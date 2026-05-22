#!/usr/bin/env node

const ENVIRONMENTS = new Set(['staging', 'production']);

function parseArgs(argv) {
  const args = { env: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env') args.env = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node scripts/release-targeted-smoke.mjs --env staging
  node scripts/release-targeted-smoke.mjs --env production

Required env by mode:
  STAGING_API_URL, STAGING_ADMIN_EMAIL, STAGING_ADMIN_PASSWORD
  PRODUCTION_API_URL, PRODUCTION_ADMIN_EMAIL, PRODUCTION_ADMIN_PASSWORD`);
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeUrl(value = '') {
  return String(value || '').trim().replace(/\/$/, '');
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function summaryCount(summary) {
  if (!summary || typeof summary !== 'object') return 0;
  if (Number.isFinite(Number(summary.total))) return Number(summary.total);
  return Object.values(summary).reduce((total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
}

function hasUnsafeText(value) {
  const text = JSON.stringify(value);
  return /password|token|secret|Bearer\s+|undefined|\[object Object\]/i.test(text);
}

function hasUnsafeKey(value, unsafeKeys) {
  if (Array.isArray(value)) return value.some(item => hasUnsafeKey(item, unsafeKeys));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => unsafeKeys.has(String(key).toLowerCase()) || hasUnsafeKey(child, unsafeKeys));
}

function textFieldsSafe(value) {
  if (Array.isArray(value)) return value.every(textFieldsSafe);
  if (!value || typeof value !== 'object') return true;
  return Object.entries(value).every(([key, child]) => {
    if (typeof child === 'string' && /(label|text|name|number|reason|action|scenario|model|inventory)/i.test(key)) {
      return child.trim() !== '' && !/undefined|null|\[object Object\]/.test(child);
    }
    return textFieldsSafe(child);
  });
}

function executionFieldsPresent(items) {
  if (!Array.isArray(items) || items.length === 0) return true;
  return items.every(item =>
    Object.prototype.hasOwnProperty.call(item, 'executionStatus') &&
    Object.prototype.hasOwnProperty.call(item, 'executionLabel') &&
    Object.prototype.hasOwnProperty.call(item, 'executionOverdue')
  );
}

function safeAssigneeFieldsPresent(items) {
  if (!Array.isArray(items)) return false;
  return items.every(item =>
    Object.prototype.hasOwnProperty.call(item, 'userId') &&
    Object.prototype.hasOwnProperty.call(item, 'name') &&
    Object.prototype.hasOwnProperty.call(item, 'role') &&
    Object.prototype.hasOwnProperty.call(item, 'active')
  );
}

function hasObjectKey(value, key) {
  if (Array.isArray(value)) return value.some(item => hasObjectKey(item, key));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([entryKey, entryValue]) => entryKey === key || hasObjectKey(entryValue, key));
}

function unsafeAssigneeFieldsAbsent(payload) {
  return ['email', 'password', 'passwordHash', 'token', 'secret'].every(key => !hasObjectKey(payload, key));
}

function repeatBreakdownsShapeValid(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.ok !== true) return false;
  if (!payload.summary || typeof payload.summary !== 'object') return false;
  if (!Array.isArray(payload.items)) return false;
  if (!payload.groups || typeof payload.groups !== 'object') return false;
  for (const key of ['totalRepeats', 'repeatWithin7', 'repeatWithin14', 'repeatWithin30', 'critical', 'high', 'medium', 'low']) {
    if (!Number.isFinite(Number(payload.summary[key]))) return false;
  }
  for (const key of ['byEquipment', 'byMechanic', 'byModel', 'byScenario']) {
    if (!Array.isArray(payload.groups[key])) return false;
  }
  return payload.items.every(item => (
    item
    && typeof item === 'object'
    && ['critical', 'high', 'medium', 'low'].includes(item.repeatSeverity)
    && [7, 14, 30].includes(Number(item.repeatWindow))
    && Number.isFinite(Number(item.daysBetween))
    && item.links
    && typeof item.links === 'object'
  ));
}

async function timedJson(baseUrl, path, options = {}) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'follow',
    ...options,
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      ...(options.headers || {}),
    },
  });
  const durationMs = Math.round(performance.now() - started);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} did not return JSON. HTTP ${response.status}. Body length=${text.length}`);
  }
  return { response, durationMs, json };
}

