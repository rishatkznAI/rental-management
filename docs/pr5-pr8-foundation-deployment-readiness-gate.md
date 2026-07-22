# PR5–PR8 foundation deployment readiness gate

## 1. Executive status

**Gate status:** `FOUNDATION_DEPLOYMENT_BLOCKED`

**Gate timestamp:** `2026-07-22`

**Foundation deployment performed:** `NO`

**Foundation deployment authorized:** `NO`

This gate tests whether the already released PR5–PR8 foundation code could be
delivered over the current PR3 production database without activating business
behavior. It records code audit, read-only production metadata, a coherent local
snapshot, local migration and failure simulations, rollback compatibility and an
operator smoke plan. It is not a deployment approval.

The first local startup applied the expected additive migrations and created no
production identity, source, forecast, dry-run, canonical or settlement business
rows. The gate is nevertheless blocked because repeated startup changed an
existing migration timestamp, public HTTPS ingress is unhealthy, no durable
owner-approved backup or independently accepted restore drill is evidenced, and
storage, artifact, smoke and release approvals are absent.

## 2. Scope

The inspected repository state is
`da9ade9d2921f2a7120118714ffd68863b8445ee`. The production baseline is the
running PR3 artifact `6a38582f5f90b85734884b6b12ad8e306b24619e` and its
read-only SQLite state. Permitted work was limited to repository/GitHub inspection,
read-only Railway metadata and probes, coherent production-to-local capture,
disposable local simulations, tests, build and documentation.

The gate covers:

- startup entrypoint, initializer order, transaction boundaries and failure mode;
- exact PR5–PR8 schema plan and automatic DML;
- static runtime reachability and fail-closed flag/resolver behavior;
- first and repeated startup on a coherent production-derived snapshot;
- malformed, partial, locked, interrupted and space-exhausted migration states;
- previous-production-code startup over the additive migrated schema;
- storage, backup/restore, ingress, artifact and future smoke requirements.

## 3. Explicit non-goals

This work did not deploy, restart or redeploy production; change Railway variables,
domains, network or configuration; run a production initializer; apply a production
migration; create or restore a production backup; bootstrap identity; create PR6
source rows; calculate a PR7 forecast; execute PR8; create canonical or settlement
rows; enable routes or flags; switch Finance, Dashboard or Company Health; implement
PR9; or authorize any activation. The gate changes documentation only.

## 4. PR #218/#219 merged lineage

| PR | Reviewed head / role | Squash merge | Merged at | Result |
|---|---|---|---|---|
| #218 | PRE-PR9 design gate | `7892ea68193fa5357733ca0d554dc84af82e6200` | `2026-07-21T13:21:33Z` | merged in `main` |
| #219 | `0ee1cbcfd87867eb212b35263d4201a09d1de920`; four-document production evidence pack | `da9ade9d2921f2a7120118714ffd68863b8445ee` | `2026-07-22T05:07:35Z` | merged in `main` |

Before #219 was merged, its base was #218, it contained one commit and exactly the
four approved documents, was non-draft and `MERGEABLE/CLEAN`, had no comments,
reviews or unresolved review threads, had auto-merge disabled, and its
`lightweight-pr-check` completed `SUCCESS` at `2026-07-21T13:31:09Z`. The merge
used squash and exact-head protection. D-28–D-33 and all PRE-PR9 production
authorizations remained blocked or false.

## 5. Repository starting SHA

The readiness branch was created from freshly fetched and hard-reset `origin/main`
at `da9ade9d2921f2a7120118714ffd68863b8445ee`. Both #218 and #219 are ancestors
of that SHA. No #218/#219 topic branch was used as the base.

## 6. Current production baseline

| Item | Read-only evidence |
|---|---|
| Railway project / environment / service | `cooperative-vitality` / `production` / `rental-management` |
| Deployment | `b74623ec-d20d-4c50-ab40-0e0a494c5bc5`; `SUCCESS`; instance `RUNNING` |
| Deployed source | `6a38582f5f90b85734884b6b12ad8e306b24619e` |
| Image | `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650` |
| Runtime | Node `v20.18.1`; npm `10.8.2`; Linux `6.18.5+deb13` x86_64 |
| Placement | `europe-west4-drams3a`; one replica; `/data` volume mount; target port `8080` |
| Database | `/data/app.sqlite`; SQLite `3.53.1`; WAL journal; foreign keys enabled |
| Files | DB `11,927,552`; WAL `7,453,112`; SHM `32,768` bytes |
| File hashes | DB `b487d8a5534665aa896a8eea1788342b16969c2e10441e3857296505c3c7cf2b`; WAL `35445701ec00718d8c7c8adfee013580b964b4aa8c6c4063bf10c1b67f491e38`; SHM `bc2e7b214d1a4f19c928d82f452e316c8a61ab75f6646613cea34b7ba32be8c1` |
| Health | internal `/health` `200`; internal `/api/version` `200`; external ingress timeout |
| Baseline migrations | `documents_gantt_shadow_indexes` v2, `canonical_receivables_pr1_schema` v1, `canonical_receivables_pr2_settlement` v1 |
| Production authority/data | PR5 identity `MISSING`; PR6 source authority `MISSING`; PR8 schema `NOT_DEPLOYED`; PR8 evidence `MISSING`; all canonical/settlement row counts `0` |
| Runtime gates | canonical and forecast read flags absent/default false; trusted resolvers return null; canonical write path absent |

