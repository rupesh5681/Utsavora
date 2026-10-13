/**
 * Utsavora database schema (PostgreSQL, Drizzle ORM).
 *
 * Conventions
 *  - All money is integer paise in INTEGER columns (max ≈ ₹2.1 crore per field; validation caps at ₹2 crore).
 *  - Rates are integer basis points (1% = 100 bps).
 *  - snake_case tables and columns, uuid primary keys, timestamptz audit columns.
 *  - is_demo marks seeded demonstration data so it can never pass as a real listing or booking.
 *  - Quote revisions are immutable; orders keep a JSON snapshot of the accepted revision.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  check,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ───────────────────────────── Enums ─────────────────────────────

export const roleEnum = pgEnum('role', ['CUSTOMER', 'VENDOR', 'ADMIN']);
export const adminPermissionEnum = pgEnum('admin_permission', [
  'VENDORS_REVIEW',
  'LISTINGS_MODERATE',
  'ORDERS_MANAGE',
  'PAYMENTS_RECORD',
  'SETTINGS_MANAGE',
  'AUDIT_VIEW',
]);
export const vendorStatusEnum = pgEnum('vendor_status', ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']);
export const vendorMemberRoleEnum = pgEnum('vendor_member_role', ['OWNER', 'STAFF']);
export const listingStatusEnum = pgEnum('listing_status', ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']);
export const listingTypeEnum = pgEnum('listing_type', ['SERVICE', 'PACKAGE', 'MENU']);
export const pricingModeEnum = pgEnum('pricing_mode', ['FIXED', 'PER_GUEST', 'ON_QUOTE']);
export const foodPreferenceEnum = pgEnum('food_preference', ['VEG', 'NON_VEG', 'JAIN', 'MIXED', 'NOT_APPLICABLE']);
export const rateUnitEnum = pgEnum('rate_unit', ['PER_GUEST', 'FLAT', 'PER_50_GUESTS']);
export const eventRequestStatusEnum = pgEnum('event_request_status', ['OPEN', 'ACCEPTED', 'CANCELLED', 'EXPIRED']);
export const quoteStatusEnum = pgEnum('quote_status', [
  'REQUESTED',
  'VENDOR_REVIEWING',
  'QUOTED',
  'REVISED',
  'ACCEPTED',
  'DECLINED',
  'REJECTED',
  'NOT_SELECTED',
  'WITHDRAWN',
  'EXPIRED',
]);
export const orderStatusEnum = pgEnum('order_status', [
  'PENDING_CONFIRMATION',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);
export const orderModeEnum = pgEnum('order_mode', ['QUOTE', 'INSTANT']);
export const paymentProviderEnum = pgEnum('payment_provider', ['MANUAL', 'SANDBOX']);
export const paymentStatusEnum = pgEnum('payment_status', ['PENDING', 'SUCCEEDED', 'FAILED']);
export const paymentMethodEnum = pgEnum('payment_method', ['UPI', 'BANK_TRANSFER', 'CASH', 'CHEQUE']);
export const paymentKindEnum = pgEnum('payment_kind', ['ADVANCE', 'BALANCE', 'FULL']);

// ───────────────────────── Identity & access ─────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const userAdminPermissions = pgTable(
  'user_admin_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: adminPermissionEnum('permission').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permission] })],
);

/** Opaque server-side sessions. Only a SHA-256 hash of the cookie token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    audience: text('audience').notNull(), // customer | vendor | admin
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_hash_key').on(t.tokenHash), index('sessions_user_id_idx').on(t.userId)],
);

// ───────────────────────────── Reference data ─────────────────────────────

export const occasions = pgTable(
  'occasions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('occasions_slug_key').on(t.slug)],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    requiresFssai: boolean('requires_fssai').notNull().default(false),
    /** GST rate vendors typically apply in this category — a UI hint only. */
    defaultTaxBps: integer('default_tax_bps').notNull().default(1800),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('categories_slug_key').on(t.slug)],
);

