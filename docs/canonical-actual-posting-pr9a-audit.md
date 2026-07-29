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
→ complete same-scope 16-table PR6 persisted-storage preflight
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

## Draft PR 233 economic-content and full-storage remediation

This section supersedes any earlier statement that a PR6 aggregate hash, a sealed
historical `normalizedInputHash`, relationship IDs, or the period-only storage
preflight were sufficient. The two blockers were reproduced against draft-PR head
`234038ed1376c330e43a3c2ca705faaa8db9e678` before production implementation
changed. The base remains
`da3bd21935abfbd42c95ef8be9eac1eecb56e95c`.

The focused Node 22 RED run reported 4 passing and 28 failing tests. Its exact
`rateAmountMinor` observation was:

```text
persisted authoritative value: 100000 → 100001
persisted PR8 normalizedInputHash: unchanged
snapshot effectiveTermsVersionId: unchanged
close effectiveTermsVersionId: unchanged
actual before remediation: error null, replayed false, events 1, conflicts 0,
                           transitions 0, canonical business DML 0
required: PR8_EVIDENCE_MISMATCH, events 0, conflicts 1, transitions 1,
          COMPLETE attempt/rate/circuit 1/1/1
```

The same RED run proved that REAL storage in selected effective terms, conducted
UPD, selected UPD line, coverage set, source operation and audit sequence/version
columns either created an event or reached a later source denial. None returned the
required fail-before-hash code.

### P1-01 — current economic content binds selected PR8 evidence

Root cause: Algorithm A reconstructed the persisted PR8 graph and used each stored
`normalizedInputHash` as a historical label. It proved IDs, relationship edges,
candidate lineage, aggregate input hashes and outer authorization/activation seals,
but did not independently rebuild the selected effective-terms and rental-line
canonical PR8 inputs from their current authoritative PR6 rows.

The remediation implements a repository-owned reconstruction that does not call the
PR8 input constructor. For the selected candidate it:

1. resolves the current snapshot's `effectiveTermsVersionId`;
2. resolves the exact selected PR8 terms input and rental-line input;
3. rereads both authoritative rows by ID plus company/branch;
4. builds a full canonical stored-row projection, independent source version,
   external assertion hash, source state, deterministic order key, relationship
   object and every PR8 relationship column;
5. computes SHA-256 over
   `{sourceKind,row:<all current stored columns>}`;
6. compares every projected field and both normalized hashes with the persisted PR8
   inputs;
7. retains the existing exact run/candidate/input-lineage/source-adapter evidence
   binding; and
8. repeats the same reconstruction on the locked post-insert reread.

This is deliberately selected-economic-input binding, not a replacement for the
approved PR6 lifecycle graph. Appending a new immutable lifecycle row without
changing the selected row remains classified by the existing lifecycle/correction
state machine. Changing the economic content of the selected terms or rental-line
row with the same ID is classified first as `PR8_EVIDENCE_MISMATCH`. That boundary
preserves the previously closed period, correction, replay and Algorithm C
classifications.

#### PR8 economic content-binding matrix