`PR5–PR8` migration records and tables are absent in production. Read-only
`foreign_key_check` returned no rows, and `integrity_check` and `quick_check`
returned `ok`. No production state was changed while re-verifying this baseline.

## 7. Deployment drift

Production runs PR3 source `6a38582f...`; the proposed repository point is
`da9ade9...`. The server-side diff contains 34 files, 19,811 additions and 28
deletions. It is the released PR5 identity, PR6 billing-source, PR7 forecast and PR8
diagnostic foundations plus fail-closed read wiring. There is no PR9 source or
canonical posting route in that diff.

This is expected version drift, not authorization to deliver it. A deployment
would execute startup DDL automatically, so the migration, storage, rollback and
verification boundaries remain release-critical even though business paths are
unreachable.

## 8. Startup/dependency audit

The build is Nixpacks/Node 20, uses `npm ci`, and starts with
`node scripts/start-with-release-type.cjs`, which reaches `server/server.js` and
`server/db.js`. `ensureDb()` opens SQLite, enables foreign keys and invokes, in
order:

1. `ensureSqlShadowSchema()`;
2. PR1 canonical schema;
3. PR2 settlement schema;
4. PR5 platform identity;
5. PR6 billing source authority;
6. PR7 forecast planning;
7. PR8 actual-source diagnostic dry run;
8. the existing client-INN shadow-index synchronization.

Each PR5–PR8 initializer owns a separate `better-sqlite3` transaction. Failure
rolls back the current migration and fails startup; the four-migration chain is not
one global transaction, so a crash may leave a valid registered prefix for the
next startup to resume.

Static dependency proof:

- PR5 requires exact PR1/PR2 registrations and structures, clean foreign keys,
  empty canonical company/branch roots and empty financial tables. It rejects
  competing roots and partial schema. Startup adds identity schema and catalog
  v1, but no company, branch, membership, grant or bootstrap row. The bootstrap
  is reachable only through the explicit
  `server/scripts/platform-identity-bootstrap.js` command; it is not imported by
  startup. The production scope resolver returns null.
- PR6 requires PR1, PR2 and validated PR5 identity/catalog state. Its repository
  and service are not imported by `server.js` or any route, worker, scheduler,
  queue or adapter. Startup creates only DDL plus its migration record.
- PR7 requires PR1, PR2, PR5 and PR6. `FORECAST_RECEIVABLES_READ_API_ENABLED`
  parses missing, empty, `false` and malformed values as false. The production
  resolver returns null. The calculation service has no runtime route, worker or
  scheduler importer, and startup creates no run.
- PR8 requires PR1, PR2, PR5, PR6 and PR7. Its policy manifest is code-only; no
  production policy registry, execution route, worker, scheduler or runtime
  service import exists. Startup creates no run or diagnostic row.
- PR1–PR3 canonical reads are registered only when
  `CANONICAL_RECEIVABLES_READ_API_ENABLED` is exactly enabled and still require a
  trusted resolver; missing/malformed values disable the route and production
  resolver resolution fails closed. Canonical mutation and settlement
  repositories have no `server.js`/route importer. No PR9 or canonical insert
  runtime path exists.

Local listener checks with both read flags false returned `200` for `/health` and
`/api/version`, `401` for `/api/auth/me`, and `404` for canonical and forecast
read routes.

## 9. Exact migration plan

| Order | Migration | Version | New tables | DDL indexes / triggers | Automatic DML | Expected business rows |
|---|---|---:|---:|---:|---|---:|
| 1 | `platform_identity_pr5` | 1 | 9 | 11 indexes / 33 triggers | one catalog version, 11 static capabilities, one migration record | 0 |
| 2 | `billing_source_authority_pr6` | 1 | 16 | 23 indexes / 37 triggers | one migration record only | 0 |
| 3 | `forecast_receivables_planning_pr7` | 1 | 8 | 13 indexes / 25 triggers | one migration record only | 0 |
| 4 | `actual_source_eligibility_dry_run_pr8` | 1 | 8 | 14 indexes / 25 triggers | one migration record only | 0 |

PR5 upgrades the two existing empty roots, `canonical_companies` and
`canonical_branches`, in place with identity metadata and global branch identity;
they are not counted as new tables. Its nine new tables are:
`company_memberships`, `membership_branch_access`,
`capability_catalog_versions`, `capability_catalog_entries`, `role_templates`,
`role_template_capabilities`, `membership_capability_assignments`,
`authorization_audit_events`, and `identity_bootstrap_runs`.

