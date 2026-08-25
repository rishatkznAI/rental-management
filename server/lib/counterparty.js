const crypto = require('crypto');

const COUNTERPARTY_TYPES = Object.freeze([
  'legal_entity',
  'individual_entrepreneur',
  'individual',
]);
const COUNTERPARTY_ROLES = Object.freeze(['customer', 'supplier', 'contractor']);
const COUNTERPARTY_STATUSES = Object.freeze(['active', 'inactive']);
const COUNTERPARTY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const CLIENT_OPENING_AR_FIELDS = Object.freeze([
  'debt',
  'openingReceivableAmount',
  'openingReceivableAsOfDate',
  'openingReceivableRevision',
  'openingReceivableCreatedAt',
  'openingReceivableCreatedByUserId',
  'openingReceivableCreatedBy',
  'openingReceivableUpdatedAt',
  'openingReceivableUpdatedByUserId',
  'openingReceivableUpdatedBy',
]);

const CLIENT_IDENTITY_FIELDS = new Set([
  'name',
  'company',
  'companyName',
  'legalName',
  'fullName',
  'inn',
  'kpp',
  'ogrn',
  'ogrnip',
  'clientType',
  'type',
  'address',
  'legalAddress',
  'actualAddress',
  'email',
  'phone',
  'website',
]);

function counterpartyError(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizedText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е');
}

function displayText(value) {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ');
  return result || null;
}

function multilineText(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function normalizedDigits(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function normalizeIdentifier(value, field) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!/^[\d\s-]+$/.test(raw)) {
    throw counterpartyError(
      'COUNTERPARTY_VALIDATION_FAILED',
      `${field} должен содержать только цифры, пробелы или дефисы.`,
      400,
      { field },
    );
  }
  return normalizedDigits(raw);
}

function assertCounterpartyId(id) {
  const value = String(id ?? '').trim();
  if (!COUNTERPARTY_ID_PATTERN.test(value)) {
    throw counterpartyError(
      'COUNTERPARTY_VALIDATION_FAILED',
      'Некорректный идентификатор контрагента.',
      400,
      { field: 'id' },
    );
  }
  return value;
}

function normalizeRoles(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw counterpartyError(
      'COUNTERPARTY_VALIDATION_FAILED',
      'Укажите хотя бы одну роль контрагента.',
      400,
      { field: 'roles' },
    );
  }
  const roles = [...new Set(value.map(role => String(role ?? '').trim()).filter(Boolean))];
  const invalid = roles.filter(role => !COUNTERPARTY_ROLES.includes(role));
  if (invalid.length > 0) {
    throw counterpartyError(
      'COUNTERPARTY_ROLE_INVALID',
      `Недопустимая роль контрагента: ${invalid[0]}.`,
      400,
      { field: 'roles', invalidRoles: invalid, allowedRoles: [...COUNTERPARTY_ROLES] },
    );
  }
  return COUNTERPARTY_ROLES.filter(role => roles.includes(role));
}

function normalizeCounterpartyRole(value) {
  const role = String(value ?? '').trim();
  if (!COUNTERPARTY_ROLES.includes(role)) {
    throw counterpartyError(
      'COUNTERPARTY_ROLE_INVALID',
      `Недопустимая роль контрагента: ${role || 'не указана'}.`,
      400,
      { field: 'role', invalidRole: role || null, allowedRoles: [...COUNTERPARTY_ROLES] },
    );
  }
  return role;
}

function addCounterpartyRole(counterparty, value, nowIso = () => new Date().toISOString()) {
  const role = normalizeCounterpartyRole(value);
  const currentRoles = Array.isArray(counterparty?.roles) ? counterparty.roles : [];
  if (currentRoles.includes(role)) {
    return { counterparty, changed: false };
  }
  return {
    counterparty: {
      ...counterparty,
      roles: normalizeRoles([...currentRoles, role]),
      updatedAt: nowIso(),
    },
    changed: true,
  };
}

