# Skytech identity bootstrap approval packet — current-main reconciliation

Reconciled: 2026-09-04
Historical evidence date: 2026-09-01
Disposition reference: `AUTHORITATIVE_PRINCIPAL_DISPOSITION_2026-09-01`
Packet status: `REVIEW_ONLY_NON_AUTHORIZING`
Production execution authorized: **no**

## Outcome and stop status

The exact owner-approved identity mutation has been reconciled on the exact current-main base `30817fc573f3708436238826bcecc3531051a42a` and sealed as a review-only artifact. A read-only simulation against a retained historical SQLite snapshot projected exactly one Company, one Head Office, one `company-administrator:v1` template, one membership, four authorization audit events, and one bootstrap-run row. It projected no `app_data`, business, financial, schema, migration, tenant-guard, environment, smoke-identity, branch-grant, or direct-capability mutation.

The packet is not an executable production approval. All fresh production bindings remain unresolved, `productionExecutionAuthorized` is false, the bundle exposes no apply capability, and the guarded workflow requires a separate exact authority/config checksum.

No deployment, Railway change, `APP_DISABLED` change, production backup, production write, bootstrap apply, remediation apply, or production database access was performed for this checkpoint.

`authorizedExecutionSha` will bind the exact future deployed mechanism-only `main` SHA. Future authorized bundle bytes must stay outside Git, enter the guarded workflow only as canonical hash-reviewed input, and match an independently provisioned server-side SHA-256 pin. Never commit the generated authorized execution bundle or its sidecar to a Railway-watched branch.

## Current-main provenance

The reconciliation candidate was constructed locally from exactly:

- authoritative base and `origin/main`: `30817fc573f3708436238826bcecc3531051a42a`;
- base commit: `Harden tenant boundaries and production remediation safety (#304)`;
- local branch: `codex/skytech-identity-current-main-reconcile`;
- remote branch/PR/merge/deployment: none;
- production or Railway mutation: none.

The local candidate SHA is intentionally reported in the separately sealed `CURRENT-MAIN SECURITY RECONCILIATION CHECKPOINT`, which is generated after the local commit; embedding that SHA in this committed document would be self-referential. This repository packet does not claim that the candidate is on remote `main`. `authorizedExecutionSha` remains unresolved, and no historical or local candidate SHA is promoted into that execution-time binding.

## Review artifacts

| Artifact | Classification | SHA-256 |
|---|---|---|
| `server/config/skytech-identity-bootstrap-review-bundle.generated.json` | Review-only exact authority/preparation bundle | `af1ae4c0083551acd08ff8b2d368d5f1a11f1ed13e495e2413f26325650ff9eb` (file bytes) |
| Internal bundle seal | Canonical object seal | `7ea357c247f8d3e69216efd2c9239123719579d00da5916b2c4ac5f1f6b7bc8b` |
| `docs/skytech-identity-bootstrap-read-only-simulation-2026-09-01.json` | Historical simulation only | `2ac62738b602b0491259c03f6a0c300e131d5c8d77ce18a1db80cae152693d66` (file bytes) |
| Authority decision | Source-independent disposition seal | `00327ecd08ba955c204102080215528c2c909b8b4ddd88a5ba00b93c1a15e97d` |
| Prepared identity payload | Historical review projection | `70b6eb60fb5b59a5afa3ab06c0f4335feae9743549ac1c40d5b46349bd155c05` |

The `.sha256` sidecars adjacent to the two generated artifacts contain their exact file-byte hashes.

## Exact authority

| Entity | Exact value |
|---|---|
| Company | `ООО "СКАЙТЕХ КОМПАНИ"` |
| Company ID | `cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ` |
| Receivables timezone | `Europe/Moscow` |
| Branch | `Головной офис`, active, `isHeadOffice=true` |
| Branch ID | `brn_VRNOM4ABOTHKRJYODGZSPVE3WPN6CGOJITLZBD2SCYWODKFF5NYQ` |
| Role template | exact `company-administrator:v1` |
| Template capabilities | `branches.manage`, `companies.manage`, `members.manage` |
| Membership ID | `mbr_G2QDD6FEGGZ7TVGHUJQGJJM3JE4DM3HS43RNCDPUXXQ3BNZGAI7Q` |
| Member principal | `1775756913074` — Хабибрахманов Ришат Ринатович |
| Membership state | active; company-wide; no branch grants; no direct capability assignments |

