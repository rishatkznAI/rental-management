# PR5–PR8 operational readiness closure gate

## 1. Status

**Status:** `FOUNDATION_DEPLOYMENT_BLOCKED`

**Evaluated:** `2026-07-22`; cleanup and immutable candidate evidence independently
verified `2026-07-23`; coherent backup, restore drill, storage calculation and
security-exposure review updated `2026-07-24`

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

The technical restore drill is now complete and reproducible. The remaining
operational conditions are not closed: the encrypted current backup has only
single-workstation custody and no approved retention or responsible owner; the
proposed storage threshold/reserve lacks named operations approval; the locally
built immutable foundation candidate is not published or owner-approved; the
post-deployment smoke plan is not approved; potential prior secret exposure is not
resolved because two required credential rotations need owner-controlled external
systems; and there is no durable owner/release authorization. Any one is sufficient
to deny deployment.

## 2. Scope and fail-closed boundary

This gate evaluates only operational evidence needed before a possible future
PR5–PR8 foundation deployment. It uses repository/GitHub metadata, read-only
Railway metadata, read-only volume listings, read-only SQLite inspection of
existing historical backup files, and the already reviewed local migration/restore
evidence.

This work did **not** deploy or restart production; change Railway configuration,
domains, variables or network; write a backup file on the production volume;
restore production; run a production initializer or migration; bootstrap identity;
populate PR6; calculate PR7; execute PR8; enable canonical/forecast reads; create
canonical or settlement writes; switch a consumer; implement PR9; or grant
approval. A WAL-aware snapshot was serialized from a read-only/query-only
production transaction and streamed directly to restricted off-volume storage.
All restore, startup, migration and rollback checks used disposable local copies.
A local isolated
`linux/amd64` OCI build used only a Git archive of the candidate `/server` tree;
its validation overrode the entrypoint and did not start the application, open
SQLite or execute a migration. A later read-only Railway metadata query only
reconfirmed the rollback identity. The new and updated repository files are
documentation only. Section 4.4 records an unintended SQLite sidecar-file creation
on one historical backup and the later exact manual cleanup. The incident changed
no live database, backup payload or business row; the two sidecars are now absent
and the strict post-cleanup production-volume baseline has been restored.

The prompt requesting this evaluation is authority to inspect and document, not an
owner, release, operations, database, security or product approval record. Missing
or ambiguous approval remains deny.

## 3. Current production baseline

Read-only baseline evidence was captured on `2026-07-22`. Cleanup-specific
verification on `2026-07-23`, backup-specific before/after verification and the
names-only secret-exposure audit on `2026-07-24` reconfirmed the protected volume,
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
| Cleanup runtime/config (`2026-07-23`) | deployment and replica unchanged; startup `2026-07-15T07:09:34.047Z`; canonical raw 33-variable comparison fingerprint `0f23a29e44e7729e37c2e7420619db16980bb3e640d15352babf7dfc97d44816` unchanged |
| Backup verification | deployment/source/image/instance and volume listing unchanged; DB/WAL/SHM inode, size, mtime and SHA-256 exact before/after; no Railway mutation command executed |
| Secret audit verification (`2026-07-24T05:23:10Z`) | 33 variable names; sorted name-inventory SHA-256 `8f770e3a88235228693f7dcd106ed01f33d734608ea46c9caac36cd0eea2cc4f`; no variable-set command, restart or deployment |

The active deployment, source and database boundary are evidence inputs. They were
not changed by this gate.

## 4. Backup closure

### 4.1 Current coherent encrypted capture

At `2026-07-24T04:55:14.852Z`, the live `/data/app.sqlite` was opened with
`readonly=true`, `fileMustExist=true`, `query_only=ON` and a pinned read
transaction. SQLite serialization produced a coherent logical image incorporating
the WAL-visible state and streamed it over Railway SSH directly to a mode-`0700`
off-volume local directory. No production destination file, checkpoint, `VACUUM`,
migration, restart or configuration change occurred.

