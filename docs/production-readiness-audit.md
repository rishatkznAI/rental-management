# Production Readiness Audit

Дата аудита: 2026-05-17.

Production endpoints:

- Frontend: https://rishatkznai.github.io/rental-management/
- Backend: https://rental-management-production-35bc.up.railway.app

Аудит выполнен по репозиторию без рискованных изменений в production-логике. Stage 1 CI hardening меняет только CI/runtime metadata и документацию.

## Scope

Проверены:

- `package.json`, `server/package.json`
- `.github/workflows/deploy.yml`
- `playwright.config.ts`
- `e2e/*`
- `tests/*`
- `server/*`
- `README.md`
- `docs/*`

## Текущий Статус

| Область | Статус | Наблюдение |
|---|---|---|
| CI | Stage 1 ready | `.github/workflows/deploy.yml` теперь запускает Basic CI на Node 20 перед публикацией: root `npm ci`, backend `npm ci --prefix server`, `git diff --check`, `npm test`, `npm run build`. |
| Tests | CI + local | `npm test` запускает `node --test tests/*.test.js`. Набор широкий: backend/domain/security/finance/service/delivery/bot/system. Теперь это обязательный gate перед GitHub Pages deploy. |
| E2E | Focused smoke in CI | Playwright настроен в `playwright.config.ts`, поднимает Vite на `127.0.0.1:5173` и backend на `127.0.0.1:3000`. CI запускает focused `e2e/smoke.spec.ts` отдельным job после Basic CI. |
| Build | CI + local | `npm run build` запускается в Basic CI и формирует Pages artifact только после успешных checks. Локально доступен тот же script. |
| Deploy | Gated frontend deploy | Frontend деплоится через GitHub Pages workflow только после успешных `basic-ci` и `playwright-smoke`. Backend Railway деплой описан в `docs/production-operations.md`, но отдельного backend deploy gate в репозитории нет. |
| Production smoke | Partial/manual | В `docs/production-operations.md` есть post-deploy smoke checklist. В `e2e/*` есть production-style smoke tests по ролям, но они настроены на локальный backend/frontend. Отдельного GitHub Actions workflow для production smoke нет. |
| Staging smoke | Stage 2 partial | Добавлены `docs/staging-environment.md`, `.github/workflows/staging-smoke.yml`, `playwright.staging.config.ts` и read-only `e2e/staging-smoke.spec.ts`. Для реального запуска нужны staging Railway/frontend URL и GitHub secrets. |
| Backup | Partial | Есть admin-only full backup endpoint `GET /api/admin/backup/full`, история backup downloads и документация в `docs/production-operations.md`. Restore UI/API не реализован; restore playbook до этого этапа отсутствовал. |
| Rollback | Missing | До этого этапа отдельного rollback playbook не было. GitHub Pages и Railway rollback steps не были формализованы в отдельном документе. |
| Monitoring/logging | Partial | Есть `/health`, `/api/version`, admin production diagnostics, audit/security logging и backup audit history. Нет внешнего monitoring/alerting workflow или documented alert policy. |

## Что Уже Запускается В CI

- Checkout.
- Setup GitHub Pages.
- Setup Node 20.
- `npm ci`.
- `npm ci --prefix server`.
- `git diff --check`.
- `npm test`.
- `npm run build`.
- Upload Pages artifact.
- Focused Playwright smoke: `npx playwright install --with-deps`, затем `npx playwright test e2e/smoke.spec.ts`.
- On smoke failure, upload `playwright-report/` and `test-results/` as GitHub Actions artifacts.
- Deploy to GitHub Pages only after Basic CI and Playwright smoke pass.

Node 24 drift removed from root package metadata, server package metadata, Railway nixpacks pin and GitHub Actions workflow. Required release runtime is Node 20.

## Что Запускается Только Локально

