const {
  COUNTERPARTY_ROLES,
  COUNTERPARTY_TYPES,
  assertCounterpartyId,
  assertCounterpartyUnique,
  counterpartyError,
  findPossibleCounterpartyDuplicates,
  normalizeCounterpartyRecord,
  normalizedText,
  projectCounterpartyToClient,
} = require('../lib/counterparty');
const {
  CONTRACTOR_PROFILES_COLLECTION,
  ROLE_ASSIGNMENTS_COLLECTION,
  SUPPLIER_PROFILES_COLLECTION,
  activateCounterpartyRole,
  activeRolesForCounterparty,
  boundaryEntries,
  boundaryState,
  deactivateCounterpartyRole,
  hasActiveCounterpartyRole,
} = require('../lib/counterparty-role-profiles');
const {
  assertEntityOwnerScope,
  createClientMasterDataLifecycleService,
} = require('../lib/client-master-data-lifecycle');
const {
  actorWithScope,
  assertOwnershipFieldsNotClientSupplied,
  assertRecordMatchesActorScope,
  assignTrustedScope,
  filterRecordsByActorScope,
  requireRequestActorScope,
} = require('../lib/trusted-actor-scope');

const COUNTERPARTY_WRITE_FIELDS = new Set([
  'type',
  'legalName',
  'shortName',
  'inn',
  'kpp',
  'ogrn',
  'ogrnip',
  'legalAddress',
  'actualAddress',
  'email',
  'phone',
  'website',
  'notes',
  'status',
  'roles',
]);
const COUNTERPARTY_PATCH_FIELDS = new Set(
  [...COUNTERPARTY_WRITE_FIELDS].filter(field => field !== 'roles'),
);

function sanitizeCounterpartyInput(input, { patch = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw counterpartyError('COUNTERPARTY_VALIDATION_FAILED', 'Ожидается объект контрагента.', 400);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'id')) {
    throw counterpartyError(
      'COUNTERPARTY_ID_IMMUTABLE',
      'Идентификатор контрагента назначается сервером и не изменяется.',
      409,
      { field: 'id' },
    );
  }
  for (const field of ['createdAt', 'updatedAt', 'archivedAt']) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw counterpartyError(
        'COUNTERPARTY_VALIDATION_FAILED',
        `Поле ${field} управляется сервером.`,
        400,
        { field },
      );
    }
  }
  if (patch && Object.prototype.hasOwnProperty.call(input, 'roles')) {
    throw counterpartyError(
      'COUNTERPARTY_ROLE_MUTATION_REQUIRED',
      'Для изменения ролей используйте отдельные role endpoints.',
      400,
      { field: 'roles' },
    );
  }
  const allowedFields = patch ? COUNTERPARTY_PATCH_FIELDS : COUNTERPARTY_WRITE_FIELDS;
  const unknownFields = Object.keys(input).filter(field => !allowedFields.has(field));
  if (unknownFields.length > 0) {
    throw counterpartyError(
      'COUNTERPARTY_VALIDATION_FAILED',
      `Неизвестное поле контрагента: ${unknownFields[0]}.`,
      400,
      { fields: unknownFields },
    );
  }
  if (patch && Object.keys(input).length === 0) {
    throw counterpartyError('COUNTERPARTY_VALIDATION_FAILED', 'PATCH не содержит изменений.', 400);
  }
  return { ...input };
}

function sendCounterpartyError(res, error) {
  const status = Number(error?.status) || 400;
  return res.status(status).json({
    ok: false,
    code: error?.code || 'COUNTERPARTY_VALIDATION_FAILED',
    error: error?.message || 'Не удалось сохранить контрагента.',
    ...(error?.details !== undefined ? { details: error.details } : {}),
  });
}

function sanitizeRoleMutationInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw counterpartyError('COUNTERPARTY_VALIDATION_FAILED', 'Ожидается объект с полем role.', 400);
  }
  const fields = Object.keys(input);
  const allowedFields = new Set(['role', 'reason', 'source']);
  const unknownFields = fields.filter(field => !allowedFields.has(field));
  if (!fields.includes('role') || unknownFields.length > 0) {
    throw counterpartyError(
      'COUNTERPARTY_VALIDATION_FAILED',
      'Изменение роли принимает role и optional reason/source, но не меняет реквизиты контрагента.',
      400,
      { fields, unknownFields },
    );
  }
  for (const [field, maxLength] of [['reason', 500], ['source', 100]]) {
    if (input[field] === undefined || input[field] === null) continue;
    if (typeof input[field] !== 'string' || input[field].trim().length > maxLength) {
      throw counterpartyError(
        'COUNTERPARTY_VALIDATION_FAILED',
        `Поле ${field} должно быть строкой не длиннее ${maxLength} символов.`,
        400,
        { field, maxLength },
      );
    }
  }
  return {
    role: input.role,
    reason: input.reason,
    source: input.source,
  };
}

