import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  ACTIVE_ORDER_STATUSES,
  availableActions,
  canTransition,
  computeCommission,
  ORDER_TRANSITIONS,
  formatINR,
  label,
  type Actor as StateActor,
  type OrderStatus,
} from '@utsavora/types';
import type { OrderActionInput, OrderListQuery, RecordPaymentInput } from '@utsavora/validation';
import { DB } from '../config';
import type { Db, Tx } from '../db/client';
import {
  categories,
  commissionRules,
  eventRequestCategories,
  eventRequests,
  occasions,
  orderEvents,
  orders,
  payments,
  quoteItems,
  quoteRevisions,
  quotes,
  serviceAreas,
  users,
  vendorCategories,
  vendors,
} from '../db/schema';
import { conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { OutboxService } from '../common/outbox.service';
import { orderNumber } from '../common/ids';
import { addDays, todayIST } from '../common/time';
import { Page } from '../common/page';
import type { Actor } from '../auth/actor';

type RequestRow = typeof eventRequests.$inferSelect;
type QuoteRow = typeof quotes.$inferSelect;
type RevisionRow = typeof quoteRevisions.$inferSelect & { items: (typeof quoteItems.$inferSelect)[] };
type VendorRow = typeof vendors.$inferSelect;

export interface OrderSnapshot {
  version: 1;
  acceptedAt: string;
  event: {
    reference: string;
    title: string;
    occasion: string;
    eventDate: string;
    eventTime: string | null;
    area: string;
    city: string;
    venueAddress: string;
    guestCount: number;
    foodPreference: string;
    notes: string;
    services: string[];
  };
  vendor: { id: string; businessName: string; phone: string; gstin: string | null; fssaiNumber: string | null; isDemo: boolean };
  customer: { id: string; name: string };
  quote: {
    quoteId: string;
    revisionId: string;
    revisionNumber: number;
    items: { description: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }[];
    subtotalPaise: number;
    discountPaise: number;
    taxBps: number;
    taxPaise: number;
    deliveryPaise: number;
    totalPaise: number;
    advanceBps: number;
    advancePaise: number;
    inclusions: string[];
    exclusions: string[];
    terms: string;
    notes: string;
    validUntil: string;
  };
  commission: { bps: number; basis: 'taxable_value'; commissionPaise: number; vendorPayablePaise: number };
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** vendor-specific rule > category rule > platform default. */
  async resolveCommissionBps(tx: Tx | Db, vendorId: string, eventRequestId: string): Promise<number> {
    const vendorRule = await tx
      .select()
      .from(commissionRules)
      .where(and(eq(commissionRules.vendorId, vendorId), isNull(commissionRules.categoryId)));
    if (vendorRule[0]) return vendorRule[0].bps;
    // Primary category = the first (by catalogue order) requested category this vendor offers.
    const [primary] = await tx
      .select({ id: categories.id })
      .from(eventRequestCategories)
      .innerJoin(categories, eq(categories.id, eventRequestCategories.categoryId))
      .innerJoin(vendorCategories, and(eq(vendorCategories.categoryId, categories.id), eq(vendorCategories.vendorId, vendorId)))
      .where(eq(eventRequestCategories.eventRequestId, eventRequestId))
      .orderBy(asc(categories.sortOrder))
      .limit(1);
    if (primary) {
      const catRule = await tx
        .select()
        .from(commissionRules)
        .where(and(isNull(commissionRules.vendorId), eq(commissionRules.categoryId, primary.id)));
      if (catRule[0]) return catRule[0].bps;
    }
    const def = await tx
      .select()
      .from(commissionRules)
      .where(and(isNull(commissionRules.vendorId), isNull(commissionRules.categoryId)));
    return def[0]?.bps ?? 1000;
  }

  /** Must be called inside the accept-quote transaction. */
  async createFromAcceptedQuote(tx: Tx, actor: Actor, ctx: { request: RequestRow; quote: QuoteRow; revision: RevisionRow; vendor: VendorRow }) {
    const { request, quote, revision, vendor } = ctx;

    // Serialise capacity checks per vendor per date, then count active bookings.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${vendor.id}:${request.eventDate}`}, 0))`);
    const [{ booked }] = await tx
      .select({ booked: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.vendorId, vendor.id), eq(orders.eventDate, request.eventDate), inArray(orders.status, ACTIVE_ORDER_STATUSES)));
    if (booked >= vendor.maxEventsPerDay) {
      throw conflict('VENDOR_FULLY_BOOKED', `${vendor.businessName} is fully booked on ${request.eventDate}. Please choose another quote.`);
    }

    const bps = await this.resolveCommissionBps(tx, vendor.id, request.id);
    const taxable = revision.subtotalPaise - revision.discountPaise;
    const { commissionPaise, vendorPayablePaise } = computeCommission(taxable, revision.totalPaise, bps);

    const [occ] = await tx.select().from(occasions).where(eq(occasions.id, request.occasionId));
    const [area] = await tx.select().from(serviceAreas).where(eq(serviceAreas.id, request.serviceAreaId));
    const services = await tx
      .select({ name: categories.name })
      .from(eventRequestCategories)
      .innerJoin(categories, eq(categories.id, eventRequestCategories.categoryId))
      .where(eq(eventRequestCategories.eventRequestId, request.id));
    const [customer] = await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, request.customerId));

    const snapshot: OrderSnapshot = {
      version: 1,
      acceptedAt: new Date().toISOString(),
      event: {
        reference: request.reference,
        title: request.title,
        occasion: occ.name,
        eventDate: request.eventDate,
        eventTime: request.eventTime,
        area: area.name,
        city: area.city,
        venueAddress: request.venueAddress,
        guestCount: request.guestCount,
        foodPreference: request.foodPreference,
        notes: request.notes,
        services: services.map((s) => s.name),
      },
      vendor: { id: vendor.id, businessName: vendor.businessName, phone: vendor.phone, gstin: vendor.gstin, fssaiNumber: vendor.fssaiNumber, isDemo: vendor.isDemo },
      customer,
      quote: {
        quoteId: quote.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        items: revision.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPricePaise: i.unitPricePaise, lineTotalPaise: i.lineTotalPaise })),
        subtotalPaise: revision.subtotalPaise,
        discountPaise: revision.discountPaise,
        taxBps: revision.taxBps,
        taxPaise: revision.taxPaise,
        deliveryPaise: revision.deliveryPaise,
        totalPaise: revision.totalPaise,
        advanceBps: revision.advanceBps,
        advancePaise: revision.advancePaise,
        inclusions: revision.inclusions,
        exclusions: revision.exclusions,
        terms: revision.terms,
        notes: revision.notes,
        validUntil: revision.validUntil,
      },
      commission: { bps, basis: 'taxable_value', commissionPaise, vendorPayablePaise },
    };

    const [order] = await tx
      .insert(orders)
      .values({
        orderNumber: orderNumber(request.eventDate),
        mode: 'QUOTE',
        customerId: request.customerId,
        vendorId: vendor.id,
        eventRequestId: request.id,
        quoteId: quote.id,
        acceptedRevisionId: revision.id,
        status: 'PENDING_CONFIRMATION',
        eventDate: request.eventDate,
        guestCount: request.guestCount,
        subtotalPaise: revision.subtotalPaise,
        discountPaise: revision.discountPaise,
        taxPaise: revision.taxPaise,
        deliveryPaise: revision.deliveryPaise,
        totalPaise: revision.totalPaise,
        advancePaise: revision.advancePaise,
        commissionBps: bps,
        commissionPaise,
        vendorPayablePaise,
        snapshot,
        isDemo: vendor.isDemo,
      })
      .returning();
    await tx.insert(orderEvents).values({
      orderId: order.id,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'quote_accepted',
      fromStatus: null,
      toStatus: 'PENDING_CONFIRMATION',
      note: `Accepted quote revision ${revision.revisionNumber}`,
    });
    await this.outbox.enqueue(tx, 'order.created', { orderId: order.id, orderNumber: order.orderNumber, vendorId: vendor.id, customerId: request.customerId });
    return order;
  }

  async findByEventRequest(id: string) {
    return this.db.query.orders.findFirst({ where: eq(orders.eventRequestId, id), columns: { id: true, orderNumber: true, status: true } });
  }

  async findByQuote(id: string) {
    return this.db.query.orders.findFirst({ where: eq(orders.quoteId, id), columns: { id: true, orderNumber: true, status: true } });
  }

  private scope(actor: Actor): SQL | undefined {
    if (actor.role === 'CUSTOMER') return eq(orders.customerId, actor.userId);
    if (actor.role === 'VENDOR') {
      if (!actor.vendorId) throw forbidden();
      return eq(orders.vendorId, actor.vendorId);
    }
    if (!actor.permissions.includes('ORDERS_MANAGE')) throw forbidden('Missing admin permission: ORDERS_MANAGE');
    return undefined;
  }

  private filters(q: Partial<OrderListQuery>): SQL[] {
    const c: SQL[] = [];
    if (q.status) c.push(eq(orders.status, q.status));
    if (q.from) c.push(gte(orders.eventDate, q.from));
    if (q.to) c.push(lte(orders.eventDate, q.to));
    if (q.q) {
      const term = `%${q.q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
      c.push(or(ilike(orders.orderNumber, term), ilike(vendors.businessName, term), ilike(users.name, term))!);
    }
    return c;
  }

  private listColumns = {
    id: orders.id,
    orderNumber: orders.orderNumber,
    status: orders.status,
    eventDate: orders.eventDate,
    guestCount: orders.guestCount,
    totalPaise: orders.totalPaise,
    advancePaise: orders.advancePaise,
    paidPaise: orders.paidPaise,
    commissionPaise: orders.commissionPaise,
    vendorPayablePaise: orders.vendorPayablePaise,
    isDemo: orders.isDemo,
    createdAt: orders.createdAt,
    occasion: sql<string>`${orders.snapshot} -> 'event' ->> 'occasion'`,
    area: sql<string>`${orders.snapshot} -> 'event' ->> 'area'`,
    vendor: { id: vendors.id, businessName: vendors.businessName },
    customer: { id: users.id, name: users.name },
  };

  async list(actor: Actor, q: OrderListQuery) {
    const where = and(this.scope(actor), ...this.filters(q));
    const base = this.db
      .select(this.listColumns)
      .from(orders)
      .innerJoin(vendors, eq(vendors.id, orders.vendorId))
      .innerJoin(users, eq(users.id, orders.customerId))
      .where(where);
    const [items, [{ total }]] = await Promise.all([
      base
        .orderBy(asc(orders.eventDate), desc(orders.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(orders)
        .innerJoin(vendors, eq(vendors.id, orders.vendorId))
        .innerJoin(users, eq(users.id, orders.customerId))
        .where(where),
    ]);
    // Vendors and customers don't need each other's internal financial split.
    const visible = actor.role === 'CUSTOMER' ? items.map(({ commissionPaise: _c, vendorPayablePaise: _v, ...rest }) => rest) : items;
    return new Page(visible, q.page, q.pageSize, total);
  }

  /** Full rows for CSV export (admin only, capped). */
  async exportRows(actor: Actor, q: Partial<OrderListQuery>) {
    const where = and(this.scope(actor), ...this.filters(q));
    return this.db
      .select({
        ...this.listColumns,
        customerEmail: users.email,
        customerPhone: users.phone,
        vendorPhone: vendors.phone,
        eventReference: sql<string>`${orders.snapshot} -> 'event' ->> 'reference'`,
      })
      .from(orders)
      .innerJoin(vendors, eq(vendors.id, orders.vendorId))
      .innerJoin(users, eq(users.id, orders.customerId))
      .where(where)
      .orderBy(asc(orders.eventDate))
      .limit(10_000);
  }

  private stateActor(actor: Actor): StateActor {
    return actor.role;
  }

  async detail(actor: Actor, id: string) {
    const o = await this.db.query.orders.findFirst({
      where: eq(orders.id, id),
      with: {
        events: { orderBy: [asc(orderEvents.createdAt)] },
        payments: { orderBy: [asc(payments.createdAt)] },
        vendor: { columns: { id: true, businessName: true, phone: true, slug: true, isDemo: true } },
        customer: { columns: { id: true, name: true, phone: true, email: true } },
      },
    });
    if (!o) throw notFound('Order');
    if (actor.role === 'CUSTOMER' && o.customerId !== actor.userId) throw notFound('Order');
    if (actor.role === 'VENDOR' && o.vendorId !== actor.vendorId) throw notFound('Order');
    if (actor.role === 'ADMIN' && !actor.permissions.includes('ORDERS_MANAGE')) throw forbidden('Missing admin permission: ORDERS_MANAGE');

    const snapshot = o.snapshot as OrderSnapshot;
    const base = {
      id: o.id,
      orderNumber: o.orderNumber,
      mode: o.mode,
      status: o.status,
      isDemo: o.isDemo,
      eventDate: o.eventDate,
      guestCount: o.guestCount,
      eventRequestId: o.eventRequestId,
      quoteId: o.quoteId,
      subtotalPaise: o.subtotalPaise,
      discountPaise: o.discountPaise,
      taxPaise: o.taxPaise,
      deliveryPaise: o.deliveryPaise,
      totalPaise: o.totalPaise,
      advancePaise: o.advancePaise,
      paidPaise: o.paidPaise,
      balancePaise: o.totalPaise - o.paidPaise,
      cancelReason: o.cancelReason,
      createdAt: o.createdAt,
      snapshot: { ...snapshot, commission: undefined },
      vendor: o.vendor,
      timeline: o.events.map((e) => ({ id: e.id, action: e.action, actorRole: e.actorRole, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, createdAt: e.createdAt })),
      payments: o.payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        kind: p.kind,
        status: p.status,
        method: p.method,
        amountPaise: p.amountPaise,
        receivedOn: p.receivedOn,
        createdAt: p.createdAt,
        reference: actor.role === 'ADMIN' ? p.reference : undefined,
      })),
      actions: availableActions(ORDER_TRANSITIONS, o.status, this.stateActor(actor)).filter((a) => a !== 'record_advance'),
      canRecordPayment: actor.role === 'ADMIN' && actor.permissions.includes('PAYMENTS_RECORD') && ['PAYMENT_PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(o.status) && o.paidPaise < o.totalPaise,
    };
    if (actor.role === 'CUSTOMER') return { ...base, customer: { id: o.customer.id, name: o.customer.name } };
    return {
      ...base,
      customer: o.customer,
      commissionBps: o.commissionBps,
      commissionPaise: o.commissionPaise,
      vendorPayablePaise: o.vendorPayablePaise,
    };
  }

  async act(actor: Actor, id: string, input: OrderActionInput) {
    if (actor.role === 'ADMIN' && !actor.permissions.includes('ORDERS_MANAGE')) throw forbidden('Missing admin permission: ORDERS_MANAGE');
    await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!o) throw notFound('Order');
      if (actor.role === 'CUSTOMER' && o.customerId !== actor.userId) throw notFound('Order');
      if (actor.role === 'VENDOR' && o.vendorId !== actor.vendorId) throw notFound('Order');
      const t = canTransition(ORDER_TRANSITIONS, input.action, o.status, this.stateActor(actor));
      if (!t.ok) throw conflict('INVALID_TRANSITION', t.reason);
      const today = todayIST();
      if (input.action === 'start' && o.eventDate > addDays(today, 1)) {
        throw unprocessable('TOO_EARLY', 'An order can be marked in progress from the day before the event.');
      }
      if (input.action === 'complete' && o.eventDate > today) throw unprocessable('TOO_EARLY', 'An order can be completed on or after the event date.');
      if (t.to === 'CANCELLED' && actor.role !== 'CUSTOMER' && !input.reason) {
        throw unprocessable('REASON_REQUIRED', 'Please give a reason for cancelling.');
      }
      if (t.to === 'CANCELLED' && o.paidPaise > 0) {
        // Refund handling arrives with online payments; flag for ops in the timeline and audit log.
        input.reason = `${input.reason ? `${input.reason}. ` : ''}${formatINR(o.paidPaise)} already paid; Utsavora will process the refund.`;
      }
      await tx
        .update(orders)
        .set({ status: t.to, cancelReason: t.to === 'CANCELLED' ? input.reason || 'Cancelled by customer' : o.cancelReason })
        .where(eq(orders.id, id));
      await this.event(tx, actor, id, input.action, o.status, t.to, input.reason);
      await this.outbox.enqueue(tx, 'order.status_changed', {
        orderId: id,
        orderNumber: o.orderNumber,
        toStatus: t.to,
        vendorId: o.vendorId,
        customerId: o.customerId,
        actorRole: actor.role,
      });
      await this.audit.record(actor, { action: `order.${input.action}`, entityType: 'order', entityId: id, metadata: { from: o.status, to: t.to, reason: input.reason } }, tx);
    });
    return this.detail(actor, id);
  }

  private event(tx: Tx, actor: Actor, orderId: string, action: string, from: OrderStatus | null, to: OrderStatus, note = '') {
    return tx.insert(orderEvents).values({ orderId, actorId: actor.userId, actorRole: actor.role, action, fromStatus: from, toStatus: to, note });
  }

  /**
   * Records an offline payment that an admin has verified (bank statement, UPI reference, receipt).
   * The method+reference pair is unique, so the same payment can't be recorded twice.
   * Online gateway payments will be recorded only from verified webhooks (Phase 2).
   */
  async recordPayment(actor: Actor, id: string, input: RecordPaymentInput) {
    if (!actor.permissions.includes('PAYMENTS_RECORD')) throw forbidden('Missing admin permission: PAYMENTS_RECORD');
    if (input.receivedOn > todayIST()) throw unprocessable('INVALID_DATE', 'Payment date cannot be in the future.');
    await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!o) throw notFound('Order');
      if (!['PAYMENT_PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(o.status)) {
        throw conflict('PAYMENT_NOT_EXPECTED', 'Payments can be recorded only after the vendor confirms the booking.');
      }
      const outstanding = o.totalPaise - o.paidPaise;
      if (input.amountPaise > outstanding) throw unprocessable('OVERPAYMENT', `Amount exceeds the outstanding balance of ₹${(outstanding / 100).toFixed(2)}.`);
      const idempotencyKey = `manual:${input.method}:${input.reference.trim().toUpperCase()}`;
      const dupe = await tx.select({ id: payments.id }).from(payments).where(eq(payments.idempotencyKey, idempotencyKey));
      if (dupe.length) throw conflict('DUPLICATE_PAYMENT', 'A payment with this method and reference is already recorded.');
      const paid = o.paidPaise + input.amountPaise;
      const kind = o.status === 'PAYMENT_PENDING' ? (paid >= o.totalPaise ? 'FULL' : 'ADVANCE') : 'BALANCE';
      await tx.insert(payments).values({
        orderId: id,
        provider: 'MANUAL',
        kind,
        status: 'SUCCEEDED',
        method: input.method,
        amountPaise: input.amountPaise,
        reference: input.reference,
        idempotencyKey,
        receivedOn: input.receivedOn,
        notes: input.notes,
        recordedById: actor.userId,
      });
      let status = o.status;
      if (o.status === 'PAYMENT_PENDING' && paid >= o.advancePaise) {
        const t = canTransition(ORDER_TRANSITIONS, 'record_advance', o.status, 'ADMIN');
        if (t.ok) status = t.to;
      }
      await tx.update(orders).set({ paidPaise: paid, status }).where(eq(orders.id, id));
      await this.event(
        tx,
        actor,
        id,
        'payment_recorded',
        o.status,
        status,
        `${formatINR(input.amountPaise)} by ${label(input.method)}, verified by Utsavora`,
      );
      await this.outbox.enqueue(tx, 'payment.recorded', { orderId: id, orderNumber: o.orderNumber, vendorId: o.vendorId, customerId: o.customerId });
      if (status !== o.status) {
        await this.outbox.enqueue(tx, 'order.status_changed', { orderId: id, orderNumber: o.orderNumber, toStatus: status, vendorId: o.vendorId, customerId: o.customerId, actorRole: 'ADMIN' });
      }
      await this.audit.record(actor, { action: 'payment.recorded', entityType: 'order', entityId: id, metadata: { amountPaise: input.amountPaise, method: input.method, reference: input.reference } }, tx);
    });
    return this.detail(actor, id);
  }
}
