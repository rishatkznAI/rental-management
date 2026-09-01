import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { registerAuthRoutes } = require('../server/routes/auth.js');
const {
  isExactProductionSmokeReaderUser,
} = require('../server/lib/production-validation-read-only.js');
const {
  PRODUCTION_SMOKE_READER_EMAIL,
  PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
  PRODUCTION_SMOKE_READER_ROLE,
  PRODUCTION_SMOKE_REPLACEMENT_REASON,
  PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
} = require('../server/lib/production-smoke-identity.js');

function createMockResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function createAuthRoutes(state, overrides = {}) {
  const routes = {};
  const app = {
    post(path, ...handlers) { routes[`POST ${path}`] = handlers; },
    get(path, ...handlers) { routes[`GET ${path}`] = handlers; },
    patch(path, ...handlers) { routes[`PATCH ${path}`] = handlers; },
  };

  registerAuthRoutes(app, {
    readData: (name) => state[name] || [],
    writeData: (name, value) => { state[name] = value; },
    verifyPassword: (plain, stored) => plain === stored,
    hashPassword: (plain) => `hash:${plain}`,
    needsPasswordRehash: overrides.needsPasswordRehash || (() => false),
    rehashAuthUser: overrides.rehashAuthUser,
    createSession: overrides.createSession || (() => 'session-token'),
    resolveActorScope: overrides.resolveActorScope || (() => null),
    requireActorScopeOnLogin: overrides.requireActorScopeOnLogin === true,
    requireAuth: overrides.requireAuth || ((_req, _res, next) => next()),
    destroySession: overrides.destroySession || (() => {}),
    deleteSessionsForUserIds: overrides.deleteSessionsForUserIds || (() => 0),
    auditLog: overrides.auditLog || (() => {}),
    isProductionValidationReadOnly: overrides.isProductionValidationReadOnly || (() => false),
    isExactProductionSmokeReaderUser: overrides.isExactProductionSmokeReaderUser
      || isExactProductionSmokeReaderUser,
    runProductionValidationLoginTransaction: overrides.runProductionValidationLoginTransaction
      || (operation => operation()),
    nowIso: () => '2026-04-28T12:00:00.000Z',
  });

  return routes;
}

async function runLogin(login, body) {
  const res = createMockResponse();
  await login({ body, headers: {}, ip: '127.0.0.1' }, res);
  return res;
}

