# PR8 Actual-Source Eligibility Dry Run implementation audit

**Status:** `PR8: DRY-RUN FOUNDATION IMPLEMENTED FOR REVIEW — NOT RELEASED.`

**Implementation date:** 2026-07-19

**Repository:** `rishatkznAI/rental-management`

**Exact starting `origin/main` SHA:** `66659c1296e05424179e2b4cc6ee1924ece4fbc9`

**Expected baseline:** `66659c1296e05424179e2b4cc6ee1924ece4fbc9`; no difference was found after `git fetch origin --prune`.

**Implementation branch:** `codex/pr8-actual-source-eligibility-dry-run`

**Implementation commit/head:** `90f0db113c475c2342a9197d8dbb96c1f5472116`

**Migration:** `actual_source_eligibility_dry_run_pr8`, version `1`

This record describes a fail-closed diagnostic foundation proposed for review. It is not a release record, source-authority approval, accounting or legal approval, production activation, canonical-write authorization, PR9 authorization, deployment, or cutover.

No production actual-source dry run was performed. Test-fixture zero-delta evidence does not satisfy the production PR8 reconciliation gate.

## Repository and source audit

Before implementation, GitHub's default branch was verified as `main`; `origin/main` was fetched and matched the expected baseline exactly. The clean implementation worktree and branch were created directly from that commit. PR6 implementation PR #212 was squash-merged as `485808d24b8c5f6481e0520eec5c8985b71ffeab`, with its release-marker PR #213 merged as `b582b9d2ac4eb0f4bb5ced04d74fbb016e437659`. PR7 implementation PR #214 was squash-merged as `cb90e09f26c5b9916a4818fd96048070a6a1a662`, with release-marker PR #215 merged as the starting SHA. Open and closed PRs, remote branches, commits, runtime wiring, migrations, documentation, and tests were searched; no existing PR8 branch, PR, migration, or overlapping actual-source eligibility implementation was present.

The PR6 and PR7 release boundaries remain intact. PR6 is an isolated Billing Source Authority foundation; PR7 is an isolated Forecast Receivables Planning foundation. Neither release enabled canonical writes, production source/forecast adapters, production policy, production bootstrap, consumer switching, deployment, or cutover.

The dry-run input universe is a complete, deterministically ordered and untruncated read of these exact PR6 tables:

1. `billing_source_activation_boundaries`
2. `billing_source_rental_lines`
3. `billing_source_effective_terms`
4. `billing_source_periods`
5. `billing_source_period_versions`
6. `billing_source_snapshots`
7. `billing_source_snapshot_evidence`
8. `billing_source_upds`
9. `billing_source_upd_versions`
10. `billing_source_upd_lines`
11. `billing_source_upd_line_versions`
12. `billing_source_coverage_sets`
13. `billing_source_coverage_supersessions`
14. `billing_source_coverage_slices`
15. `billing_source_operations`
16. `billing_source_audit_events`

There is no PR7, canonical, settlement, Finance, document, rental, payment, or other legacy fallback source. The only `app_data` read is the repository-owned `users` reader required for fresh PR5 human-principal authorization. Names, labels, document filenames, array positions, mutable settings, environment policy values, and external source hashes are not treated as authority.

## Migration and exact tables

The additive migration requires exact registered and structurally valid PR1 v1, PR2 v1, PR5 v1, PR6 v1, and PR7 v1 prerequisites in that order. It requires `foreign_keys = 1`, the unchanged PR5 capability catalog version 1 with exactly 11 entries, no competing company/branch roots, no canonical financial business rows on first application, and no partial or registered-incomplete PR8 state.

One immediate transaction creates exactly these eight tables and registers the migration last:

1. `actual_source_dry_runs`
2. `actual_source_dry_run_inputs`
3. `actual_source_dry_run_candidates`
4. `actual_source_dry_run_checks`
5. `actual_source_dry_run_reconciliations`
6. `actual_source_dry_run_diagnostics`
7. `actual_source_dry_run_operations`
8. `actual_source_dry_run_audit_events`

Every table rejects `UPDATE` and `DELETE`. Operations and audit rows also reject replacement. Operation insertion is the final seal: later input, candidate, check, reconciliation, diagnostic, or audit-link insertion is rejected. Structural assertions cover required columns, indexes, triggers, foreign keys, prerequisite registrations, exact table set, catalog conservation, registry-last atomicity, final counts, links, totals, and hashes. Repeated startup validates the complete structure and preserves the original `applied_at`. There is no down/delete migration, TTL, purge, cleanup worker, or finite retention.

No `actual_receivable_eligible_events`, `ActualReceivableEligibleV1`, canonical posting queue/outbox, canonical adapter, source-adapter state, or activation state exists.

## Architecture and runtime boundary

The bounded context is split into:

- `actual-source-eligibility-dry-run-domain.js` — deeply inert request/policy materialization, allow-listed values, stable serialization, SHA-256, brands, and bounded input validation;
- `actual-source-eligibility-dry-run-policy.js` — pure fail-closed gate, lineage, evidence, scope, money, and reconciliation evaluation;
- `actual-source-eligibility-dry-run-service.js` — pre-transaction orchestration and plan branding;
- `actual-source-eligibility-dry-run-repository.js` — fresh authorization/source revalidation, immediate transaction, immutable persistence, reread reconciliation, idempotency, operation, and audit;
- `actual-source-eligibility-dry-run-read-repository.js` — internal scoped inspection only;
- `actual-source-eligibility-dry-run-schema.js` — additive schema and structural assertions.

The sole production wiring is `server/db.js` importing and calling `ensureActualSourceEligibilityDryRunSchema(db)` immediately after PR7 schema initialization. The production dependency graph cannot reach the domain, policy, service, mutation repository, internal read repository, test policy, source adapter, route, worker, scheduler, timer, queue, or CLI. No feature toggle can enable execution. No HTTP API, frontend query, product consumer, Finance/Dashboard/Company Health/Risks integration, canonical resolver, or forecast resolver changed.

The canonical production resolver remains unconditional `null`; `CANONICAL_RECEIVABLES_READ_API_ENABLED` remains false by default. The forecast production resolver remains unconditional `null`; `FORECAST_RECEIVABLES_READ_API_ENABLED` remains false by default. Production forecast calculation remains unreachable.

## Inert input and policy gate model

Requests and policy manifests are materialized as deeply inert plain JSON. Unknown fields, proxies, accessors, custom prototypes, classes, `toJSON`, functions, symbols, hidden properties, sparse arrays, cycles, bigint, undefined, non-finite numbers, dates, buffers, maps/sets, typed arrays, promises/errors/regular expressions, secret-like keys, invalid civil dates or intervals, unsafe/floating money, non-RUB currency, and excessive bytes/depth/nodes are rejected before the transaction. Business hashes exclude generated identifiers and timestamps.

The exact versioned gate keys are:

1. `accounting_source_sufficiency`
2. `canonical_amount_basis`
3. `conducted_evidence`
4. `client_signature_requirement`
5. `contractual_due_date`
6. `unknown_due_date_treatment`
7. `vat_selection`
8. `vat_basis`
9. `rounding_mode_and_order`
10. `rounding_residual_allocation`
11. `operational_event_authority`
12. `correction_cancellation_reopen_effect`
13. `activation_boundary`
14. `activation_cohort`
15. `source_adapter_authority`

Each gate is `approved_by_reference`, `unresolved`, or `rejected`. Missing is normalized to unresolved. An approval claim without decision reference, version, hash/fingerprint, schema version, and exact applicable scope is normalized to unresolved rather than accepted. Unknown or duplicate keys and conflicting identities are rejected. Unresolved and rejected gates block candidates. The production policy registry is intentionally unavailable; isolated tests inject explicit versioned artificial policy manifests. Test policy is not production, accountant, legal, or product-owner approval.

All caller-controlled policy work finishes before `BEGIN IMMEDIATE`. No caller callback, custom clock, ID generator, transaction hook, repository option, raw request, or dynamic policy callback can enter the repository transaction. The repository owns UUIDs, timestamps, canonical hashes, the SQLite user read, and fresh evaluation.

## Candidate and result semantics

The smallest candidate is one exact PR6 economic coverage slice with its company, concrete branch, activation boundary, rental line/rental/client/contract, current closed period version, snapshot, formed and current conducted UPD lineage, current UPD line/version, active validated coverage set/slice, half-open interval, RUB net/VAT/gross amounts, due-date provenance, complete policy manifest, repository-owned candidate key, input lineage hash, and result hash.

Allowed statuses are only `eligible_candidate` and `blocked`. `eligible_candidate` means only that, for that exact source slice and explicit versioned policy manifest, the diagnostic engine found no blocking discrepancy. It does not mean source authority is approved, debt is legally recognized, a canonical row may be written, an adapter or cohort is active, production reconciliation passed, PR9 may start, backfill/cutover is allowed, or any consumer may switch.

Every run and candidate is explicitly diagnostic-only. Persisted constraints require `diagnosticOnly = 1`, `canonicalWriteAuthorized = 0`, and `productionActivationAuthorized = 0`. There is no canonical receivable ID or canonical workflow status. Run statuses are neutral: `completed`, `completed_with_blockers`, or `completed_no_candidates`; no approved, activated, released, or production-ready status exists.

