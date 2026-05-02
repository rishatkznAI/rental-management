const RENTAL_OPEN_STATUSES = new Set(['active', 'confirmed', 'return_planned', 'planned']);
const RENTAL_CLOSED_STATUSES = new Set(['closed', 'returned', 'completed', 'done']);
const DOCUMENT_TYPES = new Set(['contract', 'act', 'invoice', 'work_order', 'upd']);
const DOCUMENT_STATUSES = new Set(['draft', 'sent', 'signed']);

export const DOCUMENT_CONTROL_STATUSES = {
  OK: 'ok',
  MISSING_CONTRACT: 'missing_contract',
  MISSING_CLOSING_DOCS: 'missing_closing_docs',
  UNSIGNED: 'unsigned',
  SENT_WAITING: 'sent_waiting',
  OVERDUE_SIGNATURE: 'overdue_signature',
  ORPHAN_DOCUMENT: 'orphan_document',
  UNKNOWN: 'unknown',
};

export const DOCUMENT_CONTROL_LABELS = {
  ok: 'Всё закрыто',
  missing_contract: 'Нет договора',
  missing_closing_docs: 'Нет закрывающих документов',
  unsigned: 'Не подписано',
  sent_waiting: 'Отправлено, ждём подпись',
  overdue_signature: 'Просрочено подписание',
  orphan_document: 'Документ без связи',
  unknown: 'Недостаточно данных',
};

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase();
}

