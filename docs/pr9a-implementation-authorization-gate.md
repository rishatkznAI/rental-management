# Gate B Authorization Package: PR9a Disabled Implementation

## 1. Status and authority boundary

**Document status:** `GATE B PACKAGE PREPARED — PR9A IMPLEMENTATION NOT AUTHORIZED`

**Repository:** `rishatkznAI/rental-management`

**Preparation base / merged architecture baseline:**
`fefb5c482bcb63dedbb81ec9eb12da49d57a358a`

**Merged architecture PR:** `#231`

**Normative architecture document:**
`docs/canonical-actual-posting-pre-pr9-design-closure.md`

**Normative document blob at the preparation base:**
`10c08058c0ef2316d5a417779fd4af4be50a5c2a`

**Gate A approved design head recorded by that document:**
`b8a420f896e4363d014e5f6e2a0f1e6eae0cbe66`

**Durable Gate A Owner evidence:**
`https://github.com/rishatkznAI/rental-management/pull/231#issuecomment-5087757763`

This file is a subordinate decision package for a future Gate B Owner decision. It
does not amend, reinterpret or compete with the normative architecture document.
The normative document controls on any conflict. Its sections 5.1, 14, 21–26 and 28
are incorporated by reference; a contradiction or missing security-critical
semantic is a stopping condition, not discretion for an implementer.

This preparation does not grant Gate B. Merge, CI, review, silence, this template or
the existence of this file grants no implementation authority. The current state is:

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

Every other field in the normative section-26 authorization matrix remains
`FALSE`. Only a later valid Owner authorization, meeting section 10 below and bound
to the exact final head of this document, may set
`pr9aImplementationAuthorized = TRUE`. It may change no other authorization value.

## 2. Gate B decision boundary

The only decision this package prepares is whether to authorize a future PR9a as
the disabled **authority, schema and eligibility-event foundation** defined by the
normative sections 5.1 and 21. PR9a is limited to:

1. the additive `canonical_actual_posting_pr9` version-1 schema;
2. immutable validation, serialization, hashing and envelope contracts;
3. repository-owned authority and authorization foundation code;
4. repository-owned `ActualReceivableEligibleV1` production and replay under
   Algorithm A, including only the denial-evidence and recovery behavior that the
   normative Algorithm A requires;
5. disabled repository/domain/service code, tests, fixtures and audit documents.

PR9a implements no canonical DML. It never performs Algorithm B canonical posting.
No production business execution, concrete production adapter, route, worker,
scheduler, flag, resolver or activation path is included. Production-reachable code
is limited to the additive schema initializer in `server/db.js`, and inclusion of
that initializer in the future implementation is expressly within this proposed
Gate B scope. This authorizes writing and locally testing initializer code only; it
does not authorize deploying it or executing the migration in production.

## 3. Exact future changed-file allow-list

The future PR9a implementation may add or modify only the following production
files from normative section 21:

```text
server/db.js
server/lib/canonical-actual-posting-schema.js
server/lib/canonical-actual-posting-domain.js
server/lib/canonical-actual-posting-authority-repository.js
server/lib/canonical-actual-eligibility-event-repository.js
server/lib/canonical-actual-eligibility-event-service.js
```

It may add or modify only these tests, helpers and documents:

```text
tests/canonical-actual-posting-fixtures.js
tests/canonical-actual-posting-schema.test.js
tests/canonical-actual-posting-domain.test.js
tests/canonical-actual-posting-authority.test.js
tests/canonical-actual-eligibility-event.test.js
tests/canonical-actual-posting-structural.test.js
tests/canonical-actual-posting-safety.test.js
tests/helpers/canonical-actual-eligibility-concurrency-worker.mjs
docs/canonical-actual-posting-pr9a-audit.md
docs/canonical-receivables-contract.md
docs/canonical-receivables-decisions.md
```

This is a closed allow-list, not a requirement to touch every listed file. Before
implementation begins, the implementer must publish an exact proposed subset with
one responsibility per file and compare it to this list. Generated files,
dependency manifests, lockfiles, CI files and configuration are not implicitly
allowed. A need for any other file, filename, broad mask or moved/renamed module is
a hard stop requiring a separate Gate B scope amendment and new Owner authorization
on its exact head.

The following PR9b files are specifically outside PR9a even though they have related
names:

```text
server/lib/canonical-actual-posting-repository.js
server/lib/canonical-actual-posting-service.js
tests/canonical-actual-posting-repository.test.js
tests/canonical-actual-posting-concurrency.test.js
tests/canonical-actual-posting-remediation.test.js
docs/canonical-actual-posting-pr9b-audit.md
```

