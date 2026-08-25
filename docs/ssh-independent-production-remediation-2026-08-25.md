# SSH-independent production remediation

Date: 2026-08-25
Status: application mechanism only; production execution is not authorized by this document

## Safety boundary

The application ships a disabled-by-default operations surface. It never runs remediation during build, startup, deploy, restart, or ordinary application traffic. It accepts only one explicitly enabled mode per signed request:

- `preflight`: read-only production inspection;
- `backup`: coherent backup plus server-owned receipt;
- `apply`: one guarded immediate transaction;
- `verify`: read-only post-apply verification.

The bundled plan remains fail-closed. Its authority is `PENDING_VERIFIED_PRODUCTION_DRY_RUN`, `identityBootstrap` is `null`, the smoke actor and smoke records remain `UNRESOLVED`, and the backup is unverified. Therefore the application can be released with only `preflight` enabled, but the bundled plan cannot reach `backup` or `apply`.

No HTTP request may supply a replacement plan, SQL, shell command, collection list, database path, or backup receipt. The application image owns the plan and the exact production target.

## Immutable target

The route and workflow are pinned to all of the following:

| Field | Required value |
|---|---|
| Railway project | `1558b38d-bf16-4b50-9ee6-0871b7152116` |
| Railway environment | `62833109-61cb-4600-9200-d624d6537a05` |
| Railway service | `b2016e92-3c50-4b00-800d-625a139b219c` |
| Railway volume | `48b8768c-a8a9-4a87-8a4b-b980fff5d00c` |
| Railway volume name | `rental-management-volume` |
| Volume mount | `/data` |
| SQLite source | `/data/app.sqlite` |
| Canonical Company / tenant | `cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ` |
| GitHub repository | `rishatkznAI/rental-management` |
| Production API origin | `https://api.skytech-rent.ru` |

The protected workflow proves the volume ID through Railway's control plane and sends the request only to the repository-pinned HTTPS origin without following redirects. The running application independently proves the Railway project, environment, service, volume name, mount path, nonempty replica ID, exact database real path, and exact deployed commit SHA from Railway runtime variables. The signed request binds the control-plane volume ID and every other target field. A mismatch returns fail-closed before any runner is called.

## Authorization and replay control

The endpoint does not use a reusable bearer value. Every operation has a five-minute authorization window and a UUIDv4 request ID. GitHub Actions calculates:

```text
HMAC-SHA256(
  signing-secret,
  "rentcore-production-scope-remediation-v1\n"
  + request-id + "\n"
  + mode + "\n"
  + issued-at + "\n"
  + expires-at + "\n"
  + SHA256(canonical-request-body)
)
```

The server requires a signing secret of at least 32 bytes, exact timestamp bounds, a matching body hash, and a timing-safe signature comparison. It then atomically consumes the request ID in a server-side replay ledger using create-if-absent plus file and directory `fsync`. Reuse is rejected. The in-process mutex prevents concurrent operations on one replica; the workflow and Railway assertion also require exactly one running instance.

Only the derived HMAC is sent to the service. The signing secret, Railway token, and backup passphrase are masked and are never written to request or response artifacts. Server error responses and logs contain only a stable error code, mode, and truncated request identifier.

## Preflight invariants

`preflight` opens the exact database with `readonly=true` and `fileMustExist=true`, enables `foreign_keys` and `query_only`, and performs a single read transaction. It proves:

- exact deployed 40-character commit SHA;
- exact bundled-plan checksum and execution-plan checksum;
- exact SQLite application ID, page size, schema fingerprint, and user version expected by the plan;
- complete logical database fingerprint across persistent SQLite header fields, every non-internal schema object, every row in every table, BLOBs, and `sqlite_sequence`;
- scoped remediation-state and collection fingerprints;
- safe complete user inventory and its fingerprint;
- explicit disposition for every eligible actor;
- `integrity_check=ok` and zero foreign-key violations;
- zero `total_changes()` delta;
- identical DB/WAL/SHM size and SHA-256 before and after inspection.

The user inventory returns only stable ID, display name, status, role, classification, proposed action, and evidence. It excludes passwords, password hashes, tokens, sessions, cookies, API keys, secrets, and arbitrary user payloads.

Any new eligible actor, unexpected record, unresolved mapping, schema drift, collection drift, tenant/company mismatch, wrong Company ID, wrong path, wrong SHA, or database-file change becomes a blocker. There is no wildcard assignment of unclassified actors or records.

## Central write freeze

