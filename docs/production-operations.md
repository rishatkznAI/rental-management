# Production Operations

This checklist documents the production deployment shape and the minimum smoke checks for Skytech Rental Management. Do not store real secrets, tokens, passwords, SQLite databases, backups, or logs in git.

## Production URLs

- Frontend: https://rishatkznai.github.io/rental-management/
- Backend API: Railway backend URL configured as `VITE_API_URL` in the frontend build.

`VITE_API_URL` must point to the backend API host, not to the GitHub Pages frontend URL.

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
- `CORS_ORIGIN` when the frontend origin is not already allowlisted
- `BOT_TOKEN` when MAX bot is enabled
- `WEBHOOK_URL` when MAX webhook transport is enabled
- `MAX_WEBHOOK_SECRET`

Generate `MAX_WEBHOOK_SECRET` as a long random value in Railway. Do not paste it into chat, docs, logs, commits, or screenshots. After enabling it, verify that MAX webhook registration logs redact the secret and that bot events are still received.

Railway billing warning: keep the Trial/Hobby plan active for the production service. If the plan is inactive or exhausted, the backend can stop responding even when the code and database are correct.

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
2. Backend version: `GET /api/version` returns the expected commit/build.
3. Frontend opens at the GitHub Pages URL.
4. Login succeeds with a dedicated production smoke/admin account.
5. Admin diagnostics opens and does not show secrets, tokens, passwords, cookies, or raw env values.
6. Documents page opens.
7. Finance page opens.
8. Logout succeeds and returns to the login page.

Do not use a personal owner account for smoke testing. Prefer a dedicated smoke user that can be disabled or rotated after verification.
