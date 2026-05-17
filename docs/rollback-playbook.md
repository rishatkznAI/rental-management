# Rollback Playbook

Use this when production smoke fails or users report a production-breaking regression. Prefer the smallest rollback that restores service safely. Do not overwrite production data without a confirmed backup and explicit human approval.

## First 10 Minutes

1. Freeze additional deploys.
2. Capture facts:
   - incident start time;
   - frontend URL status;
   - backend `/health` status;
   - backend `/api/version` output;
   - frontend commit/build time from admin diagnostics or debug build info;
   - last successful smoke result;
   - affected roles and pages.
3. Decide whether this is:
   - frontend-only;
   - backend-only;
   - data issue;
   - mixed frontend/backend compatibility issue.

## Frontend Rollback

Use when backend is healthy and the regression is in the GitHub Pages frontend.

1. Identify the last known good frontend commit.
2. Re-run GitHub Pages deploy from the last known good commit, or revert the offending frontend commit and deploy.
3. Verify the Pages workflow completed.
4. Open `https://rishatkznai.github.io/rental-management/`.
5. Run production smoke:
   - login;
   - admin diagnostics;
   - role smoke;
   - affected page.
6. Confirm frontend build commit changed to the rollback commit.

## Backend Rollback

Use when `/health`, `/api/version`, auth, API, MAX bot, GSM, documents, rentals, service or finance behavior broke after backend deploy.

1. Identify the last known good Railway deployment.
2. Roll back to that deployment in Railway.
3. Do not change `DB_PATH`, volume mount or secrets during rollback.
4. Verify:
   - `GET /health`;
   - `GET /api/version`;
   - login;
   - affected API route.
5. Run production smoke.
6. Confirm backend commit is the expected rollback commit.

## Data Restore

Use only when production data was corrupted or an import/backfill caused a bad state. This is higher risk than code rollback.

1. Stop writes if possible.
2. Download and preserve the current broken database state for forensic analysis.
3. Identify the backup created before the risky operation.
4. Verify the backup archive:
   - `manifest.json` exists;
   - `database/app.sqlite` exists;
   - expected local files are present when relevant.
5. Restore in a staging or local clone first.
6. Run validation:
   - app starts;
   - `/health`;
   - `/api/version`;
   - admin login;
   - clients/rentals/equipment/service/documents/payments counts look expected;
   - affected business flow works.
7. Restore production only after explicit approval.
8. Run full production smoke after restore.

## Fix-Forward Criteria

Fix-forward can be safer than rollback when:

- the bad change is small and well understood;
- no data was corrupted;
- the previous version is incompatible with current data;
- rollback would reintroduce a worse production issue.

Even for fix-forward, run the same health, version and smoke checks after deploy.

## Communication Notes

Record:

- root cause summary;
- rollback or fix-forward commit/deployment;
- smoke result;
- data restore status;
- follow-up tests or CI gates needed.

Never paste secrets, tokens, passwords, raw env values or full backup contents into issue comments, chats or docs.
