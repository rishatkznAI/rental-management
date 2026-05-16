const SHADOW_SCHEMA_VERSION = 1;

const DOCUMENTS_TABLE = 'documents_sql';
const GANTT_TABLE = 'gantt_rentals_sql';

function text(value) {
  return String(value ?? '').trim();
}

function nullableText(value) {
  const next = text(value);
  return next || null;
}

function dateOnly(value) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return match[1];
}

function timestampText(value) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return dateOnly(raw);
}

function canonicalGanttRentalId(record) {
  return text(record?.rentalId || record?.sourceRentalId || record?.originalRentalId || '');
}

function documentSearchText(record) {
  return [
    record?.id,
    record?.number,
    record?.documentNumber,
    record?.type,
    record?.documentType,
    record?.status,
    record?.clientId,
    record?.client,
    record?.clientName,
    record?.rentalId,
    record?.rental,
    record?.equipmentId,
    record?.equipmentInv,
    record?.inventoryNumber,
    record?.objectId,
    record?.contractId,
    record?.manager,
    record?.managerId,
    record?.ownerId,
    record?.signatoryName,
    record?.signatoryBasis,
  ].map(text).filter(Boolean).join(' ').toLowerCase();
}

function ganttSearchText(record) {
  return [
    record?.id,
    record?.rentalId,
    record?.sourceRentalId,
    record?.originalRentalId,
    record?.clientId,
    record?.client,
    record?.clientName,
    record?.clientShort,
    record?.equipmentId,
    record?.equipmentInv,
    record?.inventoryNumber,
    record?.serialNumber,
    record?.manager,
    record?.managerId,
    record?.ownerId,
    record?.objectId,
    record?.contractId,
    record?.status,
  ].map(text).filter(Boolean).join(' ').toLowerCase();
}

function normalizeDocumentRecord(record) {
  const id = text(record?.id);
  if (!id) return null;
  return {
    id,
    number: nullableText(record?.number || record?.documentNumber),
    type: nullableText(record?.type || record?.documentType),
    status: nullableText(record?.status),
    clientId: nullableText(record?.clientId),
    rentalId: nullableText(record?.rentalId || record?.rental),
    equipmentId: nullableText(record?.equipmentId),
    objectId: nullableText(record?.objectId),
    contractId: nullableText(record?.contractId),
    createdAt: timestampText(record?.createdAt || record?.date || record?.documentDate),
    updatedAt: timestampText(record?.updatedAt || record?.createdAt || record?.date || record?.documentDate),
    signedAt: timestampText(record?.signedAt),
    sentAt: timestampText(record?.sentAt),
    managerId: nullableText(record?.managerId),
    ownerId: nullableText(record?.ownerId),
    parentDocumentId: nullableText(record?.parentDocumentId),
    searchText: documentSearchText(record),
    rawJson: JSON.stringify(record),
  };
}

function normalizeGanttRecord(record) {
  const id = text(record?.id);
  if (!id) return null;
  return {
    id,
    rentalId: nullableText(canonicalGanttRentalId(record)),
    sourceRentalId: nullableText(record?.sourceRentalId),
    originalRentalId: nullableText(record?.originalRentalId),
    equipmentId: nullableText(record?.equipmentId),
    clientId: nullableText(record?.clientId),
    managerId: nullableText(record?.managerId),
    ownerId: nullableText(record?.ownerId),
    status: nullableText(record?.status),
    startDate: dateOnly(record?.startDate),
    endDate: dateOnly(record?.endDate || record?.plannedReturnDate),
    plannedReturnDate: dateOnly(record?.plannedReturnDate || record?.endDate),
    objectId: nullableText(record?.objectId),
    contractId: nullableText(record?.contractId),
    searchText: ganttSearchText(record),
    rawJson: JSON.stringify(record),
  };
}

function ensureSqlShadowSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sql_shadow_schema_migrations (
      name TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ${DOCUMENTS_TABLE} (
      id TEXT PRIMARY KEY,
      number TEXT,
      type TEXT,
      status TEXT,
      clientId TEXT,
      rentalId TEXT,
      equipmentId TEXT,
      objectId TEXT,
      contractId TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      signedAt TEXT,
      sentAt TEXT,
      managerId TEXT,
      ownerId TEXT,
      parentDocumentId TEXT,
      searchText TEXT,
      rawJson TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_sql_type ON ${DOCUMENTS_TABLE}(type);
    CREATE INDEX IF NOT EXISTS idx_documents_sql_status ON ${DOCUMENTS_TABLE}(status);
    CREATE INDEX IF NOT EXISTS idx_documents_sql_client ON ${DOCUMENTS_TABLE}(clientId);
    CREATE INDEX IF NOT EXISTS idx_documents_sql_rental ON ${DOCUMENTS_TABLE}(rentalId);
    CREATE INDEX IF NOT EXISTS idx_documents_sql_equipment ON ${DOCUMENTS_TABLE}(equipmentId);
    CREATE INDEX IF NOT EXISTS idx_documents_sql_contract ON ${DOCUMENTS_TABLE}(contractId);
    CREATE INDEX IF NOT EXISTS idx_documents_sql_created ON ${DOCUMENTS_TABLE}(createdAt);
    CREATE INDEX IF NOT EXISTS idx_documents_sql_updated ON ${DOCUMENTS_TABLE}(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_documents_sql_number ON ${DOCUMENTS_TABLE}(number);
    CREATE INDEX IF NOT EXISTS idx_documents_sql_refs ON ${DOCUMENTS_TABLE}(type, status, clientId, rentalId, equipmentId, contractId, createdAt);

    CREATE TABLE IF NOT EXISTS ${GANTT_TABLE} (
      id TEXT PRIMARY KEY,
      rentalId TEXT,
      sourceRentalId TEXT,
      originalRentalId TEXT,
      equipmentId TEXT,
      clientId TEXT,
      managerId TEXT,
      ownerId TEXT,
      status TEXT,
      startDate TEXT,
      endDate TEXT,
      plannedReturnDate TEXT,
      objectId TEXT,
      contractId TEXT,
      searchText TEXT,
      rawJson TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_rental ON ${GANTT_TABLE}(rentalId);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_source_rental ON ${GANTT_TABLE}(sourceRentalId);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_original_rental ON ${GANTT_TABLE}(originalRentalId);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_equipment ON ${GANTT_TABLE}(equipmentId);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_client ON ${GANTT_TABLE}(clientId);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_manager ON ${GANTT_TABLE}(managerId);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_owner ON ${GANTT_TABLE}(ownerId);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_status ON ${GANTT_TABLE}(status);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_start ON ${GANTT_TABLE}(startDate);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_end ON ${GANTT_TABLE}(endDate);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_equipment_overlap ON ${GANTT_TABLE}(equipmentId, startDate, endDate);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_overlap ON ${GANTT_TABLE}(startDate, endDate);
    CREATE INDEX IF NOT EXISTS idx_gantt_rentals_sql_status_overlap ON ${GANTT_TABLE}(status, startDate, endDate);
  `);
  db.prepare(`
    INSERT INTO sql_shadow_schema_migrations (name, version)
    VALUES ('documents_gantt_shadow_indexes', ?)
    ON CONFLICT(name) DO UPDATE SET
      version = excluded.version,
      applied_at = CURRENT_TIMESTAMP
  `).run(SHADOW_SCHEMA_VERSION);
}

function readAppDataCollection(db, name) {
  const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
  if (!row) return { ok: true, value: [], missing: true };
  try {
    const value = JSON.parse(row.json);
    return { ok: true, value: Array.isArray(value) ? value : [], rawType: Array.isArray(value) ? 'array' : typeof value };
  } catch (error) {
    return { ok: false, value: [], error: error.message };
  }
}

function makeStats() {
  return { source: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
}

function upsertDocuments(db, records) {
  const stats = makeStats();
  stats.source = Array.isArray(records) ? records.length : 0;
  const existing = new Set(db.prepare(`SELECT id FROM ${DOCUMENTS_TABLE}`).all().map(row => row.id));
  const stmt = db.prepare(`
    INSERT INTO ${DOCUMENTS_TABLE} (
      id, number, type, status, clientId, rentalId, equipmentId, objectId, contractId,
      createdAt, updatedAt, signedAt, sentAt, managerId, ownerId, parentDocumentId, searchText, rawJson
    ) VALUES (
      @id, @number, @type, @status, @clientId, @rentalId, @equipmentId, @objectId, @contractId,
      @createdAt, @updatedAt, @signedAt, @sentAt, @managerId, @ownerId, @parentDocumentId, @searchText, @rawJson
    )
    ON CONFLICT(id) DO UPDATE SET
      number = excluded.number,
      type = excluded.type,
      status = excluded.status,
      clientId = excluded.clientId,
      rentalId = excluded.rentalId,
      equipmentId = excluded.equipmentId,
      objectId = excluded.objectId,
      contractId = excluded.contractId,
      createdAt = excluded.createdAt,
      updatedAt = excluded.updatedAt,
      signedAt = excluded.signedAt,
      sentAt = excluded.sentAt,
      managerId = excluded.managerId,
      ownerId = excluded.ownerId,
      parentDocumentId = excluded.parentDocumentId,
      searchText = excluded.searchText,
      rawJson = excluded.rawJson
  `);
  for (const record of Array.isArray(records) ? records : []) {
    try {
      const normalized = normalizeDocumentRecord(record);
      if (!normalized) {
        stats.skipped += 1;
        continue;
      }
      stmt.run(normalized);
      if (existing.has(normalized.id)) stats.updated += 1;
      else {
        stats.inserted += 1;
        existing.add(normalized.id);
      }
    } catch (error) {
      stats.errors.push({ id: text(record?.id) || null, error: error.message });
    }
  }
  return stats;
}

function upsertGanttRentals(db, records) {
  const stats = makeStats();
  stats.source = Array.isArray(records) ? records.length : 0;
  const existing = new Set(db.prepare(`SELECT id FROM ${GANTT_TABLE}`).all().map(row => row.id));
  const stmt = db.prepare(`
    INSERT INTO ${GANTT_TABLE} (
      id, rentalId, sourceRentalId, originalRentalId, equipmentId, clientId, managerId, ownerId,
      status, startDate, endDate, plannedReturnDate, objectId, contractId, searchText, rawJson
    ) VALUES (
      @id, @rentalId, @sourceRentalId, @originalRentalId, @equipmentId, @clientId, @managerId, @ownerId,
      @status, @startDate, @endDate, @plannedReturnDate, @objectId, @contractId, @searchText, @rawJson
    )
    ON CONFLICT(id) DO UPDATE SET
      rentalId = excluded.rentalId,
      sourceRentalId = excluded.sourceRentalId,
      originalRentalId = excluded.originalRentalId,
      equipmentId = excluded.equipmentId,
      clientId = excluded.clientId,
      managerId = excluded.managerId,
      ownerId = excluded.ownerId,
      status = excluded.status,
      startDate = excluded.startDate,
      endDate = excluded.endDate,
      plannedReturnDate = excluded.plannedReturnDate,
      objectId = excluded.objectId,
      contractId = excluded.contractId,
      searchText = excluded.searchText,
      rawJson = excluded.rawJson
  `);
  for (const record of Array.isArray(records) ? records : []) {
    try {
      const normalized = normalizeGanttRecord(record);
      if (!normalized) {
        stats.skipped += 1;
        continue;
      }
      stmt.run(normalized);
      if (existing.has(normalized.id)) stats.updated += 1;
      else {
        stats.inserted += 1;
        existing.add(normalized.id);
      }
    } catch (error) {
      stats.errors.push({ id: text(record?.id) || null, error: error.message });
    }
  }
  return stats;
}

function backfillSqlShadowIndexes(db, options = {}) {
  ensureSqlShadowSchema(db);
  const documents = readAppDataCollection(db, 'documents');
  const ganttRentals = readAppDataCollection(db, 'gantt_rentals');
  const result = {
    ok: documents.ok && ganttRentals.ok,
    sourceOfTruth: 'app_data',
    destructiveChanges: false,
    documents: makeStats(),
    gantt_rentals: makeStats(),
    sourceErrors: [],
  };
  if (!documents.ok) result.sourceErrors.push({ collection: 'documents', error: documents.error });
  if (!ganttRentals.ok) result.sourceErrors.push({ collection: 'gantt_rentals', error: ganttRentals.error });
  const tx = db.transaction(() => {
    if (documents.ok) result.documents = upsertDocuments(db, documents.value);
    if (ganttRentals.ok) result.gantt_rentals = upsertGanttRentals(db, ganttRentals.value);
  });
  tx();
  if (options.logger) {
    [...result.documents.errors, ...result.gantt_rentals.errors].forEach(entry => {
      options.logger.warn?.(`[sql-shadow] skipped record id=${entry.id || '(missing)'}: ${entry.error}`);
    });
  }
  return result;
}

function syncSqlShadowIndexForCollection(db, collection, records) {
  ensureSqlShadowSchema(db);
  const ids = new Set((Array.isArray(records) ? records : []).map(record => text(record?.id)).filter(Boolean));
  if (collection === 'documents') {
    const result = upsertDocuments(db, records);
    const existing = db.prepare(`SELECT id FROM ${DOCUMENTS_TABLE}`).all().map(row => text(row.id)).filter(Boolean);
    const del = db.prepare(`DELETE FROM ${DOCUMENTS_TABLE} WHERE id = ?`);
    result.deleted = 0;
    for (const id of existing) {
      if (!ids.has(id)) {
        del.run(id);
        result.deleted += 1;
      }
    }
    return result;
  }
  if (collection === 'gantt_rentals') {
    const result = upsertGanttRentals(db, records);
    const existing = db.prepare(`SELECT id FROM ${GANTT_TABLE}`).all().map(row => text(row.id)).filter(Boolean);
    const del = db.prepare(`DELETE FROM ${GANTT_TABLE} WHERE id = ?`);
    result.deleted = 0;
    for (const id of existing) {
      if (!ids.has(id)) {
        del.run(id);
        result.deleted += 1;
      }
    }
    return result;
  }
  return null;
}

function parseRawRows(rows) {
  return rows.flatMap(row => {
    try {
      return [JSON.parse(row.rawJson)];
    } catch {
      return [];
    }
  });
}

function queryDocumentsIndex(db, query = {}) {
  ensureSqlShadowSchema(db);
  const where = [];
  const params = {};
  for (const [field, column] of Object.entries({
    status: 'status',
    type: 'type',
    clientId: 'clientId',
    rentalId: 'rentalId',
    equipmentId: 'equipmentId',
    parentDocumentId: 'parentDocumentId',
  })) {
    const value = text(query[field]);
    if (value && value !== 'all') {
      where.push(`${column} = @${field}`);
      params[field] = value;
    }
  }
  const dateFrom = dateOnly(query.dateFrom);
  const dateTo = dateOnly(query.dateTo);
  if (dateFrom) {
    where.push('COALESCE(createdAt, updatedAt, sentAt, signedAt) >= @dateFrom');
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    where.push('COALESCE(createdAt, updatedAt, sentAt, signedAt) <= @dateToEnd');
    params.dateToEnd = `${dateTo}T23:59:59.999Z`;
  }
  const search = text(query.search).toLowerCase();
  if (search) {
    where.push('searchText LIKE @search');
    params.search = `%${search}%`;
  }
  const sql = `SELECT rawJson FROM ${DOCUMENTS_TABLE}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  return parseRawRows(db.prepare(sql).all(params));
}

function queryGanttIndex(db, query = {}) {
  ensureSqlShadowSchema(db);
  const where = [];
  const params = {};
  for (const [field, column] of Object.entries({
    clientId: 'clientId',
    equipmentId: 'equipmentId',
    contractId: 'contractId',
    status: 'status',
  })) {
    const value = text(query[field]);
    if (value && value !== 'all') {
      where.push(`${column} = @${field}`);
      params[field] = value;
    }
  }
  const rentalId = text(query.rentalId);
  if (rentalId && rentalId !== 'all') {
    where.push('(rentalId = @rentalId OR sourceRentalId = @rentalId OR originalRentalId = @rentalId OR id = @rentalId)');
    params.rentalId = rentalId;
  }
  const dateFrom = dateOnly(query.dateFrom);
  const dateTo = dateOnly(query.dateTo);
  if (dateFrom) {
    where.push('COALESCE(endDate, plannedReturnDate, startDate) >= @dateFrom');
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    where.push('COALESCE(startDate, endDate, plannedReturnDate) <= @dateTo');
    params.dateTo = dateTo;
  }
  const search = text(query.search).toLowerCase();
  if (search) {
    where.push('searchText LIKE @search');
    params.search = `%${search}%`;
  }
  const sql = `SELECT rawJson FROM ${GANTT_TABLE}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  return parseRawRows(db.prepare(sql).all(params));
}

function duplicateIds(list) {
  const counts = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const id = text(item?.id);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
}

function invalidDateRows(list, fields) {
  const rows = [];
  for (const item of Array.isArray(list) ? list : []) {
    for (const field of fields) {
      const value = text(item?.[field]);
      if (value && !dateOnly(value) && Number.isNaN(new Date(value).getTime())) {
        rows.push({ id: text(item?.id) || null, field, value: value.slice(0, 80) });
      }
    }
  }
  return rows;
}

function diagnoseSqlShadowConsistency(db) {
  ensureSqlShadowSchema(db);
  const documents = readAppDataCollection(db, 'documents');
  const ganttRentals = readAppDataCollection(db, 'gantt_rentals');
  const rentals = readAppDataCollection(db, 'rentals');
  const equipment = readAppDataCollection(db, 'equipment');
  const docSqlRows = db.prepare(`SELECT id, updatedAt FROM ${DOCUMENTS_TABLE}`).all();
  const ganttSqlRows = db.prepare(`SELECT id, rentalId, sourceRentalId, originalRentalId, equipmentId, startDate, endDate, plannedReturnDate FROM ${GANTT_TABLE}`).all();
  const sourceDocuments = documents.value;
  const sourceGantt = ganttRentals.value;
  const sourceDocIds = new Set(sourceDocuments.map(item => text(item?.id)).filter(Boolean));
  const sourceGanttIds = new Set(sourceGantt.map(item => text(item?.id)).filter(Boolean));
  const sqlDocIds = new Set(docSqlRows.map(item => text(item.id)).filter(Boolean));
  const sqlGanttIds = new Set(ganttSqlRows.map(item => text(item.id)).filter(Boolean));
  const rentalIds = new Set((rentals.value || []).map(item => text(item?.id)).filter(Boolean));
  const equipmentIds = new Set((equipment.value || []).map(item => text(item?.id)).filter(Boolean));
  const sourceDocsById = new Map(sourceDocuments.map(item => [text(item?.id), item]).filter(([id]) => id));
  const sourceGanttById = new Map(sourceGantt.map(item => [text(item?.id), item]).filter(([id]) => id));
  const docSqlById = new Map(docSqlRows.map(item => [text(item.id), item]));
  const mismatchedDocumentUpdatedAt = [...sourceDocsById.entries()].flatMap(([id, item]) => {
    const sql = docSqlById.get(id);
    if (!sql) return [];
    const sourceUpdatedAt = timestampText(item?.updatedAt || item?.createdAt || item?.date || item?.documentDate);
    return text(sourceUpdatedAt) !== text(sql.updatedAt) ? [{ id, sourceUpdatedAt, sqlUpdatedAt: sql.updatedAt || null }] : [];
  });
  const invalidRentalLinks = [...sourceGanttById.values()].flatMap(item => {
    const ids = [item?.rentalId, item?.sourceRentalId, item?.originalRentalId].map(text).filter(Boolean);
    if (ids.length === 0) return [];
    return ids.some(id => rentalIds.has(id)) ? [] : [{ id: text(item?.id), rentalIds: ids }];
  });
  const invalidEquipmentLinks = [...sourceGanttById.values()].flatMap(item => {
    const id = text(item?.equipmentId);
    return id && !equipmentIds.has(id) ? [{ id: text(item?.id), equipmentId: id }] : [];
  });
  const invalidDocumentChains = sourceDocuments.flatMap(item => {
    const parentId = text(item?.parentDocumentId);
    return parentId && !sourceDocIds.has(parentId) ? [{ id: text(item?.id), parentDocumentId: parentId }] : [];
  });
  const summary = {
    ok: documents.ok && ganttRentals.ok,
    sourceOfTruth: 'app_data',
    productionReadSwitched: false,
    documents: {
      appDataCount: sourceDocuments.length,
      sqlCount: docSqlRows.length,
      missingInSql: [...sourceDocIds].filter(id => !sqlDocIds.has(id)),
      extraInSql: [...sqlDocIds].filter(id => !sourceDocIds.has(id)),
      duplicateIds: duplicateIds(sourceDocuments),
      missingIds: sourceDocuments.filter(item => !text(item?.id)).length,
      mismatchedUpdatedAt: mismatchedDocumentUpdatedAt,
      invalidDates: invalidDateRows(sourceDocuments, ['createdAt', 'updatedAt', 'date', 'documentDate', 'sentAt', 'signedAt']),
      invalidDocumentChains,
    },
    gantt_rentals: {
      appDataCount: sourceGantt.length,
      sqlCount: ganttSqlRows.length,
      missingInSql: [...sourceGanttIds].filter(id => !sqlGanttIds.has(id)),
      extraInSql: [...sqlGanttIds].filter(id => !sourceGanttIds.has(id)),
      duplicateIds: duplicateIds(sourceGantt),
      missingIds: sourceGantt.filter(item => !text(item?.id)).length,
      invalidDates: invalidDateRows(sourceGantt, ['startDate', 'endDate', 'plannedReturnDate', 'createdAt', 'updatedAt']),
      invalidRentalLinks,
      invalidEquipmentLinks,
    },
    sourceErrors: [documents, ganttRentals, rentals, equipment]
      .filter(result => !result.ok)
      .map(result => result.error),
  };
  const criticalMismatch = summary.sourceErrors.length > 0 ||
    summary.documents.missingInSql.length > 0 ||
    summary.gantt_rentals.missingInSql.length > 0 ||
    summary.documents.duplicateIds.length > 0 ||
    summary.gantt_rentals.duplicateIds.length > 0;
  return { ...summary, criticalMismatch };
}

module.exports = {
  DOCUMENTS_TABLE,
  GANTT_TABLE,
  SHADOW_SCHEMA_VERSION,
  backfillSqlShadowIndexes,
  diagnoseSqlShadowConsistency,
  ensureSqlShadowSchema,
  normalizeDocumentRecord,
  normalizeGanttRecord,
  queryDocumentsIndex,
  queryGanttIndex,
  syncSqlShadowIndexForCollection,
};
