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

Current authorization state:

`foundationDeploymentAuthorized = FALSE`

`productionActivationAuthorized = FALSE`

`pr9ImplementationAuthorized = FALSE`

## 2. Backup custody decisions

Technical context: a coherent encrypted off-production-volume artifact and checksum
exist, but the current single-workstation custody is not an approved durable backup.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `backupDurableDestinationApproved` | `UNDECIDED` | destination class and immutable reference; failure-domain separation; accountable backup owner |
| `backupRetentionApproved` | `UNDECIDED` | retention period, expiry/deletion policy and exception authority |
| `backupEncryptionAccessApproved` | `UNDECIDED` | encryption boundary, key custodian, reader/writer allow-list and access-review procedure; no secret value in this record |
| `backupResponsibleOwnerAccepted` | `UNDECIDED` | owner name, role, on-call/escalation boundary and durable approval reference |
| `backupCustodyApproved` | `UNDECIDED` | may become `APPROVED` only when all four rows above are approved for one exact artifact custody contract |

Decision record:

- Approver name: `UNDECIDED`
- Accountable role: `UNDECIDED`
- UTC timestamp: `UNDECIDED`
- Durable destination/reference: `UNDECIDED`
- Durable decision reference: `UNDECIDED`

## 3. Restore drill acceptance decisions

Technical context: `restoreDrillPassed = TRUE`; the isolated drill verified backup
hash, SQLite integrity and foreign keys, schema and migration registry, application
data, current-production startup, candidate migration/repeated startup and
previous-code rollback compatibility. Technical success is not owner acceptance.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `restoreDrillOwnerAcceptance` | `UNDECIDED` | explicit acceptance of the completed technical drill and its evidence reference |
| `restoreOperationsOwnerAccepted` | `UNDECIDED` | responsible operations owner, restoration duty and escalation boundary |

Decision record:

- Operations owner name: `UNDECIDED`
- Accountable role: `UNDECIDED`
- UTC timestamp: `UNDECIDED`
- Accepted drill evidence reference: `UNDECIDED`
- Durable decision reference: `UNDECIDED`

## 4. Storage policy decisions

Technical context: the proposed production-volume floor is 30% available space
(`276,429,620` bytes on the measured filesystem), with an alert at 35%. The
measured migration peak stayed above that floor; measurement does not approve the
policy.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `storageThirtyPercentReserveApproved` | `UNDECIDED` | approve or reject the 30% minimum reserve and record exception/stop authority |
| `storageThirtyFivePercentAlertApproved` | `UNDECIDED` | approve or reject the 35% alert threshold, alert destination and response time |
| `storageOperationsOwnerAccepted` | `UNDECIDED` | operations owner responsible for capacity, alerts and stop decisions |
| `storageCapacityAccepted` | `UNDECIDED` | may become `APPROVED` only with the reserve, alert and named-owner rows resolved |

Decision record:

- Operations owner name: `UNDECIDED`
- Accountable role: `UNDECIDED`
- UTC timestamp: `UNDECIDED`
- Reserve decision rationale: `UNDECIDED`
- Alert decision rationale: `UNDECIDED`
- Durable decision reference: `UNDECIDED`

## 5. Pinned artifact decisions

The only candidate presented for approval is:

- Source SHA: `1d59992315f1b7f4ff2d370fc17345a459ac52e3`
- OCI digest:
  `sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5`

Durable registry publication of this exact digest is a mandatory pre-deployment
condition. This packet does not publish the artifact, select a registry or treat the
local OCI build as durable publication.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `candidateSourceShaApproved` | `UNDECIDED` | approve or reject the exact source SHA above |
| `candidateOciDigestApproved` | `UNDECIDED` | approve or reject the exact OCI digest above |
| `durableRegistryDestinationApproved` | `UNDECIDED` | approved restricted registry/repository and retention/access policy |
| `durableRegistryPublicationVerified` | `UNDECIDED` | immutable digest-qualified registry reference recorded before deployment |
| `pinnedArtifactApproved` | `UNDECIDED` | may become `APPROVED` only after both identities and durable publication are approved |

