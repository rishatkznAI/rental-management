# PRE-PR9 canonical-write authorization gate

## 1. Executive status

**Gate status:** `PRE-PR9 GATE: DESIGN RECORDED — AUTHORIZATION BLOCKED`

**PR9 implementation:** `NOT AUTHORIZED`

**Production canonical writes:** `NOT AUTHORIZED`

**Audit timestamp:** `2026-07-21T09:36:24Z`

**Read-only production evidence recovery:** `EVIDENCE_PR_READY_COMPLETE`; see
`docs/pre-pr9-production-evidence-pack.md`.

**Design-gate lineage:** PR #218 was squash-merged as
`7892ea68193fa5357733ca0d554dc84af82e6200` on `2026-07-21T13:21:33Z`.

**Evidence-pack lineage:** PR #219 reviewed head
`0ee1cbcfd87867eb212b35263d4201a09d1de920` was squash-merged unchanged as
`da9ade9d2921f2a7120118714ffd68863b8445ee` on
`2026-07-22T05:07:35Z`.

**Foundation readiness:** `FOUNDATION_DEPLOYMENT_BLOCKED`; see
`docs/pr5-pr8-foundation-deployment-readiness-gate.md`.

**Foundation readiness lineage:** PR #220 reviewed head
`4d2e141a696c30860646c40026afc35aeb0b5115` was squash-merged as
`94d9963e5cd18d75bde3414c3a7e05687a2c3ef3`; PR #221 reviewed head
`11f824ccdda63213cc71808bfc42b48b9e51996b` was squash-merged as
`bbabfdc0bff89953ff746b9a09e0d38147e83085`. The latter closes only the
repeated-startup technical blocker; it grants no authorization.

**Foundation deployment authorization:** `FALSE`

**Repository:** `rishatkznAI/rental-management`

**Starting `origin/main`:** `c3b20fcb5375894f900a31b70a1f36b2d4b524fe`

This document is a fail-closed architecture and evidence gate. It is not PR9, an
approval record, a release, an activation record, production evidence by itself, or
permission to deploy or write. The burden of proof rests on canonical-write
authorization. Missing, stale, inaccessible, ambiguous, synthetic, local-only, or
unapproved evidence means deny.

The later read-only recovery capture restored official Railway access and verified
the active runtime and live SQLite database. Production runs PR3 SHA `6a38582f...`,
the exact PR1/PR2 schema is present with all eight financial tables empty, and
PR5–PR8 migrations/tables are not deployed. Therefore production identity and
source authority are `MISSING`, `PRODUCTION_PR8_SCHEMA = NOT_DEPLOYED`, and
`PRODUCTION_PR8_DRY_RUN_EVIDENCE = MISSING`. Internal health/version probes pass,
but public ingress times out. No authorization status changed.

The factual audit found a released but production-unreachable PR8 diagnostic
foundation. The current repository has no production PR8 execution path, production
policy registry, `ActualReceivableEligibleV1` repository or producer, canonical
posting adapter, canonical insertion repository, integration/system authority
contract, catalog-v2 execution/posting/activation capabilities, or explicit
`CanonicalWriteAuthorizationV1`. The latest independently reproducible GitHub
deployment record for the Railway production environment points to PR3 SHA
`6a38582f5f90b85734884b6b12ad8e306b24619e`, before PR4–PR8. Current runtime and
database evidence is now recorded by the separate recovery pack: PR5–PR8 schema is
not deployed, PR6 authority is missing, and no PR8 run exists.

## 2. Scope and non-goals

This gate does only four things:

1. records the factual repository, GitHub, deployment, and accessible production
   evidence;
2. defines the future authority separation and immutable contracts;
3. defines the evidence and approvals required before PR9 implementation or any
   later production write can be authorized;
4. leaves every unresolved authority fail closed.

This gate does **not** implement PR9; create a posting adapter, event producer,
queue, outbox, worker, scheduler, timer, CLI, route, repository, schema, migration,
identity, capability, source row, dry run, feature flag, backup, deployment, or
canonical row; run a production bootstrap or dry run; mutate production; enable
canonical reads; perform settlement; backfill; dual-write; shadow-read; cut over;
or revise historical PR4/PR8 records.

Local fixtures, a fresh local SQLite database, tests, CI, documentation assertions,
developer-workstation data, manually constructed JSON, screenshots without durable
lineage, and this document are explicitly excluded from production evidence.

## 3. Verified repository lineage

`git fetch origin --prune` on 2026-07-21 confirmed a clean starting worktree and
`origin/main` at `c3b20fcb5375894f900a31b70a1f36b2d4b524fe`.

| Stage | Verified state | Commit / evidence |
|---|---|---|
| PR1 | RELEASED; schema/domain foundation only | preserved in main history |
| PR2 | RELEASED; settlement/domain foundation only | preserved in main history |
| PR3 | RELEASED; default-disabled read-only infrastructure only | implementation `6a38582f5f90b85734884b6b12ad8e306b24619e`; marker `85f81948b831f10fd707f46fae03b2efcef3ad9b` |
| PR4 | DESIGN APPROVED; historical documentation gate; not released | `f071633e1df537dfe6595e31f3d222e0a5cc1515` / PR #209 |
| PR5 | RELEASED; identity/RBAC foundation only | `35aa9891e389ab7de114475f7012d737d1165695`; marker `030b140fa767f4c2ff16b3f9910a46e12b94e485` |
| PR6 | RELEASED; Billing Source Authority foundation only | `485808d24b8c5f6481e0520eec5c8985b71ffeab`; marker `b582b9d2ac4eb0f4bb5ced04d74fbb016e437659` |
| PR7 | RELEASED; Forecast Receivables Planning foundation only | `cb90e09f26c5b9916a4818fd96048070a6a1a662`; marker `66659c1296e05424179e2b4cc6ee1924ece4fbc9` |
| PR8 | RELEASED; Actual-Source Eligibility Dry Run foundation only | PR #216 head `fb66d27208dc810d5ccf60e11b3a5498daf7239d`, squash `afeac4de9b2711d9c6493855a8e3632443844f61`; PR #217 head `bc02c4f285dfc98b8355992eb8af0bef81a96770`, marker/main `c3b20fcb5375894f900a31b70a1f36b2d4b524fe` |

