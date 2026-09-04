#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  buildExpectedAuthoritySnapshot,
  calculateAuthorityFingerprint,
  calculateBootstrapChecksum,
  getAuthorityRowCounts,
  getSchemaFingerprint,
  planPlatformIdentityBootstrap,
} = require('../lib/platform-identity-bootstrap-validation');
const {
  COMPANY_ID,
  HEAD_OFFICE_ID,
  OWNER_MEMBERSHIP_ID,
  OWNER_PRINCIPAL_ID,
  buildCanonicalIdentityBootstrapConfig,
  buildIdentityBootstrapExecutionBundle,
  validateIdentityBootstrapExecutionBundle,
} = require('../lib/identity-bootstrap-execution-bundle');
const {
  buildUserInventory,
  databaseContentFingerprint,
  sqliteFileSet,
  sqliteFileSetFingerprint,
  sqliteObservedFileSetFingerprint,
} = require('../lib/production-scope-remediation-runner');
const {
  IDENTITY_ONLY_EXECUTION_SCOPE,
  collectionFingerprint,
  databaseIdentity,
  planProductionScopeRemediation,
  stableJson,
} = require('../lib/production-scope-remediation');

const PROTECTED_PRINCIPAL_IDS = Object.freeze([
  OWNER_PRINCIPAL_ID,
  '1776673416137',
  '1787547467703',
  'DEMO-USER-CARRIER',
  'production-smoke-admin',
]);
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const args = {};
  const accepted = new Set([
    '--db',
    '--approved-at',
    '--capture-deployed-sha',
    '--capture-deployment-id',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help' || name === '-h') return { help: true };
    if (!accepted.has(name)) fail('ARGUMENT_INVALID', `Unknown argument: ${name}`);
    const value = argv[++index];
    if (!value) fail('ARGUMENT_INVALID', `Missing value for ${name}.`);
    args[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node server/scripts/simulate-skytech-identity-bootstrap-read-only.js \\',
    '    --db <retained SQLite snapshot> \\',
    '    --approved-at <review timestamp> \\',
    '    [--capture-deployed-sha <historical 40-hex SHA>] \\',
    '    [--capture-deployment-id <historical UUID>]',
    '',
    'This command opens the supplied database read-only with query_only enabled.',
    'It has no apply, backup, deployment, environment, or output-file write mode.',
    'All source values are classified as historical simulation evidence only.',
  ].join('\n');
}

function exactFileProjection(fileSet) {
  return Object.fromEntries(['database', 'wal', 'shm'].map(key => {
    const item = fileSet[key];
    return [key, item ? {
      name: item.name,
      sizeBytes: item.sizeBytes,
      sha256: item.sha256,
    } : null];
  }));
}

function createEphemeralMirror(sourceDbPath, sourceFileSet) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skytech-identity-readonly-'));
  const dbPath = path.join(directory, 'snapshot.sqlite');
  try {
    fs.copyFileSync(sourceDbPath, dbPath);
    if (sourceFileSet.wal) fs.copyFileSync(`${sourceDbPath}-wal`, `${dbPath}-wal`);
    return { directory, dbPath };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function removeEphemeralMirror(mirror) {
  const expectedPrefix = `${path.join(os.tmpdir(), 'skytech-identity-readonly-')}`;
  if (!mirror?.directory || !mirror.directory.startsWith(expectedPrefix)) {
    fail('EPHEMERAL_MIRROR_PATH_INVALID', 'Refusing to remove an unexpected simulation path.');
  }
  fs.rmSync(mirror.directory, { recursive: true, force: true });
}

function parseUsers(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail('USERS_JSON_INVALID', 'app_data.users is not valid JSON.');
  }
  if (!Array.isArray(value)) fail('USERS_NOT_ARRAY', 'app_data.users must be an array.');
  return value;
}

function protectedPrincipalFingerprints(users) {
  return Object.fromEntries(PROTECTED_PRINCIPAL_IDS.map(principalId => {
    const matches = users.filter(user => String(user?.id || '').trim() === principalId);
    if (matches.length !== 1) {
      fail(
        'PROTECTED_PRINCIPAL_CARDINALITY_INVALID',
        `Expected exactly one preserved user record for ${principalId}.`,
      );
    }
    return [principalId, sha256(stableJson(matches[0]))];
  }));
}

function readAppDataEvidence(db) {
  const rows = db.prepare('SELECT * FROM app_data ORDER BY name').all();
  const usersRow = rows.find(row => row.name === 'users');
  if (!usersRow) fail('USERS_COLLECTION_MISSING', 'app_data.users is required.');
  const users = parseUsers(usersRow.json);
  return {
    rowCount: rows.length,
    tableFingerprint: sha256(stableJson(rows)),
    usersRawSha256: sha256(usersRow.json),
    users,
    protectedPrincipalRecordSha256: protectedPrincipalFingerprints(users),
  };
}

function deterministicBootstrapIdGenerator(seed) {
  let ordinal = 0;
  return prefix => {
    ordinal += 1;
    const hex = sha256(`${seed}:${ordinal}:${prefix}`);
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    return { ordinal, prefix, id: `${prefix}-${uuid}` };
  };
}

function identityCountExpectations(identityPlan) {
  return Object.fromEntries(Object.keys(identityPlan.beforeCounts).map(table => [
    table,
    [...new Set([
      Number(identityPlan.beforeCounts[table]),
      Number(identityPlan.afterCounts[table]),
    ])],
  ]));
}

function buildHistoricalGuardedPlan({
  db,
  config,
  identityPlan,
  users,
  beforeFileSet,
  approvedAt,
}) {
  const historicalConfig = structuredClone(config);
  historicalConfig.approval.backupReference = 'HISTORICAL_SIMULATION_ONLY';
  return {
    productionExecutionAuthorized: false,
    executionScope: IDENTITY_ONLY_EXECUTION_SCOPE,
    manifestVersion: 2,
    planVersion: 1,
    planId: 'skytech-identity-bootstrap-2026-09-01-v1',
    sourceDbPath: '/data/app.sqlite',
    expected: {
      dbIdentity: databaseIdentity(db),
      identityCounts: identityCountExpectations(identityPlan),
      collectionCounts: { users: users.length },
      collectionFingerprints: { users: [collectionFingerprint(users)] },
    },
    authority: {
      status: 'APPROVED',
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
      identityBootstrap: historicalConfig,
    },
    actorMappings: [
      {
        userId: OWNER_PRINCIPAL_ID,
        action: 'CREATE_MEMBERSHIP',
        membershipId: OWNER_MEMBERSHIP_ID,
        companyId: COMPANY_ID,
        tenantId: COMPANY_ID,
      },
      ...PROTECTED_PRINCIPAL_IDS.slice(1).map(userId => ({
        userId,
        action: 'NO_MEMBERSHIP',
        candidateForProductionMembership: false,
      })),
    ],
    recordMappings: [],
    relationMappings: [],
    backup: {
      verified: true,
      reference: 'HISTORICAL_SIMULATION_ONLY',
      sourceDbIdentity: sha256(stableJson(databaseIdentity(db))),
      timestamp: approvedAt,
      sizeBytes: beforeFileSet.database.sizeBytes,
      sha256: beforeFileSet.database.sha256,
    },
    canonicalCompanyIdStrategy: {
      status: 'APPROVED',
      format: 'cmp_<base32(sha256(canonicalIdentityKey))>',
      encoding: 'RFC4648_BASE32_UPPERCASE_NO_PADDING',
      identity: { jurisdiction: 'RU', registry: 'INN', value: '1660217548' },
      canonicalIdentityKey: 'rentcore:company:v1|jurisdiction=RU|registry=INN|value=1660217548',
      sha256Hex: 'f9026198f378c197e6a565035b0299cac846c58ae97e6fa6209c2c3ca4e6c419',
      base32Digest: '7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ',
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
    },
  };
}

function readActiveCatalogVersion(db) {
  const rows = db.prepare(`
    SELECT version
    FROM capability_catalog_versions
    WHERE status = 'active'
    ORDER BY version
  `).all();
  if (rows.length !== 1 || !Number.isSafeInteger(Number(rows[0].version))) {
    fail('ACTIVE_CAPABILITY_CATALOG_INVALID', 'Exactly one active capability catalog is required.');
  }
  return Number(rows[0].version);
}

function validateHistoricalMetadata(args) {
  if (args.captureDeployedSha && !SHA40_PATTERN.test(args.captureDeployedSha)) {
    fail('CAPTURE_DEPLOYED_SHA_INVALID', 'capture-deployed-sha must be exact lowercase 40-hex.');
  }
  if (args.captureDeploymentId && !UUID_PATTERN.test(args.captureDeploymentId)) {
    fail('CAPTURE_DEPLOYMENT_ID_INVALID', 'capture-deployment-id must be a UUID.');
  }
}

function validateSimulationArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    fail('ARGUMENT_INVALID', 'Simulation arguments must be an object.');
  }
  const accepted = new Set([
    'db',
    'approvedAt',
    'captureDeployedSha',
    'captureDeploymentId',
  ]);
  const unrecognized = Object.keys(args).filter(key => !accepted.has(key));
  if (unrecognized.length > 0) {
    fail('ARGUMENT_INVALID', `Unknown simulation argument: ${unrecognized.sort().join(', ')}`);
  }
}