- `npm test` -> `node --test tests/*.test.js`.
- `npm run test:e2e` -> полный Playwright suite.
- `npm run test:e2e:smoke` -> `playwright test e2e/smoke.spec.ts`.
- No `lint`, `typecheck`, standalone `smoke` or standalone `playwright` npm scripts are currently defined.
- Role UI smoke files:
  - `e2e/admin-ui-smoke.spec.ts`
  - `e2e/office-ui-smoke.spec.ts`
  - `e2e/rental-manager-ui-smoke.spec.ts`
  - `e2e/mechanic-ui-smoke.spec.ts`
  - `e2e/investor-ui-smoke.spec.ts`
  - дополнительные mechanic/carrier smoke specs.
- Manual production checks from `docs/production-operations.md`.

## Чего Не Хватает

- Production smoke workflow with explicit environment approval.
- Staging smoke workflow and staging URLs.
- Automated check that frontend build commit matches backend `/api/version` commit.
- Dedicated Playwright smoke for `head` / `Руководитель` role.
- Documented restore drill with expected validation steps.
- External uptime monitoring and alert ownership.

## Production Smoke Workflow

Отдельный production smoke workflow не обнаружен.

Есть ручной checklist в `docs/production-operations.md` и локальные Playwright smoke tests. Production-ready следующий шаг: добавить manual `workflow_dispatch` smoke workflow, который:

- использует Node 20;
- не деплоит;
- проверяет `GET /health`;
- проверяет `GET /api/version`;
- открывает GitHub Pages frontend;
- сверяет frontend commit/build timestamp с backend version, если оба commit доступны;
- запускает smoke по dedicated production smoke users;
- требует GitHub Environment approval для production.

## Staging Smoke Workflow

Stage 2 добавил отдельный manual workflow: `.github/workflows/staging-smoke.yml`.

Workflow:

- запускается через `workflow_dispatch`;
- использует Node 20;
- выполняет `npm ci`, `npm ci --prefix server`, `npm run build`;
- устанавливает Playwright browsers;
- запускает `npx playwright test e2e/staging-smoke.spec.ts --config=playwright.staging.config.ts`;
- загружает `playwright-report/` и `test-results/` artifacts.

Нужны GitHub secrets:

- `STAGING_API_URL`;
- `STAGING_FRONTEND_URL`;
- `STAGING_ADMIN_EMAIL`;
- `STAGING_ADMIN_PASSWORD`.

Staging URL в документации или коде не найден. До добавления secrets и отдельной Railway staging service workflow готов структурно, но реальный smoke будет заблокирован validate-secrets шагом.

Read-only staging smoke проверяет frontend boot, backend `/health`, backend `/api/version`, admin login, dashboard, основные разделы, отсутствие critical console errors, API 500 и неожиданных 401/403 для admin-visible pages. Он не создает аренды, платежи, документы, пользователей или сервисные заявки.

## Backup/Restore

Что есть:

- admin-only full backup download: `GET /api/admin/backup/full`;
- backup archive includes SQLite snapshot, manifest and local files;
- backup audit history routes and tests;
- production operations notes warn not to commit backups/secrets.

Что отсутствует:

- restore UI/API;
- formal restore playbook;
- periodic restore drill;
- documented RPO/RTO;
- pre-deploy backup requirement tied to release risk.

## Rollback

До этого этапа rollback instruction не была выделена в отдельный playbook.

Нужны отдельные процедуры для:

- frontend rollback on GitHub Pages;
- backend rollback on Railway;
- data rollback from SQLite backup;
- mixed rollback where frontend and backend commits temporarily differ;
- decision point between rollback and fix-forward.

## Backend/Frontend Commit Match

Что есть:

- Backend exposes build info via `/health` and `/api/version`.
- Frontend embeds `__APP_COMMIT_HASH__` and `__APP_BUILD_TIME__` through `vite.config.ts`.
- Admin diagnostics shows frontend commit/build time and backend commit.
- `BuildDebugBadge` can expose frontend build info in debug mode.

Gap:

- No automated CI/smoke assertion compares production frontend build commit to backend `/api/version` commit.
- GitHub Pages workflow currently does not set a shortened explicit `VITE_GIT_COMMIT_SHA`; Vite can read `GITHUB_SHA`, but the verification is manual.

## Риски

### Критичные

