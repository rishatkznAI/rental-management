'use strict';

const {
  ALL_APP_DATA_COLLECTIONS,
  COLLECTION_SCOPE_CATEGORY,
  COLLECTION_SCOPE_REGISTRY,
} = require('./app-data-scope-registry');
const {
  buildFutureWriteAudit,
  scanFile,
  sourceCorpusSha256,
  walkSourceFiles,
} = require('./future-write-audit');
const {
  DELETED_COLLECTIONS: CLEAN_RESET_DELETED_COLLECTIONS,
  DELETED_TABLES: CLEAN_RESET_DELETED_TABLES,
} = require('./skytech-clean-production-reset');

const APP_KINDS = Object.freeze(['APP_DATA_WRITE', 'APP_DATA_CAS', 'APP_DATA_CALLABLE_ESCAPE']);
const SQL_KINDS = Object.freeze([
  'SQL_CONNECTION_GUARD',
  'SQL_EXEC',
  'SQL_CALLABLE_ESCAPE',
  'SQL_PREPARED_RUN',
  'SQL_PRAGMA_WRITE',
  'SQL_READONLY_PREPARE_GUARD',
  'SQL_TRANSACTION_CONTROL',
]);
const BACKUP_KINDS = Object.freeze(['SQLITE_BACKUP_ARTIFACT', 'SQLITE_BACKUP_CALLABLE_ESCAPE']);

function unique(values) {
  return [...new Set(values)];
}

function authority(id, files, options = {}) {
  return Object.fromEntries(Object.entries({
    id,
    status: 'PASS',
    authority: options.authority || id,
    layer: options.layer || 'APPLICATION',
    pathRole: options.pathRole || 'BUSINESS_CREATE_UPSERT',
    files,
    kinds: options.kinds,
    functions: options.functions,
    tables: options.tables,
    platformRemediationOnly: options.platformRemediationOnly,
    disposableOnly: options.disposableOnly,
    guard: options.guard,
    contributesCollectionPaths: options.contributesCollectionPaths,
    nonContributingSiteFingerprints: options.nonContributingSiteFingerprints,
    siteFingerprints: options.siteFingerprints,
    excludeSiteFingerprints: options.excludeSiteFingerprints,
  }).filter(([, value]) => value !== undefined));
}

function exactSite(sites, { file, functionName, callee, sourceIncludes, kind }) {
  const matches = sites.filter(site => (
    site.file === file
    && (kind ? site.kind === kind : !site.kind.endsWith('_CALLABLE_ESCAPE'))
    && (!functionName || site.function === functionName)
    && (!callee || site.callee === callee)
    && (!sourceIncludes || site.source.includes(sourceIncludes))
  ));
  if (matches.length !== 1) {
    throw new Error(`Reviewed future-write site selector is ambiguous: ${file}:${functionName || '*'}:${callee || '*'}:${sourceIncludes || '*'}`);
  }
  return matches[0].fingerprint;
}

const SQL_TABLES = Object.freeze({
  core: Object.freeze(['app_data', 'app_sessions', 'client_inn_index']),
  canonical: Object.freeze(['canonical_companies', 'canonical_branches', 'canonical_receivables', 'financial_audit_events']),
  settlement: Object.freeze(['canonical_payments', 'canonical_payment_allocations', 'canonical_receivable_adjustments', 'canonical_approval_requests']),
  billing: Object.freeze([
    'billing_source_activation_boundaries', 'billing_source_rental_lines', 'billing_source_effective_terms',
    'billing_source_periods', 'billing_source_period_versions', 'billing_source_snapshots',
    'billing_source_snapshot_evidence', 'billing_source_upds', 'billing_source_upd_versions',
    'billing_source_upd_lines', 'billing_source_upd_line_versions', 'billing_source_coverage_sets',
    'billing_source_coverage_supersessions', 'billing_source_coverage_slices', 'billing_source_operations',
    'billing_source_audit_events',
  ]),
  forecast: Object.freeze([
    'forecast_receivable_runs', 'forecast_receivable_run_supersessions', 'forecast_receivable_input_snapshots',
    'forecast_receivable_input_events', 'forecast_receivable_items', 'forecast_receivable_diagnostics',
    'forecast_receivable_operations', 'forecast_receivable_audit_events',
  ]),
  actualSource: Object.freeze([
    'actual_source_dry_runs', 'actual_source_dry_run_inputs', 'actual_source_dry_run_candidates',
    'actual_source_dry_run_checks', 'actual_source_dry_run_reconciliations', 'actual_source_dry_run_diagnostics',
    'actual_source_dry_run_operations', 'actual_source_dry_run_audit_events',
  ]),
  actualPosting: Object.freeze([
    'governed_adapter_authority_records', 'canonical_write_authorization_records',
    'canonical_posting_activation_records', 'actual_receivable_eligible_events',
    'canonical_receivable_posting_operations', 'canonical_receivable_posting_conflicts',
    'canonical_receivable_posting_conflict_transitions',
  ]),
  identity: Object.freeze([
    'canonical_companies', 'canonical_branches', 'company_memberships', 'membership_branch_access',
    'capability_catalog_versions', 'capability_catalog_entries', 'role_templates',
    'role_template_capabilities', 'membership_capability_assignments', 'authorization_audit_events',
    'identity_bootstrap_runs',
  ]),
  technical: Object.freeze([
    'request_idempotency', 'request_idempotency_schema_migrations',
  ]),
});

const DEDICATED_SQL_TABLES = Object.freeze(unique([
  ...SQL_TABLES.canonical,
  ...SQL_TABLES.settlement,
  ...SQL_TABLES.billing,
  ...SQL_TABLES.forecast,
  ...SQL_TABLES.actualSource,
  ...SQL_TABLES.actualPosting,
  ...SQL_TABLES.identity,
  ...SQL_TABLES.technical,
  'sql_shadow_schema_migrations',
  'documents_sql',
  'gantt_rentals_sql',
  'number_sequences',
  'business_numbers',
  'number_sequence_schema_migrations',
]));
const PRODUCTION_SQL_TABLES = Object.freeze(unique([
  'app_data',
  ...SQL_TABLES.identity,
  ...SQL_TABLES.technical,
]));
const RESET_SQL_TABLES = Object.freeze(unique([
  ...SQL_TABLES.core,
  ...DEDICATED_SQL_TABLES,
]));
const CLEAN_RESET_WRITE_TABLES = Object.freeze(unique([
  'app_data',
  ...CLEAN_RESET_DELETED_TABLES,
]));
const GENERIC_CRUD_COLLECTIONS = Object.freeze([
  'equipment', 'equipment_downtimes', 'equipment_finance', 'service', 'warranty_claims',
  'clients', 'client_objects', 'client_contracts', 'knowledge_base_modules',
  'knowledge_base_progress', 'app_settings', 'documents', 'mechanic_documents', 'payments',
  'payment_allocations', 'debt_collection_plans', 'debt_collection_actions',
  'receivable_payment_plans', 'finance_accounts', 'finance_operations', 'company_expenses',
  'crm_deals', 'delivery_carriers', 'users', 'shipping_photos', 'owners', 'mechanics',
  'service_works', 'spare_parts', 'service_route_norms', 'service_field_trips',
  'service_work_catalog', 'spare_parts_catalog', 'planner_items', 'service_vehicles', 'vehicle_trips',
]);

