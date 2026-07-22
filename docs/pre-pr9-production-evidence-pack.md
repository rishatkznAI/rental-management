# PRE-PR9 read-only production evidence pack

## 1. Executive status

**Pack status:** `EVIDENCE_PR_READY_COMPLETE`

**Capture date:** `2026-07-21`

**Repository:** `rishatkznAI/rental-management`

**Factual starting `origin/main`:**
`c3b20fcb5375894f900a31b70a1f36b2d4b524fe`

**Verified active production SHA:**
`6a38582f5f90b85734884b6b12ad8e306b24619e`

**Runtime drift classification:** `DOCUMENTED_ALLOWED_DRIFT`

**Production evidence acceptance:** `BLOCKED`

**PR9 implementation authorization:** `FALSE`

**Production canonical-write authorization:** `FALSE`

Official Railway authentication was recovered and the current production service,
running container, environment, volume and live SQLite database were inspected
read-only. The active backend is the successful PR3 deployment
`b74623ec-d20d-4c50-ab40-0e0a494c5bc5` at `6a38582f...`, not current main.
Production has exactly the expected PR1 and PR2 registrations and structures. All
eight canonical/settlement tables contain zero rows. PR5, PR6, PR7 and PR8
migrations and tables are not deployed, so production identity authority, source
authority and PR8 run evidence are factually missing. The current runtime remains
fail closed: canonical and forecast read routes return `404` internally, the auth
boundary returns `401`, and no canonical writer, PR6 adapter or PR8 execution path
is reachable.

The evidence pack is complete because the requested runtime/database facts and
their negative results are independently reproducible. `COMPLETE` does not mean
accepted or authorized. The public Railway domain timed out while the same running
container answered internal health/version probes, and all PRE-PR9 approval fields
remain blocked or false.

## 2. Scope and read-only boundary

Production-facing actions were limited to official Railway login, metadata and
log reads, secret-safe variable allow-list reads, safe HTTP `GET`/`HEAD` probes,
container filesystem metadata reads and SQLite opened with
`{ readonly: true, fileMustExist: true }` plus `PRAGMA query_only = ON`.
`immutable=1` was deliberately not used because a live WAL exists. No application
initializer or server was started.

