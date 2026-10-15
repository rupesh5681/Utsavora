/*
  Utsavora — initial schema for Microsoft SQL Server 2022 (also runs on Azure SQL Database).

  Conventions
    * Money is integer paise in INT columns (max ≈ ₹2.1 crore per field; the API caps amounts at ₹2 crore).
    * Rates are integer basis points (500 = 5%).
    * Text is NVARCHAR (Unicode: ₹, Hindi). Status values are NVARCHAR + CHECK constraints.
    * Lists (inclusions/exclusions) and documents (order snapshot, audit metadata) are JSON in NVARCHAR(MAX) with ISJSON checks.
    * Timestamps are DATETIME2(3) in UTC. Calendar dates (event date, validity) are DATE.
    * Primary keys are UNIQUEIDENTIFIER with NEWSEQUENTIALID() to avoid index fragmentation.
    * is_demo marks seeded demonstration data so it can never pass as a real listing or booking.
    * ON DELETE CASCADE is used only for pure child/link tables, which keeps SQL Server free of
      "multiple cascade paths" errors. Commercial records are never deleted (users are deactivated).

  Applied by `pnpm db:migrate` (apps/api/src/db/migrate.ts), which records it in dbo.schema_migrations.
  You can also run it by hand in SSMS or sqlcmd; GO separates batches.
*/

-- ───────────────────────────── Identity & access ─────────────────────────────

