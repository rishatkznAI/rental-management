# PR5–PR8 foundation deployment readiness gate

## 1. Executive status

**Gate status:** `FOUNDATION_DEPLOYMENT_BLOCKED`

**Gate timestamp:** `2026-07-22`; immutable candidate evidence updated `2026-07-23`;
coherent backup, restore, storage and security review updated `2026-07-24`;
disabled-integration execution audit completed `2026-07-24T05:52:47Z`

**Foundation deployment performed:** `NO`

**Foundation deployment authorized:** `NO`

This gate tests whether the already released PR5–PR8 foundation code could be
delivered over the current PR3 production database without activating business
behavior. It records code audit, read-only production metadata, a coherent local
snapshot, local migration and failure simulations, rollback compatibility and an
operator smoke plan. It is not a deployment approval.

The first local startup applied the expected additive migrations and created no
production identity, source, forecast, dry-run, canonical or settlement business
rows. PR #221 closed the repeated-startup timestamp defect identified by this gate:
the registered shadow migration now follows a validated read-only path and retains
its exact original `applied_at`. Public HTTPS ingress was independently reverified
healthy without a Railway or application change. The separate operational closure
evaluation in `docs/pr5-pr8-operational-readiness-closure-gate.md` confirms that the
gate remains blocked. A current encrypted off-volume SQLite artifact and complete
isolated technical restore drill now exist, but backup custody/retention/ownership
and the proposed storage reserve are not approved. Potential prior secret exposure
also remains unresolved, while rotation is deferred under a foundation-only scoped
owner risk acceptance. That acceptance grants no bot/GSM activation authority and
requires no operator/tool token access, no token disclosure or external token use,
and both integrations to remain disabled. The exact candidate satisfies that
clarified boundary: its permitted in-process lookups lead to no MAX request, GSM
ingest action or gateway listener while the disable flags remain exact. The scoped
deferral therefore no longer independently blocks foundation-only readiness, but
artifact, smoke and release approvals are absent. A reproducible local OCI
candidate is bound to an exact digest, but it is not published or owner-approved
and therefore grants no deployment authority.

## 2. Scope

The original readiness simulation inspected repository state
`da9ade9d2921f2a7120118714ffd68863b8445ee`. Its documentation was squash-merged
through PR #220 as `94d9963e5cd18d75bde3414c3a7e05687a2c3ef3`. The shadow
initializer remediation was independently reviewed and squash-merged through PR
#221 as `bbabfdc0bff89953ff746b9a09e0d38147e83085`. PR #222 then merged the
corresponding four-document readiness update as
`c0fd6b51938ff66ec9b81cc2f5cc501c6a52e995`, which is the repository state for
this ingress evidence update. The production baseline remains the running PR3
artifact `6a38582f5f90b85734884b6b12ad8e306b24619e` and its read-only SQLite state.
Permitted work was limited to repository/GitHub inspection, Railway metadata and
log reads, safe DNS/TCP/TLS/HTTP probes, read-only production consistency checks,
tests, build and documentation.

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
PR9; or authorize any activation. Repository changes from the gate are
documentation only. The later operational closure inspection created two inert
SQLite sidecars beside a historical backup despite a read-only open; no live DB or
business data changed. Exact manual deletion plus independent read-only cleanup
verification is recorded in
`docs/pr5-pr8-operational-readiness-closure-gate.md`.

## 4. PR #218–#223 merged lineage

| PR | Reviewed head / role | Squash merge | Merged at | Result |
|---|---|---|---|---|
| #218 | PRE-PR9 design gate | `7892ea68193fa5357733ca0d554dc84af82e6200` | `2026-07-21T13:21:33Z` | merged in `main` |
| #219 | `0ee1cbcfd87867eb212b35263d4201a09d1de920`; four-document production evidence pack | `da9ade9d2921f2a7120118714ffd68863b8445ee` | `2026-07-22T05:07:35Z` | merged in `main` |
| #220 | `4d2e141a696c30860646c40026afc35aeb0b5115`; five-document foundation readiness gate | `94d9963e5cd18d75bde3414c3a7e05687a2c3ef3` | `2026-07-22T06:29:57Z` | merged in `main`; readiness remained blocked |
| #221 | `11f824ccdda63213cc71808bfc42b48b9e51996b`; shadow startup idempotency remediation | `bbabfdc0bff89953ff746b9a09e0d38147e83085` | `2026-07-22T06:58:41Z` | merged in `main`; repeated-startup blocker closed |
| #222 | `1706587aa0ccd28818ff946d5a817a760e0e62c6`; four-document post-#221 readiness update | `c0fd6b51938ff66ec9b81cc2f5cc501c6a52e995` | `2026-07-22T10:59:37Z` | squash-merged unchanged in `main`; no deployment or activation |
| #223 | `1a5dfee9dcd42f28b189017361a3223aeef9d25c`; four-document ingress-readiness evidence | `1d59992315f1b7f4ff2d370fc17345a459ac52e3` | `2026-07-22T11:26:06Z` | squash-merged unchanged in `main`; ingress blocker closed only |

