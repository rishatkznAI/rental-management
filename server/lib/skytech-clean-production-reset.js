const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  prepareSqliteReadonlyStatement,
} = require('./sqlite-readonly-statement');
const {
  inspectFullBackupArchive,
  readStoredZipEntry,
  validateStoredZipEntry,
} = require('./full-backup-validation');
const {
  fileCrc32Sync,
  normalizeZipPath,
} = require('./zip-store');
const {
  ALL_APP_DATA_COLLECTIONS,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
} = require('./app-data-scope-registry');

const PRODUCTION_CONFIRMATION = 'SKYTECH_CLEAN_PRODUCTION_RESET';
const ISOLATED_CONFIRMATION = 'SKYTECH_CLEAN_ISOLATED_RESET';
const PURGE_CONFIRMATION = 'SKYTECH_PURGE_RESET_QUARANTINE';

const MIXED_CATALOG_RETENTION_REASONS = Object.freeze({
  knowledge_base_modules: 'Training platform defaults and tenant entries/overrides are retained byte-for-byte.',
  service_works: 'Service-work platform defaults and tenant entries/overrides are retained byte-for-byte.',
  spare_parts: 'Parts platform defaults and tenant entries/overrides are retained byte-for-byte.',
  service_route_norms: 'Route-norm platform defaults and tenant entries/overrides are retained byte-for-byte.',
  service_work_catalog: 'Legacy work-catalog platform defaults and tenant entries/overrides are retained byte-for-byte.',
  spare_parts_catalog: 'Legacy parts-catalog platform defaults and tenant entries/overrides are retained byte-for-byte.',
  service_work_names: 'Legacy work-name platform defaults and tenant entries/overrides are retained byte-for-byte.',
  spare_part_names: 'Legacy part-name platform defaults and tenant entries/overrides are retained byte-for-byte.',
});

const RETAINED_COLLECTIONS = Object.freeze({
  users: 'Production user identities, authentication hashes, roles and account state.',
  app_settings: 'Application settings are retained byte-for-byte.',
  bot_users: 'MAX identities and their current role mappings are authentication identity data.',
  public_site_cms: 'Tenant-owned public-site configuration is retained byte-for-byte; no ownership inference or automatic remediation is permitted.',
  ...Object.fromEntries(PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS.map(name => [
    name,
    MIXED_CATALOG_RETENTION_REASONS[name]
      || 'Mixed catalogue partitions and stable IDs are retained byte-for-byte.',
  ])),
});

const DELETED_COLLECTIONS = Object.freeze([
  'equipment',
  'equipment_finance',
  'equipment_downtimes',
  'rentals',
  'gantt_rentals',
  'rental_change_requests',
  'service',
  'warranty_claims',
  'counterparties',
  'counterparty_role_assignments',
  'supplier_profiles',
  'contractor_profiles',
  'clients',
  'client_objects',
  'client_contracts',
  'inline_relation_idempotency',
  'rental_create_idempotency',
  'knowledge_base_progress',
  'gsm_devices',
  'gsm_packets',
  'gsm_commands',
  'documents',
  'mechanic_documents',
  'payments',
  'payment_allocations',
  'debt_collection_plans',
  'debt_collection_actions',
  'receivable_payment_plans',
  'finance_accounts',
  'finance_operations',
  'company_expenses',
  'leasing_contracts',
  'leasing_payment_schedule',
  'payroll_profiles',
  'payroll_periods',
  'payroll_records',
  'payroll_adjustments',
  'payroll_audit_events',
  'crm_deals',
  'crm_activities',
  'deliveries',
  'delivery_carriers',
  'shipping_photos',
  'equipment_operation_sessions',
  'owners',
  'mechanics',
  'service_field_trips',
  'repair_work_items',
  'repair_part_items',
  'service_audit_log',
  'client_history',
  'client_object_history',
  'domain_history',
  'planner_items',
  'service_vehicles',
  'vehicle_trips',
  'bot_sessions',
  'bot_activity',
  'manager_activity',
  'bot_notifications',
  'management_action_states',
  'audit_log',
  'audit_logs',
  'snapshot',
]);

