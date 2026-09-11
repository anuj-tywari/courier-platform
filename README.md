# Multi-Courier Integration Platform

A courier-agnostic backend for order creation, tracking, and cancellation across multiple courier
partners. Callers hit **one unified API** and pass a `courier_partner` field; everything
courier-specific is isolated behind a pluggable adapter. An **admin UI** (`/admin`) lets you see
which couriers are active, activate/deactivate one or many, and register a brand-new courier
entirely from the browser — no code or redeploy. See [`DESIGN.md`](./DESIGN.md) for architecture,
patterns, schema, and trade-offs.

## Stack

Node.js + TypeScript + Express, **PostgreSQL** (`pg`, raw SQL), Zod (validation), Pino (structured
logging), Axios (HTTP), `p-limit` (bounded concurrency), Vitest + Supertest (tests). The admin
dashboard is a static, no-build-step vanilla HTML/CSS/JS page served by the same Express app.

## Quick start (Docker, nothing else to install)

```bash
docker compose up --build
```

That starts Postgres and the app together; open `http://localhost:3000/admin`. The admin token is
`ADMIN_API_TOKEN` from your `.env` (or shell) if set, otherwise `change-me`. Database migrations and
built-in courier seed data are applied automatically on boot.

Prefer running the app from source with hot reload? Start only the database in Docker and point
the app at it:

```bash
docker compose up -d db
cp .env.example .env
# in .env: DATABASE_URL=postgres://courier:courier@localhost:5432/courier_platform
npm install && npm run dev
# tests: DATABASE_URL=postgres://courier:courier@localhost:5432/courier_platform_test npm test
```

(`courier_platform_test` is created for you by `docker/init-test-db.sql` the first time the DB
volume is created.)

## Local Postgres setup (alternative to Docker)

Requires a local PostgreSQL server (e.g. `brew install postgresql@18 && brew services start postgresql@18`).

```bash
createdb courier_platform         # app database
createdb courier_platform_test    # used by `npm test`
```

## Setup

```bash
npm install
cp .env.example .env   # set DATABASE_URL, ADMIN_API_TOKEN, and optional UrbaneBolt UAT seed values
npm run dev             # http://localhost:3000 -- migrations + courier seed run automatically
```

Prefer explicit setup? Run these once before starting the app:

```bash
npm run migrate
npm run seed
```

Build & run compiled:
```bash
npm run build
npm start
```

## Admin UI

Open **`http://localhost:3000/admin`** and enter `ADMIN_API_TOKEN` (from `.env`) when prompted --
it's stored only in that browser's `localStorage` and sent as `Authorization: Bearer <token>` on
every admin API call. Light theme, a courier list, and add/edit as real hash-addressable pages
(`#/new`, `#/edit/:id`) rather than a dialog -- back button and bookmarking both work. From there
you can:
- See every registered courier and whether it's active.
- Toggle one courier, or select several with the checkboxes and bulk enable/disable.
- Click **+ Add courier** to register a brand-new REST courier -- no code, no redeploy. Adding
  only asks for the basics: base URL and auth style (none / API key header / HTTP Basic / static
  bearer / login-call-for-a-bearer-token), with a **Test connection** button that fires a real
  `authenticate()` call. Save returns you to the list.
- Open **Edit** on a courier you've added to get two tabs: **Courier details** (the same basics)
  and **Endpoints**, where you add the create / track / cancel URLs one at a time (each saves
  immediately) and edit or delete any you've already added. A courier is usable as soon as it has
  a create endpoint; calls that need a missing one fail with `COURIER_MISCONFIGURED` rather than
  crashing, and the list shows an "n/3 endpoints" warning until all three exist. Status mappings
  (courier status string → ours) are edited inside the create and track endpoints, since those
  are the responses a status is read from.
- **Edit** or **Delete** any courier, including the built-in coded ones (UrbaneBolt, MockCourier).
  Every courier's config -- credentials included -- lives in the database and is edited here; env
  vars only seed the coded adapters' rows on first boot. Delete removes the courier from the app
  for good (no restore in the UI or API); under the hood it's a soft delete so the order history of
  anything it shipped isn't orphaned.
