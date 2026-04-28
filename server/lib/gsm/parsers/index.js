const BASE_PARSE_RESULT = Object.freeze({
  protocol: null,
  parseStatus: 'pending',
  parseError: null,
  deviceId: null,
  imei: null,
  deviceTime: null,
  lat: null,
  lng: null,
  speed: null,
  course: null,
  satellites: null,
  gsmSignal: null,
  voltage: null,
  motoHours: null,
  alarmType: null,
  parsed: null,
  ack: null,
});

function sanitizePrintableText(value) {
  if (!value) return '';
  return String(value)
    .replace(/\r/g, '')
    .replace(/\0/g, '')
    .replace(/[^\x09\x0A\x20-\x7E\u0400-\u04FF]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, 4000);
}

function bufferToReadableText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) return null;

  let printable = 0;
  let controls = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || code >= 32) {
      printable += 1;
    } else {
      controls += 1;
    }
  }

  const total = printable + controls;
  if (total === 0 || printable / total < 0.85) return null;
  const sanitized = sanitizePrintableText(text);
  return sanitized || null;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}/.test(text)
    ? text
    : text.replace(/^(\d{2})\.(\d{2})\.(\d{4})/, '$3-$2-$1');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getField(text, aliases, valuePattern = '([^\\s;,]+)') {
  const keys = aliases.map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = text.match(new RegExp(`(?:^|[\\s;,])(?:${keys})\\s*[:=]\\s*${valuePattern}`, 'i'));
  return match?.[1] ? String(match[1]).trim() : null;
}

function parseJsonPayload(text) {
  if (!text || !(text.startsWith('{') || text.startsWith('['))) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pick(payload, aliases) {
  if (!payload || typeof payload !== 'object') return null;
  for (const alias of aliases) {
    if (payload[alias] !== undefined && payload[alias] !== null && payload[alias] !== '') {
      return payload[alias];
    }
  }
  return null;
}

function extractFromText(text) {
  const json = parseJsonPayload(text);
  const imei = String(
    pick(json, ['imei', 'IMEI'])
    || getField(text, ['imei', 'IMEI'], '(\\d{10,20})')
    || '',
  ).trim() || null;
  const deviceId = String(
    pick(json, ['deviceId', 'device_id', 'trackerId', 'tracker', 'id'])
    || getField(text, ['deviceId', 'device_id', 'trackerId', 'tracker', 'device', 'id'], '([A-Za-z0-9_.:-]{3,64})')
    || imei
    || '',
  ).trim() || null;

  const lat = parseNumber(pick(json, ['lat', 'latitude']) ?? getField(text, ['lat', 'latitude']));
  const lng = parseNumber(pick(json, ['lng', 'lon', 'longitude']) ?? getField(text, ['lng', 'lon', 'longitude']));
  const speed = parseNumber(pick(json, ['speed', 'speedKph', 'spd']) ?? getField(text, ['speed', 'speedKph', 'spd']));
  const course = parseNumber(pick(json, ['course', 'heading']) ?? getField(text, ['course', 'heading']));
  const satellites = parseNumber(pick(json, ['satellites', 'sats', 'sat']) ?? getField(text, ['satellites', 'sats', 'sat']));
  const gsmSignal = parseNumber(pick(json, ['gsmSignal', 'signal', 'rssi']) ?? getField(text, ['gsmSignal', 'signal', 'rssi']));
  const voltage = parseNumber(pick(json, ['voltage', 'batteryVoltage', 'vbat', 'battery']) ?? getField(text, ['voltage', 'batteryVoltage', 'vbat', 'battery']));
  const motoHours = parseNumber(pick(json, ['motoHours', 'hourmeter', 'engineHours', 'hours']) ?? getField(text, ['motoHours', 'hourmeter', 'engineHours', 'hours']));
  const alarmType = String(
    pick(json, ['alarmType', 'alarm'])
    || getField(text, ['alarmType', 'alarm'], '([A-Za-zА-Яа-я0-9_.:-]{2,64})')
    || '',
  ).trim() || null;
  const deviceTime = parseDate(pick(json, ['deviceTime', 'time', 'timestamp', 'datetime', 'at']) ?? getField(text, ['deviceTime', 'time', 'timestamp', 'datetime', 'at']));

  const parsed = {
    ...(json || {}),
    rawText: text,
  };

  const hasUsefulData = Boolean(
    imei || deviceId || lat !== null || lng !== null || speed !== null || voltage !== null || motoHours !== null,
  );

  return {
    protocol: null,
    parseStatus: hasUsefulData ? 'parsed' : 'pending',
    parseError: null,
    deviceId,
    imei,
    deviceTime,
    lat,
    lng,
    speed,
    course,
    satellites,
    gsmSignal,
    voltage,
    motoHours,
    alarmType,
    parsed: hasUsefulData ? parsed : null,
    ack: null,
  };
}

function parsePacket(buffer, context = {}) {
  try {
    const rawText = bufferToReadableText(buffer);
    if (!rawText) {
      return {
        ...BASE_PARSE_RESULT,
        parsed: {
          byteLength: Buffer.isBuffer(buffer) ? buffer.length : 0,
          sourceIp: context.sourceIp || null,
        },
      };
    }
    return extractFromText(rawText);
  } catch (error) {
    return {
      ...BASE_PARSE_RESULT,
      parseStatus: 'failed',
      parseError: error instanceof Error ? error.message : 'Parser failed',
    };
  }
}

module.exports = {
  BASE_PARSE_RESULT,
  bufferToReadableText,
  parsePacket,
};
