const crypto = require('node:crypto');
const { deriveCanonicalMembershipId } = require('./canonical-authority-id');
const { normalizeRole } = require('./role-groups');

const PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID = 'production-smoke-admin';
const PRODUCTION_SMOKE_READER_PRINCIPAL_ID = 'production-smoke-reader-v1';
const PRODUCTION_SMOKE_READER_EMAIL = 'production-smoke-reader@skytech.internal';
const PRODUCTION_SMOKE_READER_ROLE = 'Технический аудитор';
const PRODUCTION_SMOKE_READER_TEMPLATE_KEY = 'production-smoke-reader';
const PRODUCTION_SMOKE_REPLACEMENT_REASON = 'PRODUCTION_SMOKE_LEAST_PRIVILEGE_REPLACEMENT';

const TRANSITION_KEYS = new Set([
  'transitionVersion',
  'status',
  'sourcePrincipalId',
  'expectedSourceRole',
  'replacement',
  'membership',
]);
const REPLACEMENT_KEYS = new Set(['id', 'name', 'email', 'role']);
const MEMBERSHIP_KEYS = new Set([
  'id',
  'companyId',
  'branchId',
  'roleTemplateKey',
  'roleTemplateVersion',
]);
const FORBIDDEN_CONFIG_KEY = /(password|passwd|secret|token|credential|cookie|session|api.?key)/i;
const HASHED_PASSWORD_PATTERN = /^(?:h1:[a-f0-9]{64}|h2:scrypt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+)$/;
const PROJECTED_USERS = new WeakMap();

class ProductionSmokeIdentityError extends Error {
  constructor(code, message, blockers = []) {
    super(message);
    this.name = 'ProductionSmokeIdentityError';
    this.code = code;
    this.blockers = blockers;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pushBlocker(blockers, code, details = {}) {
  blockers.push({ code, ...details });
}

function unknownKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).filter(key => !allowed.has(key));
}

function findForbiddenConfigPath(value, path = 'smokeIdentityTransition') {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const found = findForbiddenConfigPath(child, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_CONFIG_KEY.test(key)) return `${path}.${key}`;
    const found = findForbiddenConfigPath(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function normalizedEmail(value) {
  return normalizedText(value).toLowerCase();
}

function isHashedPassword(value) {
  return typeof value === 'string' && HASHED_PASSWORD_PATTERN.test(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeUserDirectoryFingerprint(users) {
  const records = users.map(user => ({
    id: normalizedText(user?.id) || null,
    status: normalizedText(user?.status) || null,
    role: normalizeRole(user?.role) || null,
    botOnly: user?.botOnly === true,
    allowFrontendLogin: user?.allowFrontendLogin === true,
    frontendAccess: user?.frontendAccess === true,
    tokenVersion: Number.isSafeInteger(Number(user?.tokenVersion))
      ? Number(user.tokenVersion)
      : null,
    replacementForPrincipalId: normalizedText(user?.replacementForPrincipalId) || null,
    replacedByPrincipalId: normalizedText(user?.replacedByPrincipalId) || null,
  })).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  return sha256(stableJson(records));
}

function validateConfig(config, blockers) {
  const forbiddenPath = findForbiddenConfigPath(config);
  if (forbiddenPath) pushBlocker(blockers, 'SMOKE_TRANSITION_SECRET_FIELD_FORBIDDEN', { path: forbiddenPath });
  for (const key of unknownKeys(config, TRANSITION_KEYS)) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_UNKNOWN_FIELD', { path: `smokeIdentityTransition.${key}` });
  }
  for (const key of unknownKeys(config?.replacement, REPLACEMENT_KEYS)) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_UNKNOWN_FIELD', { path: `smokeIdentityTransition.replacement.${key}` });
  }
  for (const key of unknownKeys(config?.membership, MEMBERSHIP_KEYS)) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_UNKNOWN_FIELD', { path: `smokeIdentityTransition.membership.${key}` });
  }

  if (config?.transitionVersion !== 1 || config?.status !== 'APPROVED') {
    pushBlocker(blockers, 'SMOKE_TRANSITION_NOT_APPROVED');
  }
  if (normalizedText(config?.sourcePrincipalId) !== PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_SOURCE_INVALID');
  }
  if (normalizeRole(config?.expectedSourceRole) !== 'Администратор') {
    pushBlocker(blockers, 'SMOKE_TRANSITION_SOURCE_ROLE_INVALID');
  }
  if (normalizedText(config?.replacement?.id) !== PRODUCTION_SMOKE_READER_PRINCIPAL_ID) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_REPLACEMENT_ID_INVALID');
  }
  if (normalizeRole(config?.replacement?.role) !== PRODUCTION_SMOKE_READER_ROLE) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_REPLACEMENT_ROLE_INVALID');
  }
  if (!normalizedText(config?.replacement?.name)) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_REPLACEMENT_NAME_REQUIRED');
  }
  const email = normalizedEmail(config?.replacement?.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_REPLACEMENT_EMAIL_INVALID');
  } else if (email !== PRODUCTION_SMOKE_READER_EMAIL) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_REPLACEMENT_EMAIL_UNAPPROVED');
  }

  const companyId = normalizedText(config?.membership?.companyId);
  const branchId = normalizedText(config?.membership?.branchId);
  let expectedMembershipId = null;
  try {
    expectedMembershipId = deriveCanonicalMembershipId({
      companyId,
      principalId: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
    }).membershipId;
  } catch {
    pushBlocker(blockers, 'SMOKE_TRANSITION_MEMBERSHIP_SCOPE_INVALID');
  }
  if (!branchId) pushBlocker(blockers, 'SMOKE_TRANSITION_BRANCH_REQUIRED');
  if (expectedMembershipId && normalizedText(config?.membership?.id) !== expectedMembershipId) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_MEMBERSHIP_ID_INVALID');
  }
  if (normalizedText(config?.membership?.roleTemplateKey) !== PRODUCTION_SMOKE_READER_TEMPLATE_KEY) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_TEMPLATE_KEY_INVALID');
  }
  if (config?.membership?.roleTemplateVersion !== 1) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_TEMPLATE_VERSION_INVALID');
  }
}

