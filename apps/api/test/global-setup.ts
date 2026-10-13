import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { seedAdmin, seedReferenceData } from '../src/db/seed';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://utsavora:utsavora@localhost:5432/utsavora_test';

/** Fresh schema, real migrations, reference data and one fully-permissioned admin. */
export default async function globalSetup() {
  const c = new Client({ connectionString: TEST_DB_URL });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await c.end();
  await runMigrations(TEST_DB_URL);
  const { db, pool } = createDb(TEST_DB_URL, 2);
  await seedReferenceData(db);
  await seedAdmin(db, 'admin@test.local', 'Admin-Pass-2026');
  await pool.end();
}