The four exact intentionally-unmapped principals are:

1. `1776673416137` — Мениса / `kmzh@mantall.ru`
2. `1787547467703` — Айзат / `mp2@mantall.ru`
3. `DEMO-USER-CARRIER` — Demo Carrier User
4. `production-smoke-admin` — Production Smoke Admin

For each, the sealed disposition is `INTENTIONALLY_UNMAPPED`, `membershipAcrossAllCompanies=NONE`, and `preserveUserRecordExactly=true`.

## Deterministic ID derivations

| Entity | Canonical key | SHA-256 | Result |
|---|---|---|---|
| Company | `rentcore:company:v1\|jurisdiction=RU\|registry=INN\|value=1660217548` | `f9026198f378c197e6a565035b0299cac846c58ae97e6fa6209c2c3ca4e6c419` | `cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ` |
| Head Office | `rentcore:branch:v1\|companyId=cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ\|kind=HEAD_OFFICE` | `ac5ae6700174cea8a70e19b327d49bb3dbe119c944d7908f52162ce1a8a5eb71` | `brn_VRNOM4ABOTHKRJYODGZSPVE3WPN6CGOJITLZBD2SCYWODKFF5NYQ` |
| Owner membership | `rentcore:membership:v1\|companyId=cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ\|principalId=1775756913074` | `36a031f8a431b3f9d4c7a26064a59b4938366cf2e6e2d10df4bde1b0b726023f` | `mbr_G2QDD6FEGGZ7TVGHUJQGJJM3JE4DM3HS43RNCDPUXXQ3BNZGAI7Q` |

The company, branch, and membership IDs above are source-independent and sealed. The four audit IDs and bootstrap-run ID are deterministic but not yet resolvable: the guarded runner seeds them from the final receipt-bound `executionPlanChecksum` using `sha256("${executionPlanChecksum}:${ordinal}:${prefix}")` and its UUID projection. Ordinals 1–4 use prefix `authorization-audit`; ordinal 5 uses `identity-bootstrap`. Their production values must not be copied from the historical simulation.

All persisted bootstrap timestamps bind to the future receipt timestamp. The exact machine `approvedAt` was not supplied in the disposition and remains an execution-time binding rather than an invented value.

## Sealed hashes and postconditions

| Section | SHA-256/value |
|---|---|
| Authority payload | `2e42b9adfcdfa6d0fb857f3c7be91eee8f113bc7fc8068e02a93ae4a99713c2b` |
| Principal dispositions | `ffe447b1bf74ad26b8512bebec90ea5530c30ea848c88e496d67c04c4ea0df65` |
| Expected row deltas | `bcfc25179ba0b97a39403722a2cd50a8b898c5959121207fc28ed26a9df6fb2b` |
| Audit manifest | `73be25013ca747989693b5d92d82446e80522b7456d0deb2adff86ca0664e26e` |
| Write manifest | `277b3d0858be2970d5be7fe5262a1697acdfa46b918bcb73a9c22fb2ff6adadf` |
| Explicit non-write set | `a4cbcdb194883a32a7f679cfbbcfa1a0691775b77b3fc5df4d918fd35fe3541f` |
| Runtime-ID specification | `c5d7c3003838d5bcd90a784795a097a610b4057dd7ef1d3cff719c3d7944f6d6` |
| Deterministic identity postconditions | `4e7d125d11e122f27551736a794cd132f760172f50f25be5e19384a95f29dd1b` |
| Expected authority snapshot fingerprint | `d4c5bd8f49712e72614755c6e21c0c0a04b37b41bbd0efd29ee6bcb479657926` |
| Required capability catalog | version `1`, checksum `2edf4f8648295c89d29311089e1ee322c6c5463b716e7db8ee7192e253e0ccc6`, mutation count `0` |
| Full database expected post-state fingerprint | `UNRESOLVED_EXECUTION_TIME_BINDING` |

