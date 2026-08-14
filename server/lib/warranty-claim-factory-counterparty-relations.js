const crypto = require('crypto');
const { counterpartyError, normalizedText } = require('./counterparty');
const {
  ROLE_ASSIGNMENTS_COLLECTION,
  SUPPLIER_PROFILES_COLLECTION,
  isActiveAssignment,
  isActiveProfile,
} = require('./counterparty-role-profiles');
const { isTerminalWarrantyClaim } = require('./warranty-claim-counterparty-relations');

const EXTERNAL_FACTORY_STATUSES = new Set([
  'sent_to_factory',
  'factory_review',
  'answer_received',
  'approved',
  'parts_shipping',
]);

const PRE_EXTERNAL_FACTORY_STATUSES = new Set([
  'draft',
  'new',
  'created',
  'open',
]);

const FACTORY_EXTERNAL_EVIDENCE_FIELDS = Object.freeze([
  'sentAt',
  'factoryCaseNumber',
  'factoryResponse',
]);

const FACTORY_SNAPSHOT_FIELDS = Object.freeze([
  'factoryName',
  'factoryContact',
  'manufacturer',
]);

const WARRANTY_FACTORY_CLASSIFICATIONS = Object.freeze({
  CANONICAL: 'canonical',
  CANONICAL_TERMINAL_HISTORY: 'canonical_terminal_history',
  VALID_PRE_EXTERNAL_DRAFT: 'valid_pre_external_draft',
  BLOCKED_MANUAL_MAPPING: 'blocked_manual_mapping',
  AMBIGUOUS_METADATA: 'ambiguous_metadata',
  MISSING_CANONICAL_TARGET: 'missing_canonical_target',
  DUPLICATE_BROKEN_STABLE_TARGET: 'duplicate_broken_stable_target',
  ARCHIVED_ACTIVE_TARGET: 'archived_active_target',
  MISSING_INACTIVE_SUPPLIER_ASSIGNMENT: 'missing_inactive_supplier_assignment',
  MISSING_INACTIVE_SUPPLIER_PROFILE: 'missing_inactive_supplier_profile',
  UNRESOLVED_TERMINAL_HISTORICAL_SNAPSHOT: 'unresolved_terminal_historical_snapshot',
});

const WARRANTY_FACTORY_CODES = Object.freeze({
  CLAIM_ID_REQUIRED: 'WARRANTY_FACTORY_CLAIM_ID_REQUIRED',
  COLLECTION_INVALID: 'WARRANTY_FACTORY_COLLECTION_INVALID',
  CONTROLLED_MAPPING_REQUIRED: 'WARRANTY_FACTORY_CONTROLLED_MAPPING_REQUIRED',
  COUNTERPARTY_ARCHIVED: 'WARRANTY_FACTORY_COUNTERPARTY_ARCHIVED',
  COUNTERPARTY_DUPLICATE: 'WARRANTY_FACTORY_COUNTERPARTY_DUPLICATE',
  COUNTERPARTY_NOT_FOUND: 'WARRANTY_FACTORY_COUNTERPARTY_NOT_FOUND',
  DUPLICATE_CLAIM_ID: 'WARRANTY_FACTORY_DUPLICATE_CLAIM_ID',
  DUPLICATE_MAPPING: 'WARRANTY_FACTORY_DUPLICATE_MAPPING',
  IMMUTABLE: 'WARRANTY_FACTORY_RELATION_IMMUTABLE',
  MANIFEST_INVALID: 'WARRANTY_FACTORY_MAPPING_MANIFEST_INVALID',
  MAPPING_CONFLICT: 'WARRANTY_FACTORY_MAPPING_CONFLICT',
  MAPPING_PRECONDITION_CHANGED: 'WARRANTY_FACTORY_MAPPING_PRECONDITION_CHANGED',
  MULTIPLE_BATCH_ENTRIES: 'WARRANTY_FACTORY_MULTIPLE_BATCH_ENTRIES',
  RELATION_REQUIRED: 'WARRANTY_FACTORY_RELATION_REQUIRED',
  SUPPLIER_ASSIGNMENT_INVALID: 'WARRANTY_FACTORY_SUPPLIER_ASSIGNMENT_INVALID',
  SUPPLIER_PROFILE_INVALID: 'WARRANTY_FACTORY_SUPPLIER_PROFILE_INVALID',
});