No `railway up`, deploy, redeploy, restart, variable/configuration change,
application startup, migration, worker, scheduler, queue, bootstrap or diagnostic
run occurred. No `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, DDL, `wal_checkpoint`,
`VACUUM`, `ANALYZE` or `REINDEX` was issued. The only writes are the requested
local docs-only branch/commit and GitHub PR.

## 3. Repository lineage

Evidence `REP-001`, initially captured `2026-07-21T10:25:57Z`:

- `git fetch origin --prune` completed and the starting worktree was clean;
- `origin/main` was
  `c3b20fcb5375894f900a31b70a1f36b2d4b524fe`;
- PR5 implementation/marker are `35aa9891...` / `030b140f...`;
- PR6 implementation/marker are `485808d2...` / `b582b9d2...`;
- PR7 implementation/marker are `cb90e09f...` / `66659c12...`;
- PR8 implementation/marker are `afeac4de...` / `c3b20fcb...`;
- no later commit existed on `origin/main` at the initial capture;
- repository searches found no PR9 posting adapter,
  `CanonicalWriteAuthorizationV1`, `ActualReceivableEligibleV1`, capability
  catalog v2, canonical-write flag or runtime posting route/worker.

PR #218 was subsequently squash-merged as
`7892ea68193fa5357733ca0d554dc84af82e6200` on `2026-07-21T13:21:33Z`.
This evidence branch was then rebased onto that exact `origin/main`; the three-file
documentation overlap was resolved manually by retaining the full design gate and
the factual recovery evidence.

## 4. PR #218 status

Evidence `REP-002`, queried `2026-07-21T10:25:57Z`:

| Field | Result |
|---|---|
| State / merged / draft | `MERGED` / `true` / `false` |
| Head | `8ebe4ffd1263a8a75628453e64398ef74108c2ca` |
| Base | `c3b20fcb5375894f900a31b70a1f36b2d4b524fe` |
| Mergeability | `MERGEABLE`; merge state `CLEAN` |
| Checks | `lightweight-pr-check`: `SUCCESS`, completed `2026-07-21T09:50:47Z` |
| Auto-merge | absent |
| Squash merge | `7892ea68193fa5357733ca0d554dc84af82e6200`; `2026-07-21T13:21:33Z` |
| Gate status | `GATE_PR_READY_BLOCKED` |

#218 is docs-only, contains no PR9 implementation, and its merge changes no
authorization value.

## 5. Railway authentication and access state

Evidence `RWY-AUTH-001`:

- installed CLI: `railway 4.60.0`; reported upgrade `5.27.1` was not installed;
- the prior OAuth refresh failed with `invalid_grant`;
- official browserless login was completed through Railway's OAuth approval flow;
- `railway whoami` and `railway status --json` then succeeded;
- authenticated identity is recorded only as `h***@gmail.com`;
- no token, cookie, device code, secret or credential is retained here.

Evidence `RWY-LINK-001`:

| Object | Safe identity |
|---|---|
| Project | `cooperative-vitality`; `1558b38d-bf16-4b50-9ee6-0871b7152116` |
| Environment | `production`; `62833109-61cb-4600-9200-d624d6537a05` |
| Service | `rental-management`; `b2016e92-3c50-4b00-800d-625a139b219c` |
| Region | `europe-west4-drams3a`; one replica |
| Domain | `rental-management-production-35bc.up.railway.app`; target port `8080` |
| Local linkage fingerprint | SHA-256 `dad493b5839fcf92a631833606289ae9b77784f3992664e0c203361ff7a85ab4` |

No linkage, project, environment or service setting was changed.

## 6. Active deployment identity

Evidence `DEP-001/002` combines the GitHub deployment record, Railway status,
deployment/build logs, active instance metadata and the application's internal
build marker.

| Field | Verified result |
|---|---|
| Active deployment | `b74623ec-d20d-4c50-ab40-0e0a494c5bc5` |
| Status | `SUCCESS`; `deploymentStopped=false`; instance `RUNNING` |
| Source | `rishatkznAI/rental-management`; branch `main` |
| Source/deployed SHA | `6a38582f5f90b85734884b6b12ad8e306b24619e` |
| Trigger | Railway GitHub integration/autodeploy |
| Deployment created | `2026-07-15T07:07:35.262Z` |
| Build log begins | `2026-07-15T07:07:36.495Z` |
| Container start | `2026-07-15T07:09:34.696Z` |
| Application `startedAt` | `2026-07-15T07:09:34.047Z` |
| GitHub deployment success | `2026-07-15T07:09:40Z` |
| Runtime | Linux `6.18.5+deb13-cloud-amd64`, `x86_64` |
| Node / npm | `v20.18.1` / `10.8.2` |
| Build | Nixpacks `v1.41.0`; Node 20; `npm ci` |
| Start command | `node scripts/start-with-release-type.cjs` |
| Application version | package `1.0.0`; release type `backend` |
| Image digest | `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650` |
| Health policy | `/health`; timeout `300`; restart `ON_FAILURE`, maximum `10` |
| Public URL | `https://rental-management-production-35bc.up.railway.app` |
| Previous successful deployment | `2b183b0e-3ad0-4728-8d1f-87b0446cd0f3`; SHA `ee2c1b6...`; now `REMOVED` |
| Last failed deployment | none in the retrieved GitHub/Railway production window |

The running application marker, running container environment, Railway active
deployment metadata and GitHub deployment status all independently identify
`6a38582f...`. Its uninterrupted `startedAt`/uptime also shows no restart during
this capture.

## 7. Deployed SHA versus current main

Production is at the PR3 implementation merge. Current main is ahead by the
documented PR4 design record and PR5–PR8 foundation releases. PR5–PR8 implementation
commits have no production deployment, and their docs-only release markers were
skipped by Railway because watched runtime files did not change.

| Comparison | Result |
|---|---|
| Deployed SHA vs PR3 | exact match: `6a38582f...` |
| Deployed SHA vs PR4–PR8 | later repository work is not deployed |
| Deployed SHA vs current main | current main is ahead |
| Current main vs #218 | #218 is present as squash merge `7892ea68...` |
| PR9 code | absent in deployed SHA, current main and merged #218 |
| Classification | `DOCUMENTED_ALLOWED_DRIFT` |

This is evidence of version drift, not permission to deploy current main.

## 8. Runtime and HTTP evidence

Evidence `HTTP-INT-001`, captured through Railway SSH at
`2026-07-21T10:49:37.899Z`, used unauthenticated `GET` requests to
`127.0.0.1:8080` inside the already-running container:

| Route | Status | Safe result |
|---|---:|---|
| `/health` | `200` | `ok=true`; deployment/SHA/start marker match `DEP-002` |
| `/api/version` | `200` | `ok=true`; `app.disabled=false`; same build marker |
| `/api/auth/me` | `401` | `{ok:false,error:"Unauthorized"}` |
| `/api/receivables` | `404` | canonical read route is not registered |
| `/api/forecast-receivables/runs` | `404` | forecast route is absent in deployed PR3 |

Responses carried `Content-Type` and `X-Content-Type-Options: nosniff`; no auth
bypass or write method was attempted. PR8 has no HTTP route and no canonical write
route exists.

Evidence `HTTP-EXT-001`: public `GET`/`HEAD` probes at
`2026-07-21T10:21:32Z` and a later retry all failed before HTTP with curl exit `28`
after the eight-second connection timeout. This affected health, version, auth,
canonical and forecast route categories. The contrast with the internal `200`
health/version result is a P1 public-ingress finding, not a runtime-identity gap.

## 9. Production database identity

Evidence `DB-ID-001`, first captured `2026-07-21T10:35:17Z`:

| Field | Result |
|---|---|
| Engine | SQLite `3.53.1` via `better-sqlite3` |
| Absolute path | `/data/app.sqlite` (`DB_PATH` explicit) |
| Volume | `rental-management-volume`; `48b8768c-a8a9-4a87-8a4b-b980fff5d00c`; mount `/data`; `READY` |
| Capacity | Railway allocation `1000 MB`; `df` used `481,689,600` of `921,432,064` bytes (`54%`) |
| Database | device `4253392`, inode `13`, mode `0644`, size `11,927,552` bytes, mtime `2026-07-15 07:16:56.915091367 +0000` |
| Database SHA-256 | `b487d8a5534665aa896a8eea1788342b16969c2e10441e3857296505c3c7cf2b` |
| WAL | present; inode `14`; `7,453,112` bytes; mtime `2026-07-15 17:09:34.230828238 +0000` |
| WAL SHA-256 | `35445701ec00718d8c7c8adfee013580b964b4aa8c6c4063bf10c1b67f491e38` |
| SHM | present; inode `15`; `32,768` bytes; mtime `2026-07-15 18:09:34.259223202 +0000` |
| SHM SHA-256 | `bc2e7b214d1a4f19c928d82f452e316c8a61ab75f6646613cea34b7ba32be8c1` |
| Connection proof | `readonly=true`; `query_only=1`; no initializer imported |

The live WAL was read but never checkpointed. Hashes identify this live database
set for the capture; they are not advertised as a recoverable backup.

## 10. Database integrity

Evidence `DB-INT-001`, captured `2026-07-21T10:42:28.352Z` against `DB-ID-001`:

| Check | Exact result |
|---|---|
| `readonly` / `PRAGMA query_only` | `true` / `1` |
| `PRAGMA foreign_keys` | `1` |
| `PRAGMA foreign_key_check` | `[]` (zero rows) |
| `PRAGMA integrity_check` | `ok` |
| `PRAGMA quick_check` | `ok` |
| `PRAGMA journal_mode` | `wal` |
| `PRAGMA user_version` | `0` |
| `PRAGMA page_size` | `4096` |
| `PRAGMA page_count` | `2912` |
| `PRAGMA freelist_count` | `2657` |
| Query duration | `3 ms` |

No integrity blocker was observed.

## 11. Migration registry

Evidence `DB-MIG-001`, `SELECT` at `2026-07-21T10:41:52.029Z` from
`sql_shadow_schema_migrations`:

| Registration order | Migration | Version | `applied_at` UTC | Classification |
|---:|---|---:|---|---|
| 1 | `documents_gantt_shadow_indexes` | 2 | `2026-07-15 07:09:34` | expected deployed application migration |
| 2 | `canonical_receivables_pr1_schema` | 1 | `2026-07-14 05:19:11` | present, exact |
| 3 | `canonical_receivables_pr2_settlement` | 1 | `2026-07-14 18:42:21` | present, exact |
| — | `platform_identity_pr5` | 1 | absent | not deployed; expected version drift |
| — | `billing_source_authority_pr6` | 1 | absent | not deployed; expected version drift |
| — | `forecast_receivables_planning_pr7` | 1 | absent | not deployed; expected version drift |
| — | `actual_source_eligibility_dry_run_pr8` | 1 | absent | not deployed; expected version drift |

There are no duplicate migration IDs or versions and no unexpected registration
for the deployed SHA. Current main would initialize PR5–PR8; it was not started.

## 12. Table and row-count evidence

