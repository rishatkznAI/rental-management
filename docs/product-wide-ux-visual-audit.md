# rentCore Product-wide UX & Visual Audit

Дата локального аудита: 18 августа 2026 г.

Статус документа: implementation audit перед публикацией PR.

## 0. Safety / Baseline Gate

Работа изолирована в отдельном worktree `/Users/rishat/Documents/GitHub/rental-management-product-wide-ux-audit` и ветке `codex/product-wide-ux-visual-audit`, созданной от свежего `origin/main`.

| Проверка | Результат |
|---|---|
| Исходная ветка пользователя | `codex/dashboard-v2-plan-integrity-hotfix` |
| Исходный HEAD | `39c5856d257988e4c546f4e6a2a9e32d4c2112e6` |
| `origin/main` на старте | `7be4ed0e4999b445473d5adf17886b9051cf5e9c` |
| Ahead / behind исходной ветки относительно `origin/main` | 2 / 4 |
| Защищённые изменения пользователя | `.env.production`, `infrastructure/`, `tests/cloudflare-api-proxy.test.js` |
| Состояние защищённых файлов | не переносились, не редактировались и не очищались |
| `npm test` | 3329 passed, 0 failed, 292296 ms |
| `npm run build` | passed |
| `npm run test:e2e:smoke` | 7 passed, 28.5 s |
| `git diff --check` | passed |

Первый запуск unit и smoke был красным только потому, что новый worktree не имел зависимостей из отдельного `server/package.json`. После штатного `npm ci` в корне и `server/` baseline полностью зелёный. Это не продуктовый дефект.

Риск среды: manifests требуют Node 20.x, локально активен Node 22.22.0. `npm audit` до изменений сообщал 7 корневых уязвимостей и 3 moderate уязвимости server-пакетов. Автоматический `npm audit fix` не запускался, чтобы не смешивать dependency/security scope с UX-аудитом.

## 1. Product Inventory

Dashboard V2 использован как reference quality bar. Inventory выполнен по объявленным routes, permission guards, shared primitives, loading/error components, demo dataset и локальному браузерному проходу.

