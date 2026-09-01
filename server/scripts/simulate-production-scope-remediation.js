#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  applyProductionScopeRemediation,
  collectionFingerprint,
  identityCounts,
  planProductionScopeRemediation,
  recordContentFingerprint,
  recordFingerprint,
  stableJson,
} = require('../lib/production-scope-remediation');
const {
  buildExecutionPlanFromManifest,
  buildProductionScopeManifest,
} = require('../lib/production-scope-remediation-manifest');
const {
  buildProductionScopeExecutionBundle,
} = require('../lib/production-scope-execution-plan-bundle');
const {
  sqliteFileSetFingerprint,
  sqliteObservedFileSetFingerprint,
} = require('../lib/production-scope-remediation-runner');
const {
  verifyEvidenceSourceBindingContract,
} = require('../lib/production-scope-evidence-builder');
const {
  buildUsersDirectorySnapshot,
  calculateBootstrapChecksum,
  getSchemaFingerprint,
} = require('../lib/platform-identity-bootstrap-validation');
const { deriveCanonicalMembershipId } = require('../lib/canonical-authority-id');
const {
  PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
  PRODUCTION_SMOKE_READER_ROLE,
  PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
  PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
  getProjectedSmokeIdentityUsers,
  planProductionSmokeIdentityTransition,
} = require('../lib/production-smoke-identity');
const { createTrustedActorScopeResolver } = require('../lib/trusted-actor-scope');
const {
  COLLECTION_SCOPE_REGISTRY,
  COLLECTION_SHAPE,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
} = require('../lib/app-data-scope-registry');

const SQLITE_FILES = ['app.sqlite', 'app.sqlite-wal', 'app.sqlite-shm'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help' || name === '-h') return { help: true };
    if (![
      '--capture-dir',
      '--evidence-dir',
      '--identity-plan',
      '--identity-plan-sha256',
      '--artifact-index-sha256',
      '--manifest-output',
      '--simulation-output',
      '--execution-plan-output',
    ].includes(name)) {
      throw Object.assign(new Error(`Unknown argument: ${name}`), { code: 'ARGUMENT_INVALID' });
    }
    const value = argv[++index];
    if (!value) throw Object.assign(new Error(`Missing value for ${name}.`), { code: 'ARGUMENT_INVALID' });
    args[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node server/scripts/simulate-production-scope-remediation.js \\',
    '    --capture-dir <directory containing app.sqlite, WAL, SHM> \\',
    '    --evidence-dir <fresh evidence analysis directory> \\',
    '    --identity-plan <reviewed remediation plan JSON> \\',
    '    --identity-plan-sha256 <externally reviewed plan SHA-256> \\',
    '    --artifact-index-sha256 <externally reviewed evidence-index SHA-256> \\',
    '    [--manifest-output <new JSON path>] \\',
    '    [--simulation-output <new JSON path>] \\',
    '    [--execution-plan-output <new review-only bundle JSON path>]',
    '',
    'The capture is never opened. Two disposable copies are created and removed.',
    'The command has no production apply mode and refuses to overwrite artifacts.',
  ].join('\n');
}

function readRegularFileBytes(filePath, codePrefix, message) {
  const resolved = path.resolve(filePath);
  let fd;
  try {
    fd = fs.openSync(
      resolved,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('not a regular file');
    return { bytes: fs.readFileSync(fd), resolved, stat };
  } catch {
    throw Object.assign(new Error(message), { code: `${codePrefix}_FILE_INVALID` });
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function parseJsonBytes(bytes, codePrefix, message) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw Object.assign(new Error(message), { code: `${codePrefix}_JSON_INVALID` });
  }
}

function readHashBoundJson(filePath, expectedSha256, codePrefix = 'HASH_BOUND_JSON') {
  const expected = String(expectedSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw Object.assign(new Error('An externally reviewed JSON SHA-256 is required.'), {
      code: `${codePrefix}_APPROVAL_REQUIRED`,
    });
  }
  const { bytes } = readRegularFileBytes(
    filePath,
    codePrefix,
    'The hash-bound JSON input must be a regular file.',
  );
  if (sha256(bytes) !== expected) {
    throw Object.assign(new Error('The hash-bound JSON input differs from its approved SHA-256.'), {
      code: `${codePrefix}_HASH_MISMATCH`,
    });
  }
  return {
    value: parseJsonBytes(bytes, codePrefix, 'The hash-bound JSON input is invalid JSON.'),
    sha256: expected,
  };
}

function exactFileState(directory) {
  return SQLITE_FILES.map(name => {
    const filePath = path.join(directory, name);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw Object.assign(new Error(`Capture member is not a regular file: ${name}.`), {
        code: 'CAPTURE_FILE_INVALID',
      });
    }
    return { name, size: stat.size, sha256: fileSha256(filePath) };
  });
}

function runnerFileSet(rows) {
  const byName = new Map((Array.isArray(rows) ? rows : []).map(row => [row.name, row]));
  const entry = name => {
    const row = byName.get(name);
    return row ? { name, sizeBytes: row.size, sha256: row.sha256 } : null;
  };
  return {
    database: entry('app.sqlite'),
    wal: entry('app.sqlite-wal'),
    shm: entry('app.sqlite-shm'),
  };
}

function selectCaptureRound(capture, rawFileState) {
  const roundA = Array.isArray(capture?.roundA) ? capture.roundA : [];
  const roundB = Array.isArray(capture?.roundB) ? capture.roundB : [];
  const durableHashA = sqliteFileSetFingerprint(runnerFileSet(roundA));
  const durableHashB = sqliteFileSetFingerprint(runnerFileSet(roundB));
  const observedHashA = sqliteObservedFileSetFingerprint(runnerFileSet(roundA));
  const observedHashB = sqliteObservedFileSetFingerprint(runnerFileSet(roundB));
  const observedHashes = capture?.sourceObservedFileSetHashes || {};
  const shmMatches = observedHashA === observedHashB;
  const analysisRound = capture?.analysisRound;
  if (!['roundA', 'roundB'].includes(analysisRound)) {
    throw Object.assign(new Error('The evidence analysis round is invalid.'), {
      code: 'CAPTURE_ANALYSIS_ROUND_INVALID',
    });
  }
  if (
    durableHashA !== durableHashB
    || capture?.durableRoundsByteIdentical !== true
    || capture?.sourceFileSetHash !== durableHashA
  ) {
    throw Object.assign(new Error('The two capture rounds differ in durable DB/WAL state.'), {
      code: 'CAPTURE_DURABLE_ROUNDS_MISMATCH',
    });
  }
  if (
    observedHashes.roundA !== observedHashA
    || observedHashes.roundB !== observedHashB
    || capture?.sourceObservedFileSetHash !== observedHashes[analysisRound]
    || capture?.shmObservationByteIdentical !== shmMatches
  ) {
    throw Object.assign(new Error('The forensic capture file-set hashes are inconsistent.'), {
      code: 'CAPTURE_OBSERVED_FILE_SET_MISMATCH',
    });
  }
  const normalizedRaw = stableJson(rawFileState);
  const matchesA = normalizedRaw === stableJson(roundA);
  const matchesB = normalizedRaw === stableJson(roundB);
  if (!matchesA && !matchesB) {
    throw Object.assign(new Error('The capture file set differs from the fresh evidence.'), {
      code: 'CAPTURE_FILE_SET_MISMATCH',
    });
  }
  const selectedRound = matchesB ? 'roundB' : 'roundA';
  if (selectedRound !== analysisRound) {
    throw Object.assign(new Error('The supplied capture is not the reviewed analysis round.'), {
      code: 'CAPTURE_ANALYSIS_ROUND_MISMATCH',
    });
  }
  return {
    selectedRound,
    sourceFileSetHash: durableHashA,
    sourceObservedFileSetHash: observedHashes[analysisRound],
    sourceFileSet: analysisRound === 'roundB' ? roundB : roundA,
  };
}

