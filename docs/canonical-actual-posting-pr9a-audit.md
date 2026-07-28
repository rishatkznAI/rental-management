# PR9a Disabled Canonical Actual Posting Foundation Audit

## Status and fixed authorization boundary

This document records the repository implementation authorized by Gate B at commit
`da3bd21935abfbd42c95ef8be9eac1eecb56e95c`, based on architecture baseline
`fefb5c482bcb63dedbb81ec9eb12da49d57a358a`. The implementation is PR9a only and is
disabled by construction. It is not a deployment, production-migration, activation,
canonical-read, canonical-write, settlement, shadow-read, cutover, or PR9b approval.

The authorization state remains:

```text
foundationDeploymentRetryAuthorized = FALSE
architectureDesignApproved = TRUE
pr9aImplementationAuthorized = TRUE
pr9bImplementationAuthorized = FALSE
pr9ImplementationAuthorized = FALSE
pr9DisabledDeploymentAuthorized = FALSE
productionActivationAuthorized = FALSE
canonicalProductionReadsAuthorized = FALSE
productionCanonicalWritesAuthorized = FALSE
settlementAuthorized = FALSE
shadowReadAuthorized = FALSE
cutoverAuthorized = FALSE
```

No live adapter, production authority approval, route, worker, scheduler, flag,
resolver, environment activation, deployment integration, Railway access, or
production database execution is part of this change.

## Implemented schema foundation

Migration `canonical_actual_posting_pr9` version `1` adds exactly these seven tables:

1. `governed_adapter_authority_records`
2. `canonical_write_authorization_records`
3. `canonical_posting_activation_records`
4. `actual_receivable_eligible_events`
5. `canonical_receivable_posting_operations`
6. `canonical_receivable_posting_conflicts`
7. `canonical_receivable_posting_conflict_transitions`

The initializer runs immediately after the PR8 initializer in `server/db.js`. It is
additive, requires the exact PR1/PR2/PR5/PR6/PR7/PR8 migration and catalog baseline,
uses an immediate transaction for first application, registers one v1 migration row,
and validates the complete registered structure on every rerun. A registered partial,
weakened, wrong-version, or competing schema fails closed; a valid rerun is read-only
and preserves the original migration timestamp.

The schema contains exact ordered indexes and composite foreign keys, immutable and
append-only guards, version-chain guards, authority-binding triggers, event and
operation seal guards, the audit-side activation predicate, and reciprocal deferred
conflict/transition links. The reciprocal pair can commit only when both directions
agree on transition ID, conflict ID, scope, denial-attempt ID, and conflict hash.

The audit-side trigger activates exactly when the inserted audit row has the PR9
event literal or when an operation references its ID. It requires exactly one
operation and verifies scope, operation, event, canonical-receivable, actor,
authority, timestamp, correlation, literal, and complete exact 33-key payload
bindings. The operation-to-audit composite FK is deferred, preserving the normative
canonical receivable → operation → audit order. These objects are foundation
constraints only; PR9a contains no code that inserts a canonical receivable,
posting operation, or financial audit event.

## Serialization and authority proof

The domain accepts only bounded deeply inert JSON data: valid Unicode scalar strings,
plain objects and dense arrays, booleans, null, and safe integers other than negative
zero. Proxies, accessors, custom prototypes, `toJSON`, symbols, cycles, sparse arrays,
floats, coercion, duplicate JSON keys, BOMs, invalid UTF-8, unsafe integers, and input
beyond the byte/depth/node limits fail closed.

Canonical JSON uses explicit UTF-16 key ordering and SHA-256 domain-separated v1
envelopes. No locale comparator, subtraction comparator, implicit numeric/string
coercion, or caller serialization hook is used. Hash, timestamp, UUIDv4, identifier,
version, and money constraints have stable errors.

Authority, write-authorization, and activation repositories support exact append,
read, replay, version-chain, latest-chain, candidate-order, kind-major global
precedence, and frozen-boundary proof. Frozen snapshots include the complete
root-to-head member set, candidates, boundary, hashes, and precedence result. Every
frozen member is reread through the full governed record envelope and must satisfy:

