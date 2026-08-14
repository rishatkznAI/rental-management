#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  applyWarrantyClaimFactoryCounterpartyMappings,
  planWarrantyClaimFactoryCounterpartyMappings,
} = require('../lib/warranty-claim-factory-counterparty-relations');

function parseArgs(argv) {
  const result = { apply: false, dbPath: '', manifestPath: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') result.apply = true;
    else if (argument === '--dry-run') result.apply = false;
    else if (argument === '--db') {
      result.dbPath = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--manifest') {
      result.manifestPath = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--help' || argument === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function printUsage() {
  console.log([
    'Usage:',
    '  node server/scripts/warranty-claim-factory-counterparty-relations.js --dry-run --manifest mapping.json [--db /path/to/app.sqlite]',
    '  node server/scripts/warranty-claim-factory-counterparty-relations.js --apply --manifest mapping.json [--db /path/to/app.sqlite]',
    '',
    'Manifest: { "sourceFingerprint": "<dry-run fingerprint for apply>", "mappings": [',
    '  { "claimId": "WCL-...", "factoryCounterpartyId": "CP-..." }',
    '] }',
    '',
    'Dry-run is read-only. Apply requires the dry-run sourceFingerprint, rechecks it,',
    'backs up SQLite before mutation, and writes the full mapping atomically.',
    'Names, manufacturer, INN, phone, email, and other metadata are never mapping inputs.',
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

function readManifest(manifestPath) {
  if (!manifestPath) throw new Error('--manifest is required');
  const resolved = path.resolve(manifestPath);
  if (!fs.existsSync(resolved)) throw new Error(`Mapping manifest not found: ${resolved}`);
  return { path: resolved, value: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
}

function backupPathFor(dbPath, now = new Date()) {
  return path.join(
    path.dirname(dbPath),
    'backups',
    `pre-warranty-factory-mapping-${now.toISOString().replace(/[:.]/g, '-')}.sqlite`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const dbPath = path.resolve(args.dbPath || path.join(__dirname, '..', 'data', 'app.sqlite'));
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);
  const manifest = readManifest(args.manifestPath);
  const db = new Database(dbPath, { readonly: !args.apply, fileMustExist: true });
  try {
    const storage = createStorage(db);
    if (!args.apply) {
      const result = planWarrantyClaimFactoryCounterpartyMappings({
        readData: storage.readData,
        manifest: manifest.value,
      });
      console.log(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        dbPath,
        manifestPath: manifest.path,
        ...result,
        nextClaims: undefined,
      }, null, 2));
      return;
    }

    const sourceFingerprint = String(manifest.value?.sourceFingerprint || '').trim();
    if (!sourceFingerprint) {
      const error = new Error('Apply требует sourceFingerprint из отдельного dry-run.');
      error.code = 'WARRANTY_FACTORY_MAPPING_MANIFEST_INVALID';
      throw error;
    }
    const preview = planWarrantyClaimFactoryCounterpartyMappings({
      readData: storage.readData,
      manifest: manifest.value,
      expectedFingerprint: sourceFingerprint,
    });
    let backupPath = null;
    if (preview.changedRecords > 0) {
      backupPath = backupPathFor(dbPath);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      await db.backup(backupPath);
    }
    const result = applyWarrantyClaimFactoryCounterpartyMappings({
      readData: storage.readData,
      writeDataBatch: storage.writeDataBatch,
      manifest: manifest.value,
      expectedFingerprint: sourceFingerprint,
    });
    console.log(JSON.stringify({
      ok: true,
      mode: 'apply',
      dbPath,
      manifestPath: manifest.path,
      backupPath,
      ...result,
    }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || 'WARRANTY_FACTORY_MAPPING_FAILED',
      error: error?.message || String(error),
      details: error?.details,
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  backupPathFor,
  createStorage,
  parseArgs,
  readManifest,
};
