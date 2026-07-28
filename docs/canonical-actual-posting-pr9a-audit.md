# PR9a Disabled Canonical Actual Posting Foundation Audit

## Status and fixed authorization boundary

**REMEDIATION COMPLETE — INDEPENDENT RE-AUDIT REQUIRED**

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
of close v1 was incorrectly sufficient. `hasValidUniqueCurrentClosedPeriod` now reads
the complete period graph, proves unique contiguous versions and predecessor/event
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

### P1-01 follow-up — complete semantic billing-period lifecycle

An independent follow-up audit against head
`db7c94514a3067142ba214364f44a510f87b55fb` found that the prior P1-01 remediation
still accepted `closed v1 → closed v2` when a fully accepted and independently
resealed PR8 candidate selected v2. Both close rows had exact scope, contiguous
semantic versions, predecessor links, independently created snapshots, writer-created
operation/audit rows and matching result/after fingerprints. The actual result was
one eligibility event and no denial. The required result was
`SOURCE_LINEAGE_NO_CURRENT_REVISION`, events 0, conflicts 1, transitions 1 and a
`COMPLETE` transition with attempt/rate/circuit `1/1/1`.

The root cause was a partial state check: a `closed` row was required only to have
`reopensClosedVersionId = null`; its predecessor was not required to be `reopened`.
This allowed any structurally contiguous chain of closes to become current. The same
predicate fed initial reconstruction and the post-insert locked reread.

`hasValidUniqueCurrentClosedPeriod` now reconstructs the complete graph by globally
unique `periodId`, not by an ownership-filtered subset. This deliberately makes a
same-period company/branch drift visible instead of silently excluding it. It then:

1. requires the period root to match candidate company and branch;
2. orders every version by integer semantic `version`, independent of row ID, rowid,
   creation time, or insertion order;
3. requires exactly one v1 root, no duplicate/gapped versions, one successor at most,
   exact immediate predecessor links, full traversal and no cycle or disconnected
   component;
4. requires the only state sequence to alternate from initial `closed` through
   `reopened` and independently `closed` revisions;
5. requires reopen target and predecessor to be the same immediately preceding close;
6. requires every close to own a distinct snapshot whose scope, period,
   `closedPeriodVersionId` and `effectiveTermsVersionId` bind back to that close;
7. returns a current revision only after the entire graph is valid, the terminal state
   is `closed`, and PR8 selects that exact close.

The same validator is reached by the initial `loadAcceptedContext` before replay,
event and conflict lookup; it is explicitly rechecked before event lookup and before
insert against the same `BEGIN IMMEDIATE` snapshot; post-insert `loadAcceptedContext`
performs the full locked reread. Initial invalid persistence remains a required
source-lineage denial. Drift injected inside the transaction remains the registered
`CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED` rollback with no partial event,
conflict, transition or accounting DML.

#### Lifecycle transition matrix

| State/transition | Allowed | Current revision | Result when PR8 selects stated row |
| --- | --- | --- | --- |
| root `closed v1`, null predecessor/reopen target, independent snapshot | yes | v1 | event may be eligible |
| root `reopened v1` | no | none | `SOURCE_LINEAGE_NO_CURRENT_REVISION` |
| `closed → reopened`, both predecessor fields target the close | yes | none while reopened is terminal | `SOURCE_LINEAGE_NO_CURRENT_REVISION` |
| `closed → closed` | no | none | `SOURCE_LINEAGE_NO_CURRENT_REVISION` |
| `reopened → closed`, null reopen target and independent snapshot | yes | new close | event only when PR8 selects the new close |
| `reopened → reopened` | no | none | `SOURCE_LINEAGE_NO_CURRENT_REVISION` |
| valid chain but PR8 selects an older close | graph valid, selection stale | latest close only | `SOURCE_LINEAGE_NO_CURRENT_REVISION` |
| duplicate/gap integer version, competing root, fork, cycle or disconnected component | no | none | `SOURCE_LINEAGE_NO_CURRENT_REVISION` |
| non-integer, non-positive or unsafe persisted semantic-version storage/value | operational integrity failure before lifecycle classification | none | `CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID` |
| foreign predecessor, period/scope ownership drift or snapshot ownership/binding drift | no | none | `SOURCE_LINEAGE_NO_CURRENT_REVISION` |

