# PR9b Design and Future Implementation Authorization Package

## 1. Status and authority boundary

**Package status:**
`PR9B DESIGN REMEDIATION COMPLETE — INDEPENDENT RE-AUDIT REQUIRED`

**Implementation status:** `PR9B IMPLEMENTATION NOT AUTHORIZED`

**Design base / merged PR9a:**
`a8987eb8c33a7b8974a21a8d25ad018b05317148`.

**Authorized PR9a source head:**
`2f73fa99225142758319ec9c3a80ee5186e176fd`.

**Normative PR9b proposal:**
`docs/canonical-actual-posting-pr9b-design.md`.

This package defines review and authorization boundaries only. It contains no
implementation authorization, canonical business DML, deployment authority,
production evidence acceptance, activation, production read/write, settlement,
shadow-read, or cutover permission. Merge, CI, a draft PR, review silence, or the
existence of these files changes no authorization value.

The previous package head `bdc6279b2b4ba6adf0d71335d61b0e21dd27ed76`
was rejected because its global incomplete-replay prohibition conflicted with the
merged PR9a wrapper contract. This revision adopts the Owner/Architect
cross-entrypoint decision: the existing wrapper retains stage-preserving exact replay,
while only the new bounded PR9b seam maps an incomplete exact pair to C7
`CONFLICT_RECOVERY_REQUIRED`. Closure is a design proposal only and must be
independently re-audited at its new exact head.

## 2. Effect of the design PR

The design remediation PR may only:

- add or modify the two PR9b design/authorization Markdown documents;
- modify `tests/canonical-actual-posting-structural.test.js` solely to pin the
  historical PR9a allowlist to its closed commit range and enforce the current PR9b
  remediation diff against its exact base/three-file scope;
- record archaeology, contracts, proposed decisions, exact future scope, and gates;
- receive independent review and an Owner/Architect design decision.

It may not modify an approved historical document to make a new decision appear
previously approved. Apart from the named test-process correction, it may not create
or modify code, tests, SQL, migration, configuration, runtime wiring, evidence rows,
or production actions.

After a design PR merge, the only possible new fact is that a reviewable design
package exists.
`pr9bImplementationAuthorized` remains `FALSE` until a separate later authorization
record meets section 6.

## 3. Exact future PR9b implementation allowlist

A future PR9b implementation may add or modify only this closed list, after a
separate authorization explicitly names its exact base SHA and selected subset.

### 3.1 Production-source files

```text
server/lib/canonical-actual-posting-domain.js
server/lib/canonical-actual-posting-repository.js
server/lib/canonical-actual-posting-service.js
server/lib/canonical-actual-eligibility-event-repository.js
```

Responsibilities are exact:

| File | Allowed responsibility |
|---|---|
| `canonical-actual-posting-domain.js` | Pure posting command, projection, canonical serialization/hash, fingerprint, idempotency, result, and stable-error contracts needed by Algorithm B; no I/O or runtime activation |
| `canonical-actual-posting-repository.js` | Repository-owned `BEGIN IMMEDIATE`, durable historical-result resolution before current admission, Algorithm B primary triplet, exact replay, rollback, and delegation of only a bounded denial cause to the existing Algorithm C owner |
| `canonical-actual-posting-service.js` | Inert exact command validation and delegation to the disabled repository only; no registration or caller authority |
| `canonical-actual-eligibility-event-repository.js` | One narrow C-owned posting-denial seam with seam-specific C1-C8 outcomes; extraction of one unexported in-transaction pair-validation/create/replay primitive; and separate entrypoint mappers so the existing wrapper retains stage-preserving exact replay while the new seam returns recovery-required for an incomplete exact pair, without nested `BEGIN` or an unlock gap |

No other production file is implicitly allowed. In particular, the implementation
may not modify PR9a schema, Algorithm A semantics, Algorithm C state/persistence/
accounting/recovery semantics, authority repository, `server/db.js`, or
`server/server.js`. The eligibility-event repository exception is limited to the
single seam plus private-primitive extraction above. The existing wrapper must retain
its transaction ownership and observable behavior. The primitive must not own a
transaction or be exported. The new seam alone owns its `BEGIN IMMEDIATE`, locked
classification, fresh reconstruction, private branding, reciprocal-pair invocation,
post-write proof, and commit/rollback. Algorithm B supplies no connection or
transaction context. The PR9b service must call only the new narrow seam for this
handoff; it may not use the generic existing wrapper for durable-state classification
or public result mapping. A shared private primitive may validate the pair, but it
must not force one public outcome on both entrypoints.

### 3.2 Tests, helper, fixtures, and implementation records

```text
tests/canonical-actual-posting-fixtures.js
tests/canonical-actual-posting-repository.test.js
tests/canonical-actual-posting-concurrency.test.js
tests/canonical-actual-posting-remediation.test.js
tests/canonical-actual-posting-safety.test.js
tests/canonical-actual-posting-structural.test.js
tests/helpers/canonical-actual-posting-concurrency-worker.mjs
docs/canonical-actual-posting-pr9b-audit.md
docs/canonical-receivables-contract.md
docs/canonical-receivables-decisions.md
```

The design and authorization documents themselves are approval baselines and are not
on the implementation allowlist. A required semantic change to either document
stops implementation and returns to design review.

### 3.3 Subset rule

Before implementation starts, the implementer must publish the exact subset of the
allowlist that will change and one responsibility per file. Adding, renaming, moving,
or generating another file is a hard stop and requires a new design/scope review and
Owner authorization. Package manifests, lockfiles, formatting churn, generated
artifacts, and CI/configuration files are not implicitly permitted.

## 4. Explicit prohibited scope

The future PR9b implementation must not include or perform:

- schema, migration, index, trigger, or `server/db.js` changes;
- changes to `canonical-actual-eligibility-event-repository.js` outside the exact
  section-3.1 C-owned seam, C1-C8 handling, and private-primitive extraction; its
  service, the PR9a authority repository, or any Algorithm A/C semantic, invariant,
  state, persisted-format, or recovery behavior;
- changing current wrapper replay precedence, moving the incomplete guard before its
  exact replay lookup, changing its existing result mapping, modifying/weakening its
  PR9a replay tests, or making exact replay invoke automatic recovery;
- using one shared public classifier or mapper that silently changes the existing
  wrapper while adding the seam; the shared component must remain private and
  entrypoint-neutral;
- a generic/exported transaction API, caller-supplied connection/transaction/context,
  nested `BEGIN`, exported private primitive/package factory/brand, caller-created
  branded package, or duplicated Algorithm C conflict/transition DML in the posting
  repository;
- routes, `server/server.js`, workers, schedulers, cron, timers, queues, startup
  hooks, CLI, frontend, or runtime consumers;
- feature flags, environment switches, enabled defaults, resolver wiring, or live
  adapter/credential/identity provisioning;
- staging or production deployment, Railway access/change, production database
  access, migration execution, evidence capture, activation, read, or write;
- canonical draft/update/delete/cancel/correct/compensate operations;
- payments, allocations, adjustments, refunds, write-offs, settlement, backfill,
  dual write, shadow read, cutover, or legacy retirement;
- modification, normalization, repair, deletion, or population of PR9a/PR6/PR8 or
  existing canonical data;
- merge of its own PR or any self-issued authorization.

Isolated tests may execute Algorithm B DML only against disposable local databases
and artificial fixtures. Such rows are not production evidence.

## 5. Required implementation proof

A future PR9b is eligible for technical review only when it proves all of the
following against the exact authorized head:

1. the changed-file set is an exact subset of section 3;
2. the service/repository remain unreachable from every production call graph;
3. Algorithm B accepts only an existing event-rooted selector/assertion command;
   caller values confer no authority and cannot include generated IDs, correlation,
   clock, UUID, idempotency, canonical payload, audit payload, or branded denial;
4. the only primary DML is one canonical receivable, one posting operation, and one
   financial audit in a single transaction;
5. after schema/storage preflight, durable state is classified by the exact ordered
   mutually exclusive predicates before current authority/business admission;
6. exact committed result proof is read-only, returns the original historical
   result, and cannot be hidden by current revocation/drift; current status is a
   separate non-persisted qualifier;
7. only `NO_RESULT` performs fresh PR5/PR6/PR8/PR9 authority, authorization,
   activation, policy/timezone, and business admission under `BEGIN IMMEDIATE`;
8. changed payload under an intersecting identity cannot create a second effect;
9. every error/denial follows the normative precedence and has the exact durable
   write set;
10. every insert/trigger/reread/commit fault rolls the primary triplet back;
11. independent-process concurrency creates at most one effect;
12. uncertain commit is resolved by Phase 1 as `EXACT_COMMITTED_RESULT` or
    `NO_RESULT` before current admission; drift cannot hide a committed effect;
13. operation and financial audit correlation equal the persisted event correlation,
    while canonical is bound relationally and carries no correlation column;
14. after B rollback, the narrow PR9a C seam alone opens exactly one
    `BEGIN IMMEDIATE`; B cannot supply/nest a transaction, forge a package, perform C
    DML, retry C, or form the response from its non-durable denial object;
15. the current wrapper retains its transaction-owning behavior, replay precedence,
    stage-preserving result mapping, and no-recovery replay behavior while it and the
    new seam may call one unexported, non-transaction-owning pair-validation/create/
    replay primitive; final outcome mapping remains entrypoint-specific and fresh
    seam reread/reconstruction/branding and pair persistence have no unlock gap;
16. the new PR9b seam C1-C8 retain the exact design classifications and write sets:
    `PRIMARY_RESULT_WON`, `PRIMARY_RESULT_INTEGRITY_BLOCKED`,
    `DENIAL_NO_LONGER_CURRENT`, `DENIAL_RECLASSIFIED`,
    `EXACT_CONFLICT_REPLAY`, `CONFLICT_RESULT_MISMATCH`,
    `CONFLICT_RECOVERY_REQUIRED`, and C8's two explicit result milestones:
    initial `DENIAL_ACCEPTED_FOR_RECOVERY` at `PENDING`, then final
    `DENIAL_PERSISTED` only after durable `COMPLETE` proof;
