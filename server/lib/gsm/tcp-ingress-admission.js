const WINDOW_MS = 60_000;

function boundedPositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), min), max);
}

const DEFAULT_MAX_CONNECTIONS = boundedPositiveInteger(
  process.env.GSM_TCP_MAX_CONNECTIONS,
  200,
  { max: 100_000 },
);
const DEFAULT_MAX_CONNECTIONS_PER_IP = boundedPositiveInteger(
  process.env.GSM_TCP_MAX_CONNECTIONS_PER_IP,
  40,
  { max: 10_000 },
);
const DEFAULT_MAX_AUTH_ATTEMPTS_PER_MINUTE = boundedPositiveInteger(
  process.env.GSM_TCP_MAX_AUTH_ATTEMPTS_PER_MINUTE,
  120,
  { max: 100_000 },
);
const DEFAULT_MAX_AUTH_ATTEMPTS_PER_IP_PER_MINUTE = boundedPositiveInteger(
  process.env.GSM_TCP_MAX_AUTH_ATTEMPTS_PER_IP_PER_MINUTE,
  30,
  { max: 10_000 },
);
const DEFAULT_MAX_PACKETS_PER_MINUTE = boundedPositiveInteger(
  process.env.GSM_TCP_MAX_PACKETS_PER_MINUTE_GLOBAL,
  10_000,
  { max: 1_000_000 },
);
const DEFAULT_MAX_PACKETS_PER_IP_PER_MINUTE = boundedPositiveInteger(
  process.env.GSM_TCP_MAX_PACKETS_PER_IP_PER_MINUTE,
  1_000,
  { max: 100_000 },
);
const DEFAULT_MAX_BYTES_PER_MINUTE = boundedPositiveInteger(
  process.env.GSM_TCP_MAX_BYTES_PER_MINUTE_GLOBAL,
  64 * 1024 * 1024,
  { max: 1024 * 1024 * 1024 },
);
const DEFAULT_MAX_BYTES_PER_IP_PER_MINUTE = boundedPositiveInteger(
  process.env.GSM_TCP_MAX_BYTES_PER_IP_PER_MINUTE,
  8 * 1024 * 1024,
  { max: 256 * 1024 * 1024 },
);
const DEFAULT_PREAUTH_TIMEOUT_MS = boundedPositiveInteger(
  process.env.GSM_TCP_PREAUTH_TIMEOUT_MS,
  15_000,
  { min: 100, max: 10 * 60_000 },
);

function createWindow(nowMs) {
  return { startedAt: nowMs, count: 0, bytes: 0 };
}

