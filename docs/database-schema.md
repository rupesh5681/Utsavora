# Database schema

Microsoft SQL Server 2022 (also compatible with Azure SQL Database). Source of truth: the T-SQL files in `apps/api/migrations/`, applied in filename order by `pnpm db:migrate` and recorded in `dbo.schema_migrations`. TypeScript table types live in `apps/api/src/db/types.ts`.

## Conventions

- `UNIQUEIDENTIFIER` primary keys with `NEWSEQUENTIALID()`; `DATETIME2(3)` UTC `created_at` / `updated_at` (set by the API on update).
- `NVARCHAR` for all text (Unicode: ₹, Hindi). Calendar dates (event date, quote validity, payment date) are `DATE`.
- **Money is integer paise** in `INT` columns (max about ₹2.1 crore per field; validation caps amounts at ₹2 crore). **Rates are basis points** (`500` = 5%).
- Status fields are `NVARCHAR` with `CHECK` constraints matching `packages/types/src/enums.ts`.
- Lists (inclusions, exclusions) and documents (order snapshot, audit metadata, outbox payload) are JSON in `NVARCHAR(MAX)` with `ISJSON` checks; query them with `JSON_VALUE` / `OPENJSON`.
- Names are `snake_case`; constraints are named (`pk_`, `fk_`, `uq_`, `ck_`, `df_`, `ix_`) so they are easy to find in SSMS.
- `is_demo` marks seeded demonstration vendors, listings and orders. Demo orders are labelled everywhere and excluded from admin money totals.
- Check constraints guard non-negative amounts, guest counts, capacity range, advance ≤ total.

## Tables

| Area | Tables |
| --- | --- |
| Identity | `users`, `user_roles`, `user_admin_permissions`, `sessions` |
| Reference | `occasions`, `categories`, `service_areas`, `budget_rates` |
| Vendors | `vendors`, `vendor_members`, `vendor_categories`, `vendor_service_areas`, `vendor_verification_reviews` |
| Catalogue | `listings`, `listing_occasions`, `moderation_actions` |
| Requests & quotes | `event_requests`, `event_request_categories`, `quotes`, `quote_revisions`, `quote_items` |
| Orders | `orders`, `order_events`, `payments` |
| Settings | `commission_rules` |
| Operations | `notifications`, `outbox_events`, `audit_logs` |

Tables from the brief that belong to later phases (packages, planner sessions, inventory, availability calendars and holds, carts, shipments, refunds, payouts, subscriptions, reviews, disputes) are **not created yet**; adding them is additive.

## Money representation

For a quote revision (computed only by `computeQuoteTotals` in `packages/types`):

```
subtotal = Σ quantity × unit_price
taxable  = subtotal − discount            (discount ≤ subtotal)
tax      = round_half_up(taxable × tax_bps / 10000)
total    = taxable + tax + delivery       (delivery is not taxed in the MVP)
advance  = round_half_up(total × advance_bps / 10000)
```

On acceptance the order copies these and adds:

```
commission      = round_half_up(taxable × commission_bps / 10000)   -- excludes GST and delivery
vendor_payable  = total − commission
paid            = Σ succeeded payments
```

Commission rule resolution: vendor-specific rule, else the rule for the request's primary category the vendor offers, else the platform default. The bps used is stored on the order, so later rule changes never alter existing orders. GST on the platform fee, TDS/TCS and payouts are Phase 2 items for the finance review.

## Important constraints

- `quotes (event_request_id, vendor_id)` unique — one thread per vendor per request.
- `quote_revisions (quote_id, revision_number)` unique; revisions are never updated.
- A request, quote or revision can produce at most one order (see the filtered indexes below).
- `payments.idempotency_key` unique — `manual:<method>:<REFERENCE>` today; provider event ids later, for safe webhook replay.
- `orders.event_request_id`, `quote_id` and `accepted_revision_id` use **filtered** unique indexes (`WHERE … IS NOT NULL`), because a plain SQL Server unique constraint allows only one NULL.
- `commission_rules (vendor_id, category_id)` and `budget_rates (category_id, food_preference)` are plain unique constraints: SQL Server treats NULLs as equal there, which is exactly "one default rule".
- Deletion rules: `ON DELETE CASCADE` only for pure child/link tables (roles, sessions, vendor categories/areas, listing occasions, quote revisions/items, order events, notifications). Everything else is `NO ACTION`, which avoids SQL Server's "multiple cascade paths" error; users are deactivated rather than deleted.
- `quotes.current_revision_id → quote_revisions` is `NO ACTION` because the two tables reference each other.

## Isolation and locking

- The migration runner enables `READ_COMMITTED_SNAPSHOT` (already on in Azure SQL Database), so ordinary reads use row versions and never block on writes. If the app's login lacks permission, run `ALTER DATABASE utsavora SET READ_COMMITTED_SNAPSHOT ON` once as a DBA.
- Rows that are about to change are read `WITH (UPDLOCK, ROWLOCK)`; capacity checks per vendor per day use `sp_getapplock` with `@LockOwner = 'Transaction'`; the outbox dispatcher claims events `WITH (UPDLOCK, READPAST, ROWLOCK)`.
- Deadlock victims (error 1205) and lock timeouts (1222) are returned to clients as `409 RETRY`.

## Adding a migration

Create the next file, e.g. `apps/api/migrations/0002_add_reviews.sql`, write T-SQL (use `GO` lines between batches if needed, as in SSMS), add matching types to `src/db/types.ts`, and run `pnpm db:migrate`. Never edit a migration that has already been applied anywhere; add a new one.