- Production frontend deploy is now gated by Node tests, build and focused local Playwright smoke. Backend Railway deploy remains outside GitHub Actions visibility.
- No automated production smoke gate after deploy; production health/version and role checks are manual.
- Staging smoke is absent, so production is the first deployed environment with realistic integration conditions.
- Restore process is not formalized and not drilled; backup exists, but recovery confidence is incomplete.

### Средние

- Node version drift should be watched in future dependency/tooling updates; Stage 1 pins project metadata and CI to Node 20.
- No automated frontend/backend commit consistency check.
- `head` role has backend/unit coverage, but no dedicated Playwright role smoke.
- Railway backend deployment is outside GitHub Actions visibility, so frontend deploy can proceed without backend readiness signal.
- E2E suite depends on local seeded state and may be too broad/flaky for a required fast CI gate unless split.

### Низкие

- Production operations documentation exists but is spread across files and not mapped to release stages.
- Manual smoke checklist did not explicitly list all requested roles before this stage.
- Monitoring/logging exists at app level, but alerting ownership and thresholds are not documented.

## Что Хорошо Сделано

- Backend has `/health` and `/api/version`.
- Frontend embeds commit and build timestamp.
- Admin diagnostics shows frontend/backend build info and safe endpoint summaries without secrets.
- There is a broad Node test suite covering security, RBAC, system routes, backup, delivery, service, finance, bot and data safety paths.
- Playwright has role-oriented smoke coverage for admin, office manager, rental manager, mechanic and investor.
- Backup endpoint is admin-only, tested, audited and includes SQLite snapshot plus local files.
- Production operations doc already warns about Railway persistent volume and secret handling.
- GitHub Pages deployment is simple and reproducible through one workflow.

## Что Добавить В Следующих Этапах

- Dedicated smoke script or Playwright project for role smoke: admin, office manager, rental manager, mechanic, investor, head.
- Staging environment and `workflow_dispatch` staging smoke.
- Production smoke workflow with manual approval and read-only checks by default.
- Automated frontend/backend build identity check.
- Rollback playbook execution drill after a low-risk release.
- Backup restore drill and documented RPO/RTO.
- External uptime checks for `/health` and alert routing.

## Recommended Roadmap

### Stage 1: CI Hardening

- Completed: pin Node 20 in GitHub Actions, root package, server package and Railway nixpacks metadata.
- Completed: gate GitHub Pages deploy on root/backend clean installs, `git diff --check`, `npm test` and `npm run build`.
- Completed: add a focused Playwright smoke job that runs `e2e/smoke.spec.ts` against the local app.
- Completed: upload Playwright `playwright-report/` and `test-results/` artifacts on smoke failure.
- Keep full Playwright suite optional or scheduled until flakiness is known.
- Upload Playwright reports only as CI artifacts, never commit them.

### Stage 2: Staging Smoke

- Completed in repo: documented staging environment requirements in `docs/staging-environment.md`.
- Completed in repo: added manual `workflow_dispatch` staging smoke workflow.
- Completed in repo: added remote Playwright config and read-only staging smoke spec.
- Still required outside repo: create staging Railway service with separate SQLite volume/database.
- Still required outside repo: deploy staging frontend build with staging `VITE_API_URL`.
- Still required outside repo: add `STAGING_*` GitHub secrets and dedicated staging smoke user.
- Future: add seeded role users and write smoke only for staging.

### Stage 3: Production Smoke + Rollback

- Add manual production smoke workflow protected by GitHub Environment approval.
- Check `GET /health`, `GET /api/version`, frontend build info and role smoke.
- Compare frontend commit/build timestamp with backend commit/build info and document allowed mismatch cases.
- Run smoke immediately after GitHub Pages and Railway deploys.
- Use `docs/rollback-playbook.md` for failed smoke.

### Stage 4: Monitoring + Alerting

- Add external uptime monitoring for `/health`.
- Add alert routing for backend unavailable, repeated 5xx, failed backup, and failed smoke workflow.
- Document owner, severity, escalation and expected response time.
- Schedule restore drills and smoke workflow dry-runs.