17. impossible primary/conflict combinations always precede primary or conflict
    replay and return the read-only integrity block; through the PR9b seam an
    incomplete transition returns recovery-required with zero DML, while an exact
    branded existing-wrapper replay retains its merged stage-preserving zero-DML
    result; neither entrypoint advances recovery;
18. C4/C8 perform exactly two reciprocal-pair inserts in the initial seam-owned
    transaction and the unchanged four monotonic transition updates only through
    the existing reconciler's separate transactions; these six statements are never
    represented as one SQLite transaction; all other C1-C8 paths perform zero DML,
    and a pre-pair-commit fault leaves zero durable rows;
19. the B service returns only an immutable C result; a synchronous winner may
    return `DENIAL_PERSISTED` only after a durable `COMPLETE` reread, while
    interruption after the initial commit leaves a recoverable incomplete pair and
    cannot return a false final result; fresh C state may otherwise make a primary
    win, remove/reclassify denial, replay/mismatch conflict evidence, or require
    recovery, and stale caller/B causes are never authority;
20. independent-process tests cover every design section-17.1 race, including the
    existing-wrapper compatibility matrix, PR9b seam before/after-`COMPLETE`
    barriers, fresh-fixture bidirectional same-pair outcomes, repeated alternating
    calls, simultaneous post-commit readers, hostile changed assertions and bounded
    commands, private export/nested-transaction rejection, rollback between pair
    inserts, entrypoint-specific lost responses, corrupt graphs, and impossible
    primary-plus-conflict state;
21. deterministic tests fix entrypoint contract, command, locked snapshot, captured
    attemptedAt, and injected generator outcomes; prove independence from invocation
    order, prior process-local calls, query order, and concurrent read scheduling;
    and separately exercise lock/commit outcomes;
22. every other hostile scenario in the design matrix passes, including tampering,
    partial legacy state, post-insert mismatch, and unauthorized activation;
23. canonical-byte and SHA-256 fixtures are independently reproduced for every new
    posting envelope and mutation;
24. schema/FK/integrity and no-orphan/extra-row checks pass after every success and
    fault case;
25. static inventory proves every SQL reference to PR9 tables, import/call-graph
    isolation, and absence of dynamic/generic business DML; startup proves exact
    schema/index/trigger definitions, `foreign_keys = 1`, clean
    `foreign_key_check`, and orphan anti-joins;
26. static inspection rejects module-level mutable mapper/result state, cached
    entrypoint discriminators, global mutable classification, outcome-affecting
    singleton repository state, and production dependence on test-only mutable state;
    any observationally irrelevant cache produces identical cold/warm results;
27. two focused final-tree runs, two full test runs, explicit Node test run, build,
    static scope scans, and a clean exact-head review are recorded in the PR9b audit.

### 5.1 Mandatory cross-entrypoint replay authorization contract

Entrypoint contract is part of deterministic API identity and audit evidence:

```text
entrypoint contract
+ validated command
+ locked persisted snapshot
+ captured attemptedAt
+ injected generator outcomes
= one deterministic classification, outcome, and write set
```

Different bounded entrypoints may legally return different read-only outcomes for
the same durable pair. That distinction is contractual, not repository
nondeterminism, scheduler timing, or query-order dependence.

For a fixed deterministic-domain tuple, the result must be independent of invocation
order, prior process-local calls, query order, and concurrent read scheduling. The
only permitted outcome sources are the selected bounded entrypoint, validated
command, locked durable snapshot, and captured injected inputs explicitly included
in that domain. Process-local `last mapper` state, cached previous disposition,
mutable singleton classification, previous entrypoint identity, call-order-derived
mapping, and shared mutable test-fixture state are prohibited.

**Existing PR9a wrapper.** For an exact private branded replay request and one exact
valid reciprocal pair at `PENDING`, `ACCOUNTED`, `CIRCUIT_APPLIED`, or `COMPLETE`,
the wrapper retains its merged API mapping `{ conflict, replayed: true }`, called
`EXACT_STAGE_PRESERVING_REPLAY` only as a design-level semantic label. Its existing
conflict envelope returns original IDs, timestamps, and hashes; the current stage is
proved through the existing verified pair/read contract alongside that result, not
through a new or renamed wrapper field. It performs zero DML, does not mutate stage,
and invokes no recovery. Exact replay remains ordered before the incomplete-transition
guard. The PRE-PR9 contract and existing PR9a tests remain unchanged compatibility
authority.

**New PR9b seam.** C5/C7 and `EXACT_CONFLICT_REPLAY` below are seam-specific final
Algorithm B result terms. The seam must not expose an incomplete pair as final exact
conflict replay:

| Locked pair state | Seam classification | Seam outcome | Seam DML | Mutation / recovery | Returned evidence |
|---|---|---|---:|---|---|
| exact `PENDING` | C7 | `CONFLICT_RECOVERY_REQUIRED` | 0 | none / none | original pair identity/hashes and stage `PENDING` |
| exact `ACCOUNTED` | C7 | `CONFLICT_RECOVERY_REQUIRED` | 0 | none / none | original pair identity/hashes and stage `ACCOUNTED` |
| exact `CIRCUIT_APPLIED` | C7 | `CONFLICT_RECOVERY_REQUIRED` | 0 | none / none | original pair identity/hashes and stage `CIRCUIT_APPLIED` |
| fully reread and validated `COMPLETE` | C5 | `EXACT_CONFLICT_REPLAY` | 0 | none / none | original IDs, timestamps, hashes, and complete transition evidence |
| corrupt or mismatched pair | C2/C6 or earlier integrity state | exact registered integrity/mismatch result | 0 | none / none | available diagnostic identity only |

C7 is a PR9b seam classification, not a global prohibition on every Algorithm C
replay entrypoint. PR9b seam final exact conflict replay is legal only at validated
`COMPLETE`; this does not prohibit the existing wrapper from stage-preserving exact
replay of an incomplete pair.

The mandatory cross-entrypoint matrix is below. “Stage” in the wrapper column means
the stage observed through the existing verified pair/read contract alongside the
stable wrapper envelope; it does not authorize a result-mapping change:

| Durable pair | Existing PR9a wrapper | New PR9b seam |
|---|---|---|
| exact `PENDING` | stage-preserving `{ conflict, replayed: true }`; original IDs/timestamps/hashes/stage; DML 0; no mutation; no recovery | C7 `CONFLICT_RECOVERY_REQUIRED`; original pair identity/hashes/stage; DML 0; no mutation; no recovery |
| exact `ACCOUNTED` | stage-preserving `{ conflict, replayed: true }`; original IDs/timestamps/hashes/stage; DML 0; no mutation; no recovery | C7 `CONFLICT_RECOVERY_REQUIRED`; original pair identity/hashes/stage; DML 0; no mutation; no recovery |
| exact `CIRCUIT_APPLIED` | stage-preserving `{ conflict, replayed: true }`; original IDs/timestamps/hashes/stage; DML 0; no mutation; no recovery | C7 `CONFLICT_RECOVERY_REQUIRED`; original pair identity/hashes/stage; DML 0; no mutation; no recovery |
| exact validated `COMPLETE` | stable `{ conflict, replayed: true }`; original complete evidence; DML 0; no mutation; no recovery | C5 `EXACT_CONFLICT_REPLAY`; original complete evidence; DML 0; no mutation; no recovery |
| corrupt/mismatched | existing registered integrity/collision result; DML 0; no mutation; no recovery | C2/C6 or earlier registered integrity/mismatch result; DML 0; no mutation; no recovery |

The PR9b service must call only the new seam for B-to-C handoff. It may not call the
generic existing wrapper to classify durable state. Shared private pair validation
is permitted, but the wrapper and seam must apply their separate final mappers. A
shared public classifier that changes existing wrapper precedence or behavior is
forbidden.

The following test groups are mandatory in the already allowlisted PR9b test files:

1. **Existing-wrapper compatibility tests.** Parameterize exact branded replay over
   `PENDING`, `ACCOUNTED`, `CIRCUIT_APPLIED`, and `COMPLETE`. Assert the current
   merged replay result, current durable stage through the existing pair read, zero
   DML, byte-unchanged rows/stage, no recovery, and stable IDs/timestamps/hashes.
   These are compatibility tests, not new semantic authorization.
2. **PR9b seam tests.** Test A places deterministic barriers after commits that
   establish `PENDING`, `ACCOUNTED`, and `CIRCUIT_APPLIED` and before the next
   recovery transaction; the seam follower must obtain its lock and return
   C7/`CONFLICT_RECOVERY_REQUIRED` with current stage, zero DML, no recovery,
   stable one-pair evidence, no primary/admission/second pair, and no row mutation.
   Test B releases the seam only after all four recovery updates commit and a fresh
   reread proves `COMPLETE`; it must return C5/`EXACT_CONFLICT_REPLAY`, zero DML,
   original complete evidence, and one unchanged pair.
3. **Fresh-fixture bidirectional cross-entrypoint tests.** For each of `PENDING`,
   `ACCOUNTED`, `CIRCUIT_APPLIED`, and `COMPLETE`, run wrapper then seam and seam
   then wrapper as separate fresh-fixture scenarios. A fresh equivalent fixture has
   a byte-equivalent durable conflict/transition graph at the same stage; the same
   identities, hashes, and bindings except for an unavoidable fixture-local database
   identity; no inherited process-local state; and clean repository/service instances
   where needed. Reuse of one mutated in-memory object does not prove order
   independence. At incomplete stages the wrapper returns existing stage-preserving
   replay and the seam returns recovery-required; at `COMPLETE` the wrapper returns
   existing exact replay and the seam returns exact conflict replay. Assert zero DML,
   no recovery or stage mutation, byte-equivalent rows before/between/after calls,
   stable IDs/hashes, equal per-entrypoint outcomes across orders, and no order-
   dependent envelope, classification, or evidence.
