import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { computeQuoteTotals, QUOTE_ACCEPTABLE, QUOTE_REVISABLE, QUOTE_TERMINAL, type QuoteStatus } from '@utsavora/types';
import type { AcceptQuoteInput, EventRequestInput, QuoteRevisionInput, ReasonInput } from '@utsavora/validation';
import { CONFIG, DB, type AppConfig } from '../config';
import { json, lockRow, now, shareLockRow, sql, type Db, type DbOrTx, type Tx } from '../db/client';
import type { EventRequest, QuoteItem, QuoteRevision } from '../db/types';
import { conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { OutboxService } from '../common/outbox.service';
import { eventRequestReference } from '../common/ids';
import { addDays, todayIST } from '../common/time';
import type { Actor } from '../auth/actor';
import { OrdersService } from '../orders/orders.service';
import { Page } from '../common/page';

const MAX_OPEN_REQUESTS_PER_CUSTOMER = 10;
const MAX_DAYS_AHEAD = 540;
const PRICED_OR_CLOSED: QuoteStatus[] = ['QUOTED', 'REVISED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'NOT_SELECTED', 'WITHDRAWN'];

const formatTitleDate = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

export function revisionView(rev: QuoteRevision, items: QuoteItem[]) {
  return {
    id: rev.id,
    revisionNumber: rev.revisionNumber,
    items: items
      .filter((i) => i.revisionId === rev.id)
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ description: i.description, quantity: i.quantity, unitPricePaise: i.unitPricePaise, lineTotalPaise: i.lineTotalPaise })),
    subtotalPaise: rev.subtotalPaise,
    discountPaise: rev.discountPaise,
    taxBps: rev.taxBps,
    taxPaise: rev.taxPaise,
    deliveryPaise: rev.deliveryPaise,
    totalPaise: rev.totalPaise,
    advanceBps: rev.advanceBps,
    advancePaise: rev.advancePaise,
    inclusions: rev.inclusions,
    exclusions: rev.exclusions,
    terms: rev.terms,
    notes: rev.notes,
    validUntil: rev.validUntil,
    createdAt: rev.createdAt,
  };
}

