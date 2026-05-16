const RENTAL_OPEN_STATUSES = new Set(['active', 'confirmed', 'return_planned', 'planned']);
const RENTAL_CLOSED_STATUSES = new Set(['closed', 'returned', 'completed', 'done']);
const DOCUMENT_TYPES = new Set(['rental_contract', 'rental_specification', 'specification', 'spec', 'transfer_act_to_client', 'transfer_act', 'return_act_from_client', 'return_act', 'contract', 'act', 'invoice', 'work_order', 'upd']);
const DOCUMENT_STATUSES = new Set(['draft', 'sent', 'signed']);
const INACTIVE_DOCUMENT_STATUSES = new Set(['cancelled', 'canceled', 'deleted']);

export const DOCUMENT_CONTROL_STATUSES = {
  OK: 'ok',
  MISSING_CONTRACT: 'missing_contract',
  MISSING_SPECIFICATION: 'missing_specification',
  MISSING_TRANSFER_ACT: 'missing_transfer_act',
  MISSING_RETURN_ACT: 'missing_return_act',
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
  missing_specification: 'Нет спецификации',
  missing_transfer_act: 'Нет акта передачи',
  missing_return_act: 'Нет акта возврата',
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

function getDocumentEquipmentInv(doc) {
  return safeId(doc?.equipmentInv, doc?.inventoryNumber, doc?.equipment);
}

function getDocumentParentId(doc) {
  return safeId(doc?.parentDocumentId, doc?.parentId);
}

function getDocumentSpecificationId(doc) {
  return safeId(doc?.specificationId, doc?.specId);
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

function isDocumentActive(doc) {
  return !INACTIVE_DOCUMENT_STATUSES.has(normalizeStatus(doc?.status));
}

function documentTypeLabel(type) {
  if (type === 'contract') return 'Договор';
  if (type === 'rental_contract') return 'Договор аренды';
  if (type === 'rental_specification' || type === 'specification' || type === 'spec') return 'Спецификация';
  if (type === 'transfer_act_to_client' || type === 'transfer_act') return 'Акт передачи';
  if (type === 'return_act_from_client' || type === 'return_act') return 'Акт возврата';
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
  return ['contract', 'rental_contract'].includes(documentType(doc));
}

function isClosingDocument(doc) {
  return ['act', 'upd', 'return_act_from_client', 'return_act'].includes(documentType(doc));
}

function isSpecification(doc) {
  return ['rental_specification', 'specification', 'spec'].includes(documentType(doc));
}

function isTransferAct(doc) {
  return ['transfer_act_to_client', 'transfer_act'].includes(documentType(doc));
}

function isReturnAct(doc) {
  return ['return_act_from_client', 'return_act'].includes(documentType(doc));
}

function isUnsigned(doc) {
  return isDocumentActive(doc) && ['contract', 'rental_contract', 'rental_specification', 'specification', 'spec', 'transfer_act_to_client', 'transfer_act', 'return_act_from_client', 'return_act', 'act', 'upd'].includes(documentType(doc)) && documentStatus(doc) !== 'signed';
}

function isSentUnsigned(doc) {
  return isUnsigned(doc) && documentStatus(doc) === 'sent';
}

function isRentalClosed(rental) {
  const status = normalizeStatus(rental?.status);
  return RENTAL_CLOSED_STATUSES.has(status) || Boolean(rental?.actualReturnDate);
}

function documentChainItem(doc) {
  return {
    id: safeId(doc?.id),
    number: safeDisplay(doc?.documentNumber, doc?.number, doc?.id),
    type: documentTypeLabel(documentType(doc)),
    status: documentStatusLabel(documentStatus(doc)),
    rawStatus: documentStatus(doc),
    date: dateKey(doc?.documentDate || doc?.date || doc?.createdAt),
    parentDocumentId: getDocumentParentId(doc),
    specificationId: getDocumentSpecificationId(doc),
  };
}

function isRentalRelevant(rental) {
  const status = normalizeStatus(rental?.status);
  return !['cancelled', 'canceled'].includes(status) && (RENTAL_OPEN_STATUSES.has(status) || isRentalClosed(rental) || !status);
}

function documentMatchesRentalPartyAndEquipment(doc, rental) {
  const rentalClientId = safeId(rental?.clientId);
  const docClientId = getDocumentClientId(doc);
  if (!rentalClientId || !docClientId || rentalClientId !== docClientId) return false;

  const rentalEquipmentId = getRentalEquipmentId(rental);
  const docEquipmentId = getDocumentEquipmentId(doc);
  if (rentalEquipmentId && docEquipmentId) return rentalEquipmentId === docEquipmentId;

  const rentalEquipmentInv = getRentalEquipmentInv(rental);
  const docEquipmentInv = getDocumentEquipmentInv(doc);
  return Boolean(rentalEquipmentInv && docEquipmentInv && rentalEquipmentInv === docEquipmentInv);
}

function actionForStatus(status) {
  if (status === DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT) return 'Создать или привязать договор';
  if (status === DOCUMENT_CONTROL_STATUSES.MISSING_SPECIFICATION) return 'Создать спецификацию';
  if (status === DOCUMENT_CONTROL_STATUSES.MISSING_TRANSFER_ACT) return 'Создать акт передачи';
  if (status === DOCUMENT_CONTROL_STATUSES.MISSING_RETURN_ACT) return 'Создать акт возврата';
  if (status === DOCUMENT_CONTROL_STATUSES.MISSING_CLOSING_DOCS) return 'Подготовить акт/УПД';
  if (status === DOCUMENT_CONTROL_STATUSES.OVERDUE_SIGNATURE) return 'Напомнить о подписи';
  if (status === DOCUMENT_CONTROL_STATUSES.SENT_WAITING) return 'Проверить подпись';
  if (status === DOCUMENT_CONTROL_STATUSES.UNSIGNED) return 'Довести до подписи';
  if (status === DOCUMENT_CONTROL_STATUSES.ORPHAN_DOCUMENT) return 'Уточнить связь документа';
  if (status === DOCUMENT_CONTROL_STATUSES.UNKNOWN) return 'Проверить реквизиты';
  return 'Контроль не требуется';
}

function riskForStatus(status) {
  if ([DOCUMENT_CONTROL_STATUSES.MISSING_CLOSING_DOCS, DOCUMENT_CONTROL_STATUSES.MISSING_RETURN_ACT, DOCUMENT_CONTROL_STATUSES.OVERDUE_SIGNATURE].includes(status)) return 'critical';
  if ([DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT, DOCUMENT_CONTROL_STATUSES.MISSING_SPECIFICATION, DOCUMENT_CONTROL_STATUSES.MISSING_TRANSFER_ACT, DOCUMENT_CONTROL_STATUSES.ORPHAN_DOCUMENT].includes(status)) return 'high';
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
  const specifications = rentalDocuments.filter(isSpecification);
  const transferActs = rentalDocuments.filter(isTransferAct);
  const returnActs = rentalDocuments.filter(isReturnAct);
  const closingDocs = rentalDocuments.filter(isClosingDocument);
  const unsignedDocs = rentalDocuments.filter(isUnsigned);
  const sentUnsignedDocs = rentalDocuments.filter(isSentUnsigned);
  const maxUnsignedDays = unsignedDocs.reduce((max, doc) => {
    const sentDate = dateKey(doc?.sentAt || doc?.sentDate || doc?.date || doc?.createdAt);
    return Math.max(max, daysBetween(sentDate, todayKey));
  }, 0);
  const hasSignedContract = contracts.some(doc => documentStatus(doc) === 'signed');
  const hasContract = contracts.length > 0;
  const hasRentalContract = contracts.some(doc => documentType(doc) === 'rental_contract');
  const hasSpecification = specifications.length > 0;
  const hasTransferAct = transferActs.length > 0;
  const hasReturnAct = returnActs.length > 0;
  const hasSignedClosingDoc = closingDocs.some(doc => documentStatus(doc) === 'signed');
  const hasClosingDoc = closingDocs.length > 0;
  const closed = isRentalClosed(rental);

  let status = DOCUMENT_CONTROL_STATUSES.OK;
  if (!hasContract) status = DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT;
  else if (hasRentalContract && !hasSpecification) status = DOCUMENT_CONTROL_STATUSES.MISSING_SPECIFICATION;
  else if (hasRentalContract && !hasTransferAct && !closed) status = DOCUMENT_CONTROL_STATUSES.MISSING_TRANSFER_ACT;
  else if (hasRentalContract && closed && !hasReturnAct) status = DOCUMENT_CONTROL_STATUSES.MISSING_RETURN_ACT;
  else if (closed && !hasClosingDoc) status = DOCUMENT_CONTROL_STATUSES.MISSING_CLOSING_DOCS;
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
      documents: contracts.map(documentChainItem),
    },
    specification: {
      exists: hasSpecification,
      count: specifications.length,
      label: hasSpecification ? 'Есть' : 'Нет спецификации',
      documents: specifications.map(documentChainItem),
    },
    transferAct: {
      exists: hasTransferAct,
      count: transferActs.length,
      label: hasTransferAct ? 'Есть' : 'Нет акта передачи',
      documents: transferActs.map(documentChainItem),
    },
    returnAct: {
      exists: hasReturnAct,
      count: returnActs.length,
      label: hasReturnAct ? 'Есть' : 'Нет акта возврата',
      documents: returnActs.map(documentChainItem),
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
      documentType: summary.status === DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT
        ? 'Договор'
        : summary.status === DOCUMENT_CONTROL_STATUSES.MISSING_SPECIFICATION
          ? 'Спецификация'
          : summary.status === DOCUMENT_CONTROL_STATUSES.MISSING_TRANSFER_ACT
            ? 'Акт передачи'
            : summary.status === DOCUMENT_CONTROL_STATUSES.MISSING_RETURN_ACT
              ? 'Акт возврата'
              : 'Акт/УПД',
      documentStatus: summary.statusLabel,
      daysWithoutSignature: summary.maxDaysWithoutSignature,
      responsible: summary.responsible,
      rentalClosed: isRentalClosed(maps.rentalsById.get(summary.rentalId)),
    }));
}