4. **Repeated alternating-call tests at every stage.** Independently for each of
   `PENDING`, `ACCOUNTED`, `CIRCUIT_APPLIED`, and `COMPLETE`, run
   `wrapper -> seam -> wrapper -> seam` on one fresh-equivalent read-only fixture and
   `seam -> wrapper -> seam -> wrapper` on a separate fresh-equivalent fixture. A
   single `PENDING` execution cannot satisfy another stage. At incomplete stages,
   every wrapper call returns the existing stage-preserving replay and every seam
   call returns `CONFLICT_RECOVERY_REQUIRED`; at `COMPLETE`, every wrapper call
   returns existing exact replay and every seam call returns
   `EXACT_CONFLICT_REPLAY`. The first and second outcome from each entrypoint are
   equal; total DML is zero; no recovery or stage mutation occurs; IDs and hashes are
   stable; the durable graph is byte-equivalent before, between, and after all calls;
   and no prior call affects the next mapper, evidence, or intended write set.
5. **Simultaneous post-commit reader tests.** At all four committed stages, use a
   barrier to start one wrapper and one seam reader against the same snapshot.
   Outcomes remain entrypoint-specific regardless of reader completion order, with
   no writer DML, recovery, stage mutation, or lock-order-selected mapper. Internal
   read serialization is acceptable only if both calls prove equivalent unchanged
   durable graphs and independently produce their own mapped outcomes.
6. **Changed branded-wrapper assertion tests.** At all four stages, change exactly
   one bounded identity/hash assertion in an otherwise exact private branded wrapper
   package. The wrapper returns its existing deterministic mismatch/integrity result,
   never exact replay, with zero DML, no recovery, and no row change. A subsequent
   valid seam command must ignore that disposition and return the stage-derived seam
   outcome. Repeat in reverse order on a fresh equivalent fixture.
7. **Different bounded command tests.** Keep assertion mismatch and normalized
   equivalence separate at every applicable stage; applicable stages include all of
   `PENDING`, `ACCOUNTED`, `CIRCUIT_APPLIED`, and `COMPLETE` unless a command field
   is formally invalid for one named stage and the exclusion is explicit and
   justified. A changed expected ID/hash returns a deterministic read-only assertion
   mismatch, not a business denial, with zero DML and no recovery. Its mismatch
   fingerprint differs from the valid canonical command and its evidence/read set
   records the comparison; it cannot affect a later valid call through either
   entrypoint or process-local state. For transport-different commands A and B with
   identical canonical bounded semantics, tests explicitly assert equal normalized
   command representations, normalized fingerprints, entrypoint identities and
   outcomes, canonical evidence/read digests, returned IDs/hashes/stage evidence,
   intended write sets, and actual zero DML. Equal public outcome alone is
   insufficient. Cover wrapper then seam and seam then wrapper on separate fresh-
   equivalent fixtures; run both transport forms through both entrypoints in A-first
   and B-first variants.
8. **Corrupt/mismatched cross-entrypoint tests.** Separately seed a missing reciprocal
   row, mismatched conflict/transition hash, invalid stage progression, duplicate
   intersecting pair, corrupted `COMPLETE`, and primary-plus-conflict impossible
   graph. Each entrypoint returns its deterministic integrity/mismatch outcome with
   zero DML and no recovery unless the existing Algorithm C contract explicitly
   marks that exact state recoverable. Repeat the reverse order on fresh equivalent
   fixtures and prove both envelopes agree on underlying persisted classification
   facts even where their public shapes differ.

The mandatory alternating-stage matrix is:

| Durable stage | Sequence | Wrapper outcome | Seam outcome | Total DML | Mutation | Recovery |
|---|---|---|---|---:|---|---|
| `PENDING` | wrapper -> seam -> wrapper -> seam | existing replay, identical both times | recovery-required, identical both times | 0 | none | none |
| `PENDING` | seam -> wrapper -> seam -> wrapper | existing replay, identical both times | recovery-required, identical both times | 0 | none | none |
| `ACCOUNTED` | both sequences | stable existing replay | stable recovery-required | 0 | none | none |
| `CIRCUIT_APPLIED` | both sequences | stable existing replay | stable recovery-required | 0 | none | none |
| `COMPLETE` | both sequences | stable existing replay | stable exact conflict replay | 0 | none | none |

“Both sequences” means separate executions on fresh-equivalent durable fixtures.

For normalized-command verification, tests must expose a deterministic test/audit
representation, conceptually `canonicalEvidenceReadDigest`, derived only from the
authoritative persisted facts used for classification. Equality compares at least
event, conflict, and transition identities; reciprocal bindings; durable stage;
conflict and transition hashes; relevant authority/evidence seals; selector/assertion
fields consumed; collision candidates inspected; and classification facts used by
the mapper. It uses canonical field order and stable serialization, excludes
timestamps and process-local values unless they are authoritative evidence, is equal
for semantically equivalent normalized commands, and is unequal when bounded
selector/assertion semantics materially differ. SQL execution order may differ when
the canonical evidence set and classification facts are equal. The digest is test/
audit evidence only; it creates no database column, schema requirement, or public
result field.