D-01 remains exact and fail closed: a candidate requires a current closed period, formed and explicitly current conducted UPD, and an exact active validated mapping. Signed is never conducted. Open/reopened periods; draft/formed-only/cancelled/corrected UPD lineage; missing, blocked, superseded, duplicate, overlapping, cross-scope, or mismatched coverage; incomplete evidence; unsupported currency; non-positive money; drift; and unresolved policy produce blockers. Periods that start before or cross the governed activation boundary are never trimmed, prorated, imported, or backfilled.

The engine sees complete current and non-current source states so it can emit run- or candidate-level diagnostics for closed periods without conducted UPD, conducted UPD without mapping, reopened periods, formed/draft/cancelled/corrected versions, blocked snapshots/coverage, superseded mappings, evidence gaps, and activation gaps. Unknown amount is never converted to zero. Unknown due date never gains aging, overdue, collections, or legal-escalation semantics.

## Reconciliation and evidence conservation

All money uses RUB safe integer minor units. There is no floating arithmetic, `Math.round`, tolerance, one-kopeck exception, cross-client/branch/period/UPD/currency netting, or compensation between discrepancies.

Each exact slice persists separate reconciliation rows for:

1. snapshot equation: `snapshotNetMinor + snapshotVatMinor = snapshotGrossMinor`;
2. UPD-line equation: `updLineNetMinor + updLineVatMinor = updLineGrossMinor`;
3. coverage-slice equation: `sliceNetMinor + sliceVatMinor = sliceGrossMinor`;
4. exact active-slice aggregate equals the current UPD-line net/VAT/gross;
5. exact active-slice aggregate equals the current closed-period snapshot net/VAT/gross;
6. persisted coverage-set net/VAT/gross deltas are exactly zero.

Run conservation requires candidate count to equal eligible-candidate plus blocked-candidate counts, run totals to equal all candidate source totals, explicitly named eligible-candidate totals to equal only that subset, and every input/check/reconciliation/diagnostic count and hash to match the relational rows. Each dimension retains expected, observed, delta, currency, source/input hashes, blocker state, and repository-owned hash. A non-zero net, VAT, or gross delta blocks independently.

The complete source input manifest includes every allow-listed PR6 row in deterministic order, with external provenance assertions separated from repository-owned normalized integrity hashes. Before persistence the service creates an immutable branded plan. After `BEGIN IMMEDIATE`, the repository freshly revalidates PR5 authority and PR6 rows, recomputes the full manifest and policy/source evaluation, rejects source or policy drift, persists the result, rereads all relational inputs/results, recomputes hashes/counts/totals, inserts audit, inserts the sealing operation, rereads operation/audit links, and commits only on exact equality. Any mismatch or SQLite failure rolls back all PR8 rows.

## Authorization, reads, idempotency, and concurrency

Evaluation requires a branded server-created context for a live authenticated human principal, active exact-version membership, live exact-version role template, current catalog version, `receivables.read`, exact company scope, and one concrete active authorized branch. Administrator display labels grant nothing. Integration/system actors are unsupported. Client company IDs are not authority; branch filters can only narrow trusted scope. Fresh authority is checked again on the same connection inside the locked transaction.

The internal read repository exposes only `listDryRuns`, `getDryRun`, `listCandidates`, `listChecks`, `listReconciliations`, `listDiagnostics`, `inspectOperation`, and `inspectAuditHistory`. Reads require a branded company-and-concrete-branch scope, deterministic ordering, allow-listed filters, and a 200-row maximum. They neither recalculate eligibility nor project debt, aging, overdue, activation, canonical, settlement, or forecast semantics.

Idempotency is `companyId + evaluate_actual_source_dry_run + idempotencyKey` and binds branch, principal, membership/version, role-template/version, catalog version, `receivables.read`, policy-manifest hash, complete input-set hash, command fingerprint, correlation ID, and result run/hash. Exact replay returns the original logical result with `replayed = true` and creates no row. Changed authority, branch, policy, source, content, or hash yields a deterministic domain conflict.

Independent SQLite-connection tests establish one atomic first-run winner plus exact replay, and one winner plus `ACTUAL_SOURCE_IDEMPOTENCY_CONFLICT` for the same key with different policy. Repository-boundary remediation covers source correction/hash drift, reopen/version drift, coverage supersession, capability/membership loss, and branch deactivation before commit. Busy/locked SQLite errors are mapped to domain conflicts; no raw `SQLITE_BUSY`/`SQLITE_LOCKED`, partial run, duplicate candidate/result, orphan child, or missing operation/audit escapes.

## Verification evidence

All verification used Node `v20.20.2` and npm `10.9.4` from an isolated Node 20 runtime. Dependencies were installed from committed lockfiles; no package manifest or lockfile changed.

| Check | Result |
|---|---:|
| Focused PR8 suites | 51 passed, 0 failed |
| PR1/PR2/PR3/PR5/PR6/PR7/PR8 compatibility suites | 487 passed, 0 failed |
| `npm test` | 2,229 passed, 0 failed |
| Repeated `node --test tests/*.test.js` | 2,229 passed, 0 failed |
| `npm run build` | passed |
| `git diff --check` | passed |
| Fresh `PRAGMA foreign_keys` | `1` |
| Fresh `PRAGMA foreign_key_check` | clean (`0` rows) |
| Fresh `PRAGMA integrity_check` | `ok` |
| Fresh PR8 migration registration | exactly one v1 row; second startup preserved `applied_at` |
| Fresh PR8 tables | exact eight-table set; all `0` rows |
| Fresh PR6 tables | all sixteen `0` rows |
| Fresh PR7 tables | all eight `0` rows |
| Fresh canonical financial/root tables | all `0` rows |
| Fresh identity business/bootstrap/assignment/audit rows | all `0` rows |
| Fresh capability catalog | one version; 11 entries |
| Fresh `app_data` | `0` rows |
| Production canonical resolver/read default | `null` / `false` |
| Production forecast resolver/read default | `null` / `false` |

The positive control is a fully artificial fixture with explicit test-only gate references, a current closed period, complete approved-by-test evidence, a current conducted UPD, active validated exact mapping, positive RUB amounts, and zero deltas. It can yield `eligible_candidate`, while canonical, PR6, and PR7 tables remain unchanged and both authorization flags remain false. This is engine/schema/test-fixture evidence only.

## Changed files

Implementation and tests:

- `server/db.js`
- `server/lib/actual-source-eligibility-dry-run-domain.js`
- `server/lib/actual-source-eligibility-dry-run-policy.js`
- `server/lib/actual-source-eligibility-dry-run-read-repository.js`
- `server/lib/actual-source-eligibility-dry-run-repository.js`
- `server/lib/actual-source-eligibility-dry-run-schema.js`
- `server/lib/actual-source-eligibility-dry-run-service.js`
- `tests/actual-source-eligibility-dry-run-concurrency.test.js`
- `tests/actual-source-eligibility-dry-run-domain.test.js`
- `tests/actual-source-eligibility-dry-run-fixtures.js`
- `tests/actual-source-eligibility-dry-run-policy.test.js`
- `tests/actual-source-eligibility-dry-run-read-repository.test.js`
- `tests/actual-source-eligibility-dry-run-remediation.test.js`
- `tests/actual-source-eligibility-dry-run-repository.test.js`
- `tests/actual-source-eligibility-dry-run-safety.test.js`
- `tests/actual-source-eligibility-dry-run-schema.test.js`
- `tests/helpers/actual-source-eligibility-dry-run-concurrency-worker.mjs`

Documentation:

- `docs/actual-source-eligibility-pr8-audit.md`
- `docs/canonical-receivables-contract.md`
- `docs/canonical-receivables-decisions.md`

## Unresolved decisions, exclusions, and PR9 boundary

The implementation resolves none of the accountant, legal, tax, evidence, activation, operating-procedure, release, or canonical-write decisions. Source/accounting sufficiency, original-amount basis, conducted evidence authority, client-signature requirements/evidence, contractual due-date provenance, unknown-date treatment, VAT selection/basis, rounding mode/order/residual allocation, operational-event authority/precedence, correction/cancellation/reopen/replacement effect, activation date/boundary/cohort, named production adapter/actor, concrete production identity/grants, legal-hold/export/access/tamper controls, runbooks, consumer sign-off, and release authorization remain fail closed.

No production identity/bootstrap/source population occurred. No production actual-source data was evaluated. No canonical receivable, canonical financial audit, settlement/payment/allocation/adjustment/refund/write-off, source mutation, forecast mutation, legacy mutation, `ActualReceivableEligibleV1`, posting event, outbox, source adapter, activation command, import, backfill, dual write, shadow read, route, worker, scheduler, timer, queue, CLI, frontend change, Finance/Dashboard/Company Health/Risks switch, deployment, cutover, merge, or release marker is part of PR8.

PR9 remains blocked until explicit accountant/legal confirmations, approved production source evidence, approved VAT/rounding and due-date/signature/correction policy, approved activation boundary/cohort and named adapter authority, real production identity/source population, a successful production dry run, zero unexplained net/VAT/gross delta, approved reconciliation/rollback and retention-control runbooks, consumer/release sign-off, and a separate explicit product-owner canonical-write authorization. PR8 emits no future posting event and authorizes no canonical write.

Rollback of this code means disabling/reverting unreachable code while retaining all immutable PR8 history. Financial/audit rows are never deleted as a rollback mechanism. Failed migrations and failed runs roll back atomically; successful diagnostic rows are conserved indefinitely.

**Final status:** `PR8: DRY-RUN FOUNDATION IMPLEMENTED FOR REVIEW — NOT RELEASED.`
