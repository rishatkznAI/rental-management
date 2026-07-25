# PR5–PR8 foundation owner approval packet

## 1. Purpose and decision rules

This packet records only the named human decisions that remain after PR #224.
Its evidence baseline is squash merge
`79e04e0d58670c590881083c2e124731643624e6`; the detailed technical evidence
remains in `docs/pr5-pr8-operational-readiness-closure-gate.md` and
`docs/pr5-pr8-foundation-deployment-readiness-gate.md`.

Every decision field must use exactly one of:

- `APPROVED` — the named owner accepts the exact scoped item and supplies a
  durable approval reference;
- `REJECTED` — the named owner refuses the exact scoped item;
- `DEFERRED` — the named owner explicitly postpones the decision and records the
  boundary that remains disabled;
- `UNDECIDED` — no valid named human decision is recorded.

This document does not infer approval from technical evidence, a pull request,
authorship, silence or this packet's creation. An `APPROVED` decision is valid only
with approver name, accountable role, UTC timestamp and durable decision reference.
Missing information remains `UNDECIDED`.

The owner decisions below were explicitly supplied by Rishat. The initial decision
set was recorded at `2026-07-24T08:30:17Z`; the exact foundation-only deployment
approval was recorded at `2026-07-24T12:00:08Z`. That approval was exercised by
deployment `de3fa106-491a-4ddc-896d-a0f650626dc5` and is no longer reusable. The
application was rolled back to pinned PR3 deployment
`0eec88f4-2338-4352-abc5-17b030aa6583`. The current incident and remediation
evidence is recorded in
`docs/pr5-pr8-foundation-deployment-incident-2026-07-25.md`.

Current authorization state:

`foundationDeploymentPerformed = TRUE`

`foundationDeploymentAuthorized = FALSE`

`productionActivationAuthorized = FALSE`

`pr9ImplementationAuthorized = FALSE`

## 2. Backup custody decisions

Technical context: the `20260724T045252Z` pre-deployment artifact remains in
approved private Google Drive custody and passed independent verification. The
current post-rollback artifact `20260725T121525Z` is encrypted and locally
restricted; checksum, decrypt, SQLite integrity, migration registry and zero-row
verification passed, but durable off-host custody has not yet been recorded.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `backupDurableDestinationApproved` | `APPROVED` | private Google Drive; folder ID `19t2TxbDFb7AczCBxNvPNFXW9KcKxIoke`; encrypted file ID `1zQmObkd6tbZ3a51q5ALf61VoPam90m3f`; manifest file ID `1LJboUA3LoLsptMqx0s4Q7JpM9xxobl6I` |
| `backupRetentionApproved` | `APPROVED` | 30-day retention; expiry/deletion exceptions remain under the responsible backup owner |
| `backupEncryptionAccessApproved` | `APPROVED` | `age`/X25519 encryption with restricted access; no key or secret value belongs in this record |
| `backupResponsibleOwnerAccepted` | `APPROVED` | Rishat is the responsible backup owner |
| `backupCustodyApproved` | `APPROVED` | restricted Drive objects, 30-day retention and exact checksum/restorability verification satisfy durable custody; identity and plaintext are excluded |

Decision record:

- Approver name: `Rishat`
- Accountable role: `responsible backup owner`
- Approval/verification UTC timestamp: `2026-07-24T10:59:00Z`
- Durable destination/reference: Google Drive folder ID `19t2TxbDFb7AczCBxNvPNFXW9KcKxIoke`; encrypted object ID `1zQmObkd6tbZ3a51q5ALf61VoPam90m3f`; manifest object ID `1LJboUA3LoLsptMqx0s4Q7JpM9xxobl6I`
- Access: `restricted`; only Rishat; no public link; age identity is held separately and plaintext is not uploaded
- Retention expiry: `2026-08-23T04:55:14.852Z`
- Independent download verification: encrypted size `11,930,648` and SHA-256 `6a4bfdded51a475b3090bb485a74fd903967d3278536ea2aa49714ab4431b720`; manifest SHA-256 `72ee5f8ab77c40759c0bcb346374ca9f1bef391d665abc7dbc1e7e4e30d7657f`; plaintext SHA-256 `f196accf243748133c59e69ab6c5a64d865b32e79778b2447c1603c701ed0774`; integrity/quick `ok`; zero FK violations; temporary plaintext deleted
- Durable decision reference: `explicit owner approval of Google Drive custody plus independently verified object evidence recorded in this packet`

