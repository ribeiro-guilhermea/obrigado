// Utilitários de data/hora no fuso de Brasília.
// Regra do sistema: tudo é gravado em UTC (milissegundos) e convertido para
// America/Sao_Paulo só no cálculo de regras e na exibição.

export const TZ = "America/Sao_Paulo";
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Data local no formato "AAAA-MM-DD". */
export type LocalDate = string;

export interface LocalParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function toLocalParts(ms: number): LocalParts {
  const out: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, hh: out.hour % 24, mm: out.minute, ss: out.second };
}

/** Diferença (local - UTC) em ms no instante informado. */
function offsetAt(ms: number): number {
  const p = toLocalParts(ms);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Converte data/hora local de Brasília para UTC (ms). */
export function fromLocal(date: LocalDate, hhmm = "00:00"): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let result = guess - offsetAt(guess);
  const second = guess - offsetAt(result);
  if (second !== result) result = second;
  return result;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDateOf(ms: number): LocalDate {
  const p = toLocalParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function localTimeOf(ms: number): string {
  const p = toLocalParts(ms);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

export function addDays(date: LocalDate, n: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = domingo ... 6 = sábado */
export function weekdayOf(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekday(date: LocalDate): boolean {
  const w = weekdayOf(date);
  return w >= 1 && w <= 5;
}

/** Próximo dia de semana (seg-sex) estritamente depois da data. */
export function nextWeekday(date: LocalDate): LocalDate {
  let d = addDays(date, 1);
  while (!isWeekday(d)) d = addDays(d, 1);
  return d;
}

/** Dia de semana (seg-sex) estritamente antes da data. */
export function prevWeekday(date: LocalDate): LocalDate {
  let d = addDays(date, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

/** Segunda-feira da semana da data. */
export function mondayOf(date: LocalDate): LocalDate {
  const w = weekdayOf(date);
  return addDays(date, w === 0 ? -6 : 1 - w);
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

const WD_SHORT = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const WD_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

export function weekdayShort(date: LocalDate): string {
  return WD_SHORT[weekdayOf(date)];
}

/** "09/11" */
export function ddmm(date: LocalDate): string {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

/** "09/11/2026" */
export function ddmmyyyy(date: LocalDate): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** "segunda-feira, 09/11/2026 às 08:00 (horário de Brasília)" */
export function formatSlotLong(ms: number): string {
  const date = localDateOf(ms);
  return `${WD_LONG[weekdayOf(date)]}, ${ddmmyyyy(date)} às ${localTimeOf(ms)} (horário de Brasília)`;
}

/** "Seg 09/11 08:00" */
export function formatSlotShort(ms: number): string {
  const date = localDateOf(ms);
  const wd = WD_SHORT[weekdayOf(date)];
  return `${wd[0]}${wd.slice(1).toLowerCase()} ${ddmm(date)} ${localTimeOf(ms)}`;
}

/** "09/11/2026 23:00" (Brasília) */
export function formatDateTime(ms: number): string {
  return `${ddmmyyyy(localDateOf(ms))} ${localTimeOf(ms)}`;
}

export function formatDateLong(date: LocalDate): string {
  return `${WD_LONG[weekdayOf(date)]}, ${ddmmyyyy(date)}`;
}
