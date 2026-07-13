# Company Health: аудит качества данных и происхождения метрик

**Объект аудита:** production commit `bd119f14b6c9e67c7ea7e10b85877ba017fe3c2f`
**Дата аудита:** 2026-07-11
**Область:** только происхождение и смысл данных; UI, веса, пороги, API, схема и production-данные не изменялись.

## Статус аудита

Выводы ниже зафиксированы для baseline `bd119f14b6c9e67c7ea7e10b85877ba017fe3c2f` и описывают состояние до исправления поведения при неполных данных. В ветке `codex/company-health-honest-coverage-clean` реализована только защитная change-фаза: источники со статусом `missing` или `ambiguous` больше не получают балл и не участвуют как нейтральные 50; для направлений и общего индекса показываются покрытие и доверие; направления с raw-покрытием ниже 30% исключаются; итог считается по полному знаменателю, поэтому отсутствие метрики не может повысить балл. При общем покрытии ниже 60% оценка помечается предварительной, ниже 30% числовая оценка не показывается.

Эта change-фаза не подтверждает семантическую корректность спорных источников и не закрывает исходные findings по finance/debt aging, fleet readiness/liquidity, service cohorts, CRM, company/branch isolation и fetch provenance. Веса, пороги бизнес-оценки, API, backend, база, схема, auth и RBAC не менялись. Изменение ещё не выпущено в production.

## 1. Итог

На baseline Company Health нельзя считать достоверным управленческим индексом. Число строилось из реальных коллекций, но значительная часть подписей не соответствовала фактической формуле, отсутствующие данные получали нейтральные 50 баллов, а некоторые прокси получали положительные 70–100 баллов. Поэтому итог мог выглядеть стабильным даже при отсутствии планов, CRM, расходов, 90-дневного aging и экономической оценки ликвидности.

Наиболее важные выводы:

1. `Парк 802` — это `equipment.length`, то есть число JSON-записей коллекции `equipment`, а не число готовых, доступных или физически сверенных единиц. В доступном workspace-снимке все 802 записи имеют уникальные `id`, `inventoryNumber` и `serialNumber`; 163 из них имеют статус `in_service`. Код не доказывает, что 802 записи соответствуют 802 физически существующим единицам.
2. Финансовый «план» не загружается. `monthlyRevenue` — начисленная расчётная стоимость аренд, начавшихся в текущем месяце, — передаётся в Finance как знаменатель «плана». В результате платежи сравниваются не с утверждённым планом, а с начислением по другой выборке.
3. «Денежный поток» не является cash-flow: это штрафная формула из разницы начислений и оплат плюс 70% просрочки. Остатки счетов, будущие притоки и исходящие платежи в неё не входят.
4. 30/60/90 aging реализован некорректно: передаются накопительные `30+` и `60+`, `90+` не передаётся; сумма `60+` повторно входит и в `30+`, и в `60+` с разными коэффициентами.
5. «Готовность техники» — это `1 - (in_service / activeFleet)`. Это не техническая готовность и не готовность к аренде; inspection, blocked и reserved отдельно не учитываются.
6. «Средний срок ремонта» — средний возраст только открытых заявок. При отсутствии открытых заявок в модель передаётся реальный `0`, который даёт 96/100, даже если истории закрытых ремонтов для расчёта длительности нет.
7. Новые лиды заменены числом новых карточек клиентов; конверсия отсутствует; ликвидность заменена долей техники с заполненным `plannedMonthlyRevenue`.
8. Ошибка/запрет/выключение React Query не отделяется от пустого результата: деструктуризация `data = []` превращает недоступную коллекцию в пустой массив. Это позволяет смешивать реальный ноль, отсутствие прав, незагруженные и ошибочные данные.
9. В модели нет company/branch/region predicates. Backend применяет ролевой scope, но не tenant/company/branch isolation. Для менеджера аренды часть аренд отфильтрована по имени менеджера, а парк и сервис остаются шире; значит один индекс может смешивать личный и общекомпанейский scope.

## 2. Методика и источники

Проверены production-версии:

- `src/app/lib/dashboardCompanyHealth.js` — построение 25 sub-metrics, нейтральные fallback и итоговый weighted score;
- `src/app/pages/Dashboard.tsx` — фактические значения, переданные в `buildCompanyHealthModel`;
- `src/app/lib/fleetUtilization.js`, `src/app/lib/finance.ts`, `src/app/lib/rentalDowntimeFlow.js` — загрузка, начисления и дебиторка;
- `src/app/services/*`, `src/app/hooks/*` — endpoint и поведение загрузки;
- `server/routes/crud.js`, `server/routes/service.js`, `server/lib/access-control.js`, `server/db.js` — backend scope и SQLite persistence;
- тесты Company Health, finance, fleet utilization и mechanic workload;
- read-only workspace-снимок `server/data/app.sqlite` (это локально доступный снимок, не доказательство текущего live-состояния production).