function logProbe(label, result, extra = {}) {
  const line = {
    status: result.response.status,
    durationMs: result.durationMs,
    ...extra,
  };
  console.log(`[targeted-smoke] ${label} ${JSON.stringify(line)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!ENVIRONMENTS.has(args.env)) {
    printUsage();
    throw new Error('--env must be staging or production');
  }

  const prefix = args.env === 'staging' ? 'STAGING' : 'PRODUCTION';
  const apiUrl = normalizeUrl(requiredEnv(`${prefix}_API_URL`));
  const email = requiredEnv(`${prefix}_ADMIN_EMAIL`);
  const password = requiredEnv(`${prefix}_ADMIN_PASSWORD`);

  console.log(`[targeted-smoke] environment=${args.env}`);

  const health = await timedJson(apiUrl, '/health');
  assertOk(health.response.status === 200, `/health must return 200. HTTP ${health.response.status}`);
  assertOk(health.json?.ok === true, '/health JSON must include ok=true');
  logProbe('health', health);

  const ready = await timedJson(apiUrl, '/health/ready');
  assertOk(ready.response.status === 200, `/health/ready must return 200. HTTP ${ready.response.status}`);
  assertOk(ready.json?.ok === true, '/health/ready JSON must include ok=true');
  logProbe('ready', ready);

  const version = await timedJson(apiUrl, '/api/version');
  assertOk(version.response.status === 200, `/api/version must return 200. HTTP ${version.response.status}`);
  assertOk(version.json?.ok === true, '/api/version JSON must include ok=true');
  logProbe('version', version, {
    appDisabled: version.json?.app?.disabled === true,
  });

  const login = await timedJson(apiUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (args.env === 'production' && version.json?.app?.disabled === true) {
    assertOk(login.response.status === 503, `/api/auth/login must return 503 when app.disabled=true. HTTP ${login.response.status}`);
    console.log(`[targeted-smoke] login ${JSON.stringify({ status: login.response.status, durationMs: login.durationMs, appDisabled: true })}`);
    console.log('[targeted-smoke] Production is conserved: login HTTP 503 is expected.');
    console.log('[targeted-smoke] PASS');
    return;
  }

  assertOk(login.response.status === 200, `/api/auth/login must return 200. HTTP ${login.response.status}`);
  const token = login.json?.token;
  assertOk(token, '/api/auth/login must return a token');
  console.log(`[targeted-smoke] login ${JSON.stringify({ status: login.response.status, durationMs: login.durationMs })}`);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const scc = await timedJson(apiUrl, '/api/admin/system-control-center', { headers: authHeaders });
  assertOk(scc.response.status === 200, `/api/admin/system-control-center must return 200. HTTP ${scc.response.status}`);
  assertOk(!hasUnsafeText(scc.json), '/api/admin/system-control-center exposed unsafe text or raw placeholder values');
  logProbe('SCC', scc, {
    appDisabled: Boolean(scc.json?.conservation?.appDisabled),
    botDisabled: Boolean(scc.json?.conservation?.botDisabled),
    gsmDisabled: Boolean(scc.json?.conservation?.gsmDisabled),
    storageClassification: scc.json?.storage?.classification || scc.json?.database?.dbPathKind || 'unknown',
  });

  const readiness = await timedJson(apiUrl, '/api/equipment/readiness', { headers: authHeaders });
  assertOk(readiness.response.status === 200, `/api/equipment/readiness must return 200. HTTP ${readiness.response.status}`);
  assertOk(!hasUnsafeText(readiness.json), '/api/equipment/readiness exposed unsafe text or raw placeholder values');
  logProbe('readiness', readiness, {
    items: Array.isArray(readiness.json?.items) ? readiness.json.items.length : 0,
    summaryCount: summaryCount(readiness.json?.summary),
  });

  const actionQueue = await timedJson(apiUrl, '/api/management/action-queue', { headers: authHeaders });
  assertOk(actionQueue.response.status === 200, `/api/management/action-queue must return 200. HTTP ${actionQueue.response.status}`);
  assertOk(!hasUnsafeText(actionQueue.json), '/api/management/action-queue exposed unsafe text or raw placeholder values');
  assertOk(executionFieldsPresent(actionQueue.json?.items), '/api/management/action-queue items must expose execution fields');
  logProbe('actionQueue', actionQueue, {
    items: Array.isArray(actionQueue.json?.items) ? actionQueue.json.items.length : 0,
    summaryUnassigned: Number(actionQueue.json?.summary?.unassigned || 0),
    summaryOverdue: Number(actionQueue.json?.summary?.overdue || 0),
    summaryDueToday: Number(actionQueue.json?.summary?.dueToday || 0),
    summaryStale: Number(actionQueue.json?.summary?.stale || 0),
    summaryInProgress: Number(actionQueue.json?.summary?.inProgress || 0),
    summaryResolved: Number(actionQueue.json?.summary?.resolved || 0),
    executionStatusPresent: true,
    executionLabelPresent: true,
    executionOverduePresent: true,
  });

  const assignees = await timedJson(apiUrl, '/api/management/action-queue/assignees', { headers: authHeaders });
  assertOk(assignees.response.status === 200, `/api/management/action-queue/assignees must return 200. HTTP ${assignees.response.status}`);
  assertOk(!hasUnsafeText(assignees.json), '/api/management/action-queue/assignees exposed unsafe text or raw placeholder values');
  assertOk(safeAssigneeFieldsPresent(assignees.json?.items), '/api/management/action-queue/assignees must expose safe fields');
  assertOk(unsafeAssigneeFieldsAbsent(assignees.json), '/api/management/action-queue/assignees must not expose unsafe fields');
  logProbe('assignees', assignees, {
    items: Array.isArray(assignees.json?.items) ? assignees.json.items.length : 0,
    safeFieldsPresent: true,
    unsafeFieldsAbsent: true,
  });

  const repeatBreakdowns = await timedJson(apiUrl, '/api/service/repeat-breakdowns', { headers: authHeaders });
  assertOk(repeatBreakdowns.response.status === 200, `/api/service/repeat-breakdowns must return 200. HTTP ${repeatBreakdowns.response.status}`);
  assertOk(repeatBreakdownsShapeValid(repeatBreakdowns.json), '/api/service/repeat-breakdowns returned an unexpected response shape');
  assertOk(!hasUnsafeText(repeatBreakdowns.json), '/api/service/repeat-breakdowns exposed unsafe text or raw placeholder values');
  assertOk(!hasUnsafeKey(repeatBreakdowns.json, new Set(['email', 'password', 'passwordhash', 'token', 'secret', 'hash'])), '/api/service/repeat-breakdowns exposed unsafe fields');
  assertOk(textFieldsSafe(repeatBreakdowns.json), '/api/service/repeat-breakdowns exposed unsafe label/text placeholders');
  logProbe('repeatBreakdowns', repeatBreakdowns, {
    items: repeatBreakdowns.json.items.length,
    summaryKeys: Object.keys(repeatBreakdowns.json.summary || {}).sort(),
    groups: Object.fromEntries(Object.entries(repeatBreakdowns.json.groups || {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])),
    totalRepeats: Number(repeatBreakdowns.json.summary.totalRepeats || 0),
    repeatWithin7: Number(repeatBreakdowns.json.summary.repeatWithin7 || 0),
    repeatWithin14: Number(repeatBreakdowns.json.summary.repeatWithin14 || 0),
    repeatWithin30: Number(repeatBreakdowns.json.summary.repeatWithin30 || 0),
    critical: Number(repeatBreakdowns.json.summary.critical || 0),
    high: Number(repeatBreakdowns.json.summary.high || 0),
    medium: Number(repeatBreakdowns.json.summary.medium || 0),
    low: Number(repeatBreakdowns.json.summary.low || 0),
  });

  console.log('[targeted-smoke] PASS');
}

main().catch(error => {
  console.error(`[targeted-smoke] FAIL: ${error.message}`);
  process.exit(1);
});