function buildRentalDocumentMap({ rentals, documents }) {
  const activeDocuments = documents.filter(isDocumentActive);
  const documentsById = new Map();
  activeDocuments.forEach(doc => {
    const id = safeId(doc?.id);
    if (id) documentsById.set(id, doc);
  });

  const specsByRentalId = new Map();
  activeDocuments.filter(isSpecification).forEach(doc => {
    const rentalId = getDocumentRentalId(doc);
    if (!rentalId) return;
    const list = specsByRentalId.get(rentalId) || [];
    list.push(doc);
    specsByRentalId.set(rentalId, list);
  });

  const docsByRentalId = new Map();
  rentals.forEach(rental => {
    const rentalId = safeId(rental?.id);
    if (!rentalId) return;

    const rentalDocs = new Map();
    const addDoc = doc => {
      const id = safeId(doc?.id);
      if (id) rentalDocs.set(id, doc);
    };

    activeDocuments.forEach(doc => {
      if (getDocumentRentalId(doc) === rentalId) addDoc(doc);
    });

    const specifications = specsByRentalId.get(rentalId) || [];
    specifications.forEach(addDoc);

    const specificationIds = new Set(specifications.map(doc => safeId(doc?.id)).filter(Boolean));
    const contractIds = new Set();
    specifications.forEach(specification => {
      const parentId = getDocumentParentId(specification);
      const contract = parentId ? documentsById.get(parentId) : null;
      if (contract && isContract(contract)) {
        addDoc(contract);
        const contractId = safeId(contract?.id);
        if (contractId) contractIds.add(contractId);
      }
    });

    activeDocuments.filter(isContract).forEach(contract => {
      if (getDocumentRentalId(contract) === rentalId) {
        addDoc(contract);
        const contractId = safeId(contract?.id);
        if (contractId) contractIds.add(contractId);
      }
    });

    activeDocuments.filter(doc => isTransferAct(doc) || isReturnAct(doc)).forEach(doc => {
      const specificationId = getDocumentSpecificationId(doc);
      const parentId = getDocumentParentId(doc);
      if (specificationId && specificationIds.has(specificationId)) return addDoc(doc);
      if (parentId && specificationIds.has(parentId)) return addDoc(doc);
      if (parentId && contractIds.has(parentId) && documentMatchesRentalPartyAndEquipment(doc, rental)) return addDoc(doc);
      if (!specificationId && !parentId && documentMatchesRentalPartyAndEquipment(doc, rental)) return addDoc(doc);
      return undefined;
    });

    docsByRentalId.set(rentalId, Array.from(rentalDocs.values()));
  });

  return docsByRentalId;
}

