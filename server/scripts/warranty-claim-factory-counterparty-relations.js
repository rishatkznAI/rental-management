#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  planWarrantyClaimFactoryCounterpartyMappings,
} = require('../lib/warranty-claim-factory-counterparty-relations');
const {
  assertAuditedMaintenanceApplyUnavailable,
  createStrictReadOnlyStorage,
  resolveExplicitDatabasePath,
} = require('../lib/maintenance-script-safety');

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
    'Dry-run is read-only. Raw --apply is disabled; use an audited tenant-scoped maintenance runner.',
    'Names, manufacturer, INN, phone, email, and other metadata are never mapping inputs.',
  ].join('\n'));
}

function createStorage(db) {
  return createStrictReadOnlyStorage(db);
}

function readManifest(manifestPath) {
  if (!manifestPath) throw new Error('--manifest is required');
  const resolved = path.resolve(manifestPath);
  if (!fs.existsSync(resolved)) throw new Error(`Mapping manifest not found: ${resolved}`);
  return { path: resolved, value: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const dbPath = resolveExplicitDatabasePath(args.dbPath);
  assertAuditedMaintenanceApplyUnavailable(args.apply, 'warranty factory counterparty mapping');
  const manifest = readManifest(args.manifestPath);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const storage = createStorage(db);
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
      code: error?.code || 'WARRANTY_FACTORY_MAPPING_FAILED',
      error: error?.message || String(error),
      details: error?.details,
    }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  createStorage,
  parseArgs,
  readManifest,
};
