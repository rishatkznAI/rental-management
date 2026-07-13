# Canonical receivables backend contract

**Status:** product-owner baseline approved; specification only

**Audit date:** 2026-07-13

**Target branch:** `codex/canonical-receivables-contract`

**Implementation status:** no schema, backend, API, Company Health, or frontend behavior is changed by this document

## Product-owner baseline

**Decision date:** 2026-07-13

**Approved decisions:** D-01 through D-27 in `docs/canonical-receivables-decisions.md`.

**Conditional approvals:** D-01's exact allow-list of legally/accountingly sufficient source document types requires accountant and legal confirmation. D-24's exact retention duration and related legal-hold/export rules require accountant and legal confirmation. D-25's authority model is approved, but exact monetary and age thresholds for dual approval remain pending product/Finance approval.

**PR 1 implementation gate: PASS.** PR1 may implement the canonical schema/domain baseline because its structural decisions are approved. It may model a configurable source-type allow-list, but it must not hardcode unconfirmed legally sufficient document types or enable production posting. This documentation task itself creates no schema or migration.

**No silent assumptions:** unresolved source document types, retention periods, approval thresholds, or expanded permissions must remain disabled, configuration-blocked, or escalated. Implementation must not invent defaults for them.

## 1. Purpose and decisions at a glance

The current system can calculate a useful rental balance, but it does not have an accounting-grade invoice, receivable, installment, payment, adjustment, or tenant contract. The canonical model should therefore be a new ledger rather than a rename of the existing `/api/finance/receivables` aggregation.

The recommended minimum model is:

1. one immutable-posting `Receivable` for each obligation with one contractual due date;
2. no separate `ReceivableInstallment` table in the first implementation;
3. a source document with several contractual due dates creates several receivables, one per installment/source line;
4. canonical `Payment` receipts and refunds, with explicit status and reversal relationships;
5. `PaymentAllocation` records that settle a specific receivable;
6. `ReceivableAdjustment` records for debit, credit, correction, and write-off effects;
7. a dedicated append-only financial audit table;
8. normalized SQLite tables, because JSON arrays in `app_data` cannot enforce the required foreign keys, unique constraints, integer money checks, or atomic allocation limits.

Approved plans, forecasts, manager expectations, and collection promises remain in a separate planning domain. They may reference canonical IDs for comparison but never create debt, settle a balance, supply a contractual due date, or enter actual receivable/payment totals.

After signed shadow reconciliation and feature-flagged cutover, the canonical receivable ledger becomes the operational source of truth for receivables, balances, allocations, and aging. An accounting integration remains a reconciled external source; conflicts are quarantined and reconciled rather than silently overwriting canonical records.

`originalAmountMinor` is editable only while a receivable is `draft`. It becomes immutable when the receivable is `posted`. Later corrections use adjustments or a controlled cancel-and-replacement workflow.

The terms **canonical**, **derived**, **ambiguous**, and **missing** in this document mean:

- **canonical:** an authoritative persisted record with enforced identity and integrity rules;
- **derived:** computed from other records and useful for operations, but not an independent ledger fact;
- **ambiguous:** a value exists, but its identity, meaning, scope, or provenance is not proven;
- **missing:** no suitable field or entity exists.

