# PR7 Forecast Receivables Planning implementation audit

**Status:** `PR7: REMEDIATED FOR REVIEW — NOT RELEASED`

**Implementation date:** 2026-07-18

**Repository:** `rishatkznAI/rental-management`

**Exact starting `origin/main` SHA:** `b582b9d2ac4eb0f4bb5ced04d74fbb016e437659`

**Implementation branch:** `codex/pr7-forecast-receivables-planning`

This record describes an isolated planning foundation. It does not authorize release, production activation, a production calculation adapter, canonical writes, a reporting cutover, or any consumer switch.

Focused remediation was applied to the existing PR #214 from its previously reviewed and actual remediation starting head `2c82fc96f2eb78838de2b7e7d1d21e39928d5dc7`. The branch, PR, migration identity, eight-table boundary, production isolation, and unreleased status were preserved.

## Baseline audit

Before implementation, `origin/main` was fetched and verified at the SHA above. GitHub's default branch was `main`; PR #212 was merged as `485808d24b8c5f6481e0520eec5c8985b71ffeab`, and its release-marker PR #213 was merged as the starting SHA. PR1, PR2, PR3, PR5, and PR6 were released only within their documented foundation boundaries; PR4 remained a historical design-approved gate and was not released. No PR7 branch, open PR, migration, or overlapping implementation existed. The clean implementation worktree was created directly from that `origin/main` commit.

## Migration and tables

Migration `forecast_receivables_planning_pr7`, version `1`, runs after the exact registered and structurally valid PR1, PR2, PR5, and PR6 migrations. It requires `foreign_keys = 1`, validates the exact PR5 capability catalog and prerequisite structures, preserves the existing first-application canonical-financial-row stage gate, rejects partial/unregistered PR7 state, runs atomically, registers last, is idempotent, and seeds no business rows.

It creates exactly these eight PR7 tables:

1. `forecast_receivable_runs`
2. `forecast_receivable_run_supersessions`
3. `forecast_receivable_input_snapshots`
4. `forecast_receivable_input_events`
5. `forecast_receivable_items`
6. `forecast_receivable_diagnostics`
7. `forecast_receivable_operations`
8. `forecast_receivable_audit_events`

Every table rejects direct `UPDATE` and `DELETE`. Operations and audit events also reject replacement. Composite foreign keys enforce company and concrete-branch scope. Monetary fields are RUB-only safe integer minor units and reconcile net plus VAT to gross. The run stores the full normalized top-level input-set manifest, its repository hash/schema version, and exact snapshot/event/completeness-manifest counts. Each input snapshot stores activation-boundary and effective-terms versions/hashes plus the full normalized per-input completeness manifest and its repository hash. SQLite triggers enforce run horizon/lineage, candidate containment by service, exact diagnostic-to-snapshot scope and interval, item status and interval rules, no overlapping coverage, one successor per predecessor, same-scope/same-series supersession, persisted input/result counts and totals, and one current completed result. Insertion of the operation seals the result: no late input, event, item, diagnostic, or lifecycle relation can be appended after reconciliation.

The migration has no down/delete path, TTL, purge, cleanup worker, or finite-retention metadata.

## Bounded-context and module boundary

The PR7 implementation is split into:

- `forecast-receivables-planning-domain.js` — deeply inert command materialization, civil dates, stable serialization, hashes, money and command-context brands;
- `forecast-receivables-planning-policy.js` — versioned coverage, pricing, VAT/rounding-reference, and confidence gateway;
- `forecast-receivables-planning-service.js` — isolated calculation orchestration;
- `forecast-receivables-planning-repository.js` — immediate transaction, source revalidation, append-only persistence, reconciliation, operation, and audit;
- `forecast-receivables-planning-schema.js` — additive schema and structural assertions;
- `forecast-receivables-planning-read-repository.js` — scoped PR7-only queries;
- `forecast-receivables-planning-read-service.js` — filters, projections, summary compatibility, and signed cursors;
- `forecast-receivables-scope-adapter.js` — unconditional production `null` resolver;
- `forecast-receivables-read.js` — GET-only HTTP namespace.

The production dependency graph reaches only the schema initializer, default-disabled read wiring, read-only modules, and the unconditional-null adapter. It cannot reach the calculation service, mutation repository, policy registry, input adapter, scheduler, worker, queue, timer, CLI, or legacy importer. Calculation is exercised only through isolated tests with injected deterministic test policy.

## Planning contract