`backupAvailable = TRUE`

`backupResponsibleOwnerAccepted = TRUE`

`backupCustodyApproved = TRUE`

`postRollbackBackupCaptured = TRUE`

`postRollbackBackupDurableCustody = FALSE`

Post-rollback reference:
`local-restricted://rentCore-production-backups/20260725T121525Z/app.sqlite.coherent-20260725T121525Z.sqlite.age`.
The encrypted SHA-256 is
`6a12d65030cd183b0ee00beb899d2ea56e9ea0c8b8a86af95ec73bd0c3b5bd61`;
manifest SHA-256 is
`43993962d18d95730e306ad76b54f1f4f53e72a5d120d38ac6f617c5c5ac22bf`;
restore-evidence SHA-256 is
`1bf186734a9e686b3d1b26e5e1b107f925a78aa13b5542c1766f80c21860fe11`;
and verified plaintext SHA-256 is
`104a9436fcc625dd6eedaba4fe1d36b91984308518e276234b51e4ab5839ce0a`.
The restored image returned integrity/quick `ok`, FK 0, the exact seven-row
registry and zero PR5–PR8/canonical/settlement business rows. Plaintext was
deleted after verification. These technical results do not substitute for durable
custody approval.

## 3. Restore drill acceptance decisions

Technical context: `restoreDrillPassed = TRUE`; the isolated drill verified backup
hash, SQLite integrity and foreign keys, schema and migration registry, application
data, current-production startup, candidate migration/repeated startup and
previous-code rollback compatibility. Technical success is not owner acceptance.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `restoreDrillOwnerAcceptance` | `APPROVED` | Rishat accepts the completed technical drill evidenced by `restoreDrillPassed = TRUE` |
| `restoreOperationsOwnerAccepted` | `APPROVED` | Rishat accepts responsibility as operations owner for restoration and escalation |

Decision record:

- Operations owner name: `Rishat`
- Accountable role: `operations owner`
- UTC timestamp: `2026-07-24T08:30:17Z`
- Accepted drill evidence reference: `docs/pr5-pr8-operational-readiness-closure-gate.md`; `restoreDrillPassed = TRUE`
- Durable decision reference: `explicit owner instruction recorded in this approval packet update`

## 4. Storage policy decisions

Technical context: the proposed production-volume floor is 30% available space
(`276,429,620` bytes on the measured filesystem), with an alert at 35%. The
measured migration peak stayed above that floor; measurement does not approve the
policy.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `storageThirtyPercentReserveApproved` | `APPROVED` | 30% available-space minimum reserve; deployment must stop before projected available space falls below it |
| `storageThirtyFivePercentAlertApproved` | `APPROVED` | alert threshold is 35% available space |
| `storageOperationsOwnerAccepted` | `APPROVED` | Rishat is responsible for capacity, alerts and stop decisions |
| `storageCapacityAccepted` | `APPROVED` | reserve, alert and accountable operations owner are all explicitly approved |

Decision record:

- Operations owner name: `Rishat`
- Accountable role: `operations owner`
- UTC timestamp: `2026-07-24T08:30:17Z`
- Reserve decision rationale: `APPROVED`; preserve the measured 30% operational floor and stop before violation
- Alert decision rationale: `APPROVED`; warn at 35% to preserve response headroom above the floor
- Durable decision reference: `explicit owner instruction recorded in this approval packet update`

## 5. Pinned artifact decisions

The only candidate presented for approval is:

- Source SHA: `1d59992315f1b7f4ff2d370fc17345a459ac52e3`
- OCI digest:
  `sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5`

