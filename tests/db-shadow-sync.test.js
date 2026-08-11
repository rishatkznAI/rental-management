import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('lifecycle batch rolls back JSON and Rental writes when Gantt SQL shadow sync fails', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'rental-db-shadow-'));
  const dbPath = join(tempDir, 'app.sqlite');
  const dbModule = fileURLToPath(new URL('../server/db.js', import.meta.url));
  const shadowModule = fileURLToPath(new URL('../server/lib/sql-shadow-indexes.js', import.meta.url));
  const script = `
    const db = require(${JSON.stringify(dbModule)});
    const { ensureSqlShadowSchema } = require(${JSON.stringify(shadowModule)});
    db.setData('rentals', [{ id: 'R-before', status: 'active' }]);
    db.setData('gantt_rentals', [{
      id: 'GR-before', rentalId: 'R-before', equipmentId: 'EQ-1',
      startDate: '2026-05-01', endDate: '2026-05-02', status: 'active'
    }]);
    const sqlite = db.ensureDb();
    sqlite.exec(\`
      CREATE TRIGGER fail_gantt_shadow_insert
      BEFORE INSERT ON gantt_rentals_sql
      BEGIN
        SELECT RAISE(ABORT, 'shadow sync unavailable');
      END;
    \`);
    let error = null;
    try {
      db.setDataBatch([
        { name: 'rentals', value: [{ id: 'R-after', status: 'active' }] },
        { name: 'gantt_rentals', value: [{
          id: 'GR-after', rentalId: 'R-after', equipmentId: 'EQ-1',
          startDate: '2026-05-03', endDate: '2026-05-04', status: 'active'
        }] },
      ]);
    } catch (caught) {
      error = { code: caught.code, message: caught.message };
    }
    const rolledBack = {
      rentals: db.getData('rentals'),
      gantt: db.getData('gantt_rentals'),
      shadow: sqlite.prepare('SELECT id, rentalId, rawJson FROM gantt_rentals_sql ORDER BY id').all(),
    };
    sqlite.exec('DROP TRIGGER fail_gantt_shadow_insert');
    const nextGantt = [{
      id: 'GR-normal', rentalId: 'R-before', equipmentId: 'EQ-1',
      startDate: '2026-05-05', endDate: '2026-05-06', status: 'active'
    }];
    db.setData('gantt_rentals', nextGantt);
    db.setData('documents', [{ id: 'D-1', rentalId: 'R-before', title: 'Акт' }]);
    ensureSqlShadowSchema(sqlite);
    ensureSqlShadowSchema(sqlite);
    process.stdout.write(JSON.stringify({
      error,
      rolledBack,
      normalJson: db.getData('gantt_rentals'),
      normalShadow: sqlite.prepare('SELECT id, rentalId, rawJson FROM gantt_rentals_sql').all(),
      documentJson: db.getData('documents'),
      documentShadow: sqlite.prepare('SELECT id, rawJson FROM documents_sql').all(),
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

    assert.equal(output.error.code, 'GANTT_SQL_SHADOW_SYNC_FAILED');
    assert.match(output.error.message, /shadow sync unavailable/);
    assert.deepEqual(output.rolledBack.rentals, [{ id: 'R-before', status: 'active' }]);
    assert.deepEqual(output.rolledBack.gantt.map(item => item.id), ['GR-before']);
    assert.deepEqual(output.rolledBack.shadow.map(item => item.id), ['GR-before']);
    assert.deepEqual(JSON.parse(output.rolledBack.shadow[0].rawJson), output.rolledBack.gantt[0]);

    assert.deepEqual(output.normalJson.map(item => item.id), ['GR-normal']);
    assert.deepEqual(output.normalShadow.map(item => item.id), ['GR-normal']);
    assert.deepEqual(JSON.parse(output.normalShadow[0].rawJson), output.normalJson[0]);
    assert.deepEqual(output.documentJson.map(item => item.id), ['D-1']);
    assert.deepEqual(output.documentShadow.map(item => item.id), ['D-1']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
