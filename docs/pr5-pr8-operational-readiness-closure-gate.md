# PR5–PR8 operational readiness closure gate

## 1. Status

**Status:** `FOUNDATION_DEPLOYMENT_BLOCKED`

**Evaluated:** `2026-07-22`; cleanup independently verified `2026-07-23`

**Repository baseline:** `1d59992315f1b7f4ff2d370fc17345a459ac52e3`

**Foundation deployment performed:** `NO`

**Foundation deployment authorized:** `NO`

**Production activation authorized:** `NO`

**PR9 implementation authorized:** `NO`

PR #223 reviewed head `1a5dfee9dcd42f28b189017361a3223aeef9d25c`
was independently reconfirmed and squash-merged as
`1d59992315f1b7f4ff2d370fc17345a459ac52e3` on
`2026-07-22T11:26:06Z`. The public-ingress blocker is closed, the migration,
repeated-startup, failure-matrix and previous-code compatibility evidence remains
successful, and no runtime source changed after the #221 remediation.

The remaining operational conditions are not closed. There is no current,
durable, independently verifiable and owner-approved production backup; no accepted
restore drill; no approved storage threshold/reserve; no built and owner-approved
pinned foundation image; no approved post-deployment smoke record; and no durable
owner/release authorization. Any one is sufficient to deny deployment.

## 2. Scope and fail-closed boundary

This gate evaluates only operational evidence needed before a possible future
PR5–PR8 foundation deployment. It uses repository/GitHub metadata, read-only
Railway metadata, read-only volume listings, read-only SQLite inspection of
existing historical backup files, and the already reviewed local migration/restore
evidence.

This work did **not** deploy or restart production; change Railway configuration,
domains, variables or network; create a production backup; restore a database; run
a production initializer or migration; bootstrap identity; populate PR6; calculate
PR7; execute PR8; enable canonical/forecast reads; create canonical or settlement
writes; switch a consumer; implement PR9; or grant approval. The new and updated
repository files are documentation only. Section 4.3 records an unintended SQLite
sidecar-file creation on one historical backup and the later exact manual cleanup.
The incident changed no live database, backup payload or business row; the two
sidecars are now absent and the strict post-cleanup production-volume baseline has
been restored.

The prompt requesting this evaluation is authority to inspect and document, not an
owner, release, operations, database, security or product approval record. Missing
or ambiguous approval remains deny.

## 3. Current production baseline

Read-only baseline evidence was captured on `2026-07-22`. Cleanup-specific
read-only verification on `2026-07-23` reconfirmed the protected volume,
database-file, runtime and configuration rows below:

| Item | Value |
|---|---|
| Project / environment / service | `cooperative-vitality` / `production` / `rental-management` |
| Deployment / instance | `b74623ec-d20d-4c50-ab40-0e0a494c5bc5` / `54afd747-1bd1-4069-9320-31e03db1f5ea`; running |
| Deployed source | `6a38582f5f90b85734884b6b12ad8e306b24619e` |
| Deployed image | `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650` |
| Runtime / build | Node `v20.18.1`; npm `10.8.2`; Nixpacks; runtime V2 |
| Placement | `europe-west4-drams3a`; one replica; `/data` mount |
| Database | `/data/app.sqlite`; DB `11,927,552`, WAL `7,453,112`, SHM `32,768` bytes |
| Schema/data boundary | shadow v2 plus PR1/PR2 v1 only; PR5–PR8 not deployed; all eight canonical/settlement tables empty |
| Public/internal health | prior accepted `2026-07-22` evidence: `200` for `/health` and `/api/version`; public GET/HEAD evidence applies to ingress readiness only |
| Cleanup runtime/config | deployment and replica unchanged; startup `2026-07-15T07:09:34.047Z`; canonical raw 33-variable comparison fingerprint `0f23a29e44e7729e37c2e7420619db16980bb3e640d15352babf7dfc97d44816` unchanged |

The active deployment, source and database boundary are evidence inputs. They were
not changed by this gate.

## 4. Backup closure

### 4.1 Mechanism

