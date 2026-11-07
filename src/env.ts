export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  // Segredos (cadastrados no painel da Cloudflare)
  KIWIFY_WEBHOOK_TOKEN?: string;
  ADMIN_PASSWORD?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;

  // Variáveis opcionais (também ajustáveis no painel > Configurações)
  [key: string]: unknown;
}
