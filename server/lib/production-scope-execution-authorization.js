const {
  executionBundleSha256,
  executionPlanSha256,
  validateProductionScopeExecutionBundle,
} = require('./production-scope-execution-plan-bundle');
const { stableJson } = require('./production-scope-remediation');
const {
  AUTHORITY: IDENTITY_ONLY_AUTHORITY,
  COMPANY_ID: IDENTITY_ONLY_COMPANY_ID,
  EXPECTED_EXACT_CHANGES: IDENTITY_ONLY_EXACT_CHANGES,
  OWNER_MEMBERSHIP_ID: IDENTITY_ONLY_OWNER_MEMBERSHIP_ID,
  OWNER_PRINCIPAL_ID: IDENTITY_ONLY_OWNER_PRINCIPAL_ID,
} = require('./identity-bootstrap-execution-bundle');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const IDENTITY_ONLY_EXECUTION_SCOPE = 'IDENTITY_ONLY';
const IDENTITY_SIMULATION_CLASSIFICATION = 'FRESH_PINNED_READ_ONLY_IDENTITY_SIMULATION';
const IDENTITY_ONLY_UNMAPPED_PRINCIPAL_IDS = Object.freeze([
  ...IDENTITY_ONLY_AUTHORITY.intentionallyUnmappedUserIds,
]);
const APPROVAL_KEYS = new Set([
  'approvalVersion',
  'approvalReference',
  'approvedAt',
  'approvedBy',
  'captureDeployedSha',
  'captureDeploymentId',
  'independentAuditVerdict',
  'productionExecutionAuthorized',
  'repository',
  'reviewBundleFileSha256',
  'reviewBundleSha256',
  'reviewExecutionPlanSha256',
  'scopeManifestSha256',
  'simulationOneSha256',
  'simulationTwoSha256',
  'status',
]);
const IDENTITY_APPROVAL_KEYS = new Set([
  ...APPROVAL_KEYS,
  'authorizedExecutionSha',
  'authorityConfigChecksum',
]);
const IDENTITY_SIMULATION_KEYS = Object.freeze([
  'authorizationBindingsComplete',
  'authorizedExecutionSha',
  'authorityConfigChecksum',
  'classification',
  'executionPlanBundle',
  'executionScope',
  'identity',
  'integrity',
  'invariantViolations',
  'manifest',
  'nonWriteSet',
  'productionExecutionAuthorized',
  'productionWritePerformed',
  'readOnlyProof',
  'simulationVersion',
  'source',
  'status',
  'unresolvedAuthorizationBindings',
  'writesPerformed',
]);
const IDENTITY_SIMULATION_IDENTITY_KEYS = Object.freeze([
  'authorizationAuditEventCount',
  'branchGrantCount',
  'companyCount',
  'directCapabilityAssignmentCount',
  'headOfficeCount',
  'identityBootstrapRunCount',
  'intentionallyUnmappedPrincipalIds',
  'mappedPrincipalIds',
  'membershipCount',
  'membershipPrincipalIds',
  'roleTemplateCapabilityCount',
  'roleTemplateCount',
  'unmappedMembershipCount',
]);
const IDENTITY_SIMULATION_NON_WRITE_KEYS = Object.freeze([
  'appDataMutationCount',
  'businessDataMutationCount',
  'collectionWriteCount',
  'environmentMutationCount',
  'financialDataMutationCount',
  'migrationMutationCount',
  'recordMappingCount',
  'relationMappingCount',
  'schemaMutationCount',
  'smokeIdentityMutationCount',
  'tenantGuardMutationCount',
  'userRecordMutationCount',
]);

class ProductionScopeExecutionAuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProductionScopeExecutionAuthorizationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProductionScopeExecutionAuthorizationError(code, message);
}

function exactText(value) {
  return typeof value === 'string' && value === value.trim() ? value : '';
}

function isIdentityOnlyBundle(bundle) {
  return bundle?.executionPlan?.executionScope === IDENTITY_ONLY_EXECUTION_SCOPE;
}

function exactObjectKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return stableJson(Object.keys(value).sort()) === stableJson([...expectedKeys].sort());
}

function identityOnlyAuthorityProjection(config) {
  return {
    configVersion: config?.configVersion,
    company: config?.company,
    branches: config?.branches,
    roleTemplates: config?.roleTemplates,
    memberships: config?.memberships,
    intentionallyUnmappedUserIds: config?.intentionallyUnmappedUserIds,
  };
}

function expectedIdentityActorMappings() {
  return [
    {
      userId: IDENTITY_ONLY_OWNER_PRINCIPAL_ID,
      action: 'CREATE_MEMBERSHIP',
      membershipId: IDENTITY_ONLY_OWNER_MEMBERSHIP_ID,
      companyId: IDENTITY_ONLY_COMPANY_ID,
      tenantId: IDENTITY_ONLY_COMPANY_ID,
    },
    ...IDENTITY_ONLY_UNMAPPED_PRINCIPAL_IDS.map(userId => ({
      userId,
      action: 'NO_MEMBERSHIP',
      candidateForProductionMembership: false,
    })),
  ];
}

function validateIdentityOnlyAuthority(reviewBundle) {
  const plan = reviewBundle?.executionPlan;
  const config = plan?.authority?.identityBootstrap;
  const summary = reviewBundle?.summary;
  if (
    plan?.executionScope !== IDENTITY_ONLY_EXECUTION_SCOPE
    || plan?.authority?.status !== 'APPROVED'
    || plan?.authority?.companyId !== IDENTITY_ONLY_COMPANY_ID
    || plan?.authority?.tenantId !== IDENTITY_ONLY_COMPANY_ID
    || stableJson(identityOnlyAuthorityProjection(config)) !== stableJson(IDENTITY_ONLY_AUTHORITY)
    || !SHA256_PATTERN.test(exactText(config?.approval?.configChecksum))
    || config?.approval?.schemaFingerprint !== reviewBundle?.source?.schemaFingerprint
    || stableJson(plan?.actorMappings) !== stableJson(expectedIdentityActorMappings())
    || !Array.isArray(plan?.recordMappings)
    || plan.recordMappings.length !== 0
    || !Array.isArray(plan?.relationMappings)
    || plan.relationMappings.length !== 0
    || Object.prototype.hasOwnProperty.call(plan || {}, 'smokeIdentityTransition')
    || !Array.isArray(reviewBundle?.recordBindings)
    || reviewBundle.recordBindings.length !== 0
    || summary?.registryEntryCount !== 0
    || summary?.registryWriteCount !== 0
    || summary?.classifiedRecordCount !== 0
    || summary?.executionRecordMappingCount !== 0
    || summary?.semanticScopeWriteCount !== 0
    || summary?.globalReferenceCollectionCount !== 0
    || stableJson(summary?.operationCounts) !== '{}'
    || stableJson(summary?.collectionWriteCounts) !== '{}'
  ) {
    fail(
      'IDENTITY_EXECUTION_AUTHORITY_INVALID',
      'Identity authorization requires the exact one-membership/four-unmapped authority and zero non-identity mappings.',
    );
  }
  return config.approval.configChecksum;
}

function identitySimulationSource(reviewBundle) {
  return {
    captureDeployedSha: reviewBundle.source?.captureDeployedSha,
    captureDeploymentId: reviewBundle.source?.captureDeploymentId,
    railwayIdentity: reviewBundle.source?.railwayIdentity,
    deploymentIdentity: reviewBundle.source?.deploymentIdentity,
    sourceSnapshotHash: reviewBundle.source?.sourceSnapshotHash,
    sourceFileSetHash: reviewBundle.source?.sourceFileSetHash,
    sourceObservedFileSetHash: reviewBundle.source?.sourceObservedFileSetHash,
    databaseContentFingerprint: reviewBundle.source?.databaseContentFingerprint,
    schemaFingerprint: reviewBundle.source?.schemaFingerprint,
  };
}

