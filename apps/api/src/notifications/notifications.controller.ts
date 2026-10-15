import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DB } from '../config';
import { now, type Db } from '../db/client';
import { CurrentActor, type Actor } from '../auth/actor';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list(@CurrentActor() actor: Actor) {
    const [items, { unread }] = await Promise.all([
      this.db
        .selectFrom('notifications')
        .selectAll()
        .where('userId', '=', actor.userId)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .top(50)
        .execute(),
      this.db
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll<number>().as('unread'))
        .where('userId', '=', actor.userId)
        .where('readAt', 'is', null)
        .executeTakeFirstOrThrow(),
    ]);
    return { items, unread };
  }

  @HttpCode(200)
  @Post(':id/read')
  async read(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.updateTable('notifications').set({ readAt: now() }).where('id', '=', id).where('userId', '=', actor.userId).execute();
    return { ok: true };
  }

  @HttpCode(200)
  @Post('read-all')
  async readAll(@CurrentActor() actor: Actor) {
    await this.db.updateTable('notifications').set({ readAt: now() }).where('userId', '=', actor.userId).where('readAt', 'is', null).execute();
    return { ok: true };
  }
}
