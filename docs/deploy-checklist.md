# Deploy Checklist

Use this checklist before and after production releases. Do not change production data, env vars or Railway settings during deploy unless the release explicitly requires it and a backup exists.

## Pre-Deploy

1. Confirm the target commit and release scope.
2. Confirm no unrelated risky changes are included.
3. Use Node 20 for release checks.
4. Run local checks when possible:
   - `git status`
   - `git diff --check`
   - `npm test`
   - `npm run build`
   - `npx playwright test e2e/smoke.spec.ts` when Playwright browsers are installed
5. For data-sensitive releases, download a fresh admin backup from production before deploy.
6. Confirm Railway backend production URL:
   - `https://rental-management-production-35bc.up.railway.app`
7. Confirm frontend production URL:
   - `https://rishatkznai.github.io/rental-management/`
8. Confirm the frontend build uses the production Railway backend URL as `VITE_API_URL`.

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
3. If `playwright-smoke` failed, open the failed GitHub Actions run and download artifacts:
   - `playwright-report`;
   - `playwright-test-results`.
4. Do not re-run deploy until failed tests/build/smoke are understood and fixed.
5. Note: there are no `lint`, `typecheck`, standalone `smoke` or standalone `playwright` npm scripts yet, so they are not part of the required gate.
6. Open:
   - `https://rishatkznai.github.io/rental-management/`
7. Confirm the app loads without a blank screen.
8. In admin diagnostics, confirm:
   - frontend commit
   - frontend build time
   - backend health
   - backend commit
   - `VITE_API_URL`

## Stage 2 Remaining Work

1. Add staging Railway service and a separate staging database/volume.
2. Add a manual `workflow_dispatch` staging smoke workflow.
3. Add protected production smoke with explicit approval and read-only checks by default.
4. Add frontend/backend commit consistency checks after deploy.
5. Add dedicated role smoke for `head` / `Руководитель`.

## Post-Deploy Smoke

Run `docs/production-smoke-checklist.md`.

Minimum checks:

1. Backend `/health` returns `200`.
2. Backend `/api/version` returns expected build info.
3. Frontend loads on GitHub Pages.
4. Login works for a dedicated smoke/admin account.
5. Role smoke passes for admin, office manager, rental manager, mechanic, investor and head.
6. Admin diagnostics does not expose secrets, tokens, passwords, cookies or raw env values.

## Stop Conditions

Stop the deploy or start rollback if any of these happen:

- backend `/health` fails;
- frontend cannot load;
- login fails for known-good smoke users;
- role smoke shows unauthorized data access;
- admin diagnostics exposes secrets;
- documents, rentals, service, GSM, finance or MAX bot critical flows show production-breaking errors;
- frontend and backend commits are unexpectedly mismatched after both deploys complete.

Use `docs/rollback-playbook.md` for rollback steps.