| Persisted field/group | Authoritative source | Normalized projection and hash binding | Independent mutation | Exact result |
| --- | --- | --- | --- | --- |
| terms `id`, `version`, `rentalLineId` | current `billing_source_effective_terms` row | full row in `{sourceKind,row}` plus exact source ID/version/relationship columns | unchanged ID with version/owner drift | `PR8_EVIDENCE_MISMATCH`; event 0; conflict/transition 1/1 |
| `effectiveFromDate`, `effectiveToDateExclusive` | same terms row | exact half-open boundary strings included in the full-row hash | each boundary changed separately | same denial and `COMPLETE` 1/1/1 accounting |
| `rateAmountMinor`, `rateUnitCode`, `rateQuantityScale` | same terms row | exact safe integers/literal included, no aggregate-hash substitution | `100000 → 100001` plus independent controls | stale PR8 cannot create or replay an event |
| billing cycle code/version | terms row plus existing period semantic predicate | exact terms row hash; period equality remains independently checked | cycle code drift | PR8 mismatch before terms/lifecycle denial |
| minimum term and discount fields | terms row | every stored field included | unchanged-ID `discountValue` drift | PR8 mismatch |
| currency | terms row; existing snapshot/line/slice equality remains | exact stored literal included | `RUB → USD` under hostile persisted fixture | PR8 mismatch |
| calculation basis/policy | terms row; snapshot policy reference remains checked | exact `calculationPolicyRef` and complete row hash | calculation-policy drift | PR8 mismatch |
| VAT semantics | terms row; snapshot/UPD-line equality remains checked | exact `vatPolicyRef`, `policyDecisionRef`, resolution state and unresolved reasons | VAT reference drift | PR8 mismatch |
| rounding semantics | terms row; snapshot/UPD-line equality remains checked | exact `roundingPolicyRef` and full row hash | rounding reference drift | PR8 mismatch |
| source system/ref/version/hash | terms row | independent source-version selection and external-assertion hash plus full row hash | system/version/hash changed together | PR8 mismatch |
| predecessor/successor identity | terms row and existing complete terms chain | `supersedesTermsVersionId` is in relationship/full-row projection; current-chain predicate remains | predecessor identity drift; stale successor append | content drift is PR8 mismatch; immutable successor append retains lifecycle denial |
| contract-related reference | current `billing_source_rental_lines` owner row | full rental-line projection includes `contractId`, rental/client, source identity/event and provenance | `contractId` drift with all selected IDs unchanged | PR8 mismatch |
| snapshot and close identity | current snapshot and close rows | existing exact ID predicate plus selected terms input reconstruction | terms content changed while both rows keep the same terms ID | PR8 mismatch, proving ID equality is insufficient |
| selected run/candidate/input lineage | persisted PR8 run, candidate and inputs | exact candidate, input-lineage and source-adapter evidence refs are retained | candidate corruption plus terms drift | one PR8 mismatch; no event |
| outer authorization/activation | accepted pair/evidence records | outer hashes are verified but cannot replace current row reconstruction | authorization and activation independently resealed around stale terms input | one PR8 mismatch; no event |
| existing event/replay | current terms/rental rows are checked before every event lookup | authoritative hash must still equal the event's selected PR8 input | event first, then content drift, then same invocation | replay is not reached; existing event remains; one new denial pair |
| locked post-insert state | same authoritative projection in refreshed context | full terms/rental projection recomputed after insert | terms drift injected after event insert | `CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED`; event and mutation rolled back |
| valid control | unchanged authoritative rows | independently calculated test hash equals persisted PR8 hash | no mutation | one event, no conflict/transition |
| valid successor control | current successor row plus newly generated PR8 evidence | new PR8 input hash equals the new authoritative full-row hash | rate changes on v2 and PR8 is regenerated | one event, no conflict/transition |

Expected hashes in these tests come from a test-only canonical serializer and direct
`node:crypto` SHA-256. The production reconstruction helper is never used as the
expected oracle. Assertion diagnostics contain the changed field, old/new values,
authoritative normalized projection, persisted PR8 projection, expected/actual hash,
expected/actual outcome, replay state and all event/conflict/transition/canonical-DML
counts.

### P1-02 — complete PR6 persisted-storage preflight

Root cause: the old direct `typeof(version)` preflight covered only
`billing_source_period_versions.version`. Every other PR6 row entered generic
JavaScript deserialization and fingerprint construction first, where SQLite REAL
`1.0` became JavaScript number `1` and lost its persisted storage identity.

The remediation owns an explicit matrix for all 16 PR6 tables and every strict
INTEGER column. At Algorithm A admission it performs direct `typeof(column)` reads
for every row with the exact command company/branch. It accepts nullable NULL only
where registered, requires SQLite `integer`, JavaScript safe-integer representation,
the registered lower bound and `Number.MAX_SAFE_INTEGER` upper bound, and performs
no `Number` coercion. REAL, TEXT, BLOB, forbidden NULL, unknown class, unsafe integer
and range failures return
`CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID`.

The preflight runs after the incomplete-transition guard but before clock/UUID,
PR8 reconstruction, any PR6 fingerprint/current-revision hash, denial
classification and every replay/event lookup. It runs again after event insertion
and before refreshed-context reconstruction. Initial failure and post-insert failure
therefore create no conflict, transition, rate, circuit, event or canonical business
DML; post-insert failure rolls the whole transaction back. All same-company/branch
rows are scanned even when disconnected from the selected closure. A row in a
different company/branch is intentionally out of scope and does not block.

#### Complete 16-table PR6 matrix

