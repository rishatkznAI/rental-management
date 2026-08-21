const express = require('express');
const {
  formatCarrierDeliveryMessage,
  isCarrierBotUser,
  isClosedDelivery,
  resolveDeliveryCarrierId,
  toCarrierDeliveryDto,
} = require('../lib/carrier-delivery-dto');
const {
  getClientObjectById,
} = require('../lib/client-relations');
const {
  canonicalizeDeliveryCarrierCounterpartyRelation,
  canonicalizeDeliveryCounterpartyRelations,
  isHistoricalDeliveryCarrierRelation,
  isHistoricalDeliveryRelation,
} = require('../lib/delivery-counterparty-relations');
const { normalizeRole } = require('../lib/role-groups');
const {
  syncGanttRentalFields,
} = require('../lib/rental-change-requests');
const { canonicalizeRentalPatch } = require('../lib/rental-data-integrity');
const { validateRentalPayload } = require('../lib/rental-validation');
const {
  affectedEquipmentIdsForRentals,
  reconcileEquipmentRentalProjection,
  validateRentalLifecycleAvailability,
  validateTerminalRentalTransition,
} = require('../lib/rental-lifecycle');

const {
  buildPaginatedResponse,
  itemMatchesSearch,
  wantsPaginatedResponse,
} = require('../lib/pagination');
const { assertBusinessNumberNotProvided } = require('../lib/business-numbering');