function dateKey(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function daysBetween(left, right) {
  const start = dateKey(left);
  const end = dateKey(right);
  if (!start || !end) return 0;
  const diff = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.floor(diff / 86400000);
}

function safeId(...values) {
  return values.map(normalizeText).find(Boolean) || '';
}

function safeDisplay(...values) {
  return values.map(normalizeText).find(Boolean) || '—';
}

function clientName(client) {
  return safeDisplay(client?.company, client?.name, client?.client, client?.clientName);
}

function equipmentName(item) {
  return safeDisplay(item?.inventoryNumber, item?.name, item?.title, item?.model);
}

function getDocumentRentalId(doc) {
  return safeId(doc?.rentalId, doc?.rental);
}

function getDocumentClientId(doc) {
  return safeId(doc?.clientId);
}

function getDocumentEquipmentId(doc) {
  return safeId(doc?.equipmentId);
}

function getRentalEquipmentId(rental) {
  return safeId(rental?.equipmentId, rental?.equipmentItemId);
}

function getRentalEquipmentInv(rental) {
  if (Array.isArray(rental?.equipment)) return safeId(rental.equipment[0], rental?.equipmentInv);
  return safeId(rental?.equipmentInv, rental?.equipment);
}

function documentType(doc) {
  const type = normalizeStatus(doc?.type);
  return DOCUMENT_TYPES.has(type) ? type : 'document';
}

function documentStatus(doc) {
  const status = normalizeStatus(doc?.status);
  return DOCUMENT_STATUSES.has(status) ? status : 'draft';
}

function documentTypeLabel(type) {
  if (type === 'contract') return 'Договор';
  if (type === 'act' || type === 'upd') return 'Акт/УПД';
  if (type === 'invoice') return 'Счёт';
  if (type === 'work_order') return 'Заказ-наряд';
  return 'Документ';
}

function documentStatusLabel(status) {
  if (status === 'signed') return 'Подписан';
  if (status === 'sent') return 'Отправлен';
  if (status === 'draft') return 'Черновик';
  return 'Без статуса';
}

function isContract(doc) {
  return documentType(doc) === 'contract';
}

function isClosingDocument(doc) {
  return ['act', 'upd'].includes(documentType(doc));
}

function isUnsigned(doc) {
  return ['contract', 'act', 'upd'].includes(documentType(doc)) && documentStatus(doc) !== 'signed';
}

function isSentUnsigned(doc) {
  return isUnsigned(doc) && documentStatus(doc) === 'sent';
}

function isRentalClosed(rental) {
  const status = normalizeStatus(rental?.status);
  return RENTAL_CLOSED_STATUSES.has(status) || Boolean(rental?.actualReturnDate);
}

function isRentalRelevant(rental) {
  const status = normalizeStatus(rental?.status);
  return !['cancelled', 'canceled'].includes(status) && (RENTAL_OPEN_STATUSES.has(status) || isRentalClosed(rental) || !status);
}

function actionForStatus(status) {
  if (status === DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT) return 'Создать или привязать договор';
  if (status === DOCUMENT_CONTROL_STATUSES.MISSING_CLOSING_DOCS) return 'Подготовить акт/УПД';
  if (status === DOCUMENT_CONTROL_STATUSES.OVERDUE_SIGNATURE) return 'Напомнить о подписи';
  if (status === DOCUMENT_CONTROL_STATUSES.SENT_WAITING) return 'Проверить подпись';
  if (status === DOCUMENT_CONTROL_STATUSES.UNSIGNED) return 'Довести до подписи';
  if (status === DOCUMENT_CONTROL_STATUSES.ORPHAN_DOCUMENT) return 'Уточнить связь документа';
  if (status === DOCUMENT_CONTROL_STATUSES.UNKNOWN) return 'Проверить реквизиты';
  return 'Контроль не требуется';
}

function riskForStatus(status) {
  if ([DOCUMENT_CONTROL_STATUSES.MISSING_CLOSING_DOCS, DOCUMENT_CONTROL_STATUSES.OVERDUE_SIGNATURE].includes(status)) return 'critical';
  if ([DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT, DOCUMENT_CONTROL_STATUSES.ORPHAN_DOCUMENT].includes(status)) return 'high';
  if ([DOCUMENT_CONTROL_STATUSES.SENT_WAITING, DOCUMENT_CONTROL_STATUSES.UNSIGNED, DOCUMENT_CONTROL_STATUSES.UNKNOWN].includes(status)) return 'medium';
  return 'low';
}

function sortRows(left, right) {
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return (order[left.risk] ?? 9) - (order[right.risk] ?? 9)
    || (right.daysWithoutSignature || 0) - (left.daysWithoutSignature || 0)
    || safeDisplay(left.client).localeCompare(safeDisplay(right.client), 'ru');
}

function buildMaps({ rentals, clients, equipment }) {
  const rentalsById = new Map();
  const clientsById = new Map();
  const equipmentById = new Map();
  const equipmentByInventory = new Map();

  rentals.forEach(rental => {
    const id = safeId(rental?.id);
    if (id) rentalsById.set(id, rental);
  });
  clients.forEach(client => {
    const id = safeId(client?.id);
    if (id) clientsById.set(id, client);
  });
  equipment.forEach(item => {
    const id = safeId(item?.id);
    if (id) equipmentById.set(id, item);
    const inv = safeId(item?.inventoryNumber);
    if (inv && !equipmentByInventory.has(inv)) equipmentByInventory.set(inv, item);
  });

  return { rentalsById, clientsById, equipmentById, equipmentByInventory };
}

function resolveRentalDisplay(rental, maps) {
  const clientId = safeId(rental?.clientId);
  const equipmentId = getRentalEquipmentId(rental);
  const equipmentInv = getRentalEquipmentInv(rental);
  const equipmentItem = equipmentId
    ? maps.equipmentById.get(equipmentId)
    : (equipmentInv ? maps.equipmentByInventory.get(equipmentInv) : null);
  return {
    rentalId: safeId(rental?.id),
    clientId,
    client: safeDisplay(rental?.client, clientName(maps.clientsById.get(clientId))),
    equipment: safeDisplay(equipmentName(equipmentItem), equipmentInv),
    responsible: safeDisplay(rental?.manager, rental?.responsible, rental?.managerName),
  };
}

function resolveDocumentDisplay(doc, maps) {
  const rentalId = getDocumentRentalId(doc);
  const rental = rentalId ? maps.rentalsById.get(rentalId) : null;
  const clientId = getDocumentClientId(doc) || safeId(rental?.clientId);
  const equipmentId = getDocumentEquipmentId(doc) || getRentalEquipmentId(rental);
  const equipmentInv = safeId(doc?.equipmentInv, doc?.equipment, getRentalEquipmentInv(rental));
  const equipmentItem = equipmentId
    ? maps.equipmentById.get(equipmentId)
    : (equipmentInv ? maps.equipmentByInventory.get(equipmentInv) : null);
  return {
    rentalId,
    clientId,
    client: safeDisplay(doc?.client, rental?.client, clientName(maps.clientsById.get(clientId))),
    equipment: safeDisplay(equipmentName(equipmentItem), equipmentInv),
    responsible: safeDisplay(doc?.manager, rental?.manager),
  };
}

function makeRow(input) {
  const status = input.status || DOCUMENT_CONTROL_STATUSES.UNKNOWN;
  return {
    id: safeDisplay(input.id, `${status}-${input.rentalId || input.documentId || 'row'}`),
    risk: riskForStatus(status),
    status,
    statusLabel: DOCUMENT_CONTROL_LABELS[status] || DOCUMENT_CONTROL_LABELS.unknown,
    client: safeDisplay(input.client),
    clientId: normalizeText(input.clientId),
    rentalId: normalizeText(input.rentalId),
    equipment: safeDisplay(input.equipment),
    documentId: normalizeText(input.documentId),
    documentType: safeDisplay(input.documentType),
    documentStatus: safeDisplay(input.documentStatus),
    date: dateKey(input.date),
    daysWithoutSignature: Number.isFinite(input.daysWithoutSignature) ? Math.max(0, input.daysWithoutSignature) : 0,
    responsible: safeDisplay(input.responsible, 'Не назначен'),
    action: safeDisplay(input.action, actionForStatus(status)),
    rentalUrl: input.rentalId ? `/rentals/${input.rentalId}` : '',
    documentsUrl: '/documents',
    rentalClosed: Boolean(input.rentalClosed),
  };
}

function buildDocumentRows({ documents, maps, todayKey, overdueDays }) {
  return documents.map(doc => {
    const type = documentType(doc);
    const status = documentStatus(doc);
    const display = resolveDocumentDisplay(doc, maps);
    const sentDate = dateKey(doc?.sentAt || doc?.sentDate || doc?.date || doc?.createdAt);
    const daysUnsigned = status === 'signed' ? 0 : daysBetween(sentDate, todayKey);
    const orphan = !display.rentalId && !display.clientId;
    let controlStatus = DOCUMENT_CONTROL_STATUSES.OK;
    if (orphan) controlStatus = DOCUMENT_CONTROL_STATUSES.ORPHAN_DOCUMENT;
    else if (isSentUnsigned(doc) && daysUnsigned > overdueDays) controlStatus = DOCUMENT_CONTROL_STATUSES.OVERDUE_SIGNATURE;
    else if (isSentUnsigned(doc)) controlStatus = DOCUMENT_CONTROL_STATUSES.SENT_WAITING;
    else if (isUnsigned(doc)) controlStatus = DOCUMENT_CONTROL_STATUSES.UNSIGNED;
    return makeRow({
      id: `doc-${safeId(doc?.id) || type}-${display.rentalId || display.clientId}`,
      status: controlStatus,
      client: display.client,
      clientId: display.clientId,
      rentalId: display.rentalId,
      equipment: display.equipment,
      documentId: safeId(doc?.id),
      documentType: documentTypeLabel(type),
      documentStatus: documentStatusLabel(status),
      date: sentDate,
      daysWithoutSignature: daysUnsigned,
      responsible: display.responsible,
    });
  });
}

function buildRentalSummary(rental, rentalDocuments, maps, todayKey, overdueDays) {
  const display = resolveRentalDisplay(rental, maps);
  const contracts = rentalDocuments.filter(isContract);
  const closingDocs = rentalDocuments.filter(isClosingDocument);
  const unsignedDocs = rentalDocuments.filter(isUnsigned);
  const sentUnsignedDocs = rentalDocuments.filter(isSentUnsigned);
  const maxUnsignedDays = unsignedDocs.reduce((max, doc) => {
    const sentDate = dateKey(doc?.sentAt || doc?.sentDate || doc?.date || doc?.createdAt);
    return Math.max(max, daysBetween(sentDate, todayKey));
  }, 0);
  const hasSignedContract = contracts.some(doc => documentStatus(doc) === 'signed');
  const hasContract = contracts.length > 0;
  const hasSignedClosingDoc = closingDocs.some(doc => documentStatus(doc) === 'signed');
  const hasClosingDoc = closingDocs.length > 0;
  const closed = isRentalClosed(rental);

  let status = DOCUMENT_CONTROL_STATUSES.OK;
  if (!hasContract) status = DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT;
  else if (closed && !hasClosingDoc) status = DOCUMENT_CONTROL_STATUSES.MISSING_CLOSING_DOCS;
  else if (!closed && !hasClosingDoc) status = DOCUMENT_CONTROL_STATUSES.MISSING_CLOSING_DOCS;
  else if (sentUnsignedDocs.length > 0 && maxUnsignedDays > overdueDays) status = DOCUMENT_CONTROL_STATUSES.OVERDUE_SIGNATURE;
  else if (sentUnsignedDocs.length > 0) status = DOCUMENT_CONTROL_STATUSES.SENT_WAITING;
  else if (unsignedDocs.length > 0 || !hasSignedContract || (closed && !hasSignedClosingDoc)) status = DOCUMENT_CONTROL_STATUSES.UNSIGNED;

  return {
    rentalId: display.rentalId,
    clientId: display.clientId,
    client: display.client,
    equipment: display.equipment,
    responsible: display.responsible,
    status,
    statusLabel: DOCUMENT_CONTROL_LABELS[status] || DOCUMENT_CONTROL_LABELS.unknown,
    risk: riskForStatus(status),
    contract: {
      exists: hasContract,
      signed: hasSignedContract,
      count: contracts.length,
      label: hasSignedContract ? 'Есть, подписан' : hasContract ? 'Есть, без подписи' : 'Нет договора',
    },
    closing: {
      exists: hasClosingDoc,
      signed: hasSignedClosingDoc,
      count: closingDocs.length,
      label: hasSignedClosingDoc ? 'Есть, подписан' : hasClosingDoc ? 'Есть, без подписи' : 'Нет акта/УПД',
    },
    unsignedCount: unsignedDocs.length,
    sentWaitingCount: sentUnsignedDocs.length,
    maxDaysWithoutSignature: maxUnsignedDays,
    latestDocuments: [...rentalDocuments]
      .sort((left, right) => dateKey(right?.date).localeCompare(dateKey(left?.date)))
      .slice(0, 5)
      .map(doc => ({
        id: safeId(doc?.id),
        number: safeDisplay(doc?.number, doc?.id),
        type: documentTypeLabel(documentType(doc)),
        status: documentStatusLabel(documentStatus(doc)),
        date: dateKey(doc?.date),
      })),
  };
}

function buildRentalRows({ rentals, docsByRentalId, maps, todayKey, overdueDays }) {
  return rentals
    .filter(isRentalRelevant)
    .map(rental => buildRentalSummary(rental, docsByRentalId.get(safeId(rental?.id)) || [], maps, todayKey, overdueDays))
    .filter(summary => summary.status !== DOCUMENT_CONTROL_STATUSES.OK)
    .map(summary => makeRow({
      id: `rental-${summary.rentalId}-${summary.status}`,
      status: summary.status,
      client: summary.client,
      clientId: summary.clientId,
      rentalId: summary.rentalId,
      equipment: summary.equipment,
      documentType: summary.status === DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT ? 'Договор' : 'Акт/УПД',
      documentStatus: summary.statusLabel,
      daysWithoutSignature: summary.maxDaysWithoutSignature,
      responsible: summary.responsible,
      rentalClosed: isRentalClosed(maps.rentalsById.get(summary.rentalId)),
    }));
}

export function buildDocumentControl(input = {}) {
  const rentals = Array.isArray(input.rentals) ? input.rentals : [];
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const clients = Array.isArray(input.clients) ? input.clients : [];
  const equipment = Array.isArray(input.equipment) ? input.equipment : [];
  const todayKey = dateKey(input.today) || new Date().toISOString().slice(0, 10);
  const overdueDays = Number.isFinite(Number(input.signatureOverdueDays)) ? Math.max(1, Number(input.signatureOverdueDays)) : 7;
  const maps = buildMaps({ rentals, clients, equipment });
  const docsByRentalId = new Map();

  documents.forEach(doc => {
    const rentalId = getDocumentRentalId(doc);
    if (!rentalId) return;
    const list = docsByRentalId.get(rentalId) || [];
    list.push(doc);
    docsByRentalId.set(rentalId, list);
  });

  const rentalSummaries = new Map();
  rentals.forEach(rental => {
    const rentalId = safeId(rental?.id);
    if (!rentalId) return;
    rentalSummaries.set(rentalId, buildRentalSummary(rental, docsByRentalId.get(rentalId) || [], maps, todayKey, overdueDays));
  });

  const documentRows = buildDocumentRows({ documents, maps, todayKey, overdueDays })
    .filter(row => row.status !== DOCUMENT_CONTROL_STATUSES.OK);
  const rentalRows = buildRentalRows({ rentals, docsByRentalId, maps, todayKey, overdueDays });
  const rows = [...rentalRows, ...documentRows].sort(sortRows);
  const relevantRentalSummaries = Array.from(rentalSummaries.values()).filter(summary => {
    const rental = maps.rentalsById.get(summary.rentalId);
    return isRentalRelevant(rental);
  });
  const closedRentalSummaries = relevantRentalSummaries.filter(summary => {
    const rental = maps.rentalsById.get(summary.rentalId);
    return isRentalClosed(rental);
  });

  const kpi = {
    totalDocuments: documents.length,
    unsignedDocuments: documents.filter(isUnsigned).length,
    sentWaiting: documents.filter(isSentUnsigned).length,
    rentalsWithoutContract: relevantRentalSummaries.filter(summary => !summary.contract.exists).length,
    closedRentalsWithoutClosingDocs: closedRentalSummaries.filter(summary => !summary.closing.exists).length,
    overdueSignature: rows.filter(row => row.status === DOCUMENT_CONTROL_STATUSES.OVERDUE_SIGNATURE).length,
    orphanDocuments: documentRows.filter(row => row.status === DOCUMENT_CONTROL_STATUSES.ORPHAN_DOCUMENT).length,
  };

  return {
    kpi,
    rows: rows.slice(0, Number.isFinite(Number(input.limit)) ? Math.max(1, Number(input.limit)) : rows.length),
    allRowsCount: rows.length,
    rentalSummaries,
    getRentalSummary(rentalId) {
      return rentalSummaries.get(normalizeText(rentalId)) || null;
    },
    tasks: rows.slice(0, 10).map(row => ({
      id: `documents-control-${row.id}`,
      title: row.statusLabel,
      description: `${row.client} · ${row.rentalId || row.documentId || 'документ'} · ${row.action}`,
      priority: row.risk,
      section: 'documents',
      actionUrl: row.rentalUrl || row.documentsUrl,
    })),
  };
}

export function getDocumentControlStatusLabel(status) {
  return DOCUMENT_CONTROL_LABELS[normalizeText(status)] || DOCUMENT_CONTROL_LABELS.unknown;
}