function registerCounterpartyRoutes(router, deps) {
  const {
    readData,
    writeData,
    writeDataBatch = entries => {
      for (const entry of entries || []) writeData(entry.name, entry.value);
    },
    requireAuth,
    requireRead,
    requireWrite,
    generateId,
    nowIso = () => new Date().toISOString(),
    auditLog,
    clientMasterDataLifecycle = null,
  } = deps;
  const lifecycle = clientMasterDataLifecycle || createClientMasterDataLifecycleService({
    readData,
    writeDataBatch,
    generateId,
    nowIso,
  });

  function readRoleProfileState(overrides = {}, actorScope = null) {
    const state = boundaryState({
      counterparties: overrides.counterparties || readData('counterparties') || [],
      clients: overrides.clients || readData('clients') || [],
      [ROLE_ASSIGNMENTS_COLLECTION]: readData(ROLE_ASSIGNMENTS_COLLECTION) || [],
      [SUPPLIER_PROFILES_COLLECTION]: readData(SUPPLIER_PROFILES_COLLECTION) || [],
      [CONTRACTOR_PROFILES_COLLECTION]: readData(CONTRACTOR_PROFILES_COLLECTION) || [],
    });
    if (!actorScope) return state;
    for (const collection of [
      'counterparties',
      'clients',
      ROLE_ASSIGNMENTS_COLLECTION,
      SUPPLIER_PROFILES_COLLECTION,
      CONTRACTOR_PROFILES_COLLECTION,
    ]) {
      state[collection] = filterRecordsByActorScope(state[collection], actorScope);
    }
    return state;
  }

  router.get('/counterparties', requireAuth, requireRead('counterparties'), (req, res) => {
    const includeArchived = String(req.query.includeArchived || '') === '1';
    const role = String(req.query.role || '').trim();
    const type = String(req.query.type || '').trim();
    const search = normalizedText(req.query.search);

    if (role && !COUNTERPARTY_ROLES.includes(role)) {
      return sendCounterpartyError(res, counterpartyError(
        'COUNTERPARTY_ROLE_INVALID',
        `Недопустимая роль контрагента: ${role}.`,
        400,
        { allowedRoles: [...COUNTERPARTY_ROLES] },
      ));
    }
    if (type && !COUNTERPARTY_TYPES.includes(type)) {
      return sendCounterpartyError(res, counterpartyError(
        'COUNTERPARTY_VALIDATION_FAILED',
        `Недопустимый тип контрагента: ${type}.`,
        400,
        { allowedTypes: [...COUNTERPARTY_TYPES] },
      ));
    }

    let actorScope;
    try {
      actorScope = requireRequestActorScope(req);
    } catch (error) {
      return sendCounterpartyError(res, error);
    }
    let rows = filterRecordsByActorScope(readData('counterparties') || [], actorScope);
    if (!includeArchived) rows = rows.filter(item => !item?.archivedAt && item?.status !== 'archived');
    if (role) {
      const roleState = readRoleProfileState({}, actorScope);
      rows = rows.filter(item => hasActiveCounterpartyRole(item, role, roleState));
    }
    if (type) rows = rows.filter(item => item?.type === type);
    if (search) {
      rows = rows.filter(item => [
        item?.id,
        item?.legalName,
        item?.shortName,
        item?.inn,
        item?.kpp,
        item?.email,
        item?.phone,
      ].some(value => normalizedText(value).includes(search)));
    }
    rows = [...rows].sort((left, right) => (
      String(left?.legalName || '').localeCompare(String(right?.legalName || ''), 'ru')
      || String(left?.id || '').localeCompare(String(right?.id || ''))
    ));
    return res.json(rows);
  });

  router.get('/counterparties/:id', requireAuth, requireRead('counterparties'), (req, res) => {
    let id;
    try {
      id = assertCounterpartyId(req.params.id);
    } catch (error) {
      return sendCounterpartyError(res, error);
    }
    const item = (readData('counterparties') || []).find(entry => String(entry?.id || '') === id);
    if (!item) {
      return sendCounterpartyError(res, counterpartyError(
        'COUNTERPARTY_NOT_FOUND',
        'Контрагент не найден.',
        404,
        { id },
      ));
    }
    try {
      assertRecordMatchesActorScope(item, requireRequestActorScope(req));
    } catch (error) {
      return sendCounterpartyError(res, error);
    }
    return res.json(item);
  });

  router.get('/counterparties/:id/roles', requireAuth, requireRead('counterparties'), (req, res) => {
    try {
      const id = assertCounterpartyId(req.params.id);
      const item = (readData('counterparties') || []).find(entry => String(entry?.id || '') === id);
      if (!item) {
        throw counterpartyError('COUNTERPARTY_NOT_FOUND', 'Контрагент не найден.', 404, { id });
      }
      const actorScope = requireRequestActorScope(req);
      assertRecordMatchesActorScope(item, actorScope);
      const state = readRoleProfileState({}, actorScope);
      const assignments = state[ROLE_ASSIGNMENTS_COLLECTION]
        .filter(assignment => String(assignment?.counterpartyId || '') === id);
      const assignmentRoles = activeRolesForCounterparty(assignments, id);
      const roles = assignments.length > 0 ? assignmentRoles : (item.roles || []);
      return res.json({
        counterpartyId: id,
        roles,
        assignments,
        profiles: {
          customer: state.clients.find(profile => String(profile?.counterpartyId || '') === id) || null,
          supplier: state[SUPPLIER_PROFILES_COLLECTION]
            .find(profile => String(profile?.counterpartyId || '') === id) || null,
          contractor: state[CONTRACTOR_PROFILES_COLLECTION]
            .find(profile => String(profile?.counterpartyId || '') === id) || null,
        },
      });
    } catch (error) {
      return sendCounterpartyError(res, error);
    }
  });

  router.post('/counterparties/:id/roles', requireAuth, requireWrite('counterparties'), (req, res) => {
    try {
      const id = assertCounterpartyId(req.params.id);
      const input = sanitizeRoleMutationInput(req.body);
      const state = readRoleProfileState();
      const previous = state.counterparties.find(item => String(item?.id || '') === id);
      if (previous) {
        assertEntityOwnerScope({ actor: actorWithScope(req), entityType: 'counterparty', entity: previous, readData });
      }
      const result = activateCounterpartyRole({
        state,
        counterpartyId: id,
        roleCode: input.role,
        actor: actorWithScope(req),
        reason: input.reason,
        source: input.source || 'role_api',
        nowIso,
      });
      if (result.changed) {
        writeDataBatch(boundaryEntries(result.state));
        auditLog?.(req, {
          action: 'counterparties.role.add',
          entityType: 'counterparties',
          entityId: id,
          before: previous,
          after: result.counterparty,
        });
      }
      return res.json({ ok: true, changed: result.changed, counterparty: result.counterparty });
    } catch (error) {
      return sendCounterpartyError(res, error);
    }
  });

  router.delete('/counterparties/:id/roles/:role', requireAuth, requireWrite('counterparties'), (req, res) => {
    try {
      const id = assertCounterpartyId(req.params.id);
      const input = sanitizeRoleMutationInput({
        role: req.params.role,
        ...(req.query.reason !== undefined ? { reason: req.query.reason } : {}),
        ...(req.query.source !== undefined ? { source: req.query.source } : {}),
      });
      const scopedCounterparty = (readData('counterparties') || [])
        .find(item => String(item?.id || '') === id);
      if (scopedCounterparty) {
        assertEntityOwnerScope({ actor: actorWithScope(req), entityType: 'counterparty', entity: scopedCounterparty, readData });
      }
      if (input.role === 'customer') {
        return res.json(lifecycle.deactivateCustomerRole({
          id,
          actor: actorWithScope(req),
          reason: input.reason,
          source: input.source || 'role_api',
        }));
      }
      const state = readRoleProfileState();
      const previous = state.counterparties.find(item => String(item?.id || '') === id);
      const result = deactivateCounterpartyRole({
        state,
        data: { readData },
        counterpartyId: id,
        roleCode: input.role,
        actor: actorWithScope(req),
        reason: input.reason,
        source: input.source || 'role_api',
        nowIso,
      });
      if (result.changed) {
        writeDataBatch(boundaryEntries(result.state));
        auditLog?.(req, {
          action: 'counterparties.role.remove',
          entityType: 'counterparties',
          entityId: id,
          before: previous,
          after: result.counterparty,
        });
      }
      return res.json({ ok: true, changed: result.changed, counterparty: result.counterparty });
    } catch (error) {
      return sendCounterpartyError(res, error);
    }
  });

  router.post('/counterparties', requireAuth, requireWrite('counterparties'), (req, res) => {
    try {
      const actorScope = requireRequestActorScope(req);
      assertOwnershipFieldsNotClientSupplied(req.body);
      const input = sanitizeCounterpartyInput(req.body);
      if (input.status === 'archived') {
        throw counterpartyError(
          'COUNTERPARTY_VALIDATION_FAILED',
          'Новый контрагент не может быть создан в архивном статусе.',
          400,
          { field: 'status' },
        );
      }
      const counterparties = Array.isArray(readData('counterparties')) ? readData('counterparties') : [];
      const item = normalizeCounterpartyRecord(assignTrustedScope(input, actorScope), {
        id: generateId('CP'),
        nowIso,
      });
      assertCounterpartyUnique(counterparties, item);
      const warnings = findPossibleCounterpartyDuplicates(counterparties, item);
      const state = readRoleProfileState({ counterparties: [...counterparties, item] });
      let stored = item;
      for (const roleCode of item.roles) {
        const result = activateCounterpartyRole({
          state,
          counterpartyId: item.id,
          roleCode,
          actor: actorWithScope(req),
          source: 'counterparty_create',
          nowIso,
          initializeProjection: false,
        });
        stored = result.counterparty;
      }
      writeDataBatch(boundaryEntries(state));
      auditLog?.(req, {
        action: 'counterparties.create',
        entityType: 'counterparties',
        entityId: stored.id,
        after: stored,
      });
      return res.status(201).json(warnings.length > 0 ? { ...stored, warnings } : stored);
    } catch (error) {
      return sendCounterpartyError(res, error);
    }
  });

  router.patch('/counterparties/:id', requireAuth, requireWrite('counterparties'), (req, res) => {
    try {
      const id = assertCounterpartyId(req.params.id);
      const counterparties = [...(readData('counterparties') || [])];
      const index = counterparties.findIndex(item => String(item?.id || '') === id);
      if (index === -1) {
        throw counterpartyError('COUNTERPARTY_NOT_FOUND', 'Контрагент не найден.', 404, { id });
      }
      assertEntityOwnerScope({
        actor: actorWithScope(req),
        entityType: 'counterparty',
        entity: counterparties[index],
        readData,
      });
      const input = sanitizeCounterpartyInput(req.body, { patch: true });
      if (input.status === 'archived') {
        throw counterpartyError(
          'COUNTERPARTY_VALIDATION_FAILED',
          'Для архивирования используйте DELETE /api/counterparties/:id.',
          400,
          { field: 'status' },
        );
      }
      const previous = counterparties[index];
      const item = normalizeCounterpartyRecord(input, {
        existing: previous,
        nowIso,
        allowArchived: true,
      });
      const linkedClients = (readData('clients') || [])
        .filter(client => String(client?.counterpartyId || '') === id);
      if (linkedClients.length > 0 && !item.roles.includes('customer')) {
        throw counterpartyError(
          'COUNTERPARTY_CLIENT_LINK_CONFLICT',
          'Нельзя удалить роль customer, пока существует связанный Client.',
          409,
          { counterpartyId: id, clientIds: linkedClients.map(client => client.id) },
        );
      }
      if (linkedClients.length > 0 && ![10, 12].includes(String(item.inn || '').length)) {
        throw counterpartyError(
          'COUNTERPARTY_CLIENT_LINK_CONFLICT',
          'Связанный Client требует ИНН контрагента из 10 или 12 цифр.',
          409,
          { counterpartyId: id, clientIds: linkedClients.map(client => client.id), field: 'inn' },
        );
      }
      assertCounterpartyUnique(counterparties, item, id);
      const warnings = findPossibleCounterpartyDuplicates(counterparties, item, id);
      counterparties[index] = item;

      const clients = readData('clients') || [];
      const nextClients = clients.map(client => (
        String(client?.counterpartyId || '') === id
          ? projectCounterpartyToClient(client, item)
          : client
      ));
      if (linkedClients.length > 0) {
        writeDataBatch([
          { name: 'counterparties', value: counterparties },
          { name: 'clients', value: nextClients },
        ]);
      } else {
        writeData('counterparties', counterparties);
      }
      auditLog?.(req, {
        action: 'counterparties.update',
        entityType: 'counterparties',
        entityId: id,
        before: previous,
        after: item,
      });
      return res.json(warnings.length > 0 ? { ...item, warnings } : item);
    } catch (error) {
      return sendCounterpartyError(res, error);
    }
  });

  router.delete('/counterparties/:id', requireAuth, requireWrite('counterparties'), (req, res) => {
    try {
      const id = assertCounterpartyId(req.params.id);
      return res.json(lifecycle.archiveCounterparty({ id, actor: actorWithScope(req) }));
    } catch (error) {
      return sendCounterpartyError(res, error);
    }
  });

  return router;
}

module.exports = {
  COUNTERPARTY_PATCH_FIELDS,
  COUNTERPARTY_WRITE_FIELDS,
  registerCounterpartyRoutes,
  sanitizeRoleMutationInput,
  sanitizeCounterpartyInput,
  sendCounterpartyError,
};