| Экран / поток | Назначение и главный action | Вторичные действия и hierarchy | Состояния, доступность и verdict |
|---|---|---|---|
| Login | Аутентификация; главный action — вход | show password, remember me, demo entry | Семантический `h1` есть только для SR, labels и focus ring есть. Desktop/mobile устойчивы. Demo badge на mobile перекрывал интерфейс — исправлено. |
| Dashboard V2 | Executive/operational cockpit; главный action — перейти к риску | KPI, attention queue, finance/fleet/service drill-down | Эталон. Null и 0 различаются, у графика есть скрытая таблица данных, light/dark и mobile проверены. Бизнес-логику не меняли. |
| Tasks Center | Единая вычисленная очередь; главный action — открыть задачу | refresh, filters, source drill-down | Очень длинный список при demo data, но page overflow отсутствует. Read-only контракт виден в интерфейсе. |
| Rentals list | Ежедневная работа со сделками; главный action — новая аренда / открыть аренду | tabs, filters, delivery/document/payment actions, KPIs, movement chart | Сильная operational hierarchy, но визуально плотнее Dashboard. Desktop table и mobile cards сохранены. |
| Rental create | Создать договор аренды | client/equipment/date/rate/delivery/responsible/status fields | Canonical client/equipment selectors и validations уже существуют. Финансовые расчёты не менялись. |
| Rental detail/edit | Полный rental 360 и переходы к документам/платежам/доставке/сервису | tabs, extension, return, document/payment creation | Back icon не имел accessible name — исправлено. Stable IDs и финансовые поля не затронуты. |
| Planner | Подготовка техники и логистики | filters, risk comments, status work | Controlled workspace, no page overflow. В desktop/tablet использует собственную scroll-модель. |
| Equipment registry | Где техника, доступность, Ready-to-Rent и blockers | filters, readiness strip, action queue, quick view | Хорошая operational summary. Light-theme warning text имел недостаточный контраст — исправлено. Internal horizontal scrollers сохранены. |
| Equipment create/detail | Паспорт, состояние, location, documents, GSM, TO, rental/service history | edit, create rental, more actions, technical events | Информационно насыщено, но signals идут раньше истории. Mobile остаётся длинным, без page overflow. |
| Clients / Counterparties | Registry и Client 360; главный action — новый клиент / открыть карточку | roles, contacts, rentals, payments, debts, documents, activity | Stable IDs отображаются рядом с именами там, где это помогает сверке. Detail очень длинный; глубокий redesign отложен. |
| CRM / opportunities | Deals, pipelines, activities | create/edit/move deal, calls, visits, commercial offers | Реализован и routed как `/crm`, но штатно закрыт `VITE_CRM_ENABLED=false`; permission guard возвращает пользователя на Dashboard. Не включался и не перестраивался в рамках этапа. |
| Sales | Коммерческий контур продажной техники | showcase, pricing, proposals, sales documents, settings | Отдельный bounded scope. Не смешивался с rental CRM. |
| Finance | Cash flow, economics, operations, fixed expenses, AR, leasing, accounts, VAT | date range, export, operation creation, tabs | Safety-critical contracts сохранены. Responsive tabs используют controlled internal scroll. Presentation-only audit. |
| Payments | Реестр платежей и allocations | filters, export, create, payment detail | Amount/date/status hierarchy читаема; mobile cards уже есть. Allocation/counterparty logic не менялась. |
| Receivables / debtors | Canonical AR analysis and debtor drill-down | aging, client/rental navigation, plans | Доступен внутри Finance. Unknown остаётся unknown; zero не подставлялся. |
| Service | Ticket queue, priorities, mechanics, parts and closure | create, complaints, repeat breakdowns, planner, quick actions | Operational signals стоят выше списка. Mobile cards существуют. |
| Service detail | Полный service ticket / work order | assign, waiting parts, complete, cancel, work order | Показывает equipment, priority, responsible and dates. Destructive actions визуально отделены; domain не менялся. |
| Warranty | Claims and factory/supplier relations | claim status, evidence, factory relation | Встроен в Service и permission-gated. Canonical counterparty links не менялись. |
| Delivery | Dispatch list; главный action — новая доставка | search, date/status/type/driver filters, status tabs, rental link | KPI → filters → active list hierarchy читаема. Carrier DTO/access не менялись. |
| Documents | Rental/contracts/acts registry and generators | create, templates, control, filters, row actions | Исправлено отображение legacy `clientName` в реестре/деталях и accessible name меню строки; rental/equipment relation остаётся видна. Table uses internal scroll. |
| Reports | Управленческая аналитика | refresh, finance/sales/manager/service views | Tables/charts are data-dense. Existing pagination and export retained. |
| Manager Report | Manager performance and detail rows | refresh, export, filters, summary/detail | Единственный visible page heading был `h2` — исправлен на `h1`. |
| Knowledge Base | Learning modules and employee progress | open module, manage content where permitted | Clear empty/progress states; long page but no overflow. |
| GSM / telemetry | Position, geofences, routes and telemetry | attach tracker, filters, packet/detail tools | Safe empty state explains that data appears after tracker connection. Contractual links are not inferred from telemetry. |
| Bots | Bot integration and activity control | open integration, review activity | Bot remains business workflow surface. Secrets are not exposed in visible state. |
| Profile Settings | Employee profile and password | upload photo, save profile, change password | Focused personal page. Account/credential behavior not changed. |
| Admin / Users / Permissions / System Data | System control center | users, roles, RBAC, menu, collections, diagnostics | Backend permission model untouched. Existing loading/error and protected actions retained. |
| Approvals | Protected change requests | review pending request | Empty state verified with demo dataset. |
| Payroll | Payroll calculation workspace | calculate, approve, pay, close period | Dense financial-adjacent area; no financial logic touched. |
| Service Vehicles | Internal transport registry | add vehicle, filter, open detail | Empty state verified; not expanded into logistics product. |

## 2. Visual Consistency

Existing shared system was reused: `app-page-shell`, `app-page-header`, `app-page-title`, `app-page-subtitle`, `app-panel`, `app-filter-bar`, `Button`, `Badge`, `Input`, `Select`, `Dialog`, `Sheet`, table primitives and theme tokens. No second UI kit was introduced.

Observed system strengths:

- shared graphite/light surfaces and consistent lime primary action;
- compact B2B density in registries;
- controlled horizontal scrollers for wide tabs and tables;
- shared loading/error boundaries and mobile bottom navigation;
- semantic status colors and stable focus rings.

Observed consistency gaps:

- several historical detail pages still use local gray/white Tailwind palettes instead of tokens;
- page header composition varies between old details, compact reports and newer registries;
- some sections use large KPI grids where Dashboard V2 uses tighter operational hierarchy;
- CRM is feature-gated and therefore was not visually validated in its enabled state.

