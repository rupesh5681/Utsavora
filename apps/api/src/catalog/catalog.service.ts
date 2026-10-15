import { Inject, Injectable } from '@nestjs/common';
import type { SelectQueryBuilder } from 'kysely';
import { estimateBudget } from '@utsavora/types';
import type { BudgetEstimateInput, ListingSearchInput } from '@utsavora/validation';
import { DB } from '../config';
import { sql, type Db } from '../db/client';
import type { Database } from '../db/types';
import { notFound } from '../common/errors';
import { Page } from '../common/page';

/** Escapes LIKE wildcards for SQL Server (used with ESCAPE '\'). The default collation is case-insensitive. */
export const likeContains = (s: string) => `%${s.replace(/[\\%_[]/g, (c) => `\\${c}`)}%`;

type ListingJoin = 'listings' | 'vendors' | 'categories';

/** Columns every public listing card needs, flattened then reshaped by `toPublicListing`. */
export function publicListingSelect<O>(qb: SelectQueryBuilder<Database, ListingJoin, O>) {
  return qb.select([
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
    'listings.isDemo',
    'listings.createdAt',
    'vendors.id as vendorId',
    'vendors.slug as vendorSlug',
    'vendors.businessName as vendorName',
    'vendors.isDemo as vendorIsDemo',
    'categories.id as categoryId',
    'categories.slug as categorySlug',
    'categories.name as categoryName',
  ]);
}

