const KNOWN_TAX_REGIMES = new Set(['OSNO', 'USN', 'USN_VAT_EXEMPT', 'USN_VAT', 'PATENT', 'OTHER']);
const VAT_ENABLED_REGIMES = new Set(['OSNO', 'USN_VAT']);
const VAT_EXEMPT_REGIMES = new Set(['USN', 'USN_VAT_EXEMPT', 'PATENT']);

function roundMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

function normalizeTaxRegime(settings = {}) {
  const raw = String(settings?.taxRegime || '').trim().toUpperCase();
  if (!raw) return { taxRegime: 'unknown', status: 'unknown', reason: 'tax_regime_missing' };
  if (!KNOWN_TAX_REGIMES.has(raw)) return { taxRegime: raw, status: 'unknown', reason: 'tax_regime_unknown' };
  return { taxRegime: raw, status: 'known', reason: 'tax_regime_configured' };
}

function isPositiveRate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function getVatPolicy(companySettings = {}, date) {
  const normalized = normalizeTaxRegime(companySettings);
  if (normalized.status === 'unknown') {
    return {
      ...normalized,
      vatApplied: false,
      vatRate: 0,
      vatMode: 'unknown',
      vatIncluded: Boolean(companySettings?.vatIncludedByDefault),
      inputVatEnabled: false,
      outputVatEnabled: false,
      date: date || '',
    };
  }

  const vatMode = String(companySettings?.vatMode || '').trim().toLowerCase() || 'none';
  const defaultVatRate = isPositiveRate(companySettings?.defaultVatRate)
    ? Number(companySettings.defaultVatRate)
    : 0;
  const outputVatEnabled = companySettings?.outputVatEnabled === true;
  const inputVatEnabled = companySettings?.inputVatEnabled === true;
  const regimeAllowsVat = VAT_ENABLED_REGIMES.has(normalized.taxRegime);
  const regimeExemptsVat = VAT_EXEMPT_REGIMES.has(normalized.taxRegime);
  const vatApplied = !regimeExemptsVat
    && vatMode !== 'none'
    && defaultVatRate > 0
    && (regimeAllowsVat || vatMode === 'custom' || outputVatEnabled);

  return {
    ...normalized,
    vatApplied,
    vatRate: vatApplied ? defaultVatRate : 0,
    vatMode,
    vatIncluded: Boolean(companySettings?.vatIncludedByDefault),
    inputVatEnabled,
    outputVatEnabled,
    date: date || '',
    reason: vatApplied
      ? 'vat_policy_applied'
      : regimeExemptsVat
        ? 'tax_regime_vat_exempt'
        : defaultVatRate <= 0
          ? 'vat_rate_missing'
          : 'vat_disabled',
  };
}

function splitAmountVatIncluded(grossAmount, vatRate) {
  const gross = roundMoney(grossAmount);
  const rate = Number(vatRate);
  if (!Number.isFinite(rate) || rate <= 0) return { grossAmount: gross, netAmount: gross, vatAmount: 0 };
  const netAmount = roundMoney(gross / (1 + rate / 100));
  return {
    grossAmount: gross,
    netAmount,
    vatAmount: roundMoney(gross - netAmount),
  };
}

function addVatToNet(netAmount, vatRate) {
  const net = roundMoney(netAmount);
  const rate = Number(vatRate);
  if (!Number.isFinite(rate) || rate <= 0) return { grossAmount: net, netAmount: net, vatAmount: 0 };
  const vatAmount = roundMoney(net * rate / 100);
  return {
    grossAmount: roundMoney(net + vatAmount),
    netAmount: net,
    vatAmount,
  };
}

function calculateVatBreakdown(amount, options = {}) {
  const numericAmount = roundMoney(amount);
  const policy = options.companySettings
    ? getVatPolicy(options.companySettings, options.date)
    : {
        taxRegime: options.taxRegime || 'unknown',
        status: options.taxRegime ? 'known' : 'unknown',
        vatApplied: Boolean(options.vatApplied ?? options.outputVatEnabled),
        vatRate: isPositiveRate(options.vatRate) ? Number(options.vatRate) : 0,
        vatIncluded: Boolean(options.vatIncluded),
        reason: options.taxRegime ? 'vat_options_applied' : 'tax_regime_missing',
      };

  if (policy.status === 'unknown') {
    return {
      grossAmount: numericAmount,
      netAmount: numericAmount,
      vatAmount: 0,
      vatRate: 0,
      vatApplied: false,
      vatIncluded: Boolean(policy.vatIncluded),
      taxRegime: 'unknown',
      status: 'unknown',
      reason: policy.reason || 'tax_regime_missing',
    };
  }

  if (!policy.vatApplied || !isPositiveRate(policy.vatRate)) {
    return {
      grossAmount: numericAmount,
      netAmount: numericAmount,
      vatAmount: 0,
      vatRate: 0,
      vatApplied: false,
      vatIncluded: Boolean(policy.vatIncluded),
      taxRegime: policy.taxRegime,
      status: 'calculated',
      reason: policy.reason || 'vat_not_applied',
    };
  }

  const amounts = policy.vatIncluded
    ? splitAmountVatIncluded(numericAmount, policy.vatRate)
    : addVatToNet(numericAmount, policy.vatRate);

  return {
    ...amounts,
    vatRate: Number(policy.vatRate),
    vatApplied: true,
    vatIncluded: Boolean(policy.vatIncluded),
    taxRegime: policy.taxRegime,
    status: 'calculated',
    reason: policy.reason || 'vat_calculated',
  };
}

module.exports = {
  calculateVatBreakdown,
  normalizeTaxRegime,
  getVatPolicy,
  splitAmountVatIncluded,
  addVatToNet,
};
