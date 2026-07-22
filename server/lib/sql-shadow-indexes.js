const SHADOW_SCHEMA_VERSION = 2;
const SHADOW_MIGRATION_NAME = 'documents_gantt_shadow_indexes';

const DOCUMENTS_TABLE = 'documents_sql';
const GANTT_TABLE = 'gantt_rentals_sql';

const EXPECTED_TABLE_COLUMNS = Object.freeze({
  [DOCUMENTS_TABLE]: Object.freeze([
    ['id', 'TEXT', 0, 1],
    ['number', 'TEXT', 0, 0],
    ['type', 'TEXT', 0, 0],
    ['status', 'TEXT', 0, 0],
    ['clientId', 'TEXT', 0, 0],
    ['rentalId', 'TEXT', 0, 0],
    ['equipmentId', 'TEXT', 0, 0],
    ['objectId', 'TEXT', 0, 0],
    ['contractId', 'TEXT', 0, 0],
    ['date', 'TEXT', 0, 0],
    ['documentDate', 'TEXT', 0, 0],
    ['createdAt', 'TEXT', 0, 0],
    ['updatedAt', 'TEXT', 0, 0],
    ['signedAt', 'TEXT', 0, 0],
    ['sentAt', 'TEXT', 0, 0],
    ['managerId', 'TEXT', 0, 0],
    ['ownerId', 'TEXT', 0, 0],
    ['parentDocumentId', 'TEXT', 0, 0],
    ['searchText', 'TEXT', 0, 0],
    ['rawJson', 'TEXT', 1, 0],
  ]),
  [GANTT_TABLE]: Object.freeze([
    ['id', 'TEXT', 0, 1],
    ['rentalId', 'TEXT', 0, 0],
    ['sourceRentalId', 'TEXT', 0, 0],
    ['originalRentalId', 'TEXT', 0, 0],
    ['equipmentId', 'TEXT', 0, 0],
    ['clientId', 'TEXT', 0, 0],
    ['managerId', 'TEXT', 0, 0],
    ['ownerId', 'TEXT', 0, 0],
    ['status', 'TEXT', 0, 0],
    ['startDate', 'TEXT', 0, 0],
    ['endDate', 'TEXT', 0, 0],
    ['plannedReturnDate', 'TEXT', 0, 0],
    ['objectId', 'TEXT', 0, 0],
    ['contractId', 'TEXT', 0, 0],
    ['searchText', 'TEXT', 0, 0],
    ['rawJson', 'TEXT', 1, 0],
  ]),
});

const EXPECTED_INDEXES = Object.freeze({
  idx_gantt_rentals_sql_rental: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['rentalId']) }),
  idx_gantt_rentals_sql_source_rental: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['sourceRentalId']) }),
  idx_gantt_rentals_sql_original_rental: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['originalRentalId']) }),
  idx_gantt_rentals_sql_equipment: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['equipmentId']) }),
  idx_gantt_rentals_sql_client: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['clientId']) }),
  idx_gantt_rentals_sql_manager: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['managerId']) }),
  idx_gantt_rentals_sql_owner: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['ownerId']) }),
  idx_gantt_rentals_sql_status: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['status']) }),
  idx_gantt_rentals_sql_start: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['startDate']) }),
  idx_gantt_rentals_sql_end: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['endDate']) }),
  idx_gantt_rentals_sql_equipment_overlap: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['equipmentId', 'startDate', 'endDate']) }),
  idx_gantt_rentals_sql_overlap: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['startDate', 'endDate']) }),
  idx_gantt_rentals_sql_status_overlap: Object.freeze({ table: GANTT_TABLE, columns: Object.freeze(['status', 'startDate', 'endDate']) }),
  idx_documents_sql_type: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['type']) }),
  idx_documents_sql_status: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['status']) }),
  idx_documents_sql_client: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['clientId']) }),
  idx_documents_sql_rental: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['rentalId']) }),
  idx_documents_sql_equipment: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['equipmentId']) }),
  idx_documents_sql_contract: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['contractId']) }),
  idx_documents_sql_date: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['date']) }),
  idx_documents_sql_document_date: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['documentDate']) }),
  idx_documents_sql_created: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['createdAt']) }),
  idx_documents_sql_updated: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['updatedAt']) }),
  idx_documents_sql_number: Object.freeze({ table: DOCUMENTS_TABLE, columns: Object.freeze(['number']) }),
  idx_documents_sql_refs: Object.freeze({
    table: DOCUMENTS_TABLE,
    columns: Object.freeze([
      'type', 'status', 'clientId', 'rentalId', 'equipmentId', 'contractId',
      'date', 'documentDate', 'createdAt',
    ]),
  }),
});

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

