/** Limite simples de tentativas por chave, guardado no D1. Retorna true se permitido. */
export async function rateLimit(db: D1Database, key: string, max: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
       RETURNING count`,
    )
    .bind(key, now + windowMs, now)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= max;
}