function removeCounterpartyRole(counterparty, value, {
  linkedClientIds = [],
  nowIso = () => new Date().toISOString(),
} = {}) {
  const role = normalizeCounterpartyRole(value);
  const currentRoles = Array.isArray(counterparty?.roles) ? counterparty.roles : [];
  if (!currentRoles.includes(role)) {
    return { counterparty, changed: false };
  }
  if (role === 'customer' && linkedClientIds.length > 0) {
    throw counterpartyError(
      'COUNTERPARTY_CLIENT_LINK_CONFLICT',
      'Нельзя удалить роль customer, пока существует связанный Client.',
      409,
      { counterpartyId: counterparty?.id, clientIds: [...linkedClientIds] },
    );
  }
  const roles = currentRoles.filter(item => item !== role);
  if (roles.length === 0) {
    throw counterpartyError(
      'COUNTERPARTY_ROLE_REQUIRED',
      'У контрагента должна остаться хотя бы одна роль.',
      409,
      { counterpartyId: counterparty?.id, role },
    );
  }
  return {
    counterparty: {
      ...counterparty,
      roles: normalizeRoles(roles),
      updatedAt: nowIso(),
    },
    changed: true,
  };
}

function validateIdentifiers(record) {
  const fail = (field, message) => {
    throw counterpartyError('COUNTERPARTY_VALIDATION_FAILED', message, 400, { field });
  };

  if (record.type === 'legal_entity') {
    if (!record.inn || record.inn.length !== 10) fail('inn', 'Для юридического лица ИНН должен содержать 10 цифр.');
    if (record.kpp && record.kpp.length !== 9) fail('kpp', 'КПП юридического лица должен содержать 9 цифр.');
    if (record.ogrn && record.ogrn.length !== 13) fail('ogrn', 'ОГРН должен содержать 13 цифр.');
    if (record.ogrnip) fail('ogrnip', 'ОГРНИП неприменим к юридическому лицу.');
    return;
  }

  if (record.type === 'individual_entrepreneur') {
    if (!record.inn || record.inn.length !== 12) fail('inn', 'Для ИП ИНН должен содержать 12 цифр.');
    if (record.kpp) fail('kpp', 'КПП неприменим к ИП.');
    if (record.ogrn) fail('ogrn', 'ОГРН юридического лица неприменим к ИП.');
    if (record.ogrnip && record.ogrnip.length !== 15) fail('ogrnip', 'ОГРНИП должен содержать 15 цифр.');
    return;
  }

  if (record.inn && record.inn.length !== 12) fail('inn', 'ИНН физического лица должен содержать 12 цифр.');
  if (record.kpp) fail('kpp', 'КПП неприменим к физическому лицу.');
  if (record.ogrn) fail('ogrn', 'ОГРН неприменим к физическому лицу.');
  if (record.ogrnip) fail('ogrnip', 'ОГРНИП неприменим к физическому лицу.');
}

