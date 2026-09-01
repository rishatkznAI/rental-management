const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const fallbackPlan = require('./production-scope-remediation-plan');
const {
  validateProductionScopeExecutionBundle,
} = require('../lib/production-scope-execution-plan-bundle');

const GENERATED_BUNDLE_PATH = path.join(
  __dirname,
  'production-scope-remediation-execution-plan.generated.json',
);
const GENERATED_BUNDLE_HASH_PATH = `${GENERATED_BUNDLE_PATH}.sha256`;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadActivePlan() {
  let stat;
  try {
    stat = fs.lstatSync(GENERATED_BUNDLE_PATH);
  } catch (error) {
    if (error.code === 'ENOENT') return fallbackPlan;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const error = new Error('Generated production scope plan must be a regular file.');
    error.code = 'GENERATED_EXECUTION_PLAN_FILE_INVALID';
    throw error;
  }
  let bundleBytes;
  let expectedFileHash;
  try {
    const hashStat = fs.lstatSync(GENERATED_BUNDLE_HASH_PATH);
    if (!hashStat.isFile() || hashStat.isSymbolicLink()) throw new Error('invalid hash file');
    expectedFileHash = fs.readFileSync(GENERATED_BUNDLE_HASH_PATH, 'utf8').trim().toLowerCase();
    bundleBytes = fs.readFileSync(GENERATED_BUNDLE_PATH);
  } catch {
    const error = new Error('Generated production scope plan hash binding is missing or invalid.');
    error.code = 'GENERATED_EXECUTION_PLAN_FILE_HASH_INVALID';
    throw error;
  }
  if (!/^[a-f0-9]{64}$/.test(expectedFileHash) || sha256(bundleBytes) !== expectedFileHash) {
    const error = new Error('Generated production scope plan differs from its pinned file hash.');
    error.code = 'GENERATED_EXECUTION_PLAN_FILE_HASH_MISMATCH';
    throw error;
  }
  let bundle;
  try {
    bundle = JSON.parse(bundleBytes.toString('utf8'));
  } catch {
    const error = new Error('Generated production scope plan is invalid JSON.');
    error.code = 'GENERATED_EXECUTION_PLAN_JSON_INVALID';
    throw error;
  }
  return validateProductionScopeExecutionBundle(bundle).plan;
}

module.exports = loadActivePlan();