| Evidence | Exact value |
|---|---|
| Source deployment / SHA | `b74623ec-d20d-4c50-ab40-0e0a494c5bc5` / `6a38582f5f90b85734884b6b12ad8e306b24619e` |
| Source image / instance | `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650` / `54afd747-1bd1-4069-9320-31e03db1f5ea` |
| Plain coherent SQLite identity | `11,927,552` bytes; SHA-256 `f196accf243748133c59e69ab6c5a64d865b32e79778b2447c1603c701ed0774` |
| Encrypted artifact identity | `11,930,648` bytes; SHA-256 `6a4bfdded51a475b3090bb485a74fd903967d3278536ea2aa49714ab4431b720` |
| Destination reference | `local-restricted://rentCore-production-backups/20260724T045252Z/app.sqlite.coherent-20260724T045252Z.sqlite.age`; outside repository and production volume |
| Encryption / access | age v1 X25519; artifact and manifest mode `0600`; directory mode `0700`; identity file held separately in a mode-`0700` key directory |
| Retention | proposed 30 days or until superseded; review/delete `2026-08-23T04:55:14.852Z`; not owner-approved |
| Custody / owner | technical custodian: local OS account `rishat`; responsible backup owner and approval reference: `UNASSIGNED` |
| Manifest | restricted local `manifest.json`; SHA-256 `72ee5f8ab77c40759c0bcb346374ca9f1bef391d665abc7dbc1e7e4e30d7657f` after final plaintext cleanup |

Source DB/WAL/SHM SHA-256 remained respectively
`b487d8a5534665aa896a8eea1788342b16969c2e10441e3857296505c3c7cf2b`,
`35445701ec00718d8c7c8adfee013580b964b4aa8c6c4063bf10c1b67f491e38`
and `bc2e7b214d1a4f19c928d82f452e316c8a61ab75f6646613cea34b7ba32be8c1`
with the same inode, size and nanosecond mtime before and after capture. The
serialized image passed `integrity_check=ok`, `quick_check=ok`, zero FK violations,
the exact three-row production registry, 63 `app_data` rows with content hash
`5298b2f9b139dfd9885878cd8482d8d3455eccdd597f6a19ef54a532c9e9b312`
and zero canonical/settlement rows.

The disposable plaintext restore copies and the original local plaintext capture
were deleted after verification; only the encrypted artifact and restricted
metadata/evidence remain. No database artifact or secret is stored in Git or
published to GitHub.

The artifact is current, encrypted, independently restorable and off the production
failure domain, but it remains a single-workstation copy with unapproved retention
and no responsible owner. Under this gate's strict approved/durable definition:

`backupAvailable = FALSE`.

### 4.2 Mechanism

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

### 4.3 Existing volume artifacts and independent integrity read

Three historical SQLite copies exist on the same production volume. They were
opened with `readonly=true`, `fileMustExist=true` and `query_only=ON`; no WAL
checkpoint, repair or SQL write was requested. The filesystem side effect from one
WAL-mode open is recorded separately in section 4.4.

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

### 4.4 Read-only sidecar incident

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

The encrypted artifact was decrypted twice into a mode-`0700` disposable local
workspace. The second independent decrypt completed in `0.04 s`; both plaintext
images were exactly `11,927,552` bytes with SHA-256
`f196accf243748133c59e69ab6c5a64d865b32e79778b2447c1603c701ed0774`.
No production restore was attempted.

