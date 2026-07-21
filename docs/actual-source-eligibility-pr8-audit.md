# PR8 Actual-Source Eligibility Dry Run release and remediation audit

**Status:** **PR8: RELEASED — Actual-Source Eligibility Dry Run foundation only.**

**Implementation date:** 2026-07-20

**Release-marker date:** 2026-07-21

**Repository:** `rishatkznAI/rental-management`

**Exact starting `origin/main` SHA:** `66659c1296e05424179e2b4cc6ee1924ece4fbc9`

**Expected baseline:** `66659c1296e05424179e2b4cc6ee1924ece4fbc9`; no difference was found after `git fetch origin --prune`.

**Implementation branch:** `codex/pr8-actual-source-eligibility-dry-run`

**Original implementation commit:** `90f0db113c475c2342a9197d8dbb96c1f5472116`

**Previous independently reviewed head:** `3f498cf3cfa513b923cfdc0e7a8c21ecaae84e55`

**Actual remediation starting head:** `3f498cf3cfa513b923cfdc0e7a8c21ecaae84e55` (exact match)

**Remediation implementation commit/head:** `d1aec5445f3f6eccafe7c21903b99d9b1cf09a38`

**Previous remediated/reviewed head:** `285d32e24b8eb0c97e95b5d84c8d7d74cb365ef0`

**Second focused remediation starting head:** `285d32e24b8eb0c97e95b5d84c8d7d74cb365ef0` (exact match)

**Second focused remediation implementation commit/head:** `974c3407e9b1a54f99beacfdd123ff070227210e`

**Third focused remediation starting head:** `0ed8f18f4786c94d1ce769871bfebabbe1432c0e` (exact match)

**Third focused remediation implementation commit/head:** `1dd5aca4634651f4708bc9ac5b3ca6062f8efc44`

**Fourth focused remediation starting head:** `0e4ab783a4c0cb4051280818967ffbd71ea8f164` (exact match)

**Fourth focused remediation implementation commit/head:** `a166acfde101c73a5ddda5434d6a80d73886541d`

**Fifth focused remediation starting head:** `3143c1ed4f88eddd09dc138a18ecf8cba91ecfbc` (exact match)

**Fifth focused remediation implementation commit/head:** `fa00ab339654208b97b3e37095a2482cebace06c`

**Sixth focused remediation starting head:** `dfb5e7f9afb92b038571e04820c502821e9702de` (exact match)

**Sixth focused remediation implementation commit/head:** `dff17b1441f4e3168950dff0d5e52b942c969ca3`

**Migration:** `actual_source_eligibility_dry_run_pr8`, version `1`

This record preserves the complete historical remediation evidence and records the foundation-only release. Release is not source-authority approval, accounting/legal/tax approval, production activation, canonical-write authorization, PR9 authorization, deployment, or cutover.

No production actual-source dry run was performed. Test-fixture zero-delta evidence does not satisfy the production PR8 reconciliation gate.

## Release record

**PR8: RELEASED — Actual-Source Eligibility Dry Run foundation only.**