export const serviceAreas = pgTable(
  'service_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    city: text('city').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('service_areas_slug_key').on(t.slug), uniqueIndex('service_areas_city_name_key').on(t.city, t.name)],
);

/** Rate cards for the indicative budget estimator (admin-maintained). */
export const budgetRates = pgTable(
  'budget_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    unit: rateUnitEnum('unit').notNull(),
    lowPaise: integer('low_paise').notNull(),
    highPaise: integer('high_paise').notNull(),
    foodPreference: foodPreferenceEnum('food_preference'),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('budget_rates_category_food_key').on(t.categoryId, t.foodPreference).nullsNotDistinct(),
    check('budget_rates_range', sql`${t.lowPaise} >= 0 AND ${t.highPaise} >= ${t.lowPaise}`),
  ],
);

// ───────────────────────────── Vendors ─────────────────────────────

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    businessName: text('business_name').notNull(),
    description: text('description').notNull().default(''),
    phone: text('phone').notNull(),
    city: text('city').notNull().default('Greater Noida'),
    addressLine: text('address_line').notNull().default(''),
    gstin: text('gstin'),
    fssaiNumber: text('fssai_number'),
    maxEventsPerDay: integer('max_events_per_day').notNull().default(2),
    status: vendorStatusEnum('status').notNull().default('DRAFT'),
    isDemo: boolean('is_demo').notNull().default(false),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('vendors_slug_key').on(t.slug),
    index('vendors_status_idx').on(t.status),
    check('vendors_capacity', sql`${t.maxEventsPerDay} BETWEEN 1 AND 50`),
  ],
);

export const vendorMembers = pgTable(
  'vendor_members',
  {
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: vendorMemberRoleEnum('role').notNull().default('OWNER'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.vendorId, t.userId] }), index('vendor_members_user_idx').on(t.userId)],
);

export const vendorCategories = pgTable(
  'vendor_categories',
  {
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.vendorId, t.categoryId] }), index('vendor_categories_category_idx').on(t.categoryId)],
);

export const vendorServiceAreas = pgTable(
  'vendor_service_areas',
  {
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    serviceAreaId: uuid('service_area_id')
      .notNull()
      .references(() => serviceAreas.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.vendorId, t.serviceAreaId] }), index('vendor_service_areas_area_idx').on(t.serviceAreaId)],
);

export const vendorVerificationReviews = pgTable(
  'vendor_verification_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decision: text('decision').notNull(),
    fromStatus: vendorStatusEnum('from_status').notNull(),
    toStatus: vendorStatusEnum('to_status').notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('vendor_reviews_vendor_idx').on(t.vendorId)],
);

// ───────────────────────────── Catalogue ─────────────────────────────

/** Services, packages and menus. Admin approval is required before anything is public. */
export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    type: listingTypeEnum('type').notNull(),
    pricingMode: pricingModeEnum('pricing_mode').notNull(),
    pricePaise: integer('price_paise'),
    minGuests: integer('min_guests'),
    maxGuests: integer('max_guests'),
    foodPreference: foodPreferenceEnum('food_preference').notNull().default('NOT_APPLICABLE'),
    inclusions: text('inclusions').array().notNull().default(sql`'{}'::text[]`),
    status: listingStatusEnum('status').notNull().default('DRAFT'),
    isDemo: boolean('is_demo').notNull().default(false),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('listings_status_category_idx').on(t.status, t.categoryId),
    index('listings_vendor_idx').on(t.vendorId),
    check('listings_price_nonneg', sql`${t.pricePaise} IS NULL OR ${t.pricePaise} >= 0`),
  ],
);

export const listingOccasions = pgTable(
  'listing_occasions',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    occasionId: uuid('occasion_id')
      .notNull()
      .references(() => occasions.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.occasionId] }), index('listing_occasions_occasion_idx').on(t.occasionId)],
);

export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    moderatorId: uuid('moderator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decision: text('decision').notNull(),
    fromStatus: listingStatusEnum('from_status').notNull(),
    toStatus: listingStatusEnum('to_status').notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('moderation_actions_listing_idx').on(t.listingId)],
);