For both cross-entrypoint orders, run transport A and transport B through each
entrypoint and assert:

```text
normalizedFingerprint(commandA) = normalizedFingerprint(commandB)
evidenceReadSet(commandA) = evidenceReadSet(commandB)
entrypointOutcome(commandA) = entrypointOutcome(commandB)
```

The wrapper fingerprints and evidence digests are equal across A/B, the seam
fingerprints and evidence digests are equal across A/B, and returned evidence and
zero write sets are equal. Repeat in a cold repository/service instance, a warm
instance after wrapper calls, and a warm instance after seam calls; fingerprints,
digests, outcomes, evidence, and intended/actual zero write sets remain equal.

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

“Both orders” means separate fresh-fixture executions, never reversed assertions in
one test body.

The master P2-01 verification matrix is:

| Scenario | Stages | Orders / process states | Required equality |
|---|---|---|---|
| Alternating calls | all four | both alternating sequences | repeated per-entrypoint outcomes and evidence; zero intended/actual write set |
| Normalized equivalent commands | all applicable stages | wrapper -> seam and seam -> wrapper; A-first and B-first | normalized representation/fingerprint, evidence digest, outcome, IDs/hashes/stage evidence, intended write set and DML |
| Cold/warm normalized commands | all applicable stages | cold, wrapper-warm, seam-warm | normalized representation/fingerprint, evidence digest, outcome, returned evidence and write set |
| Assertion mismatch | all applicable stages | both cross-entrypoint orders | deterministic mismatch, differing mismatch fingerprint, recorded comparison, zero DML and no later leakage |

All applicable stages include `PENDING`, `ACCOUNTED`, `CIRCUIT_APPLIED`, and
`COMPLETE` unless one command field is formally invalid for a named stage and the
exclusion is explicit and justified.

The implementation audit must pair these behavioral tests with static inspection.
It must prohibit module-level mutable `lastResult`, cached entrypoint discriminators,
global mutable command classification, singleton repository state that affects
result mapping, and test-only state on which production code could depend. A
process-local cache is allowed only when it cannot affect classification or public
outcome, is observationally irrelevant, and passes identical cold/warm-state tests.

P2-01 implementation verification is not satisfied unless both alternating
sequences pass independently for all four stages; normalized-equivalent commands
have equal normalized fingerprints and canonical evidence/read digests; outcomes,
returned evidence, and intended/actual write sets are equal; cold, wrapper-warm,
seam-warm, A-first/B-first, and both cross-entrypoint orders pass; and assertion
mismatch remains a distinct deterministic read-only result. An outcome-only test may
not satisfy normalized equivalence.

Lost-response coverage is entrypoint-specific. Before `COMPLETE`, an exact existing-
wrapper retry returns its current replay envelope, with stage proved by the existing
pair read, and zero DML/no recovery, while a PR9b seam retry returns
`CONFLICT_RECOVERY_REQUIRED` and stage with zero DML/no recovery. After `COMPLETE`,
the wrapper retains its stable replay envelope and the seam returns
`EXACT_CONFLICT_REPLAY`; both are read-only. A synchronous new-evidence winner may
return final `DENIAL_PERSISTED` only after proven `COMPLETE`.

Minimum commands include:

```text
git diff --check
changed-file allowlist check
production call-graph and prohibited-DML scan
focused PR9b suites twice
PR9a compatibility suites
npm test
npm test
node --test tests/*.test.js
npm run build
foreign_keys = 1
foreign_key_check = 0 rows
integrity_check = ok
```

Passing these checks does not authorize merge, deployment, activation, or production
writes.

## 6. Separate gate before implementation

PR9b implementation may begin only after all of the following are durable and bound
to an exact repository head:

1. the independent design-audit verdict for the exact remediated PR9b design head is
   accepted and explicitly disposes D-PR9B-01 through D-PR9B-04;
2. there are no unresolved design P0 findings;
3. there are no unresolved design P1 findings;
4. there are no unresolved design P2 findings;
5. the exact PR9a implementation base, exact reviewed PR9b design HEAD, and exact
   reviewed design tree are confirmed;
6. the exact selected implementation allowlist subset and one responsibility per
   file are approved;
7. every required design/authorization CI check is green on the exact design HEAD;
8. the Product/Business Owner and responsible Architect durably approve the exact
   reviewed design HEAD and tree, including the merged-schema source mapping, schema
   trust boundary, and exact implementation allowlist;
9. PR9a remains independently released and the exact implementation base contains
   its merge tree without unreviewed semantic drift;
10. the Gate C prerequisites required by the approved PRE-PR9 governance for a
   production-capable posting implementation are closed by their real role-scoped
   authorities; fixtures or Codex cannot satisfy them;
11. a new direct Owner instruction names the exact PR9b base, selected file subset,
   Algorithm B scope, risks, and exclusions and authorizes only
   `pr9bImplementationAuthorized = TRUE`;
