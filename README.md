# Utsavora

Warm, Indian, and suitable for celebrations, event services, and supplies.

Utsavora is a multi-vendor marketplace for planning celebrations in India, launching in Greater Noida. Customers describe an event once, verified caterers, decorators and photographers send itemised quotes, and the customer compares, accepts and tracks the booking. Vendors are verified and their menus and packages moderated before anything is public.

This repository contains the **foundation and first working slice** from the master brief: a customer submits a real event request, an approved vendor responds with a quote (and can revise it), the customer accepts a specific revision, and the system persists and tracks the resulting booking through confirmation, payment and completion.

## Apps

| App | Dev URL | For |
| --- | --- | --- |
| `apps/customer-web` | http://localhost:3000 | Customers: browse by occasion, search and filter, plan an event with a live budget estimate, compare quotes, accept, track bookings |
| `apps/vendor-portal` | http://localhost:3001 | Vendors: register, onboarding checklist, menus/packages, quote inbox and builder with revisions, confirm and run bookings |
| `apps/admin-portal` | http://localhost:3002 | Operations: dashboard, vendor verification, listing moderation, requests, booking queue + CSV export, verified payments, commission, audit log, alerts |
| `apps/api` | http://localhost:4000/v1/docs | NestJS REST API over SQL Server 2022 |

Quick start, Docker, environment variables and backups: [docs/deployment.md](docs/deployment.md).

## Gap analysis (starting point)

The repository contained only a README and licence, so there was no Yumzy code to preserve. Each capability the brief asked to keep was rebuilt server-backed:

| Brief capability | Status |
| --- | --- |
| Occasion-based browsing (birthdays, corporate, anniversaries, weddings, family functions) | Done — home page, `/browse?occasion=` |
| Event request form (date, area, guests, budget, food, services, notes) | Done — `/plan`, validated client and server side |
| Indicative budget calculations | Done — server rate cards (`budget_rates`), live panel on `/plan` |
| Quote comparison and package selection | Done — side-by-side quotes with revisions, breakdowns, accept/decline |
| Vendor quotes with inclusions, advance %, expiry | Done — immutable revisions, GST, discount, delivery, validity |
| Vendor menu/package submission and admin approval | Done — listings with moderation; edits require re-approval |
| Admin booking queue and CSV export | Done — filters, formula-safe CSV, audited export |
| Vendor onboarding checks, configurable commission | Done — server-side checklist (FSSAI for food), commission rules |
| Responsive design, auth UI, navigation | Done — three apps, mobile-first layouts |

## What works now

- **Accounts and access**: argon2 passwords, opaque httpOnly sessions per app, logout revocation, role checks, six explicit admin permissions, strict vendor and customer data isolation, CSRF protection, rate limiting.
- **Catalogue**: occasions, categories, Greater Noida service areas, approved-only public listings, search/filter/sort/paginate, vendor profiles.
- **Request → quote → booking**: matching to approved vendors by area and service; quote threads with immutable revisions; server-computed pricing; stale-revision and expiry protection; tamper detection on stored totals; per-vendor-per-day capacity with concurrency-safe locking; durable order snapshot; commission and vendor payable; full order timeline.
- **Payments (manual, verified)**: admins record offline UPI/bank/cheque/cash payments with duplicate-reference protection; the booking confirms automatically once the advance is covered. No online gateway yet.
- **Operations**: database-backed dashboard, audit log of sensitive actions, transactional outbox → in-app notifications with failure monitoring and retry, health/readiness checks, structured request logs, OpenAPI docs.
- **Demo data** is seeded only when asked, marked `is_demo`, and shown with a dashed "Demo" tag and banners everywhere; demo bookings are excluded from money totals.

## Tests run

- 10 unit tests (pricing and rounding, commission, state machines, budget estimator, validation).
- 25 API end-to-end tests against a real SQL Server 2022 (run in GitHub Actions): the full slice, revisions and stale-accept, snapshot immutability, tampered totals, expiry, decline/withdraw/reject/cancel, unmatched requests, auth and cookie flags, per-app session isolation, vendor/customer isolation, admin permissions, onboarding and suspension, listing moderation and re-approval, **concurrent accepts never over-booking a vendor**, single-accept under double-click, commission changes with audit, CSV escaping, error envelopes.
- Typecheck of all workspaces and production builds of all three web apps.
- A browser run through the real apps (vendor registers and is approved → customer plans and requests → vendor quotes → customer accepts → vendor confirms → admin records the advance → customer sees "Confirmed").

## Deviations from the brief

- **Database: SQL Server 2022 instead of PostgreSQL, Kysely instead of Prisma.** Chosen so the database is one the team already runs. The schema is plain T-SQL (`apps/api/migrations/`) you can read and run in SSMS; see [docs/database-schema.md](docs/database-schema.md).
- **Payments are manual.** The brief requires verifying a provider's marketplace/split-settlement capabilities and Indian compliance before choosing one; that needs commercial decisions and credentials. Until then only admin-verified offline payments exist, and no booking is ever marked paid by the browser.

## Known limitations and next steps

**Phase 1 remainder**: vendor document upload (S3-compatible, private) and photo galleries; multi-component and multi-vendor packages with snapshots; availability calendars (weekly rules, blackout dates) beyond the per-day capacity check; email/SMS/WhatsApp notification channels on the outbox; admin user and permission management screen; password reset; pilot with curated Greater Noida vendors.

**Phase 2**: payment provider (sandbox adapter first, verified webhooks with idempotent processing), booking holds, refunds, rescheduling and disputes, vendor payouts and reconciliation, subscriptions with backend-enforced entitlements, Redis-backed rate limiting for multiple instances.

**Phase 3–4**: bulk products (SKU, stock, MOQ, quantity tiers, transactional inventory reservation, shipping), smart planner improvements, analytics, Delhi NCR expansion.

## Repository layout

```
apps/        api · customer-web · vendor-portal · admin-portal
packages/    types · validation · api-client · ui · config
infrastructure/docker   Dockerfiles + compose
docs/        architecture · database-schema · api-contracts · approval-workflows · deployment · openapi.json
```
