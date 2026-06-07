# Production Operations

This checklist documents the production deployment shape and the minimum smoke checks for Skytech Rental Management. Do not store real secrets, tokens, passwords, SQLite databases, backups, or logs in git.

## Production URLs

- Frontend: https://rishatkznai.github.io/rental-management/
- Backend API: Railway backend URL configured as `VITE_API_URL` in the frontend build.

`VITE_API_URL` must point to the backend API host, not to the GitHub Pages frontend URL.

## Branch Protection And Required Checks

The protected production branch is `main`.

- Direct push to `main` is forbidden.
- Merge to `main` must go through a pull request.
- Required check context for branch protection: `lightweight-pr-check`.
- Do not use `Lightweight PR Check / lightweight-pr-check` as the required context. GitHub branch protection must use the actual check context, not the workflow display name or a combined workflow/job label.
- Do not use `--admin` to bypass branch protection unless there is a separate explicit decision to do so.
- Railway backend autodeploy runs after a PR is merged into `main` when backend watch paths changed.
- A manual Railway deploy is not needed in the normal merge-to-main scenario.

## Railway Backend

The backend runs as a separate Railway service from the frontend.

Required Railway service settings:

- Root Directory: `/server`
- Start Command: `npm start`
- Healthcheck Path: `/health`
- Persistent volume mount: `/data`
- SQLite path env: `DB_PATH=/data/app.sqlite`

Required or recommended Railway variables:

- `DB_PATH`
- `NODE_ENV`
- `PORT`
- `RELEASE_TYPE` or `RELEASE_PREFLIGHT_RELEASE_TYPE` for backend/full-stack releases (`backend` or `full-stack`)
- `CORS_ORIGIN` when the frontend origin is not already allowlisted
- `BOT_TOKEN` when MAX bot is enabled
- `WEBHOOK_URL` when MAX webhook transport is enabled
- `MAX_WEBHOOK_SECRET`

Railway provides `RAILWAY_GIT_COMMIT_SHA`, but it does not classify the release scope. Backend/full-stack deploys must pass `RELEASE_TYPE` or `RELEASE_PREFLIGHT_RELEASE_TYPE` to the Railway backend runtime so `/health` and `/api/version` expose the real release type instead of `unknown`. The backend reads release metadata in this order: `RELEASE_TYPE`, `RELEASE_PREFLIGHT_RELEASE_TYPE`, `RAILWAY_RELEASE_TYPE`, `server/release-marker.json`, then `unknown`.

Generate `MAX_WEBHOOK_SECRET` as a long random value in Railway. Do not paste it into chat, docs, logs, commits, or screenshots. After enabling it, verify that MAX webhook registration logs redact the secret and that bot events are still received.

Railway billing warning: keep the Trial/Hobby plan active for the production service. If the plan is inactive or exhausted, the backend can stop responding even when the code and database are correct.

## Conservation Mode

Production deployment is allowed during conservation. Frontend and backend may continue to update from `main`; production usage is blocked at runtime instead.

Required Railway production variables during conservation:

- `APP_DISABLED=true` blocks login, existing authenticated API access and mutating business API work while keeping `/health`, `/health/ready` and `/api/version` available.
- `BOT_DISABLED=true` acknowledges MAX webhook traffic without running bot scenarios or creating service tickets, deliveries, rentals, photos, works, parts or bot sessions.
- `GSM_ENABLED=false` or `GSM_DISABLED=true` blocks HTTP GSM ingest and prevents GSM/GPRS TCP gateways from listening after restart.

`GET /api/version` must show `app.disabled=true` while `APP_DISABLED=true`.

Do not run production write smoke during conservation. Use staging for active testing.

## System Control Center

Admins can open `Панель администратора` -> `Центр контроля системы` for a read-only status view. It shows environment classification, backend/frontend build markers, conservation flag interpretation, safe SQLite path labels, storage signals, safe probe status and manual recommendations.

The control center cannot prove Railway staging/production volume isolation by itself. If runtime signals cannot prove `DB_PATH` and the mounted volume belong to the intended environment, it reports `unknown` and asks an admin to check Railway volume and `DB_PATH` manually.

The app must not mutate its own production env flags. Change `APP_DISABLED`, `BOT_DISABLED`, `GSM_ENABLED` and `GSM_DISABLED` only through Railway UI/CLI or another approved external deployment workflow.

Safe production probes remain:

- `GET /health`
- `GET /health/ready`
- `GET /api/version`

## Frontend

The frontend is deployed as a static Vite app on GitHub Pages:

- URL: https://rishatkznai.github.io/rental-management/
- Build command: `npm run build`
- Output directory: `dist`
- Base path: `/rental-management/`

The production build must receive the backend Railway URL through `VITE_API_URL`.

## Data Safety

Production import is an admin-only recovery tool, not a routine operation.

Before any production import:

1. Confirm the Railway volume is mounted at `/data`.
2. Confirm `DB_PATH` points inside the mounted volume.
3. Create a fresh SQLite backup or system JSON export.
4. Run import dry-run and review counts, unknown collections, duplicate IDs, and conflicts.
5. Import only after an explicit human approval.

Never commit:

- `.env` or secret-bearing env files
- bot tokens
- webhook secrets
- passwords
- SQLite files
- SQLite WAL/SHM files
- backups
- logs
- Playwright reports or runtime artifacts

## Резервное Копирование

Администратор может скачать полный backup в разделе `Панель администратора` → `Данные системы` → `Резервная копия`.

Backup доступен только admin-пользователям и скачивается через `GET /api/admin/backup/full`. Архив создаётся на лету и содержит:

- `manifest.json` с датой генерации, build info, counts по коллекциям, списком локальных файлов и предупреждением о чувствительных данных;
- `database/app.sqlite` — консистентный SQLite snapshot текущей базы;
- `files/...` — локальные файлы/фото из серверных директорий uploads/photos/documents/files/attachments, если они есть;
- `README-backup.txt` с краткими правилами хранения.

Рекомендуемый режим: скачивать backup перед import, крупными ручными правками, релизами с миграциями и регулярно по операционному регламенту. Хранить архив нужно в закрытом хранилище владельца или компании с ограниченным доступом.

Нельзя:

- коммитить backup в Git;
- хранить backup в публичных чатах или общих папках;
- пересылать backup без необходимости;
- считать backup обезличенным — внутри могут быть персональные, коммерческие и служебные данные.

Автоматическое восстановление из полного backup пока не реализовано в UI/API. Restore требует отдельного регламента и ручной проверки копии базы/файлов.

## Post-Deploy Smoke Checklist

Run these checks after every production deploy:

1. Backend health: `GET /health` returns `200`.
2. Backend version: `GET /api/version` returns the expected commit/build and `releaseType` is not `unknown` for backend/full-stack releases.
3. Frontend opens at the GitHub Pages URL.
4. Release preflight passes:
   `npm run release:preflight -- --env production --expected-commit <commit>`.
5. Login succeeds with a dedicated production smoke/admin account:
   `npm run test:e2e:production-smoke`.
6. Admin diagnostics opens and does not show secrets, tokens, passwords, cookies, or raw env values.
7. Documents page opens.
8. Finance page opens.
9. Logout succeeds and returns to the login page.

Do not use a personal owner account for smoke testing. Prefer a dedicated smoke user that can be disabled or rotated after verification.