// ───────────────────────── Event requests & quotes ─────────────────────────

/** A customer's request for quotes. */
export const eventRequests = pgTable(
  'event_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    occasionId: uuid('occasion_id')
      .notNull()
      .references(() => occasions.id, { onDelete: 'restrict' }),
    serviceAreaId: uuid('service_area_id')
      .notNull()
      .references(() => serviceAreas.id, { onDelete: 'restrict' }),
    title: text('title').notNull().default(''),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    eventTime: text('event_time'),
    venueAddress: text('venue_address').notNull().default(''),
    guestCount: integer('guest_count').notNull(),
    budgetPaise: integer('budget_paise').notNull(),
    foodPreference: foodPreferenceEnum('food_preference').notNull(),
    notes: text('notes').notNull().default(''),
    status: eventRequestStatusEnum('status').notNull().default('OPEN'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('event_requests_reference_key').on(t.reference),
    index('event_requests_customer_idx').on(t.customerId, t.createdAt),
    index('event_requests_status_date_idx').on(t.status, t.eventDate),
    check('event_requests_guests', sql`${t.guestCount} > 0`),
    check('event_requests_budget', sql`${t.budgetPaise} >= 0`),
  ],
);

export const eventRequestCategories = pgTable(
  'event_request_categories',
  {
    eventRequestId: uuid('event_request_id')
      .notNull()
      .references(() => eventRequests.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.eventRequestId, t.categoryId] })],
);

/** One vendor's thread for one event request. Prices live in immutable revisions. */
export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventRequestId: uuid('event_request_id')
      .notNull()
      .references(() => eventRequests.id, { onDelete: 'cascade' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    status: quoteStatusEnum('status').notNull().default('REQUESTED'),
    currentRevisionId: uuid('current_revision_id').references((): AnyPgColumn => quoteRevisions.id, { onDelete: 'set null' }),
    declineReason: text('decline_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('quotes_request_vendor_key').on(t.eventRequestId, t.vendorId),
    index('quotes_vendor_status_idx').on(t.vendorId, t.status),
  ],
);

/** Immutable. Any change is a new revision with the next revision_number. */
export const quoteRevisions = pgTable(
  'quote_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    subtotalPaise: integer('subtotal_paise').notNull(),
    discountPaise: integer('discount_paise').notNull(),
    taxBps: integer('tax_bps').notNull(),
    taxPaise: integer('tax_paise').notNull(),
    deliveryPaise: integer('delivery_paise').notNull(),
    totalPaise: integer('total_paise').notNull(),
    advanceBps: integer('advance_bps').notNull(),
    advancePaise: integer('advance_paise').notNull(),
    inclusions: text('inclusions').array().notNull().default(sql`'{}'::text[]`),
    exclusions: text('exclusions').array().notNull().default(sql`'{}'::text[]`),
    terms: text('terms').notNull().default(''),
    notes: text('notes').notNull().default(''),
    validUntil: date('valid_until', { mode: 'string' }).notNull(),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('quote_revisions_quote_number_key').on(t.quoteId, t.revisionNumber),
    check('quote_revisions_totals', sql`${t.totalPaise} >= 0 AND ${t.advancePaise} <= ${t.totalPaise} AND ${t.advanceBps} BETWEEN 0 AND 10000`),
  ],
);

export const quoteItems = pgTable(
  'quote_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => quoteRevisions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPricePaise: integer('unit_price_paise').notNull(),
    lineTotalPaise: integer('line_total_paise').notNull(),
  },
  (t) => [
    uniqueIndex('quote_items_revision_position_key').on(t.revisionId, t.position),
    check('quote_items_positive', sql`${t.quantity} > 0 AND ${t.unitPricePaise} >= 0`),
  ],
);