const ROLE_BOUNDARY_COLLECTIONS = Object.freeze([
  'counterparties', 'clients', 'counterparty_role_assignments', 'supplier_profiles', 'contractor_profiles',
]);

const SYSTEM_IMPORT_COLLECTIONS = Object.freeze([
  'equipment', 'rentals', 'gantt_rentals', 'counterparties', 'counterparty_role_assignments',
  'supplier_profiles', 'contractor_profiles', 'clients', 'client_objects', 'client_contracts',
  'service', 'warranty_claims', 'documents', 'payments', 'debt_collection_plans',
  'debt_collection_actions', 'receivable_payment_plans', 'payroll_profiles', 'payroll_periods',
  'payroll_records', 'payroll_adjustments', 'payroll_audit_events', 'deliveries', 'users',
  'owners', 'mechanics', 'delivery_carriers', 'app_settings',
]);

const DEMO_COLLECTIONS = Object.freeze([
  'users', 'counterparties', 'clients', 'client_objects', 'client_contracts', 'equipment',
  'counterparty_role_assignments', 'supplier_profiles', 'contractor_profiles', 'rentals',
  'gantt_rentals', 'documents', 'payments', 'service', 'deliveries', 'debt_collection_plans',
  'repair_work_items', 'repair_part_items', 'audit_logs', 'audit_log', 'app_settings',
  'delivery_carriers', 'owners', 'mechanics', 'service_works', 'spare_parts',
]);

const PRODUCTION_SCOPE_REMEDIATION_CATEGORIES = new Set([
  COLLECTION_SCOPE_CATEGORY.TENANT,
  COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL,
  COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE,
  COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY,
]);

function productionScopeRemediationCollections() {
  return ALL_APP_DATA_COLLECTIONS.filter(name => (
    PRODUCTION_SCOPE_REMEDIATION_CATEGORIES.has(COLLECTION_SCOPE_REGISTRY[name].category)
    && COLLECTION_SCOPE_REGISTRY[name].shape === 'ARRAY'
  ));
}