Все выводы о формулах и источниках ниже относятся к указанному baseline commit. Добавленный выше статус фиксирует только реализованное защитное поведение и не переписывает исторические findings. Backend/persistence выводы использованы только там, где код не расходится по исследуемому пути.

### Термины статуса источника

- **real** — прямой факт из канонического источника с соответствующим бизнес-смыслом;
- **derived** — воспроизводимая формула из реальных полей, смысл в основном соответствует подписи;
- **fallback** — эвристика/прокси при отсутствии нужного факта;
- **missing** — нужный источник не передан;
- **ambiguous** — данные существуют, но подпись, период, знаменатель или бизнес-смысл не совпадает.

Отдельно указан **model status** — то, как production-код сам маркирует sub-metric. Это не подтверждение корректности.

## 3. Общая цепочка данных и фильтры

Все основные сущности хранятся JSON-массивами в SQLite-таблице `app_data`: имя коллекции находится в `app_data.name`, весь массив — в `app_data.json`. Dashboard получает полные разрешённые массивы через `/api/equipment`, `/api/gantt_rentals`, `/api/payments`, `/api/payment_allocations`, `/api/clients`, `/api/service`, `/api/documents`, `/api/deliveries` и производит большинство расчётов в браузере.

Общие ограничения:

- **Company:** явного `companyId` filter нет.
- **Branch/region:** явного `branchId`/`regionId` filter нет.
- **Permissions:** backend `filterCollectionByScope` ограничивает записи по роли; admin получает весь массив.
- **Rental manager:** `Dashboard.tsx` дополнительно фильтрует `rentals`/`gantt_rentals` по `manager === user.name`; парк остаётся общим, service для rental manager на backend доступен целиком. Scope метрик поэтому неоднороден.
- **Deleted/excluded:** фильтры зависят от метрики. Rental finance исключает статусы `cancelled/canceled/void/error/failed/deleted/archived`; utilization считает только `active`; месячные starts/returns до финансового `shouldCountRental` фильтруются не везде.
- **Timezone:** `today`, `monthStart`, `monthEnd` создаются в timezone браузера; часть date-only сравнений использует `toISOString().slice(0,10)` (UTC). Backend finance defaults также используют UTC. Около полуночи границы могут расходиться с Europe/Moscow.
- **Fetch state:** `const {data = []}` не различает loading/error/403/empty. В Company Health нет отдельного `isSuccess`/`isError` provenance flag.

## 4. Реестр всех sub-metrics

### 4.1 Финансы

| Metric key / русский title | Текущий источник | API, backend fields, DB | Unit / период | Filters | Числитель / знаменатель | Статус, fallback, confidence | Интерпретация, риск и correction |
|---|---|---|---|---|---|---|---|
| `finance_receipts_to_plan` / **Поступления к плану** (требование: revenue vs plan) | `Dashboard.tsx`: `monthlyPayments`, `monthlyPaidAmount`, `monthlyRevenue`; `getDashboardPaidAmount`; `buildFinanceDirection` / `planPerformanceScore` | `/api/payments`: `paidDate \|\| dueDate`, `paidAmount`, `amount`, `status`; `/api/gantt_rentals`: rental billing fields used by `getRentalBillingAmount`; `app_data.payments`, `app_data.payment_allocations`, `app_data.gantt_rentals` | rubles converted to percent score; current browser month | Role scope; manager rental scope affects revenue but payment scope is backend-defined; invalid/cancelled payment handling is in `getDashboardPaidAmount`; revenue excludes ignored rental statuses | numerator = paid amount of payments whose `paidDate` **or dueDate** is in month; denominator = calculated full billing of rentals **started** in month, mislabeled as plan | model `real`; audit **ambiguous**; fallback: if payments exist without denominator, fixed 82 or 72; confidence **low** | This is collections versus accrued started-rental billing, not revenue versus an approved plan. Due dates can place unpaid payments into the month before effective paid amount is summed. Add a canonical monthly revenue/receipts plan with period/company/branch; keep accrued revenue, invoices and cash receipts separate. |
| `finance_overdue_receivables` / **Просроченная дебиторка** | `buildRentalDebtRows`, `overduePayments`, `overdueReceivablesAmount`; `buildFinanceDirection` / `overduePressureScore` | `/api/gantt_rentals`, `/api/payments`, `/api/payment_allocations`; billing fields, `expectedPaymentDate`, `endDate`, payment/allocation links; `app_data.gantt_rentals`, `payments`, `payment_allocations` | rubles converted to ratio score; snapshot as of today, all rental history | Ignored rental/payment statuses excluded; outstanding `>0`; manager scope for manager; no company/branch filter | numerator = sum outstanding where `expectedPaymentDate < today`, otherwise `endDate < today`; denominator = max(total debt, pseudo-monthly revenue, overdue, 1) | model `real`; audit **derived**; fallback: count signal gives 52/100; any debt source with no amount can give 100; confidence **medium** | It is calculated rental receivable, not invoiced AR. Missing `expectedPaymentDate` makes rental end date the due date. Use invoice/payment-schedule due date and reconcile accrued, invoiced, paid and outstanding ledgers. |
| `finance_cash_flow` / **Денежный поток** | `buildFinanceDirection`: `pressure = (max(0,revenue-paid)+0.7*overdue)/revenue` | Same three rental/payment collections; finance accounts and finance operations are not read | ratio score; current month plus all-time overdue snapshot | Same mismatched rental/payment scopes; no account/cash-operation filters | numerator = accrual shortfall + 70% overdue; denominator = accrued billing for rentals started this month | model `real`; audit **ambiguous**; fallback 55 if any overdue, otherwise 78; confidence **low** | Not cash flow: no opening/closing cash, outgoing payments, future dated flows or account balances. Rename only after product change or replace with a real cash-flow endpoint and explicit horizon. |
| `finance_cost_pressure` / **Расходы к плану** | `buildFinanceDirection` expects `monthlyExpenseAmount` and `monthlyExpensePlan`; Dashboard passes neither | No request to `/api/company_expenses` or `/api/finance_operations`; although collections exist in schema, they are not used | rubles/ratio; intended current month, actual unknown | none because source absent | numerator/denominator missing | model `missing`; audit **missing**; fallback neutral **50/100** contributes to Finance; confidence **high** about absence | A nonexistent plan still generates a score. Do not score until actual expense and approved plan share period/scope; represent N/A separately from zero. |