// ───────────────────────────── Orders ─────────────────────────────

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNumber: text('order_number').notNull(),
    mode: orderModeEnum('mode').notNull().default('QUOTE'),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    eventRequestId: uuid('event_request_id').references(() => eventRequests.id, { onDelete: 'set null' }),
    quoteId: uuid('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
    acceptedRevisionId: uuid('accepted_revision_id').references(() => quoteRevisions.id, { onDelete: 'restrict' }),
    status: orderStatusEnum('status').notNull().default('PENDING_CONFIRMATION'),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    guestCount: integer('guest_count').notNull(),
    subtotalPaise: integer('subtotal_paise').notNull(),
    discountPaise: integer('discount_paise').notNull(),
    taxPaise: integer('tax_paise').notNull(),
    deliveryPaise: integer('delivery_paise').notNull(),
    totalPaise: integer('total_paise').notNull(),
    advancePaise: integer('advance_paise').notNull(),
    commissionBps: integer('commission_bps').notNull(),
    commissionPaise: integer('commission_paise').notNull(),
    vendorPayablePaise: integer('vendor_payable_paise').notNull(),
    paidPaise: integer('paid_paise').notNull().default(0),
    /** Durable copy of the accepted revision, vendor, event and terms at the moment of acceptance. */
    snapshot: jsonb('snapshot').notNull(),
    isDemo: boolean('is_demo').notNull().default(false),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_order_number_key').on(t.orderNumber),
    uniqueIndex('orders_event_request_key').on(t.eventRequestId),
    uniqueIndex('orders_quote_key').on(t.quoteId),
    uniqueIndex('orders_accepted_revision_key').on(t.acceptedRevisionId),
    index('orders_vendor_date_status_idx').on(t.vendorId, t.eventDate, t.status),
    index('orders_customer_idx').on(t.customerId, t.createdAt),
    index('orders_status_date_idx').on(t.status, t.eventDate),
    check('orders_amounts', sql`${t.totalPaise} >= 0 AND ${t.paidPaise} >= 0 AND ${t.commissionPaise} >= 0`),
  ],
);

/** Append-only order timeline used for tracking and audit. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    fromStatus: orderStatusEnum('from_status'),
    toStatus: orderStatusEnum('to_status').notNull(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
);

/**
 * Payments. The MVP records MANUAL (admin-verified offline) payments only.
 * Online provider payments arrive in Phase 2 behind verified webhooks.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    provider: paymentProviderEnum('provider').notNull(),
    kind: paymentKindEnum('kind').notNull(),
    status: paymentStatusEnum('status').notNull(),
    method: paymentMethodEnum('method'),
    amountPaise: integer('amount_paise').notNull(),
    reference: text('reference').notNull(),
    /** Unique per provider event / manual reference for safe replay handling. */
    idempotencyKey: text('idempotency_key').notNull(),
    receivedOn: date('received_on', { mode: 'string' }),
    notes: text('notes').notNull().default(''),
    recordedById: uuid('recorded_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('payments_idempotency_key').on(t.idempotencyKey),
    index('payments_order_idx').on(t.orderId),
    check('payments_amount_positive', sql`${t.amountPaise} > 0`),
  ],
);

// ───────────────────────────── Settings ─────────────────────────────

/** Commission rules. Most specific wins: vendor > category > default (both null). */
export const commissionRules = pgTable(
  'commission_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    bps: integer('bps').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('commission_rules_scope_key').on(t.vendorId, t.categoryId).nullsNotDistinct(),
    check('commission_rules_bps', sql`${t.bps} BETWEEN 0 AND 5000`),
  ],
);

// ───────────────────────────── Operations ─────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_read_idx').on(t.userId, t.readAt)],
);

/** Transactional outbox — written in the same transaction as the business change. */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('outbox_pending_idx').on(t.processedAt, t.createdAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_entity_idx').on(t.entityType, t.entityId), index('audit_logs_created_idx').on(t.createdAt)],
);

// ───────────────────────────── Relations (for relational queries) ─────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  roles: many(userRoles),
  adminPermissions: many(userAdminPermissions),
  vendorMemberships: many(vendorMembers),
}));
export const userRolesRelations = relations(userRoles, ({ one }) => ({ user: one(users, { fields: [userRoles.userId], references: [users.id] }) }));
export const userAdminPermissionsRelations = relations(userAdminPermissions, ({ one }) => ({
  user: one(users, { fields: [userAdminPermissions.userId], references: [users.id] }),
}));

