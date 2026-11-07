import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { HOUR, localDateOf, nextWeekday, fromLocal } from "../src/lib/time";
import { adminCookie, api, createBuyer, uid } from "./helpers";
import { outbound } from "./setup";

const freeSlots = async (token: string): Promise<number[]> =>
  (await api(`/api/public/slots?token=${token}`)).data.days.flatMap((d: any) => d.slots.map((s: any) => s.start));

describe("login do painel", () => {
  it("senha errada é recusada", async () => {
    await adminCookie();
    const r = await api("/api/admin/login", { json: { name: "Gui", password: "errada" }, ip: uid() });
    expect(r.status).toBe(401);
  });
  it("cookie de sessão é HttpOnly e seguro", async () => {
    const r = await api("/api/admin/login", { json: { name: "Gui", password: "senha-de-teste" }, ip: uid() });
    const c = r.res.headers.get("Set-Cookie")!;
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Strict");
  });
  it("dono cadastra outro usuário, que entra com a própria senha e aparece no histórico", async () => {
    const cookie = await adminCookie();
    const name = "Ana" + uid().slice(-5);
    expect((await api("/api/admin/users", { cookie, json: { name, password: "senha-da-ana-1" } })).status).toBe(200);
    const r = await api("/api/admin/login", { json: { name, password: "senha-da-ana-1" }, ip: uid() });
    expect(r.status).toBe(200);
    const anaCookie = r.res.headers.get("Set-Cookie")!.split(";")[0];
    // Ana (não dona) não pode criar usuários
    expect((await api("/api/admin/users", { cookie: anaCookie, json: { name: "X" + uid(), password: "12345678" } })).status).toBe(403);
    // agenda por um comprador
    const b = await createBuyer();
    const slots = (await api(`/api/admin/buyers/${b.id}/slots`, { cookie: anaCookie })).data.days[0].slots;
    const bk = await api(`/api/admin/buyers/${b.id}/book`, { cookie: anaCookie, json: { slotStart: slots[0].start } });
    expect(bk.status).toBe(200);
    expect(bk.data.booking.createdBy).toBe(name);
    expect(outbound.some((o) => o.url.includes("telegram") && o.body.text.includes(`comercial (${name})`))).toBe(true);
  });
});

describe("remarcação", () => {
  it("permite dentro da janela com 24h+ e libera o horário antigo", async () => {
    const cookie = await adminCookie();
    const b = await createBuyer();
    const slots = await freeSlots(b.booking_token);
    const oldSlot = slots[slots.length - 1];
    const bk = await api("/api/public/book", { json: { token: b.booking_token, slotStart: oldSlot, whatsapp: "11987654321", accept: true } });
    const id = bk.data.booking.slotStart ? (await env.DB.prepare(`SELECT id FROM bookings WHERE buyer_id = ?`).bind(b.id).first<any>()).id : 0;
    const det = await api(`/api/admin/bookings/${id}`, { cookie });
    expect(det.data.reschedule.allowed).toBe(true);
    const opts = (await api(`/api/admin/bookings/${id}/slots`, { cookie })).data.days.flatMap((d: any) => d.slots.map((s: any) => s.start));
    const newSlot = opts.find((s: number) => s !== oldSlot);
    const r = await api(`/api/admin/bookings/${id}/reschedule`, { cookie, json: { slotStart: newSlot } });
    expect(r.status).toBe(200);
    const old = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first<any>();
    expect(old.status).toBe("remarcada");
    const other = await createBuyer();
    expect(await freeSlots(other.booking_token)).toContain(oldSlot);
    expect(outbound.some((o) => o.url.includes("telegram") && o.body.text.includes("Remarcação"))).toBe(true);
    const hist = await env.DB.prepare(`SELECT actor FROM events_log WHERE tipo = 'remarcacao' AND buyer_id = ?`).bind(b.id).first<any>();
    expect(hist.actor).toBe("Gui");
  });

  it("bloqueia remarcação fora da janela original", async () => {
    const cookie = await adminCookie();
    const b = await createBuyer();
    const slot = (await freeSlots(b.booking_token))[0];
    await api("/api/public/book", { json: { token: b.booking_token, slotStart: slot, whatsapp: "11987654321", accept: true } });
    const id = (await env.DB.prepare(`SELECT id FROM bookings WHERE buyer_id = ?`).bind(b.id).first<any>()).id;
    const outside = fromLocal(nextWeekday(localDateOf(b.window_end)), "10:00");
    const r = await api(`/api/admin/bookings/${id}/reschedule`, { cookie, json: { slotStart: outside } });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe("invalid_slot");
  });

  it("bloqueia remarcação com menos de 24h de antecedência", async () => {
    const cookie = await adminCookie();
    const b = await createBuyer();
    const soon = Date.now() + 10 * HOUR;
    const ins = await env.DB.prepare(
      `INSERT INTO bookings (buyer_id, slot_start, slot_end, status, created_by, created_by_type, created_at, updated_at)
       VALUES (?, ?, ?, 'agendado', 'cliente', 'cliente', ?, ?)`,
    ).bind(b.id, soon, soon + 45 * 60_000, Date.now(), Date.now()).run();
    const id = ins.meta.last_row_id;
    const det = await api(`/api/admin/bookings/${id}`, { cookie });
    expect(det.data.reschedule.allowed).toBe(false);
    expect(det.data.reschedule.reason).toContain("24 horas");
    const slot = (await api(`/api/admin/buyers/${b.id}/slots`, { cookie })).data.days[0]?.slots[0]?.start ?? soon + 48 * HOUR;
    const r = await api(`/api/admin/bookings/${id}/reschedule`, { cookie, json: { slotStart: slot } });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe("reschedule_not_allowed");
  });
});

