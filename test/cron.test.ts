import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { computeWindow, DEFAULT_GRID } from "../src/lib/schedule";
import { fromLocal } from "../src/lib/time";
import { dailySummary, deadlineReminderMoment, reminderMoment, runEvery15 } from "../src/services/cron";
import { BASE, kiwifyPayload, postWebhook, uid } from "./helpers";
import { outbound } from "./setup";

const at = fromLocal;

/** Cria comprador com aprovação na data indicada e opcionalmente uma reunião. */
async function seed(approvedAt: number, slot?: number, createdAt?: number) {
  const orderId = uid();
  const email = `${uid("c")}@t.com`;
  await postWebhook(kiwifyPayload({ orderId, email, approvedAt }));
  const buyer = await env.DB.prepare(`SELECT * FROM buyers WHERE kiwify_order_id = ?`).bind(orderId).first<any>();
  // Corrige a janela para a data simulada (o webhook pode ter usado "agora" se a data fosse futura).
  const w = computeWindow(approvedAt, DEFAULT_GRID);
  await env.DB.prepare(`UPDATE buyers SET approved_at = ?, window_start = ?, window_end = ?, min_start = ? WHERE id = ?`)
    .bind(approvedAt, w.windowStart, w.windowEnd, w.minStart, buyer.id).run();
  if (slot) {
    await env.DB.prepare(`DELETE FROM bookings WHERE slot_start = ?`).bind(slot).run();
    await env.DB.prepare(
      `INSERT INTO bookings (buyer_id, slot_start, slot_end, status, created_by, created_by_type, created_at, updated_at)
       VALUES (?, ?, ?, 'agendado', 'cliente', 'cliente', ?, ?)`,
    ).bind(buyer.id, slot, slot + 45 * 60_000, createdAt ?? approvedAt, createdAt ?? approvedAt).run();
    await env.DB.prepare(`UPDATE buyers SET status = 'agendado' WHERE id = ?`).bind(buyer.id).run();
  }
  return { ...buyer, email };
}

const appAt = (now: number) => createApp(env as any, { now: () => now, origin: BASE });

describe("momentos dos lembretes", () => {
  it("reunião de segunda → lembrete sexta 18:00", () => {
    expect(reminderMoment(at("2026-11-16", "08:00"))).toBe(at("2026-11-13", "18:00"));
    expect(reminderMoment(at("2026-11-18", "14:30"))).toBe(at("2026-11-17", "18:00"));
  });
  it("lembrete de prazo: 09:00 do dia útil anterior ao último dia", () => {
    const w = computeWindow(at("2026-11-06", "23:00"), DEFAULT_GRID);
    expect(deadlineReminderMoment({ window_start: w.windowStart, window_end: w.windowEnd })).toBe(at("2026-11-12", "09:00"));
  });
});

describe("tarefa a cada 15 minutos", () => {
  it("envia lembrete de véspera uma única vez", async () => {
    const b = await seed(at("2027-03-01", "10:00"), at("2027-03-09", "10:00"), at("2027-03-02", "12:00")); // reunião ter 09/03
    const app = await appAt(at("2027-03-08", "18:05"));
    await runEvery15(app);
    const mails = () => outbound.filter((o) => o.url.includes("resend") && o.body.to[0] === b.email && o.body.subject.startsWith("Lembrete"));
    expect(mails().length).toBe(1);
    expect(mails()[0].body.html).toContain("terça-feira, 09/03/2027 às 10:00");
    await runEvery15(app);
    expect(mails().length).toBe(1);
  });

  it("não envia antes das 18:00 da véspera", async () => {
    const b = await seed(at("2027-04-01", "10:00"), at("2027-04-07", "11:00"), at("2027-04-02", "09:00")); // qua 07/04
    await runEvery15(await appAt(at("2027-04-06", "17:50")));
    expect(outbound.some((o) => o.url.includes("resend") && o.body.to[0] === b.email && o.body.subject.startsWith("Lembrete"))).toBe(false);
  });

  it("agendamento feito depois das 18:00 da véspera não recebe lembrete", async () => {
    const b = await seed(at("2027-05-03", "10:00"), at("2027-05-11", "09:00"), at("2027-05-10", "19:00")); // reunião ter 11/05, agendou seg 19h
    await runEvery15(await appAt(at("2027-05-10", "19:15")));
    expect(outbound.some((o) => o.url.includes("resend") && o.body.to[0] === b.email && o.body.subject.startsWith("Lembrete"))).toBe(false);
  });

  it("expira quem terminou a janela sem agendar", async () => {
    const b = await seed(at("2027-06-01", "10:00")); // janela qua 02 a ter 08/06
    await runEvery15(await appAt(at("2027-06-09", "00:10")));
    const r = await env.DB.prepare(`SELECT status FROM buyers WHERE id = ?`).bind(b.id).first<any>();
    expect(r.status).toBe("expirado");
    const ev = await env.DB.prepare(`SELECT COUNT(*) AS n FROM events_log WHERE tipo = 'bonus_expirado' AND buyer_id = ?`).bind(b.id).first<any>();
    expect(ev.n).toBe(1);
  });

  it("lembrete de prazo para quem ainda não agendou", async () => {
    const b = await seed(at("2027-07-01", "10:00")); // janela sex 02 a qui 08/07
    const app = await appAt(at("2027-07-07", "09:10"));
    await runEvery15(app);
    await runEvery15(app);
    const m = outbound.filter((o) => o.url.includes("resend") && o.body.to[0] === b.email && o.body.subject.includes("termina amanhã"));
    expect(m.length).toBe(1);
  });
});

describe("resumo diário no Telegram", () => {
  it("lista reuniões do dia e prazos terminando", async () => {
    const withMeeting = await seed(at("2027-08-02", "10:00"), at("2027-08-05", "14:30"), at("2027-08-03", "10:00"));
    const ending = await seed(at("2027-07-29", "11:00")); // janela sex 30/07 a qui 05/08
    outbound.length = 0;
    const text = await dailySummary(await appAt(at("2027-08-05", "07:30")));
    expect(text).toContain("14:30");
    expect(text).toContain(withMeeting.name);
    expect(text).toContain("prazo: quinta-feira, 05/08/2027");
    expect(outbound.some((o) => o.url.includes("telegram") && o.body.text === text)).toBe(true);
    expect(ending.id).toBeGreaterThan(0);
  });
});
