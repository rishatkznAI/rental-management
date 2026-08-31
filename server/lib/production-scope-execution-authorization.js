const {
  executionBundleSha256,
  executionPlanSha256,
  validateProductionScopeExecutionBundle,
} = require('./production-scope-execution-plan-bundle');
const { stableJson } = require('./production-scope-remediation');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
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

function validateSimulation(result, reviewBundle) {
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

function validateApproval({
  approval,
  approvalFileSha256,
  reviewBundle,
  reviewBundleFileSha256,
  simulationOneSha256,
  simulationTwoSha256,
}) {
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    fail('EXECUTION_APPROVAL_INVALID', 'The external execution approval must be an object.');
  }
  if (
    Object.keys(approval).some(key => !APPROVAL_KEYS.has(key))
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
    simulationOneSha256,
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
  };
  authorized.executionPlanSha256 = executionPlanSha256(authorized.executionPlan);
  authorized.bundleSha256 = executionBundleSha256(authorized);
  validateProductionScopeExecutionBundle(authorized, { requireAuthorized: true });
  return authorized;
}

module.exports = {
  APPROVAL_KEYS,
  ProductionScopeExecutionAuthorizationError,
  authorizeProductionScopeExecutionBundle,
  validateApproval,
  validateSimulation,
};