function buildSourceAuthorities(sites) {
  const routeAdapters = [
    exactSite(sites, { file: 'server/routes/counterparties.js', functionName: 'registerCounterpartyRoutes', sourceIncludes: 'writeData(entry.name' }),
    exactSite(sites, { file: 'server/routes/crud.js', functionName: 'registerCrudRoutes', sourceIncludes: 'writeData(entry.name' }),
    exactSite(sites, { file: 'server/routes/rentals.js', functionName: 'registerRentalRoutes', sourceIncludes: 'writeData(entry.name' }),
    exactSite(sites, { file: 'server/routes/rentals.js', functionName: 'persistDataBatch', callee: 'persistDataBatchUnsafe' }),
    exactSite(sites, { file: 'server/routes/rentals.js', functionName: 'persistDataBatchWithSemanticAudit', callee: 'persistAuditDataBatchUnsafe' }),
    exactSite(sites, { file: 'server/routes/system.js', functionName: 'registerSystemRoutes', sourceIncludes: 'writeData(entry.name' }),
  ];
  const rawServer = [
    exactSite(sites, { file: 'server/server.js', functionName: 'writeRawData' }),
    exactSite(sites, { file: 'server/server.js', functionName: 'writeRawDataBatch' }),
    exactSite(sites, { file: 'server/server.js', sourceIncludes: 'tenantDataBoundary.writeDataBatch(finalEntries)' }),
  ];
  const serverMigrations = sites
    .filter(site => site.file === 'server/server.js' && [
      'cloneTenantReferenceCollectionIfMissing',
      'migrateReferenceCollections',
      'migrateLegacyRepairFacts',
    ].includes(site.function))
    .map(site => site.fingerprint);
  const serverStartup = sites
    .filter(site => site.file === 'server/server.js' && [
      'seedDefaultUsers',
      'ensureLegacyDefaultUsers',
      'applyAdminResetFromEnv',
    ].includes(site.function))
    .map(site => site.fingerprint);
  const serverDemo = [exactSite(sites, {
    file: 'server/server.js',
    callee: 'seedDemoData',
    sourceIncludes: 'reset: true',
  })];
  const identityReadOnlySimulationGuards = [
    exactSite(sites, {
      file: 'server/scripts/simulate-skytech-identity-bootstrap-read-only.js',
      kind: 'SQL_CONNECTION_GUARD',
      sourceIncludes: 'query_only = ON',
    }),
    exactSite(sites, {
      file: 'server/scripts/simulate-skytech-identity-bootstrap-read-only.js',
      kind: 'SQL_CONNECTION_GUARD',
      sourceIncludes: 'foreign_keys = ON',
    }),
  ].sort();
  const identityAuthorizationReadOnlySimulationGuards = [
    exactSite(sites, {
      file: 'server/scripts/simulate-production-scope-identity-authorization-read-only.js',
      kind: 'SQL_CONNECTION_GUARD',
      sourceIncludes: 'query_only = ON',
    }),
    exactSite(sites, {
      file: 'server/scripts/simulate-production-scope-identity-authorization-read-only.js',
      kind: 'SQL_CONNECTION_GUARD',
      sourceIncludes: 'foreign_keys = ON',
    }),
  ].sort();
  return [
    authority('sqlite-core', ['server/db.js'], {
      kinds: SQL_KINDS,
      layer: 'SQLITE_STORAGE',
      pathRole: 'SQLITE_SCHEMA_SESSION_AND_APP_DATA_STORAGE',
      tables: SQL_TABLES.core,
      contributesCollectionPaths: false,
      authority: 'SQLite schema/session/app_data implementation beneath centralized boundary.',
    }),
    authority('sqlite-backup-adapter', ['server/db.js', 'server/lib/full-backup.js'], {
      kinds: BACKUP_KINDS,
      layer: 'BACKUP_ARTIFACT',
      pathRole: 'ISOLATED_SQLITE_BACKUP_ARTIFACT',
      authority: 'SQLite online-backup API writes a separate snapshot artifact; it never mutates app/business data.',
      guard: 'Full-backup owns an isolated staging path; deployment/reset callers bind and validate the destination.',
      contributesCollectionPaths: false,
    }),
    authority('app-data-storage', ['server/db.js'], {
      kinds: APP_KINDS,
      layer: 'SQLITE_STORAGE',
      pathRole: 'LOW_LEVEL_APP_DATA_PRIMITIVE',
      contributesCollectionPaths: false,
      authority: 'Raw app_data primitive; callers must pass centralized tenant/platform boundary.',
    }),
    authority('bot-domain', [
      'server/lib/bot-commands.js', 'server/lib/bot-notifications.js', 'server/lib/bot-operations.js',
      'server/lib/bot-runtime-safety.js',
    ], {
      kinds: APP_KINDS,
      layer: 'BOT_DOMAIN',
      pathRole: 'BOT_BUSINESS_OR_SYSTEM_UPSERT',
      authority: 'MAX membership/device identity, exact tenant boundary, atomic UoW and dedicated bot-session policy.',
    }),
    authority('tenant-domain-lifecycle', [
      'server/lib/client-links.js', 'server/lib/client-master-data-lifecycle.js',
      'server/lib/counterparty-relations.js', 'server/lib/counterparty-role-profiles.js',
      'server/lib/counterparty.js', 'server/lib/delivery-counterparty-relations.js',
      'server/lib/document-counterparty-relations.js', 'server/lib/external-photo-archive.js',
      'server/lib/payment-counterparty-relations.js', 'server/lib/rental-change-requests.js',
      'server/lib/rental-counterparty-relations.js', 'server/lib/security-audit.js',
      'server/lib/service-audit-log.js', 'server/lib/service-core.js',
      'server/lib/service-counterparty-relations.js',
      'server/lib/warranty-claim-counterparty-relations.js',
      'server/lib/warranty-claim-factory-counterparty-relations.js',
    ], {
      kinds: APP_KINDS,
      layer: 'TENANT_DOMAIN',
      pathRole: 'DOMAIN_LIFECYCLE_CREATE_UPSERT',
      authority: 'Trusted tenant actor or dedicated tenant history repository through centralized boundary.',
    }),
    authority('gsm-ingress', ['server/lib/gprs-gateway.js', 'server/lib/gsm/wialon-ips-gateway.js'], {
      kinds: APP_KINDS,
      layer: 'GSM_INGRESS',
      pathRole: 'GSM_TELEMETRY_CREATE_UPSERT',
      authority: 'Provisioned device binding resolved to exact tenant and authoritative equipment parent.',
    }),
    authority('startup-business-definitions', ['server/lib/startup.js'], {
      kinds: APP_KINDS,
      functions: ['seedServiceWorks', 'seedKnowledgeBaseModules', 'ensureKnowledgeBaseProgress', 'seedServiceRouteNorms', 'seedSpareParts', 'cleanupArchivedCrm'],
      layer: 'STARTUP_DEFINITION',
      pathRole: 'DISABLED_STARTUP_BUSINESS_MAINTENANCE',
      authority: 'Injected trusted tenant writer; automatic startup business maintenance is hard-disabled.',
      platformRemediationOnly: true,
      guard: 'isStartupBusinessMaintenanceEnabled always returns false; explicit scoped maintenance runner required.',
    }),
    authority('startup-system-identity', ['server/lib/startup.js'], {
      kinds: APP_KINDS,
      functions: ['startServer'],
      layer: 'STARTUP_SYSTEM',
      pathRole: 'STARTUP_SYSTEM_IDENTITY_UPSERT',
      authority: 'Explicit runWithPlatformSystemScope limited to users.',
    }),
    authority('startup-callable-exports', ['server/lib/startup.js'], {
      kinds: ['APP_DATA_CALLABLE_ESCAPE'],
      functions: ['<module>'],
      layer: 'STARTUP_DEFINITION',
      pathRole: 'EXPORTED_DISABLED_MAINTENANCE_CALLABLE',
      authority: 'Reviewed exported maintenance definitions; each concrete invocation remains separately inventoried.',
      platformRemediationOnly: true,
      guard: 'Automatic startup business maintenance is hard-disabled; explicit scoped maintenance is required.',
      contributesCollectionPaths: false,
    }),
    authority('tenant-boundary-storage', ['server/lib/tenant-data-boundary.js'], {
      kinds: APP_KINDS,
      layer: 'TENANT_BOUNDARY',
      pathRole: 'LOW_LEVEL_BOUNDARY_PERSISTENCE',
      authority: 'Central scope/shape/parent/CAS/audit enforcement immediately above raw SQLite.',
      contributesCollectionPaths: false,
    }),
    authority('user-authority-transition', ['server/lib/user-authority-transition.js'], {
      kinds: APP_KINDS,
      layer: 'IDENTITY_DOMAIN',
      pathRole: 'USER_AUTHORITY_TRANSITION_ADAPTER',
      authority: 'Immediate SQLite transition validates expected users and revokes bot/session authority atomically.',
      contributesCollectionPaths: false,
    }),
    authority('http-routes', [
      'server/routes/auth.js', 'server/routes/counterparties.js', 'server/routes/crm-activities.js',
      'server/routes/crud.js', 'server/routes/deliveries.js', 'server/routes/documents.js',
      'server/routes/equipment-readiness.js', 'server/routes/finance.js', 'server/routes/gsm.js', 'server/routes/leasing.js',
      'server/routes/manager-my-plan.js', 'server/routes/payroll.js', 'server/routes/planner.js',
      'server/routes/public-site.js',
      'server/routes/rental-change-requests.js', 'server/routes/rentals.js', 'server/routes/service.js',
      'server/routes/system.js',
    ], {
      kinds: APP_KINDS,
      layer: 'HTTP_BACKEND',
      pathRole: 'AUTHENTICATED_CREATE_UPSERT_OR_IMPORT',
      authority: 'Backend authentication/RBAC, trusted exact actor scope, registry boundary and domain preflight.',
      nonContributingSiteFingerprints: routeAdapters,
    }),
    authority('disposable-seeds', [
      'server/scripts/seed-demo-data.js', 'server/scripts/seed-e2e-actor-scope.js',
      'server/scripts/seed-staging-readiness-fixtures.cjs',
      'server/scripts/seed-staging-repeat-breakdown-fixtures.cjs',
    ], {
      kinds: APP_KINDS,
      layer: 'DISPOSABLE_SEED',
      pathRole: 'DISPOSABLE_FIXTURE_SEED',
      authority: 'Explicit demo/e2e/staging fixture authority.',
      disposableOnly: true,
      guard: 'Fixture scripts reject app.sqlite/default production paths and require exact disposable marker.',
    }),
    authority('server-storage-adapters', ['server/server.js'], {
      kinds: APP_KINDS,
      siteFingerprints: rawServer,
      layer: 'APPLICATION_STORAGE',
      pathRole: 'LOW_LEVEL_APP_DATA_ADAPTER',
      authority: 'Central application boundary composition.',
      contributesCollectionPaths: false,
    }),
    authority('server-dormant-migrations', ['server/server.js'], {
      kinds: APP_KINDS,
      siteFingerprints: serverMigrations,
      layer: 'MAINTENANCE_DEFINITION',
      pathRole: 'DISABLED_TENANT_MIGRATION',
      authority: 'Trusted tenant boundary required; startup never invokes business migrations.',
      platformRemediationOnly: true,
      guard: 'No startup call site; centralized tenant boundary rejects missing actor scope.',
    }),
    authority('server-startup-identities', ['server/server.js'], {
      kinds: APP_KINDS,
      siteFingerprints: serverStartup,
      layer: 'STARTUP_SYSTEM',
      pathRole: 'STARTUP_SYSTEM_IDENTITY_UPSERT',
      authority: 'Explicit platform-system user directory scope.',
    }),
    authority('server-demo-reset', ['server/server.js'], {
      kinds: APP_KINDS,
      siteFingerprints: serverDemo,
      layer: 'DISPOSABLE_SEED',
      pathRole: 'DISPOSABLE_DEMO_RESET',
      authority: 'Demo reset delegates to guarded demo seed.',
      disposableOnly: true,
      guard: 'seedDemoData rejects production/default DB and requires demo disposable marker.',
    }),
    authority('server-application', ['server/server.js'], {
      kinds: APP_KINDS,
      excludeSiteFingerprints: [...rawServer, ...serverMigrations, ...serverStartup, ...serverDemo],
      layer: 'APPLICATION_DOMAIN',
      pathRole: 'APPLICATION_CREATE_UPSERT',
      authority: 'Trusted tenant/platform context composed at server boundary.',
    }),
    authority('dedicated-sql-repositories', [
      'server/lib/actual-source-eligibility-dry-run-repository.js',
      'server/lib/actual-source-eligibility-dry-run-schema.js',
      'server/lib/billing-source-authority-repository.js',
      'server/lib/billing-source-authority-schema.js',
      'server/lib/canonical-actual-eligibility-event-repository.js',
      'server/lib/canonical-actual-posting-authority-repository.js',
      'server/lib/canonical-actual-posting-product-service.js',
      'server/lib/canonical-actual-posting-repository.js',
      'server/lib/canonical-actual-posting-schema.js',
      'server/lib/canonical-receivables-repository.js',
      'server/lib/canonical-receivables-schema.js',
      'server/lib/canonical-receivables-settlement-repository.js',
      'server/lib/canonical-receivables-settlement-schema.js',
      'server/lib/forecast-receivables-planning-repository.js',
      'server/lib/forecast-receivables-planning-schema.js',
      'server/lib/number-sequences.js', 'server/lib/platform-identity-repository.js',
      'server/lib/platform-identity-schema.js', 'server/lib/request-idempotency.js',
      'server/lib/sql-shadow-indexes.js',
    ], {
      kinds: SQL_KINDS,
      layer: 'DEDICATED_SQL_REPOSITORY',
      pathRole: 'SCOPED_SQL_CREATE_UPSERT_OR_SCHEMA',
      authority: 'Dedicated repository/schema APIs enforce table-specific tenant/branch, version, audit and idempotency invariants.',
      tables: DEDICATED_SQL_TABLES,
      contributesCollectionPaths: false,
    }),
    authority('sqlite-readonly-statement-guard', ['server/lib/sqlite-readonly-statement.js'], {
      kinds: ['SQL_READONLY_PREPARE_GUARD'],
      layer: 'SQLITE_READ_GUARD',
      pathRole: 'RUNTIME_PROVEN_READONLY_PREPARE',
      authority: 'Central helper prepares arbitrary repository-owned SQL and rejects Statement.readonly !== true before returning it.',
      tables: RESET_SQL_TABLES,
      contributesCollectionPaths: false,
    }),
    authority('platform-identity-bootstrap', ['server/scripts/platform-identity-bootstrap.js'], {
      kinds: SQL_KINDS,
      layer: 'PLATFORM_IDENTITY',
      pathRole: 'PLATFORM_IDENTITY_BOOTSTRAP_ONLY',
      authority: 'Approved platform identity bootstrap runner.',
      tables: SQL_TABLES.identity,
      platformRemediationOnly: true,
      guard: 'Explicit approved configuration, actor and backup evidence are mandatory.',
      contributesCollectionPaths: false,
    }),
    authority('production-scope-platform-tools', [
      'server/pre-compatibility-backup-server.js',
      'server/lib/production-scope-evidence-builder.js',
      'server/lib/production-scope-remediation-runner.js',
      'server/lib/production-scope-remediation.js',
      'server/lib/production-smoke-identity.js',
      'server/scripts/production-scope-remediation.js',
    ], {
      kinds: SQL_KINDS,
      layer: 'PLATFORM_REMEDIATION',
      pathRole: 'PLATFORM_REMEDIATION_ONLY',
      authority: 'Frozen, backed-up, plan/deploy/volume-bound production remediation or query-only pre-backup authority.',
      tables: PRODUCTION_SQL_TABLES,
      platformRemediationOnly: true,
      guard: 'Feature flags, exact environment, write freeze, backup and verification gates are mandatory; pre-backup server is query_only.',
      contributesCollectionPaths: false,
    }),
    authority('pre-compatibility-backup-validation', [
      'scripts/validate-historical-pre-compatibility-backup.mjs',
      'server/lib/pre-compatibility-backup.js',
    ], {
      kinds: SQL_KINDS,
      layer: 'READ_ONLY_BACKUP_VALIDATION',
      pathRole: 'QUERY_ONLY_BACKUP_INTEGRITY_VALIDATION',
      authority: 'Historical and current backup validators inspect SQLite through read-only, query-only connections.',
      tables: RESET_SQL_TABLES,
      guard: 'Connections are opened readonly/fileMustExist and set query_only before validation; dynamic table reads never execute through Statement.run().',
      contributesCollectionPaths: false,
    }),
    authority('pre-compatibility-backup-route-snapshot', ['server/routes/pre-compatibility-backup.js'], {
      kinds: ['SQL_TRANSACTION_CONTROL'],
      layer: 'READ_ONLY_BACKUP_SNAPSHOT',
      pathRole: 'QUERY_ONLY_SNAPSHOT_TRANSACTION',
      authority: 'Read-only transaction controls establish and validate one coherent SQLite backup snapshot.',
      guard: 'The route verifies readonly plus query_only before BEGIN and rejects any total_changes or durable-source drift.',
      contributesCollectionPaths: false,
    }),
    authority('pre-compatibility-backup-route-artifact', ['server/routes/pre-compatibility-backup.js'], {
      kinds: BACKUP_KINDS,
      layer: 'PLATFORM_BACKUP_ARTIFACT',
      pathRole: 'PRE_COMPATIBILITY_BACKUP_ARTIFACT_ONLY',
      authority: 'The query-only source connection writes only a separately validated backup archive artifact.',
      guard: 'The source remains readonly/query_only; publication is path-bound, atomic, receipt-bound, and source-state checked.',
      contributesCollectionPaths: false,
    }),
    authority('clean-reset-platform-tools', [
      'server/lib/skytech-clean-production-reset.js',
      'server/scripts/skytech-clean-production-reset.js',
    ], {
      kinds: SQL_KINDS,
      layer: 'PLATFORM_DESTRUCTIVE_MAINTENANCE',
      pathRole: 'PLATFORM_RESET_ONLY',
      authority: 'Confirmation-bound clean reset with backup/quarantine manifest.',
      tables: CLEAN_RESET_WRITE_TABLES,
      platformRemediationOnly: true,
      guard: 'Exact confirmation, target identity, verified backup/quarantine and reset manifest required.',
      contributesCollectionPaths: false,
    }),
    authority('production-scope-simulation', ['server/scripts/simulate-production-scope-remediation.js'], {
      kinds: SQL_KINDS,
      layer: 'DISPOSABLE_SIMULATION',
      pathRole: 'DISPOSABLE_REMEDIATION_SIMULATION',
      authority: 'Offline remediation simulation on disposable copied databases.',
      disposableOnly: true,
      guard: 'Simulation constructs isolated copies and never opens the production target for mutation.',
      contributesCollectionPaths: false,
    }),
    authority(
      'skytech-identity-read-only-simulation',
      ['server/scripts/simulate-skytech-identity-bootstrap-read-only.js'],
      {
        kinds: ['SQL_CONNECTION_GUARD'],
        siteFingerprints: identityReadOnlySimulationGuards,
        layer: 'DISPOSABLE_READ_ONLY_SIMULATION',
        pathRole: 'EPHEMERAL_MIRROR_CONNECTION_GUARD_ONLY',
        authority: 'Skytech identity bootstrap simulation inspects only an ephemeral SQLite mirror through a read-only, query-only connection.',
        disposableOnly: true,
        guard: 'The source is never SQLite-opened; its DB/WAL/SHM bytes and total_changes are checked while the temporary mirror remains readonly/query_only.',
        contributesCollectionPaths: false,
      },
    ),
    authority(
      'skytech-identity-authorization-read-only-simulation',
      ['server/scripts/simulate-production-scope-identity-authorization-read-only.js'],
      {
        kinds: ['SQL_CONNECTION_GUARD'],
        siteFingerprints: identityAuthorizationReadOnlySimulationGuards,
        layer: 'DISPOSABLE_READ_ONLY_SIMULATION',
        pathRole: 'FRESH_PINNED_EPHEMERAL_MIRROR_CONNECTION_GUARD_ONLY',
        authority: 'Fresh pinned Skytech identity authorization simulation inspects only an ephemeral SQLite mirror through a read-only, query-only connection.',
        disposableOnly: true,
        guard: 'The hash-bound frozen source is never SQLite-opened; exact DB/WAL bytes are copied to a disposable mirror, and source DB/WAL/SHM identity and bytes, total_changes, schema, app_data, and database-content fingerprints are rechecked.',
        contributesCollectionPaths: false,
      },
    ),
    authority('local-visibility-simulation', ['server/scripts/verify-production-scope-local-visibility.js'], {
      kinds: SQL_KINDS,
      layer: 'DISPOSABLE_SIMULATION',
      pathRole: 'DISPOSABLE_LOCAL_VISIBILITY_WRITE',
      authority: 'Local post-remediation visibility simulation on one disposable SQLite copy.',
      tables: ['app_data'],
      disposableOnly: true,
      guard: 'Requires canonical OS-temp path, regular file, nlink=1, and rejects app.sqlite/production paths.',
      contributesCollectionPaths: false,
    }),
    authority('manual-sqlite-backup-artifact', ['scripts/backup-sqlite.cjs'], {
      kinds: BACKUP_KINDS,
      layer: 'BACKUP_ARTIFACT',
      pathRole: 'EXPLICIT_MANUAL_SQLITE_BACKUP',
      authority: 'Explicit operator-requested SQLite backup artifact.',
      guard: 'Requires distinct explicit source/output paths, refuses overwrite, opens source read-only, and verifies copy integrity and content fingerprint.',
      contributesCollectionPaths: false,
    }),
    authority('system-backup-route-adapter', ['server/routes/system.js'], {
      kinds: BACKUP_KINDS,
      layer: 'HTTP_BACKEND_BACKUP_ADAPTER',
      pathRole: 'AUTHENTICATED_BACKUP_DEPENDENCY_AND_ARTIFACT',
      authority: 'Admin system route passes the reviewed isolated SQLite-backup capability to full-backup generation.',
      guard: 'Authentication, admin authorization, explicit artifact path ownership and full-backup verification remain mandatory.',
      contributesCollectionPaths: false,
    }),
  ];
}