### 4.2 Аренда

| Metric key / русский title | Текущий источник | API, backend fields, DB | Unit / период | Filters | Числитель / знаменатель | Статус, fallback, confidence | Интерпретация, риск и correction |
|---|---|---|---|---|---|---|---|
| `rental_utilization` / **Загрузка техники** | `calculateCurrentFleetUtilization(equipmentList, activeRentalsList)` | `/api/equipment`: `id`, `category`, `activeInFleet`, sale/status fields; `/api/gantt_rentals`: `status`, `equipmentId`, inventory/serial fallbacks; `app_data.equipment`, `gantt_rentals` | percent; current snapshot, not time-weighted | Equipment: own/partner, not sold/inactive/archived/etc., `activeInFleet !== false`; rentals: exactly `active`; service equipment is **included** in denominator; reserved excluded from numerator | numerator = distinct active-fleet equipment linked to active rentals; denominator = active-rental-fleet records | model `real`; audit **derived**; fallback if no equipment can still accept numeric zero; confidence **high** for formula, **medium** for business meaning | Snapshot utilization. It is not month utilization; maintenance lowers it because `in_service` remains denominator; reservation has no effect. Decide whether KPI is contractual occupancy or rentable-capacity utilization and use equipment-days for period utilization. |
| `rental_revenue_to_plan` / **Выручка аренды к плану** | `monthlyRevenue`; `fleetMonthlyRevenuePlan = sum(activeFleet.plannedMonthlyRevenue)`; `planPerformanceScore` | `/api/gantt_rentals` billing data; `/api/equipment.plannedMonthlyRevenue`; `app_data.gantt_rentals`, `equipment` | rubles converted to percent score; current month actual versus undated equipment sum | Actual = non-ignored rentals started in month; plan = active fleet only; no company/branch | numerator = full calculated billing of rentals started this month; denominator = sum per-equipment `plannedMonthlyRevenue` | model `derived`; audit **ambiguous**; fallback actual >0 with absent plan = fixed 82; confidence **low** | Per-unit planned revenue is not proven to be an approved monthly company plan and has no effective month. Actual excludes revenue earned in month by earlier rentals. Add versioned monthly plan and period-overlap accrual. |
| `rental_idle_fleet` / **Простои** | `availableEquipment` and `activeEquipment`; reservation/rental key sets | `/api/equipment`, `/api/gantt_rentals`; status, IDs and reservation status `created`; `app_data.equipment`, `gantt_rentals` | count ratio converted to score; current snapshot | active fleet; excludes `in_service`, rented and reserved from available; includes any other active-fleet status as available | numerator = available records; denominator = active fleet including in-service | model `real`; audit **derived**; fallback derives `1-utilization`; confidence **medium** | Means free now, not idle duration or economic downtime. Denominator includes service while numerator excludes it. Rename to current free share or calculate idle equipment-days by cause. |
| `rental_movement` / **Движение аренды** | month starts, month returns, reserved count; extensions input is never passed | `/api/gantt_rentals`: `startDate`, `endDate`, `status`; `app_data.gantt_rentals` | count/ratio; starts and returns current month, reservations current snapshot | manager scope; starts/returns are not status-filtered at collection step, so cancelled/historical records may count; reservations `status=created` | incoming = starts + extensions(0) + 0.5×reservations; outgoing = all rentals ending in month | model `real`; audit **derived**; fallback from overdue/today return signals gives 45/68/80; confidence **low** | An arbitrary weighted activity ratio, not recognized rental movement/revenue momentum. Define events, mutually exclusive statuses, period and business target; exclude cancelled records. |

### 4.3 Риски

