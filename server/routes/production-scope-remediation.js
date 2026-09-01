const path = require('path');
const fs = require('fs');
const defaultPlan = require('../config/production-scope-remediation-active-plan');
const defaultEnvironment = require('../config/production-scope-remediation-environment');
const {
  consumeOperationRequest,
  validateOperationAuthorization,
} = require('../lib/production-scope-remediation-auth');
const {
  runApply,
  runBackup,
  runPreflight,
  runVerify,
} = require('../lib/production-scope-remediation-runner');

const ALLOWED_MODES = new Set(['preflight', 'backup', 'apply', 'verify']);

class ProductionScopeRouteError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'ProductionScopeRouteError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new ProductionScopeRouteError(code, message, status);
}

function runtimeIdentityFromEnv(env = process.env) {
  return {
    projectId: String(env.RAILWAY_PROJECT_ID || '').trim(),
    environmentId: String(env.RAILWAY_ENVIRONMENT_ID || '').trim(),
    serviceId: String(env.RAILWAY_SERVICE_ID || '').trim(),
    volumeName: String(env.RAILWAY_VOLUME_NAME || '').trim(),
    volumeMountPath: String(env.RAILWAY_VOLUME_MOUNT_PATH || '').trim(),
    replicaId: String(env.RAILWAY_REPLICA_ID || '').trim(),
    gitCommitSha: String(env.RAILWAY_GIT_COMMIT_SHA || '').trim().toLowerCase(),
  };
}

function signedRailwayIdentity(value = {}) {
  return {
    projectId: String(value.projectId || '').trim(),
    environmentId: String(value.environmentId || '').trim(),
    serviceId: String(value.serviceId || '').trim(),
    volumeId: String(value.volumeId || '').trim(),
    volumeName: String(value.volumeName || '').trim(),
    volumeMountPath: String(value.volumeMountPath || '').trim(),
  };
}