function registerDeliveryRoutes(router, deps) {
  const {
    readData,
    writeData,
    writeDataBatch: persistDataBatch = entries => {
      for (const entry of entries || []) writeData(entry.name, entry.value);
    },
    requireAuth,
    requireRead,
    requireWrite,
    sendMessage,
    getBotUsers,
    saveBotUsers,
    nowIso,
    generateId,
    idPrefixes,
    accessControl,
    auditLog,
    botNotifications = null,
    businessNumbering = null,
  } = deps;
  const requiredAccessMethods = ['filterCollectionByScope', 'canAccessEntity', 'assertCanUpdateEntity', 'assertCanDeleteEntity'];
  const missingAccessMethods = !accessControl
    ? requiredAccessMethods
    : requiredAccessMethods.filter(name => typeof accessControl[name] !== 'function');
  if (missingAccessMethods.length > 0) {
    throw new Error(`Delivery routes require access-control methods: ${missingAccessMethods.join(', ')}`);
  }

  function ensureNonEmpty(value, fieldName) {
    if (!String(value || '').trim()) {
      throw new Error(`Поле «${fieldName}» обязательно`);
    }
  }

  function normalizePickupTime(value, existing = null) {
    if (value === undefined) return existing?.pickupTime || null;
    const time = String(value || '').trim();
    if (!time) return null;
    if (!/^\d{2}:\d{2}$/.test(time)) {
      throw new Error('Поле «Время забора техники» должно быть в формате HH:mm');
    }
    const [hours, minutes] = time.split(':').map(Number);
    if (hours > 23 || minutes > 59) {
      throw new Error('Поле «Время забора техники» должно быть в формате HH:mm');
    }
    return time;
  }

  function normalizeDeliveryCost(value, existing = null) {
    if (value === undefined) return existing?.cost ?? 0;
    if (value === null || value === '') return 0;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error('Поле «Стоимость доставки» должно быть числом не меньше 0');
    }
    return numeric;
  }

  function normalizeDeliveryDate(value, fieldName, { required = false, existing = null } = {}) {
    if (value === undefined) {
      return existing === undefined ? null : existing;
    }
    const raw = String(value || '').trim();
    if (!raw) {
      if (required) throw new Error(`Поле «${fieldName}» обязательно`);
      return null;
    }
    const dateKey = raw.slice(0, 10);
    const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      throw new Error(`Поле «${fieldName}» должно быть корректной датой в формате YYYY-MM-DD`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error(`Поле «${fieldName}» должно быть корректной датой в формате YYYY-MM-DD`);
    }
    return dateKey;
  }

  function normalizeCarrierRecord(record = {}) {
    return {
      id: String(record.id || ''),
      key: String(record.key || record.id || ''),
      name: String(record.name || '').trim(),
      company: record.company ? String(record.company).trim() : undefined,
      inn: record.inn ? String(record.inn).trim() : undefined,
      counterpartyId: record.counterpartyId ? String(record.counterpartyId).trim() : null,
      phone: record.phone ? String(record.phone).trim() : undefined,
      notes: record.notes ? String(record.notes).trim() : undefined,
      status: record.status === 'inactive' ? 'inactive' : 'active',
      systemUserId: record.systemUserId ? String(record.systemUserId).trim() : null,
      maxCarrierKey: record.maxCarrierKey ? String(record.maxCarrierKey) : null,
    };
  }

  function isCarrierRequest(req) {
    return normalizeRole(req.user?.userRole || req.user?.role) === 'Перевозчик';
  }

  function findEquipmentForDelivery(delivery) {
    const equipment = readData('equipment') || [];
    const refs = [
      delivery?.equipmentId,
      delivery?.equipmentInv,
      delivery?.inventoryNumber,
      delivery?.serialNumber,
    ].map(value => String(value || '').trim()).filter(Boolean);
    if (refs.length === 0) return null;
    return equipment.find(item => refs.some(ref =>
      ref === String(item?.id || '').trim()
      || ref === String(item?.inventoryNumber || '').trim()
      || ref === String(item?.serialNumber || '').trim()
    )) || null;
  }

  function carrierDeliveryResponse(delivery) {
    const dto = toCarrierDeliveryDto(delivery, {
      equipment: findEquipmentForDelivery(delivery),
    });
    const requestContact = dto.requestContact || null;
    return {
      id: delivery?.id || dto.number,
      type: dto.type,
      status: dto.status,
      transportDate: dto.transportDate,
      pickupTime: dto.pickupTime,
      neededBy: dto.neededBy,
      origin: dto.origin,
      destination: dto.destination,
      cargo: dto.equipment,
      contactName: dto.objectContactName || dto.contactName || '',
      contactPhone: dto.objectContactPhone || dto.contactPhone || '',
      comment: dto.driverComment,
      objectName: dto.objectName || '',
      objectAddress: dto.objectAddress || '',
      objectContactName: dto.objectContactName || '',
      objectContactPhone: dto.objectContactPhone || '',
      manager: requestContact?.name || '',
      equipmentLabel: dto.equipment,
      createdAt: delivery?.createdAt || '',
      updatedAt: delivery?.updatedAt || '',
      createdBy: '',
    };
  }

  function deliveryResponse(delivery, req) {
    return isCarrierRequest(req) ? carrierDeliveryResponse(delivery) : delivery;
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function deliveryDateKey(delivery) {
    return String(delivery?.transportDate || delivery?.neededBy || delivery?.date || delivery?.createdAt || '').slice(0, 10);
  }

  function isDeliveryOverdueForPagination(delivery, now = todayKey()) {
    if (isClosedDelivery(delivery)) return false;
    const date = deliveryDateKey(delivery);
    return Boolean(date && date < now);
  }

  function isDeliveryUnassignedForPagination(delivery) {
    return !delivery?.carrierId && !delivery?.carrierKey && !delivery?.carrierName;
  }

  function matchesDeliveryStatusFilter(delivery, value) {
    if (!value || value === 'all') return true;
    if (value === 'active') return !isClosedDelivery(delivery);
    if (value === 'planned') return ['new', 'sent', 'accepted'].includes(String(delivery?.status || ''));
    if (value === 'overdue') return isDeliveryOverdueForPagination(delivery);
    if (value === 'unassigned') return isDeliveryUnassignedForPagination(delivery) && !isClosedDelivery(delivery);
    return delivery?.status === value;
  }

  function appendGanttHistoryEntry(rental, text, author) {
    const comments = Array.isArray(rental.comments) ? rental.comments : [];
    return {
      ...rental,
      comments: [
        ...comments,
        {
          date: nowIso(),
          text,
          author,
          type: 'comment',
        },
      ],
    };
  }

  function appendClassicRentalComment(rental, text) {
    const existing = String(rental.comments || '').trim();
    const line = `[${new Date().toLocaleString('ru-RU')}] ${text}`;
    return existing ? `${existing}\n${line}` : line;
  }

  function buildDeliveryCreator(req) {
    const users = readData('users') || [];
    const userId = String(req.user?.userId || '').trim();
    const user = users.find(item => String(item.id || '') === userId) || null;
    const name = String(req.user?.userName || user?.name || 'Система').trim();
    return {
      id: userId || null,
      name,
      phone: String(user?.phone || req.user?.phone || '').trim() || null,
      email: String(req.user?.email || user?.email || '').trim() || null,
    };
  }

  function normalizeDeliveryPayload(body, existing = null, author = 'Система', creator = null) {
    const type = body.type === 'receiving' ? 'receiving' : 'shipping';
    const status = ['new', 'sent', 'accepted', 'in_transit', 'completed', 'cancelled'].includes(body.status)
      ? body.status
      : (existing?.status || 'new');
    const transportDate = normalizeDeliveryDate(body.transportDate, 'Дата перевозки', { required: true });
    const neededBy = body.neededBy === undefined
      ? (existing?.neededBy || null)
      : normalizeDeliveryDate(body.neededBy, 'Дедлайн');
    const contactName = String(body.contactName || '').trim();
    const contactPhone = String(body.contactPhone || '').trim();
    const existingContactName = String(existing?.contactName || '').trim();
    const existingContactPhone = String(existing?.contactPhone || '').trim();

    ensureNonEmpty(transportDate, 'Дата перевозки');
    ensureNonEmpty(body.origin, 'Откуда');
    ensureNonEmpty(body.destination, 'Куда');
    ensureNonEmpty(body.cargo, 'Что перевозим');
    if (!existing || existingContactName || contactName) {
      ensureNonEmpty(contactName, 'Контактное лицо');
    }
    if (!existing || existingContactPhone || contactPhone) {
      ensureNonEmpty(contactPhone, 'Контактный номер');
    }
    ensureNonEmpty(body.manager || existing?.manager || author, 'Ответственный менеджер');

    const existingCreatorName = String(existing?.createdByName || existing?.createdBy || '').trim().toLowerCase();
    const currentCreatorName = String(creator?.name || '').trim().toLowerCase();
    const canUseCurrentCreatorContact = !existing || (existingCreatorName && existingCreatorName === currentCreatorName);
    const next = {
      id: existing?.id || body.id || generateId(idPrefixes.deliveries),
      number: existing?.number || '',
      type,
      status,
      transportDate,
      pickupTime: normalizePickupTime(body.pickupTime, existing),
      neededBy,
      origin: String(body.origin || '').trim(),
      destination: String(body.destination || '').trim(),
      cargo: String(body.cargo || '').trim(),
      contactName,
      contactPhone,
      cost: normalizeDeliveryCost(body.cost, existing),
      comment: String(body.comment || '').trim(),
      client: String(body.client || '').trim(),
      clientId: body.clientId ? String(body.clientId) : (existing?.clientId || null),
      counterpartyId: body.counterpartyId ? String(body.counterpartyId) : (existing?.counterpartyId || null),
      objectId: body.objectId ? String(body.objectId) : (existing?.objectId || null),
      contractId: body.contractId ? String(body.contractId) : (existing?.contractId || null),
      objectName: body.objectName ? String(body.objectName).trim() : (existing?.objectName || null),
      objectAddress: body.objectAddress ? String(body.objectAddress).trim() : (existing?.objectAddress || null),
      objectContactName: body.objectContactName ? String(body.objectContactName).trim() : (existing?.objectContactName || null),
      objectContactPhone: body.objectContactPhone ? String(body.objectContactPhone).trim() : (existing?.objectContactPhone || null),
      manager: String(body.manager || existing?.manager || author).trim(),
      carrierId: body.carrierId ? String(body.carrierId) : (body.carrierKey ? String(body.carrierKey) : (existing?.carrierId || null)),
      carrierKey: body.carrierKey ? String(body.carrierKey) : (body.carrierId ? String(body.carrierId) : (existing?.carrierKey || null)),
      carrierCounterpartyId: body.carrierCounterpartyId
        ? String(body.carrierCounterpartyId)
        : (existing?.carrierCounterpartyId || null),
      carrierName: body.carrierName ? String(body.carrierName) : (existing?.carrierName || null),
      carrierPhone: body.carrierPhone ? String(body.carrierPhone) : (existing?.carrierPhone || null),
      carrierChatId: body.carrierChatId ?? existing?.carrierChatId ?? null,
      carrierUserId: body.carrierUserId ?? existing?.carrierUserId ?? null,
      rentalId: body.rentalId ? String(body.rentalId) : (existing?.rentalId || null),
      ganttRentalId: body.ganttRentalId ? String(body.ganttRentalId) : (existing?.ganttRentalId || null),
      classicRentalId: body.classicRentalId ? String(body.classicRentalId) : (existing?.classicRentalId || null),
      equipmentId: body.equipmentId ? String(body.equipmentId) : (existing?.equipmentId || null),
      equipmentInv: body.equipmentInv ? String(body.equipmentInv) : (existing?.equipmentInv || null),
      equipmentLabel: body.equipmentLabel ? String(body.equipmentLabel) : (existing?.equipmentLabel || null),
      botSentAt: body.botSentAt ?? existing?.botSentAt ?? null,
      botSendError: body.botSendError ?? existing?.botSendError ?? null,
      carrierInvoiceReceived: body.carrierInvoiceReceived ?? existing?.carrierInvoiceReceived ?? false,
      carrierInvoiceReceivedAt: body.carrierInvoiceReceivedAt ?? existing?.carrierInvoiceReceivedAt ?? null,
      clientPaymentVerified: body.clientPaymentVerified ?? existing?.clientPaymentVerified ?? false,
      clientPaymentVerifiedAt: body.clientPaymentVerifiedAt ?? existing?.clientPaymentVerifiedAt ?? null,
      completedAt: body.completedAt ?? existing?.completedAt ?? null,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
      createdBy: existing?.createdBy || author,
      createdByUserId: existing?.createdByUserId || (canUseCurrentCreatorContact ? creator?.id : null) || null,
      createdByName: existing?.createdByName || existing?.createdBy || creator?.name || author,
      createdByPhone: existing?.createdByPhone || (canUseCurrentCreatorContact ? creator?.phone : null) || null,
      createdByEmail: existing?.createdByEmail || (canUseCurrentCreatorContact ? creator?.email : null) || null,
    };

    if (next.status === 'completed' && !next.completedAt) {
      next.completedAt = nowIso();
    }
    if (next.status !== 'completed') {
      next.completedAt = null;
    }

    return next;
  }

  function sanitizeDeliveryBody(body = {}, existing = null, req) {
    if (req.user?.userRole === 'Администратор' || req.user?.userRole === 'Офис-менеджер') {
      return { ...body };
    }

    const allowed = new Set([
      'type',
      'transportDate',
      'pickupTime',
      'neededBy',
      'origin',
      'destination',
      'cargo',
      'contactName',
      'contactPhone',
      'comment',
      'client',
      'clientId',
      'counterpartyId',
      'objectId',
      'contractId',
      'objectName',
      'objectAddress',
      'objectContactName',
      'objectContactPhone',
      'carrierId',
      'carrierKey',
      'carrierCounterpartyId',
      'rentalId',
      'ganttRentalId',
      'classicRentalId',
      'equipmentId',
      'equipmentInv',
      'equipmentLabel',
    ]);
    const safe = Object.entries(body || {}).reduce((acc, [field, value]) => {
      if (allowed.has(field)) acc[field] = value;
      return acc;
    }, {});
    safe.manager = existing?.manager || req.user?.userName || 'Система';
    return safe;
  }

  function findLinkedRentalContext(delivery) {
    const classicRentals = readData('rentals') || [];
    const ganttRentals = readData('gantt_rentals') || [];
    const rentalId = String(delivery?.rentalId || delivery?.classicRentalId || '').trim();
    const ganttRentalId = String(delivery?.ganttRentalId || '').trim();

    let classicRental = rentalId
      ? classicRentals.find(item => String(item?.id || '') === rentalId) || null
      : null;
    let ganttRental = ganttRentalId
      ? ganttRentals.find(item => String(item?.id || '') === ganttRentalId) || null
      : null;

    if (!classicRental && ganttRental) {
      const linkedClassicId = String(ganttRental.rentalId || ganttRental.sourceRentalId || ganttRental.originalRentalId || '').trim();
      classicRental = linkedClassicId
        ? classicRentals.find(item => String(item?.id || '') === linkedClassicId) || null
        : null;
    }
    if (!ganttRental && classicRental) {
      ganttRental = ganttRentals.find(item =>
        [item.rentalId, item.sourceRentalId, item.originalRentalId].some(id => String(id || '') === String(classicRental.id || ''))
      ) || null;
    }

    return { classicRental, ganttRental };
  }

  function getClientObject(objectId) {
    return getClientObjectById(readData, objectId);
  }

  function withDeliveryObjectSnapshot(delivery) {
    const object = getClientObject(delivery?.objectId);
    if (!object) return delivery;
    return {
      ...delivery,
      objectName: delivery.objectName || object.name || null,
      objectAddress: delivery.objectAddress || object.address || null,
      objectContactName: delivery.objectContactName || object.contactName || null,
      objectContactPhone: delivery.objectContactPhone || object.contactPhone || null,
      destination: delivery.destination || object.address || '',
      contactName: delivery.contactName || object.contactName || '',
      contactPhone: delivery.contactPhone || object.contactPhone || '',
    };
  }

  function normalizeDeliveryCounterpartyLinks(delivery, existing = null) {
    const historical = Boolean(existing) && isHistoricalDeliveryRelation(existing);
    return canonicalizeDeliveryCounterpartyRelations(delivery, { readData }, {
      existing,
      allowArchived: historical,
      requireActiveObject: !historical,
      requireActiveCarrier: !historical,
    });
  }

  function normalizeDeliveryRentalLinks(delivery) {
    const { classicRental, ganttRental } = findLinkedRentalContext(delivery);
    if (ganttRental && !classicRental) {
      const error = new Error(`Gantt projection ${ganttRental.id} has no linked Classic Rental.`);
      error.status = 409;
      error.code = 'ORPHAN_GANTT_PROJECTION';
      throw error;
    }
    if (!classicRental && !ganttRental) return delivery;
    const source = classicRental || ganttRental;
    const equipment = source?.equipmentId
      ? (readData('equipment') || []).find(item => String(item?.id || '') === String(source.equipmentId || '')) || null
      : null;
    const equipmentInv = source?.equipmentInv
      || source?.inventoryNumber
      || equipment?.inventoryNumber
      || (Array.isArray(source?.equipment) ? source.equipment[0] : '')
      || '';
    const equipmentLabel = delivery.equipmentLabel
      || [equipment?.manufacturer, equipment?.model].filter(Boolean).join(' ').trim()
      || equipmentInv
      || null;

    return withDeliveryObjectSnapshot({
      ...delivery,
      rentalId: classicRental?.id || delivery.rentalId || null,
      classicRentalId: classicRental?.id || delivery.classicRentalId || null,
      ganttRentalId: ganttRental?.id || delivery.ganttRentalId || null,
      counterpartyId: source?.counterpartyId || delivery.counterpartyId || null,
      clientId: source?.clientId || delivery.clientId || null,
      client: source?.client || delivery.client,
      objectId: source?.objectId || delivery.objectId || null,
      contractId: source?.contractId || delivery.contractId || null,
      manager: source?.manager || delivery.manager,
      equipmentId: source?.equipmentId || delivery.equipmentId || null,
      equipmentInv: equipmentInv || delivery.equipmentInv || null,
      equipmentLabel,
    });
  }

  function enrichDeliveryBodyFromRentalContext(body, existing = null) {
    const candidate = {
      ...(existing || {}),
      ...(body || {}),
      rentalId: body?.rentalId || existing?.rentalId || body?.classicRentalId || existing?.classicRentalId,
      classicRentalId: body?.classicRentalId || existing?.classicRentalId || body?.rentalId || existing?.rentalId,
    };
    const { classicRental, ganttRental } = findLinkedRentalContext(candidate);
    if (!classicRental && !ganttRental) return body;
    const source = classicRental || ganttRental;
    const equipment = source?.equipmentId
      ? (readData('equipment') || []).find(item => String(item?.id || '') === String(source.equipmentId || '')) || null
      : null;
    const equipmentInv = source?.equipmentInv
      || source?.inventoryNumber
      || equipment?.inventoryNumber
      || (Array.isArray(source?.equipment) ? source.equipment[0] : '')
      || '';
    const equipmentLabel = body?.equipmentLabel
      || [equipment?.manufacturer, equipment?.model].filter(Boolean).join(' ').trim()
      || equipmentInv
      || undefined;

    return {
      ...(body || {}),
      rentalId: classicRental?.id || body?.rentalId,
      classicRentalId: classicRental?.id || body?.classicRentalId,
      ganttRentalId: ganttRental?.id || body?.ganttRentalId,
      counterpartyId: source?.counterpartyId || body?.counterpartyId,
      clientId: source?.clientId || body?.clientId,
      client: source?.client || body?.client,
      objectId: source?.objectId || body?.objectId,
      contractId: source?.contractId || body?.contractId,
      manager: source?.manager || body?.manager,
      equipmentId: source?.equipmentId || body?.equipmentId,
      equipmentInv: equipmentInv || body?.equipmentInv,
      equipmentLabel,
    };
  }

  function button(text, payload) {
    return {
      type: 'callback',
      text,
      payload,
    };
  }

  function keyboard(rows) {
    return [{
      type: 'inline_keyboard',
      payload: {
        buttons: rows,
      },
    }];
  }

  function deliveryStatusKeyboard(deliveryId, status) {
    if (status === 'completed' || status === 'cancelled') return null;
    if (status === 'accepted') {
      return keyboard([
        [button('В пути', `delivery:status:${deliveryId}:in_transit`)],
        [button('Проблема/отмена', `delivery:status:${deliveryId}:cancelled`)],
        [button('Комментарий/фото', `delivery:comment:${deliveryId}`)],
      ]);
    }
    if (status === 'in_transit') {
      return keyboard([
        [button('Выполнено', `delivery:status:${deliveryId}:completed`)],
        [button('Проблема/отмена', `delivery:status:${deliveryId}:cancelled`)],
        [button('Комментарий/фото', `delivery:comment:${deliveryId}`)],
      ]);
    }
    return keyboard([
      [button('Принять доставку', `delivery:status:${deliveryId}:accepted`)],
      [button('Проблема/отмена', `delivery:status:${deliveryId}:cancelled`)],
      [button('Комментарий/фото', `delivery:comment:${deliveryId}`)],
    ]);
  }

  function getMaxApiErrorMessage(response) {
    if (!response) return 'MAX не вернул ответ';
    if (response.error) {
      return response.message || response.error_description || response.error || 'MAX вернул ошибку';
    }
    if (response.success === false) {
      return response.message || 'MAX вернул ошибку';
    }
    return null;
  }

  async function emitDeliveryNotification(label, task) {
    if (typeof task !== 'function') return;
    try {
      await task();
    } catch (error) {
      console.error(`[BOT] ${label}:`, error?.message || error);
    }
  }

  function buildLinkedRentalSync(delivery, author) {
    const ganttRentals = readData('gantt_rentals') || [];
    const classicRentals = readData('rentals') || [];
    const equipment = readData('equipment') || [];
    const today = new Date().toISOString().slice(0, 10);

    let ganttChanged = false;
    let classicChanged = false;
    const protectedClassicIds = new Set();
    const protectedGanttIds = new Set();

    const nextClassic = classicRentals.map((rental) => {
      const deliveryClassicRentalId = delivery.classicRentalId || delivery.rentalId;
      if (!deliveryClassicRentalId || rental.id !== deliveryClassicRentalId) return rental;

      if (delivery.type === 'shipping') {
        if (rental.startDate === delivery.transportDate && rental.deliveryAddress === delivery.destination) return rental;
        classicChanged = true;
        const startDateChanged = rental.startDate !== delivery.transportDate;
        if (startDateChanged) protectedClassicIds.add(String(rental.id || ''));
        const canonical = startDateChanged
          ? canonicalizeRentalPatch(rental, { startDate: delivery.transportDate }).rental
          : rental;
        return {
          ...canonical,
          deliveryAddress: delivery.destination || rental.deliveryAddress,
          manager: delivery.manager || rental.manager,
          status: rental.status === 'closed' ? rental.status : 'delivery',
          comments: appendClassicRentalComment(
            rental,
            `Назначена доставка на отгрузку: ${delivery.transportDate} (${delivery.origin} → ${delivery.destination})`,
          ),
        };
      }

      if (rental.plannedReturnDate === delivery.transportDate) return rental;
      classicChanged = true;
      protectedClassicIds.add(String(rental.id || ''));
      const canonical = canonicalizeRentalPatch(rental, { plannedReturnDate: delivery.transportDate }).rental;
      return {
        ...canonical,
        manager: delivery.manager || rental.manager,
        status: rental.status === 'closed' ? rental.status : 'return_planned',
        comments: appendClassicRentalComment(
          rental,
          `Назначена приёмка/возврат: ${delivery.transportDate} (${delivery.origin} → ${delivery.destination})`,
        ),
      };
    });

    const previousClassicById = new Map(classicRentals.map(item => [String(item?.id || ''), item]));
    const nextClassicById = new Map(nextClassic.map(item => [String(item?.id || ''), item]));
    for (const rental of nextClassic) {
      const previousRental = previousClassicById.get(String(rental?.id || '')) || null;
      const terminalValidation = validateTerminalRentalTransition(previousRental, rental);
      if (!terminalValidation.ok) {
        const error = new Error(terminalValidation.error);
        Object.assign(error, terminalValidation, { status: terminalValidation.status || 409 });
        throw error;
      }
    }
    const deliveryClassicRentalId = String(delivery.classicRentalId || delivery.rentalId || '');
    const nextGantt = ganttRentals.map((rental) => {
      const linkedIds = [rental.rentalId, rental.sourceRentalId, rental.originalRentalId]
        .map(value => String(value || ''));
      const isDeliveryGantt = Boolean(delivery.ganttRentalId && rental.id === delivery.ganttRentalId);
      const isLinkedClassic = Boolean(deliveryClassicRentalId && linkedIds.includes(deliveryClassicRentalId));
      if (!isDeliveryGantt && !isLinkedClassic) return rental;

      const linkedClassicId = linkedIds.find(id => nextClassicById.has(id)) || deliveryClassicRentalId;
      const previousClassic = previousClassicById.get(linkedClassicId) || null;
      const updatedClassic = nextClassicById.get(linkedClassicId) || null;
      if (previousClassic && updatedClassic) {
        const rentalForPlanner = { ...updatedClassic, status: previousClassic.status };
        let synced = syncGanttRentalFields(rental, previousClassic, rentalForPlanner, author, equipment);
        if (delivery.type === 'shipping') {
          const nextStatus = rental.status === 'returned' || rental.status === 'closed'
            ? rental.status
            : (delivery.transportDate <= today ? 'active' : 'created');
          synced = { ...synced, status: nextStatus };
        } else {
          synced = { ...synced, status: rental.status };
        }
        const linked = synced;
        if (JSON.stringify(linked) !== JSON.stringify(rental)) ganttChanged = true;
        if (protectedClassicIds.has(String(updatedClassic.id || ''))) {
          protectedGanttIds.add(String(rental.id || ''));
        }
        return linked;
      }

      if (delivery.type === 'shipping') {
        if (rental.startDate === delivery.transportDate) return rental;
        ganttChanged = true;
        protectedGanttIds.add(String(rental.id || ''));
        const nextStatus = rental.status === 'returned' || rental.status === 'closed'
          ? rental.status
          : (delivery.transportDate <= today ? 'active' : 'created');
        return appendGanttHistoryEntry(
          { ...rental, startDate: delivery.transportDate, manager: delivery.manager || rental.manager, status: nextStatus },
          `Назначена доставка на отгрузку: ${delivery.transportDate} (${delivery.origin} → ${delivery.destination})`,
          author,
        );
      }
      if (rental.endDate === delivery.transportDate) return rental;
      ganttChanged = true;
      protectedGanttIds.add(String(rental.id || ''));
      return appendGanttHistoryEntry(
        { ...rental, endDate: delivery.transportDate, manager: delivery.manager || rental.manager },
        `Назначена приёмка/возврат: ${delivery.transportDate} (${delivery.origin} → ${delivery.destination})`,
        author,
      );
    });

    for (const [index, rental] of nextClassic.entries()) {
      if (rental === classicRentals[index] || !protectedClassicIds.has(String(rental.id || ''))) continue;
      const validation = validateRentalPayload('rentals', rental, nextClassic, equipment, rental.id);
      if (!validation.ok) {
        const error = new Error(validation.error);
        Object.assign(error, validation, { status: validation.status || 400 });
        throw error;
      }
      const lifecycleValidation = validateRentalLifecycleAvailability({
        rental,
        equipmentList: equipment,
        serviceTickets: readData('service') || [],
        equipmentDowntimes: readData('equipment_downtimes') || [],
      });
      if (!lifecycleValidation.ok) {
        const error = new Error(lifecycleValidation.error);
        Object.assign(error, lifecycleValidation, { status: lifecycleValidation.status || 409 });
        throw error;
      }
    }
    for (const [index, rental] of nextGantt.entries()) {
      if (rental === ganttRentals[index] || !protectedGanttIds.has(String(rental.id || ''))) continue;
      const validation = validateRentalPayload('gantt_rentals', rental, nextGantt, equipment, rental.id);
      if (!validation.ok) {
        const error = new Error(validation.error);
        Object.assign(error, validation, { status: validation.status || 400 });
        throw error;
      }
    }

    const affectedRentals = [
      ...classicRentals.filter((item, index) => item !== nextClassic[index]),
      ...nextClassic.filter((item, index) => item !== classicRentals[index]),
    ];
    const lifecycle = reconcileEquipmentRentalProjection({
      equipmentList: equipment,
      rentals: nextClassic,
      ganttRentals: nextGantt,
      serviceTickets: readData('service') || [],
      affectedEquipmentIds: affectedEquipmentIdsForRentals(affectedRentals, equipment),
      nowIso,
      author,
      reason: `Изменение дат аренды доставкой ${delivery.id}`,
    });

    return {
      classicChanged,
      ganttChanged,
      nextClassic,
      nextGantt,
      equipmentChanged: lifecycle.changed,
      nextEquipment: lifecycle.nextEquipment,
    };
  }

  function persistDeliveryBatch(entries) {
    try {
      persistDataBatch(entries);
    } catch (error) {
      const persistenceError = new Error(error?.message || 'Не удалось сохранить доставку и связанную аренду');
      Object.assign(persistenceError, error, { status: 500 });
      throw persistenceError;
    }
  }

  function listRawCarrierConnections() {
    const botUsers = getBotUsers() || {};
    return Object.entries(botUsers)
      .map(([key, value]) => ({
        id: String(value.userId || key),
        key,
        name: value.userName || value.email || key,
        role: value.userRole || '',
        email: value.email || '',
        phone: key,
        chatId: value.replyTarget?.chat_id ?? null,
        userId: value.replyTarget?.user_id ?? (Number(key) || null),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  function listCarrierDirectory() {
    const rawConnections = listRawCarrierConnections();
    const rawByKey = new Map(rawConnections.map((item) => [item.key, item]));
    const rawBySystemUserId = new Map(rawConnections.map((item) => [item.id, item]));
    const users = readData('users') || [];
    const carrierUsers = users.filter((user) => user?.role === 'Перевозчик' && user?.status !== 'Неактивен');
    const carrierUsersById = new Map(carrierUsers.map((user) => [String(user.id), user]));
    const directory = (readData('delivery_carriers') || [])
      .map((record) => {
        try {
          return normalizeCarrierRecord(canonicalizeDeliveryCarrierCounterpartyRelation(
            record,
            { readData },
            { allowArchived: isHistoricalDeliveryCarrierRelation(record) },
          ));
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);

    // Carrier bot/user connections are operational identities, not legal/business
    // identities. They must be attached to an explicit persisted DeliveryCarrier
    // whose counterpartyId resolves to a contractor Counterparty.
    if (directory.length === 0) return [];

    const directoryCarriers = directory
      .map((item) => {
        const linked = item.maxCarrierKey
          ? rawByKey.get(item.maxCarrierKey)
          : rawBySystemUserId.get(String(item.systemUserId || ''));
        const systemUser = carrierUsersById.get(String(item.systemUserId || ''));
        return {
          id: item.id,
          key: item.id,
          name: item.name,
          phone: item.phone || linked?.phone,
          notes: item.notes,
          status: item.status,
          systemUserId: item.systemUserId || null,
          systemUserName: systemUser?.name || null,
          systemUserEmail: systemUser?.email || null,
          maxCarrierKey: item.maxCarrierKey || linked?.key || null,
          maxUserName: linked?.name || null,
          email: linked?.email || systemUser?.email || undefined,
          role: linked?.role || undefined,
          maxConnected: Boolean(linked),
          chatId: linked?.chatId ?? null,
          userId: linked?.userId ?? null,
        };
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        return a.name.localeCompare(b.name, 'ru');
      });
    return directoryCarriers.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return a.name.localeCompare(b.name, 'ru');
    });
  }

  function isAdminRequest(req) {
    return normalizeRole(req.user?.userRole || req.user?.role || '') === 'Администратор';
  }

  function requireCarrierConnectionRead(req, res, next) {
    if (!isAdminRequest(req)) {
      return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role' });
    }
    return next();
  }

  function safeCarrierDirectoryItem(item) {
    return {
      id: item.id,
      key: item.key || item.id,
      name: item.name,
      company: item.company,
      inn: item.inn,
      counterpartyId: item.counterpartyId,
      phone: item.phone,
      notes: item.notes,
      status: item.status,
      maxConnected: Boolean(item.maxConnected),
    };
  }

  function resolveCarrierSelection(carrierKey) {
    const carriers = listCarrierDirectory();
    return carriers.find((item) =>
      item.key === carrierKey
      || item.id === carrierKey
      || item.maxCarrierKey === carrierKey,
    ) || null;
  }

  function shouldSendAfterDeliveryUpdate(previous, next, patch = {}) {
    const previousCarrierId = resolveDeliveryCarrierId(previous);
    const nextCarrierId = resolveDeliveryCarrierId(next);
    if (!nextCarrierId) return false;
    // IMPORTANT: completed/cancelled deliveries are terminal. Do not re-send them as
    // active tasks to the carrier bot after edits.
    if (next.status === 'completed' || next.status === 'cancelled') return false;

    const carrierChanged = previousCarrierId !== nextCarrierId;
    const commentWasSubmitted = Object.prototype.hasOwnProperty.call(patch, 'comment');
    const commentChanged = commentWasSubmitted &&
      String(previous?.comment || '').trim() !== String(next?.comment || '').trim();

    if (next.botSentAt && !carrierChanged && !commentChanged) return false;

    const carrierFieldWasSubmitted = Object.prototype.hasOwnProperty.call(patch, 'carrierId') ||
      Object.prototype.hasOwnProperty.call(patch, 'carrierKey');

    return carrierFieldWasSubmitted ||
      commentChanged ||
      !previousCarrierId ||
      carrierChanged ||
      previous?.botSendError === 'Перевозчик не выбран';
  }

  async function trySendToCarrier(delivery) {
    const selectedCarrierId = resolveDeliveryCarrierId(delivery);
    if (!selectedCarrierId) {
      return {
        ...delivery,
        botSendError: 'Перевозчик не выбран',
      };
    }

    const carrier = resolveCarrierSelection(selectedCarrierId);
    if (!carrier) {
      return {
        ...delivery,
        botSendError: 'Перевозчик не найден в справочнике',
      };
    }

    if (!carrier.maxCarrierKey) {
      return {
        ...delivery,
        botSendError: 'Для перевозчика не привязан пользователь MAX',
      };
    }

    const botUsers = getBotUsers() || {};
    const botUser = botUsers[carrier.maxCarrierKey];
    if (!botUser) {
      return {
        ...delivery,
        botSendError: 'Перевозчик не подключён к боту MAX',
      };
    }
    const hasCarrierRole = String(botUser.role || '').trim().toLowerCase() === 'carrier' ||
      botUser.userRole === 'Перевозчик' ||
      botUser.botMode === 'delivery';
    if (!hasCarrierRole) {
      return {
        ...delivery,
        botSendError: 'Пользователь MAX не привязан к роли перевозчика',
      };
    }
    const carrierBotUser = {
      ...botUser,
      userRole: botUser.userRole || 'Перевозчик',
      role: 'carrier',
      botMode: 'delivery',
      isActive: botUser.isActive !== false,
      carrierId: botUser.carrierId || carrier.id,
    };
    if (!isCarrierBotUser(carrierBotUser)) {
      return {
        ...delivery,
        botSendError: 'Пользователь MAX не привязан к роли перевозчика',
      };
    }
    if (typeof saveBotUsers === 'function' && JSON.stringify(botUser) !== JSON.stringify(carrierBotUser)) {
      saveBotUsers({
        ...botUsers,
        [carrier.maxCarrierKey]: carrierBotUser,
      });
    }

    const target = carrierBotUser.replyTarget || { user_id: Number(carrier.maxCarrierKey) };
    const equipment = delivery.equipmentId
      ? (readData('equipment') || []).find(item => item.id === delivery.equipmentId)
      : null;
    const text = [
      delivery.type === 'shipping'
        ? 'Появилась новая заявка на отгрузку'
        : 'Появилась новая заявка на приёмку',
      '',
      formatCarrierDeliveryMessage({ ...delivery, carrierId: carrier.id }, { equipment }),
    ].join('\n');

    try {
      const response = await sendMessage(target, text, {
        attachments: deliveryStatusKeyboard(delivery.id, delivery.status === 'new' ? 'sent' : delivery.status),
      });
      const maxApiError = getMaxApiErrorMessage(response);
      if (maxApiError) {
        throw new Error(maxApiError);
      }
      return {
        ...delivery,
        carrierId: carrier.id,
        carrierKey: carrier.key || carrier.id,
        status: delivery.status === 'new' ? 'sent' : delivery.status,
        botSentAt: nowIso(),
        botSendError: null,
      };
    } catch (error) {
      return {
        ...delivery,
        botSendError: error?.message || 'Не удалось отправить заявку в MAX',
      };
    }
  }

  router.get('/delivery-carriers', requireAuth, requireRead('deliveries'), (req, res) => {
    if (isCarrierRequest(req)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const directory = listCarrierDirectory();
    if (isAdminRequest(req)) {
      return res.json(directory);
    }
    return res.json(directory
      .filter(item => item.status === 'active')
      .map(safeCarrierDirectoryItem));
  });

  router.get('/delivery-carrier-connections', requireAuth, requireCarrierConnectionRead, (req, res) => {
    res.json(listRawCarrierConnections());
  });

  router.get('/deliveries', requireAuth, requireRead('deliveries'), (req, res) => {
    let deliveries = readData('deliveries') || [];
    deliveries = accessControl.filterCollectionByScope('deliveries', deliveries, req.user);
    if (isCarrierRequest(req)) {
      deliveries = deliveries.filter(item => !isClosedDelivery(item));
    }
    if (req.query.status && !wantsPaginatedResponse(req.query)) {
      deliveries = deliveries.filter((item) => item.status === req.query.status);
    }
    if (req.query.manager) {
      deliveries = deliveries.filter((item) => item.manager === req.query.manager);
    }
    deliveries.sort((a, b) => {
      const byDate = String(b.transportDate || '').localeCompare(String(a.transportDate || ''));
      if (byDate !== 0) return byDate;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    const sanitized = accessControl.sanitizeCollectionForRead('deliveries', deliveries, req.user);
    const responseItems = sanitized.map(item => deliveryResponse(item, req));
    if (wantsPaginatedResponse(req.query)) {
      let rows = responseItems.filter(item => itemMatchesSearch(item, req.query.search, [
        'id',
        'number',
        'client',
        'clientName',
        'clientId',
        'rentalId',
        'equipment',
        'cargo',
        'equipmentInv',
        'origin',
        'destination',
        'fromAddress',
        'toAddress',
        'carrierName',
        'manager',
      ]));
      const statusValue = String(req.query.status || req.query.statusGroup || '').trim();
      if (statusValue) {
        rows = rows.filter(item => matchesDeliveryStatusFilter(item, statusValue));
      }
      const filterMap = {
        carrierId: item => item.carrierId,
        carrier: item => item.carrierName || item.carrierKey || item.carrierId,
        clientId: item => item.clientId,
        rentalId: item => item.rentalId,
        type: item => item.type,
        manager: item => item.manager,
      };
      Object.entries(filterMap).forEach(([name, getter]) => {
        const value = String(req.query[name] || '').trim();
        if (value && value !== 'all') rows = rows.filter(item => String(getter(item) || '') === value);
      });
      const dateFrom = String(req.query.dateFrom || '').trim();
      const dateTo = String(req.query.dateTo || '').trim();
      if (dateFrom || dateTo) {
        rows = rows.filter(item => {
          const date = String(item.transportDate || item.date || item.createdAt || '').slice(0, 10);
          if (!date) return false;
          if (dateFrom && date < dateFrom) return false;
          if (dateTo && date > dateTo) return false;
          return true;
        });
      }
      return res.json(buildPaginatedResponse(rows, req.query, {
        sortFields: {
          transportDate: item => item.transportDate || item.date,
          createdAt: item => item.createdAt,
          status: item => item.status,
          client: item => item.clientName || item.client,
          carrierName: item => item.carrierName,
        },
        defaultSort: { sortBy: 'transportDate', sortDir: 'desc' },
        summary: {
          total: rows.length,
          active: rows.filter(item => !isClosedDelivery(item)).length,
          inTransit: rows.filter(item => item.status === 'in_transit').length,
          completed: rows.filter(item => item.status === 'completed').length,
          overdue: rows.filter(item => isDeliveryOverdueForPagination(item)).length,
          unassigned: rows.filter(item => isDeliveryUnassignedForPagination(item) && !isClosedDelivery(item)).length,
        },
      }));
    }
    res.json(responseItems);
  });

  router.get('/deliveries/:id', requireAuth, requireRead('deliveries'), (req, res) => {
    const deliveries = readData('deliveries') || [];
    const found = deliveries.find((item) => item.id === req.params.id);
    if (!found) {
      return res.status(404).json({ ok: false, error: 'Доставка не найдена' });
    }
    if (!accessControl.canAccessEntity('deliveries', found, req.user)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (isCarrierRequest(req) && isClosedDelivery(found)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    return res.json(deliveryResponse(accessControl.sanitizeEntityForRead('deliveries', found, req.user), req));
  });

  router.post('/deliveries', requireAuth, requireWrite('deliveries'), async (req, res) => {
    try {
      assertBusinessNumberNotProvided(req.body);
      const author = req.user.userName;
      const safeBody = sanitizeDeliveryBody(req.body, null, req);
      let delivery = normalizeDeliveryPayload(enrichDeliveryBodyFromRentalContext(safeBody), null, author, buildDeliveryCreator(req));
      delivery = normalizeDeliveryRentalLinks(delivery);
      delivery = withDeliveryObjectSnapshot(normalizeDeliveryCounterpartyLinks(delivery));
      const carrier = resolveCarrierSelection(resolveDeliveryCarrierId(delivery));
      if (carrier) {
        delivery = {
          ...delivery,
          carrierId: carrier.id,
          carrierKey: carrier.key || carrier.id,
          carrierName: carrier.name,
          carrierPhone: carrier.phone,
          carrierChatId: carrier.chatId ?? null,
          carrierUserId: carrier.userId ?? null,
        };
      } else {
        delivery = {
          ...delivery,
          carrierId: null,
          carrierKey: null,
          carrierName: null,
          carrierPhone: null,
          carrierChatId: null,
          carrierUserId: null,
        };
      }

      if (businessNumbering) businessNumbering.assignNewRecord('deliveries', delivery);

      const linkedRentalSync = buildLinkedRentalSync(delivery, author);
      delivery = await trySendToCarrier(delivery);

      const deliveries = [...(readData('deliveries') || [])];
      deliveries.push(delivery);
      persistDeliveryBatch([
        ...(linkedRentalSync.classicChanged ? [{ name: 'rentals', value: linkedRentalSync.nextClassic }] : []),
        ...(linkedRentalSync.ganttChanged ? [{ name: 'gantt_rentals', value: linkedRentalSync.nextGantt }] : []),
        ...(linkedRentalSync.equipmentChanged ? [{ name: 'equipment', value: linkedRentalSync.nextEquipment }] : []),
        { name: 'deliveries', value: deliveries },
      ]);
      auditLog?.(req, {
        action: 'deliveries.create',
        entityType: 'deliveries',
        entityId: delivery.id,
        after: delivery,
      });
      await emitDeliveryNotification('Не удалось отправить уведомление о создании отгрузки', () =>
        botNotifications?.notifyDeliveryCreated?.(delivery),
      );
      return res.status(201).json(delivery);
    } catch (error) {
      return res.status(error?.status || 400).json({
        ok: false,
        code: error?.code,
        error: error.message,
        field: error?.field,
        fieldErrors: error?.fieldErrors,
      });
    }
  });

  router.patch('/deliveries/:id', requireAuth, requireWrite('deliveries'), async (req, res) => {
    try {
      assertBusinessNumberNotProvided(req.body);
      const deliveries = [...(readData('deliveries') || [])];
      const idx = deliveries.findIndex((item) => item.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ ok: false, error: 'Доставка не найдена' });
      }

      const current = deliveries[idx];
      try {
        accessControl.assertCanUpdateEntity('deliveries', current, req.user);
      } catch (error) {
        return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
      }
      const author = req.user.userName;
      const safeBody = sanitizeDeliveryBody(req.body, current, req);
      let delivery = normalizeDeliveryPayload(
        enrichDeliveryBodyFromRentalContext({ ...current, ...safeBody }, current),
        current,
        author,
        buildDeliveryCreator(req),
      );
      delivery = normalizeDeliveryRentalLinks(delivery);
      delivery = withDeliveryObjectSnapshot(normalizeDeliveryCounterpartyLinks(delivery, current));
      const carrier = resolveCarrierSelection(resolveDeliveryCarrierId(delivery));
      if (carrier) {
        delivery = {
          ...delivery,
          carrierId: carrier.id,
          carrierKey: carrier.key || carrier.id,
          carrierName: carrier.name,
          carrierPhone: carrier.phone,
          carrierChatId: carrier.chatId ?? null,
          carrierUserId: carrier.userId ?? null,
        };
      } else {
        delivery = {
          ...delivery,
          carrierId: null,
          carrierKey: null,
          carrierName: null,
          carrierPhone: null,
          carrierChatId: null,
          carrierUserId: null,
        };
      }

      if (delivery.carrierInvoiceReceived && !delivery.carrierInvoiceReceivedAt) {
        delivery.carrierInvoiceReceivedAt = nowIso();
      }
      if (!delivery.carrierInvoiceReceived) {
        delivery.carrierInvoiceReceivedAt = null;
      }
      if (delivery.clientPaymentVerified && !delivery.clientPaymentVerifiedAt) {
        delivery.clientPaymentVerifiedAt = nowIso();
      }
      if (!delivery.clientPaymentVerified) {
        delivery.clientPaymentVerifiedAt = null;
      }

      const linkedRentalSync = buildLinkedRentalSync(delivery, author);
      if (shouldSendAfterDeliveryUpdate(current, delivery, safeBody)) {
        delivery = await trySendToCarrier(delivery);
      }
      deliveries[idx] = delivery;
      persistDeliveryBatch([
        ...(linkedRentalSync.classicChanged ? [{ name: 'rentals', value: linkedRentalSync.nextClassic }] : []),
        ...(linkedRentalSync.ganttChanged ? [{ name: 'gantt_rentals', value: linkedRentalSync.nextGantt }] : []),
        ...(linkedRentalSync.equipmentChanged ? [{ name: 'equipment', value: linkedRentalSync.nextEquipment }] : []),
        { name: 'deliveries', value: deliveries },
      ]);
      auditLog?.(req, {
        action: 'deliveries.update',
        entityType: 'deliveries',
        entityId: delivery.id,
        before: current,
        after: delivery,
      });
      await emitDeliveryNotification('Не удалось отправить уведомление о статусе отгрузки', () =>
        botNotifications?.notifyDeliveryStatusChanged?.(current, delivery),
      );
      return res.json(delivery);
    } catch (error) {
      return res.status(error?.status || 400).json({
        ok: false,
        code: error?.code,
        error: error.message,
        field: error?.field,
        fieldErrors: error?.fieldErrors,
      });
    }
  });

  router.post('/deliveries/:id/send', requireAuth, requireWrite('deliveries'), async (req, res) => {
    try {
      const deliveries = readData('deliveries') || [];
      const idx = deliveries.findIndex((item) => item.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ ok: false, error: 'Доставка не найдена' });
      }
      try {
        accessControl.assertCanUpdateEntity('deliveries', deliveries[idx], req.user);
      } catch (error) {
        return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
      }

      const updated = await trySendToCarrier(deliveries[idx]);
      deliveries[idx] = {
        ...updated,
        updatedAt: nowIso(),
      };
      writeData('deliveries', deliveries);
      auditLog?.(req, {
        action: 'deliveries.send_to_carrier',
        entityType: 'deliveries',
        entityId: deliveries[idx].id,
        after: deliveries[idx],
      });
      return res.json(deliveries[idx]);
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.delete('/deliveries/:id', requireAuth, requireWrite('deliveries'), (req, res) => {
    const deliveries = readData('deliveries') || [];
    const idx = deliveries.findIndex((item) => item.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: 'Доставка не найдена' });
    }
    const removed = deliveries[idx];
    try {
      accessControl.assertCanDeleteEntity('deliveries', removed, req.user);
    } catch (error) {
      return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
    }
    deliveries.splice(idx, 1);
    writeData('deliveries', deliveries);
    auditLog?.(req, {
      action: 'deliveries.delete',
      entityType: 'deliveries',
      entityId: removed.id,
      before: removed,
    });
    return res.json({ ok: true });
  });
}

module.exports = {
  registerDeliveryRoutes,
};
