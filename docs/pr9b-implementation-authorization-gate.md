# PR9b Design and Future Implementation Authorization Package

## 1. Status and authority boundary

**Package status:** `PR9B DESIGN: READY FOR INDEPENDENT REVIEW`

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

## 2. Effect of the design PR

The design PR may only:

- add the two PR9b design/authorization Markdown documents;
- record archaeology, contracts, proposed decisions, exact future scope, and gates;
- receive independent review and an Owner/Architect design decision.

It may not modify an approved historical document to make a new decision appear
previously approved. It may not create code, tests, SQL, migration, configuration,
runtime wiring, evidence rows, or production actions.

After a design PR merge, the only possible new fact is that a reviewed design exists.
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
```

Responsibilities are exact:

| File | Allowed responsibility |
|---|---|
| `canonical-actual-posting-domain.js` | Pure posting command, projection, canonical serialization/hash, fingerprint, idempotency, result, and stable-error contracts needed by Algorithm B; no I/O or runtime activation |
| `canonical-actual-posting-repository.js` | Repository-owned `BEGIN IMMEDIATE`, full fresh persisted-graph proof, Algorithm B primary triplet, exact replay, rollback, and delegation of a branded denial to the existing Algorithm C boundary |
| `canonical-actual-posting-service.js` | Inert exact command validation and delegation to the disabled repository only; no registration or caller authority |

No other production file is implicitly allowed. In particular, the implementation
may not modify PR9a schema, Algorithm A, Algorithm C, authority repository,
`server/db.js`, or `server/server.js`.

### 3.2 Tests, helper, fixtures, and implementation records

```text
tests/canonical-actual-posting-fixtures.js
tests/canonical-actual-posting-repository.test.js
tests/canonical-actual-posting-concurrency.test.js
tests/canonical-actual-posting-remediation.test.js
tests/canonical-actual-posting-safety.test.js
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
- changes to `canonical-actual-eligibility-event-repository.js`, its service, the
  PR9a authority repository, or Algorithm A/C behavior;
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
3. Algorithm B accepts only an existing event-rooted selector command and freshly
   proves the complete PR5/PR6/PR8/PR9 authority graph under one `BEGIN IMMEDIATE`;
4. the only primary DML is one canonical receivable, one posting operation, and one
   financial audit in a single transaction;
5. exact replay is read-only and current revocation/drift denies replay without
   changing historical rows;
6. changed payload under an intersecting identity cannot create a second effect;
7. every error/denial follows the normative precedence and has the exact durable
   write set;
8. every insert/trigger/reread/commit fault rolls the primary triplet back;
9. independent-process concurrency creates at most one effect;
10. uncertain commit is resolved only by a later full persisted replay proof;
11. Algorithm C denial/recovery remains separate and cannot write a primary effect;
12. every hostile scenario in the design matrix passes, including tampering,
    partial legacy state, post-insert mismatch, and unauthorized activation;
13. canonical-byte and SHA-256 fixtures are independently reproduced for every new
    posting envelope and mutation;
14. schema/FK/integrity and no-orphan/extra-row checks pass after every success and
    fault case;
15. two focused final-tree runs, two full test runs, explicit Node test run, build,
    static scope scans, and a clean exact-head review are recorded in the PR9b audit.

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

1. independent review of the PR9b design finds no unresolved P0/P1 and explicitly
   disposes D-PR9B-01 through D-PR9B-04;
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
| PR9b design proposal | absent as a post-PR9a package | exact design is reviewable | `READY FOR INDEPENDENT REVIEW` only |
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

## 9. Independent reviewer checklist

The reviewer must independently:

1. verify the PR9a merge/source tree equality and documentation chronology;
2. inspect all seven PR9a tables, posting indexes/FKs/triggers, domain contracts,
   Algorithm A/C transaction and recovery boundaries, and focused tests;
3. reproduce the source-field mapping contradiction and approve the proposed merged
   mapping or require a separate schema/design change;
4. decide whether the repository-exclusive raw-DML trust boundary is acceptable;
5. confirm the one Algorithm B responsibility and PR9a/PR9b/PR9c split;
6. validate authoritative input, durable output, state machine, transaction order,
   post-insert reread, commit ambiguity, and denial transaction separation;
7. prove idempotency serialization/key/uniqueness and double-post prevention;
8. challenge the error precedence with combined hostile states;
9. validate the evidence graph without relying on runtime logs;
10. confirm no schema change is needed or block PR9b pending a schema-v2 design;
11. confirm the future allowlist and prohibited scope are closed and sufficient;
12. confirm every authorization field remains fail-closed.

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
- diff: documentation only;
- additions: this authorization package and the PR9b design;
- exclusions: all code, tests, schema, migrations, runtime, deployment, Railway,
  production access, activation, reads/writes, settlement, shadow read, and cutover;
- unresolved decisions: D-PR9B-01 through D-PR9B-04 only;
- result: `PR9B DESIGN: READY FOR INDEPENDENT REVIEW`;
- next gate: independent review, Owner/Architect design approval, applicable Gate C
  closure, and a separate exact-head implementation authorization.

The author of the design may open a draft PR but may not merge it or represent their
own review as independent approval.
