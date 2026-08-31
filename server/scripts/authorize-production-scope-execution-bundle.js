#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  authorizeProductionScopeExecutionBundle,
} = require('../lib/production-scope-execution-authorization');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VALUE_OPTIONS = new Set([
  '--review-bundle',
  '--review-bundle-sha256',
  '--approval',
  '--approval-sha256',
  '--simulation-one',
  '--simulation-one-sha256',
  '--simulation-two',
  '--simulation-two-sha256',
  '--output-bundle',
  '--output-sha256',
]);

function usage() {
  return [
    'Usage:',
    '  node server/scripts/authorize-production-scope-execution-bundle.js \\',
    '    --review-bundle <review-only bundle> --review-bundle-sha256 <sha256> \\',
    '    --approval <reviewed approval JSON> --approval-sha256 <sha256> \\',
    '    --simulation-one <PASS result> --simulation-one-sha256 <sha256> \\',
    '    --simulation-two <PASS result> --simulation-two-sha256 <sha256> \\',
    '    --output-bundle <new generated bundle path> --output-sha256 <new sidecar path>',
    '',
    'Inputs are read once through no-follow descriptors. Outputs must not exist.',
  ].join('\n');
}

function optionKey(name) {
  return name.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--help' || option === '-h') return { help: true };
    if (!VALUE_OPTIONS.has(option)) {
      throw Object.assign(new Error(`Unknown argument: ${option}`), { code: 'ARGUMENT_INVALID' });
    }
    const value = argv[++index];
    if (!value) throw Object.assign(new Error(`Missing value for ${option}.`), { code: 'ARGUMENT_INVALID' });
    result[optionKey(option)] = value;
  }
  return result;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readPinnedJson(filePath, expectedSha256, label) {
  if (typeof expectedSha256 !== 'string' || !SHA256_PATTERN.test(expectedSha256)) {
    throw Object.assign(new Error(`${label} requires an exact SHA-256.`), { code: 'INPUT_HASH_REQUIRED' });
  }
  const absolute = path.resolve(filePath);
  const before = fs.lstatSync(absolute);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw Object.assign(new Error(`${label} must be one regular, non-linked file.`), { code: 'INPUT_FILE_INVALID' });
  }
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1) {
      throw Object.assign(new Error(`${label} changed before it was read.`), { code: 'INPUT_FILE_CHANGED' });
    }
    const bytes = fs.readFileSync(fd);
    if (sha256(bytes) !== expectedSha256) {
      throw Object.assign(new Error(`${label} differs from its externally reviewed SHA-256.`), {
        code: 'INPUT_FILE_HASH_MISMATCH',
      });
    }
    return { absolute, bytes, value: JSON.parse(bytes.toString('utf8')) };
  } finally {
    fs.closeSync(fd);
  }
}

function writeExclusive(filePath, bytes) {
  const requested = path.resolve(filePath);
  const parent = path.dirname(requested);
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw Object.assign(new Error('Output parent must be a regular directory.'), { code: 'OUTPUT_PARENT_INVALID' });
  }
  // Resolve pre-existing ancestors once, then create the new basename beneath
  // that canonical directory. This keeps O_EXCL effective while also working
  // on platforms where /var is a stable alias of /private/var.
  const absolute = path.join(fs.realpathSync(parent), path.basename(requested));
  const fd = fs.openSync(
    absolute,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0),
    0o600,
  );
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return absolute;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  for (const option of VALUE_OPTIONS) {
    if (!args[optionKey(option)]) {
      throw Object.assign(new Error(usage()), { code: 'ARGUMENT_REQUIRED' });
    }
  }
  const review = readPinnedJson(args.reviewBundle, args.reviewBundleSha256, 'Review bundle');
  const approval = readPinnedJson(args.approval, args.approvalSha256, 'Approval');
  const simulationOne = readPinnedJson(
    args.simulationOne,
    args.simulationOneSha256,
    'Simulation one',
  );
  const simulationTwo = readPinnedJson(
    args.simulationTwo,
    args.simulationTwoSha256,
    'Simulation two',
  );
  const outputBundle = path.resolve(args.outputBundle);
  const outputSha256 = path.resolve(args.outputSha256);
  if (outputBundle === outputSha256 || fs.existsSync(outputBundle) || fs.existsSync(outputSha256)) {
    throw Object.assign(new Error('Authorization outputs must be distinct and absent.'), {
      code: 'OUTPUT_ALREADY_EXISTS',
    });
  }
  const authorized = authorizeProductionScopeExecutionBundle({
    reviewBundle: review.value,
    reviewBundleFileSha256: args.reviewBundleSha256,
    approval: approval.value,
    approvalFileSha256: args.approvalSha256,
    simulationOne: simulationOne.value,
    simulationOneSha256: args.simulationOneSha256,
    simulationTwo: simulationTwo.value,
    simulationTwoSha256: args.simulationTwoSha256,
  });
  const bundleBytes = Buffer.from(`${JSON.stringify(authorized, null, 2)}\n`);
  const bundleFileSha256 = sha256(bundleBytes);
  let wroteBundle = false;
  let wroteSidecar = false;
  try {
    writeExclusive(outputBundle, bundleBytes);
    wroteBundle = true;
    writeExclusive(outputSha256, Buffer.from(`${bundleFileSha256}\n`));
    wroteSidecar = true;
    for (const directory of new Set([path.dirname(outputBundle), path.dirname(outputSha256)])) {
      const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY);
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    }
  } catch (error) {
    if (wroteSidecar) fs.unlinkSync(outputSha256);
    if (wroteBundle) fs.unlinkSync(outputBundle);
    throw error;
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: authorized.status,
    outputBundle,
    outputSha256,
    bundleFileSha256,
    bundleSha256: authorized.bundleSha256,
    executionPlanSha256: authorized.executionPlanSha256,
    scopeManifestSha256: authorized.scopeManifestSha256,
    captureDeployedSha: authorized.source.captureDeployedSha,
    productionExecutionAuthorized: true,
  }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || 'EXECUTION_BUNDLE_AUTHORIZATION_FAILED',
      message: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  parseArgs,
  readPinnedJson,
  writeExclusive,
};