| Drill stage | Result |
|---|---|
| Raw restore | `integrity_check=ok`; `quick_check=ok`; FK violations `0`; schema hash `b184599187300ba77ab372ec2a816c4aec0e258d14d7de0198c7424f1dc8819b`; exact shadow v2 + PR1/PR2 v1 registry |
| Application data | 63 `app_data` rows; exact content hash `5298b2f9b139dfd9885878cd8482d8d3455eccdd597f6a19ef54a532c9e9b312`; canonical/settlement counts `0` |
| Current production source startup | detached SHA `6a38582f5f90b85734884b6b12ad8e306b24619e`; `/health=200`; `/api/version=200` with exact SHA and isolated marker; observed WAL `16,512` bytes |
| Candidate first startup | detached SHA `1d59992315f1b7f4ff2d370fc17345a459ac52e3`; `/health=200`; `/api/version=200`; PR5–PR8 applied; original shadow/PR1/PR2 timestamps retained |
| Candidate result | logical image SHA-256 `33d2909c5b42343495596c50ef522161bbf509bd1c26a5836d6397132331c120`; schema hash `30309e9655618597e901279969355069fb849a3709b1089f7c0c5cbc2af8c091`; seven registry rows; integrity/quick `ok`; FK `0` |
| Foundation counts | capability catalog exactly `1`/`11`; all PR5 authority/bootstrap, all 16 PR6, all 8 PR7, all 8 PR8 and all canonical/settlement business counts `0`; 63 legacy collections conserved |
| Repeated candidate startup | `/health=200`; `/api/version=200`; exact logical image, schema, seven timestamps, `app_data` hash and every count unchanged |
| Previous-code rollback compatibility | migrated logical image serialized to a fresh target; SHA `6a38582f...` returned `/health=200` and `/api/version=200`; schema, table counts, migration names/versions, business emptiness and `app_data` hash conserved |

The old production code predictably rewrote only the shadow migration's
`applied_at` in the disposable rollback target, reproducing its already documented
pre-#221 behavior. It did not remove or alter PR5–PR8 structures or business state.
The candidate repeated-start test itself retained the exact original shadow time
`2026-07-15 07:09:34` and all other registry timestamps.

Restricted, checksum-addressed JSON evidence for the raw restore, both candidate
starts and rollback probe is stored beside the encrypted artifact. The recipe is
reproducible from the manifest, encrypted artifact, exact two source SHAs and locked
dependencies. Technical execution passed; named owner acceptance remains absent
and does not grant deployment authorization.

`restoreDrillPassed = TRUE`.

`restoreDrillOwnerAccepted = FALSE`.

## 6. Storage closure

| Measurement | Evidence |
|---|---:|
| Railway configured volume | `1,000 MB`; production volume `48b8768c-a8a9-4a87-8a4b-b980fff5d00c` |
| Filesystem total | `921,432,064` bytes |
| Used | `481,689,600` bytes |
| Free / available to application | `439,742,464` / `422,965,248` bytes |
| Railway current-size metric | `565.28896 MB` |
| Encrypted off-volume backup | `11,930,648` bytes; consumes no production-volume bytes |
| PR5–PR8 logical database growth in simulation | `970,752` bytes |
| Persistent DB-file growth in simulation | `0` bytes; existing free pages supplied the DDL |
| Observed migration/repeated-start WAL peak | `1,120,672` bytes |
| SHM allowance | `32,768` bytes |
| Conservative temporary restore workspace | `48,866,744` bytes: encrypted artifact + three DB images + WAL peak + SHM |
| Projected migration-peak used / available | `482,843,040` / `421,811,808` bytes |
| Projected peak used / available as total percentage | `52.401%` / `45.778%` |
| Proposed minimum production reserve | `276,429,620` bytes: 30% of filesystem total |
| Projected headroom above proposed reserve | `145,382,188` bytes |

The proposed fail-closed policy is: before and throughout a foundation window,
available bytes must remain at least 30% of filesystem total
(`276,429,620` bytes), with an alert at 35%; the window must stop before any action
if projected available space falls below the 30% floor. Thirty percent is
conservative relative to the measured migration peak, preserves more than eleven
complete raw DB images, and leaves space for application growth and incident
response. Backup and restore workspace remain off-volume and must separately have
at least `48,866,744` bytes free; the measured local destination had more than
`127,004,807,168` bytes available.

The current facts satisfy the proposed numerical floor, but the policy, alert,
reserve and exception authority have no named operations-owner approval reference.
Measurement does not approve itself.

`storageCapacityAccepted = BLOCKED`.

## 6A. Potential secret exposure

