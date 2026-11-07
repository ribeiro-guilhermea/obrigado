// Regras de agendamento, remarcação, reembolso e expiração.
// A página pública e o painel usam as MESMAS funções, então as regras valem igual nos dois.

import type { App } from "../app";
import {
  type Booking,
  type Buyer,
  OCCUPYING_SQL,
  activeBookingOf,
  blocksBetween,
  getBooking,
  getBuyer,
  logEvent,
  takenSlots,
} from "../db/repo";
import { HttpError } from "../lib/http";
import { normalizeBrPhone } from "../lib/phone";
import { availableSlots } from "../lib/schedule";
import { HOUR, MINUTE, formatSlotShort } from "../lib/time";
import { sendEmail } from "../notify/email";
import { emails, tg } from "../notify/messages";
import { sendTelegram } from "../notify/telegram";

export interface Actor {
  type: "cliente" | "comercial";
  name: string;
}

/** Horários livres para este comprador (respeita todas as regras). */
export async function slotsForBuyer(app: App, buyer: Buyer, ignoreSlot?: number): Promise<number[]> {
  const taken = await takenSlots(app.db, buyer.window_start, buyer.window_end);
  if (ignoreSlot !== undefined) taken.delete(ignoreSlot);
  const blocks = await blocksBetween(app.db, buyer.window_start, buyer.window_end);
  return availableSlots(
    buyer,
    app.now(),
    taken,
    blocks.map((b) => ({ start: b.start_at, end: b.end_at })),
    app.grid,
  );
}

function statusError(buyer: Buyer, now: number): HttpError | null {
  if (buyer.status === "reembolsado") return new HttpError(409, "refunded", "Esta compra foi reembolsada e o bônus foi cancelado.");
  if (buyer.status === "expirado" || buyer.window_end <= now)
    return new HttpError(409, "expired", "O prazo para agendar o bônus terminou.");
  return null;
}

function mapDbError(e: unknown): HttpError {
  const msg = String((e as Error)?.message ?? e);
  if (msg.includes("slot_blocked")) return new HttpError(409, "slot_taken", "Esse horário acabou de ficar indisponível, escolha outro.");
  if (msg.includes("bookings.slot_start")) return new HttpError(409, "slot_taken", "Esse horário acabou de ser reservado, escolha outro.");
  if (msg.includes("bookings.buyer_id")) return new HttpError(409, "already_booked", "Esta compra já tem uma reunião agendada.");
  throw e;
}

/** Valida e grava um novo agendamento. */
export async function createBooking(
  app: App,
  buyerId: number,
  slotStart: number,
  actor: Actor,
  data: { name?: string; whatsapp?: string } = {},
): Promise<{ buyer: Buyer; booking: Booking }> {
  const buyer = await getBuyer(app.db, buyerId);
  if (!buyer) throw new HttpError(404, "not_found", "Compra não encontrada.");
  if (buyer.status === "agendado" || (await activeBookingOf(app.db, buyer.id)))
    throw new HttpError(409, "already_booked", "Esta compra já tem uma reunião agendada.");
  const se = statusError(buyer, app.now());
  if (se) throw se;

  const name = (data.name ?? buyer.name).trim().slice(0, 120) || buyer.name;
  const whatsappInput = data.whatsapp ?? buyer.whatsapp;
  const whatsapp = normalizeBrPhone(whatsappInput);
  if (!whatsapp) throw new HttpError(400, "invalid_whatsapp", "Informe um WhatsApp válido com DDD.");
  if (!name) throw new HttpError(400, "invalid_name", "Informe seu nome.");

  if (!Number.isInteger(slotStart)) throw new HttpError(400, "invalid_slot", "Horário inválido.");
  const free = await slotsForBuyer(app, buyer);
  if (!free.includes(slotStart)) {
    // Diferencia "alguém pegou agora" de "horário que nunca foi permitido".
    const taken = await takenSlots(app.db, slotStart, slotStart + 1);
    if (taken.has(slotStart)) throw new HttpError(409, "slot_taken", "Esse horário acabou de ser reservado, escolha outro.");
    throw new HttpError(400, "invalid_slot", "Esse horário não está disponível para a sua compra.");
  }

  const now = app.now();
  const slotEnd = slotStart + app.grid.durationMin * MINUTE;
  const createdBy = actor.type === "cliente" ? "cliente" : actor.name;
  let bookingId: number;
  try {
    const [ins] = await app.db.batch([
      app.db
        .prepare(
          `INSERT INTO bookings (buyer_id, slot_start, slot_end, status, created_by, created_by_type, created_at, updated_at)
           SELECT ?, ?, ?, 'agendado', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM buyers WHERE id = ? AND status = 'ativo')`,
        )
        .bind(buyer.id, slotStart, slotEnd, createdBy, actor.type, now, now, buyer.id),
      app.db
        .prepare(
          `UPDATE buyers SET status = 'agendado', name = ?, whatsapp = ?
           WHERE id = ? AND status = 'ativo' AND EXISTS (SELECT 1 FROM bookings WHERE buyer_id = ? AND status = 'agendado')`,
        )
        .bind(name, whatsapp, buyer.id, buyer.id),
    ]);
    if (!ins.meta.changes) throw new HttpError(409, "not_active", "Esta compra não pode mais agendar.");
    bookingId = Number(ins.meta.last_row_id);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw mapDbError(e);
  }

  const booking = (await getBooking(app.db, bookingId))!;
  const updated = (await getBuyer(app.db, buyer.id))!;
  await logEvent(app.db, "agendamento", {
    buyerId: buyer.id,
    bookingId,
    actor: createdBy,
    resumo: `${formatSlotShort(slotStart)} (${actor.type === "cliente" ? "pelo cliente" : "pelo comercial"})`,
    at: now,
  });
  app.defer(sendTelegram(app, tg.newBooking(updated, booking)));
  app.defer(sendEmail(app, emails.bookingConfirmed(app, updated, booking), { buyerId: buyer.id, tipo: "confirmacao" }));
  return { buyer: updated, booking };
}

