const crypto = require('crypto');
const {
  COUNTERPARTY_ROLES,
  counterpartyError,
  normalizeCounterpartyRole,
  normalizeRoles,
  normalizedText,
} = require('./counterparty');

const ROLE_ASSIGNMENTS_COLLECTION = 'counterparty_role_assignments';
const SUPPLIER_PROFILES_COLLECTION = 'supplier_profiles';
const CONTRACTOR_PROFILES_COLLECTION = 'contractor_profiles';

const ROLE_PROFILE_CODES = Object.freeze({
  AMBIGUOUS_LEGACY_CONTRACTOR_MAPPING: 'COUNTERPARTY_AMBIGUOUS_LEGACY_CONTRACTOR_MAPPING',
  AMBIGUOUS_LEGACY_SUPPLIER_MAPPING: 'COUNTERPARTY_AMBIGUOUS_LEGACY_SUPPLIER_MAPPING',
  ASSIGNMENT_DUPLICATE: 'COUNTERPARTY_ROLE_ASSIGNMENT_DUPLICATE',
  ASSIGNMENT_ACTIVE_ON_ARCHIVED: 'COUNTERPARTY_ROLE_ASSIGNMENT_ACTIVE_ON_ARCHIVED',
  ASSIGNMENT_WITHOUT_COUNTERPARTY: 'COUNTERPARTY_ROLE_ASSIGNMENT_WITHOUT_COUNTERPARTY',
  CLIENT_COUNTERPARTY_MISSING: 'COUNTERPARTY_CUSTOMER_PROFILE_TARGET_MISSING',
  CUSTOMER_PROFILE_DUPLICATE: 'COUNTERPARTY_CUSTOMER_PROFILE_DUPLICATE',
  CUSTOMER_PROFILE_WITHOUT_ROLE: 'COUNTERPARTY_CUSTOMER_PROFILE_WITHOUT_ROLE',
  DUPLICATE_STABLE_ID: 'COUNTERPARTY_ROLE_PROFILE_DUPLICATE_STABLE_ID',
  PROFILE_COUNTERPARTY_MISSING: 'COUNTERPARTY_ROLE_PROFILE_TARGET_MISSING',
  PROFILE_DUPLICATE: 'COUNTERPARTY_ROLE_PROFILE_DUPLICATE',
  PROFILE_WITHOUT_ROLE: 'COUNTERPARTY_ROLE_PROFILE_WITHOUT_ROLE',
  PROJECTION_CONFLICT: 'COUNTERPARTY_ROLE_PROJECTION_CONFLICT',
  ROLE_REMOVAL_BLOCKED: 'COUNTERPARTY_ROLE_REMOVAL_BLOCKED',
  ROLE_WITHOUT_PROFILE: 'COUNTERPARTY_ROLE_WITHOUT_PROFILE',
});

const ACTIVE_PROFILE_STATUSES = new Set(['active', 'new', 'blocked', 'Активен']);