```text
recomputedRecordHash
  == persistedRecordHash
  == frozenAuthorityRecordHash
```

A missing or changed frozen member fails closed. A complete contiguous descendant
above the frozen maximum is proven but remains outside the historical attempt and
cannot change its classification.

## Algorithm A, replay, denial, and recovery

The disabled eligibility repository follows the fixed locked prefix:

```text
BEGIN IMMEDIATE
→ exact scope and zero-incomplete-transition guard
→ repository clock read exactly once
→ validate and render RFC3339 UTC milliseconds
→ node:crypto.randomUUID({ disableEntropyCache: true }) exactly once
→ validate lowercase RFC 9562 UUIDv4
→ deterministic locked derivation
```

Generation failures use `CANONICAL_DENIAL_ATTEMPT_ID_GENERATION_FAILED`, generate no
replacement, and write no row. A proven self-consistent UUID collision uses
`CANONICAL_DENIAL_ATTEMPT_ID_COLLISION`; corrupted persisted replay evidence uses
`CANONICAL_CONFLICT_REPLAY_INTEGRITY_FAILED`.

Algorithm A rereads accepted PR8 evidence, freshness, PR5 timezone, current PR6
lineage, authority chains, write authorization, activation, boundary, cohort, and
due-date policy. A new path inserts only one `ActualReceivableEligibleV1`. Persisted
identity is checked by lineage, current revision, and dry-run/candidate keys. Exact
event replay reuses the original ID, correlation ID, and timestamps and performs zero
writes. Any validation, trigger, insert, or post-insert reconstruction failure rolls
the event transaction back.

Authority denial classification reconstructs all three complete chains before event
lookup, applies source-before-producer-before-posting kind-major precedence, and
persists one selected snapshot plus every suppressed lower-precedence candidate.
Algorithm C independently rebuilds the authority observation from the immutable rows
and frozen snapshots before either exact replay or new evidence admission. A later
descendant with persisted lifecycle status `expired` takes the registered
unrepresentable zero-conflict-DML path.

Required safely reconstructable denial evidence is persisted only after the primary
transaction rolls back. Algorithm C classifies both repository replay keys before
append-specific admission, proves located conflict/transition pairs and all three
authority snapshots, and distinguishes replay integrity from genuine collision.
New evidence uses its own single `evidenceAttemptedAt` clock and locked
`scopeSequence`; operational order is only `(evidenceAttemptedAt, scopeSequence)`.
The rolling-minute rate guard permits at most 30 committed pairs. Immediate and
fifth-in-five circuit results are reconstructed only from durable applied rows.

Conflict and transition rows commit atomically with reciprocal deferred FKs. The
transition advances monotonically through `PENDING`, `ACCOUNTED`,
`CIRCUIT_APPLIED`, and `COMPLETE`, with separate attempt, rate, and circuit keys and
durable applied/result markers. Reapplication is byte-exact. After pair commit the
synchronous reconciler is mandatory; normal denial return is allowed only after
`COMPLETE`. An incomplete scope blocks the current invocation, runs the separate
reconciler, and returns `CANONICAL_CONFLICT_TRANSITION_RECOVERY_REQUIRED`; that
invocation never resumes.

## Draft PR 233 independent remediation record

This section supersedes the earlier unsupported statement that all prior P1 findings
were closed. It records implementation evidence only. Closure and merge authorization
remain the responsibility of a separate independent re-audit.

