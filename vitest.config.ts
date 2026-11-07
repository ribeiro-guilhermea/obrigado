import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          KIWIFY_WEBHOOK_TOKEN: "token-de-teste",
          ADMIN_PASSWORD: "senha-de-teste",
          TELEGRAM_BOT_TOKEN: "bot-teste",
          TELEGRAM_CHAT_ID: "123",
          RESEND_API_KEY: "re_teste",
          KIWIFY_PRODUCT_ID: "prod-moneys-map",
          PUBLIC_BASE_URL: "https://exemplo.workers.dev",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