@Injectable()
export class QuotesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Quotes');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit() {
    if (this.config.outboxIntervalMs > 0) {
      this.timer = setInterval(() => void this.expireStale().catch((e) => this.logger.warn(String(e))), 10 * 60 * 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Expires quotes past their validity and requests whose event date has passed.
   * Runs on a timer and lazily before reads/accepts, so correctness never depends on the timer.
   */
  async expireStale(db: DbOrTx = this.db) {
    const today = todayIST();
    await sql`
      UPDATE q SET q.status = 'EXPIRED', q.updated_at = SYSUTCDATETIME()
      FROM quotes q
      JOIN quote_revisions r ON r.id = q.current_revision_id
      WHERE q.status IN ('QUOTED', 'REVISED') AND r.valid_until < CAST(${today} AS DATE);

      UPDATE q SET q.status = 'EXPIRED', q.updated_at = SYSUTCDATETIME()
      FROM quotes q
      JOIN event_requests e ON e.id = q.event_request_id
      WHERE e.status = 'OPEN' AND e.event_date < CAST(${today} AS DATE)
        AND q.status NOT IN (${sql.join(QUOTE_TERMINAL)});

      UPDATE event_requests SET status = 'EXPIRED', updated_at = SYSUTCDATETIME()
      WHERE status = 'OPEN' AND event_date < CAST(${today} AS DATE);`.execute(db);
  }

  // ─────────────────────────── Customer: event requests ───────────────────────────

  async createRequest(actor: Actor, input: EventRequestInput) {
    const today = todayIST();
    if (input.eventDate <= today) throw unprocessable('DATE_TOO_SOON', 'Event date must be at least tomorrow.');
    if (input.eventDate > addDays(today, MAX_DAYS_AHEAD)) throw unprocessable('DATE_TOO_FAR', 'Event date must be within the next 18 months.');

    return this.db.transaction().execute(async (tx) => {
      const { open } = await tx
        .selectFrom('eventRequests')
        .select((eb) => eb.fn.countAll<number>().as('open'))
        .where('customerId', '=', actor.userId)
        .where('status', '=', 'OPEN')
        .executeTakeFirstOrThrow();
      if (open >= MAX_OPEN_REQUESTS_PER_CUSTOMER) {
        throw conflict('TOO_MANY_OPEN_REQUESTS', `You can have up to ${MAX_OPEN_REQUESTS_PER_CUSTOMER} open requests. Close one to create another.`);
      }
      const occasion = await tx.selectFrom('occasions').select(['id', 'name']).where('id', '=', input.occasionId).executeTakeFirst();
      if (!occasion) throw unprocessable('INVALID_OCCASION', 'Choose a valid occasion.');
      const area = await tx
        .selectFrom('serviceAreas')
        .select(['id', 'name'])
        .where('id', '=', input.serviceAreaId)
        .where('isActive', '=', true)
        .executeTakeFirst();
      if (!area) throw unprocessable('INVALID_AREA', 'We do not serve this area yet.');
      const catIds = [...new Set(input.categoryIds)];
      const cats = await tx.selectFrom('categories').select('id').where('id', 'in', catIds).execute();
      if (cats.length !== catIds.length) throw unprocessable('INVALID_CATEGORY', 'One or more services are invalid.');

      // Matching vendors: approved, serve the area, offer at least one requested category.
      let matched = await tx
        .selectFrom('vendors')
        .select(['vendors.id', 'vendors.businessName'])
        .distinct()
        .innerJoin('vendorServiceAreas', (j) => j.onRef('vendorServiceAreas.vendorId', '=', 'vendors.id').on('vendorServiceAreas.serviceAreaId', '=', area.id))
        .innerJoin('vendorCategories', (j) => j.onRef('vendorCategories.vendorId', '=', 'vendors.id').on('vendorCategories.categoryId', 'in', catIds))
        .where('vendors.status', '=', 'APPROVED')
        .execute();
      if (input.vendorIds?.length) {
        const wanted = new Set(input.vendorIds);
        const eligible = matched.filter((v) => wanted.has(v.id));
        if (eligible.length !== wanted.size) {
          throw unprocessable(
            'VENDOR_NOT_ELIGIBLE',
            "The selected vendor doesn't serve this area or service. Remove the vendor filter to reach all matching vendors.",
          );
        }
        matched = eligible;
      }

      const req = await tx
        .insertInto('eventRequests')
        .output(['inserted.id', 'inserted.reference', 'inserted.eventDate', 'inserted.guestCount'])
        .values({
          reference: eventRequestReference(),
          customerId: actor.userId,
          occasionId: occasion.id,
          serviceAreaId: area.id,
          title: input.title || `${occasion.name.replace(/s$/, '').replace(/s & /, ' & ')} on ${formatTitleDate(input.eventDate)}`,
          eventDate: input.eventDate,
          eventTime: input.eventTime ?? null,
          venueAddress: input.venueAddress,
          guestCount: input.guestCount,
          budgetPaise: input.budgetPaise,
          foodPreference: input.foodPreference,
          notes: input.notes,
        })
        .executeTakeFirstOrThrow();
      await tx.insertInto('eventRequestCategories').values(catIds.map((categoryId) => ({ eventRequestId: req.id, categoryId }))).execute();
      for (const v of matched) {
        const q = await tx
          .insertInto('quotes')
          .output('inserted.id')
          .values({ eventRequestId: req.id, vendorId: v.id, currentRevisionId: null, declineReason: null })
          .executeTakeFirstOrThrow();
        await this.outbox.enqueue(tx, 'quote.requested', {
          quoteId: q.id,
          vendorId: v.id,
          reference: req.reference,
          occasion: occasion.name,
          eventDate: input.eventDate,
          guestCount: input.guestCount,
          area: area.name,
        });
      }
      if (matched.length === 0) await this.outbox.enqueue(tx, 'event_request.unmatched', { eventRequestId: req.id, reference: req.reference });
      await this.audit.record(actor, { action: 'event_request.created', entityType: 'event_request', entityId: req.id, metadata: { matched: matched.length } }, tx);
      return { id: req.id, reference: req.reference, matchedVendors: matched.length };
    });
  }

  async listRequests(actor: Actor, page = 1, pageSize = 20) {
    await this.expireStale();
    const base = this.db.selectFrom('eventRequests').where('eventRequests.customerId', '=', actor.userId);
    const [rows, total] = await Promise.all([
      base
        .innerJoin('occasions', 'occasions.id', 'eventRequests.occasionId')
        .innerJoin('serviceAreas', 'serviceAreas.id', 'eventRequests.serviceAreaId')
        .select([
          'eventRequests.id',
          'eventRequests.reference',
          'eventRequests.title',
          'occasions.name as occasion',
          'serviceAreas.name as area',
          'eventRequests.eventDate',
          'eventRequests.guestCount',
          'eventRequests.budgetPaise',
          'eventRequests.status',
          'eventRequests.createdAt',
          (eb) => eb.selectFrom('quotes').select(eb.fn.countAll<number>().as('n')).whereRef('quotes.eventRequestId', '=', 'eventRequests.id').as('vendorsInvited'),
          (eb) =>
            eb
              .selectFrom('quotes')
              .select(eb.fn.countAll<number>().as('n'))
              .whereRef('quotes.eventRequestId', '=', 'eventRequests.id')
              .where('quotes.status', 'in', PRICED_OR_CLOSED)
              .as('quotesReceived'),
        ])
        .orderBy('eventRequests.createdAt', 'desc')
        .offset((page - 1) * pageSize)
        .fetch(pageSize)
        .execute(),
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return new Page(
      rows.map((r) => ({ ...r, vendorsInvited: r.vendorsInvited ?? 0, quotesReceived: r.quotesReceived ?? 0 })),
      page,
      pageSize,
      total.n,
    );
  }

  /** Request detail with every vendor's quote thread for side-by-side comparison. */
  async requestDetail(actor: Actor, id: string) {
    await this.expireStale();
    const r = await this.db
      .selectFrom('eventRequests')
      .innerJoin('occasions', 'occasions.id', 'eventRequests.occasionId')
      .innerJoin('serviceAreas', 'serviceAreas.id', 'eventRequests.serviceAreaId')
      .selectAll('eventRequests')
      .select([
        'occasions.name as occasionName',
        'occasions.slug as occasionSlug',
        'serviceAreas.name as areaName',
        'serviceAreas.city as areaCity',
      ])
      .where('eventRequests.id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound('Event request');
    if (actor.role === 'CUSTOMER' && r.customerId !== actor.userId) throw notFound('Event request');

    const [cats, qs, order] = await Promise.all([
      this.db
        .selectFrom('eventRequestCategories')
        .innerJoin('categories', 'categories.id', 'eventRequestCategories.categoryId')
        .select(['categories.id', 'categories.name', 'categories.slug'])
        .where('eventRequestCategories.eventRequestId', '=', id)
        .orderBy('categories.sortOrder')
        .execute(),
      this.db
        .selectFrom('quotes')
        .innerJoin('vendors', 'vendors.id', 'quotes.vendorId')
        .select([
          'quotes.id',
          'quotes.status',
          'quotes.declineReason',
          'quotes.currentRevisionId',
          'quotes.updatedAt',
          'vendors.id as vendorId',
          'vendors.slug as vendorSlug',
          'vendors.businessName as vendorName',
          'vendors.isDemo as vendorIsDemo',
        ])
        .where('quotes.eventRequestId', '=', id)
        .execute(),
      this.orders.findByEventRequest(id),
    ]);
    const { revisions, items } = await this.loadRevisions(qs.map((q) => q.id));

    return {
      id: r.id,
      reference: r.reference,
      title: r.title,
      status: r.status,
      occasion: { id: r.occasionId, name: r.occasionName, slug: r.occasionSlug },
      serviceArea: { id: r.serviceAreaId, name: r.areaName, city: r.areaCity },
      categories: cats,
      eventDate: r.eventDate,
      eventTime: r.eventTime,
      venueAddress: r.venueAddress,
      guestCount: r.guestCount,
      budgetPaise: r.budgetPaise,
      foodPreference: r.foodPreference,
      notes: r.notes,
      createdAt: r.createdAt,
      order: order ?? null,
      quotes: qs
        .map((q) => ({
          id: q.id,
          status: q.status,
          declineReason: q.declineReason,
          vendor: { id: q.vendorId, slug: q.vendorSlug, businessName: q.vendorName, isDemo: q.vendorIsDemo },
          currentRevisionId: q.currentRevisionId,
          revisions: revisions
            .filter((rev) => rev.quoteId === q.id)
            .sort((a, b) => b.revisionNumber - a.revisionNumber)
            .map((rev) => revisionView(rev, items)),
          updatedAt: q.updatedAt,
        }))
        .sort((a, b) => (a.revisions[0]?.totalPaise ?? Number.MAX_SAFE_INTEGER) - (b.revisions[0]?.totalPaise ?? Number.MAX_SAFE_INTEGER)),
    };
  }

  private async loadRevisions(quoteIds: string[]) {
    if (quoteIds.length === 0) return { revisions: [] as QuoteRevision[], items: [] as QuoteItem[] };
    const revisions = await this.db.selectFrom('quoteRevisions').selectAll().where('quoteId', 'in', quoteIds).execute();
    const items = revisions.length
      ? await this.db.selectFrom('quoteItems').selectAll().where('revisionId', 'in', revisions.map((r) => r.id)).execute()
      : [];
    return { revisions, items };
  }

  async cancelRequest(actor: Actor, id: string, input: ReasonInput) {
    await this.db.transaction().execute(async (tx) => {
      const r = await lockRow(tx, 'eventRequests', id);
      if (!r || r.customerId !== actor.userId) throw notFound('Event request');
      if (r.status !== 'OPEN') throw conflict('INVALID_TRANSITION', `This request is ${r.status.toLowerCase()} and can no longer be cancelled.`);
      await tx.updateTable('eventRequests').set({ status: 'CANCELLED', updatedAt: now() }).where('id', '=', id).execute();
      const affected = await tx
        .updateTable('quotes')
        .set({ status: 'NOT_SELECTED', updatedAt: now() })
        .output(['inserted.id', 'inserted.vendorId'])
        .where('eventRequestId', '=', id)
        .where('status', 'not in', QUOTE_TERMINAL)
        .execute();
      for (const q of affected) await this.outbox.enqueue(tx, 'quote.not_selected', { quoteId: q.id, vendorId: q.vendorId, reference: r.reference });
      await this.audit.record(actor, { action: 'event_request.cancelled', entityType: 'event_request', entityId: id, metadata: { reason: input.reason } }, tx);
    });
    return this.requestDetail(actor, id);
  }

  private async lockQuoteForCustomer(tx: Tx, actor: Actor, requestId: string, quoteId: string) {
    const request = await lockRow(tx, 'eventRequests', requestId);
    if (!request || request.customerId !== actor.userId) throw notFound('Event request');
    const quote = await lockRow(tx, 'quotes', quoteId);
    if (!quote || quote.eventRequestId !== requestId) throw notFound('Quote');
    return { request, quote };
  }

  async rejectQuote(actor: Actor, requestId: string, quoteId: string, input: ReasonInput) {
    await this.db.transaction().execute(async (tx) => {
      const { request, quote } = await this.lockQuoteForCustomer(tx, actor, requestId, quoteId);
      if (!QUOTE_ACCEPTABLE.includes(quote.status)) throw conflict('INVALID_TRANSITION', 'Only an active quote can be declined.');
      await tx.updateTable('quotes').set({ status: 'REJECTED', updatedAt: now() }).where('id', '=', quoteId).execute();
      await this.outbox.enqueue(tx, 'quote.rejected', { quoteId, vendorId: quote.vendorId, reference: request.reference });
      await this.audit.record(actor, { action: 'quote.rejected', entityType: 'quote', entityId: quoteId, metadata: { reason: input.reason } }, tx);
    });
    return this.requestDetail(actor, requestId);
  }

  /**
   * Accepts the exact revision the customer reviewed and creates a durable order.
   * Re-validates everything inside one transaction with row locks; a per-vendor-per-date
   * application lock (sp_getapplock) serialises capacity checks so a vendor can't be double-booked.
   */
  async acceptQuote(actor: Actor, requestId: string, quoteId: string, input: AcceptQuoteInput) {
    await this.expireStale();
    const orderId = await this.db.transaction().execute(async (tx) => {
      const { request, quote } = await this.lockQuoteForCustomer(tx, actor, requestId, quoteId);
      if (request.status !== 'OPEN') throw conflict('REQUEST_CLOSED', `This request is already ${request.status.toLowerCase()}.`);
      const today = todayIST();
      if (request.eventDate <= today) throw conflict('EVENT_DATE_PASSED', 'The event date has passed. Please create a new request.');
      if (!QUOTE_ACCEPTABLE.includes(quote.status)) {
        throw conflict('QUOTE_NOT_ACCEPTABLE', `This quote can't be accepted because it is ${quote.status.toLowerCase().replace(/_/g, ' ')}.`);
      }
      if (quote.currentRevisionId !== input.revisionId) {
        throw conflict('QUOTE_REVISED', 'The vendor has updated this quote since you opened it. Please review the latest version.');
      }
      const revision = await tx.selectFrom('quoteRevisions').selectAll().where('id', '=', input.revisionId).executeTakeFirst();
      if (!revision) throw notFound('Quote revision');
      const items = await tx.selectFrom('quoteItems').selectAll().where('revisionId', '=', revision.id).orderBy('position').execute();
      if (revision.validUntil < today) {
        await tx.updateTable('quotes').set({ status: 'EXPIRED', updatedAt: now() }).where('id', '=', quoteId).execute();
        throw conflict('QUOTE_EXPIRED', 'This quote has expired. Ask the vendor for a revised quote.');
      }
      const vendor = await shareLockRow(tx, 'vendors', quote.vendorId);
      if (!vendor || vendor.status !== 'APPROVED') throw conflict('VENDOR_UNAVAILABLE', 'This vendor is not accepting bookings right now.');

      // Re-verify pricing integrity of the stored revision before it becomes a binding order.
      const recomputed = computeQuoteTotals({
        items,
        discountPaise: revision.discountPaise,
        deliveryPaise: revision.deliveryPaise,
        taxBps: revision.taxBps,
        advanceBps: revision.advanceBps,
      });
      if (recomputed.totalPaise !== revision.totalPaise || recomputed.advancePaise !== revision.advancePaise) {
        this.logger.error(`Revision ${revision.id} totals mismatch`);
        throw conflict('PRICE_MISMATCH', 'This quote could not be verified. Please ask the vendor to re-issue it.');
      }

      const order = await this.orders.createFromAcceptedQuote(tx, actor, { request, quote, revision, items, vendor });

      await tx.updateTable('quotes').set({ status: 'ACCEPTED', updatedAt: now() }).where('id', '=', quoteId).execute();
      const others = await tx
        .updateTable('quotes')
        .set({ status: 'NOT_SELECTED', updatedAt: now() })
        .output(['inserted.id', 'inserted.vendorId'])
        .where('eventRequestId', '=', requestId)
        .where('id', '!=', quoteId)
        .where('status', 'not in', QUOTE_TERMINAL)
        .execute();
      for (const o of others) await this.outbox.enqueue(tx, 'quote.not_selected', { quoteId: o.id, vendorId: o.vendorId, reference: request.reference });
      await tx.updateTable('eventRequests').set({ status: 'ACCEPTED', updatedAt: now() }).where('id', '=', requestId).execute();
      await this.audit.record(
        actor,
        { action: 'quote.accepted', entityType: 'quote', entityId: quoteId, metadata: { revisionId: revision.id, orderId: order.id, totalPaise: revision.totalPaise } },
        tx,
      );
      return order.id;
    });
    return this.orders.detail(actor, orderId);
  }

  // ─────────────────────────── Vendor: quote inbox ───────────────────────────

  private requireVendor(actor: Actor) {
    if (!actor.vendorId) throw forbidden('No vendor business is linked to this account.');
    return actor.vendorId;
  }

  /** Request fields + occasion/area names, as one row per request. */
  private requestRows(db: DbOrTx, ids: string[]) {
    return db
      .selectFrom('eventRequests')
      .innerJoin('occasions', 'occasions.id', 'eventRequests.occasionId')
      .innerJoin('serviceAreas', 'serviceAreas.id', 'eventRequests.serviceAreaId')
      .selectAll('eventRequests')
      .select(['occasions.name as occasionName', 'serviceAreas.name as areaName', 'serviceAreas.city as areaCity'])
      .where('eventRequests.id', 'in', ids)
      .execute();
  }

  private async requestCategories(ids: string[]) {
    if (ids.length === 0) return [];
    return this.db
      .selectFrom('eventRequestCategories')
      .innerJoin('categories', 'categories.id', 'eventRequestCategories.categoryId')
      .select(['eventRequestCategories.eventRequestId', 'categories.id', 'categories.name', 'categories.slug'])
      .where('eventRequestCategories.eventRequestId', 'in', ids)
      .orderBy('categories.sortOrder')
      .execute();
  }

  /** What a vendor may see of a request: no customer contact details until an order exists. */
  private vendorRequestView(
    r: EventRequest & { occasionName: string; areaName: string; areaCity: string },
    cats: { eventRequestId: string; id: string; name: string; slug: string }[],
  ) {
    return {
      id: r.id,
      reference: r.reference,
      title: r.title,
      status: r.status,
      occasion: r.occasionName,
      area: `${r.areaName}, ${r.areaCity}`,
      eventDate: r.eventDate,
      eventTime: r.eventTime,
      guestCount: r.guestCount,
      budgetPaise: r.budgetPaise,
      foodPreference: r.foodPreference,
      notes: r.notes,
      venueLocality: r.venueAddress ? r.venueAddress.split(',').slice(-2).join(',').trim() : '',
      categories: cats.filter((c) => c.eventRequestId === r.id).map(({ id, name, slug }) => ({ id, name, slug })),
    };
  }

  async vendorInbox(actor: Actor, status: string | undefined, page = 1, pageSize = 20) {
    const vendorId = this.requireVendor(actor);
    await this.expireStale();
    const groups: Record<string, QuoteStatus[]> = {
      new: ['REQUESTED', 'VENDOR_REVIEWING'],
      quoted: ['QUOTED', 'REVISED'],
      won: ['ACCEPTED'],
      closed: ['DECLINED', 'REJECTED', 'NOT_SELECTED', 'WITHDRAWN', 'EXPIRED'],
    };
    let base = this.db.selectFrom('quotes').where('quotes.vendorId', '=', vendorId);
    if (status && groups[status]) base = base.where('quotes.status', 'in', groups[status]);
    const [qs, total] = await Promise.all([
      base
        .select(['quotes.id', 'quotes.status', 'quotes.updatedAt', 'quotes.eventRequestId', 'quotes.currentRevisionId'])
        .orderBy('quotes.updatedAt', 'desc')
        .orderBy('quotes.id')
        .offset((page - 1) * pageSize)
        .fetch(pageSize)
        .execute(),
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    const reqIds = [...new Set(qs.map((q) => q.eventRequestId))];
    const revIds = qs.map((q) => q.currentRevisionId).filter((x): x is string => Boolean(x));
    const [reqs, cats, revs] = await Promise.all([
      reqIds.length ? this.requestRows(this.db, reqIds) : Promise.resolve([]),
      this.requestCategories(reqIds),
      revIds.length
        ? this.db.selectFrom('quoteRevisions').select(['id', 'totalPaise', 'revisionNumber', 'validUntil']).where('id', 'in', revIds).execute()
        : Promise.resolve([]),
    ]);
    return new Page(
      qs.map((q) => ({
        id: q.id,
        status: q.status,
        updatedAt: q.updatedAt,
        latest: revs.find((r) => r.id === q.currentRevisionId) ?? null,
        request: this.vendorRequestView(reqs.find((r) => r.id === q.eventRequestId)!, cats),
      })),
      page,
      pageSize,
      total.n,
    );
  }

  async vendorQuoteDetail(actor: Actor, quoteId: string) {
    const vendorId = this.requireVendor(actor);
    await this.expireStale();
    const q = await this.db.selectFrom('quotes').selectAll().where('id', '=', quoteId).where('vendorId', '=', vendorId).executeTakeFirst();
    if (!q) throw notFound('Quote');
    const [[req], cats, customer, { revisions, items }, order, competing, vendor] = await Promise.all([
      this.requestRows(this.db, [q.eventRequestId]),
      this.requestCategories([q.eventRequestId]),
      this.db
        .selectFrom('eventRequests')
        .innerJoin('users', 'users.id', 'eventRequests.customerId')
        .select('users.name')
        .where('eventRequests.id', '=', q.eventRequestId)
        .executeTakeFirstOrThrow(),
      this.loadRevisions([q.id]),
      this.orders.findByQuote(q.id),
      this.db
        .selectFrom('quotes')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('eventRequestId', '=', q.eventRequestId)
        .where('status', 'in', ['QUOTED', 'REVISED'])
        .where('id', '!=', q.id)
        .executeTakeFirstOrThrow(),
      this.db.selectFrom('vendors').select('status').where('id', '=', vendorId).executeTakeFirstOrThrow(),
    ]);
    return {
      id: q.id,
      status: q.status,
      declineReason: q.declineReason,
      currentRevisionId: q.currentRevisionId,
      customerFirstName: customer.name.split(' ')[0],
      request: this.vendorRequestView(req, cats),
      revisions: revisions.sort((a, b) => b.revisionNumber - a.revisionNumber).map((r) => revisionView(r, items)),
      competingQuotes: competing.n,
      order: order ?? null,
      vendorStatus: vendor.status,
      canQuote: vendor.status === 'APPROVED' && QUOTE_REVISABLE.includes(q.status) && req.status === 'OPEN',
    };
  }

  async markReviewing(actor: Actor, quoteId: string) {
    const vendorId = this.requireVendor(actor);
    await this.db
      .updateTable('quotes')
      .set({ status: 'VENDOR_REVIEWING', updatedAt: now() })
      .where('id', '=', quoteId)
      .where('vendorId', '=', vendorId)
      .where('status', '=', 'REQUESTED')
      .execute();
    return this.vendorQuoteDetail(actor, quoteId);
  }

  /** Creates a new immutable revision. Totals are always computed here, never taken from the client. */
  async submitRevision(actor: Actor, quoteId: string, input: QuoteRevisionInput) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction().execute(async (tx) => {
      const vendor = await shareLockRow(tx, 'vendors', vendorId);
      if (!vendor || vendor.status !== 'APPROVED') throw forbidden('Your business must be approved by Utsavora before you can send quotes.');
      const q = await lockRow(tx, 'quotes', quoteId);
      if (!q || q.vendorId !== vendorId) throw notFound('Quote');
      if (!QUOTE_REVISABLE.includes(q.status)) {
        throw conflict('INVALID_TRANSITION', `You can't quote on this request because it is ${q.status.toLowerCase().replace(/_/g, ' ')}.`);
      }
      const r = await shareLockRow(tx, 'eventRequests', q.eventRequestId);
      if (!r || r.status !== 'OPEN') throw conflict('REQUEST_CLOSED', 'The customer has closed this request.');
      const today = todayIST();
      if (input.validUntil < today) throw unprocessable('INVALID_VALIDITY', 'Quote validity must be today or later.');
      if (input.validUntil > r.eventDate) throw unprocessable('INVALID_VALIDITY', 'Quote validity cannot extend past the event date.');

      let totals;
      try {
        totals = computeQuoteTotals(input);
      } catch (e) {
        throw unprocessable('INVALID_PRICING', e instanceof Error ? e.message : 'Invalid pricing');
      }
      if (totals.totalPaise > 2_000_000_000) throw unprocessable('INVALID_PRICING', 'Quote total cannot exceed ₹2 crore.');

      const { next } = await tx
        .selectFrom('quoteRevisions')
        .select(sql<number>`COALESCE(MAX(revision_number), 0) + 1`.as('next'))
        .where('quoteId', '=', quoteId)
        .executeTakeFirstOrThrow();
      const rev = await tx
        .insertInto('quoteRevisions')
        .output('inserted.id')
        .values({
          quoteId,
          revisionNumber: next,
          subtotalPaise: totals.subtotalPaise,
          discountPaise: totals.discountPaise,
          taxBps: input.taxBps,
          taxPaise: totals.taxPaise,
          deliveryPaise: totals.deliveryPaise,
          totalPaise: totals.totalPaise,
          advanceBps: input.advanceBps,
          advancePaise: totals.advancePaise,
          inclusions: json(input.inclusions),
          exclusions: json(input.exclusions),
          terms: input.terms,
          notes: input.notes,
          validUntil: input.validUntil,
          createdById: actor.userId,
        })
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('quoteItems')
        .values(
          totals.lines.map((l, i) => ({
            revisionId: rev.id,
            position: i + 1,
            description: l.description,
            quantity: l.quantity,
            unitPricePaise: l.unitPricePaise,
            lineTotalPaise: l.lineTotalPaise,
          })),
        )
        .execute();
      await tx
        .updateTable('quotes')
        .set({ currentRevisionId: rev.id, status: next === 1 ? 'QUOTED' : 'REVISED', declineReason: null, updatedAt: now() })
        .where('id', '=', quoteId)
        .execute();
      await this.outbox.enqueue(tx, 'quote.submitted', {
        quoteId,
        eventRequestId: r.id,
        customerId: r.customerId,
        vendorName: vendor.businessName,
        reference: r.reference,
        revisionNumber: next,
      });
      await this.audit.record(actor, { action: 'quote.revision_submitted', entityType: 'quote', entityId: quoteId, metadata: { revisionNumber: next, totalPaise: totals.totalPaise } }, tx);
    });
    return this.vendorQuoteDetail(actor, quoteId);
  }

  async decline(actor: Actor, quoteId: string, input: ReasonInput) {
    return this.vendorClose(actor, quoteId, input, ['REQUESTED', 'VENDOR_REVIEWING'], 'DECLINED', 'quote.declined');
  }

  async withdraw(actor: Actor, quoteId: string, input: ReasonInput) {
    return this.vendorClose(actor, quoteId, input, ['QUOTED', 'REVISED'], 'WITHDRAWN', 'quote.withdrawn');
  }

  private async vendorClose(
    actor: Actor,
    quoteId: string,
    input: ReasonInput,
    from: QuoteStatus[],
    to: 'DECLINED' | 'WITHDRAWN',
    event: 'quote.declined' | 'quote.withdrawn',
  ) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction().execute(async (tx) => {
      const q = await lockRow(tx, 'quotes', quoteId);
      if (!q || q.vendorId !== vendorId) throw notFound('Quote');
      if (!from.includes(q.status)) throw conflict('INVALID_TRANSITION', `This quote is ${q.status.toLowerCase().replace(/_/g, ' ')}.`);
      const r = await tx.selectFrom('eventRequests').select(['id', 'customerId', 'reference']).where('id', '=', q.eventRequestId).executeTakeFirstOrThrow();
      const v = await tx.selectFrom('vendors').select('businessName').where('id', '=', vendorId).executeTakeFirstOrThrow();
      await tx.updateTable('quotes').set({ status: to, declineReason: input.reason || null, updatedAt: now() }).where('id', '=', quoteId).execute();
      await this.outbox.enqueue(tx, event, {
        quoteId,
        eventRequestId: r.id,
        customerId: r.customerId,
        vendorName: v.businessName,
        reference: r.reference,
        reason: input.reason,
      });
      await this.audit.record(actor, { action: event, entityType: 'quote', entityId: quoteId, metadata: { reason: input.reason } }, tx);
    });
    return this.vendorQuoteDetail(actor, quoteId);
  }

  // ─────────────────────────── Admin views ───────────────────────────

  async adminRequests(status: string | undefined, page = 1, pageSize = 20) {
    await this.expireStale();
    let base = this.db.selectFrom('eventRequests');
    if (status) base = base.where('eventRequests.status', '=', status as EventRequest['status']);
    const [rows, total] = await Promise.all([
      base
        .innerJoin('occasions', 'occasions.id', 'eventRequests.occasionId')
        .innerJoin('serviceAreas', 'serviceAreas.id', 'eventRequests.serviceAreaId')
        .innerJoin('users', 'users.id', 'eventRequests.customerId')
        .select([
          'eventRequests.id',
          'eventRequests.reference',
          'eventRequests.status',
          'occasions.name as occasion',
          'serviceAreas.name as area',
          'eventRequests.eventDate',
          'eventRequests.guestCount',
          'eventRequests.budgetPaise',
          'eventRequests.createdAt',
          'users.name as customerName',
          'users.email as customerEmail',
          'users.phone as customerPhone',
          (eb) => eb.selectFrom('quotes').select(eb.fn.countAll<number>().as('n')).whereRef('quotes.eventRequestId', '=', 'eventRequests.id').as('vendorsInvited'),
          (eb) =>
            eb
              .selectFrom('quotes')
              .select(eb.fn.countAll<number>().as('n'))
              .whereRef('quotes.eventRequestId', '=', 'eventRequests.id')
              .where('quotes.status', 'not in', ['REQUESTED', 'VENDOR_REVIEWING', 'DECLINED'])
              .as('quotesReceived'),
        ])
        .orderBy('eventRequests.createdAt', 'desc')
        .offset((page - 1) * pageSize)
        .fetch(pageSize)
        .execute(),
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return new Page(
      rows.map(({ customerName, customerEmail, customerPhone, ...r }) => ({
        ...r,
        vendorsInvited: r.vendorsInvited ?? 0,
        quotesReceived: r.quotesReceived ?? 0,
        customer: { name: customerName, email: customerEmail, phone: customerPhone },
      })),
      page,
      pageSize,
      total.n,
    );
  }
}