The deployed PR3 source contains the admin-only
`GET /api/admin/backup/full` mechanism. It creates a temporary ZIP containing a
consistent SQLite snapshot, manifest, build/count metadata and local files, sends
the archive to the authenticated administrator and deletes the server-side
temporary archive. `GET /api/admin/backup/history` exposes a limited audit history;
it is not an artifact store. Repository operations guidance says the operator must
place the download in restricted owner/company storage, but it defines no approved
destination, retention, encryption, checksum registry, RPO/RTO or responsible
backup owner.

The production audit collection contains one backup-download event:

| Generated at | Filename | Size | Contents signal | Operator signal |
|---|---|---:|---|---|
| `2026-06-24T05:46:53.512Z` | `skytech-backup-2026-06-24-05-45.zip` | `437,708,259` bytes | 61 collections; 1,517 files | administrator event; redacted actor reference `b2a48d5987f0fbe5` |

That event proves generation/download only. The archive is not present on the
Railway volume, its current existence and destination are unknown, no checksum is
recorded, and no encryption/access/retention/owner approval is linked. It predates
the July PR1/PR2 production migrations and is not a current foundation-deployment
backup.

### 4.2 Existing volume artifacts and independent integrity read

Three historical SQLite copies exist on the same production volume. They were
opened with `readonly=true`, `fileMustExist=true` and `query_only=ON`; no WAL
checkpoint, repair or SQL write was requested. The filesystem side effect from one
WAL-mode open is recorded separately in section 4.3.

| Artifact | Timestamp | Size | SHA-256 | Integrity / FK | Registry / scope |
|---|---|---:|---|---|---|
| `/data/backups/app-before-test-reset-2026-06-14-10-02-07.sqlite` | `2026-06-14T10:02:07.670Z` | `11,927,552` | `444d7b28ebdbe9f2bddaa8553ebf3243a8a920853e7d1f646af01d4fa0c05c4b` | `ok` / 0 | shadow v2 only; 47 `app_data` rows |
| `/data/app.sqlite.backup-before-action-execution-rollout-20260521-040225.sqlite` | `2026-05-21T04:02:25.694Z` | `11,276,288` | `c4586ca1206da11cbf6cbd6eb88760f1643efb42970a3aaa905f2810356088b9` | `ok` / 0 | shadow v2 only; 47 `app_data` rows |
| `/data/backups/app-sql-shadow-documents-20260516T193957Z.sqlite` | `2026-05-16T19:39:57.151Z` | `10,399,744` | `9372ad7348a22e3c7ba6ec81c519db66613abfcea612aa5eed6099a33a8079d9` | `ok` / 0 | shadow v2 only; 47 `app_data` rows |

All three have schema fingerprint
`54ec2be714629c89d9861b081000b90af232959d225e1aaec36a0c2791d5968e`;
their companion WAL files are empty. They are internally readable, but they are
stale, incomplete for the current production schema/data, colocated with the live
database and therefore share its failure domain. None has approved retention,
encryption/access evidence or a named responsible owner.

The mechanism and historical artifacts do not satisfy the qualifying definition
of an approved, current, durable and independently recoverable backup.

`backupAvailable = FALSE`.

### 4.3 Read-only sidecar incident

Opening the May 21 historical backup with SQLite `readonly=true` still caused
SQLite's WAL-mode shared-memory handling to create two previously absent companion
files at `2026-07-22T11:28:32Z`:

- `/data/app.sqlite.backup-before-action-execution-rollout-20260521-040225.sqlite-wal`,
  size `0`, SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`;
- `/data/app.sqlite.backup-before-action-execution-rollout-20260521-040225.sqlite-shm`,
  size `32,768`, SHA-256
  `fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb`.

The Railway CLI refused agent deletion and required a human operator. No safety
guard was bypassed. The operator later deleted exactly those two paths, without a
glob or broader volume operation. A read-only root listing on `2026-07-23`
confirmed that both paths are absent. The remaining root entries are exactly the
live DB/WAL/SHM, the unchanged May 21 backup, and the pre-existing `backups`,
`lost+found` and `uploads` directories; no unexpected root entry is present. The
root directory inode remains `2`; its cleanup mtime is
`2026-07-23T15:51:05.903726049Z`.

| Artifact | Inode | Size | Mtime | Before SHA-256 | After SHA-256 / state |
|---|---:|---:|---|---|---|
| `/data/app.sqlite` | 13 | 11,927,552 | `2026-07-15T07:16:56.915091367Z` | `b487d8a5534665aa896a8eea1788342b16969c2e10441e3857296505c3c7cf2b` | same exact hash |
| `/data/app.sqlite-wal` | 14 | 7,453,112 | `2026-07-15T17:09:34.230828238Z` | `35445701ec00718d8c7c8adfee013580b964b4aa8c6c4063bf10c1b67f491e38` | same exact hash |
| `/data/app.sqlite-shm` | 15 | 32,768 | `2026-07-15T18:09:34.259223202Z` | `bc2e7b214d1a4f19c928d82f452e316c8a61ab75f6646613cea34b7ba32be8c1` | same exact hash |
| `/data/app.sqlite.backup-before-action-execution-rollout-20260521-040225.sqlite` | 1,645 | 11,276,288 | `2026-05-21T04:02:25.694084219Z` | `c4586ca1206da11cbf6cbd6eb88760f1643efb42970a3aaa905f2810356088b9` | same exact hash |
| exact historical-backup `-wal` sidecar | 1,649 | 0 | `2026-07-22T11:28:32.784864697Z` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `ABSENT` |
| exact historical-backup `-shm` sidecar | 1,650 | 32,768 | `2026-07-22T11:28:32.789116707Z` | `fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb` | `ABSENT` |

No SQLite API or command was used for cleanup verification. Because the complete
live DB/WAL/SHM byte set, inode, size and mtime match the previously accepted
read-only capture, its schema fingerprint
`53a3c1cb87935323cc165575ce3574184d77c4169a723b54e32aa9af1b101e46`,
migration registry and business counts remain unchanged. Canonical and settlement
rows, PR5 business identity rows and every PR6, PR7 and PR8 row remain `0`.
Internal `/api/version` independently reported the same deployment
`b74623ec-d20d-4c50-ab40-0e0a494c5bc5`, source
`6a38582f5f90b85734884b6b12ad8e306b24619e`, replica
`54afd747-1bd1-4069-9320-31e03db1f5ea`, production environment and original
startup timestamp. There was no restart, redeploy, variable, flag, code, database
or business-data change.

`productionVolumeMutationCleanup = COMPLETE`.

## 5. Restore drill closure

The prior readiness work documented a local, disposable rehearsal rather than a
production restore:

- coherent production-derived source artifact SHA-256
  `f196accf243748133c59e69ab6c5a64d865b32e79778b2447c1603c701ed0774`;
- raw target initially matched the source; migrated target SHA-256
  `43139a34049441c1fb120dfa925a3fbea898dfc013a897e1c98fc654f97f4083`;
- the #221 repeated-start evidence produced final schema fingerprint
  `466ce614c48d27b0d25ac2e38706d9cc74c8793d79fd1806c11cdb3f65a10a81`;
- SQLite integrity/quick checks were `ok`, foreign-key violations were `0`, the
  exact shadow/PR1/PR2/PR5–PR8 migration registry was present, 63 legacy
  `app_data` rows were conserved and all authority/source/run/financial business
  counts remained `0`;
- current foundation source started successfully, and previous production SHA
  `6a38582f5f90b85734884b6b12ad8e306b24619e` accepted the additive schema without
  deleting unknown tables or registrations.

A qualifying independent drill must start from the exact approved durable backup,
verify its checksum and manifest, restore it to an isolated non-production target,
verify files and SQLite integrity/FKs, compare the approved schema and migration
registry, start both the previous production artifact and the proposed foundation
artifact, execute the approved read-only smoke, record RPO/RTO and deletion of the
temporary target, and carry named operator plus owner acceptance.

No qualifying source artifact or owner-accepted drill exists, and no production
restore was attempted.

`restoreDrillPassed = FALSE`.

## 6. Storage closure

| Measurement | Evidence |
|---|---:|
| Railway configured volume | `1,000 MB`; production volume `48b8768c-a8a9-4a87-8a4b-b980fff5d00c` |
| Filesystem total | `921,432,064` bytes |
| Used | `481,689,600` bytes |
| Free / available to application | `439,742,464` / `422,965,248` bytes |
| Railway current-size metric | `565.248 MB` |
| PR5–PR8 logical database growth in simulation | `970,752` bytes |
| Observed migration WAL peak | `1,112,432` bytes |
| SHM allowance | `32,768` bytes |
| Current DB-only snapshot size | `11,927,552` bytes |
| Raw DB snapshot + WAL peak + SHM subtotal | `13,072,752` bytes |
| Observed full-backup archive size | `437,708,259` bytes |

The raw subtotal is not a safety threshold. A full backup materially exceeds the
DB-only estimate because it includes local files. Required retention generations,
off-volume destination capacity, restore workspace, concurrent WAL growth,
application growth rate, emergency reserve, alert levels and stop threshold have
no approved numerical policy. Current free space does not substitute for approval.

`storageCapacityAccepted = BLOCKED`.

## 7. Pinned artifact closure

The only source SHA currently eligible for later owner approval is
`1d59992315f1b7f4ff2d370fc17345a459ac52e3`, never floating `main`, a branch name
or `latest`. `origin/main` was independently reconfirmed at that exact SHA on
`2026-07-23`. Its diff from the #221 runtime remediation merge
`bbabfdc0bff89953ff746b9a09e0d38147e83085` contains only the four #222/#223
Markdown files, so its runtime tree is the reviewed #221 tree. Designating a
candidate is not release approval.

### 7.1 Candidate release manifest

| Field | Required exact candidate value / state |
|---|---|
| Candidate source SHA | `1d59992315f1b7f4ff2d370fc17345a459ac52e3`; `candidateSourceShaApproved = FALSE` |
| Expected image digest | `UNSET / NOT BUILT`; approval requires one immutable lowercase `sha256:<64-hex>` digest built only from the candidate SHA; floating tag comparison is forbidden |
| Build contract | Nixpacks, runtime V2, root plus `/server` dependency installs with `npm ci`, start `node scripts/start-with-release-type.cjs` |
| Exact target Node/npm | Node `v20.18.1`; npm `10.8.2`; build output and `/api/version` must record both before approval |
| Ordered migration set | `documents_gantt_shadow_indexes` v2; `canonical_receivables_pr1_schema` v1; `canonical_receivables_pr2_settlement` v1; `platform_identity_pr5` v1; `billing_source_authority_pr6` v1; `forecast_receivables_planning_pr7` v1; `actual_source_eligibility_dry_run_pr8` v1 |
| Ordered migration-set hash | `e8c207bef0b157b058fa56fa594f3e5c697bcdb60c3b5c75834b357f79b282da` |
| Safe config fingerprint reference | `146eb3d634c7d3a667c6aa56905714c5c8ca2e738eed784e91c90bd5ea64b6e8`; secret-free approved-key/value boundary from the readiness evidence |
| Environment comparison reference | 33-variable raw-value canonical hash `0f23a29e44e7729e37c2e7420619db16980bb3e640d15352babf7dfc97d44816`; hash only, never raw secret values |
| Root package / lock | `78cd0bb5474cae32ff9cd77b3087d7b1ab720819d1ba967a9250e90b23694c2f` / `064721ed5c462a0561adfd50cbdbb08ea0cba4fb128ff0d5d43e2324fe355fd3` |
| Server package / lock | `fd9826dab816540813841353f581ce3644e058a88b1e70740ae1ca2e164809cd` / `faaf55b6718804ba2814ef0b02e8664a2b38278413a8c81dba74df94861db4d8` |
| `server/db.js` / shadow initializer | `f3fb2ad911e99ac17ee26f7e6520ad5a5c3f4fdb8bffaf79303e42f09938d25f` / `49a7a36105b99a36e994074ddc4b3c844d694f2ae377ba8435fc519f35cf9ac6` |
| Candidate approval owner | `MISSING`; one named release owner must approve the complete source/image/build/migration/config manifest, with named operations co-approval |

### 7.2 Rollback artifact

The application rollback target is the current proven production artifact, not a
floating deployment: source `6a38582f5f90b85734884b6b12ad8e306b24619e`, image
`sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650`
and deployment `b74623ec-d20d-4c50-ab40-0e0a494c5bc5`. Rollback means application
artifact rollback only; the previously verified additive foundation schema is
retained. The rollback owner, command/runbook, stop authority and acceptance
evidence are `MISSING / NOT APPROVED`.

No candidate image digest or named approval record exists. A later build does not
approve itself, and neither this document nor PR #224 is an owner decision.

`pinnedArtifactCandidateDefined = TRUE`.

`pinnedArtifactApproved = FALSE`.

## 8. Post-deployment smoke closure

`pr5-pr8-foundation-post-deployment-smoke-v1` is the proposed minimum read-only
acceptance plan for a separately authorized future foundation deployment. It is
defined now but not approved, and no deployment-dependent check was executed by
this docs-only gate.

| Area | Required check | Exact pass condition | Failure action / evidence owner |
|---|---|---|---|
| Deployment identity | Railway deployment metadata plus `/api/version` | exact approved source SHA, deployment ID and immutable image digest; no branch or tag substitution | P0 stop; signed release capture; release owner |
| Deployment placement | metadata for runtime V2, Node/npm, replica, region and `/data` mount | approved Node `v20.18.1`, npm `10.8.2`, one approved replica in `europe-west4-drams3a` | P0/P1 stop; metadata JSON; operations owner |
| Runtime health | internal and public GET/HEAD `/health` and `/api/version`; startup/log review | independent HTTP 200, one deployment/version marker, valid TLS, no crash/restart loop or migration error | P1 stop; timestamped probes/log extract; operations owner |
| Auth boundary | unauthenticated `/api/auth/me` and protected-route probes | expected 401/403; never 200 or secret-bearing output | P0 stop; redacted transcript; security owner |
| DB integrity | read-only/query-only `foreign_key_check`, `integrity_check`, `quick_check` | 0 FK rows; `ok`; `ok`; no checkpoint, vacuum or write | P0 stop; redacted transcript; database owner |
| DB schema/count conservation | approved normalized `sqlite_master` fingerprint plus before/after count allow-list | exact approved schema hash; all 63 legacy `app_data` collections conserved; no unauthorized business delta | P0 stop; hash/count record; database/release owners |
| Migration registry | ordered read of `sql_shadow_schema_migrations` | exact seven-row ordered set in section 7.1; original shadow/PR1/PR2 timestamps retained and PR5–PR8 each present once with approved timestamps | P0/P1 stop; registry CSV/hash; release owner |
| Repeated-start evidence | only under a separately approved controlled restart window | registry/schema/counts unchanged and exact `documents_gantt_shadow_indexes.applied_at` preserved | P1 stop; signed before/after diff; operations owner |
| PR5 identity | read-only roots, memberships, branch access, roles, grants, audit, bootstrap and resolver checks | catalog 1/11 only; company/branch/authority/bootstrap rows `0`; trusted resolver `null` | P0 stop; count JSON; security/identity owner |
| PR6 source | read-only counts of all 16 PR6 tables and deployed import/route/worker graph | all rows `0`; no adapter, population, route, worker or consumer | P0 stop; count/import transcript; source owner |
| PR7 forecast | read-only counts of all 8 PR7 tables, route/resolver and import graph | all rows `0`; no calculation/run/consumer; forecast read unavailable and resolver `null` | P0 stop; count/probe transcript; finance owner |
| PR8 diagnostic | read-only counts of all 8 PR8 tables and route/import graph | all rows `0`; no policy registry, execution or dry run | P0 stop; count/import transcript; source/security owners |
| Canonical reads | canonical/forecast flag inventory, resolver and unauthenticated route probes | flags absent/default false; both resolvers `null`; routes unavailable | P0 stop; config hash and probe transcript; security owner |
| Canonical writes | deployed import/route/worker graph plus eight canonical/settlement counts | write path absent; all eight financial tables remain `0` | P0 stop; count/import transcript; accountant/release owner |
| Consumers | deployed artifact manifest and UI smoke for Finance, Dashboard and Company Health/Risks | no consumer switch or canonical/forecast projection | P0 stop; manifest/screenshots; product owner |

Approval requires one immutable plan record binding the exact artifact manifest,
commands, evidence destination/retention, named release/operations/database/
security/product owners, change window, P0/P1 stop rules and application-only
rollback target. All required approval identities and signatures are currently
missing. A smoke run cannot approve the plan retroactively.

`postDeploymentSmokePlanDefined = TRUE`.

`postDeploymentSmokeApproved = FALSE`.

## 9. Owner and release approval

No durable record names and binds the product owner, release owner, operations
owner, database/backup owner and security/identity owner to the exact source/image,
backup checksum/destination, restore evidence, storage threshold/reserve and smoke
plan. PR #223 had no comments, reviews or unresolved threads and granted no
approval. Repository design records explicitly say missing approval is deny.

`ownerReleaseApprovalRecorded = FALSE`.

## 10. Authorization matrix

| Field | Value | Closure reason |
|---|---|---|
| `backupAvailable` | `FALSE` | mechanism and stale artifacts exist; no current durable approved artifact/checksum/destination/owner |
| `restoreDrillPassed` | `FALSE` | local rehearsal passed technically but no approved backup or named independent acceptance |
| `storageCapacityAccepted` | `BLOCKED` | measurements exist; threshold, reserve, retention and restore workspace are unapproved |
| `pinnedArtifactCandidateDefined` | `TRUE` | exact source, build/runtime, migration, fingerprint and rollback contract is defined; image digest and named approval remain missing |
| `pinnedArtifactApproved` | `FALSE` | exact source candidate exists; image digest/build manifest and approval are missing |
| `postDeploymentSmokePlanDefined` | `TRUE` | complete fail-closed deployment/runtime/DB/PR5–PR8/canonical checklist and approval contract is defined |
| `postDeploymentSmokeApproved` | `FALSE` | checklist exists; no named approval and deployment-dependent checks were not run |
| `ownerReleaseApprovalRecorded` | `FALSE` | no durable scoped owner/release/operations decision |
| `productionVolumeMutationCleanup` | `COMPLETE` | exact two sidecars are absent; root listing and unchanged live/backup hashes, metadata, runtime and config independently verified |
| `foundationDeploymentAuthorized` | `FALSE` | one or more prerequisites are false/blocked; no authorization record |
| `productionActivationAuthorized` | `FALSE` | explicitly outside foundation delivery |
| `pr9ImplementationAuthorized` | `FALSE` | explicitly outside this gate |

## 11. Verification

| Check | Result |
|---|---|
| `git diff --check` | `PASS` |
| `npm test` | `PASS`; 2,343 tests passed, 0 failed |
| `npm run build` | `PASS`; production Vite build completed |
| Changed-file allow-list | `PASS`; this branch changes only this document and `docs/pr5-pr8-foundation-deployment-readiness-gate.md` |
| Runtime-code diff | `NONE` |
| Production deployment / restart / configuration change | `NONE` |
| Production live DB, WAL, SHM, schema, registry or business-data mutation | `NONE`; exact checksums and boundaries remained unchanged |
| Strict post-cleanup production-volume baseline | `PASS`; exact sidecars are absent, expected root entries remain and all protected file hashes/metadata are unchanged |

The temporary sidecar-file incident is closed. Its exact creation and deletion
remain recorded for audit, while the verified post-cleanup volume contains no
unintended root file and the protected database/application state is unchanged.

## 12. Result and next permitted step

`FOUNDATION_DEPLOYMENT_BLOCKED`.

The exact remaining blockers are:

1. no current durable approved production backup;
2. no independently accepted restore drill from that backup;
3. no approved storage threshold and operational reserve;
4. no approved immutable image/build/config artifact manifest;
5. no approved post-deployment smoke procedure;
6. no durable owner/release/operations authorization.

**One next permitted step:** conduct the final owner/release operational review,
beginning with creation and approval of a fresh current off-volume backup and its
independent restore evidence, then evaluate storage, artifact, smoke and owner
approvals. This is a readiness review, not deployment authority.