const FACTORY_PERSISTENCE_DEPENDENCIES = new Set([
  'warranty_claims',
  'counterparties',
  ROLE_ASSIGNMENTS_COLLECTION,
  SUPPLIER_PROFILES_COLLECTION,
]);

function relationId(value) {
  return String(value ?? '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readCollection(data, name) {
  if (typeof data === 'function') return asArray(data(name));
  if (data && typeof data.readData === 'function') return asArray(data.readData(name));
  return asArray(data?.[name]);
}

function lowerStatus(claim) {
  return relationId(claim?.status).toLowerCase();
}

function hasFactoryExternalEvidence(claim) {
  return FACTORY_EXTERNAL_EVIDENCE_FIELDS.some(field => relationId(claim?.[field]));
}

function requiresWarrantyFactoryRelation(claim) {
  if (isTerminalWarrantyClaim(claim)) return false;
  if (hasFactoryExternalEvidence(claim)) return true;
  const status = lowerStatus(claim);
  if (EXTERNAL_FACTORY_STATUSES.has(status)) return true;
  if (PRE_EXTERNAL_FACTORY_STATUSES.has(status)) return false;
  // Unknown nonterminal statuses fail closed as an active external workflow.
  return true;
}

function isArchivedCounterparty(counterparty) {
  return Boolean(counterparty?.archivedAt)
    || relationId(counterparty?.status).toLowerCase() === 'archived';
}

function uniqueCounterparty(factoryCounterpartyId, data) {
  const id = relationId(factoryCounterpartyId);
  const matches = readCollection(data, 'counterparties')
    .filter(item => relationId(item?.id) === id);
  if (matches.length === 0) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.COUNTERPARTY_NOT_FOUND,
      'WarrantyClaim.factoryCounterpartyId указывает на отсутствующий Counterparty.',
      409,
      { factoryCounterpartyId: id },
    );
  }
  if (matches.length > 1) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.COUNTERPARTY_DUPLICATE,
      'WarrantyClaim.factoryCounterpartyId должен разрешаться ровно в один Counterparty.',
      409,
      { factoryCounterpartyId: id, matches: matches.length },
    );
  }
  return matches[0];
}

function supplierAssignmentState(factoryCounterpartyId, data) {
  const id = relationId(factoryCounterpartyId);
  const assignments = readCollection(data, ROLE_ASSIGNMENTS_COLLECTION)
    .filter(item => relationId(item?.counterpartyId) === id)
    .filter(item => relationId(item?.roleCode) === 'supplier');
  const active = assignments.filter(isActiveAssignment);
  return { assignments, active };
}

function supplierProfileState(factoryCounterpartyId, data) {
  const id = relationId(factoryCounterpartyId);
  const profiles = readCollection(data, SUPPLIER_PROFILES_COLLECTION)
    .filter(item => relationId(item?.counterpartyId) === id);
  const active = profiles.filter(isActiveProfile);
  return { profiles, active };
}

