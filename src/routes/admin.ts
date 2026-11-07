// API do painel administrativo (/api/admin/*). Tudo exige login, exceto /login.

import type { App } from "../app";
import {
  type Block,
  type Booking,
  type Buyer,
  OCCUPYING_SQL,
  getBooking,
  getBuyer,
  logEvent,
} from "../db/repo";
import { CONFIG_FIELDS, saveConfig } from "../lib/config";
import { hashPassword, randomToken, safeEqual, sha256Hex, verifyPassword } from "../lib/crypto";
import { HttpError, clientIp, json, readJson, str } from "../lib/http";
import { formatBrPhone, normalizeBrPhone, waLink } from "../lib/phone";
import { rateLimit } from "../lib/ratelimit";
import { daysRemaining, dailySlotTimes, groupByDay, lastWindowDay } from "../lib/schedule";
import {
  DAY,
  HOUR,
  MINUTE,
  addDays,
  ddmm,
  formatDateLong,
  formatDateTime,
  formatSlotLong,
  formatSlotShort,
  fromLocal,
  localDateOf,
  localTimeOf,
  mondayOf,
  weekdayShort,
} from "../lib/time";
import {
  canReschedule,
  createBooking,
  rescheduleBooking,
  setBookingOutcome,
  slotsForBuyer,
} from "../services/booking";

interface AdminUser {
  id: number;
  name: string;
  is_owner: number;
  active: number;
}

const COOKIE = "mm_admin";
const SESSION_TTL = 7 * DAY;

