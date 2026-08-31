#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const Database = require('better-sqlite3');
const {
  ALL_APP_DATA_COLLECTIONS,
  COLLECTION_SCOPE_CATEGORY,
  COLLECTION_SCOPE_REGISTRY,
  COLLECTION_SHAPE,
  DERIVED_PARENT_RULES,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
} = require('../lib/app-data-scope-registry');
const {
  createTenantDataBoundary,
  runWithTenantActorScope,
} = require('../lib/tenant-data-boundary');
const {
  readEffectiveCatalog,
} = require('../lib/platform-default-tenant-overlay');
const {
  createPlatformIdentityRepository,
  createTrustedUserActorContext,
} = require('../lib/platform-identity-repository');

const LOCAL_SKYTECH_PRINCIPAL_ID = 'LOCAL-SCOPE-SIM-SKYTECH-ADMIN';
const LOCAL_SECOND_PRINCIPAL_ID = 'LOCAL-SCOPE-SIM-SECOND-ADMIN';
const LOCAL_SECOND_COMPANY_ID = 'cmp_LOCAL_SCOPE_SIMULATION_SECOND_TENANT';
const LOCAL_SECOND_BRANCH_ID = 'brn_LOCAL_SCOPE_SIMULATION_SECOND_HEAD';
const LOCAL_SECOND_TEMPLATE_KEY = 'local-scope-simulation-admin';
const LOCAL_FIXTURE_PREFIX = 'LOCAL-SCOPE-SIM-FIXTURE:';
const LOCAL_PASSWORD = 'local-scope-simulation-password';
const FIXTURE_TIME = '2026-08-26T00:00:00.000Z';
const SERVER_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(SERVER_DIR, 'server.js');
const KEY_HTTP_COLLECTIONS = Object.freeze([
  'equipment',
  'clients',
  'counterparties',
  'client_objects',
  'service',
  'spare_parts',
  'service_works',
  'knowledge_base_modules',
  'service_route_norms',
  'service_work_catalog',
  'spare_parts_catalog',
  'documents',
  'app_settings',
]);
const MIXED_CATALOG_COLLECTIONS = new Set(
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
);

class LocalVisibilitySimulationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalVisibilitySimulationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new LocalVisibilitySimulationError(code, message);
}

function legacyPasswordHash(password) {
  return `h1:${crypto.createHash('sha256').update(`${password}:rental-mgmt-v1`).digest('hex')}`;
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help' || name === '-h') return { help: true };
    if (!['--db-path', '--company-id'].includes(name)) fail('ARGUMENT_INVALID', `Unknown argument: ${name}.`);
    const value = argv[++index];
    if (!value) fail('ARGUMENT_INVALID', `Missing value for ${name}.`);
    result[name === '--db-path' ? 'dbPath' : 'companyId'] = value;
  }
  return result;
}

function usage() {
  return [
    'Usage:',
    '  node server/scripts/verify-production-scope-local-visibility.js \\',
    '    --db-path <disposable remediated SQLite copy under the OS temp root> \\',
    '    --company-id <canonical company ID>',
    '',
    'The command mutates only the disposable copy with local-only security fixtures.',
  ].join('\n');
}

function exactDisposablePath(inputPath) {
  const requested = path.resolve(String(inputPath || ''));
  const before = fs.lstatSync(requested);
  const canonical = fs.realpathSync(requested);
  const tempRoot = `${fs.realpathSync(os.tmpdir()).replace(/[\\/]$/, '')}${path.sep}`;
  if (
    !before.isFile()
    || before.isSymbolicLink()
    || before.nlink !== 1
    || canonical !== requested && !canonical.startsWith(tempRoot)
    || !canonical.startsWith(tempRoot)
    || canonical === path.join(tempRoot, 'app.sqlite')
    || canonical.startsWith(`${path.resolve('/data')}${path.sep}`)
  ) {
    fail('DISPOSABLE_DATABASE_REQUIRED', 'Local visibility simulation requires one regular SQLite copy under the OS temp root.');
  }
  return { canonical, before };
}

