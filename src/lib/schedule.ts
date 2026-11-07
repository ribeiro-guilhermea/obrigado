// Regras de negócio da janela do bônus e da grade de horários.
// Funções puras (sem banco), para serem testadas com facilidade.

import {
  HOUR,
  MINUTE,
  type LocalDate,
  addDays,
  fromLocal,
  isWeekday,
  localDateOf,
  minutesToTime,
  nextWeekday,
  timeToMinutes,
} from "./time";

export interface GridConfig {
  workStart: string; // "08:00"
  workEnd: string; // "20:00"
  lunchStart: string; // "12:00"
  lunchEnd: string; // "13:30"
  durationMin: number; // duração da reunião (45)
  blockMin: number; // bloco ocupado por reunião (60)
  windowDays: number; // dias de semana da janela (5)
  minNoticeHours: number; // antecedência mínima após a aprovação (24)
}

export const DEFAULT_GRID: GridConfig = {
  workStart: "08:00",
  workEnd: "20:00",
  lunchStart: "12:00",
  lunchEnd: "13:30",
  durationMin: 45,
  blockMin: 60,
  windowDays: 5,
  minNoticeHours: 24,
};

/** Horários de início do dia, ex.: ["08:00", ..., "18:30"]. */
export function dailySlotTimes(cfg: GridConfig): string[] {
  const out: string[] = [];
  const add = (from: number, until: number) => {
    for (let t = from; t + cfg.durationMin <= until; t += cfg.blockMin) out.push(minutesToTime(t));
  };
  const ws = timeToMinutes(cfg.workStart);
  const we = timeToMinutes(cfg.workEnd);
  const ls = timeToMinutes(cfg.lunchStart);
  const le = timeToMinutes(cfg.lunchEnd);
  if (ls > ws && le > ls && le < we) {
    add(ws, ls);
    add(le, we);
  } else {
    add(ws, we);
  }
  return out;
}

/** Inícios (UTC ms) de todos os horários da grade de um dia. Vazio em fim de semana. */
export function slotStartsForDay(date: LocalDate, cfg: GridConfig): number[] {
  if (!isWeekday(date)) return [];
  return dailySlotTimes(cfg).map((t) => fromLocal(date, t));
}

export interface BuyerWindow {
  /** Dias de semana da janela, em ordem (Dia 1 ... Dia 5). */
  days: LocalDate[];
  /** Início do Dia 1, 00:00 de Brasília (UTC ms). */
  windowStart: number;
  /** Fim do último dia: 00:00 do dia seguinte (UTC ms, exclusivo). */
  windowEnd: number;
  /** Nenhum horário pode começar antes disso (aprovação + 24h). */
  minStart: number;
}

/**
 * Calcula a janela do bônus.
 * - Dia 1 = primeiro dia de semana depois do dia da aprovação.
 * - Se no Dia 1 nenhum horário respeitar a antecedência mínima, a janela anda
 *   um dia de semana (decisão aprovada: o comprador sempre tem 5 dias com horário).
 * - Feriados contam como dias normais; só sábado e domingo ficam de fora.
 */
export function computeWindow(approvedAt: number, cfg: GridConfig): BuyerWindow {
  const minStart = approvedAt + cfg.minNoticeHours * HOUR;
  let day1 = nextWeekday(localDateOf(approvedAt));
  for (let i = 0; i < 30; i++) {
    if (slotStartsForDay(day1, cfg).some((s) => s >= minStart)) break;
    day1 = nextWeekday(day1);
  }
  const days = [day1];
  while (days.length < cfg.windowDays) days.push(nextWeekday(days[days.length - 1]));
  const last = days[days.length - 1];
  return {
    days,
    windowStart: fromLocal(day1),
    windowEnd: fromLocal(addDays(last, 1)),
    minStart,
  };
}

/** Reconstrói a lista de dias da janela a partir das datas gravadas. */
export function windowDaysFrom(windowStart: number, windowEnd: number): LocalDate[] {
  const days: LocalDate[] = [];
  let d = localDateOf(windowStart);
  for (let i = 0; i < 60 && fromLocal(d) < windowEnd; i++) {
    if (isWeekday(d)) days.push(d);
    d = addDays(d, 1);
  }
  return days;
}

export interface WindowLike {
  window_start: number;
  window_end: number;
  min_start: number;
}

export interface Interval {
  start: number;
  end: number;
}

/** O horário [início, início + duração) encosta em algum bloqueio? */
export function overlapsBlock(slotStart: number, blocks: Interval[], cfg: GridConfig): boolean {
  const slotEnd = slotStart + cfg.durationMin * MINUTE;
  return blocks.some((b) => b.start < slotEnd && b.end > slotStart);
}

/**
 * Horários que o comprador pode escolher, considerando a grade, a janela, a
 * antecedência mínima, horários passados, horários ocupados e bloqueios.
 */
export function availableSlots(
  w: WindowLike,
  now: number,
  taken: Set<number>,
  blocks: Interval[],
  cfg: GridConfig,
): number[] {
  const out: number[] = [];
  for (const day of windowDaysFrom(w.window_start, w.window_end)) {
    for (const s of slotStartsForDay(day, cfg)) {
      if (s < w.window_start || s >= w.window_end) continue;
      if (s < w.min_start) continue;
      if (s <= now) continue;
      if (taken.has(s)) continue;
      if (overlapsBlock(s, blocks, cfg)) continue;
      out.push(s);
    }
  }
  return out;
}

/** Último dia da janela (data local). */
export function lastWindowDay(w: { window_start: number; window_end: number }): LocalDate {
  const days = windowDaysFrom(w.window_start, w.window_end);
  return days[days.length - 1];
}

/** Quantos dias da janela ainda restam, contando hoje. */
export function daysRemaining(w: { window_start: number; window_end: number }, now: number): number {
  const today = localDateOf(now);
  return windowDaysFrom(w.window_start, w.window_end).filter((d) => d >= today).length;
}

/** Agrupa horários por dia local. */
export function groupByDay(slots: number[]): { date: LocalDate; slots: number[] }[] {
  const map = new Map<LocalDate, number[]>();
  for (const s of slots) {
    const d = localDateOf(s);
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(s);
  }
  return [...map.entries()].map(([date, slots]) => ({ date, slots }));
}
