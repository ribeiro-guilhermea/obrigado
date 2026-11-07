import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DAY, HOUR, fromLocal, localDateOf, nextWeekday } from "../src/lib/time";
import { adminCookie, api, createBuyer } from "./helpers";
import { outbound, outboundMode } from "./setup";

const book = (token: string, slotStart: number, extra: Record<string, unknown> = {}) =>
  api("/api/public/book", { json: { token, slotStart, whatsapp: "(11) 98765-4321", accept: true, ...extra } });

const freeSlots = async (token: string): Promise<number[]> =>
  (await api(`/api/public/slots?token=${token}`)).data.days.flatMap((d: any) => d.slots.map((s: any) => s.start));

describe("agendamento pela API pública", () => {
  it("dois agendamentos simultâneos no mesmo horário: só um é aceito", async () => {
    const a = await createBuyer();
    const b = await createBuyer();
    const slot = (await freeSlots(a.booking_token))[3];
    const [r1, r2] = await Promise.all([book(a.booking_token, slot), book(b.booking_token, slot)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.data.error).toBe("slot_taken");
    expect(loser.data.message).toContain("acabou de ser reservado");
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE slot_start = ? AND status = 'agendado'`).bind(slot).first<any>();
    expect(n.n).toBe(1);
  });

  it("a mesma compra não agenda duas vezes", async () => {
    const a = await createBuyer();
    const slots = await freeSlots(a.booking_token);
    expect((await book(a.booking_token, slots[0])).status).toBe(200);
    const r = await book(a.booking_token, slots[1]);
    expect(r.status).toBe(409);
    expect(r.data.error).toBe("already_booked");
  });

  it("corrida da mesma compra em duas abas: só uma reunião", async () => {
    const a = await createBuyer();
    const slots = await freeSlots(a.booking_token);
    const rs = await Promise.all([book(a.booking_token, slots[0]), book(a.booking_token, slots[1])]);
    expect(rs.filter((r) => r.status === 200).length).toBe(1);
  });

  it("recusa horários proibidos chamando a API diretamente", async () => {
    const a = await createBuyer();
    const w = { start: a.window_start, end: a.window_end };
    const firstDay = localDateOf(w.start);
    const cases: Record<string, number> = {
      almoco: fromLocal(firstDay, "12:00"),
      foraDaGrade: fromLocal(firstDay, "08:30"),
      depoisDaJanela: fromLocal(nextWeekday(localDateOf(w.end)), "09:00"),
      antesDe24h: a.approved_at + 2 * HOUR,
      passado: Date.now() - DAY,
      noite: fromLocal(firstDay, "20:00"),
    };
    // fim de semana dentro do intervalo
    let d = localDateOf(w.start);
    while (![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay())) d = localDateOf(fromLocal(d) + DAY + HOUR);
    cases.fimDeSemana = fromLocal(d, "09:00");
    for (const [nome, slot] of Object.entries(cases)) {
      const r = await book(a.booking_token, slot);
      expect(r.status, nome).toBe(400);
      expect(r.data.error, nome).toBe("invalid_slot");
    }
  });

  it("comprador antigo não vê nem agenda horários no passado", async () => {
    const approvedAt = Date.now() - 3 * DAY;
    const a = await createBuyer({ approvedAt });
    const slots = await freeSlots(a.booking_token);
    expect(slots.every((s) => s > Date.now())).toBe(true);
    const pastInWindow = a.min_start + HOUR; // dentro da janela, mas já passou? depende do dia
    if (pastInWindow < Date.now()) {
      const r = await book(a.booking_token, pastInWindow);
      expect(r.status).toBe(400);
    }
  });

  it("horário bloqueado não aparece e não pode ser agendado", async () => {
    const cookie = await adminCookie();
    const a = await createBuyer();
    const slot = (await freeSlots(a.booking_token))[0];
    const date = localDateOf(slot);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(slot);
    const bl = await api("/api/admin/blocks", { cookie, json: { date, mode: "slot", time, motivo: "médico" } });
    expect(bl.status).toBe(200);
    expect(await freeSlots(a.booking_token)).not.toContain(slot);
    const r = await book(a.booking_token, slot);
    expect(r.status).toBe(400);
    await api(`/api/admin/blocks/${bl.data.block.id}`, { method: "DELETE", cookie, headers: { "Content-Type": "application/json" } });
    expect(await freeSlots(a.booking_token)).toContain(slot);
  });

  it("exige aceite das regras e WhatsApp válido", async () => {
    const a = await createBuyer();
    const slot = (await freeSlots(a.booking_token))[0];
    expect((await book(a.booking_token, slot, { accept: false })).data.error).toBe("rules_not_accepted");
    expect((await book(a.booking_token, slot, { whatsapp: "1234" })).data.error).toBe("invalid_whatsapp");
    expect((await book(a.booking_token, slot, { whatsapp: "(00) 98765-4321" })).data.error).toBe("invalid_whatsapp");
  });

  it("falha do Telegram e do e-mail não impede o agendamento", async () => {
    const a = await createBuyer();
    const slot = (await freeSlots(a.booking_token))[0];
    outboundMode.fail = true;
    const r = await book(a.booking_token, slot);
    expect(r.status).toBe(200);
    expect(r.data.booking.label).toContain("horário de Brasília");
    await new Promise((res) => setTimeout(res, 50));
    const err = await env.DB.prepare(`SELECT COUNT(*) AS n FROM events_log WHERE tipo IN ('erro_telegram','erro_email') AND created_at > ?`).bind(Date.now() - 60_000).first<any>();
    expect(err.n).toBeGreaterThan(0);
  });

  it("após agendar, envia confirmação e avisa o time", async () => {
    const a = await createBuyer();
    outbound.length = 0;
    const slot = (await freeSlots(a.booking_token))[0];
    await book(a.booking_token, slot);
    await new Promise((res) => setTimeout(res, 50));
    expect(outbound.some((o) => o.url.includes("telegram") && o.body.text.includes("Novo agendamento") && o.body.text.includes("cliente"))).toBe(true);
    expect(outbound.some((o) => o.url.includes("resend") && o.body.subject.includes("confirmada"))).toBe(true);
    const me = await api(`/api/public/me?token=${a.booking_token}`);
    expect(me.data.state).toBe("booked");
  });
});

describe("identificação por e-mail e privacidade", () => {
  it("e-mail sem compra retorna not_found", async () => {
    const r = await api("/api/public/lookup", { json: { email: "ninguem@nada.com" }, ip: "1.1.1.1" });
    expect(r.data.state).toBe("not_found");
  });

  it("busca por e-mail não expõe WhatsApp nem sobrenome", async () => {
    const a = await createBuyer();
    const r = await api("/api/public/lookup", { json: { email: a.email.toUpperCase() }, ip: "2.2.2.2" });
    expect(r.data.state).toBe("ready");
    expect(r.data.whatsapp).toBe("");
    expect(r.data.name).toBe("Maria");
    expect(JSON.stringify(r.data)).not.toContain("98765");
    expect(JSON.stringify(r.data)).not.toContain(a.booking_token);
    // com o ticket consegue agendar informando o WhatsApp
    const slots = (await api(`/api/public/slots?ticket=${r.data.ticket}`)).data.days[0].slots;
    const b = await api("/api/public/book", { json: { ticket: r.data.ticket, slotStart: slots[0].start, whatsapp: "21987654321", accept: true } });
    expect(b.status).toBe(200);
  });

  it("API de horários devolve apenas horários", async () => {
    const a = await createBuyer();
    const r = await api(`/api/public/slots?token=${a.booking_token}`);
    const txt = JSON.stringify(r.data);
    expect(txt).not.toMatch(/@|name|email|whatsapp/i);
  });

  it("token inválido não revela nada", async () => {
    const r = await api(`/api/public/me?token=invalido`);
    expect(r.status).toBe(404);
  });

  it("limita tentativas de busca por e-mail", async () => {
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await api("/api/public/lookup", { json: { email: `x${i}@y.com` }, ip: "9.9.9.9" })).status;
    expect(last).toBe(429);
  });

  it("rotas do painel exigem login", async () => {
    for (const p of ["/api/admin/buyers", "/api/admin/agenda", "/api/admin/events", "/api/admin/webhooks"]) {
      expect((await api(p)).status).toBe(401);
    }
  });
});
