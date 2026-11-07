import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, availableSlots, computeWindow, dailySlotTimes } from "../src/lib/schedule";
import { formatSlotShort, fromLocal, localDateOf } from "../src/lib/time";

const cfg = DEFAULT_GRID;
const at = (date: string, time: string) => fromLocal(date, time);

describe("grade de horários", () => {
  it("gera os 10 horários padrão", () => {
    expect(dailySlotTimes(cfg)).toEqual([
      "08:00", "09:00", "10:00", "11:00", "13:30", "14:30", "15:30", "16:30", "17:30", "18:30",
    ]);
  });
});

// Casos obrigatórios da seção 3.3
const casos = [
  { aprov: ["2026-11-06", "23:00"], dias: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"], primeiro: "Seg 09/11 08:00" },
  { aprov: ["2026-11-09", "13:00"], dias: ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16"], primeiro: "Ter 10/11 13:30" },
  { aprov: ["2026-11-11", "10:20"], dias: ["2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18"], primeiro: "Qui 12/11 11:00" },
  { aprov: ["2026-11-16", "09:00"], dias: ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23"], primeiro: "Ter 17/11 09:00" },
  { aprov: ["2026-11-07", "15:00"], dias: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"], primeiro: "Seg 09/11 08:00" },
];

describe("janela do bônus (seção 3.3)", () => {
  for (const c of casos) {
    it(`aprovação ${c.aprov.join(" ")}`, () => {
      const approvedAt = at(c.aprov[0], c.aprov[1]);
      const w = computeWindow(approvedAt, cfg);
      expect(w.days).toEqual(c.dias);
      const slots = availableSlots(
        { window_start: w.windowStart, window_end: w.windowEnd, min_start: w.minStart },
        approvedAt, new Set(), [], cfg,
      );
      expect(formatSlotShort(slots[0])).toBe(c.primeiro);
      expect(localDateOf(slots[slots.length - 1])).toBe(c.dias[4]);
      expect(localDateOf(w.windowEnd - 1)).toBe(c.dias[4]);
    });
  }

  it("Dia 1 sem horário possível faz a janela andar um dia (qui 19:00)", () => {
    const approvedAt = at("2026-11-12", "19:00");
    const w = computeWindow(approvedAt, cfg);
    expect(w.days).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  });

  it("aprovação às 18:30 mantém o Dia 1 com o último horário", () => {
    const w = computeWindow(at("2026-11-09", "18:30"), cfg);
    expect(w.days[0]).toBe("2026-11-10");
  });
});

describe("filtros de horários", () => {
  const approvedAt = at("2026-11-06", "23:00");
  const w0 = computeWindow(approvedAt, cfg);
  const w = { window_start: w0.windowStart, window_end: w0.windowEnd, min_start: w0.minStart };

  it("não oferece horário no passado", () => {
    const now = at("2026-11-09", "10:30");
    const slots = availableSlots(w, now, new Set(), [], cfg);
    expect(formatSlotShort(slots[0])).toBe("Seg 09/11 11:00");
  });

  it("não oferece horário ocupado nem bloqueado", () => {
    const taken = new Set([at("2026-11-09", "08:00")]);
    const blocks = [{ start: at("2026-11-09", "09:00"), end: at("2026-11-09", "10:00") }];
    const slots = availableSlots(w, approvedAt, taken, blocks, cfg);
    expect(formatSlotShort(slots[0])).toBe("Seg 09/11 10:00");
  });

  it("bloqueio que encosta no meio da reunião também remove o horário", () => {
    const blocks = [{ start: at("2026-11-09", "08:30"), end: at("2026-11-09", "08:40") }];
    const slots = availableSlots(w, approvedAt, new Set(), blocks, cfg);
    expect(formatSlotShort(slots[0])).toBe("Seg 09/11 09:00");
  });

  it("nenhum horário em fim de semana nem no almoço", () => {
    const slots = availableSlots(w, approvedAt, new Set(), [], cfg);
    expect(slots.length).toBe(50);
    for (const s of slots) {
      const t = formatSlotShort(s).slice(-5);
      expect(["12:00", "12:30", "13:00"]).not.toContain(t);
    }
  });
});
