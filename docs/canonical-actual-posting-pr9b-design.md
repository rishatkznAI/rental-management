# PR9b Design: Isolated Canonical Actual Posting

## 1. Status and verdict

**Document status:** `PR9B DESIGN: READY FOR INDEPENDENT REVIEW`

**Design base:** PR9a squash-merge commit
`a8987eb8c33a7b8974a21a8d25ad018b05317148`.

**Authorized PR9a source head:**
`2f73fa99225142758319ec9c3a80ee5186e176fd`.

The merge commit and source head have the same tree
`187478f1c723568d537ee3f624ef211eb005bd4a`. This document is an additive,
design-only proposal. It does not implement Algorithm B, change the PR9a schema,
authorize PR9b, deploy code, activate a runtime path, read production data, or
write production data.

The proposed design is internally complete enough for independent architecture,
financial-integrity, SQLite, idempotency, and security review. The explicit
reviewer decisions in section 19 must be accepted before a later implementation
authorization can be requested. Nothing in this document sets
`pr9bImplementationAuthorized = TRUE`.

## 2. Repository archaeology and authority hierarchy

### 2.1 Relevant documents

| File | Role in this design | Authority treatment |
|---|---|---|
| `docs/canonical-actual-posting-pre-pr9-design-closure.md` | Approved Gate A contract, including the original Algorithm B, envelopes, transaction order, PR9a/PR9b split, and Gate C/Gate D model | Normative design history; any conflict with merged PR9a is called out below rather than silently inherited |
| `docs/pr9a-implementation-authorization-gate.md` | Exact Gate B scope, file allowlist, migration boundary, and PR9a exclusions | Normative for what PR9a was allowed to implement; its preparation-era heading is historical |
| `docs/canonical-actual-posting-pr9a-audit.md` | Implementation and remediation evidence for schema, Algorithm A, Algorithm C, replay, storage preflight, and isolation | Evidence for the merged source tree; several pre-merge status lines are historical |
| `docs/canonical-receivables-contract.md` | Cross-PR receivables boundary and current PR9a/PR9b status | Current high-level contract, subject to the more exact PR9 documents |
| `docs/canonical-receivables-decisions.md` | Product decisions D-01 through D-36 | Later exact decisions supersede earlier proposed/current-state statements |
| `docs/canonical-receivables-pre-pr9-authorization-gate.md` | Historical blocked PRE-PR9 evidence/authorization analysis | Superseded for architecture and PR9a authorization by the later Gate A/Gate B records; production blockers remain relevant |
| `docs/actual-source-eligibility-pr8-audit.md` | PR8 sealed diagnostic evidence and explicit non-authority boundary | Normative for PR8 foundation semantics; its claim that no PR9 event/schema exists is historical after PR9a |

### 2.2 Merged PR9a implementation map

| Area | Files | Persisted/runtime contract relevant to PR9b |
|---|---|---|
| Schema | `server/lib/canonical-actual-posting-schema.js`, `server/db.js` | Migration `canonical_actual_posting_pr9` v1; seven tables; 38 named indexes; 41 named triggers; initializer only is startup-reachable |
| Domain | `server/lib/canonical-actual-posting-domain.js` | Bounded inert input, restricted canonical JSON, SHA-256 envelopes, identities, authority snapshots, conflict and transition primitives, stable errors |
| Authority repository | `server/lib/canonical-actual-posting-authority-repository.js` | Append/read/replay of authority, write-authorization, and activation chains; kind-major denial precedence; frozen-chain proof |
| Algorithm A | `server/lib/canonical-actual-eligibility-event-repository.js`, `server/lib/canonical-actual-eligibility-event-service.js` | Locked reconstruction of PR5/PR6/PR8/authority state and creation/replay of `ActualReceivableEligibleV1` |
| Algorithm C | `server/lib/canonical-actual-eligibility-event-repository.js` | Required denial evidence, reciprocal conflict/transition pair, durable accounting stages, synchronous recovery |
| Tests | `tests/canonical-actual-posting-*.test.js`, `tests/helpers/canonical-actual-eligibility-concurrency-worker.mjs` | Schema, serialization, authority, Algorithm A/C, concurrency, recovery, isolation, and canonical-triplet constraint evidence |

The merged implementation contains no
`server/lib/canonical-actual-posting-repository.js`, no
`server/lib/canonical-actual-posting-service.js`, no Algorithm B, and no production
canonical business DML. No route, worker, scheduler, startup hook, resolver, flag,
frontend, or runtime consumer can invoke PR9a repositories or services.

### 2.3 Persisted PR9a graph consumed by PR9b

PR9a owns these seven tables:

1. `governed_adapter_authority_records`;
2. `canonical_write_authorization_records`;
3. `canonical_posting_activation_records`;
4. `actual_receivable_eligible_events`;
5. `canonical_receivable_posting_operations`;
6. `canonical_receivable_posting_conflicts`;
7. `canonical_receivable_posting_conflict_transitions`.

The fifth table is deliberately empty in PR9a but already defines the durable
Algorithm B operation seal. The sixth and seventh tables are used by Algorithm A/C
and are shared denial/recovery evidence for a future Algorithm B. PR9b must not
reinterpret or migrate PR9a rows.

### 2.4 Archaeology verification

Read-only repository verification on this design branch established:

- remote `main` is the exact PR9a merge commit and the source branch is the exact
  authorized source head;
- the two commits have byte-identical trees;
- the focused PR9a schema/domain/authority/structural/safety set passes 34 tests;
- a valid isolated canonical receivable -> operation -> audit triplet commits with
  clean foreign keys;
