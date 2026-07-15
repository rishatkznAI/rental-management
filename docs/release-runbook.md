# Release Runbook

Use this for staging and production releases. Do not paste secrets into logs, issues, docs, or chat.

## Smoke And Preflight Files

- Staging smoke: `e2e/staging-smoke.spec.ts`
- Production read-only smoke: `e2e/production-smoke.spec.ts`
- Shared smoke diagnostics: `e2e/helpers/releaseSmoke.ts`
- Staging Playwright config: `playwright.staging.config.ts`
- Production Playwright config: `playwright.production.config.ts`
- URL/commit/API preflight: `scripts/release-preflight.mjs`
- GitHub Actions:
  - Staging smoke: `.github/workflows/staging-smoke.yml`
  - GitHub Pages production deploy and production gate: `.github/workflows/deploy.yml`

## Required GitHub Secrets

Staging:

- `STAGING_API_URL`
- `STAGING_FRONTEND_URL`
- `STAGING_ADMIN_EMAIL`
- `STAGING_ADMIN_PASSWORD`

Production:

- `PRODUCTION_API_URL`
- `PRODUCTION_FRONTEND_URL`
- `PRODUCTION_ADMIN_EMAIL`
- `PRODUCTION_ADMIN_PASSWORD`

The workflows validate that these values exist, but never print secret values. Smoke logs may print URLs and HTTP status codes, not passwords or tokens.

## Commit Checks

Backend:

```bash
curl -fsS "$PRODUCTION_API_URL/api/version"
```

Expected: JSON has `ok: true` and `build.commit` or `build.commitFull` matching the release commit.

Staging frontend:

```bash
STAGING_FRONTEND_URL="https://<staging-frontend-host>" \
STAGING_API_URL="https://<staging-backend>.up.railway.app" \
node scripts/release-preflight.mjs --env staging --expected-commit <commit>
```

Expected: the separate staging frontend HTML/assets are reachable, contain the expected commit marker, contain `STAGING_API_URL`, and do not contain a production-like Railway backend URL. Do not use `https://rishatkznai.github.io/rental-management/` as `STAGING_FRONTEND_URL`.

Production frontend:

```bash
PRODUCTION_FRONTEND_URL="https://rishatkznai.github.io/rental-management/" \
PRODUCTION_API_URL="https://rental-management-production-35bc.up.railway.app" \
node scripts/release-preflight.mjs --env production --expected-commit <commit>
```

Expected: frontend HTML/assets are reachable, contain the expected commit marker, and contain the expected API URL.

## Staging Frontend

Staging frontend is a separate deployment from production frontend. It must be built from the target commit and configured only for the staging backend:

- `VITE_API_URL=$STAGING_API_URL`
- `VITE_BASE_PATH=/` for root-domain static hosts such as Railway or Vercel
- `VITE_GIT_COMMIT_SHA=<release commit>` only if the platform does not expose the commit automatically

If no staging frontend service exists yet, create one manually in Railway or another static host:

1. Create a new frontend service for repository `rishatkznAI/rental-management`.
2. Use branch `main`.
3. Set build command to `npm ci && npm run build`.
4. Set static output directory to `dist`.
5. Set environment `VITE_API_URL=<staging backend URL>` and `VITE_BASE_PATH=/`.
6. Deploy the target commit.
7. Copy its public URL into GitHub secret `STAGING_FRONTEND_URL`.

Production GitHub Pages is not a staging frontend. A local `vite preview` is also not a staging frontend for release smoke.

## Before Production Deploy

1. Confirm the target release commit.
2. Confirm production backup exists and was checked.
3. Deploy or verify the staging backend for that commit.
4. Deploy or verify the separate staging frontend for that commit.
5. Run staging preflight:
   - backend `/health`;
   - backend `/api/version`;
   - frontend marker;
   - frontend API URL;
   - no production backend URL in the staging bundle.
6. Run GitHub Actions `Staging Smoke`.
7. Confirm staging passed:
   - frontend commit marker matches target commit;
   - backend `/health` returns `200`;
   - backend `/api/version` matches target commit;
   - staging admin login works;
   - main read-only sections open without console/API errors.
8. Do not start production deploy while staging smoke is red unless the release owner explicitly accepts the risk and records why.