function verifyEvidencePack(packRoot, expectedIndexSha256) {
  const expected = String(expectedIndexSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw Object.assign(new Error('An externally reviewed artifact-index SHA-256 is required.'), {
      code: 'EVIDENCE_INDEX_APPROVAL_REQUIRED',
    });
  }
  const indexPath = path.join(packRoot, 'artifact-index.json');
  const { bytes: indexBytes } = readRegularFileBytes(
    indexPath,
    'EVIDENCE_INDEX',
    'The evidence artifact index must be a regular file.',
  );
  if (sha256(indexBytes) !== expected) {
    throw Object.assign(new Error('The evidence artifact index differs from the approved hash.'), {
      code: 'EVIDENCE_INDEX_HASH_MISMATCH',
    });
  }
  const index = parseJsonBytes(
    indexBytes,
    'EVIDENCE_INDEX',
    'The evidence artifact index is invalid JSON.',
  );
  const artifacts = Array.isArray(index.artifacts) ? index.artifacts : [];
  if (index.indexVersion !== 2) {
    throw Object.assign(new Error('The evidence pack predates the sensitive-local artifact contract.'), {
      code: 'EVIDENCE_INDEX_VERSION_OBSOLETE',
    });
  }
  if (index.packFingerprint !== sha256(stableJson(artifacts))) {
    throw Object.assign(new Error('The evidence pack fingerprint is invalid.'), {
      code: 'EVIDENCE_PACK_FINGERPRINT_MISMATCH',
    });
  }
  const byPath = new Map();
  for (const artifact of artifacts) {
    const relativePath = String(artifact?.relativePath || '');
    const resolved = path.resolve(packRoot, relativePath);
    if (
      !relativePath
      || resolved === packRoot
      || !resolved.startsWith(`${packRoot}${path.sep}`)
      || byPath.has(relativePath)
    ) {
      throw Object.assign(new Error('The evidence index contains an unsafe or duplicate path.'), {
        code: 'EVIDENCE_ARTIFACT_PATH_INVALID',
      });
    }
    if (artifact.sensitive !== true) {
      throw Object.assign(new Error(`Evidence artifact is not marked as sensitive local material: ${relativePath}.`), {
        code: 'EVIDENCE_ARTIFACT_SENSITIVITY_INVALID',
      });
    }
    const { bytes, stat } = readRegularFileBytes(
      resolved,
      'EVIDENCE_ARTIFACT',
      `Evidence artifact is not a regular file: ${relativePath}.`,
    );
    if (stat.size !== artifact.size || sha256(bytes) !== artifact.sha256) {
      throw Object.assign(new Error(`Evidence artifact drift: ${relativePath}.`), {
        code: 'EVIDENCE_ARTIFACT_HASH_MISMATCH',
      });
    }
    byPath.set(relativePath, artifact);
  }
  return { index, indexSha256: expected, byPath };
}

function readIndexedJson(packRoot, evidencePack, relativePath) {
  const artifact = evidencePack?.byPath?.get(relativePath);
  if (!artifact) {
    throw Object.assign(new Error(`Required evidence artifact is absent: ${relativePath}.`), {
      code: 'EVIDENCE_ARTIFACT_REQUIRED',
    });
  }
  const resolvedRoot = path.resolve(packRoot);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw Object.assign(new Error('The evidence artifact path is unsafe.'), {
      code: 'EVIDENCE_ARTIFACT_PATH_INVALID',
    });
  }
  const { bytes, stat } = readRegularFileBytes(
    resolved,
    'EVIDENCE_ARTIFACT',
    `Evidence artifact is not a regular file: ${relativePath}.`,
  );
  if (stat.size !== artifact.size || sha256(bytes) !== artifact.sha256) {
    throw Object.assign(new Error(`Evidence artifact drift: ${relativePath}.`), {
      code: 'EVIDENCE_ARTIFACT_HASH_MISMATCH',
    });
  }
  return parseJsonBytes(
    bytes,
    'EVIDENCE_ARTIFACT',
    `Evidence artifact is invalid JSON: ${relativePath}.`,
  );
}

function buildApprovedReconciliation(scopeInventory, ownershipCandidates, companyId) {
  const inventoryByKey = new Map(scopeInventory.map(row => [
    `${row.collection}:${row.recordId}`,
    row,
  ]));
  const result = [];
  const keys = new Set();
  function add(row, approvalClass) {
    const key = `${row.collection}:${row.recordId}`;
    if (keys.has(key)) {
      throw Object.assign(new Error(`Duplicate approved reconciliation record: ${key}.`), {
        code: 'APPROVED_RECONCILIATION_DUPLICATE',
      });
    }
    keys.add(key);
    result.push({
      collection: row.collection,
      recordId: row.recordId,
      sourceRecordHash: row.canonicalRecordHash,
      approvalClass,
    });
  }
  for (const candidate of ownershipCandidates) {
    const key = `${candidate.collection}:${candidate.recordId}`;
    const inventory = inventoryByKey.get(key);
    if (
      candidate.status !== 'READY_CANDIDATE'
      || candidate.canonicalRecordHash !== inventory?.canonicalRecordHash
      || candidate.proposedCompanyId !== companyId
      || candidate.proposedTenantId !== companyId
      || inventory?.disposition !== 'TENANT_OWNERSHIP_CANDIDATE'
    ) {
      throw Object.assign(new Error(`Ownership reconciliation drift: ${key}.`), {
        code: 'OWNERSHIP_RECONCILIATION_DRIFT',
      });
    }
    add(candidate, 'BASELINE_OWNERSHIP');
  }
  const mixedCatalogCollections = new Set(PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS);
  for (const row of scopeInventory) {
    if (mixedCatalogCollections.has(row.collection)) {
      const isPlatformDefault = row.disposition === 'PLATFORM_DEFAULT_REFERENCE'
        && row.currentScopeState === 'UNSCOPED';
      const isExactTenantRow = [
        'TENANT_OWNED_CATALOG_ENTRY',
        'TENANT_CATALOG_OVERRIDE',
      ].includes(row.disposition)
        && row.currentScopeState === 'FULLY_SCOPED'
        && row.currentCompanyId === row.currentTenantId;
      if ((!isPlatformDefault && !isExactTenantRow) || row.migrationRequired !== 'NO') {
        throw Object.assign(new Error(
          `Mixed catalog classification is not preserve-only: ${row.collection}:${row.recordId}.`,
        ), {
          code: 'MIXED_CATALOG_CLASSIFICATION_INVALID',
        });
      }
      // Platform defaults, tenant standalone rows, and explicit overrides are
      // byte-preserved. They never enter the approved scope-write reconciliation.
      continue;
    }
    if (row.disposition === 'TENANT_OWNERSHIP_CANDIDATE') {
      const key = `${row.collection}:${row.recordId}`;
      if (!keys.has(key)) {
        throw Object.assign(new Error(`Ownership candidate is absent from approved baseline: ${key}.`), {
          code: 'OWNERSHIP_CANDIDATE_NOT_APPROVED',
        });
      }
    } else if (row.disposition === 'AUDIT_A_ENTITY_DERIVED') {
      add(row, 'AUDIT_ENTITY_DERIVED');
    }
  }
  return result.sort((left, right) => (
    left.collection.localeCompare(right.collection) || left.recordId.localeCompare(right.recordId)
  ));
}

