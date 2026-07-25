# PR5–PR8 foundation deployment incident and post-rollback baseline

## 1. Current status

**Incident date:** `2026-07-25`

**Status:** `FOUNDATION_REMEDIATION_REQUIRED`

`foundationDeploymentPerformed = TRUE`

`foundationDeploymentAuthorized = FALSE`

`productionActivationAuthorized = FALSE`

`pr9ImplementationAuthorized = FALSE`

The previously authorized foundation deployment occurred, initialized the approved
additive PR5–PR8 schema, and was rolled back at the application-artifact layer.
No P0 data, integrity, authorization or integration failure was found. The current
runtime is the prior PR3 artifact; the additive schema and migration registrations
are retained and empty. A new digest attempt is forbidden until every condition in
section 10 is met and a new explicit owner/release authorization is recorded.

## 2. Deployment and rollback identities

| Event | Deployment | Created / started | Source identity | Image identity | Final disposition |
|---|---|---|---|---|---|
| Foundation deployment | `de3fa106-491a-4ddc-896d-a0f650626dc5` | created `2026-07-25T11:38:15.756Z`; observed `SUCCESS/RUNNING` at `2026-07-25T11:38:41.059Z` | approved source `1d59992315f1b7f4ff2d370fc17345a459ac52e3` | `ghcr.io/rishatkznai/rental-management@sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5` | rolled back after an inconclusive single-operator ingress timeout was treated as P1 under the old rule |
| First rollback attempt | `9ec12411-e00d-469d-9c8b-07e9a099d114` | created `2026-07-25T11:40:31.172Z` | PR3 `6a38582f5f90b85734884b6b12ad8e306b24619e` | rebuilt digest `sha256:fec0a54b11af6c84dd330a1f7762c19a9d891aa49063e2fc286c726167a7bc5a` | superseded because an ordinary redeploy rebuilt source instead of reusing the pinned prior artifact |
| Pinned rollback | `0eec88f4-2338-4352-abc5-17b030aa6583` | created `2026-07-25T11:44:14.121Z`; application started `2026-07-25T11:44:19.815Z` | PR3 `6a38582f5f90b85734884b6b12ad8e306b24619e` | `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650` | current `SUCCESS/RUNNING` deployment |

The pinned rollback used Railway's previous-image reuse behavior. Future rollback
instructions must require this exact behavior; an ordinary redeploy is not an
artifact-safe rollback.

## 3. Timeline

| UTC time | Event |
|---|---|
| `2026-07-25T11:38:15.507Z` | Environment patch `1b9c9c73-76e5-4ff0-8b5e-13c450bf75d4` committed: GitHub repo/branch source removed, exact GHCR digest and private registry credential configured. |
| `2026-07-25T11:38:15.756Z` | Foundation deployment created. |
| `2026-07-25 11:38:35` | `platform_identity_pr5`, `billing_source_authority_pr6`, `forecast_receivables_planning_pr7` and `actual_source_eligibility_dry_run_pr8` registered at version 1. |
| `2026-07-25T11:38:41.059Z` | Foundation deployment observed `SUCCESS`; instance observed `RUNNING`. |
| after `11:38:41Z` | The operator path to public port 443 timed out before TCP/TLS for both `/health` and `/api/version`; curl returned exit 28 and HTTP 000. The old rule classified this as P1 and initiated rollback. |
| `2026-07-25T11:40:31.172Z` | First rollback attempt created; later rejected as non-pinned because Railway rebuilt the prior source. |
| `2026-07-25T11:44:14.121Z` | Corrected pinned rollback created. |
| `2026-07-25T11:44:19.815Z` | PR3 application started; Railway subsequently confirmed `SUCCESS/RUNNING`. |
| `2026-07-25 11:44:20` | The PR3 initializer rewrote the existing `documents_gantt_shadow_indexes.applied_at`; this is the accepted post-rollback baseline, not the pre-attempt timestamp. |
| `2026-07-25T12:14:19.487Z` | Remediation patch `5b037962-291c-4528-b2e8-1b4dd77d18c5` committed with deploys skipped, setting the remaining GHCR image source to `null`. |
| `2026-07-25T12:15:52.022Z`–`12:15:52.205Z` | Coherent post-rollback SQLite backup captured and verified without changing source DB/WAL/SHM. |