Each run belongs to one company, concrete branch, and repository-owned planning-series key. Its fixed horizon is the company-local half-open civil-date interval `[asOfDate, asOfDate + 30 days)` in the PR5 company IANA timezone. V1 accepts RUB only and exposes separate `open_period_forecast` and `planned_future` totals; `primaryForecastMinor` equals only the open-period gross total.

Primary items allow only exact `active` and `return_planned` status codes. `planned_future` is separate. Other statuses produce diagnostics and no money. A forecast item is planning-only: it has no canonical receivable, due date, actualization, debt, aging, overdue, collection, payment, settlement, allocation, write-off, or conversion lifecycle.

Inputs identify a PR6 rental line, activation boundary, and effective-terms version by stable ID plus versions and hashes. Each line carries a bounded normalized event set and a versioned completeness manifest. Candidate coverage must be wholly contained by the authoritative service interval; calculated slices are additionally contained by the fixed run horizon, exact candidate, effective terms, and governed activation boundary. There is no clamping or trimming. Names, labels, display positions, current mutable rates, request-selected company authority, arbitrary blobs, and `app_data` rentals are not authority.

Before `BEGIN IMMEDIATE`, the branded command context is validated before any injected policy callback. Caller data is then deeply materialized and rejects proxies, accessors, custom prototypes, exotic objects, cycles, sparse arrays, hidden/symbol fields, functions, undefined/non-finite numbers, secret-like keys, excessive depth/count/bytes, and unknown fields. The byte budget counts canonical JSON keys, primitives, commas, colons, and array/object structure. Injected policy callbacks finish before the repository transaction. After the lock is acquired, the repository freshly revalidates the PR5 principal/membership/template/catalog/capability/branch scope and rereads the required PR6 source records, versions, hashes, effective intervals, current terms lineage, policy-resolution state, and closed-period overlap.

## Policy, confidence, and unknown input

The production policy registry is deliberately unavailable. It does not read mutable settings or invent VAT, rounding, minimum-term, return/downtime/extension precedence, coverage partition, or high/medium/low rules. A calculation without an explicitly injected versioned policy persists blocking `insufficient` diagnostics and no monetary item.

The versioned gateway separates coverage partition, pricing, and confidence classification. V1 requires non-empty calculated slices to form an exact contiguous cover of the complete candidate interval; leading, internal, trailing, overlapping, or duplicate coverage is rejected before pricing. An empty partition produces a blocking insufficient diagnostic. Test-only policies must return exact calculation/policy references, safe integer net/VAT/gross, normalized inert evidence, a confidence version, one of `high`, `medium`, or `low`, and unique machine-readable reasons. `insufficient` is represented by diagnostics, never by a zero-valued item.

Missing/incomplete manifests, unresolved events, unavailable source/terms, unsupported statuses, policy gaps, source drift, ambiguous coverage, partial closed-period overlap, money overflow, and reconciliation failures fail closed. Unknown is never treated as zero. A persisted calculated zero is allowed only when a complete authoritative input-set manifest proves no eligible inputs, or an exact authoritative PR6 closed slice is suppressed with explicit provenance. A missing current run remains `unavailable`, not a calculated zero.

Exact closed PR6 candidate coverage is repository-owned suppression evidence only, including when the policy returned multiple adjacent slices; it creates no closed-unbilled lane. Reopened coverage is not closed suppression evidence. Partial/ambiguous overlap creates a blocker, with no heuristic trimming, splitting, or proration. PR7 never reads canonical rows for precedence or totals.

## Supersession, hashing, idempotency, and concurrency

Runs are immutable and have no mutable `isCurrent` flag. Current state is derived from the absence of a successor. Every calculation supplies an exact sorted `expectedActiveRunIds`; a replacement appends one relation for each predecessor and atomically persists the successor's complete result, operation, and audit. SQLite constraints and finalization triggers reject late/cross-scope/cross-series lifecycle edges, duplicate successors, incomplete results, or a second finalized current run.

All persisted hashes use canonical sorted-key serialization and lowercase SHA-256. The repository owns planning-series, coverage, completeness-manifest, input-source, input-set, item-result, command, and result hashes. Before operation/audit insertion it rereads the persisted run manifest, every input snapshot, every full per-input manifest, and every event; reconstructs the canonical input set only from those relational fields; and recomputes manifest hashes, input-source hashes, exact counts, and the complete input-set hash against both the run and originally calculated value. It also rereads persisted items and diagnostics and reconstructs item hashes, result hash, counts, component totals, and reconciliation equations. After insertion, the actual operation/audit input-set hashes and links are reread and matched. Missing, ignored, extra, mutated, non-canonical, or hash-mismatched lineage rolls back the whole transaction.

