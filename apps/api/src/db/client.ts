import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url: string, max = 10): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: url, max });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };
