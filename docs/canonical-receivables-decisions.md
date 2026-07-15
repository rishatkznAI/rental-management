# Canonical receivables: product-owner decision memo

**Status:** product-owner baseline approved; PR1 schema/domain foundation **RELEASED**; PR2 settlement/domain foundation **RELEASED**; PR3 read API/aging infrastructure **RELEASED**; conditional confirmations remain

**Prepared:** 2026-07-13; release status updated 2026-07-15

**Source specification:** `docs/canonical-receivables-contract.md`

**Scope:** approved product-owner rules plus factual PR1/PR2/PR3 implementation metadata; this memo does not change business decisions

## Product-owner baseline

**Decision date:** 2026-07-13

**Approved decisions:** D-01 through D-27. The product owner approved every decision in this memo as recorded in the Owner answer column and detailed answer fields.

**Conditional approvals:** D-01 is approved subject to accountant and legal confirmation of the exact allow-listed source document types that are sufficient to create debt. D-24 is approved subject to accountant and legal confirmation of the exact retention duration and related legal-hold/export requirements. D-25's mandatory dual-approval policy for sensitive initial-release operations is approved for PR2; exact monetary and age thresholds are deferred.

**Deferred numerical limits:** amount and age thresholds remain intentionally undefined. The approved initial-release policy below applies mandatory dual approval to every sensitive operation instead of using unapproved thresholds. A future threshold policy requires a separate product-owner decision and may not weaken auditability or separation of duties.

**No silent assumptions:** implementation may encode only the answers in this baseline. Missing legal document types, retention durations, financial thresholds, tie-break policy extensions, or role powers must remain disabled, configuration-blocked, or explicitly escalated.

**Current status summary:** the canonical ledger baseline is approved; the PR1 schema foundation, PR2 settlement foundation, and PR3 default-disabled read-only infrastructure are released; and all eight canonical tables remain empty. The production ledger remains inactive, with canonical reads disabled and existing systems continuing to serve production reads and writes. Production settlement remains blocked by PR6 authorization enforcement and the later reconciliation and cutover gates.

## PR1 release status

**PR1: RELEASED.** The schema/domain foundation merged as commit `ae9d8a8a286307f5d6e701585750af94d631edc1` and was deployed and verified in production. It uses migration identifier `canonical_receivables_pr1_schema` version 1. The migration follows the existing idempotent initializer and `sql_shadow_schema_migrations` registry convention; production contains exactly one registration, and repeated startup skipped the initializer without re-executing the canonical DDL.

The migration adds empty `canonical_companies`, `canonical_branches`, `canonical_receivables`, and `financial_audit_events` tables. Company rows require an IANA receivables timezone, while receivables retain the immutable posting-time timezone snapshot. Company and branch are mandatory on receivable/audit rows, with composite same-company branch foreign keys and no seeded tenant. The receivable table enforces RUB integer minor units, approved provenance/workflow values, normalized source-line uniqueness, company-scoped source/idempotency/external identities, and exact posted-field immutability for the approved source/scope/money/timezone fields. The audit table is append-only for ordinary application SQL through no-update/no-delete/no-replace SQLite triggers; physical DBA tampering remains outside the PR1 application guarantee.

Repository and populated-snapshot review found no existing company/branch tables, stable tenant IDs, user memberships, or auth tenant context. The two scope tables are therefore empty foreign-key placeholders, not a second operational directory: PR1 exposes no application read/write surface for them. Before production posting, PR6 must approve the single company/branch authority, map stable IDs and user/Head Office memberships, and either adopt these roots as that authority or rebuild the still-empty canonical foreign keys against the approved master. Independent synchronization of two editable identity models is forbidden. PR1 establishes same-company schema relationships only and does not claim active-tenant or RBAC enforcement.

Because clients, contracts, rentals, and users remain JSON records, PR1 does not claim database referential integrity for `clientId`, `contractId`, `rentalId`, or audit `actorId`. Their stable identity and company ownership must be validated by the future approved scope/migration path.

Pure domain helpers implement creation validation, due-date provenance, aging eligibility, explicit PR1 workflow transitions, posted immutability, deterministic source/idempotency identities, and the limited pre-allocation balance/derived-state contract. Posted validation accepts no built-in source type: an injected approved-source policy is mandatory, and no production caller is wired.

No receivable API, posting repository, backfill, seed, dual write, payment/allocation/adjustment behavior, production read switch, Company Health import, frontend change, retention deletion, D-25 threshold, or RBAC expansion is included. PR1 is released but not cut over: production posting remains disabled and production reads remain unchanged. The PR2 decision gate is now PASS for domain implementation; later sequence, authorization, enablement, and cutover gates remain as recorded below.

### Verified production state

| Evidence | Verified value |
|---|---:|
| PR1 merge commit | `ae9d8a8a286307f5d6e701585750af94d631edc1` |
| Migration | `canonical_receivables_pr1_schema`, version `1` |
| Migration registration count | `1` |
| Repeated initializer | Skipped |
| `PRAGMA foreign_keys = 1` | Confirmed |
| `PRAGMA foreign_key_check = 0` | Confirmed |
| `canonical_companies` | `0` rows |
| `canonical_branches` | `0` rows |
| `canonical_receivables` | `0` rows |
| `financial_audit_events` | `0` rows |

The additive release changed no legacy table schema or application data and introduced no production canonical receivable read or write path. The four canonical tables remain empty infrastructure.

### Deferred production scope

PR1 enables no receivable posting, allocations, adjustments, refunds, reversals, write-offs, backfill, dual write, API, tenant/RBAC implementation, Company Health read switch, or production cutover.

The repository does not support down migrations. PR1 rollback therefore reverts the code while retaining the unused empty tables. Physical table removal is permitted only offline before any canonical data exists, after a verified SQLite backup and explicit empty-table check; canonical data must never be dropped as a rollback strategy.

## PR2 release status

**PR2: RELEASED — settlement/domain foundation only.** The additive settlement/domain foundation merged as commit `ee2c1b6e1340acb3fc3149c6a39487a283db829c`, was deployed, and was verified in production. It uses migration `canonical_receivables_pr2_settlement`, version 1, through the existing `sql_shadow_schema_migrations` startup convention. It requires registered and structurally present PR1 version 1 before any PR2 DDL, and adds only `canonical_payments`, `canonical_payment_allocations`, `canonical_receivable_adjustments`, and `canonical_approval_requests`. The migration is additive, atomic, and idempotent and contains no seed, backfill, legacy trigger, or dual write.

The existing JSON payment/allocation collections are not referenced because they do not provide mandatory company/branch/currency identity, integer-minor-unit receipt semantics, immutable reversal history, or canonical receivable targets. PR2 instead supplies an isolated canonical payment and settlement foundation.

The implementation covers partial and multi-allocation balances, unapplied receipt capacity, typed positive-magnitude adjustment effects, refunds, payment/allocation/adjustment reversals, write-offs, due-date-change approval, cancellation protection, shared approval requests, separation of duties, company-scoped idempotency, append-only audit events, and SQLite immediate-transaction/version concurrency guards. Pending or rejected events never affect balances; confirmed reversals compensate originals without editing or deleting them.

The approved temporary D-25 domain policy is implemented in PR2 infrastructure without monetary or age thresholds. Exact-reference or explicit-client-instruction allocation may be approval-exempt only in the same company, currency, and branch and within both balances. Ambiguous and cross-branch allocation is represented as approval-required. Refunds, adjustments, reversals, write-offs, post-allocation due-date changes, and posted cancellation require a distinct approver. Concrete user membership, role, capability, finance-owner/commercial-owner mapping, and approval enforcement remain PR6 work; production use remains blocked until PR6 is implemented and verified.

Only the schema initializer is reachable from startup. The settlement mutation repository remains unreachable from production flows: no production route, worker, legacy payment/rental handler, frontend module, Company Health/report reader, backfill, or dual-write path imports it. The PR3 read side reuses only pure PR2 balance-domain helpers. No settlement operation, production canonical read switch, or cutover is enabled; later authorization, migration, reconciliation, integration, and cutover gates remain in force.

### PR2 verified production state