PR #216 was merged at `2026-07-21T02:41:51Z`. Its exact reviewed head had
successful `lightweight-pr-check` run `29773544734`, job `88457369180`. PR #217 was
merged at `2026-07-21T03:25:59Z`; its head had successful
`lightweight-pr-check` run `29796972814`, job `88530171613`. Both PRs were
non-draft, had no review submissions, review requests, comments, or review threads,
and had no auto-merge request. This absence is GitHub workflow evidence only; it is
not business approval.

The recent merged sequence ends at #217. Open PRs #187, #179, #157, #142, and #138
predate this rentCore sequence and do not contain a newer merged architectural
change. No commit after `c3b20fcb...` was present on `origin/main` at the audit.

A repository-wide stale-status search found one `PR8 is not started` sentence in the
historical PR7 release audit. It is the contemporaneous PR7 boundary, not current
status, and is intentionally preserved under the docs-only allow-list. Current
contract, decision and PRE-PR9 documents consistently record PR8 as released
foundation-only and PR9 as blocked.

## 4. Verified deployment lineage

The repository documents Railway backend autodeploy, Node 20, Nixpacks, the
`/health` healthcheck, and a persistent SQLite volume requirement. Those documents
describe intended operation and do not prove current runtime state.

GitHub's deployment API records the latest success for environment
`cooperative-vitality / production` as deployment `5453098690`, status record
`15502023671`, SHA `6a38582f5f90b85734884b6b12ad8e306b24619e`, created
`2026-07-15T07:07:38Z` and successful at `2026-07-15T07:09:40Z`. Repository history
identifies that SHA as PR3 implementation #205. It is an ancestor of current main
and excludes PR4, PR5, PR6, PR7, and PR8.

Historical PR3 release evidence names Railway deployment
`b74623ec-d20d-4c50-ab40-0e0a494c5bc5`. GitHub metadata corroborates the deployed
commit but does not expose or prove the current Railway deployment ID, running
container identity, database volume, environment variables, or current runtime.

At `2026-07-21T09:33:12Z`, three read-only HTTPS probes to the documented production
backend (`GET /health`, `GET /api/version`, and `HEAD /health`) each timed out while
connecting. At `2026-07-21T09:36:24Z`, read-only `railway status --json` failed
because the local Railway OAuth refresh was unauthorized. No login, configuration
change, deploy, restart, or variable read was attempted.

That last sentence describes this gate's original audit window. During the later
evidence-recovery task, official Railway browserless OAuth login completed after
the authorized user signed in. No credential was retained, and no project setting,
deployment, restart, variable or database state was changed. Public probes still
timed out, while read-only inspection inside the already-running container returned
`200` for health/version, `401` for the unauthenticated auth boundary and `404` for
canonical/forecast read routes.

Consequences in the original `09:36:24Z` audit window:

- exact currently running backend SHA: `UNKNOWN / NOT ACCESSIBLE`;
- current deployment ID/status: `UNKNOWN / NOT ACCESSIBLE`;
- current Node/runtime version: `UNKNOWN / NOT ACCESSIBLE` (repository target is
  Node 20; local verification runtime is not production);
- startup/migration evidence for PR5–PR8: `MISSING`;
- production feature-flag values: `NOT ACCESSIBLE`;
- PR8 execution path, PR9 adapter, and canonical-write absence in the **current
  runtime**: not independently provable; the audited current source tree contains
  none of those paths and the last reproducible deployed SHA predates PR8.

The later recovery pack supersedes those accessibility results for current factual
state: the active deployment is `b74623ec...` at `6a38582f...`, Node is
`v20.18.1`, current PR5–PR8 migrations are absent, allow-listed read flags are
absent/default-disabled, and the runtime has no PR8/PR9/canonical-write path. The
remaining public-ingress timeout is fail closed and independently recorded.

## 5. Production evidence pack

### 5.1 Evidence-record rules

Every accepted production record must identify environment, exact capture time,
read-only source/tool, deployed SHA, deployment/database/artifact identity,
query/command class, redacted result, checksum where applicable, reviewer, and
independent reproducibility. No row below contains a secret, credential, raw customer
PII, or raw financial record.

`MISSING` means no qualifying record was found. `NOT ACCESSIBLE` means the evidence
may exist but could not be read. `FAIL` means the observed result does not satisfy
the gate. None may be converted to PASS by inference.

### 5.2 Deployment evidence