export function toPublicListing(r: {
  id: string;
  title: string;
  description: string;
  type: string;
  pricingMode: string;
  pricePaise: number | null;
  minGuests: number | null;
  maxGuests: number | null;
  foodPreference: string;
  inclusions: string[];
  isDemo: boolean;
  createdAt: Date;
  vendorId: string;
  vendorSlug: string;
  vendorName: string;
  vendorIsDemo: boolean;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
}) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    type: r.type,
    pricingMode: r.pricingMode,
    pricePaise: r.pricePaise,
    minGuests: r.minGuests,
    maxGuests: r.maxGuests,
    foodPreference: r.foodPreference,
    inclusions: r.inclusions,
    isDemo: r.isDemo,
    createdAt: r.createdAt,
    vendor: { id: r.vendorId, slug: r.vendorSlug, businessName: r.vendorName, isDemo: r.vendorIsDemo },
    category: { id: r.categoryId, slug: r.categorySlug, name: r.categoryName },
  };
}

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  occasions() {
    return this.db.selectFrom('occasions').selectAll().orderBy('sortOrder').execute();
  }

  categories() {
    return this.db.selectFrom('categories').selectAll().orderBy('sortOrder').execute();
  }

  serviceAreas() {
    return this.db.selectFrom('serviceAreas').selectAll().where('isActive', '=', true).orderBy('city').orderBy('name').execute();
  }

  /** Only approved listings of approved vendors are ever public. */
  private publicBase() {
    return this.db
      .selectFrom('listings')
      .innerJoin('vendors', 'vendors.id', 'listings.vendorId')
      .innerJoin('categories', 'categories.id', 'listings.categoryId')
      .where('listings.status', '=', 'APPROVED')
      .where('vendors.status', '=', 'APPROVED');
  }

  async searchListings(q: ListingSearchInput) {
    let base = this.publicBase();
    if (q.q) {
      const term = likeContains(q.q);
      base = base.where((eb) =>
        eb.or([
          sql<boolean>`${eb.ref('listings.title')} LIKE ${term} ESCAPE '\\'`,
          sql<boolean>`${eb.ref('listings.description')} LIKE ${term} ESCAPE '\\'`,
          sql<boolean>`${eb.ref('vendors.businessName')} LIKE ${term} ESCAPE '\\'`,
        ]),
      );
    }
    if (q.category) base = base.where('categories.slug', '=', q.category);
    if (q.occasion) {
      const occasion = q.occasion;
      base = base.where((eb) =>
        eb.exists(
          eb
            .selectFrom('listingOccasions')
            .innerJoin('occasions', 'occasions.id', 'listingOccasions.occasionId')
            .select(sql`1`.as('one'))
            .whereRef('listingOccasions.listingId', '=', 'listings.id')
            .where('occasions.slug', '=', occasion),
        ),
      );
    }
    if (q.area) {
      const area = q.area;
      base = base.where((eb) =>
        eb.exists(
          eb
            .selectFrom('vendorServiceAreas')
            .innerJoin('serviceAreas', 'serviceAreas.id', 'vendorServiceAreas.serviceAreaId')
            .select(sql`1`.as('one'))
            .whereRef('vendorServiceAreas.vendorId', '=', 'vendors.id')
            .where('serviceAreas.slug', '=', area),
        ),
      );
    }
    if (q.food) {
      const food = q.food;
      base = base.where((eb) => eb.or([eb('listings.foodPreference', '=', food), eb('listings.foodPreference', '=', 'NOT_APPLICABLE')]));
    }
    if (q.maxPricePaise != null) {
      const max = q.maxPricePaise;
      base = base.where((eb) => eb.or([eb('listings.pricePaise', 'is', null), eb('listings.pricePaise', '<=', max)]));
    }

    let listQ = publicListingSelect(base);
    // SQL Server sorts NULLs first ascending; push "price on quote" listings to the end either way.
    if (q.sort === 'price_asc') listQ = listQ.orderBy(sql`CASE WHEN listings.price_paise IS NULL THEN 1 ELSE 0 END`).orderBy('listings.pricePaise', 'asc');
    else if (q.sort === 'price_desc') listQ = listQ.orderBy(sql`CASE WHEN listings.price_paise IS NULL THEN 1 ELSE 0 END`).orderBy('listings.pricePaise', 'desc');
    else if (q.sort === 'newest') listQ = listQ.orderBy('listings.approvedAt', 'desc');
    else listQ = listQ.orderBy('categories.sortOrder').orderBy('listings.approvedAt', 'desc');

    const [rows, total] = await Promise.all([
      listQ
        .orderBy('listings.id')
        .offset((q.page - 1) * q.pageSize)
        .fetch(q.pageSize)
        .execute(),
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return new Page(rows.map(toPublicListing), q.page, q.pageSize, total.n);
  }

  async listing(id: string) {
    const row = await publicListingSelect(this.publicBase().where('listings.id', '=', id)).executeTakeFirst();
    if (!row) throw notFound('Listing');
    const [occ, areas] = await Promise.all([
      this.db
        .selectFrom('listingOccasions')
        .innerJoin('occasions', 'occasions.id', 'listingOccasions.occasionId')
        .select(['occasions.id', 'occasions.slug', 'occasions.name'])
        .where('listingOccasions.listingId', '=', id)
        .orderBy('occasions.sortOrder')
        .execute(),
      this.vendorAreas(row.vendorId),
    ]);
    return { ...toPublicListing(row), occasions: occ, serviceAreas: areas };
  }

  private vendorAreas(vendorId: string) {
    return this.db
      .selectFrom('vendorServiceAreas')
      .innerJoin('serviceAreas', 'serviceAreas.id', 'vendorServiceAreas.serviceAreaId')
      .select(['serviceAreas.id', 'serviceAreas.slug', 'serviceAreas.name', 'serviceAreas.city'])
      .where('vendorServiceAreas.vendorId', '=', vendorId)
      .orderBy('serviceAreas.name')
      .execute();
  }

  async vendorProfile(slug: string) {
    const v = await this.db.selectFrom('vendors').selectAll().where('slug', '=', slug).where('status', '=', 'APPROVED').executeTakeFirst();
    if (!v) throw notFound('Vendor');
    const [areas, cats, items] = await Promise.all([
      this.vendorAreas(v.id),
      this.db
        .selectFrom('vendorCategories')
        .innerJoin('categories', 'categories.id', 'vendorCategories.categoryId')
        .select(['categories.id', 'categories.slug', 'categories.name'])
        .where('vendorCategories.vendorId', '=', v.id)
        .orderBy('categories.sortOrder')
        .execute(),
      publicListingSelect(this.publicBase().where('listings.vendorId', '=', v.id)).orderBy('categories.sortOrder').execute(),
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
      listings: items.map(toPublicListing),
    };
  }

  async estimate(input: BudgetEstimateInput) {
    const rows = await this.db
      .selectFrom('budgetRates')
      .innerJoin('categories', 'categories.id', 'budgetRates.categoryId')
      .select([
        'categories.slug as categorySlug',
        'categories.name as categoryName',
        'budgetRates.unit',
        'budgetRates.lowPaise',
        'budgetRates.highPaise',
        'budgetRates.foodPreference',
      ])
      .where('categories.slug', 'in', input.categorySlugs)
      .execute();
    return estimateBudget(rows, {
      guestCount: input.guestCount,
      categorySlugs: input.categorySlugs,
      foodPreference: input.foodPreference,
      budgetPaise: input.budgetPaise ?? null,
    });
  }
}

