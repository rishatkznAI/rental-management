# Final Production Remediation Pre-Approval — 2026-08-25

## A. Verdict

> **HISTORICAL — DO NOT USE AS AN OPERATIONAL RUNBOOK.** The SSH-dependent gates and commands below record the earlier blocked investigation. They are superseded by [`ssh-independent-production-remediation-2026-08-25.md`](./ssh-independent-production-remediation-2026-08-25.md). No SSH path, generic backup endpoint, or command in this historical document is authorized for the current mechanism.

**HISTORICAL VERDICT: BLOCKED — SSH HOST IDENTITY NOT VERIFIED**

Railway production metadata and volume file sizes were obtained through read-only Railway API/CLI calls. The database itself was not opened. Railway SSH resolves to `ssh.railway.com`, but there is no locally pinned key and no independently verifiable Railway-published host-key fingerprint or DNS SSHFP. Railway documents that its CLI delegates the connection to system SSH; Railway support also states that official host-key fingerprints and a rotation policy are not currently published. See [Railway SSH documentation](https://docs.railway.com/cli/ssh) and [Railway host-key fingerprint response](https://station.railway.com/questions/request-for-official-ssh-host-key-finger-d9e1c8d3).

No `ssh-keyscan`, trust-on-first-use, `StrictHostKeyChecking=no`, `accept-new`, or SSH connection was used. Per the stop gate, the fresh DB audit and exact conflict scan stopped here.

Secondary unresolved evidence: the complete current list of eligible active production users is not available. The bootstrap validator requires every eligible active user to have one proposed Membership or appear in an explicit `intentionallyUnmappedUserIds` list. Historical evidence is inconsistent (13 users in an older reset baseline versus 14 in the preceding remediation snapshot), so that list must not be guessed.

## B. Canonical Company

| Field | Authoritative value |
| --- | --- |
| legalName | `ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "СКАЙТЕХ КОМПАНИ"` |
| shortName | `ООО "СКАЙТЕХ КОМПАНИ"` |
| jurisdiction | `RU` |
| INN | `1660217548` |
| KPP | `165501001` |
| OGRN | `1141690077814` |
| legalAddress | `420107, Республика Татарстан, г. Казань, ул. Островского, д. 107, помещ. 49` |
| timezone | `Europe/Moscow` |
| canonicalIdentityKey | `rentcore:company:v1\|jurisdiction=RU\|registry=INN\|value=1660217548` |
| SHA-256 | `f9026198f378c197e6a565035b0299cac846c58ae97e6fa6209c2c3ca4e6c419` |
| Base32 | `7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ` |
| companyId = tenantId | `cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ` |

The Company ID is deterministic, opaque, and independent of legal/display name, address, KPP, and brand changes. Once created, it is immutable canonical identity.

## C. Head Office

Exact proposed canonical Branch:

| Field | Value |
| --- | --- |
| id | `brn_VRNOM4ABOTHKRJYODGZSPVE3WPN6CGOJITLZBD2SCYWODKFF5NYQ` |
| canonicalIdentityKey | `rentcore:branch:v1\|companyId=cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ\|kind=HEAD_OFFICE` |
| SHA-256 | `ac5ae6700174cea8a70e19b327d49bb3dbe119c944d7908f52162ce1a8a5eb71` |
| companyId | canonical Company ID above |
| displayName | `Головной офис` |
| isHeadOffice | `true` |
| status | `active` |
| approved address evidence | legal address above |
| timezone | `Europe/Moscow` via `canonical_companies.receivablesTimezone` |

The current `canonical_branches` schema has no address or timezone column. The approved address is retained as bootstrap evidence; no unsupported field or schema change is proposed.

## D. Membership Mapping

The authoritative capability catalog v1 has exactly 11 entries: `billing.period.close`, `billing.period.reopen`, `branches.manage`, `companies.manage`, `forecast.calculate`, `forecast.read`, `members.manage`, `receivables.read`, `upd.conduct`, `upd.correct`, and `upd.form`. It has no ordinary rental/office CRUD capabilities and no platform-operator, backup, or global-control capability.

No repository-defined production RoleTemplate IDs exist. `role_templates` is runtime bootstrap state; historical production evidence recorded it empty, while fresh production state remains unverified. The following stable semantic template keys are therefore proposed and must be absent in the fresh conflict scan:

| User | Membership ID | Legacy role → canonical template | Canonical capabilities | Branch authority |
| --- | --- | --- | --- | --- |
| `1775756913074` Хабибрахманов Ришат Ринатович | `mbr_G2QDD6FEGGZ7TVGHUJQGJJM3JE4DM3HS43RNCDPUXXQ3BNZGAI7Q` | `Администратор` → `company-administrator:v1` | `branches.manage`, `companies.manage`, `members.manage` | company-wide only within this Company; no explicit future-branch grants |
| `1776673416137` Мениса | `mbr_EYVSFKJBNRTLDU2ZTONKV5QCK37QB7FUARBUM6ORAHDUTMD5UJPA` | `Офис-менеджер` → `office-manager:v1` | none | Head Office only |
| `1787547467703` Айзат | `mbr_S2S4CR7EHVLAAEXCFMBML6IUUPAA7V7RCRCPSPB5OEJVZFGINMEA` | `Менеджер по аренде` → `rental-manager:v1` | none | Head Office only |

The empty canonical capability sets for Office/Rental Manager are intentional least privilege, not removal of existing workflows. Ordinary application behavior continues to use the existing legacy backend RBAC. No `receivables.read` or finance capability is inferred from role names, and no role is elevated for compatibility.

Invariant after Phase A: exactly one active Membership per approved user, all pointing to the active canonical Company, with `tenantId === companyId`. Мениса and Айзат each produce one active `membership_branch_access` row; Ришат uses the existing company-wide authority mode and therefore has no explicit branch row.

## E. `production-smoke-admin`

Recommendation: **temporarily retain fail-closed without Membership, then replace and deactivate**.

Repository dependencies on the masked `PRODUCTION_ADMIN_EMAIL` / `PRODUCTION_ADMIN_PASSWORD` credentials are present in:

- `.github/workflows/deploy.yml`;
- `.github/workflows/finance-production-smoke.yml`;
- `.github/workflows/manager-plan-production-smoke.yml`;
- `.github/workflows/production-dashboard-visual-smoke.yml`;
- `.github/workflows/production-ui-selector-smoke.yml`;
- the corresponding Playwright specs and `scripts/release-targeted-smoke.mjs`.

The secret values were not inspected, and repository evidence cannot prove which production user they identify. The safe replacement is a dedicated, tenant-scoped, least-privilege smoke identity (or separate role-specific smoke identities), used only for read-only checks. It must not be a personal owner account. After secrets/workflows are rotated and the replacement is verified, deactivate `production-smoke-admin`. Do not grant the existing technical account Membership to satisfy preflight.

## F. Business Scope Mapping

Only these four exact-ID Phase A updates are authorized for proposal. Fresh current values and relationships are not captured because the DB was not opened; the historical expected before-state is null/null and must be re-proven immediately before approval.

| Collection / ID | Current companyId | Current tenantId | Proposed companyId | Proposed tenantId | Required relationship validation |
| --- | --- | --- | --- | --- | --- |
| `counterparties / CP-1787305873918-cb43be` | `NOT CAPTURED` (expected null) | `NOT CAPTURED` (expected null) | canonical Company ID | canonical Company ID | unique real SK Alabuga Counterparty; no duplicate/conflicting scope |
| `counterparty_role_assignments / CPRA-19e67e15a554df5b2d434852` | `NOT CAPTURED` (expected null) | `NOT CAPTURED` (expected null) | canonical Company ID | canonical Company ID | unique assignment links to the approved Counterparty and real Client chain |
| `clients / C-1787305873917-d5aa12` | `NOT CAPTURED` (expected null) | `NOT CAPTURED` (expected null) | canonical Company ID | canonical Company ID | unique Client links to approved Counterparty by stable ID |
| `client_objects / CO-1787567881301-0301ec` | `NOT CAPTURED` (expected null) | `NOT CAPTURED` (expected null) | canonical Company ID | canonical Company ID | active object links to approved Client and Counterparty by stable IDs |

No wildcard, name-derived, relationship-derived, or implicit update is allowed. Any current scope other than null/null or the exact proposed idempotent scope is an abort condition.

## G. Smoke Cleanup

Phase B is separate and not part of Phase A:

| Exact ID | Proposed Phase B action | Required precondition |
| --- | --- | --- |
| `CP-1787585239479-4a34e4` | archive exact Counterparty | fresh dependency scan; no business references |
| `CPRA-206c0cc4343e162cbfd7dcf6` | deactivate exact role assignment | parent archived; no business dependency |
| `CO-1787567867426-2c27d0` | delete exact archived smoke fixture | zero live dependencies; audit evidence retained |
| `CO-1787585252222-35e4d5` | delete exact archived orphan | zero live dependencies; audit evidence retained |
| `C-1787585239478-5b4168` | no action; do not restore | record remains absent |

All four smoke records retain null proposed Company/Tenant scope. Phase B requires its own fresh dry-run, backup, exact before-state, and explicit approval.

## H. Fresh Production State

Read-only Railway metadata captured at `2026-08-25T09:07:45Z`:

| Item | Value |
| --- | --- |
| project / environment / service | `1558b38d-bf16-4b50-9ee6-0871b7152116` / `62833109-61cb-4600-9200-d624d6537a05` / `b2016e92-3c50-4b00-800d-625a139b219c` |
| deployment / instance | `d0d3679d-9f0f-40f8-9f28-cbceaeac0209` / `2df579d6-50d9-4b2e-8e41-ad851ed6c645` |
| status | `SUCCESS` / `RUNNING` |
| deployed commit | `1c30e6f7cce61d9d2e42fcbec288e186e215a639` |
| image digest | `sha256:b6c56cb373a9cc075e1ba75e6140fe25575068909c7344b3dbde9869053eb9ce` |
| volume / mount / state | `48b8768c-a8a9-4a87-8a4b-b980fff5d00c` / `/data` / `READY` |
| service-instance node ID returned for volume access | `c65e56df-cc30-4f8f-bc5a-8d7390089a7c` |
| `/data/app.sqlite` | 11,927,552 bytes; hash not captured |
| `/data/app.sqlite-wal` | 7,453,112 bytes; hash not captured |
| `/data/app.sqlite-shm` | 32,768 bytes; hash not captured |

The service-instance node ID and deployment-instance ID are different Railway identifiers and are not conflated.

DB identity, `PRAGMA query_only`, `total_changes`, schema/state fingerprints, hashes, table/collection counts, user status, Membership/Branch/Role conflicts, INN conflicts, approved-record relationships, and new unscoped records are all **NOT CAPTURED**. Matching historical file sizes are not proof of current hashes or state. No sequential live DB/WAL/SHM download was attempted because it would not establish a coherent snapshot.

Required fresh conflict scan after independent host verification:

1. exact Company ID absent and no Company with INN `1660217548` under another ID;
2. deterministic Head Office ID absent, exactly zero existing active Head Offices for the Company, and no branch identity collision;
3. no Membership ID/principal collision, duplicate, inactive, revoked, or cross-company Membership for the three users;
4. RoleTemplate keys/versions absent; any present but non-identical row is an abort;
5. all eligible active users covered by Membership or exact intentional-unmapped list;
6. exact legacy counts/fingerprints match the newly approved baseline;
7. exactly four business records exist uniquely, have null/null or already exact scope, and retain approved stable-ID relationships;
8. no newly discovered unscoped production business record;
9. smoke records remain unscoped and deleted Client remains absent.

Any mismatch means `ABORT` with no writes.

## I. Exact Dry-Run Diff

This is the exact proposed Phase A mutation set, conditional on the fresh checks above. Because current production rows were not read, this is a proposed diff, not a completed production dry-run.

### CREATE

| ID | Type | Before → after | Reason / dependencies |
| --- | --- | --- | --- |
| canonical Company ID | Company | absent → active Company `{displayName, receivablesTimezone}` | authoritative INN; no ID/INN conflict; backup; approval |
| deterministic Head Office ID | Branch | absent → `{companyId, Головной офис, isHeadOffice:true, active}` | Company exists; no Branch/Head Office conflict |
| `company-administrator:v1` | RoleTemplate | absent → three company-management capabilities | catalog v1 exact; no template conflict |
| `office-manager:v1` | RoleTemplate | absent → empty canonical capability set | no legacy privilege inference |
| `rental-manager:v1` | RoleTemplate | absent → empty canonical capability set | no legacy privilege inference |
| Ришат Membership ID | Membership | absent → active Company Administrator, company-wide within Company | user active/unique; Company/template exist |
| Мениса Membership ID | Membership | absent → active Office Manager, Head Office only | user active/unique; Company/template/Branch exist |
| Айзат Membership ID | Membership | absent → active Rental Manager, Head Office only | user active/unique; Company/template/Branch exist |
| Мениса Membership → Head Office | MembershipBranchAccess | absent → active | exact Membership and Branch |
| Айзат Membership → Head Office | MembershipBranchAccess | absent → active | exact Membership and Branch |

RoleTemplate creation also creates exactly three template-capability links for Company Administrator. There are no membership capability overrides.

### UPDATE

Exactly the four rows in section F: expected `companyId:null, tenantId:null` → canonical Company ID for both fields. Already-exact rows are idempotent no-ops. Partial, foreign, or mismatched scope aborts.

### CLEANUP

None in Phase A. The exact Phase B proposal is section G.

### UNRESOLVED

- fresh current before-state, counts, fingerprints, and relationships;
- complete eligible-active-user disposition list;
- CI secret-to-user identity and replacement execution;
- Phase B dependency results;
- coherent backup reference/checksum;
- human approval reference and bootstrap config checksum.

For this reason `authority.identityBootstrap` remains `null`, while the non-executable proposed config is stored separately in the JSON plan.

## J. Expected Post-State

Target after an approved successful Phase A:

| Invariant/count | Target | Fresh delta |
| --- | ---: | --- |
| Canonical Companies / active | 1 / 1 | not computable |
| Head Offices | 1 | not computable |
| Business Memberships | 3 | not computable |
| active Memberships per approved actor | exactly 1 | not computable |
| explicit MembershipBranchAccess rows | 2 | not computable |
| RoleTemplates / template capabilities | 3 / 3 | not computable |
| scoped real Counterparty | 1 | not computable |
| scoped real role assignment | 1 | not computable |
| scoped real Client | 1 | not computable |
| scoped real active Client Object | 1 | not computable |
| smoke records with business scope | 0 | not computable |
| cross-company anomalies | 0 | not computable |
| `tenantId !== companyId` | 0 | not computable |

Actual expected post-state from current production cannot be calculated until the stopped fresh read-only audit succeeds.

## K. Backup Plan

The Company Administrator Membership must not receive backup or platform-operator authority. A separately authorized platform operator performs this procedure immediately before future apply.

1. Verify the Railway SSH host key out-of-band and pin the exact approved key. If that cannot be done, stop.
2. Record current `railway status --json`: deployment ID, deployment-instance ID, Git SHA, image digest, service/volume IDs, mount path, and timestamp.
3. Enter an externally enforced maintenance window: block interactive write traffic, disable bot/webhook/GSM ingest and background writers, wait for in-flight writes to finish, and verify no writer remains. The repository has no single generic maintenance switch, so the operator-specific ingress/integration freeze must be defined and approved before execution.
4. Create a full coherent archive through the existing platform-operator-only backup endpoint, which uses SQLite `db.backup()` and includes local files. From the repository root on a trusted operator workstation:

```bash
REM_RUN_UTC="$(date -u +%Y%m%dT%H%M%SZ)"
REM_BACKUP_DIR="$(mktemp -d)"
REM_ARCHIVE_PATH="$REM_BACKUP_DIR/skytech-pre-phase-a-$REM_RUN_UTC.zip"
test -n "${REM_PLATFORM_TOKEN:?platform operator token is required}"
curl --fail --silent --show-error \
  --header "Authorization: Bearer $REM_PLATFORM_TOKEN" \
  "https://rental-management-production-35bc.up.railway.app/api/admin/backup/full" \
  --output "$REM_ARCHIVE_PATH"
shasum -a 256 "$REM_ARCHIVE_PATH"
stat -f '%z bytes' "$REM_ARCHIVE_PATH"
```

Do not echo or persist `REM_PLATFORM_TOKEN` in shell history or logs.

5. Validate the archive and extract only its coherent database snapshot into the temporary directory:

```bash
node - "$REM_ARCHIVE_PATH" "$REM_BACKUP_DIR/app.sqlite" <<'NODE'
const fs = require('node:fs');
const [archivePath, dbPath] = process.argv.slice(2);
const { inspectFullBackupArchive, readStoredZipEntry } = require('./server/lib/full-backup-validation');
const archive = inspectFullBackupArchive(archivePath);
fs.writeFileSync(dbPath, readStoredZipEntry(archive, 'database/app.sqlite'));
process.stdout.write(`${JSON.stringify({ manifest: archive.manifest, archiveSize: archive.size })}\n`);
NODE
```

6. Verify source DB identity, schema/state fingerprints, read-only invariants, integrity, foreign keys, exact conflict scan, and zero writes on the extracted snapshot:

```bash
node - "$REM_BACKUP_DIR/app.sqlite" <<'NODE'
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { databaseIdentity, planProductionScopeRemediation, sqliteTotalChanges } = require('./server/lib/production-scope-remediation');
const dbPath = process.argv[2];
const plan = JSON.parse(fs.readFileSync('./docs/production-scope-remediation-plan-2026-08-25.json', 'utf8'));
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  db.pragma('query_only = ON');
  const before = sqliteTotalChanges(db);
  const preview = planProductionScopeRemediation({ db, plan });
  const evidence = {
    queryOnly: db.pragma('query_only', { simple: true }),
    totalChangesBefore: before,
    totalChangesAfter: sqliteTotalChanges(db),
    dbIdentity: databaseIdentity(db),
    integrityCheck: db.pragma('integrity_check', { simple: true }),
    foreignKeyViolations: db.pragma('foreign_key_check').length,
    stateFingerprint: preview.stateFingerprint,
    observed: preview.observed,
    blockers: preview.blockers,
    plannedDiff: preview.plannedDiff,
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.queryOnly !== 1 || evidence.totalChangesBefore !== evidence.totalChangesAfter
      || evidence.integrityCheck !== 'ok' || evidence.foreignKeyViolations !== 0) process.exitCode = 1;
} finally {
  db.close();
}
NODE
```

This command is expected to remain blocked until the plan is finalized with fresh fingerprints, the full active-user disposition, approval metadata, and backup reference. It is evidence collection, not apply.

7. Copy the complete archive and its manifest/hash to an approved encrypted off-volume backup store controlled by a different failure domain. Re-download that independent copy to a second `mktemp -d` directory, compare SHA-256 and size byte-for-byte, validate the archive again, and repeat the immutable read-only SQLite checks.
8. Record the archive hash/size, coherent DB hash/size, DB identity, schema/state fingerprints, collection/table counts, deployment SHA/image, storage references, and named operator/approver in the final executable plan.
9. Re-check that production state has not changed since the snapshot. Any change invalidates the approval: remain in maintenance, create a new backup, and recalculate the plan.

## L. Rollback Plan

Rollback means full coherent snapshot restore plus runtime pinning, not deleting Company/Membership rows.

1. Keep write ingress frozen; freeze deploys and integrations.
2. Before overwrite, create and independently copy a full forensic backup of the failed state.
3. Verify the pre-Phase-A archive twice as in section K. Restore it first to an isolated clone and run `integrity_check`, `foreign_key_check`, schema/state fingerprints, all collection counts, and application smoke.
4. Record and select the exact pre-apply deployment ID, Git SHA, and image digest. Use Railway's operator rollback/redeploy control for that recorded artifact; do not deploy latest source and do not change `DB_PATH`, volume mount, or secrets.
5. With the production process stopped and the exact `/data` volume resolved, stage all restored files under a new explicit directory on the same volume. Validate staged paths against the backup manifest. Never restore with unresolved globs, `$HOME`, `~`, or a broad recursive target.
6. Move the current `/data/app.sqlite`, `app.sqlite-wal`, `app.sqlite-shm`, and affected file roots into a timestamped quarantine directory; do not delete them. Move the verified restored `database/app.sqlite` and manifest-listed files into their exact paths. No WAL/SHM sidecars from the failed state may remain beside the restored database.
7. Start only the pinned runtime. Before reopening ingress, open the restored DB read-only/query-only and require: archive/database hashes match, `integrity_check=ok`, zero `foreign_key_check` rows, exact source DB identity/schema/state fingerprints, exact pre-remediation counts, Company/Membership/scope rows restored to pre-Phase-A values, and `total_changes=0`.
8. Verify `/health`, `/api/version`, the pinned commit/image, authentication, tenant isolation, approved business relationships, bot/GSM disabled boundaries, and read-only production smoke. Then reopen ingress in a controlled order.
9. Retain both the failed-state forensic archive and the pre-Phase-A archive under the approved retention policy. Recovery is not complete until the runtime and full data/files state both match the recorded pre-remediation manifest.

Because the repository does not provide an automated full-archive restore command, the exact platform stop/start and file-staging commands must be produced only after the operator resolves the verified production host, runtime filesystem paths, and approved backup location. This prevents a dangerous generic overwrite runbook from being mistaken for an executable command today.

## M. Tests

Targeted results after the offline plan update:

- canonical Company identity tests: passed;
- canonical Branch/Membership deterministic-ID tests: passed;
- role/capability mapping tests: passed;
- branch authority and Membership invariant tests: passed;
- remediation dry-run, conflict-abort, rollback, and idempotency tests: passed;
- targeted total: 22 passed, 0 failed.

Final verification:

- `npm test`: **3493 passed, 0 failed**;
- focused tenant-isolation regression: **11 passed, 0 failed**;
- production build: **passed**, Vite transformed 3394 modules;
- targeted authority/remediation group: **22 passed, 0 failed**;
- syntax checks for Company/Branch/Membership/remediation modules and CLI: **passed**;
- remediation JSON parse: **passed**;
- `git diff --check`: **passed**.

## N. Production Writes

`NONE`

No Company, Branch, RoleTemplate, Membership, scope, cleanup, migration, backup, or other production data write was performed.

## O. Deploy

`NOT PERFORMED`

## P. Approval Gate

**Phase A production remediation requires explicit human approval.**

Approval is not requestable until: Railway SSH host identity is independently verified; a fresh query-only audit and exact conflict scan pass; every eligible active user is explicitly mapped or intentionally unmapped; the exact proposed diff is reconciled to current production; a coherent independently verified backup is created immediately before apply; and the executable bootstrap checksum, backup reference, state fingerprint, approver, and approval reference are frozen.

Phase B cleanup requires a separate explicit human approval and is never bundled into Phase A.
