// Textos das notificações (Telegram e e-mails).
// Para mudar a redação, edite aqui. Datas sempre em horário de Brasília.

import type { App } from "../app";
import type { Booking, Buyer } from "../db/repo";
import { firstName } from "../db/repo";
import { formatBrPhone, waLink } from "../lib/phone";
import { lastWindowDay } from "../lib/schedule";
import { formatDateLong, formatDateTime, formatSlotLong, formatSlotShort } from "../lib/time";
import type { EmailMessage } from "./email";

const phone = (b: Buyer) => (b.whatsapp ? `${formatBrPhone(b.whatsapp)} (${waLink(b.whatsapp)})` : "não informado");
const deadline = (b: Buyer) => formatDateLong(lastWindowDay(b));

// ---------------- Telegram ----------------

export const tg = {
  newPurchase: (b: Buyer) =>
    `🛒 Nova compra\n\nNome: ${b.name || "-"}\nWhatsApp: ${phone(b)}\nE-mail: ${b.email}\nPrazo final do bônus: ${deadline(b)}\n\nEntrar em contato para garantir o agendamento.`,

  newBooking: (b: Buyer, bk: Booking) =>
    `📅 Novo agendamento\n\nNome: ${b.name || "-"}\nWhatsApp: ${phone(b)}\nReunião: ${formatSlotLong(bk.slot_start)}\nFeito por: ${
      bk.created_by_type === "cliente" ? "cliente (página)" : `comercial (${bk.created_by})`
    }\n\nEnviar link do Zoom e orientações.`,

  reschedule: (b: Buyer, oldStart: number, bk: Booking, by: string) =>
    `🔁 Remarcação\n\nNome: ${b.name || "-"}\nWhatsApp: ${phone(b)}\nDe: ${formatSlotShort(oldStart)}\nPara: ${formatSlotLong(bk.slot_start)}\nRemarcado por: ${by}`,

  refund: (b: Buyer, kind: "reembolso" | "chargeback", cancelled: Booking | null) =>
    `↩️ ${kind === "chargeback" ? "Chargeback" : "Reembolso"}\n\nNome: ${b.name || "-"}\nE-mail: ${b.email}\nWhatsApp: ${phone(b)}\n${
      cancelled ? `Reunião cancelada: ${formatSlotShort(cancelled.slot_start)} (horário liberado)` : "Não havia reunião futura agendada."
    }`,

  dailySummary: (dateLabel: string, meetings: { b: Buyer; bk: Booking }[], ending: Buyer[]) => {
    const lines = [`☀️ Resumo do dia: ${dateLabel}`, ""];
    lines.push(`Reuniões de hoje (${meetings.length}):`);
    if (!meetings.length) lines.push("• nenhuma");
    for (const { b, bk } of meetings) lines.push(`• ${formatSlotShort(bk.slot_start).slice(-5)} ${b.name || "-"} · ${phone(b)}`);
    lines.push("", `Sem agendamento com prazo terminando hoje ou no próximo dia útil (${ending.length}):`);
    if (!ending.length) lines.push("• nenhum");
    for (const b of ending) lines.push(`• ${b.name || "-"} · ${phone(b)} · prazo: ${deadline(b)}`);
    return lines.join("\n");
  },
};

// ---------------- E-mails ----------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(app: App, title: string, bodyHtml: string): string {
  const support = app.cfg.SUPPORT_EMAIL
    ? `<p style="margin:24px 0 0;font-size:13px;color:#6c78a3">Dúvidas? Responda este e-mail ou escreva para ${esc(app.cfg.SUPPORT_EMAIL)}.</p>`
    : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#060a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#060a1a"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0a1130;border:1px solid #1f2a5c;border-radius:20px">
<tr><td style="padding:32px 28px;font-family:Arial,Helvetica,sans-serif;color:#aab4d8;font-size:16px;line-height:1.55">
<div style="display:inline-block;padding:6px 12px;border:1px solid #2c3d85;border-radius:100px;font-weight:bold;color:#eef2ff;font-size:14px">Money's Map</div>
<h1 style="margin:22px 0 14px;font-size:24px;line-height:1.2;color:#eef2ff">${esc(title)}</h1>
${bodyHtml}
${support}
</td></tr></table>
</td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:26px 0"><a href="${esc(href)}" style="display:inline-block;background:#2f6bff;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:100px">${esc(label)}</a></p>`;

const rulesHtml = `<ul style="padding-left:18px;margin:12px 0">
<li>Não é possível cancelar nem remarcar pela página.</li>
<li>Se você faltar, perde o bônus (não há reposição).</li>
<li>O link do Zoom será enviado pelo nosso time no WhatsApp.</li></ul>`;
const rulesText = `- Não é possível cancelar nem remarcar pela página.\n- Se você faltar, perde o bônus (não há reposição).\n- O link do Zoom será enviado pelo nosso time no WhatsApp.`;