function copyCapture(source, destination) {
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const name of SQLITE_FILES) {
    fs.copyFileSync(path.join(source, name), path.join(destination, name), fs.constants.COPYFILE_EXCL);
    fs.chmodSync(path.join(destination, name), 0o600);
  }
  return path.join(destination, 'app.sqlite');
}

function exactEvidenceUserDispositions(users, evidenceRows) {
  const evidenceById = new Map();
  for (const row of Array.isArray(evidenceRows) ? evidenceRows : []) {
    const principalId = String(row?.principalId || '').trim();
    if (!principalId || evidenceById.has(principalId)) {
      throw Object.assign(new Error('The user-disposition evidence has an invalid or duplicate principal.'), {
        code: 'USER_DISPOSITION_EVIDENCE_INVALID',
      });
    }
    evidenceById.set(principalId, row);
  }
  for (const user of users) {
    const principalId = String(user?.id || '').trim();
    const disposition = evidenceById.get(principalId);
    if (!disposition || disposition.canonicalRecordHash !== recordFingerprint(user)) {
      throw Object.assign(new Error(`The user disposition does not hash-bind principal ${principalId}.`), {
        code: 'USER_DISPOSITION_EVIDENCE_DRIFT',
      });
    }
  }
  if (evidenceById.size !== users.length) {
    throw Object.assign(new Error('The user-disposition evidence does not exactly cover the source directory.'), {
      code: 'USER_DISPOSITION_EVIDENCE_COVERAGE_MISMATCH',
    });
  }
  const smokeSource = evidenceById.get(PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID);
  if (smokeSource?.classification !== 'SMOKE_ACCOUNT' || smokeSource?.membership !== 'NO') {
    throw Object.assign(new Error('The source smoke administrator is not classified for replacement.'), {
      code: 'SMOKE_SOURCE_DISPOSITION_INVALID',
    });
  }
  if (evidenceById.has(PRODUCTION_SMOKE_READER_PRINCIPAL_ID)) {
    throw Object.assign(new Error('The replacement smoke reader unexpectedly exists in source evidence.'), {
      code: 'SMOKE_REPLACEMENT_ALREADY_CLASSIFIED',
    });
  }
  return evidenceById;
}

function projectedUserDispositions({
  sourceUsers,
  projectedUsers,
  evidenceRows,
  companyId,
  branchId,
}) {
  const evidenceById = exactEvidenceUserDispositions(sourceUsers, evidenceRows);
  return projectedUsers.map(user => {
    const principalId = String(user?.id || '').trim();
    if (principalId === PRODUCTION_SMOKE_READER_PRINCIPAL_ID) {
      return {
        principalId,
        canonicalRecordHash: recordFingerprint(user),
        classification: 'TECHNICAL_AUDITOR_SMOKE_REPLACEMENT',
        membership: 'YES',
        companyId,
        tenantId: companyId,
        branchIds: [branchId],
        companyWideBranchAuthority: false,
        roleTemplateKey: PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
        roleTemplateVersion: 1,
        evidenceCode: 'APPROVED_PRODUCTION_SMOKE_LEAST_PRIVILEGE_REPLACEMENT',
      };
    }
    const evidence = evidenceById.get(principalId);
    if (!evidence) {
      throw Object.assign(new Error(`Projected principal lacks reviewed evidence: ${principalId}.`), {
        code: 'PROJECTED_USER_DISPOSITION_MISSING',
      });
    }
    return {
      principalId,
      canonicalRecordHash: recordFingerprint(user),
      classification: principalId === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID
        ? 'SMOKE_ACCOUNT_SOURCE_DEACTIVATED'
        : evidence.classification,
      membership: evidence.membership,
      companyId: evidence.companyId,
      tenantId: evidence.tenantId,
      branchIds: evidence.branchIds,
      companyWideBranchAuthority: evidence.companyWideBranchAuthority,
      roleTemplateKey: evidence.roleTemplateKey,
      roleTemplateVersion: evidence.roleTemplateVersion,
      evidenceCode: principalId === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID
        ? 'APPROVED_SOURCE_DEACTIVATION_AND_REPLACEMENT'
        : evidence.evidenceCode,
    };
  });
}

