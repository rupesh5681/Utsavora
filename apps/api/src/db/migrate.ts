/*
 * Applies pending T-SQL migrations from apps/api/migrations in filename order.
 * Each file runs in one transaction and is recorded in dbo.schema_migrations, so this is
 * safe to run on every deploy. Files may contain GO lines to separate batches, exactly as in SSMS.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import { createDb } from './client';

export const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

/** Splits a script on lines that contain only GO (case-insensitive), like sqlcmd/SSMS. */
export function splitBatches(script: string): string[] {
  return script
    .split(/^\s*GO\s*(?:--.*)?$/gim)
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !/^(\s*(--[^\n]*)?\n?)*$/.test(b));
}

export async function runMigrations(url = process.env.DATABASE_URL, log: (m: string) => void = console.log) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = createDb(url, 1);
  try {
    await ensureReadCommittedSnapshot(db, log);
    await sql`
      IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
        CREATE TABLE dbo.schema_migrations (
          name        NVARCHAR(200) NOT NULL CONSTRAINT pk_schema_migrations PRIMARY KEY,
          applied_at  DATETIME2(3)  NOT NULL CONSTRAINT df_schema_migrations_applied DEFAULT SYSUTCDATETIME()
        );`.execute(db);
    const applied = new Set((await db.selectFrom('schemaMigrations').select('name').execute()).map((r) => r.name));
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const batches = splitBatches(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await db.transaction().execute(async (trx) => {
        for (const batch of batches) await sql.raw(batch).execute(trx);
        await trx.insertInto('schemaMigrations').values({ name: file }).execute();
      });
      log(`Applied ${file}`);
      count++;
    }
    if (count === 0) log('Database is up to date');
    return count;
  } finally {
    await db.destroy();
  }
}

/**
 * READ_COMMITTED_SNAPSHOT makes ordinary reads use row versions instead of shared locks, so pages
 * that only read never wait on in-flight bookings. Writes still lock (UPDLOCK / sp_getapplock), so
 * the booking rules stay strict. It is on by default in Azure SQL Database; on SQL Server we turn it on
 * if we can. ALTER DATABASE cannot run inside a transaction and needs no other open connections.
 */
async function ensureReadCommittedSnapshot(db: ReturnType<typeof createDb>, log: (m: string) => void) {
  const r = await sql<{ rcsi: boolean }>`SELECT is_read_committed_snapshot_on AS rcsi FROM sys.databases WHERE name = DB_NAME()`.execute(db);
  if (r.rows[0]?.rcsi) return;
  try {
    await sql`ALTER DATABASE CURRENT SET READ_COMMITTED_SNAPSHOT ON WITH NO_WAIT`.execute(db);
    log('Enabled READ_COMMITTED_SNAPSHOT');
  } catch (e) {
    log(`Note: could not enable READ_COMMITTED_SNAPSHOT (${e instanceof Error ? e.message : String(e)}). ` +
      'Run "ALTER DATABASE <name> SET READ_COMMITTED_SNAPSHOT ON" as a DBA when no one is connected. The app works without it, with more lock waits.');
  }
}

if (require.main === module) {
  try {
    process.loadEnvFile?.('.env');
  } catch {
    /* no .env file */
  }
  runMigrations().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
