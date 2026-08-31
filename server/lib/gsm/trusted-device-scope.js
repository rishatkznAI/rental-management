function toText(value) {
  return String(value ?? '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const INACTIVE_GSM_DEVICE_STATUSES = new Set([
  'disabled',
  'inactive',
  'retired',
  'revoked',
]);

// Binding timestamps are written by the server clock. A short tolerance keeps
// harmless host-clock drift from quarantining a binding while preventing a
// far-future timestamp from remaining authoritative indefinitely.
const GSM_BINDING_FUTURE_SKEW_MS = 5 * 60 * 1000;
const GSM_IMEI_PATTERN = /^[a-z0-9._:-]+$/i;
const GSM_DEVICE_IDENTIFIER_PATTERN = /^[a-z0-9._:@/-]+$/i;
const GSM_PROJECTION_COMPARE_MAX_DEPTH = 16;
const GSM_PROJECTION_COMPARE_MAX_KEYS = 1024;
const GSM_PROJECTION_COMPARE_MAX_NODES = 4096;
// Production JSON requests are capped at 20 MiB. Equality accounts for both
// the imported projection and its stored counterpart, so the scalar budget is
// twice that transport ceiling while depth/node limits still bound traversal.
const GSM_PROJECTION_COMPARE_MAX_SCALAR_CHARS = 2 * 20 * 1024 * 1024;

// `gsm_devices` is the canonical configuration record and the gateway is the
// canonical telemetry writer. These fields are only a backwards-compatible
// read projection on equipment; generic equipment CRUD must never become a
// second provisioning/telemetry authority.
const EQUIPMENT_GSM_PROJECTION_FIELDS = Object.freeze([
  'gsmImei',
  'gsmDeviceRecordId',
  'gsmDeviceId',
  'gsmTrackerId',
  'gsmSimNumber',
  'gsmProtocol',
  'gsmStatus',
  'gsmSignalStatus',
  'gsmLastSeenAt',
  'gsmLastSignalAt',
  'gsmLastLat',
  'gsmLastLng',
  'gsmLatitude',
  'gsmLongitude',
  'gsmLastSpeed',
  'gsmSpeedKph',
  'gsmLastVoltage',
  'gsmBatteryVoltage',
  'gsmLastMotoHours',
  'gsmHourmeter',
  'gsmIgnitionOn',
  'gsmMovementHistory',
  'gsmAddress',
  'gsmCreatedAt',
]);

const EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS = Object.freeze([
  'gsmDeviceRecordId',
  'gsmImei',
  'gsmDeviceId',
  'gsmTrackerId',
  'gsmSimNumber',
  'gsmProtocol',
]);

function isEmptyEquipmentGsmProjectionValue(field, value) {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return (field === 'gsmStatus' || field === 'gsmSignalStatus')
    && toText(value).toLowerCase() === 'unknown';
}

function boundedJsonStructuralEqual(left, right) {
  const state = {
    nodes: 0,
    scalarChars: 0,
    seenLeft: new WeakSet(),
    seenRight: new WeakSet(),
  };

  function compare(leftValue, rightValue, depth) {
    state.nodes += 1;
    if (state.nodes > GSM_PROJECTION_COMPARE_MAX_NODES || depth > GSM_PROJECTION_COMPARE_MAX_DEPTH) {
      return false;
    }
    const leftType = typeof leftValue;
    const rightType = typeof rightValue;
    if (leftType === 'string' || rightType === 'string') {
      if (leftType !== 'string' || rightType !== 'string') return false;
      state.scalarChars += leftValue.length + rightValue.length;
      if (state.scalarChars > GSM_PROJECTION_COMPARE_MAX_SCALAR_CHARS) return false;
    }
    if (leftType === 'number' || rightType === 'number') {
      if (leftType !== 'number' || rightType !== 'number') return false;
      if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return false;
    }
    if (['bigint', 'function', 'symbol'].includes(leftType) || leftType !== rightType) return false;
    if (leftValue === rightValue) return true;
    if (
      leftValue === null
      || rightValue === null
      || leftType !== 'object'
      || state.seenLeft.has(leftValue)
      || state.seenRight.has(rightValue)
    ) return false;

    const leftIsArray = Array.isArray(leftValue);
    const rightIsArray = Array.isArray(rightValue);
    if (leftIsArray !== rightIsArray) return false;
    if (leftIsArray && leftValue.length !== rightValue.length) return false;
    const leftPrototype = Object.getPrototypeOf(leftValue);
    const rightPrototype = Object.getPrototypeOf(rightValue);
    if (leftIsArray) {
      if (leftPrototype !== Array.prototype || rightPrototype !== Array.prototype) return false;
    } else if (
      ![Object.prototype, null].includes(leftPrototype)
      || ![Object.prototype, null].includes(rightPrototype)
    ) return false;
    if (
      Object.getOwnPropertySymbols(leftValue).length > 0
      || Object.getOwnPropertySymbols(rightValue).length > 0
    ) return false;

    const leftKeys = Object.keys(leftValue);
    const rightKeys = Object.keys(rightValue);
    if (
      leftKeys.length !== rightKeys.length
      || leftKeys.length > GSM_PROJECTION_COMPARE_MAX_KEYS
      || rightKeys.length > GSM_PROJECTION_COMPARE_MAX_KEYS
    ) return false;
    leftKeys.sort();
    rightKeys.sort();
    for (let index = 0; index < leftKeys.length; index += 1) {
      if (leftKeys[index] !== rightKeys[index]) return false;
      state.scalarChars += leftKeys[index].length + rightKeys[index].length;
      if (state.scalarChars > GSM_PROJECTION_COMPARE_MAX_SCALAR_CHARS) return false;
    }

    state.seenLeft.add(leftValue);
    state.seenRight.add(rightValue);
    for (const key of leftKeys) {
      const leftDescriptor = Object.getOwnPropertyDescriptor(leftValue, key);
      const rightDescriptor = Object.getOwnPropertyDescriptor(rightValue, key);
      if (
        !leftDescriptor
        || !rightDescriptor
        || !Object.prototype.hasOwnProperty.call(leftDescriptor, 'value')
        || !Object.prototype.hasOwnProperty.call(rightDescriptor, 'value')
        || !compare(leftDescriptor.value, rightDescriptor.value, depth + 1)
      ) return false;
    }
    return true;
  }

  try {
    return compare(left, right, 0);
  } catch {
    return false;
  }
}

