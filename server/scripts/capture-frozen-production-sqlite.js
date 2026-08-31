#!/usr/bin/env node
'use strict';

const {
  acquireFrozenProductionSqliteCapture,
} = require('../lib/frozen-production-sqlite-capture');

const ARGUMENTS = new Map([
  ['--expected-capture-sha', 'expectedCaptureSha'],
  ['--output-root', 'outputRoot'],
]);

function usage() {
  return [
    'Usage:',
    '  node server/scripts/capture-frozen-production-sqlite.js \\',
    '    --expected-capture-sha <exact lowercase 40-hex frozen deployment SHA> \\',
    '    --output-root <new private directory outside the repository and /data>',
    '',
    'The command performs two read-only command-mode Railway SSH acquisitions from',
    'the one exact running deployment instance. It never opens raw files with SQLite,',
    'never writes production, never overwrites local output, and removes partial output.',
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await acquireFrozenProductionSqliteCapture(args);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    verdict: result.output.verdict,
    outputRoot: result.outputRoot,
    captureControlSha256: result.captureControlSha256,
    captureOutputSha256: result.captureOutputSha256,
    captureDeployedSha: result.control.railway.captureDeployedSha,
    captureDeploymentId: result.control.railway.captureDeploymentId,
    deploymentInstanceId: result.control.railway.deploymentInstanceId,
    durableRoundsByteIdentical: result.output.durableRoundsByteIdentical,
    shmObservationByteIdentical: result.output.shmObservationByteIdentical,
    productionWritePerformed: result.output.productionWritePerformed,
    rawCaptureOpenedBySQLite: result.output.rawCaptureOpenedBySQLite,
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || 'FROZEN_PRODUCTION_CAPTURE_FAILED',
      message: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