function expectedIdentitySimulationResult() {
  return {
    companyCount: IDENTITY_ONLY_EXACT_CHANGES.companies,
    headOfficeCount: IDENTITY_ONLY_EXACT_CHANGES.branches,
    roleTemplateCount: IDENTITY_ONLY_EXACT_CHANGES.roleTemplates,
    roleTemplateCapabilityCount: IDENTITY_ONLY_EXACT_CHANGES.roleTemplateCapabilities,
    membershipCount: IDENTITY_ONLY_EXACT_CHANGES.memberships,
    branchGrantCount: IDENTITY_ONLY_EXACT_CHANGES.branchGrants,
    directCapabilityAssignmentCount: IDENTITY_ONLY_EXACT_CHANGES.capabilityAssignments,
    authorizationAuditEventCount: IDENTITY_ONLY_EXACT_CHANGES.authorizationAuditEvents,
    identityBootstrapRunCount: IDENTITY_ONLY_EXACT_CHANGES.bootstrapRuns,
    membershipPrincipalIds: [IDENTITY_ONLY_OWNER_PRINCIPAL_ID],
    mappedPrincipalIds: [IDENTITY_ONLY_OWNER_PRINCIPAL_ID],
    intentionallyUnmappedPrincipalIds: [...IDENTITY_ONLY_UNMAPPED_PRINCIPAL_IDS],
    unmappedMembershipCount: 0,
  };
}

function validateIdentitySimulation(result, reviewBundle) {
  const authorityConfigChecksum = validateIdentityOnlyAuthority(reviewBundle);
  const readOnly = result?.readOnlyProof;
  const integrity = result?.integrity;
  const executionBundle = result?.executionPlanBundle;
  if (
    !exactObjectKeys(result, IDENTITY_SIMULATION_KEYS)
    || result.simulationVersion !== 1
    || result.classification !== IDENTITY_SIMULATION_CLASSIFICATION
    || result.status !== 'PASS'
    || result.executionScope !== IDENTITY_ONLY_EXECUTION_SCOPE
    || result.productionExecutionAuthorized !== false
    || result.productionWritePerformed !== false
    || result.writesPerformed !== 0
    || result.authorizationBindingsComplete !== true
    || !SHA40_PATTERN.test(exactText(result.authorizedExecutionSha))
    || result.authorityConfigChecksum !== authorityConfigChecksum
    || !Array.isArray(result.unresolvedAuthorizationBindings)
    || result.unresolvedAuthorizationBindings.length !== 0
    || !Array.isArray(result.invariantViolations)
    || result.invariantViolations.length !== 0
    || stableJson(result.source) !== stableJson(identitySimulationSource(reviewBundle))
    || !exactObjectKeys(result.manifest, ['sha256'])
    || result.manifest.sha256 !== reviewBundle.scopeManifestSha256
    || !exactObjectKeys(executionBundle, [
      'bundleSha256',
      'executionPlanSha256',
      'nonBackupPreflightBlockerCount',
      'productionExecutionAuthorized',
      'scopeManifestSha256',
      'status',
    ])
    || executionBundle.bundleSha256 !== reviewBundle.bundleSha256
    || executionBundle.executionPlanSha256 !== reviewBundle.executionPlanSha256
    || executionBundle.scopeManifestSha256 !== reviewBundle.scopeManifestSha256
    || executionBundle.productionExecutionAuthorized !== false
    || executionBundle.status !== 'REVIEW_REQUIRED'
    || executionBundle.nonBackupPreflightBlockerCount !== 0
    || !exactObjectKeys(readOnly, [
      'ephemeralMirrorRemoved',
      'foreignKeyFailureCount',
      'simulationDatabaseSource',
      'sourceDatabaseOpenedBySqlite',
      'sqliteFilesByteIdentical',
      'sqliteForeignKeys',
      'sqliteOpenMode',
      'sqliteQueryOnly',
      'totalChangesAfter',
      'totalChangesBefore',
      'totalChangesDelta',
    ])
    || readOnly.sourceDatabaseOpenedBySqlite !== false
    || readOnly.simulationDatabaseSource !== 'EPHEMERAL_LOCAL_MIRROR'
    || readOnly.sqliteOpenMode !== 'readonly'
    || readOnly.sqliteQueryOnly !== true
    || readOnly.sqliteForeignKeys !== true
    || readOnly.totalChangesBefore !== 0
    || readOnly.totalChangesAfter !== 0
    || readOnly.totalChangesDelta !== 0
    || readOnly.foreignKeyFailureCount !== 0
    || readOnly.sqliteFilesByteIdentical !== true
    || readOnly.ephemeralMirrorRemoved !== true
    || !exactObjectKeys(integrity, ['foreignKeyViolationCount', 'quickCheck'])
    || integrity.quickCheck !== 'ok'
    || integrity.foreignKeyViolationCount !== 0
    || !exactObjectKeys(result.identity, IDENTITY_SIMULATION_IDENTITY_KEYS)
    || stableJson(result.identity) !== stableJson(expectedIdentitySimulationResult())
    || !exactObjectKeys(result.nonWriteSet, IDENTITY_SIMULATION_NON_WRITE_KEYS)
    || Object.values(result.nonWriteSet).some(value => value !== 0)
  ) {
    fail(
      'IDENTITY_EXECUTION_AUTHORIZATION_SIMULATION_FAILED',
      'A pinned identity-only simulation did not prove the exact authority and read-only non-write invariants.',
    );
  }
  return {
    authorizedExecutionSha: result.authorizedExecutionSha,
    authorityConfigChecksum,
  };
}

