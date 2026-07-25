# PR5–PR8 foundation retry authorization packet

## 1. Purpose and fail-closed result

This packet records the owner decisions supplied after the foundation deployment
incident was closed into `main` through PR #227. The evidence baseline is squash
merge `8dc34629acdae6d959797873d4e66ad62a66eb46` at
`2026-07-25T13:30:05Z`.

This is a retry-decision packet, not a retry authorization. Approval of incident,
rollback, migration and backup evidence does not imply approval of a new
deployment attempt. The required multi-vantage controls and immediate preflight
remain outstanding, and no controlled retry window has been approved.

**Packet status:** `RETRY_AUTHORIZATION_PENDING`

`retryReadinessComplete = FALSE`

`foundationDeploymentAuthorized = FALSE`

`foundationDeploymentRetryAuthorized = FALSE`

`productionActivationAuthorized = FALSE`

`canonicalProductionReadsAuthorized = FALSE`

`productionCanonicalWritesAuthorized = FALSE`

`pr9ImplementationAuthorized = FALSE`

## 2. Bound evidence

| Evidence | Exact bound value |
|---|---|
| Incident record | `docs/pr5-pr8-foundation-deployment-incident-2026-07-25.md` at main `8dc34629acdae6d959797873d4e66ad62a66eb46` |
| Foundation candidate | source `1d59992315f1b7f4ff2d370fc17345a459ac52e3`; `ghcr.io/rishatkznai/rental-management@sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5` |
| Current rollback runtime | pinned previous-image deployment `0eec88f4-2338-4352-abc5-17b030aa6583`; source `6a38582f5f90b85734884b6b12ad8e306b24619e`; image `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650` |
| Railway source state | `source.repo = null`; `source.image = null`; cleanup patch `5b037962-291c-4528-b2e8-1b4dd77d18c5` committed with deploys skipped |
| Post-rollback backup folder | `Rentcore/20260725T121525Z`; Drive folder ID `1j8OLI_p3o7If0Mlu-zTbxFSCKWbwJ1Pk` |
| Encrypted backup object | ID `14tMB54nxClsrV3At7oeE0OAk41G3WPoX`; SHA-256 `6a12d65030cd183b0ee00beb899d2ea56e9ea0c8b8a86af95ec73bd0c3b5bd61` |
| Backup manifest object | ID `1orsj7QIiqB2lYIgiEj1zCXhbW-_9uC0r`; SHA-256 `43993962d18d95730e306ad76b54f1f4f53e72a5d120d38ac6f617c5c5ac22bf` |
| Verified plaintext identity | SHA-256 `104a9436fcc625dd6eedaba4fe1d36b91984308518e276234b51e4ab5839ce0a`; plaintext deleted after verification |

The exact candidate digest above is the only candidate that a later owner
decision may authorize. Recording it here does not authorize its use.

## 3. Owner decisions recorded by this packet

The decisions below were explicitly supplied by Rishat and recorded at
`2026-07-25T13:30:55Z`. Rishat remains the named product, release, operations,
database/backup and security owner in the merged owner approval packet.

| Decision field | Status | Exact scope |
|---|---|---|
| `incidentRecordDecision` | `APPROVED` | incident chronology, classification and current post-rollback state in the merged PR #227 record |
| `rollbackSafeNoSourceStateDecision` | `APPROVED` | Railway remains at `source.repo = null` and `source.image = null`; approval does not reconnect either source |
| `previousImageRollbackProcedureDecision` | `APPROVED` | rollback must reuse the exact previously deployed PR3 image; an ordinary source rebuild or redeploy is not an acceptable rollback |
| `postRollbackMigrationBaselineDecision` | `APPROVED` | exact seven-row registry, including `documents_gantt_shadow_indexes.applied_at = 2026-07-25 11:44:20`, and the zero-business-row boundaries below |
| `driveBackupCustodyDecision` | `APPROVED` | restricted durable custody under `Rentcore/20260725T121525Z`; encrypted backup and manifest only; plaintext and age identity excluded |
| `multiVantageProbeAndLogCorrelationRequirement` | `REQUIRED` | must be provisioned and evidenced before any retry authorization decision |
| `immediateRetryPreflightRequirement` | `REQUIRED` | must be run immediately before any separately authorized source change |
| `controlledRetryWindowDecision` | `UNDECIDED` | no retry window, start time, operator or execution authority is approved |
| `foundationRetryDecision` | `UNDECIDED` | `foundationDeploymentRetryAuthorized = FALSE` |

The durable decision reference is the explicit owner instruction to create this
packet with the statuses above. That instruction expressly does not approve a
retry.

## 4. Approved rollback-safe baseline

The approved no-source state is fail-closed:

- `source.repo = null`;
- `source.image = null`;
- no automatic repository or image deployment source is present;
- the source cleanup was committed with deploys skipped;
- no variable, volume, network, port, feature flag or database mutation was part
  of the source cleanup;
- the current runtime remains the pinned PR3 previous image.

The approved rollback procedure for any later separately authorized attempt must
reuse the exact previous deployed image. It must not perform an ordinary rebuild
from PR3 source, because that produces a different image identity. A retry plan
must bind the pinned rollback target above before execution begins.

Approval of this baseline neither reconnects Railway source nor permits a
deployment, restart or configuration mutation.

## 5. Approved migration and zero-row baseline

The exact ordered registry approved for comparison is:

| Migration | Version | `applied_at` |
|---|---:|---|
| `actual_source_eligibility_dry_run_pr8` | 1 | `2026-07-25 11:38:35` |
| `billing_source_authority_pr6` | 1 | `2026-07-25 11:38:35` |
| `canonical_receivables_pr1_schema` | 1 | `2026-07-14 05:19:11` |
| `canonical_receivables_pr2_settlement` | 1 | `2026-07-14 18:42:21` |
| `documents_gantt_shadow_indexes` | 2 | `2026-07-25 11:44:20` |
| `forecast_receivables_planning_pr7` | 1 | `2026-07-25 11:38:35` |
| `platform_identity_pr5` | 1 | `2026-07-25 11:38:35` |

The approved data boundary is capability catalog `1/11`, PR5 business rows
`0/7` tables, PR6 `0/16`, PR7 `0/8`, PR8 `0/8`, and canonical/settlement `0/8`.
Integrity and quick checks must remain `ok` and foreign-key violations must remain
zero. Any registry, timestamp, catalog or business-row drift fails closed and
invalidates readiness for a retry decision.

## 6. Approved backup custody baseline

`postRollbackBackupDurableCustody = TRUE` for the restricted Drive folder
`Rentcore/20260725T121525Z`. The stable folder and object IDs, exact encrypted,
manifest and plaintext checksums, independent download/decryption, SQLite checks,
registry comparison, zero-row verification and cleanup are recorded in the merged
incident record.

This custody approval authorizes neither a restore nor a deployment. The age
identity remains separately held. Plaintext SQLite, credentials and environment
material must not be uploaded to the custody folder.

## 7. Separate gates

### 7.1 Retry readiness

Incident acceptance, rollback-safe no-source state, the previous-image rollback
procedure, post-rollback migration baseline and Drive custody are approved.

Retry readiness is still incomplete. Both requirements below must be completed
with retained evidence before an owner may decide on one controlled retry window:

1. Provision multi-vantage probes for `/health` and `/api/version` and bind their
   DNS/TCP/TLS/HTTP results to Railway deployment markers and edge/request-log
   windows. One uncorrelated operator-path timeout remains inconclusive; stop or
   rollback classification requires independently correlated application or edge
   failure under the merged incident policy.
2. Run the preflight immediately before any proposed source change. It
   must reconfirm, without exposing secret values: unchanged production variable
   inventory/fingerprint, `/data` mount and accepted storage reserve, networking,
   port `8080`, disabled bot/GSM integrations, absent/default-false canonical and
   forecast reads, the exact migration registry, catalog `1/11`, and all protected
   business-row totals at zero.

`retryReadinessComplete = FALSE` until both requirements pass and their evidence
is accepted.

### 7.2 Retry authorization

Retry authorization is a later, independent owner decision.

`controlledRetryWindowDecision = UNDECIDED`

`foundationDeploymentRetryAuthorized = FALSE`

The exact remaining owner decision is whether to authorize one controlled retry
window after the required multi-vantage controls and immediate preflight have
passed. A valid approval must bind the exact GHCR digest, source SHA, current
backup folder/object IDs, accepted probe and preflight evidence, named operators,
window start/end, revised smoke plan, P0/P1 stop rules and exact previous-image
rollback target. Missing or ambiguous approval remains deny.

This prompt and this packet do not make that decision.

### 7.3 Production activation

Production activation is separate from both retry readiness and retry
authorization. Even a later successful foundation retry would not authorize
bootstrap, source population, forecast calculation, diagnostic execution,
integration activation or consumer switching.

`productionActivationAuthorized = FALSE`

### 7.4 Canonical reads and writes

Canonical production reads and canonical production writes are two separate
authorization gates. Neither is implied by foundation delivery, retry readiness,
retry authorization or a successful smoke result.

`canonicalProductionReadsAuthorized = FALSE`

`productionCanonicalWritesAuthorized = FALSE`

### 7.5 PR9

PR9 design or implementation is outside this packet and remains independently
blocked.

`pr9ImplementationAuthorized = FALSE`

## 8. Current authorization matrix

| Field | Value |
|---|---|
| `incidentRecordApproved` | `TRUE` |
| `rollbackSafeNoSourceStateApproved` | `TRUE` |
| `previousImageRollbackProcedureApproved` | `TRUE` |
| `postRollbackMigrationBaselineApproved` | `TRUE` |
| `postRollbackBackupDurableCustody` | `TRUE` |
| `multiVantageProbeAndLogCorrelation` | `REQUIRED` |
| `immediateRetryPreflight` | `REQUIRED` |
| `retryReadinessComplete` | `FALSE` |
| `controlledRetryWindowDecision` | `UNDECIDED` |
| `foundationDeploymentAuthorized` | `FALSE` |
| `foundationDeploymentRetryAuthorized` | `FALSE` |
| `productionActivationAuthorized` | `FALSE` |
| `canonicalProductionReadsAuthorized` | `FALSE` |
| `productionCanonicalWritesAuthorized` | `FALSE` |
| `pr9ImplementationAuthorized` | `FALSE` |

## 9. Prohibited actions and next permitted step

This packet performs and authorizes no Railway source reconnect, deployment,
restart, variable change, manual migration, PR5 bootstrap, PR6 population, PR7
calculation, PR8 execution, canonical read/write enablement, production activation
or PR9 work.

The next permitted work is limited to provisioning the required multi-vantage
probe/log-correlation evidence and preparing the read-only immediate preflight.
Only after both pass may the owner make the separate, explicit decision on one
controlled retry window.