| Finding | Remediation in this PR tree | Independent hostile evidence | Local result | Residual limitation |
| --- | --- | --- | --- | --- |
| A-01 | Algorithm A reconstructs every accepted PR8 run from the persisted eight-table graph, requires an exact sorted evidence/pair set, binds timezone, policy, input, ownership, reconciliation and selected pair, and recomputes all acceptance hashes. | A minimal test-only canonical JSON/SHA-256 implementation reseals foreign, missing, duplicate, divergent, timezone, ownership, multi-run, missing-parent and stale envelopes without importing the production acceptance constructors. | Initial audited tree: all six focused hostile subtests failed. Remediation tree: the focused six-subtest proof and the seven-case complete-set matrix pass. | The fixtures are synthetic and do not prove production PR8 evidence quality. |
| A-02 | Authority reread parses normalized logical arrays, derives policy hashes from accepted evidence, independently recomputes cohort/boundary, verifies local-midnight UTC and fixed source/document/rental/currency classes, and compares authorization/activation logical projections. | Test-only cohort/boundary envelopes and outer record sealing reject equal forged labels, stale logical fields, policy divergence, reordered/duplicate arrays and a pre-boundary source. | Seven hostile cases pass; the fixed independent cohort and boundary hashes equal the valid persisted fixture before each mutation. | The timezone calculation is covered for the authorized fixture zone, not every IANA transition. |
| A-03 | Source classification begins with the complete same-scope logical coverage set, scans all 16 PR6 authority tables for the relevant closure, seals complete sorted roots/edges/revisions, rejects disconnected components and forks, and gives graph ambiguity precedence over narrow revision selection. | Independent persisted-row and broken-edge fingerprints prove a two-edge fork; independent root envelopes prove three disconnected overlapping roots; missing predecessor, invalid replacement, zero/multiple current and formed-version drift are hostile mutations. | Three focused full-graph subtests pass, and the broader locked source state-machine suite passes. | The artificial fixture contains one business scope; repository-wide production cardinalities are outside PR9a authorization. |
| A-04 | Historical candidates and precedence are rebuilt only from rows through each frozen maximum. Later descendants are checked separately as an immutable contiguous suffix and are excluded from historical selection. | End-to-end rollback/freeze tests append a valid descendant or inject a malformed row, a gap, or a pre-boundary mutation before Algorithm C admission. | The valid descendant preserves the original `PR8_EVIDENCE_MISMATCH`; three corruption cases fail integrity with zero conflict/event DML. | A correctly appended suffix is proven structurally, not authorized for production use. |
| A-05 | Missing selected PR8 run/candidate rows create the contract's nullable PR8 observation. A uniquely reconstructable source identity is recovered from persisted reconciliation/input/PR6 rows solely to seal required conflict identity, then Algorithm C rechecks the same absence. | Separate missing-run, missing-candidate and missing-both cases verify exact projection keys, nullable reconciliation/result members, one conflict, one transition and applied attempt/rate/circuit accounting. | All three parent-absence cases pass with `PR8_EVIDENCE_MISMATCH` and `COMPLETE` transitions. | If the remaining rows cannot identify one source scope, the package is genuinely unrepresentable and fails integrity. |
| A-06 | Hostile expected values use a test-only restricted canonical serializer and direct Node SHA-256, plus independently written acceptance, cohort, boundary, row and edge envelopes. Production constructors remain only in older parity tests. | A fixed external SHA-256 golden anchors the test oracle; each forgery changes logical data and recomputes outer sealing. | Golden and mutation matrices pass. | Independent tests share Node's cryptographic primitive with production, but not production projection code. |
| A-07 | This document removes blanket closure claims, records evidence per finding and separates implementation, architecture, merge and production states. | Document and changed-file scans verify the authorization literals and absence of deployment/PR9b activation. | Implementation evidence is recorded; finding closure is not self-authorized. | Final acceptance still requires independent review of the pushed PR head. |

### Draft PR 233 P1 remediation contract

The three findings below were reproduced against audited head
`9635a39327cd3ca18cf2b1926a35af047afb3121` before production code changed. The
focused red run was:

```text
node --test --test-name-pattern='P1-0[12] red proof|one entropy call' \
  tests/canonical-actual-eligibility-event.test.js
0 passed, 3 failed
```

The failures were the expected pre-remediation observations: no reopen denial, no
selected-run policy denial, and one UUID total rather than two after event plus exact
replay. General green suites never supersede those reproduced contract violations.

