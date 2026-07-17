const {
  assertCapability,
} = require('./platform-authorization');

function createCanonicalReceivablesScopeAdapter({ resolvePlatformScope } = {}) {
  if (typeof resolvePlatformScope !== 'function') {
    throw new Error('A platform trusted-scope resolver is required.');
  }
  return async function resolveCanonicalScope(context) {
    const scope = await resolvePlatformScope(context);
    if (!scope) return null;
    assertCapability(scope, 'receivables.read');
    if (!Array.isArray(scope.allowedBranchIds) || scope.allowedBranchIds.length === 0) {
      return null;
    }
    return Object.freeze({
      authenticated: true,
      principalId: scope.principalId,
      companyId: scope.companyId,
      capabilities: Object.freeze([...scope.capabilities]),
      companyWideBranchAccess: scope.companyWideBranchAuthority === true,
      allowedBranchIds: Object.freeze([...scope.allowedBranchIds]),
      receivablesTimezone: scope.companyTimezone,
    });
  };
}

module.exports = {
  createCanonicalReceivablesScopeAdapter,
};