| Metric key / русский title | Текущий источник | API, backend fields, DB | Unit / период | Filters | Числитель / знаменатель | Статус, fallback, confidence | Интерпретация, риск и correction |
|---|---|---|---|---|---|---|---|
| `risks_overdue_receivables` / **Просроченная дебиторка** | Same amount as Finance, stricter score bands | Same rental/payment/allocation sources and fields | rubles/ratio; today snapshot | Same as Finance AR | overdue outstanding / max(total debt, pseudo-monthly revenue, overdue) | model `real`; audit **derived**; count fallback 35; debt source without detected overdue gives 100; confidence **medium** | Duplicates the same source in Finance and Risks, so one issue affects 30%×30% plus 20%×45% of total score. Use deliberate de-duplication or document the intended double weight; source from invoice due dates. |
| `risks_old_debt` / **Долги старше 30/60/90 дней** | `clientDebtAgingRows`; Dashboard creates `debt30PlusAmount` from `31_60 + 60_plus`, `debt60PlusAmount` from `60_plus`; no `debt90PlusAmount` | `/api/gantt_rentals`, payments, allocations; `expectedPaymentDate \|\| endDate`; `app_data.gantt_rentals`, `payments`, `payment_allocations` | rubles/ratio; snapshot today | outstanding >0; ignored statuses removed; bucket keys are 0–7, 8–14, 15–30, 31–60, 60+ | weighted pressure = 0.45×30+ + 0.75×60+ + 1×90+ over base. Since 30+ contains 60+, 60+ is double-counted; 90+ is absent | model `real`; audit **ambiguous**; fallback `oldDebtCount` gives 30 or, with debt source and no old flag, 100; confidence **high** about defect | UI says 30/60/90 but buckets are not supplied as mutually exclusive and 90 is unavailable. Build exclusive 31–60, 61–90, 90+ from invoice/payment-schedule due date; verify bucket sum equals total overdue. |
| `risks_problem_clients` / **Крупные проблемные клиенты** | `largestProblemDebtAmount = max(clientDebtAgingRows.debt)`; `problemClientCount = clientDebtAgingRows.length` | Same debt sources plus `/api/clients`; grouping key includes client, manager, age bucket and active flag | rubles/count/ratio; all-time debt snapshot | outstanding only; manager scope; unlinked client fallback can group by editable name | numerator = largest **aging row**, not total client exposure; denominator = total debt/overdue; count = aging rows, not distinct clients | model `real` when largest amount exists; audit **ambiguous**; debt source without concentration gives 100; confidence **low** | One client split across buckets/managers can be understated and counted several times. Aggregate strictly by stable `clientId`, then calculate total exposure, overdue exposure, credit-limit breach and concentration. |
| `risks_critical_events` / **Критические операционные события** | Sum of alert, invalid alert, no-fleet, overdue return, old debt, service, document and delivery counters | Multiple endpoints: equipment action attention, rentals, service, documents, deliveries; multiple `app_data` collections | count converted to score; mixed today/snapshot/all-time | Each component has different scope; critical alerts may come from management queue; invalid-source alerts are counted as critical | score = 100 − min(100, 20×critical + 8×warning) | model `derived`; audit **derived**; if any score base exists and counters are zero, gives 100; confidence **low** | Heterogeneous events are treated as comparable and independent; duplicates can be counted through multiple signals. Create canonical event IDs, severity rules, deduplication and explicit active window. |

### 4.4 Сервис