12. one narrow authorization record/commit changes only that field or supplies an
   equivalently immutable exact-head binding, while every deployment/production
   field remains false.

P3 findings may remain only when each is explicitly documented as non-blocking and
durably accepted by the Owner/Architect. No unresolved P0, P1, or P2 finding may be
waived by conditional wording.

If the independent review requires a schema change, section 6 cannot close. A
separate schema design and authorization PR must complete first.

### 6.1 Proposed D-PR9B dispositions for independent re-audit

- **D-PR9B-01 — APPROVE WITH CONDITIONS:** one initial-post business
  responsibility, implemented as durable-result resolution, new admission/primary
  transaction only from `NO_RESULT`, and post-rollback delegation to the sole C
  transaction owner through only the new bounded seam. Conditions are the
  entrypoint-specific replay contract, unchanged existing-wrapper compatibility,
  seam-specific C7, cross-entrypoint tests, and no Algorithm C semantic change. B's
  denial is non-durable; the service returns the exact seam C1-C8 outcome and never
  calls the generic wrapper for classification or supplies/nests the C transaction.
- **D-PR9B-02 — APPROVE:** `rental_service_upd` /
  `rootSourceDocumentLineageId` / `economicLineageKey` explicitly supersedes the
  PRE-PR9 mapping; correction/revision fixtures must prove identity semantics.
- **D-PR9B-03 — APPROVE WITH CONDITIONS:** PR9a schema v1 is sufficient only under
  the repository-exclusive DML controls and future proof enumerated in section 5;
  arbitrary database-owner raw SQL remains outside the threat model.
- **D-PR9B-04 — APPROVE:** all runtime activation and consumers remain PR9c+.

These are remediation proposals, not self-issued review or Owner/Architect approval.

### 6.2 Separate implementation-audit gate

Design approval does not waive later implementation findings. Before the exact
future implementation HEAD can be approved, its independent implementation audit
must find no unresolved implementation P0, P1, or P2 findings. This is a separate
condition from design review and must be bound to the exact implementation HEAD,
tree, approved file subset, and required green CI evidence. An implementation P3 may
remain only when explicitly documented as non-blocking and durably accepted by the
Owner/Architect.

## 7. Separate gate before runtime activation

Even an independently reviewed and merged PR9b must remain unreachable. Runtime
activation requires a later PR9c/Gate D package that separately proves and
authorizes:

- exact PR9b implementation head/artifact and independent audit closure;
- disabled deployment authority and verified deployed artifact/database identity;
- production identity/source/PR8 evidence and exact zero-delta reconciliation;
- current source, producer, and posting adapter authority chains;
- effective matching write-authorization and activation records;
- exact company/branch/cohort/boundary/window and approved policy hashes;
- operational limits, monitoring, storage/WAL capacity, backup/restore drill,
  incident/kill-switch, retention/legal hold, and rollback controls;
- role-scoped Accounting/Finance, Tax/VAT, Legal/Privacy, Security/Operations,
  adapter-owner, Product, and independent evidence-review approvals;
- a single-use release authorization for the exact production action;
- `productionCanonicalWritesAuthorized = TRUE` only for that action/window.

Runtime activation does not authorize canonical reads, settlement, shadow reads,
cutover, backfill, or dual write. Each remains a separate later gate.

## 8. Authorization matrix

| Field or stage | Before design PR | What a merged design PR may establish | State after design PR merge unless a separate later gate acts |
|---|---|---|---|
| PR9b design proposal | rejected head requires remediation | exact remediated design is reviewable | `INDEPENDENT RE-AUDIT REQUIRED` only |
| `pr9bDesignReviewed` | `FALSE` | remediation cannot self-review | `FALSE` until a passing independent re-audit and durable Owner/Architect acceptance |
| `architectureDesignApproved` | `TRUE` for existing Gate A | no change | `TRUE` for the prior Gate A scope; this PR does not self-approve its delta |
| `pr9aImplementationAuthorized` | `TRUE` | no change | `TRUE` |
| PR9a merge/release | merged/independently verified per supplied baseline | no change | merged; no production activation implied |
| D-PR9B-01 through D-PR9B-04 | not separately approved | independent review may recommend disposition | not approved until durable Owner/Architect decision |
| `pr9bImplementationAuthorized` | `FALSE` | design PR cannot change it | `FALSE` |
| `pr9ImplementationAuthorized` | `FALSE` | no change | `FALSE` |
| `pr9DisabledDeploymentAuthorized` | `FALSE` | no change | `FALSE` |
| `productionEvidenceAccepted` | `FALSE` | docs do not create evidence | `FALSE` |
| adapter authorities / operational / retention controls | unapproved | docs do not provision or approve them | unapproved |
| `productionActivationAuthorized` | `FALSE` | no change | `FALSE` |
| `canonicalProductionReadsAuthorized` | `FALSE` | no change | `FALSE` |
| `productionCanonicalWritesAuthorized` | `FALSE` | no change | `FALSE` |
| `settlementAuthorized` | `FALSE` | no change | `FALSE` |
| `shadowReadAuthorized` | `FALSE` | no change | `FALSE` |
| `cutoverAuthorized` | `FALSE` | no change | `FALSE` |