The shared domain, fixture, safety and decision-document files may contain only the
PR9a contracts needed by the exact normative split. Their presence on the PR9a
allow-list does not permit Algorithm B, canonical posting or other PR9b behavior.

## 4. Permitted module responsibilities and disabled integration

The future change must keep these boundaries:

| Module | Permitted PR9a responsibility |
|---|---|
| `server/db.js` | Register and invoke only the additive PR9 v1 schema initializer immediately after the PR8 initializer; no service, adapter, route, worker, flag or resolver wiring. |
| `canonical-actual-posting-schema.js` | Exact migration, structural validation, registered-rerun validation and fail-closed drift detection from normative section 14. |
| `canonical-actual-posting-domain.js` | Inert exact v1 validation, canonical JSON, hashes, envelopes, deterministic identities and errors required by PR9a. No I/O or caller-owned authority. |
| `canonical-actual-posting-authority-repository.js` | Repository-owned append/read/lock/reconstruction of the authority, write-authorization and activation contracts required to validate PR9a in isolated tests. No concrete production authority or live adapter. |
| `canonical-actual-eligibility-event-repository.js` | Repository-owned `BEGIN IMMEDIATE`, Algorithm A, replay/integrity proof, rollback and only the normative denial-evidence/recovery behavior reached from Algorithm A. Zero canonical, audit, settlement, legacy or `app_data` writes. |
| `canonical-actual-eligibility-event-service.js` | Inert validation and delegation to the disabled repository only. It must not be imported or wired by `server/server.js`, routes, jobs or production consumers. |

No adapter file is permitted. Source-adapter, eligibility-producer and posting-
adapter identities in PR9a are immutable contract and fixture data only. PR9a may
define repository interfaces inside the listed domain/repository modules, but may
not add a network, Railway, credential, environment, production database or other
live adapter implementation.

No new feature flag is allowed or required. Disabled-by-default is structural:

- no route, worker, scheduler, consumer, UI, CLI or service registration reaches
  PR9a domain behavior;
- `server/server.js`, existing read resolvers and frontend files remain unchanged;
- no environment variable, default, missing-value behavior or caller option can
  enable PR9a;
- existing production canonical-read and canonical-write gates remain false;
- only the schema initializer may be reachable from normal database startup, and
  no deployment or production migration execution is authorized.

## 5. Exact database and migration scope

PR9a may implement exactly migration ID `canonical_actual_posting_pr9`, version `1`,
as specified by normative section 14. It is additive, has no down migration, and
must preserve the PR1–PR8 migration source. Its exact seven-table inventory is:

```text
governed_adapter_authority_records
canonical_write_authorization_records
canonical_posting_activation_records
actual_receivable_eligible_events
canonical_receivable_posting_operations
canonical_receivable_posting_conflicts
canonical_receivable_posting_conflict_transitions
```

The exact columns, checks, ordered composite foreign keys, unique/non-unique indexes,
table-local triggers, cross-object triggers, reciprocal deferred conflict/transition
foreign keys and semantic trigger SQL are solely those in normative section 14.
Adding an eighth table, changing an existing PR1–PR8 object, weakening a constraint,
renaming an object or substituting a JSON reference for a relational foreign key is
forbidden.

The initializer must:

- require the exact valid PR1, PR2 and PR5–PR8 prerequisites, `foreign_keys = 1`,
  clean `foreign_key_check`, exact catalog v1/11 and no partial PR9 objects;
- enforce the first-application zero-row preconditions from section 14;
- make first application atomic and fail closed on any prerequisite or DDL error;
- make a registered rerun read-only, preserve its timestamp, produce no WAL and
  validate the exact structure and semantic trigger SQL without repair;
- reject unregistered/partial/drifted objects without normalization or repair.

Migration code may be created and exercised only in isolated local/test databases.
This package authorizes no production migration execution, production data access,
backfill, reconciliation, repair or down migration.

## 6. Fail-closed, transaction and rollback requirements

Future PR9a must implement the normative contract literally. It must not:

- introduce fallback sources, permissive aliases, best-effort validation or silent
  repair;
- accept caller-owned authority, caller time, caller IDs/hashes/JSON, caller
  transaction ownership or mutable latest authority as historical classification;
- classify replay from an identity/index hit without the complete persisted-row and
  parent integrity proof;
- weaken exact canonical serialization/hash/envelope, source-lineage, precedence,
  scope, authority-chain, accepted-evidence or transaction semantics;
