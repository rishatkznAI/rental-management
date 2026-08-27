#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_ONLY_LOGIN_SENTINEL,
  PRE_COMPATIBILITY_BACKUP_ONLY_MODE,
  validateConservedProductionLogin,
} from './release-conservation-contract.mjs';
import { validateExactGitSha } from './railway-backend-release.mjs';

export const HISTORICAL_RECOVERY_API_ORIGIN = 'https://api.skytech-rent.ru';
const MAX_JSON_BYTES = 1024 * 1024;

function exactString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`${label} must be an exact nonblank string`);
  }
  return value;
}

function validateOrigin(value) {
  const origin = new URL(exactString(value, 'API origin'));
  if (
    origin.protocol !== 'https:'
    || origin.username
    || origin.password
    || origin.search
    || origin.hash
    || origin.pathname !== '/'
    || origin.origin !== HISTORICAL_RECOVERY_API_ORIGIN
  ) {
    throw new Error('API origin must be the exact canonical production HTTPS origin');
  }
  return origin.origin;
}

async function readLimitedJson(response, label) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_JSON_BYTES) {
      throw new Error(`${label} response content length is unsafe`);
    }
  }
  if (!response.body) throw new Error(`${label} response body is missing`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new Error(`${label} response exceeds the byte limit`);
    }
    chunks.push(Buffer.from(value));
  }
  let json;
  try {
    json = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch {
    throw new Error(`${label} response is not valid JSON`);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error(`${label} response must be a JSON object`);
  }
  return json;
}

async function strictProbe(origin, path, { method = 'GET', body } = {}) {
  const url = `${origin}${path}`;
  const response = await fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.url !== url || response.status >= 300 && response.status < 400) {
    throw new Error(`${path} redirected or changed the exact canonical URL`);
  }
  const contentType = response.headers.get('content-type');
  if (contentType !== 'application/json; charset=utf-8') {
    throw new Error(`${path} did not return the exact JSON content type`);
  }
  return {
    status: response.status,
    headers: response.headers,
    json: await readLimitedJson(response, path),
  };
}

export async function createBackupOnlyApiProof({
  origin,
  expectedCommit,
  railway,
} = {}) {
  const productionOrigin = validateOrigin(origin);
  const commit = validateExactGitSha(expectedCommit, 'expected deployed commit');
  const [health, ready, version] = await Promise.all([
    strictProbe(productionOrigin, '/health'),
    strictProbe(productionOrigin, '/health/ready'),
    strictProbe(productionOrigin, '/api/version'),
  ]);
  const login = await strictProbe(productionOrigin, '/api/auth/login', {
    method: 'POST',
    body: BACKUP_ONLY_LOGIN_SENTINEL,
  });
  for (const forbiddenHeader of [
    'location',
    'content-encoding',
    'access-control-allow-origin',
    'access-control-allow-credentials',
  ]) {
    if (login.headers.get(forbiddenHeader) !== null) {
      throw new Error(`backup-only login response exposed forbidden ${forbiddenHeader}`);
    }
  }
  const terminalVersion = await strictProbe(productionOrigin, '/api/version');
  const classification = validateConservedProductionLogin({
    environment: 'production',
    health,
    ready,
    version,
    login,
    terminalVersion,
  });
  if (classification.backupOnly !== true || classification.mode !== PRE_COMPATIBILITY_BACKUP_ONLY_MODE) {
    throw new Error('public API is not the exact isolated backup-only runtime');
  }
  const identity = classification.identity;
  const checks = [
    [identity.commitFull === commit, 'public API commit mismatch'],
    [identity.railwayDeploymentId === railway?.deploymentId, 'public API deployment mismatch'],
    [identity.railwayReplicaId === railway?.replicaId, 'public API replica mismatch'],
    [identity.railwayEnvironment === 'production', 'public API environment mismatch'],
    [identity.railwayService === 'rental-management', 'public API service mismatch'],
    [version.json?.app?.disabled === true, 'public API app.disabled is not true'],
    [terminalVersion.json?.app?.disabled === true, 'terminal public API app.disabled is not true'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
  return {
    origin: productionOrigin,
    mode: classification.mode,
    appDisabled: true,
    commitFull: identity.commitFull,
    releaseType: identity.releaseType,
    startedAt: identity.startedAt,
    deploymentId: identity.railwayDeploymentId,
    replicaId: identity.railwayReplicaId,
    environment: identity.railwayEnvironment,
    service: identity.railwayService,
    healthStatus: health.status,
    readyStatus: ready.status,
    versionStatus: version.status,
    loginStatus: login.status,
    terminalVersionStatus: terminalVersion.status,
  };
}

function parseArgs(argv) {
  const args = {
    origin: '', expectedCommit: '', expectedWorkflowCommit: '', railwayProof: '', output: '',
  };
  const names = new Map([
    ['--origin', 'origin'],
    ['--expected-commit', 'expectedCommit'],
    ['--expected-workflow-commit', 'expectedWorkflowCommit'],
    ['--railway-proof', 'railwayProof'],
    ['--output', 'output'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = names.get(argv[index]);
    if (!name) throw new Error(`Unknown argument: ${argv[index]}`);
    args[name] = argv[++index] || '';
  }
  for (const [name, value] of Object.entries(args)) exactString(value, name);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('API proof is GitHub Actions only');
  const expectedCommit = validateExactGitSha(args.expectedCommit, 'expected deployed commit');
  const expectedWorkflowCommit = validateExactGitSha(
    args.expectedWorkflowCommit,
    'expected workflow commit',
  );
  if (validateExactGitSha(process.env.GITHUB_SHA, 'GITHUB_SHA') !== expectedWorkflowCommit) {
    throw new Error('GITHUB_SHA does not equal the expected workflow commit');
  }
  const railway = JSON.parse(fs.readFileSync(args.railwayProof, 'utf8'));
  const proof = await createBackupOnlyApiProof({
    origin: args.origin,
    expectedCommit,
    railway,
  });
  fs.writeFileSync(args.output, `${JSON.stringify(proof, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  console.log('[historical-backup-recovery] exact public backup-only API identity PASS');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[historical-backup-recovery] API proof FAIL: ${error.message}`);
    process.exit(1);
  });
}
