# Deploy Checklist

Use this checklist before and after production releases. Do not change production data, env vars or Railway settings during deploy unless the release explicitly requires it and a backup exists.

Production deployment is allowed while the product is conserved. Conservation is enforced by runtime flags (`APP_DISABLED`, `BOT_DISABLED`, and GSM disable flags), not by stopping frontend or backend deploys.

## Pre-Deploy

1. Confirm the target commit and release scope.
2. Confirm no unrelated risky changes are included.
3. Use Node 20 for release checks.
4. Run staging smoke before production if staging is configured:
   - Open GitHub Actions.
   - Run `Staging Smoke`.
   - Confirm the workflow passed for the target commit.
   - Download `staging-playwright-report` and `staging-playwright-test-results` if it failed.
   - Use `docs/release-runbook.md` for the current staging/prod gate details.
5. Run local checks when possible:
   - `git status`
   - `git diff --check`
   - `npm test`
   - `npm run build`
   - `npx playwright test e2e/smoke.spec.ts` when Playwright browsers are installed
6. For data-sensitive releases, download a fresh admin backup from production before deploy.
7. Confirm Railway backend production URL:
   - `https://rental-management-production-35bc.up.railway.app`
8. Confirm frontend production URL:
   - `https://rishatkznai.github.io/rental-management/`
9. Confirm the frontend build uses the production Railway backend URL as `VITE_API_URL`.
10. If production is conserved, confirm Railway production variables:
   - `APP_DISABLED=true`;
   - `BOT_DISABLED=true`;
   - `GSM_ENABLED=false` or `GSM_DISABLED=true`;
   - `/api/version` returns `app.disabled=true`.

## System Control Center

After admin login, `Панель администратора` -> `Центр контроля системы` provides a read-only safety snapshot: environment type, conservation flags, build markers, SQLite/storage labels, safe probe availability and recommendations. It must never be used to change Railway variables and does not expose secrets or raw env dumps.

The page cannot automatically prove that staging and production use isolated Railway volumes. If it shows volume isolation as `unknown`, manually verify Railway service/environment, volume mount and `DB_PATH` before smoke or release approval.

Safe probes that remain valid during conservation:

- `GET /health`
- `GET /health/ready`
- `GET /api/version`

## Staging Smoke Gate

Required setup:

- separate Railway staging service/environment;
- separate staging SQLite volume/database;
- staging frontend built with `VITE_API_URL=$STAGING_API_URL`;
- GitHub secrets `STAGING_API_URL`, `STAGING_FRONTEND_URL`, `STAGING_ADMIN_EMAIL`, `STAGING_ADMIN_PASSWORD`.
- `EXPECTED_RELEASE_COMMIT` is supplied by GitHub Actions from `github.sha`.

Run:

```bash
npm run release:preflight -- --env staging --expected-commit <commit>
npm run test:e2e:staging-smoke
```

or use GitHub Actions `Staging Smoke`.

PASS means:

- staging backend `/health` returns OK;
- staging backend `/api/version` returns build info with commit;
- staging frontend opens;
- staging admin login works;
- dashboard and read-only sections open;
- no critical console errors, page errors, API 500, or unexpected admin 401/403;
- frontend/backend commits match unless an approved metadata-only drift is documented.

BLOCKER means:

- staging points to production backend or production DB;
- any staging secret is missing;
- smoke writes to production;
- login fails;
- frontend is blank;
- `/health` or `/api/version` fails;
- critical sections throw runtime errors or API 500;
- permissions break for allowed admin sections.

On failed staging smoke, stop the production release, inspect GitHub Actions artifacts, identify whether the issue is frontend, backend, env, database seed, or commit mismatch, then fix-forward in staging and rerun smoke.

## Backend Deploy

1. Confirm Railway service root is `server`.
2. Confirm Railway start command is `npm start`.
3. Confirm Railway healthcheck path is `/health`.
4. Confirm persistent volume is mounted and `DB_PATH` points to the volume.
5. Deploy the backend.
6. Verify:
   - `GET https://rental-management-production-35bc.up.railway.app/health`
   - `GET https://rental-management-production-35bc.up.railway.app/api/version`
7. Record backend commit, build time and deployment id when available.
8. During conservation, do not disable deploys only to preserve the pause. Production deployment is allowed; production usage must remain blocked by `APP_DISABLED`, `BOT_DISABLED`, and GSM disable flags.

## Frontend Deploy

1. Confirm GitHub Pages workflow completed successfully.
2. Confirm required CI gates passed before deploy:
   - `basic-ci` on Node 20;
   - `npm ci`;
   - `npm ci --prefix server`;
   - `git diff --check`;
   - `npm test`;
   - `npm run build`;
   - `playwright-smoke` with `e2e/smoke.spec.ts`.
3. Confirm required post-deploy production gate passed:
   - `npm run release:preflight -- --env production --expected-commit <commit>`;
   - `npm run test:e2e:production-smoke`.
4. If `playwright-smoke` or production smoke failed, open the failed GitHub Actions run and download artifacts:
   - `playwright-report`;
   - `playwright-test-results`.
   - `production-playwright-report`;
   - `production-playwright-test-results`.
5. Do not re-run deploy until failed tests/build/smoke are understood and fixed.
6. Note: there are no `lint` or `typecheck` npm scripts yet, so they are not part of the required gate.
7. Open:
   - `https://rishatkznai.github.io/rental-management/`
8. Confirm the app loads without a blank screen.
9. In admin diagnostics, confirm:
   - frontend commit
   - frontend build time
   - backend health
   - backend commit
   - `VITE_API_URL`

## Stage 2 Status

1. Staging environment design is documented in `docs/staging-environment.md`.
2. Manual `workflow_dispatch` staging smoke workflow exists at `.github/workflows/staging-smoke.yml`.
3. Read-only staging spec exists at `e2e/staging-smoke.spec.ts`.
4. Production read-only smoke exists at `e2e/production-smoke.spec.ts`.
5. Release preflight exists at `scripts/release-preflight.mjs`.
6. Remaining outside-repo setup: staging Railway service, separate SQLite volume/database, staging frontend URL and GitHub `STAGING_*`/`PRODUCTION_*` secrets.
7. Remaining future work: richer role smoke and formal commit-drift policy for intentionally mixed frontend/backend releases.

## Post-Deploy Smoke

Run `docs/production-smoke-checklist.md`.

Minimum checks:

1. Backend `/health` returns `200`.
2. Backend `/api/version` returns expected build info.
3. Frontend loads on GitHub Pages.
4. Login works for a dedicated smoke/admin account.
5. Role smoke passes for admin, office manager, rental manager, mechanic, investor and head.
6. Admin diagnostics does not expose secrets, tokens, passwords, cookies or raw env values.
7. Admin System Control Center opens in normal admin mode and does not expose secrets, tokens, passwords, cookies, raw Railway secrets or full env dumps.

## Stop Conditions

Stop the deploy or start rollback if any of these happen:

- backend `/health` fails;
- frontend cannot load;
- login fails for known-good smoke users;
- role smoke shows unauthorized data access;
- admin diagnostics exposes secrets;
- documents, rentals, service, GSM, finance or MAX bot critical flows show production-breaking errors;
- frontend and backend commits are unexpectedly mismatched after both deploys complete.
- staging smoke failed or was skipped without an explicit release owner decision.

Use `docs/rollback-playbook.md` for rollback steps.