These gaps are backlog items unless they produce a concrete P1/P2. Broad restyling would churn large historical files and was intentionally avoided.

## 3. Information Hierarchy

Operational review used this order: current state → risk/impact → next action → context/history.

- Dashboard, Rentals, Equipment, Service and Delivery expose actionable signals before the long registry.
- Finance preserves amounts and unknown states above charts; decorative charts do not replace numeric summaries.
- Rental, Equipment, Client and Service detail pages put identity/status/action controls before history.
- Documents keeps relation/status/action columns visible in the registry.
- Long Client, Equipment and Service detail pages remain candidates for later secondary-information drawers, but changing topology now would be a redesign, not an audit fix.

## 4. Deep Workflow Findings

### Rentals

Flow checked: list → create → detail/edit → documents → payments → delivery/service links → return/close controls.

- Client and equipment selection use stable entities rather than editable labels as foreign keys.
- Rental detail clearly separates total, paid, allocations and balance.
- Documents, payment and delivery deep links preserve rental context.
- Conflicting/destructive actions remain behind existing confirmations and permissions.
- Implemented: accessible name/title for the icon-only back action.
- Deferred: no change to rates, billing formulas, canonical identity, availability logic or return state transitions.

### Equipment

- Registry immediately exposes status, Ready-to-Rent, service, ownership, location and action queue.
- Detail exposes current rental/service/history navigation.
- Implemented: light/dark contrast correction for the action-required strip.
- Deferred: KPI density and long detail topology; both require a separate product redesign decision.

### CRM / Clients

- Client 360 already joins rentals, payments, debts and documents by stable IDs.
- CRM deals/opportunities exist but are behind `VITE_CRM_ENABLED`; enabling or redesigning them was outside the safe scope.
- No name-based relationship backfill or canonical Counterparty mutation was added.

### Finance

- Revenue and receipts remain distinct.
- Unknown remains distinct from zero.
- Canonical debtor identity, allocations, forecast behavior and monetary-loss rules were not modified.
- Only visual/responsive inspection was performed.

### Service / Warranty

- Queue exposes what is broken, priority, assignee, parts wait and readiness.
- Ticket detail exposes equipment, dates, status and next actions.
- Customer/factory/supplier canonical relations were not changed.

### Delivery / Documents

- Delivery screen is readable as a bounded dispatch tool, not a logistics suite.
- Terminal delivery filtering and carrier access were not changed.
- Documents show status and related rental/equipment; primary create/control actions are separated from row menus.

## 5. UX Friction Flows

| Flow | Result | Remaining friction |
|---|---|---|
| A: client → rental → equipment → documents → charge → payment | PASS | Context links exist; some detail pages require vertical scrolling. |
| B: return → Ready-to-Rent → service | PASS by existing routes/tests | State transitions intentionally not edited. |
| C: overdue AR → client → rental → payment | PASS | AR lives in a Finance tab, so one tab switch remains intentional. |
| D: Service Ticket → Warranty Claim | PASS by Service tabs and permission coverage | Enabled role/data state should receive dedicated visual regression later. |
| E: Delivery → Rental | PASS | Related rental stays visible; carrier-safe DTO remains unchanged. |

## 6. Implemented P2 Improvements

1. Mobile shell now reserves space correctly: the long brand is hidden below 480 px, shell groups can shrink, and primary utility buttons remain visible.
2. Demo badge becomes a compact centered indicator below `sm`; it no longer blocks theme, notifications or profile controls. The full explanatory copy remains available to assistive technology and on desktop.
3. Equipment action-required message and icon now have readable adaptive light/dark colors.
4. Rental detail back action now has `aria-label` and `title`.
5. Manager Report now exposes a page-level `h1`.
6. Documents registry now displays the stored client snapshot when a backward-compatible record has `clientName` instead of `client`, and its row action disclosure has an accessible name.

No backend, API, persistence, permission, routing or domain file was changed.

## 7. Responsive QA

Browser audit used a local isolated demo database with synthetic records. Page-level horizontal overflow was checked using actual `documentElement.scrollWidth`; wide tables/tabs may keep internal controlled scrolling.

