# Company Health: debt-aging audit and Risks contract

**Audit date:** 2026-07-13
**Scope:** overdue receivables aging and the Company Health `Risks` direction only
**Status:** `NEEDS_BACKEND_DATA`

## Canonical read implementation status

PR3 is **IMPLEMENTED FOR REVIEW — NOT RELEASED**. It adds the default-disabled, read-only canonical endpoints `GET /api/receivables`, `GET /api/receivables/:id`, `GET /api/receivables/summary`, and `GET /api/receivables/aging` with `calculationVersion: "receivables-aging-v1"`. The code reads only the eight canonical PR1/PR2 tables and has no legacy fallback.

This does not change the `NEEDS_BACKEND_DATA` status or any production Company Health result. The canonical tables remain empty unless isolated tests create fixtures; there is no seed or backfill; `CANONICAL_RECEIVABLES_READ_API_ENABLED` defaults to disabled; and the production trusted company/branch/capability resolver remains deliberately unmapped until PR6. No Finance, Company Health, Dashboard, or Risks reader is switched, no settlement write API exists, and no production canonical read cutover occurred.

Rollback is flag disablement or code revert with no data rollback. PR4 remains blocked until PR3 is reviewed/released through a separate verification/release-marker PR and an approved backfill/reconciliation strategy exists. The PR6, PR7, and PR8 gates remain unchanged. Numeric production aging and a Risks score remain forbidden until the later scope, population, reconciliation, shadow-read, and cutover gates are satisfied.

## Decision

The existing data cannot support honest production debt aging. There is no canonical invoice or receivable entity with a proven contractual due date. The calculated rental balance is useful as a derived balance, but:

- `gantt_rentals.expectedPaymentDate` is presented and edited as an expected payment date, not a contractual term;
- `gantt_rentals.endDate` is the rental return/end date and is not legally equivalent to payment due date;
- `payments.dueDate` belongs to a mixed payment/schedule record and is not joined one-to-one to a receivable or invoice;
- `receivable_payment_plans.paymentDate` is a collection promise/plan created after debt exists, not the original contractual due date;
- no configured company timezone contract is available to the Dashboard.

Therefore Company Health does not assign current rental data to numeric aging buckets. It exposes the calculated outstanding balance as excluded/ambiguous with the reason **«Не подтверждена договорная дата платежа»**. `Risks` is excluded and displays `—` with **«Недостаточно надёжных данных по срокам задолженности»**.

This change does not alter Finance semantics. The released Finance overdue calculation continues to use its existing derived `expectedPaymentDate || endDate` behavior; only the Risks direction is prevented from treating that fallback as canonical aging.

## Complete data path

### Frontend

1. `Dashboard.tsx` requests:
   - `GET /api/gantt_rentals` through `useGanttData`;
   - `GET /api/payments` through `usePaymentsList`;
   - `GET /api/payment_allocations` through `usePaymentAllocationsList`.
2. `src/app/lib/finance.ts::buildRentalDebtRows` calculates one derived balance row per counted rental using rental billing and confirmed payment allocation impact.
3. The previous Dashboard path used `expectedPaymentDate || endDate`, `buildClientDebtAgingRows`, and cumulative `30+`/`60+` rollups. That path remains available to existing Finance/receivables UI but is no longer an input to Company Health Risks.
4. `src/app/lib/companyHealthDebtAging.js` maps rental balance rows without supplying `effectiveDueDate` or `dueDateSource`, because neither available rental date is proven contractual. Such rows are explicitly ambiguous and excluded.
5. `src/app/lib/dashboardCompanyHealth.js::buildRisksDirection` reads only the guarded `debtAging` result for overdue amount, age composition, and debtor concentration.

### Backend and persistence

- Generic collection routes expose `gantt_rentals`, `payments`, and `payment_allocations`; records are persisted as JSON collections in SQLite `app_data`.
- `server/lib/finance-core.js::buildRentalDebtRows` mirrors the frontend balance logic.
- `server/lib/receivables-core.js::buildReceivables` and `GET /api/finance/receivables` aggregate the same rental balance rows; this endpoint does not create a new accounting receivable source. It still exposes `row.expectedPaymentDate || row.endDate` as the displayed due date.
- `server/lib/payment-status-sync.js` synchronizes rental payment status from payments and allocations.
- Payment allocation backfill can link a legacy payment directly or through a document to a rental, but it does not establish an invoice due-date contract.
- Backend role scope is applied to collections. There is no explicit company/branch isolation predicate in this data path.

