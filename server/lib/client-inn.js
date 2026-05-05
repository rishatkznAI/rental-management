const DUPLICATE_CLIENT_INN_ERROR = 'Клиент с таким ИНН уже существует';

function normalizeClientInn(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function getClientInnNormalized(client) {
  return normalizeClientInn(client?.inn ?? client?.taxId ?? client?.innNormalized ?? client?.taxIdNormalized);
}

function normalizeClientInnFields(client) {
  const normalized = getClientInnNormalized(client);
  return {
    ...client,
    innNormalized: normalized || undefined,
  };
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
  assertClientInnListUnique,
  assertClientInnWriteAllowed,
  assertClientInnUnique,
  buildClientInnDuplicateReport,
  getClientInnNormalized,
  normalizeClientInn,
  normalizeClientInnFields,
};
