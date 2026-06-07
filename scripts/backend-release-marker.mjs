#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RELEASE_TYPES = new Set([
  'frontend-only',
  'backend',
  'full-stack',
  'deploy-tooling',
  'frontend-deploy-tooling',
]);

function parseArgs(argv) {
  const args = {
    commit: process.env.GITHUB_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || '',
    releaseType: process.env.RELEASE_TYPE || process.env.RELEASE_PREFLIGHT_RELEASE_TYPE || '',
    buildTime: process.env.BUILD_TIME || new Date().toISOString(),
    out: 'server/release-marker.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--commit') args.commit = argv[++index] || '';
    else if (arg === '--release-type') args.releaseType = argv[++index] || '';
    else if (arg === '--build-time') args.buildTime = argv[++index] || '';
    else if (arg === '--out') args.out = argv[++index] || '';
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
  node scripts/backend-release-marker.mjs --commit <sha> --release-type <type> [--out server/release-marker.json]`);
}

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function normalizeReleaseType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!RELEASE_TYPES.has(normalized)) {
    throw new Error(`release type must be one of: ${[...RELEASE_TYPES].join(', ')}`);
  }
  return normalized;
}

function shortCommit(value = '') {
  return String(value || '').trim().slice(0, 12);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const commitFull = required(args.commit, 'commit');
  const releaseType = normalizeReleaseType(args.releaseType);
  const buildTime = required(args.buildTime, 'build time');
  const outputFile = required(args.out, 'output file');
  const marker = {
    commit: shortCommit(commitFull),
    commitFull,
    buildTime,
    deployTime: buildTime,
    releaseType,
  };

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  console.log(`[backend-release-marker] wrote ${outputFile}`);
  console.log(`[backend-release-marker] commit=${marker.commit}`);
  console.log(`[backend-release-marker] releaseType=${marker.releaseType}`);
}

main().catch(error => {
  console.error(`[backend-release-marker] FAIL: ${error.message}`);
  process.exit(1);
});