function emptyCollectionValue(name) {
  const policy = COLLECTION_SCOPE_REGISTRY[name];
  if (!policy) fail('SIMULATION_COLLECTION_UNCLASSIFIED', `Collection ${name} has no registry policy.`);
  if (policy.shape === COLLECTION_SHAPE.ARRAY) return [];
  if (policy.shape === COLLECTION_SHAPE.MAP) return {};
  return { __tenantScopedValues: {} };
}

function readCollection(db, name, { allowMissing = false } = {}) {
  const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
  if (!row) {
    if (allowMissing) return emptyCollectionValue(name);
    fail('SIMULATION_COLLECTION_MISSING', `The disposable copy is missing registry collection ${name}.`);
  }
  try {
    return JSON.parse(row.json);
  } catch {
    fail('SIMULATION_COLLECTION_INVALID', `Registry collection ${name} is invalid JSON.`);
  }
}

function writeCollection(db, name, value) {
  const result = db.prepare(`
    INSERT INTO app_data (name, json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = CURRENT_TIMESTAMP
  `).run(name, JSON.stringify(value));
  if (result.changes !== 1) fail('SIMULATION_COLLECTION_WRITE_FAILED', `Could not update local fixture collection ${name}.`);
}

function collectionCardinality(value, policy) {
  if (policy.shape === COLLECTION_SHAPE.ARRAY) return Array.isArray(value) ? value.length : -1;
  if (policy.shape === COLLECTION_SHAPE.MAP) {
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : -1;
  }
  return value == null ? 0 : 1;
}

function localFixtureRecord(collection) {
  const policy = COLLECTION_SCOPE_REGISTRY[collection];
  const derivedRule = policy?.category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE
    ? DERIVED_PARENT_RULES[collection]?.[0]
    : null;
  const parentCollection = derivedRule?.collections?.[0];
  const parentId = parentCollection === 'users'
    ? LOCAL_SECOND_PRINCIPAL_ID
    : (parentCollection ? `${LOCAL_FIXTURE_PREFIX}${parentCollection}` : null);
  return {
    id: `${LOCAL_FIXTURE_PREFIX}${collection}`,
    companyId: LOCAL_SECOND_COMPANY_ID,
    tenantId: LOCAL_SECOND_COMPANY_ID,
    localSimulationFixture: true,
    ...(derivedRule && parentId ? { [derivedRule.fields[0]]: parentId } : {}),
    ...(COLLECTION_SCOPE_REGISTRY[collection]?.category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
      ? {
          action: 'local.cross_tenant.simulation_marker',
          entityType: 'local_simulation',
          createdAt: FIXTURE_TIME,
        }
      : {}),
  };
}

function addCrossTenantFixture(db, collection, policy) {
  if (
    policy.category === COLLECTION_SCOPE_CATEGORY.SYSTEM
    || policy.writeAuthority === 'PLATFORM_REMEDIATION_ONLY'
  ) return;
  const current = readCollection(db, collection, { allowMissing: true });
  const fixture = localFixtureRecord(collection);
  if (policy.shape === COLLECTION_SHAPE.ARRAY) {
    if (!Array.isArray(current)) fail('SIMULATION_COLLECTION_SHAPE_INVALID', `${collection} must be an array.`);
    writeCollection(db, collection, [...current, fixture]);
    return;
  }
  if (policy.shape === COLLECTION_SHAPE.MAP) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      fail('SIMULATION_COLLECTION_SHAPE_INVALID', `${collection} must be a map.`);
    }
    writeCollection(db, collection, { ...current, [`${LOCAL_FIXTURE_PREFIX}${collection}`]: fixture });
    return;
  }
  if (policy.shape === COLLECTION_SHAPE.SINGLETON) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      fail('SIMULATION_COLLECTION_SHAPE_INVALID', `${collection} must be a singleton object.`);
    }
    const envelope = current.__tenantScopedValues;
    writeCollection(db, collection, {
      ...current,
      __tenantScopedValues: {
        ...(envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? envelope : {}),
        [LOCAL_SECOND_COMPANY_ID]: {
          companyId: LOCAL_SECOND_COMPANY_ID,
          tenantId: LOCAL_SECOND_COMPANY_ID,
          value: fixture,
        },
      },
    });
  }
}