CREATE TABLE dbo.users (
  id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_users_id DEFAULT NEWSEQUENTIALID(),
  email          NVARCHAR(320)    NOT NULL,
  phone          NVARCHAR(20)     NOT NULL,
  name           NVARCHAR(100)    NOT NULL,
  password_hash  NVARCHAR(255)    NOT NULL,
  is_active      BIT              NOT NULL CONSTRAINT df_users_active DEFAULT 1,
  created_at     DATETIME2(3)     NOT NULL CONSTRAINT df_users_created DEFAULT SYSUTCDATETIME(),
  updated_at     DATETIME2(3)     NOT NULL CONSTRAINT df_users_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_users PRIMARY KEY (id),
  CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE dbo.user_roles (
  user_id     UNIQUEIDENTIFIER NOT NULL,
  role        NVARCHAR(20)     NOT NULL,
  created_at  DATETIME2(3)     NOT NULL CONSTRAINT df_user_roles_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_user_roles PRIMARY KEY (user_id, role),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES dbo.users (id) ON DELETE CASCADE,
  CONSTRAINT ck_user_roles_role CHECK (role IN ('CUSTOMER', 'VENDOR', 'ADMIN'))
);

CREATE TABLE dbo.user_admin_permissions (
  user_id     UNIQUEIDENTIFIER NOT NULL,
  permission  NVARCHAR(30)     NOT NULL,
  granted_at  DATETIME2(3)     NOT NULL CONSTRAINT df_uap_granted DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_user_admin_permissions PRIMARY KEY (user_id, permission),
  CONSTRAINT fk_uap_user FOREIGN KEY (user_id) REFERENCES dbo.users (id) ON DELETE CASCADE,
  CONSTRAINT ck_uap_permission CHECK (permission IN
    ('VENDORS_REVIEW', 'LISTINGS_MODERATE', 'ORDERS_MANAGE', 'PAYMENTS_RECORD', 'SETTINGS_MANAGE', 'AUDIT_VIEW'))
);

/* Opaque server-side sessions. Only a SHA-256 hash of the cookie token is stored. */
CREATE TABLE dbo.sessions (
  id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_sessions_id DEFAULT NEWSEQUENTIALID(),
  user_id       UNIQUEIDENTIFIER NOT NULL,
  token_hash    CHAR(64)         NOT NULL,
  audience      NVARCHAR(10)     NOT NULL,
  expires_at    DATETIME2(3)     NOT NULL,
  revoked_at    DATETIME2(3)     NULL,
  last_seen_at  DATETIME2(3)     NOT NULL CONSTRAINT df_sessions_seen DEFAULT SYSUTCDATETIME(),
  ip            NVARCHAR(64)     NULL,
  user_agent    NVARCHAR(300)    NULL,
  created_at    DATETIME2(3)     NOT NULL CONSTRAINT df_sessions_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_sessions PRIMARY KEY (id),
  CONSTRAINT uq_sessions_token UNIQUE (token_hash),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES dbo.users (id) ON DELETE CASCADE,
  CONSTRAINT ck_sessions_audience CHECK (audience IN ('customer', 'vendor', 'admin'))
);
CREATE INDEX ix_sessions_user ON dbo.sessions (user_id);

-- ───────────────────────────── Reference data ─────────────────────────────

CREATE TABLE dbo.occasions (
  id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_occasions_id DEFAULT NEWSEQUENTIALID(),
  slug         NVARCHAR(64)     NOT NULL,
  name         NVARCHAR(100)    NOT NULL,
  description  NVARCHAR(500)    NOT NULL,
  sort_order   INT              NOT NULL CONSTRAINT df_occasions_sort DEFAULT 0,
  created_at   DATETIME2(3)     NOT NULL CONSTRAINT df_occasions_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_occasions PRIMARY KEY (id),
  CONSTRAINT uq_occasions_slug UNIQUE (slug)
);

CREATE TABLE dbo.categories (
  id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_categories_id DEFAULT NEWSEQUENTIALID(),
  slug             NVARCHAR(64)     NOT NULL,
  name             NVARCHAR(100)    NOT NULL,
  description      NVARCHAR(500)    NOT NULL CONSTRAINT df_categories_desc DEFAULT N'',
  requires_fssai   BIT              NOT NULL CONSTRAINT df_categories_fssai DEFAULT 0,
  default_tax_bps  INT              NOT NULL CONSTRAINT df_categories_tax DEFAULT 1800, -- GST hint for vendors
  sort_order       INT              NOT NULL CONSTRAINT df_categories_sort DEFAULT 0,
  created_at       DATETIME2(3)     NOT NULL CONSTRAINT df_categories_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_categories PRIMARY KEY (id),
  CONSTRAINT uq_categories_slug UNIQUE (slug)
);

CREATE TABLE dbo.service_areas (
  id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_service_areas_id DEFAULT NEWSEQUENTIALID(),
  slug        NVARCHAR(100)    NOT NULL,
  name        NVARCHAR(100)    NOT NULL,
  city        NVARCHAR(80)     NOT NULL,
  is_active   BIT              NOT NULL CONSTRAINT df_service_areas_active DEFAULT 1,
  created_at  DATETIME2(3)     NOT NULL CONSTRAINT df_service_areas_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_service_areas PRIMARY KEY (id),
  CONSTRAINT uq_service_areas_slug UNIQUE (slug),
  CONSTRAINT uq_service_areas_city_name UNIQUE (city, name)
);

/* Rate cards for the indicative budget estimator. food_preference NULL = default rate.
   SQL Server unique constraints treat NULLs as equal, so there is one default rate per category. */
CREATE TABLE dbo.budget_rates (
  id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_budget_rates_id DEFAULT NEWSEQUENTIALID(),
  category_id      UNIQUEIDENTIFIER NOT NULL,
  unit             NVARCHAR(20)     NOT NULL,
  low_paise        INT              NOT NULL,
  high_paise       INT              NOT NULL,
  food_preference  NVARCHAR(20)     NULL,
  updated_at       DATETIME2(3)     NOT NULL CONSTRAINT df_budget_rates_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_budget_rates PRIMARY KEY (id),
  CONSTRAINT uq_budget_rates_category_food UNIQUE (category_id, food_preference),
  CONSTRAINT fk_budget_rates_category FOREIGN KEY (category_id) REFERENCES dbo.categories (id) ON DELETE CASCADE,
  CONSTRAINT ck_budget_rates_unit CHECK (unit IN ('PER_GUEST', 'FLAT', 'PER_50_GUESTS')),
  CONSTRAINT ck_budget_rates_range CHECK (low_paise >= 0 AND high_paise >= low_paise),
  CONSTRAINT ck_budget_rates_food CHECK (food_preference IS NULL OR food_preference IN ('VEG', 'NON_VEG', 'JAIN', 'MIXED', 'NOT_APPLICABLE'))
);

-- ───────────────────────────── Vendors ─────────────────────────────

CREATE TABLE dbo.vendors (
  id                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_vendors_id DEFAULT NEWSEQUENTIALID(),
  slug                NVARCHAR(100)    NOT NULL,
  business_name       NVARCHAR(150)    NOT NULL,
  description         NVARCHAR(3000)   NOT NULL CONSTRAINT df_vendors_desc DEFAULT N'',
  phone               NVARCHAR(20)     NOT NULL,
  city                NVARCHAR(80)     NOT NULL CONSTRAINT df_vendors_city DEFAULT N'Greater Noida',
  address_line        NVARCHAR(300)    NOT NULL CONSTRAINT df_vendors_address DEFAULT N'',
  gstin               NVARCHAR(15)     NULL,
  fssai_number        NVARCHAR(14)     NULL,
  max_events_per_day  INT              NOT NULL CONSTRAINT df_vendors_capacity DEFAULT 2,
  status              NVARCHAR(20)     NOT NULL CONSTRAINT df_vendors_status DEFAULT N'DRAFT',
  is_demo             BIT              NOT NULL CONSTRAINT df_vendors_demo DEFAULT 0,
  submitted_at        DATETIME2(3)     NULL,
  approved_at         DATETIME2(3)     NULL,
  created_at          DATETIME2(3)     NOT NULL CONSTRAINT df_vendors_created DEFAULT SYSUTCDATETIME(),
  updated_at          DATETIME2(3)     NOT NULL CONSTRAINT df_vendors_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_vendors PRIMARY KEY (id),
  CONSTRAINT uq_vendors_slug UNIQUE (slug),
  CONSTRAINT ck_vendors_status CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  CONSTRAINT ck_vendors_capacity CHECK (max_events_per_day BETWEEN 1 AND 50)
);
CREATE INDEX ix_vendors_status ON dbo.vendors (status);

CREATE TABLE dbo.vendor_members (
  vendor_id   UNIQUEIDENTIFIER NOT NULL,
  user_id     UNIQUEIDENTIFIER NOT NULL,
  role        NVARCHAR(10)     NOT NULL CONSTRAINT df_vendor_members_role DEFAULT N'OWNER',
  created_at  DATETIME2(3)     NOT NULL CONSTRAINT df_vendor_members_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_vendor_members PRIMARY KEY (vendor_id, user_id),
  CONSTRAINT fk_vendor_members_vendor FOREIGN KEY (vendor_id) REFERENCES dbo.vendors (id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_members_user FOREIGN KEY (user_id) REFERENCES dbo.users (id) ON DELETE CASCADE,
  CONSTRAINT ck_vendor_members_role CHECK (role IN ('OWNER', 'STAFF'))
);
CREATE INDEX ix_vendor_members_user ON dbo.vendor_members (user_id);

CREATE TABLE dbo.vendor_categories (
  vendor_id    UNIQUEIDENTIFIER NOT NULL,
  category_id  UNIQUEIDENTIFIER NOT NULL,
  CONSTRAINT pk_vendor_categories PRIMARY KEY (vendor_id, category_id),
  CONSTRAINT fk_vendor_categories_vendor FOREIGN KEY (vendor_id) REFERENCES dbo.vendors (id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_categories_category FOREIGN KEY (category_id) REFERENCES dbo.categories (id)
);
CREATE INDEX ix_vendor_categories_category ON dbo.vendor_categories (category_id);

CREATE TABLE dbo.vendor_service_areas (
  vendor_id        UNIQUEIDENTIFIER NOT NULL,
  service_area_id  UNIQUEIDENTIFIER NOT NULL,
  CONSTRAINT pk_vendor_service_areas PRIMARY KEY (vendor_id, service_area_id),
  CONSTRAINT fk_vsa_vendor FOREIGN KEY (vendor_id) REFERENCES dbo.vendors (id) ON DELETE CASCADE,
  CONSTRAINT fk_vsa_area FOREIGN KEY (service_area_id) REFERENCES dbo.service_areas (id)
);
CREATE INDEX ix_vendor_service_areas_area ON dbo.vendor_service_areas (service_area_id);

CREATE TABLE dbo.vendor_verification_reviews (
  id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_vvr_id DEFAULT NEWSEQUENTIALID(),
  vendor_id    UNIQUEIDENTIFIER NOT NULL,
  reviewer_id  UNIQUEIDENTIFIER NOT NULL,
  decision     NVARCHAR(10)     NOT NULL,
  from_status  NVARCHAR(20)     NOT NULL,
  to_status    NVARCHAR(20)     NOT NULL,
  notes        NVARCHAR(1000)   NOT NULL CONSTRAINT df_vvr_notes DEFAULT N'',
  created_at   DATETIME2(3)     NOT NULL CONSTRAINT df_vvr_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_vendor_verification_reviews PRIMARY KEY (id),
  CONSTRAINT fk_vvr_vendor FOREIGN KEY (vendor_id) REFERENCES dbo.vendors (id) ON DELETE CASCADE,
  CONSTRAINT fk_vvr_reviewer FOREIGN KEY (reviewer_id) REFERENCES dbo.users (id)
);
CREATE INDEX ix_vvr_vendor ON dbo.vendor_verification_reviews (vendor_id);

-- ───────────────────────────── Catalogue ─────────────────────────────

/* Services, packages and menus. Admin approval is required before anything is public. */
CREATE TABLE dbo.listings (
  id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_listings_id DEFAULT NEWSEQUENTIALID(),
  vendor_id        UNIQUEIDENTIFIER NOT NULL,
  category_id      UNIQUEIDENTIFIER NOT NULL,
  title            NVARCHAR(150)    NOT NULL,
  description      NVARCHAR(MAX)    NOT NULL,
  type             NVARCHAR(10)     NOT NULL,
  pricing_mode     NVARCHAR(10)     NOT NULL,
  price_paise      INT              NULL,
  min_guests       INT              NULL,
  max_guests       INT              NULL,
  food_preference  NVARCHAR(20)     NOT NULL CONSTRAINT df_listings_food DEFAULT N'NOT_APPLICABLE',
  inclusions       NVARCHAR(MAX)    NOT NULL CONSTRAINT df_listings_inclusions DEFAULT N'[]',
  status           NVARCHAR(20)     NOT NULL CONSTRAINT df_listings_status DEFAULT N'DRAFT',
  is_demo          BIT              NOT NULL CONSTRAINT df_listings_demo DEFAULT 0,
  submitted_at     DATETIME2(3)     NULL,
  approved_at      DATETIME2(3)     NULL,
  created_at       DATETIME2(3)     NOT NULL CONSTRAINT df_listings_created DEFAULT SYSUTCDATETIME(),
  updated_at       DATETIME2(3)     NOT NULL CONSTRAINT df_listings_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_listings PRIMARY KEY (id),
  CONSTRAINT fk_listings_vendor FOREIGN KEY (vendor_id) REFERENCES dbo.vendors (id) ON DELETE CASCADE,
  CONSTRAINT fk_listings_category FOREIGN KEY (category_id) REFERENCES dbo.categories (id),
  CONSTRAINT ck_listings_type CHECK (type IN ('SERVICE', 'PACKAGE', 'MENU')),
  CONSTRAINT ck_listings_pricing CHECK (pricing_mode IN ('FIXED', 'PER_GUEST', 'ON_QUOTE')),
  CONSTRAINT ck_listings_food CHECK (food_preference IN ('VEG', 'NON_VEG', 'JAIN', 'MIXED', 'NOT_APPLICABLE')),
  CONSTRAINT ck_listings_status CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  CONSTRAINT ck_listings_price CHECK (price_paise IS NULL OR price_paise >= 0),
  CONSTRAINT ck_listings_inclusions_json CHECK (ISJSON(inclusions) = 1)
);
CREATE INDEX ix_listings_status_category ON dbo.listings (status, category_id);
CREATE INDEX ix_listings_vendor ON dbo.listings (vendor_id);

CREATE TABLE dbo.listing_occasions (
  listing_id   UNIQUEIDENTIFIER NOT NULL,
  occasion_id  UNIQUEIDENTIFIER NOT NULL,
  CONSTRAINT pk_listing_occasions PRIMARY KEY (listing_id, occasion_id),
  CONSTRAINT fk_listing_occasions_listing FOREIGN KEY (listing_id) REFERENCES dbo.listings (id) ON DELETE CASCADE,
  CONSTRAINT fk_listing_occasions_occasion FOREIGN KEY (occasion_id) REFERENCES dbo.occasions (id)
);
CREATE INDEX ix_listing_occasions_occasion ON dbo.listing_occasions (occasion_id);

CREATE TABLE dbo.moderation_actions (
  id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_moderation_actions_id DEFAULT NEWSEQUENTIALID(),
  listing_id    UNIQUEIDENTIFIER NOT NULL,
  moderator_id  UNIQUEIDENTIFIER NOT NULL,
  decision      NVARCHAR(10)     NOT NULL,
  from_status   NVARCHAR(20)     NOT NULL,
  to_status     NVARCHAR(20)     NOT NULL,
  notes         NVARCHAR(1000)   NOT NULL CONSTRAINT df_moderation_actions_notes DEFAULT N'',
  created_at    DATETIME2(3)     NOT NULL CONSTRAINT df_moderation_actions_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_moderation_actions PRIMARY KEY (id),
  CONSTRAINT fk_moderation_actions_listing FOREIGN KEY (listing_id) REFERENCES dbo.listings (id) ON DELETE CASCADE,
  CONSTRAINT fk_moderation_actions_moderator FOREIGN KEY (moderator_id) REFERENCES dbo.users (id)
);
CREATE INDEX ix_moderation_actions_listing ON dbo.moderation_actions (listing_id);

-- ───────────────────────── Event requests & quotes ─────────────────────────

/* A customer's request for quotes. */
CREATE TABLE dbo.event_requests (
  id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_event_requests_id DEFAULT NEWSEQUENTIALID(),
  reference        NVARCHAR(20)     NOT NULL,
  customer_id      UNIQUEIDENTIFIER NOT NULL,
  occasion_id      UNIQUEIDENTIFIER NOT NULL,
  service_area_id  UNIQUEIDENTIFIER NOT NULL,
  title            NVARCHAR(120)    NOT NULL CONSTRAINT df_event_requests_title DEFAULT N'',
  event_date       DATE             NOT NULL,
  event_time       NVARCHAR(5)      NULL,
  venue_address    NVARCHAR(300)    NOT NULL CONSTRAINT df_event_requests_venue DEFAULT N'',
  guest_count      INT              NOT NULL,
  budget_paise     INT              NOT NULL,
  food_preference  NVARCHAR(20)     NOT NULL,
  notes            NVARCHAR(2000)   NOT NULL CONSTRAINT df_event_requests_notes DEFAULT N'',
  status           NVARCHAR(20)     NOT NULL CONSTRAINT df_event_requests_status DEFAULT N'OPEN',
  created_at       DATETIME2(3)     NOT NULL CONSTRAINT df_event_requests_created DEFAULT SYSUTCDATETIME(),
  updated_at       DATETIME2(3)     NOT NULL CONSTRAINT df_event_requests_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_event_requests PRIMARY KEY (id),
  CONSTRAINT uq_event_requests_reference UNIQUE (reference),
  CONSTRAINT fk_event_requests_customer FOREIGN KEY (customer_id) REFERENCES dbo.users (id),
  CONSTRAINT fk_event_requests_occasion FOREIGN KEY (occasion_id) REFERENCES dbo.occasions (id),
  CONSTRAINT fk_event_requests_area FOREIGN KEY (service_area_id) REFERENCES dbo.service_areas (id),
  CONSTRAINT ck_event_requests_status CHECK (status IN ('OPEN', 'ACCEPTED', 'CANCELLED', 'EXPIRED')),
  CONSTRAINT ck_event_requests_food CHECK (food_preference IN ('VEG', 'NON_VEG', 'JAIN', 'MIXED', 'NOT_APPLICABLE')),
  CONSTRAINT ck_event_requests_guests CHECK (guest_count > 0),
  CONSTRAINT ck_event_requests_budget CHECK (budget_paise >= 0)
);
CREATE INDEX ix_event_requests_customer ON dbo.event_requests (customer_id, created_at);
CREATE INDEX ix_event_requests_status_date ON dbo.event_requests (status, event_date);

CREATE TABLE dbo.event_request_categories (
  event_request_id  UNIQUEIDENTIFIER NOT NULL,
  category_id       UNIQUEIDENTIFIER NOT NULL,
  CONSTRAINT pk_event_request_categories PRIMARY KEY (event_request_id, category_id),
  CONSTRAINT fk_erc_request FOREIGN KEY (event_request_id) REFERENCES dbo.event_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_erc_category FOREIGN KEY (category_id) REFERENCES dbo.categories (id)
);

/* One vendor's thread for one event request. Prices live in immutable revisions. */
CREATE TABLE dbo.quotes (
  id                   UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_quotes_id DEFAULT NEWSEQUENTIALID(),
  event_request_id     UNIQUEIDENTIFIER NOT NULL,
  vendor_id            UNIQUEIDENTIFIER NOT NULL,
  status               NVARCHAR(20)     NOT NULL CONSTRAINT df_quotes_status DEFAULT N'REQUESTED',
  current_revision_id  UNIQUEIDENTIFIER NULL,  -- FK added below, after quote_revisions exists
  decline_reason       NVARCHAR(500)    NULL,
  created_at           DATETIME2(3)     NOT NULL CONSTRAINT df_quotes_created DEFAULT SYSUTCDATETIME(),
  updated_at           DATETIME2(3)     NOT NULL CONSTRAINT df_quotes_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_quotes PRIMARY KEY (id),
  CONSTRAINT uq_quotes_request_vendor UNIQUE (event_request_id, vendor_id),
  CONSTRAINT fk_quotes_request FOREIGN KEY (event_request_id) REFERENCES dbo.event_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_quotes_vendor FOREIGN KEY (vendor_id) REFERENCES dbo.vendors (id),
  CONSTRAINT ck_quotes_status CHECK (status IN ('REQUESTED', 'VENDOR_REVIEWING', 'QUOTED', 'REVISED', 'ACCEPTED',
                                                'DECLINED', 'REJECTED', 'NOT_SELECTED', 'WITHDRAWN', 'EXPIRED'))
);
CREATE INDEX ix_quotes_vendor_status ON dbo.quotes (vendor_id, status);

/* Immutable. Any change is a new revision with the next revision_number. */
CREATE TABLE dbo.quote_revisions (
  id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_quote_revisions_id DEFAULT NEWSEQUENTIALID(),
  quote_id         UNIQUEIDENTIFIER NOT NULL,
  revision_number  INT              NOT NULL,
  subtotal_paise   INT              NOT NULL,
  discount_paise   INT              NOT NULL,
  tax_bps          INT              NOT NULL,
  tax_paise        INT              NOT NULL,
  delivery_paise   INT              NOT NULL,
  total_paise      INT              NOT NULL,
  advance_bps      INT              NOT NULL,
  advance_paise    INT              NOT NULL,
  inclusions       NVARCHAR(MAX)    NOT NULL CONSTRAINT df_quote_revisions_incl DEFAULT N'[]',
  exclusions       NVARCHAR(MAX)    NOT NULL CONSTRAINT df_quote_revisions_excl DEFAULT N'[]',
  terms            NVARCHAR(3000)   NOT NULL CONSTRAINT df_quote_revisions_terms DEFAULT N'',
  notes            NVARCHAR(2000)   NOT NULL CONSTRAINT df_quote_revisions_notes DEFAULT N'',
  valid_until      DATE             NOT NULL,
  created_by_id    UNIQUEIDENTIFIER NOT NULL,
  created_at       DATETIME2(3)     NOT NULL CONSTRAINT df_quote_revisions_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_quote_revisions PRIMARY KEY (id),
  CONSTRAINT uq_quote_revisions_number UNIQUE (quote_id, revision_number),
  CONSTRAINT fk_quote_revisions_quote FOREIGN KEY (quote_id) REFERENCES dbo.quotes (id) ON DELETE CASCADE,
  CONSTRAINT fk_quote_revisions_creator FOREIGN KEY (created_by_id) REFERENCES dbo.users (id),
  CONSTRAINT ck_quote_revisions_totals CHECK (total_paise >= 0 AND advance_paise <= total_paise AND advance_bps BETWEEN 0 AND 10000),
  CONSTRAINT ck_quote_revisions_incl_json CHECK (ISJSON(inclusions) = 1),
  CONSTRAINT ck_quote_revisions_excl_json CHECK (ISJSON(exclusions) = 1)
);

-- NO ACTION: a cascading action here would create a cycle (quotes ⇄ quote_revisions).
ALTER TABLE dbo.quotes ADD CONSTRAINT fk_quotes_current_revision
  FOREIGN KEY (current_revision_id) REFERENCES dbo.quote_revisions (id);

CREATE TABLE dbo.quote_items (
  id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_quote_items_id DEFAULT NEWSEQUENTIALID(),
  revision_id       UNIQUEIDENTIFIER NOT NULL,
  position          INT              NOT NULL,
  description       NVARCHAR(200)    NOT NULL,
  quantity          INT              NOT NULL,
  unit_price_paise  INT              NOT NULL,
  line_total_paise  INT              NOT NULL,
  CONSTRAINT pk_quote_items PRIMARY KEY (id),
  CONSTRAINT uq_quote_items_position UNIQUE (revision_id, position),
  CONSTRAINT fk_quote_items_revision FOREIGN KEY (revision_id) REFERENCES dbo.quote_revisions (id) ON DELETE CASCADE,
  CONSTRAINT ck_quote_items_positive CHECK (quantity > 0 AND unit_price_paise >= 0)
);

-- ───────────────────────────── Orders ─────────────────────────────

CREATE TABLE dbo.orders (
  id                    UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_orders_id DEFAULT NEWSEQUENTIALID(),
  order_number          NVARCHAR(20)     NOT NULL,
  mode                  NVARCHAR(10)     NOT NULL CONSTRAINT df_orders_mode DEFAULT N'QUOTE',
  customer_id           UNIQUEIDENTIFIER NOT NULL,
  vendor_id             UNIQUEIDENTIFIER NOT NULL,
  event_request_id      UNIQUEIDENTIFIER NULL,
  quote_id              UNIQUEIDENTIFIER NULL,
  accepted_revision_id  UNIQUEIDENTIFIER NULL,
  status                NVARCHAR(25)     NOT NULL CONSTRAINT df_orders_status DEFAULT N'PENDING_CONFIRMATION',
  event_date            DATE             NOT NULL,
  guest_count           INT              NOT NULL,
  subtotal_paise        INT              NOT NULL,
  discount_paise        INT              NOT NULL,
  tax_paise             INT              NOT NULL,
  delivery_paise        INT              NOT NULL,
  total_paise           INT              NOT NULL,
  advance_paise         INT              NOT NULL,
  commission_bps        INT              NOT NULL,
  commission_paise      INT              NOT NULL,
  vendor_payable_paise  INT              NOT NULL,
  paid_paise            INT              NOT NULL CONSTRAINT df_orders_paid DEFAULT 0,
  snapshot              NVARCHAR(MAX)    NOT NULL,  -- durable copy of the accepted revision, event, vendor and terms
  is_demo               BIT              NOT NULL CONSTRAINT df_orders_demo DEFAULT 0,
  cancel_reason         NVARCHAR(500)    NULL,
  created_at            DATETIME2(3)     NOT NULL CONSTRAINT df_orders_created DEFAULT SYSUTCDATETIME(),
  updated_at            DATETIME2(3)     NOT NULL CONSTRAINT df_orders_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_orders PRIMARY KEY (id),
  CONSTRAINT uq_orders_number UNIQUE (order_number),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES dbo.users (id),
  CONSTRAINT fk_orders_vendor FOREIGN KEY (vendor_id) REFERENCES dbo.vendors (id),
  CONSTRAINT fk_orders_request FOREIGN KEY (event_request_id) REFERENCES dbo.event_requests (id),
  CONSTRAINT fk_orders_quote FOREIGN KEY (quote_id) REFERENCES dbo.quotes (id),
  CONSTRAINT fk_orders_revision FOREIGN KEY (accepted_revision_id) REFERENCES dbo.quote_revisions (id),
  CONSTRAINT ck_orders_mode CHECK (mode IN ('QUOTE', 'INSTANT')),
  CONSTRAINT ck_orders_status CHECK (status IN ('PENDING_CONFIRMATION', 'PAYMENT_PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT ck_orders_amounts CHECK (total_paise >= 0 AND paid_paise >= 0 AND commission_paise >= 0),
  CONSTRAINT ck_orders_snapshot_json CHECK (ISJSON(snapshot) = 1)
);
-- A request, quote or revision can produce at most one order. Filtered so many NULLs are allowed.
CREATE UNIQUE INDEX uq_orders_event_request ON dbo.orders (event_request_id) WHERE event_request_id IS NOT NULL;
CREATE UNIQUE INDEX uq_orders_quote ON dbo.orders (quote_id) WHERE quote_id IS NOT NULL;
CREATE UNIQUE INDEX uq_orders_accepted_revision ON dbo.orders (accepted_revision_id) WHERE accepted_revision_id IS NOT NULL;
CREATE INDEX ix_orders_vendor_date_status ON dbo.orders (vendor_id, event_date, status);
CREATE INDEX ix_orders_customer ON dbo.orders (customer_id, created_at);
CREATE INDEX ix_orders_status_date ON dbo.orders (status, event_date);

/* Append-only order timeline used for tracking and audit. */
CREATE TABLE dbo.order_events (
  id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_order_events_id DEFAULT NEWSEQUENTIALID(),
  order_id     UNIQUEIDENTIFIER NOT NULL,
  actor_id     UNIQUEIDENTIFIER NULL,
  actor_role   NVARCHAR(10)     NOT NULL,
  action       NVARCHAR(40)     NOT NULL,
  from_status  NVARCHAR(25)     NULL,
  to_status    NVARCHAR(25)     NOT NULL,
  note         NVARCHAR(600)    NOT NULL CONSTRAINT df_order_events_note DEFAULT N'',
  created_at   DATETIME2(3)     NOT NULL CONSTRAINT df_order_events_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_order_events PRIMARY KEY (id),
  CONSTRAINT fk_order_events_order FOREIGN KEY (order_id) REFERENCES dbo.orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_events_actor FOREIGN KEY (actor_id) REFERENCES dbo.users (id)
);
CREATE INDEX ix_order_events_order ON dbo.order_events (order_id, created_at);

/* Payments. The MVP records MANUAL (admin-verified offline) payments only.
   idempotency_key is unique for safe replay handling (provider event ids in Phase 2). */
CREATE TABLE dbo.payments (
  id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_payments_id DEFAULT NEWSEQUENTIALID(),
  order_id         UNIQUEIDENTIFIER NOT NULL,
  provider         NVARCHAR(10)     NOT NULL,
  kind             NVARCHAR(10)     NOT NULL,
  status           NVARCHAR(10)     NOT NULL,
  method           NVARCHAR(20)     NULL,
  amount_paise     INT              NOT NULL,
  reference        NVARCHAR(100)    NOT NULL,
  idempotency_key  NVARCHAR(200)    NOT NULL,
  received_on      DATE             NULL,
  notes            NVARCHAR(500)    NOT NULL CONSTRAINT df_payments_notes DEFAULT N'',
  recorded_by_id   UNIQUEIDENTIFIER NULL,
  created_at       DATETIME2(3)     NOT NULL CONSTRAINT df_payments_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_payments PRIMARY KEY (id),
  CONSTRAINT uq_payments_idempotency UNIQUE (idempotency_key),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES dbo.orders (id),
  CONSTRAINT fk_payments_recorder FOREIGN KEY (recorded_by_id) REFERENCES dbo.users (id),
  CONSTRAINT ck_payments_provider CHECK (provider IN ('MANUAL', 'SANDBOX')),
  CONSTRAINT ck_payments_kind CHECK (kind IN ('ADVANCE', 'BALANCE', 'FULL')),
  CONSTRAINT ck_payments_status CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT ck_payments_method CHECK (method IS NULL OR method IN ('UPI', 'BANK_TRANSFER', 'CASH', 'CHEQUE')),
  CONSTRAINT ck_payments_amount CHECK (amount_paise > 0)
);
CREATE INDEX ix_payments_order ON dbo.payments (order_id);

-- ───────────────────────────── Settings ─────────────────────────────

/* Commission rules. Most specific wins: vendor > category > default (both NULL).
   SQL Server unique constraints treat NULLs as equal, so each scope has exactly one rule. */
CREATE TABLE dbo.commission_rules (
  id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_commission_rules_id DEFAULT NEWSEQUENTIALID(),
  vendor_id    UNIQUEIDENTIFIER NULL,
  category_id  UNIQUEIDENTIFIER NULL,
  bps          INT              NOT NULL,
  updated_at   DATETIME2(3)     NOT NULL CONSTRAINT df_commission_rules_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_commission_rules PRIMARY KEY (id),
  CONSTRAINT uq_commission_rules_scope UNIQUE (vendor_id, category_id),
  CONSTRAINT fk_commission_rules_vendor FOREIGN KEY (vendor_id) REFERENCES dbo.vendors (id) ON DELETE CASCADE,
  CONSTRAINT fk_commission_rules_category FOREIGN KEY (category_id) REFERENCES dbo.categories (id) ON DELETE CASCADE,
  CONSTRAINT ck_commission_rules_bps CHECK (bps BETWEEN 0 AND 5000)
);

-- ───────────────────────────── Operations ─────────────────────────────

CREATE TABLE dbo.notifications (
  id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_notifications_id DEFAULT NEWSEQUENTIALID(),
  user_id     UNIQUEIDENTIFIER NOT NULL,
  type        NVARCHAR(40)     NOT NULL,
  title       NVARCHAR(200)    NOT NULL,
  body        NVARCHAR(1000)   NOT NULL,
  link        NVARCHAR(300)    NULL,
  read_at     DATETIME2(3)     NULL,
  created_at  DATETIME2(3)     NOT NULL CONSTRAINT df_notifications_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_notifications PRIMARY KEY (id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES dbo.users (id) ON DELETE CASCADE
);
CREATE INDEX ix_notifications_user_read ON dbo.notifications (user_id, read_at);

/* Transactional outbox — written in the same transaction as the business change. */
CREATE TABLE dbo.outbox_events (
  id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_outbox_events_id DEFAULT NEWSEQUENTIALID(),
  type          NVARCHAR(40)     NOT NULL,
  payload       NVARCHAR(MAX)    NOT NULL,
  attempts      INT              NOT NULL CONSTRAINT df_outbox_events_attempts DEFAULT 0,
  last_error    NVARCHAR(500)    NULL,
  processed_at  DATETIME2(3)     NULL,
  created_at    DATETIME2(3)     NOT NULL CONSTRAINT df_outbox_events_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_outbox_events PRIMARY KEY (id),
  CONSTRAINT ck_outbox_events_payload_json CHECK (ISJSON(payload) = 1)
);
CREATE INDEX ix_outbox_pending ON dbo.outbox_events (processed_at, created_at);

CREATE TABLE dbo.audit_logs (
  id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_audit_logs_id DEFAULT NEWSEQUENTIALID(),
  actor_id     UNIQUEIDENTIFIER NULL,
  actor_role   NVARCHAR(10)     NULL,
  action       NVARCHAR(60)     NOT NULL,
  entity_type  NVARCHAR(30)     NOT NULL,
  entity_id    NVARCHAR(64)     NOT NULL,
  metadata     NVARCHAR(MAX)    NOT NULL CONSTRAINT df_audit_logs_metadata DEFAULT N'{}',
  ip           NVARCHAR(64)     NULL,
  created_at   DATETIME2(3)     NOT NULL CONSTRAINT df_audit_logs_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_audit_logs PRIMARY KEY (id),
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_id) REFERENCES dbo.users (id),
  CONSTRAINT ck_audit_logs_metadata_json CHECK (ISJSON(metadata) = 1)
);
CREATE INDEX ix_audit_logs_entity ON dbo.audit_logs (entity_type, entity_id);
CREATE INDEX ix_audit_logs_created ON dbo.audit_logs (created_at);
