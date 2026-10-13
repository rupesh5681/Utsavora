import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { canTransition, LISTING_TRANSITIONS, VENDOR_TRANSITIONS, ACTIVE_ORDER_STATUSES, formatINR, label } from '@utsavora/types';
import type { CommissionSettingsInput, ModerationDecisionInput } from '@utsavora/validation';
import { DB } from '../config';
import type { Db } from '../db/client';
import {
  auditLogs,
  categories,
  commissionRules,
  eventRequests,
  listings,
  moderationActions,
  orders,
  quotes,
  users,
  vendorMembers,
  vendors,
  vendorVerificationReviews,
} from '../db/schema';
import { conflict, notFound, unprocessable } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { Page } from '../common/page';
import { todayIST, addDays } from '../common/time';
import { vendorChecklist } from '../vendor/vendor.service';
import type { Actor } from '../auth/actor';

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async dashboard() {
    const today = todayIST();
    const count = (table: typeof vendors | typeof listings | typeof eventRequests, where?: SQL) =>
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(where)
        .then((r) => r[0].n);
    const [vendorsPending, listingsPending, openRequests, vendorsApproved, ordersByStatus, [money], [upcoming], [unquoted]] = await Promise.all([
      count(vendors, eq(vendors.status, 'PENDING_REVIEW')),
      count(listings, eq(listings.status, 'PENDING_REVIEW')),
      count(eventRequests, eq(eventRequests.status, 'OPEN')),
      count(vendors, eq(vendors.status, 'APPROVED')),
      this.db.select({ status: orders.status, n: sql<number>`count(*)::int` }).from(orders).groupBy(orders.status),
      this.db
        .select({
          bookedPaise: sql<number>`coalesce(sum(${orders.totalPaise}) filter (where ${orders.status} in ('CONFIRMED','IN_PROGRESS','COMPLETED') and not ${orders.isDemo}), 0)::bigint`,
          commissionPaise: sql<number>`coalesce(sum(${orders.commissionPaise}) filter (where ${orders.status} in ('CONFIRMED','IN_PROGRESS','COMPLETED') and not ${orders.isDemo}), 0)::bigint`,
          collectedPaise: sql<number>`coalesce(sum(${orders.paidPaise}) filter (where not ${orders.isDemo}), 0)::bigint`,
        })
        .from(orders),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(inArray(orders.status, ACTIVE_ORDER_STATUSES), gte(orders.eventDate, today), sql`${orders.eventDate} <= ${addDays(today, 7)}`)),
      this.db.select({ n: sql<number>`count(*)::int` }).from(eventRequests).where(
        and(
          eq(eventRequests.status, 'OPEN'),
          sql`not exists (select 1 from ${quotes} q where q.event_request_id = ${eventRequests.id} and q.status in ('QUOTED','REVISED'))`,
          sql`${eventRequests.createdAt} < now() - interval '24 hours'`,
        ),
      ),
    ]);
    return {
      vendorsPending,
      vendorsApproved,
      listingsPending,
      openRequests,
      requestsWithoutQuotes24h: unquoted.n,
      upcomingEvents7d: upcoming.n,
      ordersByStatus: Object.fromEntries(ordersByStatus.map((r) => [r.status, r.n])),
      bookedPaise: Number(money.bookedPaise),
      commissionPaise: Number(money.commissionPaise),
      collectedPaise: Number(money.collectedPaise),
      note: 'Money totals exclude demo orders.',
    };
  }

  // ───────────── Vendors ─────────────

  async vendors(status: string | undefined, page: number, pageSize: number) {
    const where = status ? eq(vendors.status, status as 'APPROVED') : undefined;
    const rows = await this.db
      .select({
        id: vendors.id,
        businessName: vendors.businessName,
        slug: vendors.slug,
        status: vendors.status,
        city: vendors.city,
        phone: vendors.phone,
        isDemo: vendors.isDemo,
        submittedAt: vendors.submittedAt,
        createdAt: vendors.createdAt,
      })
      .from(vendors)
      .where(where)
      .orderBy(sql`${vendors.submittedAt} DESC NULLS LAST`, desc(vendors.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(vendors).where(where);
    return new Page(rows, page, pageSize, total);
  }

  async vendor(id: string) {
    const v = await this.db.query.vendors.findFirst({
      where: eq(vendors.id, id),
      with: {
        categories: { with: { category: true } },
        serviceAreas: { with: { serviceArea: true } },
        members: { with: { user: { columns: { id: true, name: true, email: true, phone: true } } } },
        reviews: { with: { reviewer: { columns: { name: true } } }, orderBy: [desc(vendorVerificationReviews.createdAt)] },
        listings: { columns: { id: true, title: true, status: true, type: true } },
      },
    });
    if (!v) throw notFound('Vendor');
    return {
      ...v,
      categories: v.categories.map((c) => c.category),
      serviceAreas: v.serviceAreas.map((a) => a.serviceArea),
      members: v.members.map((m) => ({ role: m.role, ...m.user })),
      reviews: v.reviews.map((r) => ({ id: r.id, decision: r.decision, fromStatus: r.fromStatus, toStatus: r.toStatus, notes: r.notes, reviewer: r.reviewer.name, createdAt: r.createdAt })),
      checklist: await vendorChecklist(this.db, v.id),
    };
  }

  async decideVendor(actor: Actor, id: string, input: ModerationDecisionInput) {
    await this.db.transaction(async (tx) => {
      const [v] = await tx.select().from(vendors).where(eq(vendors.id, id)).for('update');
      if (!v) throw notFound('Vendor');
      const t = canTransition(VENDOR_TRANSITIONS, input.decision, v.status, 'ADMIN');
      if (!t.ok) throw conflict('INVALID_TRANSITION', t.reason);
      if (input.decision !== 'approve' && !input.notes) throw unprocessable('NOTES_REQUIRED', 'Explain the decision so the vendor knows what to fix.');
      if (input.decision === 'approve') {
        const missing = (await vendorChecklist(tx, id)).filter((c) => !c.done);
        if (missing.length) throw unprocessable('ONBOARDING_INCOMPLETE', 'This vendor has not completed onboarding.', missing);
      }
      await tx
        .update(vendors)
        .set({ status: t.to, approvedAt: t.to === 'APPROVED' ? new Date() : v.approvedAt })
        .where(eq(vendors.id, id));
      await tx.insert(vendorVerificationReviews).values({ vendorId: id, reviewerId: actor.userId, decision: input.decision, fromStatus: v.status, toStatus: t.to, notes: input.notes });
      await this.audit.record(actor, { action: `vendor.${input.decision}`, entityType: 'vendor', entityId: id, metadata: { from: v.status, to: t.to, notes: input.notes } }, tx);
    });
    return this.vendor(id);
  }

  // ───────────── Listings ─────────────

  async listings(status: string | undefined, page: number, pageSize: number) {
    const where = status ? eq(listings.status, status as 'APPROVED') : undefined;
    const rows = await this.db
      .select({
        id: listings.id,
        title: listings.title,
        description: listings.description,
        type: listings.type,
        pricingMode: listings.pricingMode,
        pricePaise: listings.pricePaise,
        minGuests: listings.minGuests,
        maxGuests: listings.maxGuests,
        foodPreference: listings.foodPreference,
        inclusions: listings.inclusions,
        status: listings.status,
        isDemo: listings.isDemo,
        submittedAt: listings.submittedAt,
        updatedAt: listings.updatedAt,
        vendor: { id: vendors.id, businessName: vendors.businessName, status: vendors.status },
        category: { id: categories.id, name: categories.name },
      })
      .from(listings)
      .innerJoin(vendors, eq(vendors.id, listings.vendorId))
      .innerJoin(categories, eq(categories.id, listings.categoryId))
      .where(where)
      .orderBy(sql`${listings.submittedAt} ASC NULLS LAST`, desc(listings.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(listings).where(where);
    return new Page(rows, page, pageSize, total);
  }

  async decideListing(actor: Actor, id: string, input: ModerationDecisionInput) {
    await this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(listings).where(eq(listings.id, id)).for('update');
      if (!l) throw notFound('Listing');
      const t = canTransition(LISTING_TRANSITIONS, input.decision, l.status, 'ADMIN');
      if (!t.ok) throw conflict('INVALID_TRANSITION', t.reason);
      if (input.decision !== 'approve' && !input.notes) throw unprocessable('NOTES_REQUIRED', 'Explain the decision so the vendor knows what to fix.');
      await tx
        .update(listings)
        .set({ status: t.to, approvedAt: t.to === 'APPROVED' ? new Date() : l.approvedAt })
        .where(eq(listings.id, id));
      await tx.insert(moderationActions).values({ listingId: id, moderatorId: actor.userId, decision: input.decision, fromStatus: l.status, toStatus: t.to, notes: input.notes });
      await this.audit.record(actor, { action: `listing.${input.decision}`, entityType: 'listing', entityId: id, metadata: { from: l.status, to: t.to, notes: input.notes } }, tx);
    });
    const [row] = await this.db.select().from(listings).where(eq(listings.id, id));
    return row;
  }

  // ───────────── Commission ─────────────

  async commission() {
    const rules = await this.db
      .select({ id: commissionRules.id, vendorId: commissionRules.vendorId, categoryId: commissionRules.categoryId, bps: commissionRules.bps, updatedAt: commissionRules.updatedAt })
      .from(commissionRules);
    const cats = await this.db.select({ id: categories.id, name: categories.name, slug: categories.slug }).from(categories).orderBy(asc(categories.sortOrder));
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
    await this.db.transaction(async (tx) => {
      const def = await tx.select().from(commissionRules).where(and(isNull(commissionRules.vendorId), isNull(commissionRules.categoryId))).for('update');
      if (def[0]) await tx.update(commissionRules).set({ bps: input.defaultBps }).where(eq(commissionRules.id, def[0].id));
      else await tx.insert(commissionRules).values({ bps: input.defaultBps });
      await tx.delete(commissionRules).where(and(isNull(commissionRules.vendorId), sql`${commissionRules.categoryId} is not null`));
      if (input.categoryOverrides.length) {
        const ids = [...new Set(input.categoryOverrides.map((o) => o.categoryId))];
        const valid = await tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, ids));
        if (valid.length !== ids.length) throw unprocessable('INVALID_CATEGORY', 'Unknown category in overrides.');
        await tx.insert(commissionRules).values(input.categoryOverrides.map((o) => ({ categoryId: o.categoryId, bps: o.bps })));
      }
      await this.audit.record(
        actor,
        { action: 'settings.commission_updated', entityType: 'settings', entityId: 'commission', metadata: { before: { defaultBps: before.defaultBps, categories: before.categories.filter((c) => c.bps != null) }, after: input } },
        tx,
      );
    });
    return this.commission();
  }

  // ───────────── Audit ─────────────

  async auditLogs(q: { entityType?: string; entityId?: string; page: number; pageSize: number }) {
    const conds: SQL[] = [];
    if (q.entityType) conds.push(eq(auditLogs.entityType, q.entityType));
    if (q.entityId) conds.push(eq(auditLogs.entityId, q.entityId));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await this.db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        metadata: auditLogs.metadata,
        actorRole: auditLogs.actorRole,
        actorName: users.name,
        ip: auditLogs.ip,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where);
    return new Page(rows, q.page, q.pageSize, total);
  }

  async vendorUsers(vendorId: string) {
    return this.db.select({ userId: vendorMembers.userId }).from(vendorMembers).where(eq(vendorMembers.vendorId, vendorId));
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
