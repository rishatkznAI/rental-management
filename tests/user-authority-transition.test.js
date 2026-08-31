import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  createUserAuthorityTransitionService,
  deriveUserAuthorityAffectedIds,
} = require('../server/lib/user-authority-transition.js');

function createHarness({ failAt = '' } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE state (name TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE app_sessions (token TEXT PRIMARY KEY, json TEXT NOT NULL);
  `);
  const seed = {
    users: [
      { id: 'U-1', role: 'Менеджер по аренде', status: 'Активен', tokenVersion: 0 },
      { id: 'U-2', role: 'Офис-менеджер', status: 'Активен', tokenVersion: 0 },
    ],
    audit_logs: [{ id: 'AUD-before', action: 'seed' }],
    bot_users: {
      '+70000000001': { userId: 'U-1', role: 'Менеджер по аренде' },
      '+70000000002': { userId: 'U-2', role: 'Офис-менеджер' },
    },
    bot_sessions: {
      '+70000000001': { scenario: 'old-authority-flow' },
      '+70000000002': { scenario: 'unrelated-flow' },
    },
  };
  const put = db.prepare(`
    INSERT INTO state(name, json) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET json = excluded.json
  `);
  for (const [name, value] of Object.entries(seed)) put.run(name, JSON.stringify(value));
  db.prepare('INSERT INTO app_sessions(token, json) VALUES (?, ?)')
    .run('session-u1', JSON.stringify({ userId: 'U-1' }));
  db.prepare('INSERT INTO app_sessions(token, json) VALUES (?, ?)')
    .run('session-u2', JSON.stringify({ userId: 'U-2' }));

  const read = name => JSON.parse(db.prepare('SELECT json FROM state WHERE name = ?').get(name).json);
  const write = (name, value) => put.run(name, JSON.stringify(value));
  const snapshot = () => ({
    state: db.prepare('SELECT name, json FROM state ORDER BY name').all(),
    sessions: db.prepare('SELECT token, json FROM app_sessions ORDER BY token').all(),
  });
  const injected = stage => Object.assign(new Error(`injected ${stage} failure`), {
    code: `INJECTED_${stage.toUpperCase()}_FAILURE`,
  });

  const service = createUserAuthorityTransitionService({
    db,
    readUsers: () => read('users'),
    readBotUsers: () => read('bot_users'),
    readBotSessions: () => read('bot_sessions'),
    persistTenantEntries(entries) {
      db.transaction(rows => {
        for (const entry of rows) write(entry.name, entry.value);
        if (failAt === 'tenant') throw injected('tenant');
      }).immediate(entries);
    },
    persistBotSessions(value) {
      db.transaction(nextValue => {
        write('bot_sessions', nextValue);
        if (failAt === 'bot') throw injected('bot');
      }).immediate(value);
    },
    deleteSessionsForUserIds(ids) {
      return db.transaction(userIds => {
        const wanted = new Set(userIds);
        let deleted = 0;
        for (const row of db.prepare('SELECT token, json FROM app_sessions').all()) {
          if (!wanted.has(JSON.parse(row.json).userId)) continue;
          deleted += db.prepare('DELETE FROM app_sessions WHERE token = ?').run(row.token).changes;
        }
        if (failAt === 'auth') throw injected('auth');
        return deleted;
      }).immediate(ids);
    },
  });

  const input = {
    entries: [
      {
        name: 'users',
        value: [
          { id: 'U-1', role: 'Инвестор', status: 'Активен', tokenVersion: 1 },
          seed.users[1],
        ],
      },
      {
        name: 'audit_logs',
        value: [...seed.audit_logs, { id: 'AUD-change', action: 'users.update' }],
      },
    ],
    expectedUsers: structuredClone(seed.users),
  };

  return { db, input, read, service, snapshot };
}

for (const stage of ['tenant', 'bot', 'auth']) {
  test(`user authority transition rolls every store back after ${stage} failure`, () => {
    const harness = createHarness({ failAt: stage });
    const before = harness.snapshot();

    assert.throws(
      () => harness.service.persist(harness.input),
      error => error.code === `INJECTED_${stage.toUpperCase()}_FAILURE`,
    );
    assert.deepEqual(harness.snapshot(), before);
    harness.db.close();
  });
}

test('user authority transition commits user, audit, auth revocation, and exact MAX reset together', () => {
  const harness = createHarness();

  const result = harness.service.persist(harness.input);

  assert.deepEqual(result, {
    affectedUserCount: 1,
    disconnectedBotCount: 1,
    revokedSessions: 1,
  });
  assert.equal(harness.read('users')[0].role, 'Инвестор');
  assert.equal(harness.read('audit_logs').at(-1).action, 'users.update');
  assert.equal(harness.read('bot_users')['+70000000001'], undefined);
  assert.equal(harness.read('bot_sessions')['+70000000001'], undefined);
  assert.equal(harness.read('bot_users')['+70000000002'].userId, 'U-2');
  assert.equal(harness.read('bot_sessions')['+70000000002'].scenario, 'unrelated-flow');
  assert.deepEqual(
    harness.db.prepare('SELECT token FROM app_sessions ORDER BY token').all(),
    [{ token: 'session-u2' }],
  );
  harness.db.close();
});

test('user authority transition rejects malformed or caller-owned batch state before writes', () => {
  const harness = createHarness();
  const before = harness.snapshot();

  for (const input of [
    {},
    { entries: [{ name: 'audit_logs', value: [] }] },
    { entries: [{ name: 'users', value: [] }, { name: 'users', value: [] }] },
    { entries: [{ name: 'users', value: [] }] },
    { entries: [{ name: 'users', value: [] }, { name: 'audit_logs', value: [] }, { name: 'clients', value: [] }] },
    { entries: [{ name: 'users', value: [] }, { name: 'bot_users', value: {} }] },
    { entries: [{ name: 'users', value: [] }, { name: 'bot_sessions', value: {} }] },
  ]) {
    assert.throws(() => harness.service.persist(input));
    assert.deepEqual(harness.snapshot(), before);
  }
  harness.db.close();
});

test('user authority transition refuses malformed stored MAX maps without overwriting them', () => {
  const harness = createHarness();
  harness.db.prepare('UPDATE state SET json = ? WHERE name = ?').run('[]', 'bot_users');
  const before = harness.snapshot();

  assert.throws(
    () => harness.service.persist(harness.input),
    error => error.code === 'BOT_USERS_SHAPE_INVALID',
  );
  assert.deepEqual(harness.snapshot(), before);
  harness.db.close();
});

test('user authority transition refuses malformed stored MAX scenario state without partial writes', () => {
  const harness = createHarness();
  harness.db.prepare('UPDATE state SET json = ? WHERE name = ?').run('[]', 'bot_sessions');
  const before = harness.snapshot();

  assert.throws(
    () => harness.service.persist(harness.input),
    error => error.code === 'BOT_SESSIONS_SHAPE_INVALID',
  );
  assert.deepEqual(harness.snapshot(), before);
  harness.db.close();
});

test('user authority transition validates MAX scenario state even when no affected user has a MAX mapping', () => {
  const harness = createHarness();
  harness.db.prepare('UPDATE state SET json = ? WHERE name = ?')
    .run(JSON.stringify({ '+70000000002': { userId: 'U-2' } }), 'bot_users');
  harness.db.prepare('UPDATE state SET json = ? WHERE name = ?').run('[]', 'bot_sessions');
  const before = harness.snapshot();

  assert.throws(
    () => harness.service.persist(harness.input),
    error => error.code === 'BOT_SESSIONS_SHAPE_INVALID',
  );
  assert.deepEqual(harness.snapshot(), before);
  harness.db.close();
});

test('user authority transition rejects malformed records inside MAX maps', () => {
  for (const [collection, malformed, expectedCode] of [
    ['bot_users', { '+70000000001': [] }, 'BOT_USERS_SHAPE_INVALID'],
    ['bot_sessions', { '+70000000001': 'invalid' }, 'BOT_SESSIONS_SHAPE_INVALID'],
  ]) {
    const harness = createHarness();
    harness.db.prepare('UPDATE state SET json = ? WHERE name = ?')
      .run(JSON.stringify(malformed), collection);
    const before = harness.snapshot();
    assert.throws(
      () => harness.service.persist(harness.input),
      error => error.code === expectedCode,
    );
    assert.deepEqual(harness.snapshot(), before);
    harness.db.close();
  }
});

test('user authority transition rejects a stale expected directory under the immediate lock', () => {
  const harness = createHarness();
  const concurrentUsers = harness.read('users');
  concurrentUsers[0] = { ...concurrentUsers[0], name: 'Concurrent update' };
  harness.db.prepare('UPDATE state SET json = ? WHERE name = ?')
    .run(JSON.stringify(concurrentUsers), 'users');
  const beforeAttempt = harness.snapshot();

  assert.throws(
    () => harness.service.persist(harness.input),
    error => error.code === 'USER_AUTHORITY_PRECONDITION_CHANGED' && error.status === 409,
  );
  assert.deepEqual(harness.snapshot(), beforeAttempt);
  harness.db.close();
});

test('user authority transition centrally derives additions, removals, and all authority fields', () => {
  const authorityChanges = [
    ['status', 'Активен', 'Неактивен'],
    ['email', 'old@example.test', 'new@example.test'],
    ['role', 'Менеджер по аренде', 'Инвестор'],
    ['password', 'old-password', 'new-password'],
    ['passwordHash', 'old-hash', 'new-hash'],
    ['ownerId', 'OWNER-1', 'OWNER-2'],
    ['carrierId', 'CARRIER-1', 'CARRIER-2'],
    ['maxUserId', 'MAX-1', 'MAX-2'],
    ['botOnly', false, true],
    ['allowFrontendLogin', true, false],
    ['frontendAccess', true, false],
    ['tokenVersion', 1, 2],
    ['passwordChangedAt', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'],
  ];
  const previous = [
    ...authorityChanges.map(([field, before]) => ({ id: `U-${field}`, [field]: before })),
    { id: 'U-profile', name: 'Old name', phone: '+70000000001', profilePhoto: 'old.png', ownerName: 'Old owner' },
    { id: 'U-remove', role: 'Инвестор' },
  ];
  const next = [
    ...authorityChanges.map(([field, , after]) => ({ id: `U-${field}`, [field]: after })),
    { id: 'U-profile', name: 'New name', phone: '+70000000002', profilePhoto: 'new.png', ownerName: 'New owner' },
    { id: 'U-add', role: 'Офис-менеджер' },
  ];

  assert.deepEqual(
    deriveUserAuthorityAffectedIds(previous, next),
    [...authorityChanges.map(([field]) => `U-${field}`), 'U-remove', 'U-add'],
  );
  assert.throws(
    () => deriveUserAuthorityAffectedIds(previous, [...next, { id: 'U-add' }]),
    error => error.code === 'USER_AUTHORITY_DIRECTORY_INVALID',
  );
});

test('user authority transition requires an advanced marker for a retained authority record', () => {
  const harness = createHarness();
  const unsafe = structuredClone(harness.input);
  unsafe.entries.find(entry => entry.name === 'users').value[0].tokenVersion = 0;
  const before = harness.snapshot();

  assert.throws(
    () => harness.service.persist(unsafe),
    error => error.code === 'USER_AUTHORITY_REVOCATION_MARKER_REQUIRED',
  );
  assert.deepEqual(harness.snapshot(), before);
  harness.db.close();
});

test('user authority transition persists profile-only changes without revoking authority state', () => {
  const harness = createHarness();
  const input = structuredClone(harness.input);
  input.entries.find(entry => entry.name === 'users').value = harness.read('users').map(user => (
    user.id === 'U-1' ? { ...user, name: 'Updated display name' } : user
  ));

  const result = harness.service.persist(input);

  assert.deepEqual(result, {
    affectedUserCount: 0,
    disconnectedBotCount: 0,
    revokedSessions: 0,
  });
  assert.equal(harness.read('users')[0].name, 'Updated display name');
  assert.equal(harness.read('bot_users')['+70000000001'].userId, 'U-1');
  assert.equal(harness.read('bot_sessions')['+70000000001'].scenario, 'old-authority-flow');
  assert.deepEqual(
    harness.db.prepare('SELECT token FROM app_sessions ORDER BY token').all(),
    [{ token: 'session-u1' }, { token: 'session-u2' }],
  );
  harness.db.close();
});