const APP_DATA_RESET_DISPOSITIONS = [
  ...Object.keys(RETAINED_COLLECTIONS),
  ...DELETED_COLLECTIONS,
];
const duplicateResetDispositions = APP_DATA_RESET_DISPOSITIONS.filter(
  (name, index, names) => names.indexOf(name) !== index,
);
const missingResetDispositions = ALL_APP_DATA_COLLECTIONS.filter(
  name => !APP_DATA_RESET_DISPOSITIONS.includes(name),
);
const unknownResetDispositions = APP_DATA_RESET_DISPOSITIONS.filter(
  name => !ALL_APP_DATA_COLLECTIONS.includes(name),
);
if (
  duplicateResetDispositions.length > 0
  || missingResetDispositions.length > 0
  || unknownResetDispositions.length > 0
) {
  throw new Error(
    'Skytech reset app_data disposition mismatch: '
    + `duplicates=${[...new Set(duplicateResetDispositions)].join(',') || 'none'}; `
    + `missing=${missingResetDispositions.join(',') || 'none'}; `
    + `unknown=${unknownResetDispositions.join(',') || 'none'}.`,
  );
}

const RETAINED_TABLES = Object.freeze({
  app_data: 'Collection storage; retained and selectively emptied.',
  app_sessions: 'Authentication sessions are retained.',
  sql_shadow_schema_migrations: 'Schema/migration metadata.',
  capability_catalog_versions: 'Permission catalogue metadata.',
  capability_catalog_entries: 'Permission catalogue entries.',
  canonical_companies: 'Platform/system company authority.',
  canonical_branches: 'Platform/system branch authority.',
  role_templates: 'Current role templates.',
  role_template_capabilities: 'Current role-template permissions.',
  company_memberships: 'Current production identities and roles.',
  membership_branch_access: 'Current branch permissions.',
  membership_capability_assignments: 'Current direct permissions.',
  authorization_audit_events: 'Permission-change audit history.',
  identity_bootstrap_runs: 'Identity bootstrap/schema control history.',
});

const DELETED_TABLES = Object.freeze([
  'client_inn_index',
  'documents_sql',
  'gantt_rentals_sql',
  'canonical_receivables',
  'canonical_approval_requests',
  'canonical_payments',
  'canonical_payment_allocations',
  'canonical_receivable_adjustments',
  'financial_audit_events',
  'billing_source_activation_boundaries',
  'billing_source_periods',
  'billing_source_period_versions',
  'billing_source_upds',
  'billing_source_upd_versions',
  'billing_source_upd_lines',
  'billing_source_upd_line_versions',
  'billing_source_rental_lines',
  'billing_source_effective_terms',
  'billing_source_coverage_sets',
  'billing_source_coverage_slices',
  'billing_source_coverage_supersessions',
  'billing_source_snapshots',
  'billing_source_snapshot_evidence',
  'billing_source_operations',
  'billing_source_audit_events',
  'forecast_receivable_runs',
  'forecast_receivable_run_supersessions',
  'forecast_receivable_input_snapshots',
  'forecast_receivable_input_events',
  'forecast_receivable_items',
  'forecast_receivable_diagnostics',
  'forecast_receivable_operations',
  'forecast_receivable_audit_events',
  'actual_source_dry_runs',
  'actual_source_dry_run_inputs',
  'actual_source_dry_run_candidates',
  'actual_source_dry_run_checks',
  'actual_source_dry_run_reconciliations',
  'actual_source_dry_run_diagnostics',
  'actual_source_dry_run_operations',
  'actual_source_dry_run_audit_events',
  'governed_adapter_authority_records',
  'canonical_write_authorization_records',
  'canonical_posting_activation_records',
  'actual_receivable_eligible_events',
  'canonical_receivable_posting_operations',
  'canonical_receivable_posting_conflicts',
  'canonical_receivable_posting_conflict_transitions',
]);

