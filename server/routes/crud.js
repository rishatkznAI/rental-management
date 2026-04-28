const express = require('express');
const { syncGanttRentalPaymentStatuses } = require('../lib/payment-status-sync');
const {
  RENTAL_CHANGE_REQUEST_STATUS,
  buildRequestDecisionNotificationStatus,
  displayValue,
} = require('../lib/rental-change-requests');

function registerCrudRoutes(deps) {
  const {
    collections,
    idPrefixes,
    readData,
    writeData,
    deleteSessionsForUserIds,
    requireAuth,
    requireRead,
    requireWrite,
    sanitizeUser,
    publicUserView,
    canReadFullUsers,
    hashPassword,
    normalizeServiceWorkRecord,
    normalizeSparePartRecord,
    validateRentalPayload,
    mergeEntityHistory,
    requireNonEmptyString,
    generateId,
    nowIso,
    applyServiceTicketCreationEffects,
    accessControl,
    auditLog,
    normalizeRecordClientLink,
  } = deps;

  const router = express.Router();
  const requiredAccessMethods = [
    'assertCanReadCollection',
    'assertCanCreateCollection',
    'assertCanUpdateEntity',
    'assertCanDeleteEntity',
    'assertCanBulkReplace',
    'canAccessEntity',
    'filterCollectionByScope',
    'sanitizeCreateInput',
    'sanitizeUpdateInput',
  ];
  const missingAccessMethods = !accessControl
    ? requiredAccessMethods
    : requiredAccessMethods.filter(name => typeof accessControl[name] !== 'function');
  if (missingAccessMethods.length > 0) {
    throw new Error(`Generic CRUD requires access-control methods: ${missingAccessMethods.join(', ')}`);
  }

  function sendAccessError(res, error) {
    return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
  }

  function isOfficeManager(req) {
    return req.user?.userRole === 'Офис-менеджер';
  }

  function isCriticalAuditCollection(collection) {
    return ['payments', 'rentals', 'gantt_rentals', 'equipment', 'service', 'users', 'app_settings'].includes(collection);
  }

  function syncPaymentStatusesAfterPaymentWrite(payments) {
    const currentGanttRentals = readData('gantt_rentals') || [];
    const nextGanttRentals = syncGanttRentalPaymentStatuses(currentGanttRentals, payments);
    writeData('gantt_rentals', nextGanttRentals);
  }

  function relatedRentalsById() {
    const map = new Map();
    [...(readData('rentals') || []), ...(readData('gantt_rentals') || [])].forEach(item => {
      if (item?.id) map.set(String(item.id), item);
    });
    return map;
  }

  function withClientLink(collection, item) {
    if (typeof normalizeRecordClientLink !== 'function') return item;
    if (!['payments', 'documents', 'crm_deals'].includes(collection)) return item;
    return normalizeRecordClientLink(item, readData('clients') || [], {
      context: `${collection}:${item?.id || item?.rentalId || item?.number || 'new'}`,
      relatedRentalsById: relatedRentalsById(),
      logger: console,
    });
  }

  function hasReadAccess(req, collection) {
    if (collection === 'users') return true;
    if (typeof requireRead !== 'function') {
      return Promise.resolve({
        denied: true,
        statusCode: 403,
        payload: { ok: false, error: 'Forbidden' },
      });
    }
    return new Promise((resolve) => {
      requireRead(collection)(req, {
        status(statusCode) {
          return {
            json(payload) {
              resolve({ denied: true, statusCode, payload });
            },
          };
        },
      }, () => resolve({ denied: false }));
    });
  }

  function normalizeUserPasswordForWrite(user, existing = null) {
    const next = { ...user };
    if (!next.password && existing?.password) {
      next.password = existing.password;
    } else if (next.password && !String(next.password).startsWith('h1:') && !String(next.password).startsWith('h2:scrypt:')) {
      next.password = hashPassword(String(next.password));
    }
    return next;
  }

  function crmArchiveForbiddenReason(collection) {
    if (collection !== 'crm_deals') return null;
    const settings = readData('app_settings') || [];
    const setting = settings.find(item => item?.key === 'crm_archive_state');
    const value = setting?.value && typeof setting.value === 'object' ? setting.value : {};
    const status = value?.status;
    if (status === 'archived') return 'CRM находится в архиве и временно скрыта из системы.';
    if (status === 'deleted') return 'CRM удалена из системы.';
    return null;
  }

  function invalidateAffectedUserSessions(previousUsers, nextUsers) {
    if (typeof deleteSessionsForUserIds !== 'function') return;
    const previous = Array.isArray(previousUsers) ? previousUsers : [];
    const next = Array.isArray(nextUsers) ? nextUsers : [];
    const nextById = new Map(next.map(item => [item.id, item]));
    const affectedIds = previous
      .filter(item => {
        const nextItem = nextById.get(item.id);
        if (!nextItem) return true;
        return nextItem.status !== 'Активен' || nextItem.email !== item.email || nextItem.role !== item.role;
      })
      .map(item => item.id);

    if (affectedIds.length > 0) {
      deleteSessionsForUserIds(affectedIds);
    }
  }

  function createEntityChangeRequest(req, {
    entityType,
    entity,
    rentalId,
    operation,
    type,
    field,
    oldValue,
    newValue,
    financialImpact,
  }) {
    const rentals = readData('rentals') || [];
    const rental = rentals.find(item => item.id === rentalId);
    const requests = readData('rental_change_requests') || [];
    const request = {
      id: generateId(idPrefixes.rental_change_requests || 'RCR'),
      entityType,
      entityId: entity?.id || '',
      rentalId: rentalId || '',
      client: rental?.client || entity?.client || '',
      clientId: rental?.clientId || entity?.clientId || '',
      equipment: Array.isArray(rental?.equipment) ? rental.equipment : [],
      initiatorId: req.user?.userId || '',
      initiatorName: req.user?.userName || 'Система',
      initiatorRole: req.user?.userRole || '',
      createdAt: nowIso(),
      status: RENTAL_CHANGE_REQUEST_STATUS.PENDING,
      statusLabel: buildRequestDecisionNotificationStatus(RENTAL_CHANGE_REQUEST_STATUS.PENDING),
      operation,
      type,
      field,
      fieldLabel: field,
      oldValue,
      newValue,
      reason: `${type} требует согласования администратора.`,
      comment: '',
      attachments: [],
      financialImpact: financialImpact || { amount: 0, description: 'Без прямого изменения суммы' },
    };
    writeData('rental_change_requests', [...requests, request]);
    return request;
  }

  function buildPaymentFinancialImpact(payment, nextValue, operation) {
    if (operation === 'delete') {
      const amount = -(payment?.paidAmount ?? payment?.amount ?? 0);
      return { amount, description: `${amount}` };
    }
    const oldAmount = Number(payment?.paidAmount ?? payment?.amount ?? 0) || 0;
    const nextAmount = Number(nextValue?.paidAmount ?? nextValue?.amount ?? oldAmount) || 0;
    const amount = nextAmount - oldAmount;
    return {
      amount,
      description: amount === 0 ? 'Без прямого изменения суммы' : `${amount > 0 ? '+' : ''}${amount}`,
    };
  }

  function isPaymentStatusOnlyPatch(previousPayment, patch) {
    const changedFields = Object.keys(patch || {}).filter(field => {
      if (field === 'id') return false;
      return JSON.stringify(previousPayment?.[field] ?? null) !== JSON.stringify(patch[field] ?? null);
    });
    return changedFields.length === 1 && changedFields[0] === 'status';
  }

  function officeManagerCanOnlyCreateRental(req, collection, method) {
    const isRentalCollection = collection === 'rentals' || collection === 'gantt_rentals';
    if (!isRentalCollection) return false;
    if (req.user?.userRole !== 'Офис-менеджер') return false;
    return method !== 'POST';
  }

  function rentalWriteForbiddenReason(req, collection, method) {
    const isRentalCollection = collection === 'rentals' || collection === 'gantt_rentals';
    if (!isRentalCollection) return null;

    const role = req.user?.userRole;
    if (method === 'POST') {
      if (role !== 'Администратор' && role !== 'Офис-менеджер') {
        return 'Недостаточно прав: создавать аренду могут только администратор и офис-менеджер.';
      }
      return null;
    }

    if (role !== 'Администратор') {
      return 'Недостаточно прав: изменять, удалять и восстанавливать аренду может только администратор.';
    }

    return null;
  }

  function serviceWriteForbiddenReason(req, collection, method) {
    if (collection !== 'service') return null;

    const role = req.user?.userRole;
    if (role === 'Менеджер по аренде' && method !== 'POST') {
      return 'Недостаточно прав: менеджер по аренде может только создавать сервисные заявки.';
    }

    return null;
  }

  function isKnowledgeBaseReviewer(req) {
    return req.user?.userRole === 'Администратор' || req.user?.userRole === 'Офис-менеджер';
  }

  function knowledgeBaseProgressForbiddenReason(req, collection, method, existingItem) {
    if (collection !== 'knowledge_base_progress') return null;
    if (isKnowledgeBaseReviewer(req)) return null;

    if (method === 'DELETE' || method === 'PUT') {
      return 'Недостаточно прав: массово менять или удалять прогресс обучения может только администратор или офис-менеджер.';
    }

    if (existingItem && existingItem.userId !== req.user?.userId) {
      return 'Недостаточно прав: можно менять только свой прогресс обучения.';
    }

    return null;
  }

  function knowledgeBaseModuleForbiddenReason(req, collection, method) {
    if (collection !== 'knowledge_base_modules') return null;
    if (method !== 'DELETE') return null;
    if (req.user?.userRole === 'Администратор') return null;
    return 'Недостаточно прав: удалять учебные модули может только администратор.';
  }

  function registerCRUD(collection) {
    if (collection === 'rentals' || collection === 'gantt_rentals') {
      return;
    }
    const prefix = idPrefixes[collection] || collection;

    router.get(`/${collection}`, requireAuth, async (req, res) => {
      const readAccess = await hasReadAccess(req, collection);
      if (readAccess.denied) {
        return res.status(readAccess.statusCode).json(readAccess.payload);
      }
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      try {
        accessControl.assertCanReadCollection(collection, req.user);
      } catch (error) {
        return sendAccessError(res, error);
      }
      let data = readData(collection) || [];
      if (collection === 'service_works') {
        data = data
          .map(normalizeServiceWorkRecord)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
        if (req.query.active === '1') {
          data = data.filter(item => item.isActive);
        }
      }
      if (collection === 'spare_parts') {
        data = data
          .map(normalizeSparePartRecord)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        if (req.query.active === '1') {
          data = data.filter(item => item.isActive);
        }
      }
      if (collection === 'users') {
        if (canReadFullUsers(req)) {
          return res.json(data.map(sanitizeUser));
        }
        return res.json(data.filter(item => item.status === 'Активен').map(publicUserView));
      }
      if (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req)) {
        return res.json(data.filter(item => item.userId === req.user.userId));
      }
      data = accessControl.filterCollectionByScope(collection, data, req.user);
      return res.json(data);
    });

    router.get(`/${collection}/:id`, requireAuth, async (req, res) => {
      const readAccess = await hasReadAccess(req, collection);
      if (readAccess.denied) {
        return res.status(readAccess.statusCode).json(readAccess.payload);
      }
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      try {
        accessControl.assertCanReadCollection(collection, req.user);
      } catch (error) {
        return sendAccessError(res, error);
      }
      const data = readData(collection) || [];
      let item = data.find(entry => entry.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
      if (collection === 'service_works') item = normalizeServiceWorkRecord(item);
      if (collection === 'spare_parts') item = normalizeSparePartRecord(item);
      if (collection === 'users') {
        if (canReadFullUsers(req) || item.id === req.user.userId) {
          return res.json(sanitizeUser(item));
        }
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      if (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req) && item.userId !== req.user.userId) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      if (!accessControl.canAccessEntity(collection, item, req.user)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      return res.json(item);
    });

    router.post(`/${collection}`, requireAuth, requireWrite(collection), (req, res) => {
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'POST');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'POST');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'POST');
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'POST');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }
      try {
        accessControl.assertCanCreateCollection(collection, req.user, req.body);
        const input = accessControl.sanitizeCreateInput(collection, req.body, req.user);
        if (collection === 'rentals' || collection === 'gantt_rentals') {
          const validation = validateRentalPayload(collection, input, readData(collection) || []);
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }

        if (collection === 'service_works') {
          requireNonEmptyString(input?.name, 'Название работы');
        }
        if (collection === 'spare_parts') {
          requireNonEmptyString(input?.name, 'Название запчасти');
          requireNonEmptyString(input?.unit, 'Единица измерения');
        }

        const data = readData(collection) || [];
        let newItem = withClientLink(collection, { ...input, id: input.id || generateId(prefix) });
        if (collection === 'users') {
          newItem = normalizeUserPasswordForWrite(newItem);
        }
        if (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req)) {
          newItem = {
            ...newItem,
            userId: req.user.userId,
            userName: req.user.userName,
            userRole: req.user.userRole,
          };
        }
        if (collection === 'service_works') {
          newItem = normalizeServiceWorkRecord({ ...newItem, updatedAt: nowIso() });
        }
        if (collection === 'spare_parts') {
          newItem = normalizeSparePartRecord({ ...newItem, updatedAt: nowIso() });
        }
        if (collection === 'clients' || collection === 'equipment') {
          newItem = mergeEntityHistory(collection, null, newItem, req.user.userName);
        }
        data.push(newItem);
        writeData(collection, data);
        if (isCriticalAuditCollection(collection)) {
          auditLog?.(req, {
            action: `${collection}.create`,
            entityType: collection,
            entityId: newItem.id,
            after: newItem,
          });
        }
        if (collection === 'users' && newItem.status !== 'Активен') {
          invalidateAffectedUserSessions([], [newItem]);
        }
        if (collection === 'payments') {
          syncPaymentStatusesAfterPaymentWrite(data);
        }
        if (collection === 'service') {
          applyServiceTicketCreationEffects?.(newItem, req.user.userName);
        }
        if (collection === 'users') {
          return res.status(201).json(sanitizeUser(newItem));
        }
        return res.status(201).json(newItem);
      } catch (error) {
        if (error?.status) return sendAccessError(res, error);
        return res.status(400).json({ ok: false, error: error.message });
      }
    });

    router.patch(`/${collection}/:id`, requireAuth, requireWrite(collection), (req, res) => {
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'PATCH');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      if (officeManagerCanOnlyCreateRental(req, collection, 'PATCH')) {
        return res.status(403).json({ ok: false, error: 'Недостаточно прав: офис-менеджер может только создавать аренду.' });
      }
      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      try {
        accessControl.assertCanUpdateEntity(collection, data[idx], req.user);
      } catch (error) {
        return sendAccessError(res, error);
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'PATCH', data[idx]);
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'PATCH');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }

      if (collection === 'payments' && req.user?.userRole !== 'Администратор' && !isOfficeManager(req)) {
        const request = createEntityChangeRequest(req, {
          entityType: 'payment',
          entity: data[idx],
          rentalId: data[idx].rentalId,
          operation: 'update',
          type: 'Удаление или корректировка платежей',
          field: 'Платёж',
          oldValue: data[idx],
          newValue: { ...data[idx], ...req.body, id: data[idx].id },
          financialImpact: buildPaymentFinancialImpact(data[idx], req.body, 'update'),
        });
        return res.status(202).json({
          ok: true,
          changeRequest: request,
          message: `Изменение платежа отправлено на согласование: ${displayValue(request.oldValue?.invoiceNumber || request.entityId)}`,
        });
      }

      try {
        const safePatch = accessControl.sanitizeUpdateInput(collection, req.body, req.user, data[idx]);
        const previousItem = { ...data[idx] };
        if (collection === 'rentals' || collection === 'gantt_rentals') {
          const validation = validateRentalPayload(
            collection,
            { ...data[idx], ...safePatch },
            data,
            data[idx].id,
          );
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }

        if (collection === 'service_works') {
          requireNonEmptyString(safePatch?.name ?? data[idx].name, 'Название работы');
          data[idx] = normalizeServiceWorkRecord({
            ...data[idx],
            ...safePatch,
            id: data[idx].id,
            createdAt: data[idx].createdAt,
            updatedAt: nowIso(),
          });
        } else if (collection === 'spare_parts') {
          requireNonEmptyString(safePatch?.name ?? data[idx].name, 'Название запчасти');
          requireNonEmptyString(safePatch?.unit ?? data[idx].unit, 'Единица измерения');
          data[idx] = normalizeSparePartRecord({
            ...data[idx],
            ...safePatch,
            id: data[idx].id,
            createdAt: data[idx].createdAt,
            updatedAt: nowIso(),
          });
        } else {
          let nextItem = withClientLink(collection, { ...data[idx], ...safePatch, id: data[idx].id });
          if (collection === 'users') {
            if (
              safePatch.password ||
              safePatch.role !== undefined ||
              safePatch.status !== undefined ||
              safePatch.email !== undefined
            ) {
              nextItem.tokenVersion = (Number(data[idx].tokenVersion) || 0) + 1;
              nextItem.passwordChangedAt = safePatch.password ? nowIso() : data[idx].passwordChangedAt;
            }
            nextItem = normalizeUserPasswordForWrite(nextItem, data[idx]);
          }
          data[idx] = collection === 'clients' || collection === 'equipment'
            ? mergeEntityHistory(collection, data[idx], nextItem, req.user.userName)
            : (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req)
              ? {
                  ...nextItem,
                  userId: data[idx].userId,
                  userName: data[idx].userName,
                  userRole: data[idx].userRole,
                }
              : nextItem);
        }
        writeData(collection, data);
        if (isCriticalAuditCollection(collection)) {
          auditLog?.(req, {
            action: `${collection}.update`,
            entityType: collection,
            entityId: data[idx].id,
            before: previousItem,
            after: data[idx],
          });
        }
        if (collection === 'users' && previousItem) {
          invalidateAffectedUserSessions([previousItem], [data[idx]]);
        }
        if (collection === 'payments') {
          syncPaymentStatusesAfterPaymentWrite(data);
        }
        if (collection === 'users') {
          return res.json(sanitizeUser(data[idx]));
        }
        return res.json(data[idx]);
      } catch (error) {
        return res.status(400).json({ ok: false, error: error.message });
      }
    });

    router.delete(`/${collection}/:id`, requireAuth, requireWrite(collection), (req, res) => {
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'DELETE');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'DELETE');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'DELETE');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }
      if (officeManagerCanOnlyCreateRental(req, collection, 'DELETE')) {
        return res.status(403).json({ ok: false, error: 'Недостаточно прав: офис-менеджер может только создавать аренду.' });
      }
      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      try {
        accessControl.assertCanDeleteEntity(collection, data[idx], req.user);
      } catch (error) {
        return sendAccessError(res, error);
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'DELETE', data[idx]);
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const removedItem = data[idx];
      if (collection === 'payments' && req.user?.userRole !== 'Администратор') {
        const request = createEntityChangeRequest(req, {
          entityType: 'payment',
          entity: removedItem,
          rentalId: removedItem.rentalId,
          operation: 'delete',
          type: 'Удаление или корректировка платежей',
          field: 'Платёж',
          oldValue: removedItem,
          newValue: null,
          financialImpact: buildPaymentFinancialImpact(removedItem, null, 'delete'),
        });
        return res.status(202).json({ ok: true, changeRequest: request });
      }
      if (collection === 'documents' && req.user?.userRole !== 'Администратор') {
        const request = createEntityChangeRequest(req, {
          entityType: 'document',
          entity: removedItem,
          rentalId: removedItem.rental,
          operation: 'delete',
          type: 'Удаление документов',
          field: 'Документ',
          oldValue: removedItem,
          newValue: null,
          financialImpact: { amount: 0, description: 'Без прямого изменения суммы' },
        });
        return res.status(202).json({ ok: true, changeRequest: request });
      }
      if (collection === 'service') {
        const repairId = data[idx].id;
        writeData('repair_work_items', (readData('repair_work_items') || []).filter(item => item.repairId !== repairId));
        writeData('repair_part_items', (readData('repair_part_items') || []).filter(item => item.repairId !== repairId));
      }
      data.splice(idx, 1);
      writeData(collection, data);
      if (isCriticalAuditCollection(collection)) {
        auditLog?.(req, {
          action: `${collection}.delete`,
          entityType: collection,
          entityId: removedItem.id,
          before: removedItem,
        });
      }
      if (collection === 'users') {
        invalidateAffectedUserSessions([removedItem], []);
      }
      if (collection === 'payments') {
        syncPaymentStatusesAfterPaymentWrite(data);
      }
      return res.json({ ok: true });
    });

    router.put(`/${collection}`, requireAuth, requireWrite(collection), (req, res) => {
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'PUT');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'PUT');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      if (officeManagerCanOnlyCreateRental(req, collection, 'PUT')) {
        return res.status(403).json({ ok: false, error: 'Недостаточно прав: офис-менеджер может только создавать аренду.' });
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'PUT');
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'PUT');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }
      const body = req.body;
      const list = Array.isArray(body) ? body : body.data;
      if (!Array.isArray(list)) {
        return res.status(400).json({ ok: false, error: 'Expected array' });
      }
      try {
        accessControl.assertCanBulkReplace(collection, req.user);
      } catch (error) {
        return sendAccessError(res, error);
      }

      if (collection === 'rentals' || collection === 'gantt_rentals') {
        for (const item of list) {
          const validation = validateRentalPayload(collection, item, list, item.id);
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }
      }

      if (collection === 'service_works') {
        writeData(collection, list.map(item => normalizeServiceWorkRecord({ ...item, updatedAt: nowIso() })));
        auditLog?.(req, {
          action: `${collection}.bulk_replace`,
          entityType: collection,
          after: { count: list.length },
        });
        return res.json({ ok: true, count: list.length });
      }

      if (collection === 'spare_parts') {
        writeData(collection, list.map(item => normalizeSparePartRecord({ ...item, updatedAt: nowIso() })));
        auditLog?.(req, {
          action: `${collection}.bulk_replace`,
          entityType: collection,
          after: { count: list.length },
        });
        return res.json({ ok: true, count: list.length });
      }

      if (collection === 'users') {
        const existing = readData('users') || [];
        const existingById = new Map(existing.map(item => [item.id, item]));
        const merged = list.map(item => {
          if (!item.password) {
            const existingPwd = existingById.get(item.id)?.password;
            if (existingPwd) return { ...item, password: existingPwd };
          }
          return normalizeUserPasswordForWrite(item, existingById.get(item.id));
        });
        writeData('users', merged);
        invalidateAffectedUserSessions(existing, merged);
        auditLog?.(req, {
          action: `${collection}.bulk_replace`,
          entityType: collection,
          after: { count: merged.length },
        });
        return res.json({ ok: true, count: merged.length });
      }

      const normalizedList = list.map(item => withClientLink(collection, item));
      writeData(collection, normalizedList);
      auditLog?.(req, {
        action: `${collection}.bulk_replace`,
        entityType: collection,
        after: { count: list.length },
      });
      if (collection === 'payments') {
        syncPaymentStatusesAfterPaymentWrite(normalizedList);
      }
      return res.json({ ok: true, count: list.length });
    });
  }

  for (const collection of collections) {
    registerCRUD(collection);
  }

  return router;
}

module.exports = {
  registerCrudRoutes,
};