function equipmentGsmProjectionValuesEqual(field, left, right) {
  if (
    isEmptyEquipmentGsmProjectionValue(field, left)
    && isEmptyEquipmentGsmProjectionValue(field, right)
  ) return true;
  if (Object.is(left, right)) return true;
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    return boundedJsonStructuralEqual(left, right);
  }
  return false;
}

function canonicalEquipmentGsmConfigurationProjection(device = {}) {
  const fallbackDeviceId = toText(device.deviceId || device.trackerId || device.imei) || null;
  const fallbackTrackerId = toText(device.trackerId || device.deviceId || device.imei) || null;
  return Object.freeze({
    gsmDeviceRecordId: toText(device.id) || null,
    gsmImei: toText(device.imei) || null,
    gsmDeviceId: fallbackDeviceId,
    gsmTrackerId: fallbackTrackerId,
    gsmSimNumber: toText(device.sim1) || null,
    gsmProtocol: toText(device.protocol) || null,
  });
}

function applyEquipmentGsmConfigurationProjection(record = {}, device = {}) {
  return {
    ...record,
    ...canonicalEquipmentGsmConfigurationProjection(device),
  };
}

function equipmentGsmConfigurationProjectionIssue(record = {}, device = {}, {
  allowLegacyIncomplete = false,
} = {}) {
  const expected = canonicalEquipmentGsmConfigurationProjection(device);
  const mismatchedFields = EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS.filter((field) => {
    const actualValue = toText(record?.[field]) || null;
    const expectedValue = expected[field];
    if (actualValue === expectedValue) return false;
    return !(allowLegacyIncomplete && actualValue === null);
  });
  return mismatchedFields.length > 0
    ? Object.freeze({ code: 'equipment_configuration_projection_mismatch', mismatchedFields })
    : null;
}

function assertEquipmentGsmProjectionMutation(input, { current = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return true;
  const suppliedFields = Object.keys(input).filter(field => /^gsm/i.test(field));
  const changedFields = suppliedFields.filter((field) => {
    if (!current) return !isEmptyEquipmentGsmProjectionValue(field, input[field]);
    return !equipmentGsmProjectionValuesEqual(field, input[field], current[field]);
  }).sort();
  if (changedFields.length === 0) return true;
  fail(
    'GSM_EQUIPMENT_PROJECTION_WRITE_DENIED',
    'GSM-поля техники изменяются только через канонический lifecycle GSM-устройства.',
    409,
    { changedFields },
  );
}

function stripEquipmentGsmProjectionFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const next = { ...input };
  for (const field of Object.keys(next)) {
    if (/^gsm/i.test(field)) delete next[field];
  }
  return next;
}

function preserveEquipmentGsmProjection(input, current = null) {
  const next = stripEquipmentGsmProjectionFields(input);
  if (!current || typeof current !== 'object') return next;
  for (const field of Object.keys(current).filter(key => /^gsm/i.test(key))) {
    if (Object.prototype.hasOwnProperty.call(current, field)) next[field] = current[field];
  }
  return next;
}

function gsmDeviceIdentityValues(device = {}) {
  return [...new Set([
    toText(device.imei),
    toText(device.deviceId),
    toText(device.trackerId),
  ].filter(Boolean))];
}

function gsmBindingHistoryIdentityValues(entry = {}) {
  return [...new Set([
    toText(entry.imei),
    toText(entry.deviceId),
    toText(entry.trackerId),
    ...asArray(entry.identities).map(toText),
  ].filter(Boolean))];
}

function gsmDeviceReservedIdentityValues(device = {}) {
  return [...new Set([
    ...gsmDeviceIdentityValues(device),
    ...gsmDeviceBindingHistory(device).flatMap(gsmBindingHistoryIdentityValues),
  ].filter(Boolean))];
}

function isActiveGsmDeviceRecord(device = {}) {
  return !INACTIVE_GSM_DEVICE_STATUSES.has(toText(device.status).toLowerCase());
}

function positiveBindingRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : null;
}

function gsmDeviceBindingHistory(device = {}) {
  return asArray(device.bindingHistory)
    .filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map(entry => ({ ...entry }));
}