- bypass rollback-before-denial-evidence behavior or resume an invocation after the
  recovery-required guard;
- write canonical receivables, posting operations as business effects, financial
  audit events, settlement, legacy collections or `app_data` through Algorithm A;
- introduce production behavior, hidden activation or authorization changes through
  code, feature flags, environment variables, defaults or test-only switches.

Algorithm A and its applicable denial path must use repository-owned transactions
and locks exactly as normative section 23 specifies. Any failed validation, insert,
trigger, reread, reconstruction or integrity proof rolls the active transaction back
to zero unauthorized primary effects. Exact replay is read-only and byte-preserving.
Concurrent creation for one economic lineage/revision/candidate commits at most one
eligible event. Crash/retry and transition recovery must be deterministic,
idempotent and fail closed.

Application rollback is removal/reversion of unreachable PR9a runtime code before
any later deployment authorization. There is no schema down migration. Because this
Gate B scope authorizes no deployment or production migration, it creates no
production rollback action. Any future deployment requires its own gate and rollback
plan.

## 7. Future PR9a acceptance criteria and test matrix

A future PR9a is acceptable for technical review only when all of the following are
proven. Passing them does not authorize merge, deployment or production use.

1. Its changed files are an exact subset of section 3 and match the published
   pre-implementation proposal.
2. Schema tests cover fresh creation, exact prerequisites, every table/column/check,
   ordered composite FK, index and trigger, transactional failure, partial/drifted
   rejection, registered rerun, no repair, no timestamp mutation, no WAL, clean
   foreign-key/integrity checks and no down migration.
3. Contract tests publish and verify independent, byte-exact canonical JSON and
   SHA-256 fixtures for every PR9a envelope, including Unicode/JCS, ordering, limits,
   invalid types, omitted/extra fields and one-field mutations.
4. Authority tests cover exact scope/kind/operation, contiguous version chains,
   lifecycle/time windows, latest-chain reconstruction, precedence, ownership and
   one-field ID/version/hash/company/branch/kind mutations.
5. Algorithm A tests cover the entire accepted PR8/PR6/policy/timezone/authority/
   authorization/activation predicate, exact event creation, deterministic identity,
   exact replay, source correction classifications and zero PR7/forecast use.
6. Negative and corruption tests prove malformed, missing, duplicated, cross-scope,
   cross-tenant, stale, drifted, ambiguous and hash-valid-but-content-invalid state
   fails closed with zero unauthorized effects.
7. Crash/retry tests cover every transaction boundary and required denial-transition
   stage; retry and the separate reconciler are idempotent and never resume a blocked
   invocation.
8. Concurrency tests use the allowed worker to prove serialization, exactly one
   event per identity, deterministic conflict/replay classification, no duplicate
   current revision and no partial commit.
9. Transaction rollback and fault-injection tests prove all-or-nothing schema/event/
   evidence behavior and zero canonical, audit, settlement, legacy and `app_data`
   primary effects.
10. Authorization and structural safety tests prove no route/worker/scheduler/server
    wiring, no live adapter, no flag/resolver, no environment/default gate, no PR9b
    files or Algorithm B, and no authorization-value escalation.
11. Static and runtime-disabled checks prove zero production access, zero Railway
    access, zero deployment and no secrets/credentials.
12. The implementation audit maps every changed line and test to the normative
    section and records any deliberately untouched allow-listed file.

The future implementation must run and record at least:

```text
git diff --check
changed-file allow-list check
executable-code diff review
migration diff review
authorization-value guard
placeholder scan
repository secret scan
added-line secret scan
npm test
npm test
node --test tests/*.test.js
npm run build
foreign_keys = 1
foreign_key_check = 0 rows
integrity_check = ok
clean worktree and index after commit and push
```

Focused PR9a suites must also run twice, followed by PR1–PR8 compatibility suites.
The two full `npm test` runs are separate executions; a retry replacing a failed run
does not satisfy the criterion.

## 8. Explicit prohibited scope

Gate B and future PR9a do not authorize or include:

- PR9b, Algorithm B, a combined PR9 implementation or any canonical business DML;
- implementation files outside section 3, including routes, `server/server.js`,
  frontend, package/dependency, CI, configuration or deployment files;
- production activation, canonical production reads or writes, settlement,
  shadow-read, cutover, backfill, dual-write, correction or consumer switching;
- Railway access/change, deployment, restart, production migration execution,
  production database/data access, production read/write, reconciliation or repair;
- a concrete/live adapter, credential, authority, authorization or activation
  record, or recognition of a production financial fact;