function normalizeCounterpartyRecord(input, {
  id,
  existing = null,
  nowIso = () => new Date().toISOString(),
  allowArchived = false,
  createdAt,
} = {}) {
  const source = { ...(existing || {}), ...(input || {}) };
  const resolvedId = assertCounterpartyId(existing?.id || id || source.id);
  const type = String(source.type ?? '').trim();
  if (!COUNTERPARTY_TYPES.includes(type)) {
    throw counterpartyError(
      'COUNTERPARTY_VALIDATION_FAILED',
      `Недопустимый тип контрагента: ${type || 'не указан'}.`,
      400,
      { field: 'type', allowedTypes: [...COUNTERPARTY_TYPES] },
    );
  }

  const legalName = displayText(source.legalName);
  if (!legalName) {
    throw counterpartyError(
      'COUNTERPARTY_VALIDATION_FAILED',
      'Юридическое наименование обязательно.',
      400,
      { field: 'legalName' },
    );
  }

  const status = String(source.status || existing?.status || 'active').trim();
  const archived = Boolean(existing?.archivedAt || source.archivedAt || status === 'archived');
  if ((!COUNTERPARTY_STATUSES.includes(status) && status !== 'archived') || (status === 'archived' && !allowArchived && !existing?.archivedAt)) {
    throw counterpartyError(
      'COUNTERPARTY_VALIDATION_FAILED',
      `Недопустимый статус контрагента: ${status}.`,
      400,
      { field: 'status', allowedStatuses: [...COUNTERPARTY_STATUSES] },
    );
  }

  const timestamp = nowIso();
  const record = {
    id: resolvedId,
    ...(source.companyId ? { companyId: String(source.companyId).trim() } : {}),
    ...(source.tenantId ? { tenantId: String(source.tenantId).trim() } : {}),
    type,
    legalName,
    shortName: displayText(source.shortName) || legalName,
    inn: normalizeIdentifier(source.inn, 'ИНН'),
    kpp: normalizeIdentifier(source.kpp, 'КПП'),
    ogrn: normalizeIdentifier(source.ogrn, 'ОГРН'),
    ogrnip: normalizeIdentifier(source.ogrnip, 'ОГРНИП'),
    legalAddress: displayText(source.legalAddress),
    actualAddress: displayText(source.actualAddress),
    email: displayText(source.email)?.toLocaleLowerCase('ru-RU') || null,
    phone: displayText(source.phone),
    website: displayText(source.website),
    notes: multilineText(source.notes),
    status: archived ? 'archived' : status,
    roles: normalizeRoles(source.roles),
    createdAt: existing?.createdAt || createdAt || source.createdAt || timestamp,
    updatedAt: timestamp,
    archivedAt: archived ? (existing?.archivedAt || source.archivedAt || timestamp) : null,
  };

  if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
    throw counterpartyError(
      'COUNTERPARTY_VALIDATION_FAILED',
      'Некорректный email контрагента.',
      400,
      { field: 'email' },
    );
  }
  validateIdentifiers(record);
  return record;
}

function strongIdentityMatches(left, right) {
  const matchedFields = [];
  if (left.inn && right.inn && left.inn === right.inn) matchedFields.push('inn');
  if (left.ogrn && right.ogrn && left.ogrn === right.ogrn) matchedFields.push('ogrn');
  if (left.ogrnip && right.ogrnip && left.ogrnip === right.ogrnip) matchedFields.push('ogrnip');
  return matchedFields;
}

function assertCounterpartyUnique(counterparties, candidate, excludeId = '') {
  const conflicts = [];
  for (const existing of Array.isArray(counterparties) ? counterparties : []) {
    if (!existing || String(existing.id || '') === String(excludeId || '')) continue;
    const matchedFields = strongIdentityMatches(existing, candidate);
    if (matchedFields.length === 0) continue;
    conflicts.push({
      id: existing.id,
      legalName: existing.legalName,
      matchedFields,
    });
  }
  if (conflicts.length > 0) {
    throw counterpartyError(
      'COUNTERPARTY_DUPLICATE',
      'Контрагент с такими регистрационными идентификаторами уже существует.',
      409,
      { conflicts },
    );
  }
}

function findPossibleCounterpartyDuplicates(counterparties, candidate, excludeId = '') {
  const candidateNames = new Set([
    normalizedText(candidate?.legalName),
    normalizedText(candidate?.shortName),
  ].filter(Boolean));
  if (candidateNames.size === 0) return [];

  return (Array.isArray(counterparties) ? counterparties : [])
    .filter(existing => existing && String(existing.id || '') !== String(excludeId || ''))
    .filter(existing => [existing.legalName, existing.shortName]
      .map(normalizedText)
      .some(name => name && candidateNames.has(name)))
    .map(existing => ({
      code: 'COUNTERPARTY_POSSIBLE_DUPLICATE',
      counterpartyId: existing.id,
      legalName: existing.legalName,
      matchedBy: 'normalized_name',
    }));
}