describe("bloqueios, resultado e indicadores", () => {
  it("bloquear horário com reunião exige confirmação e mostra o conflito", async () => {
    const cookie = await adminCookie();
    const b = await createBuyer();
    const slot = (await freeSlots(b.booking_token))[0];
    await api("/api/public/book", { json: { token: b.booking_token, slotStart: slot, whatsapp: "11987654321", accept: true } });
    const date = localDateOf(slot);
    const r = await api("/api/admin/blocks", { cookie, json: { date, mode: "day", motivo: "viagem" } });
    expect(r.status).toBe(409);
    expect(r.data.conflicts.length).toBeGreaterThan(0);
    const ok = await api("/api/admin/blocks", { cookie, json: { date, mode: "day", motivo: "viagem", confirm: true } });
    expect(ok.status).toBe(200);
    const list = await api("/api/admin/blocks", { cookie });
    expect(list.data.blocks.some((x: any) => x.id === ok.data.block.id)).toBe(true);
    await api(`/api/admin/blocks/${ok.data.block.id}`, { cookie, method: "DELETE", headers: { "Content-Type": "application/json" } });
  });

  it("não marca resultado antes da reunião; marca depois e conta nos indicadores", async () => {
    const cookie = await adminCookie();
    const b = await createBuyer();
    const slot = (await freeSlots(b.booking_token))[0];
    await api("/api/public/book", { json: { token: b.booking_token, slotStart: slot, whatsapp: "11987654321", accept: true } });
    const id = (await env.DB.prepare(`SELECT id FROM bookings WHERE buyer_id = ?`).bind(b.id).first<any>()).id;
    expect((await api(`/api/admin/bookings/${id}/update`, { cookie, json: { status: "realizada" } })).status).toBe(409);
    // simula reunião no passado
    await env.DB.prepare(`UPDATE bookings SET slot_start = slot_start - 30*86400000, slot_end = slot_end - 30*86400000 WHERE id = ?`).bind(id).run();
    const r = await api(`/api/admin/bookings/${id}/update`, { cookie, json: { status: "realizada", upgradeVendido: true, observacao: "Fechou o anual" } });
    expect(r.status).toBe(200);
    expect(r.data.booking.upgradeVendido).toBe(true);
    const s = await api("/api/admin/stats", { cookie });
    expect(s.data.compras).toBeGreaterThan(0);
    expect(s.data.upgrades).toBeGreaterThan(0);
  });

  it("lista compradores sem agendamento por menos dias restantes", async () => {
    const cookie = await adminCookie();
    await createBuyer({ approvedAt: Date.now() - 2 * 24 * HOUR });
    await createBuyer();
    const r = await api("/api/admin/buyers?filter=pending", { cookie });
    const ends = r.data.buyers.map((b: any) => b.daysLeft);
    expect([...ends].sort((a, b) => a - b)).toEqual(ends);
    expect(r.data.buyers[0].waLink).toContain("https://wa.me/55");
  });

  it("configurações salvas no painel aparecem na página pública", async () => {
    const cookie = await adminCookie();
    await api("/api/admin/config", { cookie, json: { values: { YOUTUBE_VIDEO_ID: "abcDEF12345" } } });
    const info = await api("/api/public/info");
    expect(info.data.videoId).toBe("abcDEF12345");
    await api("/api/admin/config", { cookie, json: { values: { YOUTUBE_VIDEO_ID: "" } } });
  });
});
