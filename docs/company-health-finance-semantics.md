# Company Health: семантика финансовых метрик

Дата проверки: 2026-07-13. Scope документа — только направление **«Финансы»** в Company Health.

## 1. Вывод

В текущем backend-контракте нет утверждённого, версионируемого и привязанного к периоду плана поступлений и нет утверждённого плана расходов. Начисления аренды, выставленные суммы, прогнозы, значения прошлого периода и постоянные расходы не являются такими планами и не могут использоваться вместо них.

После исправления Company Health:

- считает фактические поступления только по сумме оплаты и фактической дате `paidDate`;
- показывает начисления аренды отдельно и не передаёт их как финансовый план;
- оставляет «Поступления к плану» без score, пока утверждённый план не существует;
- считает денежный поток только как фактические операционные поступления минус фактические операционные расходы;
- оставляет «Расходы к плану» без score, пока утверждённый план расходов не существует;
- не допускает Finance к общему Company Health по одной просроченной дебиторке с покрытием 30%.

## 2. Реестр финансовых понятий и источников

| Понятие | Frontend source | API / response fields | Фактический бизнес-смысл | Unit / период | Scope и filters | Provenance | Точность label | Scoring |
|---|---|---|---|---|---|---|---|---|
| 1. Actual receipts / фактические поступления | `Dashboard.tsx`: `actualReceiptPayments`, `actualReceiptsAmount`, `getDashboardPaidAmount` | `GET /api/payments`; `paidDate`, `paidAmount`, fallback суммы только при `status=paid`, `status` | Полученная сумма по payment records с фактической датой оплаты. `dueDate` больше не определяет период поступления Company Health. | ₽; текущий календарный месяц браузера | Backend role/entity scope; статусы `cancelled/canceled/void/error/failed/closed/deleted/reversed` исключены; отрицательные суммы clamp to zero; запись с положительной оплатой без `paidDate` делает critical source неоднозначным | **derived** из реальных payment records; missing/ambiguous при failed/forbidden fetch или undated paid record | «Поступило» — точный label при доступном source | Critical Finance source. Само по себе не даёт score «к плану» без approved plan. |
| 2. Accrued rental revenue / начислено | `Dashboard.tsx`: `revenueRentalsStartedThisMonth`, `monthlyRevenue`, `getRentalBillingAmount`; в модель передаётся как `accruedRentalRevenueAmount` | `GET /api/gantt_rentals`; rental dates, rates/amounts и downtime billing fields | Расчётная полная стоимость аренд, начавшихся в текущем месяце. Это не invoice, не receipt и не plan. | ₽; rentals whose `startDate` falls in current browser month | Role/entity scope; `shouldCountRental` исключает `cancelled/canceled/void/error/failed/deleted/archived`; нет company/branch filter | **derived** | «Начислено» — точный; «план» — неточный и запрещён | Только factual context; не является denominator для Finance plan attainment. |
| 3. Invoiced amount / выставлено | Отдельный source в Dashboard/Company Health отсутствует | У Company Health нет endpoint/field с канонической суммой выставленных счетов | Не определено. `Payment.amount`, document amount и accrued rental billing не подтверждены как единый invoice ledger. | — | — | **missing** | Label не должен отображаться как число без нового контракта | Не scorable. |
| 4. Approved revenue plan / утверждённый план поступлений | Source отсутствует; model принимает только явное `approvedRevenuePlanAmount`, но Dashboard его не передаёт | Endpoint/field отсутствует | Утверждённая сумма поступлений на тот же период и scope не хранится в доступном контракте | —; ожидается current calendar month | Требуются company/branch, version, approval status и audit trail | **missing** | «План поступлений» допустим только после появления approved source | `finance_receipts_to_plan`: `score=null`, `isScorable=false`, reason `Утверждённый план поступлений не задан`. |
| 5. Accounts receivable / дебиторка | `buildRentalDebtRows`, `clientFinancials`, `totalDebt` | `GET /api/gantt_rentals`, `/api/payments`, `/api/payment_allocations`; rental billing, payment/allocation IDs and amounts | Расчётный остаток начислений аренды минус связанные оплаты/распределения. Это не reconciled accounting AR ledger. | ₽; snapshot на текущую дату по доступной истории | Ignored rental/payment statuses excluded; backend role scope; stable rental/client IDs where present; no company/branch filter | **derived**, medium confidence | «Дебиторка» приемлемо только с оговоркой «расчётная» | Используется как denominator/base для overdue pressure, не как cash flow. |
| 6. Overdue receivables / просроченная дебиторка | `rentalDebtRows`, `overduePayments`, `overdueReceivablesAmount` | Те же три endpoints; `outstanding`, `expectedPaymentDate`, fallback `endDate` | Расчётный outstanding по аренде после due date; при отсутствии `expectedPaymentDate` due date заменяется концом аренды | ₽; snapshot today, не monthly flow | outstanding > 0; ignored statuses excluded; role scope; no company/branch filter | **derived**; источник считается доступным только после успешной загрузки rentals, payments и allocations | «Просроченная дебиторка» в целом верно, но provenance не равен invoice aging | Scorable в Finance с прежним весом 30%. Aging buckets и Risks formula не менялись. |
| 7. Operating inflows / операционные поступления | `actualReceiptsAmount` плюс factual cash-flow items `source=finance_operations`, `direction=incoming` | `GET /api/payments`; `GET /api/finance/cash-flow?mode=factual`; item `source`, `direction`, `amount` | Фактические клиентские оплаты с `paidDate` плюс активные ручные income operations. Expected rental rows не входят. | ₽; current calendar month | Cash-flow route requires read access to `finance_operations`; archived operations and transfers excluded backend-side | **derived** from real records; unavailable if cash-flow fetch fails/forbidden or receipts source is ambiguous | «Операционные поступления» — accurate for this assembled scope | Input to cash-flow only; not a plan. |
| 8. Operating outflows / операционные расходы | `Dashboard.tsx`: factual cash-flow items with `direction=outgoing` | `GET /api/finance/cash-flow?mode=factual`; factual items from `finance_operations` with `type=expense` | Фактически зарегистрированные активные расходные finance operations. Recurring `company_expenses` are excluded in factual mode. | ₽; current calendar month | Archived operations and transfers excluded; role/entity scope; no company/branch filter | **real records**, derived sum. Empty item set has no completeness proof, so Company Health treats outflows as missing rather than verified zero | «Операционные расходы» — accurate | Required for cash-flow score. Receipts alone cannot produce it. |
| 9. Cash flow / денежный поток | `buildFinanceDirection`: `actualOperatingInflowsAmount - actualOperatingOutflowsAmount` | Inputs assembled from factual endpoints above | Actual operating inflows minus actual operating outflows for one period/scope | ₽ and derived 0–100 score; current month | Both inputs must be explicitly available; same role scope and month | **derived** | «Денежный поток» accurate only when both inputs exist | Weight remains 20%. Existing shortfall score bands remain; pressure is now only `max(0, outflows-inflows)/max(inflows,1)`. Missing outflows => null and explicit reason. |
| 10. Actual expenses / фактические расходы | Same factual outgoing cash-flow items | `GET /api/finance/cash-flow?mode=factual`; outgoing item amounts | Recorded actual expense operations. `company_expenses` contains recurring expected expenses and is not substituted. | ₽; current month | Same as operating outflows | **derived** sum of real records; missing when no factual outgoing evidence/completeness | «Расходы» accurate with factual qualifier | Factual numerator context only; no score «к плану» without approved plan. |
| 11. Approved expense plan / утверждённый план расходов | Source отсутствует; model accepts only explicit `approvedExpensePlanAmount`, Dashboard does not pass it | Endpoint/field отсутствует | Утверждённый лимит/план расходов для того же периода и scope отсутствует | — | Требуются company/branch, version, approval status, audit trail | **missing** | «План расходов» допустим только после появления approved source | `finance_cost_pressure`: `score=null`, `isScorable=false`, reason `Утверждённый план расходов не задан`. |

