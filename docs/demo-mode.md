# Demo Mode

Demo mode is a separate, disposable environment for product demos and scenario checks. It must use its own backend service and its own SQLite database. It must not point to the production database.

## Recommended Architecture

- Railway environment: `demo`, separate from production and staging.
- Backend: separate Railway service, for example `rental-management demo`, from the same codebase.
- Database: separate Railway volume mounted at `/data`.
- Demo DB path: `/data/demo.sqlite`.
- Frontend: separate demo deployment with `VITE_DEMO_MODE=true`.
- Demo frontend API: `VITE_API_URL=https://<demo-backend>.up.railway.app`.
- Production DB path must remain `/data/app.sqlite` only in production.

This keeps demo data physically separate from production data and makes reset safe.
Do not create demo users inside the production backend and do not switch databases by login.

## Environment Split

Production frontend:

```env
VITE_API_URL=https://<production-backend>.up.railway.app
VITE_DEMO_URL=https://<demo-frontend-url>
```

`VITE_DEMO_URL` is optional. When it is set, the production login page shows a simple "Открыть демо-режим" link to the separate demo frontend. When it is empty, the link is hidden.

Demo frontend:

```env
VITE_API_URL=https://<demo-backend>.up.railway.app
VITE_DEMO_MODE=true
```

Production backend:

```env
NODE_ENV=production
DB_PATH=/data/app.sqlite
```

Do not set `DEMO_MODE` on the production backend.

Demo backend:

```env
NODE_ENV=production
APP_ENV=demo
RAILWAY_ENVIRONMENT_NAME=demo
DEMO_MODE=true
DEMO_ALLOW_RESET=true
DEMO_ENV=true
ALLOW_DEMO_SEED=true
DB_PATH=/data/demo.sqlite
BOT_DISABLED=true
GSM_ENABLED=false
GSM_DISABLED=true
ENABLE_GSM_TCP_GATEWAY=false
```

Do not set real `BOT_TOKEN`, `WEBHOOK_URL`, `MAX_WEBHOOK_SECRET`, GPRS, email, 1C, or EDO credentials on the demo backend.
Use a generated Railway variable such as `DEMO_DEFAULT_PASSWORD` for demo user passwords. Do not print it in logs, PRs, screenshots, or public docs.

## Local Run

Seed or reset the local demo database:

```bash
npm run demo:reset
```

Run backend against the demo database:

```bash
cd server
DEMO_MODE=true DB_PATH=./data/demo.sqlite npm run dev
```

Run frontend with a demo badge:

```bash
VITE_DEMO_MODE=true npm run dev
```

## Demo Users

The seed creates intentionally marked demo users:

| User | Role |
|---|---|
| `demo-admin@skytech.local` | Администратор |
| `demo-manager@skytech.local` | Менеджер по аренде |
| `demo-service@skytech.local` | Механик |
| `demo-viewer@skytech.local` | Инвестор |

Set a generated `DEMO_DEFAULT_PASSWORD` only in the demo service secret store. The seed writes password hashes only and does not print passwords.

## Reset

CLI reset:

```bash
DEMO_ENV=true DEMO_MODE=true ALLOW_DEMO_SEED=true DB_PATH=/data/demo.sqlite node server/scripts/seed-demo-data.js
```

API reset:

```http
POST /api/demo/reset
```

The API reset requires an authenticated admin and is enabled only when `DEMO_MODE=true`.

Reset guards:

- `DEMO_ENV=true` or `ALLOW_DEMO_SEED=true` is required.
- Production-like and staging-like environment names are refused.
- If `DEMO_ENV` is not set, the environment name must be clearly `demo`.
- In `NODE_ENV=production`, `DEMO_ALLOW_RESET=true` is also required.
- `DB_PATH` must point to a clearly named demo database such as `/data/demo.sqlite`.
- `DB_PATH=/data/app.sqlite` is refused.
- Seed/reset replaces only records identified with the `DEMO-` prefix and leaves non-demo records untouched.

## Railway Deployment

Create a separate backend service:

- Root directory: `server`
- Start command: `npm start`
- Volume mount: `/data`
- `DEMO_MODE=true`
- `DEMO_ALLOW_RESET=true`
- `DEMO_ENV=true`
- `ALLOW_DEMO_SEED=true`
- `DB_PATH=/data/demo.sqlite`
- `NODE_ENV=production`
- `BOT_DISABLED=true`
- `GSM_ENABLED=false`
- `GSM_DISABLED=true`
- `ENABLE_GSM_TCP_GATEWAY=false`
- Do not set real `BOT_TOKEN`, `WEBHOOK_URL`, MAX webhook secrets, email, 1C, or EDO credentials.
- Open `/api/demo/status` and confirm that `demo.enabled` is `true`.
- Run the seed/reset once with the demo DB path before handing the environment to users.

Create a separate frontend deployment:

- `VITE_DEMO_MODE=true`
- `VITE_API_URL=https://<demo-backend>.up.railway.app`
- Confirm that the `DEMO MODE` badge is visible after opening the app.

Optional production frontend link:

- Set `VITE_DEMO_URL=https://<demo-frontend-url>` on the production frontend if you want the login page to offer a link to demo.
- This link is only navigation to the separate demo frontend. It does not switch the production backend or database.

The demo backend clears MAX bot/webhook transport in demo mode, and GPRS gateway listening is disabled.

## Demo Scenarios

The seed includes:

- demo users;
- 5 fake clients with `DEMO-INN-*`, `example.test`, and `skytech.local` addresses only;
- 20 fake equipment units with `DEMO-EQ-*` inventory numbers;
- active, closed, future and debt-bearing demo rentals and planner data;
- documents without real files;
- test payments and receivables;
- service tickets in progress, waiting for parts, closed repairs, and repeat-breakdown quality-control examples;
- new, in-transit, and completed deliveries;
- demo debt collection plans;
- demo audit logs.

This is enough to show Client 360, Equipment 360, rentals, documents, payments, service, delivery, task center, global search, and admin diagnostics without production data.

## Safety Notes

- Never point demo to the production `app.sqlite`.
- Never import production data into demo.
- Never configure real external notification credentials in demo.
- Treat demo data as disposable.
- Production deploy does not need `DEMO_MODE` and will not show the demo badge.
- Reset from the admin UI can clear demo sessions; after reset, users may need to sign in again with a demo account.
