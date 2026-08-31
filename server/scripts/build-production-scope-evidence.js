#!/usr/bin/env node
'use strict';

const {
  buildFreshProductionScopeEvidence,
} = require('../lib/production-scope-evidence-builder');

const ARGUMENTS = new Map([
  ['--control', 'controlPath'],
  ['--control-sha256', 'controlSha256'],
  ['--round-a-dir', 'roundADir'],
  ['--round-b-dir', 'roundBDir'],
  ['--output-dir', 'outputDir'],
]);

function usage() {
  return [
    'Usage:',
    '  node server/scripts/build-production-scope-evidence.js \\',
    '    --control <externally reviewed capture-control.json> \\',
    '    --control-sha256 <64 lowercase hex> \\',
    '    --round-a-dir <first offline DB/WAL/SHM download> \\',
    '    --round-b-dir <second offline DB/WAL/SHM download> \\',
    '    --output-dir <new non-repository evidence-pack directory>',
    '',
    'The exact candidate authority is reconstructed from the captured records and',
    'must match the committed digest-only baseline contract before evidence is built.',
    'This command is offline and read-only with respect to both captures. It has',
    'no production, Railway, GitHub, deployment, backup, apply, or overwrite mode.',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const field = ARGUMENTS.get(name);
    if (!field) {
      const error = new Error(`Unknown argument: ${name}.`);
      error.code = 'ARGUMENT_INVALID';
      throw error;
    }
    const value = argv[++index];
    if (!value || value.startsWith('--') || result[field]) {
      const error = new Error(`Missing or duplicate value for ${name}.`);
      error.code = 'ARGUMENT_INVALID';
      throw error;
    }
    result[field] = value;
  }
  const missing = [...ARGUMENTS.values()].filter(field => !result[field]);
  if (missing.length > 0) {
    const error = new Error(usage());
    error.code = 'ARGUMENT_REQUIRED';
    throw error;
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = buildFreshProductionScopeEvidence(args);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    outputPath: result.outputPath,
    artifactIndexSha256: result.artifactIndexSha256,
    packFingerprint: result.packFingerprint,
    sourceSnapshotHash: result.summary.capture.sourceSnapshotHash,
    sourceFileSetHash: result.summary.capture.sourceFileSetHash,
    sourceObservedFileSetHash: result.summary.capture.sourceObservedFileSetHash,
    verdict: result.summary.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || 'PRODUCTION_SCOPE_EVIDENCE_FAILED',
      message: error.message,
      details: error.details || null,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  parseArgs,
  usage,
};