function ensureTableColumn(db, table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some(column => column.name === name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
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
    date: dateOnly(record?.date),
    documentDate: dateOnly(record?.documentDate),
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

function schemaObjectExists(db, type, name) {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?
  `).get(type, name));
}

function getSqlShadowMigration(db) {
  if (!schemaObjectExists(db, 'table', 'sql_shadow_schema_migrations')) return null;
  return db.prepare(`
    SELECT name, version, applied_at
    FROM sql_shadow_schema_migrations
    WHERE name = ?
  `).get(SHADOW_MIGRATION_NAME) || null;
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_xinfo("${table}")`).all().map(column => [
    column.name,
    String(column.type || '').toUpperCase(),
    Number(column.notnull),
    Number(column.pk),
  ]).sort(([left], [right]) => left.localeCompare(right));
}

function assertSqlShadowStructure(db) {
  for (const [table, expectedColumns] of Object.entries(EXPECTED_TABLE_COLUMNS)) {
    if (!schemaObjectExists(db, 'table', table)) {
      throw new Error(`SQL_SHADOW_SCHEMA_INCOMPLETE:table:${table}`);
    }
    const normalizedExpected = [...expectedColumns]
      .sort(([left], [right]) => left.localeCompare(right));
    if (JSON.stringify(tableColumns(db, table)) !== JSON.stringify(normalizedExpected)) {
      throw new Error(`SQL_SHADOW_TABLE_STRUCTURE_MISMATCH:${table}`);
    }
  }

  const expectedIndexNames = Object.keys(EXPECTED_INDEXES).sort();
  const actualIndexNames = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND tbl_name IN (?, ?)
      AND name NOT LIKE 'sqlite_autoindex_%'
    ORDER BY name
  `).all(DOCUMENTS_TABLE, GANTT_TABLE).map(row => row.name);
  if (JSON.stringify(actualIndexNames) !== JSON.stringify(expectedIndexNames)) {
    throw new Error('SQL_SHADOW_INDEX_SET_MISMATCH');
  }

  for (const [name, expected] of Object.entries(EXPECTED_INDEXES)) {
    const index = db.prepare(`
      SELECT tbl_name AS tableName
      FROM sqlite_master
      WHERE type = 'index' AND name = ?
    `).get(name);
    const metadata = db.prepare(`PRAGMA index_list("${expected.table}")`).all()
      .find(row => row.name === name);
    const columns = db.prepare(`PRAGMA index_info("${name}")`).all().map(row => row.name);
    if (!index || index.tableName !== expected.table || !metadata ||
        Number(metadata.unique) !== 0 || Number(metadata.partial) !== 0 ||
        metadata.origin !== 'c' ||
        JSON.stringify(columns) !== JSON.stringify(expected.columns)) {
      throw new Error(`SQL_SHADOW_INDEX_STRUCTURE_MISMATCH:${name}`);
    }
  }

  return true;
}

function assertSqlShadowMigration(db, migration) {
  if (!migration || migration.name !== SHADOW_MIGRATION_NAME) {
    throw new Error('SQL_SHADOW_MIGRATION_REGISTRATION_MISSING');
  }
  if (migration.version !== SHADOW_SCHEMA_VERSION) {
    throw new Error(`SQL_SHADOW_MIGRATION_VERSION_MISMATCH:${migration.version}`);
  }
  if (!text(migration.applied_at)) {
    throw new Error('SQL_SHADOW_MIGRATION_TIMESTAMP_MISSING');
  }
  assertSqlShadowStructure(db);
}

function applySqlShadowMigration(db) {
  const concurrentRegistration = getSqlShadowMigration(db);
  if (concurrentRegistration) {
    assertSqlShadowMigration(db, concurrentRegistration);
    return false;
  }

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
      date TEXT,
      documentDate TEXT,
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
  `);
  ensureTableColumn(db, DOCUMENTS_TABLE, 'date', 'TEXT');
  ensureTableColumn(db, DOCUMENTS_TABLE, 'documentDate', 'TEXT');
  for (const [name, definition] of [
    ['rentalId', 'TEXT'],
    ['sourceRentalId', 'TEXT'],
    ['originalRentalId', 'TEXT'],
    ['equipmentId', 'TEXT'],
    ['clientId', 'TEXT'],
    ['managerId', 'TEXT'],
    ['ownerId', 'TEXT'],
    ['status', 'TEXT'],
    ['startDate', 'TEXT'],
    ['endDate', 'TEXT'],
    ['plannedReturnDate', 'TEXT'],
    ['objectId', 'TEXT'],
    ['contractId', 'TEXT'],
    ['searchText', 'TEXT'],
    ['rawJson', 'TEXT'],
  ]) {
    ensureTableColumn(db, GANTT_TABLE, name, definition);
  }
  db.exec(Object.entries(EXPECTED_INDEXES).map(([name, definition]) =>
    `CREATE INDEX IF NOT EXISTS ${name} ON ${definition.table}(${definition.columns.join(', ')});`
  ).join('\n'));

  assertSqlShadowStructure(db);
  db.prepare(`
    INSERT INTO sql_shadow_schema_migrations (name, version)
    VALUES (?, ?)
  `).run(SHADOW_MIGRATION_NAME, SHADOW_SCHEMA_VERSION);
  assertSqlShadowMigration(db, getSqlShadowMigration(db));
  return true;
}