const FILE_ROOT_NAMES = Object.freeze(['uploads', 'photos', 'documents', 'files', 'attachments']);
const BUSINESS_REFERENCE_KEYS = new Set([
  'clientid',
  'counterpartyid',
  'rentalid',
  'equipmentid',
  'documentid',
  'serviceid',
  'serviceticketid',
  'deliveryid',
  'paymentid',
  'ownerid',
  'mechanicid',
  'carrierid',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const file = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(file, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(file);
  }
  return hash.digest('hex');
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function countValue(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return value == null ? 0 : 1;
}

function parseCollectionRow(row) {
  try {
    const value = JSON.parse(row.json);
    return {
      ...row,
      value,
      count: countValue(value),
      type: Array.isArray(value) ? 'array' : (value === null ? 'null' : typeof value),
      valid: true,
    };
  } catch {
    return { ...row, count: null, type: 'invalid', valid: false };
  }
}

function listCollections(db) {
  return prepareSqliteReadonlyStatement(db, 'SELECT name, json, updated_at FROM app_data ORDER BY name').all().map(parseCollectionRow);
}

function listTables(db) {
  return prepareSqliteReadonlyStatement(db, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
}

function tableCount(db, table) {
  return Number(prepareSqliteReadonlyStatement(db, `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count) || 0;
}

function stableTableRows(db, table) {
  const rows = prepareSqliteReadonlyStatement(db, `SELECT * FROM ${quoteIdentifier(table)}`).all();
  return rows.map((row) => JSON.stringify(row)).sort();
}

function tableDigest(db, table) {
  return sha256(JSON.stringify(stableTableRows(db, table)));
}

function databaseLogicalDigest(db) {
  const collections = prepareSqliteReadonlyStatement(db, 'SELECT name, json, updated_at FROM app_data ORDER BY name').all();
  const tables = listTables(db)
    .filter((name) => name !== 'app_data')
    .map((name) => ({ name, rowsSha256: tableDigest(db, name) }));
  return sha256(JSON.stringify({
    collections,
    tables,
    userVersion: db.pragma('user_version', { simple: true }),
    schemaSha256: schemaDigest(db),
    migrationSha256: migrationDigest(db),
  }));
}

function schemaDigest(db) {
  const rows = prepareSqliteReadonlyStatement(db, `
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_autoindex_%'
    ORDER BY type, name
  `).all();
  return sha256(JSON.stringify(rows));
}

function migrationDigest(db) {
  if (!listTables(db).includes('sql_shadow_schema_migrations')) return sha256('missing');
  return tableDigest(db, 'sql_shadow_schema_migrations');
}

function findSettingBusinessReferences(value, location = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findSettingBusinessReferences(entry, `${location}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, nested] of Object.entries(value)) {
    const nextLocation = `${location}.${key}`;
    if (BUSINESS_REFERENCE_KEYS.has(key.toLowerCase()) && nested !== null && nested !== undefined && String(nested).trim()) {
      found.push(nextLocation);
    }
    findSettingBusinessReferences(nested, nextLocation, found);
  }
  return found;
}

function findRetainedLocalFileReferences(value, location = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findRetainedLocalFileReferences(entry, `${location}[${index}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      findRetainedLocalFileReferences(nested, `${location}.${key}`, found);
    }
    return found;
  }
  if (typeof value !== 'string') return found;
  const text = value.trim();
  if (/^(?:\/)?(?:uploads|photos|documents|files|attachments)\//i.test(text)
    || /\/(?:uploads|photos|documents|files|attachments)\//i.test(text)
    || /\/api\/public-site\/media\/[a-f0-9]{64}\//i.test(text)) {
    found.push(location);
  }
  return found;
}

function retentionSnapshot(db) {
  const collections = new Map(listCollections(db).map((row) => [row.name, row]));
  const tables = new Set(listTables(db));
  const retainedCollections = {};
  for (const name of Object.keys(RETAINED_COLLECTIONS)) {
    const row = collections.get(name);
    retainedCollections[name] = row
      ? { count: row.count, jsonSha256: sha256(row.json), updatedAt: row.updated_at }
      : { count: 0, jsonSha256: null, updatedAt: null };
  }
  const retainedTables = {};
  for (const name of Object.keys(RETAINED_TABLES)) {
    retainedTables[name] = tables.has(name)
      ? {
        count: tableCount(db, name),
        // Individual retained app_data collections are sealed above; hashing the
        // full storage table would incorrectly include collections being reset.
        rowsSha256: name === 'app_data' ? null : tableDigest(db, name),
      }
      : { count: 0, rowsSha256: null };
  }
  return {
    collections: retainedCollections,
    tables: retainedTables,
    schema: {
      userVersion: db.pragma('user_version', { simple: true }),
      schemaVersion: db.pragma('schema_version', { simple: true }),
      schemaSha256: schemaDigest(db),
      migrationSha256: migrationDigest(db),
    },
  };
}

function scanDirectory(root) {
  let files = 0;
  let directories = 0;
  let unsupportedEntries = 0;
  let bytes = 0;
  const stack = fs.existsSync(root) ? [root] : [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        directories += 1;
        stack.push(candidate);
      } else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(candidate).size;
      } else {
        unsupportedEntries += 1;
      }
    }
  }
  return { root, exists: fs.existsSync(root), files, directories, unsupportedEntries, bytes };
}

function resolveFileRoots(dbPath, explicitRoots = []) {
  const dataDir = path.dirname(path.resolve(dbPath));
  const roots = explicitRoots.length > 0
    ? explicitRoots.map((root) => path.resolve(root))
    : FILE_ROOT_NAMES.map((name) => path.join(dataDir, name));
  return roots.map((root) => {
    const relative = path.relative(dataDir, root);
    const allowed = relative && !relative.startsWith('..') && !path.isAbsolute(relative) && FILE_ROOT_NAMES.includes(relative);
    if (!allowed) throw new Error(`Unsafe file cleanup root: ${root}`);
    return root;
  });
}

function buildResetPlan(db, { dbPath, fileRoots = [] } = {}) {
  const collectionRows = listCollections(db);
  const collectionNames = new Set(collectionRows.map((row) => row.name));
  const knownCollections = new Set([...Object.keys(RETAINED_COLLECTIONS), ...DELETED_COLLECTIONS]);
  const unknownCollections = collectionRows
    .filter((row) => !knownCollections.has(row.name))
    .map((row) => ({ name: row.name, count: row.count, type: row.type }));
  const invalidCollections = collectionRows
    .filter((row) => !row.valid)
    .map((row) => row.name);

  const tableNames = new Set(listTables(db));
  const knownTables = new Set([...Object.keys(RETAINED_TABLES), ...DELETED_TABLES]);
  const unknownTables = [...tableNames].filter((name) => !knownTables.has(name));
  const deleteCollections = DELETED_COLLECTIONS.map((name) => {
    const row = collectionRows.find((entry) => entry.name === name);
    return { name, count: row?.count || 0, type: row?.type || 'missing' };
  });
  const keepCollections = Object.entries(RETAINED_COLLECTIONS).map(([name, reason]) => {
    const row = collectionRows.find((entry) => entry.name === name);
    return { name, count: row?.count || 0, type: row?.type || 'missing', reason };
  });
  const deleteTables = DELETED_TABLES.map((name) => ({
    name,
    count: tableNames.has(name) ? tableCount(db, name) : 0,
  }));
  const keepTables = Object.entries(RETAINED_TABLES).map(([name, reason]) => ({
    name,
    count: tableNames.has(name) ? tableCount(db, name) : 0,
    reason,
  }));
  const settingsRow = collectionRows.find((row) => row.name === 'app_settings');
  const settingBusinessReferences = settingsRow?.valid
    ? findSettingBusinessReferences(settingsRow.value)
    : [];
  const retainedFileReferences = [];
  for (const name of Object.keys(RETAINED_COLLECTIONS)) {
    const row = collectionRows.find((entry) => entry.name === name);
    if (!row?.valid) continue;
    findRetainedLocalFileReferences(row.value).forEach((location) => {
      retainedFileReferences.push(`${name}:${location}`);
    });
  }
  const resolvedRoots = resolveFileRoots(dbPath, fileRoots);
  const fileCleanup = resolvedRoots.map(scanDirectory);
  const unsupportedFileEntries = fileCleanup
    .filter((entry) => entry.unsupportedEntries > 0)
    .map((entry) => `${entry.root}:${entry.unsupportedEntries}`);

  return {
    mode: 'dry-run',
    database: {
      path: path.resolve(dbPath),
      size: fs.statSync(dbPath).size,
      integrity: db.pragma('integrity_check'),
      foreignKeyViolations: db.pragma('foreign_key_check').length,
      userVersion: db.pragma('user_version', { simple: true }),
      schemaVersion: db.pragma('schema_version', { simple: true }),
      schemaSha256: schemaDigest(db),
      migrationSha256: migrationDigest(db),
    },
    deleteCollections,
    keepCollections,
    deleteTables,
    keepTables,
    unknownCollections,
    unknownTables,
    invalidCollections,
    settingBusinessReferences,
    retainedFileReferences,
    fileCleanup,
    blockers: [
      ...(unknownCollections.length ? [`Unknown app_data collections: ${unknownCollections.map((row) => row.name).join(', ')}`] : []),
      ...(unknownTables.length ? [`Unknown SQLite tables: ${unknownTables.join(', ')}`] : []),
      ...(invalidCollections.length ? [`Invalid JSON collections: ${invalidCollections.join(', ')}`] : []),
      ...(settingBusinessReferences.length ? [`app_settings contains business references: ${settingBusinessReferences.join(', ')}`] : []),
      ...(retainedFileReferences.length ? [`Retained collections reference local files: ${retainedFileReferences.join(', ')}`] : []),
      ...(unsupportedFileEntries.length ? [`Unsupported file entries in business roots: ${unsupportedFileEntries.join(', ')}`] : []),
    ],
    presentCollectionCount: collectionNames.size,
  };
}

function assertBusinessFilesBackedUp(archive, dbPath, fileRoots = []) {
  const roots = resolveFileRoots(dbPath, fileRoots);
  let currentFiles = 0;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const candidate = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(candidate);
          continue;
        }
        if (!entry.isFile()) throw new Error(`Current business file root contains an unsupported entry: ${candidate}`);
        currentFiles += 1;
        const relative = normalizeZipPath(path.relative(root, candidate));
        const zipName = `files/${path.basename(root)}/${relative}`;
        const archived = archive.entries.get(zipName);
        const stat = fs.statSync(candidate);
        if (!archived || archived.size !== stat.size || archived.checksum !== fileCrc32Sync(candidate)) {
          throw new Error(`Verified backup does not exactly cover current business file: ${zipName}`);
        }
        validateStoredZipEntry(archive, zipName);
      }
    }
  }
  const archivedFiles = [...archive.entries.keys()].filter(name => name.startsWith('files/')).length;
  const manifestFiles = Number(archive.manifest.includedFilesCount ?? archive.manifest.files?.includedFilesCount);
  if (!Number.isSafeInteger(manifestFiles) || manifestFiles !== archivedFiles || manifestFiles < currentFiles) {
    throw new Error('Verified backup file manifest does not exactly match its archived file entries.');
  }
  return { currentFiles, archivedFiles };
}

function validateProductionBackup(db, plan, backupPath, fileRoots = []) {
  const archive = inspectFullBackupArchive(backupPath);
  const fileCoverage = assertBusinessFilesBackedUp(archive, plan.database.path, fileRoots);
  const databaseBuffer = readStoredZipEntry(archive, 'database/app.sqlite');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skytech-reset-backup-verify-'));
  const tempDbPath = path.join(tempDir, 'app.sqlite');
  fs.writeFileSync(tempDbPath, databaseBuffer, { mode: 0o600 });
  let backupDb;
  try {
    backupDb = new Database(tempDbPath, { readonly: true, fileMustExist: true });
    backupDb.pragma('foreign_keys = ON');
    const backupPlan = buildResetPlan(backupDb, { dbPath: tempDbPath });
    if (backupPlan.blockers.length > 0) {
      throw new Error(`Verified backup database failed reset discovery: ${backupPlan.blockers.join('; ')}`);
    }
    if (backupPlan.database.integrity.length !== 1 || backupPlan.database.integrity[0].integrity_check !== 'ok') {
      throw new Error('Verified backup database failed integrity_check.');
    }
    if (backupPlan.database.foreignKeyViolations !== 0) {
      throw new Error('Verified backup database contains foreign-key violations.');
    }

    const backupCollections = [...backupPlan.keepCollections, ...backupPlan.deleteCollections]
      .sort((left, right) => left.name.localeCompare(right.name));
    const manifestNames = Object.keys(archive.manifest.counts).sort();
    const backupNames = backupCollections.filter(row => row.type !== 'missing').map(row => row.name).sort();
    if (JSON.stringify(manifestNames) !== JSON.stringify(backupNames)) {
      throw new Error('Verified backup manifest collection set does not match its SQLite snapshot.');
    }
    for (const row of backupCollections) {
      if (row.type === 'missing') continue;
      if (Number(archive.manifest.counts[row.name]) !== row.count) {
        throw new Error(`Verified backup manifest count does not match SQLite for ${row.name}.`);
      }
    }
    if (databaseLogicalDigest(backupDb) !== databaseLogicalDigest(db)) {
      throw new Error('Verified backup SQLite snapshot does not exactly match the current reset source database.');
    }
    if (backupPlan.database.schemaSha256 !== plan.database.schemaSha256
      || backupPlan.database.migrationSha256 !== plan.database.migrationSha256) {
      throw new Error('Verified backup schema or migration state does not match the current database.');
    }
    return {
      archiveEntries: archive.entries.size,
      generatedAt: archive.manifest.generatedAt || null,
      includedFilesCount: Number(archive.manifest.includedFilesCount ?? archive.manifest.files?.includedFilesCount) || 0,
      skippedFilesCount: 0,
      currentBusinessFiles: fileCoverage.currentFiles,
      archivedFiles: fileCoverage.archivedFiles,
      databaseIntegrity: 'ok',
      databaseForeignKeyViolations: 0,
      logicalDatabaseSha256: databaseLogicalDigest(backupDb),
    };
  } finally {
    try { backupDb?.close(); } catch { /* cleanup still runs */ }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertProductionConservation(state = {}) {
  const missing = [];
  if (state.appDisabled !== true) missing.push('APP_DISABLED');
  if (state.botDisabled !== true) missing.push('BOT_DISABLED');
  if (state.gsmDisabled !== true) missing.push('GSM_DISABLED/GSM_ENABLED=off');
  if (missing.length > 0) {
    throw new Error(`Production reset requires active conservation guards: ${missing.join(', ')}.`);
  }
  return true;
}

function assertApplyGuard({ environment, confirm, backupPath, backupSha256, preResetAudit, fileRoots = [], conservationState }, db, plan) {
  const normalizedEnvironment = String(environment || '').trim().toLowerCase();
  const isProduction = normalizedEnvironment === 'production';
  const expected = isProduction ? PRODUCTION_CONFIRMATION : ISOLATED_CONFIRMATION;
  if (confirm !== expected) throw new Error(`Apply requires --confirm=${expected}`);
  if (isProduction && process.env.SKYTECH_CLEAN_RESET_ENABLED !== 'true') {
    throw new Error('Production apply requires SKYTECH_CLEAN_RESET_ENABLED=true.');
  }
  if (isProduction && String(preResetAudit || '').toLowerCase() !== 'pass') {
    throw new Error('Production apply requires independent pre-reset audit PASS.');
  }
  if (isProduction) assertProductionConservation(conservationState);
  if (!backupPath || !fs.existsSync(backupPath) || !fs.statSync(backupPath).isFile()) {
    throw new Error('Apply requires an existing verified backup file.');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(backupSha256 || ''))) {
    throw new Error('Apply requires the recorded backup SHA-256.');
  }
  const actualSha256 = fileSha256(backupPath);
  if (actualSha256 !== String(backupSha256).toLowerCase()) {
    throw new Error('Backup SHA-256 does not match the verified backup file.');
  }
  const validation = isProduction ? validateProductionBackup(db, plan, backupPath, fileRoots) : null;
  return { isProduction, actualSha256, validation };
}

function emptyJsonFor(row) {
  return row?.type === 'object' ? '{}' : '[]';
}

function stageFileCleanup(dbPath, fileRoots, now = new Date()) {
  const dataDir = path.dirname(path.resolve(dbPath));
  const stamp = now.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
  const quarantinePath = path.join(dataDir, `.skytech-reset-quarantine-${stamp}`);
  const stage = { quarantinePath: null, staged: [] };
  try {
    for (const root of resolveFileRoots(dbPath, fileRoots)) {
      const impact = scanDirectory(root);
      if (!impact.exists || (impact.files === 0 && impact.directories === 0)) continue;
      fs.mkdirSync(quarantinePath, { recursive: true });
      stage.quarantinePath = quarantinePath;
      const target = path.join(quarantinePath, path.basename(root));
      fs.renameSync(root, target);
      stage.staged.push({ root, target, impact });
      fs.mkdirSync(root, { recursive: true });
    }
    return stage;
  } catch (error) {
    try { rollbackFileCleanup(stage); } catch (rollbackError) {
      error.message = `${error.message}; staged file rollback failed: ${rollbackError.message}`;
    }
    throw error;
  }
}

function rollbackFileCleanup(stage) {
  for (const item of [...(stage?.staged || [])].reverse()) {
    if (fs.existsSync(item.root)) fs.rmdirSync(item.root);
    fs.renameSync(item.target, item.root);
  }
  if (stage?.quarantinePath && fs.existsSync(stage.quarantinePath)) fs.rmdirSync(stage.quarantinePath);
}

function assertRetentionUnchanged(before, after) {
  const mismatches = [];
  for (const [name, value] of Object.entries(before.collections)) {
    if (JSON.stringify(value) !== JSON.stringify(after.collections[name])) mismatches.push(`collection:${name}`);
  }
  for (const [name, value] of Object.entries(before.tables)) {
    if (JSON.stringify(value) !== JSON.stringify(after.tables[name])) mismatches.push(`table:${name}`);
  }
  for (const field of ['userVersion', 'schemaVersion', 'schemaSha256', 'migrationSha256']) {
    if (before.schema[field] !== after.schema[field]) mismatches.push(`schema:${field}`);
  }
  if (mismatches.length > 0) throw new Error(`Retention invariant failed: ${mismatches.join(', ')}`);
}

function assertResetPostconditions(db, plan) {
  const nonZeroCollections = plan.deleteCollections.filter((row) => row.count !== 0);
  const nonZeroTables = plan.deleteTables.filter((row) => row.count !== 0);
  const integrity = db.pragma('integrity_check');
  const foreignKeyViolations = db.pragma('foreign_key_check');
  if (nonZeroCollections.length || nonZeroTables.length) throw new Error('Reset postcondition failed: business data remains.');
  if (plan.blockers.length > 0) throw new Error(`Reset postcondition failed: ${plan.blockers.join('; ')}`);
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('Reset postcondition failed: integrity_check is not ok.');
  if (foreignKeyViolations.length > 0) throw new Error('Reset postcondition failed: foreign key violations remain.');
  return { integrity, foreignKeyViolations };
}

function applyReset(db, options = {}) {
  const plan = buildResetPlan(db, options);
  if (plan.blockers.length > 0) throw new Error(`Reset preconditions failed: ${plan.blockers.join('; ')}`);
  const guard = assertApplyGuard(options, db, plan);
  const retentionBefore = retentionSnapshot(db);
  const collectionRows = new Map(listCollections(db).map((row) => [row.name, row]));
  const presentTables = new Set(listTables(db));
  const nonEmptyDeletedTables = DELETED_TABLES.filter((name) => presentTables.has(name) && tableCount(db, name) > 0);
  let fileStage = null;
  let transactionStarted = false;
  let foreignKeysDisabled = false;
  let retentionAfter = null;
  let afterPlan = null;
  let postconditions = null;

  try {
    if (options.cleanupFiles !== false) {
      fileStage = stageFileCleanup(options.dbPath, options.fileRoots || [], options.now || new Date());
    }
    if (nonEmptyDeletedTables.length > 0) {
      db.pragma('foreign_keys = OFF');
      foreignKeysDisabled = true;
    }
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;

    const updateCollection = db.prepare(`
      UPDATE app_data
      SET json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE name = ? AND json <> ?
    `);
    for (const name of DELETED_COLLECTIONS) {
      const row = collectionRows.get(name);
      if (!row) continue;
      const emptyJson = emptyJsonFor(row);
      updateCollection.run(emptyJson, name, emptyJson);
    }
    for (const table of DELETED_TABLES) {
      if (presentTables.has(table)) db.exec(`DELETE FROM ${quoteIdentifier(table)}`);
    }

    // Prove the complete result before COMMIT so any reset or retention failure
    // rolls both the database transaction and staged file cleanup back.
    retentionAfter = retentionSnapshot(db);
    assertRetentionUnchanged(retentionBefore, retentionAfter);
    afterPlan = buildResetPlan(db, options);
    postconditions = assertResetPostconditions(db, afterPlan);
    db.exec('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try { db.exec('ROLLBACK'); } catch { /* original error wins */ }
    }
    if (fileStage) {
      try { rollbackFileCleanup(fileStage); } catch (rollbackError) {
        error.message = `${error.message}; file rollback failed: ${rollbackError.message}`;
      }
    }
    throw error;
  } finally {
    if (foreignKeysDisabled) db.pragma('foreign_keys = ON');
  }

  return {
    mode: 'apply',
    environment: options.environment,
    backup: {
      filename: path.basename(options.backupPath),
      sha256: guard.actualSha256,
      size: fs.statSync(options.backupPath).size,
      validation: guard.validation,
    },
    before: plan,
    after: afterPlan,
    retentionBefore,
    retentionAfter,
    integrity: postconditions.integrity,
    foreignKeyViolations: postconditions.foreignKeyViolations.length,
    fileCleanup: {
      quarantinePath: fileStage?.quarantinePath || null,
      staged: (fileStage?.staged || []).map((item) => ({ root: item.root, impact: item.impact })),
    },
  };
}

function purgeQuarantine({ dbPath, quarantinePath, confirm, backupPath, backupSha256 }) {
  if (confirm !== PURGE_CONFIRMATION) throw new Error(`Purge requires --confirm=${PURGE_CONFIRMATION}`);
  assertApplyGuard({
    environment: 'isolated',
    confirm: ISOLATED_CONFIRMATION,
    backupPath,
    backupSha256,
  });
  const dataDir = path.dirname(path.resolve(dbPath));
  const target = path.resolve(quarantinePath || '');
  const relative = path.relative(dataDir, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/^\.skytech-reset-quarantine-\d{8}T\d{6,9}Z$/.test(relative)) {
    throw new Error('Unsafe quarantine purge target.');
  }
  const impact = scanDirectory(target);
  if (impact.exists) fs.rmSync(target, { recursive: true, force: false });
  return { purged: impact.exists, quarantine: path.basename(target), impact };
}

module.exports = {
  DELETED_COLLECTIONS,
  DELETED_TABLES,
  FILE_ROOT_NAMES,
  ISOLATED_CONFIRMATION,
  PRODUCTION_CONFIRMATION,
  PURGE_CONFIRMATION,
  RETAINED_COLLECTIONS,
  RETAINED_TABLES,
  applyReset,
  assertProductionConservation,
  buildResetPlan,
  fileSha256,
  purgeQuarantine,
  retentionSnapshot,
  schemaDigest,
  validateProductionBackup,
};