function resolveWarrantyClaimFactoryCounterpartyRelation(claim, data, options = {}) {
  const factoryCounterpartyId = relationId(claim?.factoryCounterpartyId);
  const historical = options.historical ?? isTerminalWarrantyClaim(claim);
  if (!factoryCounterpartyId) {
    if (requiresWarrantyFactoryRelation(claim)) {
      throw counterpartyError(
        WARRANTY_FACTORY_CODES.RELATION_REQUIRED,
        'Для внешнего гарантийного взаимодействия требуется factoryCounterpartyId.',
        409,
        {
          warrantyClaimId: relationId(claim?.id) || null,
          status: lowerStatus(claim) || null,
          evidenceFields: FACTORY_EXTERNAL_EVIDENCE_FIELDS
            .filter(field => relationId(claim?.[field])),
        },
      );
    }
    return null;
  }

  const counterparty = uniqueCounterparty(factoryCounterpartyId, data);
  if (historical) {
    return { factoryCounterpartyId, counterparty, historical: true };
  }
  if (isArchivedCounterparty(counterparty)) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.COUNTERPARTY_ARCHIVED,
      'Активная гарантийная связь не может указывать на архивного Counterparty.',
      409,
      { factoryCounterpartyId },
    );
  }

  const assignmentState = supplierAssignmentState(factoryCounterpartyId, data);
  if (assignmentState.assignments.length !== 1 || assignmentState.active.length !== 1) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.SUPPLIER_ASSIGNMENT_INVALID,
      'Factory Counterparty должен иметь ровно одно authoritative active supplier назначение.',
      409,
      {
        factoryCounterpartyId,
        assignments: assignmentState.assignments.length,
        activeAssignments: assignmentState.active.length,
      },
    );
  }

  const profileState = supplierProfileState(factoryCounterpartyId, data);
  if (profileState.profiles.length !== 1 || profileState.active.length !== 1) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.SUPPLIER_PROFILE_INVALID,
      'Factory Counterparty должен иметь ровно один active SupplierProfile.',
      409,
      {
        factoryCounterpartyId,
        profiles: profileState.profiles.length,
        activeProfiles: profileState.active.length,
      },
    );
  }

  return {
    factoryCounterpartyId,
    counterparty,
    supplierAssignment: assignmentState.active[0],
    supplierProfile: profileState.active[0],
    historical: false,
  };
}

function canonicalizeWarrantyClaimFactoryCounterpartyRelation(claim, data, options = {}) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
    throw counterpartyError('WARRANTY_FACTORY_RECORD_INVALID', 'Warranty claim должен быть объектом.', 400);
  }
  const existing = options.existing && typeof options.existing === 'object'
    ? options.existing
    : null;
  const establishedId = relationId(existing?.factoryCounterpartyId);
  const requestedId = relationId(claim?.factoryCounterpartyId);

  if (establishedId && requestedId !== establishedId) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.IMMUTABLE,
      'Established WarrantyClaim.factoryCounterpartyId нельзя удалить или переназначить обычным обновлением.',
      409,
      {
        warrantyClaimId: relationId(existing?.id) || relationId(claim?.id) || null,
        factoryCounterpartyId: establishedId,
        requestedFactoryCounterpartyId: requestedId || null,
      },
    );
  }

  if (
    existing
    && !establishedId
    && requestedId
    && !options.allowControlledMapping
    && (requiresWarrantyFactoryRelation(existing) || isTerminalWarrantyClaim(existing))
  ) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.CONTROLLED_MAPPING_REQUIRED,
      'Existing unresolved Warranty factory history можно связать только controlled mapping tooling.',
      409,
      { warrantyClaimId: relationId(existing?.id) || null, factoryCounterpartyId: requestedId },
    );
  }

  const allowHistoricalTarget = options.allowHistoricalTarget
    ?? (Boolean(existing) && isTerminalWarrantyClaim(existing) && isTerminalWarrantyClaim(claim));
  const relation = resolveWarrantyClaimFactoryCounterpartyRelation(claim, data, {
    historical: Boolean(allowHistoricalTarget) && isTerminalWarrantyClaim(claim),
  });
  const next = { ...claim };
  if (!requestedId) delete next.factoryCounterpartyId;
  if (relation) next.factoryCounterpartyId = relation.factoryCounterpartyId;
  return next;
}

function warrantyClaimIdProblems(claims) {
  const counts = new Map();
  const missingIndexes = [];
  asArray(claims).forEach((claim, index) => {
    const id = relationId(claim?.id);
    if (!id) missingIndexes.push(index);
    else counts.set(id, (counts.get(id) || 0) + 1);
  });
  return {
    missingIndexes,
    duplicateIds: [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id),
  };
}