function matchesAppliedSource(source, replacementId) {
  return source?.status === 'Неактивен'
    && source?.allowFrontendLogin === false
    && source?.frontendAccess === false
    && normalizedText(source?.replacedByPrincipalId) === replacementId
    && source?.replacementReason === PRODUCTION_SMOKE_REPLACEMENT_REASON
    && Number.isSafeInteger(Number(source?.tokenVersion))
    && Number(source.tokenVersion) >= 1;
}

function matchesAppliedReplacement(replacement, source, config) {
  return replacement?.id === PRODUCTION_SMOKE_READER_PRINCIPAL_ID
    && replacement?.name === normalizedText(config?.replacement?.name)
    && normalizedEmail(replacement?.email) === normalizedEmail(config?.replacement?.email)
    && normalizeRole(replacement?.role) === PRODUCTION_SMOKE_READER_ROLE
    && replacement?.status === 'Активен'
    && replacement?.botOnly === false
    && replacement?.allowFrontendLogin === true
    && replacement?.frontendAccess === true
    && Number(replacement?.tokenVersion) === 0
    && normalizedText(replacement?.replacementForPrincipalId) === source?.id
    && replacement?.replacementReason === PRODUCTION_SMOKE_REPLACEMENT_REASON
    && replacement?.password === source?.password;
}

