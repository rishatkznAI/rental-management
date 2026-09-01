#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildFutureWriteAudit } = require('../lib/future-write-audit');
const { buildReviewedPolicyDraft } = require('../lib/future-write-audit-policy-builder');

const POLICY_PATH = path.resolve(__dirname, '../config/future-write-audit-matrix.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function reviewPathFromArgs(argv) {
  const option = argv.find(argument => argument.startsWith('--reviews='));
  return option ? path.resolve(process.cwd(), option.slice('--reviews='.length)) : null;
}

function loadCallableEscapeReviews(argv) {
  const reviewPath = reviewPathFromArgs(argv);
  const source = reviewPath
    ? readJson(reviewPath)
    : fs.existsSync(POLICY_PATH)
      ? readJson(POLICY_PATH)
      : null;
  const reviews = Array.isArray(source) ? source : source?.callableEscapeReviews;
  if (!Array.isArray(reviews)) {
    throw new Error('Policy generation requires an exact callable-escape review array via --reviews=<path> or the current policy.');
  }
  return reviews;
}

function main(argv = process.argv.slice(2)) {
  const unknown = argv.filter(argument => (
    argument !== '--json'
    && argument !== '--generate-policy'
    && !argument.startsWith('--reviews=')
  ));
  if (unknown.length > 0) {
    throw new Error(`Unknown future-write audit option: ${unknown.join(', ')}`);
  }
  const rootDir = path.resolve(__dirname, '../..');
  if (argv.includes('--generate-policy')) {
    const policy = buildReviewedPolicyDraft(rootDir, {
      callableEscapeReviews: loadCallableEscapeReviews(argv),
    });
    fs.mkdirSync(path.dirname(POLICY_PATH), { recursive: true });
    fs.writeFileSync(POLICY_PATH, `${JSON.stringify(policy, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      status: 'PASS',
      policyPath: POLICY_PATH,
      expectedSiteCount: policy.expectedSiteCount,
      expectedSourceCorpusSha256: policy.expectedSourceCorpusSha256,
      expectedInventorySha256: policy.expectedInventorySha256,
    }, null, 2)}\n`);
    return policy;
  }
  if (reviewPathFromArgs(argv)) {
    throw new Error('--reviews=<path> is valid only with --generate-policy.');
  }
  const policy = readJson(POLICY_PATH);
  const report = buildFutureWriteAudit({ rootDir, policy });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({
      status: report.status,
      inventorySha256: report.inventorySha256,
      summary: report.summary,
      findings: report.findings,
    }, null, 2)}\n`);
  }
  if (report.status !== 'PASS') process.exitCode = 1;
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
