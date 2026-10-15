/**
 * Idempotent seed: reference data, rate cards, commission defaults, the first admin,
 * and (optionally) clearly-labelled DEMO vendors, listings and accounts.
 *
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD   initial admin (required in production)
 *   SEED_DEMO_DATA=true                      add demo vendors + demo customer (never in production)
 */
import { hash } from '@node-rs/argon2';
import { createDb, json, now, type Db } from './client';
import { ALL_ADMIN_PERMISSIONS, type FoodPreference } from '@utsavora/types';

export const OCCASIONS = [
  { slug: 'birthday', name: 'Birthdays', description: 'First birthdays to milestone 50ths — cakes, décor, food and fun.', sortOrder: 1 },
  { slug: 'anniversary', name: 'Anniversaries', description: 'Intimate dinners or grand silver-jubilee celebrations.', sortOrder: 2 },
  { slug: 'wedding', name: 'Weddings & Functions', description: 'Haldi, mehendi, sangeet, reception and everything between.', sortOrder: 3 },
  { slug: 'corporate', name: 'Corporate Events', description: 'Office parties, offsites, launches and Diwali celebrations.', sortOrder: 4 },
  { slug: 'family-function', name: 'Family Functions', description: 'Griha pravesh, naamkaran, pooja and get-togethers.', sortOrder: 5 },
];

export const CATEGORIES = [
  { slug: 'catering', name: 'Catering', description: 'Buffets, thalis, live counters and food packages.', requiresFssai: true, defaultTaxBps: 500, sortOrder: 1 },
  { slug: 'cakes-desserts', name: 'Cakes & Desserts', description: 'Celebration cakes, mithai and dessert tables.', requiresFssai: true, defaultTaxBps: 500, sortOrder: 2 },
  { slug: 'decoration', name: 'Decoration', description: 'Balloon, floral and theme décor for every occasion.', requiresFssai: false, defaultTaxBps: 1800, sortOrder: 3 },
  { slug: 'photography', name: 'Photography & Video', description: 'Candid photography, videography and reels.', requiresFssai: false, defaultTaxBps: 1800, sortOrder: 4 },
  { slug: 'entertainment', name: 'Entertainment', description: 'DJs, anchors, magicians, live music and games.', requiresFssai: false, defaultTaxBps: 1800, sortOrder: 5 },
  { slug: 'event-rentals', name: 'Event Rentals', description: 'Tents, furniture, lighting and sound.', requiresFssai: false, defaultTaxBps: 1800, sortOrder: 6 },
  { slug: 'party-supplies', name: 'Party Supplies', description: 'Disposables, return gifts and party essentials.', requiresFssai: false, defaultTaxBps: 1800, sortOrder: 7 },
];

const GN_AREAS = [
  'Alpha 1', 'Alpha 2', 'Beta 1', 'Beta 2', 'Gamma 1', 'Gamma 2', 'Delta 1', 'Delta 2', 'Omicron', 'Mu', 'Chi', 'Sigma',
  'Pari Chowk', 'Knowledge Park', 'Techzone', 'Greater Noida West', 'Surajpur', 'Dadri',
];

/** Rates in rupees; converted to paise below. Typical Greater Noida ranges, reviewed by ops. */
const RATES: { cat: string; unit: 'PER_GUEST' | 'FLAT' | 'PER_50_GUESTS'; low: number; high: number; food?: 'VEG' | 'NON_VEG' | 'JAIN' | 'MIXED' }[] = [
  { cat: 'catering', unit: 'PER_GUEST', low: 450, high: 850 },
  { cat: 'catering', unit: 'PER_GUEST', low: 400, high: 750, food: 'VEG' },
  { cat: 'catering', unit: 'PER_GUEST', low: 450, high: 800, food: 'JAIN' },
  { cat: 'catering', unit: 'PER_GUEST', low: 550, high: 1000, food: 'NON_VEG' },
  { cat: 'catering', unit: 'PER_GUEST', low: 500, high: 950, food: 'MIXED' },
  { cat: 'cakes-desserts', unit: 'PER_50_GUESTS', low: 2500, high: 6000 },
  { cat: 'decoration', unit: 'FLAT', low: 8000, high: 45000 },
  { cat: 'photography', unit: 'FLAT', low: 12000, high: 60000 },
  { cat: 'entertainment', unit: 'FLAT', low: 8000, high: 35000 },
  { cat: 'event-rentals', unit: 'PER_50_GUESTS', low: 3000, high: 9000 },
  { cat: 'party-supplies', unit: 'PER_GUEST', low: 40, high: 120 },
];

const slugify = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');


