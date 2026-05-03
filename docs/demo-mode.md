# Demo Mode

Demo mode is a separate, disposable environment for product demos and scenario checks. It must use its own backend service and its own SQLite database. It must not point to the production database.

## Recommended Architecture

- Frontend: separate demo deployment with `VITE_DEMO_MODE=true`.
- Backend: separate demo Railway service from the same codebase.
- Database: separate Railway volume mounted at `/data`.
- Demo DB path: `/data/demo.sqlite`.
- Production DB path must remain `/data/app.sqlite` only in production.

This keeps demo data physically separate from production data and makes reset safe.

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
| `demo-office@skytech.local` | Офис-менеджер |
| `demo-rental@skytech.local` | Менеджер по аренде |
| `demo-service@skytech.local` | Механик |

Default local demo password: `demo1234`.

These credentials are not production secrets. Change `DEMO_DEFAULT_PASSWORD` in the demo service if the demo environment is public.

## Reset

CLI reset:

```bash
DEMO_MODE=true DB_PATH=/data/demo.sqlite node server/scripts/seed-demo-data.js --reset
```

API reset:

```http
POST /api/demo/reset
```

The API reset requires an authenticated admin and is enabled only when `DEMO_MODE=true`.

Reset guards:

- `DEMO_MODE=true` is required.
- In `NODE_ENV=production`, `DEMO_ALLOW_RESET=true` is also required.
- `DB_PATH` must point to a clearly named demo database such as `/data/demo.sqlite`.
- `DB_PATH=/data/app.sqlite` is refused.

## Railway Deployment

Create a separate backend service:

- `DEMO_MODE=true`
- `DEMO_ALLOW_RESET=true`
- `DB_PATH=/data/demo.sqlite`
- Do not set real `BOT_TOKEN`, `WEBHOOK_URL`, MAX webhook secrets, email, 1C, or EDO credentials.

Create a separate frontend deployment:

- `VITE_DEMO_MODE=true`
- `VITE_API_URL=https://<demo-backend>.up.railway.app`

The demo backend clears MAX bot/webhook transport in demo mode, and GPRS gateway listening is disabled.

## Demo Scenarios

The seed includes:

- demo users;
- demo clients;
- demo equipment;
- demo rentals and planner data;
- demo documents;
- demo payments;
- demo service tickets;
- demo deliveries;
- demo debt collection plans;
- demo audit logs.

This is enough to show Client 360, Equipment 360, rentals, documents, payments, service, delivery, task center, global search, and admin diagnostics without production data.

## Safety Notes

- Never point demo to the production `app.sqlite`.
- Never import production data into demo.
- Never configure real external notification credentials in demo.
- Treat demo data as disposable.
- Production deploy does not need `DEMO_MODE` and will not show the demo badge.
