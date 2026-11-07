// Configurações do sistema.
// Ordem de prioridade: valor padrão < variável do Worker < valor salvo no painel (tabela config).
// Segredos (tokens, senhas, chaves) NUNCA passam por aqui: ficam só como Secrets do Worker.

import type { Env } from "../env";
import { DEFAULT_GRID, type GridConfig } from "./schedule";

export interface ConfigField {
  key: string;
  label: string;
  help?: string;
  default: string;
  type?: "text" | "textarea" | "number" | "boolean" | "time";
  group: string;
}

export const CONFIG_FIELDS: ConfigField[] = [
  // Página
  { key: "PRODUCT_NAME", group: "Página", label: "Nome do produto", default: "Money's Map — o Raio-X Financeiro de 7 Dias" },
  { key: "YOUTUBE_VIDEO_ID", group: "Página", label: "ID do vídeo no YouTube", help: "O código depois de v= no link do vídeo. Ex.: em youtube.com/watch?v=abc123XYZ, o ID é abc123XYZ.", default: "" },
  { key: "HERO_TITLE_BEFORE", group: "Página", label: "Título: texto antes do destaque", default: "Falta" },
  { key: "HERO_TITLE_HIGHLIGHT", group: "Página", label: "Título: trecho em destaque (gradiente)", default: "um passo" },
  { key: "HERO_TITLE_AFTER", group: "Página", label: "Título: texto depois do destaque", default: "pra você começar" },
  { key: "HERO_SUBTITLE", group: "Página", label: "Parágrafo abaixo do título", type: "textarea", default: "Assista ao vídeo e agende agora sua Reunião de Implementação. É nela que o Money's Map fica pronto para usar na sua IA." },
  { key: "BONUS_VALUE", group: "Página", label: "Valor declarado do bônus (R$)", default: "197" },
  { key: "EXPIRED_TEXT", group: "Página", label: "Texto para bônus expirado", type: "textarea", default: "O prazo para agendar a Reunião de Implementação gratuita terminou. Se ainda quiser a reunião, ela pode ser contratada à parte por R$ 197. Fale com o nosso time pelo e-mail de suporte." },
  { key: "SUPPORT_EMAIL", group: "Página", label: "E-mail de suporte (rodapé)", default: "" },
  { key: "FOOTER_TEXT", group: "Página", label: "Texto do rodapé", default: "Money's Map. Organize seu dinheiro com clareza." },

  // Agenda
  { key: "WORK_START", group: "Agenda", label: "Início do expediente", type: "time", default: DEFAULT_GRID.workStart },
  { key: "WORK_END", group: "Agenda", label: "Fim do expediente", type: "time", default: DEFAULT_GRID.workEnd },
  { key: "LUNCH_START", group: "Agenda", label: "Início do almoço", type: "time", default: DEFAULT_GRID.lunchStart },
  { key: "LUNCH_END", group: "Agenda", label: "Fim do almoço", type: "time", default: DEFAULT_GRID.lunchEnd },
  { key: "MEETING_DURATION_MIN", group: "Agenda", label: "Duração da reunião (minutos)", type: "number", default: String(DEFAULT_GRID.durationMin) },
  { key: "SLOT_BLOCK_MIN", group: "Agenda", label: "Bloco ocupado por reunião (minutos)", type: "number", default: String(DEFAULT_GRID.blockMin) },
  { key: "WINDOW_DAYS", group: "Agenda", label: "Dias de semana para agendar", type: "number", default: String(DEFAULT_GRID.windowDays) },
  { key: "MIN_NOTICE_HOURS", group: "Agenda", label: "Antecedência mínima após a compra (horas)", type: "number", default: String(DEFAULT_GRID.minNoticeHours) },

  // Kiwify
  { key: "KIWIFY_PRODUCT_ID", group: "Kiwify", label: "ID do produto Money's Map na Kiwify", help: "Só compras deste produto geram o bônus. Se ficar vazio, qualquer produto da conta gera bônus (use só durante os testes).", default: "" },

  // E-mail
  { key: "EMAIL_PROVIDER", group: "E-mail", label: "Provedor de e-mail", help: "resend, brevo ou desligado", default: "resend" },
  { key: "EMAIL_FROM_NAME", group: "E-mail", label: "Nome do remetente", default: "Sterling" },
  { key: "EMAIL_FROM_ADDRESS", group: "E-mail", label: "E-mail do remetente", help: "No Resend sem domínio próprio, use onboarding@resend.dev (só entrega para o e-mail da sua conta Resend).", default: "onboarding@resend.dev" },
  { key: "EMAIL_REPLY_TO", group: "E-mail", label: "Responder para (opcional)", default: "" },
  { key: "DEADLINE_REMINDER_ENABLED", group: "E-mail", label: "Enviar lembrete de prazo (1 dia antes de expirar)", type: "boolean", default: "true" },

  // Sistema
  { key: "PUBLIC_BASE_URL", group: "Sistema", label: "Endereço público do site", help: "Ex.: https://moneys-map-obrigado.SEU-USUARIO.workers.dev ou, no futuro, https://agenda.seudominio.com.br. Usado nos links dos e-mails.", default: "" },
];

