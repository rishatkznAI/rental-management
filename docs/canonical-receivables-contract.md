# Canonical receivables backend contract

**Status:** product-owner baseline approved; PR1 schema/domain foundation **RELEASED**; PR2 settlement/domain foundation **RELEASED**; PR3 read API/aging infrastructure **RELEASED**; PR4 **DESIGN APPROVED** as a historical design gate and not released; PR5 **RELEASED** as the neutral platform identity and fail-closed authorization foundation only

**Audit date:** 2026-07-15

**Current-state update:** 2026-07-17

**PR1 merge commit:** `ae9d8a8a286307f5d6e701585750af94d631edc1`

**PR2 merge commit:** `ee2c1b6e1340acb3fc3149c6a39487a283db829c`

**PR5 implementation PR / reviewed head / released squash commit:** [#210](https://github.com/rishatkznAI/rental-management/pull/210); `f2c3b7230f81be874ed46b3e4c243fa6e686f963`; `35aa9891e389ab7de114475f7012d737d1165695`

**Implementation status:** PR1, PR2, and PR3 are released within their recorded foundation-only boundaries. PR4 remains a design-approved historical gate and was not released. PR5 is released only as the neutral platform identity and fail-closed authorization foundation. PR6 may now begin only as Billing Source Authority. Canonical production reads and writes, production settlement, production identity/bootstrap activation, Finance or Company Health switching, deployment, and cutover remain disabled or unperformed.

## Product-owner baseline

**Decision date:** 2026-07-13; D-01, D-24, forecast-domain, and PR4 design-detail decisions dated 2026-07-15

**Approved decisions:** D-01 through D-27 in `docs/canonical-receivables-decisions.md`.

**Clarified approvals:** D-01 now requires both a closed relevant rental billing period and a formed/explicitly conducted UPD; merely signed is not conducted. The separate forecast-domain decision keeps forecasts outside actual debt, canonical receivables, aging, collections, and settlement and forbids conversion to actual. D-24 now requires indefinite retention and forbids deletion, purge, TTL, scheduled cleanup, and rollback deletion until a separate accountant-and-lawyer decision is approved. Accountant/legal confirmation remains required for source evidence/sufficiency, any additional signature requirement, due-date and correction rules, and retention controls such as legal hold/export/access/tamper evidence. D-25's mandatory dual-approval policy for sensitive operations remains approved for PR2 and the initial release; exact monetary and age thresholds are deferred.

**Approved PR4 design details:** one non-overlapping billing period per rental line/contractual billing cycle; capability-gated close; immutable reasoned/audited reopen version; explicit conducted state; contract-specific signature default; zero-tolerance unexplained net/VAT/gross mismatch; one active UPD line per period slice with explicit non-overlapping multi-period line coverage; one actual per immutable UPD slice and contractual due date; actual-with-unknown-date exclusion rules; operational rental-branch ownership and dedicated centralized Head Office branch; append-only corrections; approved closed-unbilled display; 30-day forecast horizon; `active`/`return_planned` forecast status scope; separate excluded `planned_future`; four forecast confidence levels/reasons; indefinite forecast history pending a separate policy; separately displayed unapplied advances; exact three-component expected-load equation; stable rental-line return events; versioned minimum terms/discounts before VAT; and fully governed forward-only periods with no partial-period or historical import. These detail approvals alone did not release any implementation stage; the final architecture approval below also releases none.

**Approved PR4 architecture and PR5 foundation:** the revised PR4–PR12 sequence is approved exactly as documented. One neutral platform identity authority conceptually owns companies, branches, company memberships, and membership branch access; the empty canonical company/branch roots must be safely replaced or rebound rather than becoming an independently editable authority. Branch IDs are stable and opaque, each branch belongs to exactly one company, Head Office is a dedicated non-null/non-wildcard/non-sentinel branch for centralized operations, and ordinary rentals use their operational branch. Company access requires an active stable company membership with explicit allowed branches or explicit company-wide branch authority that never removes record branch identity. Backend authorization uses a versioned server-authoritative explicit-capability catalog, administrative role templates, audited grants, and no administrator-implied financial authority. Authorization denies by default for missing/inactive membership, unknown role/capability, missing branch scope, cross-company access, or unapproved non-user identities; client-supplied scope can only narrow server-authorized scope. The exact conceptual capability namespace and PR5 prohibitions are recorded in `docs/canonical-receivables-pr4-design-gate.md` and `docs/canonical-receivables-decisions.md`.

**PR1 release status: RELEASED.** The schema/domain foundation is deployed and verified. This status authorizes no canonical production business behavior: no legally sufficient source type is hardcoded, no production posting or canonical read is enabled, and the legacy operational paths remain authoritative until a separately approved cutover. Baseline commit `574edc53fc0c94d9727b03ac18c2022877a2094c` itself created no schema or migration; the released PR1 implementation is recorded below.

**No silent assumptions:** unresolved source evidence/sufficiency, proven-date evidence, exact money/VAT/rounding, source compensation, downtime/extension authority, coverage precedence, activation date/cohort, concrete membership records, audited capability assignments, named integration contracts, approval thresholds, or expanded permission details remain disabled, fail-closed, or escalated. Implementation must not invent a finite retention period.

**Current product-owner status:** PR1 is **RELEASED**; PR2 is **RELEASED**; PR3 is **RELEASED**; PR4 is **DESIGN APPROVED** as a historical design gate and is not released; and PR5 is **RELEASED, foundation only**. The production ledger remains inactive, with canonical production reads and writes disabled and existing systems continuing to serve production behavior. PR6 may begin only as Billing Source Authority under the boundaries recorded below. Production settlement, canonical writes, canonical read switches, backfill, dual write, shadow reads, deployment, bootstrap, and cutover remain blocked.

## PR1 implementation record

**Implementation date:** 2026-07-13

**Production release verification date:** 2026-07-14

**Released commit:** `ae9d8a8a286307f5d6e701585750af94d631edc1`

**Migration:** `canonical_receivables_pr1_schema`, version 1, registered through the repository's existing `sql_shadow_schema_migrations` initializer convention. The registry is checked inside the migration transaction; once version 1 is present, later startups retain the original registration timestamp and skip the canonical DDL.

**Tables:**

- `canonical_companies` — empty company identity and required IANA receivables-timezone foundation; no company or timezone is hardcoded or seeded;
- `canonical_branches` — empty company-owned branch identity foundation with a company-scoped Head Office uniqueness invariant;
- `canonical_receivables` — canonical receivable rows;
- `financial_audit_events` — append-only financial audit foundation.

### PR1 production evidence

Production verification confirmed the following state without creating, deleting, or modifying canonical business rows:

| Evidence | Verified value |
|---|---:|
| Migration identifier | `canonical_receivables_pr1_schema` |
| Migration version | `1` |
| Migration registration count | `1` |
| Repeated initializer | Skipped; the migration was not re-executed |
| `PRAGMA foreign_keys = 1` | Confirmed |
| `PRAGMA foreign_key_check = 0` | Confirmed |
| `canonical_companies` | `0` rows |
| `canonical_branches` | `0` rows |
| `canonical_receivables` | `0` rows |
| `financial_audit_events` | `0` rows |

The migration was applied exactly once. Repeated startup followed the idempotent skip path and preserved the single registration. The additive migration changed no legacy table schema or application data. No production canonical receivable read or write path exists.

The company and branch foundation is intentionally schema-only. The audited repository and populated local snapshot contain no relational company/branch tables, stable tenant IDs, user membership, or authenticated tenant context that PR1 could reference. Each placeholder company row requires `receivablesTimezone`, while each receivable keeps its immutable `companyTimezone` snapshot. `canonical_receivables` and `financial_audit_events` use composite `(companyId, branchId)` foreign keys, so a branch from another company cannot be referenced.

**Historical PR1 release boundary:** `canonical_companies` and `canonical_branches` were not yet an independently usable operational tenant directory: PR1 provided no CRUD, seed, backfill, synchronization, authentication lookup, or application repository for them, and they remained empty. A later authority stage therefore had to adopt those roots as the single approved tenant master or rebuild the empty canonical foreign keys against another approved master; running two independently editable identity models was forbidden. PR5 has since promoted the same physical roots in place as the neutral platform identity authority without rebuilding child tables or rebinding foreign keys. Concrete production IDs, memberships, mappings, approvals, and bootstrap remain unapplied and must exist before any separately authorized production enablement; PR6 may not run that production bootstrap. IDs must never be inferred from names or from the current user, and no canonical write may be enabled.

At its historical release gate, PR1 therefore solved only the schema-level invariant that every canonical row has a company and a same-company branch. It did not claim end-to-end tenant isolation, active-tenant matching, user membership, or branch RBAC. PR5 now supplies the released fail-closed authority foundation, but concrete production identity state and production enablement remain absent and are not silently treated as complete.

Existing clients, contracts, rentals, documents, and users remain JSON records in `app_data`. Consequently `clientId`, nullable `contractId`, nullable `rentalId`, and audit `actorId` have no database foreign keys in PR1, and this implementation does not claim referential integrity for them. Domain validation requires stable IDs and never derives identity from a client name; future posting/backfill must validate their company ownership through the approved scoped registries before insertion.

Implemented receivable invariants include mandatory company, branch, client, source, idempotency, currency, timezone, workflow, timestamp, and version fields; RUB-only currency; safe integer minor-unit validation; non-negative draft amount with a positive amount required once posted; accepted due-date provenance requiring a contractual date; approved stored workflow states only; company-scoped idempotency; company/source-system/source-document/normalized-line uniqueness; external identity uniqueness when present; and posted-field immutability for company, branch, client, exact source fields, currency, company-timezone snapshot, and original amount. A generated `normalizedSourceLineId` maps a missing or blank line to `__document_total__`, avoiding SQLite's nullable-unique behavior without making null, empty, and whitespace values interchangeable after posting.

The source type remains extensible text. Posted-input validation requires an injected `isApprovedSourceDocument` policy and contains no legal source-type allow-list. No current runtime module supplies that policy, so this foundation cannot post a production receivable.

The audit table rejects updates, deletes, and duplicate-ID `INSERT OR REPLACE` attempts at the SQLite boundary while allowing new inserts. Its append helper requires company/branch scope, actor classification, correlation ID, source system, and valid JSON; user events require an actor ID, and compound or nested secret-bearing JSON keys are rejected. Audit payloads may still contain personal data if a future caller supplies it, so callers must minimize data to stable IDs and necessary financial values. The append-only guarantee covers ordinary application SQL while the triggers exist; a physical database administrator can alter the SQLite file or drop triggers and is outside the application-level guarantee. D-24 retention, legal-hold, export, tamper-evidence, privileged-DBA, and privacy controls remain unresolved; no deletion or purge behavior is implemented.

PR1 balance/status helpers are deliberately not a settlement engine. With no allocations or adjustments, positive `posted`/`disputed` outstanding equals `originalAmountMinor`; cancelled, written-off, and draft rows return no active outstanding. Disputed positive balances remain visible but are not ordinary-aging eligible. No production aging buckets are calculated or exposed.

All canonical tables are empty after the migration because PR1 contains no seed, backfill, posting repository, route, worker, dual write, or legacy trigger. Current Finance, Risks, Dashboard, Company Health, rentals, payments, documents, and reports do not import or query these tables.

**Rollback:** the repository has no down-migration framework. The safe rollback is to deploy the prior code and leave the unused empty additive tables in place. If physical removal is required before any later PR writes data, take and verify a SQLite backup, confirm all four tables are empty, then remove the append-only triggers and tables offline in foreign-key dependency order and delete only the `canonical_receivables_pr1_schema` migration-registry row. Once canonical data exists, tables must not be dropped as rollback; later integrations must be disabled while records are retained for diagnosis and audit.

**Deferred from PR1:** every PR2+ payment, allocation, adjustment, refund, reversal, credit/debit, write-off, retention, backfill, dual-write, API, tenant/RBAC implementation, Company Health read switch, and production cutover item remains outside the released PR1 scope. PR2 now supplies the separately released, isolated settlement/domain foundation recorded below, but no production business entrypoint imports it. There is still no production receivable posting, settlement API, canonical write path, backfill, dual write, tenant/RBAC enforcement, Company Health canonical read, production read switch, or cutover.

## PR2 implementation record

**Implementation status:** **RELEASED — settlement/domain foundation only.** This status authorizes no production settlement behavior.

**Production release verification date:** 2026-07-14

**Released commit:** `ee2c1b6e1340acb3fc3149c6a39487a283db829c`

**Migration:** `canonical_receivables_pr2_settlement`, version 1, registered through `sql_shadow_schema_migrations`. Startup calls `ensureCanonicalReceivablesSettlementSchema()` immediately after the PR1 initializer. PR2 requires the registered and structurally present `canonical_receivables_pr1_schema` version 1 and fails clearly before PR2 DDL if that prerequisite is absent. The migration is additive, atomic, and idempotent, creates no financial rows, and does not register on failed DDL.

### PR2 production evidence

Production verification confirmed the following state without persisting any canonical business row:

| Evidence | Verified value |
|---|---:|
| PR2 merge commit | `ee2c1b6e1340acb3fc3149c6a39487a283db829c` |
| Migration identifier | `canonical_receivables_pr2_settlement` |
| Migration version | `1` |
| Migration order | `canonical_receivables_pr1_schema` v1, then `canonical_receivables_pr2_settlement` v1 |
| PR1 registration count | `1` |
| PR2 registration count | `1` |
| Repeated initializers | Both skipped; registration timestamps retained |
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

The release changed no legacy table schema or application data and performed no seed or backfill. Rollback-safe production constraint probes and the backend-aware Finance Production Smoke passed. The settlement repository and domain remain unreachable from production routes, workers, maintenance scripts, legacy payment/rental handlers, frontend modules, and Company Health/report readers. No production settlement read, write, API, or cutover exists.

**Tables:**

- `canonical_payments` — immutable confirmed receipt/refund/reversal events with RUB integer magnitudes, company/branch/client scope, external/idempotency identity, explicit status, internal-transfer marker, and linked reversal identity;
- `canonical_payment_allocations` — explicit payment-to-receivable allocations and append-only reversal rows with branch context, evidence, approval, idempotency, and correlation data;
- `canonical_receivable_adjustments` — positive-magnitude typed credit, debit, discount, penalty, correction, write-off, refund-effect, and reversal rows with explicit balance effect and approval evidence;
- `canonical_approval_requests` — shared pending/approved/rejected decisions with immutable final state, separate initiator/approver identity, timestamps, reason, correlation, and operation payload.

The legacy JSON `payments` and `payment_allocations` collections are not canonical inputs. They lack mandatory company, branch, currency, immutable receipt identity, integer minor-unit, and canonical-receivable target semantics. PR2 performs no import, seed, backfill, synchronization, or dual write from them.

**Implemented domain contract:**

- exact integer-minor-unit receivable outstanding and payment unapplied calculations;
- pending/rejected operations have no financial effect;
- confirmed allocation and adjustment effects are append-only and reversal-aware;
- cross-company and currency mismatch rejection;
- ordinary same-branch allocation exemption only for an exact document/reference match or explicit client instruction verified by an injected matching-evidence policy; an unverified caller claim remains approval-required;
- approval-required representation for ambiguous or cross-branch allocation;
- mandatory dual approval for refunds, adjustments, reversals, write-offs, post-allocation due-date changes, and posted-receivable cancellation;
- separation of duties, including denial of self-approval and non-user approvers;
- due-date operations preserve previous date/provenance in append-only audit evidence;
- cancellation with active, uncompensated allocation or adjustment effects requires compensating operations; compensated history remains retained.

**Repository:** `createCanonicalSettlementRepository()` exposes isolated, inactive infrastructure for canonical receipt creation; allocation request/approve/reject/reversal; adjustment request/approve/reject/reversal; refund request/approve/reversal; write-off request/approval; due-date request/approval; posted cancellation request/approval; scoped getters; and balance calculations. Every public query requires `companyId`. No production route, worker, existing payment/rental handler, frontend module, Company Health reader, or executable script imports the settlement domain or repository.

**Atomicity and concurrency:** balance-changing confirmation runs in a `better-sqlite3` immediate transaction. The transaction obtains SQLite's write lock before reading current balances, revalidates payment/receivable scope, currency, status, approval, and capacity, then confirms the append-only event and compare-and-swap increments payment/receivable versions. Database triggers independently reject direct over-allocation, over-settlement, invalid reversal, and refund-capacity writes. Competing writers serialize before confirmation; stale versions fail instead of overwriting or silently clamping a conflict.

**Reversal chains:** allocation and adjustment originals may have at most one pending or confirmed reversal. Allocation reversals and adjustment reversal rows cannot themselves be reversed; reversal-of-reversal is fail-closed. A confirmed refund may be reversed exactly once because refund reversal is an explicitly approved payment event, while a refund-reversal row cannot be reversed again.

**D-25 implementation:** numerical and age thresholds remain absent. The approved temporary D-25 domain policy is implemented in PR2 infrastructure at the domain, schema, and repository layers. PR5 now supplies the released membership, role-template, capability, company/branch-scope, and fail-closed authorization foundation. Concrete production identity records and approval assignments remain absent, so production use remains disabled; PR6 cannot create or activate those records. Capability and matching-evidence policies are accepted as injected trusted-server context rather than read from a global session or caller assertion. Approval request identity and payload snapshots are immutable and bind operation type, aggregate, amount, currency, targets, branches, evidence/support, correlation, and operation-specific fields before confirmation.

**Audit:** settlement operations append the required `payment_recorded`, allocation, adjustment, refund, write-off, due-date-change, and cancellation request/approval/rejection/reversal event types to `financial_audit_events`. Payloads retain correlation and approval references, previous/new values where applicable, and reject secret-bearing keys. Existing audit update/delete/replace protection remains unchanged.

**Rollback:** revert the PR2 code and retain the unused additive tables. Physical removal is permitted only offline after a verified backup and explicit confirmation that all four PR2 tables are empty; otherwise retain all append-only financial and audit history.

**Deferred:** production settlement APIs, routes, workers, role lookup, tenant/RBAC enforcement, real user approvals, backfill, dual write, legacy integration, Company Health/report reads, canonical production read/write switching, monetary/age thresholds, settlement enablement, and cutover remain deferred. PR3 supplies released but default-disabled read infrastructure as recorded below; PR4–PR8 dependencies remain in force.

## PR3 release record

**PR3: RELEASED — read-only canonical receivables API and aging infrastructure only.**

Implementation PR [#205](https://github.com/rishatkznAI/rental-management/pull/205) had head `a4f46760c75d11989c74225f23891418cdb62de2` and merged as `6a38582f5f90b85734884b6b12ad8e306b24619e`. The release verification below confirms only the isolated, default-disabled read layer; it does not enable canonical production behavior.

PR3 adds an isolated canonical query/read side backed only by the eight PR1/PR2 normalized tables. It implements exactly these read-only endpoints:

- `GET /api/receivables`;
- `GET /api/receivables/:id`;
- `GET /api/receivables/summary`;
- `GET /api/receivables/aging`.

The endpoints are guarded by `CANONICAL_RECEIVABLES_READ_API_ENABLED`, which defaults to disabled. Enabling route registration is not sufficient to grant access: the production trusted-scope resolver remains unconditional `null`, so the route fails closed with `403` after authentication and before data access. The released PR5 foundation does not populate production identity records or connect a production resolver, and PR6 may not enable the API or resolver. Administrator status alone is not a substitute. Cursor pagination is signed with server-side `CANONICAL_RECEIVABLES_CURSOR_SECRET` configuration when the API is enabled.

The read repository exposes only a read-snapshot entrypoint. It never exposes PR2 mutation methods to HTTP code and imports no legacy Finance or `app_data` semantics. Balance projection reuses the pure PR2 settlement arithmetic, applies only confirmed effective canonical events, preserves allocation/adjustment reversal effects, and fails on unsafe integer or reconciliation errors. Historical due-date aging reads a complete, chronologically reconciled chain of append-only `due_date_change_approved` evidence valid at the requested company-local as-of point; malformed, duplicate, conflicting, or incomplete evidence fails without financial output. Aging uses `calculationVersion: "receivables-aging-v1"`, company IANA civil dates, the approved exclusive buckets and precedence, and all three exact minor-unit reconciliation equations. List, summary, aging, payment, and allocation scans stay inside one SQLite read snapshot and use bounded keyset batches (200 aggregate entities/effects, with a 201-row list lookahead). Enabled route registration requires a non-default cursor HMAC secret of at least 32 bytes.

### PR3 production release evidence

| Evidence | Verified value |
|---|---|
| PR3 implementation PR / head / merge | [#205](https://github.com/rishatkznAI/rental-management/pull/205); `a4f46760c75d11989c74225f23891418cdb62de2`; `6a38582f5f90b85734884b6b12ad8e306b24619e` |
| Railway production backend deployment | `b74623ec-d20d-4c50-ab40-0e0a494c5bc5`, `SUCCESS`, backend `6a38582f5f90b85734884b6b12ad8e306b24619e` |
| Smoke-contract correction | PR [#206](https://github.com/rishatkznAI/rental-management/pull/206), merge `7fed3e49ca77bc3c9db2c587a6cdc06f579a3196` |
| Merged-main Staging Smoke | [run 29399559743](https://github.com/rishatkznAI/rental-management/actions/runs/29399559743), `success`, head `7fed3e49ca77bc3c9db2c587a6cdc06f579a3196` |
| Release-tooling correction | PR [#207](https://github.com/rishatkznAI/rental-management/pull/207), merge `e5e516da92216830be42ef25fa0e5ca6681379e4` |
| GitHub Pages deployment and post-deploy gate | [run 29402545157](https://github.com/rishatkznAI/rental-management/actions/runs/29402545157), `deploy-tooling`, `success` |
| Production frontend marker | `e5e516da92216830be42ef25fa0e5ca6681379e4`, release type `deploy-tooling`, production API target matched |
| Production backend marker and drift contract | `6a38582f5f90b85734884b6b12ad8e306b24619e`; backend drift explicitly allowed and reported for `deploy-tooling` |
| Production health / readiness / version | `/health` `200`; `/health/ready` `200`; `/api/version` `200` |
| Dashboard / Company Health smoke | [run 29403203787](https://github.com/rishatkznAI/rental-management/actions/runs/29403203787), `success`; desktop/tablet/mobile passed; Company Health stayed on its existing path; Risks reported derived, not canonical, aging; console/page/API errors `0` |
| Finance smoke | [run 29403203743](https://github.com/rishatkznAI/rental-management/actions/runs/29403203743), `success`, read-only Finance path passed |
| Feature flag / route | `CANONICAL_RECEIVABLES_READ_API_ENABLED` absent and therefore default-disabled; `/api/receivables` returned `404` |
| Trusted scope | Unmapped and fail-closed; production resolver returns no trusted canonical scope |
| Canonical table counts | `canonical_companies=0`; `canonical_branches=0`; `canonical_receivables=0`; `financial_audit_events=0`; `canonical_payments=0`; `canonical_payment_allocations=0`; `canonical_receivable_adjustments=0`; `canonical_approval_requests=0` |
| Migration registrations | Only `canonical_receivables_pr1_schema` v1 (`2026-07-14 05:19:11`) and `canonical_receivables_pr2_settlement` v1 (`2026-07-14 18:42:21`); no duplicates and no PR3 migration |
| Foreign-key evidence | `PRAGMA foreign_key_check` returned `0` violations |
| Mutation evidence | No seed, backfill, dual write, canonical write, or settlement API; legacy business collection timestamps remained pre-release and no financial record was created by verification |

The `RELEASED` status covers only the isolated canonical read layer, the four GET endpoints listed above, `receivables-aging-v1`, and its default-disabled infrastructure. It does not mean that the production API is enabled, that production reads use canonical data, that Finance or Company Health/Risks have switched, or that settlement, write capability, backfill, dual write, cutover, or PR6 is complete.

The canonical tables remain empty unless tests explicitly create isolated temporary-database fixtures. Consequently an authorized injected test scope over an empty ledger returns canonical empty/zero list, summary, and aging results with `reconciled: true`; it never falls back to legacy rentals, payments, documents, clients, plans, or Finance totals. There is no migration, seed, backfill, posting, settlement write API, dual write, frontend change, Finance switch, Company Health/Risks switch, or production canonical read cutover in PR3.

Production behavior remains unchanged because the feature flag defaults to disabled and the production trusted-scope boundary remains unmapped. Rollback is flag disablement or code revert; no data rollback is required. The PR3 sequence dependency is satisfied, but PR4 may proceed only as a separate design stage after an approved backfill/reconciliation strategy and company/branch/RUB mappings exist. PR6, PR7, and PR8 gates remain unchanged.

The PR labels and future dependencies inside the PR1–PR3 implementation/release records above are preserved as contemporaneous release evidence. They do not govern prospective work after the 2026-07-15 decisions. The PR4–PR12 sequence in sections 15–16 supersedes those historical future-sequence references without changing the released scope, evidence, or behavior of PR1–PR3.

## PR4 actual-versus-forecast design gate

**PR4: DESIGN APPROVED — IMPLEMENTATION NOT STARTED.** The approved bounded-context architecture, repository audit, conceptual records, mappings, failure modes, owner-decision matrix, and external-confirmation checklist are in `docs/canonical-receivables-pr4-design-gate.md`. Approval covers the architecture, exact revised sequence, and named PR5 scope-authority/RBAC decisions; every other item still marked `OWNER APPROVAL REQUIRED` remains unresolved. PR4 is not released, and this approval is not an implementation or production-enablement authorization.

An **actual receivable** may become eligible only when both conditions are independently proven:

1. the relevant rental billing period is closed; and
2. the matching UPD is formed and explicitly conducted.

An active/open rental period, preliminary calculation, forecast, expected payment date, rental end date, draft UPD, sent UPD, or signed UPD is insufficient unless the source also independently records explicit conducted status. Signed never means conducted. A rental or document total by itself is not canonical debt. The approved PR4 details fix the named granularity, cardinality, unknown-date, branch-ownership, mismatch, return-line, correction, and forward-only boundaries. Concrete identity authority, memberships/capabilities, conducted/source evidence, proven-date evidence, exact money/VAT/rounding, compensation, activation date/cohort, and remaining operational authority still fail closed until their stage-specific approvals/confirmations exist.

A **forecast** is a separate, replaceable planning result. It never enters canonical receivables, balance, aging, overdue, collection, settlement, or accounting totals; never automatically converts to actual; and never becomes canonical debt. Each result must carry `calculatedAt`, horizon, amount, confidence/reasons, calculation version and lineage, and effective-term inputs. The three separately visible lanes, the “closed billing without conducted UPD” display, and the `actual outstanding + closed unbilled + open-period forecast` equation are approved. Exact one-slice coverage precedence/key enforcement remains `OWNER APPROVAL REQUIRED`.

PR4 records the approved forward-only coverage boundary: only fully source-governed periods may participate, with no partial-period or historical import. No historical backfill, migration, dual write, or legacy normalization is approved. Existing Finance and Company Health paths remain unchanged. PR1–PR3 release evidence remains authoritative and all eight canonical tables remain empty under the recorded production evidence.

## PR5 release record

**PR5: RELEASED — neutral platform identity and fail-closed authorization foundation only.**

Implementation PR [#210](https://github.com/rishatkznAI/rental-management/pull/210), reviewed head `f2c3b7230f81be874ed46b3e4c243fa6e686f963`, was squash-merged as `35aa9891e389ab7de114475f7012d737d1165695` on 2026-07-17. Its required `lightweight-pr-check` completed successfully, and the final independent review reported P0/P1/P2 findings of `0/0/0`.

The released migration is `platform_identity_pr5` version 1. The only physical company and branch roots remain `canonical_companies` and `canonical_branches`; no separate editable `companies` or `branches` authority exists. Existing canonical child tables were not rebuilt and their foreign keys were not rebound. The server-authoritative capability catalog contains exactly 11 entries. Repository-owned transactional revalidation is mandatory for controlled bootstrap apply, and the bootstrap-plan input boundary is inert before the transaction.

Release marks code and architecture only. Production bootstrap was not run; production identity records and canonical financial rows were not created; deployment and cutover were not performed. The production canonical resolver remains unconditional `null`. The feature flag alone remains fail-closed with `403`, and canonical production reads and writes remain disabled.

PR6 may now begin only as **Billing Source Authority**, limited to:

- closed billing periods;
- immutable billing snapshots;
- an explicit conducted-UPD lifecycle;
- stable UPD line IDs;
- deterministic line-to-period mappings.

PR6 may not:

- create canonical receivables or perform any canonical write;
- enable the canonical read API;
- switch Finance or Company Health;
- run production bootstrap;
- implement PR7.

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
20. **What can be safely backfilled?** Nothing under the current program: no historical backfill is approved. Stable IDs and explicit links were previously identified only as possible inputs to a separately approved future migration project; even then contractual dates, scope, source authority, or allocations could never be invented. Rental-derived amounts cannot become authoritative or age-eligible solely because a rental ID/amount exists.

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

Use dedicated normalized SQLite tables for canonical financial records. Existing legacy `app_data` collections remain untouched during the forward-only program; no dual write is permitted. This boundary is driven by P0 invariants: JSON collection replacement cannot reliably provide row-level foreign keys, unique source identities, compare-and-swap versions, or atomic allocation caps.

Every canonical financial table uses a stable opaque ID (UUID/ULID or existing project-standard generated ID), mandatory `companyId`, mandatory branch context, UTC timestamps, an integer `version`, and database constraints. IDs are never recycled. The approved company authority must supply a required IANA receivables timezone; no company, branch, membership, or timezone may be inferred or hardcoded. The initial release recognizes only `RUB` as a transaction currency.

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
| `sourceDocumentType` | enum/text, required | Future projection must identify the approved conducted-UPD source type and version. A rental, period, forecast, draft/sent/signed-only document, or generic posted label is forbidden as sufficient source. |
| `sourceDocumentId` | text, required | Immutable source ID in its source system. |
| `sourceLineId` | text, nullable | Stable invoice/source line or schedule-line identity. |
| `sourceSystem` | text, required | `skytech`, accounting integration name, bank/import source, etc. |
| `externalId` | text, nullable | External receivable ID; unique within company/source system when present. |
| `idempotencyKey` | text, required | Key that produced this receivable; stored with request hash/result. |
| `currency` | `CHAR(3)`, required | Must be `RUB` in the initial release; immutable after posting. |
| `originalAmountMinor` | integer, required, `> 0` | Editable in draft; immutable after posting. |
| `issuedAt` | RFC 3339 instant, nullable | Source issuance instant when distinct from posting. |
| `postedAt` | RFC 3339 instant, required for `posted`/`disputed`/`written_off` | Canonical posting instant after independently proving closed period plus explicit UPD conduct; never inferred from signature or rental dates. |
| `contractualDueDate` | `YYYY-MM-DD`, nullable | Civil date in company calendar. Never inferred silently. |
| `dueDateProvenance` | enum, required | Defined in section 7. |
| `companyTimezone` | IANA zone, required after posting | Immutable aging snapshot copied server-side from the owning company's timezone. The company setting remains authoritative for new postings. |
| `status` | enum, required | Stored lifecycle: `draft`, `posted`, `disputed`, `cancelled`, `written_off`. |
| `cancellationReason` | text, nullable | Required only for `cancelled`; cancellation preserves source and financial history. |
| `description` | text, nullable | Optional human-readable, non-identity label. |
| `createdAt`, `updatedAt` | UTC instants, required | Server generated. |
| `cancelledAt`, `closedAt`, `writtenOffAt` | UTC instants, nullable | Lifecycle timestamps; `writtenOffAt` is set only when a full approved write-off moves stored status to `written_off`, while partial write-off remains an adjustment. `closedAt` is schema foundation only in PR1 and does not add a persisted `closed` workflow state. |
| `version` | integer, required | Optimistic concurrency; starts at 1 and increments on permitted metadata/lifecycle changes. |

**Original amount decision:** `originalAmountMinor` is immutable once status leaves `draft`. A posted amount correction uses a typed adjustment. Cancellation/replacement is allowed only through a dedicated workflow that preserves both records and source relationships.

### 3.3 Installment decision

Do not create a separate `receivable_installments` table in the initial release. Each contractual due date is independently aged and therefore becomes its own `Receivable`.

For a three-installment invoice, create three receivables sharing `companyId`, `clientId`, `sourceDocumentType`, and `sourceDocumentId`, with distinct `sourceLineId` values (or a deterministic installment line such as `installment:1`). Each has its own amount, due date, allocations, adjustments, lifecycle, and aging bucket.

This model is preferred because current AR requirements do not prove a need for a parent balance that can be allocated separately from installments. It prevents a single receivable from appearing in several buckets and avoids allocation ambiguity. A future presentation-only `obligationGroupId` may group installments without becoming a settlement target.

If product later requires a parent obligation entity, it must remain non-ageable and its amount must equal the sum of child receivables; allocations still target exactly one child receivable.

### 3.4 Payment

The existing JSON `payments` collection cannot remain canonical unchanged because it mixes amount-due, schedule, and cash-receipt semantics. It remains on the unchanged legacy path until a separately approved settlement integration; it is never dual-written by this sequence. The canonical payment table uses:

| Field | Type / nullability | Contract |
|---|---|---|
| `id` | text, required, PK | Immutable payment/refund ID. |
| `companyId` | text, required | Immutable company scope. |
| `branchId` | text, required | Receipt-owning branch; company-wide receipts use the Head Office branch. |
| `clientId` | text, required | Payer/client ID; counterparty ID may be added if payer differs. |
| `kind` | enum, required | `receipt`, `refund`, or `reversal`; refund/reversal rows are append-only events linked to the original receipt. |
| `currency` | `CHAR(3)`, required | Immutable and must match every allocation. |
| `receivedAmountMinor` | integer, required | Positive magnitude for every receipt/refund/reversal payment event; direction comes from `paymentKind`. |
| `refundAmountMinor` | integer, required | Positive and equal to `receivedAmountMinor` for `refund`/`reversal`; zero for `receipt`. No signed money. |
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
| `posted` | Closed billing period plus explicitly conducted UPD eligibility was proven; original amount is frozen | Eligible when date provenance is accepted |
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
| `draft` | `posted` | The relevant billing period is closed, the mapped UPD is formed and explicitly conducted, and every required field/evidence rule is valid; freezes source identity, currency, company, branch, client, and original amount. |
| `draft` | `cancelled` | No financial postings; cancellation reason audited. |
| `posted` | `disputed` | Authorized actor and reason. No balance mutation. |
| `disputed` | `posted` | Resolution actor/reason audited. |
| `posted` / `disputed` | `cancelled` | Dedicated cancellation posts a full credit adjustment in the same transaction; allocation handling is resolved first. |
| `posted` / `disputed` | `written_off` | A fully approved write-off reduces outstanding to zero; reason, approval, and event are mandatory. |
| `written_off` | prior `posted` / `disputed` state | Only an approved append-only compensating event that reverses the write-off may restore positive outstanding; prior workflow state and complete audit are required. |

Forbidden transitions/actions:

- posting without a company, branch, client, RUB currency, positive amount, closed-period evidence, explicit conducted-UPD evidence, stable mapped source-line identity, company timezone, and idempotency key;
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
| `migrated_verified` | Reserved historical value from the approved baseline; no current migration may create it | Eligible only for already-authorized immutable evidence; otherwise fail closed |
| `unknown` | No proven contractual date; retained without inventing a date | Not canonical for aging and receives no numeric bucket |

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

#### 8.3.1 Temporary D-25 initial-release authority policy

This policy is approved for PR2 domain implementation and the initial release. The released PR5 authorization foundation does not by itself authorize production operations; production identity state, operation-specific enforcement, and separate enablement approval remain required.

1. **Ordinary payment allocation**
   - An accountant may create the allocation.
   - Dual approval is not required only when payment and receivable belong to the same company, currencies match, the allocation exceeds neither payment balance nor receivable outstanding, and there is an exact document/reference match or explicit client instruction.
   - Manual allocation without clear matching requires finance-manager confirmation.
2. **Cross-branch allocation**
   - An accountant initiates and a finance manager approves every cross-branch allocation.
   - Cross-company allocation is forbidden.
3. **Refund**
   - Every refund requires dual approval: an accountant or finance manager initiates, and another finance-authorized user approves.
   - The initiator cannot approve the same operation.
4. **Credit/debit adjustment**
   - Every credit or debit adjustment requires dual approval.
   - An explicit type and reason are mandatory, and the original posted financial event is never edited.
5. **Reversal/correction**
   - Every reversal or correction requires dual approval, references the original event, and is an append-only compensating event.
6. **Write-off**
   - Every write-off requires dual approval, with at least one approver being the finance owner or commercial/product owner.
   - A reason and supporting document reference are mandatory; automatic write-off is forbidden.
7. **Contractual due-date change**
   - Before any payment allocation, an accountant or finance manager may initiate the change and an audit reason is mandatory.
   - After any payment allocation, every change requires dual approval.
   - A retroactive change preserves the previous value in the audit log.
8. **Cancellation of a posted receivable**
   - Every cancellation requires dual approval.
   - If allocations or adjustments exist, direct cancellation is forbidden and compensating operations are required.
9. **Separation of duties**
   - Initiator and approver must be different users, and system/integration events cannot self-approve sensitive operations.
   - Every approval records `initiatorId`, `approverId`, `requestedAt`, `approvedAt`, `reason`, and `correlationId`.
10. **Temporary-policy status**
    - This is the approved initial-release policy. Monetary and age thresholds remain deferred.
    - Future threshold changes require a separate product-owner decision and must not weaken auditability or separation of duties.

Migration cutover continues to require both product-owner and finance-owner approval.

Admin status alone must not bypass company membership. Carrier, mechanic, bot-only carrier, and investor roles receive no client receivable/payment detail unless an explicit approved capability says otherwise. Existing frontend checks remain UX only.

## 9. Proposed API contract

PR3 implements only the four read endpoints in section 9.3 behind the default-disabled and fail-closed boundary recorded above. The write endpoints in sections 9.4 and 9.5 remain future contract and are not exposed.

### 9.1 Common conventions

- Base paths use `/api/receivables`, `/api/payments`, `/api/payment-allocations`, and `/api/receivable-adjustments`.
- Money is JSON integer minor units only.
- Civil dates are `YYYY-MM-DD`; instants are RFC 3339 UTC; timezone is an IANA name.
- Write requests require `Idempotency-Key`; the persisted request hash must match on replay.
- Mutable metadata/lifecycle writes require `If-Match` or body `version`.
- List pagination is cursor-based, deterministic by `(createdAt,id)`; default 50, maximum 200.
- PR3 response records contain canonical IDs and persisted canonical description only; they do not read legacy collections for display labels. A later approved scoped display-label join must still group and join by stable IDs.
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

Posted receivables and confirmed financial events are never physically deleted; corrections are append-only compensating events. Financial records and financial audit events are retained indefinitely. No delete, purge, TTL, scheduled cleanup, rollback deletion, or invented finite retention period is permitted. Accountant/legal confirmation is still required for legal hold, export, access, tamper evidence, and privacy controls, but lack of those details does not authorize deletion.

## 12. Forward-only activation and migration boundary

The forward-only coverage rule is approved: only periods fully governed by the new source authority may participate, and partial-period or historical import is forbidden. The exact activation date/cohort remains `OWNER APPROVAL REQUIRED`. This supersedes the former plan to backfill historical rental, document, receivable, payment, or allocation records.

- no historical backfill is approved;
- no migration of existing business records into canonical receivables is approved;
- no dual write is approved;
- no legacy record may be normalized, relinked, rewritten, or deleted for this program;
- no actual receivable may be created from a pre-activation event unless a future, separately approved migration decision explicitly authorizes it;
- forecast history is not a substitute for financial history and may not seed actual receivables;
- existing Finance, reports, and Company Health behavior remains unchanged until separately approved shadow-read and cutover stages;
- every future canonical write must originate after an explicit activation boundary and satisfy the then-approved source-authority contract.

### Activation safety requirements

Before any forward-only source projection can be enabled, the released PR5 foundation and the gated PR6–PR8 work must establish approved production trusted scope, immutable billing-period authority, conducted-UPD authority and stable UPD lines, deterministic mappings, effective commercial terms, integer-minor money/VAT/rounding policy, source versioning, correction semantics, and a dry-run discrepancy path that performs no writes. Unresolved or contradictory evidence is quarantined and produces no canonical receivable.

Rollback disables the relevant projector/read flag while retaining every financial and audit record indefinitely. Rollback never deletes canonical rows, source evidence, forecast lineage, quarantine records, or audit events. Backup/restore verification remains mandatory before any later schema or production-write stage, but PR4 itself creates no schema and touches no data.

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

PR1 implements focused schema, domain, isolation, audit, and runtime-boundary tests for its released additive foundation. PR2 implements focused settlement schema, balance, allocation, adjustment, refund, reversal, approval, SQLite locking/version, audit, migration, and runtime-boundary tests for its released but production-inactive foundation. PR3 implements focused default-disabled read and aging safety tests. PR5 implements focused platform-identity, transactional-bootstrap, capability, audit, and fail-closed trusted-scope tests. The remaining items below define future coverage for billing source authority, forecast isolation, forward-only activation, operation-specific production enforcement, and cutover:

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

### Forward-only activation and source projection

- activation boundary excludes pre-activation source events;
- rerun/replay produces zero duplicate receivables or forecast items;
- changed source hash and conflicting mapping quarantine;
- missing scope, client, period, UPD, line, due date, money, VAT, or term authority fails closed;
- a signed but not explicitly conducted UPD produces no actual receivable;
- an open period, closed-unbilled candidate, or forecast produces no canonical receivable;
- stable line-to-period mapping prevents document-total and line double count;
- exact dry-run discrepancy reports perform no writes;
- backup restore and feature-flag rollback retain all financial/audit records;
- a failed projection transaction leaves no partial financial state.

### API and audit

- schema validation, cursor pagination, filter allow-lists;
- integer money/date/timezone formats;
- 403/404 scope behavior, 409 conflict codes, 422 validation;
- optimistic version conflicts;
- idempotency replay headers/body;
- every sensitive action creates complete actor/before/after/reason/request/source audit;
- audit retention/export/tamper controls once approved.

## 15. Decision baseline and remaining confirmations

The product owner approved D-01 through D-27 on 2026-07-13; clarified D-01, D-24, and the forecast-domain boundary on 2026-07-15; approved the PR4 design details on 2026-07-15; and then explicitly approved the PR4 bounded-context architecture, revised PR4–PR12 sequence, and remaining PR5-scoped identity/membership/capability/default-deny decisions. PR4 is `DESIGN APPROVED — IMPLEMENTATION NOT STARTED`, is not released, and authorizes no implementation or production behavior. Conceptual schema details and downstream decisions still marked `OWNER APPROVAL REQUIRED` remain unresolved.

Remaining conditional items are narrow and must not be filled by implementation assumptions:

| Item | Approved baseline | Still required | Blocks |
|---|---|---|---|
| D-01 source sufficiency | Actual only when the relevant billing period is closed **and** the matching UPD is formed and explicitly conducted; signed never implies conducted | Accountant/legal confirmation of the exact authoritative period/UPD statuses, evidence, date, and any additional signature requirement | PR6 source authority, PR8 source dry run, PR9 projection, and later cutover |
| Forecast boundary/details | Forecast remains planning-only. Three lanes/components, total equation, 30-day horizon, status allow-list, `planned_future`, confidence levels/reasons, indefinite history, separate advances, return-line boundary, and minimum-term/discount order are approved | Exact coverage precedence/key enforcement and authoritative downtime/extension/return input lifecycle; schema/API details | PR7 forecast implementation and PR11 consumers |
| Scope/RBAC | Revised sequence, neutral platform identity authority, stable branch semantics, stable memberships, explicit versioned capability model, and deny-by-default authorization are approved | PR5 implemented and verified the foundation by promoting the existing roots in place; production records, bootstrap, resolver connection, and enablement remain absent | PR5 **RELEASED — foundation only** |
| D-24 retention | Financial and audit records are retained indefinitely; deletion, purge, TTL, scheduled cleanup, and rollback deletion are forbidden | Accountant/legal confirmation of legal hold, export, access, privacy, and tamper-evidence controls; no finite duration may be invented | PR6 where financial/audit records are created, PR8/PR9, and later activation as relevant; not PR5 scope/RBAC or the separately approved PR7 forecast-history policy |
| D-25 approval policy | Mandatory dual approval is approved for refunds, credit/debit adjustments, reversals/corrections, write-offs, posted-receivable cancellations, post-allocation due-date changes, and cross-branch allocations; tightly constrained ordinary allocations follow the approved exception above | Monetary and age thresholds are deferred; concrete production users, memberships, roles, capabilities, and operation-specific enforcement remain required before production enablement | Future production authorization/operation integration; does not block released PR2 or PR5 foundations |

### 15.1 Implementation gate summary

| Gate | Outcome | Remaining condition |
|---|---|---|
| PR1 canonical schema/domain | **RELEASED** | Foundation only; production posting and canonical reads remain disabled |
| PR2 payments/allocations/adjustments | **RELEASED** | Settlement/domain foundation only; production settlement remains blocked despite the released PR5 foundation |
| PR3 read API/aging | **RELEASED — read-only infrastructure only** | Production flag and trusted scope remain disabled/unmapped; no production read switch |
| PR4 actual/forecast design gate | **DESIGN APPROVED — IMPLEMENTATION NOT STARTED** | Architecture, sequence, and named PR5 decisions approved; documentation only, not released, no production behavior |
| PR5 scope/RBAC | **RELEASED — FOUNDATION ONLY** | Neutral identity, branch, membership, capability, audit, and fail-closed model implemented; no production records, bootstrap, canonical reads/writes, or financial behavior |
| PR6 Billing Source Authority | **MAY BEGIN — SOURCE AUTHORITY ONLY** | Closed periods, immutable billing snapshots, explicit conducted-UPD lifecycle, stable UPD line IDs, and deterministic line-to-period mappings; no canonical writes, read enablement, product switch, bootstrap, or PR7 |
| PR7 forecast domain | **BLOCKED pending remaining forecast gates** | Exact lane precedence/coverage mechanics and downtime/extension/return authority; separate planning API/storage; no canonical writes or consumer switch |
| PR8 source dry run | **BLOCKED pending PR6 and actual-source gates** | Source sufficiency, proven-date evidence, exact money/VAT, mappings, activation date/cohort, idempotency, reconciliation, and zero-delta evidence; no writes/backfill |
| PR9 blocked canonical adapter | **BLOCKED pending PR8 and separate explicit owner authorization** | Forward-only, default-disabled canonical projection; no backfill and no dual write |
| PR10 settlement integration | **BLOCKED pending PR9** | Trusted production authorization and approved actual-receivable source projection |
| PR11 shadow reads | **BLOCKED pending PR9–PR10** | Read-only comparison with existing Finance/Company Health; no user-visible switch |
| PR12 cutover | **BLOCKED** | Accountant/legal confirmations, signed zero-unexplained-delta evidence, rollback proof, owner approval, and staged read enablement |

No gate outcome authorizes product behavior beyond its named PR scope. PR1, PR2, PR3, and PR5 RELEASED status covers only their recorded foundations; all remain outside canonical production business reads and writes.

### 15.2 Stage-specific readiness boundary

- **PR5 is released, foundation only.** The neutral company/branch authority, dedicated Head Office semantics, stable membership model, explicit capability model, append-only authorization audit, controlled bootstrap tooling, and deny-by-default authorization are implemented without enabling canonical production reads or writes.
- **PR6 may begin only as Billing Source Authority.** Its allowed scope is closed billing periods, immutable billing snapshots, an explicit conducted-UPD lifecycle, stable UPD line IDs, and deterministic line-to-period mappings. It remains gated by the applicable close/reopen, conducted-UPD, signature, mapping/granularity, VAT/rounding, correction/cancellation, return-source, and accountant/legal requirements.
- **PR7 remains blocked** only by its forecast-specific dependencies: three-lane coverage mechanics, forecast inputs/status/horizon/confidence/history/advances, and effective terms including minimum terms, discounts, downtime, extensions, and returns. Approved items are recorded; downtime/extension and exact return/coverage mechanics remain unresolved.
- **PR8 and PR9 remain blocked** by all actual-source sufficiency, reconciliation, exact activation, legal/accounting, idempotency/replay, and zero-unexplained-delta gates. PR9 additionally requires separate explicit canonical-write authorization.

PR6 may not create canonical receivables, perform canonical writes, enable the canonical read API, switch Finance or Company Health, run production bootstrap, or implement PR7. Future canonical posting and settlement capabilities remain inactive and require their own later gates.

## 16. Recommended implementation PR sequence

This prospective dependency order is **APPROVED — 2026-07-15** exactly as documented. Sequence approval does not authorize implementation or enablement.

| PR | Scope | Write/read boundary | Exit gate |
|---|---|---|---|
| PR1 | Canonical receivable schema/domain foundation | **RELEASED**; empty additive tables, no production behavior | Preserved release evidence |
| PR2 | Payment/allocation/adjustment foundation | **RELEASED**; isolated, no production settlement | Preserved release evidence |
| PR3 | Read-only canonical API/aging foundation | **RELEASED**; default-disabled, trusted scope null/fail-closed | Preserved release evidence |
| PR4 | Actual-versus-forecast architecture and design gate | Documentation only; no code/schema/data/config/runtime changes | `DESIGN APPROVED — IMPLEMENTATION NOT STARTED`; merge completes the documentation gate, not a release |
| PR5 | Scope, membership, neutral company/branch authority, and RBAC | **RELEASED** foundation only; no financial activation and no canonical production reads/writes | Released as `35aa9891e389ab7de114475f7012d737d1165695`; production resolver remains null and bootstrap was not run |
| PR6 | Closed billing period, conducted UPD, stable lines, mapping, commercial-term, due-date, money/VAT, correction, and audit source authority | Source facts only; no canonical projection | Authoritative lifecycle and evidence contract approved |
| PR7 | Separate forecast domain | Planning-only writes/reads; cannot reference canonical write adapters | Isolation, lineage, confidence/reasons, and replacement semantics approved |
| PR8 | Source-authority dry run and discrepancy/quarantine reporting | Strictly no canonical or legacy writes | Deterministic zero-duplicate evidence and classified discrepancies approved |
| PR9 | Forward-only canonical projection adapter | Default-disabled and blocked; no backfill, no dual write | Owner-controlled activation boundary and rollback proof |
| PR10 | Settlement integration | Uses only eligible actual canonical receivables | Authorization, idempotency, allocation, reversal, and audit gates pass |
| PR11 | Finance and Company Health shadow reads | Comparison only; existing user-visible paths unchanged | Signed zero-unexplained-delta results and performance evidence |
| PR12 | Staged production read cutover | Feature-flagged cohort rollout | Explicit owner/accountant/legal approval and rollback drill |

Legacy logic retirement is a separate later decision after an approved monitoring period. It is not part of PR12. No stage in this sequence authorizes dual write or historical backfill.

## 17. Risk register

| Priority | Risk | Consequence | Required mitigation / gate |
|---|---|---|---|
| P0 | No current company/branch keys | Cross-tenant financial disclosure or settlement | Approved scope authority/mapping, DB constraints, endpoint predicates, and security tests before any canonical read/write; no financial-history backfill |
| P0 | Wrong source document creates receivable | Legally false debt | Owner-approved source/status contract; immutable source identity; quarantine conflicts |
| P0 | Unproven due dates enter aging | False overdue/current reporting and Company Health score | Provenance allow-list; unknown exclusion; evidence/audit; no rental/payment-date fallback |
| P0 | Allocation race/over-allocation | Incorrect outstanding and client balance | One transaction, capacity/outstanding locks/checks, idempotency, concurrency tests |
| P0 | Floating-point operational source is projected without an approved conversion | Non-reconciling balances | Versioned decimal-to-integer-minor conversion, precision quarantine, and exact reports |
| P0 | Duplicate source/import events | Double debt or receipt | Company-scoped source/external/idempotency unique constraints and conflict quarantine |
| P0 | Refund/reversal double effect | Debt restored or cash reduced twice | Explicit event relationships and ordered allocation reversal/refund rules |
| P1 | Rental-derived amount later changes | Canonical amount drifts from source | Freeze posted amount; adjustments/cancel-reissue only; source version/hash |
| P1 | Physical deletion of legacy/source evidence | Eligibility and reconciliation cannot be reproduced | Indefinite financial retention, protected source snapshots/export, no-delete rules, and audit evidence |
| P1 | Existing audit truncation/redaction | Incomplete financial history | Dedicated append-only financial audit with retention/tamper policy |
| P1 | Dispute/write-off semantics differ by team | Metrics and collection workflow disagree | Owner-approved classification and approval matrix; separate financial/workflow states |
| P1 | No receipt date for legacy payments | False cash period and allocation timing | Keep outside future settlement integration; do not infer `paidDate` from `dueDate` |
| P1 | Legacy name fallbacks mislink clients | History assigned to wrong client | Stable ID only; guarded one-candidate recovery with ambiguity log |
| P0 | Legacy/canonical dual write is introduced | Divergent financial authorities | Dual write is forbidden; use a separately approved, idempotent, forward-only source-event projector |
| P2 | Currency expansion without FX model | Invalid cross-currency totals | Per-currency reports, allocation match, FX explicitly disabled until designed |

## 18. Explicit non-goals

This contract update and the PR4 design gate do not:

- implement a receivable write route, production posting service, read endpoint, or UI;
- change existing payment, allocation, rental, document, finance, Company Health, Risks, or aging behavior;
- declare current rental billing to be a legal invoice;
- promote `expectedPaymentDate`, rental `endDate`, payment `dueDate`, or collection promises to contractual dates;
- invent still-unconfirmed source evidence/types, change indefinite retention, or supply financial approval thresholds;
- design general ledger accounting, tax accounting, bank reconciliation, revenue recognition, accounts payable, payroll, or leasing payable changes;
- design foreign-exchange conversion;
- create a client-credit wallet beyond reporting unallocated payment balance;
- replace debt-collection/legal workflow records;
- backfill or normalize production data;
- enable a production read/write path or authorize a production cutover beyond the proposed PR sequence.

Until the canonical tables, scope, source, date provenance, reconciliation, and cutover gates are implemented and approved, Company Health must continue its released behavior: unknown contractual dates remain outside numeric aging.