Rishat approved `ghcr.io/rishatkznai/rental-management` as the durable registry
destination. The already-built OCI archive was pushed there without rebuilding,
and the private remote manifest was independently resolved to the exact approved
digest. Registry publication and artifact approval did not by themselves authorize
deployment; the separate scoped owner decision in section 8 now does.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `candidateSourceShaApproved` | `APPROVED` | exact source SHA above is approved; no branch, tag or floating `main` substitution |
| `candidateOciDigestApproved` | `APPROVED` | published manifest digest exactly matches the approved local OCI manifest digest |
| `durableRegistryDestinationApproved` | `APPROVED` | private `ghcr.io/rishatkznai/rental-management` approved by Rishat |
| `durableRegistryPublicationVerified` | `TRUE` | push plus independent authenticated pull and GitHub Packages metadata returned the exact digest/tag |
| `artifactReleaseOwnerAccepted` | `APPROVED` | Rishat is the artifact/release owner |
| `pinnedArtifactApproved` | `TRUE` | source, digest, private destination and immutable reference are approved and verified |

Decision record:

- Release owner name: `Rishat`
- Operations co-approver name: `Rishat`
- Publication/verification UTC timestamp: `2026-07-24T08:54:25Z`
- Registry destination: `ghcr.io/rishatkznai/rental-management`
- Publication tag: `foundation-1d59992315f1b7f4ff2d370fc17345a459ac52e3`
- Digest-qualified registry reference: `ghcr.io/rishatkznai/rental-management@sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5`
- Visibility/access: `private`; no anonymous/public access; restricted to Rishat and explicitly authorized GitHub Packages principals
- Verification: push response and independent authenticated pull returned the expected digest; GitHub Packages API reported the matching version/tag and private visibility
- Durable decision reference: `explicit owner instruction approving the GHCR destination, recorded with independently verified publication evidence`

## 6. Post-deployment smoke plan decisions

The plan presented for approval is exactly
`pr5-pr8-foundation-post-deployment-smoke-v1`. Its deployment, runtime health,
database integrity, migration registry, PR5, PR6, PR7, PR8 and canonical
read/write safety checks remain defined in the merged readiness evidence. The plan
was executed after foundation deployment, but its old single-vantage ingress rule
classified an operator-path TCP timeout as P1 and triggered rollback. Review
evidence later showed the same timeout after PR3 rollback, no corresponding
Railway request logs, and six independent external probes returning `/health` 200.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `postDeploymentSmokePlanApproved` | `APPROVED` | exact plan `pr5-pr8-foundation-post-deployment-smoke-v1` is approved |
| `postDeploymentSmokeExecutorAccepted` | `APPROVED` | executor is Codex/operations agent, constrained by the approved plan and stop/rollback rules |
| `postDeploymentSmokeReviewerAccepted` | `APPROVED` | Rishat is the independent reviewer and evidence acceptor |
| `smokeEvidenceRetentionApproved` | `APPROVED` | signed/redacted smoke report and checksums are retained indefinitely in the repository release record with the deployment audit |

Decision record:

- Executor name and role: `Codex/operations agent`
- Reviewer name and role: `Rishat`; independent reviewer
- UTC timestamp: `2026-07-24T08:30:17Z`
- Evidence destination/retention: repository release record; signed/redacted smoke report and checksums retained indefinitely with the deployment audit
- Durable decision reference: `explicit owner instruction recorded in this approval packet update`

`postDeploymentSmokeApproved = FALSE`

The revised smoke policy is not yet approved. It classifies one operator-path
DNS/TCP/TLS timeout as `INCONCLUSIVE_PROBE_PATH` and requires multi-vantage
external probes plus Railway edge/request-log correlation before declaring an
application ingress failure. Fail-closed rollback remains mandatory when
independent evidence identifies an unhealthy runtime. A future retry requires a
new named-owner approval of that policy and the complete revised smoke plan.

## 7. Secret-rotation deferral boundary

The existing scoped owner decision is recorded, not expanded:

| Decision field | Status | Binding boundary |
|---|---|---|
| `botTokenRotationDecision` | `DEFERRED` | `BOT_DISABLED=true`; rotation is mandatory before bot integration activation |
| `gsmIngestTokenRotationDecision` | `DEFERRED` | `GSM_ENABLED=false`; rotation is mandatory before GSM integration activation |
| `botIntegrationActivationDecision` | `REJECTED` | no bot worker, external MAX request or business scenario is authorized |
| `gsmIntegrationActivationDecision` | `REJECTED` | no ingest, gateway, worker or external GSM use is authorized |

