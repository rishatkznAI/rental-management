import {
  GSM_ONLINE_WINDOW_MS,
  isGsmTimestampWithinWindow,
} from './gsmSignalState.js';

function hasFreshTimestamp(value, nowMs, onlineWindowMs) {
  return isGsmTimestampWithinWindow(value, {
    nowMs,
    windowMs: onlineWindowMs,
  });
}

export function deriveGsmGatewayOperationalState(
  status = {},
  recentPackets = [],
  devices = [],
  { nowMs = Date.now(), onlineWindowMs = GSM_ONLINE_WINDOW_MS } = {},
) {
  if (status.startError) {
    return {
      label: 'Ошибка подключения',
      badge: 'danger',
      hint: status.startError,
    };
  }
  if (status.disabled || status.gatewayEnabled === false) {
    return {
      label: 'Отключено',
      badge: 'default',
      hint: 'GSM TCP-шлюзы выключены в настройках или не запущены.',
    };
  }

  const hasFreshPacket = hasFreshTimestamp(status.lastPacketAt, nowMs, onlineWindowMs)
    || recentPackets.some(packet => (
      packet?.direction !== 'outbound'
      && packet?.bindingVerified === true
      && hasFreshTimestamp(packet?.receivedAt || packet?.createdAt, nowMs, onlineWindowMs)
    ))
    || devices.some(device => hasFreshTimestamp(
      device?.lastPacketAt || device?.lastSeenAt || device?.lastOnlineAt,
      nowMs,
      onlineWindowMs,
    ));
  if (hasFreshPacket) {
    return {
      label: 'Подключено',
      badge: 'success',
      hint: 'Свежие пакеты поступают и сохраняются в журнале.',
    };
  }

  if (Number(status.connectionsActive) > 0 || Number(status.onlineConnections) > 0) {
    return {
      label: 'Ожидает пакеты',
      badge: 'warning',
      hint: 'Соединение есть, но свежих пакетов ещё нет.',
    };
  }

  const hasHistory = recentPackets.length > 0
    || devices.length > 0
    || Number(status.packetsToday) > 0
    || Number(status.packetsReceivedTotal) > 0
    || Boolean(status.lastPacketAt);
  if (hasHistory) {
    return {
      label: 'Нет свежих данных',
      badge: 'warning',
      hint: 'Сохранённые GSM-данные устарели; текущая связь с трекерами не подтверждена.',
    };
  }

  return {
    label: 'Нет данных',
    badge: 'default',
    hint: 'Карта и телеметрия будут отображаться после подключения трекеров.',
  };
}