No field becomes true by implication from a design review, merge, commit, CI, draft
PR, username, prompt, or silence.

The fail-closed recommendation for this remediation head is:

```text
pr9bDesignReviewed = FALSE
pr9bImplementationAuthorized = FALSE
runtimeAuthorized = FALSE
deploymentAuthorized = FALSE
productionReadsAuthorized = FALSE
productionWritesAuthorized = FALSE
```

## 9. Independent reviewer checklist

The reviewer must independently:

1. verify the PR9a merge/source tree equality and documentation chronology;
2. inspect all seven PR9a tables, posting indexes/FKs/triggers, domain contracts,
   Algorithm A/C transaction and recovery boundaries, and focused tests;
3. reproduce the source-field mapping contradiction and approve the proposed merged
   mapping or require a separate schema/design change;
4. decide whether the repository-exclusive raw-DML trust boundary is acceptable;
5. confirm the one Algorithm B responsibility, its result-resolution/admission/
   denial-delegation phases, and the PR9a/PR9b/PR9c split;
6. validate authoritative input, durable output, ordered mutually exclusive state
   predicates, transaction order, post-insert reread, uncertain-commit resolution,
   current-status qualifier, and B-rollback/C-owned-transaction separation;
7. prove idempotency serialization/key/uniqueness and double-post prevention;
8. challenge determinism/error precedence with combined hostile states, injected
   clock/generator outcomes, and independent SQLite lock/commit outcomes;
9. validate the evidence graph without relying on runtime logs;
10. confirm no schema change is needed or block PR9b pending a schema-v2 design;
11. confirm the future allowlist and prohibited scope are closed and sufficient,
    including the single narrow Algorithm C seam/private-primitive exception and
    event-correlation binding;
12. reproduce seam C1-C8, both entrypoint stage/outcome matrices, exact DML counts,
    impossible-state precedence, absence of nested `BEGIN`/unlock gap/private
    exports, existing-wrapper replay precedence/result preservation, deterministic
    case-8A/8A-compatibility/8B barriers, bidirectional fresh fixtures, both
    alternating sequences independently at all four stages, simultaneous readers,
    hostile assertion/command cases, entrypoint-specific lost-response timelines,
    and every section-17.1 race outcome;
13. inspect for prohibited process-local mapper/classification state and prove cold,
    warm, reverse-order, and concurrent results are equivalent per entrypoint;
14. answer **YES**: were both alternating sequences executed independently for
    `PENDING`, `ACCOUNTED`, `CIRCUIT_APPLIED`, and `COMPLETE`?;
15. answer **YES**: did semantically equivalent transport commands produce the same
    normalized command representation and normalized fingerprint?;
16. answer **YES**: did those commands produce the same canonical evidence/read
    digest?;
17. answer **YES**: were outcomes, returned evidence, and intended/actual write sets
    equal in both entrypoint orders, A-first/B-first order, and cold, wrapper-warm,
    and seam-warm states?;
18. confirm there are no unresolved design P0, P1, or P2 findings and every
    authorization field remains fail-closed.

Any **NO** to reviewer questions 14-17 requires:

```text
pr9bDesignReviewed = FALSE
pr9bImplementationAuthorized = FALSE
```

The only acceptable approving independent design-review output is:

```text
PR9B DESIGN APPROVED FOR OWNER/ARCHITECT AUTHORIZATION
```

The blocking output is:

```text
PR9B DESIGN BLOCKED
```

with exact findings and required design changes. Any unresolved P0, P1, or P2
finding mandates:

```text
pr9bDesignReviewed = FALSE
pr9bImplementationAuthorized = FALSE
```

Reviewers must not use “approved except for P2,” “conditionally ready with unresolved
P2,” or “implementation may proceed while P2 remains.” A P3 may remain only when it
is explicitly documented as non-blocking and accepted by the Owner/Architect.
Neither design verdict authorizes implementation by itself, and a later design
approval cannot waive an unresolved implementation P0, P1, or P2 finding.

## 10. Draft design PR scope statement

The design PR description must state:

- base: exact PR9a merge commit;
- diff: two design documents plus the one structural test-process correction;
- additions: this authorization package and the PR9b design; test change only pins
  historical PR9a scope and enforces the exact PR9b remediation scope;
- exclusions: all production code, other tests, schema, migrations, runtime,
  deployment, Railway,
  production access, activation, reads/writes, settlement, shadow read, and cutover;
- unresolved decisions: D-PR9B-01 through D-PR9B-04 only;
- result:
  `PR9B DESIGN REMEDIATION COMPLETE — INDEPENDENT RE-AUDIT REQUIRED`;
- next gate: independent re-audit, Owner/Architect design approval, applicable Gate C
  closure, and a separate exact-head implementation authorization.

The author of the design may open a draft PR but may not merge it or represent their
own review as independent approval.
