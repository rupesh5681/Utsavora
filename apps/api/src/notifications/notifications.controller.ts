import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../config';
import type { Db } from '../db/client';
import { notifications } from '../db/schema';
import { CurrentActor, type Actor } from '../auth/actor';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list(@CurrentActor() actor: Actor) {
    const items = await this.db.select().from(notifications).where(eq(notifications.userId, actor.userId)).orderBy(desc(notifications.createdAt)).limit(50);
    const [{ unread }] = await this.db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)));
    return { items, unread };
  }

  @HttpCode(200)
  @Post(':id/read')
  async read(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, actor.userId)));
    return { ok: true };
  }

  @HttpCode(200)
  @Post('read-all')
  async readAll(@CurrentActor() actor: Actor) {
    await this.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)));
    return { ok: true };
  }
}