| Metric key / русский title | Текущий источник | API, backend fields, DB | Unit / период | Filters | Числитель / знаменатель | Статус, fallback, confidence | Интерпретация, риск и correction |
|---|---|---|---|---|---|---|---|
| `service_fleet_readiness` / **Готовность техники** | `activeEquipment`, `equipmentInServiceList.length`; `buildServiceDirection` | `/api/equipment`: active-fleet fields and `status`; `app_data.equipment` | percent; current snapshot | active fleet includes `in_service`; numerator approximation subtracts in-service. Reserved, rented, inspection, blocked are not separate states | numerator = activeFleet − in_service; denominator = activeFleet | model `real`; audit **ambiguous**; no inputs => neutral 50; confidence **high** for formula, **low** for label | This is “not in service,” not technically ready or available for rent. Use readiness DTO/state machine with mutually exclusive technically-ready, available, rented, service, inspection and blocked counts. |
| `service_overdue_repairs` / **Просроченные ремонты** | open service tickets and `plannedDate < today` | `/api/service`: `status`, `plannedDate`; `app_data.service` | count/percent; today snapshot | regular tickets; open = status not exactly `closed`; overdue requires `plannedDate`; tickets without planned date cannot be overdue | numerator = overdue open tickets; denominator = all open tickets | model `real`; audit **derived**; if service exists but counts absent, critical signal gives 42 else 100; confidence **medium** | Reasonable queue lateness metric, but missing planned dates are silently on-time. Require SLA/due date coverage and distinguish missing due date. |
| `service_repeat_repairs` / **Повторные ремонты** | `/api/reports/mechanics-workload`; `repeatFailures` grouped from service report rows, Dashboard counts groups with `repairsCount > 1` | `/api/reports/mechanics-workload`; service, repair work/part items, mechanics, equipment; multiple `app_data` collections | count; effectively all returned report data, no explicit Dashboard period | requires `view reports`; backend report scope; repeated group is equipment/work-pattern grouping, not necessarily recurrence in 7/14/30 days | numerator = count of repeat-failure groups; denominator absent | model `real`; audit **ambiguous**; missing report/permission => neutral 50; confidence **low** | Multiple repairs do not prove repeat failure, and no exposure denominator/window is used. Use canonical repeat-breakdown logic with prior closed repair, same failure family and explicit recurrence window/rate. |
| `service_average_duration` / **Средний срок ремонта** | `serviceInDaysRows` from open tickets; invalid/missing `createdAt` is replaced with today; empty rows produce `averageServiceDays = 0` | `/api/service`: `createdAt`, status; `app_data.service` | days; age of currently open queue as of today | regular, status not `closed`; closed repairs excluded | numerator = sum max(1, today−createdAt) for open tickets; denominator = number open tickets. Empty denominator is converted to value 0 | model `real`; audit **ambiguous**; empty/missing becomes 0 and scores 96; confidence **high** about defect | It is average open-ticket age, not repair duration. Calculate closedAt−startedAt for closed repairs over a stated period; show N/A when no eligible repairs; separately show open queue age. |
| `service_sla_load` / **SLA / загрузка механиков** | `serviceEstimatedHours` and `serviceCapacityHours = adminMechanicRows.length × 6`; heuristic ticket hours and priority/overdue multipliers | `/api/service`, `/api/reports/mechanics-workload`, mechanics; ticket status/priority/planned date and visible mechanics | hours ratio/percent; current queue against one synthetic 6-hour capacity block | waiting-parts contributes zero; visible/report-permitted mechanic rows only; no shift/calendar/absence data | numerator = estimated open-ticket hours × multipliers; denominator = mechanic count × 6 hours; capped at 140% | model `derived`; audit **fallback**; if capacity missing but tickets exist, input omitted and score falls back to blocker signal 58/86; confidence **low** | Neither SLA compliance nor actual load. Persist capacity calendars and norms; calculate queue hours/capacity for a named horizon and SLA breaches separately. |

### 4.5 Клиенты

| Metric key / русский title | Текущий источник | API, backend fields, DB | Unit / период | Filters | Числитель / знаменатель | Статус, fallback, confidence | Интерпретация, риск и correction |
|---|---|---|---|---|---|---|---|
| `clients_new_demand` / **Новые лиды** | No lead input is passed; fallback uses `newClientsThisMonth` from client `createdAt` | `/api/clients`; `createdAt`; `app_data.clients`. `crm_deals`/activities are not queried | count; current browser month | backend role scope; missing `createdAt` excluded; client card creation date only | numerator = new client cards; target = max(2, ceil(all visible clients×4%)) | model `derived`; audit **fallback**; no new client input => neutral 50; confidence **high** | New client records are not leads and target depends on total historical database size. Connect a canonical lead source, stage and creation period; do not infer leads from clients. |
| `clients_active_clients` / **Активные клиенты** | distinct non-empty `clientId` in currently `active` planner rentals | `/api/clients`, `/api/gantt_rentals`; `clientId`, rental status; `app_data.clients`, `gantt_rentals` | count ratio; current snapshot numerator, all-time client base denominator | manager scope for rentals; all visible clients denominator; active rentals without `clientId` excluded | numerator = distinct client IDs with active rental; denominator = all client records | model `real`; audit **derived**; if client base exists but active input absent fixed 78; confidence **medium** | “Active” means renting right now, not active in a stated business period. Define activity (e.g. rental/revenue/payment in rolling 90 days), enforce client IDs and align denominator scope. |
| `clients_repeat_clients` / **Повторные клиенты** | `clientFinancials`: clients with `totalRentals > 1` | `/api/clients`, `/api/gantt_rentals`; stable client IDs; `app_data.clients`, `gantt_rentals` | count ratio; all-time | visible client/rental scope; only rentals linked by stable client ID; ignored statuses are not necessarily excluded from `totalRentals` snapshot | numerator = clients with >1 linked rental; denominator = all client records | model `real`; audit **derived**; absent input => neutral 50; confidence **medium** | All-time repeat penetration is sensitive to old/inactive/imported client cards and duplicate rentals. State cohort/window and eligible completed rentals; denominator should be clients eligible to repeat. |
| `clients_conversion` / **Конверсия в сделку** | `buildClientsDirection` expects won and deal counts; Dashboard passes none | No CRM endpoint queried; local schema may contain `crm_deals`, but not used | ratio/percent; unknown | none | numerator/denominator missing | model `missing`; audit **missing**; neutral **50/100**; confidence **high** | A nonexistent conversion metric still contributes to direction and total. Require CRM lead/deal stages, eligible cohort and period; N/A until then. |

