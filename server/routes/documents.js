const express = require('express');
const { normalizeRole } = require('../lib/role-groups');
const { calculateRentalBilling } = require('../lib/rental-billing');
const {
  buildPaginatedResponse,
  itemMatchesSearch,
  wantsPaginatedResponse,
} = require('../lib/pagination');
const {
  buildDocumentRegistrySummary,
  documentNumber,
  prepareGeneratedDocument,
  nextDocumentNumber,
  prepareDocumentCreate,
  prepareDocumentPatch,
  readNumberingSettings,
  writeNumberingSettings,
  upsertSetting,
} = require('../lib/documents-core');
const {
  enrichRecordFromRentalLinks,
  normalizeClientRelationLinks,
} = require('../lib/client-relations');
const { linkedRentalIds } = require('../lib/gantt-rental-link-guard');
const {
  queryDocumentsIndex,
  queryGanttIndex,
} = require('../lib/sql-shadow-indexes');

function registerDocumentRoutes(router, deps) {
  const {
    readData,
    writeData,
    requireAuth,
    requireRead,
    requireWrite,
    accessControl,
    generateId,
    idPrefixes,
    nowIso,
    auditLog,
    normalizeRecordClientLink,
    getDb,
  } = deps;

  const documentsRouter = express.Router();

  function sendAccessError(res, error) {
    return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
  }

  function isAdmin(user) {
    return normalizeRole(user?.userRole) === 'Администратор';
  }

  function isOffice(user) {
    return normalizeRole(user?.userRole) === 'Офис-менеджер';
  }

  function enabledEnvFlag(name) {
    return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
  }

  function readDocumentsForBoundedEndpoint(query) {
    if (!enabledEnvFlag('USE_SQL_DOCUMENTS_INDEX') || typeof getDb !== 'function') {
      return { rows: readData('documents') || [], source: 'app_data' };
    }
    try {
      return { rows: queryDocumentsIndex(getDb(), query), source: 'documents_sql' };
    } catch (error) {
      console.warn(`[documents] USE_SQL_DOCUMENTS_INDEX fallback to app_data: ${error.message}`);
      return { rows: readData('documents') || [], source: 'app_data_fallback' };
    }
  }

  function readGanttForBoundedEndpoint(query) {
    if (!enabledEnvFlag('USE_SQL_GANTT_INDEX') || typeof getDb !== 'function') {
      return { rows: readData('gantt_rentals') || [], source: 'app_data' };
    }
    try {
      return { rows: queryGanttIndex(getDb(), query), source: 'gantt_rentals_sql' };
    } catch (error) {
      console.warn(`[documents] USE_SQL_GANTT_INDEX fallback to app_data: ${error.message}`);
      return { rows: readData('gantt_rentals') || [], source: 'app_data_fallback' };
    }
  }

  function canManualNumber(user) {
    return isAdmin(user) || isOffice(user);
  }

  function canManageNumberingSettings(user) {
    return isAdmin(user);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fallbackPrintableDocumentHtml(document) {
    const number = documentNumber(document) || document.id || 'Без номера';
    const rows = [
      ['Тип', document.type || document.documentType || 'Документ'],
      ['Номер', number],
      ['Дата', document.date || document.documentDate || document.createdAt || ''],
      ['Клиент', document.client || document.clientName || document.clientId || ''],
      ['Аренда', document.rentalId || document.rental || ''],
      ['Техника', document.equipmentInv || document.equipmentId || ''],
      ['Статус', document.status || ''],
      ['Комментарий', document.comment || document.description || ''],
    ].filter(([, value]) => String(value || '').trim());
    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(number)}</title>
  <style>
    body { margin: 32px; font-family: Arial, sans-serif; color: #111827; }
    h1 { margin: 0 0 16px; font-size: 24px; }
    table { width: 100%; border-collapse: collapse; }
    td { border: 1px solid #d1d5db; padding: 8px 10px; vertical-align: top; }
    td:first-child { width: 180px; font-weight: 700; background: #f9fafb; }
    @media print { body { margin: 16mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(number)}</h1>
  <table>
    <tbody>
      ${rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}
    </tbody>
  </table>
</body>
</html>`;
  }

  function relatedRentalsById() {
    const map = new Map();
    const rentals = readData('rentals') || [];
    const rentalIds = new Set(rentals.map(item => String(item?.id || '').trim()).filter(Boolean));
    rentals.forEach(item => {
      if (item?.id) map.set(String(item.id), item);
    });
    (readData('gantt_rentals') || []).forEach(item => {
      if (item?.id && linkedRentalIds(item).some(id => rentalIds.has(id))) map.set(String(item.id), item);
    });
    return map;
  }

  function canonicalRentalId(record) {
    return String(record?.rentalId || record?.sourceRentalId || record?.originalRentalId || record?.id || '').trim();
  }

  function findDocumentRental(rentalId) {
    const wanted = String(rentalId || '').trim();
    if (!wanted) return null;
    const rentals = readData('rentals') || [];
    const rentalIds = new Set(rentals.map(item => String(item?.id || '').trim()).filter(Boolean));
    const ganttRentals = readData('gantt_rentals') || [];
    const classic = rentals.find(item => String(item?.id || '') === wanted) || null;
    const gantt = ganttRentals.find(item =>
      linkedRentalIds(item).some(id => rentalIds.has(id)) && (
      String(item?.id || '') === wanted ||
      canonicalRentalId(item) === wanted
      )
    ) || null;
    if (!classic && !gantt) return null;
    return {
      ...(classic || {}),
      ...(gantt || {}),
      id: classic?.id || canonicalRentalId(gantt) || gantt?.id || wanted,
      amount: gantt?.amount ?? classic?.amount ?? classic?.price,
      price: classic?.price ?? gantt?.amount,
      downtimePeriods: Array.isArray(gantt?.downtimePeriods)
        ? gantt.downtimePeriods
        : (Array.isArray(classic?.downtimePeriods) ? classic.downtimePeriods : undefined),
      startDate: gantt?.startDate || classic?.startDate,
      endDate: gantt?.endDate || classic?.plannedReturnDate || classic?.endDate,
      plannedReturnDate: gantt?.plannedReturnDate || classic?.plannedReturnDate,
    };
  }

  function shouldApplyRentalBillingSnapshot(doc) {
    const type = String(doc?.documentType || doc?.type || '').trim().toLowerCase();
    return type === 'act' || type === 'upd';
  }

  function withRentalBillingSnapshot(doc) {
    const rentalId = doc?.rentalId || doc?.rental;
    if (!rentalId) return doc;
    const rental = findDocumentRental(rentalId);
    if (!rental) return doc;
    const billing = calculateRentalBilling(rental);
    const snapshot = {
      source: 'rental-billing',
      rentalId: String(rental.id || rentalId),
      generatedAt: nowIso(),
      totalCalendarDays: billing.totalCalendarDays,
      downtimeDays: billing.downtimeDays,
      billingDowntimeDays: billing.billingDowntimeDays,
      nonBillingDowntimeDays: billing.nonBillingDowntimeDays,
      billableDays: billing.billableDays,
      activeRentalDays: billing.activeRentalDays,
      dailyRate: billing.dailyRate,
      grossRentalAmount: billing.grossRentalAmount,
      downtimeAdjustmentAmount: billing.downtimeAdjustmentAmount,
      finalRentalAmount: billing.finalRentalAmount,
      downtimePeriods: billing.scopedPeriods.map(period => ({
        id: period.id,
        startDate: period.startDate,
        endDate: period.endDate,
        reason: period.reason,
        comment: period.comment,
        affectsBilling: period.affectsBilling,
        status: period.status,
        days: period.days,
      })),
    };
    return {
      ...doc,
      amount: shouldApplyRentalBillingSnapshot(doc)
        ? billing.finalRentalAmount
        : (doc.amount ?? billing.finalRentalAmount),
      rentalBillingSnapshot: doc.rentalBillingSnapshot || snapshot,
      billingSnapshot: doc.billingSnapshot || snapshot,
    };
  }

  function normalizeDocumentDomainRecord(item, existing = null) {
    const linked = typeof normalizeRecordClientLink === 'function'
      ? normalizeRecordClientLink(item, readData('clients') || [], {
          context: `documents:${item?.id || item?.rentalId || item?.number || 'new'}`,
          relatedRentalsById: relatedRentalsById(),
          logger: console,
        })
      : item;
    const enriched = enrichRecordFromRentalLinks(linked, readData);
    return normalizeClientRelationLinks(enriched, enriched.clientId, {
      readData,
      requireActiveObject: !existing,
      allowArchivedObjectId: existing?.objectId,
    });
  }

  function documentCollections() {
    return {
      clients: readData('clients') || [],
      rentals: readData('rentals') || [],
      gantt_rentals: readData('gantt_rentals') || [],
      equipment: readData('equipment') || [],
      service: readData('service') || [],
      deliveries: readData('deliveries') || [],
      mechanics: readData('mechanics') || [],
      service_vehicles: readData('service_vehicles') || [],
      documents: readData('documents') || [],
    };
  }

  function persistDocumentStatus(req, res, status) {
    try {
      const documents = readData('documents') || [];
      const idx = documents.findIndex(item => item.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      accessControl.assertCanUpdateEntity('documents', documents[idx], req.user);
      const updated = prepareDocumentPatch(documents[idx], { status }, {
        documents,
        nowIso,
        user: req.user,
        canManualNumber: canManualNumber(req.user),
      });
      const next = [...documents];
      next[idx] = updated;
      writeData('documents', next);
      auditLog?.(req, {
        action: `documents.mark_${status}`,
        entityType: 'documents',
        entityId: updated.id,
        before: documents[idx],
        after: updated,
      });
      return res.json(updated);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error.message, code: error.code });
    }
  }

  function readSettings() {
    return readNumberingSettings(readData('app_settings') || []);
  }

  function filterDocumentsForList(documents, query) {
    let rows = Array.isArray(documents) ? documents : [];
    rows = rows.filter(item => itemMatchesSearch(item, query.search, [
      'number',
      'documentNumber',
      'type',
      'documentType',
      'client',
      'clientName',
      'clientId',
      'rentalId',
      'rental',
      'equipmentInv',
      'equipmentId',
      'deliveryId',
      'status',
      'signatoryName',
      'signatoryBasis',
    ]));
    const filters = {
      status: item => item.status,
      type: item => item.type || item.documentType,
      clientId: item => item.clientId,
      rentalId: item => item.rentalId || item.rental,
      equipmentId: item => item.equipmentId,
      parentDocumentId: item => item.parentDocumentId,
    };
    Object.entries(filters).forEach(([name, getter]) => {
      const value = String(query[name] || '').trim();
      if (value && value !== 'all') rows = rows.filter(item => String(getter(item) || '') === value);
    });
    const dateFrom = String(query.dateFrom || '').trim();
    const dateTo = String(query.dateTo || '').trim();
    if (dateFrom || dateTo) {
      rows = rows.filter(item => {
        const date = String(item.date || item.documentDate || item.createdAt || item.updatedAt || '').slice(0, 10);
        if (!date) return false;
        if (dateFrom && date < dateFrom) return false;
        if (dateTo && date > dateTo) return false;
        return true;
      });
    }
    return rows;
  }

  function buildDocumentsPaginatedResponse(documents, query) {
    return buildPaginatedResponse(filterDocumentsForList(documents, query), query, {
      sortFields: {
        date: item => item.date || item.documentDate || item.createdAt,
        number: item => item.number || item.documentNumber,
        client: item => item.clientName || item.client,
        status: item => item.status,
        createdAt: item => item.createdAt,
      },
      defaultSort: { sortBy: 'date', sortDir: 'desc' },
      summary: buildDocumentRegistrySummary(documents, String(query.today || nowIso())),
    });
  }

  function compactDocumentReference(doc) {
    return {
      id: doc.id,
      type: doc.type || doc.documentType,
      documentType: doc.documentType || doc.type,
      number: doc.number || doc.documentNumber || '',
      documentNumber: doc.documentNumber || doc.number || '',
      clientId: doc.clientId || '',
      client: doc.client || doc.clientName || '',
      date: doc.date || doc.documentDate || '',
      documentDate: doc.documentDate || doc.date || '',
      status: doc.status,
      parentDocumentId: doc.parentDocumentId || '',
      specificationId: doc.specificationId || '',
      rentalId: doc.rentalId || doc.rental || '',
      equipmentId: doc.equipmentId || '',
      rentalStartDate: doc.rentalStartDate || '',
      rentalEndDate: doc.rentalEndDate || '',
      dailyRate: doc.dailyRate || '',
      quantityDays: doc.quantityDays || '',
      amount: doc.amount,
    };
  }

  function clampGanttReferenceLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 25;
    return Math.min(Math.max(Math.floor(parsed), 1), 100);
  }

  function dateOnly(value) {
    return String(value || '').slice(0, 10);
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  }

  function defaultGanttReferenceWindow() {
    const today = dateOnly(nowIso()) || new Date().toISOString().slice(0, 10);
    return {
      dateFrom: addDays(`${today}T00:00:00.000Z`, -90),
      dateTo: addDays(`${today}T00:00:00.000Z`, 180),
    };
  }

  function compactGanttReference(item) {
    return {
      id: item.id,
      rentalId: canonicalRentalId(item),
      ganttRentalId: item.id,
      sourceRentalId: item.sourceRentalId || '',
      originalRentalId: item.originalRentalId || '',
      clientId: item.clientId || '',
      client: item.client || item.clientName || item.clientShort || '',
      equipmentId: item.equipmentId || '',
      equipmentInv: item.equipmentInv || item.inventoryNumber || '',
      inventoryNumber: item.inventoryNumber || item.equipmentInv || '',
      serialNumber: item.serialNumber || '',
      startDate: item.startDate || '',
      endDate: item.endDate || item.plannedReturnDate || '',
      plannedReturnDate: item.plannedReturnDate || item.endDate || '',
      status: item.status || '',
      manager: item.manager || '',
      managerId: item.managerId || '',
      objectId: item.objectId || '',
      contractId: item.contractId || '',
      amount: item.amount,
      price: item.price,
      rate: item.rate || '',
    };
  }

  function filterGanttReferences(rows, query) {
    let list = Array.isArray(rows) ? rows : [];
    let hasNarrowingFilter = false;
    const filters = {
      clientId: item => item.clientId,
      rentalId: item => canonicalRentalId(item),
      equipmentId: item => item.equipmentId,
      contractId: item => item.contractId,
      status: item => item.status,
    };
    Object.entries(filters).forEach(([name, getter]) => {
      const value = String(query[name] || '').trim();
      if (value && value !== 'all') {
        hasNarrowingFilter = true;
        list = list.filter(item => String(getter(item) || '') === value);
      }
    });

    const search = String(query.search || '').trim();
    if (search) hasNarrowingFilter = true;
    list = list.filter(item => itemMatchesSearch(item, search, [
      'id',
      'rentalId',
      'sourceRentalId',
      'originalRentalId',
      'client',
      'clientName',
      'clientShort',
      'clientId',
      'equipmentInv',
      'inventoryNumber',
      'equipmentId',
      'serialNumber',
      'manager',
      'managerId',
      'objectId',
      'contractId',
      'status',
    ]));

    const hasDateFilter = Boolean(dateOnly(query.dateFrom) || dateOnly(query.dateTo));
    const fallbackWindow = !hasDateFilter && !hasNarrowingFilter ? defaultGanttReferenceWindow() : {};
    const dateFrom = dateOnly(query.dateFrom) || fallbackWindow.dateFrom || '';
    const dateTo = dateOnly(query.dateTo) || fallbackWindow.dateTo || '';
    if (!dateFrom && !dateTo) return list;
    return list.filter(item => {
      const start = dateOnly(item.startDate);
      const end = dateOnly(item.endDate || item.plannedReturnDate || item.startDate);
      if (!start && !end) return false;
      if (dateFrom && end && end < dateFrom) return false;
      if (dateTo && start && start > dateTo) return false;
      return true;
    });
  }

  function saveSettings(settings) {
    const next = writeNumberingSettings(readData('app_settings') || [], settings, nowIso);
    writeData('app_settings', next);
  }

  documentsRouter.get('/documents/registry/summary', requireAuth, requireRead('documents'), (req, res) => {
    try {
      accessControl.assertCanReadCollection('documents', req.user);
      const scoped = accessControl.filterCollectionByScope('documents', readData('documents') || [], req.user);
      return res.json(buildDocumentRegistrySummary(scoped, String(req.query.today || nowIso())));
    } catch (error) {
      return sendAccessError(res, error);
    }
  });

  documentsRouter.get('/documents/summary', requireAuth, requireRead('documents'), (req, res) => {
    try {
      accessControl.assertCanReadCollection('documents', req.user);
      const scoped = accessControl.filterCollectionByScope('documents', readData('documents') || [], req.user);
      return res.json(buildDocumentRegistrySummary(scoped, String(req.query.today || nowIso())));
    } catch (error) {
      return sendAccessError(res, error);
    }
  });

  documentsRouter.get('/documents/numbering-settings', requireAuth, requireRead('documents'), (req, res) => {
    if (!canManageNumberingSettings(req.user)) {
      return res.status(403).json({ ok: false, error: 'Настройки нумерации документов доступны только администратору' });
    }
    return res.json(readSettings());
  });

  documentsRouter.patch('/documents/numbering-settings', requireAuth, requireWrite('documents'), (req, res) => {
    if (!canManageNumberingSettings(req.user)) {
      return res.status(403).json({ ok: false, error: 'Настройки нумерации документов доступны только администратору' });
    }
    try {
      const input = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.settings) ? req.body.settings : [req.body]);
      const settings = input.reduce((list, item) => upsertSetting(list, item), readSettings());
      saveSettings(settings);
      return res.json(settings);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error.message });
    }
  });

  documentsRouter.post('/documents/number-preview', requireAuth, requireRead('documents'), (req, res) => {
    try {
      accessControl.assertCanReadCollection('documents', req.user);
      const documents = accessControl.filterCollectionByScope('documents', readData('documents') || [], req.user);
      const year = Number(req.body?.year) || Number(String(req.body?.date || req.body?.documentDate || nowIso()).slice(0, 4));
      const preview = nextDocumentNumber(documents, readSettings(), req.body?.documentType || req.body?.type, year);
      return res.json({ number: preview.number, sequence: preview.sequence, setting: preview.setting });
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error.message, code: error.code });
    }
  });

  documentsRouter.get('/documents', requireAuth, requireRead('documents'), (req, res) => {
    try {
      accessControl.assertCanReadCollection('documents', req.user);
      const documents = accessControl.sanitizeCollectionForRead(
        'documents',
        accessControl.filterCollectionByScope('documents', readData('documents') || [], req.user),
        req.user,
      );
      if (wantsPaginatedResponse(req.query)) {
        return res.json(buildDocumentsPaginatedResponse(documents, req.query));
      }
      return res.json(documents);
    } catch (error) {
      return sendAccessError(res, error);
    }
  });

  documentsRouter.get('/documents/references', requireAuth, requireRead('documents'), (req, res) => {
    try {
      accessControl.assertCanReadCollection('documents', req.user);
      const indexed = readDocumentsForBoundedEndpoint(req.query);
      const scoped = accessControl.sanitizeCollectionForRead(
        'documents',
        accessControl.filterCollectionByScope('documents', indexed.rows, req.user),
        req.user,
      );
      const requestedTypes = String(req.query.types || req.query.type || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
      const requestedIds = new Set(String(req.query.ids || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean));
      const query = {
        ...req.query,
        page: req.query.page || '1',
        pageSize: req.query.pageSize || '25',
      };
      let rows = filterDocumentsForList(scoped, query);
      if (requestedTypes.length > 0) {
        rows = rows.filter(item => requestedTypes.includes(String(item.type || item.documentType || '')));
      }
      if (requestedIds.size > 0) {
        const allRowsForRequestedIds = indexed.source === 'documents_sql'
          ? accessControl.sanitizeCollectionForRead(
              'documents',
              accessControl.filterCollectionByScope('documents', queryDocumentsIndex(getDb(), {}), req.user),
              req.user,
            )
          : scoped;
        const byId = new Map(allRowsForRequestedIds.map(item => [String(item.id || ''), item]));
        requestedIds.forEach(id => {
          const item = byId.get(id);
          if (item && !rows.some(row => row.id === item.id)) rows.push(item);
        });
      }
      const response = buildPaginatedResponse(rows, query, {
        sortFields: {
          date: item => item.date || item.documentDate || item.createdAt,
          number: item => item.number || item.documentNumber,
          client: item => item.clientName || item.client,
        },
        defaultSort: { sortBy: 'date', sortDir: 'desc' },
      });
      return res.json({
        ...response,
        items: response.items.map(compactDocumentReference),
      });
    } catch (error) {
      return sendAccessError(res, error);
    }
  });

  documentsRouter.get('/documents/gantt-references', requireAuth, requireRead('documents'), (req, res) => {
    try {
      accessControl.assertCanReadCollection('documents', req.user);
      const limit = clampGanttReferenceLimit(req.query.limit || req.query.pageSize);
      const query = {
        ...req.query,
        page: '1',
        pageSize: String(limit),
      };
      const indexed = readGanttForBoundedEndpoint(query);
      const scoped = accessControl.filterCollectionByScope('gantt_rentals', indexed.rows, req.user);
      const rows = filterGanttReferences(scoped, query);
      const response = buildPaginatedResponse(rows, query, {
        sortFields: {
          startDate: item => item.startDate,
          endDate: item => item.endDate || item.plannedReturnDate,
          client: item => item.client || item.clientName || item.clientShort,
          status: item => item.status,
        },
        defaultSort: { sortBy: 'startDate', sortDir: 'desc' },
      });
      return res.json({
        ...response,
        limit,
        items: response.items.map(compactGanttReference),
      });
    } catch (error) {
      return sendAccessError(res, error);
    }
  });

  documentsRouter.get('/documents/:id', requireAuth, requireRead('documents'), (req, res) => {
    try {
      accessControl.assertCanReadCollection('documents', req.user);
      const document = (readData('documents') || []).find(item => item.id === req.params.id);
      if (!document) return res.status(404).json({ ok: false, error: 'Not found' });
      if (!accessControl.canAccessEntity('documents', document, req.user)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      return res.json(accessControl.sanitizeEntityForRead('documents', document, req.user));
    } catch (error) {
      return sendAccessError(res, error);
    }
  });

  documentsRouter.post('/documents', requireAuth, requireWrite('documents'), (req, res) => {
    try {
      accessControl.assertCanCreateCollection('documents', req.user, req.body);
      const input = accessControl.sanitizeCreateInput('documents', req.body, req.user);
      if ((input.number || input.documentNumber) && !canManualNumber(req.user)) {
        return res.status(403).json({ ok: false, error: 'Ручной номер документа может задать только администратор или офис-менеджер' });
      }
      const documents = readData('documents') || [];
      const normalized = withRentalBillingSnapshot(normalizeDocumentDomainRecord({ ...input, id: input.id || generateId(idPrefixes.documents || 'D') }));
      const prepared = prepareDocumentCreate(normalized, {
        documents,
        settings: readSettings(),
        nowIso,
        generateId,
        idPrefix: idPrefixes.documents || 'D',
        user: req.user,
      });
      writeData('documents', [...documents, prepared.document]);
      saveSettings(prepared.settings);
      auditLog?.(req, {
        action: 'documents.create',
        entityType: 'documents',
        entityId: prepared.document.id,
        after: prepared.document,
      });
      return res.status(201).json(prepared.document);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error.message, code: error.code });
    }
  });

  documentsRouter.post('/documents/generate', requireAuth, requireWrite('documents'), (req, res) => {
    try {
      const raw = req.body?.data && typeof req.body.data === 'object' ? req.body.data : req.body;
      const generatedInput = prepareGeneratedDocument(raw, documentCollections(), { nowIso });
      accessControl.assertCanCreateCollection('documents', req.user, generatedInput);
      const input = accessControl.sanitizeCreateInput('documents', generatedInput, req.user);
      if ((input.number || input.documentNumber) && !canManualNumber(req.user)) {
        return res.status(403).json({ ok: false, error: 'Ручной номер документа может задать только администратор или офис-менеджер' });
      }
      const documents = readData('documents') || [];
      const normalized = withRentalBillingSnapshot(normalizeDocumentDomainRecord({ ...input, id: input.id || generateId(idPrefixes.documents || 'D') }));
      const prepared = prepareDocumentCreate(normalized, {
        documents,
        settings: readSettings(),
        nowIso,
        generateId,
        idPrefix: idPrefixes.documents || 'D',
        user: req.user,
      });
      writeData('documents', [...documents, prepared.document]);
      saveSettings(prepared.settings);
      auditLog?.(req, {
        action: 'documents.generate',
        entityType: 'documents',
        entityId: prepared.document.id,
        after: prepared.document,
      });
      return res.status(201).json(prepared.document);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error.message, code: error.code });
    }
  });

  documentsRouter.patch('/documents/:id', requireAuth, requireWrite('documents'), (req, res) => {
    try {
      const documents = readData('documents') || [];
      const idx = documents.findIndex(item => item.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      accessControl.assertCanUpdateEntity('documents', documents[idx], req.user);
      const safePatch = accessControl.sanitizeUpdateInput('documents', req.body, req.user, documents[idx]);
      const normalized = normalizeDocumentDomainRecord({ ...documents[idx], ...safePatch, id: documents[idx].id }, documents[idx]);
      if (safePatch.number !== undefined && safePatch.documentNumber === undefined) {
        normalized.documentNumber = safePatch.number;
      }
      if (safePatch.documentNumber !== undefined && safePatch.number === undefined) {
        normalized.number = safePatch.documentNumber;
      }
      const updated = prepareDocumentPatch(documents[idx], normalized, {
        documents,
        nowIso,
        user: req.user,
        canManualNumber: canManualNumber(req.user),
      });
      const next = [...documents];
      next[idx] = updated;
      writeData('documents', next);
      auditLog?.(req, {
        action: 'documents.update',
        entityType: 'documents',
        entityId: updated.id,
        before: documents[idx],
        after: updated,
      });
      return res.json(updated);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error.message, code: error.code });
    }
  });

  documentsRouter.delete('/documents/:id', requireAuth, requireWrite('documents'), (req, res) => {
    try {
      const documents = readData('documents') || [];
      const idx = documents.findIndex(item => item.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      accessControl.assertCanDeleteEntity('documents', documents[idx], req.user);
      const next = documents.filter(item => item.id !== req.params.id);
      writeData('documents', next);
      auditLog?.(req, {
        action: 'documents.delete',
        entityType: 'documents',
        entityId: documents[idx].id,
        before: documents[idx],
      });
      return res.json({ ok: true });
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error.message, code: error.code });
    }
  });

  documentsRouter.post('/documents/:id/mark-sent', requireAuth, requireWrite('documents'), (req, res) => (
    persistDocumentStatus(req, res, req.body?.status === 'pending_signature' ? 'pending_signature' : 'sent')
  ));

  documentsRouter.post('/documents/:id/mark-signed', requireAuth, requireWrite('documents'), (req, res) => (
    persistDocumentStatus(req, res, 'signed')
  ));

  documentsRouter.post('/documents/:id/duplicate', requireAuth, requireWrite('documents'), (req, res) => {
    try {
      const documents = readData('documents') || [];
      const source = documents.find(item => item.id === req.params.id);
      if (!source) return res.status(404).json({ ok: false, error: 'Not found' });
      if (!accessControl.canAccessEntity('documents', source, req.user)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      const copyInput = {
        ...source,
        id: undefined,
        number: '',
        documentNumber: '',
        status: 'draft',
        sentAt: undefined,
        sentBy: undefined,
        signedAt: undefined,
        signedBy: undefined,
        signedScanDataUrl: undefined,
        signedScanFileName: undefined,
        signedScanMimeType: undefined,
        history: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        notes: source.notes || source.comment,
      };
      accessControl.assertCanCreateCollection('documents', req.user, copyInput);
      const input = accessControl.sanitizeCreateInput('documents', copyInput, req.user);
      const prepared = prepareDocumentCreate(input, {
        documents,
        settings: readSettings(),
        nowIso,
        generateId,
        idPrefix: idPrefixes.documents || 'D',
        user: req.user,
      });
      writeData('documents', [...documents, prepared.document]);
      saveSettings(prepared.settings);
      auditLog?.(req, {
        action: 'documents.duplicate',
        entityType: 'documents',
        entityId: prepared.document.id,
        after: prepared.document,
      });
      return res.status(201).json(prepared.document);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error.message, code: error.code });
    }
  });

  documentsRouter.get('/documents/:id/print', requireAuth, requireRead('documents'), (req, res) => {
    try {
      accessControl.assertCanReadCollection('documents', req.user);
      const document = (readData('documents') || []).find(item => item.id === req.params.id);
      if (!document) return res.status(404).send('Not found');
      if (!accessControl.canAccessEntity('documents', document, req.user)) return res.status(403).send('Forbidden');
      const html = document.printHtml || document.generatedContent || document.contentHtml || fallbackPrintableDocumentHtml(document);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (error) {
      return res.status(error?.status || 400).send(error.message);
    }
  });

  documentsRouter.post('/documents/:id/assign-number', requireAuth, requireWrite('documents'), (req, res) => {
    if (!canManualNumber(req.user)) {
      return res.status(403).json({ ok: false, error: 'Присвоить номер может только администратор или офис-менеджер' });
    }
    try {
      const documents = readData('documents') || [];
      const idx = documents.findIndex(item => item.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      accessControl.assertCanUpdateEntity('documents', documents[idx], req.user);
      if (documentNumber(documents[idx])) return res.json(documents[idx]);
      const settings = readSettings();
      const generated = nextDocumentNumber(documents, settings, documents[idx].documentType || documents[idx].type, Number(String(documents[idx].documentDate || documents[idx].date || documents[idx].createdAt || nowIso()).slice(0, 4)));
      const updated = prepareDocumentPatch(documents[idx], {
        number: generated.number,
        documentNumber: generated.number,
      }, {
        documents,
        nowIso,
        user: req.user,
        canManualNumber: true,
      });
      const next = [...documents];
      next[idx] = updated;
      writeData('documents', next);
      saveSettings(upsertSetting(settings, generated.setting));
      auditLog?.(req, {
        action: 'documents.assign_number',
        entityType: 'documents',
        entityId: updated.id,
        before: documents[idx],
        after: updated,
      });
      return res.json(updated);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error.message, code: error.code });
    }
  });

  router.use(documentsRouter);
}

module.exports = { registerDocumentRoutes };
