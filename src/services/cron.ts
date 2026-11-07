// Tarefas agendadas.

import type { App } from "../app";
import { type Booking, type Buyer, logEvent } from "../db/repo";
import { isTrue } from "../lib/config";
import { lastWindowDay } from "../lib/schedule";
import { DAY, formatDateLong, fromLocal, localDateOf, nextWeekday, prevWeekday } from "../lib/time";
import { sendEmail } from "../notify/email";
import { emails, tg } from "../notify/messages";
import { sendTelegram } from "../notify/telegram";
import { expireWindows } from "./booking";

/** Momento do lembrete de véspera: 18:00 do dia útil anterior à reunião. */
export function reminderMoment(slotStart: number): number {
  return fromLocal(prevWeekday(localDateOf(slotStart)), "18:00");
}

/** Momento do lembrete de prazo: 09:00 do dia útil anterior ao último dia da janela. */
export function deadlineReminderMoment(b: { window_start: number; window_end: number }): number {
  return fromLocal(prevWeekday(lastWindowDay(b)), "09:00");
}

export async function sendDayBeforeReminders(app: App): Promise<number> {
  const now = app.now();
  const rows = (
    await app.db
      .prepare(
        `SELECT k.*, b.name AS b_name FROM bookings k JOIN buyers b ON b.id = k.buyer_id
         WHERE k.status = 'agendado' AND k.reminder_sent_at IS NULL AND k.slot_start > ? AND k.slot_start < ?`,
      )
      .bind(now, now + 5 * DAY)
      .all<Booking>()
  ).results;
  let sent = 0;
  for (const bk of rows) {
    const at = reminderMoment(bk.slot_start);
    if (now < at) continue;
    // Agendado depois das 18:00 da véspera: não envia lembrete (regra 8.3).
    if (bk.created_at >= at) {
      await app.db.prepare(`UPDATE bookings SET reminder_sent_at = ? WHERE id = ?`).bind(-1, bk.id).run();
      continue;
    }
    // Marca antes de enviar para nunca mandar em dobro.
    const claim = await app.db
      .prepare(`UPDATE bookings SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL`)
      .bind(now, bk.id)
      .run();
    if (!claim.meta.changes) continue;
    const buyer = (await app.db.prepare(`SELECT * FROM buyers WHERE id = ?`).bind(bk.buyer_id).first<Buyer>())!;
    await sendEmail(app, emails.bookingReminder(app, buyer, bk), { buyerId: buyer.id, tipo: "lembrete_vespera" });
    sent++;
  }
  return sent;
}

export async function sendDeadlineReminders(app: App): Promise<number> {
  if (!isTrue(app.cfg.DEADLINE_REMINDER_ENABLED)) return 0;
  const now = app.now();
  const rows = (
    await app.db
      .prepare(`SELECT * FROM buyers WHERE status = 'ativo' AND deadline_reminder_sent_at IS NULL AND window_end > ? AND window_end < ?`)
      .bind(now, now + 4 * DAY)
      .all<Buyer>()
  ).results;
  let sent = 0;
  for (const b of rows) {
    if (now < deadlineReminderMoment(b)) continue;
    const claim = await app.db
      .prepare(`UPDATE buyers SET deadline_reminder_sent_at = ? WHERE id = ? AND deadline_reminder_sent_at IS NULL AND status = 'ativo'`)
      .bind(now, b.id)
      .run();
    if (!claim.meta.changes) continue;
    await sendEmail(app, emails.deadlineReminder(app, b), { buyerId: b.id, tipo: "lembrete_prazo" });
    sent++;
  }
  return sent;
}

export async function dailySummary(app: App): Promise<string> {
  const now = app.now();
  const today = localDateOf(now);
  const tomorrowBiz = nextWeekday(today);
  const meetings = (
    await app.db
      .prepare(
        `SELECT k.id AS k_id FROM bookings k WHERE k.status IN ('agendado','realizada','nao_compareceu') AND k.slot_start >= ? AND k.slot_start < ? ORDER BY k.slot_start`,
      )
      .bind(fromLocal(today), fromLocal(today) + DAY)
      .all<{ k_id: number }>()
  ).results;
  const list: { b: Buyer; bk: Booking }[] = [];
  for (const m of meetings) {
    const bk = (await app.db.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(m.k_id).first<Booking>())!;
    const b = (await app.db.prepare(`SELECT * FROM buyers WHERE id = ?`).bind(bk.buyer_id).first<Buyer>())!;
    list.push({ b, bk });
  }
  const pending = (
    await app.db
      .prepare(`SELECT * FROM buyers WHERE status = 'ativo' AND window_end > ? ORDER BY window_end`)
      .bind(now)
      .all<Buyer>()
  ).results.filter((b) => {
    const last = lastWindowDay(b);
    return last === today || last === tomorrowBiz;
  });
  const text = tg.dailySummary(formatDateLong(today), list, pending);
  await sendTelegram(app, text);
  return text;
}

export async function runEvery15(app: App) {
  const expired = await expireWindows(app);
  const reminders = await sendDayBeforeReminders(app);
  const deadline = await sendDeadlineReminders(app);
  // Limpeza de dados temporários.
  await app.db.batch([
    app.db.prepare(`DELETE FROM access_tickets WHERE expires_at < ?`).bind(app.now()),
    app.db.prepare(`DELETE FROM rate_limits WHERE reset_at < ?`).bind(app.now()),
    app.db.prepare(`DELETE FROM admin_sessions WHERE expires_at < ?`).bind(app.now()),
  ]);
  if (expired || reminders || deadline) {
    console.log(`cron: expirados=${expired} lembretes=${reminders} prazo=${deadline}`);
  }
  return { expired, reminders, deadline };
}

export async function runScheduled(app: App, cron: string) {
  try {
    if (cron === "30 10 * * 1-5") await dailySummary(app);
    else await runEvery15(app);
  } catch (e) {
    await logEvent(app.db, "erro_cron", { resumo: `${cron}: ${String(e)}` }).catch(() => {});
    throw e;
  }
}
