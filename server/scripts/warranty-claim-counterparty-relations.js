#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  WARRANTY_RELATION_CLASSIFICATIONS,
  WARRANTY_RELATION_CODES,
  repairWarrantyClaimCounterpartyRelations,
} = require('../lib/warranty-claim-counterparty-relations');
const { counterpartyError } = require('../lib/counterparty');

function parseArgs(argv) {
  const result = { apply: false, dbPath: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') result.apply = true;
    else if (argument === '--dry-run') result.apply = false;
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
    '  node server/scripts/warranty-claim-counterparty-relations.js [--dry-run] [--db /path/to/app.sqlite]',
    '  node server/scripts/warranty-claim-counterparty-relations.js --apply [--db /path/to/app.sqlite]',
    '',
    'Default mode is a machine-readable dry-run and performs no writes.',
    '--apply stops on any invalid relation, creates a SQLite backup, rechecks the dry-run fingerprint,',
    'and atomically adds counterpartyId only to deterministic_repair Warranty claims.',
    'Only exact serviceTicketId, clientId, and rentalId chains are eligible.',
    'Names, factory/manufacturer fields, equipment state, INN, phone, email, and addresses are never identity inputs.',
  ].join('\n'));
}

function createStorage(db) {
  const readStatement = db.prepare('SELECT json FROM app_data WHERE name = ?');
  const writeStatement = db.prepare(`
    INSERT INTO app_data (name, json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      json = excluded.json,
      updated_at = CURRENT_TIMESTAMP
  `);
  const writeBatch = db.transaction(entries => {
    for (const entry of entries || []) writeStatement.run(entry.name, JSON.stringify(entry.value));
  });
  return {
    readData(name) {
      const row = readStatement.get(name);
      return row ? JSON.parse(row.json) : [];
    },
    writeDataBatch(entries) {
      writeBatch(entries);
    },
  };
}

function invalidAuditEntries(audit) {
  const valid = new Set([
    WARRANTY_RELATION_CLASSIFICATIONS.ALREADY_CANONICAL,
    WARRANTY_RELATION_CLASSIFICATIONS.DETERMINISTIC_REPAIR,
    WARRANTY_RELATION_CLASSIFICATIONS.INTERNAL_UNLINKED_VALID,
    WARRANTY_RELATION_CLASSIFICATIONS.CANONICAL_TERMINAL_HISTORY,
  ]);
  return (audit?.entries || []).filter(entry => !valid.has(entry.classification));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const dbPath = path.resolve(args.dbPath || path.join(__dirname, '..', 'data', 'app.sqlite'));
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);

  const db = new Database(dbPath, { readonly: !args.apply, fileMustExist: true });
  try {
    const storage = createStorage(db);
    const preview = repairWarrantyClaimCounterpartyRelations({
      readData: storage.readData,
      dryRun: true,
    });
    if (!args.apply) {
      console.log(JSON.stringify({ mode: 'dry-run', dbPath, ...preview }, null, 2));
      return;
    }

    const invalid = invalidAuditEntries(preview.audit);
    if (invalid.length > 0) {
      throw counterpartyError(
        WARRANTY_RELATION_CODES.REPAIR_BLOCKED,
        'Warranty repair остановлен: коллекция содержит invalid relations.',
        409,
        { invalidRecords: invalid.map(entry => ({ id: entry.recordId, classification: entry.classification })) },
      );
    }
    if (!preview.changed) {
      console.log(JSON.stringify({ mode: 'apply', dbPath, backupPath: null, ...preview }, null, 2));
      return;
    }

    const backupPath = path.join(
      path.dirname(dbPath),
      'backups',
      `pre-warranty-counterparty-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    await db.backup(backupPath);
    const result = repairWarrantyClaimCounterpartyRelations({
      readData: storage.readData,
      writeDataBatch: storage.writeDataBatch,
      dryRun: false,
      expectedFingerprint: preview.audit.fingerprint,
    });
    console.log(JSON.stringify({ mode: 'apply', dbPath, backupPath, ...result }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || 'WARRANTY_COUNTERPARTY_MIGRATION_FAILED',
      error: error?.message || String(error),
      details: error?.details,
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { createStorage, invalidAuditEntries, parseArgs };