`backup`, `apply`, and `verify` require all of these conditions simultaneously:

- application disabled;
- MAX bot disabled;
- GSM/GPRS disabled;
- central production-scope write guard enabled;
- clean reset disabled;
- admin password reset disabled.

While the write guard is active, the normal storage mutators reject collection writes, batch writes, INN index synchronization, session creation/deletion/cleanup, legacy migration, and data reset. Startup skips schema creation, legacy migration, session cleanup, user/reference maintenance, repair/payment maintenance, seeds, CRM cleanup, admin reset, bot transports, and both GSM/GPRS gateways. The hourly session timer is not created. A disabled webhook does not append bot activity. The application-disabled middleware blocks normal product routes; bot and GSM flags remain an additional external/background boundary.

The remediation runner is the only intended database writer in this state. `backup` and `verify` remain read-only with respect to the business database; backup and authorization control artifacts are written outside `app.sqlite` under the mounted volume.

## Backup and server-owned receipt

`backup` reruns preflight under the complete freeze. It permits only the plan's recoverable missing-backup blocker. It then:

1. captures the exact source DB/WAL/SHM file set;
2. uses the SQLite backup API to produce a coherent database snapshot;
3. builds a full archive and requires `skippedFilesCount=0`;
4. validates every ZIP entry;
5. opens the embedded SQLite snapshot read-only;
6. reruns integrity, foreign-key, source-identity, scoped-state, and complete-database fingerprint checks;
7. proves the source DB/WAL/SHM set did not change during backup;
8. stores the archive with mode `0600` under `/data/backups` and `fsync`s it;
9. simulates the exact deterministic apply on a temporary copy of the snapshot;
10. records the exact expected complete post-state database fingerprint;
11. atomically stores a server-owned receipt adjacent to the archive.

The receipt binds its UUID, filename, timestamp, byte size, archive SHA-256, source database identity, complete logical database fingerprint, DB/WAL/SHM set and fingerprint, scoped state, user inventory, deployed SHA, bundled and execution plan checksums, exact expected post-state fingerprint, canonical Company ID, Railway identity, archive integrity, and archive completeness.

Later requests supply only the receipt's UUID and filename. The server loads the receipt from its own volume and rejects missing, forged, stale, malformed, internally inconsistent, or context-mismatched receipts. An HTTP caller cannot replace receipt fields.

## Independent protected copy

Backup mode has no automatic transition to apply. The workflow downloads exactly `/backups/<receipt.filename>` from the pinned Railway volume, verifies plaintext SHA-256 and size against the server receipt, encrypts it with GPG AES-256 using a separate protected passphrase, deletes the plaintext runner copy, and uploads only the encrypted file as a GitHub Actions artifact with 30-day retention.

The workflow creates machine evidence containing the GitHub run and artifact IDs/URL, GitHub artifact digest, encrypted-file SHA-256 and size, and every critical receipt binding. It deliberately writes:

```json
{
  "verifiedAt": null,
  "operatorApprovalReference": "",
  "confirmation": "HUMAN_VERIFICATION_REQUIRED"
}
```

An authorized reviewer must independently download the encrypted artifact, verify the GitHub artifact digest, encrypted-file hash/size, decryptability, plaintext archive hash/size, and receipt bindings. Only then may the reviewer set a traceable approval reference, UTC verification time, and exact `INDEPENDENT_COPY_VERIFIED` confirmation for a separately approved apply run.

`apply` rejects arbitrary strings. It requires a structurally valid GitHub Actions artifact URL for the pinned repository and run ID, the expected artifact name, valid digests and sizes, a nontrivial approval reference, a fresh verification timestamp, and exact equality with every stored receipt binding. The application returns only the evidence hash, never the approval evidence itself.

## Apply transaction and TOCTOU closure

`apply` requires exact values for the deployed SHA, execution-plan checksum, scoped-state fingerprint, user-inventory fingerprint, complete source-database fingerprint, DB/WAL/SHM fingerprint, expected complete post-state fingerprint, canonical Company ID, receipt UUID/filename, independent-copy evidence, and literal `RENTCORE_PHASE_A_APPLY` confirmation.

Before opening a write transaction it repeats preflight, reloads and validates the server-owned receipt, validates the archive, rejects receipts older than 24 hours, and compares all approved fingerprints. Inside `BEGIN IMMEDIATE`, before the first write, it repeats both the exact DB/WAL/SHM comparison and the complete logical database fingerprint. The immediate lock closes the gap against another writer after that check.

