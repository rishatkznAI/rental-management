const {
  createPlatformIdentityRepository,
} = require('./platform-identity-repository');
const {
  calculateBootstrapChecksum,
  getSchemaFingerprint,
  getUsersDirectoryFingerprint,
  inspectPlatformIdentity,
  planPlatformIdentityBootstrap,
  readUsersDirectorySnapshot,
  validateBootstrapConfig,
} = require('./platform-identity-bootstrap-validation');

function applyPlatformIdentityBootstrap(db, config, options = {}) {
  if (options.explicitApply !== true) {
    throw Object.assign(new Error('Bootstrap apply requires explicit --apply.'), {
      code: 'BOOTSTRAP_EXPLICIT_APPLY_REQUIRED',
    });
  }
  const plan = planPlatformIdentityBootstrap(db, config);
  if (!plan.ok) {
    throw Object.assign(new Error('Bootstrap validation has blockers.'), {
      code: 'BOOTSTRAP_BLOCKED',
      blockers: plan.blockers,
    });
  }
  if (options.expectedChecksum !== plan.configChecksum) {
    throw Object.assign(new Error('Bootstrap checksum confirmation mismatch.'), {
      code: 'BOOTSTRAP_CHECKSUM_CONFIRMATION_MISMATCH',
    });
  }
  if (typeof options.afterPlanBeforeTransaction === 'function') {
    options.afterPlanBeforeTransaction(plan);
  }

  const repository = createPlatformIdentityRepository(db, {
    nowIso: options.nowIso,
    generateId: options.generateId,
    readUsers: () => readUsersDirectorySnapshot(db).users,
    beforeAuditInsert: options.beforeAuditInsert,
  });
  return repository.applyBootstrapPlan(plan);
}

function runPlatformIdentityBootstrap({ db, mode, config, env, ...options }) {
  if (mode === 'inspect') return inspectPlatformIdentity(db, env);
  if (mode === 'validate') return validateBootstrapConfig(db, config);
  if (mode === 'plan') return planPlatformIdentityBootstrap(db, config);
  if (mode === 'apply') return applyPlatformIdentityBootstrap(db, config, options);
  throw Object.assign(new Error('Bootstrap mode must be inspect, validate, plan, or apply.'), {
    code: 'BOOTSTRAP_MODE_INVALID',
  });
}

module.exports = {
  applyPlatformIdentityBootstrap,
  calculateBootstrapChecksum,
  getSchemaFingerprint,
  getUsersDirectoryFingerprint,
  inspectPlatformIdentity,
  planPlatformIdentityBootstrap,
  runPlatformIdentityBootstrap,
  validateBootstrapConfig,
};