const FIELD_KEYS = new Set(CONFIG_FIELDS.map((f) => f.key));

export type Config = Record<string, string>;

let cache: { at: number; values: Record<string, string> } | null = null;
const CACHE_MS = 15_000;

export function clearConfigCache() {
  cache = null;
}

export async function loadConfig(env: Env): Promise<Config> {
  const now = Date.now();
  let saved: Record<string, string>;
  if (cache && now - cache.at < CACHE_MS) {
    saved = cache.values;
  } else {
    saved = {};
    const rows = await env.DB.prepare(`SELECT key, value FROM config`).all<{ key: string; value: string }>();
    for (const r of rows.results) saved[r.key] = r.value;
    cache = { at: now, values: saved };
  }
  const cfg: Config = {};
  for (const f of CONFIG_FIELDS) {
    const fromEnv = env[f.key];
    cfg[f.key] = f.default;
    if (typeof fromEnv === "string" && fromEnv !== "") cfg[f.key] = fromEnv;
    if (saved[f.key] !== undefined && saved[f.key] !== "") cfg[f.key] = saved[f.key];
  }
  // Último endereço em que o site foi acessado (usado nos links dos e-mails das tarefas agendadas).
  cfg._LAST_ORIGIN = saved._LAST_ORIGIN ?? "";
  return cfg;
}

export async function rememberOrigin(env: Env, origin: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO config (key, value) VALUES ('_LAST_ORIGIN', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(origin)
    .run();
  clearConfigCache();
}

export async function saveConfig(env: Env, values: Record<string, string>): Promise<void> {
  const stmts = [];
  for (const [k, v] of Object.entries(values)) {
    if (!FIELD_KEYS.has(k)) continue;
    stmts.push(
      env.DB.prepare(`INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(k, String(v).trim()),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  clearConfigCache();
}

const num = (v: string, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : d;
};
const time = (v: string, d: string) => (/^\d{2}:\d{2}$/.test(v) ? v : d);

export function gridFrom(cfg: Config): GridConfig {
  return {
    workStart: time(cfg.WORK_START, DEFAULT_GRID.workStart),
    workEnd: time(cfg.WORK_END, DEFAULT_GRID.workEnd),
    lunchStart: time(cfg.LUNCH_START, DEFAULT_GRID.lunchStart),
    lunchEnd: time(cfg.LUNCH_END, DEFAULT_GRID.lunchEnd),
    durationMin: num(cfg.MEETING_DURATION_MIN, DEFAULT_GRID.durationMin),
    blockMin: num(cfg.SLOT_BLOCK_MIN, DEFAULT_GRID.blockMin),
    windowDays: num(cfg.WINDOW_DAYS, DEFAULT_GRID.windowDays),
    minNoticeHours: num(cfg.MIN_NOTICE_HOURS, DEFAULT_GRID.minNoticeHours),
  };
}

export function isTrue(v: string | undefined): boolean {
  return v === "true" || v === "1" || v === "sim";
}
