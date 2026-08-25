# Application-wide tenant isolation audit

Date: 2026-08-25

Scope: code and tests only. No production connection, database write, bootstrap, backfill, cleanup, migration execution, or deployment was performed.

## Verdict

`APPLICATION-WIDE TENANT ISOLATION READY`

This verdict covers application request paths under the approved `Company = Tenant` model. Production data is not declared remediated: legacy records without exact ownership remain deliberately invisible to tenant sessions until the separately approved production remediation gate.

There is no reachable `UNRESOLVED` data domain. Canonical receivables and forecast route adapters that do not yet have an approved actor-to-branch mapping remain disabled or return `403`; their stored rows are classified `TENANT_OWNED` and cannot be read through an unresolved scope.

## Authoritative architecture

The only tenant authority chain is:

`authenticated user ID -> exactly one active Membership -> active Company -> companyId = tenantId`

Rules enforced by the server:

- A client payload, query, or `x-company-id`/`x-tenant-id` header is never scope authority.
- Missing, multiple, inactive, or changed Membership authority fails closed.
- The live Membership is resolved on every authenticated request. A Membership version/scope change invalidates the stored session.
- Tenant-owned JSON reads require both `record.companyId === actor.companyId` and `record.tenantId === actor.tenantId`.
- Tenant-owned JSON writes preserve other tenants, stamp trusted ownership, reject foreign ownership values, and reject IDs already used outside the tenant.
- `Administrator` is a role inside the current Company. It is not a platform role and has no cross-company bypass.
- Cross-tenant relationship targets are rejected with a non-enumerating error.
- Legacy records missing either ownership field do not match any tenant and are not exposed.

The primary enforcement point is `server/lib/tenant-data-boundary.js`, applied to all request-injected `readData`, `writeData`, and `writeDataBatch` calls. `server/lib/access-control.js` repeats the exact tenant check before role logic, including the administrator path. `server/lib/tenant-relationship-guard.js` validates scalar, array, nested, dynamic, and user relationships before persistence.

## Inventory method and route surface

The audit covered:

- 262 syntactic Express route registrations in `server/routes/*.js` and `server/server.js` (dynamic collection loops count as one source registration each);
- the 36-collection generic CRUD fan-out plus the separate rentals/Gantt lifecycle;
- 71 named `app_data` collections;
- all SQLite tables created by `server/db.js` and the schema modules;
- request-injected services, background bot/GSM integrations, reports, exports/imports, diagnostics, media, search/reference endpoints, and offline scripts.

Route modules inventoried: auth, bot, canonical actual posting, canonical receivables, forecast receivables, client master data, counterparties, CRM, generic CRUD, debt collection, deliveries, documents, equipment readiness, finance, GSM/GPRS, leasing, manager plan, payroll, planner, rental changes, rentals/Gantt, reports, service/warranty, clean-reset operations, staff lookups, system/admin, and tasks center.

Offline scripts and startup migrations are not tenant user endpoints. They use raw storage only in the internal/bootstrap/operations plane. The clean-reset surface is a separately secret-gated, feature-gated platform operation and is not authorized by a tenant administrator session.

## Domain matrix

Legend: `Y` = exposed and tenant-enforced, `N/A` = no such application operation, `PO` = external platform-operator plane only, `disabled` = fails closed because an authority adapter/feature gate is unavailable.