## Source register

| Entity | Endpoint / storage | Source function | Amount semantics | Relevant dates and status | Scope / timezone | Cancellation, refund, reversal | Confidence / safe for aging |
|---|---|---|---|---|---|---|---|
| Gantt rental | `GET /api/gantt_rentals`; `app_data.gantt_rentals` | `calculateRentalBilling`, `buildRentalDebtRows` | `finalRentalAmount` is calculated billed rental amount after supported downtime adjustment; not an invoice installment | `startDate`, `endDate`, optional `expectedPaymentDate`; rental `status`; derived `paymentStatus` | Backend role scope; manager UI scope can differ; no company/branch key; browser/UTC date handling | Cancelled/canceled/void/error/failed/deleted/archived rentals excluded. A closed/returned rental can still be unpaid and must not be treated as settled. No credit-note/refund ledger. | **Medium** for calculated balance; **low** for due date; **not safe for aging** |
| Payment | `GET /api/payments`; `app_data.payments` | `getEffectivePaidAmount`, `getPaymentAllocationCap` | `paidAmount` is factual when numeric; fallback to `amount` only for `status=paid`; allocation is capped by payment amount | `dueDate`, `paidDate`, `status`, `invoiceNumber`; record mixes planned/due and received-payment behavior | Backend role scope; no company/branch or currency contract; no company timezone | cancelled/canceled/void/error/failed/closed/deleted/reversed ignored. A reversed payment stops reducing balance, but there is no separate reversal/credit ledger with effective dates. | **Medium** for confirmed paid amount; **low** for receivable/due-date identity; **not safe alone for aging** |
| Payment allocation | `GET /api/payment_allocations`; `app_data.payment_allocations` | `buildAllocatedAmountsByRental` | Positive allocation amount reduces one rental, capped by confirmed payment capacity; allocations are processed in stored order | optional `periodStart`, `periodEnd`, `status`; no contractual due date | More restricted read permissions than payments; stable `paymentId`/`rentalId`; no company/branch/timezone | Cancelled-like allocation status is ignored by the shared payment-status guard. Credits/refunds/reversals are not modeled as signed allocation events. | **Medium** for confirmed rental allocation; **not a due-date source** |
| Receivables response | `GET /api/finance/receivables` | `buildReceivables` | Client aggregation of the same rental balance rows; not an independent ledger | displayed `dueDate = expectedPaymentDate || endDate`; collection workflow status is separate from financial settlement | Backend role scope; `today` defaults to UTC date; no company timezone | Rows with positive derived debt remain. Collection workflow closed/written-off state does not reconcile rental balance automatically. | **Low** for aging; **not canonical** |
| Receivable payment plan | finance receivables workflow; `app_data.receivable_payment_plans` | `normalizePaymentPlanInput`, `buildReceivables` | Planned collection amount, not confirmed payment | `paymentDate`, `status` | Client-scoped workflow; no contractual provenance | Cancelled/completed workflow rows do not alter confirmed paid amount | **Low** for contractual due date; **not safe for aging** |
| Debt collection plan/action | debt collection endpoints/collections | collection workflow helpers | Collection activity only; no billed/outstanding ledger | promises, next actions, notification/legal due dates | Role-scoped workflow | Does not post credits, payments, or reversals | **Low** for aging; **not a receivable source** |
| Client manual debt | `GET /api/clients`; `app_data.clients` | `buildClientReceivables`, `buildClientFinancialSnapshots` | Positive `client.debt` can be added to current debt; no supporting receivable ID or allocation trail | no contractual due date | Stable client ID when present; no company/branch/timezone | Negative values clamp to zero; cancellation/refund provenance absent | **Low**; **excluded from canonical aging and Risks** |
| Document | `GET /api/documents`; `app_data.documents` | payment allocation legacy resolver / rental detail display | May link a payment to a rental; no canonical invoiced/paid/outstanding contract in Company Health | document dates and optional generic due dates have document-specific meaning | Role-scoped; stable IDs when present | Deletion/status does not form a reconciled AR ledger | **Low**; **not safe for aging** |
| App settings | `GET /api/app_settings`; `app_data.app_settings` | no Company Health timezone reader | n/a | no proven `companyTimeZone` contract | Current Dashboard calendar is browser-local; backend defaults often UTC | n/a | **Low**; timezone remains an open risk |