| Evidence ID | Environment / timestamp | Source/tool | SHA and artifact identity | Read-only class and result | Hash/checksum | Reviewer / reproducible | Status |
|---|---|---|---|---|---|---|---|
| `PROD-DEP-001` | production; record `2026-07-15T07:09:40Z`, queried `2026-07-21T09:33:50Z` | GitHub Deployments API via authenticated `gh api` | SHA `6a38582f...`; GitHub deployment `5453098690`; status `15502023671`; environment `cooperative-vitality / production` | metadata GET: `success`; SHA is PR3 and predates PR4–PR8 | Git object SHA; no artifact digest exposed | Codex factual audit; independently reproducible by authorized GitHub reader | **FAIL** — stale for PR5–PR8 |
| `PROD-DEP-002` | production; `2026-07-21T09:33:12Z` | `curl` GET/HEAD to documented Railway URL | runtime/deployment identity unavailable | `/health`, `/api/version`, `/health` HEAD each connection timeout; no response body | none | Codex factual audit; independently retryable | **NOT ACCESSIBLE** |
| `PROD-DEP-003` | production metadata; `2026-07-21T09:36:24Z` | Railway CLI `status --json` | project/runtime identity not returned | read-only metadata query rejected due expired/invalid OAuth refresh | none | Codex factual audit; reproducible only after separately restored read access | **NOT ACCESSIBLE** |
| `PROD-DEP-004` | frontend production; queried `2026-07-21T09:33:50Z` | GitHub Deployments/Actions APIs | Pages deployment `5454435905`, SHA `e5e516d...`; successful run `29402545157` | frontend/deploy-tooling evidence only; does not prove backend or DB | Git SHA | independently reproducible | **FAIL** for backend/write gate |

### 5.3 Production database integrity evidence

| Evidence ID | Environment / timestamp | Source/tool | Deployment/database identity | Required read-only result | Hash/checksum | Reviewer / reproducible | Status |
|---|---|---|---|---|---|---|---|
| `PROD-DB-001` | production; `2026-07-21T09:36:24Z` | no authenticated production DB inspection mechanism available | DB path, volume ID, SQLite file identity, inode and WAL identity unknown | `PRAGMA foreign_keys`, `foreign_key_check`, `integrity_check`: not run | missing | independent reproduction unavailable | **NOT ACCESSIBLE** |
| `PROD-DB-002` | production; same audit | unavailable | same | exact migration rows/versions for `canonical_receivables_pr1_schema` v1, `canonical_receivables_pr2_settlement` v1, `platform_identity_pr5` v1, `billing_source_authority_pr6` v1, `forecast_receivables_planning_pr7` v1, `actual_source_eligibility_dry_run_pr8` v1; duplicate-registration check: not run | missing | independent reproduction unavailable | **NOT ACCESSIBLE** |
| `PROD-DB-003` | production; same audit | unavailable | same | structural checks, database/WAL/storage/free-space size, table counts, and pre/post inspection counts: not run | missing | independent reproduction unavailable | **NOT ACCESSIBLE** |

Historical PR3 evidence reported `foreign_keys=1`, zero FK violations, only PR1/PR2
migrations, and eight canonical/settlement tables at zero rows. It is consistent with
`PROD-DEP-001` but predates PR5–PR8, lacks current database identity and fresh
before/after proof, and is not accepted as current evidence. The local
`server/data/app.sqlite`, local fresh databases, and CI databases were deliberately
excluded from this pack.

Those counts were unavailable in the original gate capture. The later recovery
pack proves canonical companies/branches and all six financial tables are zero,
PR5–PR8 tables are absent, and before/after fingerprints and counts are equal.

### 5.4 Production identity evidence

| Evidence ID | Environment / timestamp | Source/tool | Identity | Result | Hash/checksum | Reviewer / reproducible | Status |
|---|---|---|---|---|---|---|---|
| `PROD-ID-001` | production; `2026-07-21T09:36:24Z` | production DB unavailable | production identity root unknown | concrete company IDs/display names/timezones and Head Office/operational branch IDs not inspectable | missing | no independent reproduction | **NOT ACCESSIBLE** |
| `PROD-ID-002` | production; same audit | production DB unavailable | membership/bootstrap registry unknown | active memberships, branch grants/company-wide authority, template versions, v1 catalog/checksum, grants/denies, named operator/approvers, authorization audit and bootstrap lineage not inspectable | missing | no independent reproduction | **NOT ACCESSIBLE** |
| `PROD-ID-003` | current source at `c3b20fcb...` | repository audit | PR5 catalog v1 | exact 11-entry human-membership catalog; no posting/execution/activation capability; trusted scope is `principalType=user`; integration/system issuance unsupported | source Git SHA | independently reproducible | **FAIL** for PR9 authority |

The PR5 release explicitly states that production bootstrap was not run and concrete
production records, approvals, and future integration/system contracts were absent.
The later qualifying production evidence confirms that boundary: PR5 schema and
authority rows are not deployed and legacy users are not PR5 identity authority.

### 5.5 Production PR6 source evidence

| Evidence ID | Environment / timestamp | Source/tool | Source identity | Result | Hash/checksum | Reviewer / reproducible | Status |
|---|---|---|---|---|---|---|---|
| `PROD-SRC-001` | production; `2026-07-21T09:36:24Z` | production DB unavailable | PR6 source systems/cohort unknown | activation boundaries, rental lines, terms, period versions, snapshots/evidence, UPDs/versions/lines, active coverage/supersession/correction and operation/audit lineage not inspectable | missing | no independent reproduction | **NOT ACCESSIBLE** |
| `PROD-SRC-002` | current source at `c3b20fcb...` | dependency/static audit | PR6 foundation | schema has 16 append-only tables and commands but startup reaches only schema; no HTTP/runtime source adapter, worker, route, CLI activation path, or legacy fallback | source Git SHA | independently reproducible | **FAIL** for governed production source adapter |

