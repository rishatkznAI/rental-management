const express = require('express');

function registerDeliveryRoutes(router, deps) {
  const {
    readData,
    writeData,
    requireAuth,
    requireWrite,
    sendMessage,
    getBotUsers,
    nowIso,
    generateId,
    idPrefixes,
  } = deps;

  function ensureNonEmpty(value, fieldName) {
    if (!String(value || '').trim()) {
      throw new Error(`Поле «${fieldName}» обязательно`);
    }
  }

  function normalizeCarrierRecord(record = {}) {
    return {
      id: String(record.id || ''),
      name: String(record.name || '').trim(),
      phone: record.phone ? String(record.phone).trim() : undefined,
      notes: record.notes ? String(record.notes).trim() : undefined,
      status: record.status === 'inactive' ? 'inactive' : 'active',
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

  function normalizeDeliveryPayload(body, existing = null, author = 'Система') {
    const type = body.type === 'receiving' ? 'receiving' : 'shipping';
    const status = ['new', 'sent', 'accepted', 'completed', 'cancelled'].includes(body.status)
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

    const next = {
      id: existing?.id || body.id || generateId(idPrefixes.deliveries),
      type,
      status,
      transportDate,
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
      carrierKey: body.carrierKey ? String(body.carrierKey) : (existing?.carrierKey || null),
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
    };

    if (next.status === 'completed' && !next.completedAt) {
      next.completedAt = nowIso();
    }

    return next;
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
    const directory = (readData('delivery_carriers') || []).map(normalizeCarrierRecord);

    if (directory.length === 0) {
      return rawConnections.map((item) => ({
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
    }

    return directory
      .map((item) => {
        const linked = item.maxCarrierKey ? rawByKey.get(item.maxCarrierKey) : null;
        return {
          id: item.id,
          key: item.id,
          name: item.name,
          phone: item.phone || linked?.phone,
          notes: item.notes,
          status: item.status,
          maxCarrierKey: item.maxCarrierKey || null,
          maxUserName: linked?.name || null,
          email: linked?.email || undefined,
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
  }

  function resolveCarrierSelection(carrierKey) {
    const carriers = listCarrierDirectory();
    return carriers.find((item) =>
      item.key === carrierKey
      || item.id === carrierKey
      || item.maxCarrierKey === carrierKey,
    ) || null;
  }

  async function trySendToCarrier(delivery) {
    if (!delivery.carrierKey) {
      return {
        ...delivery,
        botSendError: 'Перевозчик не выбран',
      };
    }

    const carrier = resolveCarrierSelection(delivery.carrierKey);
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

    const target = botUser.replyTarget || { user_id: Number(carrier.maxCarrierKey) };
    const text = [
      delivery.type === 'shipping' ? '🚚 Новая заявка на отгрузку' : '📥 Новая заявка на приёмку',
      `Дата перевозки: ${delivery.transportDate}`,
      delivery.neededBy ? `Когда нужно: ${delivery.neededBy}` : null,
      `Маршрут: ${delivery.origin} → ${delivery.destination}`,
      `Что перевозим: ${delivery.cargo}`,
      `Клиент: ${delivery.client}`,
      `Контакт: ${delivery.contactName} · ${delivery.contactPhone}`,
      delivery.cost > 0 ? `Стоимость: ${delivery.cost.toLocaleString('ru-RU')} ₽` : null,
      delivery.comment ? `Комментарий: ${delivery.comment}` : null,
    ].filter(Boolean).join('\n');

    try {
      await sendMessage(target, text);
      return {
        ...delivery,
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

  router.get('/delivery-carriers', requireAuth, (req, res) => {
    res.json(listCarrierDirectory());
  });

  router.get('/delivery-carrier-connections', requireAuth, (req, res) => {
    res.json(listRawCarrierConnections());
  });

  router.get('/deliveries', requireAuth, (req, res) => {
    let deliveries = readData('deliveries') || [];
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

  router.get('/deliveries/:id', requireAuth, (req, res) => {
    const deliveries = readData('deliveries') || [];
    const found = deliveries.find((item) => item.id === req.params.id);
    if (!found) {
      return res.status(404).json({ ok: false, error: 'Доставка не найдена' });
    }
    return res.json(found);
  });

  router.post('/deliveries', requireAuth, requireWrite('deliveries'), async (req, res) => {
    try {
      const author = req.user.userName;
      let delivery = normalizeDeliveryPayload(req.body, null, author);
      const carrier = resolveCarrierSelection(delivery.carrierKey);
      if (carrier) {
        delivery = {
          ...delivery,
          carrierName: carrier.name,
          carrierPhone: carrier.phone,
          carrierChatId: carrier.chatId ?? null,
          carrierUserId: carrier.userId ?? null,
        };
      } else {
        delivery = {
          ...delivery,
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
      const author = req.user.userName;
      let delivery = normalizeDeliveryPayload({ ...current, ...req.body }, current, author);
      const carrier = resolveCarrierSelection(delivery.carrierKey);
      if (carrier) {
        delivery = {
          ...delivery,
          carrierName: carrier.name,
          carrierPhone: carrier.phone,
          carrierChatId: carrier.chatId ?? null,
          carrierUserId: carrier.userId ?? null,
        };
      } else {
        delivery = {
          ...delivery,
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
      deliveries[idx] = delivery;
      writeData('deliveries', deliveries);
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

      const updated = await trySendToCarrier(deliveries[idx]);
      deliveries[idx] = {
        ...updated,
        updatedAt: nowIso(),
      };
      writeData('deliveries', deliveries);
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
    deliveries.splice(idx, 1);
    writeData('deliveries', deliveries);
    return res.json({ ok: true });
  });
}

module.exports = {
  registerDeliveryRoutes,
};
