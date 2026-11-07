// Estrutura do banco D1. O próprio Worker aplica estas versões na primeira
// requisição (não há passo manual de migração). Para mudar a estrutura no futuro,
// ACRESCENTE uma nova versão no fim da lista; nunca altere uma versão já publicada.
// Datas: sempre INTEGER em milissegundos UTC.

export const MIGRATIONS: { version: number; statements: string[] }[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS buyers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kiwify_order_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL,
        whatsapp TEXT NOT NULL DEFAULT '',
        product_id TEXT NOT NULL DEFAULT '',
        approved_at INTEGER NOT NULL,
        window_start INTEGER NOT NULL,
        window_end INTEGER NOT NULL,
        min_start INTEGER NOT NULL,
        booking_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'ativo'
          CHECK (status IN ('ativo','agendado','expirado','reembolsado')),
        deadline_reminder_sent_at INTEGER,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS buyers_email ON buyers(email)`,
      `CREATE INDEX IF NOT EXISTS buyers_status ON buyers(status, window_end)`,

      `CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer_id INTEGER NOT NULL REFERENCES buyers(id),
        slot_start INTEGER NOT NULL,
        slot_end INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'agendado'
          CHECK (status IN ('agendado','realizada','nao_compareceu','remarcada','cancelada_reembolso')),
        created_by TEXT NOT NULL,
        created_by_type TEXT NOT NULL CHECK (created_by_type IN ('cliente','comercial')),
        upgrade_vendido INTEGER,
        observacao TEXT NOT NULL DEFAULT '',
        rescheduled_from INTEGER REFERENCES bookings(id),
        reminder_sent_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      // Um agendamento por horário, garantido pelo banco (entre agendamentos que ocupam o horário).
      `CREATE UNIQUE INDEX IF NOT EXISTS bookings_unique_slot ON bookings(slot_start)
        WHERE status IN ('agendado','realizada','nao_compareceu')`,
      // Uma reunião por compra.
      `CREATE UNIQUE INDEX IF NOT EXISTS bookings_unique_buyer ON bookings(buyer_id)
        WHERE status IN ('agendado','realizada','nao_compareceu')`,
      `CREATE INDEX IF NOT EXISTS bookings_slot ON bookings(slot_start)`,

      `CREATE TABLE IF NOT EXISTS blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL,
        motivo TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS blocks_range ON blocks(start_at, end_at)`,
      // Nenhum agendamento novo pode cair em horário bloqueado, mesmo com corrida.
      `CREATE TRIGGER IF NOT EXISTS bookings_no_block BEFORE INSERT ON bookings
        WHEN NEW.status = 'agendado' AND EXISTS (
          SELECT 1 FROM blocks WHERE start_at < NEW.slot_end AND end_at > NEW.slot_start
        )
        BEGIN SELECT RAISE(ABORT, 'slot_blocked'); END`,

      `CREATE TABLE IF NOT EXISTS events_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        buyer_id INTEGER,
        booking_id INTEGER,
        resumo TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL DEFAULT 'sistema',
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS events_created ON events_log(created_at)`,

      `CREATE TABLE IF NOT EXISTS webhook_raw (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at INTEGER NOT NULL,
        body TEXT NOT NULL,
        valid INTEGER NOT NULL,
        event_type TEXT NOT NULL DEFAULT '',
        order_id TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT ''
      )`,

      `CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        is_owner INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES admin_users(id),
        expires_at INTEGER NOT NULL
      )`,

      // Acesso temporário de quem se identificou pelo e-mail (sem link pessoal).
      `CREATE TABLE IF NOT EXISTS access_tickets (
        token_hash TEXT PRIMARY KEY,
        buyer_id INTEGER NOT NULL REFERENCES buyers(id),
        expires_at INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
];

let applied = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (applied) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`).run();
  const row = await db.prepare(`SELECT MAX(version) AS v FROM schema_version`).first<{ v: number | null }>();
  const current = row?.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.batch([
      ...m.statements.map((s) => db.prepare(s)),
      db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).bind(m.version),
    ]);
  }
  applied = true;
}

/** Só para testes: força reaplicar na próxima chamada. */
export function resetSchemaFlag() {
  applied = false;
}
