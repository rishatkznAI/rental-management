#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { auditArDebtorIdentities } = require('../lib/ar-debtor-identity');

function parseArgs(argv) {
  const result = { dbPath: '', json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') result.json = true;
    else if (argument === '--db') {
      result.dbPath = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--help' || argument === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function printUsage() {
  console.log([
    'Usage:',
    '  node server/scripts/ar-debtor-identity.js [--db /path/to/app.sqlite] [--json]',
    '',
    'Runs the Stage J-H1 read-only AR debtor identity audit.',
    'The database is opened in SQLite readonly mode. No repair, backfill, or persistence write is available.',
    'Only stable ID relations are evaluated; display names, INN, phone, and email are diagnostics only.',
  ].join('\n'));
}

function createReadOnlyStorage(db) {
  const readStatement = db.prepare('SELECT json FROM app_data WHERE name = ?');
  return {
    readData(name) {
      const row = readStatement.get(name);
      if (!row) return [];
      try {
        const value = JSON.parse(row.json);
        return Array.isArray(value) ? value : [];
      } catch (error) {
        const next = new Error(`Collection ${name} contains invalid JSON.`);
        next.code = 'AR_DEBTOR_AUDIT_INVALID_JSON';
        next.cause = error;
        throw next;
      }
    },
  };
}

function printHumanSummary({ dbPath, audit }) {
  const { summary } = audit;
  console.log([
    'Stage J-H1 — Canonical AR Debtor Identity Audit',
    `Database: ${dbPath}`,
    'Mode: read-only',
    '',
    `Records inspected: ${summary.inspected}`,
    `Resolved: ${summary.resolved}`,
    `Canonical: ${summary.canonical}`,
    `Legacy resolved: ${summary.legacy_resolved}`,
    `Counterparty only: ${summary.counterparty_only}`,
    `Matching dual ID: ${summary.matching_dual_id}`,
    `Unresolved: ${summary.unresolved}`,
    `Mismatch: ${summary.mismatch}`,
    `Ambiguous: ${summary.ambiguous}`,
    `Orphan client: ${summary.orphan_client}`,
    `Orphan counterparty: ${summary.orphan_counterparty}`,
    `Blocking identity issues: ${summary.blockingIssueCount}`,
  ].join('\n'));

  if (audit.blockingIssues.length === 0) return;
  console.log('\nBlocking issues:');
  for (const issue of audit.blockingIssues) {
    const location = `${issue.domain}:${issue.recordId || '<missing-id>'}`;
    const stableId = issue.stableId ? ` [${issue.stableId}]` : '';
    console.log(`- ${location} ${issue.status} ${issue.code}${stableId}: ${issue.message}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return null;
  }
  const dbPath = path.resolve(args.dbPath || path.join(__dirname, '..', 'data', 'app.sqlite'));
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const audit = auditArDebtorIdentities(createReadOnlyStorage(db));
    const result = { mode: 'read-only', dbPath, audit };
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else printHumanSummary(result);
    return result;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || 'AR_DEBTOR_AUDIT_FAILED',
      error: error?.message || String(error),
    }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = { createReadOnlyStorage, main, parseArgs, printHumanSummary };