Decision record:

- Release owner name: `UNDECIDED`
- Operations co-approver name: `UNDECIDED`
- UTC timestamp: `UNDECIDED`
- Digest-qualified registry reference: `UNDECIDED`
- Durable decision reference: `UNDECIDED`

## 6. Post-deployment smoke plan decisions

The plan presented for approval is exactly
`pr5-pr8-foundation-post-deployment-smoke-v1`. Its deployment, runtime health,
database integrity, migration registry, PR5, PR6, PR7, PR8 and canonical
read/write safety checks remain defined in the merged readiness evidence.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `postDeploymentSmokePlanApproved` | `UNDECIDED` | explicit approval or rejection of the exact plan identifier |
| `postDeploymentSmokeExecutorAccepted` | `UNDECIDED` | named executor, execution window and stop/rollback authority |
| `postDeploymentSmokeReviewerAccepted` | `UNDECIDED` | independent named reviewer and evidence acceptance responsibility |

Decision record:

- Executor name and role: `UNDECIDED`
- Reviewer name and role: `UNDECIDED`
- UTC timestamp: `UNDECIDED`
- Evidence destination/retention: `UNDECIDED`
- Durable decision reference: `UNDECIDED`

`postDeploymentSmokeApproved = FALSE`

## 7. Secret-rotation deferral boundary

The existing scoped owner decision is recorded, not expanded:

| Decision field | Status | Binding boundary |
|---|---|---|
| `botTokenRotationDecision` | `DEFERRED` | `BOT_DISABLED=true`; rotation is mandatory before bot integration activation |
| `gsmIngestTokenRotationDecision` | `DEFERRED` | `GSM_ENABLED=false`; rotation is mandatory before GSM integration activation |
| `botIntegrationActivationDecision` | `REJECTED` | no bot worker, external MAX request or business scenario is authorized |
| `gsmIntegrationActivationDecision` | `REJECTED` | no ingest, gateway, worker or external GSM use is authorized |

This is risk acceptance only. It does not resolve potential prior exposure, approve
an artifact, authorize foundation deployment or authorize production activation.
Token values must not be copied into this packet or any approval record.

`potentialSecretExposureResolved = FALSE`

`secretRotationDeferredByOwner = TRUE`

`botIntegrationActivationAuthorized = FALSE`

`gsmIntegrationActivationAuthorized = FALSE`

## 8. Separate release authorization decisions

These decisions are independent. Approval of one row must not change another row.

| Decision field | Status | Current authorization | Required scope |
|---|---|---|---|
| `artifactApprovalDecision` | `UNDECIDED` | `pinnedArtifactApproved = FALSE` | exact source, digest and durable registry reference only |
| `foundationDeploymentDecision` | `UNDECIDED` | `foundationDeploymentAuthorized = FALSE` | PR5–PR8 additive foundation delivery only; no activation |
| `productionActivationDecision` | `UNDECIDED` | `productionActivationAuthorized = FALSE` | separate future business/read/write/integration activation decision |
| `pr9ImplementationDecision` | `UNDECIDED` | `pr9ImplementationAuthorized = FALSE` | separate future implementation decision; not deployment approval |

Final release decision record:

- Product owner name: `UNDECIDED`
- Release owner name: `UNDECIDED`
- Operations owner name: `UNDECIDED`
- Database/backup owner name: `UNDECIDED`
- Security owner name: `UNDECIDED`
- UTC timestamp: `UNDECIDED`
- Durable decision reference: `UNDECIDED`

Until the named decisions above are durably recorded, the effective state remains:

`FOUNDATION_DEPLOYMENT_BLOCKED`

`foundationDeploymentAuthorized = FALSE`

`productionActivationAuthorized = FALSE`

`pr9ImplementationAuthorized = FALSE`