- changing any authorization value except a later valid Gate B Owner evidence record
  that changes only `pr9aImplementationAuthorized` from `FALSE` to `TRUE`;
- treating merge, CI, review, a username, template, prompt or silence as approval.

Schema and migration implementation is allowed only within section 5; production
execution is not. Runtime behavior remains structurally unreachable and disabled.

## 9. Mandatory implementation stopping conditions

The future implementer must stop without widening scope if:

- the normative design contract is contradictory, incomplete or ambiguous;
- any required file is outside the exact allow-list or the proposed subset changes;
- PR9b, canonical DML or a new authorization value is required;
- production/Railway access, deployment or production migration is required;
- architecture, transaction, replay, integrity, accounting, authority, recovery,
  concurrency or audit semantics must change;
- a security-critical test cannot be written without choosing semantics that the
  normative baseline does not specify;
- the implementation needs a live adapter, route, worker, scheduler, flag, resolver,
  credential, secret, dependency or configuration change;
- actual `main` no longer contains the exact architecture baseline or has an
  incompatible PR9-related change;
- any required guard, focused suite, full test run or build fails.

Resolution requires a separate architecture remediation or Gate B scope amendment,
review and new Owner authorization bound to its exact head. The implementer may not
choose a permissive interpretation.

## 10. Durable Gate B single-owner authorization contract

The normative Gate B contract requires a new, separate Product/Business Owner
authorization naming the exact PR9a scope and base SHA. For this single-owner
project, the Owner is established by this repository mapping:

```text
Repository owner account: rishatkznAI
Product / Business Owner: Ришат Хабибрахманов
```

The Gate A single-owner exception remains limited to
`architectureDesignApproved`; it is not itself Gate B authorization. Gate B instead
uses the explicit Owner instruction and authorization-commit evidence model below.
An automated system may execute and record that instruction, but it must never claim
that it independently made the business decision.

### 10.1 Authorization prerequisites

PR9a implementation may be authorized only when all of the following are true:

- `architectureDesignApproved = TRUE`;
- PR #232 contains the completed Gate B package and has no unresolved P0 or P1 Gate
  B findings;
- the Product / Business Owner gives a direct, explicit instruction in the Codex
  session to authorize PR9a and names the exact current Gate B package head;
- that instruction accepts the exact PR9a scope and disabled-implementation risks,
  authorizes only `pr9aImplementationAuthorized = TRUE`, and preserves every denial
  in sections 8 and 10.4;
- the local branch head, remote branch head and PR #232 head all equal the head named
  by the Owner immediately before the authorization commit;
- one authorization commit has that exact Gate B package head as its parent and its
  entire repository diff is only the single literal change
  `pr9aImplementationAuthorized = FALSE` to
  `pr9aImplementationAuthorized = TRUE` in this document;
- every other authorization field and every technical byte remain unchanged;
- the authorization commit is pushed to the existing repository-owner branch for
  PR #232 and all required checks complete successfully.

The exact Gate B package head named by the Owner is therefore the parent of the
authorization commit. The authorization commit's author, authored/committed
timestamps, SHA, parent SHA and exact one-line diff are supplied by Git metadata;
they are not copied manually into a separate approval record.

### 10.2 Durable evidence model

Together, the following form the durable Gate B authorization evidence:

1. the direct explicit Product / Business Owner instruction in the Codex task
   history, naming the exact pre-authorization Gate B package head;
2. the immutable parent binding from that head to the one-purpose authorization
   commit;
3. the authorization commit metadata: author, authored/committed timestamps, commit
   SHA, parent SHA and exact diff;
4. the GitHub branch and PR #232 history showing that commit and its successful
   checks;
5. verification that the repository is owner-operated by `rishatkznAI`, mapped
   above to Product / Business Owner Ришат Хабибрахманов.

A GitHub Owner approval comment may be added as optional supporting evidence, but it
is not a blocking condition and cannot substitute for the exact-head instruction or
one-purpose authorization commit. No approval-comment permalink, manually entered
UTC timestamp, self-referencing comment URL, or repeated Owner identity/role block
is required.

### 10.3 Final authorization procedure

1. Complete the docs-only Gate B package and technical/governance review while
   `pr9aImplementationAuthorized = FALSE`; resolve every P0/P1 finding.
2. Freeze and report the exact PR #232 Gate B package head, its architecture baseline
   and current authorization matrix to the Owner.
3. The Owner gives a direct explicit Codex-session instruction naming that exact
   head and authorizing only PR9a within this package. A template is not required.
4. The executing system states that it is carrying out the Owner's decision rather
   than making one, refetches local/remote/PR state, and stops on any head mismatch.