## 4. Rollback-safe Railway source

Production source cleanup result:

- `source.repo = null`;
- `source.image = null`;
- no automatic repository or image deployment source remains;
- cleanup applied through patch `5b037962-291c-4528-b2e8-1b4dd77d18c5` with
  `skipDeploys = true`;
- patch created `2026-07-25T12:14:18.630Z` and committed
  `2026-07-25T12:14:19.487Z`;
- staged patch is empty after commit;
- deployment `0eec88f4-2338-4352-abc5-17b030aa6583` remained unchanged,
  `SUCCESS/RUNNING`, source SHA `6a38582f...`, image digest `sha256:c27f43d...`;
- internal `/health` and `/api/version` returned HTTP 200 after source cleanup.

The dedicated private-registry credential remains stored in Railway; cleanup did
not read, print, rotate or remove it. With both source fields null, no automatic
deployment source references that credential.

No variable, volume, network, port, feature flag or database mutation was included
in the cleanup patch.

## 5. Post-rollback database baseline

The current exact ordered migration registry is:

| Migration | Version | `applied_at` |
|---|---:|---|
| `actual_source_eligibility_dry_run_pr8` | 1 | `2026-07-25 11:38:35` |
| `billing_source_authority_pr6` | 1 | `2026-07-25 11:38:35` |
| `canonical_receivables_pr1_schema` | 1 | `2026-07-14 05:19:11` |
| `canonical_receivables_pr2_settlement` | 1 | `2026-07-14 18:42:21` |
| `documents_gantt_shadow_indexes` | 2 | `2026-07-25 11:44:20` |
| `forecast_receivables_planning_pr7` | 1 | `2026-07-25 11:38:35` |
| `platform_identity_pr5` | 1 | `2026-07-25 11:38:35` |

`documents_gantt_shadow_indexes.applied_at = 2026-07-25 11:44:20` is the new
post-rollback reference. Every future controlled-restart or digest-retry check must
compare against this value and fail if it changes.

Current restored-snapshot evidence:

- 55 tables, 116 indexes, 154 triggers and 0 views;
- normalized schema evidence SHA-256
  `83369528e359151eb0c171e6dbd44888b035fe3ff38bc51faf95c3cedf27aa77`;
- 63 `app_data` collections; evidence-only content SHA-256
  `d7b4f1196bcfc583cf8b81d85ba7c2f05fa9d5294d70cac0201f27d4c05910e8`;
- capability catalog 1 version / 11 entries;
- PR5 business/bootstrap/grant rows: 0;
- all 16 PR6 table rows: 0;
- all 8 PR7 table rows: 0;
- all 8 PR8 table rows: 0;
- all 8 canonical/settlement table rows: 0;
- `integrity_check=ok`, `quick_check=ok`, foreign-key violations 0.

## 6. Fresh coherent backup

Restricted local reference:

`local-restricted://rentCore-production-backups/20260725T121525Z/app.sqlite.coherent-20260725T121525Z.sqlite.age`

| Artifact | Size | SHA-256 |
|---|---:|---|
| Coherent plaintext identity, deleted after verification | `11,927,552` | `104a9436fcc625dd6eedaba4fe1d36b91984308518e276234b51e4ab5839ce0a` |
| age/X25519 encrypted artifact | `11,930,648` | `6a12d65030cd183b0ee00beb899d2ea56e9ea0c8b8a86af95ec73bd0c3b5bd61` |
| `manifest.json` | `4,371` | `43993962d18d95730e306ad76b54f1f4f53e72a5d120d38ac6f617c5c5ac22bf` |
| `restore.verification.json` | `821` | `1bf186734a9e686b3d1b26e5e1b107f925a78aa13b5542c1766f80c21860fe11` |

The source DB/WAL/SHM size, mtime and SHA-256 were exact before and after the
online backup. Independent decryption reproduced the plaintext SHA-256 and the
database evidence in section 5. Both plaintext copies and their temporary
WAL/SHM sidecars were deleted; the age identity remains separately held.

