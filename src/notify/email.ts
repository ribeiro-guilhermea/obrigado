// Envio de e-mail atrás de uma interface única. Trocar de provedor = mudar a
// configuração EMAIL_PROVIDER (resend | brevo | desligado). Nenhuma falha aqui
// pode interromper o fluxo de quem chamou.

import type { App } from "../app";
import { logEvent } from "../db/repo";

export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
}

interface Provider {
  send(app: App, msg: EmailMessage): Promise<void>;
}

const resend: Provider = {
  async send(app, msg) {
    const key = app.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY não cadastrada");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${app.cfg.EMAIL_FROM_NAME} <${app.cfg.EMAIL_FROM_ADDRESS}>`,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(app.cfg.EMAIL_REPLY_TO ? { reply_to: app.cfg.EMAIL_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  },
};

const brevo: Provider = {
  async send(app, msg) {
    const key = app.env.BREVO_API_KEY;
    if (!key) throw new Error("BREVO_API_KEY não cadastrada");
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: app.cfg.EMAIL_FROM_NAME, email: app.cfg.EMAIL_FROM_ADDRESS },
        to: [{ email: msg.to, ...(msg.toName ? { name: msg.toName } : {}) }],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
        ...(app.cfg.EMAIL_REPLY_TO ? { replyTo: { email: app.cfg.EMAIL_REPLY_TO } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Brevo HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  },
};

const PROVIDERS: Record<string, Provider> = { resend, brevo };

/** Envia o e-mail. Retorna true se o provedor aceitou. Nunca lança erro. */
export async function sendEmail(app: App, msg: EmailMessage, ref: { buyerId?: number; tipo: string }): Promise<boolean> {
  const provider = PROVIDERS[(app.cfg.EMAIL_PROVIDER || "").toLowerCase()];
  if (!provider) {
    console.log("[e-mail desligado]", msg.to, msg.subject);
    return false;
  }
  try {
    await provider.send(app, msg);
    await logEvent(app.db, "email_enviado", { buyerId: ref.buyerId, resumo: `${ref.tipo} → ${msg.to}` }).catch(() => {});
    return true;
  } catch (e) {
    await logEvent(app.db, "erro_email", { buyerId: ref.buyerId, resumo: `${ref.tipo} → ${msg.to}: ${String(e)}` }).catch(() => {});
    return false;
  }
}
