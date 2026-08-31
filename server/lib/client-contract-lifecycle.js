const {
  prepareSqliteReadonlyStatement,
} = require('./sqlite-readonly-statement');

const CONTRACT_HAS_HISTORY_CODE = 'CONTRACT_HAS_HISTORY';
const CONTRACT_ARCHIVED_CODE = 'CLIENT_CONTRACT_ARCHIVED';
const CONTRACT_DELETE_CONTEXT_REQUIRED_CODE = 'CLIENT_CONTRACT_DELETE_CONTEXT_REQUIRED';
const CONTRACT_RELATION_MISMATCH_CODE = 'CLIENT_CONTRACT_RELATION_MISMATCH';

const CLIENT_CONTRACT_HISTORY_COLLECTIONS = Object.freeze([
  'rentals',
  'gantt_rentals',
  'rental_change_requests',
  'deliveries',
  'service',
  'warranty_claims',
  'client_objects',
  'documents',
  'mechanic_documents',
  'payments',
  'payment_allocations',
  'debt_collection_plans',
  'debt_collection_actions',
  'receivable_payment_plans',
  'finance_operations',
  'company_expenses',
  'crm_deals',
  'crm_activities',
  'shipping_photos',
  'equipment_operation_sessions',
  'service_field_trips',
  'planner_items',
  'vehicle_trips',
  'snapshot',
  'audit_log',
  'audit_logs',
]);

const DIRECT_REFERENCE_FIELDS = new Set(['contractid', 'clientcontractid']);
const ARRAY_REFERENCE_FIELDS = new Set(['contractids', 'clientcontractids']);

function text(value) {
  return String(value ?? '').trim();
}

function clientContractStatus(contract) {
  return text(contract?.status).toLowerCase() === 'archived' ? 'archived' : 'active';
}

function isArchivedClientContract(contract) {
  return clientContractStatus(contract) === 'archived';
}

function findClientContract(readData, contractId) {
  const id = text(contractId);
  if (!id || typeof readData !== 'function') return null;
  return (readData('client_contracts') || [])
    .find(contract => text(contract?.id) === id) || null;
}

function lifecycleError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function assertClientContractAvailableForNewLink(readData, contractId, options = {}) {
  const id = text(contractId);
  if (!id) return null;
  const contract = findClientContract(readData, id);
  if (!contract) return null;
  const allowedId = text(options.allowArchivedContractId);
  if (isArchivedClientContract(contract) && allowedId !== id) {
    throw lifecycleError(
      CONTRACT_ARCHIVED_CODE,
      'Архивный договор нельзя выбрать для новой операции.',
      409,
      { contractId: id },
    );
  }
  return contract;
}

function recordReferencesClientContract(value, contractId, seen = new Set()) {
  const id = text(contractId);
  if (!id || value === null || value === undefined) return false;
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some(item => recordReferencesClientContract(item, id, seen));
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (DIRECT_REFERENCE_FIELDS.has(normalizedKey) && text(nested) === id) return true;
    if (
      ARRAY_REFERENCE_FIELDS.has(normalizedKey)
      && Array.isArray(nested)
      && nested.some(item => text(item) === id)
    ) return true;
    if (
      normalizedKey === 'clientcontract'
      && nested
      && typeof nested === 'object'
      && text(nested.id) === id
    ) return true;
    if (recordReferencesClientContract(nested, id, seen)) return true;
  }
  return false;
}

function findJsonClientContractHistoryLinks(contractId, { readData, collections } = {}) {
  if (typeof readData !== 'function') return [];
  const names = Array.isArray(collections) ? collections : CLIENT_CONTRACT_HISTORY_COLLECTIONS;
  return names
    .map(collection => {
      const records = readData(collection);
      if (!Array.isArray(records)) return null;
      const count = records.filter(record => recordReferencesClientContract(record, contractId)).length;
      return count > 0 ? { collection, count, source: 'json' } : null;
    })
    .filter(Boolean);
}

function quoteSqlIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function findSqlClientContractHistoryLinks(contractId, db) {
  if (!db || typeof db.prepare !== 'function') return [];
  const tables = prepareSqliteReadonlyStatement(db, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  const links = [];
  for (const { name } of tables) {
    const tableName = quoteSqlIdentifier(name);
    const referenceColumns = prepareSqliteReadonlyStatement(db, `PRAGMA table_info(${tableName})`).all()
      .map(column => String(column?.name || ''))
      .filter(column => DIRECT_REFERENCE_FIELDS.has(column.toLowerCase()));
    if (referenceColumns.length === 0) continue;
    const where = referenceColumns
      .map(column => `${quoteSqlIdentifier(column)} = ?`)
      .join(' OR ');
    const row = prepareSqliteReadonlyStatement(db, `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where}`)
      .get(...referenceColumns.map(() => text(contractId)));
    const count = Number(row?.count) || 0;
    if (count > 0) links.push({ collection: name, count, source: 'sql' });
  }
  return links;
}

function findClientContractHistoryLinks(contract, options = {}) {
  const contractId = text(contract?.id || contract);
  if (!contractId) return [];
  return [
    ...findJsonClientContractHistoryLinks(contractId, options),
    ...findSqlClientContractHistoryLinks(contractId, options.db),
  ];
}

function assertClientContractDeleteContext(contract, context = {}) {
  const contractClientId = text(contract?.clientId);
  const contractCounterpartyId = text(contract?.counterpartyId);
  const clientId = text(context.clientId);
  const counterpartyId = text(context.counterpartyId);
  if (!clientId && !counterpartyId) {
    throw lifecycleError(
      CONTRACT_DELETE_CONTEXT_REQUIRED_CODE,
      'Для удаления договора укажите clientId или counterpartyId.',
      400,
      { contractId: text(contract?.id) },
    );
  }
  const clientMismatch = clientId && (!contractClientId || clientId !== contractClientId);
  const counterpartyMismatch = counterpartyId && (!contractCounterpartyId || counterpartyId !== contractCounterpartyId);
  if (clientMismatch || counterpartyMismatch) {
    throw lifecycleError(
      CONTRACT_RELATION_MISMATCH_CODE,
      'Договор не принадлежит указанному клиенту или контрагенту.',
      409,
      {
        contractId: text(contract?.id),
        clientId: clientId || null,
        counterpartyId: counterpartyId || null,
      },
    );
  }
}

module.exports = {
  CLIENT_CONTRACT_HISTORY_COLLECTIONS,
  CONTRACT_ARCHIVED_CODE,
  CONTRACT_DELETE_CONTEXT_REQUIRED_CODE,
  CONTRACT_HAS_HISTORY_CODE,
  CONTRACT_RELATION_MISMATCH_CODE,
  assertClientContractAvailableForNewLink,
  assertClientContractDeleteContext,
  clientContractStatus,
  findClientContractHistoryLinks,
  findJsonClientContractHistoryLinks,
  findSqlClientContractHistoryLinks,
  isArchivedClientContract,
  recordReferencesClientContract,
};