## 3. Finance sub-metrics after correction

Weights are unchanged:

| Key / label | Weight | Numerator | Denominator or comparison | Current production-contract status |
|---|---:|---|---|---|
| `finance_receipts_to_plan` / Поступления к плану | 40% | Actual receipts by `paidDate` | Approved receipts plan for same period/scope | Plan **missing**; unscorable. Accrued/invoiced/forecast values are ignored as plan candidates. |
| `finance_overdue_receivables` / Просроченная дебиторка | 30% | Derived overdue outstanding | `max(totalDebt, accruedRevenue, overdue, 1)`; previous pressure bands unchanged | Derived and scorable only when rentals/payments/allocations sources loaded successfully. |
| `finance_cash_flow` / Денежный поток | 20% | Actual operating inflows − actual operating outflows | Negative-flow pressure only; existing cash-flow score bands unchanged | Scorable only when both factual input sources have evidence. |
| `finance_cost_pressure` / Расходы к плану | 10% | Actual factual expenses | Approved expense plan for same period/scope | Plan **missing**; unscorable. Revenue and previous-period expenses are not substitutes. |

## 4. Eligibility contract

```js
const MIN_FINANCE_COVERAGE_PERCENT = 50;

isFinanceEligible =
  financeAvailableDataScore !== null
  && rawFinanceCoveragePercent >= MIN_FINANCE_COVERAGE_PERCENT
  && actualReceiptsAvailable
  && overdueReceivablesAvailable;
```