- malformed audit/operation bindings roll the complete triplet back;
- the runtime graph reaches only the PR9 schema initializer;
- Algorithm B and production canonical DML are absent.

These are local repository facts, not staging or production evidence.

## 3. Contradictions, stale statements, and selected interpretation

### 3.1 Historical status drift

The PRE-PR9 document says both PR9a and PR9b are unauthorized. The later Gate B
record and merged tree establish that PR9a implementation became authorized and was
merged, while PR9b remains unauthorized. The PR9a audit also retains pre-merge
phrases such as `INDEPENDENT RE-AUDIT REQUIRED` and `merge = FALSE`. Those phrases
are historical audit-stage facts and do not reverse the externally supplied PR9a
merge/verification record.

Likewise, the PR8 audit correctly states that PR8 itself creates no eligibility
event and authorizes no write; its older statement that no PR9 event/schema exists is
superseded by PR9a without changing PR8 semantics.

### 3.2 Amount-basis drift

Decision D-30 retains the older statement that the posting amount basis is
unresolved. The later approved Gate A design selects gross RUB minor units, and the
merged PR9a event schema enforces:

```text
netAmountMinor + vatAmountMinor = grossAmountMinor
originalAmountMinor = grossAmountMinor > 0
amountBasis = gross
```

PR9b therefore proposes no amount calculation or choice: it projects the locked,
revalidated event's `grossAmountMinor`. Production Accounting/Finance and Tax/VAT
approval remains a Gate C requirement; a design selection is not production policy
approval.

### 3.3 Canonical source-field mapping drift

The original Gate A mapping in section 15 of the PRE-PR9 design says:

```text
sourceDocumentType = upd_coverage_slice_v1
sourceDocumentId = event.updId
sourceLineId = event.rootCoverageLineageId
```

The merged PR9a `trg_pr9_operation_finalize` trigger permits an Algorithm B
operation seal only when the canonical row instead has:

```text
sourceDocumentType = rental_service_upd
sourceDocumentId = event.rootSourceDocumentLineageId
sourceLineId = event.economicLineageKey
```

This is a real design contradiction, not a naming preference. PR9b cannot implement
the older mapping without changing the authorized PR9a schema. This design proposes
the merged relational contract as D-PR9B-02 because it keeps document class aligned
with the activation allowlist, uses the stable root source document, and uses the
policy-independent economic lineage as the stable source line. Independent review
and Owner/Architect acceptance of this explicit delta are mandatory before
implementation authorization.

### 3.4 Physical evidence limitation

The database makes every PR9 operation immutable and uniquely binds it to one event,
canonical receivable, and audit row. The audit reference is deferred and the audit
trigger requires the exact operation and 33-key payload. The successful repository
transaction is therefore database-constrained as a complete triplet.

SQLite does not provide a reverse commit-time foreign key from an arbitrary raw
`canonical_receivables` row to a posting operation. A principal with direct database
DML authority could bypass the repository and insert an orphan PR9-looking canonical
row. PR9b does not grant such a principal: repository-exclusive business DML,
structural call-graph checks, startup integrity checks, and pre/post-operation
anti-join checks are part of the trust boundary. If independent review requires the
database to resist a separate authorized raw-SQL business writer, PR9a schema v1 is
not sufficient and a separately reviewed schema-v2 PR must precede PR9b. This design
does not silently claim protection against arbitrary database-owner tampering.

### 3.5 No implementation placeholder is authoritative

The existing posting-operation table and test fixtures are foundation constraints,
not an implementation of Algorithm B. Fixture fingerprints are deliberately
synthetic in several schema tests. They do not define the future posting hash
contract. The approved envelopes and this document define that contract; the future
repository must recompute them from persisted rows.

## 4. PR9a -> PR9b -> PR9c boundary

### 4.1 PR9a owns

- additive PR9 v1 schema and structural validation;
- immutable authority/write-authorization/activation records;
- bounded canonical serialization and common identity primitives;
- Algorithm A production/replay of `ActualReceivableEligibleV1`;
- Algorithm C denial evidence, transition accounting, and recovery;
- the default-disabled runtime contract and absence of runtime consumers.

PR9b consumes these contracts without changing their rows or lifecycle.

### 4.2 PR9b starts at

- an isolated posting command whose root selector is an already persisted
  `actual_receivable_eligible_events.id`;
- a fresh locked proof of the complete persisted eligibility graph;
- exact derivation of one `canonical_receivable.initial_post.v1` effect;
- one atomic canonical receivable + posting operation + financial audit triplet;
- exact replay, conflict classification, and use of the existing Algorithm C
  denial/recovery contract;
- isolated domain/repository/service code and hostile tests only.

PR9b remains structurally unreachable from production. Its DML may execute only in
isolated tests until later gates authorize a runtime consumer.

### 4.3 PR9c or a later activation stage owns

- any live source, eligibility-producer, or posting-adapter instance;
- route, worker, scheduler, queue, cron, timer, CLI, startup mutation, or consumer;
- environment flags, resolver wiring, runtime registration, batches, retries, and
  operational orchestration;
- production evidence collection, cohort selection, activation-record issuance,
  deployment configuration, Railway actions, or production database access;
- first production invocation and ongoing monitoring.

Settlement remains PR10, shadow reads PR11, and cutover PR12. PR9c cannot absorb
those scopes.

## 5. Algorithm B responsibility and non-responsibilities

### 5.1 Single responsibility

Algorithm B has exactly one responsibility:

> Given one persisted PR9a eligibility graph rooted at `eventId`, atomically prove
> that it is still eligible and currently authorized, then create or exactly replay
> one immutable initial-post canonical receivable effect and its complete durable
> evidence triplet.

