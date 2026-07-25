# PR5–PR8 foundation retry security and backup remediation

## 1. Scope and terminal state

This record closes only the credential-containment and current post-rollback
custody work that followed the accidental retry recorded in
`docs/pr5-pr8-foundation-retry-authorization.md`. Its trusted repository base is
main `36840ea2e1360c539aa5e34ef392f4232b1b4327`, the squash merge of PR #228.
No deployment, restart, redeploy, source reconnect, variable change, migration,
bootstrap, population, calculation, dry run, activation, canonical read/write or
PR9 operation was authorized or performed by this remediation.

**Terminal deployment result:** `FOUNDATION_DEPLOYMENT_RETRY_ROLLED_BACK`

`registryCredentialRevoked = TRUE`

`replacementRegistryCredentialVerified = FALSE`

`postRollbackBackupDurableCustody = TRUE`

`postRollbackMigrationBaselineVerified = TRUE`

`foundationDeploymentRetryAuthorized = FALSE`

`productionActivationAuthorized = FALSE`

`canonicalProductionReadsAuthorized = FALSE`

`productionCanonicalWritesAuthorized = FALSE`

`pr9ImplementationAuthorized = FALSE`

## 2. Registry credential containment

The exposed credential was a GitHub classic personal access token used as the
private GHCR registry password. Its value is not retained in this record.

| Evidence | Redacted result |
|---|---|
| Old credential safe identifier | `sha256:a9de26be90bff93d0b0a59564305ede2af8234947d99d6e94c2abb9c6a958d71` |
| Revocation accepted | GitHub credential-revocation endpoint returned `202` at `2026-07-25T14:45:58.838Z` |
| Revocation verification | a non-destructive authenticated `GET /user` using the old credential returned `401` after two polls |
| Affected configured consumer | Railway production service `rental-management`; the encrypted `deploy.registryCredentials` field still matches the revoked safe identifier |
| Active registry consumer | none: `source.repo = null` and `source.image = null` |
| Replacement identifier | `NONE_NOT_PROVISIONED` |
| Replacement verification | `NOT_APPLICABLE_NO_APPROVED_CONSUMER` |

No replacement was created or copied into Railway. The current no-source service
does not consume a registry credential, and provisioning one solely for a
hypothetical future retry would exceed this task's approved consumers. Removing
the stored encrypted field requires an environment-config commit that can enqueue
a deployment; the no-deployment P0 rule therefore leaves that field in place as a
revoked, non-authenticating value. A future separately authorized retry must
provision a new least-privilege package-read credential to its exact approved
consumer and prove a metadata/manifest read without deploying.

`registryCredentialRevoked = TRUE` is proven. Because no replacement exists,
`replacementRegistryCredentialVerified = FALSE` remains fail-closed.

## 3. Exposure-surface inspection and redaction

The exposed value was matched only in restricted Railway/operator evidence. No
search placed the credential in a command argument, process listing, document,
commit or returned output.

| Surface | Finding and disposition |
|---|---|
| Git working tree and all Git history | zero exact matches and zero classic-PAT-shaped strings |
| GitHub pull request bodies/metadata | zero matches in the inspected PR corpus; PRs #220–#228 also had zero review-body or check-output matches |
| GitHub comments and review comments | zero matches |
| GitHub Actions | zero matches in run metadata, all accessible run logs since `2026-07-20`, artifact metadata and the accessible retained artifact |
| Railway deployment metadata | one exact occurrence in restricted historical deployment metadata; retained only in the provider's restricted evidence and now non-authenticating |
| Railway current configuration | encrypted registry field contains the revoked credential; no source references or consumes it |
| Railway deploy/build/HTTP logs | zero matches across the current rollback and seven preceding relevant deployments |
| Local restricted operator artifacts | four exact incident occurrences were redacted in place: three in the active restricted session record and one in a shell snapshot |
| Additional local credential-shaped material | six non-incident classic-PAT-shaped strings in three restricted session records were also redacted; the inspected files then contained zero such strings |
| Shell history and temporary files | no remaining exact incident match |

The safe fingerprint, counts, paths by artifact class, timestamps and verification
statuses preserve the incident evidence without preserving any secret value.

## 4. Immutable rollback-state verification

Read-only checks at the start and end of the task proved the same production
runtime:

| Field | Exact result |
|---|---|
| Active deployment | `65140ce4-7947-4a9b-9a9f-9410096d11e6` |
| Deployment / instance | `SUCCESS` / `RUNNING`; instance `1ec62223-2549-4252-91f5-f2b4765dd420` |
| Source commit | `6a38582f5f90b85734884b6b12ad8e306b24619e` |
| Image digest | `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650` |
| Railway source | `repo = null`; `image = null` |
| Volume / port | `/data`; public target port `8080` |
| Integration flags | bot disabled; GSM disabled |
| Canonical/forecast read flags | absent |
| Runtime start marker | `2026-07-25T14:19:55.153Z`, before this task's first immutable-state snapshot at `2026-07-25T14:54:07.761Z` |
| Final state check | `2026-07-25T15:13:33.171Z`; no new deployment ID, unchanged runtime marker and unchanged null source |

No deployment, build, restart, redeploy or source change occurred during this
task. Values of Railway variables were never printed or recorded; only the
required boolean assertions were retained.

### Public health/version correlation

Globalping measurements `2xNja2HzdRuPnY0sq00020pIN` and
`2IaFgOTHU5ubCvKXe00020pIN` ran from `2026-07-25T14:55:52.383Z` through
`2026-07-25T14:56:00.759Z`:

- `/health`: `15/15` HTTP 200;
- `/api/version`: `15/15` HTTP 200;
- every version body named the exact rollback source and deployment;
- Railway HTTP logs contained 30 unique correlated request IDs, exactly 15 per
  endpoint, between `14:55:52.895419694Z` and `14:55:58.776058263Z`;
- every correlated request belonged to deployment
  `65140ce4-7947-4a9b-9a9f-9410096d11e6`.

The operator path remained inconclusive, consistent with the incident record; it
was not substituted for the successful multi-vantage and Railway-log evidence.

## 5. Current post-rollback migration baseline

The live database, the coherent local copy and the independent Drive restore all
returned `integrity_check = ok`, `quick_check = ok`, query-only mode enabled and
zero rows from `foreign_key_check`.

| Migration | Version | `applied_at` |
|---|---:|---|
| `actual_source_eligibility_dry_run_pr8` | 1 | `2026-07-25 11:38:35` |
| `billing_source_authority_pr6` | 1 | `2026-07-25 11:38:35` |
| `canonical_receivables_pr1_schema` | 1 | `2026-07-14 05:19:11` |
| `canonical_receivables_pr2_settlement` | 1 | `2026-07-14 18:42:21` |
| `documents_gantt_shadow_indexes` | 2 | `2026-07-25 14:19:55` |
| `forecast_receivables_planning_pr7` | 1 | `2026-07-25 11:38:35` |
| `platform_identity_pr5` | 1 | `2026-07-25 11:38:35` |

Exact protected boundaries:

| Boundary | Result |
|---|---|
| Capability catalog | `1` version / `11` entries |
| PR5 | `0` rows across `7` business tables |
| PR6 | `0` rows across `16` tables |
| PR7 | `0` rows across `8` tables |
| PR8 | `0` rows across `8` tables |
| Canonical/settlement | `0` rows across `8` tables |

The restored database contained 55 tables, 116 indexes, 154 triggers, zero views
and 63 `app_data` collections. The source DB/WAL/SHM size, mtime and SHA-256 were
identical before and after the online capture.

`postRollbackMigrationBaselineVerified = TRUE` records verification only. It is
not a retry decision or production activation.

## 6. New coherent encrypted backup

**Backup timestamp:** `20260725T145852Z`

**Capture window:** `2026-07-25T14:59:25.493Z`–`14:59:25.764Z`

**Method:** `better-sqlite3` online backup from a read-only/query-only connection.

| Artifact | Exact filename | Bytes | SHA-256 |
|---|---|---:|---|
| Plaintext identity, deleted after verification | `app.sqlite.coherent-20260725T145852Z.sqlite` | `11,927,552` | `061496b32b0343eff5244ee0a5594ba6e2dee398a152bb30dab7a19f4305ee84` |
| age/X25519 encrypted backup | `app.sqlite.coherent-20260725T145852Z.sqlite.age` | `11,930,648` | `cbde8abe643ccb71da419d5e90575e544f566b4b2733e5941d37feb61543d82f` |
| Manifest | `manifest.json` | `6,520` | `8d74d03c707c9deb169947eb6e9f38053c3338ae7aef52a3b3a2957da6c3155d` |

The existing approved age recipient was used. The private identity stayed in its
separately stored location and was not printed, copied to the backup directory,
uploaded or committed.

