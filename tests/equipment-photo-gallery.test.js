import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { mergeEntityHistory } = require('../server/lib/audit-history.js');
const {
  equipmentPhotoGallery,
  makeEquipmentPhotoMain,
} = require('../server/lib/equipment-photo-gallery.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');

const FIRST_PHOTO = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const SECOND_PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const THIRD_PHOTO = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4';

function equipmentFixture(overrides = {}) {
  return {
    id: 'EQ-PHOTOS',
    manufacturer: 'JLG',
    model: '1932R',
    inventoryNumber: 'INV-PHOTOS',
    serialNumber: 'SN-PHOTOS',
    status: 'available',
    category: 'own',
    activeInFleet: false,
    priority: 'medium',
    history: [],
    ...overrides,
  };
}

function createCrudApp(state, options = {}) {
  const app = express();
  app.use(express.json());
  let photoSequence = 0;
  const readData = name => state[name] || [];
  const writeData = (name, value) => {
    if (options.failEquipmentWrite && name === 'equipment') {
      throw new Error('Simulated repository failure');
    }
    state[name] = value;
  };
  const accessControl = createAccessControl({ readData });
  app.use('/api', registerCrudRoutes({
    collections: ['equipment'],
    idPrefixes: { equipment: 'EQ', equipment_photos: 'EPH', service: 'S' },
    readData,
    writeData,
    deleteSessionsForUserIds: () => {},
    requireAuth: (req, _res, next) => {
      req.user = options.user || { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };
      next();
    },
    requireRead: () => (_req, _res, next) => next(),
    requireWrite: () => (_req, _res, next) => next(),
    sanitizeUser: value => value,
    publicUserView: value => value,
    canReadFullUsers: () => true,
    hashPassword: value => value,
    normalizeServiceWorkRecord: value => value,
    normalizeSparePartRecord: value => value,
    validateRentalPayload: () => ({ ok: true }),
    mergeEntityHistory,
    requireNonEmptyString: () => {},
    generateId: prefix => `${prefix}-${++photoSequence}`,
    nowIso: () => '2026-08-02T12:00:00.000Z',
    applyServiceTicketCreationEffects: () => {},
    accessControl,
    auditLog: () => {},
    serviceAuditLog: () => {},
    normalizeRecordClientLink: (_collection, item) => item,
    normalizeClientLinks: () => ({ changed: false }),
  }));
  return app;
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

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('legacy main photo becomes the first gallery item and a second upload is appended and persisted', async () => {
  const first = { id: 'EPH-FIRST', dataUrl: FIRST_PHOTO };
  const state = { equipment: [equipmentFixture({ photo: first })], service: [] };

  await withServer(createCrudApp(state), async baseUrl => {
    const added = await request(baseUrl, 'POST', '/api/equipment/EQ-PHOTOS/photos', {
      photo: SECOND_PHOTO,
      filename: 'second.png',
      mimeType: 'image/png',
    });

    assert.equal(added.status, 201);
    assert.equal(added.body.photos.length, 2);
    assert.deepEqual(added.body.photos[0], first);
    assert.deepEqual(added.body.photo, first);
    assert.equal(added.body.photos[1].filename, 'second.png');

    const afterReload = await request(baseUrl, 'GET', '/api/equipment/EQ-PHOTOS');
    assert.equal(afterReload.status, 200);
    assert.equal(afterReload.body.photos.length, 2);
    assert.deepEqual(afterReload.body.photo, first);
    assert.deepEqual(state.equipment[0].photos, afterReload.body.photos);
  });
});

test('invalid second upload and repository failure leave the existing gallery unchanged', async () => {
  const first = { id: 'EPH-FIRST', dataUrl: FIRST_PHOTO };
  const initial = equipmentFixture({ photo: first, photos: [first] });
  const invalidState = { equipment: [structuredClone(initial)], service: [] };

  await withServer(createCrudApp(invalidState), async baseUrl => {
    const invalid = await request(baseUrl, 'POST', '/api/equipment/EQ-PHOTOS/photos', { photo: 'not-an-image' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalidState.equipment[0], initial);
  });

  const failedWriteState = { equipment: [structuredClone(initial)], service: [] };
  await withServer(createCrudApp(failedWriteState, { failEquipmentWrite: true }), async baseUrl => {
    const failed = await request(baseUrl, 'POST', '/api/equipment/EQ-PHOTOS/photos', { photo: SECOND_PHOTO });
    assert.equal(failed.status, 500);
    assert.deepEqual(failedWriteState.equipment[0], initial);
  });
});

test('three sequential uploads preserve all prior photos and keep the first one main', async () => {
  const state = { equipment: [equipmentFixture()], service: [] };

  await withServer(createCrudApp(state), async baseUrl => {
    for (const [index, photo] of [FIRST_PHOTO, SECOND_PHOTO, THIRD_PHOTO].entries()) {
      const response = await request(baseUrl, 'POST', '/api/equipment/EQ-PHOTOS/photos', {
        photo,
        filename: `photo-${index + 1}.jpg`,
      });
      assert.equal(response.status, 201);
      assert.equal(response.body.photos.length, index + 1);
    }

    const saved = await request(baseUrl, 'GET', '/api/equipment/EQ-PHOTOS');
    assert.equal(saved.body.photos.length, 3);
    assert.deepEqual(saved.body.photo, saved.body.photos[0]);
    assert.equal(new Set(saved.body.photos.map(photo => photo.id)).size, 3);
    assert.deepEqual(saved.body.photos.map(photo => photo.filename), ['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg']);
  });
});

test('sales manager can append sale photos without bulk-replace privileges', async () => {
  const first = { id: 'EPH-FIRST', dataUrl: FIRST_PHOTO };
  const state = { equipment: [equipmentFixture({ photo: first, photos: [first], isForSale: true, saleMode: true })], service: [] };
  const user = { userId: 'U-sales', userName: 'Продажи', userRole: 'Менеджер по продажам' };

  await withServer(createCrudApp(state, { user }), async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/equipment/EQ-PHOTOS/photos', { photo: SECOND_PHOTO });
    assert.equal(response.status, 201);
    assert.equal(response.body.photos.length, 2);
    assert.deepEqual(response.body.photo, first);
  });
});

test('main photo changes only through explicit action and deletion requires confirmation', async () => {
  const first = { id: 'EPH-FIRST', dataUrl: FIRST_PHOTO };
  const second = { id: 'EPH-SECOND', dataUrl: SECOND_PHOTO };
  const state = { equipment: [equipmentFixture({ photo: first, photos: [first, second] })], service: [] };

  assert.deepEqual(makeEquipmentPhotoMain(state.equipment[0], 1).photo, second);
  assert.deepEqual(equipmentPhotoGallery(state.equipment[0]), [first, second]);

  await withServer(createCrudApp(state), async baseUrl => {
    const madeMain = await request(baseUrl, 'PATCH', '/api/equipment/EQ-PHOTOS/photos/main', { photoIndex: 1 });
    assert.equal(madeMain.status, 200);
    assert.deepEqual(madeMain.body.photo, second);
    assert.deepEqual(madeMain.body.photos, [first, second]);

    const unconfirmed = await request(baseUrl, 'DELETE', '/api/equipment/EQ-PHOTOS/photos/0');
    assert.equal(unconfirmed.status, 400);
    assert.deepEqual(state.equipment[0].photos, [first, second]);

    const deleted = await request(baseUrl, 'DELETE', '/api/equipment/EQ-PHOTOS/photos/0', { confirm: true });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body.photos, [second]);
    assert.deepEqual(deleted.body.photo, second);
  });
});

test('upload does not recreate a main photo after the previous main was explicitly deleted', async () => {
  const remaining = { id: 'EPH-REMAINING', dataUrl: FIRST_PHOTO };
  const state = { equipment: [equipmentFixture({ photos: [remaining] })], service: [] };

  await withServer(createCrudApp(state), async baseUrl => {
    const added = await request(baseUrl, 'POST', '/api/equipment/EQ-PHOTOS/photos', { photo: SECOND_PHOTO });
    assert.equal(added.status, 201);
    assert.equal(added.body.photos.length, 2);
    assert.equal(added.body.photo, undefined);
  });
});