function validateBusinessSimulation(result, reviewBundle) {
  const smoke = result?.identity?.smokeReader || {};
  const visibility = result?.tenantVisibility || {};
  const serviceRows = visibility?.serviceBoundary?.rows;
  const apiRoutes = visibility?.actualApi?.routes;
  if (
    result?.status !== 'PASS'
    || result?.productionWritePerformed !== false
    || !Array.isArray(result?.invariantViolations)
    || result.invariantViolations.length !== 0
    || result?.integrity?.quickCheck !== 'ok'
    || result?.integrity?.foreignKeyViolationCount !== 0
    || result?.integrity?.appDataShapeCountAndStableIdPreserved !== true
    || result?.secondRun?.semanticDiffCount !== 0
    || result?.secondRun?.sqliteWriteCount !== 0
    || result?.firstRun?.plannedScopeRecordCount !== reviewBundle.summary?.semanticScopeWriteCount
    || result?.executionPlanBundle?.bundleSha256 !== reviewBundle.bundleSha256
    || result?.executionPlanBundle?.executionPlanSha256 !== reviewBundle.executionPlanSha256
    || result?.executionPlanBundle?.productionExecutionAuthorized !== false
    || result?.executionPlanBundle?.status !== 'REVIEW_REQUIRED'
    || result?.executionPlanBundle?.nonBackupPreflightBlockerCount !== 0
    || result?.manifest?.sha256 !== reviewBundle.scopeManifestSha256
    || result?.source?.sourceSnapshotHash !== reviewBundle.source?.sourceSnapshotHash
    || result?.source?.sourceFileSetHash !== reviewBundle.source?.sourceFileSetHash
    || result?.source?.sourceObservedFileSetHash !== reviewBundle.source?.sourceObservedFileSetHash
    || result?.source?.databaseContentFingerprint !== reviewBundle.source?.databaseContentFingerprint
    || result?.source?.schemaFingerprint !== reviewBundle.source?.schemaFingerprint
    || result?.evidence?.artifactIndexSha256 !== reviewBundle.evidence?.artifactIndexSha256
    || result?.evidence?.packFingerprint !== reviewBundle.evidence?.packFingerprint
    || result?.evidence?.approvedReconciliationFingerprint
      !== reviewBundle.evidence?.approvedReconciliationFingerprint
    || smoke.sourceDeactivated !== true
    || smoke.replacementActive !== true
    || smoke.hashedLoginVerifierPreserved !== true
    || smoke.replacementResolverAuthorized !== true
    || smoke.sourceResolverDenied !== true
    || smoke.secondRunAlreadyApplied !== true
    || visibility.status !== 'PASS'
    || visibility.productionWritePerformed !== false
    || visibility.inputRemediatedCopyMutated !== false
    || visibility.localWorkingCopiesMutated !== true
    || visibility.fakeCompanyPersistedOutsideDisposableCopy !== false
    || visibility.registryCollectionCount !== reviewBundle.summary?.registryEntryCount
    || visibility.crossTenantLeakageCount !== 0
    || visibility.serviceBoundary?.leakageCount !== 0
    || !Array.isArray(serviceRows)
    || serviceRows.length !== visibility.registryCollectionCount
    || serviceRows.some(row => row?.pass !== true)
    || visibility.actualApi?.targetServerStartedAgainstRemediatedCopy !== true
    || visibility.actualApi?.leakageCount !== 0
    || !Array.isArray(apiRoutes)
    || apiRoutes.length < 8
    || apiRoutes.some(row => row?.pass !== true)
    || !Array.isArray(visibility.actualApi?.exports)
    || visibility.actualApi.exports.length !== 2
    || visibility.actualApi.exports.some(row => row?.pass !== true)
    || visibility.actualApi?.auditIsolation?.pass !== true
  ) {
    fail('EXECUTION_AUTHORIZATION_SIMULATION_FAILED', 'A pinned simulation did not pass every execution invariant.');
  }
}

