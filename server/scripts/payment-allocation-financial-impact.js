#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  REQUIRED_COLLECTIONS,
  diagnosePaymentAllocationFinancialImpact,
} = require('../lib/payment-allocation-financial-impact');

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
    '  node server/scripts/payment-allocation-financial-impact.js [--db /path/to/backup.sqlite] [--json]',
    '',
    'Runs the Stage J-H1.3 historical Payment/PaymentAllocation financial-impact diagnostic.',
    'DB_PATH is used when --db is omitted; otherwise server/data/app.sqlite is the default.',
    'The database is opened with SQLite readonly + fileMustExist. No apply or write mode exists.',
  ].join('\n'));
}

function createReadOnlyStorage(db) {
  const readStatement = db.prepare('SELECT json FROM app_data WHERE name = ?');
  return {
    readData(name) {
      if (!REQUIRED_COLLECTIONS.includes(name)) {
        const error = new Error(`Diagnostic collection is not allowlisted: ${name}`);
        error.code = 'PAYMENT_ALLOCATION_DIAGNOSTIC_COLLECTION_DENIED';
        throw error;
      }
      const row = readStatement.get(name);
      if (!row) return [];
      try {
        const value = JSON.parse(row.json);
        return Array.isArray(value) ? value : [];
      } catch (error) {
        const next = new Error(`Collection ${name} contains invalid JSON.`);
        next.code = 'PAYMENT_ALLOCATION_DIAGNOSTIC_INVALID_JSON';
        next.cause = error;
        throw next;
      }
    },
  };
}

function printHuman({ dbPath, diagnostic }) {
  const { summary } = diagnostic;
  console.log([
    'Stage J-H1.3 — Historical Allocation Financial-Impact Diagnostic',
    `Database: ${dbPath}`,
    'Mode: read-only',
    '',
    `Records inspected: ${summary.recordsInspected}`,
    `Financial relations inspected: ${summary.relationRecordsInspected}`,
    `Effective explicit allocations: ${summary.effectiveExplicitAllocations}`,
    `Effective direct relations: ${summary.effectiveDirectRelations}`,
    `Blocking issues: ${summary.blockingIssues}`,
    `Warning issues: ${summary.warningIssues}`,
    `Total effective amount affected: ${summary.totalEffectiveAmountAffected}`,
    '',
    `AR-impact blockers: ${summary.arImpactBlockers}`,
    `Identity-only blockers: ${summary.identityOnlyBlockers}`,
    `Reader differences: ${summary.readerDifferences}`,
  ].join('\n'));

  const reportable = diagnostic.relations.filter(item => item.issueClass !== 'safe');
  if (reportable.length === 0) return;
  console.log('\nDiagnostic relations:');
  for (const item of reportable) {
    const ids = [
      `payment=${item.paymentId || '<missing>'}`,
      `rental=${item.rentalId || '<missing>'}`,
      item.allocationId ? `allocation=${item.allocationId}` : null,
    ].filter(Boolean).join(' ');
    console.log(
      `- ${item.severity} ${item.issueClass} ${item.relationSource} ${ids} `
      + `effective=${item.effectiveAmount} affectsCurrentAr=${item.affectsCurrentAr ? 'yes' : 'no'}`,
    );
  }
}

function resolveDatabasePath(argumentPath) {
  return path.resolve(
    argumentPath
      || process.env.DB_PATH
      || path.join(__dirname, '..', 'data', 'app.sqlite'),
  );
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return null;
  }
  const dbPath = resolveDatabasePath(args.dbPath);
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const diagnostic = diagnosePaymentAllocationFinancialImpact(createReadOnlyStorage(db));
    const result = { mode: 'read-only', dbPath, diagnostic };
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else printHuman(result);
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
      code: error?.code || 'PAYMENT_ALLOCATION_FINANCIAL_IMPACT_FAILED',
      error: error?.message || String(error),
    }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  createReadOnlyStorage,
  main,
  parseArgs,
  printHuman,
  resolveDatabasePath,
};
