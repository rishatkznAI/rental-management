# PR5–PR8 foundation retry authorization packet

## 1. Purpose and fail-closed result

This packet records the owner decisions supplied after the foundation deployment
incident was closed into `main` through PR #227. The evidence baseline is squash
merge `8dc34629acdae6d959797873d4e66ad62a66eb46` at
`2026-07-25T13:30:05Z`. It now also records the explicit owner decision at
`2026-07-25T14:10:43Z` authorizing exactly one controlled PR5–PR8 foundation
deployment retry under the conditions in section 7.2.

This was a single-use retry authorization, not production activation. It became
executable only after the required multi-vantage controls and immediate preflight
passed. The execution was blocked before those conditions were met, so the
authorization is consumed and has returned to `FALSE`.

**Packet status:** `RETRY_CONSUMED_BLOCKED`

`retryReadinessComplete = FALSE`

`foundationDeploymentAuthorized = FALSE`

`foundationDeploymentRetryDecision = APPROVED`

`foundationDeploymentRetryAttemptOutcome = FOUNDATION_DEPLOYMENT_RETRY_BLOCKED`

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

The exact candidate digest above is the only artifact authorized for the
single controlled retry. Rebuilding it, substituting another digest or using
`railway up` is outside this authorization.

## 3. Owner decisions recorded by this packet

The baseline decisions below were explicitly supplied by Rishat and recorded at
`2026-07-25T13:30:55Z`. The single-use retry decision and its conditions were
explicitly supplied at `2026-07-25T14:10:43Z`. Rishat remains the named product,
release, operations, database/backup and security owner in the merged owner
approval packet.

| Decision field | Status | Exact scope |
|---|---|---|
| `incidentRecordDecision` | `APPROVED` | incident chronology, classification and current post-rollback state in the merged PR #227 record |
| `rollbackSafeNoSourceStateDecision` | `APPROVED` | Railway remains at `source.repo = null` and `source.image = null`; approval does not reconnect either source |
| `previousImageRollbackProcedureDecision` | `APPROVED` | rollback must reuse the exact previously deployed PR3 image; an ordinary source rebuild or redeploy is not an acceptable rollback |
| `postRollbackMigrationBaselineDecision` | `APPROVED` | exact seven-row registry, including `documents_gantt_shadow_indexes.applied_at = 2026-07-25 11:44:20`, and the zero-business-row boundaries below |
| `driveBackupCustodyDecision` | `APPROVED` | restricted durable custody under `Rentcore/20260725T121525Z`; encrypted backup and manifest only; plaintext and age identity excluded |
| `multiVantageProbeAndLogCorrelationRequirement` | `REQUIRED` | run public `/health` and `/api/version` probes from multiple vantage paths and correlate them with Railway request logs before and after the retry |
| `immediateRetryPreflightRequirement` | `REQUIRED` | run immediately before the authorized Railway source change; the execution was blocked before this could pass |
| `controlledRetryWindowDecision` | `APPROVED_CONSUMED` | the one controlled execution was consumed with a blocked result; Codex / operations agent was executor and Rishat was owner and smoke reviewer |
| `foundationRetryDecision` | `APPROVED_CONSUMED` | owner decision remains `APPROVED`; current `foundationDeploymentRetryAuthorized = FALSE` |

The durable decision reference is the explicit owner instruction recorded in this
packet. The later instruction expressly approves only the one controlled retry
defined here and does not approve production activation or downstream work.

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

Approval of this baseline alone neither reconnects Railway source nor permits a
deployment, restart or configuration mutation. Only the separate single-use
authorization in section 7.2 permits the exact retry after all preconditions pass.

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

This custody approval does not authorize a restore. The age identity remains
separately held. Plaintext SQLite, credentials and environment material must not
be uploaded to the custody folder. The deployment authority, and only that
authority, is defined separately in section 7.2.

## 7. Separate gates

### 7.1 Retry readiness

Incident acceptance, rollback-safe no-source state, the previous-image rollback
procedure, post-rollback migration baseline and Drive custody are approved.

Retry readiness is incomplete at packet-merge time. Both requirements below must
be completed with retained evidence during the authorized execution and before
any Railway source change:

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

`retryReadinessComplete = FALSE`. The required sequence was not completed before
an unintended deployment attempt was created. No approved source change is
permitted, the result is `FOUNDATION_DEPLOYMENT_RETRY_BLOCKED`, and the single-use
authorization is consumed.