function identityBootstrapConfig(
  db,
  proposed,
  evidenceUserDispositions,
  generatedAt,
  sourceSnapshotHash,
  reviewedPlanFileSha256,
) {
  if (!proposed || typeof proposed !== 'object') {
    throw Object.assign(new Error('The reviewed identity plan has no proposedIdentityBootstrap.'), {
      code: 'IDENTITY_PLAN_MISSING',
    });
  }
  const usersRow = db.prepare("SELECT json FROM app_data WHERE name = 'users'").get();
  let sourceUsers;
  try {
    sourceUsers = JSON.parse(usersRow?.json);
  } catch {
    throw Object.assign(new Error('The production-copy user directory is invalid.'), {
      code: 'SMOKE_SOURCE_USERS_INVALID',
    });
  }
  if (!Array.isArray(sourceUsers)) {
    throw Object.assign(new Error('The production-copy user directory is not an array.'), {
      code: 'SMOKE_SOURCE_USERS_INVALID',
    });
  }
  const companyId = String(proposed.company?.id || '').trim();
  const headOffice = proposed.branches?.find(branch => branch?.isHeadOffice === true);
  const branchId = String(headOffice?.id || '').trim();
  if (!companyId || !branchId) {
    throw Object.assign(new Error('The reviewed identity plan lacks an exact company or head office.'), {
      code: 'SMOKE_TRANSITION_AUTHORITY_INVALID',
    });
  }
  const smokeMembershipId = deriveCanonicalMembershipId({
    companyId,
    principalId: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
  }).membershipId;
  const smokeIdentityTransition = {
    transitionVersion: 1,
    status: 'APPROVED',
    sourcePrincipalId: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
    expectedSourceRole: 'Администратор',
    replacement: {
      id: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
      name: 'Production Smoke Reader',
      email: 'production-smoke-reader@skytech.internal',
      role: PRODUCTION_SMOKE_READER_ROLE,
    },
    membership: {
      id: smokeMembershipId,
      companyId,
      branchId,
      roleTemplateKey: PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
      roleTemplateVersion: 1,
    },
  };
  const smokePreview = planProductionSmokeIdentityTransition({
    users: sourceUsers,
    config: smokeIdentityTransition,
    usersRawFingerprint: sha256(usersRow.json),
  });
  if (!smokePreview.readyToApply || smokePreview.alreadyApplied) {
    throw Object.assign(new Error('The source smoke administrator cannot be replaced from this pristine source.'), {
      code: 'SMOKE_IDENTITY_SOURCE_MISMATCH',
      blockers: smokePreview.blockers,
    });
  }
  const projectedUsers = getProjectedSmokeIdentityUsers(smokePreview);
  const userDispositions = projectedUserDispositions({
    sourceUsers,
    projectedUsers,
    evidenceRows: evidenceUserDispositions,
    companyId,
    branchId,
  });
  const roleTemplates = structuredClone(proposed.roleTemplates);
  if (roleTemplates.some(row => row.templateKey === PRODUCTION_SMOKE_READER_TEMPLATE_KEY)) {
    throw Object.assign(new Error('The reviewed plan already contains a conflicting smoke-reader template.'), {
      code: 'SMOKE_TEMPLATE_CONFLICT',
    });
  }
  roleTemplates.push({
    templateKey: PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
    templateVersion: 1,
    displayName: 'Production Smoke Reader',
    capabilities: [],
  });
  const memberships = structuredClone(proposed.memberships);
  if (memberships.some(row => (
    row.principalId === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID
    || row.principalId === PRODUCTION_SMOKE_READER_PRINCIPAL_ID
  ))) {
    throw Object.assign(new Error('The reviewed plan contains a conflicting smoke identity membership.'), {
      code: 'SMOKE_MEMBERSHIP_CONFLICT',
    });
  }
  memberships.push({
    id: smokeMembershipId,
    principalId: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
    status: 'active',
    roleTemplateKey: PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
    roleTemplateVersion: 1,
    companyWideBranchAuthority: false,
    branchIds: [branchId],
    capabilityAssignments: [],
  });
  const intentionallyUnmappedUserIds = userDispositions
    .filter(row => row.membership === 'NO')
    .map(row => row.principalId)
    .sort();
  const config = {
    configVersion: proposed.configVersion,
    company: structuredClone(proposed.company),
    branches: structuredClone(proposed.branches),
    roleTemplates,
    memberships,
    intentionallyUnmappedUserIds,
    approval: {
      approvedBy: proposed.memberships.find(row => row.roleTemplateKey === 'company-administrator')?.principalId,
      approvedAt: generatedAt,
      approvalReference: `disposable-production-copy-simulation:${sourceSnapshotHash.slice(0, 16)}`,
      backupReference: `verified-disposable-copy:${sourceSnapshotHash}`,
      schemaFingerprint: getSchemaFingerprint(db),
    },
  };
  config.approval.configChecksum = calculateBootstrapChecksum(db, config, {
    usersDirectorySnapshot: buildUsersDirectorySnapshot(projectedUsers),
  });
  return {
    identityBootstrap: config,
    projectedUsers,
    smokeIdentityTransition,
    smokePreview,
    sourceUsers,
    userDispositions,
    reviewedPlanFileSha256,
  };
}

function manifestIdentity({
  identityBootstrap,
  projectedUsers,
  smokeIdentityTransition,
  smokePreview,
  userDispositions,
  reviewedPlanFileSha256,
}) {
  return {
    bootstrapConfigHash: sha256(stableJson(identityBootstrap)),
    bootstrapConfig: structuredClone(identityBootstrap),
    userDispositionFingerprint: sha256(stableJson(userDispositions)),
    reviewedPlanFileSha256,
    company: structuredClone(identityBootstrap.company),
    branches: structuredClone(identityBootstrap.branches),
    roleTemplates: structuredClone(identityBootstrap.roleTemplates),
    memberships: structuredClone(identityBootstrap.memberships),
    intentionallyUnmappedUserIds: [...identityBootstrap.intentionallyUnmappedUserIds],
    smokeIdentity: {
      status: 'APPROVED',
      sourcePrincipalId: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
      replacementPrincipalId: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
      transition: structuredClone(smokeIdentityTransition),
      transitionConfigHash: sha256(stableJson(smokeIdentityTransition)),
      transitionChecksum: smokePreview.transitionChecksum,
      projectedUsersFingerprint: collectionFingerprint(projectedUsers),
      projectedUserCount: projectedUsers.length,
    },
    userDispositions: userDispositions.map(row => ({
      principalId: row.principalId,
      canonicalRecordHash: row.canonicalRecordHash,
      classification: row.classification,
      membership: row.membership,
      companyId: row.companyId,
      tenantId: row.tenantId,
      branchIds: row.branchIds,
      companyWideBranchAuthority: row.companyWideBranchAuthority,
      roleTemplateKey: row.roleTemplateKey,
      roleTemplateVersion: row.roleTemplateVersion,
      evidenceCode: row.evidenceCode,
    })),
  };
}

function appDataState(db) {
  const result = {};
  for (const row of db.prepare('SELECT name, json FROM app_data ORDER BY name').all()) {
    const value = JSON.parse(row.json);
    result[row.name] = {
      shape: Array.isArray(value) ? 'ARRAY' : typeof value,
      count: Array.isArray(value)
        ? value.length
        : (value && typeof value === 'object' ? Object.keys(value).length : 1),
      identityFingerprint: Array.isArray(value)
        ? sha256(stableJson(value.map((record, index) => String(record?.id || record?._id || index))))
        : sha256(stableJson(Object.keys(value || {}).sort())),
    };
  }
  return result;
}

