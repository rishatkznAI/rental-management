const UNSAFE_KEY_PATTERN = /password|pass(hash)?|token|cookie|secret|private[-_ ]?key|authorization|auth[-_ ]?header|raw[-_ ]?env|database[-_ ]?url|db[-_ ]?url/i;
const UNSAFE_STRING_PATTERN = /\bundefined\b|\bnull\b|\[object Object\]|Bearer\s+|sk-[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/|sqlite:\/\/|mongodb(?:\+srv)?:\/\//i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function describePath(path) {
  return path.length ? path.join('.') : '<root>';
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function moneyClose(left, right) {
  return Math.abs(toNumber(left) - toNumber(right)) < 0.01;
}

export function findUnsafeFinanceSmokePayloadViolations(value, path = []) {
  const violations = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      violations.push(...findUnsafeFinanceSmokePayloadViolations(item, [...path, String(index)]));
    });
    return violations;
  }

  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, entryValue]) => {
      const nextPath = [...path, key];
      if (UNSAFE_KEY_PATTERN.test(key)) {
        violations.push(`unsafe key at ${describePath(nextPath)}`);
      }
      violations.push(...findUnsafeFinanceSmokePayloadViolations(entryValue, nextPath));
    });
    return violations;
  }

  if (typeof value === 'string' && UNSAFE_STRING_PATTERN.test(value)) {
    violations.push(`unsafe string at ${describePath(path)}`);
  }

  return violations;
}

export function assertNoUnsafeFinanceSmokePayload(payload) {
  const violations = findUnsafeFinanceSmokePayloadViolations(payload);
  if (violations.length > 0) {
    throw new Error(`finance smoke payload contains unsafe fields: ${violations.join(', ')}`);
  }
}

export function hasUnsafeFinanceSmokeText(text) {
  return UNSAFE_STRING_PATTERN.test(String(text || ''));
}

export function assertCashFlowResponseShape(payload) {
  if (!isPlainObject(payload)) throw new Error('cash flow response must be an object');
  if (!isPlainObject(payload.summary)) throw new Error('cash flow summary must be an object');
  if (!Array.isArray(payload.periods)) throw new Error('cash flow periods must be an array');
  if (!Array.isArray(payload.items)) throw new Error('cash flow items must be an array');
  if (!Array.isArray(payload.warnings)) throw new Error('cash flow warnings must be an array');

  for (const key of ['outgoingTotal', 'netCashFlow', 'closingBalanceForecast']) {
    if (!Number.isFinite(Number(payload.summary[key]))) {
      throw new Error(`cash flow summary.${key} must be numeric`);
    }
  }

  for (const item of payload.items) {
    if (!isPlainObject(item)) throw new Error('cash flow item must be an object');
    if (!['incoming', 'outgoing', 'non_cash'].includes(String(item.direction || ''))) {
      throw new Error('cash flow item direction must be incoming, outgoing, or non_cash');
    }
    if (!Number.isFinite(Number(item.amount))) throw new Error('cash flow item amount must be numeric');
  }
}

export function assertCashFlowTotalsRemainCashOnly(payload) {
  assertCashFlowResponseShape(payload);
  const items = payload.items;
  const summary = payload.summary;
  const incomingTotal = items.filter(item => item.direction === 'incoming').reduce((sum, item) => sum + toNumber(item.amount), 0);
  const outgoingTotal = items.filter(item => item.direction === 'outgoing').reduce((sum, item) => sum + toNumber(item.amount), 0);

  if (Number.isFinite(Number(summary.incomingTotal)) && !moneyClose(summary.incomingTotal, incomingTotal)) {
    throw new Error('cash flow incomingTotal must equal incoming cash items');
  }
  if (!moneyClose(summary.outgoingTotal, outgoingTotal)) {
    throw new Error('cash flow outgoingTotal must equal outgoing cash items only');
  }
  if (Number.isFinite(Number(summary.incomingTotal)) && !moneyClose(summary.netCashFlow, toNumber(summary.incomingTotal) - toNumber(summary.outgoingTotal))) {
    throw new Error('cash flow netCashFlow must equal incomingTotal minus outgoingTotal');
  }
  if (Number.isFinite(Number(summary.openingBalance)) && !moneyClose(summary.closingBalanceForecast, toNumber(summary.openingBalance) + toNumber(summary.netCashFlow))) {
    throw new Error('cash flow closingBalanceForecast must not include non-cash adjustments');
  }
}

export function assertDepreciationIsNonCash(payload) {
  assertCashFlowTotalsRemainCashOnly(payload);
  const depreciationItems = payload.items.filter(item => item.type === 'depreciation');
  if (depreciationItems.some(item => item.direction !== 'non_cash')) {
    throw new Error('depreciation items must be non_cash');
  }
  if (depreciationItems.some(item => item.direction === 'outgoing')) {
    throw new Error('depreciation must not be outgoing cash');
  }

  const depreciationTotal = depreciationItems.reduce((sum, item) => sum + toNumber(item.amount), 0);
  if (depreciationTotal > 0) {
    if (!moneyClose(payload.summary.depreciationTotal, depreciationTotal)) {
      throw new Error('cash flow depreciationTotal must equal non-cash depreciation items');
    }
    if (!Number.isFinite(Number(payload.summary.nonCashAdjustments))) {
      throw new Error('cash flow nonCashAdjustments must be numeric when depreciation is present');
    }
    if (!isPlainObject(payload.summary.economicsOverlay)) {
      throw new Error('cash flow economicsOverlay must be present when depreciation is included');
    }
  }
}

export function assertTaxSettingsSafe(payload) {
  if (!isPlainObject(payload)) throw new Error('tax settings response must be an object');
  assertNoUnsafeFinanceSmokePayload(payload);
}

export function assertEconomicsResponseSafe(payload, { restricted = false } = {}) {
  if (!isPlainObject(payload)) throw new Error('equipment economics response must be an object');
  assertNoUnsafeFinanceSmokePayload(payload);
  if (restricted) return;

  if (!isPlainObject(payload.finance)) throw new Error('equipment economics finance must be an object');
  if (!isPlainObject(payload.depreciation)) throw new Error('equipment economics depreciation must be an object');
  for (const key of ['monthlyDepreciation', 'accumulatedDepreciation', 'residualValue']) {
    if (!Number.isFinite(Number(payload.depreciation[key]))) {
      throw new Error(`equipment economics depreciation.${key} must be numeric`);
    }
  }
}

export function financeSmokeSummary(payload) {
  const summary = isPlainObject(payload?.summary) ? payload.summary : {};
  const depreciationItems = Array.isArray(payload?.items)
    ? payload.items.filter(item => item?.type === 'depreciation').length
    : 0;
  return {
    items: Array.isArray(payload?.items) ? payload.items.length : 0,
    periods: Array.isArray(payload?.periods) ? payload.periods.length : 0,
    depreciationItems,
    nonCashAdjustments: Number.isFinite(Number(summary.nonCashAdjustments)),
  };
}
