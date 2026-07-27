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

The pre-commit verification result for this implementation is:

- targeted PR9a suites: 41 tests passed, 0 failed;
- first and second mandated final-tree `npm test` passes: 2,384 tests passed, 0 failed in each;
- final-tree explicit `node --test tests/*.test.js`: 2,384 tests passed, 0 failed;
- `npm run build`: passed, 3,385 modules transformed;
- schema inventory: 7 tables, 38 named indexes, 41 named triggers, clean foreign-key check;
- changed-file allow-list, PR9a/PR9b separation, Algorithm B absence, canonical business DML absence, route/worker/scheduler/external-access absence, authorization guard, placeholder, repository-secret, and added-line-secret scans: passed.

## Known boundary

PR9a stops after eligible-event production and required denial/recovery foundation.
Canonical business posting, Algorithm B, live authority and adapters, production
policy/source evidence, deployment and migration execution, production reads/writes,
activation, settlement, shadow reads, and cutover remain deferred to their separate
authorizations. No implementation result in this change changes those gates.