It does not calculate eligibility, choose an amount basis, invent a due date,
activate a cohort, settle a balance, or correct an already posted fact.

### 5.2 Explicit non-responsibilities

Algorithm B must not:

- create or update PR6 source facts or PR8 diagnostic facts;
- create a PR9a eligibility event;
- treat the event row alone as sufficient authority;
- read PR7 forecast data or convert forecast into actual;
- accept caller authority, time, IDs, hashes, policy, idempotency key, audit payload,
  canonical row, or transaction;
- create `draft`, update, cancel, correct, compensate, allocate, refund, write off,
  settle, backfill, dual-write, shadow-read, or cut over;
- mutate legacy collections or `app_data`;
- invoke a route, network adapter, plugin, callback, hook, or external service;
- hide a denial, replay, repair, fallback, normalization, or secondary write.

## 6. Authoritative input model

### 6.1 Selector command

The caller supplies a bounded inert command containing only the exact selectors and
assertions represented by `CanonicalPostingCommandFingerprintV1`:

```text
companyId, branchId, eventId, operationType,
assertedEventHash,
assertedWriteAuthorizationRecordId,
requestedActivationRecordId,
requestedSourceAdapterAuthorityRecordId,
requestedPostingAdapterAuthorityRecordId,
requestedPostingAdapterAuthorityVersion,
requestedPostingAdapterAuthorityRecordHash,
assertedDueDatePolicySetHash,
assertedSelectedDueDateGateKind,
assertedSelectedDueDatePolicyId,
assertedSelectedDueDatePolicyVersion,
assertedSelectedDueDatePolicyHash,
assertedDueDateTreatment,
assertedUnknownDueDateTreatmentMappingId,
assertedUnknownDueDateTreatmentMappingVersion,
assertedUnknownDueDateTreatmentMappingHash
```

Unknown fields reject. `operationType` is exactly
`canonical_receivable.initial_post.v1`. The command contains no idempotency key,
clock, correlation ID, row ID, actor, free-form text, policy object, or payload.
Selectors prevent accidental cross-command use but confer no authority.

### 6.2 Sole authoritative persisted input

The authoritative input is one locked persisted eligibility graph rooted at the
exact `(eventId, companyId, branchId)` and composed of:

1. the full `ActualReceivableEligibleV1` row and recomputed `eventHash`;
2. every exact PR8 run/candidate/input/check/reconciliation/diagnostic/operation/
   audit row required by `AcceptedPr8EvidencePredicateV1`;
3. the complete same-scope 16-table PR6 graph, including current lifecycle,
   predecessor/successor relations, roots, revisions, monetary rows, and all selected
   PR8 authoritative inputs;
4. fresh PR5 company/branch/timezone authority;
5. the complete source-adapter, eligibility-producer, and posting-adapter authority
   chains;
6. the exact event-bound write authorization, its latest chain, the exact activation
   record and latest chain, boundary, cohort, accepted evidence, freshness windows,
   amount basis, and due-date policy set;
7. all existing PR9 event, operation, canonical, audit, conflict, and correction-
   graph identities that can collide with the obligation.

All rows are reread after `BEGIN IMMEDIATE`. The event is an immutable index and
seal into this graph, not a cached permission. Missing, ambiguous, stale, drifted,
or corrupt members fail closed. `app_data`, names, labels, mutable rental totals,
legacy documents/payments, and PR7 are never fallback inputs.

### 6.3 Eligibility requirements at posting time

A new post or replay is eligible only when all of the following are true under the
same lock:

- the schema/FK/integrity prerequisites are exact and the scope has no incomplete
  conflict transition;
- the event row is structurally valid and its complete hash reconstructs;
- the PR8 graph remains sealed, accepted, individually zero-delta, complete, and
  inside the exact half-open freshness window;
- the complete PR6 graph has one safe root, one current revision, no broken edge,
  reopen/cancel/correction/supersession conflict, overlap, or selected-input drift;
- PR5, PR8, acceptance, authorization, activation, and event timezone values are
  canonical and byte-identical;
- all three authority chains are complete, latest, effective, and match their exact
  artifact/configuration/policy/ownership bindings;
- write authorization and activation are current, exact-scope, exact-operation,
  exact-evidence, exact-cohort, and exact-policy records;
- the event's gross amount and due-date treatment map without recalculation;
- every colliding identity is absent for a new post or byte-exact for replay.

## 7. Durable output model

### 7.1 Successful primary effect

The only successful primary operation is
`canonical_receivable.initial_post.v1`. It creates exactly one row in each of:

1. `canonical_receivables` — the accounting/business fact in direct `posted` state;
2. `canonical_receivable_posting_operations` — the immutable Algorithm B intent,
   authority, input, mapping, idempotency, fingerprint, and result seal;
3. `financial_audit_events` — the immutable repository-derived audit evidence.

The three rows share one repository-owned `attemptedAt`, correlation identity, and
relational scope. They commit in one SQLite transaction or none commit.

### 7.2 Exact canonical projection

The proposed projection is:

| Canonical column | Authoritative value |
|---|---|
| `id` | repository-generated only after the new path is proven |
| `companyId`, `branchId`, `clientId`, `contractId`, `rentalId` | event |
| `sourceDocumentType` | literal `rental_service_upd` |
| `sourceDocumentId` | event `rootSourceDocumentLineageId` |
| `sourceLineId` | event `economicLineageKey` |
| `sourceSystem` | literal `rentcore.billing_source_authority.v1` |
| `externalId` | event `economicLineageKey` |
| `idempotencyKey` | repository-derived `CanonicalPostingIdempotencyKeyV1` |
| `currency` | literal/event `RUB` |
| `originalAmountMinor` | event `grossAmountMinor` |
| `issuedAt` | current conducted UPD version `createdAt`, reread under lock |
| `postedAt`, `createdAt`, `updatedAt` | one repository `attemptedAt` |
| `contractualDueDate`, `dueDateProvenance`, `companyTimezone` | event after fresh graph proof |
| `workflowStatus` | literal `posted` |
| `description` | literal `Governed UPD coverage slice` |
| cancellation/closure/write-off fields | SQL null |
| `version` | integer `1` |

The physical source-field mapping is D-PR9B-02 and requires the explicit review
decision in section 19.

### 7.3 Operation and audit evidence

The operation row binds the event, lineage/revision, PR6 seal, source and posting
authority composites, event-sealed producer authority, write authorization,
activation, accepted PR8 evidence, due-date policy, canonical receivable, command,
audit, correlation, and result. Its unique keys are:

- `(companyId, operationType, idempotencyKey)`;
- `eventId`;
- `(companyId, branchId, economicLineageKey)`;
- `canonicalReceivableId`;
- `financialAuditEventId`.

The audit row has exact literal type
`canonical_receivable.initial_posted.v1`, exact integration actor, exact aggregate,
exact null previous value, and the exact canonical 33-key payload. Runtime logs are
not part of this proof.

### 7.4 Denial output

A safely reconstructable registered denial produces no primary effect. Algorithm B
rolls back, freezes the denial package, and invokes existing Algorithm C in a
separate transaction. The durable output is exactly one reciprocal immutable
`canonical_receivable_posting_conflicts` +
`canonical_receivable_posting_conflict_transitions` pair. Normal denial return is
permitted only after the transition is fully `COMPLETE` with one attempt, rate, and
circuit result.

Unsafe corruption, malformed input, generation failure, disabled invocation,
unrepresentable denial, database failure, and pre-commit failure may intentionally
produce no denial row. They never produce a primary effect.

## 8. Deterministic state machine

Algorithm B has no durable in-progress primary state. Its logical state is derived
from immutable rows:

| State | Persisted condition | Terminal? | Allowed transition |
|---|---|---|---|
| `ABSENT` | no operation/canonical/audit triplet for the event/lineage/key | no | `POSTED` or `DENIED` |
| `POSTED` | one complete byte-exact triplet and every current admission predicate passes | yes | read-only `EXACT_REPLAY` response only |
| `CONFLICTED` | colliding primary rows or current input/authority state differs and a registered denial is safely reconstructable | yes for this attempt | Algorithm C evidence only; never primary mutation |
| `INTEGRITY_BLOCKED` | corrupt, missing-unrepresentable, cross-scope, or impossible persisted state | yes for this invocation | operator remediation outside Algorithm B; zero primary DML |
| `RECOVERY_BLOCKED` | a same-scope conflict transition is outside `COMPLETE` | non-terminal for the evidence subsystem, terminal for the current B call | rollback B, invoke separate reconciler, return recovery-required; a later external call starts over |

Algorithm C alone owns the durable non-terminal sequence:

```text
PENDING -> ACCOUNTED -> CIRCUIT_APPLIED -> COMPLETE
```

Each arrow is monotonic and idempotent. Algorithm B never resumes a blocked request
after recovery and never turns a denial into success.

## 9. Transaction model

### 9.1 Primary transaction boundary

The repository owns exactly one `BEGIN IMMEDIATE` transaction for one Algorithm B
attempt. The command is deeply materialized and shape-validated before the lock, but
no authority, eligibility, replay, conflict, or business decision is made pre-lock.

Inside the transaction the fixed order is:

1. validate exact inert scope and operation domain;
2. require zero same-scope transition rows outside `COMPLETE`;
3. execute the complete same-scope PR6 persisted-storage preflight;
4. read the repository clock exactly once, validate it, and enforce the monotonic
   floor;
5. generate and validate exactly one internal denial-attempt UUIDv4;
6. prove a UUID hit as corruption or genuine collision before proceeding;
7. reread and verify the complete authoritative graph from section 6;
8. apply the single error/denial precedence from section 12;
9. derive the command fingerprint, idempotency key, canonical projection, audit
   payload, and all candidate fingerprints from locked rows;
10. query every event/lineage/revision/source/external/idempotency/operation/
    canonical/audit identity before DML;
11. return an exact replay with zero writes, construct one frozen denial and roll
    back, or select the proven-new path;
12. only on the new path generate canonical, operation, and audit IDs;
13. insert canonical receivable, then operation, then audit;
14. reread the complete triplet and every referenced authoritative row;
15. recompute canonical, command, audit-payload, audit-event, and result fingerprints
    from persisted values;
16. require exact row counts, no orphan/extra PR9 source rows, byte equality, clean
    FKs, and unchanged locked authority graph;
17. commit once.

No savepoint, nested caller transaction, transaction injection, or split primary
commit is permitted. SQLite automatic retries are zero.

### 9.2 Post-insert reread

Post-insert reread occurs after all three inserts and before commit. It is not a
cached comparison. Every generated column, canonical JSON byte string, FK binding,
trigger-constrained value, parent record, hash, count, and current graph seal is read
again from SQLite. A missing, extra, ignored, coerced, changed, or mismatched value
returns `CANONICAL_POSTING_PERSISTENCE_FAILED` and rolls the whole transaction back.

### 9.3 Commit and rollback