Before #219 was merged, its base was #218, it contained one commit and exactly the
four approved documents, was non-draft and `MERGEABLE/CLEAN`, had no comments,
reviews or unresolved review threads, had auto-merge disabled, and its
`lightweight-pr-check` completed `SUCCESS` at `2026-07-21T13:31:09Z`. The merge
used squash and exact-head protection. D-28–D-33 and all PRE-PR9 production
authorizations remained blocked or false.

Before #220 was merged, its exact reviewed head contained one commit and only the
five approved Markdown files; it was non-draft and `MERGEABLE/CLEAN`, had no
comments, reviews or unresolved review threads, had auto-merge disabled, and its
`lightweight-pr-check` completed `SUCCESS`. Before #221 was merged, its exact
reviewed head contained one commit and only `server/lib/sql-shadow-indexes.js` and
`tests/sql-shadow-indexes.test.js`; the same state, review, mergeability and check
conditions were independently reconfirmed. Both merges used squash and exact-head
protection. Neither merge authorized deployment or activation.

PR #222 was found already squash-merged when its final independent check ran. Its
reviewed head still matched the expected SHA, contained one commit and exactly the
four declared Markdown files, its check had succeeded, and comments, reviews,
unresolved threads and auto-merge were absent. The one-parent merge commit confirms
the squash result. It granted no deployment or activation authority.

Before #223 was merged, its exact reviewed head was non-draft, one commit ahead of
`main` and changed exactly the same four authorized Markdown files. Its lightweight
check completed successfully, GitHub reported `CLEAN` / `MERGEABLE`, auto-merge was
disabled, and comments, reviews and unresolved review threads were absent. The
manual exact-head squash merge granted no deployment or activation authority.

## 5. Repository starting SHA

The original readiness branch was created from freshly fetched and hard-reset
`origin/main` at `da9ade9d2921f2a7120118714ffd68863b8445ee`; #218 and #219 are
ancestors of that SHA. Its result was merged by #220, and the separate #221
remediation then advanced `main` to
`bbabfdc0bff89953ff746b9a09e0d38147e83085`; #222 then advanced `main` to
`c0fd6b51938ff66ec9b81cc2f5cc501c6a52e995` through documentation only; #223
then advanced `main` to `1d59992315f1b7f4ff2d370fc17345a459ac52e3`, again through
documentation only. The operational closure evaluation starts from that resulting
`origin/main`; no topic branch was used as its base.

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
| Health | internal and external `/health` `200`; internal and external `/api/version` `200`; external HEAD for both paths `200` |
| Baseline migrations | `documents_gantt_shadow_indexes` v2, `canonical_receivables_pr1_schema` v1, `canonical_receivables_pr2_settlement` v1 |
| Production authority/data | PR5 identity `MISSING`; PR6 source authority `MISSING`; PR8 schema `NOT_DEPLOYED`; PR8 evidence `MISSING`; all canonical/settlement row counts `0` |
| Runtime gates | canonical and forecast read flags absent/default false; trusted resolvers return null; canonical write path absent |

`PR5–PR8` migration records and tables are absent in production. Read-only
`foreign_key_check` returned no rows, and `integrity_check` and `quick_check`
returned `ok`. No production state was changed while re-verifying this baseline.

## 7. Deployment drift

Production runs PR3 source `6a38582f...`; the current repository point is
`c0fd6b...`. It contains the released PR5 identity, PR6 billing-source, PR7
forecast and PR8 diagnostic foundations, fail-closed read wiring, and the narrowly
scoped #221 shadow-startup remediation; #222 changed documentation only. There is
no PR9 source or canonical posting route in that diff.

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

As of #221, `ensureSqlShadowSchema()` also has an explicit migration boundary. An
absent `documents_gantt_shadow_indexes` v2 registration is applied and registered
once inside an immediate transaction. An existing v2 registration validates the
exact migration-owned tables, columns and indexes and returns through a read-only
path without DDL or registration DML. Registered drift fails closed without repair
or timestamp mutation; concurrent starters serialize and recheck the registration
after acquiring the write lock.

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

The #221 remediation applies the same fail-closed principle to
`documents_gantt_shadow_indexes` v2: exact migration-owned shadow tables, columns
and indexes are validated before an existing registration is accepted. Missing or
weakened registered structure is reported and is neither recreated nor used to
refresh `applied_at`.

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