## Production Gate

Release status words are strict:

- `MERGED` means the code is in `main`.
- `DEPLOYED` means the public frontend marker and backend `/api/version` show the intended production commit, except an explicitly scoped `frontend-only` or `deploy-tooling` release may allow backend commit drift.
- `DEMO_READY` means `DEPLOYED` plus the required read-only UI smoke passed.

Do not say the demo can be shown while the public frontend marker is missing or still points at an older commit.

The GitHub Pages deploy workflow runs in two ways:

- automatically on `push` to `main` when frontend/build-relevant files change;
- manually through `workflow_dispatch` with an explicit `release_type`.

Automatic `main` deploys classify the changed files before publishing:

- `frontend-only`: `src/**`, `public/**`, `index.html`, `vite.config.*`, `postcss.config.*`, `tsconfig*.json`, root `package.json`, root `package-lock.json`, `scripts/vite-build.mjs`, and docs.
- `deploy-tooling`: `.github/workflows/deploy.yml`, release preflight/marker scripts, production smoke helper/spec files, root `tests/*.test.js` coverage, and release/deploy/smoke/preflight docs. Root tests do not count as frontend runtime; backend, data, secret, arbitrary script, and runtime frontend changes remain outside this scope.
- Backend or deploy-critical files, including `server/**`, non-build `scripts/**`, most workflow changes, Railway/Docker/env files, and server package files, block the automatic Pages deploy with a workflow summary explaining which files require a backend or full-stack release.

The production GitHub Pages deploy workflow requires:

- successful install/test/build;
- `git diff --check`;
- production frontend build with `VITE_API_URL=$PRODUCTION_API_URL`;
- local Playwright smoke before deploy;
- successful GitHub Pages deploy;
- production preflight after deploy:
  - frontend URL reachable;
  - backend `/health`;
  - backend `/api/version`;
  - frontend commit marker;
  - frontend API URL;
- public frontend marker verification from `window.__SKYTECH_BUILD_INFO__`:
  - expected commit;
  - actual FE marker;
  - build time;
  - API URL;
- production read-only Playwright smoke login and section checks.

If the post-deploy gate fails, the workflow is failed and the release is not considered successful.

Production release order:

1. Deploy production backend through the Railway/external backend flow. The Railway start wrapper sets `RAILWAY_RELEASE_TYPE=backend` for Git-backed backend deploys when no explicit release metadata exists; set `RELEASE_TYPE=full-stack` for a full-stack release before the backend deploy when the release owner needs the backend to report `full-stack`.
2. Deploy production frontend through GitHub Pages.
3. Run production preflight.
4. Run production smoke.

## 401 On `/api/auth/login`

Treat `401` as an auth/environment/data problem first, not a selector problem.

Check:

- the smoke user exists in the target environment database;
- the smoke user is active (`Активен`);
- the workflow uses the correct environment secrets;
- `STAGING_API_URL`/`PRODUCTION_API_URL` points to the intended backend;
- the frontend build marker `apiBaseUrl` points to that same backend;
- `/api/version` backend commit is the intended release commit;
- the smoke password was rotated in both the DB/user record and GitHub secret.

Do not print the password or token while diagnosing. The smoke failure includes current URL, visible body text, frontend commit marker, API URL, frontend URL, and captured `/api/auth/login` HTTP status.

## Old Frontend Build

If the frontend still serves an old commit after deploy:

1. Check the production preflight output for the actual frontend marker.
2. Confirm GitHub Pages deploy completed for the target commit.
3. Hard-refresh the browser and retry with `?debugVersion=1`.
4. Re-run:

```bash
node scripts/release-preflight.mjs --env production --expected-commit <commit> --old-commit <previous-commit>
```

5. If the old build is still served, stop release verification and redeploy GitHub Pages after confirming the workflow built with the correct `VITE_GIT_COMMIT_SHA` and `VITE_API_URL`.

## After Production Deploy

Required checks:

- production workflow is green;
- `/health` returns `200`;
- `/api/version` returns expected commit;
- frontend marker returns expected commit and API URL;
- production smoke login passes;
- console errors are `0`;
- API errors are `0`;
- no secrets, passwords, tokens, bot secrets, or session data appear in logs.