Evidence `DB-COUNT-001` used `sqlite_master`, `COUNT(*)` and aggregate-only
`json_array_length`; no raw business rows or PII were read.

| Group | Exact production result | Timestamp range | Classification |
|---|---|---|---|
| PR1 | `canonical_companies=0`; `canonical_branches=0`; `canonical_receivables=0`; `financial_audit_events=0` | all `null..null` | expected empty foundation |
| PR2 | `canonical_payments=0`; `canonical_payment_allocations=0`; `canonical_receivable_adjustments=0`; `canonical_approval_requests=0` | all `null..null` | expected empty foundation |
| PR5 | all nine PR5 tables missing | n/a | `PRODUCTION_IDENTITY_AUTHORITY = MISSING` |
| PR6 | all sixteen PR6 tables missing | n/a | `PRODUCTION_SOURCE_AUTHORITY = MISSING` |
| PR7 | all eight forecast tables missing | n/a | schema not deployed |
| PR8 | all eight dry-run tables missing | n/a | `PRODUCTION_PR8_SCHEMA = NOT_DEPLOYED` |

Exact missing table sets:

- PR5: `company_memberships`, `membership_branch_access`,
  `capability_catalog_versions`, `capability_catalog_entries`, `role_templates`,
  `role_template_capabilities`, `membership_capability_assignments`,
  `authorization_audit_events`, `identity_bootstrap_runs`;
- PR6: `billing_source_activation_boundaries`, `billing_source_rental_lines`,
  `billing_source_effective_terms`, `billing_source_periods`,
  `billing_source_period_versions`, `billing_source_snapshots`,
  `billing_source_snapshot_evidence`, `billing_source_upds`,
  `billing_source_upd_versions`, `billing_source_upd_lines`,
  `billing_source_upd_line_versions`, `billing_source_coverage_sets`,
  `billing_source_coverage_supersessions`, `billing_source_coverage_slices`,
  `billing_source_operations`, `billing_source_audit_events`;
- PR7: `forecast_receivable_runs`, `forecast_receivable_run_supersessions`,
  `forecast_receivable_input_snapshots`, `forecast_receivable_input_events`,
  `forecast_receivable_items`, `forecast_receivable_diagnostics`,
  `forecast_receivable_operations`, `forecast_receivable_audit_events`;
- PR8: `actual_source_dry_runs`, `actual_source_dry_run_inputs`,
  `actual_source_dry_run_candidates`, `actual_source_dry_run_checks`,
  `actual_source_dry_run_reconciliations`, `actual_source_dry_run_diagnostics`,
  `actual_source_dry_run_operations`, `actual_source_dry_run_audit_events`.

Legacy `app_data` aggregates were: `users=13`, `equipment=2`, and zero each for
`rentals`, `gantt_rentals`, `clients`, `client_contracts`, `documents`, `payments`,
`payment_allocations`, `finance_accounts`, `finance_operations` and
`company_expenses`. No legacy record is treated as PR5/PR6 authority.

## 13. Structural schema evidence

Evidence `DB-SCHEMA-001` hashed sorted `sqlite_master` table/index/trigger SQL,
`table_xinfo`, foreign keys, index lists and index columns. The same algorithm was
run against an in-memory PR1+PR2 database created from the schema source shared by
the deployed SHA and current main.

| Table | Production composite SHA-256 | Expected source | Result |
|---|---|---|---|
| `canonical_companies` | `3cd48fe6ba0e8a1ff20d544b9f3a2d56b2b6cbdf915dc8486c9e9ac2b8ba9348` | same | exact |
| `canonical_branches` | `c58d712e0137e6cf3d3c0fe5d00b4e405f4a5d891f566121cc0bbe06ab34562a` | same | exact |
| `canonical_receivables` | `da53cb85a9c90fb15c73d024b360dd8968c5d01f8282b3549fa620ebc1baf063` | same | exact |
| `financial_audit_events` | `2b82862715283521f45a8b8af6ad1e7e451cfbe6a447de8b7c1bdd7785efd72b` | same | exact |
| `canonical_payments` | `f415e22af9e001145875b4bed0a10a3eff005702b8518a6717b862d56fa2995f` | same | exact |
| `canonical_payment_allocations` | `9ecc046dabe1a7dbd0242985472da8a888d0ce8b01193622782c8909d05f7b4d` | same | exact |
| `canonical_receivable_adjustments` | `2998041200786878c727551bc0c0b899eb9071f627cfdc1a96c23bdb510519a5` | same | exact |
| `canonical_approval_requests` | `dc7ebda25e48397c772c0aac5708e30b8f19359b391052f5bb86bc841b09f5a5` | same | exact |

