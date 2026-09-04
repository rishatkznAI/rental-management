import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const policy = require('../server/config/future-write-audit-matrix.json');
const {
  ALL_APP_DATA_COLLECTIONS,
  COLLECTION_SCOPE_CATEGORY,
  COLLECTION_SCOPE_REGISTRY,
} = require('../server/lib/app-data-scope-registry');
const {
  DELETED_COLLECTIONS: CLEAN_RESET_DELETED_COLLECTIONS,
  DELETED_TABLES: CLEAN_RESET_DELETED_TABLES,
} = require('../server/lib/skytech-clean-production-reset');
const {
  buildFutureWriteAudit,
  scanFile,
  sourceCorpusSha256,
  walkSourceFiles,
} = require('../server/lib/future-write-audit');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM_MAINTENANCE = Object.freeze({
  TENANT: 'TEST_EXACT_TENANT_PLATFORM_MAINTENANCE',
  PLATFORM_DEFAULT_TENANT_OVERLAY: 'TEST_EXACT_MIXED_CATALOG_PLATFORM_MAINTENANCE',
  TENANT_TECHNICAL: 'TEST_EXACT_TECHNICAL_PLATFORM_MAINTENANCE',
  DERIVED_SCOPE: 'TEST_EXACT_DERIVED_PLATFORM_MAINTENANCE',
  LEGACY_HISTORY: 'TEST_EXACT_HISTORY_PLATFORM_MAINTENANCE',
  SYSTEM: 'TEST_EXACT_SYSTEM_PLATFORM_MAINTENANCE',
  GLOBAL_REFERENCE: 'TEST_EXACT_GLOBAL_REFERENCE_PLATFORM_MAINTENANCE',
});

function fixtureRoot(t, files) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'future-write-audit-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  for (const [relativePath, source] of Object.entries(files)) {
    const target = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  return rootDir;
}

function fixtureCollectionPolicies() {
  return Object.fromEntries(ALL_APP_DATA_COLLECTIONS.map(collection => [collection, {
    category: COLLECTION_SCOPE_REGISTRY[collection].category,
    status: 'PASS',
    platformMaintenance: PLATFORM_MAINTENANCE[COLLECTION_SCOPE_REGISTRY[collection].category],
    noCreateReason: 'No create/upsert path in this adversarial fixture.',
  }]));
}

function fixtureCategoryPolicies() {
  return Object.fromEntries(Object.values(COLLECTION_SCOPE_CATEGORY).map(category => [category, {
    status: 'PASS',
    platformMaintenance: PLATFORM_MAINTENANCE[category],
  }]));
}

function buildFixturePolicy(rootDir, {
  sourceAuthorities,
  dynamicCollectionBounds = [],
  dynamicSqlObjectBounds = [],
} = {}) {
  const sites = walkSourceFiles(rootDir).flatMap(filePath => scanFile(rootDir, filePath));
  const draft = {
    schemaVersion: 1,
    expectedRegistryCollectionCount: ALL_APP_DATA_COLLECTIONS.length,
    expectedSiteCount: sites.length,
    expectedSourceCorpusSha256: sourceCorpusSha256(rootDir),
    expectedInventorySha256: '0'.repeat(64),
    categoryPolicies: fixtureCategoryPolicies(),
    collectionPolicies: fixtureCollectionPolicies(),
    sourceAuthorities,
    dynamicCollectionBounds,
    dynamicSqlObjectBounds,
    callableEscapeReviews: sites
      .filter(site => site.kind.endsWith('_CALLABLE_ESCAPE'))
      .map(site => ({
        siteFingerprint: site.fingerprint,
        kind: site.kind,
        rationale: 'Explicit adversarial-fixture callable escape review.',
      })),
  };
  let report = buildFutureWriteAudit({ rootDir, policy: draft });
  for (const entry of report.collectionMatrix) {
    if (entry.createUpsertPaths.length > 0) delete draft.collectionPolicies[entry.collection].noCreateReason;
  }
  report = buildFutureWriteAudit({ rootDir, policy: draft });
  draft.expectedInventorySha256 = report.inventorySha256;
  return draft;
}

function authority(files, extra = {}) {
  return {
    id: 'fixture-authority',
    status: 'PASS',
    authority: 'Adversarial fixture authority.',
    layer: 'TEST',
    pathRole: 'TEST_WRITE',
    files,
    ...extra,
  };
}