PR5 creates these exact indexes: `uq_canonical_branches_global_id`,
`uq_company_memberships_company_principal`,
`uq_membership_branch_access_active`, `uq_membership_capability_active`,
`uq_capability_catalog_single_active`, `uq_identity_bootstrap_success_checksum`,
`idx_company_memberships_principal_status`,
`idx_membership_branch_access_membership_status`,
`idx_membership_capability_membership_status`,
`idx_authorization_audit_company_occurred`, and
`idx_authorization_audit_target`. The first six are the structure validator's
required set. Its exact 33 triggers are:
`trg_canonical_companies_no_delete`, `trg_canonical_companies_immutable_id`,
`trg_canonical_companies_version`, `trg_canonical_companies_active_insert`,
`trg_canonical_companies_active_head_office`,
`trg_canonical_branches_no_delete`,
`trg_canonical_branches_immutable_identity`, `trg_canonical_branches_version`,
`trg_canonical_branches_sentinel_insert`,
`trg_canonical_branches_active_metadata`,
`trg_canonical_branches_active_metadata_update`,
`trg_canonical_branches_active_head_office`,
`trg_company_memberships_no_delete`,
`trg_company_memberships_immutable_identity`,
`trg_company_memberships_version`,
`trg_company_memberships_revoked_terminal`,
`trg_membership_branch_access_no_delete`,
`trg_membership_branch_access_version`, `trg_role_templates_no_update`,
`trg_role_templates_no_delete`,
`trg_role_template_capabilities_no_update`,
`trg_role_template_capabilities_no_delete`,
`trg_capability_catalog_versions_no_update`,
`trg_capability_catalog_versions_no_delete`,
`trg_capability_catalog_entries_no_update`,
`trg_capability_catalog_entries_no_delete`,
`trg_membership_capability_assignments_no_delete`,
`trg_membership_capability_assignments_version`,
`trg_authorization_audit_events_no_update`,
`trg_authorization_audit_events_no_delete`,
`trg_authorization_audit_events_no_replace`,
`trg_identity_bootstrap_runs_no_update`, and
`trg_identity_bootstrap_runs_no_delete`.

PR6 creates exactly: `billing_source_activation_boundaries`,
`billing_source_rental_lines`, `billing_source_effective_terms`,
`billing_source_periods`, `billing_source_period_versions`,
`billing_source_snapshots`, `billing_source_snapshot_evidence`,
`billing_source_upds`, `billing_source_upd_versions`,
`billing_source_upd_lines`, `billing_source_upd_line_versions`,
`billing_source_coverage_sets`, `billing_source_coverage_supersessions`,
`billing_source_coverage_slices`, `billing_source_operations`, and
`billing_source_audit_events`. Its exact indexes are:
`uq_billing_source_rental_binding`, `uq_billing_source_terms_version`,
`uq_billing_source_terms_successor`, `uq_billing_source_period_identity`,
`uq_billing_source_period_version`, `uq_billing_source_upd_identity`,
`uq_billing_source_upd_version`, `uq_billing_source_upd_line_identity`,
`uq_billing_source_upd_line_content_version`,
`uq_billing_source_snapshot_evidence_identity`,
`uq_billing_source_coverage_set_version`,
`uq_billing_source_coverage_supersession_original`,
`uq_billing_source_operation_identity`, `idx_billing_source_period_scope`,
`idx_billing_source_snapshot_scope`, `idx_billing_source_upd_scope`,
`idx_billing_source_coverage_scope`,
`idx_billing_source_coverage_supersession_replacement`,
`idx_billing_source_audit_scope`, `idx_billing_source_blocked_snapshots`,
`idx_billing_source_blocked_upd_versions`,
`idx_billing_source_blocked_upd_lines`, and
`idx_billing_source_blocked_coverage`. Its exact triggers are the
`trg_<each of the 16 table names>_no_update` and
`trg_<each of the 16 table names>_no_delete` pairs, plus
`trg_billing_source_operations_no_replace`,
`trg_billing_source_audit_events_no_replace`,
`trg_billing_source_periods_no_overlap`,
`trg_billing_source_coverage_supersessions_validate`, and
`trg_billing_source_coverage_slices_no_overlap` (37 total).

PR7 creates exactly: `forecast_receivable_runs`,
`forecast_receivable_run_supersessions`, `forecast_receivable_input_snapshots`,
`forecast_receivable_input_events`, `forecast_receivable_items`,
`forecast_receivable_diagnostics`, `forecast_receivable_operations`, and
`forecast_receivable_audit_events`. Its exact indexes are:
`uq_forecast_run_operation`, `uq_forecast_run_supersession_predecessor`,
`uq_forecast_input_per_run_line_component_interval`,
`uq_forecast_event_source_identity`, `uq_forecast_item_coverage`,
`uq_forecast_operation_identity`, `uq_forecast_operation_result`,
`idx_forecast_current_runs`, `idx_forecast_runs_scope`,
`idx_forecast_items_scope`, `idx_forecast_diagnostics_scope`,
`idx_forecast_supersession_successor`, and `idx_forecast_inputs_scope`. Its exact
triggers are the no-update/no-delete pair for each of the eight tables, plus
`trg_forecast_receivable_operations_no_replace`,
`trg_forecast_receivable_audit_events_no_replace`,
`trg_forecast_run_supersession_validate`, `trg_forecast_input_snapshot_validate`,
`trg_forecast_input_event_validate`, `trg_forecast_item_validate`,
`trg_forecast_item_no_overlap`, `trg_forecast_diagnostic_validate`, and
`trg_forecast_operation_finalize_run` (25 total).

PR8 creates exactly: `actual_source_dry_runs`, `actual_source_dry_run_inputs`,
`actual_source_dry_run_candidates`, `actual_source_dry_run_checks`,
`actual_source_dry_run_reconciliations`,
`actual_source_dry_run_diagnostics`, `actual_source_dry_run_operations`, and
`actual_source_dry_run_audit_events`. Its exact indexes are:
`uq_actual_source_input_identity`, `uq_actual_source_candidate_key`,
`uq_actual_source_check_identity`, `uq_actual_source_reconciliation_identity`,
`uq_actual_source_diagnostic_identity`, `uq_actual_source_operation_identity`,
`uq_actual_source_operation_result`, `idx_actual_source_runs_scope`,
`idx_actual_source_candidates_scope`, `idx_actual_source_checks_scope`,
`idx_actual_source_reconciliations_scope`,
`idx_actual_source_diagnostics_scope`, `idx_actual_source_inputs_scope`, and
`idx_actual_source_audit_scope`. Its exact triggers are the no-update/no-delete
pair for each of the eight tables, plus
`trg_actual_source_dry_run_operations_no_replace`,
`trg_actual_source_dry_run_audit_events_no_replace`,
`trg_actual_source_input_before_seal`,
`trg_actual_source_candidate_before_seal`,
`trg_actual_source_check_before_seal`,
`trg_actual_source_reconciliation_before_seal`,
`trg_actual_source_diagnostic_before_seal`,
`trg_actual_source_audit_before_seal`, and
`trg_actual_source_operation_finalize_run` (25 total).

The table-level `CHECK`, foreign-key, unique-key, append-only, scope, state,
version, hash, date, currency and zero-authorization invariants are validated by
each migration before accepting an existing registration. PR8 additionally
compares normalized critical `CHECK`, index and trigger definitions. No initializer
silently repairs a registered weakened schema.

PR5 static DML is exactly catalog version `1` plus 11 capabilities
(`billing.period.close`, `billing.period.reopen`, `branches.manage`,
`companies.manage`, `forecast.calculate`, `forecast.read`, `members.manage`,
`receivables.read`, `upd.conduct`, `upd.correct`, `upd.form`) and the migration
record. Catalog checksum is
`2edf4f8648295c89d29311089e1ee322c6c5463b716e7db8ee7192e253e0ccc6`.
Catalog entries are inert without companies, memberships, branch access, grants and
a non-null trusted resolver. PR6–PR8 automatic DML is limited to one migration
registration each. There is no seed, bootstrap, adapter, run or business-row DML.

## 10. Local production-snapshot capture

A coherent local snapshot was captured from the live database opened with
`readonly: true`, `fileMustExist: true`, `query_only=1` and SQLite serialization in
the production-to-local direction. Production was not checkpointed or modified.

| Evidence | Value |
|---|---|
| Source deployment | `b74623ec-d20d-4c50-ab40-0e0a494c5bc5` / source `6a38582f...` |
| Capture time | `2026-07-22T05:12:05.326Z` |
| Source DB/WAL/SHM hashes | `b487d8a...` / `3544570...` / `bc2e7b2...` as fully recorded in section 6 |
| Local coherent artifact | not committed or uploaded; size `11,927,552` bytes |
| Local artifact SHA-256 | `f196accf243748133c59e69ab6c5a64d865b32e79778b2447c1603c701ed0774` |
| SQLite state | `wal`; foreign keys `1`; `foreign_key_check` empty; integrity/quick `ok` |
| Registry | shadow v2, PR1 v1, PR2 v1 only |
| Baseline objects | 14 tables, 55 indexes, 34 triggers, 0 views |
| Baseline schema hash | `dd2b26e8e807b0744c3ce677a43b7ed9a00a1f1dc3a20f7dfeebffbde4816e6b` |
| Legacy JSON store | 63 `app_data` rows; aggregate content preserved through simulations |
| Canonical/settlement rows | all 0 |

The database artifact was kept outside the repository and was not published.

## 11. Migration simulation

The exact current-main `ensureDb()` was run on a disposable copy with both read
flags false and with no bootstrap or maintenance mode. First startup registered
PR5, PR6, PR7 and PR8, all at `2026-07-22 05:12:42`. Result:

- 55 tables, 116 indexes, 154 triggers and 0 views;
- schema hash
  `cb72667f8960c66f2f896eefb71d19b9c7b95e56ca2c6227ad7a4ef5eb80036b`;
- platform schema fingerprint
  `6b2f8723d45a28054bd3aeeb92b34fb5e5bfd06717913a8cdc31bd8e57b11df3`;
- catalog version rows `1` and catalog entry rows `11`;
- company, branch, membership, branch-access, role-template, role-capability,
  membership-grant, authorization-audit and bootstrap-run rows `0`;
- every PR6, PR7 and PR8 business table row count `0`;
- every canonical and settlement financial table row count `0`;
- 63 legacy `app_data` rows with conserved aggregate content;
- `foreign_keys=1`, empty `foreign_key_check`, and `integrity_check=ok` and
  `quick_check=ok`.

The first-start migration simulation therefore passed. The static catalog is
infrastructure, not production authority.

## 12. Repeated startup

The second exact startup preserved all PR5–PR8 registration timestamps, schema
hashes, schema objects, catalog rows and business row counts. It did not reapply
PR5–PR8. It nevertheless changed the existing
`documents_gantt_shadow_indexes` v2 `applied_at` from
`2026-07-22 05:12:42` to `2026-07-22 05:13:51`.

Cause: `ensureSqlShadowSchema()` unconditionally executes an upsert whose conflict
arm writes `applied_at = CURRENT_TIMESTAMP`. This also produced a repeated-start
WAL peak of `16,512` bytes. The requirement says a second startup must change no
`applied_at`; therefore `repeatedStartupPassed = FALSE`. This gate is docs-only,
so the implementation was not changed here.

## 13. Migration failure matrix

Each case used a separate disposable local copy. The original coherent artifact
remained at SHA-256 `f196accf...`.

| Case | Observed fail-closed result |
|---|---|
| Corrupt prerequisite registry version | `PLATFORM_IDENTITY_PREREQUISITE_REQUIRED:canonical_receivables_pr1_schema:v1` |
| Duplicate migration record | rejected by `SQLITE_CONSTRAINT_PRIMARYKEY` |
| Registered PR8 but missing table | `ACTUAL_SOURCE_PR8_SCHEMA_INCOMPLETE` |
| Weakened PR8 index | `ACTUAL_SOURCE_PR8_SCHEMA_INCOMPLETE` |
| Weakened PR8 trigger | deterministic trigger-structure mismatch |
| Weakened PR8 critical `CHECK` | `ACTUAL_SOURCE_PR8_TABLE_CONSTRAINT_MISMATCH` |
| Partial PR5 schema | `PLATFORM_IDENTITY_UNEXPECTED_PARTIAL_STATE` |
| Competing identity root | `PLATFORM_IDENTITY_COMPETING_AUTHORITY:companies` |
| Existing FK violation | `PLATFORM_IDENTITY_FOREIGN_KEY_CHECK_FAILED` |
| Concurrent `BEGIN IMMEDIATE` lock | `SQLITE_BUSY` |
| Injected PR5 exception after root upgrade | whole PR5 transaction rolled back; no PR5 registration or business rows |
| Interruption after PR5 commit | valid PR5-only prefix; later exact startup resumed PR6–PR8 |
| Locally exhausted `max_page_count` | `SQLITE_FULL`; no false PR5–PR8 registration or business rows; integrity remained `ok` |
| Unexpected pre-existing PR6 object | `BILLING_SOURCE_UNEXPECTED_PARTIAL_STATE` |
| Unexpected pre-existing PR7 object | `FORECAST_PR7_UNEXPECTED_PARTIAL_STATE` |
| Unexpected pre-existing PR8 object | `ACTUAL_SOURCE_PR8_UNEXPECTED_PARTIAL_STATE` |

Registered-but-weakened states were not silently repaired, failures were
deterministic, transactions prevented partial current-migration state, and an
interrupted multi-migration chain was recoverable from its valid prefix.
`migrationFailureMatrixPassed = TRUE`.

The unresolved migration risk is operational: the chain is not globally atomic,
so monitoring and rerun procedure must recognize a valid prefix; disk threshold
and repeated-start timestamp behavior still need approval/fix and re-verification.

## 14. Schema and row-count evidence