The exact schema-source hashes are PR1
`e81fdc88a8df62a9abf7377113db83708e8f2d8b7c85b0eaa936bba0999a07ac`
and PR2
`ca1fe27d32f3d0394f45117339ee2c1c5a18832d53f2539f71d1ee4fc92d1200`.
PR5–PR8 objects are missing exactly as expected for deployed `6a38582f...`, but
represent expected version drift from current main. No weakening or extra
canonical object was found.

## 14. PR5 production identity state

Evidence `PROD-ID-001`:

- canonical company rows: `0`; branch rows: `0`;
- legacy user aggregate: `13`, but legacy users are not PR5 identity authority;
- memberships, branch scopes, roles, capability catalog, grants/denies,
  bootstrap and authorization-audit tables: missing;
- production company, IANA receivables timezone, Head Office branch, operational
  branches, PR5 memberships and integration/system identities: none;
- deployed canonical trusted resolver is an unconditional `null` function;
- current main also retains a fail-closed `null` production scope adapter.

`PRODUCTION_IDENTITY_AUTHORITY = MISSING` and
`productionIdentityReady = BLOCKED`. No identity/bootstrap row was created.

## 15. PR6 production source authority state

Evidence `PROD-SRC-001`: all sixteen PR6 tables are missing, so activation,
cohorts, source identities, terms, periods/versions, snapshots/evidence, UPDs and
line versions, coverage/supersession/slices, operations and audit counts are all
zero-by-absence. There is no production company/branch scope, source system,
activation state, ownership manifest or authority hash.

Static graph evidence independently shows that current main's isolated PR6 service
has no runtime route/worker consumer and no production adapter configuration.

`PRODUCTION_SOURCE_AUTHORITY = MISSING` and
`productionSourceAuthorityReady = BLOCKED`.

## 16. PR8 production run state

Evidence `PROD-PR8-001`:

| Question | Result |
|---|---|
| Production PR8 schema present | `NO`; all eight tables missing |
| Production runs present | `NO` |
| Run/candidate/check/reconciliation/diagnostic/operation/audit counts | `0` by schema absence |
| Run IDs, policy/input/ownership/result hashes | none |
| Eligible/blocked totals and financial deltas | none |
| Production run executed by this task | `NO` |

`PRODUCTION_PR8_SCHEMA = NOT_DEPLOYED` and
`PRODUCTION_PR8_DRY_RUN_EVIDENCE = MISSING`. Current main's PR8 service remains
isolated from routes, workers and startup; it was not loaded or executed.

## 17. Canonical financial row state

Evidence `PROD-FIN-001` proves zero rows in `canonical_receivables`,
`financial_audit_events`, `canonical_payments`,
`canonical_payment_allocations`, `canonical_receivable_adjustments` and
`canonical_approval_requests`. Earliest/latest timestamps, source systems, actor
types, operation types and company/branch scopes are therefore all empty. There
are no refunds/reversals/write-offs represented by rows and no orphan/audit or
balance invariant can fail on the empty set.

Neither deployed SHA nor current main wires the foundation repositories to a
runtime route, posting adapter, event consumer, queue, worker or scheduler. No
canonical write flag or activation/execution capability exists. Historical
canonical writes: `NO`; current runtime write-path reachability: `NO`.

## 18. Runtime flags and configuration

Evidence `PROD-FLAG-001` is a secret-safe allow-list read plus running-container
environment verification:

| Setting | Production result | Source |
|---|---|---|
| `APP_DISABLED` | explicit `false` | Railway variable + `/api/version` |
| `BOT_DISABLED` | explicit `true` | Railway variable/start log |
| `GSM_ENABLED` | explicit `false` | Railway variable |
| `DB_PATH` | explicit `/data/app.sqlite` | Railway variable + runtime env/log |
| Canonical read flag | absent; deployed default `false`; route `404` | variable allow-list + internal probe |
| Forecast read flag | absent; deployed SHA has no forecast route | variable allow-list + internal probe |
| Canonical trusted resolver | `null` in deployed source | exact deployed source |
| Forecast trusted resolver | not present in deployed SHA; `null` on main | exact source refs |
| PR6 adapter | absent | variable names + dependency graph |
| PR8 policy/execution | absent | variable names + dependency graph |
| Canonical write flag/path | absent | variable names + dependency graph |
| Startup business maintenance | absent | variable allow-list |
| Scheduler/worker/cohort | no PR6/PR8/PR9 implementation | dependency graph |