The capture was independently repeated at `2026-07-24T04:55:14.852Z` using the
same WAL-aware, read-only/query-only SQLite serialization method, streamed directly
off production. It reproduced the exact logical SHA-256
`f196accf243748133c59e69ab6c5a64d865b32e79778b2447c1603c701ed0774`.
The resulting age-encrypted artifact is `11,930,648` bytes with SHA-256
`6a4bfdded51a475b3090bb485a74fd903967d3278536ea2aa49714ab4431b720`.
Source DB/WAL/SHM inode, size, mtime and hashes were byte-for-byte unchanged before
and after; no production file, checkpoint, migration, restart or config mutation
occurred. Destination, access, retention, custody and manifest details are recorded
in the operational closure gate.

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

## 12. Repeated startup and #221 remediation

The original #220 simulation preserved all PR5–PR8 registration timestamps,
schema objects, catalog rows and business row counts, but changed the existing
`documents_gantt_shadow_indexes` v2 `applied_at` from
`2026-07-22 05:12:42` to `2026-07-22 05:13:51`. The audited cause was
`ensureSqlShadowSchema()` unconditionally traversing its DDL and executing an
upsert whose conflict arm wrote `applied_at = CURRENT_TIMESTAMP`. That result was
correctly recorded as `repeatedStartupPassed = FALSE` in the reviewed #220 head.

PR #221, reviewed at exact head
`11f824ccdda63213cc71808bfc42b48b9e51996b` and squash-merged as
`bbabfdc0bff89953ff746b9a09e0d38147e83085`, replaced that behavior with a
transactional apply-once path and a validated read-only path for an existing v2
registration. The remediation evidence used a disposable copy of the same coherent
production-derived snapshot, without rerunning or mutating production:

- baseline shadow registration was version `2` with
  `applied_at = 2026-07-15 07:09:34`;
- the first current-main startup applied PR5–PR8 while preserving that exact shadow
  timestamp;
- a second separate-process startup preserved every migration timestamp, schema
  fingerprint, object count, `app_data` hash and relevant row count;
- the final full-schema fingerprint was
  `466ce614c48d27b0d25ac2e38706d9cc74c8793d79fd1806c11cdb3f65a10a81`;
- all canonical, settlement, identity, source, forecast and dry-run business row
  counts remained `0`, with empty `foreign_key_check` and `integrity_check` /
  `quick_check` equal to `ok`;
- isolated repeated shadow initialization returned `applied=false`,
  `total_changes=0`, produced no WAL and retained the exact registration;
- registered schema drift failed without repair or timestamp mutation, a forced
  first-apply failure left no registration or partial migration-owned objects, and
  six concurrent processes produced exactly one applier and five validated no-op
  followers.

The technical timestamp blocker is closed and
`repeatedStartupPassed = TRUE` for current `main`.

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

The remaining migration risk is operational: the PR5–PR8 chain is not globally
atomic, so monitoring and rerun procedure must recognize a valid prefix, and an
approved disk/storage threshold is still required. The #221 focused failure,
registered-drift and concurrency regressions supplement this unchanged matrix;
`migrationFailureMatrixPassed = TRUE` remains valid.

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

The table records the original #220 simulation. Its only second-start mutation was
the shadow migration timestamp described in section 12. The supplemental #221
simulation preserved the exact timestamp, schema and counts; it supersedes that
single failed condition for current `main` without changing the historical
measurements above.

## 15. Storage impact

Production volume allocation is `1,000 MB`. Read-only filesystem evidence reports
`921,432,064` total bytes, `481,689,600` used, `422,965,248` free and 54% used;
inodes are 245,760 total, 1,648 used and 244,112 free (1% used).

The July 24 drill reconfirmed zero persistent DB-file growth: DDL consumed 237
existing free pages, or `970,752` bytes of logical database capacity. Its maximum
observed candidate first/repeated-start WAL was `1,120,672` bytes; SHM was `32,768`
bytes. The encrypted off-volume backup is `11,930,648` bytes. A conservative
restore workspace holding the encrypted input, raw target, candidate target,
rollback target, WAL and SHM is `48,866,744` bytes.

At migration peak, with no on-volume backup, projected production used/available
bytes are `482,843,040` / `421,811,808`, or `52.401%` / `45.778%` of total. The
proposed fail-closed floor is 30% of total available
(`276,429,620` bytes), with an alert at 35% and a stop before work if projected
available falls below the floor. Projected headroom is `145,382,188` bytes. This
is conservative against measured migration and restore demands, but no named
operations owner has approved the threshold, alert or exception authority.

`storageCapacityAccepted = BLOCKED`.