No exact approved source-system cohort, source-owner contract, adapter artifact,
production source rows, or activation boundary can be accepted. The later recovery
proves all sixteen PR6 tables are absent. The gate remains blocked; missing rows
must not be created without governed adapter and approval lineage.

### 5.6 Production PR8 evidence

| Evidence ID | Environment / timestamp | Source/tool | Run/artifact identity | Result | Hash/checksum | Reviewer / reproducible | Status |
|---|---|---|---|---|---|---|---|
| `PROD-PR8-001` | production; `2026-07-21T09:36:24Z` | production DB unavailable | no production run ID found | run/company/branch/cohort, policy hash, complete-input hash, result hash, counts/totals/deltas, duplicate diagnostics, seal, identity, replay and storage impact unavailable | missing | no independent reproduction | **MISSING** |
| `PROD-PR8-002` | current source at `c3b20fcb...` | static/runtime dependency audit | PR8 v1 foundation | production startup imports only schema; evaluation/read/service/policy repositories have no production caller; policy registry unavailable; flags fixed diagnostic-only/write false/activation false | source Git SHA | independently reproducible | **FAIL** for execution/activation |

`PRODUCTION_PR8_DRY_RUN_EVIDENCE = MISSING`

No dry run was created to fill this gap. Artificial fixtures and the PR8 CI/test
results are excluded from production evidence.

### 5.7 Operations, backup, retention and approval evidence

| Evidence ID | Environment / timestamp | Source/tool | Artifact identity | Result | Hash/checksum | Reviewer / reproducible | Status |
|---|---|---|---|---|---|---|---|
| `PROD-OPS-001` | production; `2026-07-21T09:36:24Z` | repository docs and inaccessible runtime | no approved control set | no exact admission/rate/volume/concurrency/storage thresholds or current telemetry evidence | missing | no independent production reproduction | **MISSING** |
| `PROD-BACKUP-001` | production; same audit | repository docs only | backup endpoint exists; current backup unknown | no current backup ID/checksum, restore drill, operator, RPO/RTO, or canonical-write incident evidence | missing | no independent production reproduction | **MISSING** |
| `PROD-RET-001` | production; same audit | decision baseline only | indefinite no-delete baseline | legal hold, export/archive, privacy/access, capacity and tamper controls lack durable accountant/legal approval | missing | no independent production reproduction | **MISSING** |
| `PROD-APP-001` | production; same audit | GitHub/docs audit | no gate approval set | no named product, accountant, legal, tax, security, release/ops, source-adapter or posting-adapter approval record | missing | no independent reproduction | **MISSING** |

### 5.8 Evidence-pack disposition

No evidence row was PASS in this gate's original audit window. The later
`EVIDENCE_PR_READY_COMPLETE` recovery contains reproducible PASS/FAIL/MISSING
records, but no independent acceptance signature exists. Therefore
`approvedEvidencePackHash = MISSING`. A checksum of either Markdown file proves
only file bytes and is not a substitute for independent production-evidence
acceptance.

## 6. Missing evidence

The later recovery resolved runtime/database accessibility. Blocking evidence or
authority still missing is:

- a successful public-ingress health/version/auth-boundary response;
- production PR5 company/branch/membership/template/grant/deny/bootstrap/audit
  authority, confirmed absent in the active database;
- production PR6 governed source universe and named source adapter, confirmed
  absent in the active database/runtime graph;
- approved production policy registry and all 15 PR8 policy decisions;
- authorized production PR8 execution and real sealed production runs;
- a named eligibility producer and canonical posting adapter;
- catalog-v2 approval and an integration authority registry;
- exact activation boundary and durable cohort definition;
- exact canonical amount basis;
- approved operational thresholds, telemetry, storage forecast, alerting and
  circuit-breaker configuration;
- verified backup/checksum, restore drill, RPO/RTO, incident/kill-switch and adapter
  revocation procedure;
- legal-hold/export/privacy/access/tamper controls;
- every named approval required by section 19.

## 7. Authority graph

The four authorities are disjoint:

1. **Source-system authority** owns creation of PR6 economic and evidence rows. It
   cannot emit canonical eligibility or write canonical tables merely because it
   owns source facts.
2. **Eligibility-producer authority** may transform one exact eligible candidate
   from a complete, sealed, current, accepted PR8 production run into one immutable
   `ActualReceivableEligibleV1`. It cannot write canonical tables.
3. **Canonical-posting-adapter authority** may consume only a repository-owned event
   and, after fresh in-transaction revalidation, perform the one approved canonical
   initial-post operation. It cannot create source facts, eligibility facts, human
   approvals, settlement, or corrections.
4. **Human activation/approval authority** approves production dry-run execution,
   adapter contracts, boundary/cohort, PR9 implementation, disabled deployment,
   production writes, and revocation as separate decisions. It cannot impersonate an
   adapter or use a human membership as its runtime identity.

No `system`, `admin`, `manager`, display role, `receivables.read`, deployment, merge,
or test result spans these boundaries. An integration actor cannot impersonate a
user. A human membership cannot be assigned to an adapter.

The only permitted future flow is:

`governed source adapter -> immutable PR6 rows -> authorized PR8 execution -> sealed
accepted candidate -> named eligibility producer -> ActualReceivableEligibleV1 ->
named posting adapter -> fresh locked revalidation -> atomic posted receivable +
posting operation + financial audit`.

Every arrow requires its own current authority. A missing arrow is deny.

## 8. Source adapter contract

Each production source adapter must have one append-only
`GovernedAdapterAuthorityV1` record with `adapterKind=source_adapter`. There is no
approved current instance.