| Measurement | Before | First startup | Second startup |
|---|---:|---:|---:|
| Tables | 14 | 55 | 55 |
| Indexes | 55 | 116 | 116 |
| Triggers | 34 | 154 | 154 |
| Views | 0 | 0 | 0 |
| PR5 migration rows | 0 | 1 | 1 |
| PR6 migration rows | 0 | 1 | 1 |
| PR7 migration rows | 0 | 1 | 1 |
| PR8 migration rows | 0 | 1 | 1 |
| Catalog versions / entries | 0 / 0 | 1 / 11 | 1 / 11 |
| PR5 authority/bootstrap/grant business rows | 0 | 0 | 0 |
| PR6 source/business rows | 0 | 0 | 0 |
| PR7 run/item/diagnostic rows | 0 | 0 | 0 |
| PR8 run/candidate/check/reconciliation/diagnostic rows | 0 | 0 | 0 |
| Canonical/settlement financial rows | 0 | 0 | 0 |
| `app_data` rows | 63 | 63 | 63 |
| Foreign-key violations | 0 | 0 | 0 |
| Integrity / quick check | `ok` / `ok` | `ok` / `ok` | `ok` / `ok` |

The only second-start mutation was the existing shadow migration timestamp
described in section 12.

## 15. Storage impact

Production volume allocation is `1,000 MB`. Read-only filesystem evidence reports
`921,432,064` total bytes, `481,689,600` used, `422,965,248` free and 54% used;
inodes are 245,760 total, 1,648 used and 244,112 free (1% used).

The local database file remained `11,927,552` bytes because DDL consumed existing
free pages. Free pages fell by 237 pages at 4,096 bytes, or `970,752` bytes of
logical database capacity. First-start WAL peak was `1,112,432` bytes and SHM was
`32,768` bytes. Repeated-start WAL peak was `16,512` bytes.

The proposed, not approved, minimum is: enough free space for one coherent
`11,927,552`-byte database backup, the `1,112,432`-byte observed migration WAL
peak, `32,768` bytes SHM, and an owner/operations-approved reserve and growth
factor. The raw observed subtotal is `13,072,752` bytes, but it is not a safety
threshold. Backup destination capacity and restore workspace must be assessed
separately. `storageCapacityAccepted = BLOCKED` pending owner/operations approval.

## 16. Backup evidence

No durable production backup artifact or approved mechanism was evidenced. The
local coherent capture is a simulation input, not an accepted backup. Missing
records include destination class, encryption and access policy, retention,
operator, RPO, RTO, restore procedure, validation evidence and owner approval.

`backupAvailable = FALSE`.

## 17. Restore rehearsal/drill

A disposable target was created from the coherent local capture. Source and target
initial hashes both matched `f196accf...`. The previous production initializer
started successfully on the raw restored snapshot. Current-main initialization then
applied PR5–PR8; the result had catalog counts 1/11, zero business rows, conserved
legacy data, the expected schema, empty `foreign_key_check`, and `integrity_check`
and `quick_check` equal to `ok`. The migrated restore target hash was
`43139a34049441c1fb120dfa925a3fbea898dfc013a897e1c98fc654f97f4083`
and size remained `11,927,552` bytes.

This proves a local procedure only: coherent capture, hash verification, previous
code validation, current migration, schema/count validation and integrity checks.
It is not an independent restore from a durable production backup and has no named
operator or owner acceptance. `restoreDrillPassed = FALSE`.

## 18. Previous-code rollback compatibility

Previous production source `6a38582f5f90b85734884b6b12ad8e306b24619e`
was checked out in a detached disposable worktree. Its exact initializer accepted
the PR5–PR8-migrated snapshot, preserved unknown additive tables and registrations,
deleted or rewrote no PR5–PR8 business data, and retained empty financial rows,
empty `foreign_key_check` and `ok` integrity/quick checks.

A local full previous server returned `/health` `200`, `/api/version` `200`,
`/api/auth/me` `401`, `/api/equipment` `401`, and the canonical route `404`.
The 63 `app_data` rows and content hash were conserved. The safe rollback is to
restore the prior application artifact while keeping additive tables and migration
records; there is no down migration. The pre-existing shadow-registration timestamp
rewrite also occurs in this old version but does not prevent startup.

`previousCodeRollbackCompatibilityPassed = TRUE`.

## 19. Public ingress

Railway metadata still maps
`rental-management-production-35bc.up.railway.app` to target port `8080`. DNS A
resolved to `69.46.46.87`. External `HEAD /`, `GET /health`, and
`GET /api/version` each timed out after approximately eight seconds with curl exit
28 and HTTP `000`; TCP connection timed out before TLS, so no HTTP response was
available. The running container's internal `/health` and `/api/version` both
returned `200` and exact deployment/build identity.

Ingress was not changed or repaired. Independent post-deployment verification is
therefore unavailable: `publicIngressHealthy = FALSE`.

## 20. Feature flags/path matrix