- Any failure before commit rolls back all three primary rows.
- A deferred FK or audit trigger failure rolls back all three rows.
- A commit failure is never reported as success.
- If commit is known to fail, the return is the mapped concurrency or infrastructure
  result and durable primary state is zero.
- If the process cannot know whether commit succeeded, the caller receives no
  success assertion. A later external retry resolves the outcome from durable rows.
- No rollback deletes a previously committed canonical fact.

### 9.4 Multiple transactions

Multiple transactions are forbidden for a successful primary effect. They are
permitted only after Algorithm B has rolled back and selected a denial: Algorithm C
atomically commits its reciprocal pair and advances durable evidence-accounting
stages in separate idempotent transactions. Those transactions cannot write a
canonical receivable, posting operation, financial audit, settlement, PR6, PR8,
legacy, or `app_data` row.

## 10. Idempotency and exact replay

### 10.1 Key and uniqueness boundary

The caller supplies no key. After locked reread the repository derives:

```text
CanonicalPostingIdempotencyKeyV1 = sha256(canonicalJson({
  activationId,
  canonicalWriteAuthorizationId,
  domain: "rentcore.canonical_actual_posting.idempotency_key",
  economicLineageKey,
  economicSourceRevisionKey,
  eventHash,
  operationType: "canonical_receivable.initial_post.v1",
  version: 1
}))
```

The uniqueness boundary is the conjunction of database-enforced event, economic
lineage, canonical source/external identity, operation idempotency, canonical row,
and audit row keys. No single lookup is sufficient to classify replay.

### 10.2 Canonical serialization and hashes

All envelopes use the merged bounded restricted-JCS implementation: exact key sets,
UTF-16 key order, UTF-8 without BOM, no normalization/coercion, safe integers only,
and SHA-256 domain separation. Implementation must add exact
`CanonicalPostingCommandFingerprintV1`, `CanonicalPostingIdempotencyKeyV1`,
`canonicalReceivableFingerprint`, `auditPayloadFingerprint`,
`auditEventFingerprint`, and `resultHash` helpers to the shared domain file and
publish independent byte fixtures.

### 10.3 Replay contract

An exact duplicate is returned only after the current authoritative graph and all
three persisted result rows pass full proof. The response reuses original IDs,
`attemptedAt`, correlation, fingerprints, and result hash and sets
`replayed = true`. It performs zero DML and does not consume a second row ID.

The same derived key or any intersecting event/lineage/source/external identity with
different command, canonical, operation, audit, result, authority, policy, or source
content is `IDEMPOTENCY_CONTENT_CONFLICT` or the earlier more specific registered
denial. The committed triplet remains byte-unchanged; no second financial fact is
created.

Current revocation, expiry, source correction, PR8 staleness, timezone drift, or
policy drift takes precedence over exact replay. This does not rewrite historical
meaning: the original immutable result stays sealed by its original rows and hashes;
the new invocation is a new admission decision and is denied under current state.

### 10.4 Double-posting proof

A second posting of the same obligation is impossible within the authorized
repository boundary because:

1. `BEGIN IMMEDIATE` serializes writers before admission reads;
2. event, economic lineage, source identity, external identity, derived key,
   canonical ID, and audit ID each have database uniqueness protection;
3. one operation must FK-bind the exact event, canonical row, audit row, authority,
   authorization, and activation;
4. triggers require the exact event-to-canonical and operation-to-audit projection;
5. all three primary rows commit atomically;
6. the repository proves every colliding identity before insert and rereads after
   insert;
7. a retry can only return the same triplet or a zero-primary-write conflict.

## 11. Concurrency and crash recovery

### 11.1 Concurrent calls

- Two calls for the same event serialize at `BEGIN IMMEDIATE`. The first may commit
  one triplet; the second observes it and returns exact replay or deterministic
  conflict.
- Competing inputs for one economic obligation collide on the stable lineage and
  source/external keys. Correction/revision precedence decides the single denial;
  they cannot create two receivables.
- Pre-lock reads are selectors only. Every decision read occurs after the lock, so a
  stale caller snapshot has no authority.
- A process-local mutex may be used only as an optimization and is never an
  integrity guarantee.

### 11.2 Lock contention

`SQLITE_BUSY`, `SQLITE_LOCKED`, and equivalent locked errors at begin, statement,
reread, or commit map to `CANONICAL_POSTING_CONCURRENT_CONFLICT`. Raw SQLite errors
do not escape. Automatic repository retry count is zero; external retry must submit
the same inert command and is resolved through persisted state.

### 11.3 Crash matrix

| Crash point | Durable primary state | Recovery behavior |
|---|---|---|
| Before first durable write | zero rows | later call is a fresh attempt |
| After in-transaction intent/result construction but before canonical DML | zero rows | in-memory values are discarded |
| After canonical insert or operation insert but before audit/commit | zero rows after SQLite rollback/recovery | later call starts fresh; no partial evidence is trusted |
| After audit insert but before commit | zero rows if transaction did not commit | deferred FK/audit checks still decide commit atomically |
| During commit with unknown client outcome | either zero or one complete triplet, never a valid partial triplet | later call performs full durable replay proof |
| After commit but before response | one complete immutable triplet | later call returns exact replay with original result |
| After denial pair commit but before Algorithm C completion | no primary rows; one incomplete reciprocal pair | next same-scope new admission is blocked, runs separate recovery, returns recovery-required, and never resumes |

## 12. Failure and error precedence

For the same command bytes and same persisted database snapshot, the following
order is mandatory. Implementations may optimize reads only if tests prove the same
observable winner and write set.

1. **Malformed/unbounded/non-inert command** — stable input/envelope error before a
   transaction; zero writes.