test('committed future-write inventory is exact, complete, and contains no UNKNOWN classification', () => {
  const report = buildFutureWriteAudit({ rootDir: ROOT, policy });
  assert.equal(report.status, 'PASS', JSON.stringify(report.findings, null, 2));
  assert.equal(report.inventorySha256, policy.expectedInventorySha256);
  assert.equal(report.sourceCorpusSha256, policy.expectedSourceCorpusSha256);
  assert.equal(report.summary.registryCollectionCount, 76);
  assert.equal(report.summary.writeSiteCount, policy.expectedSiteCount);
  assert.equal(report.summary.unknownSiteCount, 0);
  assert.equal(report.summary.failedCollectionCount, 0);
  assert.equal(report.collectionMatrix.length, ALL_APP_DATA_COLLECTIONS.length);
  const publicSiteCms = report.collectionMatrix.find(entry => entry.collection === 'public_site_cms');
  assert.deepEqual(
    publicSiteCms.createUpsertPaths.map(entry => entry.file),
    ['server/routes/public-site.js'],
  );
  assert.ok(report.collectionMatrix.every(entry => entry.status === 'PASS'));
  assert.ok(report.sqlObjectMatrix.every(entry => entry.status === 'PASS'));
  assert.ok(report.sourceAuthorityMatrix.every(entry => entry.status === 'PASS' && entry.writeSiteCount > 0));
  assert.deepEqual(
    new Set(report.categoryPolicyMatrix.map(entry => entry.category)),
    new Set(Object.values(COLLECTION_SCOPE_CATEGORY)),
  );
  assert.ok(report.categoryPolicyMatrix.every(entry => entry.status === 'PASS' && entry.platformMaintenance));
  assert.equal(JSON.stringify(report).includes('"UNKNOWN"'), false);
});

test('every audited source file completes provenance scanning without recursion or parse gaps', () => {
  const files = walkSourceFiles(ROOT);
  const sites = files.flatMap(filePath => scanFile(ROOT, filePath));
  assert.ok(files.length > 0);
  assert.ok(sites.length > 0);
  assert.ok(sites.every(site => site.file && site.fingerprint));
});