function deterministicCounterpartyId(clientId) {
  const stableClientId = String(clientId ?? '').trim();
  if (!stableClientId) {
    throw counterpartyError(
      'COUNTERPARTY_CLIENT_LINK_INVALID',
      'Client без стабильного id нельзя сопоставить с контрагентом.',
      400,
      { field: 'client.id' },
    );
  }
  const digest = crypto.createHash('sha256').update(stableClientId).digest('hex').slice(0, 24);
  return `CP-CLIENT-${digest}`;
}

function clientTypeToCounterpartyType(client) {
  const value = String(client?.clientType || client?.type || '').trim().toLowerCase();
  if (['legal_entity', 'legal', 'company', 'organization'].includes(value)) return 'legal_entity';
  if (['individual_entrepreneur', 'entrepreneur', 'ip', 'sole_proprietor'].includes(value)) return 'individual_entrepreneur';
  if (['individual', 'person'].includes(value)) return 'individual';
  return normalizedDigits(client?.inn).length === 12 ? 'individual_entrepreneur' : 'legal_entity';
}

function counterpartyTypeToClientType(type) {
  if (type === 'individual_entrepreneur') return 'individual_entrepreneur';
  if (type === 'individual') return 'individual';
  return 'legal';
}

function counterpartyInputFromClient(client) {
  const legalName = displayText(client?.legalName || client?.fullName || client?.company || client?.companyName || client?.name);
  const shortName = displayText(client?.company || client?.companyName || client?.name || legalName);
  return {
    ...(client?.companyId ? { companyId: client.companyId } : {}),
    ...(client?.tenantId ? { tenantId: client.tenantId } : {}),
    type: clientTypeToCounterpartyType(client),
    legalName,
    shortName,
    inn: normalizedDigits(client?.inn),
    kpp: normalizedDigits(client?.kpp),
    ogrn: normalizedDigits(client?.ogrn),
    ogrnip: normalizedDigits(client?.ogrnip),
    legalAddress: client?.legalAddress,
    actualAddress: client?.actualAddress || client?.address,
    email: client?.email,
    phone: client?.phone,
    website: client?.website,
    status: 'active',
    roles: ['customer'],
  };
}

function projectCounterpartyToClient(client, counterparty) {
  const displayName = counterparty.shortName || counterparty.legalName;
  return {
    ...client,
    counterpartyId: counterparty.id,
    company: displayName,
    name: client?.name !== undefined ? displayName : client?.name,
    legalName: counterparty.legalName,
    inn: counterparty.inn || '',
    innNormalized: counterparty.inn || undefined,
    kpp: counterparty.kpp || undefined,
    ogrn: counterparty.ogrn || undefined,
    ogrnip: counterparty.ogrnip || undefined,
    clientType: counterpartyTypeToClientType(counterparty.type),
    legalAddress: counterparty.legalAddress || undefined,
    actualAddress: counterparty.actualAddress || undefined,
    address: counterparty.actualAddress || counterparty.legalAddress || undefined,
    email: counterparty.email || '',
    phone: counterparty.phone || '',
    website: counterparty.website || undefined,
    notes: client?.notes,
  };
}

function assertCounterpartyAvailableForClient(counterparty, clients, clientId = '') {
  if (!counterparty) {
    throw counterpartyError(
      'COUNTERPARTY_NOT_FOUND',
      'Связанный контрагент не найден.',
      404,
    );
  }
  if (counterparty.archivedAt || counterparty.status === 'archived') {
    throw counterpartyError(
      'COUNTERPARTY_CLIENT_LINK_INVALID',
      'Архивного контрагента нельзя связать с Client.',
      409,
      { counterpartyId: counterparty.id },
    );
  }
  if (![10, 12].includes(String(counterparty.inn || '').length)) {
    throw counterpartyError(
      'COUNTERPARTY_CLIENT_LINK_INVALID',
      'Для Client compatibility у контрагента должен быть российский ИНН из 10 или 12 цифр.',
      409,
      { counterpartyId: counterparty.id, field: 'inn' },
    );
  }
  const linked = (clients || []).find(client => (
    String(client?.counterpartyId || '') === String(counterparty.id)
    && String(client?.id || '') !== String(clientId || '')
  ));
  if (linked) {
    throw counterpartyError(
      'COUNTERPARTY_CLIENT_LINK_CONFLICT',
      'У контрагента уже есть Client compatibility record.',
      409,
      { counterpartyId: counterparty.id, clientId: linked.id },
    );
  }
}