function canonicalizeWarrantyClaimFactoryCollection(claims, data, options = {}) {
  if (!Array.isArray(claims)) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.COLLECTION_INVALID,
      'Коллекция warranty_claims должна быть массивом.',
      400,
    );
  }
  const { missingIndexes, duplicateIds } = warrantyClaimIdProblems(claims);
  if (missingIndexes.length > 0) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.CLAIM_ID_REQUIRED,
      'Каждая Warranty claim должна иметь stable id.',
      409,
      { missingIndexes },
    );
  }
  if (duplicateIds.length > 0) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.DUPLICATE_CLAIM_ID,
      'Коллекция warranty_claims содержит duplicate stable claim id.',
      409,
      { duplicateIds },
    );
  }
  const existingById = new Map(asArray(options.existingClaims ?? readCollection(data, 'warranty_claims'))
    .map(claim => [relationId(claim?.id), claim]));
  return claims.map(claim => {
    const existing = existingById.get(relationId(claim?.id)) || null;
    return canonicalizeWarrantyClaimFactoryCounterpartyRelation(claim, data, {
      existing,
      allowControlledMapping: options.allowControlledMapping,
      allowHistoricalTarget: options.allowHistoricalTarget
        ?? (Boolean(existing) && isTerminalWarrantyClaim(existing) && isTerminalWarrantyClaim(claim)),
    });
  });
}

function canonicalizeWarrantyFactoryPersistenceEntries(entries, { readData }) {
  const normalized = asArray(entries).map(entry => ({ name: entry?.name, value: entry?.value }));
  if (!normalized.some(entry => FACTORY_PERSISTENCE_DEPENDENCIES.has(entry.name))) return normalized;
  if (normalized.filter(entry => entry.name === 'warranty_claims').length > 1) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.MULTIPLE_BATCH_ENTRIES,
      'Atomic batch не может содержать несколько replacement entries для warranty_claims.',
      409,
    );
  }
  const staged = new Map(normalized.map(entry => [entry.name, entry.value]));
  const stagedData = {
    readData(name) {
      return staged.has(name) ? staged.get(name) : (readData(name) || []);
    },
  };
  const warrantyEntry = normalized.find(entry => entry.name === 'warranty_claims');
  const currentClaims = readData('warranty_claims') || [];
  const claims = warrantyEntry ? warrantyEntry.value : currentClaims;
  const canonicalClaims = canonicalizeWarrantyClaimFactoryCollection(claims, stagedData, {
    existingClaims: currentClaims,
    // API paths validate new records before the shared boundary. This permits imported
    // terminal history to retain a real inactive/archived target, never to derive one.
    allowHistoricalTarget: true,
  });
  if (warrantyEntry) {
    warrantyEntry.value = canonicalClaims;
    staged.set('warranty_claims', canonicalClaims);
  }
  return normalized;
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function warrantyFactoryRelationStateFingerprint(data) {
  const state = {};
  for (const collection of FACTORY_PERSISTENCE_DEPENDENCIES) {
    state[collection] = readCollection(data, collection);
  }
  return crypto.createHash('sha256').update(stableValue(state)).digest('hex');
}

function auditMetadataMatchCount(claim, data) {
  const labels = [claim?.factoryName, claim?.manufacturer]
    .map(relationId)
    .filter(Boolean)
    .map(normalizedText);
  if (labels.length === 0) return 0;
  return readCollection(data, 'counterparties').filter(counterparty => {
    const names = [counterparty?.legalName, counterparty?.shortName]
      .map(relationId)
      .filter(Boolean)
      .map(normalizedText);
    return labels.some(label => names.includes(label));
  }).length;
}