## Explicit audit answers

1. **Is there a canonical invoice or receivable entity?** No. `payments.invoiceNumber` and `/api/finance/receivables` do not establish a unique, reconciled invoice/receivable ledger.
2. **What field is the contractual due date?** None is proven in the current contract.
3. **Is `expectedPaymentDate` contractual or manually estimated?** The UI and audit labels establish it only as expected. There is no immutable contractual provenance or validation.
4. **Is rental `endDate` legally equivalent to payment due date?** No evidence supports that equivalence; it is not accepted by canonical aging.
5. **How are partial payments allocated?** Confirmed effective payment is capped by payment amount. Explicit `payment_allocations` are applied to their `rentalId` in stored order and capped by remaining confirmed payment capacity. A legacy direct `payment.rentalId` applies only when that payment has no explicit allocations.
6. **Can one payment cover several rentals/invoices?** One payment can cover several rentals through multiple allocations. Invoice allocation is not modeled canonically.
7. **Are overpayments or negative balances possible?** Raw data can contain larger/negative values, but helpers clamp monetary inputs and outstanding balance to zero. Overpayment never creates negative aged debt.
8. **Are cancelled, deleted, and closed items excluded?** Cancelled/deleted/error/archived rentals are excluded. Closed rental lifecycle status is not settlement and may retain debt. Closed/reversed payment records are ignored. There is no canonical receivable lifecycle status.
9. **Are refunds and reversals reflected?** A payment marked `reversed` is ignored, which can restore derived rental balance, but there is no complete signed refund/credit/reversal event ledger. Confirmed credits and reversals cannot be populated honestly from current data.
10. **Can the same receivable appear more than once?** Duplicate rental records can produce duplicate derived rows. The canonical frontend guard deduplicates identical stable receivable IDs and excludes conflicting duplicates; the backend has no unique receivable entity constraint.

## Guarded canonical contract

The frontend model is ready to consume a future trustworthy contract. For each unique `receivableId`:

```text
outstandingBalance = max(
  0,
  canonicalReceivableAmount
  - confirmedAllocatedPayments
  - confirmedCredits
  + confirmedReversals
)
```

All money is converted to integer cents before subtraction and aggregation. Pending/scheduled payments are ignored. Zero, paid, negative, and overpaid balances do not enter aging.

Accepted due-date provenance is deliberately allow-listed:

1. `invoice_due_date`;
2. `contractual_payment_due_date`.

`expectedPaymentDate` and `endDate` are never silent fallbacks. The as-of date must be normalized to a configured company IANA timezone before calendar-day subtraction.

### Mutually exclusive buckets

| Bucket | Rule |
|---|---|
| `current` / «Не наступил срок» | `overdueDays <= 0` |
| `bucket1to30` / «1–30 дней» | `1 <= overdueDays <= 30` |
| `bucket31to60` / «31–60 дней» | `31 <= overdueDays <= 60` |
| `bucket61to90` / «61–90 дней» | `61 <= overdueDays <= 90` |
| `bucketOver90` / «Более 90 дней» | `overdueDays >= 91` |

The result returns amounts and counts for every bucket, eligible and overdue totals, ambiguous excluded amount/count/reasons, stable IDs per bucket, source status, confidence, and reconciliation metadata.

## Risks methodology

Company Health weight remains **20%**. Risks sub-metric weights remain **45% / 25% / 20% / 10%**.

### Overdue receivables (45%)

Uses only `debtAging.overdueOutstandingAmount`. The denominator is the largest proven scale among eligible outstanding, actual current-period receipts when available, and confirmed overdue. It does not use current debt, cumulative buckets, accrued revenue, or a missing plan.

### Debt age composition (25%)

The score is composition-only because no approved monthly revenue plan is a valid denominator:

```text
severity = (
  0.20 * amount1to30
  + 0.50 * amount31to60
  + 0.80 * amount61to90
  + 1.00 * amountOver90
) / overdueOutstandingAmount

score = round(100 * (1 - min(1, severity)))
```

