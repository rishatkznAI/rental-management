function text(value) {
  return String(value ?? '').trim();
}

function transitionError(code, message, status = 500) {
  return Object.assign(new Error(message), { code, status });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableJson(value) {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const USER_AUTHORITY_SOURCE_FIELDS = Object.freeze([
  'status',
  'email',
  'role',
  'password',
  'passwordHash',
  'ownerId',
  'carrierId',
  'maxUserId',
  'botOnly',
  'allowFrontendLogin',
  'frontendAccess',
]);

const USER_AUTHORITY_FIELDS = Object.freeze([
  ...USER_AUTHORITY_SOURCE_FIELDS,
  'tokenVersion',
  'passwordChangedAt',
]);

function assertUserDirectory(value, code = 'USER_AUTHORITY_DIRECTORY_INVALID') {
  if (!Array.isArray(value)) {
    throw transitionError(code, 'User authority directory must be an array.', 409);
  }
  const byId = new Map();
  for (const user of value) {
    const id = text(user?.id);
    if (!isPlainRecord(user) || !id || byId.has(id)) {
      throw transitionError(
        code,
        'User authority directory must contain object records with unique stable IDs.',
        409,
      );
    }
    byId.set(id, user);
  }
  return Object.freeze({ list: value, byId });
}

function hasUserAuthorityChange(previousUser, nextUser, fields = USER_AUTHORITY_FIELDS) {
  if (!previousUser || !nextUser) return previousUser !== nextUser;
  return fields.some(field => stableJson(previousUser[field]) !== stableJson(nextUser[field]));
}

function deriveUserAuthorityAffectedIds(previousUsers, nextUsers) {
  const previous = assertUserDirectory(previousUsers);
  const next = assertUserDirectory(nextUsers);
  const affected = [];
  for (const [id, previousUser] of previous.byId) {
    const nextUser = next.byId.get(id);
    if (!nextUser || hasUserAuthorityChange(previousUser, nextUser)) affected.push(id);
  }
  for (const id of next.byId.keys()) {
    if (!previous.byId.has(id)) affected.push(id);
  }
  return affected;
}

function assertAuthorityRevocationMarkers(previousUsers, nextUsers) {
  const previous = assertUserDirectory(previousUsers);
  const next = assertUserDirectory(nextUsers);
  for (const [id, previousUser] of previous.byId) {
    const nextUser = next.byId.get(id);
    if (!nextUser || !hasUserAuthorityChange(previousUser, nextUser, USER_AUTHORITY_SOURCE_FIELDS)) continue;
    const previousVersion = Number(previousUser.tokenVersion) || 0;
    const nextVersion = Number(nextUser.tokenVersion) || 0;
    if (nextVersion <= previousVersion) {
      throw transitionError(
        'USER_AUTHORITY_REVOCATION_MARKER_REQUIRED',
        'Authority changes must advance the user session revocation marker.',
        409,
      );
    }
  }
}

function assertObjectRecordMap(value, code, message) {
  if (!isPlainRecord(value) || Object.entries(value).some(([key, record]) => !text(key) || !isPlainRecord(record))) {
    throw transitionError(code, message, 409);
  }
  return value;
}

function createUserAuthorityTransitionService({
  db,
  readUsers,
  readBotUsers,
  readBotSessions,
  persistTenantEntries,
  persistBotSessions,
  deleteSessionsForUserIds,
} = {}) {
  if (!db || typeof db.transaction !== 'function') {
    throw transitionError('USER_AUTHORITY_DATABASE_REQUIRED', 'User authority transitions require SQLite.');
  }
  for (const [name, dependency] of Object.entries({
    readUsers,
    readBotUsers,
    readBotSessions,
    persistTenantEntries,
    persistBotSessions,
    deleteSessionsForUserIds,
  })) {
    if (typeof dependency !== 'function') {
      throw transitionError(
        'USER_AUTHORITY_TRANSITION_DEPENDENCY_REQUIRED',
        `User authority transition dependency is required: ${name}.`,
      );
    }
  }

  const persistImmediate = db.transaction(({ entries, expectedUsers }) => {
    if (!Array.isArray(entries)) {
      throw transitionError(
        'USER_AUTHORITY_TRANSITION_ENTRY_INVALID',
        'User authority transition entries must be an array.',
        409,
      );
    }
    const names = new Set();
    for (const entry of entries) {
      const name = text(entry?.name);
      if (!name || names.has(name)) {
        throw transitionError(
          'USER_AUTHORITY_TRANSITION_ENTRY_INVALID',
          'User authority transition collections must be unique and named.',
          409,
        );
      }
      names.add(name);
    }
    if (!names.has('users')) {
      throw transitionError(
        'USER_AUTHORITY_USERS_ENTRY_REQUIRED',
        'User authority transition must contain the users collection.',
        409,
      );
    }
    if (names.has('bot_users') || names.has('bot_sessions')) {
      throw transitionError(
        'USER_AUTHORITY_BOT_STATE_OWNED',
        'Bot connection state is derived by the authority transition service.',
        409,
      );
    }
    if (!names.has('audit_logs')) {
      throw transitionError(
        'USER_AUTHORITY_AUDIT_ENTRY_REQUIRED',
        'User authority transition must contain the tenant security audit collection.',
        409,
      );
    }
    if ([...names].some(name => name !== 'users' && name !== 'audit_logs')) {
      throw transitionError(
        'USER_AUTHORITY_TRANSITION_COLLECTION_INVALID',
        'User authority transition may only persist users and tenant security audit state.',
        409,
      );
    }

    const usersEntry = entries.find(entry => text(entry?.name) === 'users');
    const expectedDirectory = assertUserDirectory(
      expectedUsers,
      'USER_AUTHORITY_EXPECTED_DIRECTORY_INVALID',
    );
    const currentDirectory = assertUserDirectory(
      readUsers(),
      'USER_AUTHORITY_STORED_DIRECTORY_INVALID',
    );
    const nextDirectory = assertUserDirectory(
      usersEntry.value,
      'USER_AUTHORITY_NEXT_DIRECTORY_INVALID',
    );
    if (stableJson(currentDirectory.list) !== stableJson(expectedDirectory.list)) {
      throw transitionError(
        'USER_AUTHORITY_PRECONDITION_CHANGED',
        'The user directory changed concurrently; retry the operation.',
        409,
      );
    }
    assertAuthorityRevocationMarkers(currentDirectory.list, nextDirectory.list);
    const ids = new Set(deriveUserAuthorityAffectedIds(currentDirectory.list, nextDirectory.list));

    const botUsers = assertObjectRecordMap(
      readBotUsers(),
      'BOT_USERS_SHAPE_INVALID',
      'MAX user mapping is malformed.',
    );
    const botSessions = assertObjectRecordMap(
      readBotSessions(),
      'BOT_SESSIONS_SHAPE_INVALID',
      'MAX scenario state is malformed.',
    );
    const affectedPhones = Object.entries(botUsers)
      .filter(([, user]) => ids.has(text(user?.userId || user?.id)))
      .map(([phone]) => phone);
    const nextTenantEntries = entries.map(entry => ({
      name: text(entry.name),
      value: structuredClone(entry.value),
    }));
    let nextBotSessions = null;
    if (affectedPhones.length > 0) {
      const nextBotUsers = structuredClone(botUsers);
      for (const phone of affectedPhones) delete nextBotUsers[phone];
      nextTenantEntries.push({ name: 'bot_users', value: nextBotUsers });

      nextBotSessions = structuredClone(botSessions);
      for (const phone of affectedPhones) delete nextBotSessions[phone];
    }

    persistTenantEntries(nextTenantEntries);
    if (nextBotSessions) persistBotSessions(nextBotSessions);
    const revokedSessions = Number(deleteSessionsForUserIds([...ids])) || 0;
    return Object.freeze({
      affectedUserCount: ids.size,
      disconnectedBotCount: affectedPhones.length,
      revokedSessions,
    });
  });

  function persist({ entries, expectedUsers } = {}) {
    return persistImmediate.immediate({ entries, expectedUsers });
  }

  return Object.freeze({ persist });
}

module.exports = {
  createUserAuthorityTransitionService,
  deriveUserAuthorityAffectedIds,
  hasUserAuthorityChange,
};