export interface RescheduleCheck {
  allowed: boolean;
  reason?: string;
}

export function canReschedule(app: App, booking: Booking): RescheduleCheck {
  if (booking.status !== "agendado") return { allowed: false, reason: "Só reuniões com status \"agendado\" podem ser remarcadas." };
  if (booking.slot_start - app.now() < 24 * HOUR)
    return { allowed: false, reason: "Faltam menos de 24 horas para a reunião. Pelas regras, não é possível remarcar." };
  return { allowed: true };
}

export async function rescheduleBooking(app: App, bookingId: number, newStart: number, actorName: string) {
  const old = await getBooking(app.db, bookingId);
  if (!old) throw new HttpError(404, "not_found", "Agendamento não encontrado.");
  const check = canReschedule(app, old);
  if (!check.allowed) throw new HttpError(409, "reschedule_not_allowed", check.reason!);
  const buyer = (await getBuyer(app.db, old.buyer_id))!;
  if (buyer.status === "reembolsado") throw new HttpError(409, "refunded", "Compra reembolsada.");
  if (newStart === old.slot_start) throw new HttpError(400, "same_slot", "Escolha um horário diferente do atual.");

  const free = await slotsForBuyer(app, buyer, old.slot_start);
  if (!free.includes(newStart))
    throw new HttpError(409, "invalid_slot", "Esse horário não está livre ou está fora da janela original do comprador.");

  const now = app.now();
  try {
    const [, ins] = await app.db.batch([
      app.db.prepare(`UPDATE bookings SET status = 'remarcada', updated_at = ? WHERE id = ? AND status = 'agendado'`).bind(now, old.id),
      app.db
        .prepare(
          `INSERT INTO bookings (buyer_id, slot_start, slot_end, status, created_by, created_by_type, upgrade_vendido, observacao, rescheduled_from, created_at, updated_at)
           SELECT ?, ?, ?, 'agendado', ?, 'comercial', ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND status = 'remarcada' AND updated_at = ?)`,
        )
        .bind(
          old.buyer_id,
          newStart,
          newStart + app.grid.durationMin * MINUTE,
          actorName,
          old.upgrade_vendido,
          old.observacao,
          old.id,
          now,
          now,
          old.id,
          now,
        ),
    ]);
    if (!ins.meta.changes) throw new HttpError(409, "reschedule_failed", "Não foi possível remarcar. Recarregue e tente de novo.");
    const booking = (await getBooking(app.db, Number(ins.meta.last_row_id)))!;
    await logEvent(app.db, "remarcacao", {
      buyerId: buyer.id,
      bookingId: booking.id,
      actor: actorName,
      resumo: `${formatSlotShort(old.slot_start)} → ${formatSlotShort(newStart)}`,
      at: now,
    });
    app.defer(sendTelegram(app, tg.reschedule(buyer, old.slot_start, booking, actorName)));
    app.defer(sendEmail(app, emails.bookingConfirmed(app, buyer, booking), { buyerId: buyer.id, tipo: "confirmacao_remarcacao" }));
    return booking;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw mapDbError(e);
  }
}

