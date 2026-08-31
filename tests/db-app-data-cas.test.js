import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('app_data compare-and-swap rejects stale single and batch tenant views atomically', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'rental-app-data-cas-'));
  const dbPath = join(tempDir, 'app.sqlite');
  const dbModule = fileURLToPath(new URL('../server/db.js', import.meta.url));
  const script = `
    const store = require(${JSON.stringify(dbModule)});
    store.setData('equipment', [
      { id: 'EQ-A', companyId: 'A', tenantId: 'A', status: 'available' },
      { id: 'EQ-B', companyId: 'B', tenantId: 'B', status: 'available' },
    ]);
    store.setData('rentals', [
      { id: 'R-A', companyId: 'A', tenantId: 'A', status: 'active' },
    ]);

    const staleEquipment = store.getData('equipment');
    const staleRentals = store.getData('rentals');
    const equipmentFingerprint = store.appDataValueFingerprint(staleEquipment);
    const rentalsFingerprint = store.appDataValueFingerprint(staleRentals);

    store.setData('equipment', staleEquipment.map(item => (
      item.id === 'EQ-B' ? { ...item, status: 'in_service' } : item
    )));

    const errors = [];
    try {
      store.setDataCompareAndSwap(
        'equipment',
        staleEquipment.map(item => item.id === 'EQ-A' ? { ...item, status: 'rented' } : item),
        equipmentFingerprint,
      );
    } catch (error) {
      errors.push({ code: error.code, collection: error.collection });
    }
    try {
      store.setDataBatchCompareAndSwap([
        {
          name: 'rentals',
          value: [{ ...staleRentals[0], status: 'closed' }],
          expectedFingerprint: rentalsFingerprint,
        },
        {
          name: 'equipment',
          value: staleEquipment,
          expectedFingerprint: equipmentFingerprint,
        },
      ]);
    } catch (error) {
      errors.push({ code: error.code, collection: error.collection });
    }

    const currentEquipment = store.getData('equipment');
    const currentRentals = store.getData('rentals');
    const currentFingerprint = store.appDataValueFingerprint(currentEquipment);
    store.setDataCompareAndSwap(
      'equipment',
      currentEquipment.map(item => item.id === 'EQ-A' ? { ...item, status: 'rented' } : item),
      currentFingerprint,
    );
    process.stdout.write(JSON.stringify({
      errors,
      equipment: store.getData('equipment'),
      rentals: currentRentals,
    }));
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DB_PATH: dbPath },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.errors, [
      { code: 'APP_DATA_CONCURRENT_MODIFICATION', collection: 'equipment' },
      { code: 'APP_DATA_CONCURRENT_MODIFICATION', collection: 'equipment' },
    ]);
    assert.equal(output.equipment.find(item => item.id === 'EQ-A').status, 'rented');
    assert.equal(output.equipment.find(item => item.id === 'EQ-B').status, 'in_service');
    assert.equal(output.rentals[0].status, 'active', 'stale batch must roll back its earlier entry');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('app_data reads fail closed on malformed JSON instead of treating it as an absent collection', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'rental-app-data-invalid-json-'));
  const dbPath = join(tempDir, 'app.sqlite');
  const dbModule = fileURLToPath(new URL('../server/db.js', import.meta.url));
  const script = `
    const store = require(${JSON.stringify(dbModule)});
    const db = store.ensureDb();
    db.prepare('INSERT INTO app_data(name,json) VALUES (?,?)').run('equipment', '{broken');
    try {
      store.getData('equipment');
      process.stdout.write(JSON.stringify({ unexpected: true }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ code: error.code, collection: error.collection }));
    }
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DB_PATH: dbPath },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      code: 'APP_DATA_INVALID_JSON',
      collection: 'equipment',
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
