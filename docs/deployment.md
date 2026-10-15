# Deployment and operations

## Components

| Service | Port | Image |
| --- | --- | --- |
| API (NestJS) | 4000 | `infrastructure/docker/api.Dockerfile` — runs migrations, then starts |
| Customer site | 3000 | `infrastructure/docker/web.Dockerfile --build-arg APP=customer-web` |
| Vendor portal | 3001 | `… APP=vendor-portal` |
| Admin portal | 3002 | `… APP=admin-portal` |
| SQL Server 2022 | 1433 | dedicated server or Azure SQL Database |

Suggested domains: `utsavora.in` (customer), `vendors.utsavora.in`, `admin.utsavora.in` (restrict by IP or SSO if possible). Each web app proxies `/api/*` to the API using `API_INTERNAL_URL`, so the API can stay on a private network.

## Environment variables

API (`apps/api/.env.example`):

| Name | Notes |
| --- | --- |
| `DATABASE_URL` | SQL Server connection string, ADO.NET format: `Server=host,1433;Database=utsavora;User Id=…;Password=…;Encrypt=true;TrustServerCertificate=false`. Named instances: `Server=HOST\\SQLEXPRESS`. Uses SQL Server authentication. |
| `DB_POOL_MAX` | connections in the API's pool, default 10 |
| `NODE_ENV` | `production` in production (hides `/v1/docs` unless `EXPOSE_API_DOCS=true`, refuses demo seeding) |
| `COOKIE_SECURE` | `true` behind HTTPS (default true in production) |
| `SESSION_TTL_HOURS` | default 168 |
| `AUTH_RATE_LIMIT_PER_MINUTE`, `WRITE_RATE_LIMIT_PER_MINUTE` | defaults 10 and 30 |
| `CORS_ORIGINS` | only needed if a browser calls the API cross-origin (not the default setup) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | first admin; change the password after first login |
| `SEED_DEMO_DATA` | `true` only for demos/staging |

Web apps: `API_INTERNAL_URL` (**build-time**: Next.js bakes rewrites into the build, so pass it as a Docker build arg), and `NEXT_PUBLIC_VENDOR_PORTAL_URL` for the customer site's "list your business" link (build-time).

Secrets belong in your platform's secret manager; nothing is hard-coded.

## Local development on Windows

### 1. Install SQL Server 2022 and create the database

1. Install **SQL Server 2022 Developer** (free for development) or Express, and **SQL Server Management Studio (SSMS)**.
2. During setup choose **Mixed Mode** authentication (the app signs in with a SQL login, not Windows authentication). If SQL Server is already installed with Windows-only authentication: in SSMS right-click the server → *Properties* → *Security* → *SQL Server and Windows Authentication mode*, then restart the SQL Server service.
3. Make sure TCP/IP is enabled: *SQL Server Configuration Manager* → *SQL Server Network Configuration* → *Protocols* → *TCP/IP* → Enabled, then restart the service. Express uses a named instance (`localhost\SQLEXPRESS`) and the SQL Server Browser service.
4. In SSMS, run:

```sql
CREATE DATABASE utsavora;
GO
CREATE LOGIN utsavora_app WITH PASSWORD = 'ChangeMe-Db-2026!';
GO
USE utsavora;
CREATE USER utsavora_app FOR LOGIN utsavora_app;
ALTER ROLE db_owner ADD MEMBER utsavora_app;   -- lets migrations create tables; narrow this in production
ALTER DATABASE utsavora SET READ_COMMITTED_SNAPSHOT ON;
```

### 2. Configure and run

```powershell
pnpm install
copy apps\api\.env.example apps\api\.env    # then set DATABASE_URL, e.g.
# DATABASE_URL=Server=localhost,1433;Database=utsavora;User Id=utsavora_app;Password=ChangeMe-Db-2026!;Encrypt=true;TrustServerCertificate=true
pnpm build:packages
pnpm db:migrate        # applies apps/api/migrations/*.sql
pnpm db:seed           # reference data, the admin, and clearly labelled demo vendors
pnpm dev:api           # :4000  (docs at http://localhost:4000/v1/docs)
pnpm dev:customer      # :3000
pnpm dev:vendor        # :3001
pnpm dev:admin         # :3002
```

`TrustServerCertificate=true` is fine locally, where SQL Server uses a self-signed certificate; in production install a proper certificate and set it to `false`.

Demo sign-ins after seeding (password `SEED_DEMO_PASSWORD`, default `Utsav-Demo-2026`): `customer.demo@utsavora.local`, `vendor1.demo@utsavora.local` (catering), `vendor2.demo@…` (décor), `vendor3.demo@…` (photography). Admin: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