function tenantMediaCollections() {
  return ALL_APP_DATA_COLLECTIONS.filter(name => (
    ['TENANT', 'TENANT_TECHNICAL', 'DERIVED_SCOPE'].includes(COLLECTION_SCOPE_REGISTRY[name].category)
    && COLLECTION_SCOPE_REGISTRY[name].shape === 'ARRAY'
    && !['inline_relation_idempotency', 'rental_create_idempotency'].includes(name)
  ));
}

function dynamicCollectionsForSite(site) {
  const all = [...ALL_APP_DATA_COLLECTIONS];
  if (site.kind === 'APP_DATA_CALLABLE_ESCAPE') return all;
  if (site.file === 'server/db.js' || site.file === 'server/lib/tenant-data-boundary.js') return all;
  if (site.file === 'server/lib/bot-commands.js') {
    if (site.function === 'updateDeliveryStatusFromBot') return ['deliveries', 'bot_activity', 'audit_logs'];
    if (site.function === 'addCarrierDeliveryCommentFromBot') return ['deliveries', 'bot_activity', 'audit_logs', 'bot_sessions'];
    if (site.function === 'handleWorkMeterHoursRequest') return ['repair_work_items', 'service_audit_log', 'service', 'equipment', 'bot_activity', 'bot_sessions'];
    if (site.function === 'handleAddPartRequest') return ['repair_part_items', 'service_audit_log', 'service', 'bot_activity', 'bot_sessions'];
  }
  if (site.file === 'server/lib/bot-operations.js') {
    if (site.function === 'createBotOperations') {
      return [
        'service', 'equipment', 'shipping_photos', 'gantt_rentals', 'rentals',
        'equipment_operation_sessions',
      ];
    }
    if (site.function === 'addRepairWorkItemFromCatalog') {
      return ['repair_work_items', 'service_audit_log', 'equipment'];
    }
    return site.collections;
  }
  if (site.file === 'server/lib/client-links.js') return ['payments', 'documents', 'crm_deals'];
  if (site.file === 'server/lib/client-master-data-lifecycle.js') {
    if (site.function === 'deleteClient') return ['clients', 'audit_logs'];
    if (['archiveClientObject', 'deleteClientObject'].includes(site.function)) return ['client_objects', 'audit_logs'];
    return [...ROLE_BOUNDARY_COLLECTIONS, 'audit_logs'];
  }
  if (site.file === 'server/lib/counterparty-role-profiles.js') return ROLE_BOUNDARY_COLLECTIONS;
  if (site.file === 'server/lib/delivery-counterparty-relations.js') return ['delivery_carriers', 'deliveries'];
  if (site.file === 'server/lib/document-counterparty-relations.js') return ['client_contracts', 'documents'];
  if (site.file === 'server/lib/external-photo-archive.js') return tenantMediaCollections();
  if (site.file === 'server/lib/gprs-gateway.js') return ['gsm_packets', 'equipment', 'gsm_devices'];
  if (site.file === 'server/lib/user-authority-transition.js') {
    return site.callee === 'persistBotSessions' ? ['bot_sessions'] : ['users', 'audit_logs', 'bot_users'];
  }
  if (site.file === 'server/lib/startup.js') return ['users'];
  if (site.file === 'server/routes/counterparties.js') {
    return site.source.includes('writeData(entry.name') ? all : ROLE_BOUNDARY_COLLECTIONS;
  }
  if (site.file === 'server/routes/crud.js') {
    if (site.function === 'registerCrudRoutes') return all;
    if (site.function === 'persistPaymentProjection') return ['payments', 'payment_allocations', 'gantt_rentals'];
    if (site.function === 'persistUserMutation') return ['users', 'audit_logs', 'bot_users', 'bot_sessions'];
    if (site.source.includes('clientCompatibilityWrite.entries')) return ROLE_BOUNDARY_COLLECTIONS;
    if (site.source.includes('normalizeServiceWorkRecord')) return ['service_works'];
    if (site.source.includes('normalizeSparePartRecord')) return ['spare_parts'];
    if (site.source.includes('writeData(entry.name')) return ['service', 'equipment', 'service_audit_log', 'audit_logs'];
    return GENERIC_CRUD_COLLECTIONS;
  }
  if (site.file === 'server/routes/deliveries.js') return ['deliveries', 'rentals', 'gantt_rentals', 'equipment'];
  if (site.file === 'server/routes/leasing.js') return ['leasing_contracts', 'leasing_payment_schedule'];
  if (site.file === 'server/routes/payroll.js') return ['payroll_profiles', 'payroll_periods', 'payroll_records', 'payroll_adjustments', 'payroll_audit_events'];
  if (site.file === 'server/routes/public-site.js') return ['public_site_cms'];
  if (site.file === 'server/routes/rental-change-requests.js') return ['rental_change_requests', 'rentals', 'gantt_rentals', 'equipment', 'payments', 'documents'];
  if (site.file === 'server/routes/rentals.js') {
    if (site.function === 'registerRentalRoutes') return all;
    if (site.function === 'persistDataBatch') return ['rentals', 'gantt_rentals', 'equipment', 'service', 'rental_change_requests'];
    if (site.function === 'persistDataBatchWithSemanticAudit') return ['rentals', 'gantt_rentals', 'equipment', 'service', 'rental_change_requests', 'audit_logs'];
    if (site.function === 'persistCreate') return ['rentals', 'gantt_rentals', 'equipment'];
    return unique([...site.collections, 'rentals', 'gantt_rentals']);
  }
  if (site.file === 'server/routes/system.js') {
    if (site.source.includes('writeData(entry.name')) return all;
    if (site.source.includes('syncWrites')) return unique([...SYSTEM_IMPORT_COLLECTIONS, 'mechanic_documents', 'shipping_photos', 'company_expenses']);
    return SYSTEM_IMPORT_COLLECTIONS;
  }
  if (site.file === 'server/scripts/seed-demo-data.js') return DEMO_COLLECTIONS;
  if (site.file === 'server/scripts/seed-staging-readiness-fixtures.cjs') {
    return ['equipment', 'rentals', 'service', 'deliveries', 'documents', 'gsm_devices', 'gsm_packets', 'management_action_states'];
  }
  if (site.file === 'server/scripts/seed-staging-repeat-breakdown-fixtures.cjs') {
    return ['equipment', 'service', 'repair_work_items', 'repair_part_items'];
  }
  if (site.file === 'server/scripts/verify-production-scope-local-visibility.js') return all;
  if (site.file === 'server/lib/production-scope-remediation.js') {
    return productionScopeRemediationCollections();
  }
  if (
    site.file === 'server/lib/skytech-clean-production-reset.js'
    && site.function === 'applyReset'
    && site.source.includes('UPDATE app_data')
  ) {
    return [...CLEAN_RESET_DELETED_COLLECTIONS];
  }
  if (site.file === 'server/server.js') {
    if (['writeRawData', 'writeRawDataBatch'].includes(site.function) || site.source.includes('tenantDataBoundary.writeDataBatch')) return all;
    if (site.function === 'writeTenantAuditBatch') return ['audit_logs', 'service_audit_log'];
    if (site.function === 'cloneTenantReferenceCollectionIfMissing') return ['service_works', 'spare_parts'];
    if (site.function === 'migrateReferenceCollections') {
      return ['service_works', 'service_work_catalog', 'spare_parts', 'spare_parts_catalog'];
    }
    if (site.function === 'persistVehicleTripAndMileage') return ['vehicle_trips', 'service_vehicles'];
    if (site.callee === 'seedDemoData') return DEMO_COLLECTIONS;
  }
  throw new Error(`Dynamic collection bound is not reviewed: ${site.file}:${site.line} ${site.source}`);
}

