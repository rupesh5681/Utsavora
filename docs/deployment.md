# Deployment and operations

## Components

| Service | Port | Image |
| --- | --- | --- |
| API (NestJS) | 4000 | `infrastructure/docker/api.Dockerfile` — runs migrations, then starts |
| Customer site | 3000 | `infrastructure/docker/web.Dockerfile --build-arg APP=customer-web` |
| Vendor portal | 3001 | `… APP=vendor-portal` |
| Admin portal | 3002 | `… APP=admin-portal` |
| PostgreSQL 16 | 5432 | managed service recommended |

Suggested domains: `utsavora.in` (customer), `vendors.utsavora.in`, `admin.utsavora.in` (restrict by IP or SSO if possible). Each web app proxies `/api/*` to the API using `API_INTERNAL_URL`, so the API can stay on a private network.

## Environment variables

API (`apps/api/.env.example`):

| Name | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | `production` in production (hides `/v1/docs` unless `EXPOSE_API_DOCS=true`, refuses demo seeding) |
| `COOKIE_SECURE` | `true` behind HTTPS (default true in production) |
| `SESSION_TTL_HOURS` | default 168 |
| `AUTH_RATE_LIMIT_PER_MINUTE`, `WRITE_RATE_LIMIT_PER_MINUTE` | defaults 10 and 30 |
| `CORS_ORIGINS` | only needed if a browser calls the API cross-origin (not the default setup) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | first admin; change the password after first login |
| `SEED_DEMO_DATA` | `true` only for demos/staging |

Web apps: `API_INTERNAL_URL` (**build-time**: Next.js bakes rewrites into the build, so pass it as a Docker build arg), and `NEXT_PUBLIC_VENDOR_PORTAL_URL` for the customer site's "list your business" link (build-time).

Secrets belong in your platform's secret manager; nothing is hard-coded.

## Local development

```bash
pnpm install
cp apps/api/.env.example apps/api/.env          # point DATABASE_URL at a local Postgres
pnpm build:packages
pnpm db:migrate && pnpm db:seed                # seed adds admin + clearly labelled demo vendors
pnpm dev:api        # :4000  (docs at http://localhost:4000/v1/docs)
pnpm dev:customer   # :3000
pnpm dev:vendor     # :3001
pnpm dev:admin      # :3002
```

Demo sign-ins after seeding (password `SEED_DEMO_PASSWORD`, default `Utsav-Demo-2026`): `customer.demo@utsavora.local`, `vendor1.demo@utsavora.local` (catering), `vendor2.demo@…` (décor), `vendor3.demo@…` (photography). Admin: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

## Docker

```bash
SEED_ADMIN_PASSWORD='a-strong-password' docker compose -f infrastructure/docker/docker-compose.yml up --build -d
docker compose -f infrastructure/docker/docker-compose.yml run --rm api node dist/db/seed.js
```

## Tests and CI

`.github/workflows/ci.yml` runs on every push and PR: install, build shared packages, typecheck all workspaces, unit tests, API end-to-end tests against a real PostgreSQL service, a migration drift check, and production builds of the three web apps; on `main` it also builds the four Docker images (push/deploy steps to be added once hosting is chosen).

```bash
pnpm --filter @utsavora/types --filter @utsavora/validation test   # pricing, state machines, validation
pnpm --filter @utsavora/api test                                     # needs TEST_DATABASE_URL (database is reset)
```

## Health, logs and monitoring

- `GET /v1/health` (liveness) and `GET /v1/health/ready` (database) for load balancers and container health checks.
- The API writes one JSON line per request (`id`, method, path, status, ms, app) and returns `x-request-id`; error responses include the same `requestId`. Ship stdout to your log platform and alert on 5xx rate and readiness failures.
- Watch the admin **Alerts** page for notification delivery failures.

## Backups and restore

Use managed PostgreSQL with automated daily snapshots **and** point-in-time recovery (7–30 days). Additionally take a nightly logical dump to separate storage:

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > utsavora-$(date +%F).dump
```

Restore drill (do this monthly into a scratch database):

```bash
createdb utsavora_restore
pg_restore --no-owner --dbname=postgresql://…/utsavora_restore utsavora-YYYY-MM-DD.dump
DATABASE_URL=postgresql://…/utsavora_restore node dist/db/migrate.js   # should report nothing to apply
```

## Before going live

- Choose and integrate a payment gateway (see Phase 2 in the README); until then, payments are recorded manually by admins after bank/UPI verification.
- Legal and compliance review: privacy policy and consent (DPDP Act 2023), terms for customers and vendors, cancellation/refund policy (Consumer Protection (E-Commerce) Rules 2020), GST treatment of platform fees, TCS obligations for e-commerce operators, FSSAI checks for food vendors.
- Put the admin portal behind IP allow-listing or SSO, and enforce strong admin passwords (MFA is a follow-up).