| Capability/path | Env key | Missing value | Malformed value | Current production value | Current-main path state |
|---|---|---|---|---|---|
| Canonical receivables read | `CANONICAL_RECEIVABLES_READ_API_ENABLED` | false | false | absent/default false | `DISABLED`; `NULL_RESOLVER` |
| Forecast read | `FORECAST_RECEIVABLES_READ_API_ENABLED` | false | false | absent/default false | `DISABLED`; `NULL_RESOLVER` |
| Forecast calculate | none | n/a | n/a | none | `PATH_ABSENT` from runtime graph |
| PR8 execution | none | n/a | n/a | none | `PATH_ABSENT` from runtime graph |
| Canonical writes | none | n/a | n/a | none | `PATH_ABSENT` |
| Settlement integration | none | n/a | n/a | none | `PATH_ABSENT` |
| Finance consumer switch | none | n/a | n/a | none | `NOT_IMPLEMENTED` |
| Dashboard consumer switch | none | n/a | n/a | none | `NOT_IMPLEMENTED` |
| Company Health/Risks consumer switch | none | n/a | n/a | none | `NOT_IMPLEMENTED` |

Flag parsing was tested with missing, empty, `false`, and malformed values, all of
which resolve false; only explicit supported true forms enable the two read-route
registration gates. No enabling flag was set during simulation.

## 21. Pinned artifact proposal

The only proposed source is exact SHA
`da9ade9d2921f2a7120118714ffd68863b8445ee`; floating `main` is forbidden. It is
not owner-approved. Proposed evidence:

| Artifact component | SHA-256 / value |
|---|---|
| root `package.json` | `78cd0bb5474cae32ff9cd77b3087d7b1ab720819d1ba967a9250e90b23694c2f` |
| root `package-lock.json` | `064721ed5c462a0561adfd50cbdbb08ea0cba4fb128ff0d5d43e2324fe355fd3` |
| `server/package.json` | `fd9826dab816540813841353f581ce3644e058a88b1e70740ae1ca2e164809cd` |
| `server/package-lock.json` | `faaf55b6718804ba2814ef0b02e8664a2b38278413a8c81dba74df94861db4d8` |
| PR5 schema source | `88ff31200bacc46764d967269ae1d68ec963311393f802e3d1aa1de0194c3c88` |
| PR6 schema source | `621c8534d742c1cf3b12f364675a0d989ddb35614574068353a6dec327d6ca00` |
| PR7 schema source | `dbb3005f4112801805557e11f8d7db29a810d30a65529469c64e5bd37251e3a1` |
| PR8 schema source | `e37e4fbdc23956402224657bc80cc3f5959973401922b9c5872e5516907dcdbe` |
| `server/db.js` | `f3fb2ad911e99ac17ee26f7e6520ad5a5c3f4fdb8bffaf79303e42f09938d25f` |
| Ordered migration-set hash | `e8c207bef0b157b058fa56fa594f3e5c697bcdb60c3b5c75834b357f79b282da` |
| Build/start | Nixpacks, Node 20, `npm ci`; `node scripts/start-with-release-type.cjs` |
| Proposed runtime target | Node `v20.18.1`; npm `10.8.2`; exact versions require artifact approval |
| Safe environment fingerprint | `146eb3d634c7d3a667c6aa56905714c5c8ca2e738eed784e91c90bd5ea64b6e8`; existing configuration only |
| Placement | `europe-west4-drams3a`; one replica; `/data`; DB `/data/app.sqlite` |

Before approval, these hashes must be attached to the release record. The safe
variable boundary is no variable change: `APP_DISABLED=false`, `BOT_DISABLED=true`,
`GSM_ENABLED=false`, `DB_PATH=/data/app.sqlite`, and canonical/forecast read flags
absent/default false. Enabling read flags or adding any bootstrap, source,
calculation, dry-run, posting or activation variable is forbidden.

The image digest cannot be known until the exact approved source is built. The
release procedure must capture the resulting immutable image digest and prove that
Railway deployment metadata and `/api/version` report the approved source SHA,
runtime and deployment ID. `pinnedArtifactApproved = FALSE`.

## 22. Post-deployment smoke plan

These are future read-only checks for a separately authorized foundation
deployment. `$APP_URL`, `$DEPLOYMENT_ID`, `$EXPECTED_SHA`, `$EXPECTED_IMAGE` and
`$DB_PATH` must be replaced by approved immutable values in the release record.

