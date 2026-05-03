import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { registerSystemRoutes } = require('../server/routes/system.js');

function createSystemApp(overrides = {}) {
  const app = express();
  const messages = [];
  const auditEntries = [];
  app.use(express.json());
  registerSystemRoutes(app, {
    readData: overrides.readData || (() => []),
    writeData: overrides.writeData || (() => {}),
    getSnapshot: () => ({}),
    saveSnapshot: () => {},
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
    getBuildInfo: () => ({ version: 'test' }),
    getRoleAccessSummary: () => ({
      readableCollections: ['equipment', 'rentals'],
      writableCollections: ['equipment'],
    }),
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

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
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