All tables use scope keys `companyId, branchId`; all stored `hidden=0` columns remain
part of the existing row fingerprint in ascending `cid` order after this preflight.
`positive` means `[1, 9007199254740991]`, `nonnegative` means
`[0, 9007199254740991]`, `signed` means
`[-9007199254740991, 9007199254740991]`.

| Table | Strict INTEGER storage contract | Relationship edges / selected-current semantics | Same-scope scan and hash ordering |
| --- | --- | --- | --- |
| `billing_source_activation_boundaries` | `schemaVersion` positive | owns governed rental-line/period boundary | every scoped row; validate before fingerprint |
| `billing_source_rental_lines` | `sourceEventVersion`, `schemaVersion` positive | boundary, rental/client/contract/equipment and selected terms owner | every scoped row; validate before fingerprint |
| `billing_source_effective_terms` | `version`, `contractualBillingCycleVersion`, `sourceVersion`, `schemaVersion` positive; `rateAmountMinor`, `rateQuantityScale`, `minimumTermQuantity`, `discountValue` nonnegative | rental-line owner, predecessor/successor, selected terminal terms | every scoped and disconnected row; validate before PR8/hash |
| `billing_source_periods` | `contractualBillingCycleVersion`, `schemaVersion` positive | rental line, activation boundary, period identity | every scoped row; validate before lifecycle/hash |
| `billing_source_period_versions` | `version`, `actorMembershipVersion`, `capabilityCatalogVersion`, `sourceEventVersion`, `schemaVersion` positive | previous/reopen, terms, snapshot, operation; unique latest close | every root/middle/latest/disconnected scoped row |
| `billing_source_snapshots` | `calculationAlgorithmVersion`, `schemaVersion` positive; all five monetary fields nonnegative | period close, terms and evidence/calculation content | every scoped row; validate before PR8/hash |
| `billing_source_snapshot_evidence` | `sourceVersion`, `sourceEventVersion`, `schemaVersion` positive | snapshot evidence set and source identity | every scoped row; validate before PR8/hash |
| `billing_source_upds` | `schemaVersion` positive | document root, client/contract/source identity | every scoped row; validate before fingerprint |
| `billing_source_upd_versions` | `version`, actor/catalog/source-event/schema versions positive; nullable `conductedEvidenceVersion` positive when present | previous/formed/corrected/superseded versions and operation; exactly one current conducted revision | every scoped root/middle/latest/disconnected row |
| `billing_source_upd_lines` | `schemaVersion` positive | UPD line identity root | every scoped row; validate before fingerprint |
| `billing_source_upd_line_versions` | `version`, `sourceVersion`, `schemaVersion` positive; nullable `displayPosition` positive; quantity/scale/net/VAT/gross nonnegative | formed UPD, predecessor line version and selected coverage line | every scoped root/middle/latest/disconnected row |
| `billing_source_coverage_sets` | `version`, `mappingAlgorithmVersion`, `schemaVersion` positive; net/VAT/gross deltas signed | UPD/formed version, operation, current validated mapping | every scoped and disconnected row |
| `billing_source_coverage_supersessions` | actor/catalog/source-event/schema versions positive | original/replacement set correction/supersession edge | every scoped edge, including disconnected/fork evidence |
| `billing_source_coverage_slices` | allocated net/VAT/gross nonnegative; `schemaVersion` positive | set, UPD/version/line, period/close/snapshot and rental/client/contract | every scoped and disconnected row |
| `billing_source_operations` | actor/catalog/result/schema versions positive | operation result aggregate and membership/capability | every scoped operation, selected or disconnected |
| `billing_source_audit_events` | aggregate/actor/catalog/schema versions positive | aggregate, operation, membership/capability and before/after seal | every scoped audit row, selected or disconnected |

The independent storage tests mutate every strict INTEGER column in the matrix to
REAL while keeping the other columns in canonical storage, then prove the exact
operational code and zero DML. Seven semantic/sequence columns additionally run the
full representation matrix: INTEGER, REAL integral/fractional, TEXT `"1"`, `"01"`
and `"1e0"`, BLOB, NULL, zero, negative, maximum safe and above-maximum integer.
Separate cases cover invalid root/middle/latest period versions, disconnected
same-scope terms, foreign-scope terms, invalid storage plus PR8 corruption, an
invalid billing-period lifecycle, an existing event, and mutation after insert.
Normal SQLite INTEGER affinity controls show that a textual/REAL literal converted
by SQLite to stored INTEGER is judged by its persisted class, not its input spelling.