/** Reembolso ou chargeback: cancela o bônus e libera reunião futura. */
export async function cancelForRefund(app: App, buyer: Buyer, kind: "reembolso" | "chargeback"): Promise<void> {
  if (buyer.status === "reembolsado") return; // idempotente
  const now = app.now();
  const future = await app.db
    .prepare(`SELECT * FROM bookings WHERE buyer_id = ? AND status = 'agendado' AND slot_start > ? ORDER BY slot_start LIMIT 1`)
    .bind(buyer.id, now)
    .first<Booking>();
  await app.db.batch([
    app.db.prepare(`UPDATE buyers SET status = 'reembolsado' WHERE id = ?`).bind(buyer.id),
    app.db
      .prepare(`UPDATE bookings SET status = 'cancelada_reembolso', updated_at = ? WHERE buyer_id = ? AND status = 'agendado' AND slot_start > ?`)
      .bind(now, buyer.id, now),
  ]);
  await logEvent(app.db, kind, {
    buyerId: buyer.id,
    bookingId: future?.id,
    resumo: future ? `Reunião ${formatSlotShort(future.slot_start)} cancelada e horário liberado` : "Sem reunião futura",
    at: now,
  });
  app.defer(sendTelegram(app, tg.refund(buyer, kind, future ?? null)));
}

/** Marca como expirado quem terminou a janela sem agendar. */
export async function expireWindows(app: App): Promise<number> {
  const now = app.now();
  const r = await app.db
    .prepare(`UPDATE buyers SET status = 'expirado' WHERE status = 'ativo' AND window_end <= ? RETURNING id`)
    .bind(now)
    .all<{ id: number }>();
  for (const row of r.results) await logEvent(app.db, "bonus_expirado", { buyerId: row.id, at: now });
  return r.results.length;
}

export async function setBookingOutcome(
  app: App,
  bookingId: number,
  fields: { status?: "realizada" | "nao_compareceu" | "agendado"; observacao?: string; upgrade_vendido?: boolean | null },
  actorName: string,
): Promise<Booking> {
  const bk = await getBooking(app.db, bookingId);
  if (!bk) throw new HttpError(404, "not_found", "Agendamento não encontrado.");
  if (!["agendado", "realizada", "nao_compareceu"].includes(bk.status))
    throw new HttpError(409, "not_editable", "Este agendamento não pode mais ser alterado.");
  const now = app.now();
  const sets: string[] = [];
  const binds: unknown[] = [];
  const changes: string[] = [];
  if (fields.status && fields.status !== bk.status) {
    if (fields.status !== "agendado" && bk.slot_start > now)
      throw new HttpError(409, "future_meeting", "Só é possível marcar o resultado depois do horário da reunião.");
    sets.push("status = ?");
    binds.push(fields.status);
    changes.push(`status: ${fields.status}`);
  }
  if (fields.observacao !== undefined && fields.observacao !== bk.observacao) {
    sets.push("observacao = ?");
    binds.push(fields.observacao.slice(0, 4000));
    changes.push("observação atualizada");
  }
  if (fields.upgrade_vendido !== undefined) {
    const v = fields.upgrade_vendido === null ? null : fields.upgrade_vendido ? 1 : 0;
    if (v !== bk.upgrade_vendido) {
      sets.push("upgrade_vendido = ?");
      binds.push(v);
      changes.push(`upgrade: ${v === null ? "não informado" : v ? "sim" : "não"}`);
    }
  }
  if (!sets.length) return bk;
  sets.push("updated_at = ?");
  binds.push(now);
  await app.db.prepare(`UPDATE bookings SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, bk.id).run();
  await logEvent(app.db, "atualizacao_reuniao", { buyerId: bk.buyer_id, bookingId: bk.id, actor: actorName, resumo: changes.join("; "), at: now });
  return (await getBooking(app.db, bk.id))!;
}

export { OCCUPYING_SQL };