function relationId(value) {
  return String(value ?? '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readCollection(data, name) {
  if (typeof data === 'function') return asArray(data(name));
  if (Array.isArray(data?.[name])) return data[name];
  if (data && typeof data.readData === 'function') return asArray(data.readData(name));
  return [];
}

function deterministicBoundaryId(prefix, ...parts) {
  const source = parts.map(relationId).join('\u0000');
  const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function deterministicRoleAssignmentId(counterpartyId, roleCode) {
  return deterministicBoundaryId('CPRA', counterpartyId, roleCode);
}

function deterministicRoleProfileId(roleCode, counterpartyId) {
  const role = normalizeCounterpartyRole(roleCode);
  const prefix = role === 'supplier' ? 'SUPP' : role === 'contractor' ? 'CONT' : 'CUST';
  return deterministicBoundaryId(prefix, counterpartyId);
}

function isActiveAssignment(assignment) {
  return String(assignment?.status || '').trim().toLowerCase() === 'active'
    && !relationId(assignment?.validTo);
}

function isActiveProfile(profile) {
  const status = String(profile?.status || 'active').trim();
  return !profile?.archivedAt && ACTIVE_PROFILE_STATUSES.has(status);
}

function activeRolesForCounterparty(assignments, counterpartyId) {
  const active = new Set(asArray(assignments)
    .filter(item => relationId(item?.counterpartyId) === relationId(counterpartyId))
    .filter(isActiveAssignment)
    .map(item => item?.roleCode));
  return COUNTERPARTY_ROLES.filter(role => active.has(role));
}

function hasActiveCounterpartyRole(counterparty, roleCode, data) {
  const role = normalizeCounterpartyRole(roleCode);
  const counterpartyId = relationId(counterparty?.id);
  const assignments = readCollection(data, ROLE_ASSIGNMENTS_COLLECTION)
    .filter(item => relationId(item?.counterpartyId) === counterpartyId);
  if (assignments.length > 0) {
    return activeRolesForCounterparty(assignments, counterpartyId).includes(role);
  }
  return asArray(counterparty?.roles).includes(role);
}

function roleProfileCollectionName(roleCode) {
  const role = normalizeCounterpartyRole(roleCode);
  if (role === 'supplier') return SUPPLIER_PROFILES_COLLECTION;
  if (role === 'contractor') return CONTRACTOR_PROFILES_COLLECTION;
  return 'clients';
}

function profileListForRole(state, roleCode) {
  return state[roleProfileCollectionName(roleCode)];
}

function profileMatchesCounterparty(profile, counterpartyId) {
  return relationId(profile?.counterpartyId) === relationId(counterpartyId);
}

function boundaryState(data = {}) {
  return {
    counterparties: [...readCollection(data, 'counterparties')],
    clients: [...readCollection(data, 'clients')],
    [ROLE_ASSIGNMENTS_COLLECTION]: [...readCollection(data, ROLE_ASSIGNMENTS_COLLECTION)],
    [SUPPLIER_PROFILES_COLLECTION]: [...readCollection(data, SUPPLIER_PROFILES_COLLECTION)],
    [CONTRACTOR_PROFILES_COLLECTION]: [...readCollection(data, CONTRACTOR_PROFILES_COLLECTION)],
  };
}

function assignmentMatches(assignment, counterpartyId, roleCode) {
  return relationId(assignment?.counterpartyId) === relationId(counterpartyId)
    && assignment?.roleCode === roleCode;
}

function findUniqueByCounterparty(list, counterpartyId, entity, code = ROLE_PROFILE_CODES.PROFILE_DUPLICATE) {
  const matches = asArray(list).filter(item => profileMatchesCounterparty(item, counterpartyId));
  if (matches.length > 1) {
    throw counterpartyError(
      code,
      `${entity} должен быть уникален по counterpartyId.`,
      409,
      { counterpartyId: relationId(counterpartyId), profileIds: matches.map(item => item?.id || null) },
    );
  }
  return matches[0] || null;
}

function findUniqueAssignment(assignments, counterpartyId, roleCode) {
  const matches = asArray(assignments).filter(item => assignmentMatches(item, counterpartyId, roleCode));
  if (matches.length > 1) {
    throw counterpartyError(
      ROLE_PROFILE_CODES.ASSIGNMENT_DUPLICATE,
      'Назначение роли должно быть уникально по counterpartyId и roleCode.',
      409,
      {
        counterpartyId: relationId(counterpartyId),
        roleCode,
        assignmentIds: matches.map(item => item?.id || null),
      },
    );
  }
  return matches[0] || null;
}

function projectActiveRolesToCounterparty(state, counterpartyId, timestamp) {
  const id = relationId(counterpartyId);
  const counterpartyIndex = state.counterparties.findIndex(item => relationId(item?.id) === id);
  if (counterpartyIndex === -1) {
    throw counterpartyError('COUNTERPARTY_NOT_FOUND', 'Контрагент не найден.', 404, { id });
  }
  const counterparty = state.counterparties[counterpartyIndex];
  const projectedRoles = activeRolesForCounterparty(state[ROLE_ASSIGNMENTS_COLLECTION], id);
  if (JSON.stringify(projectedRoles) === JSON.stringify(asArray(counterparty?.roles))) return false;
  state.counterparties[counterpartyIndex] = {
    ...counterparty,
    roles: projectedRoles,
    updatedAt: timestamp,
  };
  return true;
}

function bootstrapLegacyProjectedRoles({
  state,
  counterpartyId,
  actor,
  source,
  nowIso,
  excludeRoleCode = null,
}) {
  const id = relationId(counterpartyId);
  const counterparty = state.counterparties.find(item => relationId(item?.id) === id);
  if (!counterparty) {
    throw counterpartyError('COUNTERPARTY_NOT_FOUND', 'Контрагент не найден.', 404, { id });
  }
  const legacyRoles = normalizeRoles(counterparty.roles);
  let changed = false;
  for (const roleCode of legacyRoles) {
    if (roleCode === excludeRoleCode) continue;
    const existing = findUniqueAssignment(state[ROLE_ASSIGNMENTS_COLLECTION], id, roleCode);
    if (existing) continue;
    const result = activateCounterpartyRole({
      state,
      counterpartyId: id,
      roleCode,
      actor,
      source,
      nowIso,
      initializeProjection: false,
    });
    changed = result.changed || changed;
  }
  if (projectActiveRolesToCounterparty(state, id, nowIso())) changed = true;
  return { state, changed };
}

function actorId(actor) {
  return relationId(actor?.userId || actor?.id || actor?.userName || actor) || 'system';
}

function ownerScope(counterparty) {
  const companyId = relationId(counterparty?.companyId);
  const tenantId = relationId(counterparty?.tenantId);
  if (!companyId || !tenantId) {
    throw counterpartyError(
      'COUNTERPARTY_SCOPE_UNKNOWN',
      'Counterparty scope must be known before role/profile creation.',
      409,
      { counterpartyId: relationId(counterparty?.id) || null },
    );
  }
  return { companyId, tenantId };
}

function createSupplierProfile(counterpartyId, timestamp, scope) {
  return {
    id: deterministicRoleProfileId('supplier', counterpartyId),
    counterpartyId,
    ...scope,
    status: 'active',
    categories: [],
    settlementTerms: null,
    taxConfiguration: null,
    defaultCommercialConfiguration: null,
    preferredPaymentMethod: null,
    complianceState: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  };
}

function createContractorProfile(counterpartyId, timestamp, scope) {
  return {
    id: deterministicRoleProfileId('contractor', counterpartyId),
    counterpartyId,
    ...scope,
    status: 'active',
    serviceCategories: [],
    geographicScope: null,
    serviceScope: null,
    slaMetadata: null,
    complianceState: null,
    licenceReferences: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  };
}

function activateProfile(state, counterpartyId, roleCode, timestamp, scope) {
  if (roleCode === 'customer') {
    const profile = findUniqueByCounterparty(
      state.clients,
      counterpartyId,
      'CustomerProfile/Client',
      ROLE_PROFILE_CODES.CUSTOMER_PROFILE_DUPLICATE,
    );
    if (!profile || isActiveProfile(profile)) return false;
    const index = state.clients.indexOf(profile);
    state.clients[index] = {
      ...profile,
      status: 'active',
      customerRoleStatus: 'active',
      updatedAt: timestamp,
      archivedAt: null,
    };
    return true;
  }

  const collection = roleProfileCollectionName(roleCode);
  const profiles = state[collection];
  const entity = roleCode === 'supplier' ? 'SupplierProfile' : 'ContractorProfile';
  const profile = findUniqueByCounterparty(profiles, counterpartyId, entity);
  if (!profile) {
    profiles.push(roleCode === 'supplier'
      ? createSupplierProfile(counterpartyId, timestamp, scope)
      : createContractorProfile(counterpartyId, timestamp, scope));
    return true;
  }
  if (isActiveProfile(profile)) return false;
  const index = profiles.indexOf(profile);
  profiles[index] = {
    ...profile,
    status: 'active',
    updatedAt: timestamp,
    archivedAt: null,
  };
  return true;
}

function deactivateProfile(state, counterpartyId, roleCode, timestamp) {
  const profiles = profileListForRole(state, roleCode);
  const entity = roleCode === 'customer'
    ? 'CustomerProfile/Client'
    : roleCode === 'supplier' ? 'SupplierProfile' : 'ContractorProfile';
  const code = roleCode === 'customer'
    ? ROLE_PROFILE_CODES.CUSTOMER_PROFILE_DUPLICATE
    : ROLE_PROFILE_CODES.PROFILE_DUPLICATE;
  const profile = findUniqueByCounterparty(profiles, counterpartyId, entity, code);
  if (!profile || !isActiveProfile(profile)) return false;
  const index = profiles.indexOf(profile);
  profiles[index] = {
    ...profile,
    status: 'inactive',
    ...(roleCode === 'customer' ? { customerRoleStatus: 'inactive' } : {}),
    updatedAt: timestamp,
    archivedAt: profile.archivedAt || timestamp,
  };
  return true;
}

function activateCounterpartyRole({
  state: inputState,
  counterpartyId,
  roleCode,
  actor = 'system',
  reason = null,
  source = 'role_api',
  nowIso = () => new Date().toISOString(),
  initializeProjection = true,
}) {
  const state = inputState;
  const id = relationId(counterpartyId);
  const role = normalizeCounterpartyRole(roleCode);
  const counterpartyIndex = state.counterparties.findIndex(item => relationId(item?.id) === id);
  if (counterpartyIndex === -1) {
    throw counterpartyError('COUNTERPARTY_NOT_FOUND', 'Контрагент не найден.', 404, { id });
  }
  const counterparty = state.counterparties[counterpartyIndex];
  if (counterparty?.archivedAt || counterparty?.status === 'archived') {
    throw counterpartyError(
      'COUNTERPARTY_ROLE_ARCHIVED',
      'Нельзя активировать роль архивного контрагента.',
      409,
      { counterpartyId: id, roleCode: role },
    );
  }

  let changed = false;
  if (initializeProjection) {
    const bootstrapResult = bootstrapLegacyProjectedRoles({
      state,
      counterpartyId: id,
      actor,
      source: 'legacy_projection_on_role_mutation',
      nowIso,
      excludeRoleCode: role,
    });
    changed = bootstrapResult.changed || changed;
  }

  const timestamp = nowIso();
  const scope = ownerScope(counterparty);
  const assignments = state[ROLE_ASSIGNMENTS_COLLECTION];
  const existing = findUniqueAssignment(assignments, id, role);
  let assignment = existing;
  if (!existing) {
    assignment = {
      id: deterministicRoleAssignmentId(id, role),
      counterpartyId: id,
      ...scope,
      roleCode: role,
      status: 'active',
      validFrom: timestamp,
      validTo: null,
      createdBy: actorId(actor),
      createdAt: timestamp,
      updatedAt: timestamp,
      reason: relationId(reason) || null,
      source: relationId(source) || 'role_api',
    };
    assignments.push(assignment);
    changed = true;
  } else if (!isActiveAssignment(existing)) {
    const index = assignments.indexOf(existing);
    assignment = {
      ...existing,
      status: 'active',
      validFrom: timestamp,
      validTo: null,
      updatedAt: timestamp,
      reason: relationId(reason) || existing.reason || null,
      source: relationId(source) || existing.source || 'role_api',
    };
    assignments[index] = assignment;
    changed = true;
  }

  if (activateProfile(state, id, role, timestamp, scope)) changed = true;
  if (projectActiveRolesToCounterparty(state, id, timestamp)) changed = true;
  return { state, assignment, counterparty: state.counterparties[counterpartyIndex], changed };
}

function findRoleRemovalBlockers({ counterpartyId, roleCode, data }) {
  // Lazy loading avoids a module-initialization cycle: the lifecycle service uses
  // role boundary mutations, while this compatibility API delegates analysis back
  // to the single authoritative stable-ID registry.
  const { findCounterpartyRoleRemovalBlockers } = require('./client-master-data-lifecycle');
  return findCounterpartyRoleRemovalBlockers({ counterpartyId, roleCode, data });
}

function deactivateCounterpartyRole({
  state: inputState,
  data,
  counterpartyId,
  roleCode,
  actor = 'system',
  reason = null,
  source = 'role_api',
  nowIso = () => new Date().toISOString(),
}) {
  const state = inputState;
  const id = relationId(counterpartyId);
  const role = normalizeCounterpartyRole(roleCode);
  const counterpartyIndex = state.counterparties.findIndex(item => relationId(item?.id) === id);
  if (counterpartyIndex === -1) {
    throw counterpartyError('COUNTERPARTY_NOT_FOUND', 'Контрагент не найден.', 404, { id });
  }
  const bootstrapResult = bootstrapLegacyProjectedRoles({
    state,
    counterpartyId: id,
    actor,
    source: 'legacy_projection_on_role_mutation',
    nowIso,
  });
  const assignment = findUniqueAssignment(state[ROLE_ASSIGNMENTS_COLLECTION], id, role);
  if (!assignment || !isActiveAssignment(assignment)) {
    return {
      state,
      assignment: assignment || null,
      counterparty: state.counterparties[counterpartyIndex],
      changed: bootstrapResult.changed,
    };
  }

  const activeRoles = new Set(activeRolesForCounterparty(state[ROLE_ASSIGNMENTS_COLLECTION], id));
  activeRoles.delete(role);
  if (activeRoles.size === 0) {
    throw counterpartyError(
      'COUNTERPARTY_ROLE_REQUIRED',
      'У контрагента должна остаться хотя бы одна активная роль.',
      409,
      { counterpartyId: id, roleCode: role },
    );
  }

  const blockers = findRoleRemovalBlockers({ counterpartyId: id, roleCode: role, data });
  if (blockers.length > 0) {
    throw counterpartyError(
      ROLE_PROFILE_CODES.ROLE_REMOVAL_BLOCKED,
      'Роль нельзя деактивировать, пока она требуется durable stable-ID relations.',
      409,
      { counterpartyId: id, roleCode: role, blockers },
    );
  }

  const timestamp = nowIso();
  let currentAssignment = assignment;
  if (!currentAssignment) {
    currentAssignment = {
      id: deterministicRoleAssignmentId(id, role),
      counterpartyId: id,
      roleCode: role,
      status: 'inactive',
      validFrom: counterparty?.createdAt || timestamp,
      validTo: timestamp,
      createdBy: actorId(actor),
      createdAt: counterparty?.createdAt || timestamp,
      updatedAt: timestamp,
      reason: relationId(reason) || 'legacy_projection_deactivated',
      source: relationId(source) || 'role_api',
    };
    state[ROLE_ASSIGNMENTS_COLLECTION].push(currentAssignment);
  } else {
    const index = state[ROLE_ASSIGNMENTS_COLLECTION].indexOf(currentAssignment);
    currentAssignment = {
      ...currentAssignment,
      status: 'inactive',
      validTo: timestamp,
      updatedAt: timestamp,
      reason: relationId(reason) || currentAssignment.reason || null,
      source: relationId(source) || currentAssignment.source || 'role_api',
    };
    state[ROLE_ASSIGNMENTS_COLLECTION][index] = currentAssignment;
  }
  deactivateProfile(state, id, role, timestamp);
  projectActiveRolesToCounterparty(state, id, timestamp);
  return {
    state,
    assignment: currentAssignment,
    counterparty: state.counterparties[counterpartyIndex],
    changed: true,
  };
}

function boundaryEntries(state) {
  return [
    { name: 'counterparties', value: state.counterparties },
    { name: 'clients', value: state.clients },
    { name: ROLE_ASSIGNMENTS_COLLECTION, value: state[ROLE_ASSIGNMENTS_COLLECTION] },
    { name: SUPPLIER_PROFILES_COLLECTION, value: state[SUPPLIER_PROFILES_COLLECTION] },
    { name: CONTRACTOR_PROFILES_COLLECTION, value: state[CONTRACTOR_PROFILES_COLLECTION] },
  ];
}

function archiveCounterpartyRoleProfiles({
  state,
  counterpartyId,
  actor = 'system',
  source = 'counterparty_archive',
  nowIso = () => new Date().toISOString(),
}) {
  const id = relationId(counterpartyId);
  const timestamp = nowIso();
  let changed = false;
  for (let index = 0; index < state[ROLE_ASSIGNMENTS_COLLECTION].length; index += 1) {
    const assignment = state[ROLE_ASSIGNMENTS_COLLECTION][index];
    if (relationId(assignment?.counterpartyId) !== id || !isActiveAssignment(assignment)) continue;
    state[ROLE_ASSIGNMENTS_COLLECTION][index] = {
      ...assignment,
      status: 'inactive',
      validTo: timestamp,
      updatedAt: timestamp,
      reason: assignment.reason || 'counterparty_archived',
      source: relationId(source) || 'counterparty_archive',
      deactivatedBy: actorId(actor),
    };
    changed = true;
  }
  for (const roleCode of COUNTERPARTY_ROLES) {
    if (deactivateProfile(state, id, roleCode, timestamp)) changed = true;
  }
  return { state, changed };
}

function activateProjectedRolesForCounterparty({ state, counterpartyId, actor, source, nowIso }) {
  return bootstrapLegacyProjectedRoles({ state, counterpartyId, actor, source, nowIso });
}

function synchronizeClientRoleBoundary({
  counterparties,
  clients,
  roleAssignments = [],
  supplierProfiles = [],
  contractorProfiles = [],
  clientIds = null,
  actor = 'system',
  source = 'client_compatibility',
  nowIso = () => new Date().toISOString(),
}) {
  const state = boundaryState({
    counterparties,
    clients,
    [ROLE_ASSIGNMENTS_COLLECTION]: roleAssignments,
    [SUPPLIER_PROFILES_COLLECTION]: supplierProfiles,
    [CONTRACTOR_PROFILES_COLLECTION]: contractorProfiles,
  });
  const selectedIds = clientIds ? new Set(asArray(clientIds).map(relationId)) : null;
  let changed = false;
  for (const client of state.clients) {
    if (selectedIds && !selectedIds.has(relationId(client?.id))) continue;
    const counterpartyId = relationId(client?.counterpartyId);
    if (!counterpartyId) continue;
    const counterparty = state.counterparties.find(item => relationId(item?.id) === counterpartyId);
    if (!counterparty) {
      throw counterpartyError(
        ROLE_PROFILE_CODES.CLIENT_COUNTERPARTY_MISSING,
        'Client.counterpartyId указывает на отсутствующий Counterparty.',
        409,
        { clientId: relationId(client?.id), counterpartyId },
      );
    }
    const bootstrapResult = activateProjectedRolesForCounterparty({ state, counterpartyId, actor, source, nowIso });
    changed = bootstrapResult.changed || changed;
    const customerResult = activateCounterpartyRole({
      state,
      counterpartyId,
      roleCode: 'customer',
      actor,
      source,
      nowIso,
      initializeProjection: false,
    });
    changed = customerResult.changed || changed;
  }
  return { state, entries: boundaryEntries(state), changed };
}

function duplicateIdIssues(domain, list) {
  const byId = new Map();
  for (const item of asArray(list)) {
    const id = relationId(item?.id);
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(item);
  }
  return [...byId.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([id, matches]) => ({
      severity: 'error',
      code: ROLE_PROFILE_CODES.DUPLICATE_STABLE_ID,
      domain,
      recordId: id,
      repairability: 'none',
      context: { id, matches: matches.length },
    }));
}

function profilesByCounterparty(list, { activeOnly = false } = {}) {
  const result = new Map();
  for (const item of asArray(list).filter(item => !activeOnly || isActiveProfile(item))) {
    const id = relationId(item?.counterpartyId);
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(item);
  }
  return result;
}

function legacyMappingIssues(data, counterparties) {
  const issues = [];
  const inspect = ({ collection, field, roleCode, ambiguousCode, mappingKind }) => {
    const candidates = counterparties.filter(item => asArray(item?.roles).includes(roleCode));
    for (const record of readCollection(data, collection)) {
      if (relationId(record?.counterpartyId)
        || relationId(record?.supplierCounterpartyId)
        || relationId(record?.contractorCounterpartyId)
        || relationId(record?.carrierCounterpartyId)) continue;
      const label = relationId(record?.[field]);
      if (!label) continue;
      const matches = candidates.filter(counterparty => [counterparty?.legalName, counterparty?.shortName]
        .some(value => normalizedText(value) === normalizedText(label)));
      if (matches.length <= 1) continue;
      issues.push({
        severity: 'warning',
        code: ambiguousCode,
        domain: collection,
        recordId: relationId(record?.id) || null,
        repairability: 'report_only',
        context: {
          mappingKind,
          field,
          label,
          counterpartyIds: matches.map(item => item.id),
          reason: 'name_matching_is_not_a_safe_repair_key',
        },
      });
    }
  };
  inspect({
    collection: 'spare_parts',
    field: 'supplier',
    roleCode: 'supplier',
    ambiguousCode: ROLE_PROFILE_CODES.AMBIGUOUS_LEGACY_SUPPLIER_MAPPING,
    mappingKind: 'supplier',
  });
  for (const field of ['company', 'name']) {
    inspect({
      collection: 'delivery_carriers',
      field,
      roleCode: 'contractor',
      ambiguousCode: ROLE_PROFILE_CODES.AMBIGUOUS_LEGACY_CONTRACTOR_MAPPING,
      mappingKind: 'contractor_transport',
    });
  }
  return issues;
}

function auditCounterpartyRoleProfiles(data = {}) {
  const counterparties = readCollection(data, 'counterparties');
  const clients = readCollection(data, 'clients');
  const assignments = readCollection(data, ROLE_ASSIGNMENTS_COLLECTION);
  const supplierProfiles = readCollection(data, SUPPLIER_PROFILES_COLLECTION);
  const contractorProfiles = readCollection(data, CONTRACTOR_PROFILES_COLLECTION);
  const issues = [
    ...duplicateIdIssues('counterparties', counterparties),
    ...duplicateIdIssues('clients', clients),
    ...duplicateIdIssues(ROLE_ASSIGNMENTS_COLLECTION, assignments),
    ...duplicateIdIssues(SUPPLIER_PROFILES_COLLECTION, supplierProfiles),
    ...duplicateIdIssues(CONTRACTOR_PROFILES_COLLECTION, contractorProfiles),
  ];
  const cpById = new Map(counterparties.map(item => [relationId(item?.id), item]));
  const assignmentsByPair = new Map();
  for (const assignment of assignments) {
    const counterpartyId = relationId(assignment?.counterpartyId);
    const roleCode = relationId(assignment?.roleCode);
    if (!cpById.has(counterpartyId)) {
      issues.push({
        severity: 'error',
        code: ROLE_PROFILE_CODES.ASSIGNMENT_WITHOUT_COUNTERPARTY,
        domain: ROLE_ASSIGNMENTS_COLLECTION,
        recordId: relationId(assignment?.id) || null,
        counterpartyId,
        roleCode,
        repairability: 'none',
      });
    } else if (isActiveAssignment(assignment)) {
      const counterparty = cpById.get(counterpartyId);
      if (counterparty?.archivedAt || counterparty?.status === 'archived') {
        issues.push({
          severity: 'error',
          code: ROLE_PROFILE_CODES.ASSIGNMENT_ACTIVE_ON_ARCHIVED,
          domain: ROLE_ASSIGNMENTS_COLLECTION,
          recordId: relationId(assignment?.id) || null,
          counterpartyId,
          roleCode,
          repairability: 'deterministic_stable_id',
        });
      }
    }
    if (!COUNTERPARTY_ROLES.includes(roleCode)) {
      issues.push({
        severity: 'error',
        code: 'COUNTERPARTY_ROLE_INVALID',
        domain: ROLE_ASSIGNMENTS_COLLECTION,
        recordId: relationId(assignment?.id) || null,
        counterpartyId,
        roleCode,
        repairability: 'none',
      });
      continue;
    }
    const pair = `${counterpartyId}\u0000${roleCode}`;
    if (!assignmentsByPair.has(pair)) assignmentsByPair.set(pair, []);
    assignmentsByPair.get(pair).push(assignment);
  }
  for (const [pair, matches] of assignmentsByPair) {
    if (matches.length <= 1) continue;
    const [counterpartyId, roleCode] = pair.split('\u0000');
    issues.push({
      severity: 'error',
      code: ROLE_PROFILE_CODES.ASSIGNMENT_DUPLICATE,
      domain: ROLE_ASSIGNMENTS_COLLECTION,
      counterpartyId,
      roleCode,
      repairability: 'none',
      context: { assignmentIds: matches.map(item => item?.id || null) },
    });
  }

  const clientsByCounterparty = profilesByCounterparty(clients);
  const supplierProfilesByCounterparty = profilesByCounterparty(supplierProfiles);
  const contractorProfilesByCounterparty = profilesByCounterparty(contractorProfiles);
  const activeSupplierProfiles = profilesByCounterparty(supplierProfiles, { activeOnly: true });
  const activeContractorProfiles = profilesByCounterparty(contractorProfiles, { activeOnly: true });
  for (const [counterpartyId, profiles] of clientsByCounterparty) {
    if (profiles.length > 1) {
      issues.push({
        severity: 'error',
        code: ROLE_PROFILE_CODES.CUSTOMER_PROFILE_DUPLICATE,
        domain: 'clients',
        counterpartyId,
        repairability: 'none',
        context: { profileIds: profiles.map(item => item?.id || null) },
      });
    }
  }
  for (const [domain, roleCode, index] of [
    [SUPPLIER_PROFILES_COLLECTION, 'supplier', supplierProfilesByCounterparty],
    [CONTRACTOR_PROFILES_COLLECTION, 'contractor', contractorProfilesByCounterparty],
  ]) {
    for (const [counterpartyId, profiles] of index) {
      if (profiles.length > 1) {
        issues.push({
          severity: 'error',
          code: ROLE_PROFILE_CODES.PROFILE_DUPLICATE,
          domain,
          counterpartyId,
          roleCode,
          repairability: 'none',
          context: { profileIds: profiles.map(item => item?.id || null) },
        });
      }
    }
  }

  for (const client of clients) {
    const counterpartyId = relationId(client?.counterpartyId);
    if (!counterpartyId || !cpById.has(counterpartyId)) {
      issues.push({
        severity: 'error',
        code: ROLE_PROFILE_CODES.CLIENT_COUNTERPARTY_MISSING,
        domain: 'clients',
        recordId: relationId(client?.id) || null,
        counterpartyId: counterpartyId || null,
        repairability: 'none',
      });
      continue;
    }
    const hasCustomerRole = activeRolesForCounterparty(assignments, counterpartyId).includes('customer');
    if (isActiveProfile(client) && !hasCustomerRole) {
      issues.push({
        severity: 'error',
        code: ROLE_PROFILE_CODES.CUSTOMER_PROFILE_WITHOUT_ROLE,
        domain: 'clients',
        recordId: relationId(client?.id) || null,
        counterpartyId,
        roleCode: 'customer',
        repairability: 'deterministic_stable_id',
      });
    }
  }

  for (const [domain, roleCode, profiles] of [
    [SUPPLIER_PROFILES_COLLECTION, 'supplier', supplierProfiles],
    [CONTRACTOR_PROFILES_COLLECTION, 'contractor', contractorProfiles],
  ]) {
    for (const profile of profiles) {
      const counterpartyId = relationId(profile?.counterpartyId);
      if (!cpById.has(counterpartyId)) {
        issues.push({
          severity: 'error',
          code: ROLE_PROFILE_CODES.PROFILE_COUNTERPARTY_MISSING,
          domain,
          recordId: relationId(profile?.id) || null,
          counterpartyId,
          roleCode,
          repairability: 'none',
        });
      } else if (isActiveProfile(profile) && !activeRolesForCounterparty(assignments, counterpartyId).includes(roleCode)) {
        issues.push({
          severity: 'error',
          code: ROLE_PROFILE_CODES.PROFILE_WITHOUT_ROLE,
          domain,
          recordId: relationId(profile?.id) || null,
          counterpartyId,
          roleCode,
          repairability: 'deterministic_stable_id',
        });
      }
    }
  }

  for (const counterparty of counterparties) {
    const counterpartyId = relationId(counterparty?.id);
    const activeRoles = activeRolesForCounterparty(assignments, counterpartyId);
    const archived = Boolean(counterparty?.archivedAt || counterparty?.status === 'archived');
    if (!archived && JSON.stringify(activeRoles) !== JSON.stringify(asArray(counterparty?.roles))) {
      issues.push({
        severity: 'error',
        code: ROLE_PROFILE_CODES.PROJECTION_CONFLICT,
        domain: 'counterparties',
        recordId: counterpartyId || null,
        counterpartyId,
        repairability: 'deterministic_stable_id',
        context: { assignmentRoles: activeRoles, projectedRoles: asArray(counterparty?.roles) },
      });
    }
    for (const roleCode of activeRoles) {
      if (roleCode === 'customer') continue;
      const profiles = roleCode === 'supplier' ? activeSupplierProfiles : activeContractorProfiles;
      if ((profiles.get(counterpartyId) || []).length === 0) {
        issues.push({
          severity: 'error',
          code: ROLE_PROFILE_CODES.ROLE_WITHOUT_PROFILE,
          domain: 'counterparties',
          recordId: counterpartyId || null,
          counterpartyId,
          roleCode,
          repairability: 'deterministic_stable_id',
        });
      }
    }
  }

  const roleRemovalConstraints = [];
  for (const counterparty of counterparties) {
    for (const roleCode of activeRolesForCounterparty(assignments, counterparty?.id)) {
      const blockers = findRoleRemovalBlockers({ counterpartyId: counterparty?.id, roleCode, data });
      if (blockers.length > 0) {
        roleRemovalConstraints.push({
          code: ROLE_PROFILE_CODES.ROLE_REMOVAL_BLOCKED,
          counterpartyId: relationId(counterparty?.id),
          roleCode,
          blockers,
        });
      }
    }
  }
  const legacyMappings = legacyMappingIssues(data, counterparties);
  const errors = issues.filter(issue => issue.severity === 'error');
  const warnings = [...issues.filter(issue => issue.severity !== 'error'), ...legacyMappings];
  return {
    ok: errors.length === 0,
    authority: ROLE_ASSIGNMENTS_COLLECTION,
    errors,
    warnings,
    roleRemovalConstraints,
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      blockedRoleRemovals: roleRemovalConstraints.length,
      scanned: {
        counterparties: counterparties.length,
        customerProfiles: clients.length,
        roleAssignments: assignments.length,
        supplierProfiles: supplierProfiles.length,
        contractorProfiles: contractorProfiles.length,
      },
    },
  };
}

function prepareCounterpartyRoleProfileFoundation({
  data,
  actor = 'system:migration',
  source = 'stage_j_b_migration',
  nowIso = () => new Date().toISOString(),
  assignmentsAuthoritative = false,
}) {
  const state = boundaryState(data);
  const before = JSON.stringify(boundaryEntries(state));
  if (assignmentsAuthoritative) {
    for (let index = 0; index < state.counterparties.length; index += 1) {
      const counterparty = state.counterparties[index];
      if (counterparty?.archivedAt || counterparty?.status === 'archived') continue;
      const activeRoles = activeRolesForCounterparty(
        state[ROLE_ASSIGNMENTS_COLLECTION],
        counterparty?.id,
      );
      if (activeRoles.length === 0) {
        throw counterpartyError(
          'COUNTERPARTY_ROLE_REQUIRED',
          'Импортируемый активный Counterparty должен иметь active RoleAssignment.',
          409,
          { counterpartyId: relationId(counterparty?.id) },
        );
      }
      const timestamp = nowIso();
      state.counterparties[index] = {
        ...counterparty,
        roles: activeRoles,
        updatedAt: counterparty.updatedAt || timestamp,
      };
      for (const roleCode of activeRoles) activateProfile(state, counterparty?.id, roleCode, timestamp);
    }
  } else {
    for (const counterparty of [...state.counterparties]) {
      if (counterparty?.archivedAt || counterparty?.status === 'archived') continue;
      activateProjectedRolesForCounterparty({
        state,
        counterpartyId: counterparty?.id,
        actor,
        source,
        nowIso,
      });
    }
  }
  const synchronized = assignmentsAuthoritative
    ? { state }
    : synchronizeClientRoleBoundary({
      counterparties: state.counterparties,
      clients: state.clients,
      roleAssignments: state[ROLE_ASSIGNMENTS_COLLECTION],
      supplierProfiles: state[SUPPLIER_PROFILES_COLLECTION],
      contractorProfiles: state[CONTRACTOR_PROFILES_COLLECTION],
      actor,
      source,
      nowIso,
    });
  const auditData = {
    ...data,
    ...synchronized.state,
  };
  const audit = auditCounterpartyRoleProfiles(auditData);
  if (!audit.ok) {
    throw counterpartyError(
      'COUNTERPARTY_ROLE_PROFILE_MIGRATION_BLOCKED',
      'Role/profile foundation migration обнаружила неоднозначные или повреждённые stable-ID relations.',
      409,
      { errors: audit.errors },
    );
  }
  const entries = boundaryEntries(synchronized.state);
  return {
    state: synchronized.state,
    entries,
    changed: before !== JSON.stringify(entries),
    audit,
  };
}

function ensureCounterpartyRoleProfileFoundation({
  readData,
  writeDataBatch,
  dryRun = true,
  actor = 'system:migration',
  source = 'stage_j_b_migration',
  nowIso = () => new Date().toISOString(),
}) {
  const data = { readData };
  const result = prepareCounterpartyRoleProfileFoundation({ data, actor, source, nowIso });
  if (!dryRun && result.changed) {
    if (typeof writeDataBatch !== 'function') {
      throw counterpartyError(
        'COUNTERPARTY_ROLE_PROFILE_PERSISTENCE_REQUIRED',
        'Apply migration requires atomic writeDataBatch.',
        500,
      );
    }
    writeDataBatch(result.entries);
  }
  return {
    dryRun: Boolean(dryRun),
    changed: result.changed,
    wrote: !dryRun && result.changed,
    collections: Object.fromEntries(result.entries.map(entry => [entry.name, entry.value.length])),
    audit: result.audit,
  };
}

module.exports = {
  CONTRACTOR_PROFILES_COLLECTION,
  ROLE_ASSIGNMENTS_COLLECTION,
  ROLE_PROFILE_CODES,
  SUPPLIER_PROFILES_COLLECTION,
  activateCounterpartyRole,
  activeRolesForCounterparty,
  auditCounterpartyRoleProfiles,
  archiveCounterpartyRoleProfiles,
  boundaryEntries,
  boundaryState,
  deactivateCounterpartyRole,
  deterministicRoleAssignmentId,
  deterministicRoleProfileId,
  ensureCounterpartyRoleProfileFoundation,
  findRoleRemovalBlockers,
  hasActiveCounterpartyRole,
  isActiveAssignment,
  isActiveProfile,
  prepareCounterpartyRoleProfileFoundation,
  synchronizeClientRoleBoundary,
};