| Contract | Authoritative source | Untrusted derived fields | Success | Required denial / operational failure | DML and accounting | Check points |
| --- | --- | --- | --- | --- | --- | --- |
| P1-01 billing-period current state | Complete same-company, same-branch, same-period PR6 `billing_source_period_versions` graph ordered by semantic `version` | Old PR8 `closedPeriodVersionId`, physical row order, operation/audit fingerprints and an unchanged old close row | Exactly one contiguous latest period row, latest event `closed`, and candidate bound to that exact latest close | Zero current: `SOURCE_LINEAGE_NO_CURRENT_REVISION`; multiple conducted current revisions retain `SOURCE_LINEAGE_MULTIPLE_CURRENT_REVISIONS`; PR8 evidence mismatch retains its existing higher precedence | Denial: events 0, conflicts +1, transitions +1; transition `COMPLETE`, attempt/rate/circuit each applied once; no canonical business DML | Before replay/event lookup, before insert, and same-transaction post-insert reread |
| P1-02 selected-run named policies | Selected persisted PR8 run's canonical `policyManifestJson`, its proven manifest hash/run/candidate graph, exact named gates, write authorization and activation | Aggregate manifest-hash labels, self-hashed due set, authorization-only amount labels, identities from another accepted run | Selected contractual and unknown-due identities exactly match authorization/activation; selected amount ref/hash is authorized and v1 event uses `slice_gross_minor` | Due gate mismatch: `DUE_DATE_POLICY_DRIFT`; amount mismatch: existing `CANONICAL_WRITE_AUTHORIZATION_INTEGRITY_FAILED` because v1 has no registered amount conflict projection | Due denial: events 0, conflicts 1, transitions 1 with complete 1/1/1 accounting. Amount operational failure: events/conflicts/transitions all 0 | Before replay/event lookup, before insert, and same-transaction post-insert reread |
| P1-03 invocation entropy | Repository-owned clock and `node:crypto.randomUUID` | Replay result and every deterministic repository identity other than denial-attempt UUID | Every invocation past incomplete-transition and clock validation consumes exactly one UUID with entropy cache disabled | Invalid/throwing UUID keeps existing generation error; proven collision keeps existing collision error; incomplete transition and clock failure consume zero UUID | UUID never creates DML by itself; success/replay/denial/collision paths preserve their existing DML contracts | Immediately after guard and one clock read, before context reconstruction and every replay/event lookup |

### P1-01 — authoritative billing-period current state

Independent reproduction appended a normal PR6 `billing_period` successor changing
exactly `eventType` from the accepted `closed` state to `reopened`, with
`previousVersionId` and `reopensClosedVersionId` both bound to close v1. The service
fingerprint, `billing_source_operations.resultFingerprint`, and
`billing_source_audit_events.afterFingerprint` were all recomputed and equal. Before
remediation the actual result was one event, zero conflicts, zero transitions and no
error. The design result is a required `SOURCE_LINEAGE_NO_CURRENT_REVISION` denial
before event lookup.

Root cause was that locked reconstruction proved the old PR8 input and conducted UPD
rows but did not reconstruct the current period successor graph; physical immutability
of close v1 was incorrectly sufficient. `hasUniqueCurrentClosedPeriod` now reads the
complete scoped version graph, proves unique contiguous versions and predecessor/event
semantics, and admits only the exact latest close selected by the current slice.
`analyzeLockedSourceGraph` applies that predicate before it creates any conducted
revision candidate. The normal pre-insert reconstruction and mandatory post-insert
reread both use this path inside `BEGIN IMMEDIATE`.

Hostile cases cover closed→reopened, reopened→closed again with the old PR8 close,
two reopen descendants, wrong predecessor, foreign period scope, operation/audit-only
rows, version-vs-ID ordering, stale old PR8 membership, independently resealed
authorization/activation around stale evidence, competing reopened roots, PR8/source
precedence, replay after reopen, and reopen injected after event insert. Every
same-scope stale/malformed case produces zero current revisions and the registered
denial with events 0, conflicts 1, transitions 1 and complete 1/1/1 accounting.
Foreign-scope and operation/audit-only cases create exactly one event and no conflict
or transition. The post-insert mutation produces
`CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED` and rolls back both injected row and
event, leaving all posting counts zero.

