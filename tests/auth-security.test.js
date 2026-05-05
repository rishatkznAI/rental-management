import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { registerAuthRoutes } = require('../server/routes/auth.js');

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
    needsPasswordRehash: () => false,
    createSession: () => 'session-token',
    requireAuth: overrides.requireAuth || ((_req, _res, next) => next()),
    destroySession: overrides.destroySession || (() => {}),
    deleteSessionsForUserIds: overrides.deleteSessionsForUserIds || (() => 0),
    auditLog: () => {},
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

test('duplicate email local part blocks login', async () => {
  process.env.LOGIN_FAILURE_DELAY_MS = '0';
  const state = {
    users: [
      { id: 'U-1', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'right' },
      { id: 'U-2', name: 'Мария', email: 'MANAGER@other.test', role: 'Менеджер по аренде', status: 'Активен', password: 'right' },
    ],
  };
  const login = createAuthRoutes(state)['POST /api/auth/login'][0];

  const res = await runLogin(login, { login: 'manager', password: 'right' });

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.payload, {
    ok: false,
    error: 'Найдено несколько пользователей с таким логином. Обратитесь к администратору',
  });
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