| Domain | Read | Create | Update | Delete | Export | Admin | Tenant model | Residual risk |
|---|---:|---:|---:|---:|---:|---:|---|---|
| Authentication and sessions | Y | login only | profile/password | logout/revoke scoped user | N/A | tenant user revoke only | Membership-resolved tenant; sessions global infrastructure | Low |
| User directory | Y | Membership workflow only | Y, own Company | Membership workflow only | sanitized tenant export | no bypass | global credential root projected through one active Membership | Low; app onboarding needs a dedicated Membership UI/API |
| Companies and branches | authority lookup only | PO | PO | PO | PO | PO | Company is tenant root; branches belong to Company | Low |
| Equipment, finance, downtime, readiness, photos | Y | Y | Y | Y | tenant export where offered | tenant-only | TENANT_OWNED | Low |
| Rentals, Gantt, change requests, downtime, returns | Y | Y | Y | Y | reports/tenant export | tenant-only | TENANT_OWNED | Low |
| Counterparties and customer/supplier/contractor roles | Y | Y | Y | archive/unlink | tenant export | tenant-only | TENANT_OWNED | Low |
| Clients, objects/sites, contracts | Y | Y | Y | archive/delete lifecycle | tenant export | tenant-only | TENANT_OWNED | Low |
| Service, warranty, repair facts, catalogs, field trips | Y | Y | Y | Y | service reports | tenant-only | TENANT_OWNED | Low |
| Deliveries, carriers, shipping/receiving photos | Y | Y | Y | Y | derived reports | tenant-only | TENANT_OWNED; carrier DTO also role-limited | Low |
| Payments, allocations, accounts, operations, expenses | Y | Y | Y | lifecycle-specific | finance reports/tenant export | tenant-only | TENANT_OWNED | Low |
| Debt collection and payment plans | Y | Y | Y | lifecycle-specific | finance reports/tenant export | tenant-only | TENANT_OWNED | Low |
| Leasing and payroll | Y | Y | Y | leasing delete; payroll lifecycle | tenant export where offered | tenant-only | TENANT_OWNED | Low |
| CRM, planner, tasks, manager activity/plan, knowledge base | Y | Y | Y | where exposed | derived dashboards | tenant-only | TENANT_OWNED | Low |
| Documents, print/generation, references | Y | Y | Y | Y | print/tenant export | tenant-only | TENANT_OWNED | Low |
| Local files and archived external photos | entity-authorized | archive operation | archive operation | N/A | response file only | tenant-only | ownership inherited from referencing entity | Low |
| GSM/GPRS devices, packets, commands, analytics | Y | ingest/token | link/command | generic lifecycle | N/A | tenant-only | TENANT_OWNED; ingest inherits exact equipment scope | Low |
| MAX bot users, activity, notifications | scoped bot/API | credential + Membership | Y | disconnect | N/A | tenant-only | TENANT_OWNED | Low |
| MAX pre-auth sessions | not enumerable | transport only | transport only | transport only | excluded | no tenant view | SYSTEM_GLOBAL ephemeral transport state | Low |
| App settings and snapshot | Y after auth | Y | Y | Y | tenant export | tenant-only | TENANT_OWNED; snapshot uses tenant envelope | Low |
| Audit logs and diagnostics | Y | append | N/A | N/A | filtered response | tenant-only | TENANT_OWNED | Low |
| Reports, KPIs, dashboards, search, autocomplete | derived from scoped reads | N/A | N/A | N/A | tenant-derived | tenant-only | inherits source tenant | Low |
| Tenant system-data export/import | Y | import | import | replace within tenant | Y | tenant-only | explicit tenant allowlist, secrets stripped, users rejected on import | Low |
| Full SQLite/media backup and history | PO | PO | PO | PO | PO | no tenant access | SYSTEM_GLOBAL platform operation | Low |
| System control center | PO | N/A | N/A | N/A | PO | no tenant access | SYSTEM_GLOBAL platform operation | Low |
| Canonical receivables SQL | disabled or tenant/branch scoped | controlled repository | controlled repository | controlled repository | disabled/scoped | capability model | TENANT_OWNED | Low; production adapter still gated |
| Forecast/billing/actual SQL | disabled or tenant/branch scoped | governed repository/runtime token | governed repository | governed lifecycle | disabled/scoped | capability/platform integration | TENANT_OWNED | Low; production adapter still gated |
| Clean reset/bootstrap/remediation scripts | PO | PO | PO | PO | PO backup | no tenant access | SYSTEM_GLOBAL operations plane | Not executed |

## Complete `app_data` classification

Every `JSON_COLLECTIONS` entry is classified exactly once; a test compares the classifications to the database registry and fails if a collection is added without a decision.

### TENANT_OWNED arrays (67)