function simulate(args) {
  validateSimulationArguments(args);
  if (!args.db) fail('DATABASE_PATH_REQUIRED', '--db is required.');
  if (!args.approvedAt) fail('APPROVED_AT_REQUIRED', '--approved-at is required.');
  validateHistoricalMetadata(args);

  const sourceDbPath = path.resolve(args.db);
  const beforeFileSet = sqliteFileSet(sourceDbPath);
  if (!beforeFileSet.database) fail('DATABASE_FILE_MISSING', 'The supplied SQLite file does not exist.');
  const beforeFileProjection = exactFileProjection(beforeFileSet);
  const durableFileSetFingerprint = sqliteFileSetFingerprint(beforeFileSet);
  const observedFileSetFingerprint = sqliteObservedFileSetFingerprint(beforeFileSet);
  const sourceSnapshotSha256 = sha256(stableJson({
    durableFileSetFingerprint,
    observedFileSetFingerprint,
    files: beforeFileProjection,
  }));

  const mirror = createEphemeralMirror(sourceDbPath, beforeFileSet);
  let db;
  let result;
  try {
    db = new Database(mirror.dbPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    if (db.pragma('query_only', { simple: true }) !== 1) {
      fail('SQLITE_QUERY_ONLY_NOT_ENABLED', 'SQLite query_only could not be enabled.');
    }
    db.pragma('foreign_keys = ON');
    if (db.pragma('foreign_keys', { simple: true }) !== 1) {
      fail('SQLITE_FOREIGN_KEYS_NOT_ENABLED', 'SQLite foreign-key enforcement could not be enabled.');
    }
    const totalChangesBefore = Number(db.prepare('SELECT total_changes() AS count').get().count);
    const schemaFingerprint = getSchemaFingerprint(db);
    const checksumInput = buildCanonicalIdentityBootstrapConfig({
      approvedAt: args.approvedAt,
      schemaFingerprint,
      backupReference: 'UNRESOLVED_FRESH_PRODUCTION_BACKUP',
    });
    const authorityConfigChecksum = calculateBootstrapChecksum(db, checksumInput);
    const config = buildCanonicalIdentityBootstrapConfig({
      approvedAt: args.approvedAt,
      schemaFingerprint,
      backupReference: 'UNRESOLVED_FRESH_PRODUCTION_BACKUP',
      configChecksum: authorityConfigChecksum,
    });
    const identityPlan = planPlatformIdentityBootstrap(db, config);
    if (!identityPlan.ok || identityPlan.writes !== 0) {
      fail('IDENTITY_PLAN_BLOCKED', `Read-only identity plan failed: ${stableJson(identityPlan.blockers)}`);
    }

    const databaseFingerprint = databaseContentFingerprint(db);
    const appData = readAppDataEvidence(db);
    const catalogVersion = readActiveCatalogVersion(db);
    const expectedAuthoritySnapshot = buildExpectedAuthoritySnapshot(
      identityPlan.normalized,
      catalogVersion,
    );
    const expectedAuthorityFingerprint = calculateAuthorityFingerprint(
      expectedAuthoritySnapshot,
    );
    const guardedPlan = buildHistoricalGuardedPlan({
      db,
      config,
      identityPlan,
      users: appData.users,
      beforeFileSet,
      approvedAt: args.approvedAt,
    });
    const guardedPreview = planProductionScopeRemediation({ db, plan: guardedPlan });
    if (!guardedPreview.readyToApply || guardedPreview.writes !== 0) {
      fail(
        'GUARDED_IDENTITY_ONLY_PLAN_BLOCKED',
        `Guarded read-only plan failed: ${stableJson(guardedPreview.blockers)}`,
      );
    }
    const userInventory = buildUserInventory(appData.users, guardedPlan);
    if (userInventory.blockers.length > 0) {
      fail(
        'USER_INVENTORY_DISPOSITION_INVALID',
        `Historical user inventory is not fully dispositioned: ${stableJson(userInventory.blockers)}`,
      );
    }
    const bundle = buildIdentityBootstrapExecutionBundle({
      identityPlan,
      sourceBindings: {
        captureDeployedSha: args.captureDeployedSha || null,
        captureDeploymentId: args.captureDeploymentId || null,
        sourceSnapshotSha256,
        stateFingerprint: guardedPreview.stateFingerprint,
        appDataFingerprint: guardedPreview.observed.appDataFingerprint,
        userInventoryFingerprint: userInventory.fingerprint,
        databaseContentFingerprint: databaseFingerprint,
        durableFileSetFingerprint,
        observedFileSetFingerprint,
      },
    });
    const validation = validateIdentityBootstrapExecutionBundle(bundle);
    const nextHistoricalId = deterministicBootstrapIdGenerator(guardedPreview.planChecksum);
    const historicalProjectedRuntimeIds = [
      nextHistoricalId('authorization-audit'),
      nextHistoricalId('authorization-audit'),
      nextHistoricalId('authorization-audit'),
      nextHistoricalId('authorization-audit'),
      nextHistoricalId('identity-bootstrap'),
    ];
    const quickCheck = db.pragma('quick_check').map(row => Object.values(row)[0]);
    const foreignKeyFailures = db.pragma('foreign_key_check');
    const totalChangesAfter = Number(db.prepare('SELECT total_changes() AS count').get().count);
    if (totalChangesAfter !== totalChangesBefore) {
      fail('READ_ONLY_SIMULATION_REPORTED_WRITES', 'SQLite total_changes changed during simulation.');
    }
    result = {
      simulationVersion: 1,
      classification: 'HISTORICAL_SIMULATION_ONLY',
      productionExecutionAuthorized: false,
      executionCapability: 'NONE',
      writesPerformed: 0,
      sourcePathDisclosure: 'OMITTED_FROM_SEALED_EVIDENCE',
      historicalSource: {
        captureDeployedSha: args.captureDeployedSha || null,
        captureDeploymentId: args.captureDeploymentId || null,
        sourceSnapshotSha256,
        stateFingerprint: guardedPreview.stateFingerprint,
        appDataFingerprint: guardedPreview.observed.appDataFingerprint,
        userInventoryFingerprint: userInventory.fingerprint,
        databaseContentFingerprint: databaseFingerprint,
        durableFileSetFingerprint,
        observedFileSetFingerprint,
        sqliteFiles: beforeFileProjection,
      },
      readOnlyProof: {
        sourceDatabaseOpenedBySqlite: false,
        simulationDatabaseSource: 'EPHEMERAL_LOCAL_MIRROR',
        sqliteOpenMode: 'readonly',
        sqliteQueryOnly: true,
        sqliteForeignKeys: true,
        totalChangesBefore,
        totalChangesAfter,
        totalChangesDelta: totalChangesAfter - totalChangesBefore,
        quickCheck,
        foreignKeyFailureCount: foreignKeyFailures.length,
      },
      appDataNonWriteEvidence: {
        rowCount: appData.rowCount,
        tableFingerprint: appData.tableFingerprint,
        usersRawSha256: appData.usersRawSha256,
        userInventoryFingerprint: userInventory.fingerprint,
        userInventoryTotalCount: userInventory.rows.length,
        eligibleActiveUserCount: userInventory.eligibleActiveCount,
        protectedPrincipalRecordSha256: appData.protectedPrincipalRecordSha256,
      },
      identityPlan: {
        mode: identityPlan.mode,
        ok: identityPlan.ok,
        writes: identityPlan.writes,
        blockers: identityPlan.blockers,
        warnings: identityPlan.warnings,
        authorityConfigChecksum,
        schemaFingerprint,
        usersDirectoryFingerprint: identityPlan.usersDirectoryFingerprint,
        mappedPrincipalIds: identityPlan.mappedUserIds,
        intentionallyUnmappedPrincipalIds: identityPlan.intentionallyUnmappedUserIds,
        eligibleActivePrincipalIds: identityPlan.eligibleActiveUserIds,
        beforeCounts: identityPlan.beforeCounts,
        afterCounts: identityPlan.afterCounts,
        exactChanges: identityPlan.exactChanges,
        financialCounts: identityPlan.financialCounts,
      },
      deterministicExpectedPostAuthority: {
        capabilityCatalogVersion: catalogVersion,
        authoritySnapshotFingerprint: expectedAuthorityFingerprint,
        authorityRowCounts: getAuthorityRowCounts(expectedAuthoritySnapshot),
      },
      guardedIdentityOnlySimulation: {
        classification: 'HISTORICAL_SIMULATION_ONLY',
        productionExecutionAuthorized: guardedPlan.productionExecutionAuthorized,
        executionScope: guardedPlan.executionScope,
        preparedGuardedPlanSha256: sha256(stableJson(guardedPlan)),
        executionPlanChecksum: guardedPreview.planChecksum,
        stateFingerprint: guardedPreview.stateFingerprint,
        readyToApplyOnHistoricalSnapshotOnly: guardedPreview.readyToApply,
        writes: guardedPreview.writes,
        blockers: guardedPreview.blockers,
        targetCollections: guardedPreview.observed.targetCollections,
        appDataFingerprint: guardedPreview.observed.appDataFingerprint,
        plannedDiff: guardedPreview.plannedDiff,
        expectedPostState: guardedPreview.expectedPostState,
        historicalProjectedRuntimeIds,
        executionTimeRuntimeIdsStatus: 'UNRESOLVED_EXECUTION_TIME_BINDING',
      },
      bundleValidation: validation,
      bundle,
      unresolvedExecutionTimeBindings: bundle.bindingCompleteness.unresolvedKeys,
    };
  } finally {
    if (db?.open) db.close();
    removeEphemeralMirror(mirror);
  }

  const afterFileSet = sqliteFileSet(sourceDbPath);
  const afterFileProjection = exactFileProjection(afterFileSet);
  const beforeObserved = sqliteObservedFileSetFingerprint(beforeFileSet);
  const afterObserved = sqliteObservedFileSetFingerprint(afterFileSet);
  if (stableJson(beforeFileProjection) !== stableJson(afterFileProjection)) {
    fail('SQLITE_FILES_CHANGED_DURING_SIMULATION', 'DB/WAL/SHM changed during read-only simulation.');
  }
  result.readOnlyProof.sqliteFilesBefore = beforeFileProjection;
  result.readOnlyProof.sqliteFilesAfter = afterFileProjection;
  result.readOnlyProof.sqliteFilesByteIdentical = true;
  result.readOnlyProof.observedFileSetFingerprintBefore = beforeObserved;
  result.readOnlyProof.observedFileSetFingerprintAfter = afterObserved;
  result.readOnlyProof.ephemeralMirrorRemoved = !fs.existsSync(mirror.directory);
  if (!result.readOnlyProof.ephemeralMirrorRemoved) {
    fail('EPHEMERAL_MIRROR_NOT_REMOVED', 'The local simulation mirror was not removed.');
  }
  return result;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(simulate(args), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || 'IDENTITY_SIMULATION_FAILED',
      message: error.message,
    })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { simulate };
