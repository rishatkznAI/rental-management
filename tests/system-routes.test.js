import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const {
  buildSystemControlCenterStatus,
  registerSystemRoutes,
} = require('../server/routes/system.js');
const { createAccessControl } = require('../server/lib/access-control.js');
const {
  deterministicRoleAssignmentId,
  deterministicRoleProfileId,
} = require('../server/lib/counterparty-role-profiles.js');
const { getBuildInfo } = require('../server/lib/build-info.js');
const { resolveReleaseEnv } = require('../server/scripts/start-with-release-type.cjs');

function createSystemApp(overrides = {}) {
  const app = express();
  const messages = [];
  const auditEntries = [];
  const readData = overrides.readData || (() => []);
  app.use(express.json());
  registerSystemRoutes(app, {
    readData,
    writeData: overrides.writeData || (() => {}),
    writeDataBatch: overrides.writeDataBatch,
    getSnapshot: overrides.getSnapshot || (() => ({})),
    saveSnapshot: overrides.saveSnapshot || (() => {}),
    botToken: 'token-present',
    getBotUsers: () => ({}),
    sendMessage: async (target, text) => {
      messages.push({ target, text });
      return { ok: true };
    },
    countActiveSessions: () => 0,
    webhookUrl: '',
    requireAuth: overrides.requireAuth || ((req, _res, next) => {
      req.user = overrides.user || {
        userId: 'U-admin',
        userName: 'Админ',
        userRole: 'Администратор',
        rawRole: 'admin',
        normalizedRole: 'Администратор',
        email: 'admin@example.test',
      };
      next();
    }),
    requireAdmin: overrides.requireAdmin || ((_req, _res, next) => next()),
    fetchImpl: overrides.fetchImpl || fetch,
    assertPublicHttpUrlImpl: overrides.assertPublicHttpUrlImpl || (async (url) => new URL(url)),
    auditLog: overrides.auditLog || ((_req, entry) => auditEntries.push(entry)),
    analyzeGanttRentalLinks: overrides.analyzeGanttRentalLinks,
    backfillGanttRentalLinks: overrides.backfillGanttRentalLinks,
    getBuildInfo: overrides.getBuildInfo || (() => ({ version: 'test' })),
    getAppDisabledConfig: overrides.getAppDisabledConfig,
    getRoleAccessSummary: () => ({
      readableCollections: ['equipment', 'rentals'],
      writableCollections: ['equipment'],
    }),
    accessControl: overrides.accessControl || createAccessControl({ readData }),
    jsonCollections: overrides.jsonCollections || ['equipment', 'clients', 'users'],
    createDatabaseBackup: overrides.createDatabaseBackup,
    dbPath: overrides.dbPath || ':memory:',
    fileRoots: overrides.fileRoots,
    uploadRoot: overrides.uploadRoot,
  });
  return { app, messages, auditEntries };
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function getBuffer(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const arrayBuffer = await response.arrayBuffer();
  return {
    status: response.status,
    headers: response.headers,
    buffer: Buffer.from(arrayBuffer),
  };
}

function listZipEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.push({ name, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

async function withBuildInfoEnv(env, fn) {
  const keys = [
    'BACKEND_RELEASE_MARKER_FILE',
    'RELEASE_TYPE',
    'RELEASE_PREFLIGHT_RELEASE_TYPE',
    'RAILWAY_RELEASE_TYPE',
    'RAILWAY_GIT_COMMIT_SHA',
    'GIT_COMMIT_SHA',
    'COMMIT_SHA',
    'SOURCE_VERSION',
    'BUILD_TIME',
    'RAILWAY_DEPLOYMENT_CREATED_AT',
  ];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.entries(env).forEach(([key, value]) => {
    if (value !== undefined) process.env[key] = value;
  });
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function withLegacySyncEnabled(fn) {
  const previousEnabled = process.env.ENABLE_LEGACY_SYNC;
  process.env.ENABLE_LEGACY_SYNC = '1';
  try {
    return await fn();
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_LEGACY_SYNC;
    else process.env.ENABLE_LEGACY_SYNC = previousEnabled;
  }
}

function createLegacySyncStore(initialCollections) {
  const collections = structuredClone(initialCollections);
  const batches = [];
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    getSnapshot: () => structuredClone(collections),
    writeData: (name, value) => {
      writes.push({ name, value: structuredClone(value) });
      collections[name] = value;
    },
    writeDataBatch: entries => {
      batches.push(structuredClone(entries));
      for (const entry of entries) collections[entry.name] = entry.value;
    },
  });
  return { app, batches, collections, writes };
}

function legacySyncCounterparty(roles) {
  return {
    id: 'CP-sync',
    type: 'legal_entity',
    legalName: 'ООО Синхронизация',
    shortName: 'Синхронизация',
    inn: '7707083893',
    status: 'active',
    roles,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  };
}

function legacySyncClient(overrides = {}) {
  return {
    id: 'C-sync',
    counterpartyId: 'CP-sync',
    company: 'Синхронизация',
    legalName: 'ООО Синхронизация',
    inn: '7707083893',
    status: 'active',
    manager: 'Исходный менеджер',
    ...overrides,
  };
}

function legacySyncAssignment(roleCode, overrides = {}) {
  return {
    id: `RA-${roleCode}`,
    counterpartyId: 'CP-sync',
    roleCode,
    status: 'active',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: null,
    createdBy: 'U-original',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'original',
    ...overrides,
  };
}

async function requestRaw(baseUrl, path, method) {
  const response = await fetch(`${baseUrl}${path}`, { method });
  const text = await response.text();
  return { status: response.status, text };
}

function collectObjectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectObjectKeys(child, keys);
    }
  }
  return keys;
}

test('/api/bot-test requires explicit chatId or env chat id', async () => {
  const previousEnabled = process.env.ENABLE_BOT_TEST;
  const previousChatId = process.env.BOT_TEST_CHAT_ID;
  process.env.ENABLE_BOT_TEST = '1';
  delete process.env.BOT_TEST_CHAT_ID;
  const { app, messages } = createSystemApp();

  try {
    await withServer(app, async (baseUrl) => {
      const response = await getJson(baseUrl, '/api/bot-test');
      assert.equal(response.status, 400);
      assert.match(response.body.error, /chatId is required/);
      assert.equal(messages.length, 0);
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_BOT_TEST;
    else process.env.ENABLE_BOT_TEST = previousEnabled;
    if (previousChatId === undefined) delete process.env.BOT_TEST_CHAT_ID;
    else process.env.BOT_TEST_CHAT_ID = previousChatId;
  }
});

test('/api/bot-test sends only to provided chatId', async () => {
  const previousEnabled = process.env.ENABLE_BOT_TEST;
  const previousChatId = process.env.BOT_TEST_CHAT_ID;
  process.env.ENABLE_BOT_TEST = '1';
  delete process.env.BOT_TEST_CHAT_ID;
  const { app, messages } = createSystemApp();

  try {
    await withServer(app, async (baseUrl) => {
      const response = await getJson(baseUrl, '/api/bot-test?chatId=777&text=ping');
      assert.equal(response.status, 200);
      assert.equal(response.body.chatId, 777);
      assert.deepEqual(messages[0], { target: { chat_id: 777 }, text: 'ping' });
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_BOT_TEST;
    else process.env.ENABLE_BOT_TEST = previousEnabled;
    if (previousChatId === undefined) delete process.env.BOT_TEST_CHAT_ID;
    else process.env.BOT_TEST_CHAT_ID = previousChatId;
  }
});

test('/api/admin/production-diagnostics returns safe admin diagnostics', async () => {
  const collections = {
    equipment: [{ id: 'E-1' }],
    rentals: [{ id: 'R-1' }, { id: 'R-2' }],
    service: [],
    deliveries: [{ id: 'D-1' }],
    documents: [],
    payments: [{ id: 'P-1' }],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/production-diagnostics');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.backend.build.version, 'test');
    assert.equal(response.body.user.email, 'admin@example.test');
    assert.equal(response.body.user.rawRole, 'admin');
    assert.deepEqual(response.body.access.readableCollections, ['equipment', 'rentals']);
    assert.equal(response.body.endpoints.equipment.count, 1);
    assert.equal(response.body.endpoints.rentals.count, 2);
    assert.equal(response.body.rentalLinks.summary.rentalsTotal, 2);
    assert.equal(response.body.rentalLinks.summary.ganttTotal, 0);
    assert.equal(response.body.rentalLinks.summary.rentalsWithoutGantt, 2);

    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, /password|token-present|secret/i);
  });
});

test('/api/admin/production-diagnostics is admin-only', async () => {
  const { app } = createSystemApp({
    requireAdmin: (_req, res) => res.status(403).json({ ok: false, error: 'Forbidden' }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/production-diagnostics');
    assert.equal(response.status, 403);
  });
});

test('/health and /api/version expose RELEASE_TYPE before backend marker fallback', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rentCore-release-marker-'));
  const markerFile = path.join(tempDir, 'release-marker.json');
  fs.writeFileSync(markerFile, JSON.stringify({
    commit: '1117ad74e905',
    commitFull: '1117ad74e905f9553dd46b7d3a6cf007723844cc',
    buildTime: '2026-06-07T00:00:00.000Z',
    deployTime: '2026-06-07T00:00:00.000Z',
    releaseType: 'full-stack',
  }), 'utf8');

  await withBuildInfoEnv({
    BACKEND_RELEASE_MARKER_FILE: markerFile,
    RELEASE_TYPE: 'frontend-only',
  }, async () => {
    const { app } = createSystemApp({ getBuildInfo });
    await withServer(app, async baseUrl => {
      const health = await getJson(baseUrl, '/health');
      assert.equal(health.status, 200);
      assert.equal(health.body.build.releaseType, 'frontend-only');
      assert.deepEqual(health.body.build.release, { type: 'frontend-only' });

      const version = await getJson(baseUrl, '/api/version');
      assert.equal(version.status, 200);
      assert.equal(version.body.build.releaseType, 'frontend-only');
      assert.deepEqual(version.body.build.release, { type: 'frontend-only' });
    });
  });
});

test('/health and /api/version read backend marker releaseType when env metadata is absent', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rentCore-release-marker-'));
  const markerFile = path.join(tempDir, 'release-marker.json');
  fs.writeFileSync(markerFile, JSON.stringify({
    commit: '1117ad74e905',
    commitFull: '1117ad74e905f9553dd46b7d3a6cf007723844cc',
    buildTime: '2026-06-07T00:00:00.000Z',
    deployTime: '2026-06-07T00:00:00.000Z',
    releaseType: 'full-stack',
  }), 'utf8');

  await withBuildInfoEnv({
    BACKEND_RELEASE_MARKER_FILE: markerFile,
  }, async () => {
    const { app } = createSystemApp({ getBuildInfo });
    await withServer(app, async baseUrl => {
      const health = await getJson(baseUrl, '/health');
      assert.equal(health.status, 200);
      assert.equal(health.body.build.releaseType, 'full-stack');
      assert.deepEqual(health.body.build.release, { type: 'full-stack' });

      const version = await getJson(baseUrl, '/api/version');
      assert.equal(version.status, 200);
      assert.equal(version.body.build.releaseType, 'full-stack');
      assert.deepEqual(version.body.build.release, { type: 'full-stack' });
    });
  });
});

test('build info keeps unknown releaseType when marker and env metadata are absent', async () => {
  await withBuildInfoEnv({
    BACKEND_RELEASE_MARKER_FILE: path.join(os.tmpdir(), 'missing-rentCore-release-marker.json'),
  }, async () => {
    const build = getBuildInfo();
    assert.equal(build.releaseType, 'unknown');
    assert.deepEqual(build.release, { type: 'unknown' });
  });
});

test('build info still falls back to env releaseType when marker is absent', async () => {
  await withBuildInfoEnv({
    BACKEND_RELEASE_MARKER_FILE: path.join(os.tmpdir(), 'missing-rentCore-release-marker.json'),
    RELEASE_TYPE: 'backend',
  }, async () => {
    const build = getBuildInfo();
    assert.equal(build.releaseType, 'backend');
    assert.deepEqual(build.release, { type: 'backend' });
  });
});

test('build info reads RELEASE_PREFLIGHT_RELEASE_TYPE when RELEASE_TYPE is absent', async () => {
  await withBuildInfoEnv({
    BACKEND_RELEASE_MARKER_FILE: path.join(os.tmpdir(), 'missing-rentCore-release-marker.json'),
    RELEASE_PREFLIGHT_RELEASE_TYPE: 'full-stack',
  }, async () => {
    const build = getBuildInfo();
    assert.equal(build.releaseType, 'full-stack');
    assert.deepEqual(build.release, { type: 'full-stack' });
  });
});

test('build info reads RAILWAY_RELEASE_TYPE when explicit release env is absent', async () => {
  await withBuildInfoEnv({
    BACKEND_RELEASE_MARKER_FILE: path.join(os.tmpdir(), 'missing-rentCore-release-marker.json'),
    RAILWAY_RELEASE_TYPE: 'backend',
  }, async () => {
    const build = getBuildInfo();
    assert.equal(build.releaseType, 'backend');
    assert.deepEqual(build.release, { type: 'backend' });
  });
});

test('build info preserves Railway commit SHA while reading release type metadata', async () => {
  await withBuildInfoEnv({
    BACKEND_RELEASE_MARKER_FILE: path.join(os.tmpdir(), 'missing-rentCore-release-marker.json'),
    RAILWAY_GIT_COMMIT_SHA: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
    RELEASE_PREFLIGHT_RELEASE_TYPE: 'backend',
  }, async () => {
    const build = getBuildInfo();
    assert.equal(build.commit, '7050d37628f5');
    assert.equal(build.commitFull, '7050d37628f5e7469b59ec3f30741049b1c3aa94');
    assert.equal(build.releaseType, 'backend');
    assert.deepEqual(build.release, { type: 'backend' });
  });
});

test('Railway start wrapper provides backend release type when Railway commit metadata is present', () => {
  const env = resolveReleaseEnv({
    RAILWAY_GIT_COMMIT_SHA: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
  });
  assert.equal(env.RAILWAY_RELEASE_TYPE, 'backend');
});

test('Railway start wrapper preserves explicit full-stack release type metadata', () => {
  const env = resolveReleaseEnv({
    RAILWAY_GIT_COMMIT_SHA: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
    RELEASE_TYPE: 'full-stack',
  });
  assert.equal(env.RELEASE_TYPE, 'full-stack');
  assert.equal(env.RAILWAY_RELEASE_TYPE, undefined);
});

test('/api/admin/system-control-center is admin-only', async () => {
  const { app } = createSystemApp({
    requireAdmin: (_req, res) => res.status(403).json({ ok: false, error: 'Forbidden' }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/system-control-center');
    assert.equal(response.status, 403);
  });
});

test('/api/admin/system-control-center requires authentication', async () => {
  const { app } = createSystemApp({
    requireAuth: (_req, res) => res.status(401).json({ ok: false, error: 'Unauthorized' }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/system-control-center');
    assert.equal(response.status, 401);
  });
});

test('/api/admin/system-control-center returns safe admin status without env secrets', async () => {
  const previousSecret = process.env.RAILWAY_SECRET_TOKEN;
  const previousPassword = process.env.DATABASE_PASSWORD;
  process.env.RAILWAY_SECRET_TOKEN = 'super-secret-token';
  process.env.DATABASE_PASSWORD = 'do-not-return';
  const { app } = createSystemApp({
    dbPath: '/var/lib/railway/volume/app.sqlite',
    getBuildInfo: () => ({ commit: 'abc123def456', buildTime: '2026-05-19T00:00:00.000Z' }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await getJson(baseUrl, '/api/admin/system-control-center');
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      assert.match(response.body.status, /^(ok|warning|risk)$/);
      assert.equal(response.body.conservation.appDisabled, false);
      assert.equal(response.body.version.backendCommit, 'abc123def456');
      assert.equal(response.body.runtime.appDisabled, false);
      assert.equal(response.body.storage.dbSafeLabel, 'sqlite');
      assert.equal(response.body.database.usesSqlite, true);
      assert.equal(response.body.database.dbPathSafeLabel, 'volume/app.sqlite');

      const serialized = JSON.stringify(response.body);
      assert.doesNotMatch(serialized, /super-secret-token|do-not-return/i);
      assert.doesNotMatch(serialized, /RAILWAY_SECRET_TOKEN|DATABASE_PASSWORD/i);
      const keys = collectObjectKeys(response.body);
      assert.deepEqual(
        keys.filter(key => /^(TOKEN|PASSWORD|SECRET|KEY|DATABASE_URL)$/i.test(key)),
        [],
      );
    });
  } finally {
    if (previousSecret === undefined) delete process.env.RAILWAY_SECRET_TOKEN;
    else process.env.RAILWAY_SECRET_TOKEN = previousSecret;
    if (previousPassword === undefined) delete process.env.DATABASE_PASSWORD;
    else process.env.DATABASE_PASSWORD = previousPassword;
  }
});

test('/api/sync rejects dangerous fields when legacy sync is explicitly enabled', async () => {
  const previousEnabled = process.env.ENABLE_LEGACY_SYNC;
  process.env.ENABLE_LEGACY_SYNC = '1';
  const collections = {
    equipment: [{ id: 'EQ-1', serialNumber: 'OLD' }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    getSnapshot: () => ({ equipment: collections.equipment }),
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/sync', {
        equipment: [{ id: 'EQ-1', serialNumber: 'NEW', auditLog: [{ action: 'forged' }] }],
      });

      assert.equal(response.status, 403);
      assert.match(response.body.error, /auditLog/);
      assert.equal(collections.equipment[0].serialNumber, 'OLD');
      assert.equal(writes.length, 0);
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_LEGACY_SYNC;
    else process.env.ENABLE_LEGACY_SYNC = previousEnabled;
  }
});

test('/api/sync rejects Classic Rental replacement when legacy sync is explicitly enabled', async () => {
  const previousEnabled = process.env.ENABLE_LEGACY_SYNC;
  process.env.ENABLE_LEGACY_SYNC = '1';
  const collections = {
    rentals: [{ id: 'R-1', clientId: 'C-1', creditRiskSnapshot: { currentDebt: 75000 } }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    getSnapshot: () => ({ rentals: collections.rentals }),
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/sync', {
        rentals: [{ id: 'R-1', clientId: 'C-1', creditRiskSnapshot: { currentDebt: 0, forged: true } }],
      });

      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'RENTAL_LIFECYCLE_SYNC_DISABLED');
      assert.deepEqual(collections.rentals[0].creditRiskSnapshot, { currentDebt: 75000 });
      assert.equal(writes.length, 0);
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_LEGACY_SYNC;
    else process.env.ENABLE_LEGACY_SYNC = previousEnabled;
  }
});