function installLocalAuthority(db, skytechCompanyId) {
  const users = readCollection(db, 'users');
  if (!Array.isArray(users)) fail('SIMULATION_USERS_INVALID', 'The disposable user directory must be an array.');
  if (users.some(user => [LOCAL_SKYTECH_PRINCIPAL_ID, LOCAL_SECOND_PRINCIPAL_ID].includes(user?.id))) {
    fail('SIMULATION_FIXTURE_ALREADY_PRESENT', 'Local visibility principals already exist.');
  }
  const candidateMemberships = db.prepare(`
    SELECT id, principalId, roleTemplateKey, roleTemplateVersion,
           companyWideBranchAuthority, version
    FROM company_memberships
    WHERE companyId = ? AND status = 'active'
    ORDER BY principalId, id
  `).all(skytechCompanyId);
  const usersById = new Map(users.map(user => [String(user?.id || ''), user]));
  const actorMembership = candidateMemberships.find(row => (
    usersById.get(row.principalId)?.status === 'Активен'
    && usersById.get(row.principalId)?.botOnly !== true
  ));
  if (!actorMembership) fail('SIMULATION_AUTHORITY_ACTOR_MISSING', 'No active business membership can create local-only fixtures.');
  const scopedTemplate = db.prepare(`
    SELECT templateKey, templateVersion
    FROM role_templates
    WHERE companyId = ? AND templateKey = ? AND templateVersion = ? AND status = 'active'
  `).get(
    skytechCompanyId,
    actorMembership.roleTemplateKey,
    actorMembership.roleTemplateVersion,
  );
  if (!scopedTemplate) fail('SIMULATION_ROLE_TEMPLATE_MISSING', 'The authority actor role template is unavailable.');
  const password = legacyPasswordHash(LOCAL_PASSWORD);
  const nextUsers = [
    ...users,
    {
      id: LOCAL_SKYTECH_PRINCIPAL_ID,
      name: 'Local Scope Simulation Skytech',
      email: 'local-scope-sim-skytech@example.test',
      role: 'Администратор',
      status: 'Активен',
      password,
      tokenVersion: 0,
      fixtureTag: 'LOCAL_SCOPE_SIMULATION',
    },
    {
      id: LOCAL_SECOND_PRINCIPAL_ID,
      name: 'Local Scope Simulation Second Tenant',
      email: 'local-scope-sim-second@example.test',
      role: 'Администратор',
      status: 'Активен',
      password,
      tokenVersion: 0,
      fixtureTag: 'LOCAL_SCOPE_SIMULATION',
    },
  ];
  writeCollection(db, 'users', nextUsers);
  const readUsers = () => readCollection(db, 'users');
  let generatedIdSequence = 0;
  const repository = createPlatformIdentityRepository(db, {
    readUsers,
    nowIso: () => FIXTURE_TIME,
    generateId: prefix => `${prefix}-${crypto.createHash('sha256')
      .update(`${prefix}:local-scope-simulation:${++generatedIdSequence}`)
      .digest('hex')
      .slice(0, 24)}`,
  });
  const actor = createTrustedUserActorContext({
    principalId: actorMembership.principalId,
    membershipId: actorMembership.id,
    expectedMembershipVersion: Number(actorMembership.version),
    correlationId: 'local-scope-simulation-skytech-fixture',
  });
  const branchIds = actorMembership.companyWideBranchAuthority === 1
    ? []
    : db.prepare(`
        SELECT branchId FROM membership_branch_access
        WHERE membershipId = ? AND status = 'active'
        ORDER BY branchId
      `).all(actorMembership.id).map(row => row.branchId);
  repository.createMembership({
    id: 'mem_LOCAL_SCOPE_SIMULATION_SKYTECH',
    companyId: skytechCompanyId,
    principalId: LOCAL_SKYTECH_PRINCIPAL_ID,
    status: 'active',
    roleTemplateKey: scopedTemplate.templateKey,
    roleTemplateVersion: Number(scopedTemplate.templateVersion),
    companyWideBranchAuthority: actorMembership.companyWideBranchAuthority === 1,
    branchIds,
    actorContext: actor,
    reason: 'local-scope-simulation-only',
    timestamp: FIXTURE_TIME,
  });

  const provisioningActor = createTrustedUserActorContext({
    principalId: actorMembership.principalId,
    correlationId: 'local-scope-simulation-second-tenant',
  });
  repository.createCompanyAuthority({
    company: {
      id: LOCAL_SECOND_COMPANY_ID,
      displayName: 'Local Scope Simulation Second Tenant',
      receivablesTimezone: 'Europe/Moscow',
    },
    branches: [{
      id: LOCAL_SECOND_BRANCH_ID,
      displayName: 'Local Simulation Head Office',
      isHeadOffice: true,
      status: 'active',
    }],
    actorContext: provisioningActor,
    reason: 'local-scope-simulation-only',
    timestamp: FIXTURE_TIME,
  });
  repository.createRoleTemplate({
    companyId: LOCAL_SECOND_COMPANY_ID,
    templateKey: LOCAL_SECOND_TEMPLATE_KEY,
    templateVersion: 1,
    displayName: 'Local Simulation Administrator',
    capabilities: [],
    actorContext: provisioningActor,
    reason: 'local-scope-simulation-only',
    timestamp: FIXTURE_TIME,
  });
  repository.createMembership({
    id: 'mem_LOCAL_SCOPE_SIMULATION_SECOND',
    companyId: LOCAL_SECOND_COMPANY_ID,
    principalId: LOCAL_SECOND_PRINCIPAL_ID,
    status: 'active',
    roleTemplateKey: LOCAL_SECOND_TEMPLATE_KEY,
    roleTemplateVersion: 1,
    companyWideBranchAuthority: true,
    branchIds: [],
    actorContext: provisioningActor,
    reason: 'local-scope-simulation-only',
    timestamp: FIXTURE_TIME,
  });
}

