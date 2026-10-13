import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import { computeQuoteTotals, QUOTE_ACCEPTABLE, QUOTE_REVISABLE, QUOTE_TERMINAL, type QuoteStatus } from '@utsavora/types';
import type { AcceptQuoteInput, EventRequestInput, QuoteRevisionInput, ReasonInput } from '@utsavora/validation';
import { CONFIG, DB, type AppConfig } from '../config';
import type { Db, DbOrTx, Tx } from '../db/client';
import {
  categories,
  eventRequestCategories,
  eventRequests,
  occasions,
  quoteItems,
  quoteRevisions,
  quotes,
  serviceAreas,
  vendorCategories,
  vendorServiceAreas,
  vendors,
} from '../db/schema';
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
    await db.execute(sql`
      UPDATE quotes q SET status = 'EXPIRED', updated_at = now()
      FROM quote_revisions r
      WHERE r.id = q.current_revision_id AND q.status IN ('QUOTED','REVISED') AND r.valid_until < ${today}::date`);
    const stale = await db
      .update(eventRequests)
      .set({ status: 'EXPIRED' })
      .where(and(eq(eventRequests.status, 'OPEN'), lt(eventRequests.eventDate, today)))
      .returning({ id: eventRequests.id });
    if (stale.length) {
      await db
        .update(quotes)
        .set({ status: 'EXPIRED' })
        .where(and(inArray(quotes.eventRequestId, stale.map((s) => s.id)), notInArray(quotes.status, QUOTE_TERMINAL)));
    }
  }

  // ─────────────────────────── Customer: event requests ───────────────────────────

  async createRequest(actor: Actor, input: EventRequestInput) {
    const today = todayIST();
    if (input.eventDate <= today) throw unprocessable('DATE_TOO_SOON', 'Event date must be at least tomorrow.');
    if (input.eventDate > addDays(today, MAX_DAYS_AHEAD)) throw unprocessable('DATE_TOO_FAR', 'Event date must be within the next 18 months.');

    const result = await this.db.transaction(async (tx) => {
      const [{ open }] = await tx
        .select({ open: sql<number>`count(*)::int` })
        .from(eventRequests)
        .where(and(eq(eventRequests.customerId, actor.userId), eq(eventRequests.status, 'OPEN')));
      if (open >= MAX_OPEN_REQUESTS_PER_CUSTOMER) {
        throw conflict('TOO_MANY_OPEN_REQUESTS', `You can have up to ${MAX_OPEN_REQUESTS_PER_CUSTOMER} open requests. Close one to create another.`);
      }
      const occasion = await tx.query.occasions.findFirst({ where: eq(occasions.id, input.occasionId) });
      if (!occasion) throw unprocessable('INVALID_OCCASION', 'Choose a valid occasion.');
      const area = await tx.query.serviceAreas.findFirst({ where: and(eq(serviceAreas.id, input.serviceAreaId), eq(serviceAreas.isActive, true)) });
      if (!area) throw unprocessable('INVALID_AREA', 'We do not serve this area yet.');
      const catIds = [...new Set(input.categoryIds)];
      const cats = await tx.select().from(categories).where(inArray(categories.id, catIds));
      if (cats.length !== catIds.length) throw unprocessable('INVALID_CATEGORY', 'One or more services are invalid.');

      // Matching vendors: approved, serve the area, offer at least one requested category.
      let matched = await tx
        .selectDistinct({ id: vendors.id, businessName: vendors.businessName })
        .from(vendors)
        .innerJoin(vendorServiceAreas, and(eq(vendorServiceAreas.vendorId, vendors.id), eq(vendorServiceAreas.serviceAreaId, area.id)))
        .innerJoin(vendorCategories, and(eq(vendorCategories.vendorId, vendors.id), inArray(vendorCategories.categoryId, catIds)))
        .where(eq(vendors.status, 'APPROVED'));
      if (input.vendorIds?.length) {
        const wanted = new Set(input.vendorIds);
        const eligible = matched.filter((v) => wanted.has(v.id));
        if (eligible.length !== wanted.size) {
          throw unprocessable('VENDOR_NOT_ELIGIBLE', "The selected vendor doesn't serve this area or service. Remove the vendor filter to reach all matching vendors.");
        }
        matched = eligible;
      }

      const [req] = await tx
        .insert(eventRequests)
        .values({
          reference: eventRequestReference(),
          customerId: actor.userId,
          occasionId: occasion.id,
          serviceAreaId: area.id,
          title: input.title || `${occasion.name.replace(/s$/, '').replace(/s & /, ' & ')} on ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${input.eventDate}T00:00:00Z`))}`,
          eventDate: input.eventDate,
          eventTime: input.eventTime ?? null,
          venueAddress: input.venueAddress,
          guestCount: input.guestCount,
          budgetPaise: input.budgetPaise,
          foodPreference: input.foodPreference,
          notes: input.notes,
        })
        .returning();
      await tx.insert(eventRequestCategories).values(catIds.map((categoryId) => ({ eventRequestId: req.id, categoryId })));
      if (matched.length) {
        const created = await tx
          .insert(quotes)
          .values(matched.map((v) => ({ eventRequestId: req.id, vendorId: v.id })))
          .returning();
        for (const q of created) {
          await this.outbox.enqueue(tx, 'quote.requested', {
            quoteId: q.id,
            vendorId: q.vendorId,
            reference: req.reference,
            occasion: occasion.name,
            eventDate: req.eventDate,
            guestCount: req.guestCount,
            area: area.name,
          });
        }
      } else {
        await this.outbox.enqueue(tx, 'event_request.unmatched', { eventRequestId: req.id, reference: req.reference });
      }
      await this.audit.record(actor, { action: 'event_request.created', entityType: 'event_request', entityId: req.id, metadata: { matched: matched.length } }, tx);
      return { id: req.id, reference: req.reference, matchedVendors: matched.length };
    });
    return result;
  }

  async listRequests(actor: Actor, page = 1, pageSize = 20) {
    await this.expireStale();
    const where = eq(eventRequests.customerId, actor.userId);
    const rows = await this.db.query.eventRequests.findMany({
      where,
      with: { occasion: true, serviceArea: true, quotes: { columns: { status: true } } },
      orderBy: [desc(eventRequests.createdAt)],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(eventRequests).where(where);
    return new Page(
      rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        title: r.title,
        occasion: r.occasion.name,
        area: r.serviceArea.name,
        eventDate: r.eventDate,
        guestCount: r.guestCount,
        budgetPaise: r.budgetPaise,
        status: r.status,
        vendorsInvited: r.quotes.length,
        quotesReceived: r.quotes.filter((q) => ['QUOTED', 'REVISED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'NOT_SELECTED', 'WITHDRAWN'].includes(q.status)).length,
        createdAt: r.createdAt,
      })),
      page,
      pageSize,
      total,
    );
  }

  /** Request detail with every vendor's quote thread for side-by-side comparison. */
  async requestDetail(actor: Actor, id: string) {
    await this.expireStale();
    const r = await this.db.query.eventRequests.findFirst({
      where: eq(eventRequests.id, id),
      with: {
        occasion: true,
        serviceArea: true,
        categories: { with: { category: true } },
        quotes: {
          with: {
            vendor: true,
            revisions: { with: { items: { orderBy: [asc(quoteItems.position)] } }, orderBy: [desc(quoteRevisions.revisionNumber)] },
          },
        },
      },
    });
    if (!r) throw notFound('Event request');
    if (actor.role === 'CUSTOMER' && r.customerId !== actor.userId) throw notFound('Event request');
    const order = await this.orders.findByEventRequest(r.id);
    return {
      id: r.id,
      reference: r.reference,
      title: r.title,
      status: r.status,
      occasion: { id: r.occasion.id, name: r.occasion.name, slug: r.occasion.slug },
      serviceArea: { id: r.serviceArea.id, name: r.serviceArea.name, city: r.serviceArea.city },
      categories: r.categories.map((c) => ({ id: c.category.id, name: c.category.name, slug: c.category.slug })),
      eventDate: r.eventDate,
      eventTime: r.eventTime,
      venueAddress: r.venueAddress,
      guestCount: r.guestCount,
      budgetPaise: r.budgetPaise,
      foodPreference: r.foodPreference,
      notes: r.notes,
      createdAt: r.createdAt,
      order: order ? { id: order.id, orderNumber: order.orderNumber, status: order.status } : null,
      quotes: r.quotes
        .map((q) => ({
          id: q.id,
          status: q.status,
          declineReason: q.declineReason,
          vendor: { id: q.vendor.id, slug: q.vendor.slug, businessName: q.vendor.businessName, isDemo: q.vendor.isDemo },
          currentRevisionId: q.currentRevisionId,
          revisions: q.revisions.map((rev) => this.revisionView(rev)),
          updatedAt: q.updatedAt,
        }))
        .sort((a, b) => (a.revisions[0]?.totalPaise ?? Number.MAX_SAFE_INTEGER) - (b.revisions[0]?.totalPaise ?? Number.MAX_SAFE_INTEGER)),
    };
  }

  private revisionView(rev: typeof quoteRevisions.$inferSelect & { items: (typeof quoteItems.$inferSelect)[] }) {
    return {
      id: rev.id,
      revisionNumber: rev.revisionNumber,
      items: rev.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPricePaise: i.unitPricePaise, lineTotalPaise: i.lineTotalPaise })),
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

  async cancelRequest(actor: Actor, id: string, input: ReasonInput) {
    await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(eventRequests).where(eq(eventRequests.id, id)).for('update');
      if (!r || r.customerId !== actor.userId) throw notFound('Event request');
      if (r.status !== 'OPEN') throw conflict('INVALID_TRANSITION', `This request is ${r.status.toLowerCase()} and can no longer be cancelled.`);
      await tx.update(eventRequests).set({ status: 'CANCELLED' }).where(eq(eventRequests.id, id));
      const affected = await tx
        .update(quotes)
        .set({ status: 'NOT_SELECTED' })
        .where(and(eq(quotes.eventRequestId, id), notInArray(quotes.status, QUOTE_TERMINAL)))
        .returning();
      for (const q of affected) {
        await this.outbox.enqueue(tx, 'quote.not_selected', { quoteId: q.id, vendorId: q.vendorId, reference: r.reference });
      }
      await this.audit.record(actor, { action: 'event_request.cancelled', entityType: 'event_request', entityId: id, metadata: { reason: input.reason } }, tx);
    });
    return this.requestDetail(actor, id);
  }

  private async lockQuoteForCustomer(tx: Tx, actor: Actor, requestId: string, quoteId: string) {
    const [r] = await tx.select().from(eventRequests).where(eq(eventRequests.id, requestId)).for('update');
    if (!r || r.customerId !== actor.userId) throw notFound('Event request');
    const [q] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.eventRequestId, requestId))).for('update');
    if (!q) throw notFound('Quote');
    return { request: r, quote: q };
  }

  async rejectQuote(actor: Actor, requestId: string, quoteId: string, input: ReasonInput) {
    await this.db.transaction(async (tx) => {
      const { request, quote } = await this.lockQuoteForCustomer(tx, actor, requestId, quoteId);
      if (!QUOTE_ACCEPTABLE.includes(quote.status)) throw conflict('INVALID_TRANSITION', 'Only an active quote can be declined.');
      await tx.update(quotes).set({ status: 'REJECTED' }).where(eq(quotes.id, quoteId));
      await this.outbox.enqueue(tx, 'quote.rejected', { quoteId, vendorId: quote.vendorId, reference: request.reference });
      await this.audit.record(actor, { action: 'quote.rejected', entityType: 'quote', entityId: quoteId, metadata: { reason: input.reason } }, tx);
    });
    return this.requestDetail(actor, requestId);
  }

  /**
   * Accepts the exact revision the customer reviewed and creates a durable order.
   * Re-validates everything inside one transaction with row locks; a per-vendor-per-date
   * advisory lock serialises capacity checks so a vendor can't be double-booked.
   */
  async acceptQuote(actor: Actor, requestId: string, quoteId: string, input: AcceptQuoteInput) {
    await this.expireStale();
    const orderId = await this.db.transaction(async (tx) => {
      const { request, quote } = await this.lockQuoteForCustomer(tx, actor, requestId, quoteId);
      if (request.status !== 'OPEN') throw conflict('REQUEST_CLOSED', `This request is already ${request.status.toLowerCase()}.`);
      const today = todayIST();
      if (request.eventDate <= today) throw conflict('EVENT_DATE_PASSED', 'The event date has passed. Please create a new request.');
      if (!QUOTE_ACCEPTABLE.includes(quote.status as QuoteStatus)) {
        throw conflict('QUOTE_NOT_ACCEPTABLE', `This quote can't be accepted because it is ${quote.status.toLowerCase().replace(/_/g, ' ')}.`);
      }
      if (quote.currentRevisionId !== input.revisionId) {
        throw conflict('QUOTE_REVISED', 'The vendor has updated this quote since you opened it. Please review the latest version.');
      }
      const revision = await tx.query.quoteRevisions.findFirst({
        where: eq(quoteRevisions.id, input.revisionId),
        with: { items: { orderBy: [asc(quoteItems.position)] } },
      });
      if (!revision) throw notFound('Quote revision');
      if (revision.validUntil < today) {
        await tx.update(quotes).set({ status: 'EXPIRED' }).where(eq(quotes.id, quoteId));
        throw conflict('QUOTE_EXPIRED', 'This quote has expired. Ask the vendor for a revised quote.');
      }
      const [vendor] = await tx.select().from(vendors).where(eq(vendors.id, quote.vendorId)).for('share');
      if (vendor.status !== 'APPROVED') throw conflict('VENDOR_UNAVAILABLE', 'This vendor is not accepting bookings right now.');

      // Re-verify pricing integrity of the stored revision before it becomes a binding order.
      const recomputed = computeQuoteTotals({
        items: revision.items,
        discountPaise: revision.discountPaise,
        deliveryPaise: revision.deliveryPaise,
        taxBps: revision.taxBps,
        advanceBps: revision.advanceBps,
      });
      if (recomputed.totalPaise !== revision.totalPaise || recomputed.advancePaise !== revision.advancePaise) {
        this.logger.error(`Revision ${revision.id} totals mismatch`);
        throw conflict('PRICE_MISMATCH', 'This quote could not be verified. Please ask the vendor to re-issue it.');
      }

      const order = await this.orders.createFromAcceptedQuote(tx, actor, { request, quote, revision, vendor });

      await tx.update(quotes).set({ status: 'ACCEPTED' }).where(eq(quotes.id, quoteId));
      const others = await tx
        .update(quotes)
        .set({ status: 'NOT_SELECTED' })
        .where(and(eq(quotes.eventRequestId, requestId), ne(quotes.id, quoteId), notInArray(quotes.status, QUOTE_TERMINAL)))
        .returning();
      for (const o of others) await this.outbox.enqueue(tx, 'quote.not_selected', { quoteId: o.id, vendorId: o.vendorId, reference: request.reference });
      await tx.update(eventRequests).set({ status: 'ACCEPTED' }).where(eq(eventRequests.id, requestId));
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

  async vendorInbox(actor: Actor, status: string | undefined, page = 1, pageSize = 20) {
    const vendorId = this.requireVendor(actor);
    await this.expireStale();
    const groups: Record<string, QuoteStatus[]> = {
      new: ['REQUESTED', 'VENDOR_REVIEWING'],
      quoted: ['QUOTED', 'REVISED'],
      won: ['ACCEPTED'],
      closed: ['DECLINED', 'REJECTED', 'NOT_SELECTED', 'WITHDRAWN', 'EXPIRED'],
    };
    const where = and(eq(quotes.vendorId, vendorId), status && groups[status] ? inArray(quotes.status, groups[status]) : undefined);
    const rows = await this.db.query.quotes.findMany({
      where,
      with: {
        eventRequest: { with: { occasion: true, serviceArea: true, categories: { with: { category: true } } } },
        revisions: { columns: { id: true, totalPaise: true, revisionNumber: true, validUntil: true }, orderBy: [desc(quoteRevisions.revisionNumber)], limit: 1 },
      },
      orderBy: [desc(quotes.updatedAt)],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(quotes).where(where);
    return new Page(
      rows.map((q) => ({
        id: q.id,
        status: q.status,
        updatedAt: q.updatedAt,
        latest: q.revisions[0] ?? null,
        request: this.vendorRequestView(q.eventRequest),
      })),
      page,
      pageSize,
      total,
    );
  }

  /** What a vendor may see of a request: no customer contact details until an order exists. */
  private vendorRequestView(r: {
    id: string;
    reference: string;
    title: string;
    status: string;
    eventDate: string;
    eventTime: string | null;
    guestCount: number;
    budgetPaise: number;
    foodPreference: string;
    notes: string;
    venueAddress: string;
    occasion: { name: string };
    serviceArea: { name: string; city: string };
    categories: { category: { id: string; name: string; slug: string } }[];
  }) {
    return {
      id: r.id,
      reference: r.reference,
      title: r.title,
      status: r.status,
      occasion: r.occasion.name,
      area: `${r.serviceArea.name}, ${r.serviceArea.city}`,
      eventDate: r.eventDate,
      eventTime: r.eventTime,
      guestCount: r.guestCount,
      budgetPaise: r.budgetPaise,
      foodPreference: r.foodPreference,
      notes: r.notes,
      venueLocality: r.venueAddress ? r.venueAddress.split(',').slice(-2).join(',').trim() : '',
      categories: r.categories.map((c) => c.category),
    };
  }

  async vendorQuoteDetail(actor: Actor, quoteId: string) {
    const vendorId = this.requireVendor(actor);
    await this.expireStale();
    const q = await this.db.query.quotes.findFirst({
      where: and(eq(quotes.id, quoteId), eq(quotes.vendorId, vendorId)),
      with: {
        eventRequest: { with: { occasion: true, serviceArea: true, categories: { with: { category: true } }, customer: { columns: { name: true } } } },
        revisions: { with: { items: { orderBy: [asc(quoteItems.position)] } }, orderBy: [desc(quoteRevisions.revisionNumber)] },
      },
    });
    if (!q) throw notFound('Quote');
    const order = await this.orders.findByQuote(q.id);
    const competing = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(quotes)
      .where(and(eq(quotes.eventRequestId, q.eventRequestId), inArray(quotes.status, ['QUOTED', 'REVISED']), ne(quotes.id, q.id)));
    const vendor = await this.db.query.vendors.findFirst({ where: eq(vendors.id, vendorId) });
    return {
      id: q.id,
      status: q.status,
      declineReason: q.declineReason,
      currentRevisionId: q.currentRevisionId,
      customerFirstName: q.eventRequest.customer.name.split(' ')[0],
      request: this.vendorRequestView(q.eventRequest),
      revisions: q.revisions.map((r) => this.revisionView(r)),
      competingQuotes: competing[0].n,
      order: order ? { id: order.id, orderNumber: order.orderNumber, status: order.status } : null,
      vendorStatus: vendor?.status,
      canQuote: vendor?.status === 'APPROVED' && QUOTE_REVISABLE.includes(q.status) && q.eventRequest.status === 'OPEN',
    };
  }

  async markReviewing(actor: Actor, quoteId: string) {
    const vendorId = this.requireVendor(actor);
    await this.db
      .update(quotes)
      .set({ status: 'VENDOR_REVIEWING' })
      .where(and(eq(quotes.id, quoteId), eq(quotes.vendorId, vendorId), eq(quotes.status, 'REQUESTED')));
    return this.vendorQuoteDetail(actor, quoteId);
  }

  /** Creates a new immutable revision. Totals are always computed here, never taken from the client. */
  async submitRevision(actor: Actor, quoteId: string, input: QuoteRevisionInput) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction(async (tx) => {
      const [vendor] = await tx.select().from(vendors).where(eq(vendors.id, vendorId)).for('share');
      if (vendor.status !== 'APPROVED') throw forbidden('Your business must be approved by Utsavora before you can send quotes.');
      const [q] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.vendorId, vendorId))).for('update');
      if (!q) throw notFound('Quote');
      if (!QUOTE_REVISABLE.includes(q.status)) throw conflict('INVALID_TRANSITION', `You can't quote on this request because it is ${q.status.toLowerCase().replace(/_/g, ' ')}.`);
      const [r] = await tx.select().from(eventRequests).where(eq(eventRequests.id, q.eventRequestId)).for('share');
      if (r.status !== 'OPEN') throw conflict('REQUEST_CLOSED', 'The customer has closed this request.');
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

      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${quoteRevisions.revisionNumber}), 0)::int + 1` })
        .from(quoteRevisions)
        .where(eq(quoteRevisions.quoteId, quoteId));
      const [rev] = await tx
        .insert(quoteRevisions)
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
          inclusions: input.inclusions,
          exclusions: input.exclusions,
          terms: input.terms,
          notes: input.notes,
          validUntil: input.validUntil,
          createdById: actor.userId,
        })
        .returning();
      await tx.insert(quoteItems).values(
        totals.lines.map((l, i) => ({
          revisionId: rev.id,
          position: i + 1,
          description: l.description,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
          lineTotalPaise: l.lineTotalPaise,
        })),
      );
      await tx
        .update(quotes)
        .set({ currentRevisionId: rev.id, status: next === 1 ? 'QUOTED' : 'REVISED', declineReason: null })
        .where(eq(quotes.id, quoteId));
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
    await this.db.transaction(async (tx) => {
      const [q] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.vendorId, vendorId))).for('update');
      if (!q) throw notFound('Quote');
      if (!from.includes(q.status)) throw conflict('INVALID_TRANSITION', `This quote is ${q.status.toLowerCase().replace(/_/g, ' ')}.`);
      const [r] = await tx.select().from(eventRequests).where(eq(eventRequests.id, q.eventRequestId));
      const [v] = await tx.select({ name: vendors.businessName }).from(vendors).where(eq(vendors.id, vendorId));
      await tx.update(quotes).set({ status: to, declineReason: input.reason || null }).where(eq(quotes.id, quoteId));
      await this.outbox.enqueue(tx, event, { quoteId, eventRequestId: r.id, customerId: r.customerId, vendorName: v.name, reference: r.reference, reason: input.reason });
      await this.audit.record(actor, { action: event, entityType: 'quote', entityId: quoteId, metadata: { reason: input.reason } }, tx);
    });
    return this.vendorQuoteDetail(actor, quoteId);
  }

  // ─────────────────────────── Admin views ───────────────────────────

  async adminRequests(status: string | undefined, page = 1, pageSize = 20) {
    await this.expireStale();
    const where = status ? eq(eventRequests.status, status as 'OPEN') : undefined;
    const rows = await this.db.query.eventRequests.findMany({
      where,
      with: { occasion: true, serviceArea: true, customer: { columns: { name: true, email: true, phone: true } }, quotes: { columns: { status: true } } },
      orderBy: [desc(eventRequests.createdAt)],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(eventRequests).where(where);
    return new Page(
      rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        status: r.status,
        occasion: r.occasion.name,
        area: r.serviceArea.name,
        eventDate: r.eventDate,
        guestCount: r.guestCount,
        budgetPaise: r.budgetPaise,
        customer: r.customer,
        vendorsInvited: r.quotes.length,
        quotesReceived: r.quotes.filter((q) => !['REQUESTED', 'VENDOR_REVIEWING', 'DECLINED'].includes(q.status)).length,
        createdAt: r.createdAt,
      })),
      page,
      pageSize,
      total,
    );
  }
}
