// Ponto de entrada do Worker: páginas, API, webhook da Kiwify e tarefas agendadas.

import { createApp } from "./app";
import type { Env } from "./env";
import { HttpError, errorResponse, json } from "./lib/http";
import { handleAdmin } from "./routes/admin";
import { handlePublic } from "./routes/public";
import { runScheduled } from "./services/cron";
import { handleKiwifyWebhook } from "./services/kiwify";

async function serveAsset(env: Env, req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  url.pathname = path;
  url.search = "";
  return env.ASSETS.fetch(new Request(url.toString(), { method: "GET", headers: req.headers }));
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Link pessoal do e-mail: mesma página do obrigado (o JS lê o token da URL).
    if (path.startsWith("/agendar/")) {
      const res = await serveAsset(env, req, "/obrigado/");
      const headers = new Headers(res.headers);
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Robots-Tag", "noindex");
      headers.set("Cache-Control", "no-store");
      return new Response(res.body, { status: res.status, headers });
    }

    if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);

    try {
      const app = await createApp(env, { waitUntil: (p) => ctx.waitUntil(p), origin: url.origin });

      if (path === "/api/webhooks/kiwify") {
        if (req.method !== "POST") throw new HttpError(405, "method", "Use POST.");
        const r = await handleKiwifyWebhook(app, req);
        return json({ ok: true, ...r });
      }
      if (path.startsWith("/api/public/")) return await handlePublic(app, req, path);
      if (path.startsWith("/api/admin/")) return await handleAdmin(app, req, path);
      throw new HttpError(404, "not_found", "Rota não encontrada.");
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e);
      console.error(e);
      return json({ ok: false, error: "internal", message: "Erro inesperado. Tente novamente em instantes." }, 500);
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const app = await createApp(env, { waitUntil: (p) => ctx.waitUntil(p) });
    await runScheduled(app, event.cron);
  },
} satisfies ExportedHandler<Env>;
