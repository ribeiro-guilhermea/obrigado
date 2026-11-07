import type { App } from "../app";
import { logEvent } from "../db/repo";

/** Envia uma mensagem ao chat do time. Nunca lança erro: falhas vão para o histórico. */
export async function sendTelegram(app: App, text: string): Promise<boolean> {
  const token = app.env.TELEGRAM_BOT_TOKEN;
  const chatId = app.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[telegram desligado]", text);
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return true;
  } catch (e) {
    await logEvent(app.db, "erro_telegram", { resumo: `${String(e)} | ${text.slice(0, 200)}` }).catch(() => {});
    return false;
  }
}