All identity bootstrap and collection changes happen in that one immediate transaction. Collection updates use compare-and-swap on the original JSON. Bootstrap IDs and timestamps are deterministic from the approved execution plan and backup receipt. Before commit, the runner proves zero remaining planned diff, exact expected semantic state, and the exact simulated complete post-state database fingerprint. Any exception rolls back identity and collection writes together.

Fault-injection coverage forces failures after identity mutation, during collection mutation, and immediately before commit; every scenario proves a complete rollback.

## Verify and rollback readiness

`verify` requires the frozen state, exact SHA, pinned target, and server-owned receipt. It validates the source backup again, then proves read-only:

- the complete current database fingerprint equals the receipt's simulated expected post-state;
- canonical Company and head office are active and exact;
- all approved memberships resolve to the expected trusted Company/tenant scope;
- intentionally unmapped actors have no active membership;
- excluded smoke records remain unscoped;
- no `companyId` / `tenantId` mismatch exists in target collections;
- rerunning the plan produces zero CREATE/UPDATE/RELINK operations;
- SQLite integrity and foreign keys remain valid;
- `total_changes()` remains zero and DB/WAL/SHM stay unchanged during verification.

Rollback material is considered ready only when both copies exist and are verified: the coherent plaintext archive on the pinned Railway volume and the independently downloaded, encrypted GitHub artifact with verified decryptability and matching plaintext hash. Restore is a separate human-authorized operation and is not implemented as an automatic failure handler. An apply or verify failure leaves the maintenance freeze active and does not trigger an unreviewed restore.

## Release configuration

### Application release: preflight only

The only safe initial configuration is:

```text
PRODUCTION_SCOPE_REMEDIATION_ENABLED=true
PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES=preflight
PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET=<independent random secret, at least 32 bytes>
PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE=false
```

The signing secret must match the protected GitHub Environment secret. The release must expose the exact Railway runtime identity variables and `RAILWAY_GIT_COMMIT_SHA`. The workflow's `expected_deployed_sha` must equal the immutable commit actually deployed. This configuration authorizes only read-only preflight; it does not authorize backup or apply.

After the reviewed preflight, disable the surface by setting `PRODUCTION_SCOPE_REMEDIATION_ENABLED=false`, clearing `PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES`, and rotating/removing the signing secret unless a separately reviewed frozen phase is approved.

### Future frozen backup/apply phase

This phase is forbidden until a new reviewed plan resolves every actor/record/relation and supplies an approved identity bootstrap. To avoid an environment-change restart between backup and apply, the same immutable deployment may allow `backup,apply,verify` together, but only while all conservation flags and the central storage write guard are active from process startup. Operation-bound HMACs, protected GitHub Environment approval, server-owned receipts, and exact apply inputs remain mandatory for every individual mode.

## Threat scenarios

| Scenario | Expected result |
|---|---|
| Wrong project/environment/service/volume/name/mount/path/replica | Route returns fail-closed before runner execution |
| Wrong or non-immutable deployed SHA | Preflight aborts |
| Missing, expired, body-altered, mode-altered, or replayed authorization | Request aborts; replay cannot execute twice |
| `apply` while only `preflight` is allowed | 404; runner is not called |
| Backup without complete write freeze | Backup aborts before archive creation |
| New eligible production user | Human-disposition blocker; no wildcard membership |
| New or changed business record | State/database fingerprint blocker |
| Unrelated table or WAL write after approval | Apply aborts before remediation writes |
| WAL-only logically identical write in final pre-transaction gap | Transactional file-set guard aborts |
| Wrong Company ID, plan checksum, state, inventory, or expected post-state | Apply aborts before writes |
| Missing/forged/stale receipt or corrupted archive | Apply aborts before writes |
| Fake or partially bound independent-copy evidence | Apply aborts before writes |
| Failure after identity write, mid-collection, or before commit | Entire transaction rolls back |
| Unexpected post-apply mutation | Read-only verify reports a blocker |
| Repeated apply | Source fingerprints no longer match; no second write |

## Prohibited shortcuts

- No deploy, restart, or remediation may be triggered by this workflow.
- No SSH, TOFU, `ssh-keyscan`, host-key bypass, or shell-on-production path exists.
- No static bearer token is accepted.
- No client-supplied plan or receipt is trusted.
- No backup reference string alone satisfies rollback readiness.
- No plaintext production backup may enter Git, logs, chat, or an unencrypted artifact.
- No apply may automatically follow backup.
- No production apply is authorized by this document.