export async function seedReferenceData(db: Db) {
  for (const o of OCCASIONS) {
    const found = await db.selectFrom('occasions').select('id').where('slug', '=', o.slug).executeTakeFirst();
    if (found) await db.updateTable('occasions').set({ name: o.name, description: o.description, sortOrder: o.sortOrder }).where('id', '=', found.id).execute();
    else await db.insertInto('occasions').values(o).execute();
  }
  for (const c of CATEGORIES) {
    const found = await db.selectFrom('categories').select('id').where('slug', '=', c.slug).executeTakeFirst();
    const values = { name: c.name, description: c.description, requiresFssai: c.requiresFssai, defaultTaxBps: c.defaultTaxBps, sortOrder: c.sortOrder };
    if (found) await db.updateTable('categories').set(values).where('id', '=', found.id).execute();
    else await db.insertInto('categories').values({ slug: c.slug, ...values }).execute();
  }
  for (const name of GN_AREAS) {
    const slug = `greater-noida-${slugify(name)}`;
    const found = await db.selectFrom('serviceAreas').select('id').where('slug', '=', slug).executeTakeFirst();
    if (!found) await db.insertInto('serviceAreas').values({ name, city: 'Greater Noida', slug }).execute();
  }
  const cats = await db.selectFrom('categories').select(['id', 'slug']).execute();
  const bySlug = new Map(cats.map((c) => [c.slug, c.id]));
  for (const r of RATES) {
    const categoryId = bySlug.get(r.cat)!;
    const food = (r.food ?? null) as FoodPreference | null;
    const existing = await db
      .selectFrom('budgetRates')
      .select('id')
      .where('categoryId', '=', categoryId)
      .where((eb) => (food === null ? eb('foodPreference', 'is', null) : eb('foodPreference', '=', food)))
      .executeTakeFirst();
    const values = { unit: r.unit, lowPaise: r.low * 100, highPaise: r.high * 100 };
    if (existing) await db.updateTable('budgetRates').set({ ...values, updatedAt: now() }).where('id', '=', existing.id).execute();
    else await db.insertInto('budgetRates').values({ categoryId, foodPreference: food, ...values }).execute();
  }
  // Default commission 10%, catering 8%. Only created if missing — admins own these afterwards.
  const def = await db.selectFrom('commissionRules').select('id').where('vendorId', 'is', null).where('categoryId', 'is', null).executeTakeFirst();
  if (!def) await db.insertInto('commissionRules').values({ bps: 1000, vendorId: null, categoryId: null }).execute();
  const catering = bySlug.get('catering')!;
  const cat = await db.selectFrom('commissionRules').select('id').where('vendorId', 'is', null).where('categoryId', '=', catering).executeTakeFirst();
  if (!cat) await db.insertInto('commissionRules').values({ bps: 800, vendorId: null, categoryId: catering }).execute();
}

async function upsertUser(db: Db, u: { email: string; name: string; phone: string; password: string; roles: ('CUSTOMER' | 'VENDOR' | 'ADMIN')[] }) {
  const existing = await db.selectFrom('users').select('id').where('email', '=', u.email).executeTakeFirst();
  const id =
    existing?.id ??
    (await db
      .insertInto('users')
      .output('inserted.id')
      .values({ email: u.email, name: u.name, phone: u.phone, passwordHash: await hash(u.password) })
      .executeTakeFirstOrThrow()).id;
  for (const role of u.roles) {
    const has = await db.selectFrom('userRoles').select('role').where('userId', '=', id).where('role', '=', role).executeTakeFirst();
    if (!has) await db.insertInto('userRoles').values({ userId: id, role }).execute();
  }
  return id;
}

export async function seedAdmin(db: Db, email: string, password: string) {
  const id = await upsertUser(db, { email, name: 'Utsavora Admin', phone: '9999999999', password, roles: ['ADMIN'] });
  const have = new Set((await db.selectFrom('userAdminPermissions').select('permission').where('userId', '=', id).execute()).map((p) => p.permission));
  for (const permission of ALL_ADMIN_PERMISSIONS) {
    if (!have.has(permission)) await db.insertInto('userAdminPermissions').values({ userId: id, permission }).execute();
  }
  return id;
}

interface DemoVendor {
  slug: string;
  businessName: string;
  description: string;
  categories: string[];
  areas: string[];
  fssai?: string;
  listings: {
    cat: string;
    title: string;
    description: string;
    type: 'SERVICE' | 'PACKAGE' | 'MENU';
    pricingMode: 'FIXED' | 'PER_GUEST' | 'ON_QUOTE';
    price?: number;
    minGuests?: number;
    maxGuests?: number;
    food?: 'VEG' | 'NON_VEG' | 'JAIN' | 'MIXED' | 'NOT_APPLICABLE';
    inclusions: string[];
    occasions: string[];
  }[];
}

