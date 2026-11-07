// Consultas ao banco usadas por várias partes do sistema.

export type BuyerStatus = "ativo" | "agendado" | "expirado" | "reembolsado";
export type BookingStatus = "agendado" | "realizada" | "nao_compareceu" | "remarcada" | "cancelada_reembolso";

/** Status que ocupam o horário e contam como "a reunião desta compra". */
export const OCCUPYING: BookingStatus[] = ["agendado", "realizada", "nao_compareceu"];
export const OCCUPYING_SQL = `('agendado','realizada','nao_compareceu')`;

export interface Buyer {
  id: number;
  kiwify_order_id: string;
  name: string;
  email: string;
  whatsapp: string;
  product_id: string;
  approved_at: number;
  window_start: number;
  window_end: number;
  min_start: number;
  booking_token: string;
  status: BuyerStatus;
  deadline_reminder_sent_at: number | null;
  created_at: number;
}

export interface Booking {
  id: number;
  buyer_id: number;
  slot_start: number;
  slot_end: number;
  status: BookingStatus;
  created_by: string;
  created_by_type: "cliente" | "comercial";
  upgrade_vendido: number | null;
  observacao: string;
  rescheduled_from: number | null;
  reminder_sent_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Block {
  id: number;
  start_at: number;
  end_at: number;
  motivo: string;
  created_by: string;
  created_at: number;
}

export async function logEvent(
  db: D1Database,
  tipo: string,
  opts: { buyerId?: number | null; bookingId?: number | null; resumo?: string; actor?: string; at?: number } = {},
): Promise<void> {
  await db
    .prepare(`INSERT INTO events_log (tipo, buyer_id, booking_id, resumo, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(tipo, opts.buyerId ?? null, opts.bookingId ?? null, (opts.resumo ?? "").slice(0, 2000), opts.actor ?? "sistema", opts.at ?? Date.now())
    .run();
}

export function getBuyer(db: D1Database, id: number) {
  return db.prepare(`SELECT * FROM buyers WHERE id = ?`).bind(id).first<Buyer>();
}

export function getBuyerByToken(db: D1Database, token: string) {
  return db.prepare(`SELECT * FROM buyers WHERE booking_token = ?`).bind(token).first<Buyer>();
}

export async function getBuyersByEmail(db: D1Database, email: string): Promise<Buyer[]> {
  const r = await db.prepare(`SELECT * FROM buyers WHERE email = ? ORDER BY approved_at DESC`).bind(email).all<Buyer>();
  return r.results;
}

export function getBooking(db: D1Database, id: number) {
  return db.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first<Booking>();
}

export function activeBookingOf(db: D1Database, buyerId: number) {
  return db
    .prepare(`SELECT * FROM bookings WHERE buyer_id = ? AND status IN ${OCCUPYING_SQL} ORDER BY id DESC LIMIT 1`)
    .bind(buyerId)
    .first<Booking>();
}

export async function takenSlots(db: D1Database, from: number, to: number): Promise<Set<number>> {
  const r = await db
    .prepare(`SELECT slot_start FROM bookings WHERE status IN ${OCCUPYING_SQL} AND slot_start >= ? AND slot_start < ?`)
    .bind(from, to)
    .all<{ slot_start: number }>();
  return new Set(r.results.map((x) => x.slot_start));
}

export async function blocksBetween(db: D1Database, from: number, to: number): Promise<Block[]> {
  const r = await db
    .prepare(`SELECT * FROM blocks WHERE start_at < ? AND end_at > ? ORDER BY start_at`)
    .bind(to, from)
    .all<Block>();
  return r.results;
}

export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

export function isValidEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
}

export function firstName(name: string): string {
  return (name || "").trim().split(/\s+/)[0] ?? "";
}