function classificationForFactoryError(error) {
  if (error?.code === WARRANTY_FACTORY_CODES.COUNTERPARTY_NOT_FOUND) {
    return WARRANTY_FACTORY_CLASSIFICATIONS.MISSING_CANONICAL_TARGET;
  }
  if ([
    WARRANTY_FACTORY_CODES.COUNTERPARTY_DUPLICATE,
    WARRANTY_FACTORY_CODES.DUPLICATE_CLAIM_ID,
    WARRANTY_FACTORY_CODES.CLAIM_ID_REQUIRED,
  ].includes(error?.code)) {
    return WARRANTY_FACTORY_CLASSIFICATIONS.DUPLICATE_BROKEN_STABLE_TARGET;
  }
  if (error?.code === WARRANTY_FACTORY_CODES.COUNTERPARTY_ARCHIVED) {
    return WARRANTY_FACTORY_CLASSIFICATIONS.ARCHIVED_ACTIVE_TARGET;
  }
  if (error?.code === WARRANTY_FACTORY_CODES.SUPPLIER_ASSIGNMENT_INVALID) {
    return WARRANTY_FACTORY_CLASSIFICATIONS.MISSING_INACTIVE_SUPPLIER_ASSIGNMENT;
  }
  if (error?.code === WARRANTY_FACTORY_CODES.SUPPLIER_PROFILE_INVALID) {
    return WARRANTY_FACTORY_CLASSIFICATIONS.MISSING_INACTIVE_SUPPLIER_PROFILE;
  }
  return WARRANTY_FACTORY_CLASSIFICATIONS.BLOCKED_MANUAL_MAPPING;
}

