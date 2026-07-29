# PR9b Design: Isolated Canonical Actual Posting

## 1. Status and verdict

**Document status:**
`PR9B DESIGN REMEDIATION COMPLETE — INDEPENDENT RE-AUDIT REQUIRED`

**Design base:** PR9a squash-merge commit
`a8987eb8c33a7b8974a21a8d25ad018b05317148`.

**Authorized PR9a source head:**
`2f73fa99225142758319ec9c3a80ee5186e176fd`.

The merge commit and source head have the same tree
`187478f1c723568d537ee3f624ef211eb005bd4a`. This document is an additive,
design-only proposal. It does not implement Algorithm B, change the PR9a schema,
authorize PR9b, deploy code, activate a runtime path, read production data, or
write production data.

Earlier remediations revised the findings against rejected design heads
`a98e44156b6d74fdade23cca7c7276ab81130116`,
`ebe961a5d17fe9a77f351cc5ba729aa471f12ea5`, and
`799e2052ad931228d28d9c6598b97a69f1f74d50`. Independent re-audit rejected head
`bdc6279b2b4ba6adf0d71335d61b0e21dd27ed76` because its global incomplete-replay
prohibition conflicted with the merged PR9a wrapper contract. This cross-entrypoint
revision adopts the Owner/Architect decision that the existing PR9a wrapper retains
stage-preserving exact replay while the new bounded PR9b seam uses C7 for the same
incomplete durable pair. It remains a proposal until an independent reviewer audits
the new exact head. The explicit reviewer decisions in section 19 must be accepted
before a later implementation authorization can be requested. Nothing in this
document sets `pr9bDesignReviewed = TRUE` or `pr9bImplementationAuthorized = TRUE`.

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

This is a real design contradiction, not a naming preference. D-PR9B-02 explicitly
supersedes the three PRE-PR9 section-15 values with the merged relational contract.
That contract keeps the document class aligned with the activation allowlist, uses
the stable root source document, and uses the policy-independent economic lineage as
the stable source line. Correction and revision fixtures must prove that changing a
current UPD version, coverage set/slice, amount, due date, policy, or authority does
not create a second business identity while changing a lineage-defining member does
not collapse a distinct obligation. No PR9a schema change is required for this
decision.

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
- Algorithm C denial evidence, transition accounting, and recovery, including the
  future narrow repository-internal posting-denial orchestration seam in section
  7.4;
- the default-disabled runtime contract and absence of runtime consumers.

PR9b consumes these contracts without changing their rows or lifecycle.

### 4.2 PR9b starts at

- an isolated posting command whose root selector is an already persisted
  `actual_receivable_eligible_events.id`;
- read-only resolution of any existing durable posting/conflict result before a new
  admission decision;
- a fresh locked proof of the complete persisted eligibility graph only when no
  prior result exists;
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

Algorithm B has exactly one business responsibility:

> Resolve, admit, and produce the one authoritative outcome for an initial-post
> request rooted at one persisted PR9a `eventId`, without ever creating more than
> one canonical accounting effect.

That responsibility has three mandatory workflow phases, not three independent
business responsibilities:

1. resolve any durable historical primary or conflict result;
2. only for `NO_RESULT`, decide current admission and create one primary triplet;
3. after primary rollback, delegate a safely reconstructable denial to the sole
   Algorithm C owner through the section-7.4 seam.

It does not calculate eligibility, choose an amount basis, invent a due date,
activate a cohort, settle a balance, or correct an already posted fact.

### 5.2 Explicit non-responsibilities

Algorithm B must not:

- create or update PR6 source facts or PR8 diagnostic facts;
- create a PR9a eligibility event;
- treat the event row alone as sufficient authority;
- read PR7 forecast data or convert forecast into actual;
- treat caller selector/assertion IDs, hashes, or policy references as authority;
- accept a caller clock, generated output row ID, correlation, UUID, idempotency
  key, canonical payload, audit payload, branded denial package, or transaction;
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
`canonical_receivable.initial_post.v1`. These bounded values are selectors and
assertions only, even when they are persisted IDs, hashes, or policy references.
The repository rereads every corresponding authoritative value under its lock; an
assertion mismatch is a deterministic read-only failure and never grants authority.
The command contains no generated output row ID, idempotency key, clock, timestamp,
UUID, correlation, actor, free-form text, policy object, canonical payload, audit
payload, or denial evidence package.

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

A new post is eligible only when all of the following are true under the same lock.
These predicates do not precede or suppress durable historical-result resolution:

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
- every intersecting primary/conflict identity has been proved absent by Phase 1.

## 7. Durable output model

### 7.1 Successful primary effect

The only successful primary operation is
`canonical_receivable.initial_post.v1`. It creates exactly one row in each of:

1. `canonical_receivables` — the accounting/business fact in direct `posted` state;
2. `canonical_receivable_posting_operations` — the immutable Algorithm B intent,
   authority, input, mapping, idempotency, fingerprint, and result seal;
3. `financial_audit_events` — the immutable repository-derived audit evidence.

The three rows share one repository-owned `attemptedAt` and relational scope. The
canonical row has no `correlationId`; it is bound to the graph by the operation FK,
canonical fingerprint, source identity, and scope. The operation and financial audit
rows both copy the persisted eligibility event's `correlationId`. Algorithm B never
creates or accepts another correlation identity. All three rows commit in one SQLite
transaction or none commit.

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
not part of this proof. The event row is the sole authoritative correlation source:

- `operation.correlationId = event.correlationId`;
- `financialAuditEvent.correlationId = event.correlationId`;
- operation and audit correlation are therefore byte-identical;
- the audit payload and `resultHash` use that persisted event correlation;
- post-insert reread proves both equalities against the event;
- the canonical row carries no correlation column and is linked only relationally.

### 7.4 Denial handoff and sole transaction owner

A safely reconstructable registered denial produces no primary effect. Algorithm B
first rolls back its primary-attempt transaction and only then invokes one future
narrow repository-internal Algorithm C orchestration seam in
`canonical-actual-eligibility-event-repository.js`. The handoff begins a new attempt
boundary:

```text
B primary attempt transaction: ROLLED BACK
C denial transaction: independent and owned only by the C seam
```

Algorithm B passes only the bounded event selector, bounded assertions, the closed
denial-cause enum selected by B, and, when required, one immutable B-attempt
reference that is itself only an assertion. B does not pass an open database
connection, transaction object or context, conflict/transition IDs, timestamps,
hashes, observed/expected persisted projections, audit payload, branded package, or
free-form data. B does not create a package, reconstruct C payload, perform C DML,
call the current `persistDenialEvidence` from an external transaction, or retry C.

Persisted state is allowed to change between the two transactions. The B denial
object is non-durable and is never authority for C. The seam is the sole owner of
this complete initial denial-persistence transaction:

```text
BEGIN IMMEDIATE
-> exact storage/schema/FK/registered-structure preflight
-> section-7.6 durable-state classification
-> fresh authoritative graph reread
-> current winning-denial reconstruction
-> private package construction and WeakSet branding
-> Algorithm C create-or-replay decision through the private primitive
-> reciprocal-pair post-write reread
-> COMMIT
```

Every failure before commit rolls this transaction back. There is exactly one lock
and no unlock gap from durable-state classification and fresh authoritative reread
through private package construction and reciprocal-pair persistence. Algorithm B
cannot open, commit, roll back, inject, or nest this transaction.

The initial transaction either performs no C DML or atomically inserts exactly one
reciprocal conflict row plus one `PENDING` transition row. A successful initial pair
commit establishes the internal durable result
`DENIAL_ACCEPTED_FOR_RECOVERY` at durable stage `PENDING`; it does **not** assert
that the denial is already `COMPLETE`. After that pair commits, the existing
Algorithm C reconciler alone may advance its established monotonic
`PENDING -> ACCOUNTED -> CIRCUIT_APPLIED -> COMPLETE` sequence in its existing
separate C-owned transactions. Those post-pair recovery transactions do not create
an unlock gap in denial admission: once the reciprocal pair commits, every future B
classification must observe completed or incomplete conflict evidence and cannot
admit a primary result.

The existing transaction-owning Algorithm C wrapper synchronously invokes that
reconciler after the initial commit. A new-evidence winner service call may therefore
return the final `DENIAL_PERSISTED` result, but only after a fresh durable reread
validates stage `COMPLETE`. The initial pair is not made invisible while the wrapper
waits:
between its commit and any later recovery transaction another process may obtain
`BEGIN IMMEDIATE` and observe `PENDING`, `ACCOUNTED`, or `CIRCUIT_APPLIED`. Failure,
process loss, or interruption in that window must not return a false completed
result; the durable pair remains recoverable and every follower seam call is C7.

That new-evidence completion rule does not change the existing wrapper's separate
exact branded replay mode. Under merged PR9a ordering, the wrapper proves an exact
package/pair match before the incomplete-transition guard. For an exact valid pair
at `PENDING`, `ACCOUNTED`, `CIRCUIT_APPLIED`, or `COMPLETE`, it may return its stable
existing API result `{ conflict, replayed: true }`; this design uses the semantic
label `EXACT_STAGE_PRESERVING_REPLAY` without renaming that runtime result. The
wrapper performs zero DML, returns its existing conflict envelope with original IDs,
timestamps, and hashes, preserves the current durable stage proved by the pair read,
does not mutate that stage, and does not invoke recovery. This stage evidence does
not add or rename a public wrapper field. Existing PR9a tests and the PRE-PR9
contract remain compatibility authority for this path.

The two entrypoints answer different bounded questions. The existing wrapper asks
whether a private branded denial package exactly matches a durable reciprocal pair.
The new PR9b B-to-C seam asks whether the current Algorithm B request can return a
final denial result or whether the pair still requires existing Algorithm C
recovery. Consequently, the wrapper may stage-preserving exact-replay an incomplete
pair while the seam returns `CONFLICT_RECOVERY_REQUIRED`; both paths are read-only,
neither starts duplicate recovery, and the durable pair is identical before and
after either response.

The Algorithm B service forms its response exclusively from the immutable seam
result. It does not return or reinterpret the pre-rollback B denial object. The seam
may therefore return a primary result that won before its lock, report that denial
disappeared, persist a newly winning denial cause, replay existing conflict evidence,
or require separate C recovery.

### 7.5 Single private in-transaction Algorithm C primitive

The merged `persistDenialEvidence` wrapper already owns `BEGIN IMMEDIATE`. Future
implementation is authorized to perform exactly one minimal internal refactor so
the new seam cannot create a nested transaction:

1. preserve the current externally callable transaction-owning wrapper and its
   observable validation, create/replay, rollback, completion, and recovery behavior;
2. extract from it one private in-transaction Algorithm C primitive containing the
   existing package verification, exact replay, reciprocal-pair DML, and post-write
   reread semantics;
3. keep the wrapper responsible for its own `BEGIN IMMEDIATE`, invocation of the
   private primitive, and commit/rollback;
4. make the new seam responsible for its separate `BEGIN IMMEDIATE`, fresh
   classification/reconstruction/private branding, invocation of the same primitive
   while that seam-owned transaction is open, and commit/rollback;
5. keep all existing monotonic transition reconciliation in the current Algorithm C
   owner after reciprocal-pair commit;
6. require the PR9b service to call only the new narrow seam, never the generic
   existing wrapper as its durable-state classifier or public result mapper.

The primitive neither begins nor ends a transaction, is not exported, and accepts
only a package branded inside this repository. It is the one implementation of
Algorithm C reciprocal-pair create/replay DML used by both transaction-owning entry
points. The refactor may not change the Algorithm C state machine, precedence,
hashes, IDs, persisted projections, transition recovery, schema, or formats.
Shared private pair validation may produce an internal exact-pair disposition, but
it must not impose one public outcome on both entrypoints. The existing wrapper maps
an exact incomplete pair to its unchanged stage-preserving replay result; the PR9b
seam maps the same validated pair to `CONFLICT_RECOVERY_REQUIRED` before any final
Algorithm B denial response. A shared public classifier that moves the existing
wrapper's incomplete guard ahead of exact replay is prohibited.

Normative constraints are: **no nested `BEGIN`; no transaction supplied by Algorithm
B; no unlock between authoritative reread and reciprocal-pair persistence; one
private in-transaction Algorithm C primitive; no generic transaction or package
factory export.**

### 7.6 PR9b C-seam precedence and exact concurrent outcomes

After its own `BEGIN IMMEDIATE`, the seam classifies one locked snapshot in this
exact order. Every later predicate includes the negation of every earlier one:

1. database, schema, FK, registered-structure, or storage integrity failure;
2. any partial/corrupt primary graph, or any impossible primary/conflict combination;
3. one incomplete Algorithm C transition with no primary evidence;
4. one exact complete primary triplet with no conflict evidence;
5. one completed conflict pair: exact replay first, otherwise mismatch;
6. any other intersecting identity collision;
7. fresh authoritative graph reconstruction, including closed-cause representability;
8. denial disappeared;
9. denial changed to another closed, safely reconstructable winning cause;
10. the asserted denial remains the current winning cause;
11. Algorithm C reciprocal-pair create/replay through the private primitive.

A complete primary plus any completed or incomplete conflict pair, a partial primary
plus any conflict, multiple primary/conflict candidates, and malformed reciprocal
bindings are impossible combinations under item 2. They return
`PRIMARY_RESULT_INTEGRITY_BLOCKED` with zero DML; SQL query order may not choose a
primary or conflict replay from such a graph.

The C1-C8 labels and outcomes below belong to the new PR9b seam contract. They do
not rename or replace the existing PR9a wrapper result mapping. The exact seam
outcomes are:

| Case | Locked predicate after the C seam obtains its lock | Outcome | Exact DML owned by this invocation | Final durable state |
|---|---|---|---|---|
| C1 | No conflicting evidence; one byte-exact complete primary triplet appeared after B rollback | `PRIMARY_RESULT_WON` with original canonical/operation/audit IDs, timestamps, correlation, fingerprints and result seal | zero | exact primary triplet unchanged; no denial evidence |
| C2 | Any orphan, partial, mismatched, multiple or corrupt primary graph, including primary plus completed/incomplete conflict | `PRIMARY_RESULT_INTEGRITY_BLOCKED` | zero | corrupt/impossible graph unchanged for separate integrity remediation |
| C3 | No primary/conflict/collision evidence and fresh authoritative reconstruction produces no denial | `DENIAL_NO_LONGER_CURRENT` | zero | no primary or denial result for the old attempt; a new external B attempt is permitted |
| C4 | No prior result exists and fresh deterministic precedence selects a different closed, safely reconstructable denial cause | `DENIAL_RECLASSIFIED`, containing both asserted and authoritative causes plus the immutable completed conflict result for the authoritative cause | exactly two reciprocal-pair `INSERT`s, then exactly four existing monotonic transition `UPDATE`s; no primary DML | one `COMPLETE` pair for the fresh cause; the asserted old cause is never persisted |
| C5 | Exactly one valid `COMPLETE` pair matches the asserted attempt/cause and full durable conflict identity | `EXACT_CONFLICT_REPLAY` with original conflict/transition IDs, timestamps and hashes | zero | original complete pair byte-unchanged |
| C6 | Exactly one valid `COMPLETE` pair intersects the request but does not match its asserted/durable conflict identity | `CONFLICT_RESULT_MISMATCH` | zero | existing complete pair unchanged; no second pair |
| C7 | With no primary evidence, exactly one reciprocal pair is `PENDING`, `ACCOUNTED`, or `CIRCUIT_APPLIED` | `CONFLICT_RECOVERY_REQUIRED` | zero in the seam; it does not create a pair or synchronously reconcile | incomplete pair unchanged; only the existing separate Algorithm C reconciliation entry point may advance it, and B never resumes |
| C8 | No primary/conflict/collision evidence and fresh reconstruction proves the asserted cause remains current | Initial persistence result `DENIAL_ACCEPTED_FOR_RECOVERY` at `PENDING`; final synchronous new-evidence result `DENIAL_PERSISTED` only after durable `COMPLETE` proof | initial seam transaction: exactly two reciprocal-pair `INSERT`s; existing reconciler: exactly four monotonic transition `UPDATE`s in separate transactions; no primary DML | one authoritative pair, initially `PENDING` and ultimately immutable at `COMPLETE` |