function gsmDeviceBindingRevision(device = {}) {
  const explicit = positiveBindingRevision(device.bindingRevision);
  if (explicit) return explicit;
  const revisions = gsmDeviceBindingHistory(device)
    .map(entry => positiveBindingRevision(entry.revision))
    .filter(Boolean);
  return revisions.length > 0 ? Math.max(...revisions) : 1;
}

function isCanonicalStoredGsmIdentifier(value, {
  maxLength,
  pattern,
  optional = true,
} = {}) {
  if (value === undefined || value === null || value === '') return optional;
  if (typeof value !== 'string' || value !== value.trim()) return false;
  return value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value)
    && pattern.test(value);
}

function gsmDeviceStoredIdentitiesValid(device = {}) {
  return isCanonicalStoredGsmIdentifier(device.imei, {
    maxLength: 64,
    pattern: GSM_IMEI_PATTERN,
  }) && isCanonicalStoredGsmIdentifier(device.deviceId, {
    maxLength: 128,
    pattern: GSM_DEVICE_IDENTIFIER_PATTERN,
  }) && isCanonicalStoredGsmIdentifier(device.trackerId, {
    maxLength: 128,
    pattern: GSM_DEVICE_IDENTIFIER_PATTERN,
  });
}

function gsmBindingHistoryStoredIdentitiesValid(entry = {}) {
  if (!gsmDeviceStoredIdentitiesValid(entry)) return false;
  if (!Object.prototype.hasOwnProperty.call(entry, 'identities') || entry.identities == null) {
    return true;
  }
  if (!Array.isArray(entry.identities)) return false;
  const aliases = entry.identities;
  if (!aliases.every(alias => isCanonicalStoredGsmIdentifier(alias, {
    maxLength: 128,
    pattern: GSM_DEVICE_IDENTIFIER_PATTERN,
    optional: false,
  }))) return false;
  const uniqueAliases = new Set(aliases);
  if (uniqueAliases.size !== aliases.length) return false;
  const provenance = new Set([
    entry.imei,
    entry.deviceId,
    entry.trackerId,
  ].filter(Boolean));
  return uniqueAliases.size === provenance.size
    && [...uniqueAliases].every(alias => provenance.has(alias));
}

function gsmBindingHistoryEntry(device, revision = gsmDeviceBindingRevision(device)) {
  const safeRevision = positiveBindingRevision(revision);
  if (!safeRevision) return null;
  const matches = gsmDeviceBindingHistory(device)
    .filter(entry => positiveBindingRevision(entry.revision) === safeRevision);
  return matches.length === 1 ? matches[0] : null;
}

function gsmDeviceBindingAtRevision(device = {}, revision) {
  const safeRevision = positiveBindingRevision(revision);
  if (!safeRevision) return null;
  const history = gsmDeviceBindingHistory(device);
  if (history.length > 0) return gsmBindingHistoryEntry(device, safeRevision);
  if (safeRevision !== gsmDeviceBindingRevision(device)) return null;
  return {
    revision: safeRevision,
    equipmentId: toText(device.equipmentId) || null,
    companyId: toText(device.companyId) || null,
    tenantId: toText(device.tenantId) || null,
    imei: toText(device.imei) || null,
    deviceId: toText(device.deviceId || device.trackerId) || null,
    trackerId: toText(device.trackerId) || null,
    identities: gsmDeviceIdentityValues(device),
    linkedAt: toText(device.updatedAt || device.createdAt) || null,
    unlinkedAt: isActiveGsmDeviceRecord(device) ? null : (toText(device.retiredAt) || 'legacy_inactive'),
    reason: 'legacy_current_binding',
  };
}