Approved product choices and the few remaining conditional confirmations are summarized in [Product-owner baseline](#product-owner-baseline) and detailed in [Decision baseline and remaining confirmations](#15-decision-baseline-and-remaining-confirmations).

## 2. Current-state audit

### 2.1 Persistence and entity register

All listed business collections are JSON arrays stored under one row per collection in SQLite `app_data` (`server/db.js`). Record fields are schemaless and old records may omit newer fields. Except for limited shadow indexes, database-level foreign keys, per-record checks, and unique constraints do not exist.

| Entity / collection | Source | Important fields and keys | Amount / currency | Dates and lifecycle | Links, allocation, deletion | Classification and integrity risks |
|---|---|---|---|---|---|---|
| `app_data` | `server/db.js` | PK `name`; entire collection in `json`; `updated_at` | No per-record money type | Collection row timestamp only | A write replaces the whole JSON value | Canonical storage container, but insufficient for financial relational invariants, per-record concurrency, and database-enforced tenant isolation. |
| `rentals` | `server/routes/rentals.js`, `src/app/types.ts` | PK-like `id`; optional `clientId`, `objectId`, `contractId`; client display name; equipment; `startDate`, `plannedReturnDate`; `price`, `rate`, `discount`; `status` | JavaScript numbers / text rates; no required currency | `new`, `confirmed`, `delivery`, `active`, `return_planned`, `closed` plus legacy values; return workflow preserves related payments/documents | Stable rental/client links are supported. Generic delete physically removes a rental. | Canonical operational rental record; not a receivable. Amount fields and terms can change; no source posting identity or contractual due-date provenance. |
| `gantt_rentals` | `server/routes/rentals.js`, `src/app/mock-data.ts` | PK-like `id`; usually `rentalId`/`sourceRentalId`; `clientId`, `objectId`, `contractId`; `amount`; `expectedPaymentDate`; `endDate`; downtime data | Floating-point major units; no required currency | Operational rental and derived `paymentStatus`; cancelled/deleted/archived-like states excluded from finance helpers, while closed unpaid rentals remain debts | Finance uses this collection after requiring a link to a classic rental. Physical delete is available. | Canonical planner/rental projection; **derived** billing source; not an invoice or receivable. Duplicate/source-link drift can duplicate or omit calculated debt. |
| Rental billing result | `server/lib/rental-billing.js`, mirrored in frontend helpers | No persisted billing-result ID; result includes gross amount, daily rate, downtime adjustment, final amount | JavaScript floating point rounded to 2 decimals | Uses inclusive rental dates and active downtime periods | Recomputed whenever read; not frozen to a posted source document | **Derived**. It can change when rental dates, amount, rate, or downtime change; it is not an immutable billed obligation. |
| `clients` | `server/routes/crud.js`, `src/app/types.ts` | PK-like `id`; editable `company`; `paymentTerms`; `creditLimit`; manual `debt`; manager fields | Floating-point major units; no currency | Optional active/inactive state; history for selected edits | Deletion is physically performed but blocked when linked rentals or selected history exist. Stable `clientId` is preferred; guarded name fallback exists for legacy repair. | Client ID is a suitable reference candidate. `client.debt` is ambiguous manual debt with no receivable, due date, currency, or allocation trail. |
| Companies / branches / regions | No canonical entity found | No stable company or branch PK in the audited finance/rental model | No company currency contract | No company timezone lifecycle | No tenant/branch relationship to financial records | **Missing**. Current access behaves as a single-company model with role/manager scoping. |
| `client_contracts` | `server/lib/client-relations.js`, `server/routes/crud.js`, `src/app/types.ts` | PK-like `id`; `clientId`; optional object links; contract `number`, `date`, `status` | No contractual receivable amount model | Active/archived | Referenced by rentals/payments/allocations; generic physical delete remains possible | Operational contract register. No payment schedule, legal billing event, or immutable source version. |
| `documents` | `server/routes/documents.js`, `server/lib/documents-core.js`, `src/app/types.ts` | PK-like `id`; document type/number; `clientId`, `contractId`, `rentalId`; optional `amount`, `dueDate`; optional billing snapshot | Floating-point major units; VAT fields; no required currency | Draft/signed/sent/pending/expired/cancelled; document date fields | Can link payments/allocations to rentals. Generic delete physically removes records subject to current approval rules. | Contains `invoice` document type, but no enforced invoice identity, line model, immutable posting, balance, or one-to-one due-date contract. Not a canonical invoice ledger. |
| `payments` | `server/routes/crud.js`, `server/lib/finance-core.js`, `src/app/types.ts` | PK-like `id`; `clientId`; optional `rentalId`, `objectId`, `contractId`; `invoiceNumber`; `amount`; `paidAmount`; `dueDate`; `paidDate`; `status` | Floating-point major units; no required currency | Pending/paid/overdue/partial types plus ignored legacy statuses such as cancelled/reversed/failed/closed | A direct `rentalId` acts as legacy allocation only if no explicit allocation exists. Admin can physically delete an unallocated payment. High-risk edits/deletion are blocked after active allocations. | Mixed obligation/schedule/receipt record. `amount` means total due while `paidAmount` means cash received. IDs are useful migration candidates, but the entity is not canonical without normalization. |
| `payment_allocations` | `server/routes/crud.js`, `server/routes/finance.js`, `server/lib/finance-core.js` | PK-like `id`; `paymentId`; optional `rentalId`, document/client/object/contract IDs; `amount`; `status`; `source` | Floating-point major units; no required currency | Active by convention; cancelled allocations are ignored | One payment can have multiple allocations. Validation caps total allocations by the confirmed payment capacity and verifies referenced payment/rental/document existence. Generic update/delete is possible. | Partially canonical operational link, but targets a rental, not a receivable; it does not cap by target outstanding, enforce client/company/currency equality, or record a first-class reversal. |
| `/api/finance/receivables` response | `server/lib/receivables-core.js`, `server/routes/finance.js` | Grouped primarily by client ID; embeds rental rows | Sum of derived rental final amount less payment effects | Displays `expectedPaymentDate || endDate`; collection workflow status is separate | Read-only aggregation; no receivable record is created | **Derived**, not canonical. Client aggregation can hide individual obligation identity. Due-date fallback is not contractually safe. |
| `receivable_payment_plans` | `server/lib/receivables-core.js`, `server/routes/finance.js` | PK-like `id`; client/rental IDs; `paymentDate`, `amount`, `status` | Floating-point major units; no currency | Planned/paid/missed/cancelled | Collection promise rows do not allocate cash or change outstanding | Collection workflow only. It is not an installment contract or original contractual due date. |
| `debt_collection_actions` / `debt_collection_plans` | `server/lib/receivables-core.js`, `server/routes/finance.js`, `server/routes/debt-collection-plans.js` | IDs; client/rental/payment/document links; promise, action, court, enforcement, and workflow fields | Floating-point promise/claim/recovery amounts | Collection stages can reach recovered/closed/written_off/disputed | Workflow events do not post credits, payments, write-offs, or receivable closure | Operational/legal collection workflow. Status names such as `written_off` do not reconcile the financial balance. |
| `finance_operations` / `finance_accounts` / `company_expenses` | `server/routes/finance.js`, `server/lib/cash-flow.js` | Operation/account/expense IDs and general categories | JavaScript numbers; accounts have optional/default RUB currency | Active/archived; operation date | No receivable allocation relationship | Canonical-ish management cash-flow records for their own UI, not an AR subledger. Transfers must never count as customer receipts. |
| `leasing_contracts` / `leasing_payment_schedule` | `server/lib/leasing-core.js`, `server/routes/leasing.js` | Contract ID and generated schedule rows with `dueDate`, amount, paid/outstanding | JavaScript numbers | Planned/paid/overdue/skipped | Schedule is for company payables, not client receivables | Evidence that schedules exist technically, but not evidence of a client installment requirement. Must not be mixed into AR. |
| `app_settings` | `server/db.js`, finance/settings readers | Key/value objects | N/A | No company calendar lifecycle | Current snapshot contains document numbering settings | **Missing** stable company ID, branch register, and confirmed company IANA timezone for receivable aging. |
| Generic audit `audit_logs` | `server/lib/security-audit.js` | Audit ID, actor, action, entity, redacted before/after, IP/user-agent, timestamp | Some money fields allowed | Last 10,000 entries retained | JSON collection; logger failures are non-fatal | Useful supplemental audit, but mutable/truncated and lacks guaranteed reason, correlation ID, source system, and complete financial fields. Insufficient as the sole financial audit ledger. |
| Company Health debt-aging adapter | `src/app/lib/companyHealthDebtAging.js`, `docs/company-health-debt-aging.md` | Synthesizes `receivableId` from rental ID | Converts major-unit values to cents in memory | Accepts only `invoice_due_date` and `contractual_payment_due_date`; rental dates are deliberately not supplied as canonical | Conflicting duplicate IDs are excluded; ambiguous dates are excluded | Defensive frontend guard, not a backend ledger. Current production behavior must remain unchanged in this specification phase. |

### 2.2 Current rental charge calculation

`server/lib/rental-billing.js` calculates the charge as follows:

1. use explicit `amount`, `price`, `totalAmount`, or `rentalAmount` as the gross full-rental amount;
2. otherwise infer a daily rate from `dailyRate`, `pricePerDay`, a monthly rate divided by 30, or parsed `rate` text;
3. count inclusive calendar days;
4. subtract only active downtime periods where `affectsBilling=true`;
5. round intermediate money to two decimal major-unit digits;
6. expose `finalRentalAmount` as the derived charge.

The result is recomputed, not posted. A later rental extension or downtime edit can change it. Generated documents can contain a billing snapshot, but no invariant makes that snapshot the legal source of a unique receivable.

### 2.3 Current payment and allocation behavior

- A numeric non-negative `paidAmount` is treated as received; otherwise a `paid` payment falls back to `amount`.
- Pending payments do not reduce rental debt.
- Cancelled, failed, deleted, closed, and reversed-like payment statuses are ignored.
- A payment directly linked to `rentalId` reduces that rental only when the payment has no explicit allocations.
- Explicit allocations are processed in stored order and capped by remaining confirmed payment capacity.
- One payment can settle several rentals through several allocation rows.
- Several payments can settle one rental through direct links or several allocation rows.
- Target rental outstanding is clamped to zero, but a manual allocation is not rejected merely because all payments together exceed that rental's outstanding.
- Overpayment is represented only as an unallocated payment remainder or is hidden by the zero clamp; there is no client-credit ledger.
- A payment status of `reversed` restores derived debt by excluding the entire payment, but there is no immutable reversal transaction.
- No canonical refund, credit note, debit note, write-off posting, or adjustment reversal entity exists.

### 2.4 Scope, deletion, and date behavior

Backend access control is role/manager/equipment relationship based. It correctly applies backend filtering to finance source collections, but there is no `companyId` or `branchId` predicate to enforce. Admin and office-manager access is effectively global under the current single-company assumption.

Dates are mostly `YYYY-MM-DD` strings. Some backend helpers default to `new Date().toISOString().slice(0, 10)`, which is UTC, while frontend period logic can be browser-local. No company IANA timezone is available in the audited path.

Most generic deletes physically splice JSON arrays. Important exceptions are guards, not soft deletion: clients with history cannot be deleted; allocated payments cannot be deleted; non-admin financial deletion often enters an approval workflow. Documents, unallocated payments, allocations, rentals, and other eligible records can still be physically removed by an authorized path. Audit logging does not turn the source record into an immutable ledger.

### 2.5 Read-only local snapshot evidence

The following aggregate-only observations come from the repository's local `server/data/app.sqlite` snapshot on 2026-07-13. They are not a statement about live production. The task context separately states that current production has zero positive outstanding receivables.

| Collection / signal | Local snapshot result |
|---|---:|
| Classic rentals | 661 |
| Gantt rentals | 1,230 |
| Payments | 75 |
| Payment allocations | 6 |
| Documents | 175 |
| Invoice-typed documents | 5 |
| Clients | 281 |
| Client contracts | 130 |
| Records in the listed entities with `companyId` | 0 |
| Records in the listed entities with `branchId` | 0 |
| Gantt rentals with `clientId` / source `rentalId` | 1,230 / 1,230 |
| Gantt rentals with `expectedPaymentDate` / `endDate` | 5 / 1,230 |
| Payments with `clientId` / `rentalId` | 75 / 69 |
| Payments with `dueDate` / `paidDate` | 75 / 6 |
| Allocations with payment/rental/client/contract IDs | 6 / 6 / 6 / 6 |
| Documents with a due date | 0 |
| Confirmed company timezone setting | 0 |

The snapshot shows useful stable-link candidates, but it does not prove legal source identity, contractual dates, company scope, currency, or receipt dates for most payment rows.

### 2.6 Explicit audit answers

1. **Canonical invoice entity?** No. `documents` can have type `invoice`, and payments have `invoiceNumber`, but neither forms an immutable, unique, reconciled invoice ledger.
2. **Canonical receivable entity?** No. `/api/finance/receivables` is a derived client aggregation over rental balances.
3. **Installment/payment-obligation entity?** No for client AR. `receivable_payment_plans` is a collection promise; leasing schedules are company payables.
4. **How are rental charges calculated?** From rental amount/rate, inclusive days, and billing-affecting downtime via `calculateRentalBilling`; the result is recomputed and rounded in floating-point major units.
5. **Can one rental create several receivables?** Not currently. Finance produces at most one derived debt row per counted Gantt rental record, although duplicate rental records can duplicate the economic obligation.
6. **Can one payment settle several receivables?** It can settle several rentals through several allocation rows. There are no canonical receivables to target.
7. **Can one receivable be paid by several payments?** A derived rental debt can be reduced by several payments/allocations. No target-outstanding constraint protects the aggregate.
8. **Partial payments?** `paidAmount < amount` and/or partial allocations reduce the calculated rental balance.
9. **Overpayments?** Outstanding is clamped to zero. Explicitly allocated excess is not a negative receivable; unallocated receipt capacity can be reported separately. No client-credit ledger exists.
10. **Refunds?** Missing as a canonical event. Negative money is rejected/clamped; there is no original-payment/refund relationship.
11. **Reversals?** A payment marked `reversed` is excluded wholesale. Allocation and adjustment reversal records do not exist.
12. **Credits/write-offs?** Missing financially. Collection workflow labels/actions do not post an adjustment against the balance.
13. **Contractual due date?** None is proven. `expectedPaymentDate`, rental `endDate`, payment `dueDate`, and collection-plan dates are not accepted substitutes.
14. **Can the same debt be counted twice?** Yes. Duplicate Gantt/source rental rows, conflicting IDs, legacy direct payment links plus malformed allocations, or cross-collection drift can produce duplication/omission. There is no receivable uniqueness constraint.
15. **Money storage?** Floating-point JavaScript/JSON numbers in major units, with local two-decimal rounding in some helpers; not integer minor units.
16. **Company/branch isolation?** No. Backend role and manager scoping exists, but company and branch keys/filters are absent.
17. **Company timezone?** No confirmed setting is available to this data path.
18. **Immutable source-document identifier?** Record IDs exist, but invoice identity/version/line uniqueness and immutability are not enforced. Therefore there is no proven immutable billing-source identifier.
19. **Deletion model?** Mostly physical JSON-array deletion, with selected guards and audit entries. It is not a uniform soft-delete model.
20. **What can be safely backfilled?** Stable IDs and explicit links can be copied as migration references after company/currency mapping. Contractual dates cannot be invented. Receipts and allocations can be backfilled only when status, amount, receipt date, target, scope, and currency reconcile. Rental-derived obligations may enter shadow reconciliation with `dueDateProvenance=unknown`, but must not become authoritative or age-eligible solely because a rental ID/amount exists.

### 2.7 Current Company Health Finance/Risks mapping

| Company Health concept | Current source and semantics | Canonical-contract implication |
|---|---|---|
| Actual receipts | `GET /api/payments`; factual amount uses numeric `paidAmount` or paid-status fallback and requires `paidDate` for current-period Company Health receipts | Future receipt metrics should read confirmed canonical payments by `receivedAt`, excluding refunds/reversals/internal transfers according to the payment contract. |
| Accrued rental revenue | Gantt rentals and `calculateRentalBilling`; derived amount for rentals starting in the displayed period | Remains operational accrued context. It must not automatically create or equal an invoice/receivable without an approved source event. |
| Invoiced amount | No independent Company Health source | Future metric requires posted canonical source documents/receivables, not `payments.amount` or rental billing. |
| Accounts receivable | `buildRentalDebtRows` over Gantt rentals, payments, and allocations | Medium-confidence derived balance. Future Finance totals should use canonical receivable balances after reconciliation/read switch. |
| Finance overdue receivables | Existing Finance path still uses `expectedPaymentDate || endDate` on the derived balance | This legacy behavior is unchanged here. It must not be promoted into the canonical endpoint. |
| Risks debt aging | `mapRentalDebtRowsForCompanyHealth` deliberately supplies no canonical date; `buildCanonicalDebtAging` accepts only invoice/contractual provenance and excludes ambiguous balances | Future shadow integration consumes the backend aging endpoint only after approved provenance, timezone, tenant, and reconciliation gates pass. |
| Operating cash flow | Factual `finance_operations` expenses and receipt inputs; transfers excluded from operating flows | Canonical receipts/refunds can improve the receipt side, but the receivable ledger does not replace cash-flow or general-ledger semantics. |

No current Company Health source has a company/branch filter contract. This is a P0 blocker for canonical Finance/Risks reads, even when current production happens to contain no positive outstanding receivables.

## 3. Proposed canonical domain model

### 3.1 Storage boundary

Use dedicated normalized SQLite tables for canonical financial records. Keep legacy `app_data` collections during migration and dual-write. This recommendation is driven by P0 invariants: JSON collection replacement cannot reliably provide row-level foreign keys, unique source identities, compare-and-swap versions, or atomic allocation caps.

Every canonical financial table uses a stable opaque ID (UUID/ULID or existing project-standard generated ID), mandatory `companyId`, mandatory branch context, UTC timestamps, an integer `version`, and database constraints. IDs are never recycled. The company configuration stores a required IANA receivables timezone; the current company starts with `Europe/Moscow`. The initial release recognizes only `RUB` as a transaction currency.

### 3.2 Receivable

A receivable is a legally or operationally approved obligation owed by one client in one currency, with exactly zero or one contractual due date.

| Field | Type / nullability | Contract |
|---|---|---|
| `id` | text, required, PK | Immutable opaque ID. |
| `companyId` | text, required, FK | Immutable tenant scope. |
| `branchId` | text, required, FK | Source/owning branch. Company-wide activity uses the company's dedicated Head Office branch; null is forbidden. |
| `clientId` | text, required, FK | Stable client identity; names are display snapshots only. |
| `contractId` | text, nullable, FK | Contract when proven. Must belong to client/company. |
| `rentalId` | text, nullable | Operational source link, not identity by itself. |
| `sourceDocumentType` | enum/text, required | Must be in the versioned posted-source allow-list. The exact legally sufficient types remain blocked on accountant/legal confirmation; a rental-only type is forbidden. |
| `sourceDocumentId` | text, required | Immutable source ID in its source system. |
| `sourceLineId` | text, nullable | Stable invoice/source line or schedule-line identity. |
| `sourceSystem` | text, required | `skytech`, accounting integration name, bank/import source, etc. |
| `externalId` | text, nullable | External receivable ID; unique within company/source system when present. |
| `idempotencyKey` | text, required | Key that produced this receivable; stored with request hash/result. |
| `currency` | `CHAR(3)`, required | Must be `RUB` in the initial release; immutable after posting. |
| `originalAmountMinor` | integer, required, `> 0` | Editable in draft; immutable after posting. |
| `issuedAt` | RFC 3339 instant, nullable | Source issuance instant when distinct from posting. |
| `postedAt` | RFC 3339 instant, required for `posted`/`disputed`/`written_off` | Source posting or financial-approval instant that activates the receivable. |
| `contractualDueDate` | `YYYY-MM-DD`, nullable | Civil date in company calendar. Never inferred silently. |
| `dueDateProvenance` | enum, required | Defined in section 7. |
| `companyTimezone` | IANA zone, required after posting | Immutable aging snapshot copied server-side from the owning company's timezone. The company setting remains authoritative for new postings. |
| `status` | enum, required | Stored lifecycle: `draft`, `posted`, `disputed`, `cancelled`, `written_off`. |
| `cancellationReason` | text, nullable | Required only for `cancelled`; cancellation preserves source and financial history. |
| `description` | text, required | Human-readable, non-identity label. |
| `createdAt`, `updatedAt` | UTC instants, required | Server generated. |
| `cancelledAt`, `writtenOffAt` | UTC instants, nullable | `writtenOffAt` is set only when a full approved write-off moves stored status to `written_off`; partial write-off remains an adjustment. |
| `version` | integer, required | Optimistic concurrency; starts at 1 and increments on permitted metadata/lifecycle changes. |

**Original amount decision:** `originalAmountMinor` is immutable once status leaves `draft`. A posted amount correction uses a typed adjustment. Cancellation/replacement is allowed only through a dedicated workflow that preserves both records and source relationships.

### 3.3 Installment decision

Do not create a separate `receivable_installments` table in the initial release. Each contractual due date is independently aged and therefore becomes its own `Receivable`.

For a three-installment invoice, create three receivables sharing `companyId`, `clientId`, `sourceDocumentType`, and `sourceDocumentId`, with distinct `sourceLineId` values (or a deterministic installment line such as `installment:1`). Each has its own amount, due date, allocations, adjustments, lifecycle, and aging bucket.

This model is preferred because current AR requirements do not prove a need for a parent balance that can be allocated separately from installments. It prevents a single receivable from appearing in several buckets and avoids allocation ambiguity. A future presentation-only `obligationGroupId` may group installments without becoming a settlement target.

If product later requires a parent obligation entity, it must remain non-ageable and its amount must equal the sum of child receivables; allocations still target exactly one child receivable.

### 3.4 Payment

The existing JSON `payments` collection cannot remain canonical unchanged because it mixes amount-due, schedule, and cash-receipt semantics. It can remain the legacy projection during dual-write. The canonical payment table uses:

| Field | Type / nullability | Contract |
|---|---|---|
| `id` | text, required, PK | Immutable payment/refund ID. |
| `companyId` | text, required | Immutable company scope. |
| `branchId` | text, required | Receipt-owning branch; company-wide receipts use the Head Office branch. |
| `clientId` | text, required | Payer/client ID; counterparty ID may be added if payer differs. |
| `kind` | enum, required | `receipt`, `refund`, or `reversal`; refund/reversal rows are append-only events linked to the original receipt. |
| `currency` | `CHAR(3)`, required | Immutable and must match every allocation. |
| `receivedAmountMinor` | integer, required | Positive for `receipt`; zero for `refund`/`reversal`. |
| `refundAmountMinor` | integer, required | Positive for `refund`/`reversal`; zero for `receipt`. No signed money. |
| `receivedAt` | UTC instant, required for confirmed receipt | Actual bank/cash event time, not a due date. |
| `status` | enum, required | `pending`, `confirmed`, `failed`, `cancelled`. Only confirmed receipts fund allocations; effective reversal is derived from confirmed compensating events. |
| `externalTransactionId` | text, nullable | Bank/acquirer/import transaction identity. |
| `sourceSystem` | text, required | Source namespace for external identity. |
| `reversesPaymentId` | text, nullable, self-FK | Required for refund/reversal events. The referenced original is never edited or deleted. |
| `internalTransfer` | boolean, required, default false | Internal transfers are never customer receipts or allocation capacity. |
| `idempotencyKey` | text, required | Unique in company/operation scope. |
| `createdAt`, `updatedAt`, `version` | required | Server/audit concurrency fields. |

Confirmed receipt capacity is:

```text
paymentAvailableMinor =
  confirmed receivedAmountMinor
  - confirmed refund/reversal amounts linked to this receipt
  - confirmed allocation effects net of allocation-reversal events
```

It may not be negative. A full payment reversal requires append-only reversals of all confirmed allocations first in the same transaction or an earlier transaction. Pending/failed/cancelled payments provide zero allocation capacity; a fully compensated receipt has zero derived capacity without mutating the original receipt.

### 3.5 Payment allocation

| Field | Type / nullability | Contract |
|---|---|---|
| `id` | text, required, PK | Immutable allocation ID. |
| `companyId` | text, required | Must equal payment and receivable company. |
| `branchId` | text, required | Immutable allocation-owning/receipt branch context copied from the payment. |
| `receivableBranchId` | text, required | Immutable obligation branch context copied/validated from the receivable. |
| `kind` | enum, required | `allocation` or append-only `reversal`. |
| `paymentId` | text, required, FK | Confirmed receipt. |
| `receivableId` | text, required, FK | One ageable receivable; there is no rental-only canonical target. |
| `allocatedAmountMinor` | integer, required, `> 0` | Positive magnitude only. |
| `allocationStatus` | enum, required | `pending`, `confirmed`, or `cancelled`. A confirmed `allocation` reduces outstanding; a confirmed `reversal` compensates its referenced allocation. |
| `allocatedAt` | UTC instant, required when confirmed | Settlement posting time. |
| `reversesAllocationId` | text, nullable, self-FK | Reversal row points to the original row. |
| `createdBy` | actor ID, required | Stable user/integration actor ID. |
| `idempotencyKey` | text, required | Duplicate request protection. |
| `createdAt` | UTC instant, required | Server generated. |

On reversal, create a new confirmed `kind=reversal` row pointing to the original. The original allocation is never edited or deleted. Net allocation effect is the confirmed original amount minus confirmed linked reversal amounts; reversal chains and caps are validated atomically.

Required allocation transaction invariants:

- payment and receivable exist and are in the same company;
- client and currency match;
- branch policy passes;
- payment is confirmed and not an internal transfer;
- sum of confirmed allocation effects net of confirmed reversal events plus the new allocation does not exceed payment capacity;
- the new allocation does not exceed receivable outstanding at the same database snapshot;
- checks and insert occur in one SQLite transaction;
- optimistic/idempotency conflicts return 409, not a partial write.

Cross-branch allocation is permitted only when allocation `branchId != receivableBranchId`, both branches belong to the same `companyId`, the actor has `allocations.cross_branch`, and the audit event records both branches. Cross-company allocation is always forbidden.

Automatic allocation uses this approved order and stops as soon as capacity or eligible debt is exhausted:

1. exact posted document/reference match;
2. explicit client instruction with retained evidence;
3. oldest confirmed receivable for the same client/company/currency and permitted branch scope;
4. otherwise retain the remainder as unapplied client balance.

For step 3, “confirmed” means stored status `posted`, positive outstanding, and not disputed/cancelled/written off. “Oldest” sorts by contractual due date, then `postedAt`, then stable `id`; a missing contractual date sorts after proven dates. No allocation is inferred from a client display name. One payment may create several explicit allocation rows, and one receivable may receive several payment allocations.

### 3.6 Receivable adjustment

Adjustments use positive magnitudes, an explicit business `type`, and an explicit `effect`. Business meaning is never inferred from a positive or negative sign. The approved ordinary types are `credit`, `debit`, `discount`, `penalty`, and `correction`; `write_off` and `reversal` are controlled system/approval types required by D-13 and D-15.

| Type | Required effect | Rules |
|---|---|---|
| `debit` | `increase` | Additional approved charge. |
| `credit` | `decrease` | Approved credit-note/cancellation effect; cannot reduce below zero. |
| `discount` | `decrease` | Explicit commercial discount; cannot reduce below zero. |
| `penalty` | `increase` | Explicit contractual penalty with source evidence. |
| `correction` | `increase` or `decrease`, explicitly supplied | Corrects a posted error; direction, reason, and source are mandatory and never inferred from amount sign. |
| `write_off` | `decrease` | Requires reason and approval; cannot exceed current outstanding. |
| `reversal` | exact opposite of referenced adjustment | Append-only compensating event; `reversesAdjustmentId` is required and amount cannot exceed the referenced event's unreversed amount. |

A cash refund is a `Payment(kind=refund)`, not a receivable adjustment. If refunded cash had been allocated, the allocation must be reversed, which restores the receivable balance. This separation prevents one refund from both restoring debt and reducing receipt capacity twice.

| Field | Type / nullability | Contract |
|---|---|---|
| `id` | text, required, PK | Immutable adjustment ID. |
| `companyId` | text, required | Must equal receivable company. |
| `branchId` | text, required | Adjustment-owning branch; must be authorized and retains Head Office/branch context. |
| `receivableId` | text, required, FK | Target receivable. |
| `type` | enum above, required | Declares business semantics; no negative amount. |
| `effect` | enum `increase` / `decrease`, required | Must match the type table; `correction` requires an explicit choice and `reversal` derives the exact opposite from its reference. |
| `amountMinor` | integer, required, `> 0` | Same currency as receivable. |
| `status` | enum, required | `pending`, `confirmed`, or `cancelled`; confirmed original and compensating rows affect balances, while referenced originals remain immutable. |
| `effectiveAt` | UTC instant, required | Financial effective time. |
| `reason` | text, required | Human/legal explanation. |
| `sourceDocumentType`, `sourceDocumentId` | text, required | Immutable evidence/source identity; exact legal sufficiency remains subject to D-01 confirmation. |
| `reversesAdjustmentId` | text, nullable, self-FK | Required for reversal. |
| `createdBy` | actor ID, required | User or integration identity. |
| `idempotencyKey` | text, required | Duplicate protection. |
| `createdAt` | UTC instant, required | Server generated. |

## 4. Money and balance contract

All canonical persisted money uses integer minor units. No persisted canonical balance uses floating point.

- RUB `1234.56` is `123456` kopecks.
- APIs accept and return integer fields suffixed `Minor`.
- `currency` is required on every receivable and payment. The initial release accepts only `RUB`, with exponent 2; every other currency is rejected rather than converted.
- User-entered decimal conversion occurs once at the boundary using decimal-string logic, never binary floating-point arithmetic.
- A source amount with more fractional precision than the currency exponent is rejected unless an approved, source-specific rounding rule exists. The rounding rule and pre-rounded source value are audited.
- Cross-currency allocation is forbidden. Currency conversion, if later required, produces separate FX records and receivables; it is not implicit in allocation.

For a non-cancelled receivable:

```text
outstandingBalanceMinor = max(
  0,
  originalAmountMinor
  + confirmedDebitAdjustmentsMinor
  - confirmedCreditAdjustmentsMinor
  - confirmedPaymentAllocationsMinor
  - confirmedWriteOffsMinor
)
```

`confirmedCreditAdjustmentsMinor` includes confirmed `credit`, `discount`, and decreasing `correction` effects. `confirmedDebitAdjustmentsMinor` includes confirmed `debit`, `penalty`, and increasing `correction` effects. Confirmed reversal adjustments apply the exact opposite of the referenced adjustment. `confirmedPaymentAllocationsMinor` is the net of confirmed allocation and linked reversal events.

The following invariants make the outer `max(0, …)` defensive rather than a way to hide errors:

- no confirmed allocation may exceed receivable outstanding;
- no confirmed credit or write-off may exceed receivable outstanding;
- no payment may be allocated beyond its available balance;
- payment, allocation, adjustment, and receivable currency/company must match; the initial release requires all of them to be `RUB`;
- pending payments, allocations, and adjustments have no balance effect;
- allocation reversal events compensate their referenced allocation without mutating it;
- an overpayment remains `unallocatedPaymentBalanceMinor`; it never makes a receivable negative;
- all row-level and aggregate calculations reconcile exactly in minor units.

Refund behavior:

1. refund of an unallocated receipt reduces that receipt's unallocated balance;
2. refund of an allocated receipt first requires allocation reversal, restoring receivable outstanding;
3. a refund never directly changes `originalAmountMinor`;
4. total confirmed refunds cannot exceed the original receipt minus any amount already reversed/refunded under the approved policy.

## 5. Lifecycle contract

### 5.1 Stored and derived states

Stored `status` values represent workflow/legal facts only:

| Stored status | Meaning | Aging eligibility |
|---|---|---|
| `draft` | Not posted; amount/source may still change | Excluded as `otherExcluded` |
| `posted` | Source obligation was posted or financially approved; original amount is frozen | Eligible when date provenance is accepted |
| `disputed` | Posted obligation is under dispute | Included in total outstanding and separate disputed risk; excluded from ordinary overdue KPI |
| `cancelled` | Legally voided through controlled cancellation | Not outstanding; terminal |
| `written_off` | Full outstanding was removed by an approved write-off event | Not outstanding; write-off remains separately reportable |

The following values are derived and are never writable lifecycle states:

- `balanceStatus=open` when a `posted` or `disputed` receivable has positive outstanding and no confirmed payment allocation;
- `balanceStatus=partially_paid` when it has positive outstanding and a positive net confirmed payment-allocation effect;
- `balanceStatus=paid` when a non-cancelled/non-written-off posted obligation has zero outstanding after confirmed allocations and adjustments;
- `agingStatus=overdue` only when positive outstanding is in the ordinary eligible population and the contractual due date has passed; current/unknown and disputed classification are also derived;
- `overdueDays` and aging bucket;
- `writtenOffAmountMinor`, derived from confirmed write-off adjustments.

`open`, `partially_paid`, `paid`, and `overdue` are therefore not stored. A full approved write-off sets stored status `written_off` and `writtenOffAt`; a partial write-off leaves stored status `posted` or `disputed`. A disputed past-due balance remains visible through a separate disputed risk signal but does not enter the ordinary overdue KPI.

### 5.2 Transitions

| From | To | Allowed when / effect |
|---|---|---|
| `draft` | `posted` | Allow-listed source is posted/financially approved and all required fields are valid; freezes source identity, currency, company, branch, client, and original amount. |
| `draft` | `cancelled` | No financial postings; cancellation reason audited. |
| `posted` | `disputed` | Authorized actor and reason. No balance mutation. |
| `disputed` | `posted` | Resolution actor/reason audited. |
| `posted` / `disputed` | `cancelled` | Dedicated cancellation posts a full credit adjustment in the same transaction; allocation handling is resolved first. |
| `posted` / `disputed` | `written_off` | A fully approved write-off reduces outstanding to zero; reason, approval, and event are mandatory. |
| `written_off` | prior `posted` / `disputed` state | Only an approved append-only compensating event that reverses the write-off may restore positive outstanding; prior workflow state and complete audit are required. |

Forbidden transitions/actions:

- posting without a company, branch, client, RUB currency, positive amount, approved source identity/status, company timezone, and idempotency key;
- direct amount/source/company/branch/client/currency edits after posting;
- cancellation that strands confirmed allocations;
- direct restoration of a cancelled or written-off record without a linked compensating event and approved transition;
- physical deletion of any posted receivable or financial event.

Write-off correction is permitted only through an approved append-only compensating event. Direct mutation or deletion of the original write-off is forbidden.

## 6. Due-date contract

`contractualDueDate` is a civil `YYYY-MM-DD` date and may be null. `dueDateProvenance` is mandatory even when the date is null.

| Provenance | Meaning | Aging eligibility |
|---|---|---|
| `invoice_due_date` | Due date printed/posted on the accepted invoice source | Eligible |
| `contractual_payment_due_date` | Explicit due date in an accepted contract/source term | Eligible |
| `installment_due_date` | Due date on an accepted installment schedule; each installment is its own receivable | Eligible |
| `migrated_verified` | Legacy due date verified against immutable evidence | Eligible; evidence ID, verifier, time, and reason required |
| `unknown` | No proven contractual date; retained only so backfill does not invent a date | Not canonical for aging and receives no numeric bucket |

No other value is accepted without a versioned contract change. `expectedPaymentDate`, rental `endDate`, manager forecasts, payment `dueDate`, promise dates, notification dates, and payment-plan dates never populate canonical `contractualDueDate`.

Manual creation/change of a contractual date requires:

- authenticated role `accountant` or `finance_manager` mapped to the backend capability;
- permission `receivables.due_date_override`;
- actor ID;
- UTC timestamp;
- reason;
- previous/new date and provenance;
- source evidence ID;
- request/correlation ID;
- optimistic `version` match.

A due date may be changed after allocations only to correct proven source data, never to improve aging. It requires a second finance-manager approval by an actor other than the requester, plus reason/evidence and an audit event. The change is effective prospectively for current aging, while historical as-of reports use the audit/event history to reproduce the date valid at that time. Silent overwrite is forbidden.

## 7. Aging contract

### 7.1 Eligibility and precedence

Canonical aging uses one deterministic server-side query/transaction snapshot. A receivable enters a numeric bucket only when:

- `outstandingBalanceMinor > 0`;
- stored status is `posted`;
- `contractualDueDate` exists;
- provenance is in the approved aging allow-list;
- `companyTimezone` is a valid IANA zone;
- company/currency/source integrity checks pass.

Classification is mutually exclusive, in this order:

1. disputed positive outstanding → `disputed`;
2. draft or integrity-excluded positive outstanding → `otherExcluded`;
3. missing/unapproved due date or timezone → `ambiguous`;
4. eligible posted receivable → exactly one numeric bucket.

Cancelled/written-off records should have zero outstanding by invariant. A positive balance in either state is an integrity error and is reported under `otherExcluded`, never silently dropped.

### 7.2 Calendar calculation and buckets

The server derives `asOfDate` in the receivable/company IANA timezone. It subtracts civil dates, not milliseconds, so daylight-saving changes do not alter day counts.

```text
overdueDays = civilDayNumber(asOfDate) - civilDayNumber(contractualDueDate)
```

| Bucket | Rule |
|---|---|
| `current` | `overdueDays <= 0` |
| `days1to30` | `1 <= overdueDays <= 30` |
| `days31to60` | `31 <= overdueDays <= 60` |
| `days61to90` | `61 <= overdueDays <= 90` |
| `over90` | `overdueDays >= 91` |

Each `receivableId` appears in zero or one bucket. Duplicate canonical IDs or source identities are integrity failures, not extra rows.

### 7.3 Required output and reconciliation

The aging response returns, per company/branch/currency scope:

- `totalOutstandingMinor` — all positive outstanding before aging exclusions;
- `eligibleOutstandingMinor`;
- `currentMinor`;
- `overdueMinor`;
- `bucket1to30Minor`, `bucket31to60Minor`, `bucket61to90Minor`, `bucketOver90Minor`;
- counts for current and every overdue bucket;
- `ambiguousAmountMinor`, `ambiguousCount`;
- `disputedAmountMinor`, `disputedCount`;
- `otherExcludedAmountMinor`, `otherExcludedCount` and reason breakdown;
- `writtenOffAmountMinor` — confirmed write-offs in the requested reporting window/as-of ledger; a memo metric, not outstanding;
- `integrityErrorCount`;
- `asOfDate`, `timezone`, `currency`, company/branch scope, and calculation version.

Required exact reconciliation:

```text
totalOutstandingMinor =
  currentMinor
  + overdueMinor
  + ambiguousAmountMinor
  + disputedAmountMinor
  + otherExcludedAmountMinor

eligibleOutstandingMinor = currentMinor + overdueMinor

overdueMinor =
  bucket1to30Minor
  + bucket31to60Minor
  + bucket61to90Minor
  + bucketOver90Minor
```

`writtenOffAmountMinor` is outside these equations because a confirmed write-off reduces outstanding.

## 8. Tenant, company, and branch isolation

This is P0. No canonical record can exist without a stable `companyId`.

### 8.1 Required invariants

- `receivable.companyId`, `payment.companyId`, `allocation.companyId`, adjustment `companyId`, and audit `companyId` are non-null.
- receivable, payment, allocation, adjustment, and audit `branchId` values are non-null; allocations additionally preserve non-null `receivableBranchId`.
- `payment.companyId == receivable.companyId` for every allocation.
- `allocation.companyId == payment.companyId == receivable.companyId`.
- adjustment company equals receivable company.
- client, contract, rental, source document, branch, and actor access must belong to the same company.
- `companyId` is immutable. Correcting a wrong company requires reversal/cancellation and recreation; no transfer update exists.
- Every read query starts with an authorized company predicate. ID lookup alone is insufficient and returns 404 (or the project's non-disclosing equivalent) across company boundaries.
- Every unique constraint for business/source identity includes `companyId`.
- API clients cannot elevate scope by sending another company/branch ID; server authorization is checked before lookup and again before write.
- Database foreign keys include company identity, using composite keys or equivalent triggers/checks, so an application bug cannot create cross-company references.

### 8.2 Branch policy

- `branchId` is required for every receivable, payment, allocation, adjustment, and audit event; allocation rows preserve the payment branch in `branchId` and obligation branch in `receivableBranchId`;
- each company has a dedicated Head Office branch for company-wide activity; null is never a company-wide sentinel;
- cross-branch allocations are allowed only within one company and require `allocations.cross_branch` permission;
- every cross-branch allocation and audit event retains both the payment branch and receivable branch so reporting never silently moves cash;
- branch-scoped users see only their allowed branches; company-wide finance roles may aggregate branches but responses still include scope;
- clients may be company-wide, but receivables and payments retain their operational branch.

### 8.3 Permissions

Use backend capabilities, mapped to roles separately:

- `receivables.read`, `receivables.write`, `receivables.cancel`;
- `receivables.post`;
- `receivables.due_date_override`;
- `payments.read`, `payments.write`, `payments.refund`;
- `allocations.write`, `allocations.reverse`;
- `allocations.cross_branch`;
- `adjustments.write`, `adjustments.reverse`;
- `writeoffs.propose`, `writeoffs.approve`;
- `financial_audit.read`;
- `migration.cutover`.

Approved authority baseline:

- accountants may create/post receivables and make ordinary allocations within authorized company/branch scope;
- finance managers may approve refunds and adjustments;
- sensitive due-date changes, write-offs, and large corrections require two distinct approvers;
- migration cutover requires both product-owner and finance-owner approval;
- exact monetary and age thresholds for the elevated path remain pending. Until they are approved, every action in those sensitive categories uses dual approval; code must not invent a threshold.

Admin status alone must not bypass company membership. Carrier, mechanic, bot-only carrier, and investor roles receive no client receivable/payment detail unless an explicit approved capability says otherwise. Existing frontend checks remain UX only.

## 9. Proposed API contract

This section is a future contract; no endpoint changes are made now.

### 9.1 Common conventions

- Base paths use `/api/receivables`, `/api/payments`, `/api/payment-allocations`, and `/api/receivable-adjustments`.
- Money is JSON integer minor units only.
- Civil dates are `YYYY-MM-DD`; instants are RFC 3339 UTC; timezone is an IANA name.
- Write requests require `Idempotency-Key`; the persisted request hash must match on replay.
- Mutable metadata/lifecycle writes require `If-Match` or body `version`.
- List pagination is cursor-based, deterministic by `(createdAt,id)`; default 50, maximum 200.
- Response records contain IDs and current display labels, but joins/grouping use IDs.
- Common error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "ALLOCATION_EXCEEDS_RECEIVABLE_OUTSTANDING",
    "message": "Allocation exceeds receivable outstanding balance.",
    "field": "allocatedAmountMinor",
    "requestId": "req_...",
    "details": {}
  }
}
```

- 400 malformed syntax/date/cursor; 401 unauthenticated; 403 missing permission/scope; 404 absent or non-visible entity; 409 duplicate/idempotency/version/state/capacity conflict; 422 schema/domain validation; 500 unexpected error with no financial partial write.
- Idempotent replay returns the original status/body and `Idempotency-Replayed: true`. Same key with a different request hash returns 409 `IDEMPOTENCY_KEY_REUSED`.

### 9.2 Receivable view schema

Read responses expose persisted fields plus derived fields:

```json
{
  "id": "rec_...",
  "companyId": "co_...",
  "branchId": "br_...",
  "clientId": "client_...",
  "contractId": "contract_...",
  "rentalId": "rental_...",
  "sourceDocumentType": "invoice",
  "sourceDocumentId": "invoice_...",
  "sourceLineId": "line_1",
  "externalId": null,
  "currency": "RUB",
  "originalAmountMinor": 123456,
  "confirmedDebitAdjustmentsMinor": 0,
  "confirmedCreditAdjustmentsMinor": 0,
  "confirmedAllocatedMinor": 20000,
  "confirmedWriteOffMinor": 0,
  "outstandingBalanceMinor": 103456,
  "unallocatedAgainstReceivableMinor": 0,
  "issuedAt": "2026-07-13T09:00:00Z",
  "postedAt": "2026-07-13T09:05:00Z",
  "contractualDueDate": "2026-07-20",
  "dueDateProvenance": "invoice_due_date",
  "companyTimezone": "Europe/Moscow",
  "status": "posted",
  "balanceStatus": "partially_paid",
  "agingStatus": "current",
  "overdueDays": -7,
  "description": "Invoice 42, line 1",
  "createdAt": "2026-07-13T09:00:00Z",
  "updatedAt": "2026-07-13T10:00:00Z",
  "version": 2
}
```

### 9.3 Read endpoints

| Endpoint | Filters / request | Response | Scope and permission | Audit/idempotency/errors |
|---|---|---|---|---|
| `GET /api/receivables` | Required authorized `companyId` context; optional `branchId`, `clientId`, `contractId`, `rentalId`, source IDs, stored status, balance/aging status, currency, due date range, issued range, `cursor`, `limit`, sort allow-list | `{items,nextCursor,hasMore,scope}` of receivable views | `receivables.read`; mandatory company and allowed-branch filters | Read access event only if policy requires; invalid filters 400, inaccessible scope 403/404. |
| `GET /api/receivables/:id` | ID plus authorized scope | One view plus allocations/adjustments links or optional includes | `receivables.read`; lookup includes company/branch predicate | 404 for absent/non-visible. |
| `GET /api/receivables/aging` | `asOfDate`, exactly one currency, optional branch/client/status; no client-supplied timezone override except privileged diagnostic mode | Aging schema below | `receivables.read`; server resolves company timezone and scope | Calculation version/request ID returned; reconciliation failure is 500 and alert, never partial numbers. |
| `GET /api/receivables/summary` | Same company/branch/currency/date filters | Outstanding, allocations, credits, write-offs, unallocated payments, ambiguous/disputed totals and counts | `receivables.read` | Deterministic snapshot metadata returned. |

Canonical aging response:

```json
{
  "asOfDate": "2026-07-13",
  "timezone": "Europe/Moscow",
  "currency": "RUB",
  "companyId": "co_1",
  "branchScope": "all_authorized",
  "calculationVersion": "receivables-aging-v1",
  "totalOutstandingMinor": 0,
  "eligibleOutstandingMinor": 0,
  "currentMinor": 0,
  "overdueMinor": 0,
  "buckets": {
    "days1to30Minor": 0,
    "days31to60Minor": 0,
    "days61to90Minor": 0,
    "over90Minor": 0
  },
  "ambiguousAmountMinor": 0,
  "disputedAmountMinor": 0,
  "otherExcludedAmountMinor": 0,
  "writtenOffAmountMinor": 0,
  "counts": {
    "current": 0,
    "days1to30": 0,
    "days31to60": 0,
    "days61to90": 0,
    "over90": 0,
    "ambiguous": 0,
    "disputed": 0,
    "otherExcluded": 0
  },
  "excludedReasons": [],
  "integrityErrorCount": 0,
  "reconciled": true
}
```

### 9.4 Receivable write endpoints

| Endpoint | Request schema | Response | Permission / validations | Audit / conflicts |
|---|---|---|---|---|
| `POST /api/receivables` | Receivable source/scope/client/currency/amount/date/description fields; optional `status=draft|posted`; manual provenance includes evidence/reason | 201 receivable view; replay returns original | Accountant with `receivables.write`/`receivables.post`; posted source/company/Head Office-or-branch/client/RUB/timezone checks; server sets actor/timestamps | Audit create/post. 409 duplicate source/external/idempotency; 422 invalid amount/date/provenance. |
| `PATCH /api/receivables/:id` | `version`; draft fields, description, dispute status; due-date change object `{contractualDueDate,dueDateProvenance,reason,evidenceId,approvalId?}` | Updated view | Field allow-list; frozen posting fields rejected; accountant/finance-manager due override; post-allocation change requires second manager approval; company/branch never mutable after posting | Before/after/reason/approval audit. 409 version/state; 403 override/scope. |
| `POST /api/receivables/:id/allocations` | `{paymentId,allocatedAmountMinor,allocatedAt?,comment?,version}` | 201 allocation plus updated receivable/payment balances | Accountant with `allocations.write`; cross-branch additionally requires `allocations.cross_branch`; all P0 caps/matches in one transaction | Audit allocation and both branch contexts. 409 capacity/outstanding/currency/company/branch/version/idempotency. |
| `POST /api/receivables/:id/adjustments` | `{type,effect,amountMinor,effectiveAt,reason,sourceDocumentType,sourceDocumentId,version}` | 201 adjustment plus updated view | Finance manager with `adjustments.write`; type/effect mapping enforced; sensitive corrections use dual approval | Audit. 409 excessive decrease/state/idempotency/version/approval. |
| `POST /api/receivables/:id/cancel` | `{version,reason,sourceDocumentType,sourceDocumentId}` | Cancelled view and generated full credit adjustment | `receivables.cancel`; no stranded allocations; atomic | Audit cancellation and adjustment. 409 allocations/state/version. |
| `POST /api/receivables/:id/write-off` | `{version,amountMinor,reason,approvalId,sourceDocumentId}` | Adjustment and updated/written-off view | Dual approval with `writeoffs.approve`; amount <= outstanding; approval must be valid and scoped | Audit proposer/approver. 409 stale approval/version/amount/idempotency. |

### 9.5 Payment, refund, and reversal endpoints

| Endpoint | Request / behavior | Permission | Key conflicts and audit |
|---|---|---|---|
| `POST /api/payments` | Canonical receipt fields; integrations include source/external transaction ID. Pending or confirmed. | `payments.write` | Duplicate external/idempotency 409; amount/currency/date 422; audit receipt/import. |
| `POST /api/payments/:id/refunds` | Positive `refundAmountMinor`, reason, external transaction ID, refund time; allocated amounts require referenced allocation reversals | Finance manager with `payments.refund` | 409 refund exceeds refundable/unallocated capacity or allocations remain; audit refund and immutable links. |
| `POST /api/payments/:id/reverse` | Full reversal reason/source; all allocations must be reversed atomically or beforehand | Elevated `payments.refund`/reversal capability | 409 active allocations/state; audit before/after and relation. |
| `POST /api/payment-allocations/:id/reverse` | Positive full/approved partial reversal, reason, version | `allocations.reverse` | 409 exceeds unreversed amount/idempotency/version; audit both linked rows. |
| `POST /api/receivable-adjustments/:id/reverse` | Amount, reason, approval when needed | `adjustments.reverse`; write-off reversal additionally gated | 409 exceeds unreversed amount/state; audit linked reversal. |

## 10. Idempotency and duplicate prevention

### 10.1 Database constraints

Recommended constraints/indexes include:

```text
UNIQUE receivable source identity:
  (companyId, sourceSystem, sourceDocumentType, sourceDocumentId,
   normalizedSourceLineId)