Residual limitation: these tests use isolated PR6 rows. They prove the v1 event types
`closed`/`reopened`; any future PR6 period lifecycle literal requires a separately
authorized design/schema update rather than an implicit mapping here.

### P1-02 — selected accepted-run named-policy binding

Independent reproduction added a second valid accepted PR8 run and changed the exact
`contractual_due_date` and `canonical_amount_basis` decision ref, version and hash.
It independently recomputed the selected manifest/result, accepted dry-run,
freshness/evidence hashes, manifest-hash set, cohort, authorization and activation
record seals. Before remediation Algorithm A created one event with the selected v2
manifest hash but v1 due/amount identities: events 1, conflicts 0, transitions 0 and
no error. The minimum required design result was `DUE_DATE_POLICY_DRIFT`, and an
amount-only mismatch also had to block.

`selectedRunPolicyBinding` now parses the selected persisted manifest, requires exact
manifest and named-gate membership/shape/scope, and reconstructs contractual due,
unknown-due mapping and canonical amount identities from that run. PR8 proof binds
the manifest hash, run and candidate; authorization/activation bind the selected
manifest set and exact due set; authorization must bind the amount ref/hash. Because
`ActualReceivableEligibleV1` has no amount-policy-version column, a non-v1 amount gate
fails closed instead of silently losing its version. Due mismatch uses the registered
`DUE_DATE_POLICY_DRIFT`; amount mismatch uses the existing design operational error
`CANONICAL_WRITE_AUTHORIZATION_INTEGRITY_FAILED` and is never disguised as a denial.

The hostile matrix separately covers ref/version/hash drift for due and amount,
unknown-due literal drift, amount value drift, missing/duplicate/reordered/foreign
entries, same aggregate label with different logical content, second-run manifest
substitution, selected v1 plus activation v2, independently valid authorization and
activation bound to different accepted runs, fully resealed multi-run acceptance,
and a post-insert amount mutation. Due cases return events 0, conflicts 1,
transitions 1, `COMPLETE` 1/1/1 accounting and `DUE_DATE_POLICY_DRIFT`. Amount-only
cases return the exact operational code with events/conflicts/transitions all 0.
Malformed or stale PR8 manifests retain `PR8_EVIDENCE_MISMATCH` with the normal one
conflict/one transition accounting. Post-insert mutation rolls back with
`CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED` and zero durable DML.

Residual limitation: the approved v1 schema exposes amount policy ref/hash but no
separate amount decision ID/version in authorization, activation, or event. The
implementation therefore supports only amount decision version 1 and fails closed
for later versions; widening that projection is outside this remediation contract.

### P1-03 — exactly one UUID after early guards

Independent reproduction observed one UUID on the first invocation and zero on
byte-exact replay, for one total call. The required result is one
`randomUUID({ disableEntropyCache: true })` per invocation after the incomplete
transition guard and one clock read/validation.

Algorithm A now generates and validates the sole denial-attempt UUID and performs the
collision guard immediately after clock validation, before `loadAcceptedContext`,
business derivation and every replay/event lookup. Event and correlation identities
remain deterministic and replay comparison does not contain the unused replay UUID.

The matrix proves first success 1, exact replay an additional 1, required denial 1,
collision 1, context reconstruction failure 1, corrupted replay validation 1 and
amount operational failure 1. Every observed call has the exact entropy-cache option.
Incomplete-transition and clock-failure invocations each consume 0. No tested path
consumes 2 UUIDs, and all existing success, denial, collision and zero-DML accounting
contracts remain unchanged.

Residual limitation: UUID call-count proof is at the repository boundary with a
fresh module and patched Node primitive; it does not evaluate platform entropy
quality, which remains Node's responsibility.

