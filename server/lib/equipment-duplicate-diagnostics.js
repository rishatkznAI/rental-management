function normalizeIdentifier(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function displayValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function collectIdentifierValues(record) {
  const values = new Set();
  [
    record?.equipmentInv,
    record?.inventoryNumber,
    record?.serialNumber,
    record?.equipmentInventoryNumber,
    record?.equipmentSerialNumber,
  ].forEach(value => {
    const normalized = normalizeIdentifier(value);
    if (normalized) values.add(normalized);
  });

  if (Array.isArray(record?.equipment)) {
    record.equipment.forEach(value => {
      const normalized = normalizeIdentifier(value);
      if (normalized) values.add(normalized);
    });
  }

  return values;
}

function matchesEquipment(record, equipment, equipmentIdentifiers) {
  if (!record || !equipment) return false;
  if (equipment.id && record.equipmentId === equipment.id) return true;
  if (equipment.id && Array.isArray(record.equipmentIds) && record.equipmentIds.includes(equipment.id)) return true;

  const recordIdentifiers = collectIdentifierValues(record);
  for (const value of equipmentIdentifiers) {
    if (recordIdentifiers.has(value)) return true;
  }
  return false;
}

function summarizeLinkedRecord(record) {
  return {
    id: record?.id || record?.rentalId || record?.number || '',
    status: record?.status || record?.state || '',
    client: record?.client || record?.clientName || '',
    rentalId: record?.rentalId || '',
    type: record?.type || '',
    number: record?.number || '',
    date: record?.date || record?.startDate || record?.createdAt || '',
  };
}

function summarizeEquipment(equipment, collections) {
  const equipmentIdentifiers = new Set([
    normalizeIdentifier(equipment.inventoryNumber),
    normalizeIdentifier(equipment.serialNumber),
    normalizeIdentifier(equipment.equipmentInv),
  ].filter(Boolean));

  const linkedRentals = [
    ...asArray(collections.rentals),
    ...asArray(collections.ganttRentals),
  ].filter(record => matchesEquipment(record, equipment, equipmentIdentifiers)).map(summarizeLinkedRecord);

  const linkedServiceTickets = asArray(collections.service)
    .filter(record => matchesEquipment(record, equipment, equipmentIdentifiers))
    .map(summarizeLinkedRecord);

  const linkedDeliveries = asArray(collections.deliveries)
    .filter(record => matchesEquipment(record, equipment, equipmentIdentifiers))
    .map(summarizeLinkedRecord);

  const linkedDocuments = asArray(collections.documents)
    .filter(record => matchesEquipment(record, equipment, equipmentIdentifiers))
    .map(summarizeLinkedRecord);

  const gsmFields = [
    'gsmImei',
    'gsmDeviceId',
    'gsmStatus',
    'gsmLastSeenAt',
    'gsmLastSignalAt',
    'trackerId',
    'imei',
  ];
  const gsm = gsmFields.reduce((acc, field) => {
    if (equipment[field] !== null && equipment[field] !== undefined && equipment[field] !== '') {
      acc[field] = equipment[field];
    }
    return acc;
  }, {});

  return {
    id: equipment.id || '',
    model: displayValue([equipment.manufacturer, equipment.model].filter(Boolean).join(' ')) || displayValue(equipment.name),
    status: displayValue(equipment.status),
    owner: displayValue(equipment.ownerName || equipment.owner || equipment.ownerId),
    serialNumber: displayValue(equipment.serialNumber),
    inventoryNumber: displayValue(equipment.inventoryNumber || equipment.equipmentInv),
    linkedRentals,
    linkedServiceTickets,
    linkedDeliveries,
    linkedDocuments,
    gsm: {
      hasData: Object.keys(gsm).length > 0,
      ...gsm,
    },
  };
}

function buildDuplicateGroups(equipment, field, collections) {
  const groups = new Map();
  equipment.forEach(item => {
    const normalizedValue = normalizeIdentifier(item?.[field]);
    if (!normalizedValue) return;
    if (!groups.has(normalizedValue)) {
      groups.set(normalizedValue, {
        field,
        value: displayValue(item?.[field]),
        normalizedValue,
        items: [],
      });
    }
    const group = groups.get(normalizedValue);
    if (!group.value && displayValue(item?.[field])) {
      group.value = displayValue(item?.[field]);
    }
    group.items.push(summarizeEquipment(item, collections));
  });

  return [...groups.values()]
    .filter(group => group.items.length > 1)
    .map(group => ({
      ...group,
      count: group.items.length,
    }))
    .sort((a, b) => a.field.localeCompare(b.field) || a.normalizedValue.localeCompare(b.normalizedValue));
}

function buildEquipmentDuplicateDiagnostics(collections = {}) {
  const equipment = asArray(collections.equipment);
  const duplicates = [
    ...buildDuplicateGroups(equipment, 'inventoryNumber', collections),
    ...buildDuplicateGroups(equipment, 'serialNumber', collections),
  ].sort((a, b) => a.field.localeCompare(b.field) || a.normalizedValue.localeCompare(b.normalizedValue));

  const affectedEquipmentIds = new Set();
  duplicates.forEach(group => {
    group.items.forEach(item => {
      if (item.id) affectedEquipmentIds.add(item.id);
    });
  });

  return {
    diagnosticsReadOnly: true,
    summary: {
      equipmentTotal: equipment.length,
      duplicateGroups: duplicates.length,
      duplicateInventoryNumbers: duplicates.filter(group => group.field === 'inventoryNumber').length,
      duplicateSerialNumbers: duplicates.filter(group => group.field === 'serialNumber').length,
      affectedEquipment: affectedEquipmentIds.size,
    },
    duplicates,
  };
}

module.exports = {
  buildEquipmentDuplicateDiagnostics,
  normalizeIdentifier,
};
