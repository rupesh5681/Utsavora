CREATE TYPE "public"."admin_permission" AS ENUM('VENDORS_REVIEW', 'LISTINGS_MODERATE', 'ORDERS_MANAGE', 'PAYMENTS_RECORD', 'SETTINGS_MANAGE', 'AUDIT_VIEW');--> statement-breakpoint
CREATE TYPE "public"."event_request_status" AS ENUM('OPEN', 'ACCEPTED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."food_preference" AS ENUM('VEG', 'NON_VEG', 'JAIN', 'MIXED', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."listing_type" AS ENUM('SERVICE', 'PACKAGE', 'MENU');--> statement-breakpoint
CREATE TYPE "public"."order_mode" AS ENUM('QUOTE', 'INSTANT');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING_CONFIRMATION', 'PAYMENT_PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('ADVANCE', 'BALANCE', 'FULL');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('UPI', 'BANK_TRANSFER', 'CASH', 'CHEQUE');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('MANUAL', 'SANDBOX');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."pricing_mode" AS ENUM('FIXED', 'PER_GUEST', 'ON_QUOTE');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('REQUESTED', 'VENDOR_REVIEWING', 'QUOTED', 'REVISED', 'ACCEPTED', 'DECLINED', 'REJECTED', 'NOT_SELECTED', 'WITHDRAWN', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."rate_unit" AS ENUM('PER_GUEST', 'FLAT', 'PER_50_GUESTS');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('CUSTOMER', 'VENDOR', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."vendor_member_role" AS ENUM('OWNER', 'STAFF');--> statement-breakpoint
CREATE TYPE "public"."vendor_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"unit" "rate_unit" NOT NULL,
	"low_paise" integer NOT NULL,
	"high_paise" integer NOT NULL,
	"food_preference" "food_preference",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_rates_category_food_key" UNIQUE NULLS NOT DISTINCT("category_id","food_preference"),
	CONSTRAINT "budget_rates_range" CHECK ("budget_rates"."low_paise" >= 0 AND "budget_rates"."high_paise" >= "budget_rates"."low_paise")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"requires_fssai" boolean DEFAULT false NOT NULL,
	"default_tax_bps" integer DEFAULT 1800 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid,
	"category_id" uuid,
	"bps" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rules_scope_key" UNIQUE NULLS NOT DISTINCT("vendor_id","category_id"),
	CONSTRAINT "commission_rules_bps" CHECK ("commission_rules"."bps" BETWEEN 0 AND 5000)
);
--> statement-breakpoint
CREATE TABLE "event_request_categories" (
	"event_request_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "event_request_categories_event_request_id_category_id_pk" PRIMARY KEY("event_request_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "event_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"occasion_id" uuid NOT NULL,
	"service_area_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"event_date" date NOT NULL,
	"event_time" text,
	"venue_address" text DEFAULT '' NOT NULL,
	"guest_count" integer NOT NULL,
	"budget_paise" integer NOT NULL,
	"food_preference" "food_preference" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" "event_request_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_requests_guests" CHECK ("event_requests"."guest_count" > 0),
	CONSTRAINT "event_requests_budget" CHECK ("event_requests"."budget_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "listing_occasions" (
	"listing_id" uuid NOT NULL,
	"occasion_id" uuid NOT NULL,
	CONSTRAINT "listing_occasions_listing_id_occasion_id_pk" PRIMARY KEY("listing_id","occasion_id")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"type" "listing_type" NOT NULL,
	"pricing_mode" "pricing_mode" NOT NULL,
	"price_paise" integer,
	"min_guests" integer,
	"max_guests" integer,
	"food_preference" "food_preference" DEFAULT 'NOT_APPLICABLE' NOT NULL,
	"inclusions" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "listing_status" DEFAULT 'DRAFT' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_price_nonneg" CHECK ("listings"."price_paise" IS NULL OR "listings"."price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"moderator_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"from_status" "listing_status" NOT NULL,
	"to_status" "listing_status" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occasions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"mode" "order_mode" DEFAULT 'QUOTE' NOT NULL,
	"customer_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"event_request_id" uuid,
	"quote_id" uuid,
	"accepted_revision_id" uuid,
	"status" "order_status" DEFAULT 'PENDING_CONFIRMATION' NOT NULL,
	"event_date" date NOT NULL,
	"guest_count" integer NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"discount_paise" integer NOT NULL,
	"tax_paise" integer NOT NULL,
	"delivery_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"advance_paise" integer NOT NULL,
	"commission_bps" integer NOT NULL,
	"commission_paise" integer NOT NULL,
	"vendor_payable_paise" integer NOT NULL,
	"paid_paise" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_amounts" CHECK ("orders"."total_paise" >= 0 AND "orders"."paid_paise" >= 0 AND "orders"."commission_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"status" "payment_status" NOT NULL,
	"method" "payment_method",
	"amount_paise" integer NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"received_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"line_total_paise" integer NOT NULL,
	CONSTRAINT "quote_items_positive" CHECK ("quote_items"."quantity" > 0 AND "quote_items"."unit_price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"discount_paise" integer NOT NULL,
	"tax_bps" integer NOT NULL,
	"tax_paise" integer NOT NULL,
	"delivery_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"advance_bps" integer NOT NULL,
	"advance_paise" integer NOT NULL,
	"inclusions" text[] DEFAULT '{}'::text[] NOT NULL,
	"exclusions" text[] DEFAULT '{}'::text[] NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"valid_until" date NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_revisions_totals" CHECK ("quote_revisions"."total_paise" >= 0 AND "quote_revisions"."advance_paise" <= "quote_revisions"."total_paise" AND "quote_revisions"."advance_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_request_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"status" "quote_status" DEFAULT 'REQUESTED' NOT NULL,
	"current_revision_id" uuid,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"audience" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_admin_permissions" (
	"user_id" uuid NOT NULL,
	"permission" "admin_permission" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_admin_permissions_user_id_permission_pk" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_categories" (
	"vendor_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "vendor_categories_vendor_id_category_id_pk" PRIMARY KEY("vendor_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_members" (
	"vendor_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "vendor_member_role" DEFAULT 'OWNER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_members_vendor_id_user_id_pk" PRIMARY KEY("vendor_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_service_areas" (
	"vendor_id" uuid NOT NULL,
	"service_area_id" uuid NOT NULL,
	CONSTRAINT "vendor_service_areas_vendor_id_service_area_id_pk" PRIMARY KEY("vendor_id","service_area_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_verification_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"from_status" "vendor_status" NOT NULL,
	"to_status" "vendor_status" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"business_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"city" text DEFAULT 'Greater Noida' NOT NULL,
	"address_line" text DEFAULT '' NOT NULL,
	"gstin" text,
	"fssai_number" text,
	"max_events_per_day" integer DEFAULT 2 NOT NULL,
	"status" "vendor_status" DEFAULT 'DRAFT' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_capacity" CHECK ("vendors"."max_events_per_day" BETWEEN 1 AND 50)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_rates" ADD CONSTRAINT "budget_rates_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_request_categories" ADD CONSTRAINT "event_request_categories_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_request_categories" ADD CONSTRAINT "event_request_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_occasions" ADD CONSTRAINT "listing_occasions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_occasions" ADD CONSTRAINT "listing_occasions_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderator_id_users_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_accepted_revision_id_quote_revisions_id_fk" FOREIGN KEY ("accepted_revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_revision_id_quote_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_current_revision_id_quote_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_admin_permissions" ADD CONSTRAINT "user_admin_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_categories" ADD CONSTRAINT "vendor_categories_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_categories" ADD CONSTRAINT "vendor_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_members" ADD CONSTRAINT "vendor_members_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_members" ADD CONSTRAINT "vendor_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_service_areas" ADD CONSTRAINT "vendor_service_areas_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_service_areas" ADD CONSTRAINT "vendor_service_areas_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_verification_reviews" ADD CONSTRAINT "vendor_verification_reviews_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_verification_reviews" ADD CONSTRAINT "vendor_verification_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "event_requests_reference_key" ON "event_requests" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "event_requests_customer_idx" ON "event_requests" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "event_requests_status_date_idx" ON "event_requests" USING btree ("status","event_date");--> statement-breakpoint
CREATE INDEX "listing_occasions_occasion_idx" ON "listing_occasions" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "listings_status_category_idx" ON "listings" USING btree ("status","category_id");--> statement-breakpoint
CREATE INDEX "listings_vendor_idx" ON "listings" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_listing_idx" ON "moderation_actions" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "occasions_slug_key" ON "occasions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_event_request_key" ON "orders" USING btree ("event_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_quote_key" ON "orders" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_accepted_revision_key" ON "orders" USING btree ("accepted_revision_id");--> statement-breakpoint
CREATE INDEX "orders_vendor_date_status_idx" ON "orders" USING btree ("vendor_id","event_date","status");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_date_idx" ON "orders" USING btree ("status","event_date");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("processed_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_items_revision_position_key" ON "quote_items" USING btree ("revision_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_revisions_quote_number_key" ON "quote_revisions" USING btree ("quote_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_request_vendor_key" ON "quotes" USING btree ("event_request_id","vendor_id");--> statement-breakpoint
CREATE INDEX "quotes_vendor_status_idx" ON "quotes" USING btree ("vendor_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_areas_slug_key" ON "service_areas" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "service_areas_city_name_key" ON "service_areas" USING btree ("city","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "vendor_categories_category_idx" ON "vendor_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "vendor_members_user_idx" ON "vendor_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vendor_service_areas_area_idx" ON "vendor_service_areas" USING btree ("service_area_id");--> statement-breakpoint
CREATE INDEX "vendor_reviews_vendor_idx" ON "vendor_verification_reviews" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_slug_key" ON "vendors" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "vendors_status_idx" ON "vendors" USING btree ("status");