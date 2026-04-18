function createAuditEntry(author, text, type = 'system') {
  return {
    date: new Date().toISOString(),
    text,
    author,
    type,
  };
}

function createRentalHistoryEntry(author, text, type = 'system') {
  return {
    date: new Date().toISOString(),
    text,
    author,
    type,
  };
}

function displayValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') return String(value);
  const stringValue = String(value);
  return stringValue.trim() || '—';
}

function displayDate(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

function entryKey(entry) {
  return [
    entry?.author || '',
    entry?.type || 'system',
    entry?.text || '',
  ].join('::');
}

function extractIncomingEntries(previousEntries = [], incomingEntries = []) {
  const existing = new Set((previousEntries || []).map(entryKey));
  return (incomingEntries || []).filter(entry => entry && !existing.has(entryKey(entry)));
}

function appendUniqueEntries(previousEntries = [], ...groups) {
  const next = [...(previousEntries || [])];
  const seen = new Set(next.map(entryKey));

  groups.flat().filter(Boolean).forEach(entry => {
    const key = entryKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(entry);
  });

  return next;
}

function buildFieldDiffHistory(previous, next, labels, author, prefix) {
  const changes = [];

  Object.entries(labels).forEach(([field, label]) => {
    if (previous?.[field] !== next?.[field]) {
      changes.push(
        `${label}: ${displayValue(previous?.[field])} → ${displayValue(next?.[field])}`,
      );
    }
  });

  if (changes.length === 0) return [];
  return [createAuditEntry(author, `${prefix}: ${changes.join('; ')}`)];
}

function buildEntityCreateHistory(collection, entity, author) {
  if (collection === 'clients') {
    return [createAuditEntry(author, `Клиент создан: ${entity.company || entity.id}`)];
  }

  if (collection === 'equipment') {
    return [createAuditEntry(author, `Техника создана: ${entity.inventoryNumber || entity.id} · ${entity.manufacturer || ''} ${entity.model || ''}`.trim())];
  }

  return [];
}

function buildEntityUpdateHistory(collection, previous, next, author) {
  if (collection === 'clients') {
    return buildFieldDiffHistory(
      previous,
      next,
      {
        company: 'компания',
        inn: 'ИНН',
        email: 'email',
        address: 'адрес',
        contact: 'контакт',
        phone: 'телефон',
        paymentTerms: 'условия оплаты',
        creditLimit: 'кредитный лимит',
        debt: 'задолженность',
        manager: 'менеджер',
        notes: 'примечание',
        status: 'статус',
      },
      author,
      'Обновлён клиент',
    );
  }

  if (collection === 'equipment') {
    return buildFieldDiffHistory(
      previous,
      next,
      {
        inventoryNumber: 'инвентарный номер',
        manufacturer: 'производитель',
        model: 'модель',
        serialNumber: 'серийный номер',
        type: 'тип',
        drive: 'привод',
        year: 'год выпуска',
        hours: 'моточасы',
        liftHeight: 'высота подъёма',
        workingHeight: 'рабочая высота',
        loadCapacity: 'грузоподъёмность',
        weight: 'масса',
        dimensions: 'габариты',
        owner: 'собственник',
        category: 'категория',
        priority: 'приоритет',
        activeInFleet: 'активный парк',
        subleasePrice: 'стоимость субаренды',
        location: 'локация',
        status: 'статус',
        plannedMonthlyRevenue: 'плановый доход',
        nextMaintenance: 'следующее ТО',
        maintenanceCHTO: 'дата ЧТО',
        maintenancePTO: 'дата ПТО',
        notes: 'примечание',
      },
      author,
      'Обновлена карточка техники',
    );
  }

  return [];
}

function buildRentalCreationHistory(rental, author) {
  const label = rental.status === 'active' ? 'Аренда создана и активирована' : 'Аренда создана';
  return [
    createRentalHistoryEntry(
      author,
      `${label}: ${rental.client || '—'} · ${displayDate(rental.startDate)} — ${displayDate(rental.endDate)}`,
    ),
  ];
}

function buildRentalUpdateHistory(previous, next, author) {
  const changes = [];

  if (previous.client !== next.client) {
    changes.push(`клиент: ${displayValue(previous.client)} → ${displayValue(next.client)}`);
  }
  if (previous.manager !== next.manager) {
    changes.push(`менеджер: ${displayValue(previous.manager)} → ${displayValue(next.manager)}`);
  }
  if (previous.startDate !== next.startDate || previous.endDate !== next.endDate) {
    changes.push(
      `даты: ${displayDate(previous.startDate)} — ${displayDate(previous.endDate)} → ${displayDate(next.startDate)} — ${displayDate(next.endDate)}`,
    );
  }
  if ((previous.amount || 0) !== (next.amount || 0)) {
    changes.push(`сумма: ${displayValue(previous.amount || 0)} → ${displayValue(next.amount || 0)}`);
  }
  if ((previous.expectedPaymentDate || '') !== (next.expectedPaymentDate || '')) {
    changes.push(`ожидаемая оплата: ${displayDate(previous.expectedPaymentDate)} → ${displayDate(next.expectedPaymentDate)}`);
  }

  if (changes.length === 0) return [];
  return [createRentalHistoryEntry(author, `Обновлена аренда: ${changes.join('; ')}`)];
}

function mergeEntityHistory(collection, previousEntity, nextEntity, author) {
  const previousHistory = previousEntity?.history || [];
  const incomingHistory = nextEntity?.history || [];
  const serverEntries = previousEntity
    ? buildEntityUpdateHistory(collection, previousEntity, nextEntity, author)
    : buildEntityCreateHistory(collection, nextEntity, author);
  const incomingEntries = extractIncomingEntries(previousHistory, incomingHistory);

  return {
    ...nextEntity,
    history: appendUniqueEntries(previousHistory, serverEntries, incomingEntries),
  };
}

function mergeRentalHistory(previousRental, nextRental, author) {
  const previousComments = previousRental?.comments || [];
  const incomingComments = nextRental?.comments || [];
  const serverEntries = previousRental
    ? buildRentalUpdateHistory(previousRental, nextRental, author)
    : buildRentalCreationHistory(nextRental, author);
  const incomingEntries = extractIncomingEntries(previousComments, incomingComments);

  return {
    ...nextRental,
    comments: appendUniqueEntries(previousComments, serverEntries, incomingEntries),
  };
}

module.exports = {
  createAuditEntry,
  createRentalHistoryEntry,
  buildFieldDiffHistory,
  buildEntityCreateHistory,
  buildEntityUpdateHistory,
  buildRentalCreationHistory,
  buildRentalUpdateHistory,
  mergeEntityHistory,
  mergeRentalHistory,
  appendUniqueEntries,
  extractIncomingEntries,
};