function verifyManifestRecords(db, manifest) {
  const byCollection = new Map();
  for (const row of db.prepare('SELECT name, json FROM app_data').all()) {
    const value = JSON.parse(row.json);
    byCollection.set(row.name, value);
  }
  const violations = [];
  let preservedByteEquivalentCount = 0;
  let updatedScopeCount = 0;
  for (const expected of manifest.records) {
    const value = byCollection.get(expected.collection);
    const policy = COLLECTION_SCOPE_REGISTRY[expected.collection];
    if (value === undefined || !policy || expected.locator?.shape !== policy.shape) {
      violations.push({ code: 'POST_COLLECTION_OR_LOCATOR_INVALID', collection: expected.collection, recordId: expected.recordId });
      continue;
    }
    let matches = [];
    if (policy.shape === COLLECTION_SHAPE.ARRAY && Array.isArray(value)) {
      const index = Number(expected.locator.key);
      if (Number.isSafeInteger(index) && index >= 0 && index < value.length) {
        const candidate = value[index];
        const directId = String(candidate?.id || candidate?._id || '');
        if (
          (directId && directId === expected.recordId)
          || (!directId && recordFingerprint(candidate) === expected.sourceRecordHash)
        ) {
          matches = [candidate];
        }
      }
    } else if (policy.shape === COLLECTION_SHAPE.MAP && value && typeof value === 'object') {
      if (Object.prototype.hasOwnProperty.call(value, expected.locator.key)) {
        matches = [value[expected.locator.key]];
      }
    } else if (policy.shape === COLLECTION_SHAPE.SINGLETON) {
      if (expected.locator.key === 'singleton') {
        matches = [value];
      } else if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && value.__tenantScopedValues
        && typeof value.__tenantScopedValues === 'object'
        && Object.prototype.hasOwnProperty.call(value.__tenantScopedValues, expected.locator.key)
      ) {
        matches = [value.__tenantScopedValues[expected.locator.key]];
      }
    }
    if (matches.length !== 1) {
      violations.push({ code: 'POST_RECORD_NOT_EXACT', collection: expected.collection, recordId: expected.recordId });
      continue;
    }
    const actual = matches[0];
    if (recordContentFingerprint(actual) !== expected.canonicalContentHash) {
      violations.push({ code: 'POST_CONTENT_HASH_MISMATCH', collection: expected.collection, recordId: expected.recordId });
      continue;
    }
    if (expected.operation === 'UPDATE_SCOPE') {
      if (actual.companyId !== expected.newScope.companyId || actual.tenantId !== expected.newScope.tenantId) {
        violations.push({ code: 'POST_SCOPE_MISMATCH', collection: expected.collection, recordId: expected.recordId });
      } else {
        updatedScopeCount += 1;
      }
    } else if (recordFingerprint(actual) === expected.sourceRecordHash) {
      preservedByteEquivalentCount += 1;
    } else {
      violations.push({ code: 'PRESERVED_RECORD_CHANGED', collection: expected.collection, recordId: expected.recordId });
    }
  }
  return { violations, preservedByteEquivalentCount, updatedScopeCount };
}

function verifyActorScopes(db, plan) {
  const resolver = createTrustedActorScopeResolver({ db });
  let allowed = 0;
  let denied = 0;
  const violations = [];
  for (const mapping of plan.actorMappings) {
    if (mapping.action === 'CREATE_MEMBERSHIP') {
      try {
        const scope = resolver(mapping.userId);
        if (scope.companyId !== mapping.companyId || scope.tenantId !== mapping.tenantId) {
          violations.push({ code: 'ACTOR_SCOPE_MISMATCH', principalId: mapping.userId });
        } else {
          allowed += 1;
        }
      } catch {
        violations.push({ code: 'ACTOR_SCOPE_DENIED', principalId: mapping.userId });
      }
    } else {
      try {
        resolver(mapping.userId);
        violations.push({ code: 'UNMAPPED_ACTOR_AUTHORIZED', principalId: mapping.userId });
      } catch {
        denied += 1;
      }
    }
  }
  return { allowed, denied, violations };
}

function writeNewJson(filePath, value) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(resolved, 'wx', 0o600);
  let failure;
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } catch (error) {
    failure = error;
  } finally {
    try {
      fs.closeSync(fd);
    } catch (error) {
      if (!failure) failure = error;
    }
  }
  if (failure) {
    try { fs.unlinkSync(resolved); } catch {}
    throw failure;
  }
  return resolved;
}