function registerProductionScopeRemediationRoutes(router, deps) {
  const {
    dbPath,
    ensureDb,
    readData,
    createSqliteBackup,
    collections,
    buildInfo,
    plan = defaultPlan,
    expectedEnvironment = defaultEnvironment,
    isEnabled = () => process.env.PRODUCTION_SCOPE_REMEDIATION_ENABLED === 'true',
    getAllowedMode = () => (
      process.env.PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES
      || process.env.PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE
    ),
    getSigningSecret = () => process.env.PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET,
    getExpectedExecutionSha = () => (
      process.env.PRODUCTION_SCOPE_REMEDIATION_EXPECTED_EXECUTION_SHA
    ),
    getRuntimeIdentity = () => runtimeIdentityFromEnv(),
    getConservationState = () => ({
      appDisabled: process.env.APP_DISABLED === 'true',
      botDisabled: process.env.BOT_DISABLED === 'true',
      gsmDisabled: process.env.GSM_DISABLED === 'true'
        || String(process.env.GSM_ENABLED || '').toLowerCase() === 'off',
      storageWriteGuardEnabled:
        process.env.PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE === 'true',
      schemaCompatibilityDisabled:
        process.env.PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY !== 'true',
      cleanResetDisabled: process.env.SKYTECH_CLEAN_RESET_ENABLED !== 'true',
      adminResetDisabled: !String(process.env.ADMIN_RESET_PASSWORD || ''),
    }),
    now = () => new Date(),
    consumeRequest = consumeOperationRequest,
    logger = console,
    runner = { runApply, runBackup, runPreflight, runVerify },
  } = deps;
  let operationInFlight = false;

  function actualDeployedSha() {
    const info = typeof buildInfo === 'function' ? buildInfo() : (buildInfo || {});
    return String(info?.commitFull || '');
  }

  function assertSecureConfiguration(mode, body) {
    if (!isEnabled()) fail('REMEDIATION_ROUTE_DISABLED', 'Not found', 404);
    const configuredModes = String(getAllowedMode() || '').split(',').map(value => value.trim()).filter(Boolean);
    const configuredModeSet = new Set(configuredModes);
    if (
      configuredModes.length === 0
      || configuredModeSet.size !== configuredModes.length
      || configuredModes.some(value => !ALLOWED_MODES.has(value))
      || !configuredModeSet.has(mode)
    ) {
      fail('REMEDIATION_MODE_NOT_ENABLED', 'Not found', 404);
    }
    const runtime = getRuntimeIdentity() || {};
    const expectedExecutionSha = String(getExpectedExecutionSha() || '').trim().toLowerCase();
    let exactDatabasePath = false;
    try {
      const stat = fs.lstatSync(dbPath);
      exactDatabasePath = stat.isFile()
        && !stat.isSymbolicLink()
        && path.resolve(dbPath) === path.resolve(expectedEnvironment.sourceDbPath)
        && fs.realpathSync(dbPath) === fs.realpathSync(expectedEnvironment.sourceDbPath);
    } catch {
      exactDatabasePath = false;
    }
    const runtimeMatches = (
      runtime.projectId === expectedEnvironment.projectId
      && runtime.environmentId === expectedEnvironment.environmentId
      && runtime.serviceId === expectedEnvironment.serviceId
      && runtime.volumeName === expectedEnvironment.volumeName
      && runtime.volumeMountPath === expectedEnvironment.volumeMountPath
      && Boolean(String(runtime.replicaId || '').trim())
      && /^[a-f0-9]{40}$/.test(String(runtime.gitCommitSha || ''))
      && runtime.gitCommitSha === actualDeployedSha().toLowerCase()
      && /^[a-f0-9]{40}$/.test(expectedExecutionSha)
      && expectedExecutionSha === actualDeployedSha().toLowerCase()
      && exactDatabasePath
      && plan?.sourceDbPath
      && path.resolve(plan.sourceDbPath) === path.resolve(expectedEnvironment.sourceDbPath)
      && plan?.authority?.companyId === expectedEnvironment.canonicalCompanyId
      && plan?.authority?.tenantId === expectedEnvironment.canonicalCompanyId
    );
    if (!runtimeMatches) {
      fail('RAILWAY_RUNTIME_IDENTITY_MISMATCH', 'Not found', 404);
    }
    const requested = signedRailwayIdentity(body?.railwayIdentity);
    const expectedRequestIdentity = signedRailwayIdentity(expectedEnvironment);
    if (JSON.stringify(requested) !== JSON.stringify(expectedRequestIdentity)) {
      fail('RAILWAY_REQUEST_IDENTITY_MISMATCH', 'The signed Railway target is not approved.', 403);
    }
    return requested;
  }

  function authorizeRequest(req, mode) {
    const railwayIdentity = assertSecureConfiguration(mode, req.body);
    const authorization = validateOperationAuthorization({
      secret: getSigningSecret(),
      signature: req.headers['x-production-scope-remediation-token'],
      requestId: req.headers['x-production-scope-remediation-request-id'],
      issuedAt: req.headers['x-production-scope-remediation-issued-at'],
      expiresAt: req.headers['x-production-scope-remediation-expires-at'],
      mode,
      body: req.body,
      now: now(),
    });
    consumeRequest({
      dbPath,
      requestId: authorization.requestId,
      mode,
      issuedAt: authorization.issuedAt,
      expiresAt: authorization.expiresAt,
    });
    return { railwayIdentity, authorization };
  }

  function guarded(mode, handler) {
    return async (req, res) => {
      if (operationInFlight) {
        return res.status(409).json({ ok: false, code: 'REMEDIATION_OPERATION_IN_PROGRESS' });
      }
      operationInFlight = true;
      let requestHash = null;
      try {
        const authorization = authorizeRequest(req, mode);
        requestHash = authorization.authorization.requestId.slice(0, 8);
        return await handler(req, res, authorization.railwayIdentity);
      } catch (error) {
        const code = typeof error?.code === 'string'
          ? error.code
          : 'PRODUCTION_SCOPE_REMEDIATION_FAILED';
        if (error?.status !== 404) {
          logger.error?.('[production-scope-remediation] operation failed', {
            mode,
            code,
            request: requestHash,
          });
        }
        return res.status(Number.isInteger(error?.status) ? error.status : 409).json({
          ok: false,
          code,
          blockers: Array.isArray(error?.blockers) ? error.blockers : [],
        });
      } finally {
        operationInFlight = false;
      }
    };
  }

  router.post(
    '/admin/production-scope-remediation/preflight',
    guarded('preflight', async (req, res, railwayIdentity) => {
      const result = await runner.runPreflight({
        dbPath,
        plan,
        expectedDeployedSha: req.body?.expectedDeployedSha,
        actualDeployedSha: actualDeployedSha(),
        railwayIdentity,
      });
      return res.json({ ok: true, result });
    }),
  );

  router.post(
    '/admin/production-scope-remediation/backup',
    guarded('backup', async (req, res, railwayIdentity) => {
      const result = await runner.runBackup({
        dbPath,
        plan,
        expectedDeployedSha: req.body?.expectedDeployedSha,
        actualDeployedSha: actualDeployedSha(),
        conservationState: getConservationState(),
        readData,
        createSqliteBackup,
        collections,
        buildInfo: typeof buildInfo === 'function' ? buildInfo() : buildInfo,
        railwayIdentity,
      });
      return res.status(201).json({ ok: true, result });
    }),
  );

  router.post(
    '/admin/production-scope-remediation/apply',
    guarded('apply', async (req, res, railwayIdentity) => {
      const result = await runner.runApply({
        dbPath,
        plan,
        receipt: req.body?.backup,
        expectedDeployedSha: req.body?.expectedDeployedSha,
        actualDeployedSha: actualDeployedSha(),
        expectedPlanChecksum: req.body?.expectedPlanChecksum,
        expectedStateFingerprint: req.body?.expectedStateFingerprint,
        expectedUserInventoryFingerprint: req.body?.expectedUserInventoryFingerprint,
        expectedDatabaseFingerprint: req.body?.expectedDatabaseFingerprint,
        expectedSourceFileSetFingerprint: req.body?.expectedSourceFileSetFingerprint,
        expectedPostDatabaseFingerprint: req.body?.expectedPostDatabaseFingerprint,
        approvedCompanyId: req.body?.approvedCompanyId,
        confirmation: req.body?.confirmation,
        independentBackupEvidence: req.body?.independentBackupEvidence,
        conservationState: getConservationState(),
        ensureDb,
        railwayIdentity,
      });
      return res.json({ ok: true, result });
    }),
  );

  router.post(
    '/admin/production-scope-remediation/verify',
    guarded('verify', async (req, res, railwayIdentity) => {
      const result = await runner.runVerify({
        dbPath,
        plan,
        receipt: req.body?.backup,
        expectedDeployedSha: req.body?.expectedDeployedSha,
        actualDeployedSha: actualDeployedSha(),
        conservationState: getConservationState(),
        railwayIdentity,
      });
      return res.status(result.ok ? 200 : 409).json({ ok: result.ok, result });
    }),
  );
}

module.exports = {
  ProductionScopeRouteError,
  registerProductionScopeRemediationRoutes,
  runtimeIdentityFromEnv,
  signedRailwayIdentity,
};