The independent test harness does not call the production lifecycle validator as an
expected oracle. To create hostile rows with valid writer seals it temporarily exposes
the state expected by the production writer, lets the writer create the successor,
then restores the persisted predecessor. PR8 is regenerated over a single resealed
candidate after independently recomputing coverage slice/set and operation/audit
hashes. The pre-production RED run had four substantive failing cases: selected
illegal v2, selected illegal v3, same-period ownership drift and fully resealed
authorization/activation around illegal v2. The RED TAP therefore reported 16 passing
children, four failing children and the expected failing parent (16/21 overall). The
post-remediation contract run reports 21/21 passing tests.

The mandatory matrix covers stale/current PR8 selection, three consecutive closes,
initial reopen, double reopen, valid reopen/reclose controls, duplicate/gapped/same
versions, foreign predecessor, ownership drift, roots/forks/multiple current rows,
physical insertion order, exact replay, post-insert mutation, simultaneous PR8
corruption and fully resealed authorization/activation. A separate six-mutation
self-audit additionally covers snapshot reuse, a REAL semantic version, a root cycle,
reopen-with-close-payload, snapshot ownership drift and replay after predecessor
corruption. The later persisted-storage remediation changes the REAL-version result
to the required operational
`CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID` failure before lifecycle classification.

Implementation status is **REMEDIATION COMPLETE — INDEPENDENT RE-AUDIT REQUIRED**.
This is not a finding-closure, merge, deployment, production-read or production-write
authorization.

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

The prior `7cc2129` remediation evidence, superseded by the current effective-terms
and persisted-storage change, was:

- focused lifecycle remediation contract plus six-mutation adversarial self-audit:
  28 passed, 0 failed in 19.792 s; the mandatory contract alone reports 21/21 and
  the self-audit alone reports 7/7;
- complete Algorithm A/C eligibility file: 168 passed, 0 failed in 125.106 s;
- targeted PR9a suites, two separate final-tree runs: 202 passed, 0 failed in
  126.026 s and 123.322 s;
- `npm test`, two separate final-tree runs: 2,545 passed, 0 failed in 138.060 s
  and 143.533 s;
- explicit `node --test tests/*.test.js`: 2,545 passed, 0 failed in 138.267 s;
- `npm run build`: passed in 6.74 s, 3,385 modules transformed;
- clean Node `v20.20.2` temporary copy with separately installed root/server
  dependencies and Node 20 inherited by child processes: targeted PR9a 202 passed,
  0 failed in 149.901 s; full suite 2,545 passed, 0 failed in 167.169 s; build passed
  in 7.52 s with 3,385 modules transformed;
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

## Draft PR 233 effective-terms and persisted-storage remediation

The independent follow-up audit against
`7cc2129959a2f3c3ddc67ebba562d5b659976554` established two additional blockers:
Algorithm A did not independently prove the semantic ownership of the persisted
`effectiveTermsVersionId`, and a non-integer persisted billing-period semantic
version could be replaced by a synthetic object and hashed before it was rejected.
The findings were reproduced by test-only SQLite inspection, a restricted
test-only canonical serializer/SHA-256 implementation, writer-created PR8 evidence,
and independently resealed acceptance/authorization/activation records before
production code changed.

The pre-implementation focused RED run was:

```text
node --test \
  --test-name-pattern='P1 effectiveTermsVersionId semantic ownership RED contract|P1 persisted semantic-version storage fail-before-hash RED contract' \
  tests/canonical-actual-eligibility-event.test.js
45 tests: 9 passed, 36 failed
```

The terms failures created an eligibility event or selected the wrong denial despite
foreign rental-line ownership, stale/successor terms, invalid coverage/cycle
semantics, exact replay, and fully resealed PR8/authorization/activation evidence.
The storage failures classified REAL, TEXT, NULL, zero, negative and unsafe persisted
versions as `SOURCE_LINEAGE_NO_CURRENT_REVISION`; malformed storage combined with a
PR8 mutation selected `PR8_EVIDENCE_MISMATCH`. BLOB controls already reached the
persisted-row integrity error because the old synthetic replacement handled only
finite JavaScript numbers. Green pre-existing suites do not supersede this RED proof.

### Error precedence contract fixed before implementation