The running container reports `RAILWAY_GIT_COMMIT_SHA=6a38582f...`. Railway's
configuration-view variable `RAILWAY_GIT_COMMIT_SHA=553d0c31...` is a stale
control-plane/config-view marker and does not override the active deployment,
runtime environment or application marker. This discrepancy is recorded as P2.
No secret value was printed or changed.

## 19. Dependency graph

Evidence `SRC-GRAPH-001` is reproducible at both deployed `6a38582f...` and
`origin/main`:

| Required component | Deployed SHA | Current main |
|---|---|---|
| PR6 repository/runtime service | absent | isolated service; no route/worker consumer |
| PR8 service route/worker | absent | absent |
| Production policy registry/source adapter | absent | absent |
| Eligibility event producer | absent | absent |
| Canonical insertion repository | foundation file, runtime-unreferenced | same |
| Canonical posting adapter | absent | absent |
| Execution/activation capability | absent | absent |
| Canonical write flag | absent | absent |
| PR6/PR8/PR9 scheduler/queue/worker | absent | absent |
| Canonical read route | flag-gated and null-resolver; disabled | same |
| Forecast read route | absent | flag-gated and null-resolver |

This matches the observed fail-closed runtime.

## 20. Before/after no-mutation proof

Evidence `NOMUT-001/002`:

| Signal | Before | After |
|---|---|---|
| Active deployment | `b74623ec...`, `6a38582f...`, `SUCCESS`, created `2026-07-15T07:07:35.262Z` | identical |
| Safe active-status fingerprint | SHA-256 `d16c91dfc6efd721a169761cd6abb944171692ff3471af29804137707e8f2173` | identical SHA-256 |
| Safe environment allow-list fingerprint | SHA-256 `146eb3d634c7d3a667c6aa56905714c5c8ca2e738eed784e91c90bd5ea64b6e8` | identical SHA-256 |
| DB/WAL/SHM SHA-256 | `b487d8a5...` / `35445701...` / `bc2e7b21...` | identical hashes, sizes, inodes and mtimes at `2026-07-21T10:55:20.791Z` |
| Migration rows | app migration v2; PR1 v1; PR2 v1 | identical IDs, versions and timestamps |
| Canonical/settlement counts | eight tables, all `0` | identical: all `0` |
| PR5/PR6/PR7/PR8 tables | all missing | identical: all missing |
| Worktree | clean before intentional docs work | docs-only intentional changes |

The command log proves this task initiated deployments `0`, restarts/redeployments
`0`, environment/flag changes `0`, migrations `0`, inserts `0`, updates `0`,
deletes `0`, PR8 runs `0` and bootstrap operations `0`. Final fingerprints are
captured after documentation and before publication.

## 21. Missing evidence

The inspection result is complete, but these operational/approval items remain
factually missing:

- a successful response through the public Railway ingress;
- PR5 production identity/bootstrap/authorization rows;
- PR6 production source/activation/coverage/operation/audit rows;
- deployed PR7/PR8 schema and qualifying PR8 production evidence;
- a current backup/restore drill and durable retention/legal-hold controls;
- durable product, accounting, tax, legal, security, operations, adapter and
  independent-review approvals required by D-28–D-33.

Negative database findings are `MISSING`, not `NOT ACCESSIBLE`. No missing item is
permission to create data or deploy code.

## 22. Findings by severity

### P0

None. The accessible production database has no canonical financial rows, no PR8
run, no integrity/FK failure, no PR9 code and no reachable canonical write path.

### P1

1. The public production domain repeatedly timed out before HTTP while the running
   container answered internal `/health` and `/api/version` with `200`.

### P2

1. Railway's config-view `RAILWAY_GIT_COMMIT_SHA` is stale relative to the active
   deployment/runtime marker; four independent active-runtime sources agree on
   `6a38582f...`.
2. Backup/restore, retention/legal-hold and complete public-ingress operational
   evidence are missing.
3. The #218/#219 documentation overlap required manual rebase resolution; the
   resulting #219 head requires a fresh independent review.

Expected version drift (PR5–PR8 not deployed) is not classified as unexpected
drift and is not authorization to deploy.

## 23. Updated PRE-PR9 matrix

No field is `TRUE`. Evidence collection does not approve D-28–D-33.