An earlier variable-inspection command may have placed production runtime values in
tool output. The `2026-07-24` audit read the existing capture metadata and current
33-name Railway inventory without printing or persisting any variable value. No
authentication/session secret, signing/encryption key, database credential or
additional external-service credential was present in the affected inventory.

| Variable name | Classification | Rotation state | Reason / safe boundary |
|---|---|---|---|
| `BOT_TOKEN` | `MUST_ROTATE`; MAX external-service API credential | `BLOCKED_NOT_ROTATED` | a valid replacement is provider-issued from the owner-controlled MAX partner/business control plane; an arbitrary generated value would disable the production bot |
| `GSM_INGEST_TOKEN` | `MUST_ROTATE`; production HTTP-ingest API token | `BLOCKED_NOT_ROTATED` | a new random credential must be securely delivered to every production tracker/gateway in the same approved cutover; Railway-only replacement would reject legitimate telemetry |
| `WEBHOOK_URL` | `NO_ROTATION_REQUIRED`; ordinary public runtime URL | `AUDITED_NO_SECRET` | valid HTTPS URL with no user-info, query parameters, embedded `BOT_TOKEN` or embedded `GSM_INGEST_TOKEN` |

`RAILWAY_PRIVATE_DOMAIN` is also an ordinary platform-generated domain, not a
private key or credential. Ports, feature flags, service/project/environment IDs,
volume metadata and other Railway runtime values are non-secret configuration and
require no rotation.

Safe automation stopped before mutation. No replacement token was created, no
old/new token was printed or persisted, and therefore no rotation timestamp, actor
or post-rotation redacted fingerprint exists. The exact manual closure sequence is:

1. a named security owner must issue/revoke and replace the exact production MAX
   bot token in the MAX owner control plane and store the replacement in an
   approved secret manager; if the control plane only reveals the existing token,
   use its revoke/regenerate path or open a MAX provider support request rather
   than reusing the exposed credential;
2. a named security/operations owner must generate a cryptographically random GSM
   token in that secret manager, enumerate every production gateway consumer and
   approve an atomic client/Railway cutover with rollback;
3. in one approved window, update only `BOT_TOKEN` and `GSM_INGEST_TOKEN`; record
   only variable name, UTC rotation time, named actor and a short redacted SHA-256
   fingerprint, and prove all other variable fingerprints plus the 33-name
   inventory are unchanged;
4. record any Railway-generated restart/deployment and prove source SHA remains
   `6a38582f5f90b85734884b6b12ad8e306b24619e`; validate the new MAX token through
   the provider's read-only bot-identity endpoint and validate GSM client cutover
   without creating a synthetic production packet;
5. reconfirm internal/public health and version, DNS/TLS, DB/WAL/SHM byte identity,
   schema/registry/count boundaries, disabled foundation paths and zero PR5–PR8 or
   canonical activity, then destroy any transient plaintext secret material.

No named security owner has accepted a no-rotation decision. At
`2026-07-24T05:23:10Z`, the active deployment, instance, source and image were still
the accepted baseline. Internal `/health` and `/api/version` returned `200`.
DB/WAL/SHM inode, size, nanosecond mtime and SHA-256 were exact baseline matches;
the volume root contained no unexpected file. A fresh client-side public probe
resolved DNS but timed out before TLS/HTTP, so it did not create post-rotation
public-ingress evidence; no ingress/config remediation was attempted.