function gsmDeviceBindingLifecycleIssue(device = {}, {
  allowLegacyNoHistory = false,
  nowMs = Date.now(),
} = {}) {
  const deviceRecordId = toText(device.id);
  const equipmentId = toText(device.equipmentId);
  const identities = gsmDeviceIdentityValues(device);
  if (!deviceRecordId || !equipmentId || identities.length === 0) return 'identity_or_stable_link_missing';
  if (!gsmDeviceStoredIdentitiesValid(device)) return 'binding_identity_invalid';
  const observedAtMs = Number(nowMs);
  if (!Number.isFinite(observedAtMs)) return 'binding_clock_invalid';
  const latestAllowedBindingAtMs = observedAtMs + GSM_BINDING_FUTURE_SKEW_MS;
  const history = gsmDeviceBindingHistory(device);
  const explicitRevision = positiveBindingRevision(device.bindingRevision);
  if (history.length === 0) {
    const legacyLinkedAtText = toText(device.updatedAt || device.createdAt);
    const legacyLinkedAtMs = legacyLinkedAtText ? Date.parse(legacyLinkedAtText) : null;
    if (Number.isFinite(legacyLinkedAtMs) && legacyLinkedAtMs > latestAllowedBindingAtMs) {
      return 'binding_timestamp_in_future';
    }
    return allowLegacyNoHistory && (!explicitRevision || explicitRevision === 1)
      ? null
      : 'binding_history_missing';
  }
  if (!history.every(gsmBindingHistoryStoredIdentitiesValid)) return 'binding_identity_invalid';
  const historyHasFutureTimestamp = history.some((entry) => {
    const linkedAtMs = Date.parse(toText(entry.linkedAt));
    const unlinkedAtText = toText(entry.unlinkedAt);
    const unlinkedAtMs = unlinkedAtText ? Date.parse(unlinkedAtText) : null;
    return (Number.isFinite(linkedAtMs) && linkedAtMs > latestAllowedBindingAtMs)
      || (Number.isFinite(unlinkedAtMs) && unlinkedAtMs > latestAllowedBindingAtMs);
  });
  if (historyHasFutureTimestamp) return 'binding_timestamp_in_future';
  const revisions = history.map(entry => positiveBindingRevision(entry.revision));
  const revision = gsmDeviceBindingRevision(device);
  const currentEntries = history.filter(entry => positiveBindingRevision(entry.revision) === revision);
  const currentEntry = currentEntries[0] || null;
  const maxRevision = revisions.every(Boolean) ? Math.max(...revisions) : null;
  const historyEntriesValid = history.every((entry, index) => {
    const entryRevision = positiveBindingRevision(entry.revision);
    const previousRevision = index > 0 ? positiveBindingRevision(history[index - 1]?.revision) : null;
    const previousLinkedAtMs = index > 0
      ? Date.parse(toText(history[index - 1]?.linkedAt))
      : null;
    const previousUnlinkedAtText = index > 0 ? toText(history[index - 1]?.unlinkedAt) : '';
    const previousUnlinkedAtMs = previousUnlinkedAtText
      ? Date.parse(previousUnlinkedAtText)
      : null;
    const linkedAtMs = Date.parse(toText(entry.linkedAt));
    const unlinkedAtText = toText(entry.unlinkedAt);
    const unlinkedAtMs = unlinkedAtText ? Date.parse(unlinkedAtText) : null;
    return Boolean(
      entryRevision
      && toText(entry.equipmentId)
      && Number.isFinite(linkedAtMs)
      && (!unlinkedAtText || (Number.isFinite(unlinkedAtMs) && unlinkedAtMs >= linkedAtMs))
      && (index === 0 || (previousRevision && entryRevision > previousRevision))
      && (index === 0 || (Number.isFinite(previousLinkedAtMs) && linkedAtMs >= previousLinkedAtMs))
      && (index === 0 || !previousUnlinkedAtText || (
        Number.isFinite(previousUnlinkedAtMs) && linkedAtMs >= previousUnlinkedAtMs
      ))
    );
  });
  const currentIdentity = toText(device.deviceId || device.trackerId);
  const currentIdentities = gsmDeviceIdentityValues(device);
  const invalid = !historyEntriesValid
    || revisions.some(item => !item)
    || new Set(revisions).size !== revisions.length
    || currentEntries.length !== 1
    || revision !== maxRevision
    || positiveBindingRevision(history.at(-1)?.revision) !== revision
    || history.some(entry => (
      positiveBindingRevision(entry.revision) !== revision && !toText(entry.unlinkedAt)
    ))
    || history.some(entry => (
      toText(entry.companyId) !== toText(device.companyId)
      || toText(entry.tenantId) !== toText(device.tenantId)
      || (!toText(entry.imei) && !toText(entry.deviceId))
    ))
    || toText(currentEntry?.equipmentId) !== equipmentId
    || toText(currentEntry?.companyId) !== toText(device.companyId)
    || toText(currentEntry?.tenantId) !== toText(device.tenantId)
    || toText(currentEntry?.imei) !== toText(device.imei)
    || toText(currentEntry?.deviceId) !== currentIdentity
    || (toText(currentEntry?.trackerId) && toText(currentEntry?.trackerId) !== toText(device.trackerId))
    || (Array.isArray(currentEntry?.identities) && currentIdentities.some(
      identity => !gsmBindingHistoryIdentityValues(currentEntry).includes(identity)
    ))
    || (isActiveGsmDeviceRecord(device) ? Boolean(currentEntry?.unlinkedAt) : !toText(currentEntry?.unlinkedAt));
  return invalid ? 'binding_history_invalid' : null;
}

function gsmCurrentDeviceBindingIssue(device = {}, {
  devices = [],
  equipment = [],
  allowLegacyNoHistory = false,
  nowMs = Date.now(),
} = {}) {
  const deviceRecordId = toText(device.id);
  const equipmentId = toText(device.equipmentId);
  const lifecycleIssue = gsmDeviceBindingLifecycleIssue(device, { allowLegacyNoHistory, nowMs });
  if (lifecycleIssue) return lifecycleIssue;
  if (!isActiveGsmDeviceRecord(device)) return 'device_inactive';
  const recordMatches = asArray(devices).filter(item => toText(item?.id) === deviceRecordId);
  if (recordMatches.length !== 1) return 'device_record_ambiguous';
  const identities = new Set(gsmDeviceReservedIdentityValues(device));
  const identityMatches = asArray(devices).filter(item => (
    gsmDeviceReservedIdentityValues(item).some(identity => identities.has(identity))
  ));
  if (identityMatches.length !== 1 || toText(identityMatches[0]?.id) !== deviceRecordId) {
    return 'device_identity_ambiguous';
  }
  const activeEquipmentDevices = asArray(devices).filter(item => (
    isActiveGsmDeviceRecord(item) && toText(item.equipmentId) === equipmentId
  ));
  if (
    activeEquipmentDevices.length !== 1
    || toText(activeEquipmentDevices[0]?.id) !== deviceRecordId
  ) return 'equipment_device_ambiguous';
  const equipmentMatches = asArray(equipment).filter(item => toText(item?.id) === equipmentId);
  if (equipmentMatches.length !== 1) return 'equipment_record_ambiguous';
  const equipmentRecord = equipmentMatches[0];
  if (
    toText(device.companyId) !== toText(device.tenantId)
    || !toText(device.companyId)
    || toText(equipmentRecord.companyId) !== toText(device.companyId)
    || toText(equipmentRecord.tenantId) !== toText(device.tenantId)
  ) return 'device_equipment_scope_mismatch';
  const legacyNoHistory = gsmDeviceBindingHistory(device).length === 0;
  if (equipmentGsmConfigurationProjectionIssue(equipmentRecord, device, {
    allowLegacyIncomplete: allowLegacyNoHistory && legacyNoHistory,
  })) return 'equipment_projection_mismatch';
  const binding = gsmDeviceBindingAtRevision(device, gsmDeviceBindingRevision(device));
  if (!binding || binding.unlinkedAt) return 'current_binding_closed';
  return null;
}