test('/api/sync rejects independent Gantt projection replacement when legacy sync is explicitly enabled', async () => {
  const previousEnabled = process.env.ENABLE_LEGACY_SYNC;
  process.env.ENABLE_LEGACY_SYNC = '1';
  const collections = {
    gantt_rentals: [{ id: 'GR-1', rentalId: 'R-1', status: 'active' }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    getSnapshot: () => ({ gantt_rentals: collections.gantt_rentals }),
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/sync', {
        gantt_rentals: [{ id: 'GR-1', rentalId: 'R-1', status: 'returned' }],
      });

      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'RENTAL_LIFECYCLE_SYNC_DISABLED');
      assert.equal(collections.gantt_rentals[0].status, 'active');
      assert.equal(writes.length, 0);
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_LEGACY_SYNC;
    else process.env.ENABLE_LEGACY_SYNC = previousEnabled;
  }
});

test('/api/sync protects production smoke equipment fixture when legacy sync is explicitly enabled', async () => {
  const previousEnabled = process.env.ENABLE_LEGACY_SYNC;
  process.env.ENABLE_LEGACY_SYNC = '1';
  const fixture = {
    id: 'EQ-smoke',
    manufacturer: 'Skytech',
    model: 'Production smoke rental fixture',
    inventoryNumber: 'SMOKE-RENTAL-001',
    serialNumber: 'SMOKE-RENTAL-001',
    status: 'available',
    category: 'own',
    activeInFleet: true,
  };
  const collections = { equipment: [fixture] };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    getSnapshot: () => ({ equipment: collections.equipment }),
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/sync', {
        equipment: [{ ...fixture, saleStatus: 'on_sale' }],
      });

      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'SYSTEM_FIXTURE_PROTECTED');
      assert.equal(collections.equipment[0].saleStatus, undefined);
      assert.equal(writes.length, 0);
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_LEGACY_SYNC;
    else process.env.ENABLE_LEGACY_SYNC = previousEnabled;
  }
});

test('system control center interprets conservation flags and unknown DB isolation honestly', () => {
  const status = buildSystemControlCenterStatus({
    dbPath: '/app/storage/app.sqlite',
    buildInfo: { commit: 'abc123', buildTime: '2026-05-19T00:00:00.000Z' },
    getAppDisabledConfig: () => ({ disabled: true, message: 'paused' }),
    env: {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'production',
      APP_DISABLED: 'true',
      BOT_DISABLED: 'true',
      GSM_ENABLED: 'false',
      DB_PATH: '/app/storage/app.sqlite',
    },
    inspectStorage: () => ({
      mountPath: '/data',
      available: true,
      signalPresent: true,
      device: '/dev/zd1232',
      statDevice: 1232,
      totalKb: 899836,
      usedKb: 447072,
      freeKb: 452764,
      capacity: '50%',
      error: '',
    }),
  });

  assert.equal(status.environment.isProductionLike, true);
  assert.equal(status.conservation.appDisabled, true);
  assert.equal(status.conservation.webAccessBlocked, true);
  assert.equal(status.conservation.botDisabled, true);
  assert.equal(status.conservation.botWritesBlocked, true);
  assert.equal(status.conservation.gsmDisabled, true);
  assert.equal(status.conservation.gsmEnabled, false);
  assert.equal(status.conservation.gsmWritesBlocked, true);
  assert.equal(status.database.dbPathKind, 'unknown');
  assert.equal(status.storage.classification, 'unknown');
  assert.equal(status.storage.risk, 'unknown');
  assert.equal(status.storage.signalPresent, true);
  assert.equal(status.storage.device, '/dev/zd1232');
  assert.equal(status.storage.totalKb, 899836);
  assert.ok(status.recommendations.some(item => `${item.title} ${item.action}`.includes('Railway volume') || `${item.title} ${item.action}`.includes('DB_PATH')));
  assert.ok(status.checks.some(item => item.id === 'db_isolation' && item.status === 'unknown'));
  assert.ok(status.checks.some(item => item.id === 'production_conserved' && item.status === 'ok'));
});

test('system control center marks matching frontend/backend commits as OK', () => {
  const status = buildSystemControlCenterStatus({
    dbPath: '/data/app.sqlite',
    buildInfo: {
      commit: 'd2146e7eaea9',
      commitFull: 'd2146e7eaea9b4f8d7b5e8f1f9f6c6a0c7e3b2d1',
      buildTime: '2026-06-07T00:00:00.000Z',
      releaseType: 'full-stack',
    },
    getAppDisabledConfig: () => ({ disabled: true, message: 'paused' }),
    requestFrontendCommit: 'd2146e7eaea9',
    requestFrontendBuildTime: '2026-06-07T00:00:00.000Z',
    requestFrontendReleaseType: 'full-stack',
    env: {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'production',
      RAILWAY_SERVICE_NAME: 'rental-management',
      RAILWAY_VOLUME_MOUNT_PATH: '/data',
      APP_DISABLED: 'true',
      BOT_DISABLED: 'true',
      GSM_DISABLED: 'true',
      DB_PATH: '/data/app.sqlite',
    },
    inspectStorage: () => ({
      mountPath: '/data',
      available: true,
      signalPresent: true,
      device: '/dev/zd1232',
      statDevice: 1232,
      totalKb: 899836,
      usedKb: 447072,
      freeKb: 452764,
      capacity: '50%',
      error: '',
    }),
  });

  assert.equal(status.version.versionMatch, true);
  assert.equal(status.version.releaseStatus, 'ok');
  assert.equal(status.version.releaseType, 'full-stack');
  assert.equal(status.status, 'ok');
});

test('system control center treats production frontend-only commit drift as WARN', () => {
  const status = buildSystemControlCenterStatus({
    dbPath: '/data/app.sqlite',
    buildInfo: {
      commit: 'd9b3c24f014d',
      commitFull: 'd9b3c24f014d9f75f6174f44ea018c6b7a9f7c31',
      buildTime: '2026-06-06T00:00:00.000Z',
      releaseType: 'unknown',
    },
    getAppDisabledConfig: () => ({ disabled: true, message: 'paused' }),
    requestFrontendCommit: 'd2146e7eaea9',
    requestFrontendBuildTime: '2026-06-07T00:00:00.000Z',
    requestFrontendReleaseType: 'frontend-only',
    env: {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'production',
      RAILWAY_SERVICE_NAME: 'rental-management',
      RAILWAY_VOLUME_MOUNT_PATH: '/data',
      APP_DISABLED: 'true',
      BOT_DISABLED: 'true',
      GSM_DISABLED: 'true',
      DB_PATH: '/data/app.sqlite',
    },
    inspectStorage: () => ({
      mountPath: '/data',
      available: true,
      signalPresent: true,
      device: '/dev/zd1232',
      statDevice: 1232,
      totalKb: 899836,
      usedKb: 447072,
      freeKb: 452764,
      capacity: '50%',
      error: '',
    }),
  });

  assert.equal(status.version.versionMatch, false);
  assert.equal(status.version.releaseStatus, 'warning');
  assert.equal(status.version.releaseType, 'frontend-only');
  assert.equal(status.version.releaseBuildOrder, 'frontend-newer');
  assert.match(status.version.releaseMessage, /Frontend обновлён отдельно от backend/);
  assert.equal(status.status, 'warning');
  assert.ok(status.recommendations.some(item => item.level === 'warning' && /Frontend-only release drift/.test(item.title)));
});

test('system control center treats backend-newer drift as RISK even with stale frontend-only marker', () => {
  const status = buildSystemControlCenterStatus({
    dbPath: '/data/app.sqlite',
    buildInfo: {
      commit: 'd2146e7eaea9',
      commitFull: 'd2146e7eaea9b4f8d7b5e8f1f9f6c6a0c7e3b2d1',
      buildTime: '2026-06-08T00:00:00.000Z',
      releaseType: 'backend',
    },
    getAppDisabledConfig: () => ({ disabled: true, message: 'paused' }),
    requestFrontendCommit: 'd9b3c24f014d',
    requestFrontendBuildTime: '2026-06-07T00:00:00.000Z',
    requestFrontendReleaseType: 'frontend-only',
    env: {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'production',
      RAILWAY_SERVICE_NAME: 'rental-management',
      RAILWAY_VOLUME_MOUNT_PATH: '/data',
      APP_DISABLED: 'true',
      BOT_DISABLED: 'true',
      GSM_DISABLED: 'true',
      DB_PATH: '/data/app.sqlite',
    },
    inspectStorage: () => ({
      mountPath: '/data',
      available: true,
      signalPresent: true,
      device: '/dev/zd1232',
      statDevice: 1232,
      totalKb: 899836,
      usedKb: 447072,
      freeKb: 452764,
      capacity: '50%',
      error: '',
    }),
  });

  assert.equal(status.version.versionMatch, false);
  assert.equal(status.version.releaseStatus, 'risk');
  assert.equal(status.version.releaseBuildOrder, 'backend-newer');
  assert.match(status.version.releaseMessage, /несовместимых release/);
  assert.equal(status.status, 'risk');
});

test('system control center treats unknown release_type commit drift as RISK', () => {
  const status = buildSystemControlCenterStatus({
    dbPath: '/data/app.sqlite',
    buildInfo: {
      commit: 'd9b3c24f014d',
      commitFull: 'd9b3c24f014d9f75f6174f44ea018c6b7a9f7c31',
      buildTime: '2026-06-06T00:00:00.000Z',
      releaseType: 'unknown',
    },
    getAppDisabledConfig: () => ({ disabled: true, message: 'paused' }),
    requestFrontendCommit: 'd2146e7eaea9',
    env: {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'production',
      RAILWAY_SERVICE_NAME: 'rental-management',
      RAILWAY_VOLUME_MOUNT_PATH: '/data',
      APP_DISABLED: 'true',
      BOT_DISABLED: 'true',
      GSM_DISABLED: 'true',
      DB_PATH: '/data/app.sqlite',
    },
    inspectStorage: () => ({
      mountPath: '/data',
      available: true,
      signalPresent: true,
      device: '/dev/zd1232',
      statDevice: 1232,
      totalKb: 899836,
      usedKb: 447072,
      freeKb: 452764,
      capacity: '50%',
      error: '',
    }),
  });

  assert.equal(status.version.versionMatch, false);
  assert.equal(status.version.releaseStatus, 'risk');
  assert.equal(status.version.releaseType, 'unknown');
  assert.match(status.version.releaseMessage, /несовместимых release/);
  assert.equal(status.status, 'risk');
  assert.ok(status.recommendations.some(item => item.level === 'risk' && /Риск несовместимого release/.test(item.title)));
});

test('system control center classifies /data DB path as Railway production volume when production env is present', () => {
  const status = buildSystemControlCenterStatus({
    dbPath: '/data/app.sqlite',
    buildInfo: { commit: 'abc123', buildTime: '2026-05-19T00:00:00.000Z' },
    getAppDisabledConfig: () => ({ disabled: false }),
    env: {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'production',
      RAILWAY_SERVICE_NAME: 'rental-management',
      RAILWAY_VOLUME_MOUNT_PATH: '/data',
      BOT_DISABLED: 'true',
      GSM_DISABLED: 'true',
      DB_PATH: '/data/app.sqlite',
    },
    inspectStorage: () => ({
      mountPath: '/data',
      available: true,
      signalPresent: true,
      device: '/dev/zd1232',
      statDevice: 1232,
      totalKb: 899836,
      usedKb: 447072,
      freeKb: 452764,
      capacity: '50%',
      error: '',
    }),
  });

  assert.equal(status.environment.isProductionLike, true);
  assert.equal(status.database.dbPathSafeLabel, 'data/app.sqlite');
  assert.equal(status.database.dbPathKind, 'production-volume');
  assert.equal(status.storage.classification, 'production-volume');
  assert.equal(status.storage.mountPath, '/data');
  assert.equal(status.storage.risk, 'warning');
  assert.ok(status.storage.volumeSignals.includes('RAILWAY_ENVIRONMENT_SET'));
  assert.ok(status.storage.volumeSignals.includes('RAILWAY_VOLUME_SIGNAL_SET'));
  assert.ok(status.checks.some(item => item.id === 'db_isolation' && item.status === 'ok'));
});

test('system control center classifies /data DB path as Railway staging volume when mounted', () => {
  const status = buildSystemControlCenterStatus({
    dbPath: '/data/app.sqlite',
    buildInfo: { commit: 'abc123', buildTime: '2026-05-19T00:00:00.000Z' },
    getAppDisabledConfig: () => ({ disabled: false }),
    env: {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      RAILWAY_SERVICE_NAME: 'rental-management',
      RAILWAY_VOLUME_MOUNT_PATH: '/data',
      BOT_DISABLED: 'true',
      GSM_DISABLED: 'true',
      DB_PATH: '/data/app.sqlite',
    },
    inspectStorage: () => ({
      mountPath: '/data',
      available: true,
      signalPresent: true,
      device: '/dev/zd1232',
      statDevice: 1232,
      totalKb: 899836,
      usedKb: 447072,
      freeKb: 452764,
      capacity: '50%',
      error: '',
    }),
  });

  assert.equal(status.environment.isStagingLike, true);
  assert.equal(status.database.dbPathSafeLabel, 'data/app.sqlite');
  assert.equal(status.database.dbPathKind, 'staging-volume');
  assert.equal(status.storage.classification, 'staging-volume');
  assert.equal(status.storage.mountPath, '/data');
  assert.equal(status.storage.risk, 'ok');
  assert.ok(status.storage.volumeSignals.includes('RAILWAY_VOLUME_SIGNAL_SET'));
  assert.ok(status.checks.some(item => item.id === 'db_isolation' && item.status === 'ok'));
});

