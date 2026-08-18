# Skytech Clean Production Reset

This runbook is the audit record and operator contract for resetting the Skytech production tenant to a clean launch state. The reset preserves current identities, authorization state, system settings, schema and reference catalogues; it removes business and operational history. It never imports receivables.

## Production baseline

Baseline discovery was performed against `/data/app.sqlite` before any production mutation.

| Property | Baseline |
| --- | ---: |
| SQLite size | 11,927,552 bytes |
| Journal mode | WAL |
| `user_version` | 0 |
| SQLite `schema_version` | 421 |
| `integrity_check` | `ok` |
| FK violations | 0 |
| Users | 13 |
| App settings | 0 |
| Active session rows | 9 |
| Capability catalogue versions / entries | 1 / 11 |
| SQL shadow migrations | 9 |
| Upload files / directories / bytes | 1,517 / 107 / 425,079,298 |

The 13 retained users have these current roles: 6 Administrators, 2 Office Managers, 1 Rental Manager, 1 Sales Manager, 1 Mechanic, 1 Investor and 1 Carrier. Six Administrators are an excessive-privilege review item, but not a technical reset blocker because the task explicitly forbids changing current production roles.

Identity classification is explicit: seven user records and all three MAX identity mappings carry the existing `DEMO-` fixture tag, one user is marked as a smoke account, one inactive user has a smoke-style name, and one user describes a demo/smoke purpose. They are intentionally retained unchanged in this reset because the launch contract more specifically requires **all current production user IDs, auth hashes, activity and roles to remain unchanged**, and explicitly says the current six-Administrator state must not block the reset. The “remove demo/test records” rule is therefore applied to business/operational data, not to records in the production authentication authority. These accounts must be reviewed, disabled or rotated in a separately approved identity change after launch; this reset does not silently change authentication state.

Sealed retention fingerprints:

- complete `users` JSON SHA-256: `53343b80aacecb6d87a0399368c46767c5691e3ea4273fd048c7e26135a6ae92`;
- identity/auth projection SHA-256: `f07f8b61dba608c573a2c14d571b7529b4a67eb1457fa22044b108e328664d12`;
- `app_settings` JSON SHA-256: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`;
- discovered schema SHA-256: `5aafe7628633bec214bb3a6fef78b3f1609e787e2cf4249cd3c2c423e5fe7b9a`;
- migration rows SHA-256: `80d0f866fe156ff6f6bfce34a10284dce533dbca76c05ad1dcd1fa1a2bc67a11`.

Hashes are evidence only and contain no credentials.

## Explicit retention/deletion map

The executable authority is `server/lib/skytech-clean-production-reset.js`. An unknown SQLite table, unknown `app_data` collection, invalid JSON collection, business ID embedded in settings, local-file reference from a retained collection, or unsupported filesystem entry such as a symlink is a hard blocker.

### Retained collections and tables

| Table/entity | Keep/Delete | Reason | Dependency |
| --- | --- | --- | --- |
| `app_data.users` | Keep byte-for-byte | Current users, IDs, login hashes, roles, status and user activity fields | Auth, RBAC, MAX identity links |
| `app_data.app_settings` | Keep byte-for-byte | System/application settings | Runtime configuration; business-ID scan must be empty |
| `app_data.bot_users` | Keep byte-for-byte | MAX user identity and current role mapping | Bot authentication and authorization |
| `app_data.knowledge_base_modules` | Keep byte-for-byte | System reference/training catalogue | Knowledge-base UI |
| `app_data.service_works` | Keep byte-for-byte | Existing legacy service work reference catalogue | Service forms and calculations |
| `app_data.spare_parts` | Keep byte-for-byte | Existing legacy parts reference catalogue | Service/parts forms |
| `app_data.service_route_norms` | Keep byte-for-byte | System route norm catalogue | Service route calculation |
| `app_data.service_work_catalog` | Keep byte-for-byte | System work catalogue | Service forms |
| `app_data.spare_parts_catalog` | Keep byte-for-byte | System parts catalogue | Service forms |
| `app_data` | Keep table/schema; selectively empty values | JSON collection storage | Individual retained collections are separately sealed |
| `app_sessions` | Keep rows | Current authentication sessions and user activity | Login/token continuity |
| `sql_shadow_schema_migrations` | Keep rows | Migration state | Startup/schema compatibility |
| `capability_catalog_versions`, `capability_catalog_entries` | Keep rows | Permission catalogue | RBAC evaluation |
| `canonical_companies`, `canonical_branches` | Keep rows | Platform identity authority | Membership and capability FK roots |
| `role_templates`, `role_template_capabilities` | Keep rows | Current role definitions | Membership permissions |
| `company_memberships`, `membership_branch_access`, `membership_capability_assignments` | Keep rows | Current identity/role/branch/capability assignments | Authorization |
| `authorization_audit_events` | Keep rows | Authorization change history, not business history | Authorization integrity |
| `identity_bootstrap_runs` | Keep rows | Identity/bootstrap technical history | Startup/schema control |

At the discovered production baseline, the retained reference counts are: `bot_users=3`, `knowledge_base_modules=4`, `service_works=141`, `spare_parts=125`, `service_route_norms=4`, `service_work_catalog=0`, and `spare_parts_catalog=125`. The canonical identity/membership tables currently contain zero rows but remain because they are schema-level authorization foundations.

### Deleted `app_data` business collections

| Table/entity | Keep/Delete | Reason | Dependency |
| --- | --- | --- | --- |
| `equipment`, `equipment_finance`, `equipment_downtimes`, `equipment_operation_sessions` | Delete | Fleet and its operational/financial history | Rentals, service, delivery, GSM |
| `rentals`, `gantt_rentals`, `rental_change_requests`, `rental_create_idempotency` | Delete | Contractual rental state, projections, requests and replay guards | Clients, equipment, documents, payments |
| `clients`, `client_objects`, `client_contracts`, `inline_relation_idempotency` | Delete | Customer master and business relations | Counterparty customer roles, rentals, documents |
| `counterparties`, `counterparty_role_assignments`, `supplier_profiles`, `contractor_profiles` | Delete | Tenant business parties and business role profiles | Clients, warranty, carriers, finance |
| `payments`, `payment_allocations` | Delete | Payment and allocation ledger | Rentals, clients, AR |
| `debt_collection_plans`, `debt_collection_actions`, `receivable_payment_plans` | Delete | AR collection workflow | Counterparties, payments, rentals |
| `finance_accounts`, `finance_operations`, `company_expenses` | Delete | Operational finance data | Reports and dashboards |
| `leasing_contracts`, `leasing_payment_schedule` | Delete | Leasing obligations | Finance and reports |
| `payroll_profiles`, `payroll_periods`, `payroll_records`, `payroll_adjustments`, `payroll_audit_events` | Delete | Payroll business state | Users only as labels/IDs |
| `documents`, `mechanic_documents` | Delete | Customer/rental/service documents | Clients, rentals, service |
| `deliveries`, `delivery_carriers`, `shipping_photos` | Delete | Transport tasks and proof | Rentals, equipment, counterparties |
| `service`, `warranty_claims`, `service_field_trips`, `repair_work_items`, `repair_part_items`, `service_audit_log` | Delete | Repair, warranty and field-service operations/history | Equipment, clients, counterparties |
| `owners`, `mechanics` | Delete | Operational business profiles, not login identities | Equipment/service; `users` remain authoritative identities |
| `gsm_devices`, `gsm_packets`, `gsm_commands` | Delete | GSM configuration bound to fleet and telemetry/commands | Equipment |
| `crm_deals`, `crm_activities` | Delete | Sales pipeline and contacts/activity | Clients/counterparties |
| `planner_items`, `service_vehicles`, `vehicle_trips` | Delete | Operational plans, service fleet and trip history | Service/users |
| `knowledge_base_progress` | Delete | User operational progress, not reference content | Users/modules |
| `bot_sessions`, `bot_activity`, `bot_notifications`, `manager_activity`, `management_action_states` | Delete | In-flight scenarios, notifications and business action state | Deleted operational entities |
| `audit_log`, `audit_logs` | Delete | Historical snapshots contain deleted business records | All business domains |
| `snapshot` | Delete | Cached business/report state | Dashboards/reports |

The discovered non-zero collection impact is:

| Collection | Before | After |
| --- | ---: | ---: |
| `equipment` | 2 | 0 |
| `rental_change_requests` | 1 | 0 |
| `service` | 1 | 0 |
| `gsm_devices` / `gsm_packets` / `gsm_commands` | 8 / 24 / 3 | 0 / 0 / 0 |
| `leasing_contracts` / `leasing_payment_schedule` | 6 / 18 | 0 / 0 |
| `crm_activities` | 10 | 0 |
| `equipment_operation_sessions` | 6 | 0 |
| `repair_work_items` / `repair_part_items` | 66 / 3 | 0 / 0 |
| `bot_sessions` / `bot_activity` / `bot_notifications` | 2 / 2 / 6 | 0 / 0 / 0 |
| `manager_activity` / `management_action_states` | 10 / 1 | 0 / 0 |
| `audit_log` / `audit_logs` | 2 / 460 | 0 / 0 |
| `snapshot` | 3 | 0 |

Every other deleted collection was already zero in the discovery snapshot and remains explicitly in the deletion allowlist.

### Deleted SQL business tables

All discovered SQL business tables were zero at baseline. They remain explicit in the reset so a late write cannot escape the production apply.

| Table/entity | Keep/Delete | Reason | Dependency |
| --- | --- | --- | --- |
| `client_inn_index`, `documents_sql`, `gantt_rentals_sql` | Delete rows | SQL shadows/indexes of deleted JSON business data | Clients/documents/rentals |
| `canonical_receivables`, `canonical_approval_requests`, `canonical_payments`, `canonical_payment_allocations`, `canonical_receivable_adjustments`, `financial_audit_events` | Delete rows | Canonical AR/finance business ledger and audit | Company/branch identity retained |
| `billing_source_activation_boundaries`, `billing_source_periods`, `billing_source_period_versions`, `billing_source_upds`, `billing_source_upd_versions`, `billing_source_upd_lines`, `billing_source_upd_line_versions`, `billing_source_rental_lines`, `billing_source_effective_terms` | Delete rows | Billing-source contractual and document history | Canonical company/branch retained |
| `billing_source_coverage_sets`, `billing_source_coverage_slices`, `billing_source_coverage_supersessions`, `billing_source_snapshots`, `billing_source_snapshot_evidence`, `billing_source_operations`, `billing_source_audit_events` | Delete rows | Billing coverage/snapshot/operation history | Billing source records |
| `forecast_receivable_runs`, `forecast_receivable_run_supersessions`, `forecast_receivable_input_snapshots`, `forecast_receivable_input_events`, `forecast_receivable_items`, `forecast_receivable_diagnostics`, `forecast_receivable_operations`, `forecast_receivable_audit_events` | Delete rows | Forecast AR operational state | Billing inputs/capabilities |
| `actual_source_dry_runs`, `actual_source_dry_run_inputs`, `actual_source_dry_run_candidates`, `actual_source_dry_run_checks`, `actual_source_dry_run_reconciliations`, `actual_source_dry_run_diagnostics`, `actual_source_dry_run_operations`, `actual_source_dry_run_audit_events` | Delete rows | Actual-source dry-run business evidence | Billing inputs/capabilities |
| `governed_adapter_authority_records`, `canonical_write_authorization_records`, `canonical_posting_activation_records` | Delete rows | Tenant financial posting activation/authority records, currently empty and tied to deleted business graph | Technical capability catalogue retained |
| `actual_receivable_eligible_events`, `canonical_receivable_posting_operations`, `canonical_receivable_posting_conflicts`, `canonical_receivable_posting_conflict_transitions` | Delete rows | Actual posting events/conflicts | Canonical AR graph |

SQL append-only triggers are never dropped or rewritten. A non-zero append-only table that refuses deletion causes the transaction and staged file cleanup to roll back. This preserves schema metadata and fails closed instead of bypassing an integrity control.

### File storage

The allowed business file roots are `/data/uploads`, `/data/photos`, `/data/documents`, `/data/files`, and `/data/attachments`. Only `/data/uploads` exists in the discovered production volume. The reset first atomically renames each non-empty root into a timestamped `.skytech-reset-quarantine-*` directory and creates an empty replacement. If the database transaction fails, the rename is rolled back. Purge is a separate guarded action performed only after production verification; the full backup remains under `/data/backups` and is never in cleanup scope.

No retained production collection currently references a local file under these roots. A future retained avatar, logo or other local reference blocks the reset rather than deleting it.

## Reset controls

Local dry-run is the default:

```bash
node server/scripts/skytech-clean-production-reset.js --dry-run --db=/path/to/app.sqlite
```

An isolated apply requires an existing backup, matching SHA-256 and exact confirmation:

```bash
node server/scripts/skytech-clean-production-reset.js \
  --apply \
  --environment=isolated \
  --confirm=SKYTECH_CLEAN_ISOLATED_RESET \
  --backup=/path/to/verified-backup.sqlite \
  --backup-sha256=<sha256> \
  --db=/path/to/reset-copy.sqlite