function resolveTrustedStoredGsmBinding(record = {}, {
  devices = [],
  equipment = [],
  currentOnly = false,
} = {}) {
  const deviceRecordId = toText(record.gsmDeviceRecordId);
  const revision = positiveBindingRevision(record.gsmBindingRevision);
  if (!deviceRecordId || !revision) return null;
  const scopedDevices = asArray(devices);
  const matches = scopedDevices.filter(device => toText(device?.id) === deviceRecordId);
  if (matches.length !== 1) return null;
  const device = matches[0];
  if (gsmDeviceBindingLifecycleIssue(device)) return null;
  const identities = new Set(gsmDeviceReservedIdentityValues(device));
  const identityMatches = scopedDevices.filter(candidate => (
    gsmDeviceReservedIdentityValues(candidate).some(identity => identities.has(identity))
  ));
  if (identityMatches.length !== 1 || toText(identityMatches[0]?.id) !== deviceRecordId) return null;
  if (isActiveGsmDeviceRecord(device) && gsmCurrentDeviceBindingIssue(device, {
    devices: scopedDevices,
    equipment,
  })) return null;
  const binding = gsmDeviceBindingAtRevision(device, revision);
  if (!binding) return null;
  const bindingIdentities = new Set(gsmBindingHistoryIdentityValues(binding));
  const storedIdentities = gsmDeviceIdentityValues(record);
  if (
    toText(record.equipmentId) !== toText(binding.equipmentId)
    || toText(record.companyId) !== toText(binding.companyId)
    || toText(record.tenantId) !== toText(binding.tenantId)
    || storedIdentities.some(identity => !bindingIdentities.has(identity))
  ) return null;
  if (currentOnly && (
    !isActiveGsmDeviceRecord(device)
    || revision !== gsmDeviceBindingRevision(device)
    || Boolean(binding.unlinkedAt)
    || toText(device.equipmentId) !== toText(binding.equipmentId)
  )) return null;
  return { device, binding };
}

function bindingHistoryEntry(device, revision, at, reason) {
  return {
    revision,
    equipmentId: toText(device.equipmentId),
    companyId: toText(device.companyId) || null,
    tenantId: toText(device.tenantId) || null,
    imei: toText(device.imei) || null,
    deviceId: toText(device.deviceId || device.trackerId) || null,
    trackerId: toText(device.trackerId) || null,
    identities: gsmDeviceIdentityValues(device),
    linkedAt: toText(at) || toText(device.updatedAt || device.createdAt) || null,
    unlinkedAt: null,
    reason: toText(reason) || 'provisioned',
  };
}

function ensureGsmDeviceBindingLifecycle(device = {}, { at = '', reason = 'legacy_binding_materialized' } = {}) {
  const equipmentId = toText(device.equipmentId);
  if (!equipmentId) return { ...device };
  const revision = gsmDeviceBindingRevision(device);
  let history = gsmDeviceBindingHistory(device);
  const matching = history.filter(entry => positiveBindingRevision(entry.revision) === revision);
  if (matching.length === 0) {
    history.push(bindingHistoryEntry(device, revision, at, reason));
  } else if (
    matching.length === 1
    && toText(matching[0].imei) === toText(device.imei)
    && toText(matching[0].deviceId) === toText(device.deviceId || device.trackerId)
  ) {
    const identities = [...new Set([
      ...gsmBindingHistoryIdentityValues(matching[0]),
      ...gsmDeviceIdentityValues(device),
    ])];
    history = history.map(entry => (
      positiveBindingRevision(entry.revision) === revision
        ? {
          ...entry,
          trackerId: toText(device.trackerId) || entry.trackerId || null,
          identities,
        }
        : entry
    ));
  }
  return {
    ...device,
    bindingRevision: revision,
    bindingHistory: history,
  };
}

function advanceGsmDeviceBindingLifecycle(device = {}, {
  at = '',
  reason = 'binding_changed',
} = {}) {
  const ensured = toText(device.equipmentId)
    ? ensureGsmDeviceBindingLifecycle(device, { at, reason: 'previous_binding_materialized' })
    : { ...device, bindingHistory: gsmDeviceBindingHistory(device) };
  const history = gsmDeviceBindingHistory(ensured).map(entry => (
    entry.unlinkedAt || positiveBindingRevision(entry.revision) !== gsmDeviceBindingRevision(ensured)
      ? entry
      : { ...entry, unlinkedAt: toText(at) || null }
  ));
  const revisions = history
    .map(entry => positiveBindingRevision(entry.revision))
    .filter(Boolean);
  const previousRevision = positiveBindingRevision(ensured.bindingRevision);
  const revision = Math.max(previousRevision || 0, ...revisions, 0) + 1;
  const firstRevision = history.length === 0 && !toText(device?.bindingRevision) ? 1 : revision;
  history.push(bindingHistoryEntry(device, firstRevision, at, reason));
  return {
    ...device,
    bindingRevision: firstRevision,
    bindingHistory: history,
  };
}