The immutable record must contain:

- `adapterAuthorityId`, schema/version/status/environment and owning team;
- stable integration actor ID and `actorType=integration`;
- one company ID and explicit concrete branch IDs; wildcards are forbidden;
- exact allowed source-system IDs and source row classes;
- allowed source event/schema versions and exact PR6 target operations;
- explicit forbidden operations, including PR8 event creation, canonical posting,
  source history mutation/deletion, settlement, and user impersonation;
- executable artifact/version, source commit SHA, artifact and configuration
  digests, policy hash and activation-contract reference;
- credential issuer/reference without credential material, rotation/revocation
  process, runtime/network and deployment identity;
- named approval identities, effective time, status, supersession/revocation lineage,
  audit and retention requirements.

Before each PR6 command the repository must match actor, environment, artifact,
commit, config, policy, company, branch, source system, row class, schema version,
activation contract, capability/operation, active contract and credential status.
Any mismatch blocks before source DML. A generic system bypass is forbidden.

Until an actual source system, owner, cohort and artifact are approved, concrete
source-adapter fields remain `MISSING`; documentation must not invent them.

## 9. Eligibility producer contract

The sole conceptual producer of `ActualReceivableEligibleV1` is the future
repository-owned component identified by proposed authority ID
`rentcore.actual-receivable-eligibility-producer.production.v1` and proposed actor ID
`integration:rentcore-actual-receivable-eligibility-producer`. These names reserve a
design identity only. They are not provisioned, approved, deployable, or active.

Its `GovernedAdapterAuthorityV1` must set
`adapterKind=eligibility_producer` and allow only:

- read of an exact complete, sealed, accepted production PR8 run/candidate and its
  exact PR6 lineage;
- append of one repository-owned versioned eligibility event for an explicitly
  authorized company/branch/cohort;
- exact replay/no-op of identical content.

It must forbid PR6 source creation/correction, canonical DML, settlement, policy
selection from request input, run execution without separate authorization,
candidate reclassification, source drift suppression, event update/delete, and
human impersonation.

An event can be produced only when the producer contract, approved production dry
run, current source state, current policy, activation cohort, and an effective
`CanonicalWriteAuthorizationV1` all match. Event production itself does not authorize
posting.

## 10. Canonical posting adapter contract

The sole conceptual posting adapter has proposed authority ID
`rentcore.canonical-receivable-posting.production.v1` and proposed actor ID
`integration:rentcore-canonical-receivable-posting`. These are design reservations,
not approved identities.

Its `GovernedAdapterAuthorityV1` must set
`adapterKind=canonical_posting_adapter` and allow only one operation:
`canonical_receivable.initial_post.v1` for exact allow-listed company/branches,
source systems, event version and activation cohort.

Allowed future targets are exactly:

- `canonical_receivables` — one initial `posted` row;
- proposed `canonical_receivable_posting_operations` — one sealed operation/replay
  record owned by the future repository;
- `financial_audit_events` — one append-only event for the same operation.

All settlement tables, PR6/PR7/PR8 tables, `app_data`, legacy finance/payment/rental
collections and UPDATE/DELETE of canonical facts are forbidden. No generic service
or user DTO is accepted. The adapter must fail closed on every actor, environment,
artifact, commit, config, policy, company, branch, source-system, source-row,
event-version, activation-contract, capability, contract-status or credential-status
mismatch.

## 11. Capability catalog v2 proposal

Catalog v1 remains unchanged by this gate. The following is an exact additive v2
proposal and is not approved or implemented.

| Proposed key | Scope | Actor applicability / assignability | Grant authority | Dual approval | Restrictions, deny/revocation and audit |
|---|---|---|---|---|---|
| `receivables.actual_source.evaluate` | branch | integration contract only; never human membership assignable | security/identity owner plus product/finance source owner through immutable adapter contract | required for grant, activation and revocation | one company, explicit branches/cohort/policy/artifact; deny or revoked contract wins immediately; log every attempt/run |
| `receivables.diagnostics.read` | branch | human membership only; assignable to named reviewers | membership administrator plus finance data owner | required for grant outside an approved reviewer template; not required per read | concrete branches; deny wins; fresh membership check; every sensitive evidence export audited |
| `receivables.canonical.post` | branch | integration contract only; never human membership assignable | security/identity owner plus accountant/finance authority and adapter owner | required for grant, activation and revocation | exact event/operation/company/branch/cohort; immediate fail-closed revocation; every attempt/replay/conflict audited |
| `receivables.canonical.activation.manage` | branch | named humans only | security/identity owner plus product owner and release/operations owner | required for each activation, change and revocation; initiator cannot self-approve | no wildcard; capability alone never activates; requires separate append-only activation/authorization record |
| `receivables.reconciliation.review` | branch | named humans only | finance authority plus security/identity owner | required to accept a production run/evidence pack; independent reviewer required | cannot execute/post/activate; denial/revocation immediate; review decision/hash/scope audited |

Integration capabilities are materialized only through named adapter authority
contracts and a future dedicated integration-authority resolver. They are never rows
in `company_memberships`. Human capabilities remain membership/template grants with
deny precedence and fresh PR5 checks. `receivables.read` remains a v1 read capability
and cannot authorize execution, posting, activation, or reconciliation acceptance.

## 12. `ActualReceivableEligibleV1` design

The event is immutable, versioned, repository-owned, deterministically hashed,
company/branch scoped, idempotent, replay-safe, bounded/inert, indefinitely retained,
and linked to complete sealed evidence. It cannot be created from an HTTP body,
client-supplied policy, arbitrary DTO, test policy, unsealed run, blocked/stale
candidate, source drift, revoked authority, or unapproved cohort.