`potentialSecretExposureResolved = FALSE`.

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
| Candidate OCI manifest digest | `sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5`; exact `linux/amd64` manifest, never a floating tag |
| OCI config digest | `sha256:6cf603c99a44c01c5acfe4665fbf8a0e57b38db93fdab081429f39f03d7717a6` |
| OCI archive SHA-256 | `3a7fdb95c605f5fa94e0f6c269784e469f3b73bef3143fd7e7d0e5af51a4e2f9`; both consecutive exports were byte-identical |
| Build evidence timestamp | completed `2026-07-23T16:33:20Z`; reproducible OCI `created` value is source commit time `2026-07-22T11:26:06Z` (`SOURCE_DATE_EPOCH=1784719566`) |
| Target / builder | `linux/amd64`; local non-production Colima `0.10.3`, Docker `29.6.2`, Buildx `0.35.0`, BuildKit `0.30.0` |
| Dockerfile frontend / recipe | `docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e`; exact ephemeral Dockerfile SHA-256 `59ecb6886b0da436ecd3537f4ee8cb153b7cd85d053e14c99fa828dd67528b8b` |
| `.dockerignore` | exact content `Dockerfile`; SHA-256 `c750b6d776c1db92b55fcecbb51c80be008aae877e78a28691b3ae79be9ea63e` |
| Base image | `node:20.18.1-bookworm@sha256:968ca0550acc7589a8b1324401ec6e39ace53b2c82d2aed3a278e9ff491c2b1c` |
| Image process | exact `git archive <candidate>:server` context; two-stage pinned-base build; `npm ci --omit=dev`; copy production dependencies and server tree; OCI export with provenance/SBOM disabled; command `node scripts/start-with-release-type.cjs` |
| Expected Railway execution contract | runtime V2; `/server` service root; one replica; start `node scripts/start-with-release-type.cjs`; no pre-deploy command |
| Exact target Node/npm | Node `v20.18.1`; npm `10.8.2`; checked in both pinned base and final image |
| Runtime load check | final image `node`/`npm` check passed and `require("better-sqlite3")` passed; application entrypoint was not invoked |
| Ordered migration set | `documents_gantt_shadow_indexes` v2; `canonical_receivables_pr1_schema` v1; `canonical_receivables_pr2_settlement` v1; `platform_identity_pr5` v1; `billing_source_authority_pr6` v1; `forecast_receivables_planning_pr7` v1; `actual_source_eligibility_dry_run_pr8` v1 |
| Ordered migration-set hash | `e8c207bef0b157b058fa56fa594f3e5c697bcdb60c3b5c75834b357f79b282da` |
| Safe config fingerprint reference | `146eb3d634c7d3a667c6aa56905714c5c8ca2e738eed784e91c90bd5ea64b6e8`; secret-free approved-key/value boundary from the readiness evidence |
| Environment comparison reference | 33-variable raw-value canonical hash `0f23a29e44e7729e37c2e7420619db16980bb3e640d15352babf7dfc97d44816`; hash only, never raw secret values |
| Root package / lock | `78cd0bb5474cae32ff9cd77b3087d7b1ab720819d1ba967a9250e90b23694c2f` / `064721ed5c462a0561adfd50cbdbb08ea0cba4fb128ff0d5d43e2324fe355fd3` |
| Server package / lock | `fd9826dab816540813841353f581ce3644e058a88b1e70740ae1ca2e164809cd` / `faaf55b6718804ba2814ef0b02e8664a2b38278413a8c81dba74df94861db4d8` |
| `server/db.js` / shadow initializer | `f3fb2ad911e99ac17ee26f7e6520ad5a5c3f4fdb8bffaf79303e42f09938d25f` / `49a7a36105b99a36e994074ddc4b3c844d694f2ae377ba8435fc519f35cf9ac6` |
| Candidate approval owner | `MISSING`; one named release owner must approve the complete source/image/build/migration/config manifest, with named operations co-approval |

The reproducible build recipe fixes every digest-bearing input: the Dockerfile
frontend, base image, source tree, server lockfile, source timestamp, migration-set
hash, safe config-fingerprint reference and builder metadata. Its dependency stage
asserts the runtime versions and runs `npm ci --omit=dev`; its runtime stage copies
the resulting `node_modules` plus the exact `/server` archive, repeats the version
assertions, exposes `8080` and records
`CMD ["node", "scripts/start-with-release-type.cjs"]`. The exact source context
was exported with
`git archive 1d59992315f1b7f4ff2d370fc17345a459ac52e3:server | tar -x -C <context>`.
The exact Dockerfile was:

```Dockerfile
# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG BASE_IMAGE=node:20.18.1-bookworm@sha256:968ca0550acc7589a8b1324401ec6e39ace53b2c82d2aed3a278e9ff491c2b1c

FROM --platform=$TARGETPLATFORM ${BASE_IMAGE} AS dependencies
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false
COPY package.json package-lock.json ./
RUN test "$(node --version)" = "v20.18.1" \
    && test "$(npm --version)" = "10.8.2" \
    && npm ci --omit=dev

FROM --platform=$TARGETPLATFORM ${BASE_IMAGE} AS runtime
ARG SOURCE_SHA
ARG SOURCE_DATE
ARG MIGRATION_SET_SHA256
ARG CONFIG_FINGERPRINT_SHA256
ARG PACKAGE_LOCK_SHA256
ARG BUILDER_ID
LABEL org.opencontainers.image.title="rentCore foundation deployment candidate" \
      org.opencontainers.image.revision="${SOURCE_SHA}" \
      org.opencontainers.image.created="${SOURCE_DATE}" \
      org.opencontainers.image.source="https://github.com/rishatkznAI/rental-management" \
      rentcore.runtime.node="v20.18.1" \
      rentcore.runtime.npm="10.8.2" \
      rentcore.migration-set.sha256="${MIGRATION_SET_SHA256}" \
      rentcore.config-fingerprint.sha256="${CONFIG_FINGERPRINT_SHA256}" \
      rentcore.package-lock.sha256="${PACKAGE_LOCK_SHA256}" \
      rentcore.builder="${BUILDER_ID}"
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN test "$(node --version)" = "v20.18.1" \
    && test "$(npm --version)" = "10.8.2"
EXPOSE 8080
CMD ["node", "scripts/start-with-release-type.cjs"]
```

The build command was:

```text
docker-buildx build --builder colima-rentcore-build --platform linux/amd64 \
  --provenance=false --sbom=false --build-arg SOURCE_DATE_EPOCH=1784719566 \
  --build-arg SOURCE_SHA=1d59992315f1b7f4ff2d370fc17345a459ac52e3 \
  --build-arg SOURCE_DATE=2026-07-22T11:26:06Z \
  --build-arg MIGRATION_SET_SHA256=e8c207bef0b157b058fa56fa594f3e5c697bcdb60c3b5c75834b357f79b282da \
  --build-arg CONFIG_FINGERPRINT_SHA256=146eb3d634c7d3a667c6aa56905714c5c8ca2e738eed784e91c90bd5ea64b6e8 \
  --build-arg PACKAGE_LOCK_SHA256=faaf55b6718804ba2814ef0b02e8664a2b38278413a8c81dba74df94861db4d8 \
  --build-arg 'BUILDER_ID=local-colima/0.10.3;docker/29.6.2;buildx/0.35.0;buildkit/0.30.0' \
  --output type=oci,dest=rentcore-foundation-1d599923.oci.tar <context>
```

Two consecutive exports from the same fixed build graph produced the same manifest
digest and the same archive SHA-256. The OCI labels bind source, source time,
builder, Node/npm, server lockfile, migration-set hash and safe config fingerprint.
The archive remains local non-production evidence: it was not pushed to a registry,
uploaded to Railway or assigned to a production service. A future Railway source/
Nixpacks rebuild is a distinct artifact and must not claim this OCI digest; the
owner-approved release record must choose and preserve the exact delivery artifact.

### 7.2 Rollback artifact

The application rollback target is the current proven production artifact, not a
floating deployment: source `6a38582f5f90b85734884b6b12ad8e306b24619e`, image
`sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650`
and deployment `b74623ec-d20d-4c50-ab40-0e0a494c5bc5`. Rollback means application
artifact rollback only; the previously verified additive foundation schema is
retained. The rollback owner, command/runbook, stop authority and acceptance
evidence are `MISSING / NOT APPROVED`.