| Evidence | Verified value |
|---|---:|
| PR2 merge commit | `ee2c1b6e1340acb3fc3149c6a39487a283db829c` |
| Migration | `canonical_receivables_pr2_settlement`, version `1` |
| Migration order | `canonical_receivables_pr1_schema` v1, then `canonical_receivables_pr2_settlement` v1 |
| PR1 registration count | `1` |
| PR2 registration count | `1` |
| Repeated initializers | Both skipped |
| `PRAGMA foreign_keys = 1` | Confirmed |
| `PRAGMA foreign_key_check = 0` | Confirmed |
| `canonical_companies` | `0` rows |
| `canonical_branches` | `0` rows |
| `canonical_receivables` | `0` rows |
| `financial_audit_events` | `0` rows |
| `canonical_payments` | `0` rows |
| `canonical_payment_allocations` | `0` rows |
| `canonical_receivable_adjustments` | `0` rows |
| `canonical_approval_requests` | `0` rows |

Production verification found no legacy schema or application-data change, seed, or backfill. It also confirmed that no production canonical settlement read or write path exists.

## PR3 release status

**PR3: RELEASED — read-only canonical receivables API and aging infrastructure only.** The isolated query side implements `GET /api/receivables`, `GET /api/receivables/:id`, `GET /api/receivables/summary`, and `GET /api/receivables/aging` exclusively over the eight canonical PR1/PR2 tables. It adds no migration, seed, backfill, legacy fallback, settlement write, frontend change, Finance switch, Company Health/Risks switch, or production read cutover.

`CANONICAL_RECEIVABLES_READ_API_ENABLED` defaults to disabled. Even when route registration is enabled, the production trusted-scope resolver remains deliberately fail-closed until PR6 supplies real authenticated company membership, allowed-branch or company-wide authority, and `receivables.read` capability mappings. The read HTTP path receives only a read-only repository surface; the settlement mutation repository is not exposed.

The implementation uses `receivables-aging-v1`, server-side company IANA civil dates, reconciled append-only historical due-date evidence, confirmed effective settlement events, bounded snapshot batches, a mandatory strong cursor-signing secret, and exact outstanding/eligible/overdue reconciliation. Empty canonical tables return canonical empty/zero results only for an explicitly injected trusted test scope; legacy debt never fills the result. Production behavior remains unchanged because the feature flag is disabled and production scope mappings do not exist.