export const vendorsRelations = relations(vendors, ({ many }) => ({
  members: many(vendorMembers),
  categories: many(vendorCategories),
  serviceAreas: many(vendorServiceAreas),
  listings: many(listings),
  reviews: many(vendorVerificationReviews),
}));
export const vendorMembersRelations = relations(vendorMembers, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorMembers.vendorId], references: [vendors.id] }),
  user: one(users, { fields: [vendorMembers.userId], references: [users.id] }),
}));
export const vendorCategoriesRelations = relations(vendorCategories, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorCategories.vendorId], references: [vendors.id] }),
  category: one(categories, { fields: [vendorCategories.categoryId], references: [categories.id] }),
}));
export const vendorServiceAreasRelations = relations(vendorServiceAreas, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorServiceAreas.vendorId], references: [vendors.id] }),
  serviceArea: one(serviceAreas, { fields: [vendorServiceAreas.serviceAreaId], references: [serviceAreas.id] }),
}));
export const vendorReviewsRelations = relations(vendorVerificationReviews, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorVerificationReviews.vendorId], references: [vendors.id] }),
  reviewer: one(users, { fields: [vendorVerificationReviews.reviewerId], references: [users.id] }),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  vendor: one(vendors, { fields: [listings.vendorId], references: [vendors.id] }),
  category: one(categories, { fields: [listings.categoryId], references: [categories.id] }),
  occasions: many(listingOccasions),
  moderations: many(moderationActions),
}));
export const listingOccasionsRelations = relations(listingOccasions, ({ one }) => ({
  listing: one(listings, { fields: [listingOccasions.listingId], references: [listings.id] }),
  occasion: one(occasions, { fields: [listingOccasions.occasionId], references: [occasions.id] }),
}));
export const moderationActionsRelations = relations(moderationActions, ({ one }) => ({
  listing: one(listings, { fields: [moderationActions.listingId], references: [listings.id] }),
}));

export const eventRequestsRelations = relations(eventRequests, ({ one, many }) => ({
  customer: one(users, { fields: [eventRequests.customerId], references: [users.id] }),
  occasion: one(occasions, { fields: [eventRequests.occasionId], references: [occasions.id] }),
  serviceArea: one(serviceAreas, { fields: [eventRequests.serviceAreaId], references: [serviceAreas.id] }),
  categories: many(eventRequestCategories),
  quotes: many(quotes),
}));
export const eventRequestCategoriesRelations = relations(eventRequestCategories, ({ one }) => ({
  eventRequest: one(eventRequests, { fields: [eventRequestCategories.eventRequestId], references: [eventRequests.id] }),
  category: one(categories, { fields: [eventRequestCategories.categoryId], references: [categories.id] }),
}));
export const quotesRelations = relations(quotes, ({ one, many }) => ({
  eventRequest: one(eventRequests, { fields: [quotes.eventRequestId], references: [eventRequests.id] }),
  vendor: one(vendors, { fields: [quotes.vendorId], references: [vendors.id] }),
  revisions: many(quoteRevisions),
}));
export const quoteRevisionsRelations = relations(quoteRevisions, ({ one, many }) => ({
  quote: one(quotes, { fields: [quoteRevisions.quoteId], references: [quotes.id] }),
  items: many(quoteItems),
}));
export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  revision: one(quoteRevisions, { fields: [quoteItems.revisionId], references: [quoteRevisions.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(users, { fields: [orders.customerId], references: [users.id] }),
  vendor: one(vendors, { fields: [orders.vendorId], references: [vendors.id] }),
  events: many(orderEvents),
  payments: many(payments),
}));
export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
}));
export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));
export const budgetRatesRelations = relations(budgetRates, ({ one }) => ({
  category: one(categories, { fields: [budgetRates.categoryId], references: [categories.id] }),
}));
export const categoriesRelations = relations(categories, ({ many }) => ({
  budgetRates: many(budgetRates),
}));