The encrypted artifact is not yet recorded in independently verified durable
off-host custody. Upload to the approved restricted destination, stable object
IDs, independent re-download/checksum/decrypt verification, retention and owner
acceptance remain mandatory before a retry can be authorized.

## 7. Incident classification

No P0 occurred:

- current PR3 runtime is healthy internally;
- the additive PR5–PR8 schema is present and compatible with PR3;
- all foundation and canonical business rows remain zero;
- SQLite integrity, quick and FK checks pass;
- bot and GSM remain disabled;
- canonical and forecast reads/writes remain disabled;
- no Finance, Dashboard or Company Health consumer switch occurred.

The rollback was triggered by the old P1 ingress rule. The operator path timed out
before TCP/TLS and produced no application response. The same operator-path
failure persisted after the pinned PR3 rollback. Review evidence reports six
independent probes across Europe, North America and Asia returning `/health` 200,
with no correlated Railway request log for the failing operator attempts. The
incident therefore does not establish an application failure; it establishes an
inadequate single-vantage classification rule.

## 8. Revised ingress policy

A single operator-path DNS, TCP or TLS timeout is `INCONCLUSIVE_PROBE_PATH`, not an
application P1 by itself. It must not independently trigger rollback.

Public ingress is accepted only when all required endpoints are checked from
multiple independent external vantage points and correlated with Railway edge or
request logs. The evidence record must include vantage/region, timestamp, resolved
address, TCP/TLS result, HTTP status, deployment marker and matching edge/request
log window.

Fail-closed P1 application rollback remains required when independent evidence
indicates runtime failure, including either:

1. Railway deployment/instance or internal health is unhealthy, crash-looping or
   returning a non-200 result; or
2. at least two independent external regions fail the same endpoint and Railway
   edge/request logs correlate the failures to the deployed service; or
3. Railway edge/request logs independently show deployment-correlated 5xx,
   upstream timeout or routing failure even if one client vantage is ambiguous.

If one operator path fails while independent regions return 200, internal health
is 200 and Railway logs contain no corresponding request, classify the operator
path as inconclusive and investigate it without rolling back the application.

## 9. Authorization state

The `2026-07-24T12:00:08Z` foundation authorization was exercised by deployment
`de3fa106-...` and is no longer reusable.

`foundationDeploymentPerformed = TRUE`

`foundationDeploymentAuthorized = FALSE`

`postDeploymentSmokeApproved = FALSE`

`productionActivationAuthorized = FALSE`

`pr5BootstrapAuthorized = FALSE`

`pr6SourcePopulationAuthorized = FALSE`

`pr7ProductionCalculationAuthorized = FALSE`

`pr8ProductionDryRunAuthorized = FALSE`

`canonicalProductionReadsAuthorized = FALSE`

`productionCanonicalWritesAuthorized = FALSE`

`botIntegrationActivationAuthorized = FALSE`

`gsmIntegrationActivationAuthorized = FALSE`

`pr9ImplementationAuthorized = FALSE`

## 10. Conditions before one explicit digest retry

No deployment retry is currently authorized. Exactly these conditions remain:

1. Place the `20260725T121525Z` encrypted backup and manifest in approved durable
   restricted off-host custody; record stable object IDs, retention and access.
2. Independently download that durable copy and reproduce encrypted, manifest and
   plaintext checksums plus integrity/quick/FK, registry and zero-row evidence.
3. Approve this incident record, the rollback-safe no-source state, and the updated
   rollback runbook requiring previous-image reuse with the exact PR3 artifact.
4. Approve the post-rollback registry baseline, especially
   `documents_gantt_shadow_indexes.applied_at = 2026-07-25 11:44:20`.
5. Approve and provision the multi-vantage ingress probes and Railway edge/request
   log correlation evidence required by section 8.
6. Reconfirm unchanged variables, `/data` mount, networking, port 8080, disabled
   integrations, absent/default-false canonical/forecast reads and zero business
   rows immediately before any source change.
7. Record a new explicit owner/release/operations authorization bound to the exact
   digest, current backup, revised smoke plan, change window and stop/rollback
   rules. The prior authorization cannot be reused.

Only after all seven conditions are independently accepted may one separately
requested digest retry be considered. This incident record authorizes no retry,
activation, PR9 work or business-data operation.