function assertExplicitClientIdentityCompatible(client, counterparty) {
  const conflicts = [];
  const clientInn = normalizedDigits(client?.inn);
  if (clientInn && clientInn !== counterparty.inn) conflicts.push('inn');
  const clientKpp = normalizedDigits(client?.kpp);
  if (clientKpp && clientKpp !== (counterparty.kpp || '')) conflicts.push('kpp');
  const clientOgrn = normalizedDigits(client?.ogrn);
  if (clientOgrn && clientOgrn !== (counterparty.ogrn || '')) conflicts.push('ogrn');
  const clientOgrnip = normalizedDigits(client?.ogrnip);
  if (clientOgrnip && clientOgrnip !== (counterparty.ogrnip || '')) conflicts.push('ogrnip');

  const suppliedName = displayText(client?.legalName || client?.company || client?.name);
  if (suppliedName) {
    const acceptableNames = new Set([
      normalizedText(counterparty.legalName),
      normalizedText(counterparty.shortName),
    ]);
    if (!acceptableNames.has(normalizedText(suppliedName))) conflicts.push('legalName');
  }
  if (client?.clientType || client?.type) {
    if (clientTypeToCounterpartyType(client) !== counterparty.type) conflicts.push('type');
  }

  if (conflicts.length > 0) {
    throw counterpartyError(
      'COUNTERPARTY_CLIENT_IDENTITY_MISMATCH',
      'Поля Client не совпадают с явно выбранным контрагентом.',
      409,
      { counterpartyId: counterparty.id, fields: [...new Set(conflicts)] },
    );
  }
}

function withCustomerRole(counterparty, nowIso) {
  return addCounterpartyRole(counterparty, 'customer', nowIso).counterparty;
}

function requiredMasterDataScope(record, entityType) {
  const companyId = String(record?.companyId || '').trim();
  const tenantId = String(record?.tenantId || '').trim();
  if (!companyId || !tenantId) {
    throw counterpartyError(
      'ACTOR_SCOPE_INCOMPLETE',
      `${entityType} requires trusted companyId and tenantId before persistence.`,
      403,
      { entityId: record?.id || null },
    );
  }
  if (companyId !== tenantId) {
    throw counterpartyError(
      'ACTOR_SCOPE_INCOMPLETE',
      `${entityType} companyId and tenantId must be the same canonical Company ID.`,
      403,
      { entityId: record?.id || null },
    );
  }
  return { companyId, tenantId };
}

function assertSameMasterDataScope(left, right) {
  const leftScope = requiredMasterDataScope(left, 'Client');
  const rightScope = requiredMasterDataScope(right, 'Counterparty');
  for (const field of ['companyId', 'tenantId']) {
    if (leftScope[field] !== rightScope[field]) {
      throw counterpartyError(
        'COUNTERPARTY_SCOPE_FORBIDDEN',
        'Client и Counterparty принадлежат разным company/tenant.',
        403,
        { field },
      );
    }
  }
}

