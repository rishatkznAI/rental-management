# PR6 Billing Source Authority audit

## Status and implementation base

- Final foundation status: **PR6: RELEASED — Billing Source Authority foundation only.**
- Implementation PR: [#212](https://github.com/rishatkznAI/rental-management/pull/212), squash-merged at `2026-07-18T03:52:54Z`.
- Final independently reviewed implementation head: `b2687e5c5c75caf21cf1d5659f687fcf2ba90f89`.
- Released squash commit and resulting `origin/main`: `485808d24b8c5f6481e0520eec5c8985b71ffeab`.
- Release-marker date: 2026-07-18.
- Migration and scope: `billing_source_authority_pr6`, version `1`; exactly 16 append-only source-authority tables.
- Remediation finding: **P1 coverage lifecycle — fixed, independently re-reviewed, and included in the released foundation**.
- Remediation finding: **P1 caller-provided `evidenceSetHash` — fixed, independently re-reviewed, and included in the released foundation**.
- CI evidence: `lightweight-pr-check` succeeded for the final reviewed head ([run 29616760318](https://github.com/rishatkznAI/rental-management/actions/runs/29616760318)).
- Previous reviewed PR head: `5f4be8aaad3d53434fad230a65f3fee8a64b3920`.
- Actual remediation starting head after fetch: `5f4be8aaad3d53434fad230a65f3fee8a64b3920`.
- Prompt baseline: `030b140fa767f4c2ff16b3f9910a46e12b94e485`.
- Actual starting `origin/main`: `030b140fa767f4c2ff16b3f9910a46e12b94e485`.
- Baseline difference: none.
- Worktree: `/private/tmp/rental-management-pr6`.
- Branch: `codex/pr6-billing-source-authority`.
- PR1: **RELEASED**, schema/domain foundation only.
- PR2: **RELEASED**, settlement/domain foundation only.
- PR3: **RELEASED**, default-disabled read-only infrastructure only.
- PR4: **DESIGN APPROVED**, historical design gate, not released.
- PR5: **RELEASED**, neutral platform identity and fail-closed authorization foundation only.
- **PR6: RELEASED — Billing Source Authority foundation only.**

The original implementation starting SHA was verified after `git fetch origin --prune`; the isolated worktree started clean at that exact SHA. During remediation, PR #212 and the remote branch were re-fetched, and the then-current PR head exactly matched the previous reviewed head above. Final release review independently inspected the complete `origin/main...b2687e5c...` diff, verified that PR #212 still contained only the two expected implementation/remediation commits, reran the full Node 20 matrix, and squash-merged that exact head. No production bootstrap, canonical write, resolver wiring, feature enablement, deployment, forecast, or PR7 implementation was introduced.

## Actual repository audit

### Mutable Rental Operations

`rentals` and `gantt_rentals` remain mutable JSON collections in SQLite `app_data`. A classic rental can carry an `equipment` array and legacy records can also expose `equipmentId`, `equipmentIds`, inventory references, or labels. Gantt rows have their own IDs and use guarded legacy linkage fields and recovery logic to connect to a rental. The application supports one rental referring to multiple equipment items, but there is no normalized, immutable rental-line entity.

Rates and prices are operational strings/numbers (`rate`, `price`, daily-rate fields); discounts and calculated amounts use JavaScript numbers. Existing billing derives calendar/billable days and amounts, including `Math.round`, from mutable rental dates and downtime. The document `rentalBillingSnapshot`/`billingSnapshot` is embedded JSON with generated time, day counts, daily rate, gross amount, downtime adjustment, final amount, and downtime details; it is not an immutable accounting snapshot.

Extensions update operational dates and amount-related state and retain mutable history. Return handling changes rental/equipment operational state; legacy records do not provide an authoritative stable line-level partial/full-return event contract. Downtime periods are mutable operational records with `active`, `closed`, or `cancelled` state and optional `affectsBilling`; their financial authority and precedence against extensions and returns are unresolved.

### Mutable generic Documents

`documents` remains mutable JSON in `app_data`. Create and generate operations can persist generic records and generated payload/snapshot content; PATCH can replace mutable fields; mark-sent and mark-signed mutate status; DELETE removes the JSON record. Known statuses include `draft`, `sent`, `pending_signature`, `signed`, `expired`, and `cancelled`. `signed` and `sent` are document workflow labels, not an accounting conducted event.

`type: upd` is only a generic type discriminator. Generated `payload.lines` are presentation rows and do not have an authoritative stable immutable line identity or content-version lineage. Document amount, VAT fields, generic `rentalBillingSnapshot`, `expectedPaymentDate`, filenames/scans, and client/equipment labels do not prove source authority. Company tax settings contain mutable tax regime/VAT defaults, but they do not establish an approved immutable VAT selection or rounding policy.

### Missing source entities before PR6

Before this implementation there was no normalized authority for stable rental lines, effective term versions, contractual billing-period identity, append-only close/reopen events, immutable financial snapshots/evidence, explicit formed/conducted UPD versions, stable UPD line identities/content versions, persisted coverage slices, source-command idempotency, or relational source audit.

### PR5 foundations reused unchanged

PR6 reuses the sole physical `canonical_companies` and `canonical_branches` roots, `platform_company_memberships`, membership branch access, versioned role templates and capability catalog, explicit grants/denies, trusted-scope branding/freshness assertions, and concrete branch materialization. The existing catalog remains exactly 11 capabilities. No second company/branch authority, role model, capability table, display-role inference, or Administrator bypass was added.

Every mutation re-reads live legacy user state and relational membership/role/catalog state inside a repository-owned immediate transaction, calls PR5 freshness validation, checks the exact capability, company, concrete branch, active branch, referenced rows, expected versions, lineage, overlap, coverage, and idempotency before writing. User-supplied scope is never authority. Integration/system actors remain unavailable.

### Legacy behavior deliberately disconnected

Legacy rental, gantt, downtime, extension, return, generic-document, Finance, Company Health/Risks, and frontend flows are unchanged and do not call PR6. A generic signed or sent UPD does not create PR6 data. PR6 does not read `app_data` as a fallback source in its inspection repository and does not convert legacy snapshots, rows, or labels into authority.

## Bounded contexts

- **Mutable Rental Operations** continues to own rentals, gantt scheduling, equipment linkage, operational rates, extensions, returns, downtime, and derived billing.
- **Billing Source Authority** owns stable rental-line identity, activation-boundary references, effective term versions, contractual period identity, append-only period versions, immutable snapshots/evidence, and explicit integrity blockers.
- **Document / UPD Source Authority** owns stable UPD identity, append-only formed/conducted/corrected/cancelled versions, stable line identity/content versions, and persisted coverage mapping. It is independent of generic documents.
- **Canonical Actual Receivables** remains the isolated PR1–PR3 context. PR6 performs no canonical mutation or switch.
- **Forecast Receivables Planning** remains a future PR7 context. PR6 creates, reads, and calculates no forecast.

## Migration and logical model

Migration `billing_source_authority_pr6`, version `1`, runs immediately after `platform_identity_pr5` in `server/db.js`. It requires registered and structurally exact PR1 v1, PR2 v1, and PR5 v1 foundations, the exact PR5 capability catalog, the sole physical company/branch roots, foreign keys enabled, and zero canonical financial rows on first application. Competing identity roots, prerequisite drift, registered-incomplete state, or unregistered partial PR6 objects fail closed.

All PR6 DDL and the migration registration execute in one immediate transaction. The registry row is inserted last after `PRAGMA foreign_key_check`; a failed native DDL statement rolls back every PR6 object. Repeated initialization verifies the complete schema and returns a no-op without changing the original registration time. No source, identity, membership, assignment, or financial row is seeded.

The normalized source tables are:

| Table | Authority |
|---|---|
| `billing_source_activation_boundaries` | Approved forward-only company/branch cohort boundary references; schema only, with no production creation command |
| `billing_source_rental_lines` | Stable rental-line bindings using explicit source-system, rental, and source-line references rather than labels or positions |
| `billing_source_effective_terms` | Append-only effective term versions for rates, cycle, minimum term, discount, currency, and explicit policy/blocker state |
| `billing_source_periods` | Stable half-open contractual billing-period identities per rental line/cycle |
| `billing_source_period_versions` | Append-only close, reopen, and re-close lineage |
| `billing_source_snapshots` | Immutable integer-minor net/VAT/gross close snapshots and calculation-input fingerprints |
| `billing_source_snapshot_evidence` | Immutable scoped evidence records and authority state |
| `billing_source_upds` | Stable source-document aggregate identity |
| `billing_source_upd_versions` | Draft, formed, conducted, corrected, and cancelled append-only lifecycle versions |
| `billing_source_upd_lines` | Stable source-line identity independent of display position/description |
| `billing_source_upd_line_versions` | Immutable line content and correction lineage |
| `billing_source_coverage_sets` | Versioned validated/blocked deterministic mapping result |
| `billing_source_coverage_supersessions` | Append-only cancellation/correction/supersession relation from an original validated set to an exact validated replacement, or null replacement for cancellation |
| `billing_source_coverage_slices` | Exact non-overlapping UPD-line-to-closed-period half-open slices with monetary and due-date provenance |
| `billing_source_operations` | Exact company-scoped operation identity, command fingerprint, authority snapshot, and replay result |
| `billing_source_audit_events` | Append-only relational source audit in the same transaction as the mutation |

Every authority table rejects update and delete. Operations and audit also reject replace. Structural triggers reject overlapping periods and overlapping active validated coverage. Company/branch are copied onto dependent rows and every repository lookup uses company plus concrete branch predicates.

## Domain and lifecycle invariants

### Stable rental-line and effective-term strategy

A rental line is bound by stable `companyId`, `branchId`, `rentalId`, explicit client/contract/equipment IDs, activation boundary, source system, source rental reference, source-line identity kind/reference, event version, and provenance hash. Names, equipment labels, array positions, document descriptions, and mutable rental indexes are rejected as identity. An existing binding is reusable only when immutable content matches exactly.

Effective terms are append-only, predecessor-linked, non-overlapping versions. They carry safe integer-minor rate/discount values, explicit RUB, scale/unit/cycle/minimum-term data, source versions/hashes, and explicit policy references or unresolved reason codes. A close requires one effective terms version to govern the full period; split or stale coverage fails closed.

### Billing-period lifecycle and snapshots

Only a complete period at or after its separately approved activation boundary can close. Period identity is one non-overlapping half-open interval per rental line and contractual cycle. Close appends version 1 and an immutable snapshot; reopen appends a reasoned audited version without changing the close; re-close appends another close version and snapshot. Open state is derived from absence of a close or from the latest reopen—there is no mutable authoritative open-period financial row.

Snapshot source money is explicit RUB safe-integer minor units. Discount is applied before VAT, and matched source requires exact `preDiscountNet - discount = net` and `net + VAT = gross`. Calculation inputs use bounded sorted-key serialization and include an algorithm version in their SHA-256 fingerprint. VAT rate selection, rounding mode/timing, and residual allocation are never silently defaulted: unresolved policy/evidence remains explicitly blocked.

### UPD and coverage lifecycle

`formUpd` creates a stable UPD, an immutable draft version, stable line identities, immutable line-content versions, and a formed version freezing the line set; it may atomically persist an initial coverage set. `conductUpd` is a separate append-only accounting event with explicit evidence/policy fields. Sent, signed, uploaded, and generic document states cannot imply conducted. `correctUpd` appends cancellation or replacement lineage and never deletes or overwrites original aggregates, versions, lines, coverage sets, or slices.

Active validated coverage is defined exactly as a validated set with no append-only lifecycle successor and no terminal cancelled/corrected UPD state lacking replacement lineage. There is no mutable active flag. A blocked set is never active, never deactivates a validated set, and cannot be supplied as a replacement predecessor. Repository reads, overlap checks, the SQLite overlap trigger, and internal inspection use this definition.

Cancellation finds every current active validated set in the exact UPD lineage before mutation, appends the cancelled UPD version, and appends one `cancelled` relation with a null replacement per set in the same immediate transaction. Replacement commands must provide the exact sorted set of current active validated predecessor IDs. The repository validates those IDs without position, label, creation-time, or document-number inference, then appends corrected/draft/formed versions, immutable line versions, a validated replacement set, exact predecessor relations, slices, operation, and audit atomically. A missing, wrong-lineage, inactive, blocked, already-superseded, cross-scope, or incomplete predecessor set fails closed. The schema permits one lifecycle successor per original, requires matching concrete scope and UPD lineage, requires a validated replacement owned by the same operation, and retains every original row.

One validated coverage slice can belong to only one active UPD line. One UPD line may cover multiple explicitly declared, non-overlapping closed-period slices. Mapping requires matching company/branch/client/contract/currency and reconciled safe-integer net/VAT/gross totals across line, slice, and snapshot. Due date and provenance are explicit; rental end, expected-payment labels, forecast, or current date are not inferred as contractual evidence. Blocked snapshots/lines/mappings remain inspectable but cannot enter validated coverage.

The approved future actual-source rule remains conjunctive: a closed period plus a formed and explicitly conducted UPD with valid coverage are both necessary. PR6 does not evaluate PR8 eligibility and creates no canonical receivable.

## Commands, capabilities, and idempotency

The isolated service surface is not wired to production:

| Command | Exact existing capability |
|---|---|
| `closeBillingPeriod` | `billing.period.close` |
| `reopenBillingPeriod` | `billing.period.reopen` |
| `formUpd` | `upd.form` |
| `recordUpdCoverage` | `upd.form` |
| `conductUpd` | `upd.conduct` |
| `correctUpd` | `upd.correct` |

An inert branded command plan is materialized before transaction entry. Inputs reject proxies, accessors, `toJSON`, custom prototypes/classes, cycles, sparse/custom arrays, symbol/non-enumerable keys, functions, bigint, undefined, non-finite numbers, dates, buffers, maps/sets, typed arrays, promises/errors/regexes, unknown fields, secret-like keys, excessive depth/node count, and excessive serialized bytes. Repository calls require both a branded command context and branded plan; caller clocks, ID generators, transaction callbacks, and raw request objects are not accepted.

Idempotency is exact by company, operation type, and idempotency key. The stored lowercase SHA-256 command fingerprint is bound to the concrete branch, principal, membership/version, catalog version, capability, result aggregate/version, and result fingerprint. An exact replay returns the original logical result with `replayed: true` and writes nothing; changed content or authority is a conflict. SQLite uniqueness and immediate transactions provide the final concurrency boundary.

Child-process concurrency tests use independent SQLite connections. Two replacements of one predecessor, cancellation racing replacement, and two UPDs racing for one economic slice each produce exactly one committed winner. The loser receives a domain conflict rather than raw `SQLITE_BUSY`; no partial source rows, duplicate active mapping, missing operation/audit, or orphan lifecycle relation remains.

Source mutation, operation record, and relational audit event commit atomically. Audit captures stable aggregate/event/actor/scope/capability/correlation/reason/fingerprint/operation fields; arbitrary secrets and mutable names are excluded. SQLite-native failures injected at each close and form write stage demonstrate complete rollback, including operation and audit rows.

### Evidence-set integrity and focused hash audit

The close input no longer accepts `evidenceSetHash` as an authority value. It may carry `expectedEvidenceSetHash` only as an assertion. Domain and repository code independently normalize the complete inert evidence records, reject duplicate identities and conflicting facts, sort by the full stable identity/content tuple, exclude generated row IDs and timestamps, and compute lowercase SHA-256 over the canonical versioned representation. Snapshot insertion always uses this repository-owned value. The transaction then inserts the evidence rows, re-reads the persisted relational columns, recomputes the canonical hash, and compares it before operation/audit insertion and commit. An expected-hash mismatch, evidence insert failure, or persisted revalidation mismatch rolls back the complete close.

The focused `*Hash`/`*Fingerprint` audit classifies `sourceHash`, rental-line `provenanceHash`, evidence-row `evidenceHash`, `conductedEvidenceHash`, and activation-boundary approval/source proofs as externally supplied provenance assertions; they are stored as source evidence and are not treated as repository integrity calculations. Repository-owned `calculationInputsHash`, `evidenceSetHash`, stable identity hashes, UPD line `contentHash`, `lineSetHash`, coverage `mappingHash`, slice hash, command/result fingerprints, and audit before/after fingerprints are computed internally. No caller-provided repository-integrity hash remains authoritative.

## Internal inspection and runtime wiring

There is no PR6 HTTP router, route registration, feature flag, production service construction, worker, timer, watcher, CLI, legacy adapter, or frontend change. Normal startup imports and calls only `ensureBillingSourceAuthoritySchema(db)`.

The internal read repository requires a branded scope containing one company and one or more concrete active branch IDs, exact scoped predicates, deterministic ordering, and a bounded limit of at most 100. It inspects rental lines/terms, periods/versions, snapshots/evidence, UPDs/versions/lines, coverage slices and lifecycle predecessor/successor relations, active validated coverage, operations, audit, and explicit blocked integrity. It has no `app_data` fallback and performs no eligibility, debt, aging, settlement, or forecast calculation.

The production canonical resolver remains unconditional `null`; `CANONICAL_RECEIVABLES_READ_API_ENABLED` remains default-disabled. Production bootstrap is not called. Finance and Company Health/Risks remain on their existing implementations. PR7 was not started.

## Decision classification

### Approved decisions implemented

- Closed period and explicit conducted UPD are conjunctive future prerequisites; sent/signed/uploaded are not conducted.
- Periods do not overlap per stable rental line/cycle; close and reopen use distinct capabilities; reopen and re-close append lineage.
- UPD mapping uses stable identities, persisted non-overlapping slices, and the approved cardinality.
- Immutable money uses integer minor units with zero tolerance for unexplained net/VAT/gross mismatch and discount before VAT.
- Operational rental branch is preserved as a concrete ID; Head Office is never a wildcard/sentinel substitute.
- Corrections, source records, and audit are append-only and retained indefinitely.
- Effective minimum terms and discounts are versioned.
- Adoption is forward-only for fully governed periods; no historical import, backfill, or partial-period adoption exists.

### PR6 technical choices

- Normalized `billing_source_` SQLite tables; opaque server UUID IDs; RFC3339 UTC event timestamps; `YYYY-MM-DD` civil dates; half-open intervals.
- Deterministic sorted-key JSON and lowercase SHA-256 fingerprints; explicit RUB under the current contract.
- Append-only lifecycle/event rows with current state derived from latest valid lineage.
- No HTTP API; only a scoped internal inspection repository.

These are implementation choices, not newly claimed historical owner approvals.

### Unresolved owner/accountant/legal gates

- Exact VAT selection and exemption policy; exact rounding mode/timing and residual allocation.
- Minimum-term formulas and accepted contractual due-date evidence.
- Exact authoritative conducted evidence, accounting/legal sufficiency, and contract-specific client-signature requirements.
- Authoritative return, downtime, and extension evidence, including precedence among those events.
- Correction/cancellation accounting effect and legal replacement/supersession effect.
- Production activation date/cohort, company/branch mappings, memberships, role/capability assignments, named adapters/system actors, and separate production enablement authorization.
- PR8 reconciliation/dry-run evidence and PR9's separate explicit canonical-write authorization.

Each unresolved matter must arrive as explicit approved policy/evidence; PR6 supplies no silent default.

## Hard exclusions and conservation result

PR6 adds no canonical financial DML, posting adapter/event, eligibility evaluator, settlement/payment/allocation/adjustment behavior, forecast table/API/calculation, historical import/backfill, dual write, shadow read, product switch, feature enablement, production bootstrap/data, deployment file, frontend change, broad legacy refactor, purge/TTL/cleanup, or PR7 work. The only existing production runtime file changed is `server/db.js`, solely to call the schema initializer after PR5.

Release did not enable canonical production reads or writes; create actual receivables; run PR8 eligibility or canonical posting; perform settlement or payment allocation; enable forecast; run production bootstrap; create production identity, membership, capability-assignment, activation-boundary, rental-line, UPD, or coverage rows; wire legacy adapters; backfill, historically import, or dual-write data; switch Finance or Company Health/Risks; deploy; or cut over production. The production canonical resolver remains unconditional `null`, the canonical read flag remains default-disabled, and canonical financial tables remain empty.

PR7 has not started. Only after this release-marker PR is reviewed and merged may PR7 architecture and implementation begin as a separate Forecast Receivables Planning PR; it remains forbidden from canonical writes, Finance or Company Health/Risks switching, and production activation.

## Verification record

Verification values are recorded from the final independently reviewed implementation head before squash merge:

| Check | Result |
|---|---|
| Node / npm | `v20.20.2` / `10.9.8` |
| PR6 schema/domain/repository/safety/remediation focused suites | 135 passed, 0 failed |
| PR6 child-process concurrency suite | 3 passed, 0 failed (included above) |
| PR1/PR2/PR5/PR6 compatibility suites | 364 passed, 0 failed |
| Full `npm test` | 2,073 passed, 0 failed |
| Full `node --test tests/*.test.js` | 2,073 passed, 0 failed |
| `npm run build` | Passed; Vite transformed 3,385 modules and completed in 6.99s |
| `git diff --check` | Passed with no output |
| `PRAGMA foreign_keys` | `1` in fresh-startup SQLite probe |
| `PRAGMA foreign_key_check` | 0 rows in fresh-startup SQLite probe |
| `PRAGMA integrity_check` | `ok` |
| Final implementation CI | `lightweight-pr-check` passed for `b2687e5c...` |

The startup contract registers the unchanged `billing_source_authority_pr6` migration at version `1`. The released version-1 model contains exactly 16 PR6 tables, including the append-only coverage lifecycle table. Two independent Node 20 startup processes registered it once with the same migration timestamp and zero source, activation-boundary, identity/membership/assignment/bootstrap, or canonical financial rows; the rerun path preserved registration without business migration. The capability catalog remained exactly 1 version/11 entries, the production resolver returned `null`, and the canonical read flag evaluated false by default.

## Final status

PR6: RELEASED — Billing Source Authority foundation only.