function createTcpIngressAdmissionController({
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  maxConnectionsPerIp = DEFAULT_MAX_CONNECTIONS_PER_IP,
  maxAuthAttemptsPerMinute = DEFAULT_MAX_AUTH_ATTEMPTS_PER_MINUTE,
  maxAuthAttemptsPerIpPerMinute = DEFAULT_MAX_AUTH_ATTEMPTS_PER_IP_PER_MINUTE,
  maxPacketsPerMinute = DEFAULT_MAX_PACKETS_PER_MINUTE,
  maxPacketsPerIpPerMinute = DEFAULT_MAX_PACKETS_PER_IP_PER_MINUTE,
  maxBytesPerMinute = DEFAULT_MAX_BYTES_PER_MINUTE,
  maxBytesPerIpPerMinute = DEFAULT_MAX_BYTES_PER_IP_PER_MINUTE,
  preAuthTimeoutMs = DEFAULT_PREAUTH_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  const limits = Object.freeze({
    maxConnections: boundedPositiveInteger(maxConnections, DEFAULT_MAX_CONNECTIONS, { max: 100_000 }),
    maxConnectionsPerIp: boundedPositiveInteger(maxConnectionsPerIp, DEFAULT_MAX_CONNECTIONS_PER_IP, { max: 10_000 }),
    maxAuthAttemptsPerMinute: boundedPositiveInteger(
      maxAuthAttemptsPerMinute,
      DEFAULT_MAX_AUTH_ATTEMPTS_PER_MINUTE,
      { max: 100_000 },
    ),
    maxAuthAttemptsPerIpPerMinute: boundedPositiveInteger(
      maxAuthAttemptsPerIpPerMinute,
      DEFAULT_MAX_AUTH_ATTEMPTS_PER_IP_PER_MINUTE,
      { max: 10_000 },
    ),
    maxPacketsPerMinute: boundedPositiveInteger(
      maxPacketsPerMinute,
      DEFAULT_MAX_PACKETS_PER_MINUTE,
      { max: 1_000_000 },
    ),
    maxPacketsPerIpPerMinute: boundedPositiveInteger(
      maxPacketsPerIpPerMinute,
      DEFAULT_MAX_PACKETS_PER_IP_PER_MINUTE,
      { max: 100_000 },
    ),
    maxBytesPerMinute: boundedPositiveInteger(
      maxBytesPerMinute,
      DEFAULT_MAX_BYTES_PER_MINUTE,
      { max: 1024 * 1024 * 1024 },
    ),
    maxBytesPerIpPerMinute: boundedPositiveInteger(
      maxBytesPerIpPerMinute,
      DEFAULT_MAX_BYTES_PER_IP_PER_MINUTE,
      { max: 256 * 1024 * 1024 },
    ),
    preAuthTimeoutMs: boundedPositiveInteger(preAuthTimeoutMs, DEFAULT_PREAUTH_TIMEOUT_MS, {
      min: 100,
      max: 10 * 60_000,
    }),
  });
  const connectionsByIp = new Map();
  const authWindowsByIp = new Map();
  const telemetryWindowsByIp = new Map();
  let activeConnections = 0;
  let globalAuthWindow = createWindow(now());
  let globalTelemetryWindow = createWindow(now());
  let rejectedConnections = 0;
  let rejectedAuthAttempts = 0;
  let rejectedTelemetryPackets = 0;

  function normalizedIp(value) {
    return String(value || 'unknown').trim() || 'unknown';
  }

  function refreshWindow(window, observedAt) {
    return !window || observedAt - window.startedAt >= WINDOW_MS || observedAt < window.startedAt
      ? createWindow(observedAt)
      : window;
  }

  function refreshGlobalWindowAndPrune(globalWindow, windowsByIp, observedAt) {
    const refreshed = refreshWindow(globalWindow, observedAt);
    if (refreshed !== globalWindow) {
      for (const [ip, window] of windowsByIp.entries()) {
        if (refreshWindow(window, observedAt) !== window) windowsByIp.delete(ip);
      }
    }
    return refreshed;
  }

  function admitConnection(sourceIp) {
    const ip = normalizedIp(sourceIp);
    const ipConnections = connectionsByIp.get(ip) || 0;
    if (activeConnections >= limits.maxConnections) {
      rejectedConnections += 1;
      return { ok: false, code: 'GSM_TCP_GLOBAL_CONNECTION_LIMIT' };
    }
    if (ipConnections >= limits.maxConnectionsPerIp) {
      rejectedConnections += 1;
      return { ok: false, code: 'GSM_TCP_IP_CONNECTION_LIMIT' };
    }
    activeConnections += 1;
    connectionsByIp.set(ip, ipConnections + 1);
    let released = false;
    return {
      ok: true,
      release() {
        if (released) return;
        released = true;
        activeConnections = Math.max(0, activeConnections - 1);
        const current = connectionsByIp.get(ip) || 0;
        if (current <= 1) connectionsByIp.delete(ip);
        else connectionsByIp.set(ip, current - 1);
      },
    };
  }

  function consumeAuthAttempt(sourceIp) {
    const observedAt = now();
    const ip = normalizedIp(sourceIp);
    globalAuthWindow = refreshGlobalWindowAndPrune(
      globalAuthWindow,
      authWindowsByIp,
      observedAt,
    );
    if (globalAuthWindow.count >= limits.maxAuthAttemptsPerMinute) {
      rejectedAuthAttempts += 1;
      return { ok: false, code: 'GSM_TCP_GLOBAL_AUTH_RATE_LIMIT' };
    }
    const ipWindow = refreshWindow(authWindowsByIp.get(ip), observedAt);
    if (ipWindow.count >= limits.maxAuthAttemptsPerIpPerMinute) {
      rejectedAuthAttempts += 1;
      return { ok: false, code: 'GSM_TCP_IP_AUTH_RATE_LIMIT' };
    }
    authWindowsByIp.set(ip, ipWindow);
    globalAuthWindow.count += 1;
    ipWindow.count += 1;
    return { ok: true };
  }

  function consumeTelemetry(sourceIp, { packetCount = 1, byteLength = 0 } = {}) {
    const observedAt = now();
    const ip = normalizedIp(sourceIp);
    const packets = Number(packetCount);
    const bytes = Number(byteLength);
    if (
      !Number.isSafeInteger(packets)
      || packets <= 0
      || !Number.isSafeInteger(bytes)
      || bytes < 0
    ) {
      rejectedTelemetryPackets += 1;
      return { ok: false, code: 'GSM_TCP_TRAFFIC_OBSERVATION_INVALID' };
    }
    globalTelemetryWindow = refreshGlobalWindowAndPrune(
      globalTelemetryWindow,
      telemetryWindowsByIp,
      observedAt,
    );
    if (globalTelemetryWindow.count + packets > limits.maxPacketsPerMinute) {
      rejectedTelemetryPackets += packets;
      return { ok: false, code: 'GSM_TCP_GLOBAL_PACKET_RATE_LIMIT' };
    }
    if (globalTelemetryWindow.bytes + bytes > limits.maxBytesPerMinute) {
      rejectedTelemetryPackets += packets;
      return { ok: false, code: 'GSM_TCP_GLOBAL_BYTE_RATE_LIMIT' };
    }
    const ipWindow = refreshWindow(telemetryWindowsByIp.get(ip), observedAt);
    if (ipWindow.count + packets > limits.maxPacketsPerIpPerMinute) {
      rejectedTelemetryPackets += packets;
      return { ok: false, code: 'GSM_TCP_IP_PACKET_RATE_LIMIT' };
    }
    if (ipWindow.bytes + bytes > limits.maxBytesPerIpPerMinute) {
      rejectedTelemetryPackets += packets;
      return { ok: false, code: 'GSM_TCP_IP_BYTE_RATE_LIMIT' };
    }
    telemetryWindowsByIp.set(ip, ipWindow);
    globalTelemetryWindow.count += packets;
    globalTelemetryWindow.bytes += bytes;
    ipWindow.count += packets;
    ipWindow.bytes += bytes;
    return { ok: true };
  }

  function getStatus() {
    return {
      activeConnections,
      activeSourceIps: connectionsByIp.size,
      rejectedConnections,
      rejectedAuthAttempts,
      rejectedTelemetryPackets,
      trackedAuthSourceIps: authWindowsByIp.size,
      trackedTelemetrySourceIps: telemetryWindowsByIp.size,
      limits: { ...limits },
    };
  }

  return {
    limits,
    admitConnection,
    consumeAuthAttempt,
    consumeTelemetry,
    getStatus,
  };
}

module.exports = {
  DEFAULT_MAX_AUTH_ATTEMPTS_PER_IP_PER_MINUTE,
  DEFAULT_MAX_AUTH_ATTEMPTS_PER_MINUTE,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_MAX_CONNECTIONS_PER_IP,
  DEFAULT_MAX_BYTES_PER_IP_PER_MINUTE,
  DEFAULT_MAX_BYTES_PER_MINUTE,
  DEFAULT_MAX_PACKETS_PER_IP_PER_MINUTE,
  DEFAULT_MAX_PACKETS_PER_MINUTE,
  DEFAULT_PREAUTH_TIMEOUT_MS,
  boundedPositiveInteger,
  createTcpIngressAdmissionController,
};