The two inserts in C4/C8 commit atomically under the seam-owned transaction. The four
bounded updates are the unchanged Algorithm C attempt, rate, circuit, and final
`COMPLETE` reconciliation steps, each in its existing C-owned transaction. Failure
before the reciprocal-pair commit leaves zero rows. Failure or process loss after
that commit leaves one detectable incomplete pair; it cannot become `NO_RESULT` and
is governed by C7 for every later PR9b seam call. The two `INSERT`s and four
`UPDATE`s are not one SQLite transaction. Loss of the response after the initial
pair commit but before `COMPLETE` is C7 on a PR9b seam retry; loss after the final
`COMPLETE` commit is C5 on a PR9b seam retry. An exact branded retry through the
existing wrapper retains its separate stage-preserving replay contract.

The exact follower contract for one fully reread locked snapshot is:

| Locked pair state | Classification | Outcome | Follower DML | Retry behavior |
|---|---|---|---:|---|
| `PENDING` | C7 | `CONFLICT_RECOVERY_REQUIRED`, including current durable stage `PENDING` | 0 | Retry externally after existing Algorithm C recovery |
| `ACCOUNTED` | C7 | `CONFLICT_RECOVERY_REQUIRED`, including current durable stage `ACCOUNTED` | 0 | Retry externally after existing Algorithm C recovery |
| `CIRCUIT_APPLIED` | C7 | `CONFLICT_RECOVERY_REQUIRED`, including current durable stage `CIRCUIT_APPLIED` | 0 | Retry externally after existing Algorithm C recovery |
| exact valid `COMPLETE` pair | C5 | `EXACT_CONFLICT_REPLAY` with original IDs, timestamps, hashes, and complete transition evidence | 0 | terminal replay |
| corrupt or internally inconsistent stage | C2 / integrity state | `PRIMARY_RESULT_INTEGRITY_BLOCKED` or the earlier exact registered integrity block | 0 | manual integrity remediation only |

For one PR9b seam entrypoint contract, one locked snapshot always has exactly one
outcome. The seam must not expose a committed incomplete Algorithm C pair as a final
exact conflict replay. PR9b seam `EXACT_CONFLICT_REPLAY` is legal only for a fully
reread and validated `COMPLETE` pair. C7 is a PR9b seam classification, not a global
prohibition on every Algorithm C replay entrypoint. It performs zero seam DML,
creates no second pair, does not run admission, and does not synchronously reconcile;
the existing pair remains authoritative and recovery remains owned by the existing
Algorithm C reconciler. A later PR9b seam call made after `COMPLETE` may follow C5.

The cross-entrypoint contract is mandatory. In every cell DML is zero, stage mutation
is none, recovery invocation is none, and the returned evidence is derived only from
the validated durable pair. In the existing-wrapper column, “stage” is the current
stage observed through the existing verified pair/read contract alongside the stable
`{ conflict, replayed: true }` envelope; it is not a new response field:

| Durable pair | Existing PR9a wrapper | New PR9b seam |
|---|---|---|
| exact `PENDING` | Existing `{ conflict, replayed: true }` / semantic `EXACT_STAGE_PRESERVING_REPLAY`; original IDs, timestamps, hashes, stage `PENDING`; DML 0; no mutation; no recovery | C7 `CONFLICT_RECOVERY_REQUIRED`; original pair identity/hashes and stage `PENDING`; DML 0; no mutation; no recovery |
| exact `ACCOUNTED` | Existing `{ conflict, replayed: true }` / semantic `EXACT_STAGE_PRESERVING_REPLAY`; original IDs, timestamps, hashes, stage `ACCOUNTED`; DML 0; no mutation; no recovery | C7 `CONFLICT_RECOVERY_REQUIRED`; original pair identity/hashes and stage `ACCOUNTED`; DML 0; no mutation; no recovery |
| exact `CIRCUIT_APPLIED` | Existing `{ conflict, replayed: true }` / semantic `EXACT_STAGE_PRESERVING_REPLAY`; original IDs, timestamps, hashes, stage `CIRCUIT_APPLIED`; DML 0; no mutation; no recovery | C7 `CONFLICT_RECOVERY_REQUIRED`; original pair identity/hashes and stage `CIRCUIT_APPLIED`; DML 0; no mutation; no recovery |
| exact validated `COMPLETE` | Existing `{ conflict, replayed: true }`; original IDs, timestamps, hashes and complete stage evidence; DML 0; no mutation; no recovery | C5 `EXACT_CONFLICT_REPLAY`; original IDs, timestamps, hashes and complete transition evidence; DML 0; no mutation; no recovery |
| corrupt or mismatched pair | Existing registered replay-integrity/collision result with available diagnostic identity; DML 0; no mutation; no recovery | C2/C6 or earlier exact registered integrity/mismatch result with available diagnostic identity; DML 0; no mutation; no recovery |

An old or forged asserted cause is never written merely because B supplied it. A
changed safe cause follows only C4; an absent cause follows only C3; a malformed or
unrepresentable fresh graph returns the earlier stable integrity result with zero
DML. The seam never resumes B admission under its C transaction.

## 8. Deterministic state machine

Algorithm B has no durable in-progress primary state. Phase 1 classifies persisted
state using the following ordered, mutually exclusive predicates. Each predicate
includes the negation of every earlier predicate; `NO_RESULT` is therefore proved
absence, not a fallback for an unrecognized graph.

| Precedence | Classification | Exact persisted predicate | Terminal? | Outcome and permitted write set |
|---:|---|---|---|---|
| 1 | `PRIMARY_PARTIAL_OR_CORRUPT` | Any primary identity resolves to an orphan canonical, operation, or audit; a structurally invalid/mismatched triplet; multiple primary candidates; or otherwise incompatible primary and conflict evidence | terminal for B invocation | integrity-blocked; zero primary/conflict DML and no repair |
| 2 | `CONFLICT_RECOVERY_INCOMPLETE` | No primary evidence from state 1; exactly one same-scope reciprocal conflict pair exists and its transition is `PENDING`, `ACCOUNTED`, or `CIRCUIT_APPLIED` | non-terminal for Algorithm C, terminal for current B invocation | return `CONFLICT_RECOVERY_REQUIRED` with the current stage; zero B/seam DML; only the existing Algorithm C reconciler may later advance the pair in separate transactions |
| 3 | `CONFLICT_COMPLETED` | No state 1 or 2; exactly one structurally valid reciprocal pair exists in `COMPLETE`, with no colliding primary or second conflict result | terminal historical denial | read-only return of the immutable completed denial; zero DML regardless of restored current authority |
| 4 | `PRIMARY_POSTED_EXACT` | No earlier state; exactly one complete immutable event/canonical/operation/audit graph matches every historical command, identity, fingerprint, payload, FK, seal, and result byte | terminal historical posting | return `EXACT_COMMITTED_RESULT`; zero DML; current admission is a separate read-only qualifier |
| 5 | `IDENTITY_CONFLICT` | No earlier state; a structurally valid complete primary result or other row intersects event/lineage/source/external/idempotency identity but is not the requested exact historical result | terminal for this B attempt | rollback; delegate one safely reconstructable denial through the Algorithm C seam, or return integrity-blocked with zero writes if it cannot be reconstructed; never primary DML |
| 6 | `NO_RESULT` | Proven zero matching/intersecting canonical, operation, audit, partial primary graph, identity collision, completed conflict pair, or incomplete conflict transition | non-terminal | proceed to current admission; then one primary triplet or one delegated C denial |

`DENIED` is not a persisted state name. A denial is either the historical
`CONFLICT_COMPLETED` result or the outcome of current admission that is delegated to
Algorithm C. Current authority/business status is never folded into the durable
state predicate.

### 8.1 Combined-state precedence

