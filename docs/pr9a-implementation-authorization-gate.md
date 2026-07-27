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
pr9aImplementationAuthorized = FALSE
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

## 10. Durable Gate B Owner approval contract

The normative Gate B contract requires a new, separate Product/Business Owner
authorization naming the exact PR9a scope and base SHA. The Gate A single-owner
exception authorizes only `architectureDesignApproved`; it is not inherited by Gate
B and is not Gate B evidence. The normative document does not name a separate human
Technical Architecture Reviewer as a Gate B prerequisite, but the fresh durable
Owner decision below is mandatory and automated review cannot replace it.

Valid Gate B evidence must be an authenticated permanent GitHub comment on the Gate
B PR and must contain all of the following:

- repository `rishatkznAI/rental-management` and the actual Gate B PR number;
- the exact final Gate B document head, unchanged after the comment;
- architecture baseline
  `fefb5c482bcb63dedbb81ec9eb12da49d57a358a` and this document path;
- Owner identity, Product / Business Owner role, actual UTC timestamp and the
  permanent permalink to that same comment;
- explicit review and acceptance of the exact PR9a scope, allow-list, acceptance
  criteria, stopping conditions and disabled-implementation risks;
- explicit authorization of only `pr9aImplementationAuthorized = TRUE`;
- explicit denials for PR9b, aggregate PR9, deployment, Railway, production
  migrations/reads/writes/activation, settlement, shadow-read and cutover.

Procedure:

1. Complete review of this docs-only Gate B PR while
   `pr9aImplementationAuthorized` remains `FALSE`.
2. Freeze its final head and replace every template placeholder with actual values
   in the Owner's GitHub comment; do not edit this document merely to fill the
   template.
3. The authenticated Owner posts the comment, obtains its permanent permalink and
   immediately edits that same comment to replace the permalink placeholder. The
   comment is not valid evidence until the actual permalink and every other field
   are present. This comment-only edit does not change the approved Git head. If the
   platform cannot retain that self-reference, an authenticated immediately linked
   follow-up comment must record the permalink and exact same head; both comments
   form one evidence record.
4. Independently verify Owner identity/association, role statement, UTC timestamp,
   exact head, base binding, full scope/risk acceptance and every explicit denial.
5. Any content commit after approval invalidates it and requires a new comment on the
   new exact head. Approval does not merge the PR automatically.
6. Only after the evidence procedure is complete may a separately authorized action
   merge this docs-only Gate B PR. PR9a implementation must occur later in a separate
   implementation branch/PR created from a verified compatible `main`; this package
   itself creates no implementation branch.

Until all evidence is complete, `pr9aImplementationAuthorized = FALSE`.

## 11. Owner approval template

The following block is an **UNEXECUTED TEMPLATE — NOT APPROVAL EVIDENCE**. Every
angle-bracket field is an intentional template placeholder. The block has no effect
until the authenticated Owner posts it with actual values on the exact Gate B PR
head and the complete evidence contract in section 10 is verified.

```text
PRODUCT / BUSINESS OWNER PR9A IMPLEMENTATION AUTHORIZATION

Repository: rishatkznAI/rental-management
PR: <GATE B PR NUMBER>
Authorized head: <EXACT GATE B HEAD>
Architecture baseline: <APPROVED MAIN SHA>
Document: <GATE B DOCUMENT PATH>

Approver identity: Ришат Хабибрахманов
Approver role: Product / Business Owner
Approval timestamp UTC: <ACTUAL UTC TIMESTAMP>
Permanent GitHub reference: <PERMALINK TO THIS COMMENT>

I authorize implementation of PR9a only, within the exact scope and constraints defined by this Gate B document and the approved pre-PR9 architecture baseline.

I have reviewed and accept the exact PR9a scope, changed-file allow-list, acceptance criteria, stopping conditions and disabled-implementation risks defined by this Gate B document.

This approval authorizes only:

pr9aImplementationAuthorized = TRUE

This approval does not authorize:

pr9bImplementationAuthorized = TRUE
pr9ImplementationAuthorized = TRUE
foundationDeploymentRetryAuthorized = TRUE
pr9DisabledDeploymentAuthorized = TRUE
productionActivationAuthorized = TRUE
canonicalProductionReadsAuthorized = TRUE
productionCanonicalWritesAuthorized = TRUE
settlementAuthorized = TRUE
shadowReadAuthorized = TRUE
cutoverAuthorized = TRUE

This approval does not authorize deployment, Railway access or changes, production migrations, production reads, production writes, activation, settlement, shadow-read or cutover.

Approved by: Ришат Хабибрахманов
```

## 12. Gate B package completion checklist

Before this package can be presented for the Owner decision, its PR must prove:

- the base is the expected architecture baseline or a reviewed safe descendant;
- the only changed file is this subordinate Markdown document;
- executable, SQL, schema, migration and runtime diffs are empty;
- the baseline commit, normative document blob and Gate A evidence binding resolve;
- PR9a and PR9b scope remain separated and all production/deployment prohibitions
  are internally consistent;
- every authorization value remains unchanged;
- placeholders exist only inside the explicitly marked unexecuted template;
- repository and added-line secret scans are clean;
- `git diff --check`, two independent `npm test` runs and `npm run build` pass;
- the committed/pushed worktree and index are clean.

Passing this checklist prepares evidence for an Owner decision. It does not make the
decision and does not authorize PR9a implementation.
