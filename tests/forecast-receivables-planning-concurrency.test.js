import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  createForecastTestContext,
  forecastCommand,
} from './forecast-receivables-planning-fixtures.js';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = path.join(root, 'tests/helpers/forecast-receivables-concurrency-worker.mjs');

function runWorker(dbPath, command) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, dbPath, JSON.stringify(command)], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`worker exited ${code}: ${stderr}`));
      const line = stdout.trim().split('\n').filter(Boolean).at(-1);
      try {
        return resolve(JSON.parse(line));
      } catch {
        return reject(new Error(`invalid worker output: ${stdout}\n${stderr}`));
      }
    });
  });
}

function withFileContext(buildCommands) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-pr7-concurrency-'));
  const dbPath = path.join(dir, 'forecast.sqlite');
  const context = createForecastTestContext({ dbPath });
  const setup = buildCommands(context);
  context.close();
  return { dir, dbPath, ...setup };
}

function inspect(dbPath) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const result = {
    runs: db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count,
    currentRuns: db.prepare(`
      SELECT COUNT(*) AS count FROM forecast_receivable_runs run
      WHERE NOT EXISTS (
        SELECT 1 FROM forecast_receivable_run_supersessions lifecycle
        WHERE lifecycle.predecessorRunId = run.id
      )
    `).get().count,
    items: db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_items').get().count,
    supersessions: db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_run_supersessions').get().count,
    operations: db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_operations').get().count,
    audits: db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_audit_events').get().count,
    foreignKeys: db.pragma('foreign_key_check'),
  };
  db.close();
  return result;
}

test('independent-process first-run race has one winner and one deterministic loser', async () => {
  const setup = withFileContext(context => ({
    commands: [
      forecastCommand(context, { idempotencyKey: 'first-race-a', correlationId: 'first-race-a' }),
      forecastCommand(context, { idempotencyKey: 'first-race-b', correlationId: 'first-race-b' }),
    ],
  }));
  try {
    const results = await Promise.all(setup.commands.map(command => runWorker(setup.dbPath, command)));
    assert.equal(results.filter(item => item.ok).length, 1);
    assert.deepEqual(results.filter(item => !item.ok).map(item => item.code), ['FORECAST_ACTIVE_RUN_CONFLICT']);
    assert.equal(results.some(item => /SQLITE_(?:BUSY|LOCKED)/.test(item.message || '')), false);
    assert.deepEqual(inspect(setup.dbPath), {
      runs: 1,
      currentRuns: 1,
      items: 1,
      supersessions: 0,
      operations: 1,
      audits: 1,
      foreignKeys: [],
    });
  } finally {
    fs.rmSync(setup.dir, { recursive: true, force: true });
  }
});

test('independent-process exact replay race creates one run and one audit', async () => {
  const setup = withFileContext(context => ({
    command: forecastCommand(context, {
      idempotencyKey: 'exact-replay-race',
      correlationId: 'exact-replay-race',
    }),
  }));
  try {
    const results = await Promise.all([
      runWorker(setup.dbPath, setup.command),
      runWorker(setup.dbPath, setup.command),
    ]);
    assert.equal(results.every(item => item.ok), true);
    assert.deepEqual(results.map(item => item.result.replayed).sort(), [false, true]);
    assert.equal(new Set(results.map(item => item.result.forecastRunId)).size, 1);
    assert.deepEqual(inspect(setup.dbPath), {
      runs: 1,
      currentRuns: 1,
      items: 1,
      supersessions: 0,
      operations: 1,
      audits: 1,
      foreignKeys: [],
    });
  } finally {
    fs.rmSync(setup.dir, { recursive: true, force: true });
  }
});

test('independent-process changed-input retry race conflicts without partial history', async () => {
  const setup = withFileContext(context => ({
    commands: [
      forecastCommand(context, { idempotencyKey: 'changed-retry-race', correlationId: 'changed-a' }),
      forecastCommand(context, { idempotencyKey: 'changed-retry-race', correlationId: 'changed-b' }),
    ],
  }));
  try {
    const results = await Promise.all(setup.commands.map(command => runWorker(setup.dbPath, command)));
    assert.equal(results.filter(item => item.ok).length, 1);
    assert.deepEqual(results.filter(item => !item.ok).map(item => item.code), ['FORECAST_IDEMPOTENCY_CONFLICT']);
    assert.deepEqual(inspect(setup.dbPath), {
      runs: 1,
      currentRuns: 1,
      items: 1,
      supersessions: 0,
      operations: 1,
      audits: 1,
      foreignKeys: [],
    });
  } finally {
    fs.rmSync(setup.dir, { recursive: true, force: true });
  }
});

test('independent-process replacement race has one successor and no orphan lifecycle', async () => {
  const setup = withFileContext(context => {
    const first = context.forecastService.calculateForecastRun(
      context.forecastCommandContext,
      forecastCommand(context),
    );
    return {
      commands: [
        forecastCommand(context, {
          idempotencyKey: 'replacement-race-a',
          correlationId: 'replacement-race-a',
          expectedActiveRunIds: [first.forecastRunId],
        }),
        forecastCommand(context, {
          idempotencyKey: 'replacement-race-b',
          correlationId: 'replacement-race-b',
          expectedActiveRunIds: [first.forecastRunId],
        }),
      ],
    };
  });
  try {
    const results = await Promise.all(setup.commands.map(command => runWorker(setup.dbPath, command)));
    assert.equal(results.filter(item => item.ok).length, 1);
    assert.deepEqual(results.filter(item => !item.ok).map(item => item.code), ['FORECAST_ACTIVE_RUN_CONFLICT']);
    assert.deepEqual(inspect(setup.dbPath), {
      runs: 2,
      currentRuns: 1,
      items: 2,
      supersessions: 1,
      operations: 2,
      audits: 2,
      foreignKeys: [],
    });
  } finally {
    fs.rmSync(setup.dir, { recursive: true, force: true });
  }
});