2. **Disabled or unauthorized invocation surface** — `CANONICAL_PR9B_DISABLED` in
   PR9b; zero database reads beyond constructor/schema checks and zero writes.
3. **Schema/FK/registered-structure or inaccessible-database failure** — integrity
   or infrastructure result; no denial evidence is fabricated.
4. **Lock acquisition/contention** — `CANONICAL_POSTING_CONCURRENT_CONFLICT`; no
   automatic retry.
5. **Existing incomplete same-scope conflict transition** —
   `CANONICAL_CONFLICT_TRANSITION_RECOVERY_REQUIRED`; Algorithm B rolls back before
   clock/UUID/event reads, invokes recovery separately, and never resumes.
6. **Persisted PR6 storage-class/range corruption or impossible PR9a graph** — exact
   storage/integrity result before hashes, replay, or denial DML.
7. **Repository clock/UUID failure or proved UUID replay corruption/collision** —
   the existing exact generation, replay-integrity, or collision literal; zero
   primary/conflict DML.
8. **Missing authoritative event root** — `CANONICAL_POSTING_EVENT_NOT_FOUND` when
   the exact event cannot be loaded and therefore no safe posting/denial graph can be
   constructed; never a guessed fallback. Missing referenced PR6/PR8 evidence is
   frozen as a prospective business denial and remains subject to the higher
   authority precedence below.
9. **Authority denial** — source-adapter kind, then eligibility-producer kind, then
   posting-adapter kind; within each kind use the existing suffix order.
10. **Write-authorization then activation denial** — `AUTHORIZATION_DRIFT` before
    `ACTIVATION_DRIFT`.
11. **Business/source denial** — exact existing registry order: root conflict,
    broken successor, no current, multiple current, correction after posting,
    correction after eligibility, revision change, PR6 drift, PR8 mismatch, due-date
    drift, timezone drift.
12. **Persisted result integrity and identity collision** — corrupt/partial triplet
    before exact replay; then `IDEMPOTENCY_CONTENT_CONFLICT`, `AUDIT_SEAL_MISMATCH`,
    or `ECONOMIC_SOURCE_EVENT_MISMATCH` in the registered order.
13. **Exact replay** — only after every current predicate and complete triplet proof.
14. **New primary insert** — constraint/trigger/post-insert mismatch is
    `CANONICAL_POSTING_PERSISTENCE_FAILED` and rolls back all primary rows.
15. **Commit infrastructure failure** — mapped concurrency failure when locked/busy,
    otherwise stable database failure; never success without a proved commit.

When a safely reconstructable registered denial is selected, Algorithm B constructs
only that one observation. Multiple conflict rows for one attempt are forbidden.
Unsafe evidence takes the existing `not allowed` path and writes no conflict row.

## 13. Accounting evidence and immutable audit trail

### 13.1 Minimal evidence graph

An independent auditor must be able to traverse, without runtime logs:

```text
PR6 source graph + PR8 sealed graph + PR5 timezone
        |                         |
        +--> ActualReceivableEligibleV1
                    |
                    +--> CanonicalPostingOperationV1
                         |          |
                         v          v
              canonical_receivables  financial_audit_events
```

The eligibility event binds producer authority. The operation binds the source and
posting authority composites, the event-sealed producer composite, authorization,
activation, policy/evidence hashes, canonical fingerprint, audit fingerprints, and
result hash. The audit row exposes the exact integration actor and immutable event
payload. Foreign keys, unique indexes, triggers, immutable tables, and recomputable
hashes supply durable proof.

### 13.2 Intent, decision, operation, and effect

- **Intent:** the inert posting command and its `commandFingerprint`; it is not
  durable by itself and grants no authority.
- **Decision:** the locked admission result. On success it is sealed in the operation
  result; on safely reconstructable denial it is sealed in the conflict pair.
- **Posting operation:** `canonical_receivable_posting_operations`, the immutable
  technical/accounting evidence that one initial-post projection was selected.
- **Canonical accounting effect:** the direct-`posted` `canonical_receivables` row.
- **Audit evidence:** `financial_audit_events` plus the operation's audit and result
  fingerprints.

The operation is not the receivable, and an intent is not a financial effect.

### 13.3 Mutability

PR9 events, operations, conflicts, conflict results, PR9-source canonical rows, and
financial audits are append-only/immutable. Conflict transition rows may update only
through the schema-enforced monotonic recovery fields. Authority, authorization, and
activation changes append a new version. No posting row is updated, deleted,
normalized, repaired, or replaced.

### 13.4 Proof of performed or not performed

- **Performed:** one valid event-linked operation, one exact canonical row, and one
  exact audit row exist and reproduce `resultHash`; all unique identities agree.
- **Not performed with durable denial:** no matching primary triplet exists and one
  valid complete conflict/transition pair reproduces the frozen attempt.
- **Not performed without durable denial:** no matching primary triplet exists and
  the returned class is one explicitly prohibited from evidence persistence, such as
  malformed input, unsafe corruption, infrastructure failure, or pre-commit loss.

Logs, metrics, exceptions, and caller acknowledgements are supplemental only.

## 14. Schema impact

### 14.1 Decision

**No schema change is proposed for isolated PR9b.** The merged PR9a/PR1/PR2 schema
already supplies the exact tables, composite FKs, unique constraints, immutable
triggers, event-operation seal, audit-side seal, and canonical-source immutability
required by Algorithm B.

