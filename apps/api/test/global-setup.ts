import { Connection, Request } from 'tedious';
import { parseConnectionString, createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { seedAdmin, seedReferenceData } from '../src/db/seed';

/** SQL Server login with rights to create databases; the suite creates and drops its own test database. */
export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'Server=localhost,1433;Database=utsavora_test;User Id=sa;Password=Utsavora-Test-2026!;Encrypt=false;TrustServerCertificate=true';

function exec(cs: string, statements: string[]) {
  const cfg = parseConnectionString(cs);
  return new Promise<void>((resolve, reject) => {
    const conn = new Connection({
      server: cfg.server,
      authentication: { type: 'default', options: { userName: cfg.user, password: cfg.password } },
      options: { database: 'master', port: cfg.port, instanceName: cfg.instanceName, encrypt: cfg.encrypt, trustServerCertificate: cfg.trustServerCertificate },
    });
    conn.on('connect', (err) => {
      if (err) return reject(err);
      const run = (i: number) => {
        if (i >= statements.length) {
          conn.close();
          return resolve();
        }
        conn.execSqlBatch(new Request(statements[i], (e) => (e ? (conn.close(), reject(e)) : run(i + 1))));
      };
      run(0);
    });
    conn.connect();
  });
}

/** Fresh database, real migrations, reference data and one fully-permissioned admin. */
export default async function globalSetup() {
  const name = parseConnectionString(TEST_DB_URL).database;
  if (!/^[A-Za-z0-9_]+$/.test(name) || !/test/i.test(name)) throw new Error(`Refusing to recreate database "${name}" (name must contain "test")`);
  await exec(TEST_DB_URL, [
    `IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]; END`,
    `CREATE DATABASE [${name}]`,
  ]);
  await runMigrations(TEST_DB_URL, () => undefined);
  const db = createDb(TEST_DB_URL, 2);
  await seedReferenceData(db);
  await seedAdmin(db, 'admin@test.local', 'Admin-Pass-2026');
  await db.destroy();
}