## 16. Backup evidence

A current WAL-aware logical snapshot was captured read-only at
`2026-07-24T04:55:14.852Z`, encrypted with age X25519, stored off the production
volume and verified at plaintext SHA-256
`f196accf243748133c59e69ab6c5a64d865b32e79778b2447c1603c701ed0774`
and encrypted SHA-256
`6a4bfdded51a475b3090bb485a74fd903967d3278536ea2aa49714ab4431b720`.
The artifact, manifest and restore JSON have restricted `0600` access, with the
identity stored separately. Production DB/WAL/SHM and deployment identity remained
unchanged.

The destination is still a single local workstation. Retention is proposed, not
approved, and the responsible backup owner is unassigned. It is therefore not a
qualifying durable approved backup despite being technically coherent and
restorable.

`backupAvailable = FALSE`.

## 17. Restore rehearsal/drill

The encrypted artifact was independently decrypted twice; each raw target matched
`f196accf...`, and the replay decrypt completed in `0.04 s`. Raw integrity and quick
checks were `ok`, FK violations were `0`, the three production migrations and their
timestamps matched, the schema hash was
`b184599187300ba77ab372ec2a816c4aec0e258d14d7de0198c7424f1dc8819b`,
and 63 `app_data` rows had exact content hash
`5298b2f9b139dfd9885878cd8482d8d3455eccdd597f6a19ef54a532c9e9b312`.

The exact production SHA started with health/version `200`. The exact candidate SHA
then applied PR5–PR8 on a fresh copy and started with health/version `200`; its
logical image hash was
`33d2909c5b42343495596c50ef522161bbf509bd1c26a5836d6397132331c120`
and schema hash was
`30309e9655618597e901279969355069fb849a3709b1089f7c0c5cbc2af8c091`.
Catalog counts were 1/11, all PR5–PR8 and financial business counts remained zero,
and all original data hashes were conserved. A second candidate startup retained
the exact logical hash, schema, seven migration timestamps and counts. The previous
production SHA then started successfully on the migrated image and preserved every
additive object, migration name/version and business count; only its known pre-#221
shadow timestamp rewrite recurred in the isolated copy.

The complete technical drill is reproducible and passed. It has no named owner
acceptance and authorizes no deployment.

`restoreDrillPassed = TRUE`.

`restoreDrillOwnerAccepted = FALSE`.

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

The #221 compatibility replay reconfirmed the same previous deployed SHA against
the locally migrated post-remediation schema: PR5–PR8 structures and registrations
remained readable, the local server health/auth/route boundary remained compatible,
and FK/integrity checks passed. Rolling application code back to that SHA would
reintroduce its known timestamp rewrite, but it does not require a down migration.

`previousCodeRollbackCompatibilityPassed = TRUE`.

## 19. Public ingress