The red phase was preserved in test output before production remediation: the focused
hostile parent reported 0 passing and 7 failing tests on the audited behavior. The
same parent reports 7 passing and 0 failing tests after remediation. Green general
tests are corroborating evidence, not the sole closure oracle.

### Authorization state after remediation

```text
architecture = TRUE
PR9a = TRUE
PR9b = FALSE
full PR9 = FALSE
merge = FALSE
production activation = FALSE
production reads = FALSE
production writes = FALSE
```

## Disabled-by-default evidence

Only the schema initializer is connected to normal database startup. The authority,
eligibility repository, and service are exported modules used by isolated tests and
future separately authorized code. `server/server.js`, routes, frontend code,
workers, schedulers, resolvers, and production flags do not import them. The
eligibility repository has no canonical-receivable, posting-operation, audit,
settlement, legacy, or `app_data` insert/update/delete statement. There is no
Algorithm B or PR9b module.

## Verification coverage

The PR9a suites cover schema inventory and exact structure; idempotent initialization;
append-only and reciprocal-pair constraints; restricted canonical JSON and hashes;
UUID, timestamp, safe-integer, comparator, version, ordering, and stable-error
contracts; authority versions 2 and 10, precedence, missing/mutated members and
post-boundary descendants; normal eligibility creation and event replay; clock/UUID
failures and zero DML; forced transaction rollback; collision versus corruption;
independent-process concurrency; 31-candidate rate admission; direct, reverse,
random, and equal-time ordering; fifth-in-five reconstruction; pair-commit and
stage-crash recovery; repeated recovery; audit seal success/failure; the closed
changed-file allow-list; prohibited imports and scope; authorization values; and
disabled integration.

Final command results and the implementation commit/PR identity are recorded in the
implementation pull request. Local fixtures are artificial and grant no production
evidence, adapter approval, activation, migration, read, write, or deployment status.

The final local verification result for this remediation tree is:

- focused P1 red proof before production remediation: 0 passed, 3 failed with the
  exact missing-denial/missing-UUID observations; focused final P1-01 matrix:
  14 passed, 0 failed in 9.603 s; focused final P1-02 matrix: 19 passed, 0 failed
  in 13.183 s; focused P1-03/entropy/collision matrix: 3 passed, 0 failed in
  7.825 s;
- complete Algorithm A/C eligibility file: 140 passed, 0 failed in 110.704 s;
- targeted PR9a suites, two separate final-tree runs: 174 passed, 0 failed in
  105.916 s and 105.254 s;
- `npm test`, two separate final-tree runs: 2,517 passed, 0 failed in 120.672 s
  and 120.398 s;
- explicit `node --test tests/*.test.js`: 2,517 passed, 0 failed in 118.666 s;
- `npm run build`: passed in 6.67 s, 3,385 modules transformed;
- clean Node `v20.20.2` temporary copy with separately installed root/server
  dependencies: targeted PR9a 174 passed, 0 failed in 121.982 s; full suite
  2,517 passed, 0 failed in 136.005 s; build passed in 7.35 s with 3,385 modules;
- repository `server/data/app.sqlite` opened read-only: `foreign_key_check` returned
  no rows and `integrity_check` returned `ok`; a fresh isolated full schema returned
  the same results;
- schema inventory remains 7 tables, 38 named indexes and 41 named triggers;
- `git diff --check`, the Gate B changed-file allow-list, prohibited PR9b filenames,
  Algorithm B absence, canonical business DML absence, route/worker/scheduler/
  external-access absence, authorization guard, placeholder, repository-secret and
  added-line-secret scans passed;
- local primary runtime: Node `v22.22.0`, npm `10.9.4`; required engine verification:
  Node `v20.20.2` as recorded above.

## Known boundary

PR9a stops after eligible-event production and required denial/recovery foundation.
Canonical business posting, Algorithm B, live authority and adapters, production
policy/source evidence, deployment and migration execution, production reads/writes,
activation, settlement, shadow reads, and cutover remain deferred to their separate
authorizations. No implementation result in this change changes those gates.
