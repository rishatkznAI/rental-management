# Production Smoke Checklist

Run this after every production deploy and after every rollback. Use dedicated smoke users, not personal owner accounts.

Before production deploy, run the separate `Staging Smoke` GitHub Actions workflow against the staging Railway service and staging frontend. If staging smoke fails, do not use production as the first realistic integration test.

Backend:

- `https://rental-management-production-35bc.up.railway.app/health`
- `https://rental-management-production-35bc.up.railway.app/api/version`

Frontend:

- `https://rishatkznai.github.io/rental-management/`

## 1. Backend Health

1. `GET /health` returns `200`.
2. Response contains `ok: true`.
3. Response includes build info.
4. Uptime is present.

## 2. Backend Version

1. `GET /api/version` returns `200`.
2. Response contains backend commit or deployment metadata.
3. Commit is the expected release commit, unless this is an intentional mixed deploy.
4. Build/start timestamps are plausible for the current deploy window.

## 3. Frontend Build Identity

1. Open the frontend URL.
2. Open admin diagnostics.
3. Record:
   - frontend commit;
   - frontend build time;
   - backend commit;
   - backend build/start time;
   - `VITE_API_URL`.
4. Confirm `VITE_API_URL` points to the Railway backend, not GitHub Pages.
5. Confirm frontend and backend commits match when the release expects a single commit deploy.
6. If commits differ, record why the mismatch is acceptable.

## 4. Admin Smoke

1. Login as dedicated admin smoke user.
2. Confirm sidebar shows core sections:
   - dashboard;
   - equipment;
   - rentals;
   - service;
   - delivery;
   - documents;
   - payments;
   - finance;
   - reports;
   - admin panel.
3. Open admin diagnostics.
4. Confirm no secrets, tokens, passwords, cookies, webhook secrets or raw env values are visible.
5. Open equipment, rentals, service, documents and finance pages.

## 5. Office Manager Smoke

1. Login as dedicated office manager smoke user.
2. Confirm allowed operational sections are visible.
3. Confirm admin panel and bot admin controls are not visible unless explicitly allowed.
4. Open clients, rentals, service, documents, payments, finance and reports.
5. Confirm screens are not blank and no runtime error is shown.

## 6. Rental Manager Smoke

1. Login as dedicated rental manager smoke user.
2. Confirm rental workspace opens.
3. Confirm clients, equipment, rentals, deliveries, service, documents, payments and reports open according to role permissions.
4. Confirm finance/admin/bot restricted areas are not visible when not allowed.
5. Confirm the manager does not see unrelated restricted data.

## 7. Mechanic Smoke

1. Login as dedicated mechanic smoke user.
2. Confirm service, equipment, planner, GSM and service vehicles open according to permissions.
3. Confirm dashboard, rentals, clients, documents, payments, finance, reports, bot and admin panel are hidden when not allowed.
4. Open an assigned service ticket if one is available.
5. Confirm no financial/client document data is exposed beyond role permissions.

## 8. Investor Smoke

1. Login as dedicated investor smoke user.
2. Confirm investor sees only own equipment and related rentals.
3. Confirm unrelated owner equipment/rentals are not visible.
4. Confirm admin, finance mutation, service mutation and operational write actions are not available.
5. Confirm rental detail hides fields that are not allowed for investor.

## 9. Head / Руководитель Smoke

1. Login as dedicated head smoke user.
2. Confirm read-only movement views open.
3. Confirm delivery movement data is visible without financial fields.
4. Confirm write actions are disabled or absent.
5. Confirm admin, finance mutation, payments mutation and service/rental write operations are not available.

Current repository gap: backend/unit tests cover the head role, but a dedicated Playwright `head` UI smoke spec is not present yet.

## 10. Critical Business Screens

Open these screens with appropriate roles:

- equipment registry and one equipment card;
- rentals planner/list and one rental card;
- service list and one service card;
- delivery list;
- documents registry;
- payments page;
- finance page;
- reports page;
- GSM page;
- MAX bot admin/status page for admin only.

## 11. Protected Finance Production Smoke Fixture

Finance Production Smoke depends on a read-only production data contract for one safe rental-mode equipment card. The fixture is not created by normal smoke workflows.

Required fixture:

- `inventoryNumber=SMOKE-RENTAL-001`;
- `serialNumber=SMOKE-RENTAL-001`;
- `status=available`;
- `category=own`;
- `activeInFleet=true`;
- `saleMode` absent, `null` or `false`;
- `saleStatus` absent or `null`;
- `salesStatus` absent or `null`;
- not repair-mode: not `category=client`, not `category=partner`, not `status=in_service`;
- visible to the dedicated production smoke user;
- returned by `/api/equipment?paginated=true&page=1&pageSize=100&saleState=available_for_rent`.

Standard UI/API operations must not delete this fixture, rename its inventory or serial number, convert it to sale/client/partner/repair mode, or otherwise remove it from the first page of the dedicated `available_for_rent` endpoint. Blocked write attempts return `409 SYSTEM_FIXTURE_PROTECTED`.

Finance Production Smoke treats `productionFixtureWarning` as a hard failure. Expected diagnostics include missing fixture, `saleMode=true`, non-empty `saleStatus` / `salesStatus`, repair/client/partner mode, and absence from the first `available_for_rent` page. Restore the fixture only through a separate operational workflow or approved manual run after a fresh production data backup. Do not auto-create or mutate the fixture from the read-only smoke workflow.

## 12. Pass/Fail Decision

Pass only if:

- staging smoke passed before this production deploy, or the release owner explicitly accepted skipping it;
- backend health and version are OK;
- frontend loads from GitHub Pages;
- expected build identity is confirmed;
- all role smoke checks pass;
- Finance Production Smoke has no production fixture warning;
- no secrets are exposed;
- no critical screen is blank or throwing runtime errors.

Fail and start `docs/rollback-playbook.md` if:

- production smoke performs or requires writes to validate a basic release;
- login fails for smoke users;
- protected data is visible to the wrong role;
- write actions are available to read-only roles;
- `/health` or `/api/version` fails;
- frontend cannot reach backend;
- critical rentals, service, documents, GSM, finance or MAX bot workflows are broken.

## Production Write Ban

Production smoke must not:

- create, edit or delete rentals, payments, documents, clients, equipment, users, service tickets or deliveries;
- run imports, sync, cleanup, backfill, demo reset or database repair endpoints;
- trigger real MAX/GSM write flows, carrier dispatches or document side effects;
- change Railway production env, secrets, volume mounts or `DB_PATH`.

Use staging for write smoke and seeded data. Production write checks require explicit human approval and a fresh backup.