UNIQUE external receivable identity where externalId is not null:
  (companyId, sourceSystem, externalId)

UNIQUE receipt transaction where externalTransactionId is not null:
  (companyId, sourceSystem, externalTransactionId, kind)

UNIQUE idempotent operation:
  (companyId, operationType, idempotencyKey)
```

`normalizedSourceLineId` is a stored non-null normalized value (for example `__document_total__` for a source with no line) so SQLite null uniqueness cannot admit duplicates. If one source line legally has several installments, each installment must have a distinct deterministic source line/installment key.

Foreign keys and checks enforce positive integer magnitudes, `currency='RUB'` for v1, allowed statuses/types/effects, company equality, mandatory branch context, and valid reversal links. Allocation/payment-cap and receivable-outstanding checks run inside an immediate transaction because they depend on sums, not a static row check.

### 10.2 Request behavior

- Store idempotency key, operation type, canonical request hash, status code, and response body/reference.
- A repeated identical request returns the original result without a second write.
- The same key with different content returns 409.
- Receivable billing/import retries hit both idempotency and source-identity constraints.
- Payment imports hit external transaction and idempotency constraints.
- Allocation retries hit idempotency and are rechecked under the same transaction rules.
- Reversal/refund retries return the original linked reversal/refund.

### 10.3 Source corrections

After posting, do not update source identity or original amount:

- source amount increase → `correction` adjustment with `effect=increase`, referencing the correction document;
- source amount decrease → `correction` adjustment with `effect=decrease`;
- fully void source → controlled cancellation with full credit, subject to allocation rules;
- replacement source → cancel/credit old receivable and create new receivable with its own source identity;
- duplicate imported source with different payload → 409 `SOURCE_DOCUMENT_CONFLICT`, quarantine, and discrepancy report; never silently overwrite.

## 11. Audit trail

Use a dedicated append-only `financial_audit_events` table as the authoritative financial audit. Continue the existing `audit_logs` only as a general operational projection. An optional transactional outbox/domain-event table may publish integration events, but it does not replace the audit record.

Required audit fields:

- `id`, `companyId`, `branchId`;
- `entityType`, `entityId`, `action`;
- `actorId`, actor type (`user`, `integration`, `system`), actor role/capability snapshot;
- UTC `occurredAt`;
- redacted but complete financial `previousValue` and `newValue` in minor units;
- required `reason` for sensitive changes;
- `requestId`, `correlationId`, `idempotencyKey`;
- `sourceSystem`, external event/document IDs;
- approval ID and approver where applicable;
- record version before/after;
- immutable hash/sequence metadata if tamper evidence is required.

Financially sensitive actions that always produce an event:

| Action | Required event detail |
|---|---|
| Receivable created/posted | Source identity, amount, currency, scope, client, due date/provenance |
| Draft amount changed | Previous/new amount, actor, reason if source-driven |
| Due date/provenance changed | Previous/new values, evidence, reason, actor/approver |
| Status/dispute/write-off state changed | Previous/new state and triggering financial event |
| Allocation confirmed/reversed | Payment/receivable IDs, amount, balances before/after, linked reversal |
| Adjustment confirmed/reversed | Type/effect, amount, source, balances, linked reversal |
| Write-off proposed/approved/posted/reversed | Proposer, approver, approval, reason, amount |
| Cancellation | Source evidence, generated credit, allocation resolution |
| Refund/payment reversal | Original payment, allocation reversals, refundable balance |
| Branch changed | Draft-only change, previous/new branch and reason |
| Company change attempted | Rejected event; company mutation is forbidden |

Posted receivables and confirmed financial events are never physically deleted; corrections are append-only compensating events. Financial audit events themselves are append-only and never deleted. Exact retention duration, export, legal-hold, and tamper-evidence requirements remain subject to accountant/legal confirmation. Until confirmed, the safe baseline is indefinite no-delete retention; no implementation may invent a purge period.

## 12. Backfill and migration strategy

### Phase 0 — observation

- take a SQLite online backup and export hashes/counts before any migration;
- snapshot collection counts and aggregate sums without personal-data logs;
- inventory duplicate record IDs/source candidates, missing company/branch/client/currency, invalid money, missing receipt dates, ignored statuses, physical-orphan links, and ambiguous due dates;
- measure rental billing versus document amounts and payments versus allocations;
- define deterministic company/Head Office-or-branch/RUB mappings; unresolved scope blocks canonical import;
- run read-only reports repeatedly in production-like data; no behavior changes.

### Phase 1 — schema deployment

- add canonical normalized tables, constraints, audit table, idempotency table, and indexes;
- deploy behind disabled feature flags;
- do not switch reads or mutate legacy collections;
- verify backup/restore and schema downgrade behavior.

### Phase 2 — backfill

- process deterministic batches (recommended starting batch size 500, tunable from measured lock/latency data);
- persist migration cursor/checkpoint and source hashes so interruption/resume is idempotent;
- create receivables only when company, mandatory branch, RUB currency, client, stable posted/approved allow-listed source identity, and amount are deterministic;
- where source identity/amount is acceptable but due date is unproven, use `dueDateProvenance=unknown`; never use expected payment or rental end date;
- do not create a canonical receivable from rental-derived amount alone; retain it only in comparison/discrepancy output until an approved source obligation is proven;
- migrate a payment as a confirmed receipt only when amount, actual receipt date, status, company, branch, client, and RUB currency are proven; otherwise quarantine/pending-review;
- backfill allocations only when payment, target receivable, company, both branch contexts, RUB currency, client, amount, and aggregate caps reconcile exactly;
- unresolved payments remain unallocated; unresolved obligation amounts remain ambiguous;
- never infer a link from an editable client name except a logged, one-candidate recovery workflow approved for that batch.

### Phase 3 — shadow reconciliation

- compute old and new totals without changing user-visible reads;
- compare source billing to receivables, per-client/company/branch totals, payment capacities, allocations, and outstanding;
- produce machine-readable discrepancies with reason codes;
- Company Health continues using the released guarded behavior;
- do not progress while any P0 invariant error exists.

### Phase 4 — dual write

- write legacy and canonical models through one orchestrated transaction/outbox strategy;
- use source identities/idempotency to make retries safe;
- alert when one side fails or reconciliation changes;
- legacy remains the user-visible read; canonical reads remain shadow-only.

### Phase 5 — read switch

- expose canonical read endpoints and switch Finance/Risks behind separate feature flags;
- start with internal/admin shadow comparison, then a limited company/branch cohort;
- retain immediate flag rollback to legacy/guarded reads;
- no cutover for a currency/scope with unresolved P0 discrepancies.

### Phase 6 — retirement

- stop legacy writes only after an agreed monitoring window and signed reconciliation;
- keep legacy data read-only indefinitely until the exact accountant/legal retention period is approved;
- remove old calculations in later isolated PRs, never in the schema/backfill PR.

### Backup, rollback, monitoring, and acceptance

- Backup: SQLite online backup plus checksum, tested restore, and protected copy before schema and each production backfill run.
- Rollback: disable canonical read/write flags, stop worker, restore legacy-only writes, retain new tables for diagnosis; never delete canonical rows to roll back a read switch.
- Migration idempotency: source identity + migration run ID + checkpoint + input hash; rerun produces zero new duplicates.
- Monitoring: duplicate/conflict count, orphan/cross-scope attempts, allocation-cap conflicts, reconciliation delta, ambiguous amount, backfill rate/errors, DB lock latency, dual-write divergence, aging integrity errors.
- Mandatory zero-tolerance gates: cross-company references, currency mismatches, duplicate canonical source identities, negative/overflow balances, minor-unit reconciliation failures, unauthorized access, and unexplained canonical-row discrepancies.
- Cutover requires zero unexplained monetary discrepancy. Every monetary difference must be explained and approved without leaving a nonzero unexplained minor-unit delta. Record-count differences are allowed only when fully classified. Any cross-company leak or unresolved duplicate blocks cutover.

## 13. Reconciliation rules and reports

Mandatory reports, filterable by migration run, company, branch, currency, and as-of date:

1. source rental/document billing versus receivable original amounts and adjustments;
2. confirmed payments versus confirmed allocations, refunds, and unallocated balance;
3. unallocated payment balance by payment/client;
4. receivable original/debit/credit/write-off/allocation/outstanding detail;
5. per-client totals using `clientId`;
6. per-company totals;
7. per-branch totals including the dedicated Head Office branch separately;
8. ambiguous due-date amount/count and reason;
9. disputed and other-excluded amount/count;
10. cancelled/deleted legacy source records and their canonical effect;
11. duplicate IDs/source identities/external transaction IDs/idempotency keys;
12. missing/orphan client, contract, rental, document, payment, and allocation references;
13. company/branch/currency mismatches;
14. due-date provenance/evidence coverage;
15. write-off/refund/reversal chains and approval completeness.

Because reductions are capped before zero, the exact aggregate invariant is:

```text
sum(originalAmountMinor)
+ sum(confirmed debit, penalty, and increasing-correction effects)
- sum(confirmed credit, discount, and decreasing-correction effects)
- sum(confirmed write-off effects)
- sum(confirmed payment allocations net of reversal events)
= sum(outstandingBalanceMinor)
```

Run the invariant for each currency independently and for every company, branch, client, source document, and whole migration batch. Never sum different currencies into a money total.

Additional payment invariant:

```text
sum(confirmed receipt amounts)
- sum(confirmed refunds and payment-reversal events)
- sum(confirmed allocations net of reversal events)
= sum(unallocated payment balances)
```

## 14. Test plan

No tests are implemented in this specification phase. Required future coverage:

### Domain

- one partial payment;
- several payments settling one receivable;
- one payment allocated across several receivables;
- attempted allocation beyond payment capacity and receivable outstanding;
- overpayment retained as unallocated balance;
- debit, credit, discount, penalty, and increasing/decreasing correction effects;
- partial and full write-off;
- refund of unallocated receipt;
- refund of allocated receipt requiring allocation reversal;
- payment, allocation, and adjustment reversal; repeated/partial reversal bounds;
- cancellation with and without allocations;
- disputed receivable classification;
- missing due date;
- due-date change before/after allocation with complete audit;
- written-off receivable restored only by an approved linked compensating event;
- source correction and cancel/reissue.

### Money

- integer minor-unit persistence and API rejection of floats;
- RUB conversion examples and unsupported precision;
- no floating-point drift across thousands of rows;
- currency mismatch rejection;
- configured rounding rules and audit;
- integer overflow/bounds checks;
- exact per-currency reconciliation.

### Aging

- current day and exact 1/30/31/60/61/90/91 boundaries;
- future due dates;
- IANA timezone midnight and DST transitions;
- mutually exclusive IDs/counts/amounts;
- total/eligible/overdue reconciliation;
- unknown/unapproved provenance exclusion;
- disputed/other-excluded precedence;
- duplicate source/ID integrity failure;
- historical as-of behavior after due-date correction.

### Idempotency

- duplicate receivable import and conflicting payload;
- duplicate payment import/external transaction;
- duplicate allocation request;
- repeated refund/payment/allocation/adjustment reversal;
- interrupted request after commit with replay;
- same idempotency key with different request hash.

### Security

- cross-company list/detail/write denied and non-disclosing;
- cross-company foreign keys rejected at DB layer;
- approved and denied cross-branch cases;
- Head Office branch behavior and mandatory non-null branch validation;
- unauthorized read/write/write-off/due-date override/refund;
- tenant predicate applied to every query, include, summary, and aging endpoint;
- unknown role denied by default;
- carrier/bot-only users cannot access financial data.

### Migration

- repeatable backfill with zero duplicates;
- interruption and checkpoint resume;
- changed source hash quarantine;
- duplicate/orphan/missing-scope detection;
- exact discrepancy reports;
- unknown due-date preservation;
- backup restore and feature-flag rollback;
- batch transaction failure leaves no partial batch.

### API and audit

- schema validation, cursor pagination, filter allow-lists;
- integer money/date/timezone formats;
- 403/404 scope behavior, 409 conflict codes, 422 validation;
- optimistic version conflicts;
- idempotency replay headers/body;
- every sensitive action creates complete actor/before/after/reason/request/source audit;
- audit retention/export/tamper controls once approved.

## 15. Decision baseline and remaining confirmations

The product owner approved D-01 through D-27 on 2026-07-13. The authoritative answers are recorded in `docs/canonical-receivables-decisions.md`; this contract incorporates their structural and behavioral consequences.

Remaining conditional items are narrow and must not be filled by implementation assumptions:

| Item | Approved baseline | Still required | Blocks |
|---|---|---|---|
| D-01 source sufficiency | Only posted/financially approved allow-listed obligations create receivables; a rental alone never does | Accountant/legal confirmation of exact source document types | PR5 production dual-write enablement and PR8 cutover; PR1 may model a configurable allow-list |
| D-24 retention | Financial audit is append-only and never deleted | Accountant/legal retention duration, legal hold, export, and evidence policy | Data retirement/purge and PR8 unless an approved indefinite no-delete policy is signed |
| D-25 approval limits | Named authority roles and dual approval for sensitive actions are approved | Exact amount/age thresholds for large corrections, sensitive due-date changes, refunds, adjustments, and write-offs | PR2 and PR6 policy completion; PR8 cutover |

### 15.1 Implementation gate summary

| Gate | Outcome | Remaining condition |
|---|---|---|
| PR1 canonical schema/domain | **PASS — unblocked** | Do not hardcode unconfirmed source types or enable production posting |
| PR2 payments/allocations/adjustments | **BLOCKED** | D-25 numerical limits, or explicit approval to apply dual approval to every sensitive action |
| PR3 read API/aging | **Decision PASS; sequence blocked** | Complete PR1–PR2 |
| PR4 backfill/reconciliation tooling | **Decision PASS for no-delete tooling; sequence blocked** | Complete PR1–PR3 and configure company/branch/RUB mappings; finite retention remains unresolved |
| PR5 dual write | **BLOCKED for enablement** | D-01 source-type confirmation, upstream PRs, and PR6 authorization |
| PR6 tenant/RBAC | **BLOCKED** | D-25 limits plus concrete company, branch, Head Office, user, and capability mappings |
| PR7 Company Health shadow read | **Decision PASS; sequence blocked** | Complete PR3–PR6 |
| PR8 production read cutover | **BLOCKED** | D-01, D-24, D-25 conditions plus signed zero-delta reconciliation and operational cutover evidence |

No gate outcome authorizes product code in this documentation task.

## 16. Recommended implementation PR sequence

| PR | Scope | Risk | Dependencies | Migration impact | Rollback | Required tests |
|---|---|---|---|---|---|---|
| 1. Canonical receivable schema/domain | Normalized receivable, company/mandatory branch/RUB/source identity, approved lifecycle, financial audit/idempotency foundations; no read switch | High: foundational identity/scope | **Gate PASS**; configurable allow-list only until D-01 external confirmation | Add-only schema, empty tables | Disable feature flag; retain unused tables | Schema checks, lifecycle, source uniqueness, tenant FK, integer money, audit |
| 2. Payment allocation and adjustment model | Canonical payment/refund, allocation, typed adjustment, append-only reversal, atomic balance service | P0 financial correctness/concurrency | PR1; **blocked on D-25 limits or approved always-dual rule** | Add-only tables/services; no legacy mutation | Disable canonical writes; no data deletion | Partial/multi-allocation, caps, types/effects, write-offs/refunds/reversals, concurrency/idempotency |
| 3. Read-only receivable and aging API | List/detail/summary/aging with scope, currency, timezone, reconciliation | High reporting/security | PR1–2 | No backfill required for empty result | Disable routes/flag | API validation/pagination/RBAC, bucket/timezone/reconciliation/security |
| 4. Backfill and reconciliation tooling | Read-only audit, backup checks, deterministic backfill, checkpointing, discrepancy reports | High data safety | PR1–3; company/Head Office-or-branch/RUB/source mappings | Writes canonical tables in controlled batches | Stop job; restore backup if schema/data corruption; otherwise rerun idempotently | Repeat/resume, duplicate/orphan, unknown dates, reports, rollback |
| 5. Dual-write rental/payment integration | Approved source posts receivables; receipts/allocations update both legacy and canonical paths | Very high divergence risk | PR4 reconciliation; D-01 source-type confirmation; PR6 before enablement | Starts new canonical production writes | Feature flag to legacy-only; outbox replay/reconcile | Transaction failure/retry, idempotency, source correction, legacy/canonical equivalence |
| 6. Company/branch isolation and RBAC enforcement | Capability mapping, permitted same-company cross-branch flow, DB/API cross-scope defenses | P0 security | PR1–5; D-25 limits and concrete membership mappings | Scope backfill must be complete | Disable canonical access; retain legacy backend rules | Cross-company/branch endpoint and DB tests, unknown roles, carrier/bot denial |
| 7. Company Health shadow-read integration | Consume canonical aging in shadow, compare guarded current result; no visible score switch | Medium/high metric trust | PR3–6; approved provenance allow-list | Read-only | Disable shadow flag | Mapping, ambiguous/empty/positive debt, metric reconciliation, deterministic verification |
| 8. Feature-flagged production read switch | Finance then Risks canonical read rollout, monitoring and rollback runbook | High user-visible correctness | D-01/D-24/D-25 conditions, signed zero-unexplained-delta reconciliation, PR7 | Switch reads only | Immediate flags back to legacy/guarded behavior | Production smoke, cohort scope, performance, empty/positive/ambiguous scenarios, rollback drill |

Old logic retirement is a later PR only after a signed monitoring period; it should not be bundled into PR8.

PR5 may merge code behind a disabled flag, but canonical production dual-write must not be enabled until PR6's company/branch authorization and database defenses pass. Tenant columns and same-company foreign-key foundations already belong in PR1; PR6 completes the end-to-end access policy.

## 17. Risk register

| Priority | Risk | Consequence | Required mitigation / gate |
|---|---|---|---|
| P0 | No current company/branch keys | Cross-tenant financial disclosure or settlement | Mandatory scope backfill, DB constraints, endpoint predicates, security tests before any canonical read/write |
| P0 | Wrong source document creates receivable | Legally false debt | Owner-approved source/status contract; immutable source identity; quarantine conflicts |
| P0 | Unproven due dates enter aging | False overdue/current reporting and Company Health score | Provenance allow-list; unknown exclusion; evidence/audit; no rental/payment-date fallback |
| P0 | Allocation race/over-allocation | Incorrect outstanding and client balance | One transaction, capacity/outstanding locks/checks, idempotency, concurrency tests |
| P0 | Floating-point migration | Non-reconciling balances | Decimal-string conversion, integer minor units, precision quarantine, exact reports |
| P0 | Duplicate source/import events | Double debt or receipt | Company-scoped source/external/idempotency unique constraints and conflict quarantine |
| P0 | Refund/reversal double effect | Debt restored or cash reduced twice | Explicit event relationships and ordered allocation reversal/refund rules |
| P1 | Rental-derived amount later changes | Canonical amount drifts from source | Freeze posted amount; adjustments/cancel-reissue only; source version/hash |
| P1 | Physical deletion of legacy evidence | Backfill/reconciliation cannot be reproduced | Backup/export, deletion report, canonical no-delete rules, retention decision |
| P1 | Existing audit truncation/redaction | Incomplete financial history | Dedicated append-only financial audit with retention/tamper policy |
| P1 | Dispute/write-off semantics differ by team | Metrics and collection workflow disagree | Owner-approved classification and approval matrix; separate financial/workflow states |
| P1 | No receipt date for legacy payments | False cash period and allocation timing | Quarantine/unconfirmed migration; do not infer `paidDate` from `dueDate` |
| P1 | Legacy name fallbacks mislink clients | History assigned to wrong client | Stable ID only; guarded one-candidate recovery with ambiguity log |
| P2 | Large JSON dual-write contention | Latency/divergence | Normalized tables, outbox/orchestrator, measured batches and monitoring |
| P2 | Currency expansion without FX model | Invalid cross-currency totals | Per-currency reports, allocation match, FX explicitly disabled until designed |

## 18. Explicit non-goals

This specification does not:

- implement a database migration, table, route, helper, test, or UI;
- change existing payment, allocation, rental, document, finance, Company Health, Risks, or aging behavior;
- declare current rental billing to be a legal invoice;
- promote `expectedPaymentDate`, rental `endDate`, payment `dueDate`, or collection promises to contractual dates;
- supply the still-unconfirmed source document types, retention duration, or financial approval thresholds;
- design general ledger accounting, tax accounting, bank reconciliation, revenue recognition, accounts payable, payroll, or leasing payable changes;
- design foreign-exchange conversion;
- create a client-credit wallet beyond reporting unallocated payment balance;
- replace debt-collection/legal workflow records;
- backfill or normalize production data;
- create a pull request or release plan beyond the proposed PR sequence.

Until the canonical tables, scope, source, date provenance, reconciliation, and cutover gates are implemented and approved, Company Health must continue its released behavior: unknown contractual dates remain outside numeric aging.
