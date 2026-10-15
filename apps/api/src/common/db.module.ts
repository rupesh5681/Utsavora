import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { CONFIG, DB, type AppConfig } from '../config';
import { createDb, type Db } from '../db/client';

@Global()
@Module({
  providers: [{ provide: DB, inject: [CONFIG], useFactory: (c: AppConfig) => createDb(c.databaseUrl, c.dbPoolMax) }],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}
  async onApplicationShutdown() {
    await this.db.destroy();
  }
}