test('login works with full email', async () => {
  const state = {
    users: [{ id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'right' }],
  };
  const login = createAuthRoutes(state)['POST /api/auth/login'][0];

  const res = await runLogin(login, { email: 'manager@example.test', password: 'right' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.token, 'session-token');
  assert.equal(res.payload.user.email, 'manager@example.test');
});

test('password rehash uses an atomic per-user precondition and the latest user record', async () => {
  const state = {
    users: [
      { id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'legacy' },
      { id: 'U-2', name: 'Мария', email: 'office@example.test', role: 'Офис-менеджер', status: 'Активен', password: 'other' },
    ],
  };
  let sessionUser;
  const routes = createAuthRoutes(state, {
    needsPasswordRehash: hash => hash === 'legacy',
    rehashAuthUser: ({ userId, expectedPasswordHash, nextPasswordHash }) => {
      assert.deepEqual({ userId, expectedPasswordHash, nextPasswordHash }, {
        userId: 'U-1',
        expectedPasswordHash: 'legacy',
        nextPasswordHash: 'hash:legacy',
      });
      state.users[1] = { ...state.users[1], name: 'Мария — concurrent update' };
      state.users[0] = { ...state.users[0], name: 'Руслан — latest', password: nextPasswordHash };
      return state.users[0];
    },
    createSession: user => {
      sessionUser = user;
      return 'session-token';
    },
  });

  const res = await runLogin(routes['POST /api/auth/login'][0], {
    email: 'manager@example.test',
    password: 'legacy',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(sessionUser.name, 'Руслан — latest');
  assert.equal(state.users[1].name, 'Мария — concurrent update');
});

test('password rehash rejects login when the credential changed after verification', async () => {
  process.env.LOGIN_FAILURE_DELAY_MS = '0';
  const state = {
    users: [{ id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'legacy' }],
  };
  let sessionCreated = false;
  const routes = createAuthRoutes(state, {
    needsPasswordRehash: () => true,
    rehashAuthUser: () => null,
    createSession: () => { sessionCreated = true; return 'unexpected'; },
  });

  const res = await runLogin(routes['POST /api/auth/login'][0], {
    email: 'manager@example.test',
    password: 'legacy',
  });
  assert.equal(res.statusCode, 401);
  assert.equal(sessionCreated, false);
});

test('production validation login never rehashes credentials and suppresses failure audit writes', async () => {
  process.env.LOGIN_FAILURE_DELAY_MS = '0';
  const state = {
    users: [{
      id: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
      name: 'Production smoke reader',
      email: PRODUCTION_SMOKE_READER_EMAIL,
      role: PRODUCTION_SMOKE_READER_ROLE,
      status: 'Активен',
      password: 'legacy',
      tokenVersion: 0,
      botOnly: false,
      allowFrontendLogin: true,
      frontendAccess: true,
      replacementForPrincipalId: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
      replacementReason: PRODUCTION_SMOKE_REPLACEMENT_REASON,
    }],
  };
  let rehashCalls = 0;
  let auditWrites = 0;
  let sessionWrites = 0;
  const routes = createAuthRoutes(state, {
    needsPasswordRehash: () => true,
    rehashAuthUser: () => { rehashCalls += 1; return state.users[0]; },
    createSession: () => { sessionWrites += 1; return 'unexpected'; },
    auditLog: Object.assign(() => { auditWrites += 1; }, {
      system: () => { auditWrites += 1; },
    }),
    isProductionValidationReadOnly: () => true,
  });
  const login = routes['POST /api/auth/login'][0];

  const wrong = await runLogin(login, {
    email: PRODUCTION_SMOKE_READER_EMAIL,
    password: 'wrong',
  });
  assert.equal(wrong.statusCode, 401);

  const legacy = await runLogin(login, {
    email: PRODUCTION_SMOKE_READER_EMAIL,
    password: 'legacy',
  });
  assert.equal(legacy.statusCode, 503);
  assert.equal(legacy.payload.code, 'PRODUCTION_VALIDATION_SMOKE_HASH_INVALID');
  assert.equal(rehashCalls, 0);
  assert.equal(sessionWrites, 0);
  assert.equal(auditWrites, 0);
});

test('production validation success persists only the exact reader session and audit in its transaction', async () => {
  const user = {
    id: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
    name: 'Production smoke reader',
    email: PRODUCTION_SMOKE_READER_EMAIL,
    role: PRODUCTION_SMOKE_READER_ROLE,
    status: 'Активен',
    password: 'strong',
    tokenVersion: 0,
    botOnly: false,
    allowFrontendLogin: true,
    frontendAccess: true,
    replacementForPrincipalId: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
    replacementReason: PRODUCTION_SMOKE_REPLACEMENT_REASON,
  };
  const effects = [];
  const routes = createAuthRoutes({ users: [user] }, {
    isProductionValidationReadOnly: () => true,
    resolveActorScope: () => ({
      companyId: 'cmp_A',
      tenantId: 'cmp_A',
      principalId: user.id,
    }),
    requireActorScopeOnLogin: true,
    createSession: sessionUser => {
      effects.push(`session:${sessionUser.id}`);
      return 'validation-session';
    },
    auditLog: request => effects.push(`audit:${request.user.userId}`),
    runProductionValidationLoginTransaction: operation => {
      effects.push('transaction:begin');
      const result = operation();
      effects.push('transaction:commit');
      return result;
    },
  });

  const success = await runLogin(routes['POST /api/auth/login'][0], {
    email: user.email,
    password: 'strong',
  });
  assert.equal(success.statusCode, 200);
  assert.equal(success.payload.token, 'validation-session');
  assert.deepEqual(effects, [
    'transaction:begin',
    `session:${user.id}`,
    `audit:${user.id}`,
    'transaction:commit',
  ]);

  effects.length = 0;
  user.role = 'Администратор';
  const drifted = await runLogin(routes['POST /api/auth/login'][0], {
    email: user.email,
    password: 'strong',
  });
  assert.equal(drifted.statusCode, 503);
  assert.equal(drifted.payload.code, 'PRODUCTION_VALIDATION_SMOKE_IDENTITY_INVALID');
  assert.deepEqual(effects, []);
});

test('login works with local login before @', async () => {
  const state = {
    users: [{ id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'right' }],
  };
  const login = createAuthRoutes(state)['POST /api/auth/login'][0];

  const res = await runLogin(login, { login: 'manager', password: 'right' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.user.email, 'manager@example.test');
});

test('login ignores case and surrounding spaces', async () => {
  const state = {
    users: [{ id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'right' }],
  };
  const login = createAuthRoutes(state)['POST /api/auth/login'][0];

  const res = await runLogin(login, { login: '  MANAGER  ', password: 'right' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.user.email, 'manager@example.test');
});

test('login returns the same error for missing user and wrong password', async () => {
  process.env.LOGIN_FAILURE_DELAY_MS = '0';
  const state = {
    users: [{ id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'right' }],
  };
  const routes = createAuthRoutes(state);
  const login = routes['POST /api/auth/login'][0];

  const missingUserRes = createMockResponse();
  await login({ body: { email: 'missing@example.test', password: 'right' }, headers: {}, ip: '127.0.0.1' }, missingUserRes);

  const wrongPasswordRes = createMockResponse();
  await login({ body: { email: 'manager@example.test', password: 'wrong' }, headers: {}, ip: '127.0.0.1' }, wrongPasswordRes);

  assert.equal(missingUserRes.statusCode, 401);
  assert.equal(wrongPasswordRes.statusCode, 401);
  assert.deepEqual(missingUserRes.payload, { ok: false, error: 'Неверный логин или пароль' });
  assert.deepEqual(wrongPasswordRes.payload, { ok: false, error: 'Неверный логин или пароль' });
});

test('inactive user cannot login', async () => {
  process.env.LOGIN_FAILURE_DELAY_MS = '0';
  const state = {
    users: [{ id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Неактивен', password: 'right' }],
  };
  const login = createAuthRoutes(state)['POST /api/auth/login'][0];

  const res = await runLogin(login, { login: 'manager', password: 'right' });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { ok: false, error: 'Неверный логин или пароль' });
});

test('duplicate email local part blocks login without disclosing directory ambiguity', async () => {
  process.env.LOGIN_FAILURE_DELAY_MS = '0';
  const state = {
    users: [
      { id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'right' },
      { id: 'U-2', name: 'Мария', email: 'MANAGER@other.test', role: 'Менеджер по аренде', status: 'Активен', password: 'right' },
    ],
  };
  const login = createAuthRoutes(state)['POST /api/auth/login'][0];

  const res = await runLogin(login, { login: 'manager', password: 'right' });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { ok: false, error: 'Неверный логин или пароль' });
});

test('frontend login is unavailable for bot-only carrier accounts', async () => {
  process.env.LOGIN_FAILURE_DELAY_MS = '0';
  const state = {
    users: [{
      id: 'carrier-1',
      name: 'Быстрая доставка',
      email: 'carrier@example.test',
      role: 'Перевозчик',
      status: 'Активен',
      password: 'right',
      botOnly: true,
      carrierId: 'carrier-1',
    }],
  };
  const routes = createAuthRoutes(state);
  const login = routes['POST /api/auth/login'][0];
  const res = createMockResponse();

  await login({ body: { email: 'carrier@example.test', password: 'right' }, headers: {}, ip: '127.0.0.1' }, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { ok: false, error: 'Неверный логин или пароль' });
});

test('frontend login is unavailable for bot-only carrier alias accounts', async () => {
  process.env.LOGIN_FAILURE_DELAY_MS = '0';
  const state = {
    users: [{
      id: 'carrier-1',
      name: 'Быстрая доставка',
      email: 'carrier@example.test',
      role: 'delivery carrier',
      status: 'Активен',
      password: 'right',
      botOnly: true,
      carrierId: 'carrier-1',
    }],
  };
  const routes = createAuthRoutes(state);
  const login = routes['POST /api/auth/login'][0];
  const res = createMockResponse();

  await login({ body: { email: 'carrier@example.test', password: 'right' }, headers: {}, ip: '127.0.0.1' }, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { ok: false, error: 'Неверный логин или пароль' });
});

test('frontend login for explicitly allowed carrier keeps carrierId in auth payload', async () => {
  process.env.LOGIN_FAILURE_DELAY_MS = '0';
  const state = {
    users: [{
      id: 'carrier-1',
      name: 'Быстрая доставка',
      email: 'carrier@example.test',
      role: 'Перевозчик',
      status: 'Активен',
      password: 'right',
      botOnly: false,
      allowFrontendLogin: true,
      carrierId: 'carrier-1',
    }],
  };
  const routes = createAuthRoutes(state);
  const login = routes['POST /api/auth/login'][0];

  const res = await runLogin(login, { email: 'carrier@example.test', password: 'right' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.user.role, 'Перевозчик');
  assert.equal(res.payload.user.carrierId, 'carrier-1');
});

test('password change increments tokenVersion and revokes existing sessions', () => {
  const revokedIds = [];
  const state = {
    users: [{ id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'old', tokenVersion: 2 }],
  };
  const routes = createAuthRoutes(state, {
    deleteSessionsForUserIds: (ids) => {
      revokedIds.push(...ids);
      return ids.length;
    },
  });
  const changePassword = routes['POST /api/auth/change-password'][1];
  const res = createMockResponse();

  changePassword({
    body: { currentPassword: 'old', newPassword: 'new-password' },
    user: { userId: 'U-1', userName: 'Руслан', userRole: 'Менеджер по аренде', tokenVersion: 2 },
    headers: {},
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(state.users[0].tokenVersion, 3);
  assert.equal(state.users[0].passwordChangedAt, '2026-04-28T12:00:00.000Z');
  assert.deepEqual(revokedIds, ['U-1']);
});

test('/api/auth/me returns the current user shape for a valid token', () => {
  const state = {
    users: [{
      id: 'U-1',
      name: 'Руслан',
      email: 'manager@example.test',
      role: 'rental_manager',
      status: 'Активен',
      password: 'right',
      tokenVersion: 0,
    }],
  };
  const routes = createAuthRoutes(state, {
    requireAuth: (req, _res, next) => {
      req.user = { userId: 'U-1' };
      next();
    },
  });
  const me = routes['GET /api/auth/me'][1];
  const res = createMockResponse();

  me({ headers: { authorization: 'Bearer session-token' }, user: { userId: 'U-1' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.deepEqual(res.payload.user, {
    userId: 'U-1',
    userName: 'Руслан',
    userRole: 'Менеджер по аренде',
    rawRole: 'rental_manager',
    normalizedRole: 'Менеджер по аренде',
    permissions: undefined,
    email: 'manager@example.test',
    profilePhoto: undefined,
    ownerId: undefined,
    ownerName: undefined,
  });
});

test('/api/auth/me rejects inactive users and destroys the bearer session', () => {
  const destroyedTokens = [];
  const state = {
    users: [{ id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Неактивен', password: 'right' }],
  };
  const routes = createAuthRoutes(state, {
    requireAuth: (req, _res, next) => {
      req.user = { userId: 'U-1' };
      next();
    },
    destroySession: token => destroyedTokens.push(token),
  });
  const me = routes['GET /api/auth/me'][1];
  const res = createMockResponse();

  me({ headers: { authorization: 'Bearer session-token' }, user: { userId: 'U-1' } }, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { ok: false, error: 'Аккаунт отключён или удалён' });
  assert.deepEqual(destroyedTokens, ['session-token']);
});

test('/api/auth/profile preserves existing profile photo when only name changes', () => {
  const state = {
    users: [{
      id: 'U-1',
      name: 'Руслан',
      email: 'manager@example.test',
      role: 'Менеджер по аренде',
      status: 'Активен',
      password: 'right',
      profilePhoto: 'https://cdn.example.test/photo.jpg',
    }],
  };
  const routes = createAuthRoutes(state, {
    requireAuth: (req, _res, next) => {
      req.user = { userId: 'U-1' };
      next();
    },
  });
  const updateProfile = routes['PATCH /api/auth/profile'][1];
  const res = createMockResponse();

  updateProfile({
    body: { name: 'Руслан Обновлённый' },
    user: { userId: 'U-1' },
    headers: {},
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(state.users[0].name, 'Руслан Обновлённый');
  assert.equal(state.users[0].profilePhoto, 'https://cdn.example.test/photo.jpg');
  assert.equal(res.payload.user.profilePhoto, 'https://cdn.example.test/photo.jpg');
});

test('/api/auth/profile clears profile photo only when explicitly requested', () => {
  const state = {
    users: [{
      id: 'U-1',
      name: 'Руслан',
      email: 'manager@example.test',
      role: 'Менеджер по аренде',
      status: 'Активен',
      password: 'right',
      profilePhoto: 'https://cdn.example.test/photo.jpg',
    }],
  };
  const routes = createAuthRoutes(state, {
    requireAuth: (req, _res, next) => {
      req.user = { userId: 'U-1' };
      next();
    },
  });
  const updateProfile = routes['PATCH /api/auth/profile'][1];
  const res = createMockResponse();

  updateProfile({
    body: { name: 'Руслан', profilePhoto: '' },
    user: { userId: 'U-1' },
    headers: {},
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(state.users[0].profilePhoto, undefined);
  assert.equal(res.payload.user.profilePhoto, undefined);
});