function validateSimulation(result, reviewBundle) {
  if (isIdentityOnlyBundle(reviewBundle)) {
    return validateIdentitySimulation(result, reviewBundle);
  }
  return validateBusinessSimulation(result, reviewBundle);
}

function validateApproval({
  approval,
  approvalFileSha256,
  reviewBundle,
  reviewBundleFileSha256,
  simulationOne,
  simulationOneSha256,
  simulationTwo,
  simulationTwoSha256,
}) {
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    fail('EXECUTION_APPROVAL_INVALID', 'The external execution approval must be an object.');
  }
  const identityOnly = isIdentityOnlyBundle(reviewBundle);
  const allowedApprovalKeys = identityOnly ? IDENTITY_APPROVAL_KEYS : APPROVAL_KEYS;
  if (
    Object.keys(approval).some(key => !allowedApprovalKeys.has(key))
    || approval.approvalVersion !== 1
    || approval.status !== 'APPROVED_FOR_GUARDED_EXECUTION'
    || approval.productionExecutionAuthorized !== true
    || approval.independentAuditVerdict !== 'PASS'
    || approval.repository !== 'rishatkznAI/rental-management'
    || !SHA256_PATTERN.test(exactText(approvalFileSha256))
    || !SHA256_PATTERN.test(exactText(reviewBundleFileSha256))
    || !SHA256_PATTERN.test(exactText(simulationOneSha256))
    || !SHA256_PATTERN.test(exactText(simulationTwoSha256))
    || !SHA40_PATTERN.test(exactText(approval.captureDeployedSha))
    || !UUID_PATTERN.test(exactText(approval.captureDeploymentId))
    || exactText(approval.approvedBy).length < 3
    || exactText(approval.approvalReference).length < 16
    || !Number.isFinite(Date.parse(exactText(approval.approvedAt)))
    || new Date(exactText(approval.approvedAt)).toISOString() !== approval.approvedAt
  ) {
    fail('EXECUTION_APPROVAL_INVALID', 'The external execution approval is incomplete or invalid.');
  }
  if (
    approval.captureDeployedSha !== reviewBundle.source.captureDeployedSha
    || approval.captureDeploymentId !== reviewBundle.source.captureDeploymentId
    || approval.reviewBundleFileSha256 !== reviewBundleFileSha256
    || approval.reviewBundleSha256 !== reviewBundle.bundleSha256
    || approval.reviewExecutionPlanSha256 !== reviewBundle.executionPlanSha256
    || approval.scopeManifestSha256 !== reviewBundle.scopeManifestSha256
    || approval.simulationOneSha256 !== simulationOneSha256
    || approval.simulationTwoSha256 !== simulationTwoSha256
  ) {
    fail('EXECUTION_APPROVAL_BINDING_MISMATCH', 'The approval does not match the exact reviewed evidence.');
  }
  if (identityOnly) {
    const authorityConfigChecksum = validateIdentityOnlyAuthority(reviewBundle);
    if (
      !SHA40_PATTERN.test(exactText(approval.authorizedExecutionSha))
      || approval.authorizedExecutionSha !== reviewBundle.source?.captureDeployedSha
      || !SHA256_PATTERN.test(exactText(approval.authorityConfigChecksum))
      || approval.authorityConfigChecksum !== authorityConfigChecksum
      || approval.authorizedExecutionSha !== simulationOne?.authorizedExecutionSha
      || approval.authorizedExecutionSha !== simulationTwo?.authorizedExecutionSha
      || approval.authorityConfigChecksum !== simulationOne?.authorityConfigChecksum
      || approval.authorityConfigChecksum !== simulationTwo?.authorityConfigChecksum
      || simulationOneSha256 !== simulationTwoSha256
    ) {
      fail(
        'IDENTITY_EXECUTION_APPROVAL_BINDING_MISMATCH',
        'Identity approval does not bind the exact execution SHA, authority checksum, and identical pinned simulations.',
      );
    }
  }
}

