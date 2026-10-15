import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DB } from '../config';
import type { Db } from '../db/client';
import { Public } from '../auth/actor';
import { AppError } from '../common/errors';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Liveness: the process is up. */
  @Get()
  live() {
    return { status: 'ok', time: new Date().toISOString() };
  }

  /** Readiness: the database is reachable and migrated. */
  @Get('ready')
  async ready() {
    try {
      const r = await this.db.selectFrom('occasions').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
      return { status: 'ready', database: 'ok', occasions: r.n };
    } catch {
      throw new AppError(503, 'NOT_READY', 'Database unavailable');
    }
  }
}
