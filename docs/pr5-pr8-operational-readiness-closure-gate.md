# PR5–PR8 operational readiness closure gate

## 1. Status

**Status:** `FOUNDATION_DEPLOYMENT_BLOCKED`

**Evaluated:** `2026-07-22`

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
repository files are documentation only. Section 4.3 separately records an
unintended SQLite sidecar-file creation on one historical backup and the blocked
cleanup; it changed no live database, backup payload or business row, but means a
strict claim of zero production-volume file mutation cannot yet be made.

The prompt requesting this evaluation is authority to inspect and document, not an
owner, release, operations, database, security or product approval record. Missing
or ambiguous approval remains deny.

## 3. Current production baseline

Read-only evidence captured on `2026-07-22` reconfirmed:

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
| Public/internal health | `200` for `/health` and `/api/version`; public GET/HEAD evidence accepted for ingress readiness only |

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
guard was bypassed. Raw file reads reconfirmed that the historical backup payload
remained exact SHA-256 `c4586ca1...`, and the live DB/WAL/SHM remained exact
`b487d8a5...` / `35445701...` / `bc2e7b21...`, matching the pre-gate evidence.
Thus there was no live SQLite, schema, registry or business-data mutation, but the
two inert sidecars remain a production-volume file mutation pending human cleanup.

`productionVolumeMutationCleanup = BLOCKED`.

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

The exact proposed source candidate is
`1d59992315f1b7f4ff2d370fc17345a459ac52e3`, never floating `main` or
`latest`. The diff from the #221 runtime remediation merge
`bbabfdc0bff89953ff746b9a09e0d38147e83085` to this candidate contains only four
Markdown files, so its runtime tree is the reviewed #221 tree.

| Component | Candidate value |
|---|---|
| Source SHA | `1d59992315f1b7f4ff2d370fc17345a459ac52e3` |
| Image digest | `MISSING / NOT BUILT`; the current PR3 image digest is not reusable |
| Build | Nixpacks; Node `20.x`; `npm ci`; root `/server`; start `node scripts/start-with-release-type.cjs` |
| Target runtime | production reference Node `v20.18.1`, npm `10.8.2`; exact built values must be captured |
| Migration set | shadow v2, PR1 v1, PR2 v1, then PR5 v1, PR6 v1, PR7 v1, PR8 v1 |
| Ordered migration-set hash | `e8c207bef0b157b058fa56fa594f3e5c697bcdb60c3b5c75834b357f79b282da` |
| Safe existing-config fingerprint | `146eb3d634c7d3a667c6aa56905714c5c8ca2e738eed784e91c90bd5ea64b6e8` |
| Root package / lock | `78cd0bb5...` / `064721ed...` |
| Server package / lock | `fd9826da...` / `faaf55b6...` |
| `server/db.js` / shadow initializer | `f3fb2ad9...` / `49a7a361...` |
| PR5 / PR6 / PR7 / PR8 schema source | `88ff3120...` / `621c8534...` / `dbb3005f...` / `e37e4fbd...` |

The source candidate is identified, but no immutable image was built for it and no
owner/release record approves the source, image, build/runtime manifest, migration
set or configuration fingerprint. Building later does not imply approval.

`pinnedArtifactApproved = FALSE`.

## 8. Post-deployment smoke closure

The following checklist is the minimum read-only verification for a separately
authorized future foundation deployment. Its existence is not approval and none of
the deployment-dependent rows was executed by this gate.

| Area | Required check | Exact expected result |
|---|---|---|
| Deployment SHA | Railway metadata plus `/api/version` | approved exact source SHA, never floating `main` |
| Image | Railway deployment metadata | approved immutable image digest exactly matches release record |
| Runtime | metadata and `/api/version` | approved Node/npm/build/start command |
| Replica / region | Railway metadata | one approved replica in `europe-west4-drams3a` |
| Database migrations | read-only ordered registry query | shadow/PR1/PR2 retained; exact PR5–PR8 v1 rows added once with approved timestamps |
| Database integrity | `foreign_key_check`, `integrity_check`, `quick_check` | 0 / `ok` / `ok` |
| Database schema | normalized `sqlite_master` fingerprint | exact approved post-migration fingerprint |
| Database counts | before/after allow-list | 63 legacy collections conserved; no unauthorized business-row delta |
| PR5 identity | roots, memberships, access, roles, grants, audit, bootstrap | catalog 1/11 only; company/branch/authority/bootstrap rows `0` |
| PR5 resolver | runtime path/read probe | production trusted resolver remains `null`; no read authorization |
| PR6 | 16 source tables and runtime import graph | every row count `0`; no adapter, route, worker or population |
| PR7 | 8 planning tables and runtime import graph | every row count `0`; no calculation, run, consumer or enabled read |
| PR8 | 8 diagnostic tables and runtime import graph | every row count `0`; no policy registry, execution or dry run |
| Canonical reads | route and flag/resolver evidence | flags absent/default false; canonical and forecast routes remain unavailable |
| Canonical writes | deployed import/route/worker graph and financial counts | write path absent; all eight canonical/settlement tables remain `0` |
| Consumers | deployed artifact/UI smoke | no Finance, Dashboard or Company Health/Risks switch |

Any P0 discrepancy stops acceptance and rolls back only the application artifact,
retaining additive schema; any P1 leaves readiness unaccepted and invokes the
approved incident procedure. No named owner has approved this checklist, its
commands, evidence retention or rollback/stop authority.

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
| `pinnedArtifactApproved` | `FALSE` | exact source candidate exists; image digest/build manifest and approval are missing |
| `postDeploymentSmokeApproved` | `FALSE` | checklist exists; no named approval and deployment-dependent checks were not run |
| `ownerReleaseApprovalRecorded` | `FALSE` | no durable scoped owner/release/operations decision |
| `productionVolumeMutationCleanup` | `BLOCKED` | two inert historical-backup sidecars require human deletion and listing verification |
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
| Strict production-volume file mutation check | `BLOCKED`; the two inert historical-backup sidecars in section 4.3 remain pending human cleanup |

The gate therefore does not claim an unqualified zero-mutation result. The
sidecar-file incident is fail-closed even though it did not change the active
database, application, deployment, configuration or business state.

## 12. Result and next permitted step

`FOUNDATION_DEPLOYMENT_BLOCKED`.

The exact remaining blockers are:

1. cleanup of the two inert historical-backup sidecars is not yet verified;
2. no current durable approved production backup;
3. no independently accepted restore drill from that backup;
4. no approved storage threshold and operational reserve;
5. no approved immutable image/build/config artifact manifest;
6. no approved post-deployment smoke procedure;
7. no durable owner/release/operations authorization.

**One next permitted step:** a human Railway operator must delete exactly
`/app.sqlite.backup-before-action-execution-rollout-20260521-040225.sqlite-wal`
and
`/app.sqlite.backup-before-action-execution-rollout-20260521-040225.sqlite-shm`
from volume `rental-management-volume`, then re-list `/` and reconfirm the
historical backup and live DB/WAL/SHM checksums recorded above. No broader delete,
glob or database operation is permitted. After cleanup, the named backup/release
owner can create and approve a fresh off-volume backup as the next readiness
closure activity.