### 4.6 Парк

| Metric key / русский title | Текущий источник | API, backend fields, DB | Unit / период | Filters | Числитель / знаменатель | Статус, fallback, confidence | Интерпретация, риск и correction |
|---|---|---|---|---|---|---|---|
| `fleet_health` / **Исправность парка** (требование: technical availability) | `equipmentCount`, `activeEquipment`, `equipmentInServiceCount`, `inactiveEquipmentCount` | `/api/equipment`; status/category/active/sale fields; `app_data.equipment` | percent; current snapshot | `equipmentCount` is every record; activeFleet excludes inactive/sold; in-service remains activeFleet; inactive is then added to blocked | blocked = in_service + inactive; denominator = activeFleet (or all records fallback) | model `real`; audit **ambiguous**; if detailed counts absent may use utilization or fixed 78; confidence **medium** | Not technical availability: inactive can be outside denominator yet added to numerator, and no inspection/blocked/ready state exists. Use readiness state source with reconciled mutually exclusive statuses. |
| `fleet_age_wear` / **Возраст / износ** | `agedEquipmentCount` where current year−`year`≥8; `highHoursEquipmentCount` where `hours`≥3000 | `/api/equipment`: `year`, `hours`; `app_data.equipment` | count ratio; current snapshot | all equipment records, including service/sold unless present in list; missing values excluded from risk count but remain denominator | pressure = (aged + 0.6×high-hours)/all equipment; overlapping units double-contribute | model `derived`; audit **derived**; missing both fields => neutral 50; confidence **medium** | Coarse proxy with arbitrary cutoffs and denominator; no model-specific useful life or condition. Track field completeness and calculate age and wear separately before combining. |
| `fleet_liquidity` / **Ликвидность техники** | count of active-fleet records with `plannedMonthlyRevenue > 0` | `/api/equipment.plannedMonthlyRevenue`; `app_data.equipment` | count ratio; undated snapshot | active fleet numerator; denominator active fleet or all records | numerator = records with any positive planned monthly revenue; denominator = active fleet | model `derived`; audit **ambiguous**; absent field => neutral 50; confidence **high** about semantic mismatch | Field completeness is not liquidity. Liquidity normally needs demand, utilization, margin, resale market/time-to-sell or booking depth. Rename to plan coverage or build an economic liquidity model. |
| `fleet_structure` / **Структура парка** (concentration) | top `equipment.type` count / `totalEquipment`; missing type becomes `unknown` | `/api/equipment.type`; `app_data.equipment` | percent/ratio; current snapshot | all equipment records; no active/sold/company/branch filter | numerator = largest type bucket; denominator = every equipment record | model `derived`; audit **derived**; with equipment but no top share input fixed 70; confidence **medium** | Measures record-type concentration, not demand/revenue/owner concentration. Missing types can become the largest bucket. Filter active fleet, report unknown coverage and define the concentration dimension. |

## 5. Критические проверки

### 5.1 Целостность `Парк 802`

Production Dashboard uses:

```text
totalEquipment = equipment.length
equipmentCount = totalEquipment
"Всего единиц" = String(totalEquipment)
```

Следовательно, 802 означает **equipment records** из `app_data['equipment']`. Это не service items и не readiness items.

Read-only workspace-снимок показывает:

| Проверка | Значение |
|---|---:|
| equipment rows | 802 |
| unique `id` | 802 |
| unique non-empty `inventoryNumber` | 802 |
| unique non-empty `serialNumber` | 802 |
| `available` | 629 |
| `in_service` | 163 |
| `rented` status | 10 |
| active-fleet denominator по helper | 802 |
| distinct equipment linked to active planner rentals | 530 |
| snapshot utilization | 66% |

Это подтверждает отсутствие простого технического дубля по трём идентификаторам, но не подтверждает физическое наличие, собственность, списание, нахождение, одну запись на один asset или актуальность статуса. До сверки с инвентаризацией подпись должна пониматься как «802 записи реестра». Если фактический физический парк существенно меньше, это **critical data blocker** для utilization, readiness, idle, age/wear, liquidity и structure.

### 5.2 Ноль против missing

| Случай | Текущее поведение | Вывод аудита |
|---|---|---|
| Query loading/error/403/disabled | `data = []` | Неотличимо от пустой коллекции; не является доказанным нулём. |
| Отсутствующий sub-metric | `buildSubMetric` ставит 50 | Missing влияет на score как нейтральное значение; не ноль и не наблюдение. |
| Нет expense plan/actual | 50 | Missing, не «расходы в норме». |
| Нет CRM conversion | 50 | Missing, не 50% и не средняя конверсия. |
| Нет open service tickets | `averageServiceDays = 0`, score 96 | Ноль очереди превращён в отличный «срок ремонта»; семантически missing для duration. |
| Нет overdue amount, но debt source flag есть | score 100 | Может быть реальным нулём только при успешной и полной debt выборке; fetch success не проверяется. |
| Нет critical counters при наличии score base | critical-events score 100 | Ноль подтверждён лишь косвенно; полнота всех event sources не доказана. |
| Нет plan, но actual > 0 | fixed 82 | Положительный fallback без плана. |
| Парк есть, structure input отсутствует | fixed 70 | Положительный fallback без концентрации. |

