
# Rental Management

Frontend on React/Vite and backend on Node/Express for an equipment rental management system.

## Project structure

- `src/` — frontend application
- `server/` — backend API for auth, CRUD, and Railway deployment
- `AGENTS.md` — project instructions for AI agents/Codex
- `docs/business-rules.md` — core business rules and invariants
- `docs/code-review.md` — pre-commit review checklist
- `docs/processes-and-interface.md` — business process and interface map in Russian
- `docs/gprs-gateway.md` — local GSM/GPRS gateway test steps

## Local development

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
cd server
npm install
npm run dev
```

## Scripts

- `npm run dev` — start the frontend locally
- `npm run build` — build the frontend
- `npm test` — run the Node test suite from `tests/`
- `npm run test:e2e` — run Playwright end-to-end tests

If the current shell has Node but does not expose `npm`, Playwright can be started directly:

```bash
node node_modules/.bin/playwright test
```

The Playwright web servers use the current Node executable and local `node_modules/.bin/vite`, so the e2e config does not require `npm` to be available inside the test runner environment.
If that Node cannot load native backend modules, point the web servers at another compatible Node:

```bash
PLAYWRIGHT_NODE_PATH=/path/to/node node node_modules/.bin/playwright test
```

## Deployment

- Frontend supports static deployment (`vite build`) and includes `public/404.html` for SPA routing on GitHub Pages
- `vercel.json` keeps Vercel rewrites compatible with the hash-router shell
- Backend is deployed separately on Railway
- Production frontend uses `VITE_API_URL` to talk to the deployed backend

Current production entry points:

- Frontend: <https://rishatkznai.github.io/rental-management/>
- Backend API: set `VITE_API_URL` to the Railway backend URL

Production operations notes live in `docs/production-operations.md`. Do not commit real `.env` files, bot tokens, webhook secrets, passwords, SQLite databases, backups, or logs. Run production import only after a fresh backup/export.