| Field | Value | Evidence / reason |
|---|---|---|
| `architectureDesignApproved` | `BLOCKED` | design recorded in #218; no durable D-28–D-33 approval |
| `productionEvidenceAccepted` | `BLOCKED` | pack complete but not independently accepted; public ingress P1 |
| `productionIdentityReady` | `BLOCKED` | `PROD-ID-001`; PR5 authority missing |
| `productionSourceAuthorityReady` | `BLOCKED` | `PROD-SRC-001`; PR6 schema/authority/adapter missing |
| `productionDryRunExecutionAuthorized` | `BLOCKED` | no schema, capability, registry, activation or approval |
| `productionDryRunEvidenceAccepted` | `BLOCKED` | `PRODUCTION_PR8_DRY_RUN_EVIDENCE = MISSING` |
| `sourceAdapterAuthorityApproved` | `BLOCKED` | no concrete approved adapter |
| `eligibilityProducerAuthorityApproved` | `BLOCKED` | no producer contract/identity/artifact/approval |
| `canonicalPostingAdapterAuthorityApproved` | `BLOCKED` | no posting adapter/identity/artifact/approval |
| `operationalControlsApproved` | `BLOCKED` | public ingress failure; runbook/restore/telemetry approvals incomplete |
| `retentionAndLegalHoldControlsApproved` | `BLOCKED` | restore/retention/legal-hold approvals missing |
| `canonicalWriteContractApproved` | `BLOCKED` | durable D-30 approval missing |
| `pr9ImplementationAuthorized` | `FALSE` | explicit PRE-PR9 boundary |
| `pr9DisabledDeploymentAuthorized` | `FALSE` | no separate durable approval |
| `productionCanonicalWritesAuthorized` | `FALSE` | no authority/activation/approval |
| `canonicalProductionReadsAuthorized` | `FALSE` | routes disabled/absent; no read approval |
| `settlementAuthorized` | `FALSE` | PR2 foundation only |
| `backfillAuthorized` | `FALSE` | explicitly unauthorized |
| `dualWriteAuthorized` | `FALSE` | explicitly unauthorized |
| `shadowReadAuthorized` | `FALSE` | explicitly unauthorized |
| `cutoverAuthorized` | `FALSE` | explicitly unauthorized |

## 24. Exact blockers

Confirmed blockers are: no deployed PR5 identity authority; no deployed PR6
source authority or adapter; no deployed PR8 schema or production run evidence; no
producer/posting identities or artifacts; no capability catalog v2, execution or
activation capability; no canonical-write contract/flag/path; public ingress
failure; missing restore/retention controls; and absent durable D-28–D-33 product,
accounting, tax, legal, security, operations, adapter and reviewer approvals.

Any one is sufficient to deny PR9. Zero canonical rows and a healthy database do
not remove these blockers.

## 25. Next permitted step

The Railway project owner should restore public HTTPS ingress for the existing
deployment `b74623ec...` without changing code, schema or feature flags, then attach
a fresh external `GET`/`HEAD` health/version/auth-boundary capture to this evidence
pack. This does not authorize PR9 or deployment of current main.

## Local repository verification

Local verification after the final evidence capture passed:

- `npm test`: `2338` tests passed, `0` failed;
- `npm run build`: Vite production build completed successfully;
- `git diff --check HEAD`: passed;
- changed-file scope: the four expressly allowed documentation files only;
- historical PR4–PR8 audit files, source, schema, migrations, tests, workflows,
  package manifests and lockfiles: unchanged.

These checks prove repository integrity only; they are not production evidence or
authorization.

## Evidence register

Every record is secret-safe. Database identity means DB SHA-256 `b487d8a5...` with
WAL `35445701...` unless stated otherwise.