### Error and DML precedence

| Combined condition | Exact result | Event / conflict / transition / accounting |
| --- | --- | --- |
| invalid same-scope storage plus PR8 mismatch | `CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID` | all zero |
| selected terms content drift plus other PR8 candidate corruption | `PR8_EVIDENCE_MISMATCH` | `0 / 1 / 1 / 1-1-1` |
| valid storage and unchanged selected economic content, invalid terms relationship/lifecycle | existing exact source-lineage code | `0 / 1 / 1 / 1-1-1` |
| invalid storage plus existing event | storage code before replay lookup | existing event retained; new DML/accounting zero |
| selected content drift plus existing event | PR8 mismatch before replay lookup | existing event retained; one denial pair |
| invalid storage after insert | exact storage code and transaction rollback | all durable DML/accounting zero |
| selected content drift after insert | `CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED` and rollback | all durable DML/accounting zero |
| invalid disconnected same-scope row | exact storage code | all zero |
| invalid foreign-scope row | does not block; selected valid control remains eligible | `1 / 0 / 0 / 0-0-0` |

Storage integrity is an operational prerequisite and is not converted into ordinary
source denial evidence. Within non-authority reconstruction, selected PR8 evidence
and selected economic content bind before terms/lifecycle classification and before
replay. The approved global authority kind-major winner remains unchanged when an
authority denial is concurrently present; this remediation does not weaken the
previously closed authority contract.

### Adversarial self-audit

The post-green hostile set covers more than the required ten independent cases:
one economic field with unchanged identity; multiple source economic fields;
unchanged PR8 hash after terms content drift; outer resealing around stale PR8;
stale PR8 after a terms successor; valid selected rows plus an invalid disconnected
same-scope row; integral and fractional REAL across all semantic tables; SQLite
affinity conversion to INTEGER; storage drift after an existing event; storage drift
after insert; content drift after insert; replay after authoritative content change;
invalid storage plus a higher-level PR8 integrity issue; and a foreign-scope invalid
row that must not block. Existing PR8 hostile-graph tests additionally cover wrong
row/membership resealing, missing/duplicate children and stale run/input/result
seals. Existing lifecycle, replacement, policy, authority, Algorithm C and
frozen-suffix matrices remain green.

### Final GREEN and engine evidence

The final working-tree verification used Node `v22.22.0` and npm `10.9.4`. The
engine check used an isolated `/tmp` workspace with independent root and server
`npm ci` installations, copied git metadata only so the structural allow-list test
could inspect the same diff, and executed with Node `v20.20.2`, ABI `115`, and npm
`10.8.2`. It did not reuse either root or server Node 22 `node_modules`.

| Command | Runtime | Final result | Duration |
| --- | --- | --- | --- |
| `node --test --test-name-pattern='P1-01 PR8 authoritative economic-content binding RED contract' tests/canonical-actual-eligibility-event.test.js` | Node 22.22.0 | 19/19 passed | 12,968.876 ms |
| `node --test --test-name-pattern='P1-02 full PR6 persisted storage preflight RED contract' tests/canonical-actual-eligibility-event.test.js` | Node 22.22.0 | 31/31 passed | 19,946.964 ms |
| `node --test tests/canonical-actual-eligibility-event.test.js` | Node 22.22.0 | 271/271 passed | 184,279.270 ms |
| first `node --test tests/canonical-actual-*.test.js` | Node 22.22.0 | 305/305 passed | 183,882.630 ms |
| second `node --test tests/canonical-actual-*.test.js` | Node 22.22.0 | 305/305 passed | 183,818.577 ms |
| first `npm test` | Node 22.22.0 | 2,648/2,648 passed | 196,111.313 ms |
| second `npm test` | Node 22.22.0 | 2,648/2,648 passed | 196,634.002 ms |
| `node --test tests/*.test.js` | Node 22.22.0 | 2,648/2,648 passed | 197,370.621 ms |
| `npm run build` | Node 22.22.0 | passed | 6.38 s |
| clean `node --test tests/canonical-actual-*.test.js` | Node 20.20.2 / ABI 115 | 305/305 passed | 216,582.829 ms |
| clean `node --test tests/*.test.js` | Node 20.20.2 / ABI 115 | 2,648/2,648 passed | 228,358.973 ms |
| clean `npm run build` | Node 20.20.2 / ABI 115 | passed | 6.36 s |