const DEMO_VENDORS: DemoVendor[] = [
  {
    slug: 'demo-annapurna-caterers',
    businessName: 'Annapurna Caterers (Demo)',
    description: 'Demonstration vendor. Home-style North Indian and Awadhi catering for gatherings of 30 to 800 guests.',
    categories: ['catering', 'cakes-desserts'],
    areas: ['Alpha 1', 'Alpha 2', 'Beta 1', 'Beta 2', 'Gamma 1', 'Pari Chowk', 'Knowledge Park', 'Greater Noida West'],
    fssai: '10020051000123',
    listings: [
      {
        cat: 'catering',
        title: 'Shubh Utsav Veg Buffet',
        description: 'Two paneer mains, dal makhani, seasonal sabzi, jeera rice, assorted breads, raita, salad, gulab jamun and a live chaat counter.',
        type: 'MENU', pricingMode: 'PER_GUEST', price: 550, minGuests: 50, maxGuests: 600, food: 'VEG',
        inclusions: ['Serving staff (1 per 25 guests)', 'Chafing dishes and crockery', 'Live chaat counter', 'Setup and cleanup'],
        occasions: ['birthday', 'anniversary', 'family-function', 'wedding'],
      },
      {
        cat: 'catering',
        title: 'Awadhi Dawat Non-veg Feast',
        description: 'Galouti kebab starters, chicken korma, mutton biryani, dal, breads, salads and phirni. Veg options included for mixed gatherings.',
        type: 'MENU', pricingMode: 'PER_GUEST', price: 850, minGuests: 60, maxGuests: 500, food: 'MIXED',
        inclusions: ['Two starters', 'Biryani counter', 'Serving staff', 'Crockery'],
        occasions: ['wedding', 'anniversary', 'corporate'],
      },
      {
        cat: 'cakes-desserts',
        title: 'Celebration Cake & Mithai Table',
        description: 'Custom 3 kg theme cake with a dessert table of four mithai varieties, styled to match your décor.',
        type: 'PACKAGE', pricingMode: 'FIXED', price: 9500, food: 'VEG',
        inclusions: ['3 kg theme cake', 'Four mithai varieties', 'Table styling'],
        occasions: ['birthday', 'anniversary'],
      },
    ],
  },
  {
    slug: 'demo-rangoli-decor',
    businessName: 'Rangoli Décor Studio (Demo)',
    description: 'Demonstration vendor. Marigold, balloon and theme décor for homes, banquet halls and offices.',
    categories: ['decoration', 'event-rentals'],
    areas: ['Alpha 1', 'Beta 1', 'Gamma 1', 'Gamma 2', 'Delta 1', 'Omicron', 'Pari Chowk', 'Greater Noida West', 'Techzone'],
    listings: [
      {
        cat: 'decoration',
        title: 'Genda Phool Home Décor',
        description: 'Marigold and mango-leaf toran, entrance rangoli, floral backdrop and diya arrangement for poojas and family functions.',
        type: 'PACKAGE', pricingMode: 'FIXED', price: 14500,
        inclusions: ['Entrance toran', 'Floral backdrop (8×8 ft)', 'Rangoli', '50 diyas'],
        occasions: ['family-function', 'wedding'],
      },
      {
        cat: 'decoration',
        title: 'Birthday Balloon Theme Setup',
        description: 'Balloon arch, themed backdrop, cake table décor and name banner in your choice of colours or theme.',
        type: 'PACKAGE', pricingMode: 'FIXED', price: 8999,
        inclusions: ['Balloon arch', 'Theme backdrop', 'Cake table décor', 'Name banner'],
        occasions: ['birthday'],
      },
    ],
  },
  {
    slug: 'demo-chitra-clicks',
    businessName: 'Chitra Clicks Photography (Demo)',
    description: 'Demonstration vendor. Candid photography and short films for birthdays, weddings and corporate events.',
    categories: ['photography', 'entertainment'],
    areas: ['Alpha 1', 'Alpha 2', 'Beta 2', 'Gamma 1', 'Knowledge Park', 'Greater Noida West', 'Pari Chowk', 'Techzone'],
    listings: [
      {
        cat: 'photography',
        title: 'Candid Event Photography (4 hours)',
        description: 'One candid photographer for four hours, 300+ edited photos delivered in a private online gallery within 7 days.',
        type: 'SERVICE', pricingMode: 'FIXED', price: 18000,
        inclusions: ['4 hours coverage', '300+ edited photos', 'Online gallery'],
        occasions: ['birthday', 'anniversary', 'corporate', 'family-function'],
      },
      {
        cat: 'entertainment',
        title: 'DJ with Sound & Lights',
        description: 'Bollywood, Punjabi and retro sets with sound system and basic dance-floor lighting. Duration and add-ons on quote.',
        type: 'SERVICE', pricingMode: 'ON_QUOTE',
        inclusions: ['DJ console', 'Sound system', 'Dance-floor lighting'],
        occasions: ['birthday', 'wedding', 'corporate'],
      },
    ],
  },
];