Required canonical fields are:

- `eventId`, `schemaVersion=ActualReceivableEligibleV1`, `eventVersion`;
- `companyId`, `branchId`, `activationBoundaryId`, `activationCohortRef`;
- `dryRunId`, `candidateId`, `candidateResultHash`, `completeInputSetHash`,
  `policyManifestHash`, `sourceOwnershipManifestHash`;
- `actualSourceKey`;
- exact billing-period ID/version, snapshot ID/hash, UPD ID/version, UPD-line
  ID/version and coverage set/slice/version;
- client, contract, rental and rental-line stable IDs;
- currency and exact net/VAT/gross minor units;
- approved canonical amount-basis decision reference/hash;
- contractual due date, due-date provenance and company IANA timezone;
- producer authority ID/version, producer artifact/config digest;
- canonical-write authorization ID/version/hash;
- `correlationId` and repository-owned `occurredAt`;
- deterministic `eventHash` over the complete canonical representation.

The idempotency identity is the exact company + immutable source slice/version +
approved contractual due date + activation authorization. Same identity and content
is an exact replay. Same identity with different content is a P0 conflict and no
event. An event is never edited or deleted; revocation only prevents consumption and
adds append-only authority/audit records.

## 13. `CanonicalWriteAuthorizationV1` design

This append-only contract is the only durable record that may authorize a bounded
production canonical write. Its required fields are:

- `authorizationId`, `schemaVersion=CanonicalWriteAuthorizationV1`, version and
  append-only `status`;
- `approvedAt`, `effectiveFrom` and optional expiry if explicitly approved;
- one `companyId` and explicit `branchIds`;
- `activationBoundaryId`, `activationCohortRef`, `cohortDefinitionHash`;
- approved source-system IDs;
- approved eligibility-producer authority ID/version/artifact digest;
- approved posting-adapter authority ID/version/artifact digest;
- approved event schema version;
- approved policy manifest references/hashes;
- approved evidence-pack hash and exact production dry-run IDs/result hashes;
- exact operation `canonical_receivable.initial_post.v1`;
- allowed tables `canonical_receivables`,
  `canonical_receivable_posting_operations`, `financial_audit_events`;
- forbidden operations including draft creation, update/delete, source/legacy
  mutation, payment, allocation, adjustment, correction, cancellation, refund,
  write-off, settlement, backfill, dual write, shadow read and cutover;
- admission/rate/concurrency/storage controls, verified backup/restore evidence,
  reconciliation, incident/kill-switch, retention/legal-hold references;
- product-owner, accountant, legal, security, release/operations and adapter-owner
  approvals, plus tax/VAT approval when applicable;
- revocation/supersession references and record hash.

Wildcard company, branch, source, adapter or cohort is invalid. Deployment, merge,
admin role, CI or test success cannot imply approval. Revocation appends a new
record; it never edits the authorization.

The following are independent decisions and cannot imply one another:

1. write-contract design approved;
2. PR9 implementation authorized;
3. PR9 code deployment authorized while disabled;
4. production canonical writes authorized;
5. canonical production reads authorized;
6. settlement authorized;
7. shadow read/cutover authorized.

No `CanonicalWriteAuthorizationV1` exists at this audit.

## 14. Canonical write transaction contract

The future PR9 boundary, if separately authorized, is:

1. forward-only periods entirely after an approved boundary; no partial-period
   trimming, history import or backfill;
2. no dual write, legacy mutation or forecast conversion;
3. one canonical actual per immutable UPD source slice and contractual due date;
4. initial workflow is **direct `posted` creation only**. `draft` is forbidden for
   this adapter. This is the gate's proposed design decision and still requires the
   durable D-30 approvals before implementation;
5. `originalAmountMinor` is selected only by an approved canonical amount-basis
   reference. Net, VAT, gross or another basis remains `OWNER APPROVAL REQUIRED`;
   gross must not be assumed;
6. unknown due date follows the already approved boundary: outside aging, overdue,
   collections and legal escalation;
7. source identity comes only from immutable PR6/PR8/event lineage;
8. one repository-owned `BEGIN IMMEDIATE` transaction freshly validates adapter,
   activation, PR5 authority state, exact sealed PR8 candidate, hashes, current PR6
   source state, no reopen/cancel/correction/supersession drift, schema/FK/integrity
   prerequisites and canonical uniqueness;
9. the transaction creates the receivable, posting operation and financial audit
   atomically, then rereads and reconstructs the result before commit;
10. repository owns IDs, timestamps, hashes, idempotency and final reconstruction;
    no caller callbacks, hooks, clocks, ID generators or dynamic policy execute
    inside the lock;
11. event payload alone is never sufficient authority;
12. source/policy/authorization/adapter drift blocks and quarantines without write;
13. source reopen/cancel/correction before posting blocks posting; after posting it
    raises a P0 discrepancy requiring a separately approved append-only compensation
    strategy, never delete/update of the canonical fact;
14. PR9 performs no payment, allocation, adjustment, refund, write-off,
    cancellation, correction compensation or settlement.

Every successful transaction must retain sealed source evidence, adapter authority,
write authorization, operation, audit, correlation ID and complete reproducible
hashes.

## 15. Idempotency, replay and conflict contract

- Same authorized event identity + same canonical content + same authority state:
  exact no-op/replay; no new receivable, operation or audit row.
