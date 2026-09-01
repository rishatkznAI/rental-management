import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import {
  createPlatformIdentityContext,
  seedAuthority,
  testActor,
} from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const {
  createPublicSiteTenantResolver,
  projectPublishedPublicSiteCms,
  publicSiteCmsVersion,
  sanitizePublicSiteCms,
  validatePublicSiteCms,
} = require('../server/lib/public-site-cms');
const {
  containedPath,
  registerPublicSiteRoutes,
  tenantMediaNamespace,
} = require('../server/routes/public-site');
const {
  createTenantDataBoundary,
  runWithTenantActorScope,
} = require('../server/lib/tenant-data-boundary');
const { createTrustedActorScopeResolver } = require('../server/lib/trusted-actor-scope');

const COMPANY_A = 'COMPANY-A';
const COMPANY_B = 'COMPANY-B';
const CMS_COLLECTION = 'public_site_cms';
const ENVELOPE = '__tenantScopedValues';

function siteContent(label) {
  return {
    company: {
      name: `Компания ${label}`,
      descriptor: 'Аренда',
      phone: '+7',
      phoneHref: '+7',
      email: `${label.toLowerCase()}@example.test`,
      hours: '9–18',
      whatsapp: '',
      telegram: '',
      address: `Адрес ${label}`,
      legal: `Реквизиты ${label}`,
      cities: ['Казань'],
      privateCompanyField: 'must-not-persist',
    },
    demoNotice: '',
    footerText: `Техника ${label}`,
    home: {
      eyebrow: '', title: `Главная ${label}`, description: '', categoriesTitle: '',
      categoriesDescription: '', popularTitle: '', selectionTitle: '',
      selectionDescription: '', requestTitle: '', requestDescription: '',
      internalDraft: 'must-not-persist',
    },
    catalog: { eyebrow: '', title: 'Каталог', description: '', helperTitle: '', helperDescription: '' },
    servicesPage: { eyebrow: '', title: 'Услуги', description: '', requestTitle: '', requestDescription: '' },
    about: { eyebrow: '', title: 'О компании', description: '', storyTitle: '', storyText: '' },
    contacts: { eyebrow: '', title: 'Контакты', description: '', mapTitle: '', mapDescription: '' },
    services: [{ title: 'Аренда', text: `Подбор техники ${label}`, internal: 'must-not-persist' }],
    privateNotes: { secret: 'must-not-persist' },
  };
}

function lift(label, { published = true } = {}) {
  return {
    slug: `mantall-${label.toLowerCase()}`,
    name: `Mantall ${label}`,
    category: 'Ножничные подъёмники',
    categoryShort: 'Ножничный',
    workingHeight: 10,
    platformHeight: 8,
    capacity: 230,
    platformSize: 'Платформа',
    weight: 2000,
    engine: 'Электрический',
    drive: '2WD',
    use: 'Помещение',
    surface: 'Ровный пол',
    manufacturer: 'Mantall',
    availability: 'available',
    price: 5000,
    popularity: 50,
    image: `/images/${label.toLowerCase()}.jpg`,
    gallery: [],
    purpose: 'Работы',
    limits: [],
    benefits: [],
    published,
    internalCost: 1,
  };
}

function cmsPayload(label) {
  return {
    companyId: label === 'A' ? COMPANY_B : COMPANY_A,
    tenantId: label === 'A' ? COMPANY_B : COMPANY_A,
    content: siteContent(label),
    equipment: [lift(label), lift(`${label}-hidden`, { published: false })],
    updatedBy: 'spoofed-client-value',
    privateAdminState: { token: 'must-not-persist' },
  };
}

function seedCompany(context, companyId, principalId) {
  const templateKey = `TEMPLATE-${companyId}`;
  seedAuthority(context, {
    companyId,
    branches: [{
      id: `BRANCH-${companyId}`,
      displayName: `Head office ${companyId}`,
      isHeadOffice: true,
    }],
    templateKey,
    templateCapabilities: [],
  });
  return context.repository.createMembership({
    id: `MEMBERSHIP-${companyId}`,
    companyId,
    principalId,
    status: 'active',
    roleTemplateKey: templateKey,
    roleTemplateVersion: 1,
    companyWideBranchAuthority: true,
    branchIds: [],
    actorContext: testActor(),
    reason: 'public-site-cms-test',
  });
}

function rawFingerprint(value) {
  return JSON.stringify(value ?? null);
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        found.push(`${relative}/`);
        visit(absolute);
      } else {
        found.push(`${relative}:${fs.readFileSync(absolute).toString('hex')}`);
      }
    }
  }
  visit(root);
  return found.sort();
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