export async function seedDemoData(db: Db, demoPassword: string) {
  const cats = new Map((await db.selectFrom('categories').select(['id', 'slug']).execute()).map((c) => [c.slug, c.id]));
  const areas = new Map((await db.selectFrom('serviceAreas').select(['id', 'name']).execute()).map((a) => [a.name, a.id]));
  const occ = new Map((await db.selectFrom('occasions').select(['id', 'slug']).execute()).map((o) => [o.slug, o.id]));
  const ts = new Date();

  for (const [i, v] of DEMO_VENDORS.entries()) {
    const existing = await db.selectFrom('vendors').select('id').where('slug', '=', v.slug).executeTakeFirst();
    if (existing) continue;
    const userId = await upsertUser(db, {
      email: `vendor${i + 1}.demo@utsavora.local`,
      name: `${v.businessName.replace(' (Demo)', '')} Owner`,
      phone: `98100000${10 + i}`,
      password: demoPassword,
      roles: ['VENDOR'],
    });
    await db.transaction().execute(async (trx) => {
      const vendor = await trx
        .insertInto('vendors')
        .output('inserted.id')
        .values({
          slug: v.slug,
          businessName: v.businessName,
          description: v.description,
          phone: `98100000${10 + i}`,
          fssaiNumber: v.fssai ?? null,
          gstin: null,
          maxEventsPerDay: 3,
          status: 'APPROVED',
          isDemo: true,
          submittedAt: ts,
          approvedAt: ts,
        })
        .executeTakeFirstOrThrow();
      await trx.insertInto('vendorMembers').values({ vendorId: vendor.id, userId, role: 'OWNER' }).execute();
      await trx.insertInto('vendorCategories').values(v.categories.map((c) => ({ vendorId: vendor.id, categoryId: cats.get(c)! }))).execute();
      await trx.insertInto('vendorServiceAreas').values(v.areas.map((a) => ({ vendorId: vendor.id, serviceAreaId: areas.get(a)! }))).execute();
      for (const l of v.listings) {
        const listing = await trx
          .insertInto('listings')
          .output('inserted.id')
          .values({
            vendorId: vendor.id,
            categoryId: cats.get(l.cat)!,
            title: l.title,
            description: l.description,
            type: l.type,
            pricingMode: l.pricingMode,
            pricePaise: l.price != null ? l.price * 100 : null,
            minGuests: l.minGuests ?? null,
            maxGuests: l.maxGuests ?? null,
            foodPreference: l.food ?? 'NOT_APPLICABLE',
            inclusions: json(l.inclusions),
            status: 'APPROVED',
            isDemo: true,
            submittedAt: ts,
            approvedAt: ts,
          })
          .executeTakeFirstOrThrow();
        await trx.insertInto('listingOccasions').values(l.occasions.map((o) => ({ listingId: listing.id, occasionId: occ.get(o)! }))).execute();
      }
    });
  }
  await upsertUser(db, { email: 'customer.demo@utsavora.local', name: 'Demo Customer', phone: '9810000099', password: demoPassword, roles: ['CUSTOMER'] });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = createDb(url, 2);
  try {
    await seedReferenceData(db);
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
      await seedAdmin(db, adminEmail.toLowerCase(), adminPassword);
      console.log(`Admin ready: ${adminEmail}`);
    } else {
      console.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — no admin created.');
    }
    if (process.env.SEED_DEMO_DATA === 'true') {
      if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data with NODE_ENV=production');
      await seedDemoData(db, process.env.SEED_DEMO_PASSWORD ?? 'Utsav-Demo-2026');
      console.log('Demo vendors, listings and accounts seeded (all marked as demo).');
    }
    const { count } = await db.selectFrom('listings').select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirstOrThrow();
    console.log(`Seed complete. Listings in database: ${count}`);
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  // Load .env for local runs without adding a dependency.
  try {
    process.loadEnvFile?.('.env');
  } catch {
    /* no .env file */
  }
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
