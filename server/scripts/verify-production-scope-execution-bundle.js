#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  validateProductionScopeExecutionBundle,
} = require('../lib/production-scope-execution-plan-bundle');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function usage() {
  return [
    'Usage:',
    '  node server/scripts/verify-production-scope-execution-bundle.js \\',
    '    --bundle <generated bundle JSON> \\',
    '    --expected-sha256 <externally reviewed file SHA-256> \\',
    '    [--require-authorized]',
    '',
    'This command is read-only and never authorizes production execution.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help' || name === '-h') return { help: true };
    if (name === '--require-authorized') {
      args.requireAuthorized = true;
      continue;
    }
    if (!['--bundle', '--expected-sha256'].includes(name)) {
      throw Object.assign(new Error(`Unknown argument: ${name}`), { code: 'ARGUMENT_INVALID' });
    }
    const value = argv[++index];
    if (!value) throw Object.assign(new Error(`Missing value for ${name}.`), { code: 'ARGUMENT_INVALID' });
    args[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const expected = String(args.expectedSha256 || '').trim().toLowerCase();
  if (!args.bundle || !/^[a-f0-9]{64}$/.test(expected)) {
    throw Object.assign(new Error(usage()), { code: 'ARGUMENT_REQUIRED' });
  }
  const bundlePath = path.resolve(args.bundle);
  const stat = fs.lstatSync(bundlePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw Object.assign(new Error('The bundle must be a regular file.'), {
      code: 'EXECUTION_BUNDLE_FILE_INVALID',
    });
  }
  const bytes = fs.readFileSync(bundlePath);
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw Object.assign(new Error('The bundle differs from the externally reviewed file hash.'), {
      code: 'EXECUTION_BUNDLE_FILE_HASH_MISMATCH',
    });
  }
  const bundle = JSON.parse(bytes.toString('utf8'));
  const validation = validateProductionScopeExecutionBundle(bundle, {
    requireAuthorized: args.requireAuthorized === true,
  });
  const plan = validation.plan;
  const result = {
    ok: true,
    mode: 'read-only-verification',
    fileSha256: actual,
    bundleSha256: validation.bundleSha256,
    executionPlanSha256: validation.executionPlanSha256,
    scopeManifestSha256: plan.scopeManifestSha256,
    productionExecutionAuthorized: validation.authorized,
    classifiedRecordCount: bundle.summary.classifiedRecordCount,
    executionRecordMappingCount: plan.recordMappings.length,
    actorMappingCount: plan.actorMappings.length,
    unresolvedMappingCount: [
      ...plan.recordMappings,
      ...plan.actorMappings,
      ...(Array.isArray(plan.relationMappings) ? plan.relationMappings : []),
    ].filter(row => row.action === 'UNRESOLVED').length,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error.code || 'EXECUTION_BUNDLE_VERIFICATION_FAILED',
    message: error.message,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