- Implementation PR: [#216](https://github.com/rishatkznAI/rental-management/pull/216)
- Reviewed implementation head: `fb66d27208dc810d5ccf60e11b3a5498daf7239d`
- Squash merge SHA: `afeac4de9b2711d9c6493855a8e3632443844f61`
- Previous `main`: `66659c1296e05424179e2b4cc6ee1924ece4fbc9`
- Merge method: squash merge with exact-head protection
- Required check: `lightweight-pr-check` completed successfully for the reviewed head

The released scope is only the additive `actual_source_eligibility_dry_run_pr8` migration version 1 and its exact eight append-only PR8 tables; the diagnostic dry-run domain/repository foundation; a fail-closed 15-gate eligibility evaluation whose only candidate statuses are `eligible_candidate` and `blocked`; persisted candidates, checks, reconciliations, and diagnostics; append-only operation/audit sealing; exact source-policy and adapter-authority validation; scoped PR6 lineage; live PR5 read reauthorization; strict registered-schema structural validation; and the default-disabled runtime boundary with no production execution path.

The diagnostic contract remains fixed: `diagnosticOnly = true`, `canonicalWriteAuthorized = false`, and `productionActivationAuthorized = false`.

This release marker is not a production actual-source dry run, production source-adapter approval, production source-data population, accounting/legal/tax approval, approval of all 15 business-policy gates, actual-source reconciliation approval, zero-delta production evidence, activation boundary/cohort approval, retention/legal-hold approval, execution capability, admission/rate/concurrency controls, HTTP/API consumer, canonical write, `ActualReceivableEligibleV1`, backfill, dual write, consumer switch, deployment, or cutover. No production execution or deployment occurred.

**PR9 remains BLOCKED pending production evidence, governed source/adapter approval, explicit canonical-write authorization, operational controls, and a separate architecture gate.** The PR8 foundation release does not authorize a PR9 branch, implementation, event contract, or runtime consumer.

## Independent-review remediation (historical pre-release evidence)

All five merge-blocking findings were addressed without widening the PR8 runtime boundary:

1. **P0 signature policy binding:** `client_signature_requirement` now requires the exact conducted source policy reference, approved decision identity/version/hash/schema, and applicable company/branch/contract scope before `required` or `not_required` may be evaluated.
2. **P0 adapter authority:** eligibility now validates the complete canonical sorted source-ownership manifest, including the monetary UPD line version and every relevant evidence row; PR6 relational rows without `sourceSystem` remain governed by repository-owned lineage and hashes.
3. **P1 persisted sealing:** all persisted candidates, checks, reconciliations, diagnostics, run aggregates, operation, and audit are reread, canonically reconstructed, rehashed, and exactly compared before commit; all fault injections roll back without partial rows.
4. **P1 read authorization:** scopes are issued only from server-branded PR5 human authority, and every diagnostic query freshly checks user, membership/version, role/version, catalog, capability, company, branch grant, and branch state.
5. **P1 FK lineage:** candidate/input activation boundaries are scope-safe PR6 references, children cannot cross runs, and startup verifies the exact ordered FK graph and critical structural signatures.

The second focused remediation closes two follow-up findings without changing that boundary:

1. **P1 registered-schema validation:** startup now compares the exact canonical critical `CHECK` expression sets, the complete canonical SQL and SQLite metadata for every named PR8 index, every unique key, and the complete canonical SQL for every PR8 trigger. A registered v1 schema with a removed or weakened constraint, a partial/non-unique/expression/misdirected index, or a disabled/weakened trigger fails closed on both direct assertion and repeated startup; no automatic repair is attempted and `applied_at` is unchanged.
2. **P2 audit attribution description:** PR6 audit rows do have a required `sourceSystem`. That value is repository-generated audit attribution metadata; it is not a separate economic or evidence source-owner assertion. The v1 ownership manifest therefore intentionally classifies audit rows as PR6 repository lineage and does not use their attribution value as adapter authority.

The third focused remediation closes two structural-review findings without changing the migration, table set, or runtime boundary:

1. **P1 executable `CHECK` extraction:** registered table SQL is now read through one deterministic SQLite-aware lexical scanner. Line and block comments are discarded; single-quoted literals and double-, backtick-, or bracket-quoted identifiers remain atomic tokens; only an executable `CHECK` keyword followed by a balanced parenthesized token stream contributes to the exact constraint multiset. Unterminated lexical regions and unbalanced `CHECK` expressions fail closed. Textual decoys in comments, defaults, or quoted constraint names cannot replace an executable critical constraint.
2. **P2 quoted identifier equivalence:** index and trigger definitions now use semantic token canonicalization instead of lowercased whitespace stripping. Keyword and unquoted-identifier case and harmless comments/formatting are insignificant. Double-, backtick-, and bracket-quoted simple non-keyword identifiers normalize to the same case-insensitive identifier value, while string values, numeric spellings, operators, keyword-as-identifier quoting, spaces, and embedded escaped delimiters remain significant.

The fourth focused remediation closes the Unicode identifier false-equivalence finding without changing the migration, table set, or runtime boundary:

1. **P1 bounded SQLite identifier semantics:** simple ASCII identifiers use an explicit ASCII-only `A-Z` fold, while non-ASCII identifiers retain their exact decoded code-point sequence in a distinct token kind. No locale-aware comparison, Unicode normalization, compatibility folding, or confusable mapping participates in structural authority. Double-, backtick-, and bracket-quoted simple ASCII identifiers remain equivalent to their unquoted ASCII identity. Trigger validation now also compares `sqlite_master.tbl_name` separately from canonical SQL, so a required trigger redirected to a Unicode-lookalike table fails direct assertion and repeated startup without repair or migration timestamp change.

The fifth focused remediation closes the Unicode-spacing false-equivalence finding without changing the migration, table set, or runtime boundary:

1. **P1 bounded SQLite formatting whitespace:** structural SQL canonicalization now discards only the explicitly enumerated ASCII code points U+0020, U+0009, U+000A, U+000D, and U+000C. The scanner and its static keyword-list parser share the same predicate; JavaScript `\s`, generic trimming, Unicode whitespace properties, locale behavior, normalization, and compatibility mapping are absent. Vertical tab and every tested non-ASCII spacing or zero-width code point remain significant identifier/token content. A registered trigger whose identifier begins with U+00A0 fails direct assertion and repeated startup without repair or migration timestamp change.

The sixth focused remediation closes the ASCII metadata false-rejection finding without changing the migration, table set, or runtime boundary:

1. **P1 bounded SQLite object identity:** one comparison helper now governs structural `sqlite_master` object names and table targets. When both identifiers are entirely ASCII, only `A-Z` fold to `a-z`; when either identifier contains a non-ASCII code point, the decoded sequences must match exactly code point for code point. Trigger lookup and `tbl_name` validation therefore accept unquoted, double-quoted, backtick-quoted, and bracket-quoted mixed ASCII case while still rejecting Unicode lookalike names and targets. No locale comparison, Unicode normalization, compatibility folding, or confusable mapping participates in authority.

## Repository and source audit

For the first remediation, `git fetch origin --prune` confirmed `origin/main` at `66659c1296e05424179e2b4cc6ee1924ece4fbc9`. GitHub PR #216 and `origin/codex/pr8-actual-source-eligibility-dry-run` both pointed to `3f498cf3cfa513b923cfdc0e7a8c21ecaae84e55`, exactly the independently reviewed head. For the second focused remediation, `origin/main` remained at the same SHA and the local branch, remote branch, and PR head all exactly matched `285d32e24b8eb0c97e95b5d84c8d7d74cb365ef0`; the target worktree was clean. For the third focused remediation, `origin/main` and the merge base remained unchanged, while the local branch, remote branch, and PR head exactly matched the independently reviewed `0ed8f18f4786c94d1ce769871bfebabbe1432c0e`; the target worktree was clean. For the fourth focused remediation, `origin/main` and the merge base again remained unchanged, while the clean local branch, remote branch, and PR head exactly matched the independently reviewed `0e4ab783a4c0cb4051280818967ffbd71ea8f164`. For the fifth focused remediation, `origin/main` and the merge base remained unchanged, while the clean local branch, remote branch, and PR head exactly matched the independently reviewed `3143c1ed4f88eddd09dc138a18ecf8cba91ecfbc`. For the sixth focused remediation, `origin/main` and the merge base remained unchanged, while the clean local branch, remote branch, and PR head exactly matched the independently reviewed `dfb5e7f9afb92b038571e04820c502821e9702de`. The complete PR diff and commits were reread, and GitHub comments, reviews, and review threads remained empty. The follow-up findings therefore remained directly applicable without rebasing or adapting to unreviewed changes.

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

There is no PR7, canonical, settlement, Finance, document, rental, payment, or other legacy fallback source. The only `app_data` access in the PR8 execution/read repositories is their repository-owned `users` read required for fresh PR5 human-principal authorization. Names, labels, document filenames, array positions, mutable settings, environment policy values, and external source hashes are not treated as authority.

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

Every table rejects `UPDATE` and `DELETE`. Operations and audit rows also reject replacement. Operation insertion is the final seal: later input, candidate, check, reconciliation, diagnostic, or audit-link insertion is rejected. Candidate and input activation-boundary lineage has an exact `(activationBoundaryId, companyId, branchId)` foreign key to the PR6 activation boundary. Candidate children use `(candidateId, runId, companyId, branchId)` so a child cannot combine one run with another run's candidate; nullable `candidateId` remains reserved for complete run-level rows. Startup reconstructs the exact foreign-key map from `PRAGMA foreign_key_list`, including tables, ordered from/to columns, and `RESTRICT` behavior. It also compares the exact executable semantic-token `CHECK` multiset for every PR8 table, all expected unique keys, the complete semantic-token `sqlite_master.sql` for all 14 named indexes and every PR8 trigger, every trigger's bounded-identity `sqlite_master.name` and `tbl_name`, and index table/uniqueness/partial/ordered-key/expression/collation/direction metadata from `PRAGMA index_list`, `index_info`, and `index_xinfo`. Comments and `CHECK` text inside string literals or quoted identifiers are never executable constraints. Only ASCII SPACE, TAB, LINE FEED, CARRIAGE RETURN, and FORM FEED are insignificant formatting whitespace; comments, ASCII keyword/unquoted-identifier case, and semantically equivalent quoting of simple ASCII non-keyword identifiers are also insignificant. Structural metadata uses the same bounded rule: all-ASCII identifiers compare with only `A-Z` folded, while any identifier containing non-ASCII compares exactly. Every other spacing or zero-width code point remains significant. Non-ASCII identifiers remain exact and distinct from ASCII identifiers; string values, numeric spellings, operators, predicates, constants, expressions, events, targets, bodies, conflict behavior, keyword quoting, spaces, and escaped identifier delimiters remain significant. Malformed SQL and registered weakened or misdirected schemas fail closed on initial and repeated startup. Repeated valid startup preserves the original `applied_at`. There is no down/delete migration, TTL, purge, cleanup worker, or finite retention.

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

The client-signature decision is additionally bound to the exact conducted source `signatureRequirementPolicyRef`. The approved gate must carry an exact `expectedSourceRef`, approved decision reference/version/hash/schema, and applicable company/branch/contract scope. Missing source/expected references emit `SIGNATURE_POLICY_REFERENCE_MISSING`; identity or scope mismatch emits `SIGNATURE_POLICY_REFERENCE_MISMATCH`. Only after exact identity matching may allow-listed `required` or `not_required` semantics be evaluated, and `required` still requires signature evidence.

Source-adapter authority is evaluated over a canonical sorted ownership manifest for every candidate input. Source-owned economic/evidence rows — rental lines, effective terms, all relevant snapshot evidence, UPDs, and UPD line versions — must disclose a known source system exactly approved by the versioned gate. Activation boundaries, periods/events, snapshots, UPD-version/conducted evidence, coverage/mapping rows, and operations prove ownership through exact PR6 repository-owned relational lineage and hashes instead of receiving an invented adapter identity. PR6 audit rows are also classified as repository lineage even though `billing_source_audit_events.sourceSystem` is required: the repository generates that value as attribution metadata for the audited operation (falling back to `billing_source_authority`), so it is neither a separate economic/evidence authority nor an adapter-owner claim. Missing source-owned attribution emits `SOURCE_ADAPTER_AUTHORITY_INCOMPLETE`; any unknown, extra, or unapproved source system on a source-owned economic/evidence row emits `SOURCE_ADAPTER_AUTHORITY_MISMATCH`.

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

The complete source input manifest includes every allow-listed PR6 row in deterministic order, with external provenance assertions separated from repository-owned normalized integrity hashes. Before persistence the service creates an immutable branded plan. After `BEGIN IMMEDIATE`, the repository freshly revalidates PR5 authority and PR6 rows, recomputes the full manifest and policy/source evaluation, and rejects source or policy drift. Before sealing it rereads every persisted candidate, check, reconciliation, and diagnostic; reconstructs canonical content only from relational columns; maps generated IDs back to business candidate keys; recomputes each repository-owned child hash; rejects missing, extra, duplicate, reordered-logical, status, blocker, identity, content, lineage, or hash drift; and rebuilds deterministic child manifests, counts, eligible/blocked totals, run status, and the complete result hash. It then inserts audit and the sealing operation, rereads both rows, and exactly verifies authorization identity, links, aggregate identity, hashes, counts, and timestamps. Any mismatch or SQLite failure rolls back the complete transaction without operation/audit or partial PR8 rows.

## Authorization, reads, idempotency, and concurrency

Evaluation requires a branded server-created context for a live authenticated human principal, active exact-version membership, live exact-version role template, current catalog version, `receivables.read`, exact company scope, and one concrete active authorized branch. Administrator display labels grant nothing. Integration/system actors are unsupported. Client company IDs are not authority; branch filters can only narrow trusted scope. Fresh authority is checked again on the same connection inside the locked transaction.

The internal read repository exposes only `listDryRuns`, `getDryRun`, `listCandidates`, `listChecks`, `listReconciliations`, `listDiagnostics`, `inspectOperation`, and `inspectAuditHistory`. A read scope can be issued only from a server-branded PR5 human actor and a live exact membership through the PR5 resolver; caller-provided principal, membership, company, capabilities, or a forged scope confer no authority. Before every query the repository uses its own same-connection user reader and rechecks legacy user state, active exact-version membership and role template, current catalog, `receivables.read`, exact company, concrete branch grants, and active branches. Membership/role/catalog/capability/branch/user revocation invalidates an already issued scope before diagnostic data is returned. Reads remain deterministically ordered, use allow-listed filters and a 200-row maximum, and neither recalculate eligibility nor project debt, aging, overdue, activation, canonical, settlement, or forecast semantics.

Idempotency is `companyId + evaluate_actual_source_dry_run + idempotencyKey` and binds branch, principal, membership/version, role-template/version, catalog version, `receivables.read`, policy-manifest hash, complete input-set hash, command fingerprint, correlation ID, and result run/hash. Exact replay returns the original logical result with `replayed = true` and creates no row. Changed authority, branch, policy, source, content, or hash yields a deterministic domain conflict.

Independent SQLite-connection tests establish one atomic first-run winner plus exact replay, and one winner plus `ACTUAL_SOURCE_IDEMPOTENCY_CONFLICT` for the same key with different policy. Repository-boundary remediation covers source correction/hash drift, reopen/version drift, coverage supersession, capability/membership loss, and branch deactivation before commit. Busy/locked SQLite errors are mapped to domain conflicts; no raw `SQLITE_BUSY`/`SQLITE_LOCKED`, partial run, duplicate candidate/result, orphan child, or missing operation/audit escapes.

## Verification evidence

All verification used Node `v20.20.2` and npm `10.9.4` from an isolated Node 20 runtime. Dependencies were installed from committed lockfiles; no package manifest or lockfile changed.

| Check | Result |
|---|---:|
| First focused remediation suites | 55 passed, 0 failed |
| Registered-schema structural remediation suite | 54 passed, 0 failed |
| Persisted structural rejection matrix | 33 mutations rejected: 8 original `CHECK`, 6 lexical decoy, 3 malformed SQL, 6 index, 10 trigger; direct/repeated/`applied_at`/no-repair fingerprint controls passed |
| Semantic SQL controls | nested expressions and literal `CHECK` tokens parsed correctly; only U+0020/U+0009/U+000A/U+000D/U+000C formatting is ignored; vertical tab and 22 non-ASCII spacing/zero-width code points remain significant; bounded metadata comparison accepts mixed ASCII case only when both identifiers are all-ASCII; equivalent unquoted/double/backtick/bracket trigger names, targets, and indexes are accepted; Unicode lookalikes/case variants, meaningful quoting, strings, numbers, and operators remain distinct |
| All PR8 remediation suites | 121 passed, 0 failed |
| All focused PR8 suites | 160 passed, 0 failed |
| Persisted-sealing fault regressions | 14 passed, 0 failed |
| Direct FK/altered-schema SQL probes | 12 passed, 0 failed |
| PR1/PR2/PR3/PR5/PR6/PR7/PR8 compatibility suites | 616 passed, 0 failed |
| `npm test` | 2,338 passed, 0 failed |
| Repeated `node --test tests/*.test.js` | 2,338 passed, 0 failed |
| `npm run build` | passed |
| `git diff --check` | passed |
| Fresh `PRAGMA foreign_keys` | `1` |
| Fresh `PRAGMA foreign_key_check` | clean (`0` rows) |
| Fresh `PRAGMA integrity_check` | `ok` |
| Fresh PR8 migration registration | exactly one v1 row; repeated startup and file-backed reopen preserved `applied_at` |
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

## Remediation changed files

Implementation and tests:

- `server/lib/actual-source-eligibility-dry-run-domain.js`
- `server/lib/actual-source-eligibility-dry-run-policy.js`
- `server/lib/actual-source-eligibility-dry-run-read-repository.js`
- `server/lib/actual-source-eligibility-dry-run-repository.js`
- `server/lib/actual-source-eligibility-dry-run-schema.js`
- `server/lib/platform-identity-repository.js`
- `tests/actual-source-eligibility-dry-run-eligibility-remediation.test.js`
- `tests/actual-source-eligibility-dry-run-fixtures.js`
- `tests/actual-source-eligibility-dry-run-fk-remediation.test.js`
- `tests/actual-source-eligibility-dry-run-read-authorization-remediation.test.js`
- `tests/actual-source-eligibility-dry-run-read-repository.test.js`
- `tests/actual-source-eligibility-dry-run-safety.test.js`
- `tests/actual-source-eligibility-dry-run-sealing-remediation.test.js`
- `tests/actual-source-eligibility-dry-run-structural-remediation.test.js`
- `tests/billing-source-authority-fixtures.js`

Documentation:

- `docs/actual-source-eligibility-pr8-audit.md`
- `docs/canonical-receivables-contract.md`
- `docs/canonical-receivables-decisions.md`

## Unresolved decisions, exclusions, and PR9 boundary

The foundation-only release marker resolves documentation lifecycle status only. It resolves none of the accountant, legal, tax, evidence, production activation, operating-procedure, execution, or canonical-write decisions. Source/accounting sufficiency, original-amount basis, conducted evidence authority, client-signature requirements/evidence, contractual due-date provenance, unknown-date treatment, VAT selection/basis, rounding mode/order/residual allocation, operational-event authority/precedence, correction/cancellation/reopen/replacement effect, activation date/boundary/cohort, named production adapter/actor, concrete production identity/grants, legal-hold/export/access/tamper controls, runbooks, consumer sign-off, and production execution/activation authorization remain fail closed.

The merged implementation performed no production identity/bootstrap/source population and evaluated no production actual-source data. It created no canonical receivable, canonical financial audit, settlement/payment/allocation/adjustment/refund/write-off, source mutation, forecast mutation, legacy mutation, `ActualReceivableEligibleV1`, posting event, outbox, source adapter, activation command, import, backfill, dual write, shadow read, route, worker, scheduler, timer, queue, CLI, frontend change, Finance/Dashboard/Company Health/Risks switch, deployment, or cutover. This docs-only release marker changes none of those boundaries.

**PR9 remains BLOCKED pending production evidence, governed source/adapter approval, explicit canonical-write authorization, operational controls, and a separate architecture gate.** Those gates include explicit accountant/legal confirmations, approved VAT/rounding and due-date/signature/correction policy, approved activation boundary/cohort and named adapter authority, real production identity/source population, a successful production dry run, zero unexplained net/VAT/gross delta, and approved reconciliation/rollback and retention-control runbooks. PR8 emits no future posting event and authorizes no canonical write.

Future runtime activation has an additional explicit P2 blocker: it requires a separate governed execution capability, admission/rate controls, concurrency limits, storage telemetry, and approved retention/legal-hold controls. Existing `receivables.read` is acceptable only inside this isolated foundation/test boundary; it is not approval of a future runtime execution contract. No HTTP API or runtime consumer was added, and PR9/activation remain blocked.

Rollback of this code means disabling/reverting unreachable code while retaining all immutable PR8 history. Financial/audit rows are never deleted as a rollback mechanism. Failed migrations and failed runs roll back atomically; successful diagnostic rows are conserved indefinitely.

**Final status:** **PR8: RELEASED — Actual-Source Eligibility Dry Run foundation only.**