function containsFixture(value) {
  if (typeof value === 'string') return value.startsWith(LOCAL_FIXTURE_PREFIX)
    || value === 'local.cross_tenant.simulation_marker';
  if (Array.isArray(value)) return value.some(containsFixture);
  return Boolean(value && typeof value === 'object' && Object.values(value).some(containsFixture));
}

function recordIds(value) {
  return new Set(Array.isArray(value)
    ? value.map(record => String(record?.id || '')).filter(Boolean)
    : []);
}

function containsExpectedProjection(actual, expected) {
  if (Array.isArray(expected)) return isDeepStrictEqual(actual, expected);
  if (expected && typeof expected === 'object') {
    return Boolean(actual && typeof actual === 'object' && !Array.isArray(actual))
      && Object.entries(expected).every(([key, value]) => (
        key === 'localSimulationFixture'
        || containsExpectedProjection(actual[key], value)
      ));
  }
  return isDeepStrictEqual(actual, expected);
}

function effectiveCatalogResponseMatches(visibleValue, expected) {
  if (visibleValue.length !== expected.length) return false;
  const visibleById = new Map(visibleValue.map(record => [String(record?.id || ''), record]));
  if (visibleById.size !== visibleValue.length || visibleById.has('')) return false;
  return expected.every(record => {
    const id = String(record?.id || '');
    return id && containsExpectedProjection(visibleById.get(id), record);
  });
}

function mixedCatalogVisibility(collection, rawValue, visibleValue, { tenantId, fixtureExpected }) {
  if (!Array.isArray(rawValue) || !Array.isArray(visibleValue)) return false;
  const expected = readEffectiveCatalog({
    collection,
    records: rawValue,
    scope: { companyId: tenantId, tenantId },
  });
  const visibleIds = recordIds(visibleValue);
  const platformDefaultIds = rawValue.filter(record => (
    !String(record?.companyId || '').trim()
    && !String(record?.tenantId || '').trim()
    && !Object.prototype.hasOwnProperty.call(record || {}, 'platformDefaultId')
  )).map(record => String(record?.id || ''));
  const foreignStandaloneIds = rawValue.filter(record => (
    String(record?.tenantId || '').trim()
    && String(record?.tenantId || '').trim() !== tenantId
    && !Object.prototype.hasOwnProperty.call(record || {}, 'platformDefaultId')
  )).map(record => String(record?.id || ''));
  return effectiveCatalogResponseMatches(visibleValue, expected)
    && platformDefaultIds.every(id => id && visibleIds.has(id))
    && foreignStandaloneIds.every(id => !visibleIds.has(id))
    && (fixtureExpected ? containsFixture(visibleValue) : !containsFixture(visibleValue));
}