| Condition | Precedence and exact result | DML/accounting |
| --- | --- | --- |
| selected persisted PR6 semantic-version storage/type/value is invalid | `CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID` before every PR6 row/source-lineage fingerprint, PR8/source classification, authority denial selection and replay lookup | eligibility/conflict/transition/accounting all zero |
| governed authority chain has a registered denial | existing kind-major authority precedence remains higher than non-authority business/source denials | existing Algorithm C contract |
| authorization or activation drift | existing order before PR8/source classification | existing Algorithm C contract |
| selected PR8 evidence is invalid | `PR8_EVIDENCE_MISMATCH` before lifecycle/effective-terms/source-current denial | event zero; one conflict/transition and complete 1/1/1 accounting |
| billing-period lifecycle or effective-terms semantic edge is invalid with valid PR8 evidence | `SOURCE_LINEAGE_NO_CURRENT_REVISION` | event zero; one conflict/transition and complete 1/1/1 accounting |
| exact event replay candidate exists | considered only after all storage, authority, PR8, lifecycle and terms checks succeed | byte-exact replay is read-only |
| storage or semantic relationship changes after event insert | the same locked reconstruction reruns; the transaction rolls back and no partial event/conflict/transition/accounting DML survives | exact persisted-type error for invalid storage; persistence failure for a changed semantic edge |

This section records a remediation contract, not independent finding closure or merge,
deployment, production-read, production-write, or production-activation authority.

### Effective-terms ownership remediation

Root cause: Algorithm A reconstructed the close and snapshot IDs and included the
reachable terms row in the PR6 hash closure, but it never evaluated the relational
meaning of that edge. The PR8 verifier also reconstructed candidate
`inputLineageHash` by following the live snapshot terms ID without proving that the
selected terms input owned the selected rental line. A foreign row could therefore
remain completely sealed while being economically unrelated.

The repository now records the selected PR8 terms/rental-line input identities and
the exact `source_adapter_exact_match` evidence references while independently
verifying the complete PR8 graph. `hasValidEffectiveTermsBinding` then loads the
persisted PR6 rental line, terms, period, close, snapshot, coverage slice and UPD line
version and evaluates their logical fields. It does not accept a caller boolean,
label, aggregate hash or manifest membership as an oracle. The current terms chain
must be one contiguous root/successor chain and the selected row must be its terminal
revision. PR6 closure fingerprints remain evidence inputs, while semantic admission
is decided by the independent row-identity/relationship predicate so malformed
ownership retains the established source-denial classification.

The same predicate is reached during initial locked source reconstruction, the
explicit pre-insert lifecycle/terms assertion, and the full post-insert
`loadAcceptedContext` reread. Initial representable semantic failure produces
`SOURCE_LINEAGE_NO_CURRENT_REVISION`, events 0, conflicts 1, transitions 1 and a
`COMPLETE` transition with attempt/rate/circuit `1/1/1`. Relationship drift after
insert produces `CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED` and rolls back the
event and injected mutation.

#### Effective-terms binding matrix

| Expected relationship | Authoritative rows | Validation | Independent test | Result |
| --- | --- | --- | --- | --- |
| terms identity exists | `billing_source_snapshots`, `billing_source_effective_terms` | snapshot ID is non-empty and exact terms row is loaded by ID | foreign/missing identity variants | invalid edge denied |
| company/branch scope is exact | rental line, terms, period, close, snapshot, slice, UPD line version | every row equals selected company/branch | same-scope foreign owner plus existing cross-scope lifecycle coverage | only exact scope admitted |
| terms owns selected rental line | terms and rental line | `terms.rentalLineId === candidate.rentalLineId` | foreign line with same scope/cycle/coverage; correct ID with mutated owner | `SOURCE_LINEAGE_NO_CURRENT_REVISION` |
| economic source is the selected source | rental line, period, snapshot, slice | rental/client/contract and rental-line IDs bind the same candidate | foreign economic source; correct line with period drift | invalid edge denied |
| period and coverage are exact | terms, period, snapshot, slice | period/snapshot/slice intervals are equal and contained in terms half-open interval | other-period interval; shortened coverage | invalid edge denied |
| billing/contract semantics agree | terms, period, snapshot, UPD line version | cycle code/version, currency and calculation/VAT/rounding refs agree | billing-cycle mutation | invalid edge denied |
| selected terms revision is current | complete same-line terms chain | integer contiguous versions, immediate predecessor links, selected terminal row | stale predecessor; successor while candidate selects old row | invalid edge denied |
| snapshot selects exact terms | snapshot and terms | exact persisted ID equality | snapshot-only foreign ID | invalid edge denied |
| close selects snapshot terms | close and snapshot | both IDs equal the loaded terms identity | close-only foreign ID; split close/snapshot IDs | invalid edge denied |
| PR8 candidate input selects exact terms | selected PR8 input rows | candidate ID/input-lineage hash plus exact terms/rental-line source IDs and relationship fields | foreign input-lineage identity | invalid edge denied |
| selected PR8 run/candidate confirms identity | run, candidate, named source-adapter check | exact run/candidate IDs and evidence refs contain both row identities | two-candidate fully resealed run selecting the other candidate's terms | invalid edge denied |
| current PR6 revision contains the selected evidence rows | repository-owned PR6 closure plus independent semantic predicate | closure fingerprints the reachable persisted rows; rental-line/terms/period/close/snapshot identity is admitted only by the relationship predicate | independent persisted-row fingerprint and foreign closure case | a hashed wrong edge still cannot pass semantic admission |
| ownership acceptance is the same envelope | accepted PR8 entry, authorization, authority chain, named check | accepted ownership hash equals authorization; authority binding retains existing mismatch denial; exact semantic refs are separately required | aggregate hash unchanged while semantic edge differs | aggregate equality cannot authorize wrong edge |
| replay and locked reread repeat all checks | event lookup boundary and post-insert transaction snapshot | replay lookup follows validation; refreshed context reruns PR8 and source predicate | mutation after event; mutation after insert | no early replay; atomic rollback |