export function buildDocumentControl(input = {}) {
  const rentals = Array.isArray(input.rentals) ? input.rentals : [];
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const clients = Array.isArray(input.clients) ? input.clients : [];
  const equipment = Array.isArray(input.equipment) ? input.equipment : [];
  const todayKey = dateKey(input.today) || new Date().toISOString().slice(0, 10);
  const overdueDays = Number.isFinite(Number(input.signatureOverdueDays)) ? Math.max(1, Number(input.signatureOverdueDays)) : 7;
  const maps = buildMaps({ rentals, clients, equipment });
  const activeDocuments = documents.filter(isDocumentActive);
  const docsByRentalId = buildRentalDocumentMap({ rentals, documents: activeDocuments });

  const rentalSummaries = new Map();
  rentals.forEach(rental => {
    const rentalId = safeId(rental?.id);
    if (!rentalId) return;
    rentalSummaries.set(rentalId, buildRentalSummary(rental, docsByRentalId.get(rentalId) || [], maps, todayKey, overdueDays));
  });

  const documentRows = buildDocumentRows({ documents: activeDocuments, maps, todayKey, overdueDays })
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
    unsignedDocuments: activeDocuments.filter(isUnsigned).length,
    sentWaiting: activeDocuments.filter(isSentUnsigned).length,
    rentalsWithoutContract: relevantRentalSummaries.filter(summary => !summary.contract.exists).length,
    rentalsWithoutSpecification: relevantRentalSummaries.filter(summary => summary.contract.exists && !summary.specification.exists).length,
    rentalsWithoutTransferAct: relevantRentalSummaries.filter(summary => summary.specification.exists && !summary.transferAct.exists).length,
    closedRentalsWithoutReturnAct: closedRentalSummaries.filter(summary => !summary.returnAct.exists).length,
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