function getCookie(req: Request, name: string): string {
  const c = req.headers.get("Cookie") ?? "";
  for (const part of c.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

function sessionCookie(token: string, maxAge: number, secure: boolean) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

async function currentUser(app: App, req: Request): Promise<AdminUser | null> {
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  return app.db
    .prepare(
      `SELECT u.id, u.name, u.is_owner, u.active FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    )
    .bind(await sha256Hex(token), app.now())
    .first<AdminUser>();
}

// ---------- formatação ----------

function buyerOut(app: App, b: Buyer) {
  const last = lastWindowDay(b);
  return {
    id: b.id,
    orderId: b.kiwify_order_id,
    name: b.name,
    email: b.email,
    whatsapp: b.whatsapp ? formatBrPhone(b.whatsapp) : "",
    waLink: b.whatsapp ? waLink(b.whatsapp) : "",
    status: b.status,
    approvedAt: b.approved_at,
    approvedLabel: formatDateTime(b.approved_at),
    lastDay: last,
    lastDayLabel: formatDateLong(last),
    daysLeft: daysRemaining(b, app.now()),
    bookingLink: `${app.baseUrl}/agendar/${b.booking_token}`,
  };
}

function bookingOut(bk: Booking) {
  return {
    id: bk.id,
    buyerId: bk.buyer_id,
    slotStart: bk.slot_start,
    label: formatSlotLong(bk.slot_start),
    short: formatSlotShort(bk.slot_start),
    status: bk.status,
    createdBy: bk.created_by,
    createdByType: bk.created_by_type,
    upgradeVendido: bk.upgrade_vendido === null ? null : bk.upgrade_vendido === 1,
    observacao: bk.observacao,
    createdAt: bk.created_at,
    createdLabel: formatDateTime(bk.created_at),
  };
}

function blockOut(b: Block) {
  const sameDay = localDateOf(b.start_at) === localDateOf(b.end_at - 1);
  return {
    id: b.id,
    start: b.start_at,
    end: b.end_at,
    label: sameDay
      ? `${formatDateLong(localDateOf(b.start_at))}, ${localTimeOf(b.start_at)} às ${localTimeOf(b.end_at) === "00:00" ? "24:00" : localTimeOf(b.end_at)}`
      : `${formatDateTime(b.start_at)} até ${formatDateTime(b.end_at)}`,
    motivo: b.motivo,
    createdBy: b.created_by,
  };
}

function slotsOut(slots: number[]) {
  return groupByDay(slots).map((d) => ({
    date: d.date,
    weekday: weekdayShort(d.date),
    label: ddmm(d.date),
    slots: d.slots.map((s) => ({ start: s, time: localTimeOf(s) })),
  }));
}

const idFrom = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "invalid_id", "ID inválido.");
  return n;
};

const dateParam = (v: string | null, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);

// ---------- rotas ----------

export async function handleAdmin(app: App, req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  const secure = url.protocol === "https:";

  if (path === "/api/admin/login" && req.method === "POST") {
    if (!(await rateLimit(app.db, `login:${clientIp(req)}`, 10, 15 * 60_000, app.now())))
      throw new HttpError(429, "too_many", "Muitas tentativas. Aguarde 15 minutos.");
    const body = await readJson(req);
    const name = str(body.name, 60);
    const password = typeof body.password === "string" ? body.password : "";
    if (!name || !password) throw new HttpError(400, "missing", "Informe nome e senha.");
    const master = app.env.ADMIN_PASSWORD ?? "";

    let user = await app.db.prepare(`SELECT * FROM admin_users WHERE name = ? AND active = 1`).bind(name).first<AdminUser & { password_hash: string }>();
    const count = (await app.db.prepare(`SELECT COUNT(*) AS n FROM admin_users`).first<{ n: number }>())!.n;

    if (!user && count === 0 && master && safeEqual(password, master)) {
      // Primeiro acesso: cria o usuário dono do painel.
      await app.db
        .prepare(`INSERT INTO admin_users (name, password_hash, is_owner, active, created_at) VALUES (?, ?, 1, 1, ?)`)
        .bind(name, await hashPassword(password), app.now())
        .run();
      user = await app.db.prepare(`SELECT * FROM admin_users WHERE name = ?`).bind(name).first();
      await logEvent(app.db, "usuario_criado", { actor: name, resumo: "Primeiro acesso (dono do painel)" });
    } else if (!user) {
      throw new HttpError(401, "invalid_login", "Nome ou senha incorretos.");
    } else {
      const ok = (await verifyPassword(password, user.password_hash)) || (user.is_owner === 1 && master !== "" && safeEqual(password, master));
      if (!ok) throw new HttpError(401, "invalid_login", "Nome ou senha incorretos.");
    }
    const token = randomToken(32);
    await app.db
      .prepare(`INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
      .bind(await sha256Hex(token), user!.id, app.now() + SESSION_TTL)
      .run();
    await app.db.prepare(`DELETE FROM admin_sessions WHERE expires_at < ?`).bind(app.now()).run();
    return json({ ok: true, user: { name: user!.name, isOwner: user!.is_owner === 1 } }, 200, {
      "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000, secure),
    });
  }

  const user = await currentUser(app, req);
  if (!user) throw new HttpError(401, "unauthorized", "Faça login.");
  if (req.method !== "GET" && !(req.headers.get("Content-Type") ?? "").includes("application/json"))
    throw new HttpError(415, "json_required", "Envie os dados em JSON.");
  const actor = user.name;
  const seg = path.split("/").filter(Boolean); // ["api","admin",...]
  const [, , res, idStr, sub] = seg;

  if (res === "logout" && req.method === "POST") {
    await app.db.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).bind(await sha256Hex(getCookie(req, COOKIE))).run();
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0, secure) });
  }

  if (res === "me") return json({ ok: true, user: { name: user.name, isOwner: user.is_owner === 1 } });

  // ----- Indicadores -----
  if (res === "stats" && req.method === "GET") {
    const today = localDateOf(app.now());
    const from = dateParam(url.searchParams.get("from"), addDays(today, -29));
    const to = dateParam(url.searchParams.get("to"), today);
    const f = fromLocal(from);
    const t = fromLocal(addDays(to, 1));
    const s = (await app.db
      .prepare(
        `SELECT
           COUNT(*) AS compras,
           SUM(CASE WHEN b.status = 'reembolsado' THEN 1 ELSE 0 END) AS reembolsos,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM bookings k WHERE k.buyer_id = b.id AND k.status IN ${OCCUPYING_SQL}) THEN 1 ELSE 0 END) AS agendaram,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM bookings k WHERE k.buyer_id = b.id AND k.status = 'realizada') THEN 1 ELSE 0 END) AS compareceram,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM bookings k WHERE k.buyer_id = b.id AND k.status = 'nao_compareceu') THEN 1 ELSE 0 END) AS faltaram,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM bookings k WHERE k.buyer_id = b.id AND k.upgrade_vendido = 1) THEN 1 ELSE 0 END) AS upgrades
         FROM buyers b WHERE b.approved_at >= ? AND b.approved_at < ?`,
      )
      .bind(f, t)
      .first<Record<string, number | null>>())!;
    const n = (k: string) => Number(s[k] ?? 0);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const concluded = n("compareceram") + n("faltaram");
    return json({
      ok: true,
      from,
      to,
      compras: n("compras"),
      reembolsos: n("reembolsos"),
      agendaram: n("agendaram"),
      compareceram: n("compareceram"),
      faltaram: n("faltaram"),
      upgrades: n("upgrades"),
      pctAgendou: pct(n("agendaram"), n("compras")),
      pctCompareceu: pct(n("compareceram"), concluded),
      pctUpgrade: pct(n("upgrades"), n("compareceram")),
    });
  }

  // ----- Agenda semanal -----
  if (res === "agenda" && req.method === "GET") {
    const monday = mondayOf(dateParam(url.searchParams.get("week"), localDateOf(app.now())));
    const days = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
    const from = fromLocal(monday);
    const to = fromLocal(addDays(monday, 5));
    const bookings = (
      await app.db
        .prepare(
          `SELECT k.*, b.name AS buyer_name FROM bookings k JOIN buyers b ON b.id = k.buyer_id
           WHERE k.status IN ${OCCUPYING_SQL} AND k.slot_start >= ? AND k.slot_start < ?`,
        )
        .bind(from, to)
        .all<Booking & { buyer_name: string }>()
    ).results;
    const blocks = (await app.db.prepare(`SELECT * FROM blocks WHERE start_at < ? AND end_at > ?`).bind(to, from).all<Block>()).results;
    const times = dailySlotTimes(app.grid);
    const byStart = new Map(bookings.map((b) => [b.slot_start, b]));
    const used = new Set<number>();
    const now = app.now();
    const out = days.map((date) => ({
      date,
      weekday: weekdayShort(date),
      label: ddmm(date),
      cells: times.map((time) => {
        const start = fromLocal(date, time);
        const end = start + app.grid.durationMin * MINUTE;
        const bk = byStart.get(start);
        if (bk) {
          used.add(bk.id);
          return { time, start, state: "booked", booking: { id: bk.id, name: bk.buyer_name, status: bk.status } };
        }
        const bl = blocks.find((x) => x.start_at < end && x.end_at > start);
        if (bl) return { time, start, state: "blocked", block: { id: bl.id, motivo: bl.motivo } };
        return { time, start, state: start <= now ? "past" : "free" };
      }),
    }));
    const offGrid = bookings
      .filter((b) => !used.has(b.id))
      .map((b) => ({ id: b.id, name: b.buyer_name, status: b.status, short: formatSlotShort(b.slot_start) }));
    return json({ ok: true, monday, prev: addDays(monday, -7), next: addDays(monday, 7), days: out, offGrid });
  }

  // ----- Agendamentos -----
  if (res === "bookings" && idStr) {
    const id = idFrom(idStr);
    const bk = await getBooking(app.db, id);
    if (!bk) throw new HttpError(404, "not_found", "Agendamento não encontrado.");
    const buyer = (await getBuyer(app.db, bk.buyer_id))!;

    if (!sub && req.method === "GET") {
      return json({ ok: true, booking: bookingOut(bk), buyer: buyerOut(app, buyer), reschedule: canReschedule(app, bk) });
    }
    if (sub === "slots" && req.method === "GET") {
      const check = canReschedule(app, bk);
      if (!check.allowed) return json({ ok: true, allowed: false, reason: check.reason, days: [] });
      return json({ ok: true, allowed: true, days: slotsOut(await slotsForBuyer(app, buyer, bk.slot_start)) });
    }
    if (sub === "reschedule" && req.method === "POST") {
      const body = await readJson(req);
      const nb = await rescheduleBooking(app, id, Number(body.slotStart), actor);
      return json({ ok: true, booking: bookingOut(nb) });
    }
    if (sub === "update" && req.method === "POST") {
      const body = await readJson<Record<string, unknown>>(req);
      const status = body.status === "realizada" || body.status === "nao_compareceu" || body.status === "agendado" ? body.status : undefined;
      const upgrade = body.upgradeVendido === undefined ? undefined : body.upgradeVendido === null ? null : body.upgradeVendido === true;
      const updated = await setBookingOutcome(
        app,
        id,
        { status, observacao: typeof body.observacao === "string" ? body.observacao : undefined, upgrade_vendido: upgrade },
        actor,
      );
      return json({ ok: true, booking: bookingOut(updated) });
    }
  }

  // ----- Compradores -----
  if (res === "buyers" && !idStr && req.method === "GET") {
    const filter = url.searchParams.get("filter") ?? "pending";
    const q = str(url.searchParams.get("q"), 100).toLowerCase();
    const now = app.now();
    let where = "";
    let order = "b.approved_at DESC";
    const binds: unknown[] = [];
    if (filter === "pending") {
      where = "b.status = 'ativo' AND b.window_end > ?";
      binds.push(now);
      order = "b.window_end ASC";
    } else if (filter === "expired") where = "b.status = 'expirado' OR (b.status = 'ativo' AND b.window_end <= ?)", binds.push(now);
    else if (filter === "refunded") where = "b.status = 'reembolsado'";
    else if (filter === "booked") where = "b.status = 'agendado'";
    else where = "1 = 1";
    if (q) {
      where = `(${where}) AND (lower(b.name) LIKE ? OR b.email LIKE ? OR b.whatsapp LIKE ?)`;
      binds.push(`%${q}%`, `%${q}%`, `%${q.replace(/\D/g, "") || q}%`);
    }
    const rows = (await app.db.prepare(`SELECT b.* FROM buyers b WHERE ${where} ORDER BY ${order} LIMIT 500`).bind(...binds).all<Buyer>()).results;
    return json({ ok: true, buyers: rows.map((b) => buyerOut(app, b)) });
  }

  if (res === "buyers" && idStr) {
    const id = idFrom(idStr);
    const buyer = await getBuyer(app.db, id);
    if (!buyer) throw new HttpError(404, "not_found", "Comprador não encontrado.");
    if (!sub && req.method === "GET") {
      const bks = (await app.db.prepare(`SELECT * FROM bookings WHERE buyer_id = ? ORDER BY id DESC`).bind(id).all<Booking>()).results;
      const evs = (
        await app.db.prepare(`SELECT * FROM events_log WHERE buyer_id = ? ORDER BY id DESC LIMIT 100`).bind(id).all<Record<string, unknown>>()
      ).results.map((e) => ({ ...e, createdLabel: formatDateTime(Number(e.created_at)) }));
      return json({ ok: true, buyer: buyerOut(app, buyer), bookings: bks.map(bookingOut), events: evs });
    }
    if (sub === "slots" && req.method === "GET") {
      return json({ ok: true, days: buyer.status === "ativo" ? slotsOut(await slotsForBuyer(app, buyer)) : [] });
    }
    if (sub === "book" && req.method === "POST") {
      const body = await readJson(req);
      const { booking } = await createBooking(app, id, Number(body.slotStart), { type: "comercial", name: actor }, {
        name: str(body.name, 120) || undefined,
        whatsapp: str(body.whatsapp, 40) || undefined,
      });
      return json({ ok: true, booking: bookingOut(booking) });
    }
    if (sub === "contact" && req.method === "POST") {
      // Corrigir nome/WhatsApp do comprador.
      const body = await readJson(req);
      const wa = str(body.whatsapp, 40);
      const norm = wa ? normalizeBrPhone(wa) : "";
      if (wa && !norm) throw new HttpError(400, "invalid_whatsapp", "WhatsApp inválido.");
      const name = str(body.name, 120) || buyer.name;
      await app.db.prepare(`UPDATE buyers SET name = ?, whatsapp = ? WHERE id = ?`).bind(name, norm ?? "", id).run();
      await logEvent(app.db, "contato_atualizado", { buyerId: id, actor });
      return json({ ok: true, buyer: buyerOut(app, (await getBuyer(app.db, id))!) });
    }
  }

  // ----- Bloqueios -----
  if (res === "blocks" && !idStr && req.method === "GET") {
    const rows = (await app.db.prepare(`SELECT * FROM blocks WHERE end_at > ? ORDER BY start_at`).bind(app.now()).all<Block>()).results;
    return json({ ok: true, blocks: rows.map(blockOut) });
  }

  if (res === "blocks" && !idStr && req.method === "POST") {
    const body = await readJson<Record<string, unknown>>(req);
    const date = dateParam(str(body.date, 10), "");
    if (!date) throw new HttpError(400, "invalid_date", "Escolha a data.");
    const mode = str(body.mode, 10);
    let start: number;
    let end: number;
    const timeOk = (t: string) => /^\d{2}:\d{2}$/.test(t);
    if (mode === "day") {
      start = fromLocal(date);
      end = fromLocal(addDays(date, 1));
    } else if (mode === "slot") {
      const t = str(body.time, 5);
      if (!timeOk(t)) throw new HttpError(400, "invalid_time", "Escolha o horário.");
      start = fromLocal(date, t);
      end = start + app.grid.blockMin * MINUTE;
    } else {
      const f = str(body.from, 5);
      const t = str(body.to, 5);
      if (!timeOk(f) || !timeOk(t)) throw new HttpError(400, "invalid_time", "Informe o horário inicial e final.");
      start = fromLocal(date, f);
      end = t === "24:00" ? fromLocal(addDays(date, 1)) : fromLocal(date, t);
    }
    if (end <= start) throw new HttpError(400, "invalid_range", "O horário final precisa ser depois do inicial.");
    if (end <= app.now()) throw new HttpError(400, "past", "Não dá para bloquear um horário que já passou.");
    const conflicts = (
      await app.db
        .prepare(
          `SELECT k.*, b.name AS buyer_name FROM bookings k JOIN buyers b ON b.id = k.buyer_id
           WHERE k.status = 'agendado' AND k.slot_start < ? AND k.slot_end > ?`,
        )
        .bind(end, start)
        .all<Booking & { buyer_name: string }>()
    ).results;
    if (conflicts.length && body.confirm !== true) {
      throw new HttpError(409, "conflict", "Já existe reunião agendada nesse período.", {
        conflicts: conflicts.map((c) => ({ id: c.id, name: c.buyer_name, short: formatSlotShort(c.slot_start) })),
      });
    }
    const motivo = str(body.motivo, 200);
    const r = await app.db
      .prepare(`INSERT INTO blocks (start_at, end_at, motivo, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(start, end, motivo, actor, app.now())
      .run();
    const block = (await app.db.prepare(`SELECT * FROM blocks WHERE id = ?`).bind(r.meta.last_row_id).first<Block>())!;
    await logEvent(app.db, "bloqueio", {
      actor,
      resumo: `${blockOut(block).label}${motivo ? ` (${motivo})` : ""}${conflicts.length ? ` — mantidas ${conflicts.length} reunião(ões) já marcadas` : ""}`,
    });
    return json({ ok: true, block: blockOut(block) });
  }

  if (res === "blocks" && idStr && req.method === "DELETE") {
    const id = idFrom(idStr);
    const b = await app.db.prepare(`SELECT * FROM blocks WHERE id = ?`).bind(id).first<Block>();
    if (!b) throw new HttpError(404, "not_found", "Bloqueio não encontrado.");
    await app.db.prepare(`DELETE FROM blocks WHERE id = ?`).bind(id).run();
    await logEvent(app.db, "bloqueio_removido", { actor, resumo: blockOut(b).label });
    return json({ ok: true });
  }

  // ----- Histórico -----
  if (res === "events" && req.method === "GET") {
    const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
    const tipo = str(url.searchParams.get("tipo"), 40);
    const rows = (
      await app.db
        .prepare(
          `SELECT e.*, b.name AS buyer_name FROM events_log e LEFT JOIN buyers b ON b.id = e.buyer_id
           WHERE e.id < ? ${tipo ? "AND e.tipo = ?" : ""} ORDER BY e.id DESC LIMIT 100`,
        )
        .bind(...(tipo ? [before, tipo] : [before]))
        .all<Record<string, unknown>>()
    ).results;
    return json({ ok: true, events: rows.map((e) => ({ ...e, createdLabel: formatDateTime(Number(e.created_at)) })) });
  }

  if (res === "webhooks" && req.method === "GET") {
    const rows = (await app.db.prepare(`SELECT * FROM webhook_raw ORDER BY id DESC LIMIT 50`).all<Record<string, unknown>>()).results;
    return json({ ok: true, webhooks: rows.map((w) => ({ ...w, receivedLabel: formatDateTime(Number(w.received_at)) })) });
  }

  // ----- Usuários -----
  if (res === "users") {
    if (req.method === "GET" && !idStr) {
      const rows = (await app.db.prepare(`SELECT id, name, is_owner, active, created_at FROM admin_users ORDER BY name`).all()).results;
      return json({ ok: true, users: rows });
    }
    if (user.is_owner !== 1) throw new HttpError(403, "forbidden", "Só o dono do painel pode gerenciar usuários.");
    if (req.method === "POST" && !idStr) {
      const body = await readJson(req);
      const name = str(body.name, 60);
      const pw = typeof body.password === "string" ? body.password : "";
      if (!name) throw new HttpError(400, "missing", "Informe o nome.");
      if (pw.length < 8) throw new HttpError(400, "weak_password", "A senha precisa ter pelo menos 8 caracteres.");
      try {
        await app.db
          .prepare(`INSERT INTO admin_users (name, password_hash, is_owner, active, created_at) VALUES (?, ?, 0, 1, ?)`)
          .bind(name, await hashPassword(pw), app.now())
          .run();
      } catch {
        throw new HttpError(409, "exists", "Já existe um usuário com esse nome.");
      }
      await logEvent(app.db, "usuario_criado", { actor, resumo: name });
      return json({ ok: true });
    }
    if (req.method === "POST" && idStr) {
      const id = idFrom(idStr);
      const body = await readJson(req);
      if (id === user.id && body.active === false) throw new HttpError(400, "self", "Você não pode desativar a si mesmo.");
      if (typeof body.active === "boolean") {
        await app.db.prepare(`UPDATE admin_users SET active = ? WHERE id = ?`).bind(body.active ? 1 : 0, id).run();
        if (!body.active) await app.db.prepare(`DELETE FROM admin_sessions WHERE user_id = ?`).bind(id).run();
      }
      if (typeof body.password === "string" && body.password) {
        if (body.password.length < 8) throw new HttpError(400, "weak_password", "A senha precisa ter pelo menos 8 caracteres.");
        await app.db.prepare(`UPDATE admin_users SET password_hash = ? WHERE id = ?`).bind(await hashPassword(body.password), id).run();
      }
      await logEvent(app.db, "usuario_alterado", { actor, resumo: `usuário #${id}` });
      return json({ ok: true });
    }
  }

  if (res === "password" && req.method === "POST") {
    const body = await readJson(req);
    const row = (await app.db.prepare(`SELECT password_hash FROM admin_users WHERE id = ?`).bind(user.id).first<{ password_hash: string }>())!;
    if (!(await verifyPassword(String(body.current ?? ""), row.password_hash))) throw new HttpError(400, "wrong_password", "Senha atual incorreta.");
    const pw = String(body.password ?? "");
    if (pw.length < 8) throw new HttpError(400, "weak_password", "A nova senha precisa ter pelo menos 8 caracteres.");
    await app.db.prepare(`UPDATE admin_users SET password_hash = ? WHERE id = ?`).bind(await hashPassword(pw), user.id).run();
    return json({ ok: true });
  }

  // ----- Configurações -----
  if (res === "config") {
    if (req.method === "GET") {
      return json({
        ok: true,
        fields: CONFIG_FIELDS.map((f) => ({ ...f, value: app.cfg[f.key] })),
        secrets: {
          KIWIFY_WEBHOOK_TOKEN: !!app.env.KIWIFY_WEBHOOK_TOKEN,
          TELEGRAM_BOT_TOKEN: !!app.env.TELEGRAM_BOT_TOKEN,
          TELEGRAM_CHAT_ID: !!app.env.TELEGRAM_CHAT_ID,
          RESEND_API_KEY: !!app.env.RESEND_API_KEY,
          BREVO_API_KEY: !!app.env.BREVO_API_KEY,
        },
        webhookUrl: `${app.baseUrl}/api/webhooks/kiwify`,
        thankYouUrl: `${app.baseUrl}/obrigado`,
      });
    }
    if (req.method === "POST") {
      const body = await readJson<Record<string, unknown>>(req);
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.values ?? {})) values[k] = String(v ?? "");
      await saveConfig(app.env, values);
      await logEvent(app.db, "configuracao", { actor, resumo: Object.keys(values).join(", ") });
      return json({ ok: true });
    }
  }

  if (res === "test-notify" && req.method === "POST") {
    const { sendTelegram } = await import("../notify/telegram");
    const ok = await sendTelegram(app, `✅ Teste do painel Money's Map, enviado por ${actor}.`);
    return json({ ok, message: ok ? "Mensagem enviada ao Telegram." : "Falhou. Confira TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID (veja o Histórico)." });
  }

  throw new HttpError(404, "not_found", "Rota não encontrada.");
}

export { HOUR };
