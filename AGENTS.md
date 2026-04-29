# AGENTS.md

Skytech Rental Management is an internal equipment rental management system for coordinating clients, rentals, fleet state, service, deliveries, payments, documents, reports, MAX bot workflows, and GSM/GPRS telemetry.

## Stack

- Frontend: React, Vite, TypeScript, React Router, TanStack Query.
- Backend: Node.js, Express.
- Data store: SQLite via `better-sqlite3`.
- Main database: `server/data/app.sqlite`.
- Main JSON storage table: `app_data`, where each collection is stored as a JSON value.

## Project Structure

- `src/` contains the frontend application.
- `src/app/pages/` contains major product screens: clients, rentals, equipment, service, deliveries, payments, finance, reports, bots, GSM, settings.
- `src/app/services/` contains API clients for frontend data access.
- `src/app/lib/` contains frontend domain helpers such as permissions, finance, GSM, rental conflicts, and service helpers.
- `server/server.js` wires the backend, auth, routes, MAX bot, GSM/GPRS gateway, and domain services.
- `server/routes/` contains Express route modules.
- `server/lib/` contains core backend business logic: access control, finance, client links, rental validation, service state, bot operations, delivery DTOs, and GSM/GPRS handling.
- `server/db.js` manages SQLite persistence and legacy JSON migration.
- `tests/` contains Node test coverage for backend/domain/security flows.
- `e2e/` contains Playwright tests.
- `docs/` contains project/business documentation.

## Data Model

The current persistence model is intentionally simple: collections are JSON arrays or objects stored in SQLite `app_data`. Important collections include:

- `equipment`
- `rentals`
- `gantt_rentals`
- `clients`
- `payments`
- `documents`
- `service`
- `deliveries`
- `delivery_carriers`
- `users`
- `bot_users`
- `bot_sessions`
- `bot_activity`
- `gsm_packets`
- `gsm_commands`
- `app_settings`

Treat stored records as long-lived production data. Old JSON records can lack new fields, so code must remain backward compatible and should use defensive defaults.

## Key Business Rules

- Do not link debts, rentals, payments, documents, or service tickets by client name. Use stable IDs such as `clientId`, `rentalId`, and `equipmentId`.
- Client names are editable. Renaming a client must not break history, receivables, payments, documents, or rental links.
- Payments must be linked to a client and/or rental by ID. `client`/`clientName` fields are display labels, not foreign keys.
- Reports may display the current client name, but grouping and joins must be based on stable IDs.
- Rental and equipment statuses must remain consistent with active rentals, service tickets, deliveries, shipping/receiving operations, and returns.
- A returned or closed rental must not keep equipment blocked as actively rented unless another active rental requires it.
- A service ticket in an open status should keep matching equipment in service.
- Delivery statuses `completed` and `cancelled` are terminal for carrier task lists and must not be shown as active carrier tasks.
- The MAX bot is part of the business flow, not just notifications. Bot operations can create service tickets, shipping/receiving photo events, field trips, and delivery status updates.
- Changing a user's role in the MAX bot must reset that user's bot scenario/session so they cannot continue an old scenario with new permissions.
- GSM/GPRS data should be treated as operational telemetry and should not silently override contractual rental/client links.

## Roles And Access

Known roles include:

- `Администратор` / admin
- `Офис-менеджер` / office manager
- `Менеджер по аренде` / rental manager
- `Менеджер по продажам` / sales manager
- `Механик` and mechanic subroles
- `Перевозчик` / carrier
- `Инвестор` / investor

Access rules must be enforced on the backend, not only on the frontend. Frontend permission checks are UX only.

Carrier-specific rules:

- A carrier must see only deliveries assigned to their `carrierId`.
- A carrier must not see client financial data, client documents, or extra rental details.
- Carrier DTOs should expose only operational delivery fields needed for transport work.
- Completed and cancelled deliveries must not appear as active carrier tasks.
- Bot-only carrier users must not be able to log in to the frontend.

## Data Safety Rules

- Changes to JSON records in `app_data` must be backward compatible.
- New fields should be optional and have safe defaults.
- Migrations/backfills must be idempotent when possible.
- Do not overwrite or normalize large data sets casually.
- Mass data changes should be cautious and preferably preceded by an export or SQLite backup.
- Avoid deriving persistent links from editable labels. If legacy data has only names, use name matching only as a guarded recovery/backfill path and log ambiguity.

## Security Rules

- Keep role and permission enforcement on backend routes and backend domain helpers.
- Deny unknown roles and unknown collections by default.
- Strip mass-assignment fields for non-admin users.
- Never expose passwords, tokens, bot secrets, session data, or webhook secrets in API responses or logs.
- Use webhook secrets and rate/deduplication protections for MAX webhook routes.
- Avoid logging full user messages, passwords, tokens, or `/start` credentials.

## Checks

Run these before handing off meaningful changes:

```bash
git diff --stat
git diff
npm test
node --test tests/*.test.js
npm run build
```

For frontend behavior changes, also consider:

```bash
npm run test:e2e
```

## How Codex Should Work Here

- Read nearby code and tests before editing.
- Preserve the current architecture and storage model.
- Do not refactor broadly while fixing a narrow issue.
- Keep edits close to the affected route/helper/page.
- Prefer existing helpers in `server/lib` and `src/app/lib`.
- Do not change business logic while adding documentation or comments.
- Any bug fix should include a test or at least a clear diagnostic verification scenario.
- Before changing permissions, payments, debts, rentals, deliveries, MAX bot flows, or equipment statuses, inspect existing tests and add targeted coverage when behavior changes.
- Do not format the whole project or churn unrelated files.