function auditWarrantyClaimFactoryCounterpartyRelations(data) {
  const claims = readCollection(data, 'warranty_claims');
  const { missingIndexes, duplicateIds } = warrantyClaimIdProblems(claims);
  const duplicateSet = new Set(duplicateIds);
  const entries = claims.map((claim, index) => {
    const recordId = relationId(claim?.id) || null;
    const factoryCounterpartyId = relationId(claim?.factoryCounterpartyId) || null;
    const terminal = isTerminalWarrantyClaim(claim);
    const relationRequired = requiresWarrantyFactoryRelation(claim);
    const activeExternal = !terminal && (relationRequired || Boolean(factoryCounterpartyId));
    const base = {
      domain: 'warranty_claims',
      recordId,
      factoryCounterpartyId,
      status: lowerStatus(claim) || null,
      terminal,
      activeExternal,
    };
    if (!recordId || duplicateSet.has(recordId)) {
      return {
        ...base,
        classification: WARRANTY_FACTORY_CLASSIFICATIONS.DUPLICATE_BROKEN_STABLE_TARGET,
        code: recordId ? WARRANTY_FACTORY_CODES.DUPLICATE_CLAIM_ID : WARRANTY_FACTORY_CODES.CLAIM_ID_REQUIRED,
        repairability: 'none',
        context: recordId ? { matches: duplicateIds.filter(id => id === recordId).length + 1 } : { index },
      };
    }
    if (!factoryCounterpartyId) {
      const snapshotFields = FACTORY_SNAPSHOT_FIELDS.filter(field => relationId(claim?.[field]));
      if (terminal) {
        return {
          ...base,
          classification: WARRANTY_FACTORY_CLASSIFICATIONS.UNRESOLVED_TERMINAL_HISTORICAL_SNAPSHOT,
          code: null,
          repairability: 'explicit_mapping_optional',
          snapshotFields,
        };
      }
      if (!relationRequired) {
        return {
          ...base,
          classification: WARRANTY_FACTORY_CLASSIFICATIONS.VALID_PRE_EXTERNAL_DRAFT,
          code: null,
          repairability: 'not_needed',
          snapshotFields,
        };
      }
      const metadataMatches = auditMetadataMatchCount(claim, data);
      return {
        ...base,
        classification: metadataMatches > 1
          ? WARRANTY_FACTORY_CLASSIFICATIONS.AMBIGUOUS_METADATA
          : WARRANTY_FACTORY_CLASSIFICATIONS.BLOCKED_MANUAL_MAPPING,
        code: WARRANTY_FACTORY_CODES.RELATION_REQUIRED,
        repairability: 'explicit_mapping_required',
        metadataMatches,
        snapshotFields,
      };
    }
    try {
      const relation = resolveWarrantyClaimFactoryCounterpartyRelation(claim, data, {
        historical: terminal,
      });
      if (terminal) {
        return {
          ...base,
          classification: WARRANTY_FACTORY_CLASSIFICATIONS.CANONICAL_TERMINAL_HISTORY,
          code: null,
          repairability: 'not_needed',
        };
      }
      return {
        ...base,
        classification: WARRANTY_FACTORY_CLASSIFICATIONS.CANONICAL,
        code: null,
        repairability: 'not_needed',
        supplierProfileId: relation?.supplierProfile?.id || null,
      };
    } catch (error) {
      return {
        ...base,
        classification: classificationForFactoryError(error),
        code: error?.code || 'WARRANTY_FACTORY_AUDIT_FAILED',
        repairability: 'explicit_mapping_or_supplier_lifecycle',
        ...(error?.details ? { context: error.details } : {}),
      };
    }
  });

  const classifications = Object.values(WARRANTY_FACTORY_CLASSIFICATIONS)
    .reduce((summary, classification) => ({ ...summary, [classification]: 0 }), {});
  for (const entry of entries) classifications[entry.classification] += 1;
  const accepted = new Set([
    WARRANTY_FACTORY_CLASSIFICATIONS.CANONICAL,
    WARRANTY_FACTORY_CLASSIFICATIONS.CANONICAL_TERMINAL_HISTORY,
    WARRANTY_FACTORY_CLASSIFICATIONS.VALID_PRE_EXTERNAL_DRAFT,
    WARRANTY_FACTORY_CLASSIFICATIONS.UNRESOLVED_TERMINAL_HISTORICAL_SNAPSHOT,
  ]);
  const broken = entries.filter(entry => !accepted.has(entry.classification));
  const strictRolloutBlockers = entries.filter(entry => entry.activeExternal
    && entry.classification !== WARRANTY_FACTORY_CLASSIFICATIONS.CANONICAL);
  return {
    ok: broken.length === 0,
    strictRolloutReady: strictRolloutBlockers.length === 0,
    authority: 'WarrantyClaim.factoryCounterpartyId -> Counterparty.id -> active supplier RoleAssignment -> active SupplierProfile',
    fingerprint: warrantyFactoryRelationStateFingerprint(data),
    entries,
    strictRolloutBlockers: strictRolloutBlockers.map(entry => ({
      recordId: entry.recordId,
      classification: entry.classification,
      code: entry.code,
    })),
    summary: {
      classifications,
      scanned: { warranty_claims: claims.length },
      missingIds: missingIndexes.length,
      duplicateIds: duplicateIds.length,
      broken: broken.length,
      activeExternalUnresolved: strictRolloutBlockers.length,
    },
  };
}

function assertWarrantyFactoryStrictRolloutReady(audit) {
  if (audit?.strictRolloutReady !== false) return audit;
  throw counterpartyError(
    'WARRANTY_FACTORY_STRICT_ROLLOUT_BLOCKED',
    'Strict rollout blocked: active external Warranty claims require explicit factory mapping or supplier lifecycle repair.',
    503,
    { blockers: audit.strictRolloutBlockers || [] },
  );
}

function activeWarrantyFactoryCounterpartyReferences(counterpartyId, data) {
  const id = relationId(counterpartyId);
  if (!id) return [];
  return readCollection(data, 'warranty_claims')
    .filter(claim => !isTerminalWarrantyClaim(claim))
    .filter(claim => relationId(claim?.factoryCounterpartyId) === id);
}