5. Create exactly one authorization commit whose parent is the named head and whose
   entire diff is the one literal `FALSE` to `TRUE` change for
   `pr9aImplementationAuthorized`. Do not amend scope, evidence text or any other
   authorization value in that commit.
6. Push only that commit to the existing PR #232 branch and require successful
   checks. Verify its author, timestamps, SHA, parent, exact diff and unchanged denial
   fields from Git and GitHub.
7. Only after steps 1–6 pass is Gate B evidence complete. A separately requested
   action may then merge the docs-only Gate B PR. PR9a implementation must occur
   later in a separate implementation branch/PR created from a verified compatible
   `main`.

Any content change before the authorization commit creates a new candidate Gate B
package head and requires a new exact-head Owner instruction. Any extra diff in the
authorization commit, failed check, unresolved P0/P1, identity ambiguity or head
mismatch invalidates the procedure and requires a stop; it must not be repaired by
silently broadening the authorization commit.

Until the whole procedure is complete,
`pr9aImplementationAuthorized = FALSE`.

### 10.4 Scope of this governance simplification

This evidence simplification applies only to
`pr9aImplementationAuthorized`. It neither authorizes nor simplifies the separate
gates for:

```text
pr9bImplementationAuthorized
pr9ImplementationAuthorized
foundationDeploymentRetryAuthorized
pr9DisabledDeploymentAuthorized
productionActivationAuthorized
canonicalProductionReadsAuthorized
productionCanonicalWritesAuthorized
settlementAuthorized
shadowReadAuthorized
cutoverAuthorized
```

Deployment, Railway access/change and every production action still require their
own later explicit instructions and applicable gates.

## 11. Optional non-blocking Owner instruction template

The following block is an **OPTIONAL UNEXECUTED TEMPLATE — NOT AUTHORIZATION
EVIDENCE**. It is only drafting assistance. Stored in this document, it has no
effect. The Owner may instead use any direct Codex-session instruction that contains
the exact head and all section-10 requirements.

```text
PRODUCT / BUSINESS OWNER PR9A IMPLEMENTATION AUTHORIZATION INSTRUCTION

Repository: rishatkznAI/rental-management
PR: #232
Gate B package head: <EXACT PRE-AUTHORIZATION PR HEAD>
Architecture baseline: fefb5c482bcb63dedbb81ec9eb12da49d57a358a
Document: docs/pr9a-implementation-authorization-gate.md

I directly instruct Codex to create and push the Gate B authorization commit for PR9a at the exact Gate B package head stated above.

I have reviewed and accept the exact PR9a scope, changed-file allow-list, acceptance criteria, stopping conditions and disabled-implementation risks defined by this Gate B document.

The authorization commit must change only:

pr9aImplementationAuthorized = FALSE → TRUE

All other authorization fields and all technical content must remain unchanged.

This instruction does not authorize PR9b, aggregate PR9, deployment, Railway access or changes, production migrations, production reads, production writes, activation, settlement, shadow-read or cutover.
```

This optional template does not require a GitHub comment or any manually copied
timestamp, permalink, Owner identity or role block.

## 12. Gate B package completion and verification checklist

Before this package head can be named in an Owner authorization instruction, PR #232
must prove:

- the base is the expected architecture baseline or a reviewed safe descendant;
- the only changed file is this subordinate Markdown document;
- executable, SQL, schema, migration and runtime diffs are empty;
- the baseline commit, normative document blob and Gate A evidence binding resolve;
- technical sections 2–9 are byte-identical to pre-remediation PR head
  `81e8fcaf6580f7e6aac29f515a5f762aeac82255`, with SHA-256
  `a170f6f84c4b38bd53957aa7094272e004beab11d40be62d3649b33bf71fdbaa`;
- PR9a and PR9b scope remain separated and all production/deployment prohibitions
  are internally consistent;
- `architectureDesignApproved` remains `TRUE`,
  `pr9aImplementationAuthorized` remains `FALSE`, and every other authorization
  value remains unchanged during package preparation;
- no language makes a GitHub comment, comment permalink, manually entered UTC
  timestamp, self-referencing URL or repeated Owner identity/role block mandatory;
- placeholders exist only inside the explicitly marked optional unexecuted template;
- repository and added-line secret scans are clean;
- `git diff --check`, two independent `npm test` runs and `npm run build` pass;
- the committed/pushed worktree and index are clean.

Passing this checklist prepares the simplified evidence model for a later Owner
decision. It does not make that decision, create the authorization commit or
authorize PR9a implementation.