```

Production apply additionally requires:

- `SKYTECH_CLEAN_RESET_ENABLED=true` on the backend;
- live conservation state proving `APP_DISABLED=true`, `BOT_DISABLED=true` and GSM writers disabled;
- a reset token of at least 32 characters supplied only through the protected operations header;
- exact `SKYTECH_CLEAN_PRODUCTION_RESET` confirmation;
- `preResetAudit=pass`;
- the exact backup basename and matching SHA-256;
- a blocker-free dry-run.

The apply guard parses the stored ZIP structure and CRCs, requires the Skytech full-backup manifest and `database/app.sqlite`, requires `skippedFilesCount=0`, opens the embedded SQLite snapshot, proves its integrity/FKs/schema/migrations and exact logical equality to the current database, and verifies every current business file by archive path, size and CRC-32. A renamed text file, incomplete archive, late database write, changed attachment or skipped/blocked attachment fails before file staging or `BEGIN IMMEDIATE`.

The manual GitHub Actions workflow `.github/workflows/skytech-clean-production-reset.yml` exposes only `dry-run`, `backup`, `verify`, `apply` and `purge-quarantine`. Its reset token is a temporary secret and must be removed from both GitHub and Railway after completion.

## Backup, restore and apply gate

The production sequence is fixed:

1. Put the app, MAX bot and GSM writers in maintenance/disabled mode and wait for the exact deployed backend SHA.
2. Run guarded `backup`; record UTC timestamp, filename, size, SHA-256, manifest collection/file counts and `skippedFilesCount=0`.
3. Keep the remote backup in `/data/backups` and download that exact stored file to a protected directory outside Git with the authenticated, project-linked Railway CLI. Do not create a different fresh backup and do not upload the archive as a GitHub artifact:

   ```bash
   railway volume files --volume "$RAILWAY_VOLUME_ID" download \
     "/data/backups/$BACKUP_FILENAME" \
     "$PROTECTED_BACKUP_DIR/$BACKUP_FILENAME" --json
   shasum -a 256 "$PROTECTED_BACKUP_DIR/$BACKUP_FILENAME"
   ```

   The local SHA-256 must equal the guarded backup receipt before the restore drill starts.
4. Restore the downloaded archive into an isolated directory; verify archive SHA, manifest, SQLite `integrity_check=ok`, FK count 0, users/settings hashes, original collection counts, backend `/health`, `/health/ready` and `/api/version`.
5. Apply the reset to a second isolated restore; verify every deleted collection/table is zero, all retention seals match and the backend/UI start in zero-state.
6. Run unit/build checks and independent pre-reset audit. P0, P1 and reset-related P2 must all be zero.
7. Re-run production dry-run immediately before apply. Any drift or blocker stops the operation.
8. Apply once through the workflow. Verify DB health, exact counts and retention hashes before reopening the app.
9. Temporarily reopen only the web app while MAX bot and GSM writers remain disabled. Run auth/RBAC/UI smokes and a reversible non-financial write smoke limited to Client/Counterparty, Equipment, Rental, Service and Delivery. Do **not** create a production Payment, opening AR or Document: opening AR and Document are proved on isolated copies, and Document numbering would mutate retained `app_settings`. Remove the active test graph through standard endpoints.
10. Drain active web requests, disable the web app again and prove APP, MAX bot and GSM writers are all blocked. Because Counterparty archival and audit are intentionally historical, create a **second** uniquely named coherent full backup of the current post-smoke state. Record its own SHA-256, require `skippedFilesCount=0`, download that exact `/data/backups/<second-name>` archive with the same explicit `railway volume files --volume "$RAILWAY_VOLUME_ID" download` command, prove the downloaded SHA matches the second receipt, restore-drill it in isolation with integrity/FK/count checks, and run a fresh production dry-run. The original pre-reset backup cannot be reused: exact logical-database validation must and will reject it after smoke writes.
11. Run the second guarded apply using the second backup filename/SHA. Verify exact zero again and re-check the original users/settings/schema/migration seals. Purge only the first and second reset quarantines after all verification succeeds.
12. Restore normal writer flags, disable/remove reset credentials, and retain both the original pre-reset backup and the post-smoke cleanup backup in remote and protected downloaded form.

## Opening receivables

Opening AR is not a payment, income or revenue operation. An Administrator enters it from the client card after the canonical Counterparty has been created. The API resolves the Client through the canonical relation helper and requires the exact existing, non-archived Counterparty with an active customer role, plus a non-negative amount, an as-of date, a reason, an expected revision and Administrator role. Optimistic revision checks prevent stale corrections; setting the amount to zero safely clears an error. Generic Client create/update, bulk replace, legacy sync and system import inputs cannot change `debt` or any opening-AR field. Every create/correct/clear is recorded in the audit log.

The legacy `client.debt` field remains only as a backward-compatible display alias for the dedicated opening balance. No Payment or FinanceOperation is created by this flow.

## Verified isolated evidence

The coherent discovery copy and its reset copy produced:

- isolated copy SHA-256: `55e4cad2917e8060421268cf473fd01b679c5cf7d7d8ae25968787d88b6cc46d`;
- dry-run blockers: none;
- first apply: all deleted collections/tables zero, retention snapshots equal, integrity `ok`, FK 0;
- repeated apply: same result, proving idempotence;
- users stayed 13 with the exact production users hash;
- settings stayed 0 with the exact production settings hash;
- backend `/health`, `/health/ready` and `/api/version` passed on the cleaned copy;
- browser sweep passed Dashboard, Clients, Equipment, Rentals, Finance/AR, Payments, Service, Delivery, Documents, Reports, Settings and Users/Admin with no console errors, `NaN`, `undefined`, `[object Object]`, HTTP 500 state or phantom demo metrics; exact-empty Dashboard rendered no numeric Health score and explicitly reported insufficient data;
- isolated write smoke created Client, canonical Counterparty, Equipment, ClientObject, ClientContract, Rental plus Gantt projection, Payment, Document, Delivery, Service Ticket and opening AR; the Dashboard displayed the opening AR in total receivables while marking date aging as incomplete, and correcting the opening AR to zero created neither a payment nor a finance operation.