export function bookingLink(app: App, b: Buyer): string {
  return `${app.baseUrl}/agendar/${b.booking_token}`;
}

export const emails = {
  scheduleInvite(app: App, b: Buyer): EmailMessage {
    const link = bookingLink(app, b);
    const name = esc(firstName(b.name) || "olá");
    const dl = deadline(b);
    return {
      to: b.email,
      toName: b.name,
      subject: "Agende sua Reunião de Implementação",
      html: layout(
        app,
        "Agende sua Reunião de Implementação",
        `<p>${name}, sua compra do Money's Map foi confirmada. O acesso ao produto chega no e-mail enviado pela Kiwify.</p>
<p>Você ganhou de bônus uma <strong style="color:#eef2ff">Reunião de Implementação</strong> (valor de R$ ${esc(app.cfg.BONUS_VALUE)}), em que configuramos o Money's Map na sua IA e mostramos como usar.</p>
<p>O bônus vale se você agendar até <strong style="color:#eef2ff">${esc(dl)}</strong>. Os horários são limitados.</p>
${button(link, "Escolher meu horário")}
<p style="font-size:13px;color:#6c78a3">Este link é pessoal. Se o botão não funcionar, copie e cole no navegador:<br>${esc(link)}</p>`,
      ),
      text: `${firstName(b.name) || "Olá"}, sua compra do Money's Map foi confirmada.\n\nVocê ganhou de bônus uma Reunião de Implementação (valor de R$ ${app.cfg.BONUS_VALUE}). O bônus vale se você agendar até ${dl}.\n\nEscolha seu horário: ${link}\n\nEste link é pessoal.`,
    };
  },

  bookingConfirmed(app: App, b: Buyer, bk: Booking): EmailMessage {
    const when = formatSlotLong(bk.slot_start);
    const dur = app.grid.durationMin;
    return {
      to: b.email,
      toName: b.name,
      subject: "Reunião de Implementação confirmada",
      html: layout(
        app,
        "Sua reunião está confirmada",
        `<p>${esc(firstName(b.name) || "Olá")}, sua Reunião de Implementação está marcada:</p>
<p style="font-size:20px;color:#eef2ff;font-weight:bold;margin:18px 0">${esc(when)}</p>
<p>Duração: cerca de ${dur} minutos, pelo Zoom.</p>
${rulesHtml}
<p>Fique de olho no seu WhatsApp: é por lá que vamos enviar o link e as orientações.</p>`,
      ),
      text: `Sua Reunião de Implementação está marcada:\n\n${when}\nDuração: cerca de ${dur} minutos, pelo Zoom.\n\n${rulesText}\n\nFique de olho no seu WhatsApp.`,
    };
  },

  bookingReminder(app: App, b: Buyer, bk: Booking): EmailMessage {
    const when = formatSlotLong(bk.slot_start);
    return {
      to: b.email,
      toName: b.name,
      subject: "Lembrete: sua Reunião de Implementação é no próximo dia útil",
      html: layout(
        app,
        "Lembrete da sua reunião",
        `<p>${esc(firstName(b.name) || "Olá")}, passando para lembrar da sua Reunião de Implementação:</p>
<p style="font-size:20px;color:#eef2ff;font-weight:bold;margin:18px 0">${esc(when)}</p>
<p>O link do Zoom é enviado pelo nosso time no WhatsApp. Lembre-se: se faltar, o bônus é perdido.</p>`,
      ),
      text: `Lembrete da sua Reunião de Implementação: ${when}.\nO link do Zoom é enviado pelo WhatsApp. Se faltar, o bônus é perdido.`,
    };
  },

  deadlineReminder(app: App, b: Buyer): EmailMessage {
    const link = bookingLink(app, b);
    const dl = deadline(b);
    return {
      to: b.email,
      toName: b.name,
      subject: "Seu bônus termina amanhã: agende sua reunião",
      html: layout(
        app,
        "Seu bônus está acabando",
        `<p>${esc(firstName(b.name) || "Olá")}, você ainda não agendou sua Reunião de Implementação gratuita.</p>
<p>O prazo termina em <strong style="color:#eef2ff">${esc(dl)}</strong>. Depois disso, a reunião passa a custar R$ ${esc(app.cfg.BONUS_VALUE)}.</p>
${button(link, "Agendar agora")}`,
      ),
      text: `Você ainda não agendou sua Reunião de Implementação gratuita. O prazo termina em ${dl}.\n\nAgende: ${link}`,
    };
  },
};

export { formatDateTime };
