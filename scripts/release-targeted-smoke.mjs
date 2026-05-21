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

function executionFieldsPresent(items) {
  if (!Array.isArray(items) || items.length === 0) return true;
  return items.every(item =>
    Object.prototype.hasOwnProperty.call(item, 'executionStatus') &&
    Object.prototype.hasOwnProperty.call(item, 'executionLabel') &&
    Object.prototype.hasOwnProperty.call(item, 'executionOverdue')
  );
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

  const login = await timedJson(apiUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
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
    storageClassification: scc.json?.storage?.classification || 'unknown',
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
    summaryCount: summaryCount(actionQueue.json?.summary),
    executionFieldsPresent: true,
  });

  console.log('[targeted-smoke] PASS');
}

main().catch(error => {
  console.error(`[targeted-smoke] FAIL: ${error.message}`);
  process.exit(1);
});