Historical evidence on `2026-07-21` recorded repeated curl exit `28` before TCP/TLS
completion while the running container remained healthy. Railway retained no HTTP
request record for those failed probes, so they did not enter the service's edge
HTTP pipeline. The exact supportable root-cause boundary is therefore a transient
failure on the client-to-Railway-edge network path before HTTP/TLS handling, not an
application, SQLite, deployment-target or service-upstream failure.
[Railway's public status history](https://status.railway.com/historical) records no
widespread incident in that window, and the available service telemetry cannot
responsibly attribute the transient path failure to a narrower carrier or edge
component.

The separate investigation on `2026-07-22` found every persistent ingress
component valid and unchanged:

- production service domain
  `rental-management-production-35bc.up.railway.app`, domain ID
  `a7d3ebee-eaac-41f1-9dfb-7a7da2889f50`, still targets `8080`; there is no custom
  domain or TCP proxy required for this Railway HTTP service;
- the active deployment is still
  `b74623ec-d20d-4c50-ab40-0e0a494c5bc5`, instance
  `54afd747-1bd1-4069-9320-31e03db1f5ea`, source
  `6a38582f5f90b85734884b6b12ad8e306b24619e`, with uninterrupted application
  `startedAt = 2026-07-15T07:09:34.047Z`;
- runtime `PORT=8080`; no `HOST` override is set; Node listens on wildcard
  `[::]:8080`, not loopback; internal `/health` and `/api/version` remained `200`;
- system, Cloudflare `1.1.1.1` and Google `8.8.8.8` DNS lookups agreed on A
  `69.46.46.87` with no AAAA record;
- TLS completed with TLS 1.2 and a valid Let's Encrypt `YE1` certificate for
  `*.up.railway.app`, valid from `2026-07-03T14:01:30Z` through
  `2026-10-01T14:01:29Z`.

Final independent external evidence began at `2026-07-22T11:12:43.704302Z`:

| Probe | HTTP | Railway request ID | Marker / edge result |
|---|---:|---|---|
| `GET /health` | `200` | `PTgPPB-TQBenMdDNnbOCzg` | exact deployment/SHA; edge `europe-west4-drams3a`; no upstream error |
| `GET /api/version` | `200` | `snu9zYjNSqK9yrQEYqdHTg` | exact deployment/SHA; `app.disabled=false`; no upstream error |
| `HEAD /health` | `200` | `jn7uTqhkQoeRJO0FnbOCzg` | Railway edge and upstream both completed normally |
| `HEAD /api/version` | `200` | `ZoWRS1aSSmCntB78YqdHTg` | Railway edge and upstream both completed normally |

Railway edge logs independently correlate all four requests to the same deployment
and instance and show HTTP/2 downstream, HTTP/1.1 upstream to internal
`[fd12:94ee:ee6e:1:4000:b3:d7a7:48e5]:8080`, total edge durations `8`–`15` ms,
and empty `upstreamErrors` / `responseDetails`.

No repair mutation was warranted: the correct domain, target, listener and running
deployment had self-recovered before intervention. No Railway variable, domain,
network, service, deployment or source setting changed; no restart or redeploy ran.
The 33-variable configuration compared exactly equal before/after. Read-only SQLite
captures at `2026-07-22T11:11:11.971Z` and `2026-07-22T11:14:08.405Z` preserved DB,
WAL and SHM inode/size/mtime, all table counts, all three migration rows and exact
`applied_at` values, schema fingerprint
`53a3c1cb87935323cc165575ce3574184d77c4169a723b54e32aa9af1b101e46`, and
`app_data` fingerprint
`dc7f3cb9ef72099dc7b43327c248ae08b6032cd25e029f3f1e3fae41ab94b2fb`; foreign-key
violations remained `0`.

`publicIngressHealthy = TRUE`. This closes only the ingress readiness blocker; it
does not authorize deployment or activation.

## 19A. Potential secret exposure

An earlier runtime-variable inspection may have exposed values in tool output. The
`2026-07-24` names-only audit classified the complete 33-name inventory without
printing or persisting a value. `BOT_TOKEN` and `GSM_INGEST_TOKEN` are the only
affected credentials and both are `MUST_ROTATE`. `WEBHOOK_URL` is a public HTTPS URL
without user-info, query credentials or an embedded known token; it requires no
rotation. No affected authentication/session secret, signing/encryption key or
database credential exists in the inventory.

The owner decision supplied for PR #224 on `2026-07-24` defers both rotations and
accepts temporary bot/GSM integration unavailability. This is scoped risk
acceptance, not secret remediation, foundation release approval or production
activation approval. `BOT_DISABLED=true` and `GSM_ENABLED=false` were reconfirmed
from only those two non-sensitive production flags at `2026-07-24T05:52:47Z`;
deployment `b74623ec-d20d-4c50-ab40-0e0a494c5bc5` and source
`6a38582f5f90b85734884b6b12ad8e306b24619e` were unchanged. Neither token variable
was requested and no Railway mutation or restart occurred.

The owner clarification permits a normal in-process environment lookup while
prohibiting operator/agent/tool value access, logging, persistence, copying,
exposure, external authentication and integration/business activation. The exact
candidate satisfies this boundary. `server/server.js` reads `BOT_TOKEN`, but
`BOT_DISABLED=true` prevents webhook registration/watchdog, polling, schedulers and
outbound sends before a MAX network request. `registerGsmRoutes()` closes over
`GSM_INGEST_TOKEN`, but `requireGsmIngestToken()` returns `503 GSM_DISABLED` before
credential extraction/comparison or packet processing; both TCP gateways are
constructed disabled and do not listen. Startup diagnostics expose token presence
only, and the disabled webhook audit contains only route, count and update-type
metadata. Foundation migrations and health/version startup have no dependency on
either integration. Rotation remains mandatory before either is enabled.

`potentialSecretExposureResolved = FALSE`.

`secretRotationDeferredByOwner = TRUE`.

`secretRotationDeferralFoundationExemptionEffective = TRUE`.

`botIntegrationActivationAuthorized = FALSE`.

`gsmIntegrationActivationAuthorized = FALSE`.

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

The pre-remediation #220 SHA is superseded. The only source currently eligible for
later owner approval is exact `origin/main`
`1d59992315f1b7f4ff2d370fc17345a459ac52e3`; a branch name, floating `main` or
`latest` is forbidden. Its runtime tree is exact #221 because all later changes
through #223 are the four readiness Markdown files. Candidate designation is not
approval.

| Artifact component | SHA-256 / value |
|---|---|
| Candidate source SHA | `1d59992315f1b7f4ff2d370fc17345a459ac52e3`; eligible for approval, not approved |
| Candidate OCI manifest digest | `sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5`; exact `linux/amd64` manifest |
| OCI config digest | `sha256:6cf603c99a44c01c5acfe4665fbf8a0e57b38db93fdab081429f39f03d7717a6` |
| OCI archive SHA-256 | `3a7fdb95c605f5fa94e0f6c269784e469f3b73bef3143fd7e7d0e5af51a4e2f9`; consecutive exports byte-identical |
| Build/source time | evidence completed `2026-07-23T16:33:20Z`; OCI created/source time `2026-07-22T11:26:06Z`; `SOURCE_DATE_EPOCH=1784719566` |
| Builder | local non-production Colima `0.10.3`; Docker `29.6.2`; Buildx `0.35.0`; BuildKit `0.30.0`; target `linux/amd64` |
| Dockerfile frontend / recipe | `docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e`; Dockerfile SHA-256 `59ecb6886b0da436ecd3537f4ee8cb153b7cd85d053e14c99fa828dd67528b8b` |
| `.dockerignore` | exact content `Dockerfile`; SHA-256 `c750b6d776c1db92b55fcecbb51c80be008aae877e78a28691b3ae79be9ea63e` |
| Base image | `node:20.18.1-bookworm@sha256:968ca0550acc7589a8b1324401ec6e39ace53b2c82d2aed3a278e9ff491c2b1c` |
| root `package.json` | `78cd0bb5474cae32ff9cd77b3087d7b1ab720819d1ba967a9250e90b23694c2f` |
| root `package-lock.json` | `064721ed5c462a0561adfd50cbdbb08ea0cba4fb128ff0d5d43e2324fe355fd3` |
| `server/package.json` | `fd9826dab816540813841353f581ce3644e058a88b1e70740ae1ca2e164809cd` |
| `server/package-lock.json` | `faaf55b6718804ba2814ef0b02e8664a2b38278413a8c81dba74df94861db4d8` |
| PR5 schema source | `88ff31200bacc46764d967269ae1d68ec963311393f802e3d1aa1de0194c3c88` |
| PR6 schema source | `621c8534d742c1cf3b12f364675a0d989ddb35614574068353a6dec327d6ca00` |
| PR7 schema source | `dbb3005f4112801805557e11f8d7db29a810d30a65529469c64e5bd37251e3a1` |
| PR8 schema source | `e37e4fbdc23956402224657bc80cc3f5959973401922b9c5872e5516907dcdbe` |
| `server/db.js` | `f3fb2ad911e99ac17ee26f7e6520ad5a5c3f4fdb8bffaf79303e42f09938d25f` |
| #221 shadow initializer source | `49a7a36105b99a36e994074ddc4b3c844d694f2ae377ba8435fc519f35cf9ac6` |
| Exact ordered migration set | `documents_gantt_shadow_indexes` v2; `canonical_receivables_pr1_schema`, `canonical_receivables_pr2_settlement`, `platform_identity_pr5`, `billing_source_authority_pr6`, `forecast_receivables_planning_pr7`, `actual_source_eligibility_dry_run_pr8` each v1 |
| Ordered migration-set hash | `e8c207bef0b157b058fa56fa594f3e5c697bcdb60c3b5c75834b357f79b282da` |
| Candidate image build/start | exact `git archive <candidate>:server`; pinned two-stage OCI build; `npm ci --omit=dev`; Node `v20.18.1`; npm `10.8.2`; `node scripts/start-with-release-type.cjs` |
| Final-image verification | exact Node/npm passed; native `better-sqlite3` load passed; application entrypoint and migrations were not run |
| Expected Railway execution | Nixpacks source baseline is distinct; runtime V2, `/server`, one replica and the same start command; any Railway rebuild must receive its own digest approval |
| Safe config fingerprint reference | `146eb3d634c7d3a667c6aa56905714c5c8ca2e738eed784e91c90bd5ea64b6e8`; secret-free approved-key/value boundary |
| Environment comparison reference | raw 33-variable canonical hash `0f23a29e44e7729e37c2e7420619db16980bb3e640d15352babf7dfc97d44816`; hash only |
| Rollback artifact | source `6a38582f5f90b85734884b6b12ad8e306b24619e`; image `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650`; deployment `b74623ec-d20d-4c50-ab40-0e0a494c5bc5`; read-only Railway metadata reconfirmed `2026-07-23T16:33:50Z`; application rollback only, additive schema retained |
| Approval owner | `MISSING`; named release owner plus named operations co-approval required |
| Placement | `europe-west4-drams3a`; one replica; `/data`; DB `/data/app.sqlite` |

Before approval, a complete manifest must bind this source SHA, built OCI digest,
exact build/runtime versions, migration set, both fingerprint references, rollback
artifact and named approvers in one durable release record. The safe
variable boundary is no variable change: `APP_DISABLED=false`, `BOT_DISABLED=true`,
`GSM_ENABLED=false`, `DB_PATH=/data/app.sqlite`, and canonical/forecast read flags
absent/default false. Enabling read flags or adding any bootstrap, source,
calculation, dry-run, posting or activation variable is forbidden. The scoped
secret deferral additionally requires no bot/GSM route, worker or gateway
activation, no operator/tool token-value access or disclosure and no external token
use. Ordinary in-process lookup is permitted by the clarified owner decision; the
current candidate satisfies this condition while both disable flags remain exact.

The digest was measured from the local non-production OCI artifact and reproduced
by a second byte-identical export; it was not inferred from the current PR3 image.
It has not been pushed to a durable registry or uploaded to Railway. A Railway
source/Nixpacks build is a different artifact and must receive its own pinned digest
and approval. The release procedure must prove that Railway metadata and
`/api/version` match whichever complete artifact manifest is explicitly approved.
`pinnedArtifactCandidateDefined = TRUE`; `pinnedArtifactApproved = FALSE`.

## 22. Post-deployment smoke plan

`pr5-pr8-foundation-post-deployment-smoke-v1` defines future read-only checks for a
separately authorized foundation deployment. `$APP_URL`, `$DEPLOYMENT_ID`,
`$EXPECTED_SHA`, `$EXPECTED_IMAGE` and `$DB_PATH` must be replaced by approved
immutable values in the release record. Defining this plan is not approval and no
deployment-dependent check was executed by PR #224.

| Area | Exact command/check | Expected result | Failure classification | Evidence artifact | Responsible owner |
|---|---|---|---|---|---|
| Deployment identity | Railway deployment metadata for `$DEPLOYMENT_ID` plus `curl -fsS "$APP_URL/api/version"` | approved SHA, deployment ID and image digest all match | P0 artifact drift | signed release capture | release owner |
| Runtime placement | Railway read-only service/deployment metadata | approved Node/npm, region, one replica and `/data` mount | P0/P1 configuration drift | metadata JSON | operations |
| Runtime health | independent internal/public GET/HEAD for `/health` and `/api/version`, startup/log review | HTTP 200, exact marker, valid TLS, no crash/restart loop or migration error | P1 ingress/runtime failure | timestamped probe/log transcript | operations |
| Auth boundary | `curl -sS -o /dev/null -w '%{http_code}\n' "$APP_URL/api/auth/me"` | 401 | P0 auth exposure if 200 | timestamped curl transcript | security |
| Bot disabled boundary | read only `BOT_DISABLED`; inspect startup/transport logs and disabled bot entry points without reading or printing `BOT_TOKEN` | `BOT_DISABLED=true`; in-process lookup permitted; no polling, webhook/watchdog registration, outbound message, worker, external token use or token-bearing output; activation authorization false | P0 unauthorized integration activation | redacted flag/log/probe transcript | security/operations |
| GSM disabled boundary | read only `GSM_ENABLED`; inspect gateway/route state without reading or printing `GSM_INGEST_TOKEN` or sending a packet | `GSM_ENABLED=false`; in-process lookup permitted; ingest fails `503 GSM_DISABLED` before token comparison; no TCP gateway, worker, synthetic packet, external token use or token-bearing output; activation authorization false | P0 unauthorized integration activation | redacted flag/log/probe transcript | security/operations |
| Clarified deferred-secret boundary | static/runtime trace of disabled integration initialization | no operator/tool value access, mutation, disclosure, external authentication or integration/business action; ordinary in-process lookup allowed; current candidate passes while disable flags remain exact | P0 owner-condition violation | source/runtime trace | security/release owners |
| Database core | readonly `better-sqlite3` query with `query_only=1`: `PRAGMA foreign_key_check; PRAGMA integrity_check; PRAGMA quick_check;` | 0 FK rows; `ok`; `ok` | P0 integrity | redacted query transcript | DBA/operations |
| Migration registry | readonly query of `sql_shadow_schema_migrations` ordered by name | exact shadow v2, PR1–PR8 v1 set and approved timestamps | P0/P1 migration drift | registry CSV/hash | release owner |
| Schema fingerprint | hash normalized `sqlite_master` SQL in readonly mode | exact separately approved release fingerprint; #221 local evidence `466ce614...` | P0 schema drift | hash transcript | release owner |
| Repeated startup | separately approved controlled restart, then re-read registry/schema/counts | no timestamp, schema or row change | P1 idempotency failure | before/after signed diff | operations |
| PR5 | readonly counts for roots, memberships, access, roles, grants, audit and bootstrap; catalog counts | authority/business rows 0; catalog 1/11; resolver null | P0 unauthorized identity/bootstrap | redacted count JSON | security/identity owner |
| PR6 | readonly count of all 16 tables and runtime route/import audit | every table 0; no adapter, consumer or route | P0 unauthorized source population | redacted count JSON | source owner |
| PR7 | readonly count of all 8 tables; probe forecast route | all 0; calculate unreachable; read 404; resolver null | P0 unauthorized calculation/read | count/probe transcript | finance owner |
| PR8 | readonly count of all 8 tables and runtime route/import audit | all 0; no policy registry/execution/run | P0 unauthorized dry run | count/import transcript | source/security owners |
| Canonical/settlement | readonly counts of eight financial tables | all 0 | P0 unauthorized financial write | redacted count JSON | accountant/release owner |
| Canonical route | unauthenticated canonical endpoint probe | 404 while flag false | P0 unauthorized read surface | timestamped probe | security |
| Consumers | static deployed-artifact import/route manifest and UI smoke | no Finance, Dashboard or Company Health switch | P0 unauthorized activation | manifest/screenshots | product owner |

Approval requires a durable record binding the exact artifact, commands, evidence
destination/retention, named release/operations/database/security/product owners,
change window, P0/P1 stop rules and application-only rollback target. The
repeated-start step remains non-executable until a future release separately
authorizes a controlled restart. Any P0 stops/rolls back the application artifact
while preserving additive tables; any P1 blocks acceptance and invokes the
approved incident path. Required named approvers and signatures are absent.
`postDeploymentSmokePlanDefined = TRUE`; `postDeploymentSmokeApproved = FALSE`.

## 23. Authorization matrix

| Field | Value |
|---|---|
| `pr218Merged` | `TRUE` |
| `pr219Merged` | `TRUE` |
| `pr220Merged` | `TRUE` |
| `pr221Merged` | `TRUE` |
| `pr222Merged` | `TRUE` |
| `pr223Merged` | `TRUE` |
| `operationalClosureEvaluated` | `TRUE` |
| `productionVolumeMutationCleanup` | `COMPLETE` |
| `productionBaselineReverified` | `TRUE` |
| `migrationPlanVerified` | `TRUE` |
| `migrationSimulationPassed` | `TRUE` |
| `repeatedStartupPassed` | `TRUE` |
| `registeredShadowDriftFailsClosed` | `TRUE` |
| `migrationFailureMatrixPassed` | `TRUE` |
| `previousCodeRollbackCompatibilityPassed` | `TRUE` |
| `storageCapacityAccepted` | `BLOCKED` |
| `backupAvailable` | `FALSE` |
| `restoreDrillPassed` | `TRUE` |
| `restoreDrillOwnerAccepted` | `FALSE` |
| `potentialSecretExposureResolved` | `FALSE` |
| `secretRotationDeferredByOwner` | `TRUE` |
| `secretRotationDeferralFoundationExemptionEffective` | `TRUE` |
| `botIntegrationActivationAuthorized` | `FALSE` |
| `gsmIntegrationActivationAuthorized` | `FALSE` |
| `publicIngressHealthy` | `TRUE` |
| `pinnedArtifactCandidateDefined` | `TRUE` |
| `postDeploymentSmokePlanDefined` | `TRUE` |
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

The repeated-startup timestamp defect is closed by #221, public ingress is healthy
under the separate no-mutation evidence above, and the exact historical-backup
sidecar cleanup is independently verified; none is a current blocker.
Any one of the following remaining conditions still denies deployment authorization:

1. the current encrypted backup has only single-workstation custody and lacks approved retention and a responsible owner;
2. the proposed 30% storage threshold and reserve are not owner/operations-approved;
3. the exact source/image candidate is built and pinned by digest but not durably published or owner-approved;
4. the post-deployment smoke plan is not approved;
5. no durable owner/release approval authorizes foundation deployment.

Successful local migration and rollback simulations do not replace these
operational and authorization requirements.

## 25. Deployment authorization status

`FOUNDATION_DEPLOYMENT_BLOCKED`.

D-34 and D-35 are design records only and remain unapproved. Foundation delivery
is distinct from activation, bootstrap, source population, calculations, dry runs,
reads, writes, consumer switching and PR9. No production action is authorized by
this document.

## 26. Next permitted step

The one next permitted step is to obtain a named operations/release review of the
off-volume backup custody/retention, 30% storage reserve, immutable artifact and
smoke plan. This step does not authorize deployment, activation or PR9; all five
listed blockers remain until durably approved.