function writeNewJsonSet(entries) {
  const requested = entries.filter(entry => entry.filePath).map(entry => ({
    ...entry,
    resolved: path.resolve(entry.filePath),
  }));
  if (new Set(requested.map(entry => entry.resolved)).size !== requested.length) {
    throw Object.assign(new Error('Artifact output paths must be distinct.'), {
      code: 'ARTIFACT_OUTPUT_PATH_DUPLICATE',
    });
  }
  for (const entry of requested) {
    if (fs.existsSync(entry.resolved)) {
      throw Object.assign(new Error(`Artifact output already exists: ${entry.resolved}.`), {
        code: 'ARTIFACT_OUTPUT_EXISTS',
      });
    }
  }
  const created = [];
  try {
    for (const entry of requested) created.push(writeNewJson(entry.resolved, entry.value));
  } catch (error) {
    for (const filePath of created.reverse()) {
      try { fs.unlinkSync(filePath); } catch {}
    }
    throw error;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (
    !args.captureDir
    || !args.evidenceDir
    || !args.identityPlan
    || !args.identityPlanSha256
    || !args.artifactIndexSha256
  ) {
    throw Object.assign(new Error(usage()), { code: 'ARGUMENT_REQUIRED' });
  }
  const captureDir = path.resolve(args.captureDir);
  const evidenceDir = path.resolve(args.evidenceDir);
  const packRoot = path.dirname(evidenceDir);
  if (path.basename(evidenceDir) !== 'analysis') {
    throw Object.assign(new Error('Evidence directory must be the indexed analysis directory.'), {
      code: 'EVIDENCE_DIRECTORY_INVALID',
    });
  }
  const evidencePack = verifyEvidencePack(packRoot, args.artifactIndexSha256);
  const rawBefore = exactFileState(captureDir);
  const summary = readIndexedJson(packRoot, evidencePack, 'analysis/summary.json');
  const evidenceSourceBinding = verifyEvidenceSourceBindingContract({
    sourceBindings: summary.sourceBindings,
    sourceBindingsFingerprint: summary.sourceBindingsFingerprint,
    platformDefaultTenantOverlaySemantics:
      summary.platformDefaultTenantOverlaySemantics,
  });
  const classificationInventory = readIndexedJson(
    packRoot,
    evidencePack,
    'analysis/scope-record-inventory.json',
  );
  const ownershipCandidates = readIndexedJson(
    packRoot,
    evidencePack,
    'analysis/ownership-candidates.json',
  );
  const dispositionEvidence = readIndexedJson(
    packRoot,
    evidencePack,
    'analysis/user-dispositions.json',
  );
  const evidenceUserDispositions = dispositionEvidence.rows;
  const reviewedPlanInput = readHashBoundJson(
    args.identityPlan,
    args.identityPlanSha256,
    'IDENTITY_PLAN',
  );
  const reviewedPlan = reviewedPlanInput.value;
  const expectedRoundA = summary.capture.roundA.map(row => ({
    name: row.name,
    size: row.size,
    sha256: row.sha256,
  }));
  const expectedRoundB = summary.capture.roundB.map(row => ({
    name: row.name,
    size: row.size,
    sha256: row.sha256,
  }));
  const selectedCapture = selectCaptureRound({
    ...summary.capture,
    roundA: expectedRoundA,
    roundB: expectedRoundB,
  }, rawBefore);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skytech-remediation-simulation-'));
  let classificationDb;
  let simulationDb;
  try {
    const classificationDir = path.join(workspace, 'classification');
    const simulationDir = path.join(workspace, 'simulation');
    const classificationDbPath = copyCapture(captureDir, classificationDir);
    const simulationDbPath = copyCapture(captureDir, simulationDir);
    if (
      stableJson(exactFileState(classificationDir)) !== stableJson(rawBefore)
      || stableJson(exactFileState(simulationDir)) !== stableJson(rawBefore)
    ) {
      throw Object.assign(new Error('A disposable SQLite copy differs from the approved capture.'), {
        code: 'CAPTURE_COPY_FILE_SET_MISMATCH',
      });
    }
    classificationDb = new Database(classificationDbPath, { readonly: true, fileMustExist: true });
    classificationDb.pragma('foreign_keys = ON');
    classificationDb.pragma('query_only = ON');
    const identitySetup = identityBootstrapConfig(
      classificationDb,
      reviewedPlan.proposedIdentityBootstrap,
      evidenceUserDispositions,
      summary.capture.evidenceGeneratedAt,
      summary.capture.sourceSnapshotHash,
      reviewedPlanInput.sha256,
    );
    const {
      identityBootstrap,
      projectedUsers,
      smokeIdentityTransition,
      sourceUsers,
      userDispositions,
      reviewedPlanFileSha256,
    } = identitySetup;
    const identity = manifestIdentity(identitySetup);
    const approvedReconciliation = buildApprovedReconciliation(
      classificationInventory,
      ownershipCandidates,
      summary.ownershipCandidates.canonicalCompanyId,
    );
    const artifact = relativePath => {
      const value = evidencePack.byPath.get(relativePath);
      if (!value) {
        throw Object.assign(new Error(`Required evidence artifact is absent: ${relativePath}.`), {
          code: 'EVIDENCE_ARTIFACT_REQUIRED',
        });
      }
      return value;
    };
    const evidence = {
      artifactIndexSha256: evidencePack.indexSha256,
      baselineContractSha256: summary.ownershipCandidates.baselineContractSha256,
      candidateKeySetSha256: summary.ownershipCandidates.candidateKeySetSha256,
      candidateAuthoritySha256: summary.ownershipCandidates.candidateAuthoritySha256,
      canonicalScopeSha256: summary.ownershipCandidates.canonicalScopeSha256,
      classificationAuthorityFingerprint: summary.classificationAuthorityFingerprint,
      packFingerprint: evidencePack.index.packFingerprint,
      summaryFileSha256: artifact('analysis/summary.json').sha256,
      classificationFileSha256: artifact('analysis/scope-record-inventory.json').sha256,
      classificationFingerprint: sha256(stableJson(classificationInventory)),
      userDispositionsFileSha256: artifact('analysis/user-dispositions.json').sha256,
      ownershipCandidatesFileSha256: artifact('analysis/ownership-candidates.json').sha256,
      approvedReconciliationFingerprint: sha256(stableJson(approvedReconciliation)),
      sourceBindingsFingerprint: evidenceSourceBinding.sourceBindingsFingerprint,
      platformDefaultTenantOverlaySemantics: structuredClone(
        evidenceSourceBinding.platformDefaultTenantOverlaySemantics,
      ),
    };
    const source = {
      captureDeployedSha: summary.capture.railway.captureDeployedSha,
      captureDeploymentId: summary.capture.railway.captureDeploymentId,
      railwayIdentity: {
        projectId: summary.capture.railway.projectId,
        environmentId: summary.capture.railway.environmentId,
        serviceId: summary.capture.railway.serviceId,
        volumeId: summary.capture.railway.volumeId,
        volumeName: summary.capture.railway.volumeName,
        volumeMountPath: summary.capture.railway.volumeMountPath,
      },
      deploymentIdentity: {
        serviceInstanceId: summary.capture.railway.serviceInstanceId,
        deploymentInstanceId: summary.capture.railway.deploymentInstanceId,
      },
      sourceSnapshotHash: summary.capture.sourceSnapshotHash,
      sourceFileSetHash: selectedCapture.sourceFileSetHash,
      sourceObservedFileSetHash: selectedCapture.sourceObservedFileSetHash,
      sourceFileSet: selectedCapture.sourceFileSet,
      databaseContentFingerprint: summary.integrity.databaseContentFingerprint,
      schemaFingerprint: summary.integrity.databaseIdentity.schemaFingerprint,
    };
    const companyId = summary.ownershipCandidates.canonicalCompanyId;
    const manifest = buildProductionScopeManifest({
      db: classificationDb,
      source,
      authority: { companyId, tenantId: companyId },
      classificationInventory,
      approvedReconciliation,
      evidence,
      identity,
    });
    classificationDb.close();
    classificationDb = undefined;
    if (manifest.status !== 'READY_FOR_DISPOSABLE_SIMULATION') {
      throw Object.assign(new Error('The exact scope manifest is blocked.'), {
        code: 'MANIFEST_BLOCKED',
        blockers: manifest.blockers,
      });
    }

    simulationDb = new Database(simulationDbPath, { fileMustExist: true });
    simulationDb.pragma('foreign_keys = ON');
    const beforeAppData = appDataState(simulationDb);
    const backup = {
      verified: true,
      reference: `verified-disposable-copy-${manifest.source.sourceSnapshotHash.slice(0, 16)}`,
      sourceDbIdentity: sha256(stableJson(manifest.source.databaseIdentity)),
      timestamp: summary.capture.evidenceGeneratedAt,
      sizeBytes: rawBefore.find(row => row.name === 'app.sqlite').size,
      sha256: rawBefore.find(row => row.name === 'app.sqlite').sha256,
    };
    const plan = buildExecutionPlanFromManifest({
      db: simulationDb,
      manifest,
      identityBootstrap,
      smokeIdentityTransition,
      userDispositions,
      reviewedPlanFileSha256,
      backup,
      canonicalCompanyIdStrategy: reviewedPlan.canonicalCompanyIdStrategy,
      sourceDbPath: reviewedPlan.sourceDbPath,
    });
    const executionPlanBundle = buildProductionScopeExecutionBundle({ plan, manifest });
    const reviewOnlyPreview = planProductionScopeRemediation({
      db: simulationDb,
      plan: executionPlanBundle.executionPlan,
    });
    const reviewOnlyNonBackupBlockers = reviewOnlyPreview.blockers.filter(row => (
      row.code !== 'RECOVERABLE_BACKUP_NOT_VERIFIED'
    ));
    if (
      reviewOnlyPreview.readyToApply
      || reviewOnlyNonBackupBlockers.length !== 0
      || !reviewOnlyPreview.blockers.some(row => row.code === 'RECOVERABLE_BACKUP_NOT_VERIFIED')
    ) {
      throw Object.assign(new Error('The review-only execution bundle is not a clean backup-gated base plan.'), {
        code: 'EXECUTION_BUNDLE_PREFLIGHT_INVALID',
        blockers: reviewOnlyPreview.blockers,
      });
    }
    const firstPreview = planProductionScopeRemediation({ db: simulationDb, plan });
    const firstPlannedScopeUpdates = firstPreview.plannedDiff.UPDATE.filter(row => (
      row?.operation === 'UPDATE_SCOPE'
    ));
    if (
      !firstPreview.readyToApply
      || firstPlannedScopeUpdates.length !== approvedReconciliation.length
      || manifest.summary.semanticScopeWriteCount !== approvedReconciliation.length
    ) {
      throw Object.assign(new Error('First-run exact diff differs from the hash-bound approved reconciliation.'), {
        code: 'FIRST_RUN_PLAN_MISMATCH',
        blockers: firstPreview.blockers,
      });
    }
    const firstRun = applyProductionScopeRemediation({
      db: simulationDb,
      plan,
      explicitApply: true,
      expectedPlanChecksum: firstPreview.planChecksum,
    });
    const afterFirstAppData = appDataState(simulationDb);
    const postRecords = verifyManifestRecords(simulationDb, manifest);
    const actorScopes = verifyActorScopes(simulationDb, plan);
    const appliedUsersRow = simulationDb.prepare("SELECT json FROM app_data WHERE name = 'users'").get();
    const appliedUsers = JSON.parse(appliedUsersRow.json);
    const appliedSmokePreview = planProductionSmokeIdentityTransition({
      users: appliedUsers,
      config: smokeIdentityTransition,
      usersRawFingerprint: sha256(appliedUsersRow.json),
    });
    const appliedSourceUser = appliedUsers.find(user => user?.id === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID);
    const appliedReaderUser = appliedUsers.find(user => user?.id === PRODUCTION_SMOKE_READER_PRINCIPAL_ID);
    const readerCapabilityCount = Number(simulationDb.prepare(`
      SELECT COUNT(*) AS count
      FROM role_template_capabilities
      WHERE companyId = ? AND templateKey = ? AND templateVersion = 1
    `).get(companyId, PRODUCTION_SMOKE_READER_TEMPLATE_KEY).count);
    const smokeIdentityViolations = [];
    if (!appliedSmokePreview.readyToApply || !appliedSmokePreview.alreadyApplied) {
      smokeIdentityViolations.push('SMOKE_TRANSITION_NOT_APPLIED_EXACTLY');
    }
    if (collectionFingerprint(appliedUsers) !== collectionFingerprint(projectedUsers)) {
      smokeIdentityViolations.push('SMOKE_PROJECTED_USERS_MISMATCH');
    }
    if (
      !appliedSourceUser
      || !appliedReaderUser
      || appliedSourceUser.password !== appliedReaderUser.password
    ) {
      smokeIdentityViolations.push('SMOKE_HASHED_LOGIN_VERIFIER_NOT_PRESERVED');
    }
    if (readerCapabilityCount !== 0) {
      smokeIdentityViolations.push('SMOKE_READER_CAPABILITIES_NOT_EMPTY');
    }
    const quickCheck = simulationDb.pragma('quick_check', { simple: true });
    const foreignKeyViolations = simulationDb.pragma('foreign_key_check');
    const secondPreview = planProductionScopeRemediation({ db: simulationDb, plan });
    const semanticSecondDiff = secondPreview.plannedDiff.CREATE.length
      + secondPreview.plannedDiff.UPDATE.length
      + secondPreview.plannedDiff.RELINK.length;
    const secondRun = applyProductionScopeRemediation({
      db: simulationDb,
      plan,
      explicitApply: true,
      expectedPlanChecksum: secondPreview.planChecksum,
    });
    const finalIdentityCounts = identityCounts(simulationDb);
    simulationDb.pragma('wal_checkpoint(TRUNCATE)');
    simulationDb.close();
    simulationDb = undefined;

    const visibilityDbPath = path.join(workspace, 'visibility', 'app.sqlite');
    fs.mkdirSync(path.dirname(visibilityDbPath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(simulationDbPath, visibilityDbPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(visibilityDbPath, 0o600);
    const visibilityChild = spawnSync(process.execPath, [
      path.join(__dirname, 'verify-production-scope-local-visibility.js'),
      '--db-path', visibilityDbPath,
      '--company-id', companyId,
    ], {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
      timeout: 45_000,
      env: process.env,
    });
    let tenantVisibility;
    try {
      tenantVisibility = JSON.parse(visibilityChild.stdout || '');
    } catch {
      tenantVisibility = null;
    }
    if (
      visibilityChild.status !== 0
      || tenantVisibility?.status !== 'PASS'
      || tenantVisibility?.productionWritePerformed !== false
      || tenantVisibility?.registryCollectionCount !== Object.keys(COLLECTION_SCOPE_REGISTRY).length
      || tenantVisibility?.crossTenantLeakageCount !== 0
    ) {
      throw Object.assign(new Error('Target API/service tenant visibility simulation failed.'), {
        code: 'TENANT_VISIBILITY_SIMULATION_FAILED',
        blockers: [{
          code: 'TENANT_VISIBILITY_SIMULATION_FAILED',
          childStatus: visibilityChild.status,
          visibilityStatus: tenantVisibility?.status || null,
          crossTenantLeakageCount: tenantVisibility?.crossTenantLeakageCount ?? null,
          failedApiRoutes: Array.isArray(tenantVisibility?.actualApi?.routes)
            ? tenantVisibility.actualApi.routes
              .filter(row => !row?.pass)
              .map(row => ({
                collection: row.collection,
                statusSkytech: row.statusSkytech,
                statusSecondTenant: row.statusSecondTenant,
                visibleSkytech: row.visibleSkytech,
                visibleSecondTenant: row.visibleSecondTenant,
              }))
            : [],
          failedExports: Array.isArray(tenantVisibility?.actualApi?.exports)
            ? tenantVisibility.actualApi.exports
              .filter(row => !row?.pass)
              .map(row => ({ scope: row.scope, status: row.status }))
            : [],
          auditIsolationPass: tenantVisibility?.actualApi?.auditIsolation?.pass ?? null,
          ...(() => {
            try {
              const childError = JSON.parse(visibilityChild.stderr || '');
              return {
                childCode: childError?.code || null,
                childMessage: childError?.message || null,
              };
            } catch {
              return { childCode: null, childMessage: null };
            }
          })(),
        }],
      });
    }

    const rawAfter = exactFileState(captureDir);
    const invariantViolations = [];
    if (stableJson(rawAfter) !== stableJson(rawBefore)) invariantViolations.push('SOURCE_CAPTURE_CHANGED');
    if (stableJson(afterFirstAppData) !== stableJson(beforeAppData)) {
      const beforeKeys = Object.keys(beforeAppData);
      const afterKeys = Object.keys(afterFirstAppData);
      if (stableJson(beforeKeys) !== stableJson(afterKeys)) invariantViolations.push('APP_DATA_COLLECTION_SET_CHANGED');
      for (const name of beforeKeys) {
        if (name === 'users') {
          const expectedUserIdentityFingerprint = sha256(stableJson(
            projectedUsers.map((record, index) => String(record?.id || record?._id || index)),
          ));
          if (
            beforeAppData[name].shape !== afterFirstAppData[name]?.shape
            || afterFirstAppData[name]?.count !== projectedUsers.length
            || afterFirstAppData[name]?.identityFingerprint !== expectedUserIdentityFingerprint
          ) {
            invariantViolations.push('APP_DATA_APPROVED_USER_TRANSITION_MISMATCH');
          }
          continue;
        }
        if (
          beforeAppData[name].shape !== afterFirstAppData[name]?.shape
          || beforeAppData[name].count !== afterFirstAppData[name]?.count
          || beforeAppData[name].identityFingerprint !== afterFirstAppData[name]?.identityFingerprint
        ) {
          invariantViolations.push(`APP_DATA_IDENTITY_CHANGED:${name}`);
        }
      }
    }
    invariantViolations.push(...postRecords.violations.map(row => row.code));
    invariantViolations.push(...actorScopes.violations.map(row => row.code));
    invariantViolations.push(...smokeIdentityViolations);
    if (quickCheck !== 'ok') invariantViolations.push('SQLITE_QUICK_CHECK_FAILED');
    if (foreignKeyViolations.length !== 0) invariantViolations.push('SQLITE_FOREIGN_KEY_CHECK_FAILED');
    if (semanticSecondDiff !== 0 || secondRun.status !== 'noop' || secondRun.writes !== 0) {
      invariantViolations.push('SECOND_RUN_NOT_SEMANTIC_NOOP');
    }
    const result = {
      status: invariantViolations.length === 0 ? 'PASS' : 'FAIL',
      productionWritePerformed: false,
      source: {
        sourceSnapshotHash: manifest.source.sourceSnapshotHash,
        sourceFileSetHash: manifest.source.sourceFileSetHash,
        sourceObservedFileSetHash: manifest.source.sourceObservedFileSetHash,
        databaseContentFingerprint: manifest.source.databaseContentFingerprint,
        schemaFingerprint: manifest.source.schemaFingerprint,
      },
      evidence: {
        artifactIndexSha256: manifest.evidence.artifactIndexSha256,
        baselineContractSha256: manifest.evidence.baselineContractSha256,
        candidateKeySetSha256: manifest.evidence.candidateKeySetSha256,
        candidateAuthoritySha256: manifest.evidence.candidateAuthoritySha256,
        canonicalScopeSha256: manifest.evidence.canonicalScopeSha256,
        classificationAuthorityFingerprint: manifest.evidence.classificationAuthorityFingerprint,
        packFingerprint: manifest.evidence.packFingerprint,
        approvedReconciliationFingerprint: manifest.evidence.approvedReconciliationFingerprint,
        approvedReconciliationCount: manifest.evidence.approvedReconciliationCount,
        sourceBindingsFingerprint: manifest.evidence.sourceBindingsFingerprint,
        platformDefaultTenantOverlaySemantics: structuredClone(
          manifest.evidence.platformDefaultTenantOverlaySemantics,
        ),
      },
      manifest: {
        sha256: manifest.manifestSha256,
        classifiedRecordCount: manifest.summary.classifiedRecordCount,
        semanticScopeWriteCount: manifest.summary.semanticScopeWriteCount,
        operationCounts: manifest.summary.operationCounts,
        collectionWriteCounts: manifest.summary.collectionWriteCounts,
      },
      firstRun: {
        status: firstRun.status,
        sqliteWriteCount: firstRun.writes,
        collectionWriteCount: firstRun.collectionWrites,
        plannedScopeRecordCount: firstPlannedScopeUpdates.length,
        plannedSmokeUserCreateCount: firstPreview.plannedDiff.CREATE.filter(row => row?.type === 'User').length,
        plannedSmokeUserUpdateCount: firstPreview.plannedDiff.UPDATE.filter(row => row?.type === 'User').length,
      },
      secondRun: {
        status: secondRun.status,
        sqliteWriteCount: secondRun.writes,
        semanticDiffCount: semanticSecondDiff,
      },
      integrity: {
        quickCheck,
        foreignKeyViolationCount: foreignKeyViolations.length,
        appDataCollectionCount: Object.keys(beforeAppData).length,
        appDataShapeCountAndStableIdPreserved: invariantViolations.every(value => !value.startsWith('APP_DATA_')),
        updatedScopeRecordCount: postRecords.updatedScopeCount,
        preservedRecordCount: postRecords.preservedByteEquivalentCount,
      },
      identity: {
        counts: finalIdentityCounts,
        intendedBusinessActorsAuthorized: actorScopes.allowed,
        intentionallyUnmappedActorsDenied: actorScopes.denied,
        sourceUserCount: sourceUsers.length,
        projectedUserCount: projectedUsers.length,
        smokeReader: {
          sourceDeactivated: appliedSourceUser?.status === 'Неактивен'
            && appliedSourceUser?.allowFrontendLogin === false
            && appliedSourceUser?.frontendAccess === false,
          replacementActive: appliedReaderUser?.status === 'Активен'
            && appliedReaderUser?.allowFrontendLogin === true
            && appliedReaderUser?.frontendAccess === true
            && appliedReaderUser?.role === PRODUCTION_SMOKE_READER_ROLE,
          hashedLoginVerifierPreserved: Boolean(
            appliedSourceUser
            && appliedReaderUser
            && appliedSourceUser.password === appliedReaderUser.password
          ),
          capabilityCount: readerCapabilityCount,
          replacementResolverAuthorized: !actorScopes.violations.some(row => (
            row.principalId === PRODUCTION_SMOKE_READER_PRINCIPAL_ID
          )),
          sourceResolverDenied: !actorScopes.violations.some(row => (
            row.principalId === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID
          )),
          secondRunAlreadyApplied: appliedSmokePreview.alreadyApplied,
        },
      },
      tenantVisibility,
      executionPlanBundle: {
        bundleSha256: executionPlanBundle.bundleSha256,
        executionPlanSha256: executionPlanBundle.executionPlanSha256,
        productionExecutionAuthorized: executionPlanBundle.productionExecutionAuthorized,
        status: executionPlanBundle.status,
        nonBackupPreflightBlockerCount: reviewOnlyNonBackupBlockers.length,
      },
      invariantViolations,
    };
    writeNewJsonSet([
      { filePath: args.manifestOutput, value: manifest },
      { filePath: args.simulationOutput, value: result },
      { filePath: args.executionPlanOutput, value: executionPlanBundle },
    ]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'PASS') process.exitCode = 2;
  } finally {
    if (classificationDb?.open) classificationDb.close();
    if (simulationDb?.open) simulationDb.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || 'PRODUCTION_SCOPE_SIMULATION_FAILED',
      message: error.message,
      blockers: Array.isArray(error.blockers) ? error.blockers : [],
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildApprovedReconciliation,
  exactFileState,
  readIndexedJson,
  readHashBoundJson,
  selectCaptureRound,
  verifyEvidencePack,
  verifyManifestRecords,
  writeNewJsonSet,
};