This is risk acceptance only. It does not resolve potential prior exposure, approve
an artifact or authorize foundation deployment/production activation by itself;
the separate section 8 decision is the sole foundation authorization.
Token values must not be copied into this packet or any approval record.

`potentialSecretExposureResolved = FALSE`

`secretRotationDeferredByOwner = TRUE`

`botIntegrationActivationAuthorized = FALSE`

`gsmIntegrationActivationAuthorized = FALSE`

## 8. Separate release authorization decisions

These decisions are independent. Approval of one row must not change another row.

| Decision field | Status | Current authorization | Required scope |
|---|---|---|---|
| `artifactApprovalDecision` | `APPROVED` | `pinnedArtifactApproved = TRUE` | exact source and digest are approved under the immutable private GHCR reference only |
| `historicalFoundationDeploymentDecision` | `APPROVED` | `foundationDeploymentPerformed = TRUE` | the `2026-07-24T12:00:08Z` approval was exercised by deployment `de3fa106-491a-4ddc-896d-a0f650626dc5` and cannot be reused |
| `foundationRetryDecision` | `UNDECIDED` | `foundationDeploymentAuthorized = FALSE` | no retry may occur until the incident/remediation conditions are independently accepted and a new explicit authorization is recorded |
| `productionActivationDecision` | `REJECTED` | `productionActivationAuthorized = FALSE` | business/read/write/integration activation remains forbidden |
| `pr9ImplementationDecision` | `REJECTED` | `pr9ImplementationAuthorized = FALSE` | PR9 implementation remains forbidden and is not implied by any foundation decision |

Final release decision record:

- Product owner name: `Rishat`
- Release owner name: `Rishat`
- Operations owner name: `Rishat`
- Database/backup owner name: `Rishat`
- Security owner name: `Rishat`
- Latest owner record UTC timestamp: `2026-07-24T12:00:08Z`
- Approved source SHA: `1d59992315f1b7f4ff2d370fc17345a459ac52e3`
- Approved OCI digest: `sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5`
- Approved backup reference: `Google Drive / Rentcore / 20260724T045252Z`; encrypted file ID `1zQmObkd6tbZ3a51q5ALf61VoPam90m3f`; manifest file ID `1LJboUA3LoLsptMqx0s4Q7JpM9xxobl6I`
- Approved smoke plan: `pr5-pr8-foundation-post-deployment-smoke-v1`
- Durable decision reference: `explicit owner instruction recorded in this approval packet update`

The historical final release record above remains immutable evidence of the
consumed approval. The effective current state is:

`FOUNDATION_REMEDIATION_REQUIRED`

`foundationDeploymentPerformed = TRUE`

`foundationRetryDecision = UNDECIDED`

`foundationDeploymentAuthorized = FALSE`

`productionActivationAuthorized = FALSE`

`pr9ImplementationAuthorized = FALSE`

The foundation approval does not alter any excluded authority:

`pr5BootstrapAuthorized = FALSE`

`pr6SourcePopulationAuthorized = FALSE`

`pr7ProductionCalculationAuthorized = FALSE`

`pr8ProductionDryRunAuthorized = FALSE`

`canonicalProductionReadsAuthorized = FALSE`

`productionCanonicalWritesAuthorized = FALSE`

`botIntegrationActivationAuthorized = FALSE`

`gsmIntegrationActivationAuthorized = FALSE`

## 9. Exact next permitted step

Do not retry deployment. Keep the Railway service source disconnected while all
seven conditions in
`docs/pr5-pr8-foundation-deployment-incident-2026-07-25.md` section 10 are
completed and independently accepted. They require current durable backup custody
and verification; incident, rollback and no-source approval; the new shadow
timestamp baseline; multi-vantage ingress and Railway-log evidence; immediate
pre-change config/flag/count reconfirmation; and a new explicit authorization bound
to the exact digest, backup, change window and revised stop/rollback rules.

Production activation and PR9 remain `REJECTED`; they cannot be implied by any
future foundation retry decision.