const SQL_CONSTANT_OVERRIDES = Object.freeze({
  DOCUMENTS_TABLE: 'documents_sql',
  GANTT_TABLE: 'gantt_rentals_sql',
  REQUEST_IDEMPOTENCY_MIGRATIONS_TABLE: 'request_idempotency_schema_migrations',
});

function tableForSqlConstant(name) {
  if (SQL_CONSTANT_OVERRIDES[name]) return SQL_CONSTANT_OVERRIDES[name];
  const candidate = name.endsWith('_TABLE')
    ? name.slice(0, -'_TABLE'.length).toLowerCase()
    : '';
  return RESET_SQL_TABLES.includes(candidate) ? candidate : '';
}

function dynamicTablesForSite(site) {
  const constantNames = unique([...String(site.sql || '').matchAll(/\{\{([A-Z][A-Z0-9_]*_TABLE)\}\}/g)]
    .map(match => match[1]));
  const unresolvedConstants = constantNames.filter(name => !tableForSqlConstant(name));
  if (unresolvedConstants.length > 0) {
    throw new Error(`Dynamic SQL constants are not reviewed: ${site.file}:${site.line} ${unresolvedConstants.join(',')}`);
  }
  const constantTables = unique(constantNames.map(tableForSqlConstant).filter(Boolean));
  if (constantTables.length > 0) return constantTables.sort();
  if (site.file.includes('actual-source-eligibility-dry-run-')) return [...SQL_TABLES.actualSource];
  if (site.file.includes('billing-source-authority-')) return [...SQL_TABLES.billing];
  if (site.file.includes('forecast-receivables-planning-')) return [...SQL_TABLES.forecast];
  if (site.file === 'server/lib/canonical-receivables-read-repository.js') return [...SQL_TABLES.canonical];
  if (site.file === 'server/lib/client-contract-lifecycle.js') return [...RESET_SQL_TABLES];
  if (['server/lib/tenant-data-boundary.js', 'server/lib/trusted-actor-scope.js'].includes(site.file)) {
    return [...SQL_TABLES.identity];
  }
  if (site.file === 'server/lib/platform-identity-bootstrap-validation.js') return [...RESET_SQL_TABLES];
  if ([
    'scripts/diagnostics/repair-gantt-rentals-dry-run.mjs',
    'scripts/repair-accidental-return.js',
    'scripts/repair-gantt-rentals.js',
  ].includes(site.file)) return ['app_data'];
  if (site.file === 'server/lib/canonical-actual-eligibility-event-repository.js') return [...SQL_TABLES.actualPosting];
  if (site.file === 'server/lib/canonical-actual-posting-authority-repository.js') return [...SQL_TABLES.actualPosting];
  if (site.file === 'server/lib/canonical-actual-posting-repository.js') {
    return unique([...SQL_TABLES.canonical, ...SQL_TABLES.actualPosting]);
  }
  if (site.file === 'server/lib/canonical-actual-posting-product-service.js') {
    return unique([...SQL_TABLES.canonical, ...SQL_TABLES.actualPosting]);
  }
  if (site.file === 'server/lib/canonical-actual-posting-schema.js') return [...SQL_TABLES.actualPosting];
  if (site.file.includes('canonical-receivables-settlement-')) {
    return unique([...SQL_TABLES.canonical, ...SQL_TABLES.settlement]);
  }
  if (site.file.includes('canonical-receivables-')) return [...SQL_TABLES.canonical];
  if (site.file.includes('platform-identity-')) return [...SQL_TABLES.identity];
  if (site.file === 'server/lib/request-idempotency.js') {
    return ['request_idempotency', 'request_idempotency_schema_migrations'];
  }
  if (site.file === 'server/lib/sql-shadow-indexes.js') {
    return ['documents_sql', 'gantt_rentals_sql', 'sql_shadow_schema_migrations'];
  }
  if (site.file === 'server/lib/sqlite-readonly-statement.js') return [...RESET_SQL_TABLES];
  if (site.file === 'server/lib/pre-compatibility-backup.js') return [...RESET_SQL_TABLES];
  if ([
    'server/lib/production-scope-evidence-builder.js',
    'server/lib/production-scope-remediation-runner.js',
    'server/lib/production-scope-remediation.js',
    'server/lib/production-smoke-identity.js',
    'server/scripts/production-scope-remediation.js',
  ].includes(site.file)) return [...PRODUCTION_SQL_TABLES];
  if (
    site.file === 'server/lib/skytech-clean-production-reset.js'
    && site.function === 'applyReset'
    && site.source.includes('quoteIdentifier(table)')
  ) {
    return [...CLEAN_RESET_DELETED_TABLES];
  }
  if ([
    'server/lib/skytech-clean-production-reset.js',
    'server/scripts/skytech-clean-production-reset.js',
  ].includes(site.file)) return [...CLEAN_RESET_WRITE_TABLES];
  throw new Error(`Dynamic SQL object bound is not reviewed: ${site.file}:${site.line} ${site.source}`);
}