function prepareClientCompatibilityCreate({
  client,
  clients = [],
  counterparties = [],
  generateId,
  nowIso = () => new Date().toISOString(),
}) {
  requiredMasterDataScope(client, 'Client');
  const explicitCounterpartyId = String(client?.counterpartyId || '').trim();
  let counterparty;
  let nextCounterparties = [...counterparties];

  if (explicitCounterpartyId) {
    assertCounterpartyId(explicitCounterpartyId);
    const index = nextCounterparties.findIndex(item => String(item?.id || '') === explicitCounterpartyId);
    counterparty = index === -1 ? null : nextCounterparties[index];
    assertCounterpartyAvailableForClient(counterparty, clients, client?.id);
    assertSameMasterDataScope(client, counterparty);
    assertExplicitClientIdentityCompatible(client, counterparty);
    counterparty = withCustomerRole(counterparty, nowIso);
    nextCounterparties[index] = counterparty;
  } else {
    const nextId = typeof generateId === 'function'
      ? generateId('CP')
      : deterministicCounterpartyId(client?.id);
    counterparty = normalizeCounterpartyRecord(counterpartyInputFromClient(client), {
      id: nextId,
      nowIso,
      createdAt: client?.createdAt,
    });
    assertCounterpartyUnique(nextCounterparties, counterparty);
    nextCounterparties.push(counterparty);
  }

  return {
    client: projectCounterpartyToClient(client, counterparty),
    counterparty,
    counterparties: nextCounterparties,
  };
}

function counterpartyPatchFromClientPatch(previousClient, patch, counterparty) {
  const fields = Object.keys(patch || {}).filter(field => CLIENT_IDENTITY_FIELDS.has(field));
  if (fields.length === 0) return null;
  const source = { ...previousClient, ...patch };
  const next = {};

  if (fields.some(field => ['legalName', 'fullName'].includes(field))) {
    next.legalName = source.legalName || source.fullName;
  }
  if (fields.some(field => ['company', 'companyName', 'name'].includes(field))) {
    const nextName = source.company || source.companyName || source.name;
    next.shortName = nextName;
    const previousName = previousClient?.company || previousClient?.companyName || previousClient?.name;
    if (!counterparty.legalName || normalizedText(counterparty.legalName) === normalizedText(previousName)) {
      next.legalName = nextName;
    }
  }
  if (fields.includes('inn')) next.inn = source.inn;
  if (fields.includes('kpp')) next.kpp = source.kpp;
  if (fields.includes('ogrn')) next.ogrn = source.ogrn;
  if (fields.includes('ogrnip')) next.ogrnip = source.ogrnip;
  if (fields.includes('clientType') || fields.includes('type')) next.type = clientTypeToCounterpartyType(source);
  if (fields.includes('legalAddress')) next.legalAddress = source.legalAddress;
  if (fields.includes('actualAddress') || fields.includes('address')) next.actualAddress = source.actualAddress || source.address;
  if (fields.includes('email')) next.email = source.email;
  if (fields.includes('phone')) next.phone = source.phone;
  if (fields.includes('website')) next.website = source.website;
  return next;
}