test('self-referential member and logical aliases terminate fail closed', t => {
  const rootDir = fixtureRoot(t, {
    'server/cyclic-provenance.js': `
      function cyclic(setData) {
        const box = { persist: box.persist || setData };
        box.persist('equipment', []);
      }
    `,
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/cyclic-provenance.js'));
  assert.ok(sites.some(site => (
    site.kind === 'APP_DATA_WRITE' || site.kind === 'APP_DATA_CALLABLE_ESCAPE'
  )));
});

test('every raw app_data DML site resolves exact registry collections', () => {
  const report = buildFutureWriteAudit({ rootDir: ROOT, policy });
  const rawAppDataSites = report.writeSites.filter(site => (
    site.tables.includes('app_data')
    && /\b(?:INSERT|REPLACE|UPDATE|DELETE)\b/i.test(site.sql || '')
    && !/^\s*CREATE\b/i.test(site.sql || '')
  ));
  assert.deepEqual(
    rawAppDataSites.map(site => `${site.file}:${site.function}`).sort(),
    [
      'server/db.js:setData',
      'server/lib/production-scope-remediation.js:persistCollectionDiff',
      'server/lib/production-smoke-identity.js:applyProductionSmokeIdentityTransition',
      'server/lib/skytech-clean-production-reset.js:applyReset',
      'server/scripts/verify-production-scope-local-visibility.js:writeCollection',
    ],
  );
  for (const site of rawAppDataSites) {
    assert.equal(site.status, 'PASS', `${site.file}:${site.line}`);
    assert.ok(site.collections.length > 0, `${site.file}:${site.line}`);
    assert.ok(site.collections.every(collection => COLLECTION_SCOPE_REGISTRY[collection]), `${site.file}:${site.line}`);
    if (site.dynamicCollections) {
      assert.equal(policy.dynamicCollectionBounds.filter(bound => bound.siteFingerprint === site.fingerprint).length, 1);
    }
  }
});

test('production remediation CAS is bounded to the current non-overlay array scope', () => {
  const report = buildFutureWriteAudit({ rootDir: ROOT, policy });
  const remediationCas = report.writeSites.find(site => (
    site.file === 'server/lib/production-scope-remediation.js'
    && site.function === 'persistCollectionDiff'
    && site.kind === 'SQL_PREPARED_RUN'
  ));
  assert.ok(remediationCas);
  const allowedCategories = new Set([
    COLLECTION_SCOPE_CATEGORY.TENANT,
    COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL,
    COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE,
    COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY,
  ]);
  const expected = ALL_APP_DATA_COLLECTIONS.filter(name => (
    allowedCategories.has(COLLECTION_SCOPE_REGISTRY[name].category)
    && COLLECTION_SCOPE_REGISTRY[name].shape === 'ARRAY'
  )).sort();
  assert.deepEqual(remediationCas.collections, expected);
  assert.equal(remediationCas.collections.includes('public_site_cms'), false);
  assert.equal(remediationCas.collections.includes('users'), false);
});

test('clean reset dynamic bounds are the exact collection and SQL-table deletion allowlists', () => {
  const report = buildFutureWriteAudit({ rootDir: ROOT, policy });
  const appDataUpdate = report.writeSites.find(site => (
    site.file === 'server/lib/skytech-clean-production-reset.js'
    && site.function === 'applyReset'
    && site.kind === 'SQL_PREPARED_RUN'
    && site.tables.includes('app_data')
  ));
  assert.ok(appDataUpdate);
  assert.deepEqual(appDataUpdate.collections, [...CLEAN_RESET_DELETED_COLLECTIONS].sort());

  const tableDelete = report.writeSites.find(site => (
    site.file === 'server/lib/skytech-clean-production-reset.js'
    && site.function === 'applyReset'
    && site.kind === 'SQL_EXEC'
    && site.source.includes('quoteIdentifier(table)')
  ));
  assert.ok(tableDelete);
  assert.deepEqual(tableDelete.tables, [...CLEAN_RESET_DELETED_TABLES].sort());
  assert.equal(tableDelete.tables.includes('app_data'), false);
});

test('bot and rental persistence inventory includes every equipment side effect', () => {
  const report = buildFutureWriteAudit({ rootDir: ROOT, policy });
  for (const [file, functionName] of [
    ['server/lib/bot-operations.js', 'completeBotEquipmentOperation'],
    ['server/routes/rentals.js', 'persistCreate'],
  ]) {
    const matches = report.writeSites.filter(site => site.file === file && site.function === functionName);
    assert.ok(matches.length > 0, `${file}:${functionName}`);
    assert.ok(matches.every(site => site.collections.includes('equipment')), `${file}:${functionName}`);
  }
  const repairWorkSites = report.writeSites.filter(site => (
    site.file === 'server/lib/bot-operations.js'
    && site.function === 'addRepairWorkItemFromCatalog'
  ));
  assert.deepEqual(
    new Set(repairWorkSites.flatMap(site => site.collections)),
    new Set(['repair_work_items', 'equipment']),
  );
});

test('platform-only, connection-guard, disposable-copy, and backup artifacts are explicit', () => {
  const report = buildFutureWriteAudit({ rootDir: ROOT, policy });
  const preCompatibility = report.writeSites.filter(site => site.file === 'server/pre-compatibility-backup-server.js');
  assert.ok(preCompatibility.some(site => site.kind === 'SQL_CONNECTION_GUARD'));
  assert.ok(preCompatibility.every(site => site.platformRemediationOnly && site.guard));
  const backupValidation = report.writeSites.filter(site => site.file === 'server/lib/pre-compatibility-backup.js');
  assert.ok(backupValidation.some(site => site.kind === 'SQL_READONLY_PREPARE_GUARD'));
  assert.ok(backupValidation.every(site => site.guard && site.contributesCollectionPaths === false));
  const preCompatibilityRoute = report.writeSites.filter(site => site.file === 'server/routes/pre-compatibility-backup.js');
  assert.ok(preCompatibilityRoute.some(site => site.kind === 'SQLITE_BACKUP_ARTIFACT'));
  assert.ok(preCompatibilityRoute.every(site => site.guard && site.contributesCollectionPaths === false));
  const localVisibility = report.writeSites.filter(site => site.file === 'server/scripts/verify-production-scope-local-visibility.js');
  assert.ok(localVisibility.length > 0);
  assert.ok(localVisibility.every(site => site.disposableOnly && /OS-temp|nlink=1/.test(site.guard)));
  const identitySimulation = report.writeSites.filter(site => (
    site.file === 'server/scripts/simulate-skytech-identity-bootstrap-read-only.js'
  ));
  assert.equal(identitySimulation.length, 2);
  assert.ok(identitySimulation.every(site => (
    site.kind === 'SQL_CONNECTION_GUARD'
    && site.disposableOnly
    && site.contributesCollectionPaths === false
    && /source is never SQLite-opened/.test(site.guard)
  )));
  assert.equal(report.summary.backupArtifactSiteCount, 4);
  assert.ok(report.backupArtifactPaths.every(site => site.guard && site.contributesCollectionPaths === false));
});

test('a new unclassified write site fails closed with authority and inventory drift', t => {
  const rootDir = fixtureRoot(t, {
    'server/example.js': "function write(writeData) { writeData('equipment', []); }\n",
  });
  const draft = buildFixturePolicy(rootDir, {
    sourceAuthorities: [authority(['server/example.js'])],
  });
  assert.equal(buildFutureWriteAudit({ rootDir, policy: draft }).status, 'PASS');
  fs.writeFileSync(path.join(rootDir, 'server/new-writer.js'), "function write(writeData) { writeData('users', []); }\n");
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(report.status, 'FAIL');
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_SITE_AUTHORITY_UNKNOWN'));
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_INVENTORY_DRIFT'));
});

test('binding provenance inventories app-data and SQLite aliases across imports, assignments, bind, call, and apply', t => {
  const rootDir = fixtureRoot(t, {
    'server/alias-provenance.js': `
      import { setData as importedWriter } from './db.js';
      const { setData } = require('./db.js');
      const firstWriter = setData;
      const secondWriter = firstWriter;
      let assignedWriter;
      assignedWriter = setData;
      const memberWriter = storage.writeData;
      const boundWriter = setData.bind(null);
      const objectBox = { persist: setData };
      const arrayBox = [setData];
      const { persist: destructuredBoxWriter } = objectBox;
      function invokeWriter(customWriter) {
        customWriter('deliveries', []);
      }

      secondWriter('equipment', []);
      importedWriter('rentals', []);
      assignedWriter('users', []);
      memberWriter('documents', []);
      boundWriter('gantt_rentals', []);
      objectBox.persist('equipment_finance', []);
      arrayBox[0]('leasing_contracts', []);
      destructuredBoxWriter('warranty_claims', []);
      invokeWriter(setData);
      setData.call(null, 'service', []);
      setData.apply(null, ['clients', []]);
      Reflect.apply(setData, null, ['payments', []]);

      const execute = db.exec.bind(db);
      const firstExecute = execute;
      const secondExecute = firstExecute;
      const prepareBound = db.prepare.bind(db);
      const { exec: executeDestructured, prepare: prepareDestructured } = db;
      const sqlBox = { execute: db.exec.bind(db) };
      secondExecute("DELETE FROM app_data WHERE name = 'equipment'");
      executeDestructured("DELETE FROM app_data WHERE name = 'users'");
      prepareBound("DELETE FROM app_data WHERE name = 'service'").run();
      const statement = prepareDestructured("DELETE FROM app_data WHERE name = 'clients'");
      statement.run();
      sqlBox.execute("DELETE FROM app_data WHERE name = 'documents'");

      const pattern = /equipment/;
      pattern.exec('equipment');
      const boundRegexExec = pattern.exec.bind(pattern);
      const { exec: destructuredRegexExec } = pattern;
      boundRegexExec('equipment');
      destructuredRegexExec('equipment');
      const importPatterns = [/equipment/g, /service/g];
      for (const importPattern of importPatterns) {
        while (importPattern.exec('equipment service')) {}
      }
    `,
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/alias-provenance.js'));
  const appSites = sites.filter(site => site.kind.startsWith('APP_DATA_'));
  const sqlSites = sites.filter(site => site.kind.startsWith('SQL_'));

  assert.equal(appSites.length, 12);
  assert.deepEqual(
    appSites.map(site => site.collections[0]).sort(),
    [
      'clients',
      'deliveries',
      'documents',
      'equipment',
      'equipment_finance',
      'gantt_rentals',
      'leasing_contracts',
      'payments',
      'rentals',
      'service',
      'users',
      'warranty_claims',
    ],
  );
  assert.ok(appSites.every(site => site.dynamicCollections === false));
  assert.equal(sqlSites.length, 5);
  assert.deepEqual(
    sqlSites.map(site => site.collections[0]).sort(),
    ['clients', 'documents', 'equipment', 'service', 'users'],
  );
  assert.equal(sites.some(site => site.kind.endsWith('_CALLABLE_ESCAPE')), false);
  assert.equal(sites.some(site => site.source.includes('pattern.exec')), false);
  assert.equal(sites.some(site => site.source.includes('boundRegexExec')), false);
  assert.equal(sites.some(site => site.source.includes('destructuredRegexExec')), false);
  assert.equal(sites.some(site => site.source.includes('importPattern.exec')), false);
});

test('alias-only write injection changes the committed inventory and fails closed', t => {
  const rootDir = fixtureRoot(t, {
    'server/base.js': "function write(writeData) { writeData('equipment', []); }\n",
  });
  const draft = buildFixturePolicy(rootDir, {
    sourceAuthorities: [authority(['server/base.js'])],
  });
  const baseline = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(baseline.status, 'PASS');

  fs.writeFileSync(path.join(rootDir, 'server/alias-bypass.js'), `
    const { setData } = require('./db');
    const first = setData;
    const second = first;
    const execute = db.exec.bind(db);
    second('equipment', [{ companyId: 'forged', tenantId: 'forged' }]);
    execute("DELETE FROM app_data WHERE name = 'equipment'");
  `);
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.summary.writeSiteCount, baseline.summary.writeSiteCount + 2);
  assert.ok(report.writeSites.some(site => site.file === 'server/alias-bypass.js'));
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_SITE_AUTHORITY_UNKNOWN'));
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_INVENTORY_DRIFT'));
});

test('the exact source-corpus seal fails closed even when a new callable shape is not classified', t => {
  const rootDir = fixtureRoot(t, {
    'server/base.js': "function write(writeData) { writeData('equipment', []); }\n",
  });
  const draft = buildFixturePolicy(rootDir, {
    sourceAuthorities: [authority(['server/base.js'])],
  });
  const baseline = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(baseline.status, 'PASS');

  fs.writeFileSync(path.join(rootDir, 'server/unresolved-container.js'), `
    const vault = new Map([['persist', require('./db').setData]]);
    vault.get('persist')('equipment', []);
  `);
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(report.status, 'FAIL');
  assert.notEqual(report.sourceCorpusSha256, baseline.sourceCorpusSha256);
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_SOURCE_CORPUS_DRIFT'));
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_INVENTORY_DRIFT'));
});

test('SQLite exec exclusion requires proven RegExp provenance, never a receiver name', t => {
  const rootDir = fixtureRoot(t, {
    'server/receiver-provenance.js': `
      function disguisedDatabase(pattern) {
        pattern.exec("DELETE FROM app_data WHERE name = 'equipment'");
      }
      function actualRegex() {
        const neutral = /equipment/;
        neutral.exec('equipment');
        const bound = neutral.exec.bind(neutral);
        const { exec: destructured } = neutral;
        bound('equipment');
        destructured('equipment');
        const constructed = new RegExp('equipment');
        constructed.exec('equipment');
      }
    `,
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/receiver-provenance.js'));
  assert.equal(sites.length, 1);
  assert.equal(sites[0].kind, 'SQL_EXEC');
  assert.deepEqual(sites[0].collections, ['equipment']);
  assert.equal(sites[0].function, 'disguisedDatabase');
});

test('prepared execution inventories incomplete WITH and PRAGMA plus write pragmas through read methods', t => {
  const rootDir = fixtureRoot(t, {
    'server/prepared-provenance.js': `
      function execute(db, tail) {
        db.prepare(\`WITH x AS (SELECT 1) \${tail}\`).get();
        db.prepare(\`PRAGMA \${tail}\`).all();
        db.prepare('PRAGMA journal_mode=WAL').get();
        db.prepare('PRAGMA writable_schema=ON').all();
        db.prepare('PRAGMA user_version(7)').all();
        const statement = db.prepare(buildSql());
        const boundRun = statement.run.bind(statement);
        boundRun();
        const box = { statement: db.prepare(buildOtherSql()) };
        box.statement.run();
        db.prepare(buildThirdSql()).pluck().run();
        db.prepare('SELECT 1').get();
        db.prepare('PRAGMA table_info(app_data)').all();
      }
    `,
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/prepared-provenance.js'));
  assert.equal(sites.length, 8);
  assert.ok(sites.every(site => site.kind === 'SQL_PREPARED_RUN'));
  assert.equal(sites.filter(site => site.dynamicSqlObjects).length, 5);
  assert.ok(sites.some(site => site.sql.includes('WITH x AS')));
  assert.ok(sites.some(site => site.sql === 'PRAGMA journal_mode=WAL'));
  assert.ok(sites.some(site => site.sql === 'PRAGMA writable_schema=ON'));
});

test('dynamic db.pragma calls and non-assignment write pragmas are inventoried conservatively', t => {
  const rootDir = fixtureRoot(t, {
    'server/dynamic-pragma.js': `
      function execute(db, source) {
        db.pragma(source);
        db.pragma(\`journal_mode(\${source})\`);
        db.pragma('wal_checkpoint');
        db.pragma('user_version(7)');
        db.pragma('foreign_keys(ON)');
        db.pragma('mystery_pragma');
        db.pragma('foreign_keys');
        db.pragma('journal_mode');
        db.pragma('table_info(app_data)');
      }
    `,
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/dynamic-pragma.js'));
  assert.equal(sites.length, 6);
  assert.ok(sites.every(site => site.kind === 'SQL_PRAGMA_WRITE'));
  assert.equal(sites.filter(site => site.dynamicSqlObjects).length, 2);
  assert.ok(sites.some(site => site.sql === 'wal_checkpoint'));
  assert.ok(sites.some(site => site.sql === 'user_version(7)'));
  assert.ok(sites.some(site => site.sql === 'foreign_keys(ON)'));
  assert.ok(sites.some(site => site.sql === 'mystery_pragma'));
  assert.equal(sites.some(site => site.sql === 'foreign_keys'), false);
  assert.equal(sites.some(site => site.sql === 'journal_mode'), false);
  assert.equal(sites.some(site => site.sql === 'table_info(app_data)'), false);
});

test('unsupported ordinary callable propagation becomes an explicit fail-closed escape site', t => {
  const rootDir = fixtureRoot(t, {
    'server/callable-escapes.js': `
      function objectMethodShape(setData) {
        const api = { use(writer) { writer('equipment', []); } };
        api.use(setData);
      }
      function classMethodShape(setData) {
        class Api { use(writer) { writer('rentals', []); } }
        new Api().use(setData);
      }
      function destructuredShape(setData) {
        function use({ persist }) { persist('clients', []); }
        use({ persist: setData });
      }
      function defaultShape(setData) {
        function defaultInvoker(persist = setData) { persist('payments', []); }
        defaultInvoker();
      }
      function restShape(setData) {
        function use(...writers) { writers[0]('service', []); }
        use(setData);
      }
      function memberAssignmentShape(setData) {
        const box = {};
        box.persist = setData;
        box.persist('documents', []);
      }
      function nestedObjectShape(setData) {
        const box = { inner: { persist: setData } };
        box.inner.persist('deliveries', []);
      }
      function arrayMutationShape(setData) {
        const box = [];
        box.push(setData);
        box[0]('gantt_rentals', []);
      }
      function factoryShape(setData) {
        function factory() { return setData; }
        factory()('users', []);
      }
      function objectAssignShape(setData) {
        const box = Object.assign({}, { persist: setData });
        box.persist('planner_items', []);
      }
      function mapShape(setData) {
        const box = new Map([['persist', setData]]);
        box.get('persist')('equipment', []);
      }
    `,
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/callable-escapes.js'));
  const escapeSites = sites.filter(site => site.kind === 'APP_DATA_CALLABLE_ESCAPE');
  assert.ok(escapeSites.length >= 5);
  for (const functionName of [
    'objectMethodShape',
    'classMethodShape',
    'destructuredShape',
    'defaultInvoker',
    'restShape',
    'memberAssignmentShape',
    'nestedObjectShape',
    'arrayMutationShape',
    'objectAssignShape',
    'mapShape',
  ]) {
    assert.ok(escapeSites.some(site => site.function === functionName), functionName);
  }
  assert.ok(escapeSites.some(site => site.function === 'factory'));
  assert.ok(escapeSites.every(site => site.dynamicCollections));
});

test('unsupported SQLite containers become explicit SQL callable escapes', t => {
  const rootDir = fixtureRoot(t, {
    'server/sql-callable-escapes.js': `
      function memberAssignment(db) {
        const box = {};
        box.execute = db.exec.bind(db);
        box.execute("DELETE FROM app_data WHERE name = 'equipment'");
      }
      function nestedObject(db) {
        const box = { inner: { execute: db.exec.bind(db) } };
        box.inner.execute("DELETE FROM app_data WHERE name = 'rentals'");
      }
      function mapContainer(db) {
        const box = new Map([['execute', db.prepare.bind(db)]]);
        box.get('execute')(buildSql()).run();
      }
    `,
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/sql-callable-escapes.js'));
  const escapes = sites.filter(site => site.kind === 'SQL_CALLABLE_ESCAPE');
  assert.equal(escapes.length, 3);
  assert.deepEqual(
    escapes.map(site => site.function).sort(),
    ['mapContainer', 'memberAssignment', 'nestedObject'],
  );
  assert.ok(escapes.every(site => site.dynamicSqlObjects));
});

test('one recognized alias use cannot suppress a second unsupported escape of the same origin', t => {
  const rootDir = fixtureRoot(t, {
    'server/mixed-alias-uses.js': `
      function app(setData) {
        const writer = setData;
        writer('clients', []);
        const box = new Map([['persist', writer]]);
        box.get('persist')('equipment', []);
      }
      function sql(db) {
        const execute = db.exec.bind(db);
        execute("DELETE FROM app_data WHERE name = 'clients'");
        const box = new Map([['execute', execute]]);
        box.get('execute')("DELETE FROM app_data WHERE name = 'equipment'");
      }
    `,
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/mixed-alias-uses.js'));
  assert.ok(sites.some(site => (
    site.kind === 'APP_DATA_WRITE'
    && site.function === 'app'
    && site.collections.includes('clients')
  )));
  assert.ok(sites.some(site => (
    site.kind === 'APP_DATA_CALLABLE_ESCAPE'
    && site.function === 'app'
  )));
  assert.ok(sites.some(site => (
    site.kind === 'SQL_EXEC'
    && site.function === 'sql'
    && site.collections.includes('clients')
  )));
  assert.ok(sites.some(site => (
    site.kind === 'SQL_CALLABLE_ESCAPE'
    && site.function === 'sql'
  )));
});

test('a callable escape cannot pass even with authority and bounds until its exact review is present', t => {
  const rootDir = fixtureRoot(t, {
    'server/reviewed-escape.js': `
      function unresolved(setData) {
        const box = [];
        box.push(setData);
        box[0]('equipment', []);
      }
    `,
  });
  const [escapeSite] = scanFile(rootDir, path.join(rootDir, 'server/reviewed-escape.js'));
  assert.equal(escapeSite.kind, 'APP_DATA_CALLABLE_ESCAPE');
  const draft = buildFixturePolicy(rootDir, {
    sourceAuthorities: [authority(['server/reviewed-escape.js'])],
    dynamicCollectionBounds: [{
      siteFingerprint: escapeSite.fingerprint,
      collections: ['equipment'],
    }],
  });
  assert.equal(buildFutureWriteAudit({ rootDir, policy: draft }).status, 'PASS');
  draft.callableEscapeReviews = [];
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(report.status, 'FAIL');
  assert.ok(report.findings.some(finding => (
    finding.code === 'FUTURE_WRITE_CALLABLE_ESCAPE_UNREVIEWED'
    && finding.siteFingerprint === escapeSite.fingerprint
  )));
});

test('reassigned, logical, and conditional collection names are always dynamic', t => {
  const rootDir = fixtureRoot(t, {
    'server/dynamic.js': `
      function writes(writeData, request, flag) {
        let collection = 'equipment';
        collection = request.body.collection;
        writeData(collection, []);
        writeData(request.body.collection || 'equipment', []);
        writeData(flag ? request.body.collection : 'equipment', []);
      }
    `,
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/dynamic.js'));
  assert.equal(sites.length, 3);
  assert.ok(sites.every(site => site.dynamicCollections));
});

test('dynamic collection and dynamic SQL sites require one exact fingerprint bound', t => {
  const rootDir = fixtureRoot(t, {
    'server/dynamic.js': `
      function write(writeData, name) { writeData(name, []); }
      function execute(db) { db.exec(buildSql()); }
    `,
  });
  const draft = buildFixturePolicy(rootDir, {
    sourceAuthorities: [authority(['server/dynamic.js'], { tables: ['app_data'] })],
  });
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(report.status, 'FAIL');
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_DYNAMIC_COLLECTION_UNKNOWN'));
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_DYNAMIC_SQL_OBJECT_UNKNOWN'));
});

test('a dynamic SQL bound cannot turn raw app_data DML without collection authority into PASS', t => {
  const rootDir = fixtureRoot(t, {
    'server/dynamic-app-data.js': 'function execute(db, table) { db.exec(`DELETE FROM ${table}`); }\n',
  });
  const [site] = scanFile(rootDir, path.join(rootDir, 'server/dynamic-app-data.js'));
  const draft = buildFixturePolicy(rootDir, {
    sourceAuthorities: [authority(['server/dynamic-app-data.js'], { tables: ['app_data'] })],
    dynamicSqlObjectBounds: [{ siteFingerprint: site.fingerprint, tables: ['app_data'] }],
  });
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.writeSites[0].status, 'FAIL');
  assert.deepEqual(report.writeSites[0].tables, ['app_data']);
  assert.deepEqual(report.writeSites[0].collections, []);
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_APP_DATA_COLLECTION_UNKNOWN'));
});

test('an unknown raw app_data selector cannot hide beside a registered collection', t => {
  const rootDir = fixtureRoot(t, {
    'server/unknown-app-data.js': "function execute(db) { db.exec(\"DELETE FROM app_data WHERE name IN ('users', 'future_collection')\"); }\n",
  });
  const draft = buildFixturePolicy(rootDir, {
    sourceAuthorities: [authority(['server/unknown-app-data.js'], { tables: ['app_data'] })],
  });
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.writeSites[0].status, 'FAIL');
  assert.deepEqual(report.writeSites[0].collections, ['future_collection', 'users']);
  assert.ok(report.findings.some(finding => (
    finding.code === 'FUTURE_WRITE_COLLECTION_UNCLASSIFIED'
    && finding.collections.includes('future_collection')
  )));
});

test('prepared app_data writes resolve only the bind slot for name', t => {
  const rootDir = fixtureRoot(t, {
    'server/parameter-slots.js': `
      function unsafe(db, unknownName) {
        db.prepare('UPDATE app_data SET json = ? WHERE name = ?').run('users', unknownName);
      }
      function safe(db) {
        db.prepare('UPDATE app_data SET json = ? WHERE name = ?').run('not-a-collection', 'users');
      }
    `,
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/parameter-slots.js'));
    const unsafe = sites.find(site => site.function === 'unsafe');
    const safe = sites.find(site => site.function === 'safe');
    assert.ok(unsafe);
    assert.ok(safe);
    assert.deepEqual(unsafe.collections, []);
    assert.equal(unsafe.dynamicCollections, true);
    assert.deepEqual(safe.collections, ['users']);
    assert.equal(safe.dynamicCollections, false);

  const draft = buildFixturePolicy(rootDir, {
    sourceAuthorities: [authority(['server/parameter-slots.js'], { tables: ['app_data'] })],
  });
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(report.status, 'FAIL');
  assert.ok(report.findings.some(finding => (
    finding.code === 'FUTURE_WRITE_DYNAMIC_COLLECTION_UNKNOWN'
    && finding.siteFingerprint === unsafe.fingerprint
  )));
});

test('static SQL tables are an exact authority allowlist', t => {
  const rootDir = fixtureRoot(t, {
    'server/rogue.js': "function execute(db) { db.prepare('INSERT INTO rogue_table (id) VALUES (?)').run('x'); }\n",
  });
  const draft = buildFixturePolicy(rootDir, {
    sourceAuthorities: [authority(['server/rogue.js'], { tables: ['app_data'] })],
  });
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(report.status, 'FAIL');
  assert.ok(report.findings.some(finding => (
    finding.code === 'FUTURE_WRITE_SQL_TABLE_UNCLASSIFIED'
    && finding.tables.includes('rogue_table')
  )));
});

test('stale authority selectors fail even while the authority remains otherwise used', t => {
  const rootDir = fixtureRoot(t, {
    'server/sites.js': "function write(writeData) { writeData('equipment', []); writeData('users', []); }\n",
  });
  const sites = scanFile(rootDir, path.join(rootDir, 'server/sites.js'));
  const draft = buildFixturePolicy(rootDir, {
    sourceAuthorities: [authority(['server/sites.js'], {
      nonContributingSiteFingerprints: [sites[0].fingerprint],
    })],
  });
  assert.equal(buildFutureWriteAudit({ rootDir, policy: draft }).status, 'PASS');
  draft.sourceAuthorities[0].nonContributingSiteFingerprints = ['f'.repeat(64)];
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_SOURCE_SELECTOR_STALE'));
});

test('no-create reasons and active persistence paths are mutually exclusive', () => {
  const mutated = structuredClone(policy);
  mutated.collectionPolicies.equipment.noCreateReason = 'Stale assertion.';
  const report = buildFutureWriteAudit({ rootDir: ROOT, policy: mutated });
  assert.equal(report.status, 'FAIL');
  assert.ok(report.findings.some(finding => (
    finding.code === 'FUTURE_WRITE_COLLECTION_MATRIX_INCOMPLETE'
    && finding.collection === 'equipment'
  )));
});

test('overlapping authorities cannot classify a write site', t => {
  const rootDir = fixtureRoot(t, {
    'server/overlap.js': "function write(writeData) { writeData('equipment', []); }\n",
  });
  const first = authority(['server/overlap.js']);
  const second = { ...authority(['server/overlap.js']), id: 'second-authority' };
  const draft = buildFixturePolicy(rootDir, { sourceAuthorities: [first, second] });
  const report = buildFutureWriteAudit({ rootDir, policy: draft });
  assert.equal(report.status, 'FAIL');
  assert.ok(report.findings.some(finding => finding.code === 'FUTURE_WRITE_SITE_AUTHORITY_UNKNOWN'));
});