Before the production change, the combined focused RED contract reported 4 passing
and 28 failing tests in 22,333 ms. After implementation, the final focused groups
prove all 18 independent PR8 child cases and all 30 independent full-storage child
cases, including explicit storage-plus-lifecycle precedence. The complete
eligibility file and repository-wide suites above are additional regression
evidence, not substitutes for those focused proofs.

Read-only inspection of `server/data/app.sqlite` returned no rows from
`PRAGMA foreign_key_check` and `ok` from `PRAGMA integrity_check`. Final
`git diff --check`, staged-diff, allow-list, prohibited PR9b, placeholder, known
secret-pattern, repository-wide writer/consumer and canonical business DML scans
are release checks recorded against the remediation commit and pushed head.

### Residual limitations

- PR8 v1 candidates still do not expose `effectiveTermsVersionId` directly.
  Algorithm A resolves it through the current persisted snapshot and exact PR8
  terms input. Widening the PR8 schema is outside this remediation.
- The storage matrix is intentionally tied to the approved PR6 v1 schema. Any new
  INTEGER column or row class requires an explicit design and matrix update; it is
  not silently inferred or coerced.
- The isolated fixtures prove repository behavior, not production source quality,
  adapter authority, production cardinality or production readiness.
- This work adds no Algorithm B, canonical business writer, deployment, production
  read, production write or activation path.
- Clean root and server installs report pre-existing npm audit advisories (root:
  one low, four high and one critical; server: three moderate). This narrow
  remediation neither introduces nor resolves dependency advisories.

Status remains **REMEDIATION COMPLETE — INDEPENDENT RE-AUDIT REQUIRED**.

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

## Draft PR 233 all-selected-input and Algorithm C transaction remediation

The independent audit against
`cca10badf197f72f89b3f0e76b4088034e436901` found two further P1 gaps. First,
authoritative PR6 content was reconstructed for selected rental-line and
effective-terms PR8 inputs only; the other selected inputs could retain a stale
`normalizedInputHash`. Second, the separate Algorithm C transaction inherited the
effect of Algorithm A's storage preflight even though Algorithm A had rolled back.
This section records the remediation evidence, not independent closure, merge
approval, deployment approval, or production authority.

### Fixed invariants and RED evidence

Before production changes, the independent all-input contract reported 40 expected
subtest failures: current authoritative rows could drift while an eligibility event
was inserted, and an existing event produced
`SOURCE_REVISION_CHANGED_BEFORE_POSTING` instead of `PR8_EVIDENCE_MISMATCH`.
Expected hashes are produced by a test-only restricted canonical serializer and
direct Node SHA-256, not by the repository projection helper.

The independent Algorithm C race contract reported 17 expected subtest failures.
After Algorithm A rollback, same-scope strict-INTEGER storage changed to REAL was
fingerprinted or admitted into conflict evidence, yielding PR8, lifecycle, due-date,
or frozen-package results instead of
`CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID`; conflict/transition/accounting DML could
therefore occur. The tests observe the rollback-to-BEGIN mutation boundary, raw
SQLite `typeof`, preflight queries, fingerprint queries, exact error and durable DML.

The fixed all-input invariant is:

```text
selected persisted PR8 input identity
  -> closed source-kind/table registry
  -> exact PR6 row by id + company + branch
  -> complete PR8 canonical row projection
  -> independent normalized-input SHA-256
  -> exact persisted PR8 identity/type/table/hash/relationship equality
```

Missing, foreign-scope, duplicate and unknown inputs fail the selected PR8 proof.
Outer run, candidate, acceptance, authorization and activation seals cannot replace
the fresh row comparison. The complete comparison executes during initial Algorithm
A reconstruction before replay/event lookup and insert, during the locked
post-insert reread, and again when Algorithm C reconstructs the denial package.

### Selected PR8 authoritative input matrix

The registry is deliberately closed and exactly equal to the 16 PR6 authority
tables. The canonical projection is the complete PR8 v1 persisted-row projection,
including identity, state, relationships, canonical content and its freshly
recomputed `normalizedInputHash`.

