import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { label } from '@utsavora/types';
import { CONFIG, DB, type AppConfig } from '../config';
import { json, now, sql, type Db, type DbOrTx, type Tx } from '../db/client';

export type OutboxType =
  | 'quote.requested'
  | 'quote.submitted'
  | 'quote.declined'
  | 'quote.withdrawn'
  | 'quote.rejected'
  | 'quote.not_selected'
  | 'event_request.unmatched'
  | 'order.created'
  | 'order.status_changed'
  | 'payment.recorded';

type Payload = Record<string, string | number | null | undefined>;
const MAX_ATTEMPTS = 8;

/**
 * Transactional outbox. Business code calls enqueue() inside its DB transaction; a
 * background loop dispatches events (today: in-app notifications; later: email/SMS/WhatsApp).
 * Each event is claimed with UPDLOCK + READPAST, so several API instances can dispatch safely.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Outbox');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async enqueue(tx: DbOrTx, type: OutboxType, payload: Payload) {
    await tx.insertInto('outboxEvents').values({ type, payload: json(payload) }).execute();
  }

  onModuleInit() {
    if (this.config.outboxIntervalMs > 0) {
      this.timer = setInterval(() => void this.dispatchPending(), this.config.outboxIntervalMs);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Processes up to `limit` events, one transaction each. Returns the number processed. */
  async dispatchPending(limit = 50): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;
    try {
      for (let i = 0; i < limit; i++) {
        const outcome = await this.dispatchOne();
        if (outcome === 'empty') break;
        if (outcome === 'ok') processed++;
      }
    } catch (e) {
      this.logger.error(`Dispatch loop failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
    return processed;
  }

  private async dispatchOne(): Promise<'ok' | 'failed' | 'empty'> {
    let claimed: { id: string; type: string; attempts: number } | undefined;
    try {
      return await this.db.transaction().execute(async (trx) => {
        const r = await sql<{ id: string; type: string; payload: Payload; attempts: number }>`
          SELECT TOP (1) id, type, payload, attempts
          FROM outbox_events WITH (UPDLOCK, READPAST, ROWLOCK)
          WHERE processed_at IS NULL AND attempts < ${MAX_ATTEMPTS}
          ORDER BY created_at`.execute(trx);
        const ev = r.rows[0];
        if (!ev) return 'empty';
        claimed = ev;
        await this.handle(trx, ev.type as OutboxType, ev.payload);
        await trx
          .updateTable('outboxEvents')
          .set({ processedAt: now(), attempts: ev.attempts + 1, lastError: null })
          .where('id', '=', ev.id)
          .execute();
        return 'ok';
      });
    } catch (e) {
      if (!claimed) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Event ${claimed.id} (${claimed.type}) failed: ${msg}`);
      await this.db
        .updateTable('outboxEvents')
        .set({ attempts: claimed.attempts + 1, lastError: msg.slice(0, 500) })
        .where('id', '=', claimed.id)
        .execute();
      return 'failed';
    }
  }

  private async vendorUserIds(tx: Tx, vendorId: string) {
    const rows = await tx.selectFrom('vendorMembers').select('userId').where('vendorId', '=', vendorId).execute();
    return rows.map((r) => r.userId);
  }

  private async notify(tx: Tx, userIds: string[], n: { type: string; title: string; body: string; link?: string }) {
    if (userIds.length === 0) return;
    await tx
      .insertInto('notifications')
      .values(userIds.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null })))
      .execute();
  }

  private async handle(tx: Tx, type: OutboxType, p: Payload) {
    const s = (k: string) => String(p[k] ?? '');
    switch (type) {
      case 'quote.requested':
        return this.notify(tx, await this.vendorUserIds(tx, s('vendorId')), {
          type,
          title: 'New event request',
          body: `${s('occasion')} on ${s('eventDate')} for ${s('guestCount')} guests in ${s('area')}. Ref ${s('reference')}.`,
          link: `/quotes/${s('quoteId')}`,
        });
      case 'quote.submitted':
        return this.notify(tx, [s('customerId')], {
          type,
          title: Number(p.revisionNumber) > 1 ? `Revised quote from ${s('vendorName')}` : `New quote from ${s('vendorName')}`,
          body: `For your request ${s('reference')}. Review and compare quotes.`,
          link: `/requests/${s('eventRequestId')}`,
        });
      case 'quote.declined':
      case 'quote.withdrawn':
        return this.notify(tx, [s('customerId')], {
          type,
          title: type === 'quote.declined' ? `${s('vendorName')} can't take this event` : `${s('vendorName')} withdrew their quote`,
          body: s('reason') || `Request ${s('reference')}.`,
          link: `/requests/${s('eventRequestId')}`,
        });
      case 'quote.rejected':
      case 'quote.not_selected':
        return this.notify(tx, await this.vendorUserIds(tx, s('vendorId')), {
          type,
          title: type === 'quote.rejected' ? 'Customer declined your quote' : 'Customer chose another vendor',
          body: `Request ${s('reference')}.`,
          link: `/quotes/${s('quoteId')}`,
        });
      case 'event_request.unmatched': {
        const admins = await tx.selectFrom('userRoles').select('userId').where('role', '=', 'ADMIN').execute();
        return this.notify(
          tx,
          admins.map((a) => a.userId),
          { type, title: 'Request with no matching vendors', body: `Ref ${s('reference')} needs manual vendor outreach.`, link: `/requests` },
        );
      }
      case 'order.created': {
        await this.notify(tx, await this.vendorUserIds(tx, s('vendorId')), {
          type,
          title: `New booking ${s('orderNumber')}`,
          body: 'The customer accepted your quote. Please confirm the booking.',
          link: `/orders/${s('orderId')}`,
        });
        return this.notify(tx, [s('customerId')], {
          type,
          title: `Booking ${s('orderNumber')} created`,
          body: 'We have sent it to the vendor for confirmation.',
          link: `/orders/${s('orderId')}`,
        });
      }
      case 'order.status_changed': {
        const body = `Booking ${s('orderNumber')} is now: ${label(s('toStatus'))}.`;
        if (s('actorRole') !== 'CUSTOMER') await this.notify(tx, [s('customerId')], { type, title: 'Booking update', body, link: `/orders/${s('orderId')}` });
        if (s('actorRole') !== 'VENDOR') {
          await this.notify(tx, await this.vendorUserIds(tx, s('vendorId')), { type, title: 'Booking update', body, link: `/orders/${s('orderId')}` });
        }
        return;
      }
      case 'payment.recorded':
        await this.notify(tx, [s('customerId')], {
          type,
          title: 'Payment received',
          body: `We recorded your payment for booking ${s('orderNumber')}.`,
          link: `/orders/${s('orderId')}`,
        });
        return this.notify(tx, await this.vendorUserIds(tx, s('vendorId')), {
          type,
          title: 'Customer payment recorded',
          body: `Payment recorded for booking ${s('orderNumber')}.`,
          link: `/orders/${s('orderId')}`,
        });
      default:
        throw new Error(`No handler for outbox event type ${type satisfies never}`);
    }
  }

  /** For admin monitoring: events that failed at least once and are not yet processed. */
  async failures(limit = 100) {
    return this.db
      .selectFrom('outboxEvents')
      .select(['id', 'type', 'attempts', 'lastError', 'createdAt'])
      .where('processedAt', 'is', null)
      .where('attempts', '>', 0)
      .orderBy('createdAt')
      .top(limit)
      .execute();
  }

  async retry(ids: string[]) {
    if (ids.length === 0) return;
    await this.db.updateTable('outboxEvents').set({ attempts: 0 }).where('id', 'in', ids).where('processedAt', 'is', null).execute();
  }
}
