// Webhook da Kiwify.
// Autenticidade: a Kiwify envia ?signature=<HMAC-SHA1 hexadecimal do corpo bruto>,
// calculado com o token configurado no webhook. Comparamos em tempo constante.
// TODO payload: os nomes de campos abaixo seguem o formato público conhecido da
// Kiwify; confirme com o payload real gravado em webhook_raw após a compra de teste.

import type { App } from "../app";
import { type Buyer, logEvent, normalizeEmail } from "../db/repo";
import { randomToken, hmacHex, safeEqual } from "../lib/crypto";
import { HttpError } from "../lib/http";
import { normalizeBrPhone } from "../lib/phone";
import { computeWindow } from "../lib/schedule";
import { fromLocal } from "../lib/time";
import { sendEmail } from "../notify/email";
import { emails, tg } from "../notify/messages";
import { sendTelegram } from "../notify/telegram";
import { cancelForRefund } from "./booking";

export type KiwifyKind = "approved" | "refunded" | "chargeback" | "other";

export interface ParsedOrder {
  kind: KiwifyKind;
  rawEvent: string;
  orderId: string;
  name: string;
  email: string;
  phone: string;
  productId: string;
  approvedAt: number | null;
}

type Obj = Record<string, any>;

const pick = (...vals: unknown[]): string => {
  for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  return "";
};

/** Datas da Kiwify: aceita ISO com fuso, "AAAA-MM-DD HH:mm[:ss]" (Brasília) ou número. */
export function parseKiwifyDate(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?$/);
  if (m) return fromLocal(m[1], `${m[2]}:${m[3]}`) + Number(m[4] ?? 0) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function classify(event: string, status: string): KiwifyKind {
  const e = event.toLowerCase();
  const s = status.toLowerCase();
  if (e.includes("chargeback") || s === "chargedback" || s === "chargeback") return "chargeback";
  if (e.includes("refund") || e.includes("reembols") || s === "refunded") return "refunded";
  if (e === "order_approved" || e === "compra_aprovada" || (!e && (s === "paid" || s === "approved"))) return "approved";
  return "other";
}

export function parseOrder(body: Obj): ParsedOrder {
  const o: Obj = body.order && typeof body.order === "object" ? body.order : body;
  const c: Obj = o.Customer ?? o.customer ?? {};
  const p: Obj = o.Product ?? o.product ?? {};
  const rawEvent = pick(o.webhook_event_type, body.webhook_event_type, o.event, body.event, o.trigger);
  const status = pick(o.order_status, o.status);
  return {
    kind: classify(rawEvent, status),
    rawEvent: rawEvent || status,
    orderId: pick(o.order_id, o.id, o.order_ref),
    name: pick(c.full_name, c.name, [c.first_name, c.last_name].filter(Boolean).join(" ")),
    email: normalizeEmail(pick(c.email)),
    phone: pick(c.mobile, c.phone, c.cellphone, c.whatsapp),
    productId: pick(p.product_id, p.id, o.product_id),
    approvedAt: parseKiwifyDate(o.approved_date ?? o.approved_at ?? o.paid_at ?? o.pay_date),
  };
}

export async function verifySignature(token: string | undefined, rawBody: string, signature: string | null): Promise<boolean> {
  if (!token || !signature) return false;
  const sig = signature.trim().toLowerCase();
  const sha1 = await hmacHex("SHA-1", token, rawBody);
  if (safeEqual(sha1, sig)) return true;
  // Tolerância caso a Kiwify passe a usar SHA-256 no mesmo parâmetro.
  const sha256 = await hmacHex("SHA-256", token, rawBody);
  return safeEqual(sha256, sig);
}