The post-green five-case self-audit additionally covers correct terms ID with the
wrong persisted owner, correct rental line with period semantic drift, byte-equal
labels/source hash on a foreign identity, a stale successor after an existing event,
and close/snapshot divergence after insert. It passes 6/6 including its parent.

### Persisted semantic-version fail-before-hash remediation

Root cause: `persistedRowFingerprint` special-cased a finite non-integer JavaScript
number by constructing
`rentcore.billing_source_authority.invalid_semantic_version` and hashing that
replacement. Lifecycle classification could then persist a normal source-lineage
conflict and suppress the required storage-integrity result.

`assertSelectedPeriodVersionStorageIntegrity` now reads `typeof(version)` directly
from SQLite for every selected-period version before PR8 hashing and before replay.
Only actual SQLite `integer` storage represented as a positive JavaScript safe integer
is admitted. `persistedRowFingerprint` repeats the raw storage check before reading
columns or calling SHA-256 and has no synthetic/fallback path. The lifecycle
validator repeats the same check; the post-insert PR8 reconstruction repeats the
preflight. No `Number(value)` conversion occurs before storage validation.

#### Persisted storage matrix

| Raw input | Persisted SQLite class / JS value | Fingerprint construction | Expected and actual code | Event/conflict/transition/accounting |
| --- | --- | --- | --- | --- |
| INTEGER `2` | integer / number `2` | called after validation | valid control | `1/0/0/0` |
| REAL `2.0` in no-affinity corruption fixture | real / number `2` | not called | `CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID` | all zero |
| REAL `2.5` | real / number `2.5` | not called | same integrity code | all zero |
| TEXT `"2"` | text / string `"2"` | not called | same integrity code | all zero |
| TEXT `"02"` | text / string `"02"` | not called | same integrity code | all zero |
| TEXT `"2e0"` | text / string `"2e0"` | not called | same integrity code | all zero |
| BLOB `x'32'` | blob / `Buffer(32)` | not called | same integrity code | all zero |
| NULL in permissive corruption fixture | null / null | not called | same integrity code | all zero |
| INTEGER `0` | integer / number `0` | not called | same integrity code | all zero |
| INTEGER `-1` | integer / number `-1` | not called | same integrity code | all zero |
| INTEGER `9007199254740992` | integer / unsafe number | not called | same integrity code | all zero |
| INTEGER `9007199254740991` | integer / maximum safe number | called after validation | semantic gap remains `SOURCE_LINEAGE_NO_CURRENT_REVISION` | event 0; conflict/transition 1/1; accounting 1/1/1 |
| TEXT input `'02'` under normal INTEGER affinity | integer / number `2` | called after persisted validation | valid control | `1/0/0/0` |
| REAL expression `2.0` under normal INTEGER affinity | integer / number `2` | called after persisted validation | valid control | `1/0/0/0` |
| apparent numeric duplicate `CAST('3' AS INTEGER)` | integer / number `3` | called after validation | `SOURCE_LINEAGE_NO_CURRENT_REVISION` | event 0; conflict/transition 1/1; accounting 1/1/1 |
| TEXT version-gap representation | text / string `"4"` | not called | persisted-row integrity code, before gap classification | all zero |
| malformed root TEXT | text | not called | persisted-row integrity code | all zero |
| malformed middle REAL | real | not called | persisted-row integrity code | all zero |
| malformed latest BLOB | blob | not called | persisted-row integrity code | all zero |
| malformed row after existing event | real | not called | persisted-row integrity code before replay | existing event retained; new DML zero |
| malformed row after insert | real | not called on locked reread | persisted-row integrity code and rollback | all durable DML zero |
| malformed row plus independent PR8 mismatch | real | not called | persisted-row integrity code wins | all zero |