No overdue debt produces 100 for this sub-metric only when the empty result itself is reliable. More-than-90 debt is always more severe than the same amount in 1–30.

### Large problem clients (20%)

Uses the largest confirmed client-level overdue amount divided by confirmed overdue. A stable client ID is required. The existing concentration score bands are retained. The descriptive rule «large concentration» is derived at `>=30%`; it is **not** claimed to be management-approved policy.

### Risks eligibility

```text
MIN_RISKS_COVERAGE_PERCENT = 55

isRisksEligible =
  risksScore !== null
  && rawRisksCoveragePercent >= 55
  && overdueReceivablesAvailable
  && debtAgingReliable
```

Raw, unrounded coverage is used. Ambiguous aging makes the 45%, 25%, and 20% debt metrics unscorable, so the operational 10% cannot manufacture a confident Risks score.

### Focus priority override

This does not change the total score. Risks moves to the front of focus directions when either derived condition is met:

- confirmed `over90` amount is at least `max(50,000 ₽, 5% of factual current-period receipts)`; or
- one confirmed client holds at least 50% of confirmed overdue and at least 50,000 ₽.

These thresholds are explicitly derived rules, not approved credit policy.

## Reconciliation evidence

Automated fixtures prove boundary exclusivity, counts, amounts, paid/zero/negative exclusion, partial allocation behavior, pending-payment exclusion, status behavior, ambiguous-date exclusion, timezone boundaries, stable-ID deduplication, real 91+ behavior, and cent rounding.

Safe aggregate read-only check of the repository SQLite snapshot at 2026-07-13 (not a claim about current live production):

| Signal | Aggregate |
|---|---:|
| `gantt_rentals` records | 1,230 |
| rental records with `expectedPaymentDate` | 5 |
| payment records | 75 |
| payment records with `dueDate` | 75 |
| payment records with `paidDate` | 6 |
| payment allocation records | 6 |
| positive derived rental balance rows | 1,230 |
| derived outstanding before aging guard | 15,630,100 ₽ |
| canonical-aging eligible amount | 0 ₽ |
| excluded ambiguous amount | 15,630,100 ₽ |
| excluded ambiguous rows | 1,230 |
| numeric bucket sum | 0 ₽ |
| source status / confidence | `ambiguous` / `low` |

The exclusion reconciles: `0 ₽ eligible + 15,630,100 ₽ ambiguous = 15,630,100 ₽ derived outstanding`. No client names or personal data were used in this evidence.

## Exact backend contract required for production Company Health

PR3 implements the review-only backend contract at `GET /api/receivables/aging?asOfDate=YYYY-MM-DD`, but Company Health cannot consume it in production yet. Moving from `NEEDS_BACKEND_DATA` to real aging still requires PR3 release verification, PR6 trusted company/branch/capability mappings, populated and reconciled canonical data, PR7 shadow comparison, and the later cutover approval. The canonical rows and aggregate response must continue to provide:

- immutable unique `receivableId` and, when applicable, `invoiceId`/`documentId`;
- stable `clientId`, optional `rentalId`/`contractId`, and explicit `companyId`/`branchId` scope;
- currency and integer-minor-unit `canonicalReceivableAmount`;
- contractual `dueDate` plus one of the approved provenances (`invoice_due_date`, `contractual_payment_due_date`, `installment_due_date`, or `migrated_verified`);
- receivable lifecycle `status` with defined open/paid/cancelled/void/written-off semantics;
- confirmed allocated payments in minor units, excluding pending/scheduled payments;
- confirmed credit notes and reversal/refund events in minor units with effective status/date;
- server-enforced uniqueness and deterministic duplicate handling;
- company IANA timezone and server-normalized `asOfDate`;
- aggregate eligible/excluded counts and amounts with exclusion reasons;
- bucket amounts/counts and reconciliation totals calculated or verifiable server-side.

The endpoint contract must guarantee:

```text
totalOutstanding = current + 1–30 + 31–60 + 61–90 + over90
overdueOutstanding = 1–30 + 31–60 + 61–90 + over90
```

Until that contract is released, authorized, populated, reconciled, shadow-verified, and explicitly cut over, showing numeric production aging or a numeric Risks score would overstate data integrity.
