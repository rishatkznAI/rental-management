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

The owner decisions below were explicitly supplied by Rishat and recorded at
`2026-07-24T08:30:17Z`. This record changes approval state only; it performs no
deployment, artifact publication, Railway change, production operation, migration,
integration activation or PR9 work.

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
| `backupRetentionApproved` | `APPROVED` | 30-day retention; expiry/deletion exceptions remain under the responsible backup owner |
| `backupEncryptionAccessApproved` | `APPROVED` | `age`/X25519 encryption with restricted access; no key or secret value belongs in this record |
| `backupResponsibleOwnerAccepted` | `APPROVED` | Rishat is the responsible backup owner |
| `backupCustodyApproved` | `UNDECIDED` | exact external durable destination remains undecided; the three approvals above do not make single-workstation custody durable |

Decision record:

- Approver name: `Rishat`
- Accountable role: `responsible backup owner`
- UTC timestamp: `2026-07-24T08:30:17Z`
- Durable destination/reference: `UNDECIDED`
- Durable decision reference: `explicit owner instruction recorded in this approval packet update`

`backupAvailable = FALSE`

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
digest. Registry publication and artifact approval do not authorize deployment.

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
read/write safety checks remain defined in the merged readiness evidence.

| Decision field | Status | Required named-owner record |
|---|---|---|
| `postDeploymentSmokePlanApproved` | `APPROVED` | exact plan `pr5-pr8-foundation-post-deployment-smoke-v1` is approved |
| `postDeploymentSmokeExecutorAccepted` | `APPROVED` | executor is Codex/operations agent, constrained by the approved plan and stop/rollback rules |
| `postDeploymentSmokeReviewerAccepted` | `APPROVED` | Rishat is the independent reviewer and evidence acceptor |

Decision record:

- Executor name and role: `Codex/operations agent`
- Reviewer name and role: `Rishat`; independent reviewer
- UTC timestamp: `2026-07-24T08:30:17Z`
- Evidence destination/retention: `UNDECIDED`
- Durable decision reference: `explicit owner instruction recorded in this approval packet update`

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
| `artifactApprovalDecision` | `APPROVED` | `pinnedArtifactApproved = TRUE` | exact source and digest are approved under the immutable private GHCR reference only |
| `foundationDeploymentDecision` | `DEFERRED` | `foundationDeploymentAuthorized = FALSE` | no foundation deployment until remaining backup, smoke-evidence and owner prerequisites close and a later explicit authorization is recorded |
| `productionActivationDecision` | `REJECTED` | `productionActivationAuthorized = FALSE` | business/read/write/integration activation remains forbidden |
| `pr9ImplementationDecision` | `REJECTED` | `pr9ImplementationAuthorized = FALSE` | PR9 implementation remains forbidden and is not implied by any foundation decision |

Final release decision record:

- Product owner name: `Rishat`
- Release owner name: `Rishat`
- Operations owner name: `Rishat`
- Database/backup owner name: `Rishat`
- Security owner name: `UNDECIDED`
- UTC timestamp: `2026-07-24T08:30:17Z`
- Durable decision reference: `explicit owner instruction recorded in this approval packet update`

Until the named decisions above are durably recorded, the effective state remains:

`FOUNDATION_DEPLOYMENT_BLOCKED`

`foundationDeploymentAuthorized = FALSE`

`productionActivationAuthorized = FALSE`

`pr9ImplementationAuthorized = FALSE`

## 9. Exact remaining actions before foundation deployment authorization

1. Select and approve an exact durable external backup destination, transfer the
   existing encrypted artifact under the approved 30-day retention/access policy,
   record its immutable destination/checksum and independently verify integrity.
2. Choose the durable destination and retention for future smoke evidence before
   executing `pr5-pr8-foundation-post-deployment-smoke-v1`.
3. Name the security owner for the final release record.
4. After all preceding prerequisites are durably recorded, issue a separate explicit
   `APPROVED` decision for `foundationDeploymentDecision`. Until then,
   `foundationDeploymentAuthorized = FALSE`.

Production activation and PR9 remain `REJECTED`; they are not prerequisites to, and
cannot be implied by, a future foundation-only deployment authorization.