Idempotency is scoped by `companyId + calculate_forecast_run + idempotencyKey` and binds the exact branch, real principal, membership/version, role-template/version, capability-catalog version, capability, planning series, command fingerprint, input-set hash, result run/hash, and correlation. Exact replay returns the original logical result without a new run, item, relation, operation, or audit. Changed input or authority yields a deterministic conflict.

Independent-process tests cover first-run, exact replay, changed-input retry, and replacement races. Repository-boundary tests additionally move PR6 source state, deny `forecast.calculate`, and deactivate the branch after planning but before commit. Outcomes are deterministic one-winner/fail-closed behavior with no raw SQLite lock leakage, partial rows, duplicate current run, orphan relation, or missing winner operation/audit.

## Authorization

Calculation requires a branded server-created context for a live authenticated human user, active exact-version membership, live exact-version role template and capability catalog, `forecast.calculate`, and a concrete active authorized branch. Reads require the analogous branded read scope and `forecast.read` for one or more concrete authorized branches. Administrator display labels grant nothing. Client `companyId` is rejected; client `branchId` can only narrow an already authorized branch set. Every entity lookup includes trusted company, branch, and entity ID, and cross-scope misses are non-disclosing.

Integration/system actors are unsupported.

## Default-disabled read API

The namespace contains only:

- `GET /api/forecast-receivables/runs`
- `GET /api/forecast-receivables/runs/:id`
- `GET /api/forecast-receivables/items`
- `GET /api/forecast-receivables/summary`
- `GET /api/forecast-receivables/diagnostics`

Static routes precede dynamic detail. Queries use allow-listed filters, deterministic ordering, limit 50 by default and 200 maximum, and HMAC-signed endpoint/scope/filter/sort/position-bound cursors. Run detail reads 201 input snapshots, returns at most 200, and derives truncation only from the sentinel row rather than monetary item count. Responses include structured request IDs and errors. Summary returns branch components when current runs are incompatible and never exposes or computes actual outstanding, closed-unbilled totals, expected client load, aging, debt, advances netting, collection, or settlement.

`FORECAST_RECEIVABLES_READ_API_ENABLED` defaults to `false`. `FORECAST_RECEIVABLES_CURSOR_SECRET` has no default secret value. With the flag disabled, routes are absent. With it enabled but the production resolver unavailable, authentication still runs and the request fails with 403 before any forecast read. The production forecast resolver is unconditional `null`; future platform bootstrap alone cannot activate PR7 reads.

## Verification evidence

All verification used Node `v20.20.2` and npm `10.9.4` from an isolated `node@20` runtime. The worktree's ignored dependencies were installed from the committed lockfiles; no package manifest or lockfile changed.

| Check | Result |
|---|---:|
| New focused remediation regressions | 23 passed, 0 failed |
| Focused PR7 suites | 100 passed, 0 failed |
| PR1/PR2/PR3/PR5/PR6/PR7 compatibility suites | 461 passed, 0 failed |
| `npm test` | 2,173 passed, 0 failed |
| Repeated `node --test tests/*.test.js` | 2,173 passed, 0 failed |
| `npm run build` | passed |
| `git diff --check` | passed |
| `PRAGMA foreign_keys` | `1` |
| `PRAGMA foreign_key_check` | clean (`0` rows) |
| `PRAGMA integrity_check` | `ok` |
| Fresh-start PR7 tables | all eight `0` rows |
| Fresh-start PR6 source tables | all sixteen `0` rows |
| Fresh-start canonical financial tables | all `0` rows |
| Fresh-start identity/source business rows | `0` rows; only the approved PR5 capability catalog is schema-seeded |
| Second startup | PR7 v1 remained registered exactly once and its registration timestamp was preserved |

## Explicit exclusions and unresolved gates

This PR performs no production identity/bootstrap/source population; no source adapter; no actual-source eligibility or PR8 work; no canonical/source/legacy financial write; no settlement/payment/allocation/adjustment/write-off/refund; no import, backfill, dual write, shadow read, posting, or conversion; no canonical/forecast read enablement; no production calculation; no scheduler or workflow; no Finance, Dashboard, Company Health, or Risks switch; no frontend/UI; no deploy, cutover, merge, or release marker.

Previously unresolved accountant/legal decisions remain unresolved. Production VAT, rounding, minimum-term, evidence sufficiency, return/downtime/extension authority and precedence, activation, consumer aggregation, and retention controls beyond the already approved indefinite no-delete rule remain separate gates. PR8 is not started or automatically unblocked.

**Final status:** `PR7: REMEDIATED FOR REVIEW — NOT RELEASED`