Production release evidence is: implementation PR [#205](https://github.com/rishatkznAI/rental-management/pull/205), head `a4f46760c75d11989c74225f23891418cdb62de2`, merge `6a38582f5f90b85734884b6b12ad8e306b24619e`; Railway deployment `b74623ec-d20d-4c50-ab40-0e0a494c5bc5`; smoke correction PR [#206](https://github.com/rishatkznAI/rental-management/pull/206), merge `7fed3e49ca77bc3c9db2c587a6cdc06f579a3196`, and successful merged-main Staging Smoke [run 29399559743](https://github.com/rishatkznAI/rental-management/actions/runs/29399559743); release-tooling PR [#207](https://github.com/rishatkznAI/rental-management/pull/207), merge `e5e516da92216830be42ef25fa0e5ca6681379e4`, and successful Pages/post-deploy [run 29402545157](https://github.com/rishatkznAI/rental-management/actions/runs/29402545157). The production frontend marker is `e5e516da92216830be42ef25fa0e5ca6681379e4` with release type `deploy-tooling`; the backend remains `6a38582f5f90b85734884b6b12ad8e306b24619e` under the explicitly allowed deploy-tooling drift contract. Dashboard/Company Health [run 29403203787](https://github.com/rishatkznAI/rental-management/actions/runs/29403203787) and Finance [run 29403203743](https://github.com/rishatkznAI/rental-management/actions/runs/29403203743) both succeeded.

Production safety verification found `CANONICAL_RECEIVABLES_READ_API_ENABLED` absent/default-disabled, `/api/receivables` returning `404`, and the trusted canonical scope unmapped/fail-closed. All eight canonical tables contain `0` rows. Only `canonical_receivables_pr1_schema` v1 and `canonical_receivables_pr2_settlement` v1 are registered; `PRAGMA foreign_key_check` returned `0` violations. No seed, backfill, dual write, canonical write, settlement API, Finance switch, Company Health/Risks switch, legacy business-data mutation, or verification-created financial record exists.

`RELEASED` covers only the isolated canonical read layer, the four GET endpoints, `receivables-aging-v1`, and default-disabled infrastructure. It does not mean production API enablement, a canonical read switch, Finance or Company Health/Risks adoption, settlement, write capability, backfill, dual write, cutover, or PR6 completion. Rollback is flag disablement or code revert with no data rollback.

Gate summary: PR1 — **RELEASED**; PR2 — **RELEASED**; PR3 — **RELEASED, read-only infrastructure only**; PR4 — **BLOCKED pending a separately approved backfill/reconciliation strategy and mappings**; PR5 — **BLOCKED**; PR6 — **BLOCKED**; PR7 — **SEQUENCE BLOCKED**; PR8 — **BLOCKED**. PR4 was not started by this release-marker change.

## How to use this memo

Every decision now has a recorded product-owner answer. Conditional approvals are usable only within their stated boundary; unresolved external confirmations and limits remain implementation gates where listed below. Approval identity may be linked in the approval record when the durable business record is available.

Labels used below:

- **Recommended default:** preferred for correct money, duplicate prevention, auditability, multi-company safety, operational simplicity, reversible migration, and future accounting integration.
- **Acceptable alternative:** supportable, but with stated tradeoffs.
- **Dangerous option:** likely to create ambiguous debt, unsafe access, irreconcilable money, or destructive history.
- **Accountant confirmation required:** accounting treatment or control must be confirmed by the company's accountant.
- **Legal confirmation required:** contractual validity, evidence, retention, or legal effect must be confirmed by the company's lawyer.

No recommendation in this memo is a legal or accounting conclusion.

## Decision summary

| ID | Decision | Recommendation | Owner answer | Status | Blocks PR |
|---|---|---|---|---|---|
| D-01 | What creates a receivable? | Only a posted/approved, allow-listed source-obligation line; a rental alone is insufficient | Approved; exact sufficient document types require accountant/legal confirmation | approved subject to accountant/legal confirmation | PR 1 baseline PASS; PR 5 enablement pending confirmation |
| D-02 | One receivable or installments? | One receivable per contractual due date; no installment table initially | Approved as recommended | approved | PR 1 |
| D-03 | When does rental debt become active? | On posting/approval of the accepted source event; due/overdue remain derived | Approved as recommended | approved | PR 1, PR 5 |
| D-04 | Accepted due-date sources | Allow proven invoice, contract, installment, and verified-migration dates; reject forecasts/rental end dates | Approved with the four named canonical provenance values | approved | PR 1, PR 3, PR 7 |
| D-05 | Who may create/change due dates? | Capability-based finance authority, reason/evidence/audit, elevated post-allocation approval | Approved for accountant/finance-manager roles and additional manager approval after allocation | approved | PR 3, PR 6 |
| D-06 | Is `companyId` mandatory? | Yes, on every financial record; no cross-company references | Approved as recommended | approved | PR 1, PR 6 |
| D-07 | Is `branchId` mandatory? | Mandatory; use a dedicated Head Office branch instead of null | Mandatory; use a dedicated Head Office branch instead of null | approved | PR 1, PR 6 |
| D-08 | Can payments cross branches? | Same company only, explicit permission, preserved branch identities and visible reporting | Allowed only within one company with explicit permission and both branch contexts | approved | PR 2, PR 6 |
| D-09 | Can one payment settle many receivables? | Yes, only through explicit allocations | Approved as recommended | approved | PR 2 |
| D-10 | Can one receivable use many payments? | Yes; partial/paid status derived from confirmed allocations | Approved as recommended | approved | PR 2 |
| D-11 | How are overpayments handled? | Keep as unapplied client/payment balance until explicit allocation or refund | Approved as recommended | approved | PR 2 |
| D-12 | How are refunds handled? | Append-only linked refund event; reverse affected allocations before restoring debt | Approved; original payment/allocation is never edited or deleted | approved | PR 2 |
| D-13 | How are reversals/corrections handled? | Append-only compensating records referencing originals | Approved as recommended | approved | PR 2 |
| D-14 | How are credits/debits handled? | Positive magnitude plus explicit effect type; no signed-value inference | Approved types: credit, debit, discount, penalty, correction | approved | PR 2 |
| D-15 | How are write-offs handled? | Approved append-only adjustment, permanently reportable; correction only by compensating event | Approved; reason and approval required | approved | PR 2 |
| D-16 | How are disputes handled? | Keep in total outstanding, report separately, exclude from ordinary overdue KPI pending policy | Approved as recommended; keep a separate risk signal | approved | PR 2, PR 3, PR 7 |
| D-17 | Stored vs derived lifecycle states | Store legal/workflow state; derive partial, paid, overdue, and balance | Store draft/posted/disputed/cancelled/written_off; derive open/partially_paid/paid/overdue | approved | PR 1 |
| D-18 | Can posted original amount change? | No; draft editable, posted amount corrected by adjustments or cancel/reissue | Approved as recommended | approved | PR 1 |
| D-19 | Company timezone | Company-configured IANA zone; initially propose `Europe/Moscow`; never browser-local | Approved; current company starts with Europe/Moscow | approved | PR 1, PR 3, PR 7 |
| D-20 | Currency behavior | Currency required, RUB-only first release, exact allocation match, no automatic FX | Approved as recommended | approved | PR 1, PR 2, PR 3 |
| D-21 | Automatic allocation policy | Exact reference, then documented instruction, then oldest confirmed debt; otherwise unapplied | Approved in the stated priority | approved | PR 2, PR 5 |
| D-22 | Which records may be backfilled? | Import only deterministic facts; unknown dates stay unknown; uncertain allocations stay unapplied | Approved; stable source identity is mandatory | approved | PR 4 |
| D-23 | Cutover discrepancy threshold | Zero unexplained money delta; classified count differences only; zero P0 integrity errors | Approved as recommended | approved | PR 4, PR 8 |
| D-24 | Audit retention | Append-only audit; no purge until accountant/lawyer approve retention and legal-hold policy | No deletion; exact retention duration requires accountant/legal confirmation | approved subject to accountant/legal confirmation | PR 8 retention gate |
| D-25 | Who approves sensitive actions? | Mandatory dual approval for sensitive initial-release operations, with a constrained ordinary-allocation exception and strict separation of duties | Initial-release policy approved for PR2; numerical limits deferred | approved for PR2; numerical limits deferred | PR 6 enforcement and production enablement; not PR 2 domain implementation |
| D-26 | Do plans belong here? | Keep approved plans and forecasts in a separate planning domain | Approved as recommended | approved | PR 3, PR 5 |
| D-27 | Source of truth after cutover | Canonical ledger is operational authority; accounting system remains reconciled external source | Approved as recommended | approved | PR 5, PR 8 |

## Detailed decisions

### D-01 — What creates a receivable?

- **Question:** Which event/document creates the canonical client obligation?
- **Why the decision matters:** It determines whether recorded debt is authorized, unique, auditable, and legally supportable.
- **Current system behavior:** Rental billing creates a derived balance. Invoice-typed documents and invoice numbers exist, but no immutable posting event makes them a canonical receivable.
- **Available options:** signed contract; issued invoice; signed act/service completion document; closed rental billing period; manually approved obligation; imported accounting document; an allow-listed combination by contract/product.
- **Recommended default:** create a receivable only from a posted/approved, allow-listed source-obligation line with stable document identity, amount, client, company, currency, and posting state. A rental record alone may create a draft billing candidate but is not sufficient financial debt. Do not choose exact production source types until accountant/legal confirmation is recorded.
- **Acceptable alternative:** use a signed act or billing-period close where the relevant contract and accounting policy explicitly make that the obligation trigger.
- **Dangerous option:** make every active/closed rental automatically become debt without a posting/source rule.
- **Business benefits:** prevents premature/duplicate debt and gives staff one explainable source document.
- **Business risks:** a strict source rule can delay visibility when operational teams do not issue/approve documents promptly.
- **Accounting/operational consequences:** the posting workflow and source status must be owned by Finance; **accountant confirmation required**. Contractual sufficiency of invoice/act/contract triggers needs **legal confirmation**.
- **Technical consequences:** source-type allow-list, source-state adapter, immutable source identity, and uniqueness constraint are mandatory.
- **Migration consequences:** rental-derived rows without an approved source remain shadow/ambiguous rather than canonical debt.
- **What becomes impossible if postponed:** PR1 cannot finalize identity/uniqueness; PR5 cannot know when to dual-write a receivable.
- **Product-owner answer:** A receivable is created only from a posted/approved allow-listed source obligation. A rental alone does not create debt. Exact legally sufficient source document types require accountant and legal confirmation.
- **Status:** approved subject to accountant/legal confirmation

### D-02 — One receivable or installments?

- **Question:** Does the model create one obligation per rental, billing period, contractual date, or a parent receivable with installments?
- **Why the decision matters:** Aging and allocation must classify each amount under exactly one due date.
- **Current system behavior:** Finance derives one balance row per counted Gantt rental; client payment plans are collection promises, not contractual installments.
- **Available options:** one rental/one receivable; one billing-period receivable; one receivable per contractual due date; parent receivable with installment children.
- **Recommended default:** one receivable per contractual due date, including one per billing period when each period has its own due date; no separate installment table initially.
- **Acceptable alternative:** parent obligation for display/grouping only, while settlement and aging still target due-date child receivables.
- **Dangerous option:** one ageable parent containing several due dates.
- **Business benefits:** simpler allocations, exclusive aging buckets, clearer collections, and fewer reconciliation paths.
- **Business risks:** users may need grouped presentation for one contract/invoice.
- **Accounting/operational consequences:** Finance must confirm whether contractual schedules are independent obligations; **accountant confirmation required**.
- **Technical consequences:** source line/installment key is part of uniqueness; allocations target one receivable.
- **Migration consequences:** existing rentals are split only when a proven source schedule exists; no schedule is invented.
- **What becomes impossible if postponed:** PR1 cannot finalize schema, source uniqueness, or aging identity.
- **Product-owner answer:** Use one receivable per contractual due date and no separate installment table in the initial release.
- **Status:** approved

### D-03 — When does rental debt become legally/operationally active?

- **Question:** At what event does a draft charge become an approved/open receivable?
- **Why the decision matters:** The trigger controls totals, collection work, customer statements, and downstream metrics.
- **Current system behavior:** Calculated rental balance appears without a canonical approval/posting transition; due/overdue use derived rental dates in legacy Finance.
- **Available options:** invoice issue; act signing; billing-period close; manual financial approval; another contract-specific event.
- **Recommended default:** a calculated rental charge remains noncanonical/draft; a receivable becomes `posted` only when D-01's accepted source is posted or financially approved. `overdue` is derived only after the contractual date passes with positive outstanding.
- **Acceptable alternative:** contract-specific trigger adapters, provided each maps to the same posted/open invariant.
- **Dangerous option:** treat rental creation, rental end, or a manager forecast as automatic approval.
- **Business benefits:** separates operational accrual from collectible debt and prevents premature collection.
- **Business risks:** missing approvals can understate operational AR until process compliance improves.
- **Accounting/operational consequences:** trigger validity requires **accountant and legal confirmation**; operations must own draft-to-open exceptions.
- **Technical consequences:** stored draft/open lifecycle, posting command, audit, and immutable-on-open fields.
- **Migration consequences:** legacy balances without proof remain draft/shadow or excluded, not silently open.
- **What becomes impossible if postponed:** PR1 lifecycle and PR5 source integration cannot be implemented safely.
- **Product-owner answer:** Activate the receivable when its source obligation is posted or financially approved. Derive overdue only after the contractual due date passes.
- **Status:** approved

### D-04 — Accepted contractual due-date sources

- **Question:** Which date provenances may enter numeric aging?
- **Why the decision matters:** Wrong dates create false overdue balances and Company Health risk scores.
- **Current system behavior:** Company Health accepts only `invoice_due_date` and `contractual_payment_due_date`; it excludes `expectedPaymentDate` and rental `endDate`.
- **Available options:** invoice date term; explicit contract payment date; contractual installment date; verified migrated date; imported accounting date; forecasts/rental end dates.
- **Recommended default:** approve `invoice_due_date` and `contractual_payment_due_date`; approve `installment_due_date` only for an accepted schedule; allow `migrated_verified` only with evidence, verifier, timestamp, and reason. Imported dates must map to one of these legal meanings rather than gaining trust merely because they were imported.
- **Acceptable alternative:** start with only the two already accepted values, then add installment/migration provenance after separate approval.
- **Dangerous option:** use `expectedPaymentDate`, rental `endDate`, arbitrary manager forecasts, or an unclassified imported date.
- **Business benefits:** honest aging, reproducible reports, and safer migration.
- **Business risks:** a large ambiguous bucket may remain until documents are verified.
- **Accounting/operational consequences:** accepted documentary evidence requires **accountant and legal confirmation**.
- **Technical consequences:** allow-list, evidence fields, unknown exclusion, and Company Health mapping version.
- **Migration consequences:** unverified dates use `unknown`; no numeric aging.
- **What becomes impossible if postponed:** PR1 due-date contract, PR3 aging API, and PR7 shadow Risks mapping cannot finalize.
- **Product-owner answer:** Accept only `invoice_due_date`, `contractual_payment_due_date`, `installment_due_date`, and `migrated_verified` as canonical provenances. `expectedPaymentDate`, rental `endDate`, and manager forecasts are noncanonical.
- **Status:** approved

### D-05 — Who may create or change a contractual due date?

- **Question:** Which roles/integrations can set or correct dates, and under what controls?
- **Why the decision matters:** Date changes can move debt between current/overdue buckets and alter management decisions.
- **Current system behavior:** Managers can edit expected dates, but those dates are not canonical; no dedicated contractual-date approval exists.
- **Available options:** accountant; finance manager; commercial director; administrator; branch manager; trusted system integration; combinations with thresholds/approval.
- **Recommended default:** only accountant or finance-manager roles with `receivables.due_date_override` may create/change contractual dates, with reason/evidence/audit. Post-allocation corrections require an additional manager approval. Administrator access alone does not imply financial authority.
- **Acceptable alternative:** prohibit all manual changes after posting and require source correction/reimport.
- **Dangerous option:** unrestricted manager/admin edits without reason, evidence, versioning, or approval.
- **Business benefits:** corrects genuine document errors without hiding history.
- **Business risks:** restrictive approval can slow urgent corrections; broad access can manipulate KPIs.
- **Accounting/operational consequences:** reason and evidence mandatory; retroactive policy needs **accountant confirmation** and potentially **legal confirmation**.
- **Technical consequences:** capability checks, optimistic version, before/after audit, approval reference, historical as-of support.
- **Migration consequences:** migrated verified dates need a named verifier/approval route.
- **What becomes impossible if postponed:** PR3 cannot safely expose date writes; PR6 cannot map permissions.
- **Product-owner answer:** Only accountant or finance-manager roles may create/change contractual due dates. Reason and audit are mandatory; a post-allocation change requires additional manager approval.
- **Status:** approved

### D-06 — Is `companyId` mandatory?

- **Question:** May any canonical financial record exist without company scope?
- **Why the decision matters:** Company isolation is the primary tenant security boundary.
- **Current system behavior:** Audited receivables/payments/allocations have no company key; access assumes one company plus role/manager scope.
- **Available options:** mandatory; optional legacy/default company; inferred at query time.
- **Recommended default:** mandatory on every receivable, payment, allocation, adjustment, refund, idempotency, and audit record; no company-less financial rows; cross-company references forbidden; business uniqueness includes company.
- **Acceptable alternative:** none for canonical records. A quarantine staging row may lack company but cannot enter canonical APIs/totals.
- **Dangerous option:** default missing company at read time or trust a client-supplied company without authorization.
- **Business benefits:** multi-company SaaS safety and clean reporting.
- **Business risks:** legacy rows cannot migrate until company mapping is deterministic.
- **Accounting/operational consequences:** company ownership must be assigned operationally; no special accounting conclusion.
- **Technical consequences:** non-null columns, composite FKs/constraints, mandatory query predicates, immutable company.
- **Migration consequences:** missing/ambiguous company blocks canonical import.
- **What becomes impossible if postponed:** PR1/PR6 cannot meet P0 isolation; no production canonical endpoint is safe.
- **Product-owner answer:** `companyId` is mandatory on every receivable, payment, allocation, adjustment, and audit event. Cross-company references are forbidden.
- **Status:** approved

### D-07 — Is `branchId` mandatory?

- **Question:** How are branch-originated and head-office/company-wide transactions scoped?
- **Why the decision matters:** Branch profitability, permissions, and payment movement depend on stable ownership.
- **Current system behavior:** No branch/region key exists in the audited financial records.
- **Available options:** mandatory everywhere; optional company-wide; inherited from rental/contract; assigned at allocation time.
- **Recommended default:** require and freeze a branch on every canonical record. Use a dedicated Head Office branch for company-wide operations; null is forbidden.
- **Acceptable alternative:** none for canonical records; a noncanonical quarantine row may await branch mapping but cannot enter APIs or totals.
- **Dangerous option:** infer branch from the current user or allocation after posting.
- **Business benefits:** accurate branch reporting and fewer scope disputes.
- **Business risks:** organization/master-data work is required before migration.
- **Accounting/operational consequences:** Finance/operations must define head-office ownership; **accountant confirmation required** if branch drives books/reporting.
- **Technical consequences:** non-null branch FK, Head Office master record, branch access predicate, immutable-after-posting rule.
- **Migration consequences:** ambiguous branch rows remain quarantined until mapped to a real branch or Head Office.
- **What becomes impossible if postponed:** PR1 schema nullability and PR6 branch RBAC cannot finalize.
- **Product-owner answer:** `branchId` is mandatory. Company-wide operations use a dedicated Head Office branch; null is forbidden.
- **Status:** approved

### D-08 — Can payments cross branches?

- **Question:** May a receipt owned by one branch settle a receivable owned by another branch?
- **Why the decision matters:** Cross-branch settlement affects responsibility, internal reporting, and authorization.
- **Current system behavior:** No branch identities exist, so the system cannot detect or report cross-branch allocations.
- **Available options:** forbid; allow same-company freely; allow with explicit permission/reason; company-wide payment exception.
- **Recommended default:** allow only within the same company and only with explicit cross-branch permission. Preserve payment and receivable branch IDs on the allocation/audit and report the cross-branch movement explicitly; company-wide payments follow a controlled exception.
- **Acceptable alternative:** forbid all cross-branch allocations and require an internal reclassification workflow first.
- **Dangerous option:** silently rewrite branch IDs or allow cross-company allocation.
- **Business benefits:** supports centralized collection while preserving accountability.
- **Business risks:** adds approval/reporting complexity and can create branch disputes.
- **Accounting/operational consequences:** cross-branch transfer treatment requires **accountant confirmation**.
- **Technical consequences:** branch-policy service, capability, audit reason, dual-branch reporting fields.
- **Migration consequences:** legacy allocations cannot be classified cross-branch until branch mapping exists.
- **What becomes impossible if postponed:** PR2 cannot enforce allocation scope; PR6 cannot complete branch authorization.
- **Product-owner answer:** Cross-branch allocations are allowed only inside the same company, require explicit permission, and preserve both payment and receivable branch context.
- **Status:** approved

### D-09 — Can one payment settle multiple receivables?

- **Question:** Can a single receipt be split across obligations?
- **Why the decision matters:** Contract-level and bulk customer payments are already operationally possible.
- **Current system behavior:** One payment can have multiple rental-targeted allocation rows.
- **Available options:** one payment/one receivable; explicit split allocations; implicit client-level settlement.
- **Recommended default:** yes, through explicit positive minor-unit allocations, each targeting exactly one receivable and capped by payment availability and target outstanding.
- **Acceptable alternative:** require manual split for every payment during the first release.
- **Dangerous option:** let one client-level payment reduce all debts without allocation records.
- **Business benefits:** supports real bank receipts and exact reconciliation.
- **Business risks:** incorrect auto-splitting can settle the wrong obligation.
- **Accounting/operational consequences:** allocation instruction/priority must be documented; **accountant confirmation required** for default settlement policy.
- **Technical consequences:** many allocation rows, atomic caps, idempotency, reversal links.
- **Migration consequences:** only proven splits migrate; uncertain remainder stays unapplied.
- **What becomes impossible if postponed:** PR2 allocation model cannot finalize.
- **Product-owner answer:** One payment may settle multiple receivables only through explicit payment allocations.
- **Status:** approved

### D-10 — Can one receivable be paid by multiple payments?

- **Question:** Can an obligation be settled through several receipts?
- **Why the decision matters:** Partial and staged payment are normal operational cases.
- **Current system behavior:** Several payment records/allocations can reduce one rental-derived balance.
- **Available options:** yes with allocations; one payment only; consolidate receipts before posting.
- **Recommended default:** yes. Outstanding equals posted amount plus/minus confirmed adjustment effects less confirmed allocation effects net of append-only reversals and write-offs. `partially_paid` and `paid` are derived, not manually stored.
- **Acceptable alternative:** none that preserves individual receipt audit while supporting partial payment.
- **Dangerous option:** overwrite one “paid amount” field and lose receipt history.
- **Business benefits:** accurate cash history, partial collection visibility, reversible settlement.
- **Business risks:** none beyond normal allocation complexity.
- **Accounting/operational consequences:** Finance sees receipt-level history and one derived outstanding balance.
- **Technical consequences:** one-to-many allocation relationship and deterministic settlement derivation.
- **Migration consequences:** several proven legacy receipts may target one canonical receivable without merging IDs.
- **What becomes impossible if postponed:** PR2 cannot support partial payment correctly.
- **Product-owner answer:** One receivable may be settled by multiple payments.
- **Status:** approved

### D-11 — How are overpayments handled?

- **Question:** What happens when confirmed receipt capacity exceeds allocated debt?
- **Why the decision matters:** Clamping a receivable to zero must not lose money owed back or available for future allocation.
- **Current system behavior:** Derived debt clamps at zero; some unallocated payment remainder is reported, but there is no canonical client-credit balance.
- **Available options:** unallocated payment; client advance; auto-oldest allocation; auto-next-invoice allocation; refund obligation.
- **Recommended default:** store the excess as an unapplied balance linked to the original payment/client until explicit allocation or refund. Present it operationally as an advance only if accountant-approved terminology/rules say so.
- **Acceptable alternative:** a dedicated client-credit wallet in a later model.
- **Dangerous option:** silently apply to future/oldest debt or discard it through a zero clamp.
- **Business benefits:** preserves cash exactly and prevents unauthorized settlement.
- **Business risks:** unapplied balances require a review queue and may grow operationally.
- **Accounting/operational consequences:** classification as advance/refundable balance requires **accountant confirmation**; refund rights may need **legal confirmation**.
- **Technical consequences:** payment available/unapplied balance, allocation/refund actions, reporting.
- **Migration consequences:** legacy excess remains unapplied; never becomes negative receivable.
- **What becomes impossible if postponed:** PR2 cannot define payment capacity or overpayment reconciliation.
- **Product-owner answer:** Keep overpayments as unapplied client balances until explicitly allocated or refunded.
- **Status:** approved

### D-12 — How are refunds handled?

- **Question:** How does returned cash link to the original receipt and settled receivable?
- **Why the decision matters:** Refunds affect both cash availability and, sometimes, debt outstanding.
- **Current system behavior:** No canonical refund event; negative amounts are rejected/clamped and payment status may be overwritten/reversed.
- **Available options:** destructive payment edit; negative payment; explicit refund event; receivable adjustment.
- **Recommended default:** append-only `refund` financial event with positive refund magnitude, original payment link, actual refund time, reason, approval, idempotency, and audit. If refunded cash was allocated, reverse the affected allocation first; that reversal restores outstanding. Support partial refunds within remaining refundable capacity.
- **Acceptable alternative:** integrate an accounting-system refund event using the same canonical relationships.
- **Dangerous option:** reduce/delete the original payment or post an unlinked negative number.
- **Business benefits:** avoids double effects and gives complete customer/cash history.
- **Business risks:** refund and allocation reversal require coordinated workflow.
- **Accounting/operational consequences:** approval limits and treatment require **accountant confirmation**; contractual refund rights require **legal confirmation**.
- **Technical consequences:** refund kind/status, original link, capacity checks, allocation reversal prerequisite, idempotency/audit.
- **Migration consequences:** legacy reversed payments without event evidence remain ambiguous; no invented refund.
- **What becomes impossible if postponed:** PR2 cannot safely model refunds or payment reversal capacity.
- **Product-owner answer:** Refunds are explicit linked financial events. Never destructively edit or delete the original payment or allocation.
- **Status:** approved

### D-13 — How are reversals and corrections handled?

- **Question:** May posted financial facts be edited/deleted, or only compensated?
- **Why the decision matters:** Destructive correction prevents reliable reconciliation and historical reproduction.
- **Current system behavior:** Some allocated payment edits/deletes are blocked, but generic records can still be edited/deleted; payment `reversed` is a status rather than a linked event.
- **Available options:** edit original; delete/recreate; append-only compensating record.
- **Recommended default:** no editing/deletion of posted financial events. Create an idempotent compensating record that references the original, uses an explicit effect, requires a reason, and preserves both entries.
- **Acceptable alternative:** draft records remain editable before posting.
- **Dangerous option:** destructive posted edits, anonymous status flips, or unlinked correction amounts.
- **Business benefits:** reproducible history, safer integrations, and reversible mistakes.
- **Business risks:** users need correction workflows instead of a simple edit button.
- **Accounting/operational consequences:** correction evidence/period treatment needs **accountant confirmation**.
- **Technical consequences:** self-references, remaining-reversible cap, immutable posted rows, audit/idempotency.
- **Migration consequences:** preserve source events; ambiguous legacy edits cannot be reconstructed automatically.
- **What becomes impossible if postponed:** PR2 event semantics and reconciliation cannot be trusted.
- **Product-owner answer:** Reversals and corrections use append-only compensating events linked to their originals.
- **Status:** approved

### D-14 — How are credits and debits handled?

- **Question:** How do discounts, credit notes, additional charges, penalties, and corrections affect outstanding?
- **Why the decision matters:** A positive/negative number alone does not explain the business effect.
- **Current system behavior:** No canonical receivable adjustment ledger; collection actions named write-off do not change financial balance.
- **Available options:** signed amounts; generic correction plus direction; explicit typed positive magnitudes.
- **Recommended default:** positive `amountMinor`, explicit `effect`, and an explicit business type: `credit`, `debit`, `discount`, `penalty`, or `correction`. Controlled write-off/reversal events remain separately identifiable. Never infer semantics from the sign.
- **Acceptable alternative:** fixed effect for all types except `correction`, which must explicitly choose increase/decrease.
- **Dangerous option:** infer effect from sign or free-text description.
- **Business benefits:** unambiguous reports and exact balance equations.
- **Business risks:** source systems must map their document types accurately.
- **Accounting/operational consequences:** mapping of discount, penalty, and correction documents needs **accountant confirmation** and potentially **legal confirmation**.
- **Technical consequences:** typed adjustments, positive checks, source document, caps, reversal behavior.
- **Migration consequences:** unsigned/unclear legacy corrections are quarantined, not guessed.
- **What becomes impossible if postponed:** PR2 adjustment schema/formula cannot finalize.
- **Product-owner answer:** Adjustment semantics are explicitly typed as `credit`, `debit`, `discount`, `penalty`, or `correction`; business meaning is never inferred from the amount sign alone.
- **Status:** approved

### D-15 — How are write-offs handled?

- **Question:** Who can write off debt, with what evidence/limits, and can it be corrected?
- **Why the decision matters:** A write-off removes collectible outstanding and affects financial/risk reporting.
- **Current system behavior:** Collection workflow has `written_off` labels/actions, but they do not post a reconciled financial effect.
- **Available options:** status-only close; destructive amount edit; approved append-only adjustment; irreversible vs compensating reversal.
- **Recommended default:** approved append-only `write_off` adjustment, amount capped by outstanding, mandatory reason/supporting document, proposer/approver audit, and permanent visibility in reports. Correct only through a separately approved compensating event; never edit/delete the original.
- **Acceptable alternative:** prohibit write-off reversal entirely and require a new debit under a new approval when correction is necessary.
- **Dangerous option:** let any admin set `written_off` or zero the amount without evidence.
- **Business benefits:** controlled loss recognition and transparent recovery history.
- **Business risks:** wrong thresholds/authority can hide debt or create bottlenecks.
- **Accounting/operational consequences:** authority, limits, reporting, reversibility, and evidence require **accountant confirmation**; recovery/legal status may require **legal confirmation**.
- **Technical consequences:** approval record, adjustment, close reason/timestamp, report memo amount, compensating link.
- **Migration consequences:** workflow labels alone cannot backfill a financial write-off without proof.
- **What becomes impossible if postponed:** PR2 write-off behavior and authority checks cannot start.
- **Product-owner answer:** Write-offs require reason and approval and may be corrected only through compensating events.
- **Status:** approved

### D-16 — How are disputed receivables handled?

- **Question:** Does disputed debt remain outstanding, enter overdue KPIs, and affect Company Health Risks?
- **Why the decision matters:** Hiding disputes understates exposure; mixing them with ordinary overdue may misrepresent collectability.
- **Current system behavior:** Collection workflow can label a client disputed, but the rental-derived balance and legacy overdue calculation remain separate.
- **Available options:** normal aging; exclude entirely; keep in total and separate bucket; include in Company Health with a distinct rule.
- **Recommended default:** retain disputed positive balance in `totalOutstandingMinor`, require dispute reason/date, classify it exclusively in `disputedAmountMinor`, display it prominently, exclude it from ordinary overdue KPI, and show separate disputed exposure in Company Health/Risks.
- **Acceptable alternative:** retain its contractual aging bucket plus a dispute flag, provided reports prevent double counting.
- **Dangerous option:** drop disputed debt from all totals or count it in both disputed and overdue buckets.
- **Business benefits:** honest total exposure with operational clarity.
- **Business risks:** excluding from ordinary overdue can improve a KPI unless the separate disputed metric remains visible.
- **Accounting/operational consequences:** balance remains until settled/credited/written off; KPI treatment needs **accountant/product confirmation** and legal workflow needs **legal confirmation**.
- **Technical consequences:** stored disputed state, exclusive classification precedence, reason/date audit, Company Health mapping.
- **Migration consequences:** legacy dispute actions must link deterministically; otherwise debt remains ordinary/ambiguous with discrepancy note.
- **What becomes impossible if postponed:** PR2 lifecycle, PR3 aging output, and PR7 Risks methodology cannot finalize.
- **Product-owner answer:** Disputed receivables remain in total outstanding, appear in a separate disputed bucket, are excluded from ordinary overdue KPI, and remain visible as a separate risk signal.
- **Status:** approved

### D-17 — Which lifecycle states are stored and which are derived?

- **Question:** Which statuses represent authoritative workflow/legal state versus calculated financial state?
- **Why the decision matters:** Storing both balance and redundant paid/overdue states creates drift.
- **Current system behavior:** Rental, payment, and collection statuses overlap and can disagree with calculated outstanding.
- **Available options:** store all statuses; store only workflow/legal states; event-only lifecycle.
- **Recommended default:** store `draft`, `posted`, `disputed`, `cancelled`, and `written_off`. Derive `open`, `partially_paid`, `paid`, `overdue`, outstanding, and written-off amount.
- **Acceptable alternative:** add a short-lived `pending_approval` stored state if D-03 requires a distinct approval queue.
- **Dangerous option:** allow users to set paid/overdue independently of allocations and dates.
- **Business benefits:** fewer contradictions and clearer workflow.
- **Business risks:** UI must present derived and stored states distinctly.
- **Accounting/operational consequences:** closure/reopen rules must match approved refund/reversal policy.
- **Technical consequences:** transition service, derived view fields, forbidden direct status writes.
- **Migration consequences:** legacy statuses are mapped only when balance/events prove them; otherwise derived anew.
- **What becomes impossible if postponed:** PR1 lifecycle schema and PR3 response contract cannot finalize.
- **Product-owner answer:** Persist `draft`, `posted`, `disputed`, `cancelled`, and `written_off`; derive `open`, `partially_paid`, `paid`, and `overdue`.
- **Status:** approved

### D-18 — Can posted original amount change?

- **Question:** May `originalAmountMinor` be edited after posting?
- **Why the decision matters:** Mutable principal destroys source reconciliation and historical audit.
- **Current system behavior:** Rental/payment amounts can be edited under current permissions/workflows and derived balances recalculate.
- **Available options:** always mutable; immutable after open; immutable from draft creation.
- **Recommended default:** draft amount may change with audit; posting freezes original amount, currency, source identity, company, branch, and client. Later changes use typed adjustment or cancellation and replacement.
- **Acceptable alternative:** freeze at draft creation and recreate drafts for any change.
- **Dangerous option:** edit a posted amount and overwrite previous financial history.
- **Business benefits:** stable invoices, exact reconciliation, safe integrations.
- **Business risks:** correction workflow is more deliberate than direct editing.
- **Accounting/operational consequences:** correction document requirements need **accountant confirmation**.
- **Technical consequences:** state-dependent immutability checks, versioning, adjustment/cancel-reissue commands.
- **Migration consequences:** capture a frozen source snapshot/hash; later legacy changes become discrepancies/adjustments.
- **What becomes impossible if postponed:** PR1 field constraints and source-correction strategy cannot finalize.
- **Product-owner answer:** `originalAmountMinor` is immutable after posting. Corrections require adjustments or cancellation/replacement.
- **Status:** approved

### D-19 — What is the company timezone?

- **Question:** Which IANA timezone governs aging and as-of dates?
- **Why the decision matters:** Browser/UTC boundaries can move a balance between current and overdue.
- **Current system behavior:** No confirmed company timezone exists; backend often uses UTC dates and frontend can use browser-local dates.
- **Available options:** fixed `Europe/Moscow`; per-company configuration; per-branch configuration; browser/UTC.
- **Recommended default:** store an authoritative IANA timezone per company and use `Europe/Moscow` for the current company initially. Server calculates all aging in that company timezone and returns timezone context. No browser-local or branch-specific aging in the initial release.
- **Acceptable alternative:** company timezone only in v1, branch-specific zones in a later version.
- **Dangerous option:** infer from user browser or server host.
- **Business benefits:** deterministic reports and production verification.
- **Business risks:** wrong default affects every boundary calculation.
- **Accounting/operational consequences:** company calendar/default requires **accountant/product confirmation**.
- **Technical consequences:** company setting, IANA validation, civil-date arithmetic, calculation metadata.
- **Migration consequences:** no age eligibility until company timezone is assigned; historical reports need timezone versioning policy.
- **What becomes impossible if postponed:** PR1 required field, PR3 aging, and PR7 Company Health mapping cannot finalize.
- **Product-owner answer:** Store an IANA timezone per company, use `Europe/Moscow` for the current company initially, and never age by browser-local time.
- **Status:** approved

### D-20 — Which currency behavior is supported?

- **Question:** Is v1 RUB-only or multi-currency, and may allocations convert currency?
- **Why the decision matters:** Different currencies cannot be summed or allocated without explicit FX accounting.
- **Current system behavior:** Rental/payment amounts generally lack currency; some finance accounts default to RUB.
- **Available options:** implicit RUB; required RUB-only field; multiple currencies without conversion; full FX conversion.
- **Recommended default:** require ISO currency on every record; support RUB only in the first release; require exact payment/receivable currency match; report each currency separately; no automatic FX.
- **Acceptable alternative:** permit multiple same-currency ledgers while still forbidding conversion.
- **Dangerous option:** implicit currency or application-time conversion without FX records/rates.
- **Business benefits:** simpler exact reconciliation and safe phased delivery.
- **Business risks:** foreign-currency business remains outside v1.
- **Accounting/operational consequences:** supported currencies and rounding exponents require **accountant confirmation**.
- **Technical consequences:** ISO validation, integer minor units, match constraints, per-currency API filters.
- **Migration consequences:** legacy currency must be deterministically assigned; ambiguity blocks migration.
- **What becomes impossible if postponed:** PR1 money schema, PR2 allocation checks, and PR3 summaries cannot finalize.
- **Product-owner answer:** The initial release supports RUB only. Currency is required, payment/receivable currencies must match, and automatic FX is forbidden.
- **Status:** approved

### D-21 — What is the automatic payment allocation policy?

- **Question:** When may the system choose target receivables without a fully explicit manual selection?
- **Why the decision matters:** Allocation changes legal/operational settlement and overdue balances.
- **Current system behavior:** Preview suggests rental debts in derived order; users can apply allocations. No canonical policy is documented.
- **Available options:** no automation; oldest contractual debt; exact reference then oldest; client instruction; manual-only for ambiguity.
- **Recommended default:** priority: (1) exact trusted document/reference match; (2) captured explicit client instruction; (3) oldest eligible confirmed receivable by contractual due date, then posting time/ID; (4) otherwise remain unapplied. Exclude disputed debt from automatic oldest-first allocation and audit the selected rule.
- **Acceptable alternative:** manual-only allocations for v1.
- **Dangerous option:** silently allocate to oldest rental/end date or across clients/companies/currencies.
- **Business benefits:** efficient operations with deterministic, explainable settlement.
- **Business risks:** default priority may conflict with client intent or contract rules.
- **Accounting/operational consequences:** settlement-order policy needs **accountant and legal confirmation**.
- **Technical consequences:** deterministic ordering, confidence/reason, preview/confirm, idempotency, exclusion rules.
- **Migration consequences:** uncertain legacy allocation remains unapplied; no reconstructed oldest-first allocation.
- **What becomes impossible if postponed:** PR2 auto-allocation and PR5 payment dual-write behavior cannot finalize.
- **Product-owner answer:** Allocate automatically by exact document/reference match, then explicit client instruction, then oldest confirmed receivable; otherwise leave the payment unapplied.
- **Status:** approved

### D-22 — Which records may be backfilled?

- **Question:** How is each legacy obligation/payment/allocation classified for migration?
- **Why the decision matters:** Backfill can create duplicate or fictitious debt if uncertainty is treated as fact.
- **Current system behavior:** Stable IDs exist widely, but company, branch, currency, canonical source, receipt dates, and contractual dates are incomplete.
- **Available options:** migrate everything with defaults; migrate deterministic facts only; no backfill.
- **Recommended default:** classify:
  - `safe_to_backfill`: company/currency/client/source identity/amount and status are deterministic;
  - `safe_due_date_unknown`: same, but due date uses provenance `unknown` and is not aged;
  - `ambiguous_source_identity`: no canonical receivable; quarantine/discrepancy;
  - `ambiguous_payment_allocation`: migrate proven receipt only and leave balance unapplied;
  - `unsafe_to_migrate`: invalid/duplicate/cross-scope/unreconciled data; quarantine.
- **Acceptable alternative:** restrict first backfill to posted imported accounting sources and confirmed bank receipts only.
- **Dangerous option:** invent contractual dates, match editable names, generate duplicate sources, or infer uncertain allocations.
- **Business benefits:** phased migration with honest coverage and reversible decisions.
- **Business risks:** initial canonical coverage may be low and require manual verification.
- **Accounting/operational consequences:** evidence rules and migrated receipt status need **accountant confirmation**.
- **Technical consequences:** classifier, reason codes, quarantine, source hashes, checkpoints, idempotent batches.
- **Migration consequences:** this decision is the migration contract itself; every record receives one classification.
- **What becomes impossible if postponed:** PR4 cannot write a safe backfill or discrepancy report.
- **Product-owner answer:** Backfill only stable source identities; never invent contractual dates. Use `provenance=unknown` for unknown dates and leave ambiguous allocations unapplied.
- **Status:** approved

### D-23 — What reconciliation discrepancy permits cutover?

- **Question:** Which money/count differences are acceptable before canonical reads replace legacy reads?
- **Why the decision matters:** Cutover with unexplained deltas transfers incorrect balances into operational authority.
- **Current system behavior:** Legacy derived calculations can differ from future canonical source rules; no approved threshold exists.
- **Available options:** zero total delta; percentage/absolute tolerance; classified differences; manual approval per discrepancy.
- **Recommended default:** zero unexplained money discrepancy for canonical balances at company, currency, client, receivable, payment, and allocation levels. Record-count differences are allowed only when every difference has an approved classification. Zero cross-company, duplicate identity, currency mismatch, or reconciliation errors. Any non-zero legacy-vs-canonical aggregate delta requires explicit owner/accountant acceptance and must not be hidden by netting.
- **Acceptable alternative:** cohort cutover only for fully reconciled companies/branches while others remain legacy.
- **Dangerous option:** aggregate-only percentage tolerance that lets client-level errors cancel each other.
- **Business benefits:** trustworthy source-of-truth transition and clear rollback criteria.
- **Business risks:** zero unexplained delta can delay cutover.
- **Accounting/operational consequences:** acceptance threshold/sign-off needs **accountant confirmation**.
- **Technical consequences:** exact minor-unit reports, reason taxonomy, gate automation, signed run ID.
- **Migration consequences:** unresolved cohorts remain shadow-only.
- **What becomes impossible if postponed:** PR4 acceptance tests and PR8 production switch cannot be authorized.
- **Product-owner answer:** Production read cutover requires zero unexplained monetary discrepancy. Count differences must be fully classified; cross-company leaks and unresolved duplicates block cutover.
- **Status:** approved

### D-24 — What audit retention is required?

- **Question:** How long and in what form must financial audit/history be retained?
- **Why the decision matters:** Corrections, disputes, external audits, and historical reports depend on durable evidence.
- **Current system behavior:** General JSON audit is capped at 10,000 records and is not a dedicated immutable financial ledger.
- **Available options:** fixed period; indefinite; legal/accounting retention policy; tiered active/archive/legal hold.
- **Recommended default:** append-only financial audit with actor, time, reason, before/after minor-unit values, source system, request/correlation/idempotency IDs, approvals, and versions. Do not purge until accountant/lawyer approve a retention, archive, export, legal-hold, and tamper-evidence policy.
- **Acceptable alternative:** tiered online/archive storage with the same immutable retrievability.
- **Dangerous option:** reuse the current capped audit as sole evidence or delete audit with source records.
- **Business benefits:** defensible corrections and reproducible history.
- **Business risks:** storage/privacy/export obligations increase.
- **Accounting/operational consequences:** retention duration requires **accountant and legal confirmation**; no duration is asserted here.
- **Technical consequences:** dedicated table, append-only permissions, archival/export, legal hold, optional hashes.
- **Migration consequences:** retain migration run/evidence/discrepancy events under the approved policy.
- **What becomes impossible if postponed:** PR4 cannot finalize audit retention/exports; PR8 lacks a production evidence policy.
- **Product-owner answer:** Financial audit events are append-only and never deleted. Exact retention duration and related legal/accounting controls require accountant and legal confirmation.
- **Status:** approved subject to accountant/legal confirmation

### D-25 — Who can approve sensitive actions?

- **Question:** Which roles can initiate and approve financial actions, and where are thresholds/separation of duties required?
- **Why the decision matters:** Technical admin access must not automatically authorize financial loss or KPI-changing actions.
- **Current system behavior:** Admin and office-manager control most payment/allocation writes; accountant/finance/commercial/branch authority roles are not established in the audited role model.
- **Available options:** role-only; capability-only; amount thresholds; two-person approval; external accounting approval.
- **Recommended default:** capability-based authority with company/branch scope, immutable approval records, and separation of duties. For the initial release, use the approved mandatory dual-approval policy below instead of unapproved monetary or age thresholds.

#### Approved temporary initial-release policy

1. **Ordinary payment allocation**
   - An accountant may create the allocation.
   - Dual approval is not required only when payment and receivable belong to the same company, currencies match, the allocation exceeds neither payment balance nor receivable outstanding, and there is an exact document/reference match or explicit client instruction.
   - A manual allocation without clear matching requires finance-manager confirmation.
2. **Cross-branch allocation**
   - Always requires accountant initiation and finance-manager approval.
   - Cross-company allocation is forbidden.
3. **Refund**
   - Always requires dual approval.
   - An accountant or finance manager initiates; another finance-authorized user approves.
   - The initiator cannot approve the same operation.
4. **Credit/debit adjustment**
   - Always requires dual approval.
   - Explicit adjustment type and reason are mandatory.
   - The original posted financial event is never edited.
5. **Reversal/correction**
   - Always requires dual approval.
   - It must reference the original event and use an append-only compensating event.
6. **Write-off**
   - Always requires dual approval.
   - One approver must be the finance owner or commercial/product owner.
   - Reason and supporting-document reference are mandatory; automatic write-off is forbidden.
7. **Contractual due-date change**
   - Before any payment allocation, an accountant or finance manager may initiate the change and an audit reason is mandatory.
   - After any payment allocation, dual approval is always required.
   - A retroactive change preserves the previous value in the audit log.
8. **Cancellation of a posted receivable**
   - Always requires dual approval.
   - If allocations or adjustments exist, direct cancellation is forbidden and compensating operations are required.
9. **Separation of duties and approval evidence**
   - Initiator and approver are different users.
   - System and integration events cannot self-approve sensitive operations.
   - Every approval records `initiatorId`, `approverId`, `requestedAt`, `approvedAt`, `reason`, and `correlationId`.
10. **Temporary-policy status**
   - This is the approved initial-release D-25 policy.
   - Monetary and age thresholds remain deferred.
   - Future threshold changes require a separate product-owner decision and must not weaken auditability or separation of duties.

- **Acceptable alternative:** stricter two-person approval for every posted correction/refund/write-off.
- **Dangerous option:** administrator can approve every financial action solely because of system role.
- **Business benefits:** controlled authority, branch safety, and clear accountability.
- **Business risks:** roles/thresholds may slow work if understaffed.
- **Accounting/operational consequences:** the initial-release authority and separation rules are approved. Future numerical thresholds still require **accountant and product-owner confirmation**; legal-sensitive cancellation/write-off evidence needs **legal confirmation**.
- **Technical consequences:** new capabilities and immutable approval records, scoped checks, non-self-approval, exact approval metadata, and default-deny enforcement. No threshold configuration is required for the initial-release policy.
- **Migration consequences:** discrepancy acceptance and verified-date actors must use this matrix.
- **What becomes impossible if postponed:** PR6 authorization enforcement and production enablement cannot be completed; the PR2 domain may proceed under this approved policy.
- **Product-owner answer:** Approve the temporary initial-release policy above: every sensitive operation uses dual approval and separation of duties, while only strictly matched ordinary same-company/same-currency allocations may use the documented single-accountant path. Numerical limits remain deferred.
- **Status:** approved for PR2; numerical limits deferred

### D-26 — Do financial plans belong to this model?

- **Question:** Are receipts plans, expense plans, and forecasts part of the actual receivable/payment ledger?
- **Why the decision matters:** Mixing plans with actuals can fabricate balances, receipts, or Finance scores.
- **Current system behavior:** Collection payment plans and management expenses/forecasts exist separately; Company Health correctly treats missing approved plans as missing.
- **Available options:** same receivable tables; separate planning domain linked by IDs; no planning model.
- **Recommended default:** keep approved plans and forecasts in a separate planning domain with period/scope/version/approval. They may reference canonical IDs but never change receivable outstanding or confirmed payment balances.
- **Acceptable alternative:** expose a combined read view that clearly labels actual vs plan while keeping storage/effects separate.
- **Dangerous option:** store planned payments as confirmed allocations or treat accrued rental revenue as a receipts plan.
- **Business benefits:** honest actual/plan metrics and simpler financial invariants.
- **Business risks:** an additional planning contract is needed later for Company Health plan attainment.
- **Accounting/operational consequences:** plan approval authority belongs to planning governance, not AR posting.
- **Technical consequences:** separate schema/API/domain and explicit read joins only.
- **Migration consequences:** `receivable_payment_plans` remain collection/planning records, not installments or receipts.
- **What becomes impossible if postponed:** PR3 API boundaries and PR5 integrations risk mixing planned and factual values.
- **Product-owner answer:** Approved plans and forecasts belong to a separate planning domain and must not be mixed with actual receivables or payments.
- **Status:** approved

### D-27 — What is the source of truth after cutover?

- **Question:** Which system is authoritative for operational receivable balance after migration?
- **Why the decision matters:** Dual authority creates conflicting edits and no deterministic reconciliation owner.
- **Current system behavior:** Rentals/payments and derived finance helpers are operational sources; accounting integration is not a canonical reconciled AR authority in this model.
- **Available options:** canonical ledger; accounting integration; permanent dual authority; current rentals/payments.
- **Recommended default:** after signed reconciliation and feature-flagged cutover, the canonical receivable ledger becomes the operational source of truth for outstanding, allocation, and aging. Accounting integration remains a reconciled external source with explicit inbound/outbound ownership; it does not independently overwrite canonical facts.
- **Acceptable alternative:** accounting system becomes the sole posting authority while this application is a read/operational projection, provided idempotent integration and ownership are explicitly designed before PR5.
- **Dangerous option:** permanent bidirectional dual authority without conflict ownership.
- **Business benefits:** one explainable balance and clear integration responsibility.
- **Business risks:** outages or delayed integration require defined operating procedures.
- **Accounting/operational consequences:** accounting-system ownership and reconciliation workflow require **accountant confirmation**.
- **Technical consequences:** feature flags, write ownership, outbox/import contracts, conflict quarantine, rollback policy.
- **Migration consequences:** dual-write is temporary; read/write authority changes only at approved cutover.
- **What becomes impossible if postponed:** PR5 cannot define write direction and PR8 cannot declare a completed cutover.
- **Product-owner answer:** After shadow reconciliation and feature-flagged cutover, the canonical receivable ledger is the operational source of truth; accounting remains a reconciled external source.
- **Status:** approved

## Implementation gates

The outcomes below distinguish a product-decision baseline from later operational evidence. A `PASS` authorizes only the named PR scope; it does not authorize production enablement, migration, or cutover.

### PR1 — canonical schema and domain

**Status: RELEASED — schema/domain foundation only.**

D-01, D-02, D-03, D-04, D-06, D-07, D-17, D-18, D-19, and D-20 have product-owner answers. PR1 implements the generic allow-list boundary and source identity but does not hardcode legally sufficient source document types before D-01's accountant/legal confirmation. RELEASED does not authorize production posting or canonical production reads.

PR1 must use mandatory `companyId` and `branchId`, the dedicated Head Office branch model, RUB-only constraints, the approved lifecycle, and company IANA timezone storage. The original baseline task was docs-only and created no migration; the later PR1 migration recorded above remains additive and enables no product behavior.

### PR2 — payments, allocations, adjustments

**Status: RELEASED — settlement/domain foundation only.** D-08 through D-16 and D-21 are approved, and D-25 supplies the approved initial-release authority policy. The additive PR2 settlement foundation implements the mandatory dual-approval and separation-of-duties domain contract. RELEASED does not authorize production settlement; no production operation may be enabled before PR6 authorization enforcement exists.

### PR 3 — read API and aging

**Status: RELEASED — read-only canonical receivables API and aging infrastructure only.** PR2 is released, and D-05, D-16, D-19, D-20, D-25's role model, and D-26 are approved. PR3 implements the read-only canonical receivable/aging API under the approved contract without exposing settlement writes. It excludes disputed balances from ordinary overdue KPI while returning them in total outstanding and a separate risk bucket. Production enablement remains disabled and scope-mapping remains blocked on PR6.

### Before PR 4 — backfill and reconciliation

**Gate: BLOCKED pending a separately approved backfill/reconciliation strategy and mappings.** The PR3 sequence dependency is satisfied, but PR4 may proceed only as a separate design stage after its strategy and company, Head Office/branch, `Europe/Moscow`, RUB, and source mappings are approved. D-22 and D-23 are approved. D-24 authorizes append-only/no-delete handling, so tooling may be designed under indefinite retention only after that approval. Actual data retirement, purge, or finite retention behavior remains blocked until the retention duration is confirmed.

### Before PR 5 — dual write

**Gate: BLOCKED for production enablement.** D-03, D-09, D-12, D-13, D-21, D-26, and D-27 are approved. Enablement additionally requires D-01's accountant/legal source-type confirmation, completion of upstream PRs, and PR6 company/branch authorization. Any code prepared earlier must remain disabled.

### Before PR 6 — tenant and RBAC enforcement

**Gate: BLOCKED on operational authorization mappings and enforcement.** The temporary D-25 domain policy is implemented in PR2 infrastructure, but concrete tenant memberships, finance-authorized roles, capabilities, company/branch/Head Office mappings, real-user approval identity, and immutable approval enforcement must be supplied and tested before production enablement.

### Before PR 7 — Company Health shadow read

**Sequence gate: BLOCKED by the canonical read API and shadow reconciliation after PR3–PR6.** D-04, D-16, D-19, and D-20 are approved. Shadow output must retain ambiguous/disputed coverage and may not silently change visible scoring.

### Before PR 8 — production cutover

**Gate: BLOCKED.** Product decisions are recorded, but cutover still requires D-01 source-type confirmation, D-24 retention confirmation or a formally approved indefinite no-delete policy, PR6 enforcement of the approved D-25 policy, all upstream PRs, signed zero-delta reconciliation, verified rollback evidence, explicit cutover approval, and the following operational evidence:

- reconciliation threshold and signed results approved;
- authority matrix active and tested;
- audit/retention policy approved or a lawyer/accountant-approved interim no-purge policy;
- source-of-truth ownership approved;
- feature flags, backup, rollback policy, and rollback drill approved;
- zero unresolved cross-company, duplicate, currency, allocation-cap, or minor-unit reconciliation errors;
- explicit sign-off from product, Finance/accounting, security/operations, and release ownership.

## Decisions requiring external confirmation

### Accountant confirmation required

D-01 requires confirmation of which source document types are financially sufficient to create a receivable. D-24 requires confirmation of the accounting retention duration and export/control requirements.

### Legal confirmation required

D-01 requires confirmation of which allow-listed source documents are legally sufficient evidence of debt. D-24 requires confirmation of legal retention, legal-hold, deletion, and evidence-preservation requirements.

### Deferred Product/Finance numerical policy

D-25 does not require numerical limits for the approved initial-release policy because sensitive operations use mandatory dual approval. Monetary and age thresholds remain deferred; no implementation may silently choose them. Any future threshold change requires a separate product-owner decision and must preserve auditability and separation of duties.

## Approval record

Record the durable approval identity and later conditional confirmations here without deleting the original recommendation or product-owner answer:

| Approval batch | Decision IDs | Product owner | Accountant confirmation | Legal confirmation | Date | Notes/reference |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

This memo records the product-owner baseline. Conditional confirmations and blocked gates must not be bypassed through implementation defaults.