test('system control center treats GSM_DISABLED=true as write blocking', () => {
  const status = buildSystemControlCenterStatus({
    dbPath: ':memory:',
    buildInfo: {},
    getAppDisabledConfig: () => ({ disabled: false }),
    env: {
      NODE_ENV: 'development',
      GSM_DISABLED: 'true',
      GSM_ENABLED: 'true',
    },
  });

  assert.equal(status.conservation.gsmDisabled, true);
  assert.equal(status.conservation.gsmWritesBlocked, true);
  assert.equal(status.conservation.gsmEnabled, true);
});

test('system control center reports unavailable storage signal without failing', () => {
  const status = buildSystemControlCenterStatus({
    dbPath: ':memory:',
    buildInfo: {},
    getAppDisabledConfig: () => ({ disabled: false }),
    env: { NODE_ENV: 'test', RAILWAY_ENVIRONMENT_NAME: 'staging', BOT_DISABLED: 'true', GSM_DISABLED: 'true' },
    inspectStorage: () => ({
      mountPath: '/data',
      available: false,
      signalPresent: false,
      device: '',
      statDevice: null,
      totalKb: null,
      usedKb: null,
      freeKb: null,
      capacity: '',
      error: 'mount-not-found',
    }),
  });

  assert.equal(status.environment.isStagingLike, true);
  assert.equal(status.storage.signalPresent, false);
  assert.equal(status.storage.risk, 'unknown');
  assert.ok(status.checks.some(item => item.id === 'storage_signal' && item.status === 'unknown'));
  assert.ok(status.checks.some(item => item.id === 'staging_external_writes' && item.status === 'ok'));
});

test('/api/admin/rental-equipment-diagnostics returns structured admin diagnostics', async () => {
  const collections = {
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1' },
      { id: 'EQ-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2' },
    ],
    rentals: [
      { id: 'R-1', equipmentId: 'EQ-2', equipmentInv: 'INV-1', equipment: ['INV-1'] },
      { id: 'R-2', equipmentInv: 'INV-1', equipment: ['INV-1'] },
    ],
    gantt_rentals: [
      { id: 'GR-1', rentalId: 'R-1', equipmentId: 'EQ-1', equipmentInv: 'INV-1' },
      { id: 'GR-2', rentalId: 'R-missing', equipmentId: 'EQ-1', equipmentInv: 'INV-1' },
    ],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/rental-equipment-diagnostics');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.summary.rentalsTotal, 2);
    assert.equal(response.body.summary.rentalsWithoutEquipmentId, 1);
    assert.equal(response.body.summary.ganttMissingRental, 1);
    assert.equal(response.body.summary.ganttEquipmentMismatches, 1);
    assert.equal(response.body.issues.rentalsWithoutEquipmentId[0].id, 'R-2');
    assert.equal(response.body.issues.ganttEquipmentMismatches[0].id, 'GR-1');
    assert.deepEqual(Object.keys(response.body.issues).sort(), [
      'duplicateEquipmentIdentifiers',
      'ganttEquipmentMismatches',
      'ganttMissingRental',
      'ganttWithoutRentalId',
      'legacyConflicts',
      'rentalsWithMissingEquipment',
      'rentalsWithoutEquipmentId',
    ].sort());
  });
});

test('/api/admin/rental-equipment-diagnostics is admin-only', async () => {
  const { app } = createSystemApp({
    requireAdmin: (_req, res) => res.status(403).json({ ok: false, error: 'Forbidden' }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/rental-equipment-diagnostics');
    assert.equal(response.status, 403);
  });
});

test('/api/admin/diagnostics/gantt-rentals-repair is admin-only', async () => {
  const { app } = createSystemApp({
    requireAuth: (req, _res, next) => {
      req.user = { userId: 'U-manager', userRole: 'Менеджер по аренде' };
      next();
    },
    requireAdmin: (req, res, next) => {
      if (req.user?.userRole !== 'Администратор') {
        return res.status(403).json({ ok: false, error: 'Forbidden: admin only' });
      }
      return next();
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/diagnostics/gantt-rentals-repair');
    assert.equal(response.status, 403);
  });
});

test('/api/admin/diagnostics/gantt-rentals-repair returns read-only sanitized report', async () => {
  const collections = {
    equipment: [{ id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', model: 'Genie S-65' }],
    rentals: [
      { id: 'R-valid', clientId: 'C-1', equipmentId: 'EQ-1', inventoryNumber: 'INV-1', startDate: '2026-05-01', endDate: '2026-05-10' },
      { id: 'R-candidate', clientId: 'C-2', client: 'Safe Client', equipmentId: 'EQ-1', inventoryNumber: 'INV-1', startDate: '2026-06-01', endDate: '2026-06-10' },
    ],
    gantt_rentals: [
      { id: 'GR-valid', rentalId: 'R-valid', clientId: 'C-1', equipmentId: 'EQ-1', inventoryNumber: 'INV-1', startDate: '2026-05-01', endDate: '2026-05-10' },
      {
        id: 'GR-1776257615497',
        clientId: 'C-2',
        client: 'Safe Client',
        equipmentId: 'EQ-1',
        inventoryNumber: 'INV-1',
        startDate: '2026-06-01',
        endDate: '2026-06-10',
        status: 'active',
        amount: 9000,
        price: 1000,
        manager: 'Sensitive Manager',
        phone: '+79990000000',
      },
      { id: 'GR-stale', clientId: 'C-3', equipmentId: 'EQ-1', inventoryNumber: 'INV-1', startDate: '2026-07-01', endDate: '2026-07-10' },
    ],
    documents: [{ id: 'DOC-1', rentalId: 'GR-stale', fileUrl: 'https://example.test/private.pdf' }],
    payments: [{ id: 'PAY-1', rentalId: 'GR-stale', amount: 5000 }],
    deliveries: [],
    service: [],
  };
  const before = JSON.stringify(collections);
  let writeCount = 0;
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: () => { writeCount += 1; },
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/diagnostics/gantt-rentals-repair');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.productionDataChanged, false);
    assert.equal(response.body.counts.rentals, 2);
    assert.equal(response.body.counts.ganttRentals, 3);
    assert.equal(response.body.counts.validLinks, 1);
    assert.equal(response.body.counts.brokenRows, 2);
    assert.equal(response.body.groups.B[0].ganttId, 'GR-1776257615497');
    assert.equal(response.body.groups.B[0].flags.hasSafeSingleCandidate, true);
    assert.equal(response.body.groups.B[0].confidence, 'high');
    assert.equal(response.body.groups.B[0].repairAllowed, true);
    assert.deepEqual(response.body.groups.B[0].candidateIds, ['R-candidate']);
    assert.equal(response.body.groups.C[0].flags.hasDocuments, true);
    assert.equal(response.body.groups.C[0].flags.hasPayments, true);
    assert.equal(response.body.target.id, 'GR-1776257615497');
    assert.equal(response.body.target.found, true);
    assert.equal(response.body.target.broken, true);
    assert.equal(response.body.target.row.reason, 'POSSIBLE_LEGACY_RENTAL');
    assert.equal(writeCount, 0);
    assert.equal(JSON.stringify(collections), before);
    assert.doesNotMatch(JSON.stringify(response.body), /\+7999|private\.pdf|price|phone|fileUrl/i);
  });
});

test('/api/admin/diagnostics/gantt-rentals-repair remains dry-run and rejects production apply', async () => {
  const collections = {
    equipment: [{ id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', model: 'Genie S-65' }],
    rentals: [
      { id: 'R-candidate', clientId: 'C-2', client: 'Safe Client', equipmentId: 'EQ-1', inventoryNumber: 'INV-1', startDate: '2026-06-01', endDate: '2026-06-10' },
      { id: 'R-other', clientId: 'C-3', client: 'Other Client', equipmentId: 'EQ-1', inventoryNumber: 'INV-1', startDate: '2026-07-01', endDate: '2026-07-10' },
    ],
    gantt_rentals: [
      { id: 'GR-high', clientId: 'C-2', client: 'Safe Client', equipmentId: 'EQ-1', inventoryNumber: 'INV-1', startDate: '2026-06-01', endDate: '2026-06-10' },
      { id: 'GR-low', clientId: 'C-9', equipmentId: 'EQ-1', inventoryNumber: 'INV-1', startDate: '2026-08-01', endDate: '2026-08-10' },
    ],
    documents: [],
    payments: [],
    deliveries: [],
    service: [],
  };
  const before = JSON.stringify(collections);
  let writeCount = 0;
  const { app, auditEntries } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writeCount += 1;
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const dryRun = await postJson(baseUrl, '/api/admin/diagnostics/gantt-rentals-repair', { ids: ['GR-high', 'GR-low'] });
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.ok, true);
    assert.equal(dryRun.body.applied, false);
    assert.equal(dryRun.body.productionDataChanged, false);
    assert.equal(dryRun.body.summary.repairableCount, 1);
    assert.equal(dryRun.body.operations[0].id, 'GR-high');
    assert.equal(writeCount, 0);
    assert.equal(JSON.stringify(collections), before);

    const rejected = await postJson(baseUrl, '/api/admin/diagnostics/gantt-rentals-repair', { ids: ['GR-high'], apply: true });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, 'PRODUCTION_AUTO_REPAIR_DISABLED');
    assert.equal(rejected.body.productionDataChanged, false);
    assert.equal(collections.gantt_rentals.find(item => item.id === 'GR-high').rentalId, undefined);

    const applied = await postJson(baseUrl, '/api/admin/diagnostics/gantt-rentals-repair', {
      ids: ['GR-high', 'GR-low'],
      apply: true,
      backupVerified: true,
      confirm: 'APPLY_GANTT_REPAIR',
    });
    assert.equal(applied.status, 409);
    assert.equal(applied.body.code, 'PRODUCTION_AUTO_REPAIR_DISABLED');
    assert.equal(applied.body.applied, false);
    assert.equal(applied.body.productionDataChanged, false);
    assert.equal(collections.gantt_rentals.find(item => item.id === 'GR-high').rentalId, undefined);
    assert.equal(collections.gantt_rentals.find(item => item.id === 'GR-low').rentalId, undefined);
    assert.equal(writeCount, 0);
    assert.equal(auditEntries.some(entry => entry.action === 'gantt_rentals.repair_links'), false);
  });
});

test('/api/admin/diagnostics/gantt-rentals-cleanup-preview is admin-only and requires auth', async () => {
  const unauthorized = createSystemApp({
    requireAuth: (_req, res) => res.status(401).json({ ok: false, error: 'Unauthorized' }),
  });
  await withServer(unauthorized.app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/diagnostics/gantt-rentals-cleanup-preview');
    assert.equal(response.status, 401);
  });

  const nonAdmin = createSystemApp({
    requireAuth: (req, _res, next) => {
      req.user = { userId: 'U-manager', userRole: 'Менеджер по аренде' };
      next();
    },
    requireAdmin: (req, res, next) => {
      if (req.user?.userRole !== 'Администратор') {
        return res.status(403).json({ ok: false, error: 'Forbidden: admin only' });
      }
      return next();
    },
  });
  await withServer(nonAdmin.app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/diagnostics/gantt-rentals-cleanup-preview');
    assert.equal(response.status, 403);
  });
});

test('/api/admin/diagnostics/gantt-rentals-cleanup-preview classifies read-only cleanup decisions', async () => {
  const collections = {
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', model: 'Genie S-65' },
      { id: 'EQ-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2', model: 'JLG 2632R' },
      { id: 'EQ-3', inventoryNumber: '025', serialNumber: 'SN-025', model: 'Mantall' },
    ],
    rentals: [
      { id: 'R-ok', clientId: 'C-ok', equipmentId: 'EQ-1', inventoryNumber: 'INV-1', startDate: '2026-05-01', endDate: '2026-05-10' },
      { id: 'R-a', clientId: 'C-a', client: 'Candidate A', equipmentId: 'EQ-2', inventoryNumber: 'INV-2', startDate: '2026-06-01', endDate: '2026-06-10' },
      { id: 'R-b', clientId: 'C-b', client: 'Candidate B', equipmentId: 'EQ-2', inventoryNumber: 'INV-2', startDate: '2026-06-01', endDate: '2026-06-10' },
    ],
    gantt_rentals: [
      { id: 'GR-ok', rentalId: 'R-ok', clientId: 'C-ok', equipmentId: 'EQ-1', inventoryNumber: 'INV-1', startDate: '2026-05-01', endDate: '2026-05-10' },
      { id: 'GR-archive', clientId: 'C-archive', client: 'Archive Candidate', equipmentId: 'EQ-3', inventoryNumber: '025', startDate: '2026-04-01', endDate: '2026-04-10' },
      { id: 'GR-pay', clientId: 'C-pay', client: 'Payment Blocked', equipmentId: 'EQ-3', inventoryNumber: '025', startDate: '2026-04-01', endDate: '2026-04-10' },
      { id: 'GR-delivery', clientId: 'C-delivery', client: 'Delivery Blocked', equipmentId: 'EQ-3', inventoryNumber: '025', startDate: '2026-04-11', endDate: '2026-04-20' },
      { id: 'GR-multi', clientId: 'C-x', client: 'Ambiguous', equipmentId: 'EQ-2', inventoryNumber: 'INV-2', startDate: '2026-06-01', endDate: '2026-06-10' },
      { id: 'GR-low', equipmentId: 'EQ-3', inventoryNumber: '025', startDate: '2026-07-01', endDate: '2026-07-10' },
      {
        id: 'GR-1776257615497',
        clientId: 'cli-xls-12',
        client: 'Промтехмонтаж',
        equipmentId: 'eq-1775822459003-f06191',
        inventoryNumber: '025',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        amount: 100000,
        price: 1000,
        phone: '+79990000000',
      },
    ],
    documents: [],
    payments: [
      { id: 'PAY-1', rentalId: 'GR-pay', amount: 5000, cardNumber: '4111111111111111' },
      { id: 'PAY-target', rentalId: 'GR-1776257615497', amount: 7000 },
    ],
    deliveries: [{ id: 'DEL-1', rentalId: 'GR-delivery', address: 'Private address' }],
    service: [],
  };
  const before = JSON.stringify(collections);
  let writeCount = 0;
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: () => { writeCount += 1; },
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/diagnostics/gantt-rentals-cleanup-preview');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.productionDataChanged, false);
    assert.equal(response.body.counts.ganttRentals, 7);
    assert.equal(response.body.counts.okRows, 1);
    assert.equal(response.body.counts.archiveCandidates, 1);
    assert.equal(response.body.counts.duplicateReview, 1);
    assert.equal(response.body.counts.blockedByPayments, 2);
    assert.equal(response.body.counts.blockedByDeliveries, 1);

    const rows = Object.fromEntries(response.body.rows.map(row => [row.ganttId, row]));
    assert.equal(rows['GR-archive'].previewAction, 'candidate_archive');
    assert.equal(rows['GR-archive'].previewRisk, 'medium');
    assert.equal(rows['GR-pay'].previewAction, 'blocked_has_payments');
    assert.equal(rows['GR-pay'].previewRisk, 'high');
    assert.equal(rows['GR-delivery'].previewAction, 'blocked_has_deliveries');
    assert.equal(rows['GR-delivery'].previewRisk, 'high');
    assert.equal(rows['GR-multi'].previewAction, 'candidate_duplicate_review');
    assert.equal(rows['GR-multi'].candidateIds.length, 2);
    assert.equal(rows['GR-low'].previewAction, 'blocked_low_confidence');
    assert.equal(rows['GR-low'].repairAllowed, false);
    assert.equal(response.body.target.row.previewAction, 'blocked_has_payments');
    assert.equal(response.body.target.row.previewRisk, 'high');
    assert.match(response.body.target.row.previewReason, /ручной сверки платежа/);

    assert.equal(writeCount, 0);
    assert.equal(JSON.stringify(collections), before);
    assert.doesNotMatch(JSON.stringify(response.body), /phone|cardNumber|Private address|411111/i);

    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const methodResponse = await requestRaw(baseUrl, '/api/admin/diagnostics/gantt-rentals-cleanup-preview', method);
      assert.notEqual(methodResponse.status, 200);
    }
    assert.equal(writeCount, 0);
  });
});

