const crypto = require('crypto');
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
const {
  validateProductionScopeExecutionBundle,
} = require('../lib/production-scope-execution-plan-bundle');

const ALLOWED_MODES = new Set(['preflight', 'backup', 'apply', 'verify']);
const MAX_AUTHORIZED_BUNDLE_BYTES = 1024 * 1024;
const AUTHORIZED_BUNDLE_PIN_FILENAME = '.production-scope-remediation-authorized-bundle.sha256';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function buildProductionScopeConservationState({
  appDisabled,
  botDisabled,
  gsmDisabled,
  storageWriteGuardEnabled,
  env = process.env,
} = {}) {
  return {
    appDisabled: typeof appDisabled === 'boolean'
      ? appDisabled
      : env.APP_DISABLED === 'true',
    botDisabled: typeof botDisabled === 'boolean'
      ? botDisabled
      : env.BOT_DISABLED === 'true',
    gsmDisabled: typeof gsmDisabled === 'boolean'
      ? gsmDisabled
      : env.GSM_DISABLED === 'true' || String(env.GSM_ENABLED || '').toLowerCase() === 'off',
    storageWriteGuardEnabled: typeof storageWriteGuardEnabled === 'boolean'
      ? storageWriteGuardEnabled
      : env.PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE === 'true',
    schemaCompatibilityDisabled:
      env.PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY !== 'true',
    cleanResetDisabled: env.SKYTECH_CLEAN_RESET_ENABLED !== 'true',
    adminResetDisabled: !String(env.ADMIN_RESET_PASSWORD || ''),
  };
}