function readBoundaryMatrix(db, skytechCompanyId) {
  const readRawData = name => readCollection(db, name, { allowMissing: true });
  const forbiddenWrite = () => fail('SIMULATION_BOUNDARY_WRITE_FORBIDDEN', 'Visibility verification is read-only.');
  const boundary = createTenantDataBoundary({
    db,
    readRawData,
    writeRawData: forbiddenWrite,
    writeRawDataBatch: forbiddenWrite,
  });
  const scopes = {
    skytech: { companyId: skytechCompanyId, tenantId: skytechCompanyId },
    second: { companyId: LOCAL_SECOND_COMPANY_ID, tenantId: LOCAL_SECOND_COMPANY_ID },
  };
  const rows = [];
  let leakageCount = 0;
  for (const collection of ALL_APP_DATA_COLLECTIONS) {
    const policy = COLLECTION_SCOPE_REGISTRY[collection];
    if (collection === 'bot_sessions') {
      for (const scope of Object.values(scopes)) {
        try {
          runWithTenantActorScope(scope, () => boundary.readData(collection));
          leakageCount += 1;
        } catch (error) {
          if (error.code !== 'SYSTEM_COLLECTION_POLICY_REQUIRED') throw error;
        }
      }
      rows.push({
        collection,
        category: policy.category,
        expectedPolicy: 'TENANT_READ_DENIED',
        skytechVisible: 0,
        secondTenantVisible: 0,
        pass: true,
      });
      continue;
    }
    const skytechValue = runWithTenantActorScope(scopes.skytech, () => boundary.readData(collection));
    const secondValue = runWithTenantActorScope(scopes.second, () => boundary.readData(collection));
    const skytechVisible = collectionCardinality(skytechValue, policy);
    const secondTenantVisible = collectionCardinality(secondValue, policy);
    const immutableReplay = policy.writeAuthority === 'PLATFORM_REMEDIATION_ONLY';
    const mixedCatalog = MIXED_CATALOG_COLLECTIONS.has(collection);
    const expectedSecond = collection === 'users' ? 1 : immutableReplay ? 0 : 1;
    const pass = mixedCatalog
      ? mixedCatalogVisibility(
          collection,
          readCollection(db, collection, { allowMissing: true }),
          skytechValue,
          { tenantId: skytechCompanyId, fixtureExpected: false },
        )
        && mixedCatalogVisibility(
          collection,
          readCollection(db, collection, { allowMissing: true }),
          secondValue,
          { tenantId: LOCAL_SECOND_COMPANY_ID, fixtureExpected: true },
        )
      : skytechVisible >= 0
        && !containsFixture(skytechValue)
        && secondTenantVisible === expectedSecond
        && (immutableReplay || collection === 'users' || containsFixture(secondValue));
    if (!pass) leakageCount += 1;
    rows.push({
      collection,
      category: policy.category,
      expectedPolicy: immutableReplay
        ? 'LEGACY_REPLAY_HIDDEN'
        : (mixedCatalog ? 'PLATFORM_DEFAULT_PLUS_EXACT_TENANT_OVERLAY' : 'STRICT_TENANT_SCOPE'),
      skytechVisible,
      secondTenantVisible,
      pass,
    });
  }
  return { rows, leakageCount };
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function localServerEnv(dbPath, port) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('RAILWAY_')
      || key.startsWith('PRODUCTION_SCOPE_')
      || key.startsWith('SKYTECH_CLEAN_')
      || ['APP_DISABLED', 'WRITE_FREEZE', 'WRITE_FREEZE_ENABLED'].includes(key)
    ) delete env[key];
  }
  return {
    ...env,
    NODE_ENV: 'test',
    PORT: String(port),
    DB_PATH: dbPath,
    BOT_DISABLED: 'true',
    GSM_DISABLED: 'true',
    GPRS_ENABLED: 'false',
    MAX_BOT_TRANSPORT: 'disabled',
    LOGIN_FAILURE_DELAY_MS: '0',
  };
}

