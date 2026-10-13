# API contracts

Base path `/v1`. Full machine-readable spec: [`openapi.json`](./openapi.json) (regenerate with `pnpm --filter @utsavora/api openapi`); interactive docs at `/v1/docs` outside production.

## Conventions

- **Header** `x-utsavora-app: customer | vendor | admin` on every request. Required on all writes (CSRF protection) and used to select the session cookie.
- **Success**: `{ "data": … }`; lists add `"meta": { page, pageSize, total, pageCount }`. Paginate with `?page=&pageSize=` (max 100).
- **Errors**: `{ "error": { "code", "message", "details?", "requestId" } }`. Validation errors are `422 VALIDATION_ERROR` with `details: [{ path, message }]`. Business-rule conflicts are `409` with a specific code (e.g. `QUOTE_REVISED`, `VENDOR_FULLY_BOOKED`, `INVALID_TRANSITION`). `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND` (also used when a record belongs to someone else, so ids can't be probed), `429 RATE_LIMITED`.
- Money in paise, rates in basis points, dates as `YYYY-MM-DD` (IST calendar).

## Endpoints

| Method & path | Who | Purpose |
| --- | --- | --- |
| `POST /auth/register` | public | Customer sign-up (sets cookie) |
| `POST /auth/register-vendor` | public | Vendor sign-up; creates a DRAFT vendor |
| `POST /auth/login` | public | Sign in to the app named in the header |
| `POST /auth/logout`, `GET /auth/me` | signed in | |
| `GET /occasions`, `/categories`, `/service-areas` | public | Reference data |
| `GET /listings` | public | Search approved listings: `q, occasion, category, area, food, maxPricePaise, sort, page` |
| `GET /listings/:id`, `GET /vendors/:slug` | public | Listing detail, vendor profile |
| `POST /estimates/budget` | public | Indicative budget from rate cards |
| `POST /requests` | customer | Create event request; returns `{ id, reference, matchedVendors }` |
| `GET /requests`, `GET /requests/:id` | customer | List; detail with all quote threads and revisions |
| `POST /requests/:id/cancel` | customer | |
| `POST /requests/:id/quotes/:quoteId/accept` | customer | Body `{ revisionId }` → creates the order |
| `POST /requests/:id/quotes/:quoteId/reject` | customer | |
| `GET/PUT /vendor/me`, `POST /vendor/me/submit` | vendor | Profile, onboarding checklist, submit for verification |
| `GET /vendor/dashboard` | vendor | |
| `GET/POST /vendor/listings`, `PUT/DELETE /vendor/listings/:id`, `POST …/:id/submit` | vendor | Menus, packages, services |
| `GET /vendor/quotes?status=new\|quoted\|won\|closed`, `GET /vendor/quotes/:id` | vendor | Inbox and detail (no customer contact before booking) |
| `POST /vendor/quotes/:id/review` · `/revisions` · `/decline` · `/withdraw` | vendor | Quote lifecycle |
| `GET /orders`, `GET /orders/:id` | any role | Scoped to the caller |
| `POST /orders/:id/actions` | any role | `{ action, reason? }` — `vendor_confirm`, `start`, `complete`, `customer_cancel`, `vendor_cancel`, `admin_cancel` |
| `GET /admin/dashboard` | admin | |
| `GET /admin/vendors`, `GET /admin/vendors/:id`, `POST …/:id/decision` | `VENDORS_REVIEW` | approve / reject / suspend |
| `GET /admin/listings`, `POST /admin/listings/:id/decision` | `LISTINGS_MODERATE` | |
| `GET /admin/requests`, `GET /admin/requests/:id` | `ORDERS_MANAGE` | |
| `GET /admin/orders`, `GET /admin/orders/export.csv` | `ORDERS_MANAGE` | Booking queue (`status, from, to, q`) and CSV |
| `POST /admin/orders/:id/payments` | `PAYMENTS_RECORD` | Record a verified offline payment |
| `GET/PUT /admin/settings/commission` | `SETTINGS_MANAGE` | |
| `GET /admin/audit-logs`, `GET /admin/notification-failures` | `AUDIT_VIEW` | |
| `POST /admin/notification-failures/retry` | `SETTINGS_MANAGE` | |
| `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` | signed in | |
| `GET /health`, `GET /health/ready` | public | Liveness, readiness (DB) |

## Rate limits

Global 300 requests/min per IP. Sign-in and registration: `AUTH_RATE_LIMIT_PER_MINUTE` (default 10). Creating requests and sending quotes: `WRITE_RATE_LIMIT_PER_MINUTE` (default 30). Customers may have at most 10 open requests. The in-memory limiter is per API instance; use a Redis store when running several instances.
