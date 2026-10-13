/* Applies pending SQL migrations from ./drizzle. Safe to run on every deploy. */
import path from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export async function runMigrations(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  try {
    process.loadEnvFile?.('.env');
  } catch {
    /* no .env file */
  }
  runMigrations()
    .then(() => console.log('Migrations applied'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