- **Endpoints** are editable for UrbaneBolt too, on its Endpoints tab: auth / create / track /
  cancel paths, methods, body templates, response mappings, and the status map -- seeded with the
  values from the UAT docs. Leaving a body template empty keeps the adapter's built-in payload
  mapping (it does things a template can't, like COD conditionals and numeric pincodes); "Reset"
  puts an endpoint back to its default. MockCourier makes no HTTP calls, so it just shows its
  operations read-only.
- You can't deactivate or delete the last active courier -- the API always has somewhere to route.
  Enforced server-side, singly and in bulk.

This covers most JSON REST APIs. A courier with a genuinely unusual integration (SOAP, XML,
multi-step handshakes) still needs a small coded adapter (see "Adding a *coded* courier" below) --
that limitation is intentional, see DESIGN.md.

### Demo: add a courier with zero code

A tiny fixture courier server (also used by the automated tests) is included for trying this
without a real carrier account:

```bash
npx tsx scripts/demo-courier-server.ts
# Demo courier fixture server listening at http://127.0.0.1:PORT
```

In `/admin`, click **+ Add courier**:
- Partner ID: `fixturecourier`, Base URL: the printed `http://127.0.0.1:PORT`
- Auth: **API key header**, header `X-Api-Key`, key `fixture-secret-key`
- Click **Test connection**, then **Save**.

Back on the list, click **Edit** on Fixture Courier and open the **Endpoints** tab. Add each one
and save it:
- Create: `POST /shipments`, body `{"ref": "{{order_id}}", "weight": "{{package.weightKg}}"}`,
  response mapping `id` / `tracking` / `state`
- Track: `GET /shipments/{{courier_order_id}}`, response status path `state`
- Cancel: `POST /shipments/{{courier_order_id}}/void`
- In the Create and Track editors, status mappings: `new -> CREATED`, `in_transit -> IN_TRANSIT`,
  `voided -> CANCELLED`

`fixturecourier` shows up in `GET /api/v1/couriers` as soon as it's saved and accepts real
`POST /api/v1/orders` calls once the create endpoint exists -- no restart needed.

## Environment variables

All in `.env.example`. Nothing is hardcoded (assignment 4).

| Variable | Purpose |
|---|---|
| `PORT`, `NODE_ENV`, `LOG_LEVEL` | Server basics |
| `DATABASE_URL` | Postgres connection string, credentials included: `postgres://user:password@host:5432/db`. The local default omits them because Homebrew Postgres trusts your OS user on localhost |
| `ADMIN_API_TOKEN` | Bearer token guarding `/api/v1/admin/*` (and used by the `/admin` UI). **Required** when `NODE_ENV=production` |
| `BULK_MAX_ORDERS`, `BULK_CONCURRENCY` | Bulk endpoint limits |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins. **Required** (non-empty) when `NODE_ENV=production` |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` | Rate limit on `/api/v1/*` |
| `URBANEBOLT_*` | Optional first-boot/local seed values for UrbaneBolt UAT config. Keep real values in `.env`, not committed files |

Every courier's config (credentials included) is stored in `courier_partners.config` and managed
from `/admin` -- one place for coded and no-code couriers alike. Env values only seed built-in
couriers when the stored config is missing or blank. Secrets are masked in every admin API response;
sending the mask back keeps the stored value.

## Running tests

Requires the local `courier_platform_test` Postgres database (see "Local Postgres setup" above).

```bash
npm test
```

49 tests across:
- `tests/retry.test.ts` — exponential backoff/retry unit behavior.
- `tests/courier-registry.test.ts` — factory resolution, case-insensitivity, `UNKNOWN_COURIER` /
  `COURIER_DISABLED` normalization.
- `tests/bulk.integration.test.ts` — full HTTP-level tests via Supertest against MockCourier:
  create/track/cancel, idempotent resubmission (including the cross-courier-partner conflict
  case), field-level validation errors, unknown/disabled-courier rejection, 404 on unknown order,
  never-reached-the-courier track/cancel, bulk submit + background processing + polling for
  completion, in-batch duplicate rejection, batch failures before order persistence, idempotent
  replays inside a later batch, and the config-driven batch-size cap.
- `tests/generic-rest-adapter.integration.test.ts` — registers a brand-new courier purely via the
  admin API (a local HTTP fixture server standing in for a real carrier) and drives
  create/track/cancel through the *unified* API, proving the no-code claim end-to-end.
- `tests/admin-couriers.integration.test.ts` — admin-token auth, CRUD, bulk enable/disable, secret
  masking.

- `tests/urbanebolt-adapter.test.ts` — the UrbaneBolt adapter against a local server mimicking the
  UAT API's quirks (HTTP 200 `{"status":"Failed"}` errors, simplejwt-style tokens) and
  admin-overridden endpoints/mappings.

Tests never call the real UrbaneBolt UAT API, so they run fully offline (aside from the local DB).


## Deliverables checklist (per assignment §6)

| # | Deliverable | Where |
|---|---|---|
| 1 | Public Git repository with full source | this directory — `git init && git remote add origin ... && git push` (not yet pushed; see below) |
| 2 | README.md — setup, env vars, run, test, add-a-courier | this file |
| 3 | DESIGN.md — architecture, pattern, schema, trade-offs | [`DESIGN.md`](./DESIGN.md) |
| 4 | Postman collection / curl examples | [`postman_collection.json`](./postman_collection.json), [`examples.http`](./examples.http) |
| 5 | Bonus: second mock courier adapter | `src/couriers/mock/` (`mockcourier`) |

To satisfy deliverable #1: `git init`, commit, create a repo on GitHub/GitLab, and push — this
wasn't done automatically since it needs your account/credentials.

## Running with Docker

```bash
cp .env.example .env    # then fill in real values — required in production, see below
docker compose up --build
```

Uses a multi-stage `Dockerfile` (non-root user, health-checked) plus a `postgres:16-alpine`
service in `docker-compose.yml` with a named volume, so data survives container restarts.

## Production checklist

`NODE_ENV=production` enforces this at startup (the process refuses to boot otherwise):

- `CORS_ALLOWED_ORIGINS` must be set to an explicit comma-separated origin list — no wildcard CORS

Also on by default: Helmet security headers, rate limiting on `/api/v1/*`
(`RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS`), `Authorization`-header log redaction, and
graceful shutdown on `SIGTERM`/`SIGINT`. `GET /health` is liveness; `GET /ready` additionally checks
DB connectivity — point your orchestrator's readiness probe at `/ready`, not `/health`.

## API

Base path: `/api/v1`. Every response follows `{ success, data }` or `{ success: false, error: { code,
message, details }, request_id }` — see DESIGN.md §5.

### `GET /couriers`
List registered `courier_partner` ids.

### `POST /orders`
Create one order. Idempotent on `order_id`.

<details><summary>Request body</summary>

```json
{
  "order_id": "ORD-1001",
  "courier_partner": "urbanebolt",
  "pickup_address": {
    "name": "Acme Warehouse", "phone": "9876543210", "email": "ops@acme.test",
    "line1": "Plot 12, Udyog Vihar Phase 1", "city": "Gurugram", "state": "Haryana", "pincode": "122001"
  },
  "delivery_address": {
    "name": "Ravi Kumar", "phone": "9123456780", "email": "ravi@example.test",
    "line1": "12 Janpath Road, Connaught Place", "city": "New Delhi", "state": "Delhi", "pincode": "110011"
  },
  "package": { "weightKg": 1.2, "declaredValue": 999, "description": "T-shirt" },
  "payment_mode": "PREPAID"
}
```
(Gurugram → Delhi because those pincodes are in UrbaneBolt's UAT serviceable list and its
addresses must be ≥ 10 characters; MockCourier accepts anything.)
</details>

`email` on either address is optional in the unified DTO; it's passed through to couriers that
require it (UrbaneBolt does) and falls back to the courier's configured default return email
(set on its edit page in `/admin`) if omitted.


### `GET /orders/:order_id/track`
Current status + full append-only tracking history.

### `POST /orders/:order_id/cancel`
Cancel a previously created order.

### `POST /orders/bulk`
Up to `BULK_MAX_ORDERS` (default 100) orders, each optionally with a different `courier_partner`.
Returns `202` with a `batch_id` immediately; processing happens in the background (see DESIGN.md §4).

```json
{ "orders": [ { "...same shape as POST /orders..." }, { "..." } ] }
```

### `GET /orders/bulk/:batch_id`
Poll batch progress: `status` (`PROCESSING` | `COMPLETED`), `succeeded`, `failed`, and a per-order
`results[]` with `success`/`error` for failed items.

Full curl examples: [`examples.http`](./examples.http). Postman collection:
[`postman_collection.json`](./postman_collection.json) -- the complete flow (health, single +
bulk orders on both couriers, every error path, the admin API) with an assertion on every request,
so it doubles as an end-to-end check. Run it headless with:

```bash
npx newman run postman_collection.json --env-var base_url=http://localhost:3000 --env-var admin_token=<ADMIN_API_TOKEN>
```

## Admin API

Base path `/api/v1/admin`, requires `Authorization: Bearer <ADMIN_API_TOKEN>` on every request
(this is separate from, and stricter than, the consumer-facing `/api/v1/orders*` API -- see
DESIGN.md's "Admin-managed couriers" section for why). Backs the `/admin` UI; also usable directly.

| Endpoint | Purpose |
|---|---|
| `GET /couriers` | List all couriers (secrets masked) |
| `GET /couriers/:id` | One courier's detail (masked) |
| `POST /couriers` | Register a new `generic_rest` courier (`id`, `display_name`, `config`) |
| `PUT /couriers/:id` | Update a `generic_rest` courier's config |
| `PATCH /couriers/:id/enable` | `{ "enabled": true\|false }` -- activate/deactivate one |
| `POST /couriers/bulk-enable` | `{ "ids": [...], "enabled": true\|false }` -- activate/deactivate many |
| `DELETE /couriers/:id` | Delete any courier (refused if it's the last active one); not reversible via the API |
| `POST /couriers/test` | `{ "config": {...}, "id"?: "..." }` -- test a config before saving (`id` lets the server fill the stored secret behind the mask) |
| `PUT /couriers/:id/endpoints/:operation` | Add or replace one endpoint (`create` / `track` / `cancel`); body is the endpoint config |
| `DELETE /couriers/:id/endpoints/:operation` | Remove one endpoint |

Secrets are masked in every response; sending the mask (`••••••••`) back in a `PUT /couriers/:id`
keeps the stored value, so the details page can be edited without re-entering credentials. A
details update never touches endpoints (or the status mappings they carry) -- those go through the
endpoint routes.

`code`-kind couriers (`urbanebolt`, `mockcourier`) take a `config` shaped by their own schema
(the response's `fields` array describes it) rather than the generic REST one, and have no
endpoint routes -- their endpoints are in code.

## Supported couriers

- **`urbanebolt`** — real adapter (`src/couriers/urbanebolt/`), calls the UrbaneBolt UAT API at
  `https://uat.urbanebolt.in/api/v1`. Endpoints, HTTP methods, headers, and request field names are
  taken from the live UAT Postman collection. The collection has no saved example responses, so auth,
  manifest, tracking and cancel were confirmed against live UAT and the adapter handles the real
  response shapes, including failures returned as HTTP 200. Set the credentials and customer code on
  its edit page in `/admin` (they start empty). Two UrbaneBolt rules worth knowing: both pincodes must
  be in its serviceable list, and address lines must be at least
  10 characters — either is rejected with a clear `COURIER_CLIENT_ERROR`.
- **`mockcourier`** — bonus adapter (`src/couriers/mock/`), fully in-process (no network calls),
  proves the plug-in design with a second, independently-implemented courier. Supports
  a configurable failure rate (on its edit page in `/admin`) to demo retry/backoff and partial
  bulk failure on demand.

## How to add a new courier

Two paths, depending on the courier:

1. **No-code, via the admin UI** (covers most JSON REST APIs) — open `/admin`, click **+ Add
   courier**, fill in base URL / auth / endpoint templates, **Test connection**, **Save**. See
   "Demo: add a courier with zero code" above. Nothing is deployed or restarted.
2. **Coded adapter** (for anything the generic REST engine can't describe — SOAP, XML, unusual
   auth handshakes): see DESIGN.md §2 "Adding a new courier (concretely)" — implement
   `ICourierAdapter`, register it, add its env config block. Four small, additive steps, zero
   changes to any existing controller, route, DTO, service, or other adapter.

## Project layout

```
src/
  types/            unified DTOs + normalized error vocabulary
  couriers/
    courier-adapter.interface.ts   the ONE contract every courier implements
    registry.ts                    courier_partner -> adapter (Factory), DB-backed reload()
    base/http-client.ts            shared retry/backoff + 4xx/5xx normalization
    urbanebolt/  mock/             one folder per coded courier, self-contained
    generic-rest/                  the no-code, config-driven adapter + its template engine
  services/         OrderService, BulkService, CourierAdminService — business logic
  repositories/     Postgres access (parameterized queries), one per table
  controllers/, routes/, middleware/, validators/   Express wiring (order + admin)
  config/           env parsing (server settings + first-boot seed values for coded couriers)
  db/               migrations, seed script, and pg Pool client
public/admin/       the admin dashboard (static HTML/CSS/JS, no build step)
tests/
```