function decorateWarrantyClaimFactoryCounterparty(claim, data) {
  const factoryCounterpartyId = relationId(claim?.factoryCounterpartyId);
  if (!factoryCounterpartyId) return claim;
  const matches = readCollection(data, 'counterparties')
    .filter(item => relationId(item?.id) === factoryCounterpartyId);
  if (matches.length !== 1) return claim;
  const counterparty = matches[0];
  const displayName = relationId(counterparty?.shortName || counterparty?.legalName);
  return {
    ...claim,
    factoryCounterpartyId,
    ...(displayName ? { factoryCounterpartyDisplayName: displayName } : {}),
  };
}

function listEligibleWarrantyFactoryCounterparties(data) {
  const unique = new Map();
  const duplicateIds = new Set();
  for (const counterparty of readCollection(data, 'counterparties')) {
    const id = relationId(counterparty?.id);
    if (!id || unique.has(id)) {
      if (id) duplicateIds.add(id);
      continue;
    }
    unique.set(id, counterparty);
  }
  const eligible = [];
  for (const [id, counterparty] of unique) {
    if (duplicateIds.has(id) || isArchivedCounterparty(counterparty)) continue;
    const assignments = supplierAssignmentState(id, data);
    const profiles = supplierProfileState(id, data);
    if (assignments.assignments.length !== 1 || assignments.active.length !== 1) continue;
    if (profiles.profiles.length !== 1 || profiles.active.length !== 1) continue;
    eligible.push({
      id,
      name: relationId(counterparty?.shortName || counterparty?.legalName) || id,
    });
  }
  const nameCounts = new Map();
  for (const option of eligible) nameCounts.set(option.name, (nameCounts.get(option.name) || 0) + 1);
  return eligible
    .map(option => ({
      id: option.id,
      displayLabel: (nameCounts.get(option.name) || 0) > 1
        ? `${option.name} · ${option.id.slice(-8)}`
        : option.name,
    }))
    .sort((left, right) => left.displayLabel.localeCompare(right.displayLabel, 'ru'));
}

function normalizeMappingManifest(manifest) {
  const mappings = Array.isArray(manifest) ? manifest : manifest?.mappings;
  if (!Array.isArray(mappings)) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.MANIFEST_INVALID,
      'Mapping manifest должен содержать массив mappings.',
      400,
    );
  }
  const normalized = mappings.map((mapping, index) => {
    const claimId = relationId(mapping?.claimId);
    const factoryCounterpartyId = relationId(mapping?.factoryCounterpartyId);
    if (!claimId || !factoryCounterpartyId) {
      throw counterpartyError(
        WARRANTY_FACTORY_CODES.MANIFEST_INVALID,
        'Каждый mapping требует claimId и factoryCounterpartyId.',
        400,
        { index },
      );
    }
    return { claimId, factoryCounterpartyId };
  });
  const counts = new Map();
  for (const mapping of normalized) counts.set(mapping.claimId, (counts.get(mapping.claimId) || 0) + 1);
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([claimId]) => claimId);
  if (duplicates.length > 0) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.DUPLICATE_MAPPING,
      'Mapping manifest содержит несколько значений для одного claimId.',
      409,
      { claimIds: duplicates },
    );
  }
  return normalized;
}