The test does not monkeypatch the production fingerprint helper. It combines direct
SQLite `quote`/`typeof`, JavaScript value/type assertions, exact observable
error/DML/accounting checks and a structural assertion that the preflight precedes
the first verifier fingerprint and that the old synthetic domain is absent.

### Final remediation verification evidence

The working-tree verification below used Node `v22.22.0`/npm `10.9.4`. The clean
engine verification used a separate temporary clone, applied the same working-tree
diff, ran both root and server `npm ci`, and loaded `better-sqlite3` only from that
clone. Its runtime was Node `v20.20.2`, ABI `115`, with SQLite `3.53.1`; no Node 22
`node_modules` was reused.

| Command | Runtime | Result | Duration |
| --- | --- | --- | --- |
| focused `P1 effectiveTermsVersionId semantic ownership RED contract` | clean Node 20.20.2 | 23 passed, 0 failed, 39 unrelated skipped | 18,803.716 ms |
| focused `P1 persisted semantic-version storage fail-before-hash RED contract` | clean Node 20.20.2 | 24 passed, 0 failed, 39 unrelated skipped | 17,416.378 ms |
| `node --test tests/canonical-actual-eligibility-event.test.js` | Node 22.22.0 | 221/221 passed | 167,239.009 ms |
| first `node --test tests/canonical-actual-*.test.js` | Node 22.22.0 | 255/255 passed | 170,699.996 ms |
| second `node --test tests/canonical-actual-*.test.js` | Node 22.22.0 | 255/255 passed | 165,064.097 ms |
| first `npm test` | Node 22.22.0 | 2,598/2,598 passed | 198,855.585 ms |
| second `npm test` | Node 22.22.0 | 2,598/2,598 passed | 192,634.411 ms |
| `node --test tests/*.test.js` | Node 22.22.0 | 2,598/2,598 passed | 184,764.945 ms |
| `npm run build` | Node 22.22.0 | passed | 7.40 s |
| clean `node --test tests/canonical-actual-*.test.js` | Node 20.20.2 / ABI 115 | 255/255 passed | 188,746.461 ms |
| clean `npm test` | Node 20.20.2 / ABI 115 | 2,598/2,598 passed | 197,327.768 ms |
| clean `npm run build` | Node 20.20.2 / ABI 115 | passed | 6.81 s |
| clean `node --test tests/canonical-actual-posting-structural.test.js` | Node 20.20.2 / ABI 115 | 7/7 passed | 267.279 ms |

The five-case post-green effective-terms adversarial self-audit separately passed
6/6 including its parent in 3,938.556 ms. Read-only checks against the local
`server/data/app.sqlite` returned no rows from `PRAGMA foreign_key_check` and `ok`
from `PRAGMA integrity_check`. `git diff --check`, the baseline allow-list,
runtime-consumer, prohibited PR9b, canonical business DML, placeholder and known
secret-pattern scans were also clean. Staged-diff, pushed-head equality and final
worktree cleanliness are release actions recorded after the remediation commit,
not pre-commit evidence embedded in that commit.

### Remediation status and residual limitations

Status: **REMEDIATION COMPLETE — INDEPENDENT RE-AUDIT REQUIRED**.

The approved v1 PR8 candidate schema has no direct `effectiveTermsVersionId` column;
Algorithm A therefore reconstructs the selected identity through the persisted
snapshot plus exact PR8 inputs/check evidence. Widening the PR8 candidate contract is
outside this PR9a remediation. `sourceOwnershipManifestHash` is an accepted opaque
aggregate in the approved schema; the repository does not pretend to decode it.
Instead, it requires its existing acceptance/authority equality and proves the
rental-line/terms edge independently from persisted logical rows and exact PR8
evidence. Fixtures remain isolated synthetic evidence and grant no production
authority. Clean installs also report existing npm audit advisories in the root and
server dependency graphs; this narrow remediation neither introduces nor resolves
those dependency advisories.

Authorization remains:

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