## Expected row-count deltas

| Table | Delta |
|---|---:|
| `canonical_companies` | +1 |
| `canonical_branches` | +1 |
| `role_templates` | +1 |
| `role_template_capabilities` | +3 |
| `company_memberships` | +1 |
| `membership_branch_access` | 0 |
| `membership_capability_assignments` | 0 |
| `authorization_audit_events` | +4 |
| `identity_bootstrap_runs` | +1 |
| `app_data` | 0 |

This is 12 unique inserted/updated rows. SQLite `total_changes` is expected to increase by 13 because the same company row is first inserted inactive and then updated active.

## SQL/write manifest

All allowed SQLite identity DML executes in one guarded `BEGIN IMMEDIATE` transaction. The exact ordered DML surface is:

| Sequence | Table | Operation / exact row identity |
|---:|---|---|
| 1 | `canonical_companies` | Insert Company inactive, version 1, exact Company ID |
| 2 | `canonical_branches` | Insert active Head Office, version 1, exact Branch ID |
| 3 | `canonical_companies` | Update the same Company to active, version 2, guarded by `id` and version 1 |
| 4 | `authorization_audit_events` | Insert `company.authority.created`, target exact Company ID |
| 5 | `authorization_audit_events` | Insert `branch.created`, target exact Branch ID |
| 6 | `role_templates` | Insert exact `company-administrator:v1`, active, catalog v1 |
| 7 | `role_template_capabilities` | Insert `branches.manage` |
| 8 | `role_template_capabilities` | Insert `companies.manage` |
| 9 | `role_template_capabilities` | Insert `members.manage` |
| 10 | `authorization_audit_events` | Insert `role_template.created`, target `company-administrator:v1` |
| 11 | `company_memberships` | Insert exact owner membership, active, company-wide, version 1 |
| 12 | `authorization_audit_events` | Insert `membership.created`, target exact Membership ID |
| 13 | `identity_bootstrap_runs` | Insert one succeeded apply run bound to config/schema/users/backup/authority summary |

Every audit event is bound to the Company, concrete Head Office, actor principal `1775756913074`, catalog version 1, exact approval reference, receipt timestamp, and its deterministic runtime ID. No `INSERT`, `UPDATE`, `DELETE`, or DDL is permitted for any other table or row.

### Operational-control and artifact write surface

The packet SHA sidecar also seals this non-identity operational surface. These writes are not part of the 13 SQLite identity changes and none was performed during this local checkpoint:

- Future activation and revocation of `/data/.production-scope-remediation-authorized-bundle.sha256` are separate, explicitly authorized production-volume writes. The workflow never creates the pin.
- Every future authenticated `preflight`, `backup`, `apply`, or `verify` request may first create `/data/.production-scope-remediation-requests/` and then creates one mode-0600 replay tombstone at `/data/.production-scope-remediation-requests/<sha256(requestId)>.used`. HMAC and exact-bundle validation occur first. The tombstone persists even when the handler fails and is not coupled to the SQLite transaction or database restore.
- `backup` additionally creates the separately authorized coherent archive and receipt under `/data/backups/`, with transient local verification files; the workflow downloads, encrypts, verifies, and publishes the separately reviewed GitHub artifact.
- The GitHub runner writes only transient request/response and allowlisted evidence files in its runner temp/workspace. Those are not application data and are cleaned according to the workflow gates.
- `apply` has exactly 13 SQLite `total_changes` affecting 12 unique identity rows. SQLite DB/WAL bytes change as the atomic transaction commits; SHM may be rebuilt by SQLite observation. There is no reverse-delete path.
- `preflight` and `verify` are SQLite-read-only, but the end-to-end authenticated request is not globally write-free because it consumes its replay tombstone.

The future request ID, replay filename, backup filename, receipt, and artifact identifiers are runtime control values and are not fabricated here. They do not replace or enlarge the 18 production-derived identity bindings. None of these operational artifacts mutates `app_data`, business or financial rows, schema, migrations, tenant guards, process/Railway configuration, or deployment state. Restore does not erase replay tombstones; pin revocation and any artifact cleanup require separately authorized lifecycle steps.

## Explicit non-write set