async function request(harness, route, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${harness.baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, status: response.status, body: json, text };
}

async function createHarness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'public-site-cms-real-'));
  const uploadRoot = path.join(root, 'uploads');
  const context = createPlatformIdentityContext({
    dbPath: path.join(root, 'app.sqlite'),
    users: [
      { id: 'U-admin', name: 'Bootstrap', role: 'Администратор', status: 'Активен' },
      { id: 'U-A', name: 'Admin A', role: 'Администратор', status: 'Активен' },
      { id: 'U-B', name: 'Admin B', role: 'Администратор', status: 'Активен' },
      { id: 'U-NONE', name: 'No membership', role: 'Администратор', status: 'Активен' },
      { id: 'U-MANAGER', name: 'Manager A', role: 'Менеджер по аренде', status: 'Активен' },
    ],
  });
  const membershipA = seedCompany(context, COMPANY_A, 'U-A');
  seedCompany(context, COMPANY_B, 'U-B');
  context.repository.createMembership({
    id: `MEMBERSHIP-${COMPANY_A}-MANAGER`,
    companyId: COMPANY_A,
    principalId: 'U-MANAGER',
    status: 'active',
    roleTemplateKey: `TEMPLATE-${COMPANY_A}`,
    roleTemplateVersion: 1,
    companyWideBranchAuthority: true,
    branchIds: [],
    actorContext: testActor({
      principalId: 'U-A',
      membershipId: membershipA.id,
      expectedMembershipVersion: membershipA.version,
      correlationId: 'public-site-cms-active-manager-test',
    }),
    reason: 'public-site-cms-active-manager-test',
  });

  const readRawData = name => {
    const row = context.db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
    return row ? JSON.parse(row.json) : null;
  };
  const setRawData = (name, value) => {
    context.db.prepare(`
      INSERT INTO app_data (name, json) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = CURRENT_TIMESTAMP
    `).run(name, JSON.stringify(value));
  };
  const assertExpected = entry => {
    if (rawFingerprint(readRawData(entry.name)) === entry.expectedFingerprint) return;
    const error = new Error(`Collection ${entry.name} changed after it was read.`);
    error.code = 'APP_DATA_CONCURRENT_MODIFICATION';
    error.status = 409;
    throw error;
  };
  const writeRawData = (name, value, { expectedFingerprint } = {}) => {
    assertExpected({ name, expectedFingerprint });
    setRawData(name, value);
  };
  const writeRawDataBatch = entries => {
    for (const entry of entries) assertExpected(entry);
    for (const entry of entries) setRawData(entry.name, entry.value);
  };
  const boundary = createTenantDataBoundary({
    db: context.db,
    readRawData,
    writeRawData,
    writeRawDataBatch,
    nowIso: () => '2026-08-31T12:00:00.000Z',
  });
  const resolveActorScope = createTrustedActorScopeResolver({ db: context.db });
  const resolvePublicSiteTenant = createPublicSiteTenantResolver([
    { siteIdentity: 'site-a.test', companyId: COMPANY_A, tenantId: COMPANY_A },
    { siteIdentity: 'site-b.test', companyId: COMPANY_B, tenantId: COMPANY_B },
    { siteIdentity: 'ambiguous.test', companyId: COMPANY_A, tenantId: COMPANY_A },
    { siteIdentity: 'ambiguous.test', companyId: COMPANY_B, tenantId: COMPANY_B },
  ]);
  const readPublishedCms = boundary.createBoundPublicTenantSingletonReader({
    collection: CMS_COLLECTION,
    resolveTenantScope: resolvePublicSiteTenant,
    project: projectPublishedPublicSiteCms,
  });
  const tokens = new Map([
    ['admin-a', 'U-A'],
    ['admin-b', 'U-B'],
    ['no-membership', 'U-NONE'],
    ['manager-a', 'U-MANAGER'],
  ]);
  let beforeBoundaryWrite = null;
  let storageFrozen = false;
  let failMediaAudit = false;
  const mediaAudit = [];

  const requireAuth = (req, res, next) => {
    const token = String(req.get('authorization') || '').replace(/^Bearer\s+/, '');
    const principalId = tokens.get(token);
    const user = context.readUsers().find(candidate => candidate.id === principalId);
    if (!user || user.status !== 'Активен') return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
    try {
      const actorScope = resolveActorScope(principalId);
      req.actorScope = actorScope;
      req.user = { userId: principalId, userRole: user.role };
      return runWithTenantActorScope(actorScope, next);
    } catch (error) {
      return res.status(Number(error?.status) || 403).json({
        ok: false,
        code: error?.code || 'ACTOR_SCOPE_INCOMPLETE',
      });
    }
  };
  const requireAdmin = (req, res, next) => (
    req.user?.userRole === 'Администратор'
      ? next()
      : res.status(403).json({ ok: false, code: 'ADMIN_REQUIRED' })
  );
  const writeData = (name, value) => {
    const hook = beforeBoundaryWrite;
    beforeBoundaryWrite = null;
    if (hook) hook();
    return boundary.writeData(name, value);
  };
  const auditLog = (_req, event) => {
    if (failMediaAudit) {
      failMediaAudit = false;
      throw new Error('injected media audit failure');
    }
    mediaAudit.push(structuredClone(event));
  };
  const assertStorageWriteAllowed = () => {
    if (!storageFrozen) return true;
    const error = new Error('production write freeze');
    error.code = 'PRODUCTION_SCOPE_WRITE_FREEZE_ACTIVE';
    throw error;
  };

  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', registerPublicSiteRoutes({
    readData: boundary.readData,
    writeData,
    readPublishedCms,
    requireAuth,
    requireAdmin,
    auditLog,
    assertStorageWriteAllowed,
    uploadRoot,
    nowIso: () => '2026-08-31T12:00:00.000Z',
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const harness = {
    baseUrl,
    boundary,
    context,
    mediaAudit,
    membershipA,
    readRawData,
    root,
    setRawData,
    uploadRoot,
    beforeWrite(callback) { beforeBoundaryWrite = callback; },
    failNextMediaAudit() { failMediaAudit = true; },
    setStorageFrozen(value) { storageFrozen = value; },
  };
  t.after(async () => {
    await closeServer(server);
    context.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return harness;
}

test('CMS validation and sanitization preserve only the reviewed contract', () => {
  const payload = cmsPayload('A');
  assert.deepEqual(validatePublicSiteCms(payload), { ok: true });
  assert.equal(validatePublicSiteCms({ ...payload, equipment: [lift('A'), lift('A')] }).ok, false);
  const sanitized = sanitizePublicSiteCms(payload);
  assert.equal(Object.hasOwn(sanitized, 'companyId'), false);
  assert.equal(Object.hasOwn(sanitized.content, 'privateNotes'), false);
  assert.equal(Object.hasOwn(sanitized.content.company, 'privateCompanyField'), false);
  assert.equal(Object.hasOwn(sanitized.content.home, 'internalDraft'), false);
  assert.equal(Object.hasOwn(sanitized.content.services[0], 'internal'), false);
  assert.equal(Object.hasOwn(sanitized.equipment[0], 'internalCost'), false);
  assert.equal(sanitized.equipment[1].published, false);
  const legacyMissingFlag = cmsPayload('legacy');
  delete legacyMissingFlag.equipment[0].published;
  assert.equal(validatePublicSiteCms(legacyMissingFlag).ok, true);
  assert.equal(sanitizePublicSiteCms(legacyMissingFlag).equipment[0].published, false);
  assert.deepEqual(
    projectPublishedPublicSiteCms({ ...legacyMissingFlag, updatedAt: null }).equipment,
    [],
  );

  assert.throws(
    () => createPublicSiteTenantResolver({ 'site.test': { companyId: COMPANY_A, tenantId: COMPANY_B } }),
    error => error?.code === 'PUBLIC_SITE_TENANT_MAP_INVALID',
  );
  const ambiguous = createPublicSiteTenantResolver([
    { siteIdentity: 'site.test', companyId: COMPANY_A, tenantId: COMPANY_A },
    { siteIdentity: 'site.test', companyId: COMPANY_B, tenantId: COMPANY_B },
  ]);
  assert.equal(ambiguous('site.test'), null);
  assert.match(publicSiteCmsVersion(null), /^[a-f0-9]{64}$/);
});

test('real HTTP and SQLite tenant boundary isolate CMS admin/public access and enforce CAS', async t => {
  const harness = await createHarness(t);
  const payloadA = cmsPayload('A');
  const payloadB = cmsPayload('B');

  assert.equal((await request(harness, '/api/public-site/cms')).status, 401);
  const managerRead = await request(harness, '/api/public-site/cms', { token: 'manager-a' });
  assert.equal(managerRead.status, 403);
  assert.equal(managerRead.body.code, 'ADMIN_REQUIRED');
  const managerWrite = await request(harness, '/api/public-site/cms', {
    method: 'PUT', token: 'manager-a', body: payloadA,
  });
  assert.equal(managerWrite.status, 403);
  assert.equal(managerWrite.body.code, 'ADMIN_REQUIRED');
  assert.equal((await request(harness, '/api/public-site/cms', { token: 'no-membership' })).status, 403);

  const emptyA = await request(harness, '/api/public-site/cms', { token: 'admin-a' });
  assert.match(emptyA.body.version, /^[a-f0-9]{64}$/);
  const missingVersion = await request(harness, '/api/public-site/cms', {
    method: 'PUT', token: 'admin-a', body: payloadA,
  });
  assert.equal(missingVersion.status, 400);
  assert.equal(missingVersion.body.code, 'PUBLIC_SITE_CMS_VERSION_REQUIRED');
  assert.equal(harness.readRawData(CMS_COLLECTION), null);
  const saveA = await request(harness, '/api/public-site/cms', {
    method: 'PUT', token: 'admin-a', body: { ...payloadA, expectedVersion: emptyA.body.version },
  });
  assert.equal(saveA.status, 200, saveA.text);
  assert.match(saveA.body.version, /^[a-f0-9]{64}$/);
  const readA = await request(harness, `/api/public-site/cms?companyId=${encodeURIComponent(COMPANY_B)}`, {
    token: 'admin-a',
  });
  assert.equal(readA.status, 200);
  assert.equal(readA.body.content.company.name, 'Компания A');
  assert.equal(Object.hasOwn(readA.body.content, 'privateNotes'), false);
  assert.equal(Object.hasOwn(readA.body.equipment[0], 'internalCost'), false);

  const emptyB = await request(harness, '/api/public-site/cms', { token: 'admin-b' });
  assert.deepEqual(emptyB.body, {
    content: null,
    equipment: null,
    updatedAt: null,
    version: publicSiteCmsVersion(null),
  });
  assert.equal((await request(harness, '/api/public-site/cms', {
    method: 'PUT', token: 'admin-b', body: { ...payloadB, expectedVersion: emptyB.body.version },
  })).status, 200);
  assert.equal((await request(harness, '/api/public-site/cms', { token: 'admin-a' })).body.content.company.name, 'Компания A');
  assert.equal((await request(harness, '/api/public-site/cms', { token: 'admin-b' })).body.content.company.name, 'Компания B');

  const raw = harness.readRawData(CMS_COLLECTION);
  assert.deepEqual(Object.keys(raw[ENVELOPE]).sort(), [COMPANY_A, COMPANY_B]);
  for (const companyId of [COMPANY_A, COMPANY_B]) {
    assert.equal(raw[ENVELOPE][companyId].companyId, companyId);
    assert.equal(raw[ENVELOPE][companyId].tenantId, companyId);
    assert.equal(Object.hasOwn(raw[ENVELOPE][companyId].value, 'companyId'), false);
    assert.equal(Object.hasOwn(raw[ENVELOPE][companyId].value, 'tenantId'), false);
  }

  const publicA = await request(harness, '/api/public-site/public/site-a.test/cms');
  assert.equal(publicA.status, 200, publicA.text);
  assert.equal(publicA.body.content.company.name, 'Компания A');
  assert.deepEqual(publicA.body.equipment.map(item => item.slug), ['mantall-a']);
  assert.equal(Object.hasOwn(publicA.body, 'updatedBy'), false);
  assert.equal(Object.hasOwn(publicA.body.content, 'privateNotes'), false);
  assert.equal(Object.hasOwn(publicA.body.equipment[0], 'internalCost'), false);
  assert.equal((await request(harness, '/api/public-site/public/site-b.test/cms')).body.content.company.name, 'Компания B');
  for (const identity of ['missing.test', 'ambiguous.test']) {
    const missing = await request(harness, `/api/public-site/public/${identity}/cms`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'PUBLIC_SITE_IDENTITY_UNRESOLVED');
  }

  harness.context.db.prepare(`
    UPDATE company_memberships
    SET status = 'inactive', version = version + 1, inactivatedAt = ?, updatedAt = ?, updatedBy = ?, reason = ?
    WHERE id = ?
  `).run(
    '2026-08-31T12:01:00.000Z',
    '2026-08-31T12:01:00.000Z',
    'U-admin',
    'inactive-membership-test',
    harness.membershipA.id,
  );
  const inactive = await request(harness, '/api/public-site/cms', { token: 'admin-a' });
  assert.equal(inactive.status, 403);
  assert.equal(inactive.body.code, 'ACTOR_SCOPE_INCOMPLETE');
  harness.context.db.prepare(`
    UPDATE company_memberships
    SET status = 'active', version = version + 1, updatedAt = ?, updatedBy = ?, reason = ?
    WHERE id = ?
  `).run('2026-08-31T12:02:00.000Z', 'U-admin', 'reactivate-membership-test', harness.membershipA.id);

  const beforeConcurrentA = (await request(harness, '/api/public-site/cms', { token: 'admin-a' })).body;
  harness.beforeWrite(() => {
    const peer = harness.readRawData(CMS_COLLECTION);
    peer[ENVELOPE][COMPANY_B].value = {
      ...peer[ENVELOPE][COMPANY_B].value,
      updatedAt: '2026-08-31T12:03:00.000Z',
      peerMarker: 'preserve-me',
    };
    harness.setRawData(CMS_COLLECTION, peer);
  });
  const staleWrite = await request(harness, '/api/public-site/cms', {
    method: 'PUT',
    token: 'admin-a',
    body: {
      ...payloadA,
      content: siteContent('A replacement'),
      expectedVersion: beforeConcurrentA.version,
    },
  });
  assert.equal(staleWrite.status, 409, staleWrite.text);
  assert.equal(staleWrite.body.code, 'TENANT_COLLECTION_CONCURRENT_MODIFICATION');
  assert.equal((await request(harness, '/api/public-site/cms', { token: 'admin-a' })).body.content.company.name, beforeConcurrentA.content.company.name);
  assert.equal(harness.readRawData(CMS_COLLECTION)[ENVELOPE][COMPANY_B].value.peerMarker, 'preserve-me');

  const staleEditor = (await request(harness, '/api/public-site/cms', { token: 'admin-a' })).body;
  const peer = harness.readRawData(CMS_COLLECTION);
  peer[ENVELOPE][COMPANY_A].value = {
    ...peer[ENVELOPE][COMPANY_A].value,
    content: siteContent('A peer'),
    updatedAt: '2026-08-31T12:04:00.000Z',
  };
  harness.setRawData(CMS_COLLECTION, peer);
  const staleEditorWrite = await request(harness, '/api/public-site/cms', {
    method: 'PUT',
    token: 'admin-a',
    body: { ...payloadA, expectedVersion: staleEditor.version },
  });
  assert.equal(staleEditorWrite.status, 409);
  assert.equal(staleEditorWrite.body.code, 'PUBLIC_SITE_CMS_VERSION_CONFLICT');
  assert.equal(
    (await request(harness, '/api/public-site/cms', { token: 'admin-a' })).body.content.company.name,
    'Компания A peer',
  );
});

test('tenant media namespaces reject traversal and obey write freeze with rollback', async t => {
  const harness = await createHarness(t);
  const imageBody = {
    fileName: '../../cross-tenant.png',
    contentType: 'image/png',
    base64: Buffer.from('tenant-image-bytes').toString('base64'),
  };
  const managerUpload = await request(harness, '/api/public-site/media', {
    method: 'POST', token: 'manager-a', body: imageBody,
  });
  assert.equal(managerUpload.status, 403);
  assert.equal(managerUpload.body.code, 'ADMIN_REQUIRED');
  const uploadedA = await request(harness, '/api/public-site/media', {
    method: 'POST', token: 'admin-a', body: imageBody,
  });
  const uploadedB = await request(harness, '/api/public-site/media', {
    method: 'POST', token: 'admin-b', body: imageBody,
  });
  assert.equal(uploadedA.status, 201, uploadedA.text);
  assert.equal(uploadedB.status, 201, uploadedB.text);
  assert.match(uploadedA.body.path, /^\/api\/public-site\/media\/[a-f0-9]{64}\/site-[0-9]+-[a-f0-9]{12}\.png$/);
  assert.match(uploadedB.body.path, /^\/api\/public-site\/media\/[a-f0-9]{64}\/site-[0-9]+-[a-f0-9]{12}\.png$/);
  const [, namespaceA, fileA] = uploadedA.body.path.match(/\/media\/([a-f0-9]{64})\/([^/]+)$/);
  const [, namespaceB] = uploadedB.body.path.match(/\/media\/([a-f0-9]{64})\/([^/]+)$/);
  assert.notEqual(namespaceA, namespaceB);
  assert.equal(namespaceA, tenantMediaNamespace({ companyId: COMPANY_A, tenantId: COMPANY_A }));
  assert.equal(namespaceB, tenantMediaNamespace({ companyId: COMPANY_B, tenantId: COMPANY_B }));
  assert.equal(fs.readFileSync(path.join(harness.uploadRoot, 'public-site', namespaceA, fileA), 'utf8'), 'tenant-image-bytes');
  const publicMedia = await request(harness, uploadedA.body.path);
  assert.equal(publicMedia.status, 200);
  assert.equal(publicMedia.response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal((await request(harness, `/api/public-site/media/${namespaceB}/${fileA}`)).status, 404);
  assert.throws(
    () => containedPath(path.join(harness.uploadRoot, 'public-site'), '..', 'escape.png'),
    error => error?.code === 'PUBLIC_SITE_MEDIA_PATH_INVALID',
  );
  assert.notEqual((await request(harness, `/api/public-site/media/${namespaceA}/..%2F${fileA}`)).status, 200);

  const collisionTimestamp = 1_777_777_777_777;
  const collisionEntropy = Buffer.from('deadbeefcafe', 'hex');
  const collisionName = `site-${collisionTimestamp}-${collisionEntropy.toString('hex')}.png`;
  const collisionPath = path.join(harness.uploadRoot, 'public-site', namespaceA, collisionName);
  fs.writeFileSync(collisionPath, 'pre-existing-tenant-media', { flag: 'wx', mode: 0o600 });
  const originalDateNow = Date.now;
  const originalRandomBytes = crypto.randomBytes;
  Date.now = () => collisionTimestamp;
  crypto.randomBytes = size => {
    assert.equal(size, collisionEntropy.length);
    return Buffer.from(collisionEntropy);
  };
  try {
    const collision = await request(harness, '/api/public-site/media', {
      method: 'POST', token: 'admin-a', body: imageBody,
    });
    assert.equal(collision.status, 500);
  } finally {
    Date.now = originalDateNow;
    crypto.randomBytes = originalRandomBytes;
  }
  assert.equal(fs.readFileSync(collisionPath, 'utf8'), 'pre-existing-tenant-media');

  const beforeFreezeFiles = listFiles(harness.uploadRoot);
  const beforeFreezeAudit = harness.mediaAudit.length;
  harness.setStorageFrozen(true);
  const frozen = await request(harness, '/api/public-site/media', {
    method: 'POST', token: 'admin-a', body: imageBody,
  });
  assert.equal(frozen.status, 503, frozen.text);
  assert.equal(frozen.body.code, 'PRODUCTION_SCOPE_WRITE_FREEZE_ACTIVE');
  assert.deepEqual(listFiles(harness.uploadRoot), beforeFreezeFiles);
  assert.equal(harness.mediaAudit.length, beforeFreezeAudit);
  harness.setStorageFrozen(false);

  const beforeAuditFailureFiles = listFiles(harness.uploadRoot);
  harness.failNextMediaAudit();
  const auditFailure = await request(harness, '/api/public-site/media', {
    method: 'POST', token: 'admin-a', body: imageBody,
  });
  assert.equal(auditFailure.status, 500);
  assert.deepEqual(listFiles(harness.uploadRoot), beforeAuditFailureFiles);
  assert.equal(harness.mediaAudit.length, beforeFreezeAudit);

  assert.equal((await request(harness, '/api/public-site/media', {
    method: 'POST', token: 'admin-a', body: { ...imageBody, base64: 'not-base64!' },
  })).status, 400);

  const heldUploadRoot = path.join(harness.root, 'uploads-held');
  const outsideUploadRoot = path.join(harness.root, 'outside-upload-root');
  fs.renameSync(harness.uploadRoot, heldUploadRoot);
  fs.mkdirSync(outsideUploadRoot, { mode: 0o700 });
  fs.symlinkSync(outsideUploadRoot, harness.uploadRoot, 'dir');
  try {
    const symlinkedUpload = await request(harness, '/api/public-site/media', {
      method: 'POST', token: 'admin-a', body: imageBody,
    });
    assert.equal(symlinkedUpload.status, 500);
    assert.equal((await request(harness, uploadedA.body.path)).status, 404);
    assert.deepEqual(listFiles(outsideUploadRoot), []);
  } finally {
    fs.unlinkSync(harness.uploadRoot);
    fs.renameSync(heldUploadRoot, harness.uploadRoot);
  }
});
