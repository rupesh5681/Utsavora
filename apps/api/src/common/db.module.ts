import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool as PgPool } from 'pg';
import { CONFIG, DB, PG_POOL, type AppConfig } from '../config';
import * as schema from '../db/schema';

@Global()
@Module({
  providers: [
    { provide: PG_POOL, inject: [CONFIG], useFactory: (c: AppConfig) => new PgPool({ connectionString: c.databaseUrl, max: 10 }) },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool) => drizzle(pool, { schema }) },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