| PR8 source kind / authoritative persisted row | Representative content and relationship drift in the independent matrix | Result |
| --- | --- | --- |
| `billing_source_activation_boundaries` | approval reference; authorized scope/policy fields | stale selected input denied |
| `billing_source_rental_lines` | source-event identity and version | stale selected input denied |
| `billing_source_effective_terms` | policy/economic content and ownership edge | stale selected input denied |
| `billing_source_periods` | cycle evidence and contractual cycle version | stale selected input denied |
| `billing_source_period_versions` | reason/lifecycle payload, null-to-empty, source event, actor/capability/catalog | stale selected input denied |
| `billing_source_snapshots` | calculation JSON and hash, evidence-set hash, all money fields, valid-INTEGER algorithm version | stale selected input denied |
| `billing_source_snapshot_evidence` | authority policy, source ref/hash and evidence/source-event JSON | stale selected input denied |
| `billing_source_upds` | document/status/source content | stale selected input denied |
| `billing_source_upd_versions` | conducted evidence, status/content and source-event fields | stale selected input denied |
| `billing_source_upd_lines` | source identity | stale selected input denied |
| `billing_source_upd_line_versions` | description, quantity/scale, net/VAT/gross, source identity and display position | stale selected input denied |
| `billing_source_coverage_sets` | mapping hash and net/VAT/gross deltas | stale selected input denied |
| `billing_source_coverage_supersessions` | correction/supersession content and relationship edge | stale selected input denied |
| `billing_source_coverage_slices` | due-date evidence, slice hash and allocated money | stale selected input denied |
| `billing_source_operations` | command/result fingerprints and actor/catalog/result version | stale selected input denied |
| `billing_source_audit_events` | metadata JSON, after fingerprint and actor/catalog/aggregate version | stale selected input denied |

Single-row drift, two-row coordinated drift, canonical JSON content change, null versus
empty string, fully resealed authority around stale PR8, an existing event followed by
drift, post-insert drift, combined content drift plus independent PR8 corruption and a
fresh writer-generated PR8 control are covered. Current content drift is the
representable `PR8_EVIDENCE_MISMATCH` denial: events 0, conflicts 1, transitions 1,
transition `COMPLETE`, and attempt/rate/circuit applied `1/1/1`. Drift injected after
event insert returns `CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED` and rolls the
transaction back to durable event/conflict/transition/accounting `0/0/0/0`.

### Algorithm C transaction and precedence contract

Algorithm C does not consume a cached preflight result. It begins only after
Algorithm A rollback, derives the scope from the frozen denial package, and scans all
same-company/branch rows in the same 16-table, 67-strict-INTEGER-column registry used
by Algorithm A. The admission scan occurs before conflict replay and every frozen or
PR6 fingerprint reconstruction; the full scan is repeated at the internal reread
boundary and immediately before conflict/transition insertion.

| Boundary | Fresh preflight and mutation proof | Fingerprint / result | Durable DML and accounting |
| --- | --- | --- | --- |
| Algorithm A `BEGIN IMMEDIATE` | full 16-table same-scope scan | reconstruction only after valid storage | existing Algorithm A contract |
| Algorithm A rollback -> Algorithm C `BEGIN IMMEDIATE` | new transaction; mutation is visible; new full scan | invalid row is not fingerprinted; exact persisted-type error | all new DML/accounting zero |
| Algorithm C admission | snapshot, terms, UPD, UPD line, coverage set/slice, operation, audit and activation-boundary REAL races | fingerprint counter remains zero after mutation | all new DML/accounting zero |
| disconnected same-scope row | included in full scan | blocked before reconstruction | all new DML/accounting zero |
| foreign-scope row | excluded by exact company/branch | original representable denial proceeds | one complete conflict/transition pair and `1/1/1` |
| after admission preflight | test hook mutates before reconstruction; repeated full scan observes it | invalid row is not fingerprinted | all new DML/accounting zero |
| existing identical conflict replay | storage scan precedes replay lookup | invalid storage wins; existing durable pair retained byte-for-byte | no new DML/accounting |
| frozen suffix / lifecycle / due-date denial | storage scan precedes suffix and business reconstruction | invalid storage wins | all new DML/accounting zero |
| final insert boundary | third complete scan before pair insertion | only validated rows can contribute to frozen evidence | atomic pair plus complete accounting, or rollback |

The implemented order inside the current transaction is persisted storage integrity,
frozen-package representability/integrity, PR8 evidence, source lifecycle/current
revision, authority/policy denial, conflict replay, then conflict insertion and
transition/accounting. Registered authority-chain integrity/authorization guards that
must establish the package scope retain their pre-existing fail-closed position.