test('/api/admin/rental-equipment-diagnostics/backfill is diagnostic-only in production', async () => {
  const collections = {
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1' },
      { id: 'EQ-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2' },
    ],
    rentals: [
      { id: 'R-1', equipmentId: 'EQ-2', equipmentInv: 'INV-1', equipment: ['INV-1'] },
      { id: 'R-2', equipmentInv: 'INV-1', equipment: ['INV-1'] },
    ],
    gantt_rentals: [
      { id: 'GR-1', rentalId: 'R-1', equipmentId: 'EQ-1', equipmentInv: 'INV-1', equipment: ['INV-1'] },
    ],
  };
  const { app, auditEntries } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => { collections[name] = value; },
  });

  await withServer(app, async (baseUrl) => {
    const dryRun = await postJson(baseUrl, '/api/admin/rental-equipment-diagnostics/backfill', {});
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.dryRun, true);
    assert.equal(dryRun.body.backfill.summary.rentalsUpdated, 2);
    assert.equal(collections.rentals.find(item => item.id === 'R-2').equipmentId, undefined);
    assert.equal(auditEntries.some(entry => entry.action === 'rental_equipment.backfill'), false);

    const queryDryRun = await postJson(baseUrl, '/api/admin/rental-equipment-diagnostics/backfill?dryRun=1', { confirm: true });
    assert.equal(queryDryRun.status, 200);
    assert.equal(queryDryRun.body.dryRun, true);
    assert.equal(collections.rentals.find(item => item.id === 'R-2').equipmentId, undefined);
    assert.equal(auditEntries.some(entry => entry.action === 'rental_equipment.backfill'), false);

    const applied = await postJson(baseUrl, '/api/admin/rental-equipment-diagnostics/backfill', { confirm: true });
    assert.equal(applied.status, 409);
    assert.equal(applied.body.code, 'PRODUCTION_AUTO_REPAIR_DISABLED');
    assert.equal(collections.rentals.find(item => item.id === 'R-2').equipmentId, undefined);
    assert.equal(collections.rentals.find(item => item.id === 'R-1').equipmentInv, 'INV-1');
    assert.equal(collections.gantt_rentals.find(item => item.id === 'GR-1').equipmentId, 'EQ-1');
    assert.equal(auditEntries.some(entry => entry.action === 'rental_equipment.backfill'), false);
  });
});

test('/api/admin/rental-link-diagnostics/backfill is diagnostic-only in production', async () => {
  const collections = {
    rentals: [{ id: 'R-1' }],
    gantt_rentals: [{ id: 'GR-1' }],
    equipment: [],
  };
  const dryRunValues = [];
  let writeCount = 0;
  const { app, auditEntries } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writeCount += 1;
      collections[name] = value;
    },
    analyzeGanttRentalLinks: ({ ganttRentals }) => ({
      ganttRentalsCount: ganttRentals.length,
      missingRentalIdCount: ganttRentals.filter(item => !item.rentalId).length,
    }),
    backfillGanttRentalLinks: ({ readData, writeData, dryRun }) => {
      dryRunValues.push(dryRun);
      const ganttRentals = readData('gantt_rentals') || [];
      const nextGanttRentals = ganttRentals.map(item => ({ ...item, rentalId: 'R-1' }));
      if (!dryRun) writeData('gantt_rentals', nextGanttRentals);
      return {
        checked: ganttRentals.length,
        missingLink: 1,
        linked: 1,
        ambiguous: [],
        unresolved: [],
        dryRun,
      };
    },
  });

  await withServer(app, async (baseUrl) => {
    const defaultPost = await postJson(baseUrl, '/api/admin/rental-link-diagnostics/backfill', {});
    assert.equal(defaultPost.status, 200);
    assert.equal(defaultPost.body.backfill.dryRun, true);
    assert.equal(defaultPost.body.backfill.linked, 1);
    assert.equal(collections.gantt_rentals[0].rentalId, undefined);
    assert.equal(writeCount, 0);
    assert.equal(auditEntries.some(entry => entry.action === 'rental_links.backfill'), false);

    const explicitDryRun = await postJson(baseUrl, '/api/admin/rental-link-diagnostics/backfill?dryRun=1', { confirm: true });
    assert.equal(explicitDryRun.status, 200);
    assert.equal(explicitDryRun.body.backfill.dryRun, true);
    assert.equal(collections.gantt_rentals[0].rentalId, undefined);
    assert.equal(writeCount, 0);
    assert.equal(auditEntries.some(entry => entry.action === 'rental_links.backfill'), false);

    const applied = await postJson(baseUrl, '/api/admin/rental-link-diagnostics/backfill', { confirm: true });
    assert.equal(applied.status, 409);
    assert.equal(applied.body.code, 'PRODUCTION_AUTO_REPAIR_DISABLED');
    assert.equal(collections.gantt_rentals[0].rentalId, undefined);
    assert.equal(writeCount, 0);
    assert.deepEqual(dryRunValues, [true, true]);
    assert.equal(auditEntries.some(entry => entry.action === 'rental_links.backfill'), false);
  });
});

test('/api/admin/rental-link-diagnostics/backfill is admin-only', async () => {
  const { app } = createSystemApp({
    requireAuth: (req, _res, next) => {
      req.user = { userId: 'U-manager', userRole: 'Менеджер по аренде' };
      next();
    },
    requireAdmin: (req, res, next) => {
      if (req.user?.userRole !== 'Администратор') {
        return res.status(403).json({ ok: false, error: 'Forbidden: admin only' });
      }
      return next();
    },
    analyzeGanttRentalLinks: () => ({}),
    backfillGanttRentalLinks: () => ({ dryRun: true, linked: 0, ambiguous: [], unresolved: [] }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/admin/rental-link-diagnostics/backfill', { confirm: true });
    assert.equal(response.status, 403);
  });
});

test('/api/admin/audit-logs returns filtered safe entries for admins only', async () => {
  const collections = {
    audit_logs: [
      {
        id: 'AUD-1',
        createdAt: '2026-05-02T10:00:00.000Z',
        userId: 'U-1',
        userName: 'Админ',
        role: 'Администратор',
        action: 'payments.update',
        entityType: 'payments',
        entityId: 'P-1',
        description: 'Изменение платежа',
        before: { id: 'P-1', amount: 100, password: 'hidden', internalComment: 'hidden-note', fileUrl: 'https://example.test/private.pdf' },
        after: { id: 'P-1', amount: 200, token: 'hidden' },
        metadata: { secret: 'hidden', reason: 'test', debugPayload: 'hidden-debug' },
        userAgent: 'hidden-agent',
      },
      {
        id: 'AUD-2',
        createdAt: '2026-05-01T10:00:00.000Z',
        userId: 'U-2',
        userName: 'Менеджер',
        role: 'Менеджер по аренде',
        action: 'documents.create',
        entityType: 'documents',
        entityId: 'D-1',
      },
    ],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/audit-logs?action=payments.update&section=payments&dateFrom=2026-05-02');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.logs.length, 1);
    assert.equal(response.body.logs[0].id, 'AUD-1');
    assert.equal(response.body.logs[0].before.amount, 100);
    assert.equal(response.body.logs[0].before.password, undefined);
    assert.equal(response.body.logs[0].before.internalComment, undefined);
    assert.equal(response.body.logs[0].before.fileUrl, undefined);
    assert.equal(response.body.logs[0].after.token, undefined);
    assert.equal(response.body.logs[0].metadata.debugPayload, undefined);
    assert.equal(response.body.logs[0].userAgent, undefined);
    assert.ok(response.body.filters.actions.includes('payments.update'));
    assert.ok(response.body.filters.sections.includes('payments'));
    assert.doesNotMatch(JSON.stringify(response.body), /hidden|token|secret|password|private\.pdf/i);
  });
});

test('/api/admin/audit-logs is admin-only', async () => {
  const { app } = createSystemApp({
    requireAdmin: (_req, res) => res.status(403).json({ ok: false, error: 'Forbidden' }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/audit-logs');
    assert.equal(response.status, 403);
  });
});

test('/api/admin/system-data/export returns safe JSON without passwords or secrets', async () => {
  const collections = {
    equipment: [{ id: 'EQ-1', serialNumber: 'SN-1' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'secret', tokenVersion: 7, name: 'Админ' }],
    app_settings: [
      { id: 'S-public', key: 'theme', value: 'dark' },
      { id: 'S-secret', key: 'bot_secret', value: 'do-not-export' },
    ],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/system-data/export');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.format, 'rental-management-system-data');
    assert.equal(response.body.collections.equipment.length, 1);
    assert.equal(response.body.collections.users[0].password, undefined);
    assert.equal(response.body.collections.users[0].tokenVersion, undefined);
    assert.equal(response.body.collections.app_settings.length, 1);
    assert.equal(response.body.collections.app_settings[0].key, 'theme');
    assert.deepEqual(response.body.collections.counterparty_role_assignments, []);
    assert.deepEqual(response.body.collections.client_contracts, []);
    assert.deepEqual(response.body.collections.supplier_profiles, []);
    assert.deepEqual(response.body.collections.contractor_profiles, []);
    assert.doesNotMatch(JSON.stringify(response.body), /secret|do-not-export/i);
  });
});

test('/api/admin/backup/full requires auth and admin access', async () => {
  const unauth = createSystemApp({
    requireAuth: (_req, res) => res.status(401).json({ ok: false, error: 'Unauthorized' }),
  });
  await withServer(unauth.app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/backup/full');
    assert.equal(response.status, 401);
  });

  const forbidden = createSystemApp({
    requireAdmin: (_req, res) => res.status(403).json({ ok: false, error: 'Forbidden' }),
  });
  await withServer(forbidden.app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/backup/full');
    assert.equal(response.status, 403);
  });
});

test('/api/admin/backup/history requires auth and admin access', async () => {
  const unauth = createSystemApp({
    requireAuth: (_req, res) => res.status(401).json({ ok: false, error: 'Unauthorized' }),
  });
  await withServer(unauth.app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/backup/history');
    assert.equal(response.status, 401);
  });

  const forbidden = createSystemApp({
    requireAdmin: (_req, res) => res.status(403).json({ ok: false, error: 'Forbidden' }),
  });
  await withServer(forbidden.app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/backup/history');
    assert.equal(response.status, 403);
  });
});

test('/api/admin/backup/history returns safe backup download audit entries only', async () => {
  const audit_logs = [
    {
      id: 'AUD-1',
      createdAt: '2026-05-03T11:00:00.000Z',
      userName: 'Admin One',
      role: 'Администратор',
      action: 'system.backup.download',
      entityType: 'system',
      metadata: {
        filename: 'skytech-backup-2026-05-03-11-00.zip',
        size: 123456,
        collections: { clients: 2, rentals: 1 },
        files: 3,
        token: 'secret-token',
        password: 'secret-password',
      },
    },
    {
      id: 'AUD-2',
      createdAt: '2026-05-03T10:00:00.000Z',
      userName: 'Admin Two',
      role: 'Администратор',
      action: 'system_data.export',
      entityType: 'system',
      metadata: { filename: 'system-data.json' },
    },
  ];
  const { app } = createSystemApp({
    readData: name => (name === 'audit_logs' ? audit_logs : []),
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/backup/history');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.history.length, 1);
    assert.deepEqual(response.body.history[0], {
      id: 'AUD-1',
      createdAt: '2026-05-03T11:00:00.000Z',
      userName: 'Admin One',
      userEmail: null,
      role: 'Администратор',
      filename: 'skytech-backup-2026-05-03-11-00.zip',
      size: 123456,
      collectionsCount: 2,
      filesCount: 3,
    });
    assert.doesNotMatch(JSON.stringify(response.body), /secret-token|secret-password|password|token/i);
  });
});

test('/api/admin/backup/history returns only 5 newest backup download events', async () => {
  const audit_logs = Array.from({ length: 7 }, (_, index) => {
    const hour = 7 + index;
    return {
      id: `AUD-${index + 1}`,
      createdAt: `2026-05-03T${String(hour).padStart(2, '0')}:00:00.000Z`,
      userName: 'Admin',
      role: 'Администратор',
      action: 'system.backup.download',
      entityType: 'system',
      metadata: {
        filename: `skytech-backup-2026-05-03-${String(hour).padStart(2, '0')}-00.zip`,
        size: 1000 + index,
        collections: { equipment: index },
        files: index,
      },
    };
  });
  audit_logs.push({
    id: 'AUD-other',
    createdAt: '2026-05-03T14:00:00.000Z',
    action: 'system_data.export',
    entityType: 'system',
    metadata: { filename: 'system-data.json' },
  });
  const { app } = createSystemApp({
    readData: name => (name === 'audit_logs' ? audit_logs : []),
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/backup/history?limit=20');
    assert.equal(response.status, 200);
    assert.equal(response.body.history.length, 5);
    assert.deepEqual(
      response.body.history.map(entry => entry.id),
      ['AUD-7', 'AUD-6', 'AUD-5', 'AUD-4', 'AUD-3'],
    );
    assert.deepEqual(
      response.body.history.map(entry => entry.createdAt),
      [
        '2026-05-03T13:00:00.000Z',
        '2026-05-03T12:00:00.000Z',
        '2026-05-03T11:00:00.000Z',
        '2026-05-03T10:00:00.000Z',
        '2026-05-03T09:00:00.000Z',
      ],
    );
  });
});

test('/api/admin/backup/history returns an empty list when no backup was downloaded', async () => {
  const { app } = createSystemApp({
    readData: name => (name === 'audit_logs' ? [] : []),
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/backup/history');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, history: [] });
  });
});

