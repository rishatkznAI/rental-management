const express = require('express');
const {
  formatCarrierDeliveryMessage,
  isCarrierBotUser,
  resolveDeliveryCarrierId,
} = require('../lib/carrier-delivery-dto');

function registerDeliveryRoutes(router, deps) {
  const {
    readData,
    writeData,
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

  function normalizeCarrierRecord(record = {}) {
    return {
      id: String(record.id || ''),
      key: String(record.key || record.id || ''),
      name: String(record.name || '').trim(),
      company: record.company ? String(record.company).trim() : undefined,
      inn: record.inn ? String(record.inn).trim() : undefined,
      phone: record.phone ? String(record.phone).trim() : undefined,
      notes: record.notes ? String(record.notes).trim() : undefined,
      status: record.status === 'inactive' ? 'inactive' : 'active',
      systemUserId: record.systemUserId ? String(record.systemUserId).trim() : null,
      maxCarrierKey: record.maxCarrierKey ? String(record.maxCarrierKey) : null,
    };
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
    const transportDate = String(body.transportDate || '').slice(0, 10);
    const neededBy = body.neededBy ? String(body.neededBy).slice(0, 10) : (existing?.neededBy || null);

    ensureNonEmpty(transportDate, 'Дата перевозки');
    ensureNonEmpty(body.origin, 'Откуда');
    ensureNonEmpty(body.destination, 'Куда');
    ensureNonEmpty(body.cargo, 'Что перевозим');
    ensureNonEmpty(body.contactName, 'Контактное лицо');
    ensureNonEmpty(body.contactPhone, 'Контактный номер');
    ensureNonEmpty(body.client, 'Клиент');
    ensureNonEmpty(body.manager || existing?.manager || author, 'Ответственный менеджер');

    const existingCreatorName = String(existing?.createdByName || existing?.createdBy || '').trim().toLowerCase();
    const currentCreatorName = String(creator?.name || '').trim().toLowerCase();
    const canUseCurrentCreatorContact = !existing || (existingCreatorName && existingCreatorName === currentCreatorName);
    const next = {
      id: existing?.id || body.id || generateId(idPrefixes.deliveries),
      type,
      status,
      transportDate,
      pickupTime: normalizePickupTime(body.pickupTime, existing),
      neededBy,
      origin: String(body.origin || '').trim(),
      destination: String(body.destination || '').trim(),
      cargo: String(body.cargo || '').trim(),
      contactName: String(body.contactName || '').trim(),
      contactPhone: String(body.contactPhone || '').trim(),
      cost: Math.max(0, Number(body.cost) || 0),
      comment: String(body.comment || '').trim(),
      client: String(body.client || '').trim(),
      clientId: body.clientId ? String(body.clientId) : (existing?.clientId || null),
      manager: String(body.manager || existing?.manager || author).trim(),
      carrierId: body.carrierId ? String(body.carrierId) : (body.carrierKey ? String(body.carrierKey) : (existing?.carrierId || null)),
      carrierKey: body.carrierKey ? String(body.carrierKey) : (body.carrierId ? String(body.carrierId) : (existing?.carrierKey || null)),
      carrierName: body.carrierName ? String(body.carrierName) : (existing?.carrierName || null),
      carrierPhone: body.carrierPhone ? String(body.carrierPhone) : (existing?.carrierPhone || null),
      carrierChatId: body.carrierChatId ?? existing?.carrierChatId ?? null,
      carrierUserId: body.carrierUserId ?? existing?.carrierUserId ?? null,
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
      'carrierId',
      'carrierKey',
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

  function syncLinkedRentals(delivery, author) {
    const ganttRentals = readData('gantt_rentals') || [];
    const classicRentals = readData('rentals') || [];
    const today = new Date().toISOString().slice(0, 10);

    let ganttChanged = false;
    let classicChanged = false;

    const nextGantt = ganttRentals.map((rental) => {
      if (!delivery.ganttRentalId || rental.id !== delivery.ganttRentalId) return rental;

      if (delivery.type === 'shipping') {
        if (rental.startDate === delivery.transportDate) return rental;
        ganttChanged = true;
        const nextStatus = rental.status === 'returned' || rental.status === 'closed'
          ? rental.status
          : (delivery.transportDate <= today ? 'active' : 'created');
        return appendGanttHistoryEntry(
          {
            ...rental,
            startDate: delivery.transportDate,
            manager: delivery.manager || rental.manager,
            status: nextStatus,
          },
          `Назначена доставка на отгрузку: ${delivery.transportDate} (${delivery.origin} → ${delivery.destination})`,
          author,
        );
      }

      if (rental.endDate === delivery.transportDate) return rental;
      ganttChanged = true;
      return appendGanttHistoryEntry(
        {
          ...rental,
          endDate: delivery.transportDate,
          manager: delivery.manager || rental.manager,
        },
        `Назначена приёмка/возврат: ${delivery.transportDate} (${delivery.origin} → ${delivery.destination})`,
        author,
      );
    });

    const nextClassic = classicRentals.map((rental) => {
      if (!delivery.classicRentalId || rental.id !== delivery.classicRentalId) return rental;

      if (delivery.type === 'shipping') {
        if (rental.startDate === delivery.transportDate && rental.deliveryAddress === delivery.destination) return rental;
        classicChanged = true;
        return {
          ...rental,
          startDate: delivery.transportDate,
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
      return {
        ...rental,
        plannedReturnDate: delivery.transportDate,
        manager: delivery.manager || rental.manager,
        status: rental.status === 'closed' ? rental.status : 'return_planned',
        comments: appendClassicRentalComment(
          rental,
          `Назначена приёмка/возврат: ${delivery.transportDate} (${delivery.origin} → ${delivery.destination})`,
        ),
      };
    });

    if (ganttChanged) writeData('gantt_rentals', nextGantt);
    if (classicChanged) writeData('rentals', nextClassic);
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
    const directory = (readData('delivery_carriers') || []).map(normalizeCarrierRecord);

    if (directory.length === 0) {
      const connectionCarriers = rawConnections.map((item) => ({
        id: item.key,
        key: item.key,
        name: item.name,
        phone: item.phone,
        notes: undefined,
        status: 'active',
        maxCarrierKey: item.key,
        maxUserName: item.name,
        email: item.email,
        role: item.role,
        maxConnected: true,
        chatId: item.chatId ?? null,
        userId: item.userId ?? null,
      }));
      const existingIds = new Set(connectionCarriers.map((item) => String(item.id)));
      const userCarriers = carrierUsers
        .filter((user) => !existingIds.has(String(user.carrierId || user.id)))
        .map((user) => {
          const linked = rawBySystemUserId.get(String(user.id));
          const id = String(user.carrierId || user.id);
          return {
            id,
            key: id,
            name: user.name || user.email || 'Перевозчик',
            phone: user.phone,
            notes: undefined,
            status: 'active',
            systemUserId: user.id,
            systemUserName: user.name || null,
            systemUserEmail: user.email || null,
            maxCarrierKey: linked?.key || (user.maxUserId ? String(user.maxUserId) : null),
            maxUserName: linked?.name || null,
            email: linked?.email || user.email || undefined,
            role: linked?.role || user.role,
            maxConnected: Boolean(linked || user.maxUserId),
            chatId: linked?.chatId ?? null,
            userId: linked?.userId ?? null,
          };
        });
      return [...connectionCarriers, ...userCarriers].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }

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
    const knownCarrierIds = new Set(directoryCarriers.map((item) => String(item.id)));
    const knownSystemUserIds = new Set(directoryCarriers.map((item) => String(item.systemUserId || '')).filter(Boolean));
    const virtualUserCarriers = carrierUsers
      .filter((user) => !knownSystemUserIds.has(String(user.id)) && !knownCarrierIds.has(String(user.carrierId || user.id)))
      .map((user) => {
        const linked = rawBySystemUserId.get(String(user.id));
        const id = String(user.carrierId || user.id);
        return {
          id,
          key: id,
          name: user.name || user.email || 'Перевозчик',
          phone: user.phone,
          notes: undefined,
          status: 'active',
          systemUserId: user.id,
          systemUserName: user.name || null,
          systemUserEmail: user.email || null,
          maxCarrierKey: linked?.key || (user.maxUserId ? String(user.maxUserId) : null),
          maxUserName: linked?.name || null,
          email: linked?.email || user.email || undefined,
          role: linked?.role || user.role,
          maxConnected: Boolean(linked || user.maxUserId),
          chatId: linked?.chatId ?? null,
          userId: linked?.userId ?? null,
        };
      });

    return [...directoryCarriers, ...virtualUserCarriers].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return a.name.localeCompare(b.name, 'ru');
    });
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
    res.json(listCarrierDirectory());
  });

  router.get('/delivery-carrier-connections', requireAuth, requireRead('delivery_carriers'), (req, res) => {
    res.json(listRawCarrierConnections());
  });

  router.get('/deliveries', requireAuth, requireRead('deliveries'), (req, res) => {
    let deliveries = readData('deliveries') || [];
    deliveries = accessControl.filterCollectionByScope('deliveries', deliveries, req.user);
    if (req.query.status) {
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
    res.json(deliveries);
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
    return res.json(found);
  });

  router.post('/deliveries', requireAuth, requireWrite('deliveries'), async (req, res) => {
    try {
      const author = req.user.userName;
      let delivery = normalizeDeliveryPayload(sanitizeDeliveryBody(req.body, null, req), null, author, buildDeliveryCreator(req));
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

      syncLinkedRentals(delivery, author);
      delivery = await trySendToCarrier(delivery);

      const deliveries = readData('deliveries') || [];
      deliveries.push(delivery);
      writeData('deliveries', deliveries);
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
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.patch('/deliveries/:id', requireAuth, requireWrite('deliveries'), async (req, res) => {
    try {
      const deliveries = readData('deliveries') || [];
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
      let delivery = normalizeDeliveryPayload({ ...current, ...safeBody }, current, author, buildDeliveryCreator(req));
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

      syncLinkedRentals(delivery, author);
      if (shouldSendAfterDeliveryUpdate(current, delivery, safeBody)) {
        delivery = await trySendToCarrier(delivery);
      }
      deliveries[idx] = delivery;
      writeData('deliveries', deliveries);
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
      return res.status(400).json({ ok: false, error: error.message });
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
