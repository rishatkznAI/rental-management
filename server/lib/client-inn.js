const DUPLICATE_CLIENT_INN_ERROR = 'Клиент с таким ИНН уже существует';
const INVALID_CLIENT_INN_ERROR = 'Укажите корректный ИНН: 10 цифр для юрлица или 12 цифр для ИП';

function normalizeClientInn(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

const normalizeInn = normalizeClientInn;

function getClientInnNormalized(client) {
  return normalizeClientInn(client?.inn ?? client?.taxId ?? client?.innNormalized ?? client?.taxIdNormalized);
}

function normalizeClientInnFields(client) {
  const normalized = getClientInnNormalized(client);
  return {
    ...client,
    inn: normalized || client?.inn,
    innNormalized: normalized || undefined,
  };
}

function isValidClientInn(value) {
  const normalized = normalizeClientInn(value);
  return normalized.length === 10 || normalized.length === 12;
}

function createInvalidInnError() {
  const error = new Error(INVALID_CLIENT_INN_ERROR);
  error.status = 400;
  error.code = 'CLIENT_INN_INVALID';
  return error;
}

function assertClientInnValid(client) {
  if (!isValidClientInn(client?.inn ?? client?.taxId ?? client?.innNormalized ?? client?.taxIdNormalized)) {
    throw createInvalidInnError();
  }
}

function validateClientInnRequired(client) {
  assertClientInnValid(client);
}

function buildClientInnDuplicateReport(clients) {
  const byInn = new Map();
  for (const client of clients || []) {
    const innNormalized = getClientInnNormalized(client);
    if (!innNormalized) continue;
    const list = byInn.get(innNormalized) || [];
    list.push({
      id: client?.id ? String(client.id) : '',
      company: client?.company || client?.name || client?.clientName || '',
      inn: client?.inn || '',
      innNormalized,
    });
    byInn.set(innNormalized, list);
  }

  return Array.from(byInn.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([innNormalized, matches]) => ({ innNormalized, clients: matches }));
}

function buildClientInnGroups(clients) {
  const groups = new Map();
  for (const client of clients || []) {
    const innNormalized = getClientInnNormalized(client);
    if (!innNormalized) continue;
    const list = groups.get(innNormalized) || [];
    list.push(client);
    groups.set(innNormalized, list);
  }
  return groups;
}

function findClientByNormalizedInn(clients, innNormalized, exceptClientId) {
  const except = exceptClientId ? String(exceptClientId) : '';
  if (!innNormalized) return null;
  return (clients || []).find(client => {
    if (!client) return false;
    if (except && String(client.id || '') === except) return false;
    return getClientInnNormalized(client) === innNormalized;
  }) || null;
}

function createDuplicateInnError(existingClient) {
  const error = new Error(DUPLICATE_CLIENT_INN_ERROR);
  error.status = 409;
  error.code = 'CLIENT_INN_DUPLICATE';
  error.conflictClient = existingClient
    ? {
        id: existingClient.id,
        company: existingClient.company || existingClient.name || existingClient.clientName || '',
        inn: existingClient.inn || '',
        innNormalized: getClientInnNormalized(existingClient),
      }
    : undefined;
  return error;
}

function assertClientInnUnique(clients, candidate, exceptClientId) {
  const normalized = getClientInnNormalized(candidate);
  if (!normalized) return;
  const existingClient = findClientByNormalizedInn(clients, normalized, exceptClientId);
  if (existingClient) {
    throw createDuplicateInnError(existingClient);
  }
}

function assertNoDuplicateInn(clients, currentClientId) {
  const current = currentClientId
    ? (clients || []).find(client => String(client?.id || '') === String(currentClientId))
    : null;
  if (current) return assertClientInnUnique(clients, current, currentClientId);
  return assertClientInnListUnique(clients);
}

function stableClientWriteSignature(client) {
  const normalized = normalizeClientInnFields(client || {});
  return JSON.stringify({
    ...normalized,
    inn: getClientInnNormalized(normalized) || '',
    innNormalized: getClientInnNormalized(normalized) || undefined,
    taxIdNormalized: normalized.taxIdNormalized ? normalizeClientInn(normalized.taxIdNormalized) : undefined,
  });
}

function assertClientInnListUnique(clients) {
  const duplicates = buildClientInnDuplicateReport(clients);
  if (duplicates.length === 0) return;
  const first = duplicates[0]?.clients?.[0];
  const error = createDuplicateInnError(first);
  error.duplicates = duplicates;
  error.message = `${DUPLICATE_CLIENT_INN_ERROR}. Найдены дубли: ${duplicates
    .map(group => `${group.innNormalized}: ${group.clients.map(client => client.company || client.id || 'без названия').join(', ')}`)
    .join('; ')}`;
  throw error;
}

function assertClientInnWriteAllowed(previousClients, nextClients) {
  const previousById = new Map((previousClients || [])
    .filter(client => client?.id)
    .map(client => [String(client.id), client]));
  for (const client of nextClients || []) {
    if (isValidClientInn(client?.inn ?? client?.taxId ?? client?.innNormalized ?? client?.taxIdNormalized)) continue;
    const id = String(client?.id || '').trim();
    const previous = id ? previousById.get(id) : null;
    const legacyUnchanged = previous &&
      !isValidClientInn(previous?.inn ?? previous?.taxId ?? previous?.innNormalized ?? previous?.taxIdNormalized) &&
      stableClientWriteSignature(previous) === stableClientWriteSignature(client);
    if (!legacyUnchanged) {
      throw createInvalidInnError();
    }
  }

  const previousGroups = buildClientInnGroups(previousClients);
  const nextGroups = buildClientInnGroups(nextClients);
  const newDuplicateGroups = [];

  for (const [innNormalized, nextGroup] of nextGroups.entries()) {
    if (nextGroup.length <= 1) continue;
    const previousGroup = previousGroups.get(innNormalized) || [];
    const previousIds = new Set(previousGroup.map(client => String(client?.id || '')).filter(Boolean));
    const hasNewDuplicateMember = nextGroup
      .map(client => String(client?.id || '').trim())
      .some(id => !id || !previousIds.has(id));
    if (previousGroup.length <= 1 || nextGroup.length > previousGroup.length || hasNewDuplicateMember) {
      newDuplicateGroups.push({
        innNormalized,
        clients: nextGroup.map(client => ({
          id: client?.id ? String(client.id) : '',
          company: client?.company || client?.name || client?.clientName || '',
          inn: client?.inn || '',
          innNormalized,
        })),
      });
    }
  }

  if (newDuplicateGroups.length > 0) {
    const first = newDuplicateGroups[0]?.clients?.[0];
    const error = createDuplicateInnError(first);
    error.duplicates = newDuplicateGroups;
    error.message = `${DUPLICATE_CLIENT_INN_ERROR}. Новые дубли: ${newDuplicateGroups
      .map(group => `${group.innNormalized}: ${group.clients.map(client => client.company || client.id || 'без названия').join(', ')}`)
      .join('; ')}`;
    throw error;
  }
}

module.exports = {
  DUPLICATE_CLIENT_INN_ERROR,
  INVALID_CLIENT_INN_ERROR,
  assertClientInnListUnique,
  assertClientInnValid,
  assertClientInnWriteAllowed,
  assertClientInnUnique,
  assertNoDuplicateInn,
  buildClientInnDuplicateReport,
  getClientInnNormalized,
  isValidClientInn,
  normalizeInn,
  normalizeClientInn,
  normalizeClientInnFields,
  validateClientInnRequired,
};
