# Architecture

Utsavora is a **modular monolith**: one NestJS API, one SQL Server database, and three Next.js web apps that share TypeScript packages. There are no microservices; module boundaries inside the API are where future services would split if load ever demands it.

```
                 ┌────────────── browsers ──────────────┐
                 │                │                     │
        customer-web :3000   vendor-portal :3001   admin-portal :3002     (Next.js 15, React 19)
                 │  /api/* same-origin proxy (rewrites) │
                 └────────────────┬─────────────────────┘
                                  ▼
                        api :4000  /v1/*  (NestJS 11)
     auth · catalogue · vendor · quotes(event requests) · orders · admin · notifications · health
                │                                   │
                ▼                                   ▼
     SQL Server 2022  ◄── transactional outbox ── background dispatcher (in-process)
```

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/api` | NestJS API. `migrations/*.sql` (T-SQL schema), `src/db/` (Kysely client, types, migration runner, seed), `test/` (end-to-end tests against SQL Server). |
| `apps/customer-web` | Customer marketplace: browse, plan, request quotes, compare, accept, track bookings. |
| `apps/vendor-portal` | Vendor onboarding, menus/packages, quote inbox and builder, bookings. |
| `apps/admin-portal` | Dashboard, vendor verification, listing moderation, requests, booking queue + CSV, payments, commission, audit, alerts. |
| `packages/types` | Enums, **state machines**, **money/pricing functions**, budget estimator. Single source of truth used by the API (enforcement) and UIs (display only). |
| `packages/validation` | Zod schemas for every request body. The API validates with them; forms reuse them for instant feedback. |
| `packages/api-client` | Typed fetch client and response types. |
| `packages/ui` | Design tokens (CSS), shared React components, data hooks, `OrderView`. |
| `packages/config` | Shared `tsconfig` bases. |
| `infrastructure/docker` | Dockerfiles and a compose stack. |
| `docs/` | This documentation and the generated `openapi.json`. |

## Key decisions

**SQL Server 2022 with Kysely.** The schema is hand-written T-SQL in `apps/api/migrations/`, applied in order by `pnpm db:migrate` and recorded in `dbo.schema_migrations`. Queries use Kysely (a typed SQL query builder) over the `tedious` driver, so what runs is plain, readable T-SQL; a few statements that need SQL Server hints are written as raw SQL. Table and column names are snake_case in the database and camelCase in TypeScript. The brief preferred PostgreSQL with Prisma; the team chose SQL Server because they already run it.

**Same-origin API proxy + per-app cookies.** Each Next.js app rewrites `/api/*` to the API. Sessions are opaque random tokens in `httpOnly`, `SameSite=Lax` cookies (`uts_customer`, `uts_vendor`, `uts_admin`); only a SHA-256 hash is stored. The `x-utsavora-app` header picks which cookie is read, so one browser can be signed in to all three apps without sessions bleeding across, and because the header is mandatory on writes and CORS is closed, it also blocks CSRF.

**Server-side everything.** Prices, totals, commission, state transitions, vendor isolation and permissions are computed or checked in the API. Shared packages let the UI preview the same maths, but the server recomputes and never trusts client totals. The test suite sends tampered totals to prove this.

**Immutable quote revisions and order snapshots.** A quote is a thread (`quotes`) of immutable `quote_revisions` + `quote_items`. Accepting requires the exact revision id the customer saw (`QUOTE_REVISED` if the vendor changed it). The order stores the accepted revision, event, vendor and terms as a JSON `snapshot`, plus denormalised money columns for reporting.

**Concurrency.** Accepting a quote runs in one transaction that reads the request and quote `WITH (UPDLOCK, ROWLOCK)`, then takes a transaction-scoped `sp_getapplock` on `vendor + event date` before counting active bookings against the vendor's `max_events_per_day`. Filtered unique indexes on `orders.event_request_id`, `quote_id` and `accepted_revision_id` are the final backstop against double-accepts. The database runs with `READ_COMMITTED_SNAPSHOT` so plain reads never wait on bookings in progress. Tests fire concurrent accepts to verify.

**Transactional outbox.** Business transactions insert `outbox_events` rows; an in-process dispatcher (claims rows `WITH (UPDLOCK, READPAST)`, retries, failure tracking) turns them into in-app notifications. Email/SMS/WhatsApp channels plug in here later without touching business code. Admins can see and retry failures.

**IST calendar.** Event dates are `date` columns compared against "today" in India Standard Time.

## Request lifecycle (first objective)

1. Customer `POST /v1/requests` → validated, matched to **approved** vendors that serve the area and offer at least one requested service → one `quotes` row per vendor (`REQUESTED`) → outbox notifies vendors. No match → admins are alerted.
2. Vendor opens it (`VENDOR_REVIEWING`), `POST /v1/vendor/quotes/:id/revisions` → server computes totals → `QUOTED` (later `REVISED`).
3. Customer compares and `POST /v1/requests/:id/quotes/:quoteId/accept { revisionId }` → re-validation (status, expiry, vendor approval, stored totals, capacity) → order `PENDING_CONFIRMATION` with snapshot and commission; other quotes `NOT_SELECTED`.
4. Vendor `vendor_confirm` → `PAYMENT_PENDING`. Admin records a verified payment → `CONFIRMED` once the advance is covered. Vendor/admin `start` → `IN_PROGRESS`, `complete` → `COMPLETED`. Every step is appended to `order_events` and the audit log.