- Same event/source/idempotency identity + different content, amount basis, due date,
  policy, source version, adapter or authorization: deterministic P0 conflict; no
  write; quarantine and alert.
- Duplicate/overlapping economic coverage: circuit break; no write.
- Concurrent attempts for the same governed scope or identity: one winner, later
  exact replay or deterministic domain conflict; no raw `SQLITE_BUSY`/`LOCKED` and
  no partial row.
- Replay after revocation, drift or expired authority: blocked even if the original
  payload is unchanged.
- Operation and event records are indefinite, append-only replay evidence.

## 16. Operational controls

### Activation

A future server-owned flag must default disabled with no enabled fallback. Deployment
does not activate it. Activation requires an append-only record matching exact
company, branches, cohort, boundary, adapter artifacts, policy and write
authorization. Requests cannot select activation. A kill switch and adapter
revocation must stop future attempts without deleting history.

### Admission and rate limits

The following require explicit owner approval before activation: maximum runs per
window, candidates per run, writes per batch, bytes/input rows, scheduling window,
retry/backoff, queue depth and every stop threshold. This gate invents no numerical
value. All remain `OWNER APPROVAL REQUIRED`, so activation is blocked.

### Concurrency

Only one active evaluation/posting lease may exist per exact governed scope. SQLite
writers use immediate transactions. Duplicate posting, partial rows and raw busy
errors are forbidden. Lease identity, duration, renewal, recovery and stop behavior
require approval and must be observable.

### Circuit breakers

Immediate stop is mandatory for non-zero unexplained net/VAT/gross delta,
duplicate/overlap, source/policy/adapter/authorization drift, unknown source,
revoked human/adapter authority, schema/FK/integrity failure, event conflict,
storage threshold breach, audit failure, backup-health failure or excessive blocker
rate. Numerical storage/blocker thresholds remain unapproved and blocking.

### Observability

Required metrics are runs started/completed/blocked, candidates eligible/blocked,
posting attempts/successes, exact replays/conflicts, every drift class,
net/VAT/gross deltas, latency, transaction conflicts, audit failures, storage/WAL
growth, kill-switch state and current adapter/config/policy/authorization versions.
Metrics must carry stable scope and correlation identities without customer PII.

## 17. Retention and legal-hold controls

PR8/PR9 evidence is retained indefinitely. TTL, purge, scheduled cleanup and
rollback deletion are forbidden. Before production execution, approved controls must
cover:

- production free-space and WAL telemetry;
- PR6/PR8/PR9 rows and bytes per candidate/run/write;
- approved alert thresholds and long-term capacity forecast;
- immutable export/archive without deletion;
- legal holds, access/privacy controls and tamper evidence;
- evidence retrieval and independent verification.

The indefinite no-delete baseline is approved historically, but legal hold,
export/archive, access/privacy, tamper controls, capacity and their named owners are
not. `retentionAndLegalHoldControlsApproved` remains blocked.

## 18. Backup, restore and rollback controls

Before a first write there must be a verified production backup with exact database
identity, timestamp, checksum, storage location reference, responsible operator and
access controls; a tested restore procedure and restore-drill evidence; approved RPO
and RTO; incident and reconciliation runbooks; kill switch; adapter credential
revocation; and post-restore integrity/reconciliation queries.

The repository provides a full-backup endpoint and operational guidance, but no
current backup/checksum or restore drill was accessible. Documentation is not drill
evidence.

Rollback never deletes canonical writes. It disables future execution, revokes the
adapter/activation authorization, retains every source/canonical/audit record,
quarantines affected sources and uses only a future separately approved append-only
correction/compensation event.

## 19. Approval matrix

No GitHub username, commit author, role label, merge, prompt statement, or Codex
decision satisfies this matrix.

| Required authority | Required durable fields | Evidence found | Status |
|---|---|---|---|
| Product owner | stable identity, time, decision ref/version/hash, exact cohort/operation/scope, limitations and revocation | none for D-28–D-33/PR9 | **MISSING** |
| Accountant / Finance authority | same; amount basis, source sufficiency, reconciliation and write treatment | none | **MISSING** |
| Legal authority | same; debt evidence, due date, correction, retention/legal hold | none | **MISSING** |
| Tax/VAT authority where applicable | same; VAT basis/selection/evidence | none | **MISSING** |
| Security/identity owner | same; human/integration identities, capabilities, credentials/revocation | none | **MISSING** |
| Release/operations owner | same; deployment, activation, limits, telemetry, backup/restore/incident | none | **MISSING** |
| Source-adapter owner | same; source systems/classes/artifact/config/runtime ownership | none | **MISSING** |
| Eligibility-producer owner | same; producer artifact/event repository/operation | none | **MISSING** |
| Canonical-posting-adapter owner | same; adapter artifact/config/runtime/operation | none | **MISSING** |
| Independent reconciliation reviewer | same; evidence-pack/run/result acceptance | none | **MISSING** |

Every future approval is approved/rejected explicitly, narrowly scoped, hashed,
append-only and supersedable/revocable. An absent record is deny.

## 20. Exact authorization status matrix