Read-only Railway metadata at `2026-07-23T16:33:50Z` independently reconfirmed that
deployment and image identity, instance
`54afd747-1bd1-4069-9320-31e03db1f5ea` `RUNNING`, deployment `SUCCESS`, Nixpacks,
runtime V2, `/server`, `/data` and the same start command. No Railway mutation was
requested. The candidate digest now exists, but a local build does not approve or
durably publish itself, and neither this document nor PR #224 is an owner decision.

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
| `backupAvailable` | `FALSE` | current encrypted off-volume artifact and checksum exist, but custody is single-workstation and retention/responsible owner are unapproved |
| `restoreDrillPassed` | `TRUE` | encrypted restore, raw validation, both exact-SHA startups, candidate migration/repeat and previous-code compatibility passed reproducibly |
| `restoreDrillOwnerAccepted` | `FALSE` | technical evidence exists; no named owner acceptance reference |
| `storageCapacityAccepted` | `BLOCKED` | exact measurements and a 30% reserve proposal exist; operations-owner approval is missing |
| `potentialSecretExposureResolved` | `FALSE` | `BOT_TOKEN` and `GSM_INGEST_TOKEN` require owner-controlled coordinated rotation; neither is rotated and no named security owner accepted no rotation |
| `pinnedArtifactCandidateDefined` | `TRUE` | exact source, OCI digest, reproducible build/runtime, migration, fingerprint and rollback contract are evidenced |
| `pinnedArtifactApproved` | `FALSE` | candidate is local-only and not durably published; named release/operations approval is missing |
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
| Coherent production capture | `PASS`; WAL-aware read-only serialization; exact DB/WAL/SHM before/after identity; encrypted off-volume artifact and manifest |
| Isolated restore drill | `PASS`; raw decrypt/hash/integrity, production-SHA startup, candidate migration/repeat and previous-code compatibility |
| Storage calculation | `PASS`; total/used/free, backup, DB growth, WAL peak, restore workspace, 30% reserve and projected peak recorded |
| Secret-output audit | `PASS`; 33-name inventory classified without printing/persisting values; only `BOT_TOKEN` and `GSM_INGEST_TOKEN` require rotation; `WEBHOOK_URL` is non-secret |
| Secret rotation | `BLOCKED`; safe automation stopped before mutation because provider issuance and coordinated external-gateway cutover are unavailable; no owner acceptance |
| Secret-audit no-mutation check | `PASS`; no Railway variable update, restart or deployment; internal health/version `200`; exact DB/WAL/SHM and volume-root baseline |
| Fresh public DNS/TLS/HTTP probe | `INCONCLUSIVE`; DNS resolved but the client timed out before TLS/HTTP; no ingress mutation was attempted and no post-rotation evidence applies |
| Exact candidate context | `PASS`; `/server` exported only from `1d59992315f1b7f4ff2d370fc17345a459ac52e3`; server lockfile SHA-256 matched the manifest |
| OCI build and repeat export | `PASS`; both `linux/amd64` exports produced manifest `sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5` and archive SHA-256 `3a7fdb95c605f5fa94e0f6c269784e469f3b73bef3143fd7e7d0e5af51a4e2f9` |
| Final image inspection | `PASS`; source/runtime/migration/config/lock labels exact; Node `v20.18.1`, npm `10.8.2` and native `better-sqlite3` load passed without application startup |
| Rollback identity read | `PASS`; exact production deployment/source/image/instance remained current at `2026-07-23T16:33:50Z` |
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

1. the current encrypted backup has only single-workstation custody and lacks approved retention and a responsible owner;
2. the proposed 30% storage threshold and reserve lack named operations approval;
3. `BOT_TOKEN` and `GSM_INGEST_TOKEN` lack coordinated rotation evidence or named security-owner acceptance;
4. the immutable candidate is built and pinned by digest but is not durably published or owner-approved;
5. no approved post-deployment smoke procedure exists;
6. no durable owner/release/operations authorization exists.

**One next permitted step:** a named security owner must perform the exact
provider-issued MAX-token and coordinated GSM-token manual cutover in section 6A,
or record a durable scoped no-rotation acceptance. This is credential remediation,
not deployment authority; backup, storage, artifact, smoke and release blockers
remain after it.