function ensureSqlShadowSchema(db) {
  const migration = getSqlShadowMigration(db);
  if (migration) {
    assertSqlShadowMigration(db, migration);
    return false;
  }
  return db.transaction(() => applySqlShadowMigration(db)).immediate();
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
      date, documentDate, createdAt, updatedAt, signedAt, sentAt, managerId, ownerId, parentDocumentId, searchText, rawJson
    ) VALUES (
      @id, @number, @type, @status, @clientId, @rentalId, @equipmentId, @objectId, @contractId,
      @date, @documentDate, @createdAt, @updatedAt, @signedAt, @sentAt, @managerId, @ownerId, @parentDocumentId, @searchText, @rawJson
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
      date = excluded.date,
      documentDate = excluded.documentDate,
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
    contractId: 'contractId',
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
  const businessDate = 'COALESCE(date, documentDate, substr(createdAt, 1, 10), substr(updatedAt, 1, 10))';
  if (dateFrom) {
    where.push(`${businessDate} >= @dateFrom`);
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    where.push(`${businessDate} <= @dateTo`);
    params.dateTo = dateTo;
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
    objectId: 'objectId',
    contractId: 'contractId',
    managerId: 'managerId',
    ownerId: 'ownerId',
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
  const docSqlRows = db.prepare(`SELECT id, date, documentDate, updatedAt FROM ${DOCUMENTS_TABLE}`).all();
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
  const mismatchedDocumentBusinessDates = [...sourceDocsById.entries()].flatMap(([id, item]) => {
    const sql = docSqlById.get(id);
    if (!sql) return [];
    const sourceDate = dateOnly(item?.date);
    const sourceDocumentDate = dateOnly(item?.documentDate);
    if (text(sourceDate) === text(sql.date) && text(sourceDocumentDate) === text(sql.documentDate)) return [];
    return [{
      id,
      sourceDate,
      sqlDate: sql.date || null,
      sourceDocumentDate,
      sqlDocumentDate: sql.documentDate || null,
    }];
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
      mismatchedBusinessDates: mismatchedDocumentBusinessDates,
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
    summary.gantt_rentals.duplicateIds.length > 0 ||
    summary.documents.mismatchedBusinessDates.length > 0;
  return { ...summary, criticalMismatch };
}

module.exports = {
  DOCUMENTS_TABLE,
  EXPECTED_INDEXES,
  GANTT_TABLE,
  SHADOW_MIGRATION_NAME,
  SHADOW_SCHEMA_VERSION,
  assertSqlShadowStructure,
  backfillSqlShadowIndexes,
  diagnoseSqlShadowConsistency,
  ensureSqlShadowSchema,
  normalizeDocumentRecord,
  normalizeGanttRecord,
  queryDocumentsIndex,
  queryGanttIndex,
  syncSqlShadowIndexForCollection,
};
