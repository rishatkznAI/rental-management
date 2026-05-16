const BASE_WIALON_RESULT = Object.freeze({
  protocol: 'wialon-ips',
  parseStatus: 'pending',
  parseError: null,
  packetType: 'unknown',
  imei: null,
  deviceId: null,
  deviceTime: null,
  recordTime: null,
  lat: null,
  lng: null,
  latitude: null,
  longitude: null,
  speed: null,
  course: null,
  satellites: null,
  altitude: null,
  hdop: null,
  voltage: null,
  BoardVoltage: null,
  ignition: null,
  iobits0: null,
  iobits1: null,
  param1: null,
  param9: null,
  param12: null,
  hasValidLocation: false,
  parsed: null,
  ack: null,
});

function toText(value) {
  return String(value || '').trim();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().replace(',', '.');
  if (!normalized || normalized.toUpperCase() === 'NA') return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDateTime(dateValue, timeValue) {
  const dateText = toText(dateValue);
  const timeText = toText(timeValue);
  if (!dateText || !timeText || dateText.toUpperCase() === 'NA' || timeText.toUpperCase() === 'NA') return null;

  let year;
  let month;
  let day;
  if (/^\d{6}$/.test(dateText)) {
    day = Number(dateText.slice(0, 2));
    month = Number(dateText.slice(2, 4));
    year = 2000 + Number(dateText.slice(4, 6));
  } else if (/^\d{8}$/.test(dateText)) {
    day = Number(dateText.slice(0, 2));
    month = Number(dateText.slice(2, 4));
    year = Number(dateText.slice(4, 8));
  } else {
    const parsed = new Date(`${dateText}T${timeText}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const match = timeText.match(/^(\d{2})(\d{2})(\d{2})(?:\.(\d+))?$/);
  if (!match) return null;
  const [, hh, mm, ss, fraction = ''] = match;
  const millis = Number((fraction + '000').slice(0, 3)) || 0;
  const date = new Date(Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss), millis));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseCoordinate(value, hemisphere) {
  const numeric = parseNumber(value);
  if (numeric === null) return null;
  const side = toText(hemisphere).toUpperCase();
  let degrees;
  if (Math.abs(numeric) > 180) {
    const whole = Math.floor(Math.abs(numeric) / 100);
    const minutes = Math.abs(numeric) - whole * 100;
    degrees = whole + minutes / 60;
    if (numeric < 0) degrees *= -1;
  } else {
    degrees = numeric;
  }
  if (side === 'S' || side === 'W') degrees = -Math.abs(degrees);
  if (side === 'N' || side === 'E') degrees = Math.abs(degrees);
  return Number.isFinite(degrees) ? degrees : null;
}

function parseParams(rawParams) {
  const params = {};
  const text = toText(rawParams);
  if (!text || text.toUpperCase() === 'NA') return params;

  for (const part of text.split(',')) {
    const item = part.trim();
    if (!item) continue;
    const pieces = item.split(':');
    if (pieces.length >= 3) {
      params[pieces[0]] = pieces.slice(2).join(':');
    } else if (pieces.length === 2) {
      params[pieces[0]] = pieces[1];
    }
  }
  return params;
}

function pickParam(params, names) {
  for (const name of names) {
    if (params[name] !== undefined && params[name] !== null && params[name] !== '') return params[name];
  }
  return null;
}

function parseIoBits(value) {
  const numeric = parseNumber(value);
  if (numeric === null) return { iobits0: null, iobits1: null, ignition: null };
  return {
    iobits0: numeric & 1,
    iobits1: (numeric >> 1) & 1,
    ignition: Boolean(numeric & 1),
  };
}

function ackFor(type, count = 1) {
  if (type === 'login') return Buffer.from('#AL#1\r\n');
  if (type === 'ping') return Buffer.from('#AP#\r\n');
  if (type === 'short-data') return Buffer.from('#ASD#1\r\n');
  if (type === 'extended-data') return Buffer.from('#AD#1\r\n');
  if (type === 'blackbox') return Buffer.from(`#AB#${Math.max(1, Number(count) || 1)}\r\n`);
  return Buffer.from('#NAK#\r\n');
}

function withBase(result) {
  const lat = result.lat ?? result.latitude ?? null;
  const lng = result.lng ?? result.longitude ?? null;
  const hasValidLocation = lat !== null
    && lng !== null
    && lat !== 0
    && lng !== 0
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180;
  return {
    ...BASE_WIALON_RESULT,
    ...result,
    lat,
    lng,
    latitude: lat,
    longitude: lng,
    deviceId: result.deviceId || result.imei || null,
    deviceTime: result.deviceTime || result.recordTime || null,
    recordTime: result.recordTime || result.deviceTime || null,
    hasValidLocation,
    parseStatus: result.parseStatus || 'parsed',
  };
}

function parseLogin(payload) {
  const [imei, password] = payload.split(';');
  return withBase({
    packetType: 'login',
    imei: toText(imei) || null,
    parsed: { passwordConfigured: Boolean(toText(password)) },
    ack: ackFor('login'),
  });
}

function parsePing() {
  return withBase({
    packetType: 'ping',
    parseStatus: 'parsed',
    parsed: {},
    ack: ackFor('ping'),
  });
}

function parseData(payload, packetType) {
  const fields = payload.split(';');
  const [
    date,
    time,
    latRaw,
    latHemisphere,
    lngRaw,
    lngHemisphere,
    speedRaw,
    courseRaw,
    altitudeRaw,
    satellitesRaw,
    hdopRaw,
    inputsRaw,
    outputsRaw,
    adcRaw,
    iButtonRaw,
    paramsRaw,
  ] = fields;
  const params = parseParams(fields.slice(15).join(';') || paramsRaw);
  const io = parseIoBits(inputsRaw ?? pickParam(params, ['iobits', 'io', 'inputs']));
  const boardVoltage = parseNumber(pickParam(params, ['BoardVoltage', 'boardVoltage', 'batteryVoltage', 'Voltage', 'voltage'])) ?? parseNumber(adcRaw);
  const param1 = pickParam(params, ['param1', 'Param1', '1']);
  const param9 = pickParam(params, ['param9', 'Param9', '9']);
  const param12 = pickParam(params, ['param12', 'Param12', '12']);
  const recordTime = parseDateTime(date, time);
  const lat = parseCoordinate(latRaw, latHemisphere);
  const lng = parseCoordinate(lngRaw, lngHemisphere);

  return withBase({
    packetType,
    recordTime,
    deviceTime: recordTime,
    lat,
    lng,
    speed: parseNumber(speedRaw),
    course: parseNumber(courseRaw),
    altitude: parseNumber(altitudeRaw),
    satellites: parseNumber(satellitesRaw),
    hdop: parseNumber(hdopRaw),
    voltage: boardVoltage,
    BoardVoltage: boardVoltage,
    iobits0: io.iobits0,
    iobits1: io.iobits1,
    ignition: io.ignition,
    param1,
    param9,
    param12,
    parsed: {
      date,
      time,
      rawFields: fields,
      outputs: outputsRaw ?? null,
      adc: adcRaw ?? null,
      iButton: iButtonRaw ?? null,
      params,
    },
    ack: ackFor(packetType),
  });
}

function parseBlackbox(payload) {
  const records = payload ? payload.split('|').filter(Boolean) : [];
  return withBase({
    packetType: 'blackbox',
    parseStatus: 'pending',
    parsed: { raw: payload, recordsCount: records.length },
    ack: ackFor('blackbox', records.length || 1),
  });
}

function parseWialonIpsPacket(input) {
  const raw = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const text = raw.replace(/\r?\n$/, '').trim();
  try {
    if (text.startsWith('#L#')) return parseLogin(text.slice(3));
    if (text === '#P#') return parsePing();
    if (text.startsWith('#SD#')) return parseData(text.slice(4), 'short-data');
    if (text.startsWith('#D#')) return parseData(text.slice(3), 'extended-data');
    if (text.startsWith('#B#')) return parseBlackbox(text.slice(3));
    return withBase({
      parseStatus: 'failed',
      parseError: 'Unsupported WIALON IPS packet',
      parsed: { raw: text },
      ack: ackFor('unknown'),
    });
  } catch (error) {
    return withBase({
      parseStatus: 'failed',
      parseError: error instanceof Error ? error.message : 'WIALON IPS parser failed',
      parsed: { raw: text },
      ack: ackFor('unknown'),
    });
  }
}

module.exports = {
  BASE_WIALON_RESULT,
  parseWialonIpsPacket,
};