| Viewport | Pages | Verdict |
|---|---|---|
| 1440×900 | Login, Dashboard, Rentals, Rental Detail, Equipment, Clients, Finance, Service, Delivery, Documents | PASS; no page overflow. Required desktop screenshots captured. |
| 1280×800 | same 10 core pages | PASS; 10/10 no page overflow or visible unlabeled buttons. |
| 1024×768 | same 10 core pages | PASS; 10/10 no page overflow or visible unlabeled buttons. |
| 768×1024 | same 10 core pages | PASS; 10/10 no page overflow or visible unlabeled buttons. |
| 390×844 | Login, Dashboard, Rentals, Equipment, Finance, plus Rental Detail semantics | PASS after fixes; utility buttons remain visible and page overflow is absent. |

Light and dark themes were visually checked on Dashboard, Rentals and Equipment. Screenshot artifacts are kept outside Git in:

`/Users/rishat/.codex/visualizations/2026/08/18/01a012fc-ad0e-7712-b63f-fcad5ea5b7e3/rentcore-product-audit`

## 8. Accessibility

- Visible labels and semantic headings were inventoried on all declared routes.
- All visible buttons in the 30-screen intermediate breakpoint matrix had accessible text/name after the fix.
- The Rental Detail icon-only back action is now named.
- Manager Report now has a page-level `h1`.
- Shared controls expose focus-visible rings; login input focus rendered a 3 px ring in browser inspection.
- Dashboard charts retain a screen-reader table, so charts are not the only data source.
- Dialog/sheet primitives keep focus and sticky action contracts; their business flows were not rewritten.

Automated accessibility tooling was not treated as proof of usability. Dedicated screen-reader and full keyboard-only sessions remain advisable before a major public launch.

## 9. Findings and Deferrals

| Priority | Finding | Decision |
|---|---|---|
| P2 | Mobile shell/demo indicator blocked header controls | Fixed and browser-verified. |
| P2 | Equipment warning summary had insufficient light-theme contrast | Fixed and light/dark verified. |
| P2 | Rental Detail icon-only back action lacked accessible name | Fixed and DOM-verified. |
| P2 | Manager Report lacked a page-level `h1` | Fixed. |
| P2 | Documents could show `Клиент —` for rental-linked legacy records and row actions had no accessible name | Fixed after independent audit; stable IDs remain the source of linkage. |
| P3 | Historical detail pages mix local palettes with shared tokens | Deferred: broad visual refactor, no proven workflow break. |
| P3 | Client/Equipment/Service detail pages are very long | Deferred: information-architecture redesign. |
| P3 | KPI/card density varies by section | Deferred: should be addressed section-by-section with task metrics. |
| P3 | Несколько secondary targets мобильного header остаются 36–40 px вместо ориентира 44 px | Deferred: verified usable at 390 px; enlarging all targets would reintroduce shell crowding. |
| P3 | CRM E2E ignores browser-cancelled `net::ERR_ABORTED` requests broadly | Deferred test-harness refinement; every CRM mutation still awaits and asserts its exact response. |
| Gap | CRM/opportunities visual state is feature-gated | Deferred: do not activate incomplete/disabled CRM in a UX-only audit. |
| Test debt | CRM activity test depended on a non-seeded company; Documents filter locator matched both Filter and Reset; quick-action/service fixtures used expired fixed dates and an invalid spaced email suffix | Corrected to deterministic owned fixtures, calendar-relative dates and page-contract assertions; no product behavior changed. |

## 10. Cleanup

No production UI code was deleted. No duplicated shared primitive was introduced. The feature-gated CRM source was not considered dead because route, permission and feature-flag wiring exist. Unused-import cleanup was limited to compiler/build verification; no broad formatting or historical-file churn was performed.

## 11. Business Safety

Confirmed unchanged:

- financial formulas and Revenue/Receipts semantics;
- canonical Counterparty/debtor identity and stable-ID joins;
- allocations, forecasts and monetary-loss creation rules;
- permissions, role guards and carrier DTOs;
- routing semantics and feature flags;
- persistence, SQLite schema/JSON collections and API contracts;
- rental/equipment/service/delivery state transitions;
- Dashboard V2 business logic and selectors.

## 12. Implementation Test Snapshot

- baseline full regression: 3329 passed, 0 failed;
- post-change clean full regression: 3333 passed, 0 failed, 275274.714 ms;
- focused finance/domain/UX safety suite: 215 passed, 0 failed;
- cross-product Playwright matrix with CRM enabled: 42 passed, 0 failed;
- baseline Playwright smoke: 7 passed, 0 failed;
- `npm run build`: passed after the final source change;
- `git diff --check`: passed.

Independent audit, PR/CI, merge and production evidence are recorded in the final task report because those checks happen after this document is committed.