Eligibility uses raw floating-point coverage, never rounded display coverage. If the predicate fails:

- public Finance `score` is `null` (the diagnostic `availableDataScore` may remain internal);
- Finance is excluded from the Company Health weighted total;
- Finance company weight contributes zero to the adjusted score;
- the tile shows `—` and `Недостаточно данных`;
- the explanation shows missing critical sources or the coverage blocker.

Overdue receivables alone provide raw Finance coverage 30% and can therefore never make Finance eligible.

## 5. Period, timezone, and scope contract

| Attribute | Current behavior | Assessment / risk |
|---|---|---|
| Period start/end | Current calendar month. Dashboard builds local month boundaries; cash-flow query sends `YYYY-MM-01` through local last day. Overdue receivables remain a today snapshot over history. | Receipts/accrual/cash-flow periods align by displayed browser month; overdue is intentionally a snapshot, not a monthly amount. |
| Company timezone | No company timezone field/setting is consumed. Boundaries use browser local timezone; some existing debt helpers still use UTC `toISOString`. | **Open P0:** cannot guarantee `Europe/Moscow` when the browser/server timezone differs. This PR documents but does not silently change the global date contract. |
| Company filter | No `companyId` filter/field in Company Health contracts. | **Open P0:** single-company assumption; cross-company isolation is not provable. |
| Branch/region filter | No `branchId`/`regionId` contract. | **Open P0:** unavailable; not implemented in this frontend-only change. |
| Role/entity scope | Backend `filterCollectionByScope`; finance cash-flow additionally requires `finance_operations` read permission. | Direction availability can differ by role. A 403/disabled query is missing, not an empty/zero source. |
| Cancelled/deleted | Payment ignored statuses and rental ignored statuses are excluded; archived finance operations excluded. Deleted collection records are absent. | Backward-compatible defensive status filtering. |
| Refunds/reversals | `reversed` payments excluded; negative payment/operation amounts are not represented as signed refunds because stored monetary normalizers are non-negative. | **Remaining risk:** a canonical refund/reversal cash event contract is missing. |
| Internal transfers | `finance_operations.type=transfer` excluded from factual cash flow. | Correct for operating cash flow. |
| Unpaid invoices | Do not enter actual receipts or factual cash flow. They may enter derived receivables/outstanding. | Correct separation; invoice ledger itself remains missing. |

## 6. Backend data still required

The honest frontend behavior is implemented, but complete Finance scoring needs a separate backend/data PR. A canonical response should provide, at minimum, these fields for one explicit period and scope:

```json
{
  "periodStart": "YYYY-MM-DD",
  "periodEnd": "YYYY-MM-DD",
  "timezone": "Europe/Moscow",
  "companyId": "...",
  "branchId": null,
  "actualReceipts": { "amount": 0, "status": "complete" },
  "approvedReceiptsPlan": { "amount": 0, "status": "approved", "version": "...", "approvedAt": "..." },
  "actualOperatingInflows": { "amount": 0, "status": "complete" },
  "actualOperatingOutflows": { "amount": 0, "status": "complete" },
  "actualExpenses": { "amount": 0, "status": "complete" },
  "approvedExpensePlan": { "amount": 0, "status": "approved", "version": "...", "approvedAt": "..." }
}
```

The endpoint name is intentionally left to the backend PR; the required semantics are not. Zero must be distinguishable from missing/incomplete, and approved plans must have period, scope, version/status, approval metadata, and audit trail. No migration or backend/API/schema change is part of this task.

## 7. Explicit non-changes

- Company Health direction weights and Finance sub-metric weights unchanged.
- Existing plan-performance, overdue-pressure, cash-flow-pressure, and expense-pressure score bands unchanged.
- Debt-aging buckets, Risks methodology, and debt-aging calculations unchanged.
- Fleet, Service, Clients, and Rental methodology unchanged.
- Backend, API, SQLite schema/data, auth, and RBAC unchanged.
- Card width/placement/chart/colors/signal count/selectors and `radialNodesInside=true` unchanged.
