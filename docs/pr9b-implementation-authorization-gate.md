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
    barriers, same-pair cross-entrypoint outcomes, private export/nested-transaction
    rejection, rollback between pair inserts, entrypoint-specific lost responses,
    and impossible primary-plus-conflict state;
21. deterministic tests fix entrypoint contract, command, locked snapshot, captured
    attemptedAt, and injected generator outcomes and separately exercise lock/commit
    outcomes;
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
26. two focused final-tree runs, two full test runs, explicit Node test run, build,
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

Three test groups are mandatory in the already allowlisted PR9b test files:

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
3. **Cross-entrypoint tests.** Against the same exact incomplete pair at each of the
   three incomplete stages, call the wrapper and seam under one deterministic
   barrier. The wrapper must return stage-preserving replay and the seam must return
   recovery-required. Both perform zero DML, invoke no recovery, and leave rows
   byte-identical before, between, and after calls. Repeat at `COMPLETE` to prove
   both replay while preserving their stable response envelopes. The asserted
   distinction must be the entrypoint contract, never timing or query order.

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

1. independent re-audit of the exact remediated PR9b design head finds no unresolved
   P0/P1 and explicitly disposes D-PR9B-01 through D-PR9B-04;
2. the Product/Business Owner and responsible Architect approve the exact reviewed
   design head, including the merged-schema source mapping and schema trust boundary;
3. PR9a remains independently released and the exact implementation base contains
   its merge tree without unreviewed semantic drift;
4. the Gate C prerequisites required by the approved PRE-PR9 governance for a
   production-capable posting implementation are closed by their real role-scoped
   authorities; fixtures or Codex cannot satisfy them;
5. a new direct Owner instruction names the exact PR9b base, selected file subset,
   Algorithm B scope, risks, and exclusions and authorizes only
   `pr9bImplementationAuthorized = TRUE`;
6. one narrow authorization record/commit changes only that field or supplies an
   equivalently immutable exact-head binding, while every deployment/production
   field remains false.

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
    case-8A/8A-compatibility/8B barriers, entrypoint-specific lost-response
    timelines, and every section-17.1 race outcome;
13. confirm every authorization field remains fail-closed.

The acceptable independent-review output is either:

```text
PR9B DESIGN REVIEW PASSED — READY FOR SEPARATE IMPLEMENTATION AUTHORIZATION
```

or:

```text
PR9B DESIGN BLOCKED
```

with exact findings and required design changes. Neither verdict authorizes
implementation by itself.

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