### 5.3 Revenue, invoices, payments, receivables и plan

| Понятие | Реальный текущий источник | Не следует считать |
|---|---|---|
| Accrued rental revenue | `getRentalBillingAmount` по rentals started this month | invoice, cash receipt, approved plan |
| Invoiced amount | отдельного source в Company Health нет | accrued revenue |
| Payments received | effective paid amount из `payments`/allocations; month chosen by `paidDate \|\| dueDate` | revenue or invoice |
| Accounts receivable | calculated rental billing minus linked paid allocations | бухгалтерский AR без reconciliation |
| Overdue receivable | outstanding after expected date, fallback rental end date | invoice-due aging |
| Plan value | approved plan source отсутствует; per-equipment `plannedMonthlyRevenue` используется только Rental | Finance `monthlyRevenue` denominator |

### 5.4 Utilization

- **Формула:** distinct equipment in planner rentals with `status === active` / active rental fleet records.
- **Active fleet:** category `own` or `partner` (missing category defaults to `own`), `activeInFleet !== false`, not sold and not in inactive/sold/archived/decommissioned status set.
- **Maintenance:** `in_service` остаётся в denominator и не может попасть в numerator без активной rental link; снижает utilization.
- **Reserved:** `created` rental не входит в utilization numerator.
- **Period:** current snapshot. График отдельно строит исторический overlap, но score получает snapshot `utilization`.
- **Не time-weighted:** да. Helper для monthly equipment-days существует, но Company Health его не использует.

### 5.5 Debt aging reconciliation

Канонический frontend helper создаёт взаимоисключающие buckets 0–7, 8–14, 15–30, 31–60, 60+. Однако Dashboard сворачивает их в накопительные `30+` и `60+`; 90+ отсутствует. Production score затем повторно взвешивает эти накопительные суммы. Поэтому score aging не может быть reconciled как 30/60/90. Paid/zero outstanding отбрасываются, negative amounts clamp to zero, ignored rental/payment statuses исключаются. Due date — `expectedPaymentDate`, иначе rental `endDate`, не invoice date.

### 5.6 Service readiness

В production score существуют только приближения:

- technically ready — отсутствует;
- available for rent — Dashboard считает отдельно, но readiness score его не использует;
- currently rented — отдельно для utilization, readiness не вычитает;
- in service — `equipment.status === in_service`;
- requires inspection — отсутствует как отдельное состояние;
- blocked — отсутствует как отдельное состояние.

Таким образом readiness смешана с «не находится в сервисе» и не должна интерпретироваться как availability.

### 5.7 Clients

- **Active:** клиент с planner rental `status=active` прямо сейчас и непустым `clientId`.
- **Repeat:** клиент с более чем одной linked rental за всё время.
- **Lead source:** отсутствует; proxy = новая client card в месяце.
- **Conversion denominator:** отсутствует; metric получает neutral 50.

### 5.8 Plans

Ни один утверждённый, periodized план Company Health не загружает. `plannedMonthlyRevenue` на equipment не имеет выбранного месяца/версии. Все vs-plan выводы должны считаться неподтверждёнными до появления plan entity с company/branch, metric key, period, amount, version/status и audit trail.

### 5.9 Dates и timezone

Месяц строится локальными `new Date(year, month, ...)`, но `todayKey` часто берётся через UTC `toISOString`. ISO date-only strings парсятся JavaScript как UTC. Это создаёт риск пограничного сдвига для timestamp around midnight. Нужна единая company timezone (для данного бизнеса ожидаемо Europe/Moscow), date-only helpers без UTC round-trip и тесты на начало/конец месяца.

### 5.10 Multi-company / branch isolation

Модель данных и запросы не используют `companyId`, `branchId` или `regionId` для Company Health. Доступный workspace-снимок также не содержит эти поля в проверенных equipment/rental/payment/client/service записях. Backend обеспечивает role/entity scope, но это не tenant isolation. При появлении нескольких компаний/филиалов текущий индекс будет иметь cross-company leakage risk. До tenant-aware data contract Company Health допустим только как single-company dashboard.

## 6. Data coverage matrix

Здесь «confidence» — уверенность, что отображаемое направление соответствует заявленному бизнес-смыслу, а не уровень здоровья компании.