## 7. Durable Google Drive custody and restore drill

Exactly one active folder with the timestamp exists. A concurrent folder-creation
race briefly produced an empty same-name duplicate; after resolving both exact
IDs, its sole object was moved into the retained folder and the empty duplicate
folder `1n3q4NiNLrHIfDQBovGYpm3EbFNPqVmJk` was set to `trashed = true`. The retained
folder has exactly two objects:

| Object | Path | Google Drive ID |
|---|---|---|
| Folder | `rentcore-drive:Rentcore/20260725T145852Z/` | `1IDqWXVuhPw9mypTK9xNxcsCBBzuDsPiL` |
| Encrypted backup | `rentcore-drive:Rentcore/20260725T145852Z/app.sqlite.coherent-20260725T145852Z.sqlite.age` | `1BNeePc1Eu1gw-S69f_8bPMexM8KH1PiT` |
| Manifest | `rentcore-drive:Rentcore/20260725T145852Z/manifest.json` | `1PecI1kvisD2xmt9UZ7NNxN2D5jjGcQEh` |

Remote object count, exact sizes and Drive-reported SHA-256 values matched the
local encrypted backup and manifest. An independent download into a newly created
mode-0700 temporary directory reproduced both hashes and sizes. Local decryption
with the separately stored identity reproduced the exact plaintext size and
SHA-256, followed by the full SQLite, registry, schema and boundary verification
in sections 5 and 6.

The folder and both objects each have exactly one inherited `user`/`owner`
permission, no `anyone` or `domain` grant, `trashed = false`, and anonymous media
requests returned `403`. The private 30-day minimum retention policy is recorded
through at least `2026-08-24T14:59:25.764Z`.

The independent download directory, decrypted SQLite and its WAL/SHM sidecars
were deleted. The capture-side remote plaintext, compressed transfer container and
sidecars were deleted. The restricted local plaintext and sidecars were deleted;
only the encrypted backup and manifest remain locally. No plaintext SQLite,
identity, credential, token or environment-variable material is present in Drive.

`postRollbackBackupDurableCustody = TRUE`.

## 8. Authorization matrix

| Field | Value |
|---|---|
| `registryCredentialRevoked` | `TRUE` |
| `replacementRegistryCredentialVerified` | `FALSE` |
| `postRollbackBackupDurableCustody` | `TRUE` |
| `postRollbackMigrationBaselineVerified` | `TRUE` |
| `foundationDeploymentRetryAuthorized` | `FALSE` |
| `productionActivationAuthorized` | `FALSE` |
| `canonicalProductionReadsAuthorized` | `FALSE` |
| `productionCanonicalWritesAuthorized` | `FALSE` |
| `pr9ImplementationAuthorized` | `FALSE` |

## 9. Exact prerequisites before any second retry

No second retry is approved. All of the following remain mandatory before one can
be considered:

1. Merge and owner-accept this remediation evidence, including the revoked
   credential state, exact `2026-07-25 14:19:55` registry baseline and new Drive
   custody IDs.
2. Create a new least-privilege package-read registry credential only after an
   exact future consumer and change window are explicitly approved. Record only
   its safe identifier, provision it only to that consumer, prove a non-deployment
   GHCR manifest read, and remove or supersede the revoked Railway field without
   causing an unapproved deployment or restart.
3. Re-download and independently verify the encrypted backup and manifest from
   `Rentcore/20260725T145852Z`; reconfirm access and minimum retention. Before the
   shared rclone Google Drive client is retired during 2026, separately configure
   an owner-controlled Drive client without exposing or changing unrelated
   credentials.
4. Immediately before any source change, re-prove unchanged variables, `/data`
   volume, networking, port `8080`, disabled bot/GSM integrations, absent/false
   canonical and forecast flags, SQLite integrity, this exact migration registry,
   catalog `1/11` and all zero-business-row boundaries.
5. Bind a newly approved immutable source/image, pinned previous-image rollback
   target, multi-vantage health/version probes, Railway request-log correlation,
   smoke plan, executor/reviewer, stop rules and one explicit change window.
6. Obtain a new explicit single-use owner authorization. The authorization
   consumed by the rolled-back attempt cannot be reused.

Until every prerequisite and the new owner decision exist,
`foundationDeploymentRetryAuthorized = FALSE`. Production activation, canonical
production reads/writes and PR9 remain independently blocked.