const PLATFORM_MAINTENANCE = Object.freeze({
  TENANT: 'EXPLICIT_ALLOWLIST; COMPLETE_EQUAL_COMPANY_AND_TENANT_SCOPE; ATOMIC_GLOBAL_AUDIT',
  PLATFORM_DEFAULT_TENANT_OVERLAY: 'EXPLICIT_ALLOWLIST; PRESERVE_PLATFORM_DEFAULTS; EXACT_TENANT_PARTITION; EXPLICIT_OVERRIDE_LINKAGE',
  TENANT_TECHNICAL: 'EXPLICIT_ALLOWLIST; SCOPED_ARRAY_MAP_OR_SINGLETON; LEGACY_IDEMPOTENCY_PRESERVE_ONLY',
  DERIVED_SCOPE: 'EXPLICIT_ALLOWLIST; COMPLETE_SCOPE; LIVE_AUTHORITATIVE_PARENT_RE_RESOLUTION',
  LEGACY_HISTORY: 'DEDICATED_HISTORY_AUTHORITY; EXACT_TENANT_OR_GLOBAL_SYSTEM; PREEXISTING_LEGACY_PRESERVE_ONLY',
  SYSTEM: 'DEDICATED_USER_DIRECTORY_OR_BOT_SESSION_POLICY',
  GLOBAL_REFERENCE: 'UNSCOPED_PLATFORM_CATALOGUE_ONLY',
});

