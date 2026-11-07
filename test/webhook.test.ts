import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parseKiwifyDate, parseOrder } from "../src/services/kiwify";
import { fromLocal } from "../src/lib/time";
import { api, createBuyer, kiwifyPayload, postWebhook, uid } from "./helpers";
import { outbound } from "./setup";

describe("leitura do payload da Kiwify", () => {
  it("interpreta data sem fuso como horário de Brasília", () => {
    expect(parseKiwifyDate("2026-11-06 23:00")).toBe(fromLocal("2026-11-06", "23:00"));
    expect(parseKiwifyDate("2026-11-07T02:00:00.000Z")).toBe(Date.parse("2026-11-07T02:00:00.000Z"));
  });
  it("aceita payload com o pedido dentro de 'order'", () => {
    const p = parseOrder({ order: kiwifyPayload({ orderId: "A1", email: "X@Y.com" }) });
    expect(p.kind).toBe("approved");
    expect(p.orderId).toBe("A1");
    expect(p.email).toBe("x@y.com");
  });
  it("classifica reembolso e chargeback", () => {
    expect(parseOrder({ order_id: "1", webhook_event_type: "order_refunded", order_status: "refunded" }).kind).toBe("refunded");
    expect(parseOrder({ order_id: "1", webhook_event_type: "chargeback", order_status: "chargedback" }).kind).toBe("chargeback");
    expect(parseOrder({ order_id: "1", webhook_event_type: "billet_created", order_status: "waiting_payment" }).kind).toBe("other");
  });
});

describe("webhook da Kiwify", () => {
  it("rejeita assinatura inválida e grava o payload bruto", async () => {
    const orderId = uid();
    const r = await postWebhook(kiwifyPayload({ orderId, email: "a@b.com" }), { badSig: true });
    expect(r.status).toBe(401);
    const raw = await env.DB.prepare(`SELECT * FROM webhook_raw WHERE order_id = ?`).bind(orderId).first<any>();
    expect(raw.valid).toBe(0);
    const buyer = await env.DB.prepare(`SELECT * FROM buyers WHERE kiwify_order_id = ?`).bind(orderId).first();
    expect(buyer).toBeNull();
  });

  it("rejeita requisição sem assinatura", async () => {
    const r = await (await import("cloudflare:test")).SELF.fetch("https://exemplo.workers.dev/api/webhooks/kiwify", {
      method: "POST", body: JSON.stringify(kiwifyPayload({ orderId: uid(), email: "a@b.com" })),
    });
    expect(r.status).toBe(401);
  });

  it("compra aprovada cria comprador, token, e-mail e aviso no Telegram", async () => {
    const b = await createBuyer();
    expect(b.status).toBe("ativo");
    expect(b.booking_token.length).toBeGreaterThan(20);
    expect(b.whatsapp).toBe("5511987654321");
    expect(outbound.some((o) => o.url.includes("telegram") && o.body.text.includes("Nova compra"))).toBe(true);
    const mail = outbound.find((o) => o.url.includes("resend"));
    expect(mail?.body.subject).toBe("Agende sua Reunião de Implementação");
    expect(mail?.body.html).toContain(`/agendar/${b.booking_token}`);
  });

  it("webhook repetido não duplica comprador nem e-mail", async () => {
    const orderId = uid();
    const p = kiwifyPayload({ orderId, email: `${uid()}@t.com` });
    expect((await postWebhook(p)).status).toBe(200);
    const countMails = () => outbound.filter((o) => o.url.includes("resend")).length;
    const first = countMails();
    const r2 = await postWebhook(p);
    expect(r2.status).toBe(200);
    expect((await r2.json<any>()).result).toContain("duplicado");
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM buyers WHERE kiwify_order_id = ?`).bind(orderId).first<any>();
    expect(n.n).toBe(1);
    expect(countMails()).toBe(first);
  });

  it("ignora outro produto da conta", async () => {
    const orderId = uid();
    const r = await postWebhook(kiwifyPayload({ orderId, email: "z@z.com", productId: "outro" }));
    expect((await r.json<any>()).result).toBe("ignored_product");
    expect(await env.DB.prepare(`SELECT 1 FROM buyers WHERE kiwify_order_id = ?`).bind(orderId).first()).toBeNull();
  });

  it("reembolso cancela o bônus, libera o horário e avisa no Telegram", async () => {
    const b = await createBuyer();
    const slots = await api(`/api/public/slots?token=${b.booking_token}`);
    const slot = slots.data.days[0].slots[0].start;
    const book = await api("/api/public/book", { json: { token: b.booking_token, slotStart: slot, whatsapp: "11987654321", accept: true } });
    expect(book.status).toBe(200);
    outbound.length = 0;

    const r = await postWebhook(kiwifyPayload({ orderId: b.orderId, email: b.email, event: "order_refunded", status: "refunded" }));
    expect(r.status).toBe(200);
    const after = await env.DB.prepare(`SELECT status FROM buyers WHERE id = ?`).bind(b.id).first<any>();
    expect(after.status).toBe("reembolsado");
    const bk = await env.DB.prepare(`SELECT status FROM bookings WHERE buyer_id = ?`).bind(b.id).first<any>();
    expect(bk.status).toBe("cancelada_reembolso");
    const tg = outbound.find((o) => o.url.includes("telegram"));
    expect(tg?.body.text).toContain("Reembolso");
    expect(tg?.body.text).toContain("horário liberado");

    // O horário volta a ficar disponível para outra pessoa.
    const other = await createBuyer();
    const s2 = await api(`/api/public/slots?token=${other.booking_token}`);
    const all = s2.data.days.flatMap((d: any) => d.slots.map((s: any) => s.start));
    expect(all).toContain(slot);
  });

  it("chargeback também cancela", async () => {
    const b = await createBuyer();
    await postWebhook(kiwifyPayload({ orderId: b.orderId, email: b.email, event: "chargeback", status: "chargedback" }));
    const after = await env.DB.prepare(`SELECT status FROM buyers WHERE id = ?`).bind(b.id).first<any>();
    expect(after.status).toBe("reembolsado");
  });
});