| Invariant | Durable mechanism already present |
|---|---|
| One operation per event | unique `canonical_receivable_posting_operations(eventId)` |
| One post per economic lineage | unique `(companyId, branchId, economicLineageKey)` |
| One derived operation key | unique `(companyId, operationType, idempotencyKey)` plus canonical company/key unique index |
| One canonical and audit per operation | unique canonical/audit references plus FKs |
| Exact event/authority/authorization/activation binding | composite FKs and before-insert seal trigger |
| Exact canonical mapping | `trg_pr9_operation_finalize` plus repository full fingerprint reread |
| Complete audit evidence | deferred audit FK and `trg_pr9_financial_audit_scope_validate_after_insert` |
| No mutation/deletion | PR9 source-scoped canonical triggers; operation/event/audit immutable triggers |
| Denial pair atomicity/recovery | reciprocal deferred FKs, unique keys, and monotonic transition trigger |

### 14.2 Why application code alone is not the guarantee

Application classification is necessary for business precedence, but duplicate
prevention and graph binding remain database-enforced. `BEGIN IMMEDIATE` prevents a
stale read/write window, and the unique/FK/trigger set is the final concurrent guard.
The repository must still reread because SQLite constraints cannot express every
canonical hash, PR6/PR8 graph, time-window, and authority-chain invariant.

### 14.3 Schema-change stopping condition

If implementation cannot satisfy the merged physical mapping, operation-first/audit
order, exact composite FKs, or reverse-orphan trust boundary without weakening a
constraint or modifying PR9a schema, implementation must stop. Any schema delta is a
separate additive schema design/authorization PR. It may not be hidden inside PR9b.

## 15. Future implementation allowlist

The exact future implementation allowlist is normative in
`docs/pr9b-implementation-authorization-gate.md`. In summary it permits only the
shared pure domain extension, isolated posting repository/service, focused fixtures
and tests, and implementation audit/status documents. It excludes schema,
`server/db.js`, Algorithm A/C modules, routes, server wiring, frontend, dependencies,
configuration, deployment, and production access.

## 16. Prohibited scope

PR9b must not include:

- schema or migration changes;
- modifications to Algorithm A or Algorithm C;
- routes, workers, schedulers, cron, timers, queues, startup hooks, CLI, UI, or live
  adapters;
- feature flags, environment activation, resolver wiring, or runtime consumers;
- Railway, staging, production, deployment, database, or data operations;
- production reads or writes;
- settlement, payment/allocation, adjustment, cancellation, refund, write-off,
  correction/compensation, backfill, dual write, shadow read, cutover, or legacy
  retirement;
- PR9b merge or self-authorization by the implementer.

## 17. Hostile test matrix

The future matrix is grouped by invariant; each row may contain several focused
mutations but must retain the exact durable/outcome contract.

| Scenario | Attacked invariant and setup | Expected durable state | Returned outcome | Writes that must be absent |
|---|---|---|---|---|
| Tampered PR9a evidence | Mutate/reseal one event, PR8 child, selected PR6 row, authority member, authorization, or activation | Existing rows unchanged; optional one complete conflict pair only when the observation is safely reconstructable | Exact integrity error or registered denial by precedence | No new canonical, operation, audit, settlement, source, PR8, legacy, or `app_data` row |
| Reused key/identity with changed payload | Seed a valid triplet, then change one command assertion, event field, mapping, fingerprint, amount, due date, policy, authority, canonical field, or audit field while preserving an intersecting identity | Original triplet byte-unchanged; at most one complete denial pair | Earlier specific denial or `IDEMPOTENCY_CONTENT_CONFLICT`/`AUDIT_SEAL_MISMATCH` | No second/updated canonical, operation, or audit |
| Exact duplicate and successful replay | Submit the byte-exact command after one committed post | Exactly the original triplet; no new conflict | Original result and timestamps, `replayed=true` | All DML absent |
| Concurrent same event | Two independent processes cross a barrier and post one event | Exactly one triplet | One success; other exact replay or deterministic conflict, never raw busy | No duplicate or partial rows |
| Competing inputs for one obligation | Two current/correction candidates share one economic lineage or source identity | At most one triplet; optional complete conflict pair for loser | Registered correction/revision/idempotency denial | No second canonical effect |
| Stale, missing, or incomplete graph | Remove one required PR8/PR6/event parent, create zero/multiple roots/current revisions, or stale freshness | No primary rows; one conflict pair only for registered safe evidence | `EVENT_NOT_FOUND`, exact integrity error, or registered source/PR8 denial | All primary, settlement, legacy, and source writes absent |
| Conflicting denial transition | Seed `PENDING`, `ACCOUNTED`, or `CIRCUIT_APPLIED` in same scope | Existing pair advances only through reconciler; B adds no attempt | `CANONICAL_CONFLICT_TRANSITION_RECOVERY_REQUIRED` for blocked B call | Clock/UUID/row IDs, primary DML, and new conflict admission absent from B |
| Crash before commit | Inject exit/failure before DML, after each primary insert, after audit, and during deferred constraint evaluation | Zero primary rows when commit did not complete | Persistence/infrastructure failure or process loss | No partial canonical/operation/audit and no denial pair for the rolled-back success path |
| Crash after uncertain commit | Kill after SQLite commit boundary but before response | Either zero rows or one complete triplet | Retry returns new success only from zero state, otherwise exact replay | Never a second triplet |
| Replay after successful post under later drift | Revoke/expire authority, change timezone/policy/source, or append a correction after post | Original triplet unchanged; optional complete conflict pair | Current-state denial, not replay | No update/delete/second post |
| Replay after denial | Retry the exact frozen denial package and separately retry the original B command | Same package replays one pair; new B invocation gets its own attempt decision | C exact replay for same package; deterministic new B denial | No duplicate pair for package and no primary rows |
| Database lock contention | Hold a writer lock at begin and inject busy/locked at DML/reread/commit | Existing durable state unchanged | `CANONICAL_POSTING_CONCURRENT_CONFLICT` | Automatic retries and partial DML absent |
| Constraint or audit failure | Mutate every FK/scope/literal/null/key/payload binding and force audit/operation trigger rejection | Zero new primary rows | `CANONICAL_POSTING_PERSISTENCE_FAILED` or stable mapped integrity error | No surviving canonical, operation, or audit |
| Post-insert reread mismatch | Ignore/coerce/mutate one inserted field, parent, generated column, hash, count, or graph row before reread | Transaction rolls back to zero new primary rows | `CANONICAL_POSTING_PERSISTENCE_FAILED` | No conflict evidence for an uncommitted primary attempt and no partial effect |
| Partial/impossible legacy state | Seed orphan PR9-source canonical, orphan/mismatched operation/audit, duplicate-looking non-PR9 row, dirty FK, or schema drift | No new primary rows; impossible state retained only for diagnosis | Integrity or identity conflict before replay/new DML | No repair, delete, normalization, replacement, settlement, or second effect |
| Unauthorized activation attempt | Call disabled service, forge runtime contract/activation selectors, import from route/server, or use environment defaults | PR9 tables unchanged | `CANONICAL_PR9B_DISABLED` or structural safety-test failure | All business/conflict DML and runtime wiring absent |

