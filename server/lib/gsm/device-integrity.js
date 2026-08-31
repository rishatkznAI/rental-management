const { TenantDataBoundaryError } = require('../tenant-data-boundary');
const {
  EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS,
  equipmentGsmConfigurationProjectionIssue,
  gsmCurrentDeviceBindingIssue,
  gsmDeviceBindingHistory,
  gsmDeviceBindingAtRevision,
  gsmDeviceBindingLifecycleIssue,
  gsmDeviceBindingRevision,
  gsmDeviceReservedIdentityValues,
  isActiveGsmDeviceRecord,
} = require('./trusted-device-scope');

function text(value) {
  return String(value ?? '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function positiveRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : null;
}

function recordKey(record, index) {
  return text(record?.id || record?._id) || `fingerprint:${stableJson(record)}:${index}`;
}

function violation(code, signature, details = {}) {
  return { code, signature: `${code}:${signature}`, details };
}

function bindingSemanticSnapshot(device) {
  return stableJson({
    id: text(device?.id),
    equipmentId: text(device?.equipmentId),
    companyId: text(device?.companyId),
    tenantId: text(device?.tenantId),
    bindingRevision: gsmDeviceBindingRevision(device),
    bindingHistory: gsmDeviceBindingHistory(device),
  });
}

function equipmentProjectionSemanticSnapshot(record) {
  return stableJson({
    id: text(record?.id),
    companyId: text(record?.companyId),
    tenantId: text(record?.tenantId),
    ...Object.fromEntries(EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS.map(field => (
      [field, text(record?.[field]) || null]
    ))),
  });
}

function collectDeviceViolations(devices) {
  const violations = [];
  const identities = new Map();
  const activeByEquipment = new Map();
  devices.forEach((device, index) => {
    const id = recordKey(device, index);
    for (const identity of gsmDeviceReservedIdentityValues(device)) {
      if (!identities.has(identity)) identities.set(identity, new Set());
      identities.get(identity).add(id);
    }
    const equipmentId = text(device?.equipmentId);
    const active = isActiveGsmDeviceRecord(device);
    if (equipmentId && active) {
      if (!activeByEquipment.has(equipmentId)) activeByEquipment.set(equipmentId, new Set());
      activeByEquipment.get(equipmentId).add(id);
    }

    const lifecycleIssue = gsmDeviceBindingLifecycleIssue(device);
    if (lifecycleIssue) {
      violations.push(violation(
        lifecycleIssue === 'binding_history_missing'
          ? 'GSM_DEVICE_BINDING_LIFECYCLE_REQUIRED'
          : 'GSM_DEVICE_BINDING_HISTORY_INVALID',
        `${id}:${bindingSemanticSnapshot(device)}:${lifecycleIssue}`,
        { collection: 'gsm_devices', deviceRecordId: text(device?.id) || null },
      ));
    }
  });

  for (const [identity, ids] of identities) {
    if (ids.size < 2) continue;
    const sortedIds = [...ids].sort();
    violations.push(violation(
      'GSM_DEVICE_IDENTITY_CONFLICT',
      `${identity}:${sortedIds.join(',')}`,
      { collection: 'gsm_devices' },
    ));
  }
  for (const [equipmentId, ids] of activeByEquipment) {
    if (ids.size < 2) continue;
    const sortedIds = [...ids].sort();
    violations.push(violation(
      'GSM_EQUIPMENT_DEVICE_AMBIGUOUS',
      `${equipmentId}:${sortedIds.join(',')}`,
      { collection: 'gsm_devices', equipmentId },
    ));
  }
  return violations;
}

function invalidDeviceParentIds(devices, equipment) {
  const invalid = new Set();
  const byRecordId = new Map();
  const byIdentity = new Map();
  const activeByEquipment = new Map();
  for (const device of devices) {
    const id = text(device?.id);
    if (!id) continue;
    if (!byRecordId.has(id)) byRecordId.set(id, []);
    byRecordId.get(id).push(device);
    if (gsmDeviceBindingLifecycleIssue(device)) invalid.add(id);
    for (const identity of gsmDeviceReservedIdentityValues(device)) {
      if (!byIdentity.has(identity)) byIdentity.set(identity, new Set());
      byIdentity.get(identity).add(id);
    }
    if (isActiveGsmDeviceRecord(device)) {
      const equipmentId = text(device.equipmentId);
      if (!activeByEquipment.has(equipmentId)) activeByEquipment.set(equipmentId, new Set());
      activeByEquipment.get(equipmentId).add(id);
      if (gsmCurrentDeviceBindingIssue(device, { devices, equipment })) invalid.add(id);
    }
  }
  for (const [id, matches] of byRecordId) if (matches.length !== 1) invalid.add(id);
  for (const ids of byIdentity.values()) if (ids.size > 1) for (const id of ids) invalid.add(id);
  for (const ids of activeByEquipment.values()) if (ids.size > 1) for (const id of ids) invalid.add(id);
  return invalid;
}

function collectTelemetryViolations(collection, records, devices, invalidParentIds) {
  const violations = [];
  records.forEach((record, index) => {
    const key = recordKey(record, index);
    const rowFingerprint = stableJson(record);
    const deviceRecordId = text(record?.gsmDeviceRecordId);
    if (!deviceRecordId) {
      violations.push(violation(
        'GSM_DEVICE_RECORD_REQUIRED',
        `${collection}:${key}:${rowFingerprint}`,
        { collection, recordId: text(record?.id) || null, field: 'gsmDeviceRecordId' },
      ));
      return;
    }
    const matches = devices.filter(device => text(device?.id) === deviceRecordId);
    if (matches.length !== 1) {
      violations.push(violation(
        'GSM_DEVICE_RECORD_NOT_FOUND',
        `${collection}:${key}:${rowFingerprint}:${matches.length}`,
        { collection, recordId: text(record?.id) || null, field: 'gsmDeviceRecordId' },
      ));
      return;
    }
    const revision = positiveRevision(record?.gsmBindingRevision);
    if (!revision) {
      violations.push(violation(
        'GSM_BINDING_REVISION_REQUIRED',
        `${collection}:${key}:${rowFingerprint}`,
        { collection, recordId: text(record?.id) || null, field: 'gsmBindingRevision' },
      ));
      return;
    }
    const device = matches[0];
    if (invalidParentIds.has(deviceRecordId)) {
      violations.push(violation(
        'GSM_DEVICE_PARENT_INVALID',
        `${collection}:${key}:${rowFingerprint}:${bindingSemanticSnapshot(device)}`,
        { collection, recordId: text(record?.id) || null, deviceRecordId },
      ));
      return;
    }
    const binding = gsmDeviceBindingAtRevision(device, revision);
    if (!binding) {
      violations.push(violation(
        'GSM_DEVICE_BINDING_REVISION_INVALID',
        `${collection}:${key}:${rowFingerprint}:${bindingSemanticSnapshot(device)}`,
        { collection, recordId: text(record?.id) || null, deviceRecordId },
      ));
      return;
    }
    if (text(record?.equipmentId) !== text(binding.equipmentId)) {
      violations.push(violation(
        'GSM_DEVICE_EQUIPMENT_MISMATCH',
        `${collection}:${key}:${rowFingerprint}:${bindingSemanticSnapshot(device)}`,
        { collection, recordId: text(record?.id) || null, deviceRecordId, field: 'equipmentId' },
      ));
    }
    if (
      text(record?.companyId) !== text(binding.companyId)
      || text(record?.tenantId) !== text(binding.tenantId)
    ) {
      violations.push(violation(
        'GSM_DEVICE_SCOPE_MISMATCH',
        `${collection}:${key}:${rowFingerprint}:${bindingSemanticSnapshot(device)}`,
        { collection, recordId: text(record?.id) || null, deviceRecordId },
      ));
    }
  });
  return violations;
}

const COMMAND_BINDING_FIELDS = Object.freeze([
  'gsmDeviceRecordId',
  'gsmBindingRevision',
  'equipmentId',
  'companyId',
  'tenantId',
]);

function commandBindingValue(record, field) {
  return field === 'gsmBindingRevision'
    ? positiveRevision(record?.[field])
    : text(record?.[field]);
}

function collectCommandMutationViolations(read, beforeRead) {
  const violations = [];
  const commands = asArray(read('gsm_commands'));
  const previousCommands = asArray(beforeRead('gsm_commands'));
  const devices = asArray(read('gsm_devices'));

  commands.forEach((record, index) => {
    const id = text(record?.id);
    const previousMatches = id
      ? previousCommands.filter(previous => text(previous?.id) === id)
      : previousCommands.filter(previous => stableJson(previous) === stableJson(record));
    if (previousMatches.length === 1) {
      const previous = previousMatches[0];
      const changedFields = COMMAND_BINDING_FIELDS.filter(field => (
        commandBindingValue(previous, field) !== commandBindingValue(record, field)
      ));
      if (changedFields.length > 0) {
        violations.push(violation(
          'GSM_COMMAND_BINDING_IMMUTABLE',
          `${recordKey(record, index)}:${stableJson(record)}:${changedFields.join(',')}`,
          { collection: 'gsm_commands', recordId: id || null, fields: changedFields },
        ));
      }
      return;
    }
    if (previousMatches.length > 1) {
      violations.push(violation(
        'GSM_COMMAND_RECORD_AMBIGUOUS',
        `${recordKey(record, index)}:${stableJson(record)}:${previousMatches.length}`,
        { collection: 'gsm_commands', recordId: id || null },
      ));
      return;
    }

    const deviceRecordId = text(record?.gsmDeviceRecordId);
    const revision = positiveRevision(record?.gsmBindingRevision);
    const deviceMatches = devices.filter(device => text(device?.id) === deviceRecordId);
    const device = deviceMatches.length === 1 ? deviceMatches[0] : null;
    const binding = device && revision ? gsmDeviceBindingAtRevision(device, revision) : null;
    if (
      !device
      || !binding
      || !isActiveGsmDeviceRecord(device)
      || revision !== gsmDeviceBindingRevision(device)
      || Boolean(binding.unlinkedAt)
    ) {
      violations.push(violation(
        'GSM_COMMAND_BINDING_NOT_CURRENT',
        `${recordKey(record, index)}:${stableJson(record)}:${bindingSemanticSnapshot(device)}`,
        { collection: 'gsm_commands', recordId: id || null, deviceRecordId: deviceRecordId || null },
      ));
    }
  });
  return violations;
}

function collectEquipmentProjectionViolations(equipment, devices) {
  const violations = [];
  const activeDevices = devices.filter(isActiveGsmDeviceRecord);
  equipment.forEach((record, index) => {
    const key = recordKey(record, index);
    const projectedDeviceId = text(record?.gsmDeviceRecordId);
    const matchingDevices = projectedDeviceId
      ? activeDevices.filter(device => text(device?.id) === projectedDeviceId)
      : [];
    if (projectedDeviceId && (
      matchingDevices.length !== 1
      || text(matchingDevices[0]?.equipmentId) !== text(record?.id)
    )) {
      violations.push(violation(
        'GSM_EQUIPMENT_PROJECTION_MISMATCH',
        `${key}:${equipmentProjectionSemanticSnapshot(record)}:${matchingDevices.map(bindingSemanticSnapshot).join(',')}`,
        { collection: 'equipment', equipmentId: text(record?.id) || null, field: 'gsmDeviceRecordId' },
      ));
    }
  });
  for (const device of activeDevices) {
    if (gsmDeviceBindingHistory(device).length === 0) continue;
    const equipmentId = text(device?.equipmentId);
    const matches = equipment.filter(record => text(record?.id) === equipmentId);
    const record = matches.length === 1 ? matches[0] : null;
    const projectionIssue = record
      ? equipmentGsmConfigurationProjectionIssue(record, device)
      : { code: 'equipment_record_missing', mismatchedFields: ['id'] };
    if (projectionIssue) {
      violations.push(violation(
        'GSM_EQUIPMENT_PROJECTION_MISMATCH',
        `${text(device?.id)}:${bindingSemanticSnapshot(device)}:${equipmentProjectionSemanticSnapshot(record)}:${stableJson(projectionIssue)}`,
        {
          collection: 'equipment',
          equipmentId: equipmentId || null,
          fields: projectionIssue.mismatchedFields,
        },
      ));
    }
  }
  return violations;
}

function collectGsmIntegrityViolations(read) {
  const devices = asArray(read('gsm_devices'));
  const equipment = asArray(read('equipment'));
  const invalidParentIds = invalidDeviceParentIds(devices, equipment);
  return [
    ...collectDeviceViolations(devices),
    ...collectEquipmentProjectionViolations(equipment, devices),
    ...collectTelemetryViolations('gsm_packets', asArray(read('gsm_packets')), devices, invalidParentIds),
    ...collectTelemetryViolations('gsm_commands', asArray(read('gsm_commands')), devices, invalidParentIds),
  ];
}

function assertGsmDataIntegrity({ read, beforeRead } = {}) {
  if (typeof read !== 'function' || typeof beforeRead !== 'function') {
    throw new TypeError('GSM integrity validation requires staged and previous readers.');
  }
  const previousSignatures = new Set(
    collectGsmIntegrityViolations(beforeRead).map(item => item.signature),
  );
  const newlyInvalid = collectGsmIntegrityViolations(read)
    .find(item => !previousSignatures.has(item.signature));
  const commandMutationInvalid = collectCommandMutationViolations(read, beforeRead)[0] || null;
  if (!newlyInvalid && !commandMutationInvalid) return true;
  const invalid = newlyInvalid || commandMutationInvalid;
  throw new TenantDataBoundaryError(
    invalid.code,
    'GSM device, equipment, binding revision, and tenant scope must remain exactly correlated.',
    409,
    invalid.details,
  );
}

module.exports = {
  assertGsmDataIntegrity,
  collectGsmIntegrityViolations,
};
