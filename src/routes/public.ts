// API pública (página de obrigado). Regra de ouro: nunca devolver dados de
// outras pessoas. Quem chega pelo link pessoal (token) vê seus dados completos;
// quem se identifica só pelo e-mail recebe um acesso temporário (ticket) com o
// mínimo necessário (primeiro nome, sem WhatsApp).

import type { App } from "../app";
import {
  type Booking,
  type Buyer,
  activeBookingOf,
  firstName,
  getBuyer,
  getBuyerByToken,
  getBuyersByEmail,
  isValidEmail,
  normalizeEmail,
} from "../db/repo";
import { randomToken, sha256Hex } from "../lib/crypto";
import { HttpError, clientIp, json, readJson, str } from "../lib/http";
import { formatBrPhone } from "../lib/phone";
import { rateLimit } from "../lib/ratelimit";
import { computeWindow, daysRemaining, groupByDay, lastWindowDay } from "../lib/schedule";
import { HOUR, formatDateLong, formatSlotLong, localTimeOf, weekdayShort, ddmm } from "../lib/time";
import { createBooking, slotsForBuyer } from "../services/booking";

type Mode = "token" | "ticket";
interface Access {
  buyer: Buyer;
  mode: Mode;
}

const TICKET_TTL = 2 * HOUR;

async function issueTicket(app: App, buyerId: number): Promise<string> {
  const t = randomToken(24);
  await app.db
    .prepare(`INSERT INTO access_tickets (token_hash, buyer_id, expires_at) VALUES (?, ?, ?)`)
    .bind(await sha256Hex(t), buyerId, app.now() + TICKET_TTL)
    .run();
  return t;
}

async function resolveAccess(app: App, token: string, ticket: string): Promise<Access> {
  if (token) {
    const buyer = await getBuyerByToken(app.db, token);
    if (!buyer) throw new HttpError(404, "invalid_link", "Link de agendamento inválido.");
    return { buyer, mode: "token" };
  }
  if (ticket) {
    const row = await app.db
      .prepare(`SELECT buyer_id FROM access_tickets WHERE token_hash = ? AND expires_at > ?`)
      .bind(await sha256Hex(ticket), app.now())
      .first<{ buyer_id: number }>();
    const buyer = row ? await getBuyer(app.db, row.buyer_id) : null;
    if (!buyer) throw new HttpError(401, "ticket_expired", "Sua sessão expirou. Informe seu e-mail novamente.");
    return { buyer, mode: "ticket" };
  }
  throw new HttpError(400, "missing_access", "Identificação ausente.");
}

function windowInfo(app: App, b: { window_start: number; window_end: number }) {
  const last = lastWindowDay(b);
  return {
    lastDay: last,
    lastDayLabel: formatDateLong(last),
    lastDayShort: ddmm(last),
    daysLeft: daysRemaining(b, app.now()),
  };
}

function bookingInfo(bk: Booking) {
  return {
    slotStart: bk.slot_start,
    label: formatSlotLong(bk.slot_start),
    status: bk.status,
  };
}

async function buyerState(app: App, a: Access) {
  const b = a.buyer;
  const base = {
    mode: a.mode,
    firstName: firstName(b.name),
    ...(a.mode === "token"
      ? { name: b.name, email: b.email, whatsapp: b.whatsapp ? formatBrPhone(b.whatsapp) : "" }
      : { name: firstName(b.name), email: b.email, whatsapp: "" }),
    window: windowInfo(app, b),
  };
  if (b.status === "reembolsado") return { state: "refunded", ...base };
  const bk = await activeBookingOf(app.db, b.id);
  if (bk) return { state: "booked", ...base, booking: bookingInfo(bk) };
  if (b.status === "expirado" || b.window_end <= app.now()) return { state: "expired", ...base, expiredText: app.cfg.EXPIRED_TEXT };
  return { state: "ready", ...base };
}

