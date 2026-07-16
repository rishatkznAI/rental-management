// PR5 intentionally leaves the production canonical route boundary unmapped.
// Feature enablement and trusted-scope mapping remain independent gates.
function resolveCanonicalReceivablesTrustedScope() {
  return null;
}

module.exports = {
  resolveCanonicalReceivablesTrustedScope,
};