| Hostile combined state | Mandatory classification | Reason and write set |
|---|---|---|
| Complete exact primary + current authority/policy/business denial | `PRIMARY_POSTED_EXACT` | historical result is returned with `currentAdmissionStatus = CURRENTLY_DENIED`; zero DML |
| Partial primary + any conflict pair | `PRIMARY_PARTIAL_OR_CORRUPT` | primary integrity failure wins; no repair or new evidence |
| Complete conflict + current authority restored | `CONFLICT_COMPLETED` | completed historical denial cannot become a new post; zero DML |
| Valid primary for a competing event/identity | `IDENTITY_CONFLICT` | never replay as the requested event and never create a second effect; C-only denial if safely reconstructable |
| Incomplete Algorithm C transition without partial primary | `CONFLICT_RECOVERY_INCOMPLETE` | C reconciler alone may advance the existing transition; B never resumes the same call |
| Orphan PR9-source canonical | `PRIMARY_PARTIAL_OR_CORRUPT` | zero DML; arbitrary repair is outside B |
| Orphan operation, audit, or mismatched operation/audit binding | `PRIMARY_PARTIAL_OR_CORRUPT` | zero DML; result cannot be replayed or treated as absence |

Algorithm C alone owns the durable non-terminal sequence:

```text
PENDING -> ACCOUNTED -> CIRCUIT_APPLIED -> COMPLETE
```

Each arrow is monotonic and idempotent. Algorithm B never resumes a blocked request
after recovery and never turns a denial into success.

## 9. Transaction model

### 9.1 Primary transaction boundary

The repository owns exactly one `BEGIN IMMEDIATE` transaction for primary result
resolution and possible creation. The command is deeply materialized and
shape-validated before the lock, but no authority, eligibility, replay, conflict, or
business decision is made pre-lock. `resolveExistingResult` and
`admitAndCreateNewResult` are mandatory internal phases, not separately callable
public operations.

After `BEGIN IMMEDIATE`, exact schema/FK/registered-structure and same-scope PR6
storage preflight run first. The repository captures and validates `attemptedAt`
from its injected clock exactly once. Every expiry, freshness, and current-status
decision in the invocation uses this one value.

**Phase 1 — durable result resolution (`resolveExistingResult`)**

1. query the event identity and every available event/lineage/revision/source/
   external/idempotency/operation/canonical/audit/conflict identity;
2. classify the immutable rows by the exact section-8 precedence;
3. perform no UUID generation and no DML;
4. return completed conflict/recovery/integrity outcomes as prescribed;
5. for `PRIMARY_POSTED_EXACT`, prove the complete historical triplet first and
   return `historicalPostingOutcome = EXACT_COMMITTED_RESULT` with original IDs,
   timestamps, correlation, fingerprints, and result hash;
6. after that historical proof, evaluate current graph status read-only and attach
   exactly one non-persisted qualifier: `CURRENTLY_ADMITTED`, `CURRENTLY_DENIED`, or
   `CURRENT_STATUS_INTEGRITY_BLOCKED`; qualifier failure never hides or changes the
   historical result;
7. only `NO_RESULT` may continue to Phase 2.

**Phase 2 — new admission decision (`admitAndCreateNewResult`)**

1. reread and verify the complete authoritative graph from section 6;
2. apply current authority, authorization, activation, source/business,
   policy/timezone, and eligibility precedence using captured `attemptedAt`;
3. derive the command fingerprint, idempotency key, canonical projection, audit
   payload, and candidate fingerprints solely from locked persisted values;
4. requery all collision identities and require the classification still to be
   `NO_RESULT`;
5. on safely reconstructable denial, retain only the bounded immutable cause,
   rollback B, and proceed to the Algorithm C seam in Phase 3;
6. on admission, select the proven-new primary path.

**Phase 3 — primary insertion or denial orchestration**

For an admitted primary path, UUIDs are generated from injected generators only
after the read-only classification and admission are complete and immediately before
their inserts. Generator failure has the fixed section-12 precedence; UUID collision
cannot change the already established business classification and produces zero
DML. The repository then inserts canonical receivable, operation, and audit in that
order; rereads the complete triplet and authoritative parents; recomputes every
fingerprint/result; requires exact counts, byte equality, clean FKs, no orphan/extra
rows, and an unchanged locked graph; and commits once.

For denial, the primary transaction is rolled back before invoking the section-7.4
Algorithm C seam. That seam is the only owner of the new C transaction and performs
the exact section-7.6 precedence under its own lock. It may return
`PRIMARY_RESULT_WON`, `PRIMARY_RESULT_INTEGRITY_BLOCKED`,
`DENIAL_NO_LONGER_CURRENT`, `DENIAL_RECLASSIFIED`, `EXACT_CONFLICT_REPLAY`,
`CONFLICT_RESULT_MISMATCH`, `CONFLICT_RECOVERY_REQUIRED`, or `DENIAL_PERSISTED`.
For C8, `DENIAL_ACCEPTED_FOR_RECOVERY` is the internal result of the initial pair
commit; `DENIAL_PERSISTED` is the outward final result only after the synchronous
new-evidence orchestration proves `COMPLETE`.
Algorithm B supplies no transaction and never resumes primary admission after this
delegation. Its service response is the seam result, not the pre-rollback denial.

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

Multiple transactions are forbidden for a successful primary effect. After
Algorithm B rolls back, the C seam owns one separate initial denial transaction from
fresh classification through atomic reciprocal-pair commit, with no unlock gap and
no nested `BEGIN`. That commit exposes the durable internal result
`DENIAL_ACCEPTED_FOR_RECOVERY` at `PENDING`. Only after that commit may the existing
Algorithm C reconciler advance durable evidence-accounting stages in its separate
idempotent transactions. A synchronous new-evidence winner orchestration returns
`DENIAL_PERSISTED` only after it rereads and proves `COMPLETE`; it cannot make the
intermediate committed stages atomic with or invisible behind the initial
transaction. These C-owned transactions cannot write a canonical receivable,
posting operation, financial audit, settlement, PR6, PR8, legacy, or `app_data` row.

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

An exact duplicate is returned after all three persisted result rows and their
historical event/authority/policy bindings pass full immutable proof. This durable
result proof precedes current freshness, expiry, authority, policy, timezone, and
business admission. The response sets
`historicalPostingOutcome = EXACT_COMMITTED_RESULT`, reuses original IDs,
`attemptedAt`, event correlation, fingerprints, and result hash, and sets
`replayed = true`. It performs zero DML and consumes no UUID.

The same derived key or any intersecting event/lineage/source/external identity with
different command, canonical, operation, audit, result, authority, policy, or source
content is `IDEMPOTENCY_CONTENT_CONFLICT` or the earlier more specific registered
denial. The committed triplet remains byte-unchanged; no second financial fact is
created.

After historical proof, the repository separately evaluates current status using the
single captured invocation time. Current revocation, expiry, source correction, PR8
staleness, timezone drift, policy drift, or current-graph corruption can set
`currentAdmissionStatus` to `CURRENTLY_DENIED` or
`CURRENT_STATUS_INTEGRITY_BLOCKED`; they never replace, suppress, or mutate
`historicalPostingOutcome`. A current-status qualifier creates no Algorithm C
denial, because no new admission is attempted once a committed result exists.

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
| During commit with unknown client outcome | either zero or one complete triplet, never a valid partial triplet | retry Phase 1 returns `EXACT_COMMITTED_RESULT` when commit succeeded; otherwise `NO_RESULT` enters a new current admission |
| After commit but before response | one complete immutable triplet | later call proves and returns the original historical result before current drift checks |
| Authority or policy drifts after a successful commit/lost response | original complete triplet | retry returns `EXACT_COMMITTED_RESULT` plus `CURRENTLY_DENIED`; zero DML and no C conflict |
| After B rollback but before the C seam lock | B state is zero; another writer may commit a primary or C pair | the C seam disregards the non-durable B decision and applies section 7.6; an exact primary returns `PRIMARY_RESULT_WON` and stale denial evidence is never written |
| After a C conflict or transition insert but before reciprocal-pair commit | zero C rows after rollback/recovery | later invocation reclassifies the durable state; no orphan pair is accepted |
| After denial pair commit but before Algorithm C completion | no primary rows; one incomplete reciprocal pair | PR9b seam retry classifies C7 and returns `CONFLICT_RECOVERY_REQUIRED` with current stage and zero DML; an exact branded existing-wrapper retry returns its unchanged stage-preserving replay with the same stage and zero DML; neither path invokes recovery or resumes B |
| After final C `COMPLETE` commit but before response | one immutable complete reciprocal pair | PR9b seam retry returns C5 `EXACT_CONFLICT_REPLAY`; exact existing-wrapper retry returns its stable replay envelope; both return original IDs/timestamps/hashes with zero DML and no recovery |

