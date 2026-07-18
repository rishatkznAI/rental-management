// PR7 intentionally leaves the production forecast-read boundary unmapped.
// Feature-flag enablement and an approved forecast scope adapter are separate
// future production gates.
function resolveForecastReceivablesTrustedScope() {
  return null;
}

module.exports = {
  resolveForecastReceivablesTrustedScope,
};
