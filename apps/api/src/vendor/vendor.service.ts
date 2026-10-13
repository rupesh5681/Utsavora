import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { canTransition, LISTING_TRANSITIONS, VENDOR_TRANSITIONS, ACTIVE_ORDER_STATUSES } from '@utsavora/types';
import type { ListingInput, VendorProfileInput } from '@utsavora/validation';
import { DB } from '../config';
import type { Db, DbOrTx } from '../db/client';
import {
  categories,
  listingOccasions,
  listings,
  occasions,
  orders,
  quotes,
  serviceAreas,
  vendorCategories,
  vendorServiceAreas,
  vendors,
  moderationActions,
  vendorVerificationReviews,
} from '../db/schema';
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
  const v = await db.query.vendors.findFirst({ where: eq(vendors.id, vendorId) });
  if (!v) throw notFound('Vendor');
  const cats = await db
    .select({ requiresFssai: categories.requiresFssai })
    .from(vendorCategories)
    .innerJoin(categories, eq(categories.id, vendorCategories.categoryId))
    .where(eq(vendorCategories.vendorId, vendorId));
  const [{ areas }] = await db.select({ areas: sql<number>`count(*)::int` }).from(vendorServiceAreas).where(eq(vendorServiceAreas.vendorId, vendorId));
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
    const v = await this.db.query.vendors.findFirst({
      where: eq(vendors.id, vendorId),
      with: { categories: true, serviceAreas: true, reviews: { orderBy: (r, { desc }) => [desc(r.createdAt)], limit: 5 } },
    });
    if (!v) throw notFound('Vendor');
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
      categoryIds: v.categories.map((c) => c.categoryId),
      serviceAreaIds: v.serviceAreas.map((a) => a.serviceAreaId),
      latestReview: v.reviews[0] ? { decision: v.reviews[0].decision, notes: v.reviews[0].notes, createdAt: v.reviews[0].createdAt } : null,
      checklist: await vendorChecklist(this.db, v.id),
    };
  }

  async updateProfile(actor: Actor, input: VendorProfileInput) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction(async (tx) => {
      const [v] = await tx.select().from(vendors).where(eq(vendors.id, vendorId)).for('update');
      if (v.status === 'SUSPENDED') throw forbidden('Your account is suspended. Contact Utsavora support.');
      const validCats = await tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, input.categoryIds));
      const validAreas = await tx.select({ id: serviceAreas.id }).from(serviceAreas).where(inArray(serviceAreas.id, input.serviceAreaIds));
      if (validCats.length !== new Set(input.categoryIds).size) throw unprocessable('INVALID_CATEGORY', 'One or more categories are invalid.');
      if (validAreas.length !== new Set(input.serviceAreaIds).size) throw unprocessable('INVALID_AREA', 'One or more service areas are invalid.');
      // Categories with live listings can't be removed until the listings are moved or removed.
      const inUse = await tx
        .selectDistinct({ categoryId: listings.categoryId })
        .from(listings)
        .where(eq(listings.vendorId, vendorId));
      const dropped = inUse.filter((c) => !input.categoryIds.includes(c.categoryId));
      if (dropped.length > 0) throw conflict('CATEGORY_IN_USE', 'You have listings in a category you are removing. Delete or move those listings first.');

      await tx
        .update(vendors)
        .set({
          businessName: input.businessName,
          description: input.description,
          phone: input.phone,
          city: input.city,
          addressLine: input.addressLine,
          gstin: input.gstin ?? null,
          fssaiNumber: input.fssaiNumber ?? null,
          maxEventsPerDay: input.maxEventsPerDay,
        })
        .where(eq(vendors.id, vendorId));
      await tx.delete(vendorCategories).where(eq(vendorCategories.vendorId, vendorId));
      await tx.insert(vendorCategories).values([...new Set(input.categoryIds)].map((categoryId) => ({ vendorId, categoryId })));
      await tx.delete(vendorServiceAreas).where(eq(vendorServiceAreas.vendorId, vendorId));
      await tx.insert(vendorServiceAreas).values([...new Set(input.serviceAreaIds)].map((serviceAreaId) => ({ vendorId, serviceAreaId })));
      const regulatoryChanged = (v.fssaiNumber ?? null) !== (input.fssaiNumber ?? null) || (v.gstin ?? null) !== (input.gstin ?? null);
      await this.audit.record(
        actor,
        { action: 'vendor.profile_updated', entityType: 'vendor', entityId: vendorId, metadata: { regulatoryChanged } },
        tx,
      );
    });
    return this.profile(actor);
  }

  async submitForReview(actor: Actor) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction(async (tx) => {
      const [v] = await tx.select().from(vendors).where(eq(vendors.id, vendorId)).for('update');
      const t = canTransition(VENDOR_TRANSITIONS, 'submit', v.status, 'VENDOR');
      if (!t.ok) throw conflict('INVALID_TRANSITION', t.reason);
      const checklist = await vendorChecklist(tx, vendorId);
      const missing = checklist.filter((c) => !c.done);
      if (missing.length) throw unprocessable('ONBOARDING_INCOMPLETE', 'Complete your profile before submitting.', missing);
      await tx.update(vendors).set({ status: t.to, submittedAt: new Date() }).where(eq(vendors.id, vendorId));
      await this.audit.record(actor, { action: 'vendor.submitted', entityType: 'vendor', entityId: vendorId }, tx);
    });
    return this.profile(actor);
  }

  // ───────────── Listings (menus, packages, services) ─────────────

  async listListings(actor: Actor) {
    const vendorId = this.requireVendor(actor);
    const rows = await this.db.query.listings.findMany({
      where: eq(listings.vendorId, vendorId),
      with: {
        category: true,
        occasions: true,
        moderations: { orderBy: (m, { desc }) => [desc(m.createdAt)], limit: 1 },
      },
      orderBy: [desc(listings.updatedAt)],
    });
    return rows.map((l) => this.toVendorListing(l));
  }

  private toVendorListing(l: Awaited<ReturnType<typeof this.loadListing>>) {
    return {
      id: l.id,
      categoryId: l.categoryId,
      category: { id: l.category.id, name: l.category.name, slug: l.category.slug },
      title: l.title,
      description: l.description,
      type: l.type,
      pricingMode: l.pricingMode,
      pricePaise: l.pricePaise,
      minGuests: l.minGuests,
      maxGuests: l.maxGuests,
      foodPreference: l.foodPreference,
      inclusions: l.inclusions,
      occasionIds: l.occasions.map((o) => o.occasionId),
      status: l.status,
      isDemo: l.isDemo,
      updatedAt: l.updatedAt,
      lastModeration: l.moderations[0] ? { decision: l.moderations[0].decision, notes: l.moderations[0].notes, createdAt: l.moderations[0].createdAt } : null,
    };
  }

  private async loadListing(id: string, db: DbOrTx = this.db) {
    const l = await db.query.listings.findFirst({
      where: eq(listings.id, id),
      with: { category: true, occasions: true, moderations: { orderBy: (m, { desc }) => [desc(m.createdAt)], limit: 1 } },
    });
    if (!l) throw notFound('Listing');
    return l;
  }

  private async validateListingRefs(tx: DbOrTx, vendorId: string, input: ListingInput) {
    const offered = await tx
      .select()
      .from(vendorCategories)
      .where(and(eq(vendorCategories.vendorId, vendorId), eq(vendorCategories.categoryId, input.categoryId)));
    if (offered.length === 0) throw unprocessable('CATEGORY_NOT_OFFERED', 'Add this category to your profile before listing in it.');
    if (input.occasionIds.length) {
      const occ = await tx.select({ id: occasions.id }).from(occasions).where(inArray(occasions.id, input.occasionIds));
      if (occ.length !== new Set(input.occasionIds).size) throw unprocessable('INVALID_OCCASION', 'One or more occasions are invalid.');
    }
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
      inclusions: input.inclusions,
    };
  }

  async createListing(actor: Actor, input: ListingInput) {
    const vendorId = this.requireVendor(actor);
    const id = await this.db.transaction(async (tx) => {
      const [v] = await tx.select().from(vendors).where(eq(vendors.id, vendorId));
      if (v.status === 'SUSPENDED') throw forbidden('Your account is suspended.');
      await this.validateListingRefs(tx, vendorId, input);
      const [l] = await tx.insert(listings).values({ vendorId, ...this.listingValues(input) }).returning();
      if (input.occasionIds.length) {
        await tx.insert(listingOccasions).values([...new Set(input.occasionIds)].map((occasionId) => ({ listingId: l.id, occasionId })));
      }
      await this.audit.record(actor, { action: 'listing.created', entityType: 'listing', entityId: l.id }, tx);
      return l.id;
    });
    return this.toVendorListing(await this.loadListing(id));
  }

  /** Editing an approved listing takes it offline for re-approval, so customers never see unreviewed content. */
  async updateListing(actor: Actor, id: string, input: ListingInput) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(listings).where(eq(listings.id, id)).for('update');
      if (!l || l.vendorId !== vendorId) throw notFound('Listing');
      if (l.status === 'SUSPENDED') throw forbidden('This listing was suspended by Utsavora and cannot be edited.');
      await this.validateListingRefs(tx, vendorId, input);
      const status = l.status === 'APPROVED' ? 'PENDING_REVIEW' : l.status;
      await tx
        .update(listings)
        .set({ ...this.listingValues(input), status, submittedAt: status === 'PENDING_REVIEW' ? new Date() : l.submittedAt })
        .where(eq(listings.id, id));
      await tx.delete(listingOccasions).where(eq(listingOccasions.listingId, id));
      if (input.occasionIds.length) {
        await tx.insert(listingOccasions).values([...new Set(input.occasionIds)].map((occasionId) => ({ listingId: id, occasionId })));
      }
      await this.audit.record(actor, { action: 'listing.updated', entityType: 'listing', entityId: id, metadata: { from: l.status, to: status } }, tx);
    });
    return this.toVendorListing(await this.loadListing(id));
  }

  async submitListing(actor: Actor, id: string) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(listings).where(eq(listings.id, id)).for('update');
      if (!l || l.vendorId !== vendorId) throw notFound('Listing');
      const t = canTransition(LISTING_TRANSITIONS, 'submit', l.status, 'VENDOR');
      if (!t.ok) throw conflict('INVALID_TRANSITION', t.reason);
      await tx.update(listings).set({ status: t.to, submittedAt: new Date() }).where(eq(listings.id, id));
      await this.audit.record(actor, { action: 'listing.submitted', entityType: 'listing', entityId: id }, tx);
    });
    return this.toVendorListing(await this.loadListing(id));
  }

  async deleteListing(actor: Actor, id: string) {
    const vendorId = this.requireVendor(actor);
    await this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(listings).where(eq(listings.id, id)).for('update');
      if (!l || l.vendorId !== vendorId) throw notFound('Listing');
      if (!['DRAFT', 'REJECTED'].includes(l.status)) throw conflict('LISTING_LOCKED', 'Only draft or rejected listings can be deleted.');
      await tx.delete(listings).where(eq(listings.id, id));
      await this.audit.record(actor, { action: 'listing.deleted', entityType: 'listing', entityId: id, metadata: { title: l.title } }, tx);
    });
    return { ok: true };
  }

  async dashboard(actor: Actor) {
    const vendorId = this.requireVendor(actor);
    const today = todayIST();
    const [quoteCounts, orderCounts, [upcoming], [money]] = await Promise.all([
      this.db
        .select({ status: quotes.status, n: sql<number>`count(*)::int` })
        .from(quotes)
        .where(eq(quotes.vendorId, vendorId))
        .groupBy(quotes.status),
      this.db
        .select({ status: orders.status, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(eq(orders.vendorId, vendorId))
        .groupBy(orders.status),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.vendorId, vendorId), inArray(orders.status, ACTIVE_ORDER_STATUSES), sql`${orders.eventDate} >= ${today}`)),
      this.db
        .select({
          bookedPaise: sql<number>`coalesce(sum(${orders.totalPaise}) filter (where ${orders.status} in ('CONFIRMED','IN_PROGRESS','COMPLETED')), 0)::int`,
          payablePaise: sql<number>`coalesce(sum(${orders.vendorPayablePaise}) filter (where ${orders.status} in ('CONFIRMED','IN_PROGRESS','COMPLETED')), 0)::int`,
        })
        .from(orders)
        .where(eq(orders.vendorId, vendorId)),
    ]);
    const qc = Object.fromEntries(quoteCounts.map((r) => [r.status, r.n]));
    const oc = Object.fromEntries(orderCounts.map((r) => [r.status, r.n]));
    return {
      newRequests: (qc.REQUESTED ?? 0) + (qc.VENDOR_REVIEWING ?? 0),
      awaitingCustomer: (qc.QUOTED ?? 0) + (qc.REVISED ?? 0),
      quotesWon: qc.ACCEPTED ?? 0,
      ordersToConfirm: oc.PENDING_CONFIRMATION ?? 0,
      upcomingEvents: upcoming.n,
      bookedPaise: money.bookedPaise,
      payablePaise: money.payablePaise,
      quoteCounts: qc,
      orderCounts: oc,
    };
  }

  async reviews(vendorId: string) {
    return this.db
      .select()
      .from(vendorVerificationReviews)
      .where(eq(vendorVerificationReviews.vendorId, vendorId))
      .orderBy(desc(vendorVerificationReviews.createdAt));
  }

  async listingModerations(listingId: string) {
    return this.db.select().from(moderationActions).where(eq(moderationActions.listingId, listingId)).orderBy(asc(moderationActions.createdAt));
  }
}