## 12. Failure and error precedence

Determinism is defined over the complete domain tuple, not over persisted rows alone:

```text
entrypoint contract
+ validated command
+ locked persisted snapshot
+ captured attemptedAt
+ injected generator outcomes
= one deterministic classification, outcome, and write set
```

Entry point is part of API identity and audit evidence. Two bounded entrypoints may
therefore return different read-only outcomes for the same durable pair when their
contracts explicitly ask different questions. The existing wrapper's stage-preserving
replay and the PR9b seam's recovery-required response are deterministic for their
respective tuples; their difference is not repository nondeterminism, scheduler
timing, or SQL query-order dependence.

For a fixed deterministic-domain tuple, the result must be independent of invocation
order, prior process-local calls, query order, and concurrent read scheduling. The
only permitted sources of an outcome are the selected bounded entrypoint, validated
command, locked durable snapshot, and captured injected inputs explicitly included
in the deterministic domain. No compliant implementation may select or alter an
outcome through process-local `last mapper` state, a cached previous disposition, a
mutable singleton classification, a previous entrypoint identity, a call-order-
derived mapping, or shared mutable test-fixture state. A process-local optimization
is permitted only when it cannot affect classification or public outcome, is
observationally irrelevant, and produces identical cold-state and warm-state results.

SQLite lock acquisition and commit outcome are external infrastructure outcomes;
they have stable mappings but are not falsely described as deterministic business
inputs. Tests inject a deterministic clock and UUID generators. The clock is read
exactly once after lock, every time-window predicate uses that captured value, and
primary UUID generators run only after read-only classification/admission and
immediately before insert. A generator failure has one fixed position below. A UUID
collision cannot change the prior business classification and produces zero DML.

The mandatory precedence is:

1. **Malformed/unbounded/non-inert command or assertion mismatch knowable from
   shape** — stable input error before transaction; zero writes.
2. **Disabled or unauthorized invocation surface** — `CANONICAL_PR9B_DISABLED`;
   zero business reads and writes.
3. **Inaccessible database or schema/FK/registered-structure failure** — stable
   integrity/infrastructure result; no fabricated denial.
4. **Lock acquisition/contention** — `CANONICAL_POSTING_CONCURRENT_CONFLICT`; no
   automatic retry.
5. **Persisted same-scope PR6 storage-class/range preflight failure** — exact
   storage/integrity result before result classification or DML.
6. **Repository clock failure** — stable clock error; zero DML.
7. **Phase-1 durable state** — exact section-8 order:
   `PRIMARY_PARTIAL_OR_CORRUPT`, `CONFLICT_RECOVERY_INCOMPLETE`,
   `CONFLICT_COMPLETED`, `PRIMARY_POSTED_EXACT`, `IDENTITY_CONFLICT`, then
   `NO_RESULT`. A complete historical result is never hidden by the following
   current predicates.
8. **Current-status qualifier for `PRIMARY_POSTED_EXACT`** — current graph is
   classified read-only as admitted, denied, or integrity-blocked; historical result
   remains the observable primary outcome and no DML occurs.
9. **Missing authoritative event root for `NO_RESULT`** —
   `CANONICAL_POSTING_EVENT_NOT_FOUND`; no guessed fallback.
10. **Impossible/corrupt authoritative PR6/PR8/PR9a graph** — exact integrity result
    before business denial or generated IDs.
11. **Authority denial** — source-adapter, eligibility-producer, posting-adapter;
    within each kind use the existing suffix order.
12. **Write-authorization then activation denial** — `AUTHORIZATION_DRIFT` before
    `ACTIVATION_DRIFT`.
13. **Business/source denial** — root conflict, broken successor, no current,
    multiple current, correction after posting, correction after eligibility,
    revision change, PR6 drift, PR8 mismatch, due-date drift, timezone drift.
14. **Primary UUID generator failure or collision after admitted classification** —
    stable generation/collision result; zero primary/conflict DML and no change to
    the previously determined business classification.
15. **New primary insert/reread failure** — constraint, trigger, ignored/coerced
    field, or post-insert mismatch maps to
    `CANONICAL_POSTING_PERSISTENCE_FAILED` and rolls back all primary rows.
16. **Commit infrastructure failure** — mapped concurrency failure when busy/locked,
    otherwise stable database failure; never success without proved commit. Unknown
    outcome is resolved by the next invocation's Phase 1.

When a safely reconstructable registered denial is selected, Algorithm B retains
only one bounded immutable asserted cause and rolls back. Final authority moves to
the Algorithm C seam's new locked snapshot and exact section-7.6 precedence. The
seam may return a newly won primary result, no-current-denial result, reclassified
denial, conflict replay/mismatch/recovery result, or one newly completed denial.
Multiple conflict rows for one attempt are forbidden. Unsafe evidence takes the
stable read-only integrity path and writes no conflict row.

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
shared pure domain extension, isolated posting repository/service, and in
`canonical-actual-eligibility-event-repository.js` the one narrow C-owned seam plus
extraction of one unexported in-transaction primitive from the existing wrapper.
That extraction must preserve wrapper behavior and every Algorithm C semantic,
invariant, state transition, recovery rule, hash, schema, and persisted format. It
may share private pair validation while retaining separate entrypoint outcome
mappers: the existing wrapper keeps stage-preserving exact replay and the new seam
uses C7 for an incomplete exact pair. It also permits focused fixtures/tests and
implementation audit/status documents. The
list excludes generic transaction APIs, private factory export, duplicate C DML,
all other schema, `server/db.js`, routes, server wiring, frontend, dependencies,
configuration, deployment, and production access.

## 16. Prohibited scope

PR9b must not include:

- schema or migration changes;
- modifications to Algorithm A semantics or Algorithm C state, persistence,
  accounting, recovery, branding, or persisted-format invariants; the sections
  7.4-7.6 narrow C-owned seam and section-7.5 private-primitive extraction are the
  only permitted PR9a repository delta;
- any change to current wrapper replay precedence, including moving the incomplete
  guard ahead of exact replay, changing the existing PR9a result mapping, adding
  automatic recovery to exact replay, weakening existing replay tests, or altering
  PRE-PR9 compatibility semantics;
- direct use of the generic existing wrapper by the PR9b service for durable-state
  classification or public outcome mapping;