The following must compare equal before and after, or the transaction/preflight fails closed:

- every `app_data` row and its `name`, `json`, and `updated_at` bytes;
- all user records, including the owner and four intentionally-unmapped principals;
- every business and operational JSON collection;
- every financial JSON collection and the guarded relational finance tables;
- `capability_catalog_versions` and `capability_catalog_entries`;
- `membership_branch_access` and `membership_capability_assignments`;
- `sqlite_master`, schema/user/application versions, migrations, and tenant-guard definitions;
- Railway/environment configuration, `APP_DISABLED`, process environment, deployment state, and standalone smoke identity;
- all record/relation mappings: both lists are exactly empty;
- all business/financial/schema/migration/tenant/environment/smoke mutation counters: exactly zero.

The identity-only planner binds the entire raw `app_data` table into its state fingerprint and rechecks it immediately before commit. A last-moment `app_data` change rolls back the identity transaction.

## Historical read-only simulation

The retained source is historical, non-fresh, and non-authorizing. Its captured deployment was `f01ad6b1a73157096f7bbda51c15f456c30c6fb0` / `f6e441be-8a21-4b2a-b074-e923b91de94d`; neither value is a future execution binding.

The simulator never opened the source with SQLite. It copied only DB+WAL to an ephemeral local mirror, opened that mirror `readonly` with `query_only=ON` and foreign keys on, removed the mirror in `finally`, and compared the original DB/WAL/SHM bytes before and after.

Proof:

- `total_changes`: 0 before, 0 after, delta 0;
- `quick_check`: `ok`;
- foreign-key failures: 0;
- original DB/WAL/SHM byte-identical before/after: true;
- ephemeral mirror removed: true;
- identity plan: `ok=true`, `writes=0`, no blockers, no warnings;
- guarded scope: `IDENTITY_ONLY`, `productionExecutionAuthorized=false`, target collections `[]`, `UPDATE=[]`, `RELINK=[]`, `UNRESOLVED=[]`;
- planned creates: exact Company, exact Head Office, exact role template, exact owner membership only.

Historical source fingerprints:

| Binding | Historical simulation value |
|---|---|
| Source snapshot | `7540a73f49766e1171846da5a0d13e07107b38b9b6a6a28f752207fb2edbee08` |
| Logical database content | `e2424e27e975e980d68296bcfda5d49593b38e99b831e7872093bc9f51ca5a5a` |
| Durable DB/WAL set | `d108ff1bd220a101e9296682b1add4eda6bea36ca7da0a940cd4bb3e3a060bfd` |
| Observed DB/WAL/SHM set | `42e2e797a8530c0dd978f12355c886c33efc997308d7713d045a61ead9c9623c` |
| Schema | `58fcb559e6f8d2244222d5140e052d42ed4e17d95e32a22fcef1f3ce5b88a894` |
| Authority/config | `dcfc0c9b714d6e6aeffc2c46634b33df7f3a31e8582c00b9ed1f1e840d69ab3c` |
| Users directory | `741d05fe393449e7220a23066e58de8eff16ae116285b4911b9b4e0a224fcc16` |
| Complete user inventory | `793faf77ae828914692fadadd94547e90518601a34760535eb385968a08fca71` |
| Raw `app_data` state | `3557918102195f737fcf66e6bacd6f3ef2329c86818d24cac87a279913ba71f2` |
| Guarded state | `6ff76aeb2e8c0d68398bda9c905fa43a48d229f7028b60a1540c3a62f711e658` |
| Historical guarded plan | `da717c3e74250fb5a2c81463461e0d7183fe56d99c44de2b243c0aa1245926cd` |
| Historical execution-plan checksum | `9655a3ec5739a0c9d6371fa2b0eb5d71c1904e74a71ff07b36afd035741b3c85` |

The snapshot had 70 `app_data` rows and 14 users, of whom exactly the five dispositioned principals were eligible and active. The raw `app_data.users` JSON SHA-256 was `5bc789a58d967335aaef561854788e29c11e6f1941aa11b066b293b6952fdb90`.

Protected historical record fingerprints:

| Principal | Record SHA-256 |
|---|---|
| `1775756913074` | `0f61dcb75e71e500e3326b4bdb29c0a763482e86bfbd4a06411bde2082334cca` |
| `1776673416137` | `fce3e1b72ab2135f911acb0f8f22795ceefa6697fb50032077b52fbd7ac0f0bd` |
| `1787547467703` | `6b5982c649e85ced58430aeacff85a21d7e52fc214a43829fab526dfc2d59ef0` |
| `DEMO-USER-CARRIER` | `e17f385ea57461f6943be811dec5fa0067765c90114140827ca53be8e2ec4af6` |
| `production-smoke-admin` | `480a84e78182691e29b0fdc3e0f2f2353bb5486b036240f4f3328c2b0afbf2e2` |

The historical simulation projects deterministic audit/run IDs for that historical checksum, but they are evidence examples only and are deliberately excluded from production runtime bindings.

## Unresolved execution-time bindings

All 18 values below are `UNRESOLVED_EXECUTION_TIME_BINDING` with `value=null`:

1. exact machine `approvedAt`;
2. receipt-derived `backupReference`;
3. fresh authority/config checksum;
4. fresh schema fingerprint;
5. fresh users-directory fingerprint;
6. fresh complete user-inventory fingerprint;
7. fresh captured deployed SHA;
8. fresh capture deployment ID;
9. fresh source-snapshot SHA-256;
10. fresh guarded state fingerprint;
11. fresh raw `app_data` fingerprint;
12. fresh logical database-content fingerprint;
13. fresh durable DB/WAL fingerprint;
14. fresh observed DB/WAL/SHM fingerprint;
15. future exact deployed mechanism-only `main` execution SHA;
16. final receipt-bound execution-plan checksum;
17. fresh coherent backup receipt and independent-copy evidence;
18. full expected post-database fingerprint from the receipt-bound disposable copy.

No historical value may be promoted into any of these fields.

## Fail-closed preconditions for any later production stage

A later, separately authorized stage must prove all of the following before the first write:

1. The safe identity-only mechanism is reviewed on `main`, the exact deployed 40-hex SHA equals the separately approved execution SHA, and the authorized bundle stays external to Git with an independently provisioned exact file-hash pin.
2. The source capture, deployment/service/volume identity, `/data/app.sqlite` target, logical DB fingerprint, schema, complete user inventory, raw `app_data`, durable DB/WAL, and observed DB/WAL/SHM fingerprints match the reviewed fresh evidence.
3. The authority/config checksum recalculated from the live schema and users equals the independently supplied checksum, the base plan, fresh preflight, stored receipt, independent-copy evidence, and transaction-local re-plan.
4. Identity tables begin at exact zero counts; every guarded financial table begins at zero; capability catalog v1 is the sole active catalog with the exact checksum above.
5. Eligible active principals are exactly the owner plus the four intentionally-unmapped principals, with one exact owner membership and four exact `NO_MEMBERSHIP` mappings.
6. The exact source-bound manifest has zero registry records, zero record/relation mappings, zero semantic/collection writes, and no smoke, business, financial, schema, migration, tenant-guard, or environment mutation field.
7. A fresh coherent, recoverable backup and independently verified copy exist and are bound to the exact source, deployed SHA, Railway volume, receipt, hashes, sizes, decryptability evidence, and reviewed execution plan.
8. A disposable-copy simulation supplies the exact expected full post-database fingerprint and exact runtime audit/run IDs.
9. The complete maintenance/write-freeze prerequisites are separately authorized and active. This packet does not authorize changing them.
10. A separately authorized external deployment freeze is active for the full before/request/after window, native autodeploy is disabled, no nonterminal deployment exists, and a sole operator controls every manual/API deployment path. The Railway point-in-time interlock does not constitute an atomic provider lease.
11. Fresh capture simulation runs only on a clean, isolated GitHub-hosted runner with no untrusted same-UID process. Canonical path, symlink, inode, descriptor, and exclusive-create checks are defense in depth; they are not a sandbox against a process that can already tamper with the runner account.
12. There is no pre-existing transaction; foreign keys and integrity checks pass; all source and plan gates are repeated inside the immediate transaction.