function prepareClientCompatibilityUpdate({
  previousClient,
  nextClient,
  patch = {},
  clients = [],
  counterparties = [],
  nowIso = () => new Date().toISOString(),
}) {
  requiredMasterDataScope(nextClient, 'Client');
  const previousCounterpartyId = String(previousClient?.counterpartyId || '').trim();
  const requestedCounterpartyId = String(nextClient?.counterpartyId || '').trim();
  if (previousCounterpartyId && requestedCounterpartyId !== previousCounterpartyId) {
    throw counterpartyError(
      'COUNTERPARTY_CLIENT_LINK_IMMUTABLE',
      'Связь Client.counterpartyId нельзя менять после создания.',
      409,
      { clientId: previousClient?.id, counterpartyId: previousCounterpartyId },
    );
  }

  let nextCounterparties = [...counterparties];
  let index = -1;
  let counterparty;

  if (requestedCounterpartyId) {
    assertCounterpartyId(requestedCounterpartyId);
    index = nextCounterparties.findIndex(item => String(item?.id || '') === requestedCounterpartyId);
    counterparty = index === -1 ? null : nextCounterparties[index];
    assertCounterpartyAvailableForClient(counterparty, clients, previousClient?.id);
    assertSameMasterDataScope(nextClient, counterparty);
    if (!previousCounterpartyId) assertExplicitClientIdentityCompatible(nextClient, counterparty);
  } else {
    const migrationId = deterministicCounterpartyId(previousClient?.id);
    index = nextCounterparties.findIndex(item => String(item?.id || '') === migrationId);
    if (index >= 0) {
      counterparty = nextCounterparties[index];
    } else {
      counterparty = normalizeCounterpartyRecord(counterpartyInputFromClient(nextClient), {
        id: migrationId,
        nowIso,
        createdAt: previousClient?.createdAt,
      });
      assertCounterpartyUnique(nextCounterparties, counterparty);
      nextCounterparties.push(counterparty);
      index = nextCounterparties.length - 1;
    }
  }

  assertSameMasterDataScope(nextClient, counterparty);

  assertCounterpartyAvailableForClient(counterparty, clients, previousClient?.id);
  counterparty = withCustomerRole(counterparty, nowIso);
  const identityPatch = counterpartyPatchFromClientPatch(previousClient, patch, counterparty);
  if (identityPatch) {
    counterparty = normalizeCounterpartyRecord(identityPatch, {
      existing: counterparty,
      nowIso,
      allowArchived: true,
    });
    assertCounterpartyUnique(nextCounterparties, counterparty, counterparty.id);
  }
  nextCounterparties[index] = counterparty;

  return {
    client: projectCounterpartyToClient(nextClient, counterparty),
    counterparty,
    counterparties: nextCounterparties,
  };
}

function prepareClientCompatibilityBulkReplace({
  previousClients = [],
  nextClients = [],
  counterparties = [],
  nowIso = () => new Date().toISOString(),
}) {
  const previousById = new Map(previousClients.map(client => [String(client?.id || ''), client]));
  const incomingIds = new Set(nextClients.map(client => String(client?.id || '')).filter(Boolean));
  let workingClients = previousClients.filter(client => incomingIds.has(String(client?.id || '')));
  let workingCounterparties = [...counterparties];
  const result = [];

  for (const incoming of nextClients) {
    const previous = previousById.get(String(incoming?.id || ''));
    const compatibilityInput = { ...incoming };
    if (previous) {
      // Opening receivables are owned exclusively by the dedicated finance route.
      // Replacement/import callers cannot supply these fields, so preserve the
      // exact persisted state by stable Client ID instead of treating omission as
      // an instruction to erase the balance or its audit metadata.
      for (const field of CLIENT_OPENING_AR_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(previous, field)) compatibilityInput[field] = previous[field];
        else delete compatibilityInput[field];
      }
      if (previous.counterpartyId && !compatibilityInput.counterpartyId) {
        compatibilityInput.counterpartyId = previous.counterpartyId;
      }
    }
    const prepared = previous
      ? prepareClientCompatibilityUpdate({
          previousClient: previous,
          nextClient: compatibilityInput,
          patch: compatibilityInput,
          clients: workingClients,
          counterparties: workingCounterparties,
          nowIso,
        })
      : prepareClientCompatibilityCreate({
          client: compatibilityInput,
          clients: workingClients,
          counterparties: workingCounterparties,
          generateId: () => deterministicCounterpartyId(incoming?.id),
          nowIso,
        });
    workingCounterparties = prepared.counterparties;
    workingClients = workingClients.filter(client => String(client?.id || '') !== String(incoming?.id || ''));
    workingClients.push(prepared.client);
    result.push(prepared.client);
  }

  return { clients: result, counterparties: workingCounterparties };
}