`equipment`, `equipment_finance`, `equipment_downtimes`, `rentals`, `gantt_rentals`, `rental_change_requests`, `service`, `warranty_claims`, `counterparties`, `counterparty_role_assignments`, `supplier_profiles`, `contractor_profiles`, `clients`, `client_objects`, `client_contracts`, `inline_relation_idempotency`, `rental_create_idempotency`, `knowledge_base_modules`, `knowledge_base_progress`, `app_settings`, `gsm_devices`, `gsm_packets`, `gsm_commands`, `documents`, `mechanic_documents`, `payments`, `payment_allocations`, `debt_collection_plans`, `debt_collection_actions`, `receivable_payment_plans`, `finance_accounts`, `finance_operations`, `company_expenses`, `leasing_contracts`, `leasing_payment_schedule`, `payroll_profiles`, `payroll_periods`, `payroll_records`, `payroll_adjustments`, `payroll_audit_events`, `crm_deals`, `crm_activities`, `deliveries`, `delivery_carriers`, `shipping_photos`, `equipment_operation_sessions`, `owners`, `mechanics`, `service_works`, `spare_parts`, `service_route_norms`, `service_field_trips`, `repair_work_items`, `repair_part_items`, `service_audit_log`, `service_work_catalog`, `spare_parts_catalog`, `service_work_names`, `spare_part_names`, `planner_items`, `service_vehicles`, `vehicle_trips`, `bot_activity`, `manager_activity`, `bot_notifications`, `audit_log`, `audit_logs`.

### TENANT_OWNED non-array collections

- `bot_users`: tenant-owned map; entries must carry exact scope and are merged without replacing another tenant's keys.
- `snapshot`: tenant-owned singleton implemented as a per-Company envelope.

### SYSTEM_GLOBAL collections

- `users`: platform credential identities. This is not an application-global directory: tenant reads are a Membership projection; generic creation/deletion/cross-company mutation is rejected; password/token/secret fields are removed from DTOs.
- `bot_sessions`: short-lived MAX pre-auth scenario/transport state keyed by globally unique sender identity. It is not tenant authority, is never directly enumerable, is excluded from tenant diagnostics/export, and authenticated bot management joins it only through tenant-scoped `bot_users`.

Unknown `app_data` names return no data in a tenant/denied context and cannot be written by an actor. This prevents a newly introduced collection from silently becoming global.

## Complete SQLite classification

### Shared containers or genuine SYSTEM_GLOBAL metadata

- `app_data`: physical mixed-data container; each named value is classified above.
- `app_sessions`: bearer-session credential infrastructure; no list/backup access to tenant administrators.
- `sql_shadow_schema_migrations`, `number_sequence_schema_migrations`: schema metadata only.
- `canonical_companies`: authoritative tenant-root directory. A row names a tenant; ordinary tenant routes cannot enumerate it.
- `capability_catalog_versions`, `capability_catalog_entries`: platform-wide capability vocabulary.
- `identity_bootstrap_runs`: platform-operator bootstrap evidence; no tenant endpoint.

### TENANT_OWNED shared tables

- Derived/indexed: `client_inn_index` (tenant-prefixed key), `documents_sql`, `gantt_rentals_sql`, `number_sequences`, `business_numbers`.
- Company/identity authority: `canonical_branches`, `role_templates`, `role_template_capabilities`, `company_memberships`, `membership_branch_access`, `membership_capability_assignments`, `authorization_audit_events`.
- Canonical AR: `canonical_receivables`, `financial_audit_events`, `canonical_payments`, `canonical_payment_allocations`, `canonical_receivable_adjustments`, `canonical_approval_requests`.
- Billing source authority: `billing_source_activation_boundaries`, `billing_source_rental_lines`, `billing_source_effective_terms`, `billing_source_periods`, `billing_source_period_versions`, `billing_source_snapshots`, `billing_source_snapshot_evidence`, `billing_source_upds`, `billing_source_upd_versions`, `billing_source_upd_lines`, `billing_source_upd_line_versions`, `billing_source_coverage_sets`, `billing_source_coverage_supersessions`, `billing_source_coverage_slices`, `billing_source_operations`, `billing_source_audit_events`.
- Forecast: `forecast_receivable_runs`, `forecast_receivable_run_supersessions`, `forecast_receivable_input_snapshots`, `forecast_receivable_input_events`, `forecast_receivable_items`, `forecast_receivable_diagnostics`, `forecast_receivable_operations`, `forecast_receivable_audit_events`.
- Actual-source dry run: `actual_source_dry_runs`, `actual_source_dry_run_inputs`, `actual_source_dry_run_candidates`, `actual_source_dry_run_checks`, `actual_source_dry_run_reconciliations`, `actual_source_dry_run_diagnostics`, `actual_source_dry_run_operations`, `actual_source_dry_run_audit_events`.
- Canonical actual posting: `governed_adapter_authority_records`, `canonical_write_authorization_records`, `canonical_posting_activation_records`, `actual_receivable_eligible_events`, `canonical_receivable_posting_operations`, `canonical_receivable_posting_conflicts`, `canonical_receivable_posting_conflict_transitions`.

