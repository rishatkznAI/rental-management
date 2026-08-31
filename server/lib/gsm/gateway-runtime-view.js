function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function latestNonFutureTimestamp(values, nowMs = Date.now()) {
  return values
    .map(value => ({ value, time: Date.parse(String(value || '')) }))
    .filter(item => Number.isFinite(item.time) && item.time <= nowMs)
    .sort((left, right) => right.time - left.time)[0]?.value || null;
}

function earliestNonFutureTimestamp(values, nowMs = Date.now()) {
  return values
    .map(value => ({ value, time: Date.parse(String(value || '')) }))
    .filter(item => Number.isFinite(item.time) && item.time <= nowMs)
    .sort((left, right) => left.time - right.time)[0]?.value || null;
}

function stableOnlineDeviceKey(connection = {}) {
  const values = [
    connection.gsmDeviceRecordId,
    connection.imei,
    connection.deviceId,
    connection.trackerId,
    connection.equipmentId,
  ];
  const value = values.map(item => String(item || '').trim()).find(Boolean);
  return value || null;
}

function aggregateGsmGatewayStatus(runtimeStatuses = [], nowMs = Date.now(), runtimeConnections = []) {
  const statuses = asArray(runtimeStatuses)
    .filter(item => item?.status && typeof item.status === 'object')
    .map(item => ({ key: item.key || 'gsm', ...item.status }));
  if (statuses.length === 0) return {};
  const primary = statuses[0];
  const healthyStatuses = statuses.filter(status => (
    Boolean(status.gatewayEnabled || status.enabled) && !String(status.startError || '').trim()
  ));
  const active = healthyStatuses[0]
    || statuses.find(status => status.gatewayEnabled || status.enabled)
    || primary;
  const runtimeErrors = statuses
    .map(status => ({ runtime: status.key, error: String(status.startError || '').trim() }))
    .filter(item => item.error);
  const fatalStartError = healthyStatuses.length === 0
    ? [...new Set(runtimeErrors.map(item => item.error))].join(' | ')
    : '';
  const connections = asArray(runtimeConnections)
    .flatMap(runtime => asArray(runtime?.connections));
  const uniqueOnlineDevices = new Set(connections
    .filter(connection => connection?.isOnline !== false && !connection?.closedAt)
    .map(stableOnlineDeviceKey)
    .filter(Boolean));
  const runtimeOnlineFallback = Math.max(...statuses.map(status => finiteNumber(status.onlineDevices)), 0);

  return {
    ...primary,
    gatewayEnabled: statuses.some(status => Boolean(status.gatewayEnabled || status.enabled)),
    enabled: statuses.some(status => Boolean(status.gatewayEnabled || status.enabled)),
    disabled: statuses.every(status => status.disabled === true),
    host: active.host || primary.host,
    port: finiteNumber(active.port || active.tcpPort, finiteNumber(primary.port || primary.tcpPort)),
    tcpPort: finiteNumber(active.tcpPort || active.port, finiteNumber(primary.tcpPort || primary.port)),
    startedAt: earliestNonFutureTimestamp(statuses.map(status => status.startedAt), nowMs),
    startError: fatalStartError,
    partialDegradation: healthyStatuses.length > 0 && runtimeErrors.length > 0,
    runtimeErrors,
    uptimeSeconds: Math.max(...statuses.map(status => finiteNumber(status.uptimeSeconds)), 0),
    connectionsActive: statuses.reduce(
      (sum, status) => sum + finiteNumber(status.connectionsActive ?? status.onlineConnections),
      0,
    ),
    onlineConnections: statuses.reduce((sum, status) => sum + finiteNumber(status.onlineConnections), 0),
    onlineDevices: connections.length > 0 ? uniqueOnlineDevices.size : runtimeOnlineFallback,
    packetsReceivedTotal: Math.max(...statuses.map(status => finiteNumber(status.packetsReceivedTotal)), 0),
    packetsStored: Math.max(...statuses.map(status => finiteNumber(status.packetsStored)), 0),
    packetsToday: Math.max(...statuses.map(status => finiteNumber(status.packetsToday)), 0),
    queuedCommands: Math.max(...statuses.map(status => finiteNumber(status.queuedCommands)), 0),
    sentToday: Math.max(...statuses.map(status => finiteNumber(status.sentToday)), 0),
    failedCommands: Math.max(...statuses.map(status => finiteNumber(status.failedCommands)), 0),
    lastPacketAt: latestNonFutureTimestamp(statuses.map(status => status.lastPacketAt), nowMs),
    runtimes: statuses,
    activeRuntimes: healthyStatuses,
  };
}

function aggregateGsmGatewayConnections(runtimeConnections = []) {
  return asArray(runtimeConnections)
    .flatMap(runtime => asArray(runtime?.connections).map(connection => ({
      ...connection,
      id: `${runtime.key || 'gsm'}:${connection.id}`,
      runtime: runtime.key || 'gsm',
    })))
    .sort((left, right) => Date.parse(right.lastSeenAt || '') - Date.parse(left.lastSeenAt || ''));
}

module.exports = {
  aggregateGsmGatewayConnections,
  aggregateGsmGatewayStatus,
};