### 7.2 Retry authorization

The owner has made the independent retry decision:

`controlledRetryWindowDecision = APPROVED_CONSUMED`

`foundationDeploymentRetryDecision = APPROVED`

`foundationDeploymentRetryAuthorized = FALSE`

The authorization scope was exactly one controlled PR5–PR8 foundation deployment
retry using source `1d59992315f1b7f4ff2d370fc17345a459ac52e3` and immutable image
`ghcr.io/rishatkznai/rental-management@sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5`.
The deployment executor is Codex / operations agent. Rishat is the owner and smoke
reviewer.

The following conditions are mandatory:

1. Final-review and squash-merge this authorization packet before any Railway
   action.
2. Immediately before any Railway source change, re-download and verify the
   approved backup and manifest; verify variables, `/data` volume, networking,
   port `8080` and flags without exposing secrets; prove `BOT_DISABLED=true`,
   `GSM_ENABLED=false`, canonical and forecast flags absent or false, database
   integrity, the exact migration registry and all approved zero-row boundaries.
3. Run multi-vantage public `/health` and `/api/version` probes and correlate them
   with Railway request logs.
4. Configure only the approved immutable GHCR digest. Do not rebuild it and do
   not use `railway up`.
5. Execute `pr5-pr8-foundation-post-deployment-smoke-v1` immediately after the
   deployment.
6. Stop and use the pinned previous-image rollback target on any P0/P1 deviation:
   deployment `0eec88f4-2338-4352-abc5-17b030aa6583`, source
   `6a38582f5f90b85734884b6b12ad8e306b24619e`, image
   `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650`.
7. The authorization expires after this single execution, whether it succeeds,
   is blocked before or during deployment, or is rolled back. After the terminal
   result, `foundationDeploymentRetryAuthorized` must be restored to `FALSE`.

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
| `controlledRetryWindowDecision` | `APPROVED_CONSUMED` |
| `foundationDeploymentAuthorized` | `FALSE` |
| `foundationDeploymentRetryDecision` | `APPROVED` |
| `foundationDeploymentRetryAttemptOutcome` | `FOUNDATION_DEPLOYMENT_RETRY_BLOCKED` |
| `foundationDeploymentRetryAuthorized` | `FALSE` |
| `productionActivationAuthorized` | `FALSE` |
| `canonicalProductionReadsAuthorized` | `FALSE` |
| `productionCanonicalWritesAuthorized` | `FALSE` |
| `pr9ImplementationAuthorized` | `FALSE` |

## 9. Prohibited actions and next permitted step

The single-use retry authorization in section 7.2 is consumed. This packet does
not authorize another deployment attempt, variable changes, manual migrations,
PR5 bootstrap, PR6 source population, PR7 production calculation, PR8 production
dry run, canonical read/write enablement, bot or GSM activation, production
activation or PR9 work.

No second attempt is authorized. A future retry would require a new owner decision
and a new authorization packet after the blocked execution and credential-handling
follow-up are closed.

## 10. Blocked execution and authorization consumption

At `2026-07-25T14:12:07.935Z`, before this packet was merged and before the
required backup, preflight and multi-vantage controls passed, Markdown backticks
in a local documentation-consistency command were interpreted by the shell as
command substitution. This unintentionally invoked the expressly prohibited
`railway up` command.

Railway created deployment `6cce2aeb-6d63-4e02-96f0-df0452fce3a4`. Read-only
metadata at `2026-07-25T14:14:03Z` showed it as `BUILDING` but stopped, with no
instances, no image digest and no commit identity. The production service source
remained `repo = null`, `image = null`. The approved rollback deployment
`0eec88f4-2338-4352-abc5-17b030aa6583` remained `SUCCESS/RUNNING` on source
`6a38582f5f90b85734884b6b12ad8e306b24619e` and image
`sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650`.
Traffic was not switched, so no application rollback was required.

The unintended deployment creation violates the required ordering and artifact
boundary. It consumes the one authorized execution with terminal result
`FOUNDATION_DEPLOYMENT_RETRY_BLOCKED`. The approved immutable candidate was not
deployed, `pr5-pr8-foundation-post-deployment-smoke-v1` was not run, and no second
attempt is permitted.

A subsequent raw Railway metadata read exposed a registry credential only in the
restricted operator transcript; no credential value is recorded in this document,
repository or PR. Credential rotation is a separate required security follow-up
because this task does not authorize credential or variable changes.
