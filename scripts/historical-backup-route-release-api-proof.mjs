#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HISTORICAL_RECOVERY_API_ORIGIN,
  createBackupOnlyApiProof,
} from './historical-backup-recovery-api-proof.mjs';
import { validateExactGitSha } from './railway-backend-release.mjs';
import {
  HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
  RAILWAY_DERIVED_COMMIT_SHA_KEY,
  ROUTE_RELEASE_IDENTITY,
} from './historical-backup-route-release-control-plane.mjs';

function exactString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`${label} must be an exact nonblank string`);
  }
  return value;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assertContext(expectedWorkflowCommit) {
  const commit = validateExactGitSha(expectedWorkflowCommit, 'expected workflow commit');
  const expectedWorkflowRef = `${ROUTE_RELEASE_IDENTITY.repository}/.github/workflows/skytech-historical-backup-route-release.yml@refs/heads/${ROUTE_RELEASE_IDENTITY.branch}`;
  const checks = [
    [process.env.GITHUB_ACTIONS === 'true', 'API proof is GitHub Actions only'],
    [process.env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'API proof event mismatch'],
    [process.env.GITHUB_REPOSITORY === ROUTE_RELEASE_IDENTITY.repository, 'API proof repository mismatch'],
    [process.env.GITHUB_REF === `refs/heads/${ROUTE_RELEASE_IDENTITY.branch}`, 'API proof ref mismatch'],
    [validateExactGitSha(process.env.GITHUB_SHA, 'GITHUB_SHA') === commit, 'API proof workflow SHA mismatch'],
    [process.env.GITHUB_WORKFLOW_SHA === commit, 'API proof workflow-file SHA mismatch'],
    [process.env.GITHUB_WORKFLOW_REF === expectedWorkflowRef, 'API proof workflow ref mismatch'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
  return commit;
}

export async function createRouteReleaseApiProof({
  phase = 'terminal',
  origin,
  expectedCommit,
  expectedDeploymentId,
  railway,
  attempts = 1,
  intervalMs = 5_000,
  createProof = createBackupOnlyApiProof,
} = {}) {
  if (!['baseline', 'terminal'].includes(phase)) throw new Error('API proof phase is invalid');
  const commit = validateExactGitSha(expectedCommit, 'expected API commit');
  const deploymentId = exactString(expectedDeploymentId, 'expected API deployment ID');
  const terminalChecksPass = phase === 'baseline' || (
    railway?.oldDeploymentNoLongerActive === true
    && railway?.terminalVariablesConservedWithSingleRailwayDerivedExemption === true
    && railway?.terminalVariableConservation?.exactKeyInventory === true
    && railway?.terminalVariableConservation?.exemptionKey === RAILWAY_DERIVED_COMMIT_SHA_KEY
    && railway?.terminalVariableConservation?.exemptionAuthority
      === 'documented Railway-provided deployment metadata'
    && railway?.terminalVariableConservation?.exemptionPresenceSymmetric === true
    && railway?.terminalVariableConservation?.exemptionValuesAreExactHexSha === true
    && railway?.terminalVariableConservation?.allNonExemptValuesExact === true
    && railway?.terminalVariableConservation?.rawVariableValuesEmitted === false
    && railway?.terminalTargetServiceConfigConserved === true
    && railway?.terminalStagedPatchEmpty === true
  );
  if (
    railway?.mode !== phase
    || railway?.railwayVariableSourcesExact !== true
    || railway?.railwayVariableSourceAuthority
      !== 'exact private CLI inventory equals GraphQL rendered variables query'
    || railway?.decryptedConfigRawValuesEmitted !== false
    || railway?.decryptedConfigPinExact !== true
    || railway?.decryptedConfigPin?.key !== HISTORICAL_BACKUP_EXPECTED_SHA_KEY
    || JSON.stringify(railway?.decryptedConfigPin?.containerOwnKeys) !== JSON.stringify(['value'])
    || railway?.decryptedConfigPin?.valueType !== 'string'
    || railway?.decryptedConfigPin?.valueExact !== true
    || railway?.decryptedConfigPin?.rawValueEmitted !== false
    || railway?.railway?.deploymentId !== deploymentId
    || railway?.railway?.deployedSha !== commit
    || railway?.backupExpectedSha !== commit
    || !terminalChecksPass
  ) {
    throw new Error('terminal Railway proof is not bound to the expected route release');
  }
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 60) {
    throw new Error('API proof attempts must be between 1 and 60');
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 60_000) {
    throw new Error('API proof interval is invalid');
  }
  let lastError = new Error('API proof was not attempted');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const api = await createProof({ origin, expectedCommit: commit, railway: railway.railway });
      return {
        evidenceVersion: 1,
        phase,
        attempt,
        commit,
        deploymentId,
        replicaId: railway.railway.replicaId,
        mode: api.mode,
        api,
      };
    } catch (error) {
      lastError = error;
      console.log(`[historical-backup-route-release] public API proof pending attempt=${attempt}`);
      if (attempt < attempts) await sleep(intervalMs);
    }
  }
  throw new Error(`terminal backup-only API proof failed: ${lastError.message}`);
}

function parseArgs(argv) {
  const args = {
    phase: '',
    origin: '',
    expectedCommit: '',
    expectedWorkflowCommit: '',
    expectedDeploymentId: '',
    railwayProof: '',
    attempts: '1',
    intervalMs: '5000',
    output: '',
  };
  const names = new Map([
    ['--phase', 'phase'],
    ['--origin', 'origin'],
    ['--expected-commit', 'expectedCommit'],
    ['--expected-workflow-commit', 'expectedWorkflowCommit'],
    ['--expected-deployment-id', 'expectedDeploymentId'],
    ['--railway-proof', 'railwayProof'],
    ['--attempts', 'attempts'],
    ['--interval-ms', 'intervalMs'],
    ['--output', 'output'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = names.get(argv[index]);
    if (!name) throw new Error(`Unknown argument: ${argv[index]}`);
    args[name] = argv[++index] || '';
  }
  for (const name of ['phase', 'origin', 'expectedCommit', 'expectedWorkflowCommit', 'expectedDeploymentId', 'railwayProof', 'output']) {
    exactString(args[name], name);
  }
  args.attempts = Number(args.attempts);
  args.intervalMs = Number(args.intervalMs);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workflowCommit = assertContext(args.expectedWorkflowCommit);
  const expectedCommit = validateExactGitSha(args.expectedCommit, 'expected API commit');
  if (!['baseline', 'terminal'].includes(args.phase)) throw new Error('API proof phase is invalid');
  if (args.phase === 'terminal' && expectedCommit !== workflowCommit) {
    throw new Error('terminal API commit must equal the reviewed workflow commit');
  }
  if (args.origin !== HISTORICAL_RECOVERY_API_ORIGIN) {
    throw new Error('API origin must be the canonical Skytech production origin');
  }
  const railway = JSON.parse(fs.readFileSync(args.railwayProof, 'utf8'));
  const proof = await createRouteReleaseApiProof({
    phase: args.phase,
    origin: args.origin,
    expectedCommit,
    expectedDeploymentId: args.expectedDeploymentId,
    railway,
    attempts: args.attempts,
    intervalMs: args.intervalMs,
  });
  fs.writeFileSync(args.output, `${JSON.stringify(proof, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  console.log('[historical-backup-route-release] exact canonical backup-only API PASS');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[historical-backup-route-release] API proof FAIL: ${error.message}`);
    process.exit(1);
  });
}