### Production database login

Give the running app a login that can read and write but not change the schema, and run migrations with a separate deploy login:

```sql
CREATE LOGIN utsavora_runtime WITH PASSWORD = '<strong password>';
USE utsavora;
CREATE USER utsavora_runtime FOR LOGIN utsavora_runtime;
ALTER ROLE db_datareader ADD MEMBER utsavora_runtime;
ALTER ROLE db_datawriter ADD MEMBER utsavora_runtime;   -- sp_getapplock needs no extra grant (public role)
```

## Docker

```bash
MSSQL_SA_PASSWORD='Str0ng!Passw0rd' SEED_ADMIN_PASSWORD='a-strong-password' docker compose -f infrastructure/docker/docker-compose.yml up --build -d
docker compose -f infrastructure/docker/docker-compose.yml run --rm api node dist/db/seed.js
```

The compose file runs SQL Server 2022 Developer edition in a container (`mcr.microsoft.com/mssql/server:2022-latest`) and creates the `utsavora` database on first start. Developer edition is licensed for development and testing only; set `MSSQL_PID` to `Express`, `Standard` or `Enterprise` (with a licence) for production.

## Tests and CI

`.github/workflows/ci.yml` runs on every push and PR: install, build shared packages, typecheck all workspaces, unit tests, API end-to-end tests against a real SQL Server 2022 container, a production build of the API that is migrated twice (to prove migrations are idempotent), seeded and smoke-tested, and production builds of the three web apps; on `main` it also builds the four Docker images (push/deploy steps to be added once hosting is chosen).

```bash
pnpm --filter @utsavora/types --filter @utsavora/validation test   # pricing, state machines, validation
pnpm --filter @utsavora/api test:unit                                # connection string, GO splitting, type mapping
pnpm --filter @utsavora/api test                                     # + e2e: needs TEST_DATABASE_URL to a login that can create databases;
                                                                     #   the test database (name must contain "test") is dropped and recreated
```

## Health, logs and monitoring

- `GET /v1/health` (liveness) and `GET /v1/health/ready` (database) for load balancers and container health checks.
- The API writes one JSON line per request (`id`, method, path, status, ms, app) and returns `x-request-id`; error responses include the same `requestId`. Ship stdout to your log platform and alert on 5xx rate and readiness failures.
- Watch the admin **Alerts** page for notification delivery failures.

## Backups and restore

On **Azure SQL Database**, automated full/differential/log backups and point-in-time restore (7–35 days) are built in; set the retention and add long-term retention for monthly copies.

On **SQL Server**, use the FULL recovery model with a SQL Server Agent schedule (or Ola Hallengren's maintenance solution):

```sql
ALTER DATABASE utsavora SET RECOVERY FULL;
-- nightly full, hourly differential, log every 15 minutes; copy the files off the server
BACKUP DATABASE utsavora TO DISK = N'D:\Backups\utsavora_full.bak' WITH COMPRESSION, CHECKSUM, INIT;
BACKUP DATABASE utsavora TO DISK = N'D:\Backups\utsavora_diff.bak' WITH DIFFERENTIAL, COMPRESSION, CHECKSUM, INIT;
BACKUP LOG utsavora TO DISK = N'D:\Backups\utsavora_log.trn' WITH COMPRESSION, CHECKSUM;
```

Restore drill (do this monthly onto a scratch database):

```sql
RESTORE VERIFYONLY FROM DISK = N'D:\Backups\utsavora_full.bak' WITH CHECKSUM;
RESTORE DATABASE utsavora_restore FROM DISK = N'D:\Backups\utsavora_full.bak'
  WITH MOVE 'utsavora' TO N'D:\Data\utsavora_restore.mdf', MOVE 'utsavora_log' TO N'D:\Data\utsavora_restore_log.ldf', RECOVERY;
```

Then point `DATABASE_URL` at `utsavora_restore` and run `node dist/db/migrate.js`; it should report "Database is up to date".

## Before going live

- Choose and integrate a payment gateway (see Phase 2 in the README); until then, payments are recorded manually by admins after bank/UPI verification.
- Legal and compliance review: privacy policy and consent (DPDP Act 2023), terms for customers and vendors, cancellation/refund policy (Consumer Protection (E-Commerce) Rules 2020), GST treatment of platform fees, TCS obligations for e-commerce operators, FSSAI checks for food vendors.
- Put the admin portal behind IP allow-listing or SSO, and enforce strong admin passwords (MFA is a follow-up).