All tables in the last four groups carry `companyId` (and normally `branchId`) in their schema. Repositories include company/branch predicates and capability assertions. Product actual-posting resolves scope from the authenticated Membership; its internal runtime is separately trigger-token protected. Canonical/forecast read routes have an additional fail-closed adapter gate.

The two legacy SQL shadow tables store scope inside `rawJson` rather than first-class columns. The only application consumers pass their results through the exact `companyId` + `tenantId` access-control check. Tests enable both SQL flags and prove foreign search and ID references return no Company B result.

## User directory result

Endpoints that can expose user-derived data include generic `/api/users` list/detail/update, `/api/staff/manager-options`, report/finance manager lookups, equipment action-queue assignees, delivery carrier connections, bot connections, and logout-user. They all receive the Membership-projected `users` collection.

- Company A administrator lists and updates only active Membership principals in Company A.
- Company B principals return `404` to Company A detail/update/logout-user attempts.
- Non-admin user DTOs remain role-limited; administrator DTOs are tenant-limited and redact keys matching password, passhash, token, secret, session, cookie, authorization, or API-key patterns.
- Generic user create/delete or a list replacement that changes Membership membership is rejected with `USER_MEMBERSHIP_WORKFLOW_REQUIRED`.
- Existing application RBAC still derives the operational role label from the credential user record. Membership is the sole tenant authority. Moving all role capabilities to Membership templates is a P2 authorization-model cleanup, not a tenant-isolation bypass.

## Backup and restore result

- `/api/admin/backup/full`, backup history, and system control center require an external platform operator. The application middleware always rejects a tenant session with `403 PLATFORM_OPERATOR_REQUIRED`, including Company administrators.
- Full backup code would contain the SQLite database, sessions, identities, all companies, and selected media. It is therefore a platform backup and is never a tenant-admin capability.
- `/api/admin/system-data/export` is the tenant export: it reads only the actor's Company, strips sensitive fields/settings, and returns an explicit allowlist.
- System-data import/dry-run stamps trusted scope, rejects scope spoofing and cross-company IDs/relationships, writes atomically, and rejects `users`; identity/Membership restoration requires the future platform control plane.
- Legacy `/api/sync` is disabled by default and, if explicitly enabled, still executes through the tenant boundary; dangerous canonical lifecycle replacements are rejected.

## P0/P1 findings and fixes

| Severity | Finding before hardening | Resolution |
|---|---|---|
| P0 | Shared `app_data` reads/writes allowed role logic to operate on global arrays. | Central AsyncLocalStorage tenant boundary filters every collection and tenant-merges every write. |
| P0 | Unknown/new collection names could fall through to raw shared data. | Unknown reads return nothing and actor writes fail `TENANT_COLLECTION_UNCLASSIFIED`; classification parity test added. |
| P0 | Administrator paths could bypass entity scoping. | Exact tenant ownership check now precedes administrator role logic. |
| P0 | Missing/multiple/inactive Membership could leave an authenticated actor without authoritative tenant scope. | Login and every authenticated request fail closed; session scope drift invalidates the session. |
| P0 | Payload ownership fields and bulk/import operations could spoof Company. | Trusted stamping, immutable ownership, cross-tenant ID collision rejection, and import scope checks. |
| P0 | Relationship IDs could point from Company A records to Company B records. | Central relationship guard plus domain canonicalizers validate scalar/array/nested/dynamic/user chains. |
| P0 | Global user directory and cross-user session revoke were tenant-admin reachable. | Directory is Membership-projected; foreign list/detail/update/revoke returns no result; generic identity lifecycle changes are rejected. |
| P0 | Tenant administrator could request the full platform backup/control center. | Full backup/history/control center moved behind an unreachable-from-tenant platform-operator middleware. |
| P0 | Export/import and legacy synchronization could replace or disclose shared collections. | Tenant export filtering; tenant-stamped import; users rejected; canonical bulk replacements disabled; central write merge preserves peers. |
| P0 | Business numbering used one process/environment scope. | Allocator resolves `scope_id = actor.companyId` for every allocate/find; A and B can independently receive the same first number. |
| P0 | Client INN uniqueness/index was global. | Duplicate grouping and index key are tenant-qualified; cross-company same INN no longer leaks or conflicts. |
| P0 | Bot sender/phone mapping could be treated as tenant authority. | Bot credential authentication resolves the linked system user through exactly one Membership and stamps/validates bot ownership; carrier linkage requires a scoped system user. |
| P0 | GSM/GPRS transport writes lacked record ownership. | Telemetry and commands inherit exact ownership from the matched scoped equipment/device chain. |
| P1 | Duplicate login returned a distinct conflict response. | Ambiguous/nonexistent credentials now share the generic authentication failure convention. |
| P1 | Audit/admin diagnostics could aggregate other companies. | Audit rows carry trusted metadata and views filter exact scope; global bot pre-auth sessions are excluded from tenant diagnostics. |
| P1 | SQL shadow search/reference paths query a shared index. | Exact backend scope filter is mandatory after index query; real-server SQL-enabled search/ID leakage tests added. |
| P1 | Public settings read tenant-owned shared storage without an actor. | Public settings returns an empty list; tenant settings require authentication. |
| P1 | User DTO redaction handled only the literal `password` key. | Password/hash/token/secret/session variants are stripped by pattern. |

