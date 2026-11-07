import { SELF, env } from "cloudflare:test";
import { createApp } from "../src/app";
import { hmacHex } from "../src/lib/crypto";
import { localDateOf, localTimeOf } from "../src/lib/time";

export const BASE = "https://exemplo.workers.dev";
let seq = 0;
export const uid = (p = "ord") => `${p}-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 7)}`;

export function kiwifyPayload(o: {
  orderId: string; email: string; name?: string; mobile?: string; approvedAt?: number; event?: string; status?: string; productId?: string;
}) {
  const at = o.approvedAt ?? Date.now();
  return {
    order_id: o.orderId,
    order_ref: "REF" + o.orderId.slice(-6),
    order_status: o.status ?? "paid",
    webhook_event_type: o.event ?? "order_approved",
    payment_method: "pix",
    approved_date: `${localDateOf(at)} ${localTimeOf(at)}`,
    Product: { product_id: o.productId ?? "prod-moneys-map", product_name: "Money's Map" },
    Customer: { full_name: o.name ?? "Maria Teste da Silva", email: o.email, mobile: o.mobile ?? "+5511987654321" },
  };
}

export async function postWebhook(payload: unknown, opts: { token?: string; badSig?: boolean } = {}) {
  const raw = JSON.stringify(payload);
  const sig = opts.badSig ? "0".repeat(40) : await hmacHex("SHA-1", opts.token ?? "token-de-teste", raw);
  return SELF.fetch(`${BASE}/api/webhooks/kiwify?signature=${sig}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: raw,
  });
}

export async function api(path: string, init: RequestInit & { json?: unknown; cookie?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.cookie) headers["Cookie"] = init.cookie;
  if (init.ip) headers["CF-Connecting-IP"] = init.ip;
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const data: any = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

/** Cria um comprador direto pelo webhook e devolve o registro do banco. */
export async function createBuyer(o: { approvedAt?: number; email?: string; mobile?: string } = {}) {
  const orderId = uid();
  const email = o.email ?? `${uid("cli")}@teste.com`;
  const r = await postWebhook(kiwifyPayload({ orderId, email, approvedAt: o.approvedAt, mobile: o.mobile }));
  if (r.status !== 200) throw new Error("webhook falhou " + r.status + (await r.text()));
  const buyer = await env.DB.prepare(`SELECT * FROM buyers WHERE kiwify_order_id = ?`).bind(orderId).first<any>();
  return { ...buyer, orderId, email };
}

export async function adminCookie(): Promise<string> {
  const r = await api("/api/admin/login", { json: { name: "Gui", password: "senha-de-teste" }, ip: uid("ip") });
  if (r.status !== 200) throw new Error("login falhou " + JSON.stringify(r.data));
  return r.res.headers.get("Set-Cookie")!.split(";")[0];
}

export async function appForTest(now?: () => number) {
  return createApp(env as any, { now, origin: BASE });
}