test('/api/admin/backup/full returns zip with manifest database and safe audit metadata', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-route-test-'));
  const uploadsDir = path.join(tempDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, 'safe-photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const embeddedDataUrl = `data:image/png;base64,${Buffer.from('embedded image bytes').toString('base64')}`;
  const collections = {
    equipment: [{ id: 'EQ-1', image: 'uploads/safe-photo.png' }],
    clients: [{ id: 'C-1', company: 'Client' }],
    shipping_photos: [
      {
        id: 'SP-1',
        photo: embeddedDataUrl,
        url: 'https://cdn.example.test/private/photo.png',
        attachment: '../outside.png',
      },
    ],
    planner_items: [{ id: 'PI-1' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'stored-hash', token: 'secret-token' }],
  };
  const manifestCollections = [
    'equipment',
    'clients',
    'shipping_photos',
    'users',
    'planner_items',
    'service_vehicles',
    'vehicle_trips',
    'company_expenses',
    'debt_collection_plans',
    'owners',
    'warranty_claims',
    'service_work_catalog',
    'snapshot',
  ];
  const { app, auditEntries } = createSystemApp({
    readData: name => collections[name] || [],
    jsonCollections: manifestCollections,
    dbPath: '/tmp/app.sqlite',
    createDatabaseBackup: async (targetPath) => {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(targetPath, Buffer.from('sqlite snapshot'));
      return targetPath;
    },
    fileRoots: [{ label: 'uploads', dir: uploadsDir }],
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await getBuffer(baseUrl, '/api/admin/backup/full');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/zip');
      assert.match(response.headers.get('content-disposition') || '', /skytech-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip/);
      assert.equal(response.buffer.readUInt32LE(0), 0x04034b50);

      const entries = listZipEntries(response.buffer);
      const names = entries.map(entry => entry.name);
      assert.ok(names.includes('manifest.json'));
      assert.ok(names.includes('database/app.sqlite'));
      assert.ok(names.includes('README-backup.txt'));
      assert.ok(names.includes('files/uploads/safe-photo.png'));
      assert.ok(names.includes('files/embedded-photos/shipping_photos/SP-1/photo-0.png'));
      assert.equal(names.some(name => name.includes('outside.png')), false);

      const manifest = JSON.parse(entries.find(entry => entry.name === 'manifest.json').data.toString('utf8'));
      assert.equal(manifest.database.type, 'sqlite');
      assert.equal(manifest.database.includedAs, 'database/app.sqlite');
      assert.equal(manifest.counts.equipment, 1);
      assert.equal(manifest.counts.clients, 1);
      assert.equal(manifest.counts.shipping_photos, 1);
      assert.equal(manifest.counts.users, 1);
      assert.equal(manifest.counts.planner_items, 1);
      for (const collection of manifestCollections) {
        assert.ok(Object.hasOwn(manifest.counts, collection), `manifest counts should include ${collection}`);
      }
      assert.equal(manifest.counts.service_vehicles, 0);
      assert.equal(manifest.counts.vehicle_trips, 0);
      assert.equal(manifest.counts.company_expenses, 0);
      assert.equal(manifest.counts.debt_collection_plans, 0);
      assert.equal(manifest.counts.owners, 0);
      assert.equal(manifest.counts.warranty_claims, 0);
      assert.equal(manifest.counts.service_work_catalog, 0);
      assert.equal(manifest.counts.snapshot, 0);
      assert.equal(manifest.includedFilesCount, 2);
      assert.equal(manifest.localFilesCount, 1);
      assert.equal(manifest.embeddedPhotosCount, 1);
      assert.equal(manifest.externalReferencesCount, 1);
      assert.equal(manifest.skippedReasons['path-traversal'], 1);
      assert.equal(manifest.files.externalFileReferences.count, 1);
      assert.equal(manifest.files.externalFileReferences.collections.shipping_photos, 1);
      assert.equal(manifest.files.externalFileReferences.note, 'External URLs are referenced but not downloaded');
      assert.equal(manifest.embeddedPhotoCollections.shipping_photos, 1);
      assert.match(manifest.warning, /Не хранить в Git/);
      assert.doesNotMatch(JSON.stringify(manifest), /stored-hash|secret-token|password|token|embedded image bytes|data:image|base64/i);

      assert.equal(auditEntries.length, 1);
      assert.equal(auditEntries[0].action, 'system.backup.download');
      assert.equal(auditEntries[0].entityType, 'system');
      assert.match(auditEntries[0].metadata.filename, /^skytech-backup-/);
      assert.equal(auditEntries[0].metadata.collections.equipment, 1);
      assert.equal(auditEntries[0].metadata.filesCount, 2);
      assert.equal(auditEntries[0].metadata.embeddedPhotosCount, 1);
      assert.equal(auditEntries[0].metadata.externalReferencesCount, 1);
      assert.doesNotMatch(JSON.stringify(auditEntries), /stored-hash|secret-token|password|token|embedded image bytes|data:image|base64/i);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/api/admin/backup/full succeeds with no photos and reports zero embedded photos', async () => {
  const { app } = createSystemApp({
    readData: name => ({ equipment: [{ id: 'EQ-1' }], clients: [], users: [] })[name] || [],
    jsonCollections: ['equipment', 'clients', 'users'],
    dbPath: '/tmp/app.sqlite',
    createDatabaseBackup: async (targetPath) => {
      fs.writeFileSync(targetPath, Buffer.from('sqlite snapshot'));
      return targetPath;
    },
    fileRoots: [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await getBuffer(baseUrl, '/api/admin/backup/full');
    assert.equal(response.status, 200);
    const entries = listZipEntries(response.buffer);
    const names = entries.map(entry => entry.name);
    assert.ok(names.includes('database/app.sqlite'));
    const manifest = JSON.parse(entries.find(entry => entry.name === 'manifest.json').data.toString('utf8'));
    assert.equal(manifest.embeddedPhotosCount, 0);
    assert.equal(manifest.externalReferencesCount, 0);
  });
});

test('/api/admin/backup/full includes archived local photos from uploads', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-archived-photo-'));
  const uploadsDir = path.join(tempDir, 'uploads');
  const photoPath = path.join(uploadsDir, 'external-photos', 'shipping_photos', 'SP-1', 'photo.jpg');
  fs.mkdirSync(path.dirname(photoPath), { recursive: true });
  fs.writeFileSync(photoPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const collections = {
    shipping_photos: [{
      id: 'SP-1',
      photos: [{
        originalUrl: 'https://i.oneme.ru/i?r=archived-local',
        localPath: '/uploads/external-photos/shipping_photos/SP-1/photo.jpg',
      }],
    }],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    jsonCollections: ['shipping_photos'],
    dbPath: path.join(tempDir, 'app.sqlite'),
    createDatabaseBackup: async (targetPath) => {
      fs.writeFileSync(targetPath, Buffer.from('sqlite snapshot'));
      return targetPath;
    },
    fileRoots: [{ label: 'uploads', dir: uploadsDir }],
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await getBuffer(baseUrl, '/api/admin/backup/full');
      assert.equal(response.status, 200);
      const entries = listZipEntries(response.buffer);
      const names = entries.map(entry => entry.name);
      assert.ok(names.includes('database/app.sqlite'));
      assert.ok(names.includes('files/uploads/external-photos/shipping_photos/SP-1/photo.jpg'));
      const manifest = JSON.parse(entries.find(entry => entry.name === 'manifest.json').data.toString('utf8'));
      assert.equal(manifest.localFilesCount, 1);
      assert.equal(manifest.files.localFilesCount, 1);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/api/admin/backup/full streams archived local photos without readFileSync', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-streamed-photo-'));
  const uploadsDir = path.join(tempDir, 'uploads');
  const photoPath = path.join(uploadsDir, 'external-photos', 'shipping_photos', 'SP-1', 'streamed.jpg');
  fs.mkdirSync(path.dirname(photoPath), { recursive: true });
  fs.writeFileSync(photoPath, Buffer.alloc(128 * 1024, 7));
  const collections = {
    shipping_photos: [{
      id: 'SP-1',
      photos: [{ localPath: '/uploads/external-photos/shipping_photos/SP-1/streamed.jpg' }],
    }],
  };
  const originalReadFileSync = fs.readFileSync;
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    jsonCollections: ['shipping_photos'],
    dbPath: path.join(tempDir, 'app.sqlite'),
    createDatabaseBackup: async (targetPath) => {
      fs.writeFileSync(targetPath, Buffer.from('sqlite snapshot'));
      return targetPath;
    },
    fileRoots: [{ label: 'uploads', dir: uploadsDir }],
  });

  try {
    fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
      if (path.resolve(String(filePath)) === path.resolve(photoPath)) {
        throw new Error('local photo should be streamed, not read into memory');
      }
      return originalReadFileSync.call(this, filePath, ...args);
    };
    await withServer(app, async (baseUrl) => {
      const response = await getBuffer(baseUrl, '/api/admin/backup/full');
      assert.equal(response.status, 200);
      const names = listZipEntries(response.buffer).map(entry => entry.name);
      assert.ok(names.includes('files/uploads/external-photos/shipping_photos/SP-1/streamed.jpg'));
    });
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/api/admin/backup/full uses stable temp copy if archived source disappears during preparation', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-stable-photo-'));
  const uploadsDir = path.join(tempDir, 'uploads');
  const photoPath = path.join(uploadsDir, 'external-photos', 'shipping_photos', 'SP-1', 'stable.jpg');
  fs.mkdirSync(path.dirname(photoPath), { recursive: true });
  fs.writeFileSync(photoPath, Buffer.alloc(64 * 1024, 3));
  const collections = {
    shipping_photos: [{
      id: 'SP-1',
      photos: [{ localPath: '/uploads/external-photos/shipping_photos/SP-1/stable.jpg' }],
    }],
  };
  const originalCopyFileSync = fs.copyFileSync;
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    jsonCollections: ['shipping_photos'],
    dbPath: path.join(tempDir, 'app.sqlite'),
    createDatabaseBackup: async (targetPath) => {
      fs.writeFileSync(targetPath, Buffer.from('sqlite snapshot'));
      return targetPath;
    },
    fileRoots: [{ label: 'uploads', dir: uploadsDir }],
  });

  try {
    fs.copyFileSync = function patchedCopyFileSync(source, target, ...args) {
      const result = originalCopyFileSync.call(this, source, target, ...args);
      if (path.resolve(String(source)) === path.resolve(photoPath)) {
        fs.rmSync(photoPath, { force: true });
      }
      return result;
    };
    await withServer(app, async (baseUrl) => {
      const response = await getBuffer(baseUrl, '/api/admin/backup/full');
      assert.equal(response.status, 200);
      const names = listZipEntries(response.buffer).map(entry => entry.name);
      assert.ok(names.includes('files/uploads/external-photos/shipping_photos/SP-1/stable.jpg'));
    });
  } finally {
    fs.copyFileSync = originalCopyFileSync;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/api/admin/backup/full skips missing local photo references instead of failing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-missing-local-photo-'));
  const uploadsDir = path.join(tempDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const collections = {
    shipping_photos: [{
      id: 'SP-1',
      photos: [{
        originalUrl: 'https://i.oneme.ru/i?r=missing-local',
        localPath: '/uploads/external-photos/shipping_photos/SP-1/missing.jpg',
      }],
    }],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    jsonCollections: ['shipping_photos'],
    dbPath: path.join(tempDir, 'app.sqlite'),
    createDatabaseBackup: async (targetPath) => {
      fs.writeFileSync(targetPath, Buffer.from('sqlite snapshot'));
      return targetPath;
    },
    fileRoots: [{ label: 'uploads', dir: uploadsDir }],
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await getBuffer(baseUrl, '/api/admin/backup/full');
      assert.equal(response.status, 200);
      const entries = listZipEntries(response.buffer);
      const names = entries.map(entry => entry.name);
      assert.ok(names.includes('database/app.sqlite'));
      assert.equal(names.some(name => name.endsWith('/missing.jpg')), false);
      const manifest = JSON.parse(entries.find(entry => entry.name === 'manifest.json').data.toString('utf8'));
      assert.equal(manifest.localFilesCount, 0);
      assert.equal(manifest.skippedReasons['missing-local-file'], 1);
      assert.doesNotMatch(JSON.stringify(manifest), /missing-local"|https:\/\//i);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/api/admin/backup/full cleans up temporary archive after response finishes', async () => {
  const before = new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('skytech-backup-')));
  const { app } = createSystemApp({
    readData: name => ({ equipment: [{ id: 'EQ-1' }] })[name] || [],
    jsonCollections: ['equipment'],
    dbPath: '/tmp/app.sqlite',
    createDatabaseBackup: async (targetPath) => {
      fs.writeFileSync(targetPath, Buffer.from('sqlite snapshot'));
      return targetPath;
    },
    fileRoots: [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await getBuffer(baseUrl, '/api/admin/backup/full');
    assert.equal(response.status, 200);
  });

  const after = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('skytech-backup-'));
  const created = after.filter(name => !before.has(name));
  assert.deepEqual(created, []);
});

test('settings backup download UI reports actionable errors instead of raw fetch failure', () => {
  const source = fs.readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');
  assert.match(source, /backupErrorFromResponse/);
  assert.match(source, /HTTP \$\{response\.status\}/);
  assert.match(source, /соединение с сервером было прервано/);
  assert.match(source, /Сервер мог не успеть подготовить архив/);
  assert.doesNotMatch(source, /text: error instanceof Error \? error\.message : 'Не удалось скачать резервную копию\.'/);
});

function fakeFetchResponse({ status = 200, contentType = 'image/jpeg', body = Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentLength } = {}) {
  const buffer = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase();
        if (key === 'content-type') return contentType;
        if (key === 'content-length') return String(contentLength ?? buffer.length);
        return '';
      },
    },
    arrayBuffer: async () => buffer,
    buffer: async () => buffer,
  };
}

