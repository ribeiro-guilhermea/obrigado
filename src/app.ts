import type { Env } from "./env";
import { ensureSchema } from "./db/schema";
import { type Config, gridFrom, loadConfig, rememberOrigin } from "./lib/config";
import type { GridConfig } from "./lib/schedule";

/** Contexto de cada requisição/tarefa: ambiente, configuração e relógio. */
export interface App {
  env: Env;
  db: D1Database;
  cfg: Config;
  grid: GridConfig;
  now: () => number;
  /** Executa algo depois de responder (notificações). Nunca derruba a requisição. */
  defer: (p: Promise<unknown>) => void;
  baseUrl: string;
}

export async function createApp(
  env: Env,
  opts: { waitUntil?: (p: Promise<unknown>) => void; origin?: string; now?: () => number } = {},
): Promise<App> {
  await ensureSchema(env.DB);
  const cfg = await loadConfig(env);
  const pending: Promise<unknown>[] = [];
  if (opts.origin && !cfg.PUBLIC_BASE_URL && cfg._LAST_ORIGIN !== opts.origin && /^https:\/\//.test(opts.origin)) {
    await rememberOrigin(env, opts.origin);
  }
  const baseUrl = (cfg.PUBLIC_BASE_URL || opts.origin || cfg._LAST_ORIGIN || "").replace(/\/+$/, "");
  return {
    env,
    db: env.DB,
    cfg,
    grid: gridFrom(cfg),
    now: opts.now ?? (() => Date.now()),
    baseUrl,
    defer: (p) => {
      const safe = p.catch((e) => console.error("tarefa em segundo plano falhou", e));
      if (opts.waitUntil) opts.waitUntil(safe);
      else pending.push(safe);
    },
  };
}