function closeGsmDeviceBindingLifecycle(device = {}, {
  at = '',
  reason = 'retired',
} = {}) {
  const ensured = ensureGsmDeviceBindingLifecycle(device, { at, reason: 'previous_binding_materialized' });
  const revision = gsmDeviceBindingRevision(ensured);
  return {
    ...ensured,
    bindingHistory: gsmDeviceBindingHistory(ensured).map(entry => (
      positiveBindingRevision(entry.revision) === revision && !entry.unlinkedAt
        ? { ...entry, unlinkedAt: toText(at) || null, closedReason: toText(reason) || 'retired' }
        : entry
    )),
  };
}

class GsmIngressScopeError extends Error {
  constructor(code, message, status = 409, details = undefined) {
    super(message);
    this.name = 'GsmIngressScopeError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, status = 409, details = undefined) {
  throw new GsmIngressScopeError(code, message, status, details);
}

function exactDeviceMatches(devices, field, value) {
  if (!value) return [];
  if (field === 'imei') {
    return devices.filter(device => toText(device?.imei) === value);
  }
  return devices.filter(device => (
    toText(device?.deviceId) === value
    || toText(device?.trackerId) === value
    || toText(device?.imei) === value
  ));
}

function assertCompleteRecordScope(record, entity) {
  const companyId = toText(record?.companyId);
  const tenantId = toText(record?.tenantId);
  if (!companyId || !tenantId || companyId !== tenantId) {
    fail(
      'GSM_DEVICE_SCOPE_INCOMPLETE',
      `${entity} does not have a complete authoritative company/tenant scope.`,
      409,
      { entity },
    );
  }
  return { companyId, tenantId };
}

function createTrustedGsmDeviceScopeResolver({ readData } = {}) {
  if (typeof readData !== 'function') {
    throw new TypeError('Trusted GSM device scope resolver requires a raw readData function.');
  }

  return function resolveTrustedGsmDeviceScope(identity = {}) {
    const imei = toText(identity.imei);
    const deviceId = toText(identity.deviceId);
    if (!imei && !deviceId) {
      fail(
        'GSM_DEVICE_IDENTIFIER_REQUIRED',
        'A provisioned GSM device identifier is required.',
        400,
      );
    }

    const devices = asArray(readData('gsm_devices'));
    const imeiMatches = exactDeviceMatches(devices, 'deviceId', imei);
    const deviceIdMatches = exactDeviceMatches(devices, 'deviceId', deviceId);

    if (imeiMatches.length > 1 || deviceIdMatches.length > 1) {
      fail(
        'GSM_DEVICE_IDENTITY_AMBIGUOUS',
        'The GSM device identifier matches more than one provisioned device.',
        409,
      );
    }

    if ((imei && imeiMatches.length === 0) || (deviceId && deviceIdMatches.length === 0)) {
      const hasAnyMatch = imeiMatches.length > 0 || deviceIdMatches.length > 0;
      fail(
        hasAnyMatch ? 'GSM_DEVICE_IDENTITY_MISMATCH' : 'GSM_DEVICE_NOT_PROVISIONED',
        hasAnyMatch
          ? 'The supplied GSM identifiers do not resolve to the same provisioned device.'
          : 'The GSM device is not provisioned.',
        hasAnyMatch ? 409 : 403,
      );
    }

    const device = imeiMatches[0] || deviceIdMatches[0] || null;
    if (!device) {
      fail('GSM_DEVICE_NOT_PROVISIONED', 'The GSM device is not provisioned.', 403);
    }
    if (imei && deviceId && imeiMatches[0] !== deviceIdMatches[0]) {
      fail(
        'GSM_DEVICE_IDENTITY_MISMATCH',
        'The supplied GSM identifiers resolve to different provisioned devices.',
        409,
      );
    }

    const deviceRecordId = toText(device.id);
    if (!deviceRecordId) {
      fail('GSM_DEVICE_RECORD_INVALID', 'The provisioned GSM device has no stable record ID.', 409);
    }
    if (!isActiveGsmDeviceRecord(device)) {
      fail(
        'GSM_DEVICE_NOT_ACTIVE',
        'The GSM device provisioning is inactive.',
        403,
        { deviceRecordId },
      );
    }
    const equipmentId = toText(device.equipmentId);
    if (!equipmentId) {
      fail(
        'GSM_DEVICE_EQUIPMENT_LINK_REQUIRED',
        'The provisioned GSM device is not linked to equipment.',
        409,
        { deviceRecordId },
      );
    }
    const activeEquipmentDevices = devices.filter(candidate => (
      isActiveGsmDeviceRecord(candidate)
      && toText(candidate.equipmentId) === equipmentId
    ));
    if (
      activeEquipmentDevices.length !== 1
      || toText(activeEquipmentDevices[0]?.id) !== deviceRecordId
    ) {
      fail(
        'GSM_EQUIPMENT_DEVICE_AMBIGUOUS',
        'The equipment does not have exactly one authoritative active GSM device.',
        409,
        { deviceRecordId, equipmentId },
      );
    }
    const lifecycleIssue = gsmDeviceBindingLifecycleIssue(device, { allowLegacyNoHistory: true });
    if (lifecycleIssue) {
      fail(
        'GSM_DEVICE_BINDING_HISTORY_INVALID',
        'The GSM device binding lifecycle cannot authorize new telemetry.',
        409,
        { deviceRecordId, equipmentId, lifecycleIssue },
      );
    }

    const equipmentMatches = asArray(readData('equipment'))
      .filter(equipment => toText(equipment?.id) === equipmentId);
    if (equipmentMatches.length === 0) {
      fail(
        'GSM_DEVICE_EQUIPMENT_NOT_FOUND',
        'The equipment linked to the GSM device does not exist.',
        409,
        { deviceRecordId, equipmentId },
      );
    }
    if (equipmentMatches.length > 1) {
      fail(
        'GSM_DEVICE_EQUIPMENT_AMBIGUOUS',
        'The GSM device equipment link is ambiguous.',
        409,
        { deviceRecordId, equipmentId },
      );
    }

    const deviceScope = assertCompleteRecordScope(device, 'gsm_device');
    const equipment = equipmentMatches[0];
    const equipmentScope = assertCompleteRecordScope(equipment, 'equipment');
    if (
      deviceScope.companyId !== equipmentScope.companyId
      || deviceScope.tenantId !== equipmentScope.tenantId
    ) {
      fail(
        'GSM_DEVICE_SCOPE_MISMATCH',
        'The GSM device and linked equipment belong to different company/tenant scopes.',
        409,
        { deviceRecordId, equipmentId },
      );
    }
    const projectedDeviceRecordId = toText(equipment.gsmDeviceRecordId);
    if (
      (projectedDeviceRecordId && projectedDeviceRecordId !== deviceRecordId)
      || (gsmDeviceBindingHistory(device).length > 0 && projectedDeviceRecordId !== deviceRecordId)
    ) {
      fail(
        'GSM_EQUIPMENT_PROJECTION_MISMATCH',
        'The equipment GSM projection does not match the authoritative device binding.',
        409,
        { deviceRecordId, equipmentId },
      );
    }
    const currentBindingIssue = gsmCurrentDeviceBindingIssue(device, {
      devices,
      equipment: equipmentMatches,
      allowLegacyNoHistory: true,
    });
    if (currentBindingIssue) {
      fail(
        'GSM_DEVICE_PARENT_INVALID',
        'The GSM device is not an unambiguous authoritative current binding.',
        409,
        { deviceRecordId, equipmentId, currentBindingIssue },
      );
    }

    return Object.freeze({
      device,
      equipment,
      scope: Object.freeze({
        companyId: deviceScope.companyId,
        tenantId: deviceScope.tenantId,
        principalId: `gsm-device:${deviceRecordId}`,
        source: 'provisioned_gsm_device',
      }),
    });
  };
}

function assertTrustedGsmConnectionBinding({ connection, resolution } = {}) {
  if (!connection?.gsmDeviceRecordId) return true;
  const expected = captureTrustedGsmDeviceBinding(resolution);
  if (toText(connection.gsmDeviceRecordId) !== expected.deviceRecordId) {
    fail(
      'GSM_CONNECTION_DEVICE_MISMATCH',
      'A GSM connection cannot switch to another provisioned device.',
      409,
    );
  }
  const bindingChanged = [
    ['equipmentId', expected.equipmentId],
    ['companyId', expected.companyId],
    ['tenantId', expected.tenantId],
    ['gsmBindingRevision', expected.bindingRevision],
  ].some(([field, value]) => toText(connection[field]) !== toText(value));
  if (bindingChanged) {
    fail(
      'GSM_CONNECTION_BINDING_CHANGED',
      'The GSM device binding changed; reconnect before sending more telemetry.',
      409,
      { deviceRecordId: expected.deviceRecordId },
    );
  }
  return true;
}

function captureTrustedGsmDeviceBinding(resolution = {}) {
  const deviceRecordId = toText(resolution.device?.id);
  const equipmentId = toText(resolution.equipment?.id);
  const companyId = toText(resolution.scope?.companyId);
  const tenantId = toText(resolution.scope?.tenantId);
  const bindingRevision = gsmDeviceBindingRevision(resolution.device);
  if (!deviceRecordId || !equipmentId || !companyId || !tenantId) {
    fail(
      'GSM_DEVICE_BINDING_CHANGED',
      'The resolved GSM device binding is incomplete and cannot authorize telemetry persistence.',
      409,
    );
  }
  return Object.freeze({ deviceRecordId, equipmentId, companyId, tenantId, bindingRevision });
}

function assertTrustedGsmDeviceBindingCurrent({ readData, binding } = {}) {
  if (typeof readData !== 'function') {
    throw new TypeError('Live GSM device binding validation requires a scoped readData function.');
  }
  const expected = binding || {};
  const deviceMatches = asArray(readData('gsm_devices'))
    .filter(device => toText(device?.id) === toText(expected.deviceRecordId));
  const device = deviceMatches.length === 1 ? deviceMatches[0] : null;
  const activeEquipmentDevices = asArray(readData('gsm_devices')).filter(candidate => (
    isActiveGsmDeviceRecord(candidate)
    && toText(candidate.equipmentId) === toText(expected.equipmentId)
  ));
  const equipmentMatches = asArray(readData('equipment'))
    .filter(equipment => toText(equipment?.id) === toText(expected.equipmentId));
  const equipment = equipmentMatches.length === 1 ? equipmentMatches[0] : null;
  const lifecycleIssue = device
    ? gsmDeviceBindingLifecycleIssue(device, { allowLegacyNoHistory: true })
    : 'device_missing';
  const currentBindingIssue = device
    ? gsmCurrentDeviceBindingIssue(device, {
      devices: asArray(readData('gsm_devices')),
      equipment: asArray(readData('equipment')),
      allowLegacyNoHistory: true,
    })
    : 'device_missing';
  const revisionBinding = device
    ? gsmDeviceBindingAtRevision(device, Number(expected.bindingRevision))
    : null;
  const projectedDeviceRecordId = toText(equipment?.gsmDeviceRecordId);
  const currentBindingMatches = Boolean(
    device
    && equipment
    && !lifecycleIssue
    && !currentBindingIssue
    && revisionBinding
    && !revisionBinding.unlinkedAt
    && activeEquipmentDevices.length === 1
    && toText(activeEquipmentDevices[0]?.id) === toText(expected.deviceRecordId)
    && toText(device.equipmentId) === toText(expected.equipmentId)
    && toText(device.companyId) === toText(expected.companyId)
    && toText(device.tenantId) === toText(expected.tenantId)
    && gsmDeviceBindingRevision(device) === Number(expected.bindingRevision)
    && isActiveGsmDeviceRecord(device)
    && toText(equipment.companyId) === toText(expected.companyId)
    && toText(equipment.tenantId) === toText(expected.tenantId)
    && (
      gsmDeviceBindingHistory(device).length === 0
        ? (!projectedDeviceRecordId || projectedDeviceRecordId === toText(expected.deviceRecordId))
        : projectedDeviceRecordId === toText(expected.deviceRecordId)
    )
  );
  if (!currentBindingMatches) {
    fail(
      'GSM_DEVICE_BINDING_CHANGED',
      'The GSM device binding changed after ingress authorization; telemetry was not persisted.',
      409,
      {
        deviceRecordId: toText(expected.deviceRecordId) || null,
        expectedEquipmentId: toText(expected.equipmentId) || null,
      },
    );
  }
  return Object.freeze({
    device,
    equipment,
    scope: Object.freeze({
      companyId: expected.companyId,
      tenantId: expected.tenantId,
      principalId: `gsm-device:${expected.deviceRecordId}`,
      source: 'provisioned_gsm_device',
    }),
  });
}

function createTrustedGsmDeviceProvisioningGuard({ readData } = {}) {
  if (typeof readData !== 'function') {
    throw new TypeError('Trusted GSM device provisioning guard requires a raw readData function.');
  }

  return function assertGsmDeviceIdentityAvailable({ imei, deviceId, currentDeviceRecordId = '' } = {}) {
    const safeImei = toText(imei);
    const safeDeviceId = toText(deviceId);
    if (!safeImei && !safeDeviceId) {
      fail('GSM_DEVICE_IDENTIFIER_REQUIRED', 'IMEI or deviceId is required.', 400);
    }
    const currentId = toText(currentDeviceRecordId);
    const devices = asArray(readData('gsm_devices'));
    const matches = new Set();
    for (const identifier of new Set([safeImei, safeDeviceId].filter(Boolean))) {
      for (const device of devices) {
        if (gsmDeviceReservedIdentityValues(device).includes(identifier)) matches.add(device);
      }
    }
    const currentMatches = [...matches].filter(device => toText(device?.id) === currentId);
    const conflicts = [...matches].filter(device => toText(device?.id) !== currentId);
    if (conflicts.length > 0 || currentMatches.length > 1) {
      fail(
        'GSM_DEVICE_IDENTITY_CONFLICT',
        'The GSM device identifier is already provisioned.',
        409,
      );
    }
    return true;
  };
}

module.exports = {
  EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS,
  EQUIPMENT_GSM_PROJECTION_FIELDS,
  GSM_BINDING_FUTURE_SKEW_MS,
  GsmIngressScopeError,
  advanceGsmDeviceBindingLifecycle,
  applyEquipmentGsmConfigurationProjection,
  assertEquipmentGsmProjectionMutation,
  assertTrustedGsmConnectionBinding,
  assertTrustedGsmDeviceBindingCurrent,
  captureTrustedGsmDeviceBinding,
  closeGsmDeviceBindingLifecycle,
  createTrustedGsmDeviceProvisioningGuard,
  createTrustedGsmDeviceScopeResolver,
  ensureGsmDeviceBindingLifecycle,
  canonicalEquipmentGsmConfigurationProjection,
  equipmentGsmConfigurationProjectionIssue,
  gsmBindingHistoryEntry,
  gsmCurrentDeviceBindingIssue,
  gsmDeviceBindingAtRevision,
  gsmDeviceBindingLifecycleIssue,
  gsmDeviceBindingHistory,
  gsmDeviceIdentityValues,
  gsmDeviceReservedIdentityValues,
  gsmDeviceBindingRevision,
  isActiveGsmDeviceRecord,
  preserveEquipmentGsmProjection,
  resolveTrustedStoredGsmBinding,
  stripEquipmentGsmProjectionFields,
};