## Legacy blockers

- P0/P1 blockers above were fixed locally.
- Unscoped legacy tenant records are a deliberate production remediation blocker, not a runtime disclosure: they match no tenant and cannot be claimed via labels, headers, payload scope, or an administrator role.
- Name-based client links remain display/guarded recovery data only. Tenant ownership and financial relationships use stable IDs.
- Raw storage use remains in startup, migration, backup, reset, remediation, and external integration internals. None is an ordinary tenant-user data route; public integrations either resolve Membership scope (bot) or inherit scope from equipment (GSM/GPRS).
- P2: role labels remain in the platform credential JSON for legacy RBAC while Membership templates govern tenant/capability authority in canonical repositories. This does not grant another Company and should be consolidated in a later authorization-model project.

## Security coverage matrix

| Domain | Isolation tested | Read | Write/spoof | Delete | Export | Search/lookup | Admin |
|---|---|---:|---:|---:|---:|---:|---:|
| All 67 tenant arrays | central two-company matrix | Y | Y | Y | boundary inheritance | boundary inheritance | Y |
| `bot_users` and `snapshot` | two-company merge/envelope | Y | Y | Y | N/A | N/A | Y |
| User directory | Membership projection + real server | Y | Y | lifecycle rejected | Y | Y | Y |
| Master data | real server and lifecycle suites | Y | Y | Y/archive | Y | Y | Y |
| Equipment | real server | Y | Y | Y | Y | Y | Y |
| Documents/Gantt SQL shadows | real server with SQL flags | Y | N/A | N/A | N/A | Y, including foreign ID | Y |
| Relationships | scalar, arrays, nested, aliases, dynamic, users | Y | Y | N/A | N/A | non-enumerating | Y |
| Audit | real server | Y | append scoped | N/A | response scoped | filters scoped | Y |
| Tenant export/import | route tests + real export | Y | Y | replacement scoped | Y | N/A | Y |
| Full backup/control center | real server | denied | denied | denied | denied | denied | denied |
| Numbering | shared allocator A/B + real server A/B | Y | Y | N/A | N/A | scoped find | Y |
| Client INN | A/B duplicate test | Y | Y | N/A | N/A | no foreign duplicate disclosure | Y |
| Bot | auth, carrier, session-reset, domain tests | Y | Y | Y | N/A | scoped connections/activity | Y |
| GSM/GPRS | gateway and route suites | Y | Y | N/A | N/A | tenant equipment chain | Y |
| Reports/finance/service/delivery/rental lifecycle | existing domain/API/security suites plus central boundary | Y | Y | where exposed | Y | Y | Y |
| Missing/multiple/inactive Membership and spoofed header/body | real server | denied | denied | denied | denied | denied | denied |

Final verification on 2026-08-25:

- targeted regression set: 66/66 passed;
- full `npm test` (`node --test tests/*.test.js`): 3,485/3,485 passed, 0 failed, 0 skipped;
- production Vite build: passed (3,394 modules transformed);
- server syntax checks: passed;
- `git diff --check`: passed.

## Production safety and next gate

Production writes: **NONE**.

Deploy: **NOT PERFORMED**.

The next gate may proceed to **Authoritative Company Bootstrap + Production Scope Remediation** only under its separate approval, backup, dry-run, ambiguity report, and known SSH host-key verification controls. This audit does not authorize accepting an unknown fingerprint, running the checked-in remediation script, changing production data, or deploying.