function authorizeProductionScopeExecutionBundle({
  reviewBundle,
  reviewBundleFileSha256,
  approval,
  approvalFileSha256,
  simulationOne,
  simulationOneSha256,
  simulationTwo,
  simulationTwoSha256,
}) {
  const review = validateProductionScopeExecutionBundle(reviewBundle);
  if (review.authorized || reviewBundle.authorization !== null) {
    fail('EXECUTION_REVIEW_BUNDLE_REQUIRED', 'Authorization requires an exact review-only bundle.');
  }
  validateSimulation(simulationOne, reviewBundle);
  validateSimulation(simulationTwo, reviewBundle);
  if (stableJson(simulationOne) !== stableJson(simulationTwo)) {
    fail('EXECUTION_SIMULATION_DIVERGENCE', 'The two pristine simulation results are not identical.');
  }
  validateApproval({
    approval,
    approvalFileSha256,
    reviewBundle,
    reviewBundleFileSha256,
    simulationOne,
    simulationOneSha256,
    simulationTwo,
    simulationTwoSha256,
  });

  const authorized = structuredClone(reviewBundle);
  authorized.status = 'APPROVED_FOR_GUARDED_EXECUTION';
  authorized.productionExecutionAuthorized = true;
  authorized.executionPlan.productionExecutionAuthorized = true;
  authorized.authorization = {
    authorizationVersion: 1,
    approvalFileSha256,
    approvalReference: approval.approvalReference,
    approvedAt: approval.approvedAt,
    approvedBy: approval.approvedBy,
    captureDeployedSha: approval.captureDeployedSha,
    independentAuditVerdict: approval.independentAuditVerdict,
    reviewBundleFileSha256,
    reviewBundleSha256: reviewBundle.bundleSha256,
    reviewExecutionPlanSha256: reviewBundle.executionPlanSha256,
    scopeManifestSha256: reviewBundle.scopeManifestSha256,
    simulationOneSha256,
    simulationTwoSha256,
    ...(isIdentityOnlyBundle(reviewBundle) ? {
      authorizedExecutionSha: approval.authorizedExecutionSha,
      authorityConfigChecksum: approval.authorityConfigChecksum,
    } : {}),
  };
  authorized.executionPlanSha256 = executionPlanSha256(authorized.executionPlan);
  authorized.bundleSha256 = executionBundleSha256(authorized);
  validateProductionScopeExecutionBundle(authorized, { requireAuthorized: true });
  return authorized;
}

module.exports = {
  APPROVAL_KEYS,
  IDENTITY_APPROVAL_KEYS,
  IDENTITY_SIMULATION_CLASSIFICATION,
  ProductionScopeExecutionAuthorizationError,
  authorizeProductionScopeExecutionBundle,
  validateIdentitySimulation,
  validateApproval,
  validateSimulation,
};
