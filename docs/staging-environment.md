# Staging Environment

Stage 2 staging is the release rehearsal environment for Skytech Rental Management. It must prove that the GitHub Pages frontend build and Railway backend can work together before production is touched.

Staging is not production, demo mode, or a personal test database. It is allowed to contain seeded/test data, but it must never mount the production SQLite volume and must never use production bot, GSM, webhook, or user credentials.

## Purpose

- Verify a release candidate before production deploy.
- Catch frontend/backend URL, auth, build identity, routing, CORS, and Railway runtime issues.
- Run read-only smoke checks across the main business screens.
- Provide a safe place for later write smoke scenarios with disposable seeded records.

## Difference From Production

| Area | Staging | Production |
|---|---|---|
| Backend | Separate Railway service or Railway environment | Production Railway service |
| Database | Separate SQLite DB and volume | Production SQLite DB and volume |
| Frontend | Separate staging frontend URL/build | GitHub Pages production URL |
| Users | Dedicated staging smoke users | Dedicated production smoke users |
| Writes | Allowed only for planned staging tests | Forbidden for smoke unless explicitly approved |
| Integrations | Test/disabled MAX, GSM, webhook settings | Real operational integrations |

## Required GitHub Secrets

Add these repository or environment secrets before running `.github/workflows/staging-smoke.yml`:

- `STAGING_API_URL`: staging Railway backend URL, for example `https://<staging-service>.up.railway.app`.
- `STAGING_FRONTEND_URL`: staging frontend URL built with `VITE_API_URL=$STAGING_API_URL`.
- `STAGING_ADMIN_EMAIL`: dedicated staging admin/smoke user email.
- `STAGING_ADMIN_PASSWORD`: password for the staging admin/smoke user.

Optional future smoke users:

- `STAGING_OFFICE_EMAIL` / `STAGING_OFFICE_PASSWORD`
- `STAGING_RENTAL_MANAGER_EMAIL` / `STAGING_RENTAL_MANAGER_PASSWORD`
- `STAGING_MECHANIC_EMAIL` / `STAGING_MECHANIC_PASSWORD`
- `STAGING_INVESTOR_EMAIL` / `STAGING_INVESTOR_PASSWORD`
- `STAGING_HEAD_EMAIL` / `STAGING_HEAD_PASSWORD`

Do not reuse production credentials in staging.

## Database Requirements

- Use a separate SQLite database, normally `app.sqlite` on a separate Railway staging volume.
- Do not mount the production volume.
- Do not copy production DB into staging unless the copy is explicitly approved, sanitized if needed, and treated as sensitive.
- Seeded/test data is preferred for smoke users, equipment, rentals, service, documents, payments, delivery and GSM examples.
- Seed/backfill scripts must be idempotent where possible.

## Allowed Staging Writes

Allowed only against staging:

- Creating disposable smoke clients, equipment, rentals, service tickets, documents, payments and deliveries in later write smoke stages.
- Resetting or reseeding staging data.
- Testing MAX/GSM flows with test tokens/devices only.
- Testing admin diagnostics or cleanup previews where the operation is explicitly staging-only.

Current Stage 2 smoke is read-only and does not create business records.

## Forbidden Production Smoke Writes

Do not run these against production smoke:

- Create/edit/delete rentals, payments, documents, clients, equipment, users, service tickets or deliveries.
- Run imports, backfills, cleanup, sync bulk updates or demo reset.
- Trigger MAX webhook write flows, GSM command writes, real carrier dispatch, or document generation with side effects.
- Change production Railway env, secrets, volume mounts, or database path.

Production smoke must stay read-only unless a human explicitly approves a scoped operation and a fresh backup exists.

## Safe Stage 2 Smoke Scenarios

- Open frontend.
- Check backend `/health`.
- Check backend `/api/version`.
- Login with dedicated staging admin.
- Open dashboard.
- Open read-only main sections: equipment, rentals, deliveries, service, documents, payments, finance and GSM when enabled.
- Fail on critical console errors, page errors, API 500, or unexpected 401/403 for admin-visible sections.
- Check frontend/backend commit match when both build identities are available.

Do not use the existing broad `e2e/smoke.spec.ts` against staging or production: it creates clients, equipment, rentals, service tickets, documents and users.

## Release Check

Before production release:

1. Deploy backend release candidate to the staging Railway service.
2. Deploy/build staging frontend with `VITE_API_URL=$STAGING_API_URL`.
3. Run GitHub Actions `Staging Smoke`.
4. Confirm PASS:
   - `/health` is OK;
   - `/api/version` exposes commit;
   - frontend opens;
   - admin login works;
   - dashboard and read-only sections open;
   - no critical console errors;
   - no API 500;
   - no unexpected admin 401/403;
   - frontend/backend commits match, unless Stage 3 documents an allowed metadata-only backend drift.
5. Treat failure as a release blocker until understood.

Stage 3 should add richer role smoke, production smoke with approval, and a formal allowed commit-drift policy.