- a generic transaction API, caller-supplied transaction/context, exported private
  primitive/package factory/brand, nested `BEGIN`, or duplicate Algorithm C DML in
  the posting repository;
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
| Exact duplicate and successful replay | Submit the byte-exact command after one committed post | Exactly the original triplet; no new conflict | `EXACT_COMMITTED_RESULT`, original IDs/timestamps/event correlation, `replayed=true`, plus separate current qualifier | All DML absent |
| Concurrent same event | Two independent processes cross a barrier and post one event | Exactly one triplet | One success; other exact replay or deterministic conflict, never raw busy | No duplicate or partial rows |
| Competing inputs for one obligation | Two current/correction candidates share one economic lineage or source identity | At most one triplet; optional complete conflict pair for loser | Registered correction/revision/idempotency denial | No second canonical effect |
| Stale, missing, or incomplete graph | Remove one required PR8/PR6/event parent, create zero/multiple roots/current revisions, or stale freshness | No primary rows; one conflict pair only for registered safe evidence | `EVENT_NOT_FOUND`, exact integrity error, or registered source/PR8 denial | All primary, settlement, legacy, and source writes absent |
| Conflicting denial transition | Seed `PENDING`, `ACCOUNTED`, or `CIRCUIT_APPLIED` in same scope | Existing pair advances only through reconciler; B adds no attempt | `CONFLICT_RECOVERY_REQUIRED` with the exact current durable stage; separate C recovery runs and current B call never resumes | Primary DML, follower seam DML, and new conflict admission absent |
| Crash before commit | Inject exit/failure before DML, after each primary insert, after audit, and during deferred constraint evaluation | Zero primary rows when commit did not complete | Persistence/infrastructure failure or process loss | No partial canonical/operation/audit and no denial pair for the rolled-back success path |
| Crash after uncertain commit | Kill after SQLite commit boundary but before response; test both actual commit outcomes | Either zero rows or one complete triplet | Retry Phase 1 returns `NO_RESULT` only for failed commit and `EXACT_COMMITTED_RESULT` only for successful commit | Never a second triplet |
| Replay after successful post under later drift | Revoke/expire authority, change timezone/policy/source, or append a correction after post | Original triplet unchanged; no current-drift conflict pair | `EXACT_COMMITTED_RESULT` plus `CURRENTLY_DENIED` | All DML, update/delete, and second post absent |
| Replay after denial | Retry the original B command after one completed denial; separately repeat an internal seam call with the same bounded selector/cause | One immutable completed pair | B returns `CONFLICT_COMPLETED`; the C owner internally replays the same durable result without exposing a package | No duplicate pair and no primary rows |
| Database lock contention | Hold a writer lock at begin and inject busy/locked at DML/reread/commit | Existing durable state unchanged | `CANONICAL_POSTING_CONCURRENT_CONFLICT` | Automatic retries and partial DML absent |
| Constraint or audit failure | Mutate every FK/scope/literal/null/key/payload binding and force audit/operation trigger rejection | Zero new primary rows | `CANONICAL_POSTING_PERSISTENCE_FAILED` or stable mapped integrity error | No surviving canonical, operation, or audit |
| Post-insert reread mismatch | Ignore/coerce/mutate one inserted field, parent, generated column, hash, count, or graph row before reread | Transaction rolls back to zero new primary rows | `CANONICAL_POSTING_PERSISTENCE_FAILED` | No conflict evidence for an uncommitted primary attempt and no partial effect |
| Partial/impossible legacy state | Seed orphan PR9-source canonical, orphan/mismatched operation/audit, duplicate-looking non-PR9 row, dirty FK, or schema drift | No new primary rows; impossible state retained only for diagnosis | Integrity or identity conflict before replay/new DML | No repair, delete, normalization, replacement, settlement, or second effect |
| Combined durable states | Seed each section-8.1 combination, including partial primary plus conflict and completed conflict plus restored authority | Existing evidence remains byte-identical except permitted C recovery advancement | Exact section-8 classification independent of SQL query order | No write outside the classification's closed write set |
| Deterministic injected inputs | Repeat one command/snapshot with fixed clock/generators, then vary only attemptedAt, generator failure, UUID collision, or lock/commit outcome | Fixed tuple is byte-identical; varied external input follows its registered branch | Same tuple has same winner/write set; external failures use fixed mapping | UUID collision/failure never changes business classification or leaves DML |
| Algorithm C seam and private brand | Call the seam with each bounded registered cause; attempt caller-forged package/IDs/timestamp/hash/payload and stale cause | Exact section-7.6 state; only C4/C8 may create one C-owned pair | Exact C1-C8 outcome; no generic mismatch fallback | No exported factory, duplicate C state machine, transaction injection, nested `BEGIN`, or primary DML |
| Correlation binding | Attempt caller correlation, new B correlation, operation/audit mismatch, or mismatch with event | Valid triplet uses event correlation in operation/audit; canonical remains relational only | Success/replay only for exact event correlation; otherwise rollback | No caller/new correlation and no partial triplet |
| Unauthorized activation attempt | Call disabled service, forge runtime contract/activation selectors, import from route/server, or use environment defaults | PR9 tables unchanged | `CANONICAL_PR9B_DISABLED` or structural safety-test failure | All business/conflict DML and runtime wiring absent |

### 17.1 Mandatory B-to-C race and ownership cases

The following cases are separate mandatory tests, not variants that may share a
generic expected error. `DML` counts committed business statements unless an
attempted statement followed by rollback is stated explicitly.

| Scenario | Initial persisted state | Mutation before/during C | Classification | Returned outcome and exact DML | Final durable state |
|---|---|---|---|---|---|
| 1. Primary wins before C lock | B classified `NO_RESULT`, selected denial, and rolled back | another process commits the exact primary triplet | C1 exact primary, no conflict | `PRIMARY_RESULT_WON`; 0 DML | exact triplet only; no conflict pair |
| 2. Orphan canonical before C lock | zero result at B rollback | another writer leaves one intersecting orphan canonical | C2 partial primary | `PRIMARY_RESULT_INTEGRITY_BLOCKED`; 0 DML | orphan unchanged; no denial pair |
| 3. Denial disappears before C lock | zero result and one asserted B denial | authority/source graph changes so fresh state is admitted | C3 no current denial | `DENIAL_NO_LONGER_CURRENT`; 0 DML | no result for old attempt; external caller may start a new B attempt |
| 4. Denial cause changes before C lock | zero result and asserted cause A | fresh graph makes closed cause B the unique winner | C4 reclassified denial | `DENIAL_RECLASSIFIED`; 2 pair INSERTs + 4 transition UPDATEs = 6 DML | one `COMPLETE` pair for cause B; cause A absent |
| 5. Same conflict completes before C lock | one exact reciprocal pair for the asserted attempt/cause reaches `COMPLETE` | none after C lock | C5 exact completed conflict | `EXACT_CONFLICT_REPLAY`; 0 DML | same pair byte-unchanged |
| 6. Different conflict completes before C lock | one intersecting `COMPLETE` pair has a different durable identity | none after C lock | C6 completed-conflict mismatch | `CONFLICT_RESULT_MISMATCH`; 0 DML | existing pair unchanged; no second pair |
| 7. Incomplete transition before C lock | one pair is `PENDING`, `ACCOUNTED`, or `CIRCUIT_APPLIED`; no primary | none after C lock | C7 incomplete recovery | `CONFLICT_RECOVERY_REQUIRED`; 0 seam DML | incomplete state unchanged until separate existing C reconciliation |
| 8A. Concurrent follower through PR9b seam before `COMPLETE` | no result; same current denial | winner C8 commits one reciprocal pair at `PENDING`; a deterministic barrier before the next recovery transaction lets the seam follower obtain `BEGIN IMMEDIATE` while the pair is `PENDING`, `ACCOUNTED`, or `CIRCUIT_APPLIED` | winner C8; PR9b seam follower C7 | winner initial result `DENIAL_ACCEPTED_FOR_RECOVERY`, 2 initial INSERTs; seam follower `CONFLICT_RECOVERY_REQUIRED` with current durable stage, 0 DML | exactly one authoritative incomplete pair; seam does not recover; after barrier release only the existing reconciler may advance it |
| 8A-compatibility. Same incomplete pair through existing wrapper | the exact pair and stage from 8A | invoke the existing wrapper with the exact private branded package while the deterministic barrier holds recovery | existing wrapper exact replay before incomplete guard | unchanged `{ conflict, replayed: true }` / semantic `EXACT_STAGE_PRESERVING_REPLAY`, including original IDs/timestamps/hashes and current stage; 0 DML | same byte-identical incomplete pair; wrapper does not recover; only explicit existing reconciliation may advance it |
| 8B. Both entrypoints after `COMPLETE` | no result; same current denial | winner C8 creates the pair; release followers only after all four monotonic updates commit and a fresh reread validates `COMPLETE` | PR9b seam C5; existing wrapper exact replay | winner final `DENIAL_PERSISTED`; seam `EXACT_CONFLICT_REPLAY`; wrapper its stable `{ conflict, replayed: true }` envelope; both replay paths 0 DML and return original complete evidence | exactly one byte-identical `COMPLETE` pair; neither replay path invokes recovery |
| 9. Stale asserted cause | no result; asserted cause A | fresh locked graph proves different closed cause B | C4, never caller authority | `DENIAL_RECLASSIFIED`; exactly 6 DML | one `COMPLETE` cause-B pair; no cause-A evidence |
| 10. Nested transaction attempt | unchanged database | caller attempts to pass a connection/transaction or unknown transaction field | invalid seam command before database access | `C_SEAM_INPUT_REJECTED`; 0 DML and no `BEGIN` | unchanged |
| 11. Private primitive import | unchanged database | external module attempts to import the in-transaction primitive or package factory | structural export violation | structural test failure; 0 DML | unchanged; primitive/factory remain unexported |
| 12. Rollback between pair inserts | C8 new current denial | inject failure after conflict INSERT and before reciprocal transition INSERT/post-write proof/commit | C persistence failure | `CONFLICT_EVIDENCE_PERSISTENCE_FAILED`; 1 attempted INSERT, transaction rollback, 0 committed DML | no conflict or transition row |
| 13A. C response lost before `COMPLETE`; PR9b seam retry | initial reciprocal-pair commit succeeded; pair is `PENDING`, `ACCOUNTED`, or `CIRCUIT_APPLIED` | response/process is lost before final recovery commit; same bounded seam assertion is retried | retry C7 | `CONFLICT_RECOVERY_REQUIRED` with current durable stage; 0 retry DML; no recovery | original incomplete pair and all IDs/hashes unchanged; existing reconciler remains the only next writer |
| 13A-compatibility. Existing-wrapper exact retry before `COMPLETE` | same exact incomplete pair | exact private branded package is retried through existing wrapper | existing wrapper stage-preserving replay | unchanged `{ conflict, replayed: true }`, current stage and original evidence; 0 DML; no recovery | original incomplete pair byte-identical |
| 13B. C response lost after `COMPLETE` | one new pair completed and final `COMPLETE` commit succeeded | response is lost; retry each bounded entrypoint separately | seam C5; wrapper existing exact replay | seam `EXACT_CONFLICT_REPLAY`; wrapper unchanged replay envelope; each 0 DML and no recovery | original pair and all IDs/timestamps/hashes unchanged; complete terminal evidence |
| 14. Exact primary plus completed conflict | exact triplet and one completed intersecting conflict coexist | none; impossible graph is seeded directly in a disposable fixture | C2 impossible primary/conflict combination | `PRIMARY_RESULT_INTEGRITY_BLOCKED`; 0 DML | both facts retained only for integrity remediation; neither is selected as replay |