function readExpectedBundleFileSha256(dbPath) {
  const pinPath = path.join(path.dirname(path.resolve(dbPath)), AUTHORIZED_BUNDLE_PIN_FILENAME);
  let descriptor;
  try {
    descriptor = fs.openSync(
      pinPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile()
      || stat.nlink !== 1
      || (stat.mode & 0o022) !== 0
      || stat.size < 64
      || stat.size > 65
    ) return null;
    const value = fs.readFileSync(descriptor, 'utf8');
    if (!/^[a-f0-9]{64}\n?$/.test(value)) return null;
    return value.trim();
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
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
    getExpectedBundleFileSha256 = () => readExpectedBundleFileSha256(dbPath),
    getRuntimeIdentity = () => runtimeIdentityFromEnv(),
    getConservationState = () => buildProductionScopeConservationState(),
    now = () => new Date(),
    consumeRequest = consumeOperationRequest,
    validateExecutionBundle = validateProductionScopeExecutionBundle,
    logger = console,
    runner = { runApply, runBackup, runPreflight, runVerify },
  } = deps;
  let operationInFlight = false;

  function actualDeployedSha() {
    const info = typeof buildInfo === 'function' ? buildInfo() : (buildInfo || {});
    return String(info?.commitFull || '');
  }

  function actualDeploymentId() {
    const info = typeof buildInfo === 'function' ? buildInfo() : (buildInfo || {});
    return String(info?.deployment?.railwayDeploymentId || '').trim().toLowerCase();
  }

  function planMatchesEnvironment(candidatePlan) {
    return Boolean(
      candidatePlan?.sourceDbPath
      && path.resolve(candidatePlan.sourceDbPath) === path.resolve(expectedEnvironment.sourceDbPath)
      && candidatePlan?.authority?.companyId === expectedEnvironment.canonicalCompanyId
      && candidatePlan?.authority?.tenantId === expectedEnvironment.canonicalCompanyId
    );
  }

  function resolveSignedRequestPlan(body) {
    const hasEncodedBundle = Object.prototype.hasOwnProperty.call(
      body || {},
      'executionBundleBase64',
    );
    const hasFileHash = Object.prototype.hasOwnProperty.call(
      body || {},
      'executionBundleFileSha256',
    );
    const expectedBundleFileSha256 = String(getExpectedBundleFileSha256() || '').trim();
    const exactBundlePinConfigured = /^[a-f0-9]{64}$/.test(expectedBundleFileSha256);
    if (!hasEncodedBundle && !hasFileHash) {
      fail(
        'EXECUTION_BUNDLE_REQUIRED',
        'An explicitly supplied, authorized, and independently pinned execution bundle is required.',
        403,
      );
    }
    if (
      !hasEncodedBundle
      || !hasFileHash
      || Object.prototype.hasOwnProperty.call(body || {}, 'executionBundle')
      || typeof body.executionBundleBase64 !== 'string'
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.executionBundleBase64)
      || !/^[a-f0-9]{64}$/.test(body.executionBundleFileSha256)
    ) {
      fail('EXECUTION_BUNDLE_BYTES_INVALID', 'The signed execution bundle bytes are invalid.', 403);
    }
    if (!exactBundlePinConfigured) {
      fail('EXECUTION_BUNDLE_PIN_NOT_CONFIGURED', 'Not found', 404);
    }
    if (body.executionBundleFileSha256 !== expectedBundleFileSha256) {
      fail(
        'EXECUTION_BUNDLE_EXTERNAL_PIN_MISMATCH',
        'The signed execution bundle does not match the independently provisioned hash.',
        403,
      );
    }
    const bundleBytes = Buffer.from(body.executionBundleBase64, 'base64');
    if (
      bundleBytes.length === 0
      || bundleBytes.length > MAX_AUTHORIZED_BUNDLE_BYTES
      || bundleBytes.toString('base64') !== body.executionBundleBase64
      || crypto.createHash('sha256').update(bundleBytes).digest('hex')
        !== body.executionBundleFileSha256
    ) {
      fail('EXECUTION_BUNDLE_FILE_HASH_MISMATCH', 'The signed execution bundle file hash differs.', 403);
    }
    let executionBundle;
    try {
      executionBundle = JSON.parse(bundleBytes.toString('utf8'));
    } catch {
      fail('EXECUTION_BUNDLE_JSON_INVALID', 'The signed execution bundle is invalid JSON.', 403);
    }
    let validated;
    try {
      validated = validateExecutionBundle(executionBundle, { requireAuthorized: true });
    } catch (error) {
      fail(
        typeof error?.code === 'string' ? error.code : 'EXECUTION_BUNDLE_INVALID',
        'The signed execution bundle is invalid.',
        403,
      );
    }
    const requestedPlan = validated?.plan;
    const deployedSha = actualDeployedSha().trim().toLowerCase();
    const signedDeploymentIdentity = {
      serviceInstanceId: String(body?.deploymentIdentity?.serviceInstanceId || '')
        .trim().toLowerCase(),
      deploymentInstanceId: String(body?.deploymentIdentity?.deploymentInstanceId || '')
        .trim().toLowerCase(),
    };
    const bundledDeploymentIdentity = {
      serviceInstanceId: String(executionBundle?.source?.deploymentIdentity?.serviceInstanceId || '')
        .trim().toLowerCase(),
      deploymentInstanceId: String(executionBundle?.source?.deploymentIdentity?.deploymentInstanceId || '')
        .trim().toLowerCase(),
    };
    const signedRequestRailwayIdentity = signedRailwayIdentity(body?.railwayIdentity);
    const bundledRailwayIdentity = signedRailwayIdentity(
      executionBundle?.source?.railwayIdentity,
    );
    const approvedRailwayIdentity = signedRailwayIdentity(expectedEnvironment);
    const runtimeReplicaId = String(getRuntimeIdentity()?.replicaId || '').trim().toLowerCase();
    if (
      validated?.authorized !== true
      || requestedPlan?.executionScope !== 'IDENTITY_ONLY'
      || executionBundle?.authorization?.authorizedExecutionSha !== deployedSha
      || executionBundle?.source?.captureDeployedSha !== deployedSha
      || executionBundle?.source?.captureDeploymentId !== actualDeploymentId()
      || !UUID_PATTERN.test(signedDeploymentIdentity.serviceInstanceId)
      || !UUID_PATTERN.test(signedDeploymentIdentity.deploymentInstanceId)
      || JSON.stringify(signedDeploymentIdentity) !== JSON.stringify(bundledDeploymentIdentity)
      || JSON.stringify(bundledRailwayIdentity) !== JSON.stringify(signedRequestRailwayIdentity)
      || JSON.stringify(bundledRailwayIdentity) !== JSON.stringify(approvedRailwayIdentity)
      || runtimeReplicaId !== bundledDeploymentIdentity.deploymentInstanceId
      || !planMatchesEnvironment(requestedPlan)
    ) {
      fail(
        'IDENTITY_EXECUTION_BUNDLE_RUNTIME_MISMATCH',
        'The signed identity bundle does not match this exact deployed runtime and target.',
        403,
      );
    }
    return requestedPlan;
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
      && planMatchesEnvironment(plan)
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
    const requestPlan = resolveSignedRequestPlan(req.body);
    consumeRequest({
      dbPath,
      requestId: authorization.requestId,
      mode,
      issuedAt: authorization.issuedAt,
      expiresAt: authorization.expiresAt,
    });
    return { railwayIdentity, authorization, plan: requestPlan };
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
        return await handler(req, res, authorization.railwayIdentity, authorization.plan);
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
    guarded('preflight', async (req, res, railwayIdentity, requestPlan) => {
      const result = await runner.runPreflight({
        dbPath,
        plan: requestPlan,
        expectedDeployedSha: req.body?.expectedDeployedSha,
        actualDeployedSha: actualDeployedSha(),
        railwayIdentity,
      });
      return res.json({ ok: true, result });
    }),
  );

  router.post(
    '/admin/production-scope-remediation/backup',
    guarded('backup', async (req, res, railwayIdentity, requestPlan) => {
      const result = await runner.runBackup({
        dbPath,
        plan: requestPlan,
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
    guarded('apply', async (req, res, railwayIdentity, requestPlan) => {
      const result = await runner.runApply({
        dbPath,
        plan: requestPlan,
        receipt: req.body?.backup,
        expectedDeployedSha: req.body?.expectedDeployedSha,
        actualDeployedSha: actualDeployedSha(),
        expectedAuthorityConfigChecksum: req.body?.expectedAuthorityConfigChecksum,
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
    guarded('verify', async (req, res, railwayIdentity, requestPlan) => {
      const result = await runner.runVerify({
        dbPath,
        plan: requestPlan,
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
  AUTHORIZED_BUNDLE_PIN_FILENAME,
  ProductionScopeRouteError,
  buildProductionScopeConservationState,
  readExpectedBundleFileSha256,
  registerProductionScopeRemediationRoutes,
  runtimeIdentityFromEnv,
  signedRailwayIdentity,
};