function planWarrantyClaimFactoryCounterpartyMappings({ readData, manifest, expectedFingerprint = null }) {
  const data = { readData };
  const fingerprint = warrantyFactoryRelationStateFingerprint(data);
  if (expectedFingerprint && fingerprint !== expectedFingerprint) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.MAPPING_PRECONDITION_CHANGED,
      'Warranty factory source state изменился после dry-run; apply остановлен.',
      409,
      { expectedFingerprint, actualFingerprint: fingerprint },
    );
  }
  const mappings = normalizeMappingManifest(manifest);
  const claims = readData('warranty_claims') || [];
  const { missingIndexes, duplicateIds } = warrantyClaimIdProblems(claims);
  if (missingIndexes.length > 0 || duplicateIds.length > 0) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.DUPLICATE_CLAIM_ID,
      'Mapping blocked: warranty_claims содержит missing или duplicate claim IDs.',
      409,
      { missingIndexes, duplicateIds },
    );
  }
  const claimsById = new Map(claims.map(claim => [relationId(claim?.id), claim]));
  const changes = [];
  const noops = [];
  for (const mapping of mappings) {
    const claim = claimsById.get(mapping.claimId);
    if (!claim) {
      throw counterpartyError(
        WARRANTY_FACTORY_CODES.CLAIM_ID_REQUIRED,
        'Mapping claimId не найден.',
        409,
        { claimId: mapping.claimId },
      );
    }
    const establishedId = relationId(claim?.factoryCounterpartyId);
    if (establishedId && establishedId !== mapping.factoryCounterpartyId) {
      throw counterpartyError(
        WARRANTY_FACTORY_CODES.MAPPING_CONFLICT,
        'Mapping не может заменить established factoryCounterpartyId.',
        409,
        { claimId: mapping.claimId, establishedId, requestedId: mapping.factoryCounterpartyId },
      );
    }
    const next = canonicalizeWarrantyClaimFactoryCounterpartyRelation(
      { ...claim, factoryCounterpartyId: mapping.factoryCounterpartyId },
      data,
      {
        existing: claim,
        allowControlledMapping: true,
        allowHistoricalTarget: isTerminalWarrantyClaim(claim),
      },
    );
    if (establishedId === mapping.factoryCounterpartyId) noops.push(mapping);
    else changes.push({ ...mapping, next });
  }
  return {
    dryRun: true,
    sourceFingerprint: fingerprint,
    mappings: mappings.length,
    changedRecords: changes.length,
    noopRecords: noops.length,
    changes: changes.map(({ claimId, factoryCounterpartyId }) => ({ claimId, factoryCounterpartyId })),
    nextClaims: claims.map(claim => changes.find(change => change.claimId === relationId(claim?.id))?.next || claim),
  };
}

function applyWarrantyClaimFactoryCounterpartyMappings({
  readData,
  writeDataBatch,
  manifest,
  expectedFingerprint,
}) {
  if (!relationId(expectedFingerprint)) {
    throw counterpartyError(
      WARRANTY_FACTORY_CODES.MANIFEST_INVALID,
      'Apply требует sourceFingerprint из отдельного dry-run.',
      400,
    );
  }
  const plan = planWarrantyClaimFactoryCounterpartyMappings({
    readData,
    manifest,
    expectedFingerprint,
  });
  if (plan.changedRecords > 0) {
    if (typeof writeDataBatch !== 'function') throw new Error('writeDataBatch is required for apply');
    writeDataBatch([{ name: 'warranty_claims', value: plan.nextClaims }]);
  }
  return {
    ...plan,
    dryRun: false,
    wrote: plan.changedRecords > 0,
    nextClaims: undefined,
  };
}

module.exports = {
  EXTERNAL_FACTORY_STATUSES,
  FACTORY_EXTERNAL_EVIDENCE_FIELDS,
  FACTORY_SNAPSHOT_FIELDS,
  PRE_EXTERNAL_FACTORY_STATUSES,
  WARRANTY_FACTORY_CLASSIFICATIONS,
  WARRANTY_FACTORY_CODES,
  activeWarrantyFactoryCounterpartyReferences,
  applyWarrantyClaimFactoryCounterpartyMappings,
  assertWarrantyFactoryStrictRolloutReady,
  auditWarrantyClaimFactoryCounterpartyRelations,
  canonicalizeWarrantyClaimFactoryCollection,
  canonicalizeWarrantyClaimFactoryCounterpartyRelation,
  canonicalizeWarrantyFactoryPersistenceEntries,
  decorateWarrantyClaimFactoryCounterparty,
  hasFactoryExternalEvidence,
  listEligibleWarrantyFactoryCounterparties,
  normalizeMappingManifest,
  planWarrantyClaimFactoryCounterpartyMappings,
  requiresWarrantyFactoryRelation,
  resolveWarrantyClaimFactoryCounterpartyRelation,
  warrantyFactoryRelationStateFingerprint,
};