Every case must also assert `foreign_key_check`, `integrity_check`, exact row counts,
and byte-preservation of pre-existing evidence where the database remains structurally
readable.

The case-8 rows have this exact observable contract. Entrypoint identity is fixed
before each call and is part of the deterministic domain:

| Case | Entrypoint | Exact barrier | Locked stage | Classification | Outcome and evidence | DML / mutation / recovery | Final state and next action |
|---|---|---|---|---|---|---|---|
| 8A before `COMPLETE` | new PR9b seam | after commit establishing selected incomplete stage and before next recovery transaction | parameterized `PENDING`, `ACCOUNTED`, `CIRCUIT_APPLIED` | C7 | `CONFLICT_RECOVERY_REQUIRED`, current stage and original pair identity/hashes | 0 / none / none | same pair; release barrier for existing reconciler; external seam retry only after recovery |
| 8A-compatibility | existing PR9a wrapper | the same incomplete pair and barrier as 8A, using exact private branded replay input | same parameterized incomplete stage | existing exact replay | unchanged `{ conflict, replayed: true }`, original IDs/timestamps/hashes/current stage | 0 / none / none | same pair; wrapper does not recover |
| 8B after `COMPLETE` | new PR9b seam | release only after final commit and fresh `COMPLETE` reread | `COMPLETE` | C5 | `EXACT_CONFLICT_REPLAY`, original IDs/timestamps/hashes/complete evidence | 0 / none / none | same complete pair; terminal seam replay |
| 8B-compatibility | existing PR9a wrapper | same post-`COMPLETE` barrier | `COMPLETE` | existing exact replay | stable `{ conflict, replayed: true }`, original IDs/timestamps/hashes/current complete stage | 0 / none / none | same complete pair; stable wrapper replay |

#### 17.1.1 Mandatory barrier-controlled concurrent-follower tests

Case 8 requires three test groups with deterministic barriers; scheduler timing or
sleeps are not sufficient.

**Existing-wrapper compatibility tests.** For an exact branded replay and an exact
valid reciprocal pair parameterized at `PENDING`, `ACCOUNTED`, `CIRCUIT_APPLIED`,
and `COMPLETE`, assert the current merged `{ conflict, replayed: true }` mapping,
zero DML, byte-unchanged stage and rows, no recovery invocation, and stable original
IDs, timestamps, hashes, and current stage. These tests preserve PR9a compatibility;
they do not authorize a new wrapper semantic.

**Test A — follower before `COMPLETE`.** The winner obtains the C8 lock, creates the
reciprocal conflict/transition pair, and commits the initial pair at `PENDING`. A
barrier after that commit and before the next recovery transaction allows the
follower to obtain `BEGIN IMMEDIATE` and reread one specific incomplete stage. The
test must assert `CONFLICT_RECOVERY_REQUIRED`, classification C7, the exact current
durable stage, zero follower seam DML, one pair only, unchanged IDs/hashes, no
primary creation, no second pair, no admission, and no follower reconciliation.
After the follower returns and the barrier is released, the existing reconciler may
complete the same pair. This test must be repeated for `PENDING`, `ACCOUNTED`, and
`CIRCUIT_APPLIED`; a parameterized test is permitted, with a barrier after the
commit that establishes each stage and before the next recovery transaction.

**Test B — follower after `COMPLETE`.** The winner creates the same single pair and
the barrier does not release the follower until the existing reconciler has
committed all four monotonic updates and a fresh reread proves `COMPLETE`. The
follower then obtains `BEGIN IMMEDIATE` and must return `EXACT_CONFLICT_REPLAY`,
classification C5, zero DML, the original conflict/transition IDs, timestamps and
hashes, complete transition evidence, and a pair count of one.

For both tests, the exact barrier, lock acquisition, locked stage, statement count,
row count, IDs, hashes, transition evidence, final state, and next permitted action
are observable assertions. No PR9b seam implementation may collapse the two
timelines into one expected result.

**Fresh-equivalent fixture rule.** Every cross-entrypoint ordering scenario must use
a fresh equivalent durable fixture. “Fresh equivalent” means a byte-equivalent
durable conflict/transition graph at the same stage, with the same identities,
hashes, and bindings except for a fixture-local generated database identity where
exact reuse is impossible; no process-local state inherited from a previous
scenario; and clean repository/service instances where needed to prove absence of
mutable mapper state. Tests must not reuse one mutated in-memory object as proof of
order independence.

**Bidirectional cross-entrypoint ordering tests.** For each monotonic stage
`PENDING`, `ACCOUNTED`, `CIRCUIT_APPLIED`, and `COMPLETE`, execute both of the
following orders as separate fresh-fixture scenarios:

1. **Order A — wrapper then seam:** invoke the existing PR9a wrapper against a fresh
   exact pair, capture its outcome and durable graph, invoke the PR9b seam, and
   capture its outcome and durable graph again.
2. **Order B — seam then wrapper:** repeat against a fresh equivalent fixture in
   reverse order and capture the same evidence after each call.

At every incomplete stage, each wrapper call must return its existing stage-
preserving exact replay and each seam call must return
`CONFLICT_RECOVERY_REQUIRED`. At `COMPLETE`, the wrapper must return its existing
exact replay and the seam must return `EXACT_CONFLICT_REPLAY`. Every call performs
zero DML, invokes no recovery, changes no stage, and leaves durable rows byte-
equivalent before, between, and after calls with stable IDs and hashes. Tests must
explicitly assert that the wrapper outcome in Order A equals the wrapper outcome in
Order B, the seam outcome in Order A equals the seam outcome in Order B, and the
write set in both orders is zero. Any order-dependent envelope, classification, or
evidence is a failure.

**Repeated alternating-call tests.** Against one read-only exact fixture, execute
`wrapper -> seam -> wrapper -> seam`, then execute
`seam -> wrapper -> seam -> wrapper` against a fresh equivalent fixture. Every
wrapper call in a sequence must return the same wrapper-specific outcome; every seam
call must return the same seam-specific outcome; total DML is zero; the durable graph
remains byte-identical throughout; and no cached result or entrypoint discriminator
may leak from one call into the next.

**Simultaneous post-commit reader tests.** For each of `PENDING`, `ACCOUNTED`,
`CIRCUIT_APPLIED`, and `COMPLETE`, commit the durable stage, then use a deterministic
barrier to start one existing-wrapper invocation and one PR9b-seam invocation from
the same persisted snapshot. The incomplete-stage outcomes remain wrapper stage-
preserving replay and seam `CONFLICT_RECOVERY_REQUIRED`; the `COMPLETE` outcomes
remain wrapper exact replay and seam `EXACT_CONFLICT_REPLAY`. Assert zero writer DML,
no recovery, no stage mutation, no lock-order-dependent mapper selection, and the
same entrypoint-specific outcomes regardless of which reader completes first. If
SQLite or the repository serializes reads internally, the test must still prove both
calls observed an equivalent unchanged graph and independently applied their own
mapper.

