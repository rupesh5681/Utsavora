import { Inject, Injectable } from '@nestjs/common';
import { canTransition, LISTING_TRANSITIONS, VENDOR_TRANSITIONS, ACTIVE_ORDER_STATUSES, formatINR, label } from '@utsavora/types';
import type { CommissionSettingsInput, ModerationDecisionInput } from '@utsavora/validation';
import { DB } from '../config';
import { lockRow, now, sql, type Db } from '../db/client';
import type { Listing, Vendor } from '../db/types';
import { conflict, notFound, unprocessable } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { Page } from '../common/page';
import { todayIST, addDays } from '../common/time';
import { vendorChecklist } from '../vendor/vendor.service';
import type { Actor } from '../auth/actor';

const count = (n: { n: number } | undefined) => n?.n ?? 0;

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async dashboard() {
    const today = todayIST();
    const countAll = <T extends 'vendors' | 'listings' | 'eventRequests'>(table: T, status: string) =>
      this.db
        .selectFrom(table as 'vendors')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('status', '=', status as Vendor['status'])
        .executeTakeFirst()
        .then(count);
    const booked = sql.join(['CONFIRMED', 'IN_PROGRESS', 'COMPLETED']);
    const [vendorsPending, listingsPending, openRequests, vendorsApproved, ordersByStatus, money, upcoming, unquoted] = await Promise.all([
      countAll('vendors', 'PENDING_REVIEW'),
      countAll('listings', 'PENDING_REVIEW'),
      countAll('eventRequests', 'OPEN'),
      countAll('vendors', 'APPROVED'),
      this.db
        .selectFrom('orders')
        .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
        .groupBy('status')
        .execute(),
      // Demo orders are excluded from money totals. BIGINT sums are returned as strings by the driver.
      this.db
        .selectFrom('orders')
        .select([
          sql<string>`SUM(CAST(CASE WHEN status IN (${booked}) AND is_demo = 0 THEN total_paise ELSE 0 END AS BIGINT))`.as('bookedPaise'),
          sql<string>`SUM(CAST(CASE WHEN status IN (${booked}) AND is_demo = 0 THEN commission_paise ELSE 0 END AS BIGINT))`.as('commissionPaise'),
          sql<string>`SUM(CAST(CASE WHEN is_demo = 0 THEN paid_paise ELSE 0 END AS BIGINT))`.as('collectedPaise'),
        ])
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('orders')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('status', 'in', ACTIVE_ORDER_STATUSES)
        .where('eventDate', '>=', today)
        .where('eventDate', '<=', addDays(today, 7))
        .executeTakeFirst()
        .then(count),
      this.db
        .selectFrom('eventRequests as e')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('e.status', '=', 'OPEN')
        .where((eb) =>
          eb.not(
            eb.exists(
              eb.selectFrom('quotes as q').select(sql`1`.as('one')).whereRef('q.eventRequestId', '=', 'e.id').where('q.status', 'in', ['QUOTED', 'REVISED']),
            ),
          ),
        )
        .where(sql<boolean>`e.created_at < DATEADD(HOUR, -24, SYSUTCDATETIME())`)
        .executeTakeFirst()
        .then(count),
    ]);
    return {
      vendorsPending,
      vendorsApproved,
      listingsPending,
      openRequests,
      requestsWithoutQuotes24h: unquoted,
      upcomingEvents7d: upcoming,
      ordersByStatus: Object.fromEntries(ordersByStatus.map((r) => [r.status, r.n])),
      bookedPaise: Number(money.bookedPaise ?? 0),
      commissionPaise: Number(money.commissionPaise ?? 0),
      collectedPaise: Number(money.collectedPaise ?? 0),
      note: 'Money totals exclude demo orders.',
    };
  }

  // ───────────── Vendors ─────────────

  async vendors(status: string | undefined, page: number, pageSize: number) {
    let base = this.db.selectFrom('vendors');
    if (status) base = base.where('status', '=', status as Vendor['status']);
    const [rows, total] = await Promise.all([
      base
        .select(['id', 'businessName', 'slug', 'status', 'city', 'phone', 'isDemo', 'submittedAt', 'createdAt'])
        .orderBy(sql`CASE WHEN submitted_at IS NULL THEN 1 ELSE 0 END`)
        .orderBy('submittedAt', 'desc')
        .orderBy('createdAt', 'desc')
        .offset((page - 1) * pageSize)
        .fetch(pageSize)
        .execute(),
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return new Page(rows, page, pageSize, total.n);
  }

  async vendor(id: string) {
    const v = await this.db.selectFrom('vendors').selectAll().where('id', '=', id).executeTakeFirst();
    if (!v) throw notFound('Vendor');
    const [categories, serviceAreas, members, reviews, listings, checklist] = await Promise.all([
      this.db
        .selectFrom('vendorCategories')
        .innerJoin('categories', 'categories.id', 'vendorCategories.categoryId')
        .selectAll('categories')
        .where('vendorCategories.vendorId', '=', id)
        .orderBy('categories.sortOrder')
        .execute(),
      this.db
        .selectFrom('vendorServiceAreas')
        .innerJoin('serviceAreas', 'serviceAreas.id', 'vendorServiceAreas.serviceAreaId')
        .selectAll('serviceAreas')
        .where('vendorServiceAreas.vendorId', '=', id)
        .orderBy('serviceAreas.name')
        .execute(),
      this.db
        .selectFrom('vendorMembers')
        .innerJoin('users', 'users.id', 'vendorMembers.userId')
        .select(['vendorMembers.role', 'users.id', 'users.name', 'users.email', 'users.phone'])
        .where('vendorMembers.vendorId', '=', id)
        .execute(),
      this.db
        .selectFrom('vendorVerificationReviews as r')
        .innerJoin('users', 'users.id', 'r.reviewerId')
        .select(['r.id', 'r.decision', 'r.fromStatus', 'r.toStatus', 'r.notes', 'users.name as reviewer', 'r.createdAt'])
        .where('r.vendorId', '=', id)
        .orderBy('r.createdAt', 'desc')
        .execute(),
      this.db.selectFrom('listings').select(['id', 'title', 'status', 'type']).where('vendorId', '=', id).execute(),
      vendorChecklist(this.db, id),
    ]);
    return { ...v, categories, serviceAreas, members, reviews, listings, checklist };
  }

  async decideVendor(actor: Actor, id: string, input: ModerationDecisionInput) {
    await this.db.transaction().execute(async (tx) => {
      const v = await lockRow(tx, 'vendors', id);
      if (!v) throw notFound('Vendor');
      const t = canTransition(VENDOR_TRANSITIONS, input.decision, v.status, 'ADMIN');
      if (!t.ok) throw conflict('INVALID_TRANSITION', t.reason);
      if (input.decision !== 'approve' && !input.notes) throw unprocessable('NOTES_REQUIRED', 'Explain the decision so the vendor knows what to fix.');
      if (input.decision === 'approve') {
        const missing = (await vendorChecklist(tx, id)).filter((c) => !c.done);
        if (missing.length) throw unprocessable('ONBOARDING_INCOMPLETE', 'This vendor has not completed onboarding.', missing);
      }
      await tx
        .updateTable('vendors')
        .set({ status: t.to, approvedAt: t.to === 'APPROVED' ? now() : v.approvedAt, updatedAt: now() })
        .where('id', '=', id)
        .execute();
      await tx
        .insertInto('vendorVerificationReviews')
        .values({ vendorId: id, reviewerId: actor.userId, decision: input.decision, fromStatus: v.status, toStatus: t.to, notes: input.notes })
        .execute();
      await this.audit.record(actor, { action: `vendor.${input.decision}`, entityType: 'vendor', entityId: id, metadata: { from: v.status, to: t.to, notes: input.notes } }, tx);
    });
    return this.vendor(id);
  }

  // ───────────── Listings ─────────────

  async listings(status: string | undefined, page: number, pageSize: number) {
    let base = this.db
      .selectFrom('listings')
      .innerJoin('vendors', 'vendors.id', 'listings.vendorId')
      .innerJoin('categories', 'categories.id', 'listings.categoryId');
    if (status) base = base.where('listings.status', '=', status as Listing['status']);
    const [rows, total] = await Promise.all([
      base
        .select([
          'listings.id',
          'listings.title',
          'listings.description',
          'listings.type',
          'listings.pricingMode',
          'listings.pricePaise',
          'listings.minGuests',
          'listings.maxGuests',
          'listings.foodPreference',
          'listings.inclusions',
          'listings.status',
          'listings.isDemo',
          'listings.submittedAt',
          'listings.updatedAt',
          'vendors.id as vendorId',
          'vendors.businessName as vendorName',
          'vendors.status as vendorStatus',
          'categories.id as categoryId',
          'categories.name as categoryName',
        ])
        .orderBy(sql`CASE WHEN listings.submitted_at IS NULL THEN 1 ELSE 0 END`)
        .orderBy('listings.submittedAt')
        .orderBy('listings.updatedAt', 'desc')
        .offset((page - 1) * pageSize)
        .fetch(pageSize)
        .execute(),
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return new Page(
      rows.map(({ vendorId, vendorName, vendorStatus, categoryId, categoryName, ...l }) => ({
        ...l,
        vendor: { id: vendorId, businessName: vendorName, status: vendorStatus },
        category: { id: categoryId, name: categoryName },
      })),
      page,
      pageSize,
      total.n,
    );
  }

  async decideListing(actor: Actor, id: string, input: ModerationDecisionInput) {
    await this.db.transaction().execute(async (tx) => {
      const l = await lockRow(tx, 'listings', id);
      if (!l) throw notFound('Listing');
      const t = canTransition(LISTING_TRANSITIONS, input.decision, l.status, 'ADMIN');
      if (!t.ok) throw conflict('INVALID_TRANSITION', t.reason);
      if (input.decision !== 'approve' && !input.notes) throw unprocessable('NOTES_REQUIRED', 'Explain the decision so the vendor knows what to fix.');
      await tx
        .updateTable('listings')
        .set({ status: t.to, approvedAt: t.to === 'APPROVED' ? now() : l.approvedAt, updatedAt: now() })
        .where('id', '=', id)
        .execute();
      await tx
        .insertInto('moderationActions')
        .values({ listingId: id, moderatorId: actor.userId, decision: input.decision, fromStatus: l.status, toStatus: t.to, notes: input.notes })
        .execute();
      await this.audit.record(actor, { action: `listing.${input.decision}`, entityType: 'listing', entityId: id, metadata: { from: l.status, to: t.to, notes: input.notes } }, tx);
    });
    return this.db.selectFrom('listings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  // ───────────── Commission ─────────────

  async commission() {
    const [rules, cats] = await Promise.all([
      this.db.selectFrom('commissionRules').select(['id', 'vendorId', 'categoryId', 'bps', 'updatedAt']).execute(),
      this.db.selectFrom('categories').select(['id', 'name', 'slug']).orderBy('sortOrder').execute(),
    ]);
    const def = rules.find((r) => !r.vendorId && !r.categoryId);
    return {
      defaultBps: def?.bps ?? 1000,
      categories: cats.map((c) => ({ ...c, bps: rules.find((r) => !r.vendorId && r.categoryId === c.id)?.bps ?? null })),
      vendorOverrides: rules.filter((r) => r.vendorId),
      note: 'Commission applies to the taxable service value (before GST and delivery). Changes affect only new bookings; existing orders keep their snapshot.',
    };
  }

  async updateCommission(actor: Actor, input: CommissionSettingsInput) {
    const before = await this.commission();
    await this.db.transaction().execute(async (tx) => {
      const def = await sql<{ id: string }>`
        SELECT id FROM commission_rules WITH (UPDLOCK, ROWLOCK) WHERE vendor_id IS NULL AND category_id IS NULL`.execute(tx);
      if (def.rows[0]) await tx.updateTable('commissionRules').set({ bps: input.defaultBps, updatedAt: now() }).where('id', '=', def.rows[0].id).execute();
      else await tx.insertInto('commissionRules').values({ bps: input.defaultBps, vendorId: null, categoryId: null }).execute();
      await tx.deleteFrom('commissionRules').where('vendorId', 'is', null).where('categoryId', 'is not', null).execute();
      if (input.categoryOverrides.length) {
        const ids = [...new Set(input.categoryOverrides.map((o) => o.categoryId))];
        if (ids.length !== input.categoryOverrides.length) throw unprocessable('DUPLICATE_CATEGORY', 'Each category can have only one override.');
        const valid = await tx.selectFrom('categories').select('id').where('id', 'in', ids).execute();
        if (valid.length !== ids.length) throw unprocessable('INVALID_CATEGORY', 'Unknown category in overrides.');
        await tx
          .insertInto('commissionRules')
          .values(input.categoryOverrides.map((o) => ({ categoryId: o.categoryId, vendorId: null, bps: o.bps })))
          .execute();
      }
      await this.audit.record(
        actor,
        {
          action: 'settings.commission_updated',
          entityType: 'settings',
          entityId: 'commission',
          metadata: { before: { defaultBps: before.defaultBps, categories: before.categories.filter((c) => c.bps != null) }, after: input },
        },
        tx,
      );
    });
    return this.commission();
  }

  // ───────────── Audit ─────────────

  async auditLogs(q: { entityType?: string; entityId?: string; page: number; pageSize: number }) {
    let base = this.db.selectFrom('auditLogs');
    if (q.entityType) base = base.where('auditLogs.entityType', '=', q.entityType);
    if (q.entityId) base = base.where('auditLogs.entityId', '=', q.entityId);
    const [rows, total] = await Promise.all([
      base
        .leftJoin('users', 'users.id', 'auditLogs.actorId')
        .select([
          'auditLogs.id',
          'auditLogs.action',
          'auditLogs.entityType',
          'auditLogs.entityId',
          'auditLogs.metadata',
          'auditLogs.actorRole',
          'users.name as actorName',
          'auditLogs.ip',
          'auditLogs.createdAt',
        ])
        .orderBy('auditLogs.createdAt', 'desc')
        .orderBy('auditLogs.id', 'desc')
        .offset((q.page - 1) * q.pageSize)
        .fetch(q.pageSize)
        .execute(),
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return new Page(rows, q.page, q.pageSize, total.n);
  }
}

/** RFC 4180 CSV with spreadsheet formula-injection protection. */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; header: string; format?: (v: unknown, row: Record<string, unknown>) => string }[]) {
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.format ? c.format(r[c.key], r) : r[c.key])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export const ORDER_CSV_COLUMNS = [
  { key: 'orderNumber', header: 'Order number' },
  { key: 'isDemo', header: 'Demo', format: (v: unknown) => (v ? 'DEMO' : '') },
  { key: 'status', header: 'Status', format: (v: unknown) => label(String(v)) },
  { key: 'eventDate', header: 'Event date' },
  { key: 'occasion', header: 'Occasion' },
  { key: 'area', header: 'Area' },
  { key: 'guestCount', header: 'Guests' },
  { key: 'eventReference', header: 'Request ref' },
  { key: 'customer', header: 'Customer', format: (v: unknown) => (v as { name: string }).name },
  { key: 'customerPhone', header: 'Customer phone' },
  { key: 'customerEmail', header: 'Customer email' },
  { key: 'vendor', header: 'Vendor', format: (v: unknown) => (v as { businessName: string }).businessName },
  { key: 'vendorPhone', header: 'Vendor phone' },
  { key: 'totalPaise', header: 'Total (INR)', format: (v: unknown) => (Number(v) / 100).toFixed(2) },
  { key: 'advancePaise', header: 'Advance due (INR)', format: (v: unknown) => (Number(v) / 100).toFixed(2) },
  { key: 'paidPaise', header: 'Paid (INR)', format: (v: unknown) => (Number(v) / 100).toFixed(2) },
  { key: 'commissionPaise', header: 'Commission (INR)', format: (v: unknown) => (Number(v) / 100).toFixed(2) },
  { key: 'vendorPayablePaise', header: 'Vendor payable (INR)', format: (v: unknown) => (Number(v) / 100).toFixed(2) },
  { key: 'createdAt', header: 'Created at', format: (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)) },
];

export { formatINR };