| Area | Exact command/check | Expected result | Failure classification | Evidence artifact | Responsible owner |
|---|---|---|---|---|---|
| Deployment identity | Railway deployment metadata for `$DEPLOYMENT_ID` plus `curl -fsS "$APP_URL/api/version"` | approved SHA, deployment ID and image digest all match | P0 artifact drift | signed release capture | release owner |
| Runtime placement | Railway read-only service/deployment metadata | approved Node/npm, region, one replica and `/data` mount | P0/P1 configuration drift | metadata JSON | operations |
| Public health | `curl -fsS "$APP_URL/health"` | HTTP 200 | P1 ingress/runtime failure | timestamped curl transcript | operations |
| Auth boundary | `curl -sS -o /dev/null -w '%{http_code}\n' "$APP_URL/api/auth/me"` | 401 | P0 auth exposure if 200 | timestamped curl transcript | security |
| Database core | readonly `better-sqlite3` query with `query_only=1`: `PRAGMA foreign_key_check; PRAGMA integrity_check; PRAGMA quick_check;` | 0 FK rows; `ok`; `ok` | P0 integrity | redacted query transcript | DBA/operations |
| Migration registry | readonly query of `sql_shadow_schema_migrations` ordered by name | exact shadow v2, PR1–PR8 v1 set and approved timestamps | P0/P1 migration drift | registry CSV/hash | release owner |
| Schema fingerprint | hash normalized `sqlite_master` SQL in readonly mode | approved `cb72667...` and platform `6b2f872...` | P0 schema drift | hash transcript | release owner |
| Repeated startup | separately approved controlled restart, then re-read registry/schema/counts | no timestamp, schema or row change | P1 idempotency failure | before/after signed diff | operations |
| PR5 | readonly counts for roots, memberships, access, roles, grants, audit and bootstrap; catalog counts | authority/business rows 0; catalog 1/11; resolver null | P0 unauthorized identity/bootstrap | redacted count JSON | security/identity owner |
| PR6 | readonly count of all 16 tables and runtime route/import audit | every table 0; no adapter, consumer or route | P0 unauthorized source population | redacted count JSON | source owner |
| PR7 | readonly count of all 8 tables; probe forecast route | all 0; calculate unreachable; read 404; resolver null | P0 unauthorized calculation/read | count/probe transcript | finance owner |
| PR8 | readonly count of all 8 tables and runtime route/import audit | all 0; no policy registry/execution/run | P0 unauthorized dry run | count/import transcript | source/security owners |
| Canonical/settlement | readonly counts of eight financial tables | all 0 | P0 unauthorized financial write | redacted count JSON | accountant/release owner |
| Canonical route | unauthenticated canonical endpoint probe | 404 while flag false | P0 unauthorized read surface | timestamped probe | security |
| Consumers | static deployed-artifact import/route manifest and UI smoke | no Finance, Dashboard or Company Health switch | P0 unauthorized activation | manifest/screenshots | product owner |

This plan itself is not approved, and the repeated-start step is not executable
until a future release authorizes a controlled restart. Any P0 stops/rolls back the
application artifact while preserving additive tables; any P1 blocks acceptance
and invokes the approved incident path. `postDeploymentSmokeApproved = FALSE`.

## 23. Authorization matrix

| Field | Value |
|---|---|
| `pr218Merged` | `TRUE` |
| `pr219Merged` | `TRUE` |
| `productionBaselineReverified` | `TRUE` |
| `migrationPlanVerified` | `TRUE` |
| `migrationSimulationPassed` | `TRUE` |
| `repeatedStartupPassed` | `FALSE` |
| `migrationFailureMatrixPassed` | `TRUE` |
| `previousCodeRollbackCompatibilityPassed` | `TRUE` |
| `storageCapacityAccepted` | `BLOCKED` |
| `backupAvailable` | `FALSE` |
| `restoreDrillPassed` | `FALSE` |
| `publicIngressHealthy` | `FALSE` |
| `postDeploymentSmokeApproved` | `FALSE` |
| `pinnedArtifactApproved` | `FALSE` |
| `ownerReleaseApprovalRecorded` | `FALSE` |
| `foundationDeploymentAuthorized` | `FALSE` |
| `productionActivationAuthorized` | `FALSE` |
| `pr5BootstrapAuthorized` | `FALSE` |
| `pr6SourcePopulationAuthorized` | `FALSE` |
| `pr7ProductionCalculationAuthorized` | `FALSE` |
| `pr8ProductionDryRunAuthorized` | `FALSE` |
| `canonicalProductionReadsAuthorized` | `FALSE` |
| `productionCanonicalWritesAuthorized` | `FALSE` |
| `pr9ImplementationAuthorized` | `FALSE` |

## 24. Blockers

Any one of the following denies deployment authorization:

1. repeated startup mutates the existing shadow migration `applied_at`;
2. public HTTPS ingress times out before TLS;
3. no durable coherent production backup is evidenced;
4. no independently verified, owner-approved restore drill is evidenced;
5. the storage safety threshold and reserve are not owner/operations-approved;
6. the exact source/image artifact is proposed but not owner-approved;
7. the post-deployment smoke plan is not approved;
8. no durable owner/release approval authorizes foundation deployment.

Successful local migration and rollback simulations do not replace these
operational and authorization requirements.

## 25. Deployment authorization status

`FOUNDATION_DEPLOYMENT_BLOCKED`.

D-34 and D-35 are design records only and remain unapproved. Foundation delivery
is distinct from activation, bootstrap, source population, calculations, dry runs,
reads, writes, consumer switching and PR9. No production action is authorized by
this document.

## 26. Next permitted step

Restore public HTTPS ingress and establish an owner-approved coherent backup plus
independently verified restore drill, then rerun the foundation deployment
authorization gate.