**Changed branded-wrapper assertion.** At each of `PENDING`, `ACCOUNTED`,
`CIRCUIT_APPLIED`, and `COMPLETE`, seed one exact valid pair and invoke the existing
wrapper with a private branded package assertion that differs from the persisted
pair in exactly one bounded identity or hash field.
It must return the existing deterministic mismatch/integrity outcome, not exact
replay, with zero DML, no recovery, and an unchanged pair. Then invoke the PR9b seam
against the same unchanged state with a valid seam command. The seam must depend
only on its durable state and command: an incomplete stage returns
`CONFLICT_RECOVERY_REQUIRED`, while `COMPLETE` returns `EXACT_CONFLICT_REPLAY`, with
zero DML and no inherited wrapper mismatch disposition. Repeat seam then hostile
wrapper on a fresh equivalent fixture and assert the same entrypoint-specific
outcomes.

**Different bounded seam command.** For the same durable pair, a syntactically valid
PR9b seam command that asserts an expected ID or hash inconsistent with persisted
state must return the seam's deterministic read-only assertion mismatch, with zero
DML and no recovery. It must not alter the pair, become a business denial, affect a
later valid existing-wrapper invocation, or populate process-local mapper state. If
different command bytes normalize to the same valid bounded selector/assertion
semantics, the seam outcome must equal the canonical equivalent command outcome.
The implementation must define its normalization and command-fingerprint rules
explicitly; transport serialization alone must not alter entrypoint mapping. Cover
valid wrapper then changed-command seam and changed-command seam then valid wrapper
orders with fresh fixtures; the wrapper outcome must remain unchanged in both.

**Corrupt and mismatched cross-entrypoint fixtures.** Test missing reciprocal row,
mismatched conflict/transition hash, invalid stage progression, duplicate
intersecting pair, corrupted `COMPLETE`, and primary-plus-conflict impossible graph.
For each fixture, both entrypoints must return their deterministic integrity or
mismatch outcome, perform zero DML, and invoke no recovery unless the existing
Algorithm C contract explicitly classifies that exact state as recoverable. One
entrypoint's result may not influence the other's later result. Test the reverse
order on a fresh equivalent fixture. The public envelopes need not be identical when
the stable entrypoint contracts differ, but both results must agree on the underlying
persisted classification facts.

The mandatory assertion matrix is:

| Scenario | Order | Wrapper outcome | Seam outcome | Total DML | Durable mutation | Recovery |
|---|---|---|---|---:|---|---|
| Exact `PENDING` | wrapper -> seam | existing replay | recovery-required | 0 | none | none |
| Exact `PENDING` | seam -> wrapper | existing replay | recovery-required | 0 | none | none |
| Exact `ACCOUNTED` | both orders | existing replay | recovery-required | 0 | none | none |
| Exact `CIRCUIT_APPLIED` | both orders | existing replay | recovery-required | 0 | none | none |
| Exact `COMPLETE` | both orders | existing replay | exact conflict replay | 0 | none | none |
| Changed wrapper assertion | both orders | mismatch | stage-derived seam result | 0 | none | none |
| Different bounded seam command | both orders | wrapper unchanged | assertion/normalized result | 0 | none | none |
| Simultaneous readers | concurrent | wrapper-specific | seam-specific | 0 | none | none |
| Corrupt graph | both orders | integrity result | integrity result | 0 | none | none |

“Both orders” always means separate fresh-fixture executions, not reversing
assertions in one test body.

**Process-local state prohibition proof.** The implementation audit must combine
static inspection with the bidirectional, repeated, and concurrent behavioral tests
above. Static inspection must reject module-level mutable `lastResult` state, a
cached entrypoint discriminator, global mutable command classification, singleton
repository state that affects result mapping, and test-only state on which production
code could accidentally depend. Any process-local cache must be observationally
irrelevant to classification and public outcome, and cold-process versus warm-process
tests must return identical results.

## 18. Production-activation evidence required later

PR9b implementation and its local fixtures cannot authorize production. A later
runtime gate must be able to identify and independently verify at least:

1. the exact approved design head and independent review with no unresolved P0,
   P1, or P2 findings;
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
| D-PR9B-01 Algorithm B responsibility | **APPROVE WITH CONDITIONS:** Algorithm B owns one initial-post outcome; its mandatory workflow is durable result resolution, new admission/primary transaction only from `NO_RESULT`, and post-rollback delegation only to the new bounded C seam | Sections 7.4-7.6 require entrypoint-specific replay contracts, unchanged existing-wrapper compatibility, seam-specific C7, cross-entrypoint tests, and no Algorithm C semantic change; B may not call the generic wrapper for classification, own/nest C, duplicate C, or turn current drift into a historical failure |
| D-PR9B-02 physical source mapping | **APPROVE:** merged-schema mapping `rental_service_upd` / `rootSourceDocumentLineageId` / `economicLineageKey` explicitly supersedes the three PRE-PR9 section-15 values | Existing trigger makes alternatives mutually exclusive; correction/revision fixtures must independently prove identity semantics |
| D-PR9B-03 schema trust boundary | **APPROVE WITH CONDITIONS:** PR9a v1 is sufficient only for repository-exclusive Algorithm B business DML | Future proof must include static inventory of every PR9 SQL reference, import/call-graph isolation, prohibition of dynamic/generic business DML, `PRAGMA foreign_keys = ON`, clean `foreign_key_check`, startup schema/index/trigger assertions, orphan anti-joins, and hostile independent-process tests; arbitrary database-owner raw SQL remains outside the threat model |
| D-PR9B-04 activation split | **APPROVE:** isolated unreachable PR9b places every runtime consumer/live adapter/activation action in PR9c or later | Prevents implementation merge from implying runtime authority |

Gate C production policy/evidence approvals are not unresolved Algorithm B mechanics;
they are mandatory later authorization inputs. No implementation may fill them with
fixtures or defaults.

## 20. Authorization result and next gate

This document proposes only:

```text
PR9b design = REMEDIATION COMPLETE; INDEPENDENT RE-AUDIT REQUIRED
architectureDesignApproved = TRUE          # existing Gate A only
pr9aImplementationAuthorized = TRUE        # existing merged PR9a only
pr9bDesignReviewed = FALSE
pr9bImplementationAuthorized = FALSE
runtimeAuthorized = FALSE
deploymentAuthorized = FALSE
productionReadsAuthorized = FALSE
productionWritesAuthorized = FALSE
pr9ImplementationAuthorized = FALSE
pr9DisabledDeploymentAuthorized = FALSE
productionActivationAuthorized = FALSE
canonicalProductionReadsAuthorized = FALSE
productionCanonicalWritesAuthorized = FALSE
settlementAuthorized = FALSE
shadowReadAuthorized = FALSE
cutoverAuthorized = FALSE
```

The only next gate is an independent re-audit of the exact remediation head. The
reviewer must reproduce the repository map, verify all four residual decisions,
prove schema sufficiency or require a separate schema design, validate the ordered
state predicates, two-phase result/admission contract, deterministic input domain,
transaction/replay/crash proofs, Algorithm C seam, correlation binding, hostile
matrix, exact future allowlist, and absence of runtime/production authority. Only
after a passing re-audit and a separate direct Owner/Architect authorization bound to
an exact base/head and selected allowlist subset may PR9b implementation begin.

The only acceptable approving design-review verdict is:

```text
PR9B DESIGN APPROVED FOR OWNER/ARCHITECT AUTHORIZATION
```

Any unresolved P0, P1, or P2 finding requires:

```text
pr9bDesignReviewed = FALSE
pr9bImplementationAuthorized = FALSE
```

An unresolved P2 may not be described as “approved except for P2,” “conditionally
ready with unresolved P2,” or “implementation may proceed while P2 remains.” A P3
may remain only when it is explicitly documented as non-blocking and durably
accepted by the Owner/Architect. Design approval does not waive the separate future
implementation-audit requirement that the exact implementation head have no
unresolved implementation P0, P1, or P2 findings.
