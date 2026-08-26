#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  commitsMatch,
  extractFrontendBuildMarkerFromBundle,
  readFrontendBundle,
  validateGitSha,
} from './release-preflight.mjs';

const FRONTEND_RELEASE_TYPES = new Set([
  'frontend-only',
  'full-stack',
  'deploy-tooling',
  'frontend-deploy-tooling',
]);

function normalizeReleaseType(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function classifyReleaseOutcome({
  expectedCommit = '',
  releaseType = '',
  backendCommit = '',
  frontendCommit = '',
  gateStatus = '',
} = {}) {
  const expected = validateGitSha(expectedCommit, 'expected release commit');
  if (!expected.valid) throw new Error(expected.error);
  const type = normalizeReleaseType(releaseType);
  const backendMatch = commitsMatch(backendCommit, expected.normalized);
  const frontendMatch = commitsMatch(frontendCommit, expected.normalized);
  const backendRequired = type === 'backend' || type === 'full-stack';
  const frontendRequired = FRONTEND_RELEASE_TYPES.has(type);
  const requiredMatches = (!backendRequired || backendMatch) && (!frontendRequired || frontendMatch);
  let status = 'RELEASE_FAILED';

  if (backendRequired && frontendRequired && backendMatch !== frontendMatch) {
    status = 'PARTIAL_RELEASE';
  } else if (requiredMatches && String(gateStatus || '').trim().toLowerCase() === 'success') {
    status = 'RELEASE_VERIFIED';
  } else if (requiredMatches) {
    status = 'RELEASE_UNVERIFIED';
  }

  return {
    status,
    expectedCommit: expected.normalized,
    releaseType: type,
    backendRequired,
    frontendRequired,
    backendMatch,
    frontendMatch,
    backendCommit: String(backendCommit || '').trim() || 'unknown',
    frontendCommit: String(frontendCommit || '').trim() || 'unknown',
    gateStatus: String(gateStatus || '').trim() || 'unknown',
  };
}

function exactCommitFromLocalGit(value = '') {
  const candidate = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(candidate)) return '';
  try {
    const resolved = execFileSync('git', ['rev-parse', '--verify', `${candidate}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().toLowerCase();
    return /^[0-9a-f]{40}$/.test(resolved) ? resolved : '';
  } catch {
    return '';
  }
}

async function collectBackendCommit(apiBaseUrl) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/version`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const json = await response.json();
    if (response.status !== 200 || json?.ok !== true) return '';
    return String(json?.build?.commitFull || json?.build?.commit || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

async function collectFrontendCommit(frontendUrl) {
  try {
    const bundle = await readFrontendBundle(frontendUrl);
    const marker = extractFrontendBuildMarkerFromBundle(bundle.combinedText);
    return exactCommitFromLocalGit(marker?.commit || '');
  } catch {
    return '';
  }
}

async function main() {
  const expectedCommit = String(process.env.EXPECTED_RELEASE_COMMIT || process.env.GITHUB_SHA || '').trim();
  const releaseType = String(process.env.RELEASE_TYPE || '').trim();
  const gateStatus = String(process.env.PRODUCTION_GATE_STATUS || '').trim();
  const apiBaseUrl = String(process.env.PRODUCTION_API_URL || '').trim().replace(/\/+$/, '');
  const frontendUrl = String(process.env.PRODUCTION_FRONTEND_URL || '').trim();
  if (!apiBaseUrl) throw new Error('PRODUCTION_API_URL is required');
  if (!frontendUrl) throw new Error('PRODUCTION_FRONTEND_URL is required');

  const [backendCommit, frontendCommit] = await Promise.all([
    collectBackendCommit(apiBaseUrl),
    collectFrontendCommit(frontendUrl),
  ]);
  const result = classifyReleaseOutcome({
    expectedCommit,
    releaseType,
    backendCommit,
    frontendCommit,
    gateStatus,
  });
  const lines = [
    '### Production release outcome',
    '',
    `- status: \`${result.status}\``,
    `- release type: \`${result.releaseType}\``,
    `- expected commit: \`${result.expectedCommit}\``,
    `- actual backend commit: \`${result.backendCommit}\``,
    `- actual frontend commit: \`${result.frontendCommit}\``,
    `- production gate job: \`${result.gateStatus}\``,
  ];
  console.log(`[release-outcome] status=${result.status}`);
  console.log(`[release-outcome] expected=${result.expectedCommit}`);
  console.log(`[release-outcome] backend=${result.backendCommit}`);
  console.log(`[release-outcome] frontend=${result.frontendCommit}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[release-outcome] unable to collect outcome: ${error.message}`);
  });
}