async function startServer(dbPath) {
  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: localServerEnv(dbPath, port),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = chunk => { output = `${output}${String(chunk)}`.slice(-12_000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail('SIMULATION_SERVER_START_FAILED', 'Target server exited during local visibility startup.');
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return { baseUrl, child, output: () => output };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill('SIGKILL');
  fail('SIMULATION_SERVER_START_TIMEOUT', 'Target server did not become healthy for local visibility verification.');
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  const exited = new Promise(resolve => server.child.once('exit', resolve));
  server.child.kill('SIGTERM');
  const timer = setTimeout(() => server.child.kill('SIGKILL'), 5_000);
  await exited;
  clearTimeout(timer);
}

async function api(baseUrl, method, route, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    signal: AbortSignal.timeout(5_000),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let value = null;
  try { value = JSON.parse(await response.text()); } catch {}
  return { status: response.status, body: value };
}

function responseRecords(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['items', 'data', 'rows', 'logs']) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

async function login(baseUrl, email) {
  const response = await api(baseUrl, 'POST', '/api/auth/login', {
    body: { email, password: LOCAL_PASSWORD },
  });
  if (response.status !== 200 || typeof response.body?.token !== 'string') {
    fail('SIMULATION_LOGIN_FAILED', 'A local authoritative tenant principal could not authenticate.');
  }
  return response.body.token;
}

function installHttpFixtures(dbPath) {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    const base = collection => ({
      id: `${LOCAL_FIXTURE_PREFIX}${collection}`,
      companyId: LOCAL_SECOND_COMPANY_ID,
      tenantId: LOCAL_SECOND_COMPANY_ID,
      localSimulationFixture: true,
    });
    const fixtures = {
      equipment: [{
        ...base('equipment'),
        inventoryNumber: 'LOCAL-SCOPE-SIM-EQ',
        manufacturer: 'Local Simulation',
        model: 'Cross Tenant Probe',
        status: 'available',
      }],
      counterparties: [{
        ...base('counterparties'),
        type: 'legal_entity',
        legalName: 'Local Scope Simulation Counterparty',
        shortName: 'Local Simulation Counterparty',
        inn: '7707083893',
        innNormalized: '7707083893',
        roles: ['customer'],
        status: 'active',
      }],
      clients: [{
        ...base('clients'),
        counterpartyId: `${LOCAL_FIXTURE_PREFIX}counterparties`,
        company: 'Local Scope Simulation Client',
        inn: '7707083893',
        innNormalized: '7707083893',
        status: 'active',
      }],
      client_objects: [{
        ...base('client_objects'),
        clientId: `${LOCAL_FIXTURE_PREFIX}clients`,
        name: 'Local Scope Simulation Object',
        status: 'active',
      }],
      service: [{
        ...base('service'),
        equipmentId: `${LOCAL_FIXTURE_PREFIX}equipment`,
        equipment: 'Local Simulation Cross Tenant Probe',
        status: 'closed',
        type: 'maintenance',
      }],
      spare_parts: [{
        ...base('spare_parts'),
        name: 'Local Scope Simulation Part',
        article: 'LOCAL-SCOPE-SIM-PART',
        unit: 'шт',
        isActive: true,
      }],
      service_works: [{
        ...base('service_works'),
        name: 'Local Scope Simulation Work',
        normHours: 1,
        ratePerHour: 1,
        isActive: true,
      }],
      knowledge_base_modules: [{
        ...base('knowledge_base_modules'),
        title: 'Local Scope Simulation Module',
        section: 'manager_training',
        audience: 'all',
        isActive: true,
        quiz: [],
      }],
      service_route_norms: [{
        ...base('service_route_norms'),
        from: 'Local Simulation A',
        to: 'Local Simulation B',
        distanceKm: 1,
        normHours: 1,
        isActive: true,
      }],
      service_work_catalog: [{
        ...base('service_work_catalog'),
        name: 'Local Scope Simulation Work Catalog Entry',
        normHours: 1,
        ratePerHour: 1,
        isActive: true,
      }],
      spare_parts_catalog: [{
        ...base('spare_parts_catalog'),
        name: 'Local Scope Simulation Parts Catalog Entry',
        article: 'LOCAL-SCOPE-SIM-CATALOG-PART',
        unit: 'шт',
        isActive: true,
      }],
      documents: [{
        ...base('documents'),
        clientId: `${LOCAL_FIXTURE_PREFIX}clients`,
        type: 'act',
        number: 'LOCAL-SCOPE-SIM-DOC',
        date: '2026-08-26',
        status: 'signed',
      }],
      app_settings: [{
        ...base('app_settings'),
        key: 'local_scope_simulation_marker',
        value: 'second-tenant-only',
      }],
      audit_logs: [{
        ...base('audit_logs'),
        action: 'local.cross_tenant.simulation_marker',
        entityType: 'local_simulation',
        createdAt: FIXTURE_TIME,
      }],
    };
    db.transaction(() => {
      for (const [collection, records] of Object.entries(fixtures)) {
        const current = readCollection(db, collection, { allowMissing: true });
        if (!Array.isArray(current)) fail('SIMULATION_COLLECTION_SHAPE_INVALID', `${collection} must be an array.`);
        writeCollection(db, collection, [...current, ...records]);
      }
    }).immediate();
  } finally {
    if (db.open) db.close();
  }
}

async function verifyActualApi(dbPath, skytechCompanyId) {
  let server;
  try {
    server = await startServer(dbPath);
    installHttpFixtures(dbPath);
    const skytechToken = await login(server.baseUrl, 'local-scope-sim-skytech@example.test');
    const secondToken = await login(server.baseUrl, 'local-scope-sim-second@example.test');
    const routes = [];
    let leakageCount = 0;
    for (const collection of KEY_HTTP_COLLECTIONS) {
      const route = `/api/${collection}`;
      const skytech = await api(server.baseUrl, 'GET', route, { token: skytechToken });
      const second = await api(server.baseUrl, 'GET', route, { token: secondToken });
      const skytechRecords = responseRecords(skytech.body);
      const secondRecords = responseRecords(second.body);
      const mixedCatalog = MIXED_CATALOG_COLLECTIONS.has(collection);
      let visibilityPass;
      if (mixedCatalog) {
        const readDb = new Database(dbPath, { readonly: true, fileMustExist: true });
        let rawValue;
        try {
          rawValue = readCollection(readDb, collection, { allowMissing: true });
        } finally {
          readDb.close();
        }
        visibilityPass = mixedCatalogVisibility(collection, rawValue, skytechRecords, {
          tenantId: skytechCompanyId,
          fixtureExpected: false,
        }) && mixedCatalogVisibility(collection, rawValue, secondRecords, {
          tenantId: LOCAL_SECOND_COMPANY_ID,
          fixtureExpected: true,
        });
      } else {
        visibilityPass = !containsFixture(skytechRecords)
          && secondRecords.length === 1
          && containsFixture(secondRecords);
      }
      const pass = skytech.status === 200
        && second.status === 200
        && visibilityPass;
      if (!pass) leakageCount += 1;
      routes.push({
        collection,
        statusSkytech: skytech.status,
        statusSecondTenant: second.status,
        visibleSkytech: skytechRecords.length,
        visibleSecondTenant: secondRecords.length,
        pass,
      });
    }

    const exports = [];
    for (const [scope, token] of [['skytech', skytechToken], ['secondTenant', secondToken]]) {
      const response = await api(server.baseUrl, 'GET', '/api/admin/system-data/export', { token });
      const collections = response.body?.collections;
      const pass = response.status === 200
        && collections
        && (scope === 'skytech' ? !containsFixture(collections) : containsFixture(collections));
      if (!pass) leakageCount += 1;
      exports.push({
        scope,
        status: response.status,
        collectionCount: collections && typeof collections === 'object' ? Object.keys(collections).length : 0,
        pass: Boolean(pass),
      });
    }

    const skytechAudit = await api(server.baseUrl, 'GET', '/api/admin/audit-logs', { token: skytechToken });
    const secondAudit = await api(server.baseUrl, 'GET', '/api/admin/audit-logs', { token: secondToken });
    const auditPass = skytechAudit.status === 200
      && secondAudit.status === 200
      && !containsFixture(skytechAudit.body)
      && containsFixture(secondAudit.body);
    if (!auditPass) leakageCount += 1;
    return {
      routes,
      exports,
      auditIsolation: { pass: auditPass },
      leakageCount,
    };
  } finally {
    await stopServer(server);
  }
}

async function runLocalVisibilitySimulation({ dbPath, companyId }) {
  if (!companyId || companyId !== companyId.trim()) fail('COMPANY_ID_REQUIRED', 'An exact canonical company ID is required.');
  const target = exactDisposablePath(dbPath);
  const inputBefore = {
    dev: target.before.dev,
    ino: target.before.ino,
    size: target.before.size,
    sha256: fileSha256(target.canonical),
  };
  const boundaryDbPath = `${target.canonical}.boundary`;
  const apiDbPath = `${target.canonical}.api`;
  if (fs.existsSync(boundaryDbPath) || fs.existsSync(apiDbPath)) {
    fail('SIMULATION_WORKING_COPY_EXISTS', 'Local visibility working copies must be absent.');
  }
  fs.copyFileSync(target.canonical, boundaryDbPath, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(target.canonical, apiDbPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(boundaryDbPath, 0o600);
  fs.chmodSync(apiDbPath, 0o600);
  let boundary;
  try {
    const boundaryDb = new Database(boundaryDbPath, { fileMustExist: true });
    try {
      boundaryDb.pragma('foreign_keys = ON');
      installLocalAuthority(boundaryDb, companyId);
      boundaryDb.transaction(() => {
        for (const collection of ALL_APP_DATA_COLLECTIONS) {
          addCrossTenantFixture(boundaryDb, collection, COLLECTION_SCOPE_REGISTRY[collection]);
        }
      }).immediate();
      boundary = readBoundaryMatrix(boundaryDb, companyId);
      if (
        boundaryDb.pragma('quick_check', { simple: true }) !== 'ok'
        || boundaryDb.pragma('foreign_key_check').length !== 0
      ) {
        fail('SIMULATION_FIXTURE_INTEGRITY_FAILED', 'Local-only tenant fixtures violated SQLite integrity.');
      }
    } finally {
      if (boundaryDb.open) boundaryDb.close();
    }
    const apiDb = new Database(apiDbPath, { fileMustExist: true });
    try {
      apiDb.pragma('foreign_keys = ON');
      installLocalAuthority(apiDb, companyId);
    } finally {
      if (apiDb.open) apiDb.close();
    }
    const actualApi = await verifyActualApi(apiDbPath, companyId);
    const leakageCount = boundary.leakageCount + actualApi.leakageCount;
    const inputAfter = fs.statSync(target.canonical);
    if (
      inputAfter.dev !== inputBefore.dev
      || inputAfter.ino !== inputBefore.ino
      || inputAfter.size !== inputBefore.size
      || inputAfter.nlink !== 1
      || fileSha256(target.canonical) !== inputBefore.sha256
    ) {
      fail('SIMULATION_INPUT_COPY_CHANGED', 'The remediated input copy changed during local visibility verification.');
    }
    return {
      status: leakageCount === 0 ? 'PASS' : 'FAIL',
      productionWritePerformed: false,
      inputRemediatedCopyMutated: false,
      localWorkingCopiesMutated: true,
      fakeCompanyPersistedOutsideDisposableCopy: false,
      registryCollectionCount: ALL_APP_DATA_COLLECTIONS.length,
      serviceBoundary: {
        rows: boundary.rows,
        leakageCount: boundary.leakageCount,
      },
      actualApi: {
        ...actualApi,
        targetServerStartedAgainstRemediatedCopy: true,
      },
      crossTenantLeakageCount: leakageCount,
    };
  } finally {
    for (const workingPath of [boundaryDbPath, apiDbPath]) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(`${workingPath}${suffix}`); } catch {}
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.dbPath || !args.companyId) fail('ARGUMENT_REQUIRED', usage());
  const result = await runLocalVisibilitySimulation(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS') process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || 'LOCAL_VISIBILITY_SIMULATION_FAILED',
      message: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  KEY_HTTP_COLLECTIONS,
  exactDisposablePath,
  mixedCatalogVisibility,
  runLocalVisibilitySimulation,
};