function deduplicateBlockers(blockers) {
  const seen = new Set();
  return blockers.filter(blocker => {
    const key = stableJson(blocker);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildProjectedUsers(users, sourceIndex, config) {
  const next = cloneJson(users);
  const source = next[sourceIndex];
  const replacement = {
    id: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
    name: normalizedText(config.replacement.name),
    email: normalizedEmail(config.replacement.email),
    role: PRODUCTION_SMOKE_READER_ROLE,
    status: 'Активен',
    password: source.password,
    tokenVersion: 0,
    botOnly: false,
    allowFrontendLogin: true,
    frontendAccess: true,
    replacementForPrincipalId: source.id,
    replacementReason: PRODUCTION_SMOKE_REPLACEMENT_REASON,
  };
  next[sourceIndex] = {
    ...source,
    status: 'Неактивен',
    tokenVersion: Number(source.tokenVersion || 0) + 1,
    allowFrontendLogin: false,
    frontendAccess: false,
    replacedByPrincipalId: replacement.id,
    replacementReason: PRODUCTION_SMOKE_REPLACEMENT_REASON,
  };
  next.push(replacement);
  return next;
}

function planProductionSmokeIdentityTransition({ users, config, usersRawFingerprint = '' } = {}) {
  const blockers = [];
  validateConfig(config || {}, blockers);
  if (!Array.isArray(users)) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_USERS_INVALID');
  }
  const directory = Array.isArray(users) ? users : [];
  const sourceMatches = directory.filter(user => normalizedText(user?.id) === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID);
  const replacementMatches = directory.filter(user => normalizedText(user?.id) === PRODUCTION_SMOKE_READER_PRINCIPAL_ID);
  if (sourceMatches.length !== 1) {
    pushBlocker(blockers, sourceMatches.length === 0
      ? 'SMOKE_TRANSITION_SOURCE_MISSING'
      : 'SMOKE_TRANSITION_SOURCE_DUPLICATE');
  }
  if (replacementMatches.length > 1) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_REPLACEMENT_DUPLICATE');
  }

  const source = sourceMatches[0];
  const replacement = replacementMatches[0];
  const alreadyApplied = Boolean(
    source
    && replacement
    && matchesAppliedSource(source, replacement.id)
    && matchesAppliedReplacement(replacement, source, config || {}),
  );

  if (source && !isHashedPassword(source.password)) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_SOURCE_HASH_REQUIRED');
  }
  if (source && Object.prototype.hasOwnProperty.call(source, 'passwordHash')) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_AMBIGUOUS_CREDENTIAL_FIELDS');
  }
  if (source && !alreadyApplied) {
    if (source.status !== 'Активен') pushBlocker(blockers, 'SMOKE_TRANSITION_SOURCE_NOT_ACTIVE');
    if (normalizeRole(source.role) !== normalizeRole(config?.expectedSourceRole)) {
      pushBlocker(blockers, 'SMOKE_TRANSITION_SOURCE_ROLE_MISMATCH');
    }
    if (!Number.isSafeInteger(Number(source.tokenVersion || 0)) || Number(source.tokenVersion || 0) < 0) {
      pushBlocker(blockers, 'SMOKE_TRANSITION_SOURCE_TOKEN_VERSION_INVALID');
    }
  }
  if (replacement && !alreadyApplied) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_REPLACEMENT_CONFLICT');
  }
  const replacementEmail = normalizedEmail(config?.replacement?.email);
  const emailConflicts = directory.filter(user => (
    normalizedText(user?.id) !== PRODUCTION_SMOKE_READER_PRINCIPAL_ID
    && normalizedEmail(user?.email) === replacementEmail
  ));
  if (replacementEmail && emailConflicts.length > 0) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_REPLACEMENT_EMAIL_CONFLICT');
  }

  const uniqueBlockers = deduplicateBlockers(blockers);
  const canProject = uniqueBlockers.length === 0 && source && (alreadyApplied || !replacement);
  const projectedUsers = canProject
    ? (alreadyApplied
      ? cloneJson(directory)
      : buildProjectedUsers(directory, directory.indexOf(source), config))
    : cloneJson(directory);
  const transitionChecksum = sha256(stableJson({
    config: config || null,
    usersRawFingerprint: normalizedText(usersRawFingerprint) || null,
    safeDirectoryFingerprint: safeUserDirectoryFingerprint(directory),
  }));
  const result = Object.freeze({
    ok: uniqueBlockers.length === 0,
    readyToApply: uniqueBlockers.length === 0,
    status: uniqueBlockers.length > 0 ? 'blocked' : (alreadyApplied ? 'already_applied' : 'pending'),
    alreadyApplied,
    transitionChecksum,
    blockers: Object.freeze(uniqueBlockers),
    projectedUsersDirectoryFingerprint: safeUserDirectoryFingerprint(projectedUsers),
    plannedDiff: Object.freeze({
      CREATE: alreadyApplied || uniqueBlockers.length > 0 ? [] : [Object.freeze({
        type: 'User',
        id: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
        role: PRODUCTION_SMOKE_READER_ROLE,
        status: 'Активен',
        credentialHashCloned: true,
      })],
      UPDATE: alreadyApplied || uniqueBlockers.length > 0 ? [] : [Object.freeze({
        type: 'User',
        id: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
        status: 'Неактивен',
        frontendAccessRevoked: true,
        sessionsRevokedByTokenVersion: true,
      })],
    }),
  });
  PROJECTED_USERS.set(result, projectedUsers);
  return result;
}

function getProjectedSmokeIdentityUsers(plan) {
  const projected = PROJECTED_USERS.get(plan);
  if (!projected) {
    throw new ProductionSmokeIdentityError(
      'SMOKE_TRANSITION_PLAN_INVALID',
      'Smoke identity transition plan was not produced by the trusted planner.',
    );
  }
  return cloneJson(projected);
}

