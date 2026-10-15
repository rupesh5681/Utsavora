import { Inject, Injectable } from '@nestjs/common';
import type { Expression, SqlBool } from 'kysely';
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
import { appLock, json, lockRow, now, sql, type Db, type DbOrTx, type Tx } from '../db/client';
import type { EventRequest, Quote, QuoteItem, QuoteRevision, Vendor } from '../db/types';
import { conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { OutboxService } from '../common/outbox.service';
import { likeContains } from '../catalog/catalog.service';
import { orderNumber } from '../common/ids';
import { addDays, todayIST } from '../common/time';
import { Page } from '../common/page';
import type { Actor } from '../auth/actor';

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

const PAYABLE_STATUSES: OrderStatus[] = ['PAYMENT_PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** vendor-specific rule > category rule > platform default. */
  async resolveCommissionBps(tx: DbOrTx, vendorId: string, eventRequestId: string): Promise<number> {
    const vendorRule = await tx.selectFrom('commissionRules').select('bps').where('vendorId', '=', vendorId).where('categoryId', 'is', null).executeTakeFirst();
    if (vendorRule) return vendorRule.bps;
    // Primary category = the first (by catalogue order) requested category this vendor offers.
    const primary = await tx
      .selectFrom('eventRequestCategories')
      .innerJoin('categories', 'categories.id', 'eventRequestCategories.categoryId')
      .innerJoin('vendorCategories', (j) => j.onRef('vendorCategories.categoryId', '=', 'categories.id').on('vendorCategories.vendorId', '=', vendorId))
      .select('categories.id')
      .where('eventRequestCategories.eventRequestId', '=', eventRequestId)
      .orderBy('categories.sortOrder')
      .top(1)
      .executeTakeFirst();
    if (primary) {
      const catRule = await tx.selectFrom('commissionRules').select('bps').where('vendorId', 'is', null).where('categoryId', '=', primary.id).executeTakeFirst();
      if (catRule) return catRule.bps;
    }
    const def = await tx.selectFrom('commissionRules').select('bps').where('vendorId', 'is', null).where('categoryId', 'is', null).executeTakeFirst();
    return def?.bps ?? 1000;
  }

  /** Must be called inside the accept-quote transaction. */
  async createFromAcceptedQuote(
    tx: Tx,
    actor: Actor,
    ctx: { request: EventRequest; quote: Quote; revision: QuoteRevision; items: QuoteItem[]; vendor: Vendor },
  ) {
    const { request, quote, revision, items, vendor } = ctx;

    // Serialise capacity checks per vendor per date, then count active bookings.
    await appLock(tx, `utsavora:vendor-day:${vendor.id}:${request.eventDate}`);
    const { booked } = await tx
      .selectFrom('orders')
      .select((eb) => eb.fn.countAll<number>().as('booked'))
      .where('vendorId', '=', vendor.id)
      .where('eventDate', '=', request.eventDate)
      .where('status', 'in', ACTIVE_ORDER_STATUSES)
      .executeTakeFirstOrThrow();
    if (booked >= vendor.maxEventsPerDay) {
      throw conflict('VENDOR_FULLY_BOOKED', `${vendor.businessName} is fully booked on ${request.eventDate}. Please choose another quote.`);
    }

    const bps = await this.resolveCommissionBps(tx, vendor.id, request.id);
    const taxable = revision.subtotalPaise - revision.discountPaise;
    const { commissionPaise, vendorPayablePaise } = computeCommission(taxable, revision.totalPaise, bps);

    // Sequential on purpose: a transaction holds one connection, and tedious runs one request at a time.
    const occ = await tx.selectFrom('occasions').select('name').where('id', '=', request.occasionId).executeTakeFirstOrThrow();
    const area = await tx.selectFrom('serviceAreas').select(['name', 'city']).where('id', '=', request.serviceAreaId).executeTakeFirstOrThrow();
    const services = await tx
      .selectFrom('eventRequestCategories')
      .innerJoin('categories', 'categories.id', 'eventRequestCategories.categoryId')
      .select('categories.name')
      .where('eventRequestCategories.eventRequestId', '=', request.id)
      .orderBy('categories.sortOrder')
      .execute();
    const customer = await tx.selectFrom('users').select(['id', 'name']).where('id', '=', request.customerId).executeTakeFirstOrThrow();

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
        items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPricePaise: i.unitPricePaise, lineTotalPaise: i.lineTotalPaise })),
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

    const order = await tx
      .insertInto('orders')
      .output(['inserted.id', 'inserted.orderNumber'])
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
        snapshot: json(snapshot),
        isDemo: vendor.isDemo,
        cancelReason: null,
      })
      .executeTakeFirstOrThrow();
    await this.event(tx, actor, order.id, 'quote_accepted', null, 'PENDING_CONFIRMATION', `Accepted quote revision ${revision.revisionNumber}`);
    await this.outbox.enqueue(tx, 'order.created', { orderId: order.id, orderNumber: order.orderNumber, vendorId: vendor.id, customerId: request.customerId });
    return order;
  }

  findByEventRequest(id: string) {
    return this.db.selectFrom('orders').select(['id', 'orderNumber', 'status']).where('eventRequestId', '=', id).executeTakeFirst();
  }

  findByQuote(id: string) {
    return this.db.selectFrom('orders').select(['id', 'orderNumber', 'status']).where('quoteId', '=', id).executeTakeFirst();
  }

  /** Base query for order lists, scoped to the caller and filtered. */
  private listBase(actor: Actor, q: Partial<OrderListQuery>) {
    let base = this.db
      .selectFrom('orders')
      .innerJoin('vendors', 'vendors.id', 'orders.vendorId')
      .innerJoin('users', 'users.id', 'orders.customerId');
    if (actor.role === 'CUSTOMER') base = base.where('orders.customerId', '=', actor.userId);
    else if (actor.role === 'VENDOR') {
      if (!actor.vendorId) throw forbidden();
      base = base.where('orders.vendorId', '=', actor.vendorId);
    } else if (!actor.permissions.includes('ORDERS_MANAGE')) throw forbidden('Missing admin permission: ORDERS_MANAGE');
    if (q.status) base = base.where('orders.status', '=', q.status);
    if (q.from) base = base.where('orders.eventDate', '>=', q.from);
    if (q.to) base = base.where('orders.eventDate', '<=', q.to);
    if (q.q) {
      const term = likeContains(q.q);
      base = base.where((eb) =>
        eb.or(
          (['orders.orderNumber', 'vendors.businessName', 'users.name'] as const).map(
            (col) => sql<SqlBool>`${eb.ref(col)} LIKE ${term} ESCAPE '\\'` as Expression<SqlBool>,
          ),
        ),
      );
    }
    return base;
  }

  private listSelect(actor: Actor, q: Partial<OrderListQuery>) {
    return this.listBase(actor, q).select([
      'orders.id',
      'orders.orderNumber',
      'orders.status',
      'orders.eventDate',
      'orders.guestCount',
      'orders.totalPaise',
      'orders.advancePaise',
      'orders.paidPaise',
      'orders.commissionPaise',
      'orders.vendorPayablePaise',
      'orders.isDemo',
      'orders.createdAt',
      sql<string>`JSON_VALUE(orders.snapshot, '$.event.occasion')`.as('occasion'),
      sql<string>`JSON_VALUE(orders.snapshot, '$.event.area')`.as('area'),
      'vendors.id as vendorId',
      'vendors.businessName as vendorName',
      'users.id as customerId',
      'users.name as customerName',
    ]);
  }

  async list(actor: Actor, q: OrderListQuery) {
    const [rows, total] = await Promise.all([
      this.listSelect(actor, q)
        .orderBy('orders.eventDate')
        .orderBy('orders.createdAt', 'desc')
        .orderBy('orders.id')
        .offset((q.page - 1) * q.pageSize)
        .fetch(q.pageSize)
        .execute(),
      this.listBase(actor, q)
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow(),
    ]);
    const items = rows.map(({ vendorId, vendorName, customerId, customerName, commissionPaise, vendorPayablePaise, ...r }) => ({
      ...r,
      vendor: { id: vendorId, businessName: vendorName },
      customer: { id: customerId, name: customerName },
      // Customers don't see the platform's internal financial split.
      ...(actor.role === 'CUSTOMER' ? {} : { commissionPaise, vendorPayablePaise }),
    }));
    return new Page(items, q.page, q.pageSize, total.n);
  }

  /** Full rows for CSV export (admin only, capped at 10,000). */
  async exportRows(actor: Actor, q: Partial<OrderListQuery>) {
    const rows = await this.listSelect(actor, q)
      .select([
        'users.email as customerEmail',
        'users.phone as customerPhone',
        'vendors.phone as vendorPhone',
        sql<string>`JSON_VALUE(orders.snapshot, '$.event.reference')`.as('eventReference'),
      ])
      .orderBy('orders.eventDate')
      .orderBy('orders.id')
      .top(10_000)
      .execute();
    return rows.map(({ vendorId, vendorName, customerId, customerName, ...r }) => ({
      ...r,
      vendor: { id: vendorId, businessName: vendorName },
      customer: { id: customerId, name: customerName },
    }));
  }

  private stateActor(actor: Actor): StateActor {
    return actor.role;
  }

  async detail(actor: Actor, id: string) {
    const o = await this.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirst();
    if (!o) throw notFound('Order');
    if (actor.role === 'CUSTOMER' && o.customerId !== actor.userId) throw notFound('Order');
    if (actor.role === 'VENDOR' && o.vendorId !== actor.vendorId) throw notFound('Order');
    if (actor.role === 'ADMIN' && !actor.permissions.includes('ORDERS_MANAGE')) throw forbidden('Missing admin permission: ORDERS_MANAGE');

    const [events, pays, vendor, customer] = await Promise.all([
      this.db.selectFrom('orderEvents').selectAll().where('orderId', '=', id).orderBy('createdAt').orderBy('id').execute(),
      this.db.selectFrom('payments').selectAll().where('orderId', '=', id).orderBy('createdAt').orderBy('id').execute(),
      this.db.selectFrom('vendors').select(['id', 'businessName', 'phone', 'slug', 'isDemo']).where('id', '=', o.vendorId).executeTakeFirstOrThrow(),
      this.db.selectFrom('users').select(['id', 'name', 'phone', 'email']).where('id', '=', o.customerId).executeTakeFirstOrThrow(),
    ]);
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
      vendor,
      timeline: events.map((e) => ({ id: e.id, action: e.action, actorRole: e.actorRole, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, createdAt: e.createdAt })),
      payments: pays.map((p) => ({
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
      canRecordPayment:
        actor.role === 'ADMIN' && actor.permissions.includes('PAYMENTS_RECORD') && PAYABLE_STATUSES.includes(o.status) && o.paidPaise < o.totalPaise,
    };
    if (actor.role === 'CUSTOMER') return { ...base, customer: { id: customer.id, name: customer.name } };
    return { ...base, customer, commissionBps: o.commissionBps, commissionPaise: o.commissionPaise, vendorPayablePaise: o.vendorPayablePaise };
  }

  async act(actor: Actor, id: string, input: OrderActionInput) {
    if (actor.role === 'ADMIN' && !actor.permissions.includes('ORDERS_MANAGE')) throw forbidden('Missing admin permission: ORDERS_MANAGE');
    await this.db.transaction().execute(async (tx) => {
      const o = await lockRow(tx, 'orders', id);
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
      let reason = input.reason;
      if (t.to === 'CANCELLED' && o.paidPaise > 0) {
        // Refund handling arrives with online payments; flag for ops in the timeline and audit log.
        reason = `${reason ? `${reason}. ` : ''}${formatINR(o.paidPaise)} already paid; Utsavora will process the refund.`;
      }
      await tx
        .updateTable('orders')
        .set({ status: t.to, cancelReason: t.to === 'CANCELLED' ? reason || 'Cancelled by customer' : o.cancelReason, updatedAt: now() })
        .where('id', '=', id)
        .execute();
      await this.event(tx, actor, id, input.action, o.status, t.to, reason);
      await this.outbox.enqueue(tx, 'order.status_changed', {
        orderId: id,
        orderNumber: o.orderNumber,
        toStatus: t.to,
        vendorId: o.vendorId,
        customerId: o.customerId,
        actorRole: actor.role,
      });
      await this.audit.record(actor, { action: `order.${input.action}`, entityType: 'order', entityId: id, metadata: { from: o.status, to: t.to, reason } }, tx);
    });
    return this.detail(actor, id);
  }

  private async event(tx: Tx, actor: Actor, orderId: string, action: string, from: OrderStatus | null, to: OrderStatus, note = '') {
    await tx.insertInto('orderEvents').values({ orderId, actorId: actor.userId, actorRole: actor.role, action, fromStatus: from, toStatus: to, note }).execute();
  }

  /**
   * Records an offline payment that an admin has verified (bank statement, UPI reference, receipt).
   * The method+reference pair is unique, so the same payment can't be recorded twice.
   * Online gateway payments will be recorded only from verified webhooks (Phase 2).
   */
  async recordPayment(actor: Actor, id: string, input: RecordPaymentInput) {
    if (!actor.permissions.includes('PAYMENTS_RECORD')) throw forbidden('Missing admin permission: PAYMENTS_RECORD');
    if (input.receivedOn > todayIST()) throw unprocessable('INVALID_DATE', 'Payment date cannot be in the future.');
    await this.db.transaction().execute(async (tx) => {
      const o = await lockRow(tx, 'orders', id);
      if (!o) throw notFound('Order');
      if (!PAYABLE_STATUSES.includes(o.status)) {
        throw conflict('PAYMENT_NOT_EXPECTED', 'Payments can be recorded only after the vendor confirms the booking.');
      }
      const outstanding = o.totalPaise - o.paidPaise;
      if (input.amountPaise > outstanding) throw unprocessable('OVERPAYMENT', `Amount exceeds the outstanding balance of ${formatINR(outstanding)}.`);
      const idempotencyKey = `manual:${input.method}:${input.reference.trim().toUpperCase()}`;
      const dupe = await tx.selectFrom('payments').select('id').where('idempotencyKey', '=', idempotencyKey).executeTakeFirst();
      if (dupe) throw conflict('DUPLICATE_PAYMENT', 'A payment with this method and reference is already recorded.');
      const paid = o.paidPaise + input.amountPaise;
      const kind = o.status === 'PAYMENT_PENDING' ? (paid >= o.totalPaise ? 'FULL' : 'ADVANCE') : 'BALANCE';
      await tx
        .insertInto('payments')
        .values({
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
        })
        .execute();
      let status = o.status;
      if (o.status === 'PAYMENT_PENDING' && paid >= o.advancePaise) {
        const t = canTransition(ORDER_TRANSITIONS, 'record_advance', o.status, 'ADMIN');
        if (t.ok) status = t.to;
      }
      await tx.updateTable('orders').set({ paidPaise: paid, status, updatedAt: now() }).where('id', '=', id).execute();
      await this.event(tx, actor, id, 'payment_recorded', o.status, status, `${formatINR(input.amountPaise)} by ${label(input.method)}, verified by Utsavora`);
      await this.outbox.enqueue(tx, 'payment.recorded', { orderId: id, orderNumber: o.orderNumber, vendorId: o.vendorId, customerId: o.customerId });
      if (status !== o.status) {
        await this.outbox.enqueue(tx, 'order.status_changed', {
          orderId: id,
          orderNumber: o.orderNumber,
          toStatus: status,
          vendorId: o.vendorId,
          customerId: o.customerId,
          actorRole: 'ADMIN',
        });
      }
      await this.audit.record(
        actor,
        { action: 'payment.recorded', entityType: 'order', entityId: id, metadata: { amountPaise: input.amountPaise, method: input.method, reference: input.reference } },
        tx,
      );
    });
    return this.detail(actor, id);
  }
}
