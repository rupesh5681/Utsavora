import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, exists, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { estimateBudget } from '@utsavora/types';
import type { BudgetEstimateInput, ListingSearchInput } from '@utsavora/validation';
import { DB } from '../config';
import type { Db } from '../db/client';
import {
  budgetRates,
  categories,
  listingOccasions,
  listings,
  occasions,
  serviceAreas,
  vendorCategories,
  vendorServiceAreas,
  vendors,
} from '../db/schema';
import { notFound } from '../common/errors';
import { Page } from '../common/page';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const publicListingColumns = {
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
  isDemo: listings.isDemo,
  createdAt: listings.createdAt,
  vendor: { id: vendors.id, slug: vendors.slug, businessName: vendors.businessName, isDemo: vendors.isDemo },
  category: { id: categories.id, slug: categories.slug, name: categories.name },
};

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  occasions() {
    return this.db.select().from(occasions).orderBy(asc(occasions.sortOrder));
  }

  categories() {
    return this.db.select().from(categories).orderBy(asc(categories.sortOrder));
  }

  serviceAreas() {
    return this.db.select().from(serviceAreas).where(eq(serviceAreas.isActive, true)).orderBy(asc(serviceAreas.city), asc(serviceAreas.name));
  }

  /** Only approved listings of approved vendors are ever public. */
  private publicFilter(): SQL {
    return and(eq(listings.status, 'APPROVED'), eq(vendors.status, 'APPROVED'))!;
  }

  async searchListings(q: ListingSearchInput) {
    const conds: SQL[] = [this.publicFilter()];
    if (q.q) {
      const term = `%${escapeLike(q.q)}%`;
      conds.push(or(ilike(listings.title, term), ilike(listings.description, term), ilike(vendors.businessName, term))!);
    }
    if (q.category) conds.push(eq(categories.slug, q.category));
    if (q.occasion) {
      conds.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(listingOccasions)
            .innerJoin(occasions, eq(occasions.id, listingOccasions.occasionId))
            .where(and(eq(listingOccasions.listingId, listings.id), eq(occasions.slug, q.occasion))),
        ),
      );
    }
    if (q.area) {
      conds.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(vendorServiceAreas)
            .innerJoin(serviceAreas, eq(serviceAreas.id, vendorServiceAreas.serviceAreaId))
            .where(and(eq(vendorServiceAreas.vendorId, vendors.id), eq(serviceAreas.slug, q.area))),
        ),
      );
    }
    if (q.food) conds.push(or(eq(listings.foodPreference, q.food), eq(listings.foodPreference, 'NOT_APPLICABLE'))!);
    if (q.maxPricePaise != null) conds.push(or(isNull(listings.pricePaise), lte(listings.pricePaise, q.maxPricePaise))!);

    const where = and(...conds);
    const order =
      q.sort === 'price_asc'
        ? [sql`${listings.pricePaise} ASC NULLS LAST`]
        : q.sort === 'price_desc'
          ? [sql`${listings.pricePaise} DESC NULLS LAST`]
          : q.sort === 'newest'
            ? [desc(listings.approvedAt)]
            : [asc(categories.sortOrder), desc(listings.approvedAt)];

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select(publicListingColumns)
        .from(listings)
        .innerJoin(vendors, eq(vendors.id, listings.vendorId))
        .innerJoin(categories, eq(categories.id, listings.categoryId))
        .where(where)
        .orderBy(...order, asc(listings.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(listings)
        .innerJoin(vendors, eq(vendors.id, listings.vendorId))
        .innerJoin(categories, eq(categories.id, listings.categoryId))
        .where(where),
    ]);
    return new Page(items, q.page, q.pageSize, total);
  }

  async listing(id: string) {
    const [row] = await this.db
      .select(publicListingColumns)
      .from(listings)
      .innerJoin(vendors, eq(vendors.id, listings.vendorId))
      .innerJoin(categories, eq(categories.id, listings.categoryId))
      .where(and(eq(listings.id, id), this.publicFilter()));
    if (!row) throw notFound('Listing');
    const [occ, areas] = await Promise.all([
      this.db
        .select({ id: occasions.id, slug: occasions.slug, name: occasions.name })
        .from(listingOccasions)
        .innerJoin(occasions, eq(occasions.id, listingOccasions.occasionId))
        .where(eq(listingOccasions.listingId, id)),
      this.vendorAreas(row.vendor.id),
    ]);
    return { ...row, occasions: occ, serviceAreas: areas };
  }

  private vendorAreas(vendorId: string) {
    return this.db
      .select({ id: serviceAreas.id, slug: serviceAreas.slug, name: serviceAreas.name, city: serviceAreas.city })
      .from(vendorServiceAreas)
      .innerJoin(serviceAreas, eq(serviceAreas.id, vendorServiceAreas.serviceAreaId))
      .where(eq(vendorServiceAreas.vendorId, vendorId))
      .orderBy(asc(serviceAreas.name));
  }

  async vendorProfile(slug: string) {
    const v = await this.db.query.vendors.findFirst({ where: and(eq(vendors.slug, slug), eq(vendors.status, 'APPROVED')) });
    if (!v) throw notFound('Vendor');
    const [areas, cats, items] = await Promise.all([
      this.vendorAreas(v.id),
      this.db
        .select({ id: categories.id, slug: categories.slug, name: categories.name })
        .from(vendorCategories)
        .innerJoin(categories, eq(categories.id, vendorCategories.categoryId))
        .where(eq(vendorCategories.vendorId, v.id)),
      this.db
        .select(publicListingColumns)
        .from(listings)
        .innerJoin(vendors, eq(vendors.id, listings.vendorId))
        .innerJoin(categories, eq(categories.id, listings.categoryId))
        .where(and(eq(listings.vendorId, v.id), this.publicFilter()))
        .orderBy(asc(categories.sortOrder)),
    ]);
    return {
      id: v.id,
      slug: v.slug,
      businessName: v.businessName,
      description: v.description,
      city: v.city,
      isDemo: v.isDemo,
      fssaiVerified: Boolean(v.fssaiNumber),
      gstRegistered: Boolean(v.gstin),
      memberSince: v.approvedAt,
      serviceAreas: areas,
      categories: cats,
      listings: items,
    };
  }

  async estimate(input: BudgetEstimateInput) {
    const rows = await this.db
      .select({
        categorySlug: categories.slug,
        categoryName: categories.name,
        unit: budgetRates.unit,
        lowPaise: budgetRates.lowPaise,
        highPaise: budgetRates.highPaise,
        foodPreference: budgetRates.foodPreference,
      })
      .from(budgetRates)
      .innerJoin(categories, eq(categories.id, budgetRates.categoryId))
      .where(inArray(categories.slug, input.categorySlugs));
    return estimateBudget(rows, {
      guestCount: input.guestCount,
      categorySlugs: input.categorySlugs,
      foodPreference: input.foodPreference,
      budgetPaise: input.budgetPaise ?? null,
    });
  }
}
