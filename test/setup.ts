// Intercepta as chamadas externas (Telegram, Resend, Brevo) durante os testes.
import { beforeEach } from "vitest";

export const outbound: { url: string; body: any }[] = [];
export const outboundMode = { fail: false };
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (/api\.telegram\.org|api\.resend\.com|api\.brevo\.com/.test(url)) {
    let body: any = null;
    try { body = JSON.parse(String(init?.body ?? "null")); } catch {}
    outbound.push({ url, body });
    if (outboundMode.fail) return new Response("erro simulado", { status: 500 });
    return new Response(JSON.stringify({ ok: true, id: "x" }), { status: 200 });
  }
  return realFetch(input as any, init);
}) as typeof fetch;

beforeEach(() => {
  outbound.length = 0;
  outboundMode.fail = false;
});