| Field | Value | Exact evidence / reason |
|---|---|---|
| `architectureDesignApproved` | **BLOCKED** | design recorded here; D-28–D-33 lack durable named approval |
| `productionEvidenceAccepted` | **BLOCKED** | `docs/pre-pr9-production-evidence-pack.md` is `EVIDENCE_PR_READY_COMPLETE`, but it is not independently accepted and public ingress remains a P1 finding |
| `productionIdentityReady` | **BLOCKED** | `PROD-ID-001/002`; bootstrap and concrete authority unproven |
| `productionSourceAuthorityReady` | **BLOCKED** | `PROD-SRC-001/002`; rows and governed adapter absent/unproven |
| `productionDryRunExecutionAuthorized` | **BLOCKED** | no capability, policy registry, activation/cohort or named approval |
| `productionDryRunEvidenceAccepted` | **BLOCKED** | `PRODUCTION_PR8_DRY_RUN_EVIDENCE = MISSING` |
| `sourceAdapterAuthorityApproved` | **BLOCKED** | no concrete `GovernedAdapterAuthorityV1` source instance |
| `eligibilityProducerAuthorityApproved` | **BLOCKED** | proposed design identity only; no contract/identity/artifact/approval |
| `canonicalPostingAdapterAuthorityApproved` | **BLOCKED** | proposed design identity only; no contract/identity/artifact/approval |
| `operationalControlsApproved` | **BLOCKED** | `PROD-OPS-001`; thresholds/telemetry/circuit breakers unapproved |
| `retentionAndLegalHoldControlsApproved` | **BLOCKED** | `PROD-RET-001`; legal hold/export/privacy/tamper/capacity missing |
| `canonicalWriteContractApproved` | **BLOCKED** | amount basis and D-30 approval missing; no `CanonicalWriteAuthorizationV1` |
| `pr9ImplementationAuthorized` | **FALSE** | explicit gate outcome; implementation not authorized |
| `pr9DisabledDeploymentAuthorized` | **FALSE** | no separate disabled-deployment approval |
| `productionCanonicalWritesAuthorized` | **FALSE** | no evidence/approvals/authorization; PR8 flags fixed false |
| `canonicalProductionReadsAuthorized` | **FALSE** | read flag default-disabled and production resolver unconditional null; no switch approval |
| `settlementAuthorized` | **FALSE** | PR2 foundation only; PR10 not authorized |
| `backfillAuthorized` | **FALSE** | explicitly forbidden |
| `dualWriteAuthorized` | **FALSE** | explicitly forbidden |
| `shadowReadAuthorized` | **FALSE** | PR11 not authorized |
| `cutoverAuthorized` | **FALSE** | PR12 not authorized |

No TRUE field exists. A future TRUE must cite exact current evidence and approvals;
authorization of implementation must not alter any later field automatically.

## 21. Production dry-run and PR9 acceptance criteria

A production PR8 result can support a later gate only if it uses real production data,
an approved policy manifest/source systems/source-adapter ownership, approved
boundary/cohort, the complete source universe and a complete seal; has zero
unexplained net, VAT and gross deltas, zero duplicate economic coverage and zero
silent exclusions; exactly reconciles run/candidate/count/total data; has exact replay
evidence, reviewed blockers, storage impact and independent sign-off.

Every included candidate is either eligible under all approved gates or durably
outside the activation cohort by the pre-run cohort definition. Post-result manual
exclusion is forbidden. Aggregate zero cannot hide blocked candidates.

Required repeated-run count, observation window, minimum/maximum volume and blocker
threshold are `OWNER APPROVAL REQUIRED`. This gate offers no fabricated value.

PR9 implementation acceptance additionally requires all matrix fields through
`canonicalWriteContractApproved` to be TRUE and a separate durable
`pr9ImplementationAuthorized=TRUE` decision. A disabled deployment then needs its
own decision. Production writes need a still later effective
`CanonicalWriteAuthorizationV1` and activation record. Reads, settlement, shadow
reads and cutover remain separate later gates.

## 22. Explicit blockers

The current blockers are missing production identity/bootstrap; missing PR6 rows
and source adapter; missing policy registry and PR8 production run; missing named
producer/posting identities and integration authority; missing v2 capabilities;
missing exact boundary/cohort and amount basis; missing operational
thresholds/telemetry; public ingress timeout; missing current backup and restore
drill; missing retention/legal-hold controls; and all named approvals.

Any one is sufficient to deny. No bypass, synthetic evidence or prompt approval is
permitted.

The recovery pack replaces the prior inaccessible facts with verified negatives:
PR5/PR6/PR8 schema and authority/run rows are absent, all eight PR1/PR2 financial
tables are empty, and the runtime graph is fail closed. Confirmed blockers are the
missing production identity/source authority and PR8 evidence, absent durable
approvals/contracts/adapters/controls, and repeated public endpoint timeout.

## 23. Next permitted step

PR #219 is merged and the separate PR5–PR8 foundation-deployment readiness gate
was merged through PR #220 without deploying or activating anything. PR #221 then
closed its repeated-startup technical finding: exact
`documents_gantt_shadow_indexes.applied_at` is preserved, registered drift fails
closed without repair, the migration/failure/rollback evidence remains successful,
and `repeatedStartupPassed = TRUE`. Public ingress, durable approved production
backup, accepted restore drill, approved storage threshold, pinned artifact,
approved post-deployment smoke and owner/release approval remain blocked.

Restore public HTTPS ingress and establish an owner-approved coherent backup plus
independently verified restore drill, then rerun the foundation deployment
authorization gate. PR9 implementation is not a permitted next step.

## 24. Explicit non-goals

This document does not approve architecture, D-28–D-35, production evidence, source
authority, adapter identity, capabilities, policy, event production, amount basis,
PR9 implementation, disabled deployment, production writes, canonical reads,
settlement, backfill, dual write, shadow reads or cutover. It does not create evidence
that was missing at audit time and does not replace product, accountant, tax, legal,
security, release/operations, adapter-owner or independent-review decisions.