An independent schema matrix asserts exactly 67 strict INTEGER columns across the 16
tables and verifies both Algorithm A and Algorithm C invoke the shared registry. It
does not derive its expected table/column inventory from production code.

### Post-green adversarial self-audit

The post-green matrix contains more than ten distinct attacks: an unlisted source
table content drift, coordinated snapshot/evidence drift, null-to-empty mutation,
canonical JSON semantic drift, stale PR8 after current content change, fresh authority
seals around stale evidence, storage races between A and C and after C admission,
disconnected same-scope and foreign-scope corrupt rows, existing-conflict replay after
storage drift, frozen suffix plus drift, content plus PR8 corruption, post-insert
rollback and fresh valid PR8 evidence. These cases supplement rather than substitute
for the focused contracts and complete suites.

### Verification evidence for this remediation

The local final tree used Node `v22.22.0` and npm `10.9.4`. The engine check cloned
the branch into `/tmp/pr9a-node20.IIwYfH/repo`, applied the identical working-tree
diff, and ran independent root and server `npm ci` installations. That clone used
Node `v20.20.2`, ABI `115`, npm `10.9.4`, and only its own installed dependencies.

| Exact command | Runtime | Result | Duration |
| --- | --- | --- | --- |
| `node --test --test-name-pattern='P1-01 all selected PR8 inputs are reconstructed from authoritative PR6 content RED contract' tests/canonical-actual-eligibility-event.test.js` | Node 22.22.0 | 47/47 passed | 36,454.588 ms |
| `node --test --test-name-pattern='P1-02 Algorithm C repeats full transaction-local PR6 storage preflight RED contract' tests/canonical-actual-eligibility-event.test.js` | Node 22.22.0 | 19/19 passed | 14,638.697 ms |
| `node --test tests/canonical-actual-eligibility-event.test.js` | Node 22.22.0 | 337/337 passed | 230,164.806 ms |
| first `node --test tests/canonical-actual-*.test.js` | Node 22.22.0 | 371/371 passed | 240,990.969 ms |
| second `node --test tests/canonical-actual-*.test.js` | Node 22.22.0 | 371/371 passed | 236,519.098 ms |
| first `npm test` | Node 22.22.0 | 2,714/2,714 passed | 313,169.313 ms |
| second `npm test` | Node 22.22.0 | 2,714/2,714 passed | 313,282.773 ms |
| `node --test tests/*.test.js` | Node 22.22.0 | 2,714/2,714 passed | 314,557.762 ms |
| `npm run build` | Node 22.22.0 | passed; 3,385 modules | 6.63 s |
| clean `node --test tests/canonical-actual-*.test.js` | Node 20.20.2 / ABI 115 | 371/371 passed | 303,441.200 ms |
| clean `node --test tests/*.test.js` | Node 20.20.2 / ABI 115 | 2,714/2,714 passed | 304,765.271 ms |
| clean `npm run build` | Node 20.20.2 / ABI 115 | passed; 3,385 modules | 6.69 s |

The successful read-only database check used `better-sqlite3` against
`server/data/app.sqlite`: `PRAGMA foreign_key_check` returned no rows and
`PRAGMA integrity_check` returned `ok`. `git diff --check`, the exact Gate B
changed-file allow-list, prohibited PR9b/Algorithm B, placeholder, embedded-secret,
runtime writer/consumer and canonical-business-DML scans were clean. The structural
checks also confirmed that no route, worker, scheduler, environment activation,
network or live-adapter wiring imports PR9a. Staged-diff, final pushed-head equality,
draft state and worktree cleanliness are recorded after the remediation commit in the
handoff because those facts cannot be embedded truthfully before that commit exists.

### Concrete residual risks and authorization

The fixtures are isolated synthetic data and do not establish the quality of any
production PR6/PR8 history. The closed 16-table registry must be extended together
with the PR6 authority schema and PR8 normalized-input contract; the independent
67-column schema test intentionally fails if strict INTEGER schema changes are not
reviewed. SQLite `BEGIN IMMEDIATE` provides the tested single-writer boundary; this
work does not claim equivalence for another database engine. Existing dependency
audit findings are outside this narrow remediation. Algorithm B, canonical business
writers/readers, live adapters, migration execution, deployment, settlement and
cutover remain out of scope.

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