test('archived media fetch enforces entity access and hides missing versus inaccessible files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-media-route-'));
  const uploadsDir = path.join(tempDir, 'uploads');
  const allowedPath = '/uploads/external-photos/service/S-allowed/allowed.png';
  const missingPath = '/uploads/external-photos/service/S-allowed/missing.png';
  const deniedPath = '/uploads/external-photos/service/S-denied/denied.png';
  const unscopedPath = '/uploads/unscoped.png';
  for (const publicPath of [allowedPath, deniedPath, unscopedPath]) {
    const absolutePath = path.join(uploadsDir, publicPath.replace(/^\/uploads\//, ''));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  const state = {
    mechanics: [
      { id: 'M-allowed', userId: 'U-mechanic', name: 'Механик' },
      { id: 'M-other', userId: 'U-other-mechanic', name: 'Другой механик' },
    ],
    service: [
      {
        id: 'S-allowed',
        assignedMechanicId: 'M-allowed',
        photos: [{ localPath: allowedPath }, { localPath: missingPath }],
      },
      {
        id: 'S-denied',
        assignedMechanicId: 'M-other',
        photos: [{ localPath: deniedPath }],
      },
    ],
  };
  const users = {
    mechanic: { userId: 'U-mechanic', userName: 'Механик', userRole: 'Механик' },
    sales: { userId: 'U-sales', userName: 'Продажи', userRole: 'Менеджер по продажам' },
    carrier: { userId: 'U-carrier', userName: 'Перевозчик', userRole: 'Перевозчик', carrierId: 'CARRIER-1' },
    ordinary: { userId: 'U-ordinary', userName: 'Сотрудник', userRole: 'Сотрудник' },
  };
  const readData = collection => state[collection] || [];
  const accessControl = createAccessControl({ readData });
  const { app } = createSystemApp({
    readData,
    accessControl,
    uploadRoot: uploadsDir,
    requireAuth: (req, res, next) => {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = users[token];
      if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      req.user = user;
      return next();
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const fetchMedia = async (publicPath, token) => {
        const response = await fetch(`${baseUrl}${publicPath}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const body = await response.text();
        return { status: response.status, contentType: response.headers.get('content-type') || '', body };
      };

      const allowed = await fetchMedia(allowedPath, 'mechanic');
      assert.equal(allowed.status, 200);
      assert.match(allowed.contentType, /^image\/png/);

      const hiddenResponses = [
        await fetchMedia(deniedPath, 'sales'),
        await fetchMedia(deniedPath, 'carrier'),
        await fetchMedia(deniedPath, 'ordinary'),
        await fetchMedia(deniedPath, 'mechanic'),
        await fetchMedia(missingPath, 'mechanic'),
        await fetchMedia(unscopedPath, 'mechanic'),
      ];
      for (const response of hiddenResponses) {
        assert.equal(response.status, 404);
        assert.deepEqual(JSON.parse(response.body), { ok: false, error: 'Файл не найден.' });
      }

      const removedAvailability = await fetch(`${baseUrl}/api/media/availability?path=${encodeURIComponent(deniedPath)}`, {
        headers: { authorization: 'Bearer sales' },
      });
      assert.equal(removedAvailability.status, 404);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/api/admin/media/archive-external-photos dry-run summarizes external URLs without exposing full URLs', async () => {
  const externalPhotoUrl = 'https://i.oneme.ru/i?r=test-photo-token';
  const collections = {
    shipping_photos: [{ id: 'SP-1', type: 'shipping', photos: [externalPhotoUrl] }],
    service: [{ id: 'S-1', photos: ['https://cdn.example.test/photo.jpg'] }],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    jsonCollections: ['shipping_photos', 'service'],
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/media/archive-external-photos/dry-run');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.dryRun, true);
    assert.equal(response.body.summary.found, 2);
    assert.equal(response.body.summary.collections.shipping_photos, 1);
    assert.equal(response.body.summary.domains['i.oneme.ru'], 1);
    assert.equal(response.body.summary.domains['cdn.example.test'], 1);
    assert.doesNotMatch(JSON.stringify(response.body), /test-photo-token|photo\.jpg/);
  });
});

test('/api/admin/media/archive-external-photos archives allowed images and backup includes local file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-photo-archive-'));
  const uploadsDir = path.join(tempDir, 'uploads');
  const externalPhotoUrl = 'https://i.oneme.ru/i?r=archive-me';
  const collections = {
    shipping_photos: [{ id: 'SP-1', type: 'shipping', photos: [externalPhotoUrl] }],
    equipment: [],
    clients: [],
    users: [],
  };
  const { app, auditEntries } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, data) => { collections[name] = data; },
    jsonCollections: ['shipping_photos', 'equipment', 'clients', 'users'],
    uploadRoot: uploadsDir,
    dbPath: path.join(tempDir, 'app.sqlite'),
    fileRoots: [{ label: 'uploads', dir: uploadsDir }],
    createDatabaseBackup: async (targetPath) => {
      fs.writeFileSync(targetPath, Buffer.from('sqlite snapshot'));
      return targetPath;
    },
    fetchImpl: async () => fakeFetchResponse({ contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const archive = await postJson(baseUrl, '/api/admin/media/archive-external-photos', {
        allowDomains: ['i.oneme.ru'],
        confirm: true,
      });
      assert.equal(archive.status, 200);
      assert.equal(archive.body.summary.archived, 1);
      assert.equal(archive.body.summary.failed, 0);
      const archivedPhoto = collections.shipping_photos[0].photos[0];
      assert.equal(archivedPhoto.originalUrl, externalPhotoUrl);
      assert.match(archivedPhoto.localPath, /^\/uploads\/external-photos\/shipping_photos\/SP-1\/[a-f0-9]+\.jpg$/);
      assert.equal(archivedPhoto.mimeType, 'image/jpeg');
      assert.equal(archivedPhoto.archiveStatus, 'archived');
      assert.equal(fs.existsSync(path.join(uploadsDir, archivedPhoto.localPath.replace(/^\/uploads\//, ''))), true);

      const fileResponse = await getBuffer(baseUrl, archivedPhoto.localPath);
      assert.equal(fileResponse.status, 200);

      const backup = await getBuffer(baseUrl, '/api/admin/backup/full');
      assert.equal(backup.status, 200);
      const names = listZipEntries(backup.buffer).map(entry => entry.name);
      assert.equal(names.some(name => /^files\/uploads\/external-photos\/shipping_photos\/SP-1\/[a-f0-9]+\.jpg$/.test(name)), true);

      const auditText = JSON.stringify(auditEntries);
      assert.equal(auditEntries.some(entry => entry.action === 'media.external_photos.archive'), true);
      assert.doesNotMatch(auditText, /archive-me|https:\/\/i\.oneme\.ru|base64|password|token/i);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/api/admin/media/archive-external-photos POST defaults to dry-run and dryRun overrides confirm', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-photo-dry-run-'));
  const externalPhotoUrl = 'https://i.oneme.ru/i?r=dry-run-only';
  const collections = {
    shipping_photos: [{ id: 'SP-1', photos: [externalPhotoUrl] }],
  };
  let fetchCount = 0;
  let writeCount = 0;
  const { app, auditEntries } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, data) => {
      writeCount += 1;
      collections[name] = data;
    },
    jsonCollections: ['shipping_photos'],
    uploadRoot: path.join(tempDir, 'uploads'),
    fetchImpl: async () => {
      fetchCount += 1;
      return fakeFetchResponse();
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const defaultPost = await postJson(baseUrl, '/api/admin/media/archive-external-photos', {
        allowDomains: ['i.oneme.ru'],
      });
      assert.equal(defaultPost.status, 200);
      assert.equal(defaultPost.body.dryRun, true);
      assert.equal(defaultPost.body.summary.found, 1);
      assert.equal(fetchCount, 0);
      assert.equal(writeCount, 0);
      assert.equal(collections.shipping_photos[0].photos[0], externalPhotoUrl);

      const explicitDryRun = await postJson(baseUrl, '/api/admin/media/archive-external-photos?dryRun=1', {
        allowDomains: ['i.oneme.ru'],
        confirm: true,
      });
      assert.equal(explicitDryRun.status, 200);
      assert.equal(explicitDryRun.body.dryRun, true);
      assert.equal(fetchCount, 0);
      assert.equal(writeCount, 0);
      assert.equal(auditEntries.some(entry => entry.action === 'media.external_photos.archive'), false);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/api/admin/media/archive-external-photos skips disallowed non-image and too-large content safely', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-photo-skip-'));
  const urls = {
    disallowed: 'https://cdn.example.test/photo.jpg',
    nonImage: 'https://i.oneme.ru/i?r=html-response',
    tooLarge: 'https://i.oneme.ru/i?r=too-large',
  };
  const collections = {
    shipping_photos: [{ id: 'SP-1', photos: [urls.disallowed, urls.nonImage, urls.tooLarge] }],
  };
  const { app, auditEntries } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, data) => { collections[name] = data; },
    jsonCollections: ['shipping_photos'],
    uploadRoot: path.join(tempDir, 'uploads'),
    fetchImpl: async (url) => {
      if (String(url).includes('html-response')) {
        return fakeFetchResponse({ contentType: 'text/html', body: Buffer.from('<html></html>') });
      }
      return fakeFetchResponse({ contentType: 'image/jpeg', body: Buffer.from([1, 2, 3]), contentLength: 11 * 1024 * 1024 });
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/admin/media/archive-external-photos', {
        allowDomains: ['i.oneme.ru'],
        confirm: true,
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.summary.archived, 0);
      assert.equal(response.body.summary.skipped, 3);
      assert.equal(response.body.summary.failed, 0);
      assert.equal(response.body.summary.skippedReasons['domain-not-allowed'], 1);
      assert.equal(response.body.summary.skippedReasons['non-image-content'], 1);
      assert.equal(response.body.summary.skippedReasons['too-large'], 1);
      assert.equal(collections.shipping_photos[0].photos[0].archiveStatus, 'skipped');
      assert.equal(collections.shipping_photos[0].photos[1].archiveStatus, 'skipped');
      assert.equal(collections.shipping_photos[0].photos[2].archiveStatus, 'skipped');
      assert.doesNotMatch(JSON.stringify(auditEntries), /html-response|too-large|photo\.jpg|https:\/\/|base64|password|token/i);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/api/admin/media/archive-external-photos request cannot expand configured allowlist', async () => {
  const collections = {
    shipping_photos: [{ id: 'SP-1', photos: ['https://cdn.example.test/photo.jpg'] }],
  };
  let fetched = false;
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, data) => { collections[name] = data; },
    jsonCollections: ['shipping_photos'],
    fetchImpl: async () => {
      fetched = true;
      return fakeFetchResponse();
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/admin/media/archive-external-photos', {
      allowDomains: ['cdn.example.test'],
      confirm: true,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.allowDomains, []);
    assert.equal(response.body.summary.archived, 0);
    assert.equal(response.body.summary.skippedReasons['domain-not-allowed'], 1);
    assert.equal(fetched, false);
    assert.doesNotMatch(JSON.stringify(response.body), /photo\.jpg|https:\/\//);
  });
});

test('/api/admin/system-data/import dry-run reports counts unknown collections duplicates and conflicts', async () => {
  const collections = {
    equipment: [{ id: 'EQ-1', serialNumber: 'OLD' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'existing-password' }],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/admin/system-data/import/dry-run', {
      collections: {
        equipment: [
          { id: 'EQ-1', serialNumber: 'NEW' },
          { id: 'EQ-1', serialNumber: 'DUP' },
        ],
        unknown: [{ id: 'X-1' }],
        users: [{ id: 'U-1', email: 'admin@example.test', password: 'incoming-password' }],
      },
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.collections.equipment.incoming, 2);
    assert.deepEqual(response.body.unknownCollections, ['unknown']);
    assert.deepEqual(response.body.duplicateIds.equipment, ['EQ-1']);
    assert.deepEqual(response.body.conflicts.equipment, ['EQ-1', 'EQ-1']);
    assert.equal(response.body.strippedSensitiveFields, 1);
    assert.doesNotMatch(JSON.stringify(response.body), /incoming-password|existing-password/);
  });
});

test('/api/admin/system-data/import requires confirmation and preserves existing user secrets', async () => {
  const collections = {
    equipment: [{ id: 'EQ-1', serialNumber: 'OLD' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'existing-password', tokenVersion: 3 }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const rejected = await postJson(baseUrl, '/api/admin/system-data/import', {
      collections: { equipment: [{ id: 'EQ-2', serialNumber: 'NEW' }] },
    });
    assert.equal(rejected.status, 400);
    assert.equal(writes.length, 0);

    const imported = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        equipment: [{ id: 'EQ-2', serialNumber: 'NEW' }],
        users: [{ id: 'U-1', email: 'restored@example.test', password: 'incoming-password', tokenVersion: 99 }],
      },
    });
    assert.equal(imported.status, 200);
    assert.deepEqual(imported.body.imported, { equipment: 1, users: 1 });
    assert.equal(collections.equipment[0].id, 'EQ-2');
    assert.equal(collections.users[0].email, 'restored@example.test');
    assert.equal(collections.users[0].password, 'existing-password');
    assert.equal(collections.users[0].tokenVersion, 3);
    assert.doesNotMatch(JSON.stringify(imported.body), /incoming-password|existing-password/);
  });
});

test('/api/admin/system-data/import batch failure leaves every collection unchanged', async () => {
  const collections = {
    equipment: [{ id: 'EQ-1', serialNumber: 'OLD' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'existing-password', tokenVersion: 3 }],
  };
  const before = structuredClone(collections);
  let legacyWriteCount = 0;
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: () => { legacyWriteCount += 1; },
    writeDataBatch: () => {
      throw new Error('Injected system import batch failure');
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        equipment: [{ id: 'EQ-2', serialNumber: 'NEW' }],
        users: [{ id: 'U-1', email: 'restored@example.test' }],
      },
    });

    assert.equal(response.status, 500);
    assert.equal(response.body.code, 'SYSTEM_IMPORT_PERSISTENCE_FAILED');
    assert.equal(legacyWriteCount, 0);
    assert.deepEqual(collections, before);
  });
});

test('/api/admin/system-data/import protects production smoke equipment fixture', async () => {
  const fixture = {
    id: 'EQ-smoke',
    manufacturer: 'Skytech',
    model: 'Production smoke rental fixture',
    inventoryNumber: 'SMOKE-RENTAL-001',
    serialNumber: 'SMOKE-RENTAL-001',
    status: 'available',
    category: 'own',
    activeInFleet: true,
  };
  const collections = { equipment: [fixture] };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        equipment: [{ ...fixture, serialNumber: 'RENAMED' }],
      },
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'SYSTEM_FIXTURE_PROTECTED');
    assert.equal(collections.equipment[0].serialNumber, 'SMOKE-RENTAL-001');
    assert.equal(writes.length, 0);
  });
});

test('/api/admin/system-data/import rejects dangerous fields before writing', async () => {
  const collections = {
    equipment: [{ id: 'EQ-1', serialNumber: 'OLD' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'existing-password', tokenVersion: 3 }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const dryRun = await postJson(baseUrl, '/api/admin/system-data/import/dry-run', {
      collections: {
        equipment: [{ id: 'EQ-2', serialNumber: 'NEW', auditLog: [{ action: 'forged' }] }],
        users: [{ id: 'U-1', email: 'admin@example.test', permissions: { all: true } }],
      },
    });
    assert.equal(dryRun.status, 400);
    assert.deepEqual(dryRun.body.forbiddenFields, {
      equipment: ['auditLog'],
      users: ['permissions'],
    });
    assert.equal(writes.length, 0);

    const imported = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        equipment: [{ id: 'EQ-2', serialNumber: 'NEW', auditLog: [{ action: 'forged' }] }],
      },
    });
    assert.equal(imported.status, 400);
    assert.equal(collections.equipment[0].serialNumber, 'OLD');
    assert.equal(writes.length, 0);
  });
});

test('/api/admin/system-data/import rejects forged rental audit fields and canonicalizes relation snapshots', async () => {
  const collections = {
    rentals: [{ id: 'R-1', clientId: 'C-1', counterpartyId: 'CP-1', creditRiskSnapshot: { currentDebt: 75000 } }],
    counterparties: [{ id: 'CP-1', legalName: 'ООО Клиент', shortName: 'ООО Клиент', status: 'active', roles: ['customer'] }],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', company: 'ООО Клиент' }],
    client_objects: [{ id: 'CO-1', clientId: 'C-1', counterpartyId: 'CP-1', name: 'Канонический объект', address: 'Канонический адрес', status: 'active' }],
    client_contracts: [{ id: 'CC-1', clientId: 'C-1', objectId: 'CO-1', number: 'BUS-2026/15', status: 'active' }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const forgedAudit = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        rentals: [{ id: 'R-1', clientId: 'C-1', creditRiskSnapshot: { currentDebt: 0, forged: true } }],
      },
    });
    assert.equal(forgedAudit.status, 400);
    assert.deepEqual(forgedAudit.body.forbiddenFields.rentals, ['creditRiskSnapshot']);
    assert.deepEqual(collections.rentals[0].creditRiskSnapshot, { currentDebt: 75000 });
    assert.equal(writes.length, 0);

    const canonical = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        rentals: [{
          id: 'R-new',
          clientId: 'C-1',
          objectId: 'CO-1',
          contractId: 'CC-1',
          objectName: 'Поддельный объект',
          objectAddress: 'Поддельный адрес',
          contractNumber: 'CC-FORGED',
        }],
      },
    });
    assert.equal(canonical.status, 200);
    assert.equal(collections.rentals[0].objectName, 'Канонический объект');
    assert.equal(collections.rentals[0].objectAddress, 'Канонический адрес');
    assert.equal(collections.rentals[0].contractNumber, 'BUS-2026/15');
    assert.equal(collections.rentals[0].counterpartyId, 'CP-1');
  });
});

test('/api/admin/system-data/import cannot resurrect an existing terminal Classic rental', async () => {
  const collections = {
    rentals: [{
      id: 'R-closed',
      clientId: 'C-1',
      counterpartyId: 'CP-1',
      status: 'closed',
      actualReturnDate: '2026-04-20',
    }],
    counterparties: [{ id: 'CP-1', legalName: 'ООО Клиент', shortName: 'ООО Клиент', status: 'active', roles: ['customer'] }],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', company: 'ООО Клиент' }],
  };
  const before = structuredClone(collections.rentals);
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        rentals: [{
          id: 'R-closed',
          clientId: 'C-1',
          counterpartyId: 'CP-1',
          status: 'active',
          actualReturnDate: '2026-04-20',
        }],
      },
    });

    assert.equal(response.status, 400);
    assert.match(response.body.errors.join('\n'), /RENTAL_TERMINAL_RESURRECTION_FORBIDDEN/);
    assert.deepEqual(collections.rentals, before);
    assert.equal(writes.length, 0);
  });
});

test('/api/admin/system-data/import canonicalizes Document and ClientContract identity and rejects conflicts atomically', async () => {
  const collections = {
    counterparties: [
      { id: 'CP-1', legalName: 'ООО Одинаковое', status: 'active', roles: ['customer'] },
      { id: 'CP-2', legalName: 'ООО Одинаковое', status: 'active', roles: ['customer'] },
    ],
    counterparty_role_assignments: [
      { id: 'A-1', counterpartyId: 'CP-1', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-2', counterpartyId: 'CP-2', roleCode: 'customer', status: 'active', validTo: null },
    ],
    clients: [
      { id: 'C-1', counterpartyId: 'CP-1', company: 'ООО Одинаковое' },
      { id: 'C-2', counterpartyId: 'CP-2', company: 'ООО Одинаковое' },
    ],
    client_contracts: [],
    documents: [],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const imported = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        client_contracts: [{ id: 'CC-legacy', clientId: 'C-1', number: '1', status: 'active' }],
        documents: [{ id: 'D-legacy', type: 'contract', clientId: 'C-1', client: 'ООО Одинаковое' }],
      },
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.equal(collections.client_contracts[0].counterpartyId, 'CP-1');
    assert.equal(collections.documents[0].counterpartyId, 'CP-1');

    const beforeContracts = structuredClone(collections.client_contracts);
    const beforeDocuments = structuredClone(collections.documents);
    const writeCount = writes.length;
    const rejected = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        client_contracts: [{ id: 'CC-bad', counterpartyId: 'CP-2', clientId: 'C-1', number: '2', status: 'active' }],
        documents: [{ id: 'D-name-only', type: 'contract', client: 'ООО Одинаковое' }],
      },
    });
    assert.equal(rejected.status, 400);
    assert.match(JSON.stringify(rejected.body.errors), /COUNTERPARTY_RELATION_MISMATCH|COUNTERPARTY_RELATION_ID_REQUIRED/);
    assert.deepEqual(collections.client_contracts, beforeContracts);
    assert.deepEqual(collections.documents, beforeDocuments);
    assert.equal(writes.length, writeCount);
  });
});

test('/api/admin/system-data/import canonicalizes Payment identity and rejects metadata-only links atomically', async () => {
  const collections = {
    counterparties: [
      { id: 'CP-customer', legalName: 'ООО Клиент', shortName: 'Клиент', status: 'active', roles: ['customer'] },
      { id: 'CP-supplier', legalName: 'ООО Поставщик', shortName: 'Поставщик', status: 'active', roles: ['supplier'] },
    ],
    clients: [{ id: 'C-1', counterpartyId: 'CP-customer', company: 'ООО Клиент' }],
    payments: [],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const imported = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        payments: [
          { id: 'P-legacy', clientId: 'C-1', client: 'Снимок имени', amount: 1000 },
          { id: 'P-supplier', counterpartyId: 'CP-supplier', amount: 2000 },
        ],
      },
    });
    assert.equal(imported.status, 200);
    assert.equal(collections.payments[0].counterpartyId, 'CP-customer');
    assert.equal(collections.payments[0].clientId, 'C-1');
    assert.equal(collections.payments[1].counterpartyId, 'CP-supplier');
    assert.equal(collections.payments[1].clientId, undefined);

    const before = structuredClone(collections.payments);
    const writeCount = writes.length;
    const rejected = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        payments: [{ id: 'P-name-only', client: 'ООО Клиент', amount: 3000 }],
      },
    });
    assert.equal(rejected.status, 400);
    assert.match(JSON.stringify(rejected.body.errors), /COUNTERPARTY_RELATION_ID_REQUIRED/);
    assert.deepEqual(collections.payments, before);
    assert.equal(writes.length, writeCount);
  });
});

test('/api/admin/system-data import/export preserves canonical Delivery customer and contractor identities', async () => {
  const collections = {
    counterparties: [
      { id: 'CP-C', legalName: 'Customer', shortName: 'Customer', status: 'active', roles: ['customer'] },
      { id: 'CP-K', legalName: 'Carrier', shortName: 'Carrier', status: 'active', roles: ['contractor'] },
    ],
    counterparty_role_assignments: [
      { id: 'A-C', counterpartyId: 'CP-C', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-K', counterpartyId: 'CP-K', roleCode: 'contractor', status: 'active', validTo: null },
    ],
    clients: [{ id: 'CL-C', counterpartyId: 'CP-C', company: 'Old customer label' }],
    delivery_carriers: [],
    deliveries: [],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeDataBatch(entries) {
      writes.push(entries);
      for (const entry of entries) collections[entry.name] = entry.value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const imported = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        delivery_carriers: [{ id: 'DC-1', counterpartyId: 'CP-K', status: 'active' }],
        deliveries: [{ id: 'D-1', clientId: 'CL-C', carrierId: 'DC-1', status: 'new' }],
      },
    });
    assert.equal(imported.status, 200);
    assert.equal(collections.deliveries[0].counterpartyId, 'CP-C');
    assert.equal(collections.deliveries[0].carrierCounterpartyId, 'CP-K');
    assert.equal(collections.delivery_carriers[0].counterpartyId, 'CP-K');

    const exported = await getJson(baseUrl, '/api/admin/system-data/export');
    assert.equal(exported.status, 200);
    assert.equal(exported.body.collections.deliveries[0].counterpartyId, 'CP-C');
    assert.equal(exported.body.collections.deliveries[0].carrierCounterpartyId, 'CP-K');
    assert.equal(exported.body.collections.delivery_carriers[0].counterpartyId, 'CP-K');

    const rejected = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: { deliveries: [{ id: 'D-2', client: 'Customer', status: 'new' }] },
    });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.errors.join(' '), /stable counterpartyId|stable-ID/i);
    assert.equal(writes.length, 1);
  });
});

test('/api/sync fails closed when legacy payload contains Delivery collections', async () => {
  await withLegacySyncEnabled(async () => {
    const { app } = createSystemApp();
    await withServer(app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/sync', { deliveries: [] });
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'DELIVERY_COUNTERPARTY_SYNC_DISABLED');
    });
  });
});

test('/api/admin/system-data Service round-trip canonicalizes after prerequisite stable collections and rejects conflicts atomically', async () => {
  const collections = {
    counterparties: [],
    counterparty_role_assignments: [],
    clients: [],
    client_objects: [],
    client_contracts: [],
    rentals: [],
    gantt_rentals: [],
    service: [],
  };
  const batches = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeDataBatch(entries) {
      batches.push(structuredClone(entries));
      for (const entry of entries) collections[entry.name] = entry.value;
    },
  });
  const payloadCollections = {
    counterparties: [{ id: 'CP-1', type: 'legal_entity', legalName: 'ООО Клиент', inn: '7707083893', status: 'active', roles: ['customer'] }],
    counterparty_role_assignments: [{ id: 'A-1', counterpartyId: 'CP-1', roleCode: 'customer', status: 'active' }],
    clients: [{ id: 'CL-1', counterpartyId: 'CP-1', company: 'ООО Клиент', inn: '7707083893' }],
    client_objects: [{ id: 'O-1', counterpartyId: 'CP-1', clientId: 'CL-1', name: 'Объект', address: 'Казань', status: 'active' }],
    client_contracts: [{ id: 'C-1', counterpartyId: 'CP-1', clientId: 'CL-1', objectId: 'O-1', number: '1', status: 'active' }],
    rentals: [{ id: 'R-1', counterpartyId: 'CP-1', clientId: 'CL-1', objectId: 'O-1', contractId: 'C-1', status: 'active' }],
    service: [{ id: 'S-1', rentalId: 'R-1', clientId: 'CL-1', objectId: 'O-1', contractId: 'C-1', status: 'new' }],
  };

  await withServer(app, async baseUrl => {
    const dryRun = await postJson(baseUrl, '/api/admin/system-data/import/dry-run', { collections: payloadCollections });
    assert.equal(dryRun.status, 200, JSON.stringify(dryRun.body));
    assert.equal(dryRun.body.ok, true);
    assert.equal(batches.length, 0);

    const applied = await postJson(baseUrl, '/api/admin/system-data/import', { confirm: true, collections: payloadCollections });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(collections.service[0].counterpartyId, 'CP-1');
    const names = batches[0].map(entry => entry.name);
    assert.ok(names.indexOf('counterparties') < names.indexOf('counterparty_role_assignments'));
    assert.ok(names.indexOf('counterparty_role_assignments') < names.indexOf('clients'));
    assert.ok(names.indexOf('clients') < names.indexOf('client_objects'));
    assert.ok(names.indexOf('client_objects') < names.indexOf('client_contracts'));
    assert.ok(names.indexOf('client_contracts') < names.indexOf('rentals'));
    assert.ok(names.indexOf('rentals') < names.indexOf('service'));

    const exported = await getJson(baseUrl, '/api/admin/system-data/export');
    assert.equal(exported.status, 200);
    assert.equal(exported.body.collections.service[0].counterpartyId, 'CP-1');
    assert.equal(exported.body.collections.service[0].rentalId, 'R-1');

    const before = structuredClone(collections);
    const batchCount = batches.length;
    const rejected = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        service: [
          { ...collections.service[0] },
          { id: 'S-bad', counterpartyId: 'CP-1', rentalId: 'R-missing', status: 'new' },
        ],
      },
    });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.errors.join(' '), /SERVICE_COUNTERPARTY_RENTAL_NOT_FOUND/);
    assert.deepEqual(collections, before);
    assert.equal(batches.length, batchCount);
  });
});

test('/api/sync fails closed when legacy payload contains Service', async () => {
  await withLegacySyncEnabled(async () => {
    const { app } = createSystemApp();
    await withServer(app, async baseUrl => {
      const response = await postJson(baseUrl, '/api/sync', { service: [] });
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'SERVICE_COUNTERPARTY_SYNC_DISABLED');
    });
  });
});

test('/api/sync fails closed when legacy payload contains Warranty claims', async () => {
  await withLegacySyncEnabled(async () => {
    const { app } = createSystemApp();
    await withServer(app, async baseUrl => {
      const response = await postJson(baseUrl, '/api/sync', { warranty_claims: [] });
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'WARRANTY_COUNTERPARTY_SYNC_DISABLED');
    });
  });
});

test('/api/admin/system-data Warranty round-trip follows dependency order and rejects broken, conflicting, duplicate, and missing IDs atomically', async () => {
  const collections = {
    counterparties: [],
    counterparty_role_assignments: [],
    clients: [],
    rentals: [],
    gantt_rentals: [],
    service: [],
    warranty_claims: [],
  };
  const batches = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeDataBatch(entries) {
      batches.push(structuredClone(entries));
      for (const entry of entries) collections[entry.name] = entry.value;
    },
  });
  const payloadCollections = {
    counterparties: [
      { id: 'CP-1', type: 'legal_entity', legalName: 'ООО Клиент', inn: '7707083893', status: 'active', roles: ['customer'] },
      { id: 'CP-2', type: 'legal_entity', legalName: 'ООО Другой', inn: '7707083894', status: 'active', roles: ['customer'] },
    ],
    counterparty_role_assignments: [
      { id: 'A-1', counterpartyId: 'CP-1', roleCode: 'customer', status: 'active' },
      { id: 'A-2', counterpartyId: 'CP-2', roleCode: 'customer', status: 'active' },
    ],
    clients: [{ id: 'CL-1', counterpartyId: 'CP-1', company: 'ООО Клиент', inn: '7707083893' }],
    rentals: [{ id: 'R-1', counterpartyId: 'CP-1', clientId: 'CL-1', status: 'active' }],
    service: [{ id: 'S-1', rentalId: 'R-1', clientId: 'CL-1', status: 'new' }],
    warranty_claims: [{
      id: 'W-1', serviceTicketId: 'S-1', clientId: 'CL-1', rentalId: 'R-1', status: 'approved',
      equipmentLabel: 'Lift', factoryName: 'Factory', failureDescription: 'Failure', requestedResolution: 'Repair', priority: 'medium',
    }],
  };

  await withServer(app, async baseUrl => {
    const dryRun = await postJson(baseUrl, '/api/admin/system-data/import/dry-run', { collections: payloadCollections });
    assert.equal(dryRun.status, 200, JSON.stringify(dryRun.body));
    assert.equal(batches.length, 0);

    const applied = await postJson(baseUrl, '/api/admin/system-data/import', { confirm: true, collections: payloadCollections });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(collections.warranty_claims[0].counterpartyId, 'CP-1');
    const names = batches[0].map(entry => entry.name);
    assert.ok(names.indexOf('counterparties') < names.indexOf('counterparty_role_assignments'));
    assert.ok(names.indexOf('counterparty_role_assignments') < names.indexOf('clients'));
    assert.ok(names.indexOf('clients') < names.indexOf('rentals'));
    assert.ok(names.indexOf('rentals') < names.indexOf('service'));
    assert.ok(names.indexOf('service') < names.indexOf('warranty_claims'));

    const exported = await getJson(baseUrl, '/api/admin/system-data/export');
    assert.equal(exported.status, 200);
    assert.equal(exported.body.collections.warranty_claims[0].counterpartyId, 'CP-1');

    const cases = [
      [{ id: 'W-broken', serviceTicketId: 'S-missing', status: 'draft' }, /WARRANTY_COUNTERPARTY_SERVICE_NOT_FOUND/],
      [{ id: 'W-conflict', counterpartyId: 'CP-2', serviceTicketId: 'S-1', status: 'draft' }, /COUNTERPARTY_RELATION_MISMATCH/],
    ];
    for (const [claim, pattern] of cases) {
      const before = structuredClone(collections);
      const batchCount = batches.length;
      const rejected = await postJson(baseUrl, '/api/admin/system-data/import', {
        confirm: true,
        collections: { warranty_claims: [claim] },
      });
      assert.equal(rejected.status, 400);
      assert.match(rejected.body.errors.join(' '), pattern);
      assert.deepEqual(collections, before);
      assert.equal(batches.length, batchCount);
    }

    const duplicate = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: { warranty_claims: [collections.warranty_claims[0], collections.warranty_claims[0]] },
    });
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.body.errors.join(' '), /Дубликаты id|DUPLICATE/i);
    const missingId = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: { warranty_claims: [{ status: 'draft' }] },
    });
    assert.equal(missingId.status, 400);
    assert.match(missingId.body.errors.join(' '), /WARRANTY_COUNTERPARTY_CLAIM_ID_REQUIRED/);
    assert.equal(batches.length, 1);
  });
});

test('System Control Center exposes Warranty relation health and broken counts read-only', async () => {
  const collections = {
    warranty_claims: [{ id: 'W-broken', serviceTicketId: 'S-missing', status: 'draft' }],
    service: [],
  };
  const before = structuredClone(collections);
  const status = buildSystemControlCenterStatus({
    dbPath: ':memory:',
    readData: name => collections[name] || [],
    inspectStorage: () => ({ available: false, signalPresent: false, mountPath: '/data' }),
  });
  assert.equal(status.warrantyRelations.scanned, 1);
  assert.equal(status.warrantyRelations.broken, 1);
  assert.equal(status.warrantyRelations.authority, 'WarrantyClaim.counterpartyId -> Counterparty.id');
  assert.deepEqual(collections, before);
});

test('/api/admin/system-data/import rejects duplicate client INNs before writing any collection', async () => {
  const collections = {
    equipment: [{ id: 'EQ-old', serialNumber: 'OLD' }],
    clients: [{ id: 'C-old', company: 'ООО Старый', inn: '7700654321' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'existing-password' }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        equipment: [{ id: 'EQ-new', serialNumber: 'NEW' }],
        clients: [
          { id: 'C-1', company: 'ООО Альфа', inn: '1655 123456' },
          { id: 'C-2', company: 'ООО Бета', inn: '1655-123456' },
        ],
      },
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.errorCode, 'SYSTEM_IMPORT_CLIENT_INN_DUPLICATES');
    assert.equal(response.body.clientInnDuplicates.length, 1);
    assert.equal(response.body.clientInnDuplicates[0].innNormalized, '1655123456');
    assert.deepEqual(response.body.clientInnDuplicates[0].clients.map(client => client.id), ['C-1', 'C-2']);
    assert.deepEqual(writes, []);
    assert.equal(collections.equipment[0].id, 'EQ-old');
    assert.doesNotMatch(JSON.stringify(response.body), /password|token|secret/i);
  });
});

test('/api/admin/system-data/import accepts valid clients payload', async () => {
  const collections = {
    clients: [{ id: 'C-old', company: 'ООО Старый', inn: '7700654321' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'existing-password' }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        clients: [
          { id: 'C-1', company: 'ООО Альфа', inn: '1655123456' },
          { id: 'C-2', company: 'ИП Валидный', inn: '123456789012' },
        ],
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.imported, {
      counterparties: 2,
      clients: 2,
      counterparty_role_assignments: 2,
      supplier_profiles: 0,
      contractor_profiles: 0,
    });
    assert.deepEqual(writes.map(write => write.name), [
      'counterparties',
      'counterparty_role_assignments',
      'clients',
      'supplier_profiles',
      'contractor_profiles',
    ]);
    assert.equal(collections.clients.length, 2);
    assert.equal(collections.counterparties.length, 2);
    assert.ok(collections.clients.every(client => collections.counterparties.some(counterparty => (
      counterparty.id === client.counterpartyId
      && counterparty.roles.includes('customer')
    ))));
  });
});

test('/api/admin/system-data/import derives role assignments and supplier profiles from stable IDs', async () => {
  const collections = {};
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => { collections[name] = value; },
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        counterparties: [{
          id: 'CP-import',
          type: 'legal_entity',
          legalName: 'ООО Импорт',
          shortName: 'Импорт',
          inn: '7707083893',
          roles: ['customer', 'supplier'],
          status: 'active',
        }],
        clients: [{
          id: 'C-import',
          counterpartyId: 'CP-import',
          company: 'Импорт',
          inn: '7707083893',
          status: 'active',
        }],
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(collections.counterparties[0].roles, ['customer', 'supplier']);
    assert.deepEqual(
      collections.counterparty_role_assignments.map(item => item.roleCode),
      ['customer', 'supplier'],
    );
    assert.equal(collections.supplier_profiles.length, 1);
    assert.equal(collections.supplier_profiles[0].counterpartyId, 'CP-import');
    assert.deepEqual(collections.contractor_profiles, []);
  });
});

test('/api/admin/system-data/import rejects missing and invalid client INN', async () => {
  const collections = {
    clients: [],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'existing-password' }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const missing = await postJson(baseUrl, '/api/admin/system-data/import/dry-run', {
      collections: { clients: [{ id: 'C-missing', company: 'Без ИНН' }] },
    });
    assert.equal(missing.status, 400);
    assert.match(JSON.stringify(missing.body.errors), /Укажите корректный ИНН/);

    const invalid = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: { clients: [{ id: 'C-invalid', company: 'Короткий', inn: '12345' }] },
    });
    assert.equal(invalid.status, 400);
    assert.match(JSON.stringify(invalid.body.errors), /Укажите корректный ИНН/);
    assert.deepEqual(writes, []);
  });
});

test('/api/sync rejects missing and duplicate normalized client INN', async () => {
  const previousEnabled = process.env.ENABLE_LEGACY_SYNC;
  process.env.ENABLE_LEGACY_SYNC = '1';
  const collections = {
    clients: [{ id: 'C-existing', company: 'ООО Старый', inn: '1655123456' }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    getSnapshot: () => ({ clients: collections.clients }),
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const missing = await postJson(baseUrl, '/api/sync', {
        clients: [
          { id: 'C-existing', company: 'ООО Старый', inn: '1655123456' },
          { id: 'C-new', company: 'Без ИНН' },
        ],
      });
      assert.equal(missing.status, 400);
      assert.match(missing.body.error, /Укажите корректный ИНН/);

      const duplicate = await postJson(baseUrl, '/api/sync', {
        clients: [
          { id: 'C-existing', company: 'ООО Старый', inn: '1655123456' },
          { id: 'C-duplicate', company: 'Дубль', inn: '1655-123456' },
        ],
      });
      assert.equal(duplicate.status, 409);
      assert.match(duplicate.body.error, /Клиент с таким ИНН уже существует/);
      assert.deepEqual(writes, []);
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_LEGACY_SYNC;
    else process.env.ENABLE_LEGACY_SYNC = previousEnabled;
  }
});

test('/api/sync cannot resurrect stale supplier projection over an inactive assignment', async () => {
  await withLegacySyncEnabled(async () => {
    const supplierValidTo = '2026-02-10T09:30:00.000Z';
    const supplierAssignment = legacySyncAssignment('supplier', {
      status: 'inactive',
      validTo: supplierValidTo,
      reason: 'supplier_disabled',
    });
    const supplierProfile = {
      id: 'SUPP-existing',
      counterpartyId: 'CP-sync',
      status: 'inactive',
      archivedAt: supplierValidTo,
      updatedAt: supplierValidTo,
      categories: ['archived-category'],
    };
    const store = createLegacySyncStore({
      counterparties: [legacySyncCounterparty(['customer', 'supplier'])],
      clients: [legacySyncClient()],
      counterparty_role_assignments: [legacySyncAssignment('customer'), supplierAssignment],
      supplier_profiles: [supplierProfile],
      contractor_profiles: [],
    });

    await withServer(store.app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/sync', {
        clients: [legacySyncClient({ manager: 'Новый менеджер' })],
      });

      assert.equal(response.status, 200);
      const storedSupplier = store.collections.counterparty_role_assignments
        .find(item => item.roleCode === 'supplier');
      assert.deepEqual(storedSupplier, supplierAssignment);
      assert.equal(storedSupplier.validTo, supplierValidTo);
      assert.deepEqual(store.collections.supplier_profiles[0], supplierProfile);
      assert.deepEqual(store.collections.counterparties[0].roles, ['customer']);
      assert.equal(store.batches.length, 1);
      assert.deepEqual(store.batches[0].map(entry => entry.name), [
        'counterparties',
        'clients',
        'counterparty_role_assignments',
        'supplier_profiles',
        'contractor_profiles',
      ]);
    });
  });
});

test('/api/sync deterministically bootstraps a genuine legacy role with no assignment', async () => {
  await withLegacySyncEnabled(async () => {
    const customerAssignment = legacySyncAssignment('customer');
    const store = createLegacySyncStore({
      counterparties: [legacySyncCounterparty(['customer', 'supplier'])],
      clients: [legacySyncClient()],
      counterparty_role_assignments: [customerAssignment],
      supplier_profiles: [],
      contractor_profiles: [],
    });

    await withServer(store.app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/sync', {
        clients: [legacySyncClient()],
      });

      assert.equal(response.status, 200);
      const supplierAssignment = store.collections.counterparty_role_assignments
        .find(item => item.roleCode === 'supplier');
      assert.equal(
        supplierAssignment.id,
        deterministicRoleAssignmentId('CP-sync', 'supplier'),
      );
      assert.equal(supplierAssignment.status, 'active');
      assert.equal(supplierAssignment.validTo, null);
      assert.deepEqual(
        store.collections.counterparty_role_assignments.find(item => item.roleCode === 'customer'),
        customerAssignment,
      );
      assert.equal(
        store.collections.supplier_profiles[0].id,
        deterministicRoleProfileId('supplier', 'CP-sync'),
      );
      assert.equal(store.collections.supplier_profiles[0].status, 'active');
      assert.deepEqual(store.collections.counterparties[0].roles, ['customer', 'supplier']);
    });
  });
});

test('/api/sync activates Client customer compatibility through RoleAssignment authority', async () => {
  await withLegacySyncEnabled(async () => {
    const customerAssignment = legacySyncAssignment('customer', {
      status: 'inactive',
      validTo: '2026-03-01T00:00:00.000Z',
      reason: 'legacy_customer_disabled',
    });
    const supplierAssignment = legacySyncAssignment('supplier');
    const store = createLegacySyncStore({
      counterparties: [legacySyncCounterparty(['supplier'])],
      clients: [legacySyncClient()],
      counterparty_role_assignments: [customerAssignment, supplierAssignment],
      supplier_profiles: [{
        id: 'SUPP-active',
        counterpartyId: 'CP-sync',
        status: 'active',
        archivedAt: null,
      }],
      contractor_profiles: [],
    });

    await withServer(store.app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/sync', {
        clients: [legacySyncClient()],
      });

      assert.equal(response.status, 200);
      const storedCustomer = store.collections.counterparty_role_assignments
        .find(item => item.roleCode === 'customer');
      assert.equal(storedCustomer.id, customerAssignment.id);
      assert.equal(storedCustomer.status, 'active');
      assert.equal(storedCustomer.validTo, null);
      assert.equal(storedCustomer.source, 'legacy_sync');
      assert.deepEqual(
        store.collections.counterparty_role_assignments.find(item => item.roleCode === 'supplier'),
        supplierAssignment,
      );
      assert.deepEqual(store.collections.counterparties[0].roles, ['customer', 'supplier']);
    });
  });
});

test('/api/sync preserves unrelated inactive supplier and contractor state during Client updates', async () => {
  await withLegacySyncEnabled(async () => {
    const supplierAssignment = legacySyncAssignment('supplier', {
      status: 'inactive',
      validTo: '2026-04-01T00:00:00.000Z',
    });
    const contractorAssignment = legacySyncAssignment('contractor', {
      status: 'inactive',
      validTo: '2026-04-02T00:00:00.000Z',
    });
    const supplierProfile = {
      id: 'SUPP-inactive',
      counterpartyId: 'CP-sync',
      status: 'inactive',
      archivedAt: '2026-04-01T00:00:00.000Z',
    };
    const contractorProfile = {
      id: 'CONT-inactive',
      counterpartyId: 'CP-sync',
      status: 'inactive',
      archivedAt: '2026-04-02T00:00:00.000Z',
    };
    const store = createLegacySyncStore({
      counterparties: [legacySyncCounterparty(['customer', 'supplier', 'contractor'])],
      clients: [legacySyncClient()],
      counterparty_role_assignments: [
        legacySyncAssignment('customer'),
        supplierAssignment,
        contractorAssignment,
      ],
      supplier_profiles: [supplierProfile],
      contractor_profiles: [contractorProfile],
    });

    await withServer(store.app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/sync', {
        clients: [legacySyncClient({ manager: 'Изменённый менеджер' })],
      });

      assert.equal(response.status, 200);
      assert.equal(store.collections.clients[0].manager, 'Изменённый менеджер');
      assert.deepEqual(
        store.collections.counterparty_role_assignments.find(item => item.roleCode === 'supplier'),
        supplierAssignment,
      );
      assert.deepEqual(
        store.collections.counterparty_role_assignments.find(item => item.roleCode === 'contractor'),
        contractorAssignment,
      );
      assert.deepEqual(store.collections.supplier_profiles[0], supplierProfile);
      assert.deepEqual(store.collections.contractor_profiles[0], contractorProfile);
      assert.deepEqual(store.collections.counterparties[0].roles, ['customer']);
    });
  });
});

test('/api/sync leaves existing active role assignments and profiles unchanged', async () => {
  await withLegacySyncEnabled(async () => {
    const assignments = [
      legacySyncAssignment('customer'),
      legacySyncAssignment('supplier'),
      legacySyncAssignment('contractor'),
    ];
    const supplierProfile = {
      id: 'SUPP-active',
      counterpartyId: 'CP-sync',
      status: 'active',
      archivedAt: null,
      categories: ['lifting'],
    };
    const contractorProfile = {
      id: 'CONT-active',
      counterpartyId: 'CP-sync',
      status: 'active',
      archivedAt: null,
      serviceCategories: ['delivery'],
    };
    const store = createLegacySyncStore({
      counterparties: [legacySyncCounterparty(['customer', 'supplier', 'contractor'])],
      clients: [legacySyncClient()],
      counterparty_role_assignments: assignments,
      supplier_profiles: [supplierProfile],
      contractor_profiles: [contractorProfile],
    });

    await withServer(store.app, async (baseUrl) => {
      const response = await postJson(baseUrl, '/api/sync', {
        clients: [legacySyncClient({ manager: 'Только Client' })],
      });

      assert.equal(response.status, 200);
      assert.equal(store.collections.clients[0].manager, 'Только Client');
      assert.deepEqual(store.collections.counterparty_role_assignments, assignments);
      assert.deepEqual(store.collections.supplier_profiles, [supplierProfile]);
      assert.deepEqual(store.collections.contractor_profiles, [contractorProfile]);
      assert.deepEqual(
        store.collections.counterparties[0].roles,
        ['customer', 'supplier', 'contractor'],
      );
    });
  });
});

test('/api/sync canonicalizes Payment relations and never resolves metadata-only identity', async () => {
  const previousEnabled = process.env.ENABLE_LEGACY_SYNC;
  process.env.ENABLE_LEGACY_SYNC = '1';
  const collections = {
    counterparties: [
      { id: 'CP-customer', legalName: 'ООО Клиент', shortName: 'Клиент', status: 'active', roles: ['customer'] },
      { id: 'CP-contractor', legalName: 'ИП Подрядчик', shortName: 'Подрядчик', status: 'active', roles: ['contractor'] },
    ],
    clients: [{ id: 'C-1', counterpartyId: 'CP-customer', company: 'ООО Клиент' }],
    payments: [],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    getSnapshot: () => structuredClone(collections),
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const synced = await postJson(baseUrl, '/api/sync', {
        payments: [
          { id: 'P-legacy', clientId: 'C-1', client: 'Снимок', amount: 1000 },
          { id: 'P-contractor', counterpartyId: 'CP-contractor', amount: 2000 },
        ],
      });
      assert.equal(synced.status, 200);
      assert.equal(collections.payments[0].counterpartyId, 'CP-customer');
      assert.equal(collections.payments[1].counterpartyId, 'CP-contractor');
      assert.equal(collections.payments[1].clientId, undefined);

      const before = structuredClone(collections.payments);
      const writeCount = writes.length;
      const rejected = await postJson(baseUrl, '/api/sync', {
        payments: [{ id: 'P-name-only', client: 'ООО Клиент', amount: 3000 }],
      });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.code, 'COUNTERPARTY_RELATION_ID_REQUIRED');
      assert.deepEqual(collections.payments, before);
      assert.equal(writes.length, writeCount);
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_LEGACY_SYNC;
    else process.env.ENABLE_LEGACY_SYNC = previousEnabled;
  }
});

test('/api/sync canonicalizes staged Document and ClientContract relations and rejects conflicts before writing', async () => {
  const store = createLegacySyncStore({
    counterparties: [
      { id: 'CP-1', legalName: 'ООО Одинаковое', status: 'active', roles: ['customer'] },
      { id: 'CP-2', legalName: 'ООО Одинаковое', status: 'active', roles: ['customer'] },
    ],
    counterparty_role_assignments: [
      { id: 'A-1', counterpartyId: 'CP-1', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-2', counterpartyId: 'CP-2', roleCode: 'customer', status: 'active', validTo: null },
    ],
    clients: [
      { id: 'C-1', counterpartyId: 'CP-1', company: 'ООО Одинаковое' },
      { id: 'C-2', counterpartyId: 'CP-2', company: 'ООО Одинаковое' },
    ],
    client_contracts: [],
    documents: [],
  });

  await withLegacySyncEnabled(async () => {
    await withServer(store.app, async (baseUrl) => {
      const synced = await postJson(baseUrl, '/api/sync', {
        client_contracts: [{ id: 'CC-sync', clientId: 'C-1', number: 'SYNC-1', status: 'active' }],
        documents: [
          { id: 'D-parent', type: 'contract', clientId: 'C-1', status: 'draft' },
          { id: 'D-child', type: 'rental_specification', parentDocumentId: 'D-parent', status: 'draft' },
        ],
      });
      assert.equal(synced.status, 200, JSON.stringify(synced.body));
      assert.equal(store.collections.client_contracts[0].counterpartyId, 'CP-1');
      assert.deepEqual(
        store.collections.documents.map(document => document.counterpartyId),
        ['CP-1', 'CP-1'],
      );

      for (const [collection, field] of [
        ['client_contracts', 'createdAt'],
        ['client_contracts', 'updatedAt'],
        ['documents', 'createdAt'],
        ['documents', 'updatedAt'],
      ]) {
        const beforeContracts = structuredClone(store.collections.client_contracts);
        const beforeDocuments = structuredClone(store.collections.documents);
        const writeCount = store.writes.length;
        const rejectedAuditField = await postJson(baseUrl, '/api/sync', {
          [collection]: [{
            id: collection === 'client_contracts' ? 'CC-forged' : 'D-forged',
            ...(collection === 'client_contracts'
              ? { clientId: 'C-1', number: 'SYNC-FORGED', status: 'active' }
              : { type: 'contract', clientId: 'C-1', status: 'draft' }),
            [field]: '2000-01-01T00:00:00.000Z',
          }],
        });
        assert.equal(rejectedAuditField.status, 403);
        assert.match(rejectedAuditField.body.error, new RegExp(field));
        assert.deepEqual(store.collections.client_contracts, beforeContracts);
        assert.deepEqual(store.collections.documents, beforeDocuments);
        assert.equal(store.writes.length, writeCount);
      }

      const beforeContracts = structuredClone(store.collections.client_contracts);
      const beforeDocuments = structuredClone(store.collections.documents);
      const writeCount = store.writes.length;
      const rejected = await postJson(baseUrl, '/api/sync', {
        client_contracts: [{
          id: 'CC-bad',
          counterpartyId: 'CP-2',
          clientId: 'C-1',
          number: 'SYNC-BAD',
          status: 'active',
        }],
        documents: [{ id: 'D-name-only', type: 'contract', client: 'ООО Одинаковое', status: 'draft' }],
      });
      assert.equal(rejected.status, 409);
      assert.deepEqual(store.collections.client_contracts, beforeContracts);
      assert.deepEqual(store.collections.documents, beforeDocuments);
      assert.equal(store.writes.length, writeCount);
    });
  });
});
