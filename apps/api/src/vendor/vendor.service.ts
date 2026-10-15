import { Inject, Injectable } from '@nestjs/common';
import { canTransition, LISTING_TRANSITIONS, VENDOR_TRANSITIONS, ACTIVE_ORDER_STATUSES } from '@utsavora/types';
import type { ListingInput, VendorProfileInput } from '@utsavora/validation';
import { DB } from '../config';
import { json, lockRow, now, sql, type Db, type DbOrTx, type Tx } from '../db/client';
import type { Listing } from '../db/types';
import { conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { AuditService } from '../common/audit.service';
import type { Actor } from '../auth/actor';
import { todayIST } from '../common/time';

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

/** Onboarding checks evaluated on the server; admins cannot approve a vendor that fails them. */
export async function vendorChecklist(db: DbOrTx, vendorId: string): Promise<ChecklistItem[]> {
  const v = await db.selectFrom('vendors').selectAll().where('id', '=', vendorId).executeTakeFirst();
  if (!v) throw notFound('Vendor');
  const cats = await db
    .selectFrom('vendorCategories')
    .innerJoin('categories', 'categories.id', 'vendorCategories.categoryId')
    .select('categories.requiresFssai')
    .where('vendorCategories.vendorId', '=', vendorId)
    .execute();
  const { areas } = await db
    .selectFrom('vendorServiceAreas')
    .select((eb) => eb.fn.countAll<number>().as('areas'))
    .where('vendorId', '=', vendorId)
    .executeTakeFirstOrThrow();
  const needsFssai = cats.some((c) => c.requiresFssai);
  const items: ChecklistItem[] = [
    { key: 'business', label: 'Business name and phone', done: v.businessName.trim().length > 1 && /^[6-9]\d{9}$/.test(v.phone) },
    { key: 'description', label: 'Description of at least 50 characters', done: v.description.trim().length >= 50 },
    { key: 'categories', label: 'At least one service category', done: cats.length > 0 },
    { key: 'areas', label: 'At least one service area', done: areas > 0 },
  ];
  if (needsFssai) items.push({ key: 'fssai', label: 'FSSAI licence number (required for food categories)', done: Boolean(v.fssaiNumber) });
  return items;
}

type ListingRow = Listing & {
  categoryName: string;
  categorySlug: string;
};

@Injectable()
export class VendorService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private requireVendor(actor: Actor): string {
    if (!actor.vendorId) throw forbidden('No vendor business is linked to this account.');
    return actor.vendorId;
  }

  async profile(actor: Actor) {
    const vendorId = this.requireVendor(actor);
    const v = await this.db.selectFrom('vendors').selectAll().where('id', '=', vendorId).executeTakeFirst();
    if (!v) throw notFound('Vendor');
    const [cats, areas, review, checklist] = await Promise.all([
      this.db.selectFrom('vendorCategories').select('categoryId').where('vendorId', '=', vendorId).execute(),
      this.db.selectFrom('vendorServiceAreas').select('serviceAreaId').where('vendorId', '=', vendorId).execute(),
      this.db
        .selectFrom('vendorVerificationReviews')
        .select(['decision', 'notes', 'createdAt'])
        .where('vendorId', '=', vendorId)
        .orderBy('createdAt', 'desc')
        .top(1)
        .executeTakeFirst(),
      vendorChecklist(this.db, vendorId),
    ]);
    return {
      id: v.id,
      slug: v.slug,
      businessName: v.businessName,
      description: v.description,
      phone: v.phone,
      city: v.city,
      addressLine: v.addressLine,
      gstin: v.gstin,
      fssaiNumber: v.fssaiNumber,
      maxEventsPerDay: v.maxEventsPerDay,
      status: v.status,
      isDemo: v.isDemo,
      submittedAt: v.submittedAt,
      approvedAt: v.approvedAt,
      categoryIds: cats.map((c) => c.categoryId),
      serviceAreaIds: areas.map((a) => a.serviceAreaId),
      latestReview: review ?? null,
      checklist,
    };
  }

  async updateProfile(actor: Actor, input: VendorProfileInput) {
    const vendorId = this.requireVendor(actor);
    const categoryIds = [...new Set(input.categoryIds)];
    const serviceAreaIds = [...new Set(input.serviceAreaIds)];
    await this.db.transaction().execute(async (tx) => {
      const v = await lockRow(tx, 'vendors', vendorId);
      if (!v) throw notFound('Vendor');
      if (v.status === 'SUSPENDED') throw forbidden('Your account is suspended. Contact Utsavora support.');
      const validCats = await tx.selectFrom('categories').select('id').where('id', 'in', categoryIds).execute();
      const validAreas = await tx.selectFrom('serviceAreas').select('id').where('id', 'in', serviceAreaIds).execute();
      if (validCats.length !== categoryIds.length) throw unprocessable('INVALID_CATEGORY', 'One or more categories are invalid.');
      if (validAreas.length !== serviceAreaIds.length) throw unprocessable('INVALID_AREA', 'One or more service areas are invalid.');
      // Categories with listings can't be removed until the listings are moved or removed.
      const inUse = await tx.selectFrom('listings').select('categoryId').distinct().where('vendorId', '=', vendorId).execute();
      if (inUse.some((c) => !categoryIds.includes(c.categoryId))) {
        throw conflict('CATEGORY_IN_USE', 'You have listings in a category you are removing. Delete or move those listings first.');
      }
      await tx
        .updateTable('vendors')
        .set({
          businessName: input.businessName,
          description: input.description,
          phone: input.phone,
          city: input.city,
          addressLine: input.addressLine,
          gstin: input.gstin ?? null,
          fssaiNumber: input.fssaiNumber ?? null,
          maxEventsPerDay: input.maxEventsPerDay,
          updatedAt: now(),
        })
        .where('id', '=', vendorId)
        .execute();
      await tx.deleteFrom('vendorCategories').where('vendorId', '=', vendorId).execute();
      await tx.insertInto('vendorCategories').values(categoryIds.map((categoryId) => ({ vendorId, categoryId }))).execute();
      await tx.deleteFrom('vendorServiceAreas').where('vendorId', '=', vendorId).execute();
      await tx.insertInto('vendorServiceAreas').values(serviceAreaIds.map((serviceAreaId) => ({ vendorId, serviceAreaId }))).execute();
      const regulatoryChanged = (v.fssaiNumber ?? null) !== (input.fssaiNumber ?? null) || (v.gstin ?? null) !== (input.gstin ?? null);
      await this.audit.record(actor, { action: 'vendor.profile_updated', entityType: 'vendor', entityId: vendorId, metadata: { regulatoryChanged } }, tx);
    });
    return this.profile(actor);
  }

  async submitForReview(actor: Actor) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction().execute(async (tx) => {
      const v = await lockRow(tx, 'vendors', vendorId);
      if (!v) throw notFound('Vendor');
      const t = canTransition(VENDOR_TRANSITIONS, 'submit', v.status, 'VENDOR');
      if (!t.ok) throw conflict('INVALID_TRANSITION', t.reason);
      const missing = (await vendorChecklist(tx, vendorId)).filter((c) => !c.done);
      if (missing.length) throw unprocessable('ONBOARDING_INCOMPLETE', 'Complete your profile before submitting.', missing);
      await tx.updateTable('vendors').set({ status: t.to, submittedAt: now(), updatedAt: now() }).where('id', '=', vendorId).execute();
      await this.audit.record(actor, { action: 'vendor.submitted', entityType: 'vendor', entityId: vendorId }, tx);
    });
    return this.profile(actor);
  }

  // ───────────── Listings (menus, packages, services) ─────────────

  private listingQuery(db: DbOrTx) {
    return db
      .selectFrom('listings')
      .innerJoin('categories', 'categories.id', 'listings.categoryId')
      .selectAll('listings')
      .select(['categories.name as categoryName', 'categories.slug as categorySlug']);
  }

  private async decorate(rows: ListingRow[]) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [occ, mods] = await Promise.all([
      this.db.selectFrom('listingOccasions').select(['listingId', 'occasionId']).where('listingId', 'in', ids).execute(),
      this.db
        .selectFrom('moderationActions')
        .select(['listingId', 'decision', 'notes', 'createdAt'])
        .where('listingId', 'in', ids)
        .orderBy('createdAt', 'desc')
        .execute(),
    ]);
    return rows.map((l) => {
      const last = mods.find((m) => m.listingId === l.id);
      return {
        id: l.id,
        categoryId: l.categoryId,
        category: { id: l.categoryId, name: l.categoryName, slug: l.categorySlug },
        title: l.title,
        description: l.description,
        type: l.type,
        pricingMode: l.pricingMode,
        pricePaise: l.pricePaise,
        minGuests: l.minGuests,
        maxGuests: l.maxGuests,
        foodPreference: l.foodPreference,
        inclusions: l.inclusions,
        occasionIds: occ.filter((o) => o.listingId === l.id).map((o) => o.occasionId),
        status: l.status,
        isDemo: l.isDemo,
        updatedAt: l.updatedAt,
        lastModeration: last ? { decision: last.decision, notes: last.notes, createdAt: last.createdAt } : null,
      };
    });
  }

  async listListings(actor: Actor) {
    const vendorId = this.requireVendor(actor);
    const rows = await this.listingQuery(this.db).where('listings.vendorId', '=', vendorId).orderBy('listings.updatedAt', 'desc').execute();
    return this.decorate(rows);
  }

  private async loadListing(id: string) {
    const row = await this.listingQuery(this.db).where('listings.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Listing');
    return (await this.decorate([row]))[0];
  }

  private async validateListingRefs(tx: Tx, vendorId: string, input: ListingInput) {
    const offered = await tx
      .selectFrom('vendorCategories')
      .select('categoryId')
      .where('vendorId', '=', vendorId)
      .where('categoryId', '=', input.categoryId)
      .executeTakeFirst();
    if (!offered) throw unprocessable('CATEGORY_NOT_OFFERED', 'Add this category to your profile before listing in it.');
    const occasionIds = [...new Set(input.occasionIds)];
    if (occasionIds.length) {
      const occ = await tx.selectFrom('occasions').select('id').where('id', 'in', occasionIds).execute();
      if (occ.length !== occasionIds.length) throw unprocessable('INVALID_OCCASION', 'One or more occasions are invalid.');
    }
    return occasionIds;
  }

  private listingValues(input: ListingInput) {
    return {
      categoryId: input.categoryId,
      title: input.title,
      description: input.description,
      type: input.type,
      pricingMode: input.pricingMode,
      pricePaise: input.pricingMode === 'ON_QUOTE' ? null : (input.pricePaise ?? null),
      minGuests: input.minGuests ?? null,
      maxGuests: input.maxGuests ?? null,
      foodPreference: input.foodPreference,
      inclusions: json(input.inclusions),
    };
  }

  async createListing(actor: Actor, input: ListingInput) {
    const vendorId = this.requireVendor(actor);
    const id = await this.db.transaction().execute(async (tx) => {
      const v = await tx.selectFrom('vendors').select('status').where('id', '=', vendorId).executeTakeFirstOrThrow();
      if (v.status === 'SUSPENDED') throw forbidden('Your account is suspended.');
      const occasionIds = await this.validateListingRefs(tx, vendorId, input);
      const l = await tx
        .insertInto('listings')
        .output('inserted.id')
        .values({ vendorId, ...this.listingValues(input), submittedAt: null, approvedAt: null })
        .executeTakeFirstOrThrow();
      if (occasionIds.length) await tx.insertInto('listingOccasions').values(occasionIds.map((occasionId) => ({ listingId: l.id, occasionId }))).execute();
      await this.audit.record(actor, { action: 'listing.created', entityType: 'listing', entityId: l.id }, tx);
      return l.id;
    });
    return this.loadListing(id);
  }

  /** Editing an approved listing takes it offline for re-approval, so customers never see unreviewed content. */
  async updateListing(actor: Actor, id: string, input: ListingInput) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction().execute(async (tx) => {
      const l = await lockRow(tx, 'listings', id);
      if (!l || l.vendorId !== vendorId) throw notFound('Listing');
      if (l.status === 'SUSPENDED') throw forbidden('This listing was suspended by Utsavora and cannot be edited.');
      const occasionIds = await this.validateListingRefs(tx, vendorId, input);
      const status = l.status === 'APPROVED' ? 'PENDING_REVIEW' : l.status;
      await tx
        .updateTable('listings')
        .set({ ...this.listingValues(input), status, submittedAt: status === 'PENDING_REVIEW' ? now() : l.submittedAt, updatedAt: now() })
        .where('id', '=', id)
        .execute();
      await tx.deleteFrom('listingOccasions').where('listingId', '=', id).execute();
      if (occasionIds.length) await tx.insertInto('listingOccasions').values(occasionIds.map((occasionId) => ({ listingId: id, occasionId }))).execute();
      await this.audit.record(actor, { action: 'listing.updated', entityType: 'listing', entityId: id, metadata: { from: l.status, to: status } }, tx);
    });
    return this.loadListing(id);
  }

  async submitListing(actor: Actor, id: string) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction().execute(async (tx) => {
      const l = await lockRow(tx, 'listings', id);
      if (!l || l.vendorId !== vendorId) throw notFound('Listing');
      const t = canTransition(LISTING_TRANSITIONS, 'submit', l.status, 'VENDOR');
      if (!t.ok) throw conflict('INVALID_TRANSITION', t.reason);
      await tx.updateTable('listings').set({ status: t.to, submittedAt: now(), updatedAt: now() }).where('id', '=', id).execute();
      await this.audit.record(actor, { action: 'listing.submitted', entityType: 'listing', entityId: id }, tx);
    });
    return this.loadListing(id);
  }

  async deleteListing(actor: Actor, id: string) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction().execute(async (tx) => {
      const l = await lockRow(tx, 'listings', id);
      if (!l || l.vendorId !== vendorId) throw notFound('Listing');
      if (!['DRAFT', 'REJECTED'].includes(l.status)) throw conflict('LISTING_LOCKED', 'Only draft or rejected listings can be deleted.');
      await tx.deleteFrom('listings').where('id', '=', id).execute();
      await this.audit.record(actor, { action: 'listing.deleted', entityType: 'listing', entityId: id, metadata: { title: l.title } }, tx);
    });
    return { ok: true };
  }

  async dashboard(actor: Actor) {
    const vendorId = this.requireVendor(actor);
    const today = todayIST();
    const booked = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;
    const [quoteCounts, orderCounts, upcoming, money] = await Promise.all([
      this.db
        .selectFrom('quotes')
        .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
        .where('vendorId', '=', vendorId)
        .groupBy('status')
        .execute(),
      this.db
        .selectFrom('orders')
        .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
        .where('vendorId', '=', vendorId)
        .groupBy('status')
        .execute(),
      this.db
        .selectFrom('orders')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('vendorId', '=', vendorId)
        .where('status', 'in', ACTIVE_ORDER_STATUSES)
        .where('eventDate', '>=', today)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('orders')
        .select([
          sql<string>`SUM(CAST(CASE WHEN status IN (${sql.join([...booked])}) THEN total_paise ELSE 0 END AS BIGINT))`.as('bookedPaise'),
          sql<string>`SUM(CAST(CASE WHEN status IN (${sql.join([...booked])}) THEN vendor_payable_paise ELSE 0 END AS BIGINT))`.as('payablePaise'),
        ])
        .where('vendorId', '=', vendorId)
        .executeTakeFirstOrThrow(),
    ]);
    const qc = Object.fromEntries(quoteCounts.map((r) => [r.status, r.n]));
    const oc = Object.fromEntries(orderCounts.map((r) => [r.status, r.n]));
    return {
      newRequests: (qc.REQUESTED ?? 0) + (qc.VENDOR_REVIEWING ?? 0),
      awaitingCustomer: (qc.QUOTED ?? 0) + (qc.REVISED ?? 0),
      quotesWon: qc.ACCEPTED ?? 0,
      ordersToConfirm: oc.PENDING_CONFIRMATION ?? 0,
      upcomingEvents: upcoming.n,
      bookedPaise: Number(money.bookedPaise ?? 0),
      payablePaise: Number(money.payablePaise ?? 0),
      quoteCounts: qc,
      orderCounts: oc,
    };
  }
}