async function recordRaw(app: App, body: string, valid: boolean, event: string, orderId: string, result: string): Promise<number> {
  const r = await app.db
    .prepare(`INSERT INTO webhook_raw (received_at, body, valid, event_type, order_id, result) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(app.now(), body.slice(0, 100_000), valid ? 1 : 0, event.slice(0, 80), orderId.slice(0, 120), result)
    .run();
  return Number(r.meta.last_row_id);
}

async function setRawResult(app: App, id: number, result: string) {
  await app.db.prepare(`UPDATE webhook_raw SET result = ? WHERE id = ?`).bind(result.slice(0, 500), id).run();
}

export async function handleKiwifyWebhook(app: App, req: Request): Promise<{ result: string }> {
  const raw = await req.text();
  const url = new URL(req.url);
  const signature = url.searchParams.get("signature") ?? req.headers.get("x-kiwify-signature");
  const valid = await verifySignature(app.env.KIWIFY_WEBHOOK_TOKEN, raw, signature);

  let body: Obj | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* corpo não é JSON */
  }
  const parsed = body ? parseOrder(body) : null;
  const rawId = await recordRaw(app, raw, valid, parsed?.rawEvent ?? "", parsed?.orderId ?? "", valid ? "recebido" : "assinatura_invalida");

  if (!valid) throw new HttpError(401, "invalid_signature", "Assinatura inválida.");
  if (!parsed || !parsed.orderId) {
    await setRawResult(app, rawId, "ignorado: sem order_id");
    return { result: "ignored" };
  }

  const productFilter = app.cfg.KIWIFY_PRODUCT_ID;
  if (productFilter && parsed.productId && parsed.productId !== productFilter) {
    await setRawResult(app, rawId, `ignorado: outro produto (${parsed.productId})`);
    return { result: "ignored_product" };
  }

  switch (parsed.kind) {
    case "approved": {
      const r = await onApproved(app, parsed);
      await setRawResult(app, rawId, r);
      return { result: r };
    }
    case "refunded":
    case "chargeback": {
      const buyer = await app.db.prepare(`SELECT * FROM buyers WHERE kiwify_order_id = ?`).bind(parsed.orderId).first<Buyer>();
      if (!buyer) {
        await setRawResult(app, rawId, "reembolso de pedido sem bônus registrado");
        return { result: "unknown_order" };
      }
      await cancelForRefund(app, buyer, parsed.kind === "chargeback" ? "chargeback" : "reembolso");
      await setRawResult(app, rawId, parsed.kind);
      return { result: parsed.kind };
    }
    default:
      await setRawResult(app, rawId, `ignorado: evento ${parsed.rawEvent || "desconhecido"}`);
      await logEvent(app.db, "webhook_ignorado", { resumo: `Evento ${parsed.rawEvent} do pedido ${parsed.orderId}` });
      return { result: "ignored_event" };
  }
}

async function onApproved(app: App, o: ParsedOrder): Promise<string> {
  if (!o.email) return "ignorado: sem e-mail";
  const now = app.now();
  let approvedAt = o.approvedAt ?? now;
  // Data futura (relógio/fuso inesperado): usa o momento do recebimento.
  if (approvedAt > now + 10 * 60_000) approvedAt = now;
  const w = computeWindow(approvedAt, app.grid);
  const token = randomToken(24);
  const phone = normalizeBrPhone(o.phone) ?? "";

  const ins = await app.db
    .prepare(
      `INSERT INTO buyers (kiwify_order_id, name, email, whatsapp, product_id, approved_at, window_start, window_end, min_start, booking_token, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kiwify_order_id) DO NOTHING`,
    )
    .bind(
      o.orderId,
      o.name.slice(0, 120),
      o.email,
      phone,
      o.productId,
      approvedAt,
      w.windowStart,
      w.windowEnd,
      w.minStart,
      token,
      w.windowEnd <= now ? "expirado" : "ativo",
      now,
    )
    .run();
  if (!ins.meta.changes) return "duplicado (já registrado)";

  const buyer = (await app.db.prepare(`SELECT * FROM buyers WHERE kiwify_order_id = ?`).bind(o.orderId).first<Buyer>())!;
  await logEvent(app.db, "compra", { buyerId: buyer.id, resumo: `Pedido ${o.orderId} (${o.email})`, at: now });
  if (buyer.status === "ativo") {
    app.defer(sendEmail(app, emails.scheduleInvite(app, buyer), { buyerId: buyer.id, tipo: "convite_agendamento" }));
  }
  app.defer(sendTelegram(app, tg.newPurchase(buyer)));
  return "comprador criado";
}
