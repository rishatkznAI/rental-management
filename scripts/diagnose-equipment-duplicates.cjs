#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { buildEquipmentDuplicateDiagnostics } = require('../server/lib/equipment-duplicate-diagnostics.js');

const rootDir = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(rootDir, 'server', 'db.js'));
const Database = serverRequire('better-sqlite3');
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const dbArgIndex = args.indexOf('--db');
const dbPath = path.resolve(rootDir, dbArgIndex >= 0 ? args[dbArgIndex + 1] : (process.env.DB_PATH || 'server/data/app.sqlite'));

function readCollection(db, name, fallback) {
  const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
  if (!row || typeof row.json !== 'string') return fallback;
  try {
    const parsed = JSON.parse(row.json);
    return Array.isArray(fallback) && !Array.isArray(parsed) ? fallback : parsed;
  } catch (error) {
    throw new Error(`Failed to parse app_data.${name}: ${error.message}`);
  }
}

function loadCollections() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found: ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return {
      equipment: readCollection(db, 'equipment', []),
      rentals: readCollection(db, 'rentals', []),
      ganttRentals: readCollection(db, 'gantt_rentals', []),
      service: readCollection(db, 'service', []),
      deliveries: readCollection(db, 'deliveries', []),
      documents: readCollection(db, 'documents', []),
    };
  } finally {
    db.close();
  }
}

function printTextReport(report) {
  console.log('Equipment duplicate diagnostics');
  console.log(`Database: ${dbPath}`);
  console.log('Mode: read-only, no data changes');
  console.log('');
  console.log(`Equipment total: ${report.summary.equipmentTotal}`);
  console.log(`Duplicate groups: ${report.summary.duplicateGroups}`);
  console.log(`InventoryNumber duplicates: ${report.summary.duplicateInventoryNumbers}`);
  console.log(`SerialNumber duplicates: ${report.summary.duplicateSerialNumbers}`);
  console.log(`Affected equipment: ${report.summary.affectedEquipment}`);

  if (report.duplicates.length === 0) {
    console.log('');
    console.log('No duplicate inventoryNumber or serialNumber values found.');
    return;
  }

  report.duplicates.forEach(group => {
    console.log('');
    console.log(`[${group.field}] "${group.value}" (normalized: "${group.normalizedValue}", count: ${group.count})`);
    group.items.forEach(item => {
      console.log(`- ${item.id || '(no id)'} | ${item.model || '(no model)'} | status=${item.status || '-'} | owner=${item.owner || '-'}`);
      console.log(`  serial=${item.serialNumber || '-'} | inventory=${item.inventoryNumber || '-'}`);
      console.log(`  rentals=${item.linkedRentals.length} | service=${item.linkedServiceTickets.length} | deliveries=${item.linkedDeliveries.length} | documents=${item.linkedDocuments.length} | gsm=${item.gsm.hasData ? 'yes' : 'no'}`);
    });
  });
}

try {
  const report = buildEquipmentDuplicateDiagnostics(loadCollections());
  if (jsonOutput) {
    console.log(JSON.stringify({ dbPath, ...report }, null, 2));
  } else {
    printTextReport(report);
  }
  process.exitCode = report.duplicates.length > 0 ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