| Direction | Всего | Real | Derived | Fallback | Missing | Ambiguous | Confidence |
|---|---:|---:|---:|---:|---:|---:|---:|
| Finance | 4 | 0 | 1 | 0 | 1 | 2 | 35/100 |
| Rental | 4 | 0 | 3 | 0 | 0 | 1 | 60/100 |
| Risks | 4 | 0 | 2 | 0 | 0 | 2 | 30/100 |
| Service | 5 | 0 | 1 | 1 | 0 | 3 | 35/100 |
| Clients | 4 | 0 | 2 | 1 | 1 | 0 | 45/100 |
| Fleet | 4 | 0 | 2 | 0 | 0 | 2 | 50/100 |
| **Итого** | **25** | **0** | **11** | **2** | **2** | **10** | **42/100** |

`Real = 0` не означает, что в системе нет реальных records. Это означает, что ни один итоговый sub-metric не является прямым каноническим бизнес-фактом без derivation; фактическая база присутствует у многих derived metrics.

## 7. Top 10 misleading metrics

1. **Finance — Поступления к плану:** denominator не plan; смешаны cash receipts и accrued rental billing.
2. **Risks — 30/60/90 aging:** 90+ отсутствует, 60+ double-counted.
3. **Finance — Денежный поток:** не cash-flow, а synthetic collection pressure.
4. **Fleet — Ликвидность:** фактически completeness `plannedMonthlyRevenue`.
5. **Service — Средний срок ремонта:** open-ticket age; empty queue даёт 0 дней и 96/100.
6. **Clients — Новые лиды:** новые client cards вместо lead source.
7. **Service — Готовность техники:** “not in service” вместо technical/rental readiness.
8. **Rental — Выручка к плану:** started-rental full billing против undated per-equipment plan sum.
9. **Risks — Крупные проблемные клиенты:** largest aging row и row count вместо client-level exposure.
10. **Service — SLA / загрузка механиков:** synthetic 6 hours per visible mechanic and estimated work, not SLA.

Дополнительный системный риск выше любой отдельной метрики: missing получает 50, а некоторые отсутствующие планы/детали получают fixed 70–100. Это может поднимать итоговый score без новых фактов.

## 8. Critical blockers

Следующие метрики не должны использоваться для управленческих решений Company Health до исправления provenance:

1. `finance_receipts_to_plan` — нет настоящего plan и неверное название/сравнение.
2. `finance_cash_flow` — отсутствует cash-flow data model.
3. `finance_cost_pressure` — actual и plan не подключены; neutral fallback влияет на score.
4. `risks_old_debt` — некорректные 30/60/90 buckets.
5. `risks_problem_clients` — не агрегирует exposure по stable client ID.
6. `service_fleet_readiness` — readiness state отсутствует.
7. `service_average_duration` — неверная cohort/formula и zero-as-missing defect.
8. `service_sla_load` — SLA/capacity не измеряются.
9. `clients_new_demand` — lead source отсутствует.
10. `clients_conversion` — полностью missing, но получает 50.
11. `fleet_liquidity` — business meaning не соответствует формуле.
12. Все fleet/rental metrics, если физическая инвентаризация не подтверждает, что 802 equipment records — 802 актуальных единицы.

## 9. Приоритет исправлений

### P0 — остановить ложную уверенность

1. В data contract разделить `zero`, `missing`, `not_authorized`, `loading`, `error`; missing не должен получать числовой score.
2. Исключать sub-metric/direction из weighted denominator либо показывать N/A до минимальной полноты; не использовать fixed positive fallback 70–100.
3. Сверить 802 equipment records с физическим asset register и определить canonical active/rentable/readiness states.
4. Убрать из управленческого использования false-plan, false-cash-flow и broken-aging metrics до появления корректных источников.

### P1 — финансовая и операционная канонизация

5. Ввести periodized plans и раздельные факты accrued/invoiced/paid/AR/overdue/expenses.
6. Построить invoice/payment-schedule aging с exclusive 31–60, 61–90, 90+ buckets и reconciliation.
7. Подключить readiness DTO и time-weighted utilization с явной обработкой service/reserved/blocked.
8. Исправить service cohorts: open age отдельно, closed repair duration отдельно, repeat repair window отдельно, capacity/SLA отдельно.

### P2 — клиенты, парк и scope

9. Подключить CRM lead/deal source и определить active/repeat/conversion cohorts.
10. Заменить fleet liquidity proxy; определить structure dimension и field-completeness thresholds.
11. Ввести company/branch/region identifiers и одинаковый scope всех numerator/denominator.
12. Зафиксировать Europe/Moscow date policy и boundary tests.

## 10. Минимальные provenance tests для следующей фазы

Без изменения текущего production logic в этой фазе рекомендуется в следующей change-фазе добавить contract tests:

- missing plan, CRM, expenses и fetch error никогда не превращаются в zero или positive score;
- finance actual/plan имеют одинаковые company, branch, metric и month;
- aging buckets mutually exclusive и их сумма reconciles с overdue total;
- utilization fixture явно проверяет service, reserved, sold, inactive и period overlap;
- readiness states mutually exclusive и sum to physical active fleet;
- client metrics используют stable IDs и одинаковую cohort;
- all metric responses carry `source`, `asOf`, `period`, `timezone`, `filters`, `numerator`, `denominator`, `completeness` и `status`.