/** Escolhe a compra mais relevante de um e-mail. */
async function pickBuyerForEmail(app: App, email: string): Promise<Buyer | null> {
  const list = await getBuyersByEmail(app.db, email);
  if (!list.length) return null;
  const now = app.now();
  const active = list.filter((b) => b.status === "ativo" && b.window_end > now).sort((a, b) => a.window_end - b.window_end);
  if (active.length) return active[0];
  const order = ["agendado", "expirado", "ativo", "reembolsado"];
  return [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.approved_at - a.approved_at)[0];
}

export async function handlePublic(app: App, req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);

  if (path === "/api/public/info" && req.method === "GET") {
    // Prazo estimado para quem acabou de comprar (antes de se identificar).
    const w = computeWindow(app.now(), app.grid);
    const est = { window_start: w.windowStart, window_end: w.windowEnd };
    return json({
      ok: true,
      productName: app.cfg.PRODUCT_NAME,
      videoId: app.cfg.YOUTUBE_VIDEO_ID,
      hero: { before: app.cfg.HERO_TITLE_BEFORE, highlight: app.cfg.HERO_TITLE_HIGHLIGHT, after: app.cfg.HERO_TITLE_AFTER, subtitle: app.cfg.HERO_SUBTITLE },
      bonusValue: app.cfg.BONUS_VALUE,
      supportEmail: app.cfg.SUPPORT_EMAIL,
      footerText: app.cfg.FOOTER_TEXT,
      durationMin: app.grid.durationMin,
      estimatedWindow: windowInfo(app, est),
    });
  }

  if (path === "/api/public/lookup" && req.method === "POST") {
    if (!(await rateLimit(app.db, `lookup:${clientIp(req)}`, 30, 10 * 60_000, app.now())))
      throw new HttpError(429, "too_many", "Muitas tentativas. Aguarde alguns minutos e tente de novo.");
    const body = await readJson(req);
    const email = normalizeEmail(str(body.email, 254));
    if (!isValidEmail(email)) throw new HttpError(400, "invalid_email", "Digite um e-mail válido.");
    const buyer = await pickBuyerForEmail(app, email);
    if (!buyer) return json({ ok: true, state: "not_found" });
    const ticket = await issueTicket(app, buyer.id);
    return json({ ok: true, ticket, ...(await buyerState(app, { buyer, mode: "ticket" })) });
  }

  if (path === "/api/public/me" && req.method === "GET") {
    const a = await resolveAccess(app, str(url.searchParams.get("token"), 200), str(url.searchParams.get("ticket"), 200));
    return json({ ok: true, ...(await buyerState(app, a)) });
  }

  if (path === "/api/public/slots" && req.method === "GET") {
    const a = await resolveAccess(app, str(url.searchParams.get("token"), 200), str(url.searchParams.get("ticket"), 200));
    const st = await buyerState(app, a);
    if (st.state !== "ready") return json({ ok: true, state: st.state, days: [] });
    const slots = await slotsForBuyer(app, a.buyer);
    return json({
      ok: true,
      state: "ready",
      days: groupByDay(slots).map((d) => ({
        date: d.date,
        weekday: weekdayShort(d.date),
        label: ddmm(d.date),
        slots: d.slots.map((s) => ({ start: s, time: localTimeOf(s) })),
      })),
    });
  }

  if (path === "/api/public/book" && req.method === "POST") {
    const body = await readJson(req);
    const a = await resolveAccess(app, str(body.token, 200), str(body.ticket, 200));
    if (body.accept !== true) throw new HttpError(400, "rules_not_accepted", "É preciso aceitar as regras para confirmar.");
    const { booking } = await createBooking(app, a.buyer.id, Number(body.slotStart), { type: "cliente", name: "cliente" }, {
      name: str(body.name, 120) || undefined,
      whatsapp: str(body.whatsapp, 40),
    });
    return json({ ok: true, state: "booked", booking: bookingInfo(booking), durationMin: app.grid.durationMin });
  }

  throw new HttpError(404, "not_found", "Rota não encontrada.");
}