function ensureClientCounterpartyFoundation({
  readData,
  writeDataBatch,
  logger = console,
  nowIso = () => new Date().toISOString(),
}) {
  const clients = Array.isArray(readData('clients')) ? readData('clients') : [];
  const counterparties = Array.isArray(readData('counterparties')) ? readData('counterparties') : [];
  if (clients.length === 0) return { created: 0, linked: 0, rolesAdded: 0, issues: [], changed: false };

  let nextClients = [...clients];
  let nextCounterparties = [...counterparties];
  let created = 0;
  let linked = 0;
  let rolesAdded = 0;
  const issues = [];

  for (let index = 0; index < nextClients.length; index += 1) {
    const client = nextClients[index];
    try {
      requiredMasterDataScope(client, 'Client');
      const explicitId = String(client?.counterpartyId || '').trim();
      if (explicitId) {
        const linkedIndex = nextCounterparties.findIndex(item => String(item?.id || '') === explicitId);
        const linkedCounterparty = linkedIndex === -1 ? null : nextCounterparties[linkedIndex];
        if (!linkedCounterparty) {
          throw counterpartyError(
            'COUNTERPARTY_CLIENT_LINK_INVALID',
            `Client ${client?.id || 'без id'} содержит ссылку на отсутствующего контрагента ${explicitId}.`,
            409,
            { clientId: client?.id, counterpartyId: explicitId },
          );
        }
        assertCounterpartyAvailableForClient(linkedCounterparty, nextClients, client?.id);
        assertSameMasterDataScope(client, linkedCounterparty);
        const roleResult = addCounterpartyRole(linkedCounterparty, 'customer', nowIso);
        if (roleResult.changed) {
          nextCounterparties[linkedIndex] = roleResult.counterparty;
          rolesAdded += 1;
        }
        continue;
      }

      const id = deterministicCounterpartyId(client?.id);
      let counterparty = nextCounterparties.find(item => String(item?.id || '') === id);
      if (!counterparty) {
        counterparty = normalizeCounterpartyRecord(counterpartyInputFromClient(client), {
          id,
          nowIso,
          createdAt: client?.createdAt,
        });
        assertCounterpartyUnique(nextCounterparties, counterparty);
        nextCounterparties.push(counterparty);
        created += 1;
      }
      assertCounterpartyAvailableForClient(counterparty, nextClients, client?.id);
      nextClients[index] = projectCounterpartyToClient(client, counterparty);
      linked += 1;
    } catch (error) {
      const issue = {
        clientId: client?.id || null,
        code: error?.code || 'COUNTERPARTY_MIGRATION_FAILED',
        error: error?.message || String(error),
      };
      issues.push(issue);
      logger.warn?.(`[counterparties] Client migration skipped: clientId=${issue.clientId || 'missing'} code=${issue.code} error=${issue.error}`);
    }
  }

  const changed = created > 0 || linked > 0 || rolesAdded > 0;
  if (changed) {
    writeDataBatch([
      { name: 'counterparties', value: nextCounterparties },
      { name: 'clients', value: nextClients },
    ]);
    logger.log?.(`[counterparties] foundation migration: created=${created}, linked=${linked}, rolesAdded=${rolesAdded}, issues=${issues.length}`);
  }
  return { created, linked, rolesAdded, issues, changed };
}

module.exports = {
  CLIENT_OPENING_AR_FIELDS,
  COUNTERPARTY_ID_PATTERN,
  COUNTERPARTY_ROLES,
  COUNTERPARTY_STATUSES,
  COUNTERPARTY_TYPES,
  addCounterpartyRole,
  assertCounterpartyId,
  assertCounterpartyUnique,
  counterpartyError,
  deterministicCounterpartyId,
  ensureClientCounterpartyFoundation,
  findPossibleCounterpartyDuplicates,
  normalizeCounterpartyRecord,
  normalizeCounterpartyRole,
  normalizeRoles,
  normalizedDigits,
  normalizedText,
  prepareClientCompatibilityBulkReplace,
  prepareClientCompatibilityCreate,
  prepareClientCompatibilityUpdate,
  projectCounterpartyToClient,
  removeCounterpartyRole,
};