function authorityMatches(site, entry) {
  return entry.files.includes(site.file)
    && (!entry.kinds || entry.kinds.includes(site.kind))
    && (!entry.functions || entry.functions.includes(site.function))
    && (!entry.siteFingerprints || entry.siteFingerprints.includes(site.fingerprint))
    && (!entry.excludeSiteFingerprints || !entry.excludeSiteFingerprints.includes(site.fingerprint));
}

function buildReviewedPolicyDraft(rootDir, { callableEscapeReviews = [] } = {}) {
  const sites = walkSourceFiles(rootDir).flatMap(filePath => scanFile(rootDir, filePath));
  const escapeSites = sites.filter(site => site.kind.endsWith('_CALLABLE_ESCAPE'));
  const reviewedByFingerprint = new Map(callableEscapeReviews.map(review => [review.siteFingerprint, review]));
  if (
    reviewedByFingerprint.size !== callableEscapeReviews.length
    || escapeSites.length !== callableEscapeReviews.length
    || escapeSites.some(site => {
      const review = reviewedByFingerprint.get(site.fingerprint);
      return !review || review.kind !== site.kind || !String(review.rationale || '').trim();
    })
    || callableEscapeReviews.some(review => !escapeSites.some(site => (
      site.fingerprint === review.siteFingerprint && site.kind === review.kind
    )))
  ) {
    throw new Error('Every callable escape requires one exact, current, explicitly supplied manual review.');
  }
  const sourceAuthorities = buildSourceAuthorities(sites);
  const authorityMismatches = [];
  for (const site of sites) {
    const matches = sourceAuthorities.filter(entry => authorityMatches(site, entry));
    if (matches.length !== 1) {
      authorityMismatches.push(`${site.file}:${site.line}:${site.kind} (${matches.map(entry => entry.id).join(', ')})`);
    }
  }
  if (authorityMismatches.length > 0) {
    throw new Error(`Future-write authority is not exact:\n${authorityMismatches.join('\n')}`);
  }
  const dynamicCollectionBounds = sites
    .filter(site => site.dynamicCollections)
    .map(site => ({
      siteFingerprint: site.fingerprint,
      collections: unique(dynamicCollectionsForSite(site)).sort(),
    }))
    .sort((left, right) => left.siteFingerprint.localeCompare(right.siteFingerprint));
  const dynamicSqlObjectBounds = sites
    .filter(site => site.kind.startsWith('SQL_') && site.dynamicSqlObjects)
    .map(site => ({
      siteFingerprint: site.fingerprint,
      tables: unique(dynamicTablesForSite(site)).sort(),
    }))
    .sort((left, right) => left.siteFingerprint.localeCompare(right.siteFingerprint));
  const collectionPolicies = Object.fromEntries(ALL_APP_DATA_COLLECTIONS.map(name => [name, {
    category: COLLECTION_SCOPE_REGISTRY[name].category,
    status: 'PASS',
    platformMaintenance: PLATFORM_MAINTENANCE[COLLECTION_SCOPE_REGISTRY[name].category],
    noCreateReason: 'No active create/upsert path is detected; classification is retained for backward-compatible fail-closed reads.',
  }]));
  let policy = {
    schemaVersion: 1,
    expectedRegistryCollectionCount: ALL_APP_DATA_COLLECTIONS.length,
    expectedSiteCount: sites.length,
    expectedSourceCorpusSha256: sourceCorpusSha256(rootDir),
    expectedInventorySha256: '0'.repeat(64),
    categoryPolicies: Object.fromEntries(Object.entries(PLATFORM_MAINTENANCE).map(([category, platformMaintenance]) => [category, {
      status: 'PASS',
      platformMaintenance,
    }])),
    sourceAuthorities,
    dynamicCollectionBounds,
    dynamicSqlObjectBounds,
    callableEscapeReviews: callableEscapeReviews
      .map(review => ({
        siteFingerprint: review.siteFingerprint,
        kind: review.kind,
        rationale: review.rationale,
      }))
      .sort((left, right) => left.siteFingerprint.localeCompare(right.siteFingerprint)),
    collectionPolicies,
  };
  let report = buildFutureWriteAudit({ rootDir, policy });
  policy.expectedInventorySha256 = report.inventorySha256;
  report = buildFutureWriteAudit({ rootDir, policy });
  for (const entry of report.collectionMatrix) {
    if (entry.createUpsertPaths.length > 0) {
      delete policy.collectionPolicies[entry.collection].noCreateReason;
      continue;
    }
    const registry = COLLECTION_SCOPE_REGISTRY[entry.collection];
    policy.collectionPolicies[entry.collection].noCreateReason = registry.writeAuthority === 'PLATFORM_REMEDIATION_ONLY'
      ? 'Immutable legacy idempotency tombstone; no create/upsert path is permitted.'
      : registry.category === 'LEGACY_HISTORY'
        ? 'Legacy compatibility history has no active writer; any future write requires a dedicated history repository.'
        : 'No active create/upsert site exists; the collection remains classified for backward-compatible fail-closed reads.';
  }
  report = buildFutureWriteAudit({ rootDir, policy });
  if (report.status !== 'PASS') {
    const error = new Error('Reviewed future-write policy draft does not pass.');
    error.findings = report.findings;
    throw error;
  }
  return Object.freeze(policy);
}

module.exports = {
  APP_KINDS,
  BACKUP_KINDS,
  SQL_KINDS,
  buildReviewedPolicyDraft,
};