function validateProductionSmokeBootstrapBinding({ config, identityBootstrap } = {}) {
  const blockers = [];
  validateConfig(config || {}, blockers);
  const templates = Array.isArray(identityBootstrap?.roleTemplates)
    ? identityBootstrap.roleTemplates
    : [];
  const memberships = Array.isArray(identityBootstrap?.memberships)
    ? identityBootstrap.memberships
    : [];
  const templateMatches = templates.filter(template => (
    normalizedText(template?.templateKey) === PRODUCTION_SMOKE_READER_TEMPLATE_KEY
    && template?.templateVersion === 1
  ));
  if (templateMatches.length !== 1) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_TEMPLATE_BINDING_INVALID');
  } else if (!Array.isArray(templateMatches[0].capabilities) || templateMatches[0].capabilities.length !== 0) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_TEMPLATE_MUST_HAVE_NO_CAPABILITIES');
  }

  const membershipMatches = memberships.filter(membership => (
    normalizedText(membership?.principalId) === PRODUCTION_SMOKE_READER_PRINCIPAL_ID
  ));
  if (membershipMatches.length !== 1) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_MEMBERSHIP_BINDING_INVALID');
  } else {
    const membership = membershipMatches[0];
    const expected = config?.membership || {};
    const exactBranchIds = Array.isArray(membership.branchIds)
      && membership.branchIds.length === 1
      && membership.branchIds[0] === normalizedText(expected.branchId);
    if (
      normalizedText(membership.id) !== normalizedText(expected.id)
      || membership.status !== 'active'
      || normalizedText(membership.roleTemplateKey) !== PRODUCTION_SMOKE_READER_TEMPLATE_KEY
      || membership.roleTemplateVersion !== 1
      || membership.companyWideBranchAuthority !== false
      || !exactBranchIds
      || !Array.isArray(membership.capabilityAssignments)
      || membership.capabilityAssignments.length !== 0
    ) {
      pushBlocker(blockers, 'SMOKE_TRANSITION_MEMBERSHIP_SCOPE_INVALID');
    }
  }
  if (memberships.some(membership => (
    normalizedText(membership?.principalId) === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID
  ))) {
    pushBlocker(blockers, 'SMOKE_TRANSITION_SOURCE_MEMBERSHIP_FORBIDDEN');
  }
  return Object.freeze({
    ok: blockers.length === 0,
    blockers: Object.freeze(deduplicateBlockers(blockers)),
  });
}

function applyProductionSmokeIdentityTransition({
  db,
  config,
  expectedTransitionChecksum,
  mutationTimestamp,
} = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new ProductionSmokeIdentityError('SMOKE_TRANSITION_DATABASE_REQUIRED', 'A SQLite database is required.');
  }
  if (!normalizedText(mutationTimestamp)) {
    throw new ProductionSmokeIdentityError('SMOKE_TRANSITION_TIMESTAMP_REQUIRED', 'A deterministic mutation timestamp is required.');
  }
  const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get('users');
  if (!row || typeof row.json !== 'string') {
    throw new ProductionSmokeIdentityError('SMOKE_TRANSITION_USERS_MISSING', 'The users collection is missing.');
  }
  let users;
  try {
    users = JSON.parse(row.json);
  } catch {
    throw new ProductionSmokeIdentityError('SMOKE_TRANSITION_USERS_JSON_INVALID', 'The users collection is invalid.');
  }
  const preview = planProductionSmokeIdentityTransition({
    users,
    config,
    usersRawFingerprint: sha256(row.json),
  });
  if (!preview.readyToApply) {
    throw new ProductionSmokeIdentityError(
      'SMOKE_TRANSITION_BLOCKED',
      'Production smoke identity transition has blockers.',
      preview.blockers,
    );
  }
  if (preview.transitionChecksum !== expectedTransitionChecksum) {
    throw new ProductionSmokeIdentityError(
      'SMOKE_TRANSITION_CHECKSUM_MISMATCH',
      'Production smoke identity transition checksum changed.',
    );
  }
  if (preview.alreadyApplied) {
    return Object.freeze({ status: 'noop', writes: 0 });
  }
  const projectedUsers = getProjectedSmokeIdentityUsers(preview);
  const result = db.prepare(`
    UPDATE app_data
    SET json = ?, updated_at = ?
    WHERE name = ? AND json = ?
  `).run(JSON.stringify(projectedUsers), mutationTimestamp, 'users', row.json);
  if (result.changes !== 1) {
    throw new ProductionSmokeIdentityError(
      'SMOKE_TRANSITION_COMPARE_AND_SWAP_FAILED',
      'The users collection changed during smoke identity transition.',
    );
  }
  return Object.freeze({ status: 'succeeded', writes: 1 });
}

module.exports = {
  PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
  PRODUCTION_SMOKE_READER_EMAIL,
  PRODUCTION_SMOKE_READER_ROLE,
  PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
  PRODUCTION_SMOKE_REPLACEMENT_REASON,
  PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
  ProductionSmokeIdentityError,
  applyProductionSmokeIdentityTransition,
  getProjectedSmokeIdentityUsers,
  planProductionSmokeIdentityTransition,
  validateProductionSmokeBootstrapBinding,
};
