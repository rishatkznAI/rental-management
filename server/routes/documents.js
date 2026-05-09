const express = require('express');
const { normalizeRole } = require('../lib/role-groups');
const {
  buildDocumentRegistrySummary,
  documentNumber,
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

  function canManualNumber(user) {
    return isAdmin(user) || isOffice(user);
  }

  function canManageNumberingSettings(user) {
    return isAdmin(user);
  }

  function relatedRentalsById() {
    const map = new Map();
    [...(readData('rentals') || []), ...(readData('gantt_rentals') || [])].forEach(item => {
      if (item?.id) map.set(String(item.id), item);
    });
    return map;
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

  function readSettings() {
    return readNumberingSettings(readData('app_settings') || []);
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
      return res.json(documents);
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
      const normalized = normalizeDocumentDomainRecord({ ...input, id: input.id || generateId(idPrefixes.documents || 'D') });
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