Every case must also assert `foreign_key_check`, `integrity_check`, exact row counts,
and byte-preservation of pre-existing evidence where the database remains structurally
readable.

## 18. Production-activation evidence required later

PR9b implementation and its local fixtures cannot authorize production. A later
runtime gate must be able to identify and independently verify at least:

1. the exact approved design head and independent review with no unresolved P0/P1;
2. the exact authorized implementation base/head, changed-file allowlist, commit,
   artifact digest, build provenance, and independent implementation review;
3. reproducible cross-implementation canonical-byte/SHA-256 fixtures for every
   posting envelope and one-field mutation;
4. full hostile, fault-injection, concurrency, crash, replay, schema/FK/integrity,
   and Node-engine results against the exact implementation head;
5. proof that runtime call graph remains unreachable and no route/worker/flag/live
   adapter exists in PR9b;
6. production database identity and migration/structure/FK/integrity evidence
   collected only under a separately authorized read gate;
7. persisted production PR5 identity/timezone, complete PR6 source graph, sealed PR8
   accepted run/evidence graph, and zero unexplained net/VAT/gross deltas;
8. three concrete append-only governed authority chains and exact current source,
   producer, and posting adapter artifacts/configuration/policy hashes;
9. one effective exact-scope `canonical_write_authorization_records` row and one
   matching `canonical_posting_activation_records` row whose evidence, cohort,
   boundary, policies, authorities, controls, approvals, backup, and retention
   references independently reproduce;
10. current backup checksum, successful restore drill, storage/WAL capacity,
    monitoring, kill switch, incident/reconciliation runbooks, retention/legal hold,
    and role-scoped Accounting/Finance, Tax/VAT, Legal/Privacy,
    Security/Operations, adapter-owner, Product, and independent evidence-review
    approvals;
11. a separate single-use Gate D authorization naming exact artifact, environment,
    database, cohort, window, action, and rollback controls.

Runtime logs, local fixtures, CI green status, merge, elapsed time, or this document
cannot replace any persisted or durable approval evidence.

## 19. Residual Owner/Architect decisions

These are the only design decisions requiring explicit independent-review and
Owner/Architect disposition before an implementation authorization request:

| Decision | Proposed disposition | Why explicit approval is required |
|---|---|---|
| D-PR9B-01 Algorithm B responsibility | Approve the single graph-to-initial-post-triplet responsibility and all non-responsibilities in section 5 | It fixes the first canonical business DML boundary |
| D-PR9B-02 physical source mapping | Approve merged-schema mapping `rental_service_upd` / `rootSourceDocumentLineageId` / `economicLineageKey` as superseding the three conflicting PRE-PR9 section-15 values | Existing PR9a trigger makes the alternatives mutually exclusive |
| D-PR9B-03 schema trust boundary | Accept PR9a v1 as sufficient for repository-exclusive Algorithm B DML, with arbitrary raw database-owner DML explicitly outside the guarantee; otherwise require a separate schema-v2 design before PR9b | SQLite has no reverse commit-time FK from an arbitrary raw canonical row to an operation |
| D-PR9B-04 activation split | Approve isolated unreachable PR9b and place every runtime consumer/live adapter/activation action in PR9c or later | Prevents implementation merge from implying runtime authority |

Gate C production policy/evidence approvals are not unresolved Algorithm B mechanics;
they are mandatory later authorization inputs. No implementation may fill them with
fixtures or defaults.

## 20. Authorization result and next gate

This document proposes only:

```text
PR9b design = READY FOR INDEPENDENT REVIEW
architectureDesignApproved = TRUE          # existing Gate A only
pr9aImplementationAuthorized = TRUE        # existing merged PR9a only
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

The next gate is an independent review of this exact document and its authorization
package. The reviewer must reproduce the repository map, verify all four residual
decisions, prove schema sufficiency or require a separate schema design, validate
the single deterministic precedence, transaction/replay/crash proofs, hostile
matrix, exact future allowlist, and absence of any runtime or production authority.
Only after that review, the applicable Gate C prerequisites, and a separate direct
Owner authorization bound to an exact base/head may a PR9b implementation begin.