Any missing, stale, extra, reordered, or mismatched field must abort before writes. `requireAuthorized=true` rejects the review bundle as `PRODUCTION_EXECUTION_NOT_AUTHORIZED`.

## Exact postconditions

After a separately authorized transaction, verification must prove:

- exact row counts/deltas in the table above;
- exact authority snapshot fingerprint `d4c5...7926`;
- exact active Company, exact active Head Office, exact template/capabilities, and exact owner membership;
- zero branch grants and zero direct capability assignments;
- no membership for any intentionally-unmapped principal across all companies;
- exactly four audit actions, in the sealed order and with the final deterministic IDs;
- exactly one succeeded `identity_bootstrap_runs` row bound to final config/schema/users/backup/summary;
- `app_data`, all protected users, business/financial data, schema, migrations, tenant guards, environment, and unrelated identity state unchanged;
- full database fingerprint equal to the future receipt-bound expected post fingerprint;
- idempotent re-plan with zero remaining identity diff.

## Rollback and restore prerequisites

The write path is atomic. Any failure before commit—including the transaction-local authority checksum, source-state, `app_data`, exact post-state, or expected fingerprint checks—must roll back automatically with no partial identity state.

No reverse-delete remediation is approved or sealed. If a committed transaction later fails external verification, recovery must use the exact fresh coherent backup from the same receipt. Restore requires its own explicit authorization and must bind the encrypted artifact, decrypted plaintext hash and size, DB/WAL pair, Railway volume, source deployment, receipt, and independent-copy verification. After restore, `quick_check`, foreign keys, database-content fingerprint, durable file-set fingerprint, and expected source state must all match. The historical retained snapshot in this packet is not a rollback artifact.

## Verification record

All verification was local and non-production:

- exact identity/bootstrap, identity-only scope, execution-bundle, checksum-gate, remediation, source/baseline/overlay, tenant-boundary, workflow/interlock, and read-only-simulation coverage: 601/601 tests passed;
- complete repository test suite: 4,324/4,324 tests passed, with zero failures, skips, cancellations, or todos;
- fresh authorization-simulation producer: 10/10 tests passed, including two byte-identical outputs from identical WAL-backed frozen inputs, held-descriptor source copying, source/output parent-alias rejection, output inode revalidation, forbidden temp-root rejection, and refusal of production/live-database targets;
- future-write inventory: `PASS`, 736 reviewed sites across 279 source files, 32 exact authorities, zero unknown sites, and zero failed collections;
- future-write source-corpus seal: `17178b8576425cb8c2b37bf858c4dfbd873407a3a2c75c8fa4b19c9278f0fb79`;
- future-write inventory seal: `7f38bafd299c8cd958a345e2d35f57d7ca995cf3f28a88edc44426feac5adde9`;
- the historical and fresh simulators each have only two exact read-only connection-guard fingerprints and no table or collection write authority;
- the generic non-identity remediation CAS is inventoried against exactly 63 current registry collections selected by the retained category-and-array-shape contract; all eight platform-default/tenant-overlay collections and both system collections remain excluded, while the identity-only plan resolves target collections to `[]` and cannot reach that CAS;
- the Railway interlock unit path used injected read-only GraphQL fixtures only; it performed no Railway action and requires disabled native autodeploy, one exact successful deployment/instance/SHA, exhaustive zero nonterminal deployments, and stable before/immediate/after proofs;
- production Vite build: passed (3,401 modules transformed);
- generated JSON parsing, artifact sidecars, JavaScript syntax, workflow YAML parsing, and scoped whitespace/diff checks: passed.

The future-write seals above are repository-audit evidence, not production execution bindings. The read-only historical evidence was revalidated from local retained material; no production capture, backup, simulation, E2E production smoke, production API call, Railway mutation, or other production access was performed.

## Final stop attestation

Current-main reconciliation and local read-only verification are complete. Production readiness remains false because the candidate has not been pushed or merged, all 18 fresh execution bindings are unresolved, no fresh backup exists, and the required external deployment freeze has not been authorized or evidenced. Work stops at this review packet. A separate explicit authorization is required for remote PR/integration and for every production-changing stage.