| Evidence ID | Classification | Source | Timestamp UTC | Environment / SHA | DB identity | Command/query class | Redacted result | Reproducibility | Status |
|---|---|---|---|---|---|---|---|---|---|
| `REP-001` | repository lineage | local Git/GitHub | `2026-07-21T10:25:57Z` | repo / main `c3b20fcb...` | n/a | fetch/status/log reads | main and merge lineage verified | reproducible | PASS |
| `REP-002` | PR status | GitHub app/CLI | final `2026-07-21T13:21:33Z` | repo | n/a | PR metadata GET + authorized squash merge | #218 merged as `7892ea68...`; check passed; no auto-merge | reproducible | PASS |
| `RWY-AUTH-001` | authentication | Railway CLI/OAuth | `2026-07-21` | production / `6a38582f...` | n/a | official login/whoami | authenticated identity redacted | reproducible for authorized operator | PASS |
| `RWY-LINK-001` | linked identities | Railway status | `2026-07-21` | production / `6a38582f...` | n/a | metadata GET | exact project/env/service/region | reproducible | PASS |
| `DEP-001/002` | active deployment | GitHub + Railway + runtime | `2026-07-21` | production / `6a38582f...` | n/a | metadata/log/env/GET | deployment, image, runtime and marker agree | reproducible | PASS |
| `HTTP-INT-001` | internal safe probes | running container | `2026-07-21T10:49:37.899Z` | production / `6a38582f...` | n/a | unauthenticated GET | `200/200/401/404/404` | reproducible | PASS |
| `HTTP-EXT-001` | public safe probes | curl | `2026-07-21T10:21:32Z` + retry | production / `6a38582f...` | n/a | GET/HEAD | connect timeout, no HTTP | independently retryable | FAIL |
| `DB-ID-001` | database identity | volume/runtime | `2026-07-21T10:35:17Z` | production / `6a38582f...` | DB/WAL/SHM hashes | stat/df/hash reads | exact path, volume, size, hashes | reproducible | PASS |
| `DB-INT-001` | integrity | read-only SQLite | `2026-07-21T10:42:28.352Z` | production / `6a38582f...` | `b487d8a5...` | read-only PRAGMA | query-only, FK and integrity pass | reproducible | PASS |
| `DB-MIG-001` | migration registry | read-only SQLite | `2026-07-21T10:41:52.029Z` | production / `6a38582f...` | `b487d8a5...` | SELECT | app v2 + PR1/PR2 v1 only | reproducible | PASS |
| `DB-COUNT-001` | row counts | read-only SQLite | `2026-07-21T10:41:52.029Z` | production / `6a38582f...` | `b487d8a5...` | sqlite_master/COUNT/aggregate SELECT | canonical zero; PR5–PR8 missing | reproducible | PASS |
| `DB-SCHEMA-001` | production structure | read-only SQLite + local source | `2026-07-21T10:45:32.064Z` | production / `6a38582f...` | `b487d8a5...` | sqlite_master/PRAGMA/hash | all PR1/PR2 fingerprints exact | reproducible | PASS |
| `PROD-ID-001` | PR5 identity | DB + deployed graph | `2026-07-21` | production / `6a38582f...` | `b487d8a5...` | SELECT/static read | authority schema/rows missing; resolver null | reproducible | MISSING |
| `PROD-SRC-001` | PR6 authority | DB + source graph | `2026-07-21` | production / `6a38582f...` | `b487d8a5...` | SELECT/static read | 16 tables/adapter missing | reproducible | MISSING |
| `PROD-PR8-001` | PR8 evidence | DB + source graph | `2026-07-21` | production / `6a38582f...` | `b487d8a5...` | SELECT/static read | schema not deployed; no run | reproducible | MISSING |
| `PROD-FIN-001` | canonical writes | read-only DB + graph | `2026-07-21` | production / `6a38582f...` | `b487d8a5...` | COUNT/static read | all financial tables zero; writer unreachable | reproducible | PASS |
| `PROD-FLAG-001` | runtime flags | variables/env/source | `2026-07-21` | production / `6a38582f...` | n/a | allow-list/env/static read | reads disabled; adapters/writes absent | reproducible | PASS |
| `SRC-GRAPH-001` | dependency graph | local Git | `2026-07-21` | deployed/main refs | n/a | static import/route search | no PR6/PR8/PR9 execution path | reproducible | PASS |
| `NOMUT-001/002` | no mutation | command log + before/after | final `2026-07-21T10:55:20.791Z` | production / `6a38582f...` | identical DB/WAL/SHM hashes | read-only metadata/SELECT | deployment/config/migrations/counts/files unchanged | reproducible | PASS |

## Explicit answers

- PR9 implemented: `NO`.
- PR9 implementation authorized: `NO`.
- PR9 disabled deployment authorized: `NO`.
- Production PR8 dry run executed by this task: `NO`.
- Production canonical writes authorized: `NO`.
- Canonical production reads authorized: `NO`.
- Settlement authorized: `NO`.
- Backfill authorized: `NO`.
- Dual write authorized: `NO`.
- Shadow read authorized: `NO`.
- Cutover authorized: `NO`.
- Production mutations performed: `NO`.
- `PR9_IMPLEMENTATION_AUTHORIZED = FALSE`.
- `PRODUCTION_CANONICAL_WRITES_AUTHORIZED = FALSE`.
