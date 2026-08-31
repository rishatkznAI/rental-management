const REDACTED = '[REDACTED]';
const MAX_REDACTION_DEPTH = 32;
const MAX_REDACTION_NODES = 4096;
const MAX_ENCODED_CONTAINER_CHARS = 64 * 1024;
const MAX_PERCENT_DECODE_PASSES = 32;
const MAX_PERCENT_DECODE_WORK = MAX_ENCODED_CONTAINER_CHARS * MAX_PERCENT_DECODE_PASSES;
const MAX_KEY_NORMALIZATION_PASSES = 256;
const MAX_KEY_NORMALIZATION_WORK = 64 * 1024;
const RAW_SECRET_KEY_CHARS = String.raw`\p{L}\p{N}\p{M}_.%/+\\\-:@|#$!?^~*()<>\u00A0\u200B-\u200D\u2044\u2060\u2215\u2024\u2027\uFEFF\uFF0E\uFF0F\uFF3F`;
const RAW_SECRET_KEY_SOURCE = `[${RAW_SECRET_KEY_CHARS}]{1,${MAX_ENCODED_CONTAINER_CHARS}}`;
const RAW_SECRET_KEY_BOUNDARY_SOURCE = `(?<![${RAW_SECRET_KEY_CHARS}])`;

// Credential containers are denied by default. Only narrowly defined metadata
// keys are safe to retain; variants such as tokenValue, passwordMaterial, or
// credentialPlaintext must not become a redaction bypass.
const SECRET_KEY_TERM_PATTERN = /(?:password|passwd|passcode|pwd|psw|secret|token|authorization|auth|api[_-]?key|access[_-]?key|private[_-]?key|credential(?:s)?)/i;
const SAFE_SECRET_METADATA_PATTERN = /^(?:[a-z0-9]*(?:password|passwd|passcode|pwd|psw|secret|token|authorization|auth|apikey|accesskey|privatekey|credential|credentials))(?:configured|count|status|expiresat|type|enabled|present|required|revision|version)$/;
const SAFE_SECRET_METADATA_KEYS = new Set([
  'authenticationmethod',
  'authenticationstatus',
  'authenticationtype',
]);
const SAFE_SECRET_STATUS_VALUES = new Set([
  'active',
  'approved',
  'configured',
  'denied',
  'disabled',
  'enabled',
  'expired',
  'failed',
  'invalid',
  'missing',
  'ok',
  'pending',
  'present',
  'required',
  'revoked',
  'unknown',
  'valid',
]);
const SAFE_SECRET_TYPE_VALUES = new Set([
  'api_key',
  'access_key',
  'basic',
  'bearer',
  'credential',
  'device',
  'http',
  'none',
  'password',
  'private_key',
  'tcp',
  'token',
  'unknown',
]);
const TRUSTED_GSM_ROOT_IDENTITY_KEYS = new Set([
  'id',
  'commandid',
  'connectionid',
  'deviceid',
  'equipmentid',
  'gsmdeviceid',
  'gsmdevicerecordid',
  'gsmimei',
  'gsmtrackerid',
  'imei',
  'packetid',
  'trackerid',
  'companyid',
  'tenantid',
]);
const TRUSTED_GSM_HISTORY_IDENTITY_KEYS = new Set([
  'deviceid',
  'equipmentid',
  'imei',
  'trackerid',
  'companyid',
  'tenantid',
  'identities',
]);

function decodeBoundedPercentLayers(value, {
  maxChars = MAX_ENCODED_CONTAINER_CHARS,
  maxPasses = MAX_PERCENT_DECODE_PASSES,
  maxWork = MAX_PERCENT_DECODE_WORK,
} = {}) {
  let decoded = String(value ?? '');
  if (decoded.length > maxChars) {
    return { decoded: decoded.slice(0, maxChars), encoded: false, unsafe: true };
  }
  let encoded = false;
  let work = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (!/%[0-9a-f]{2}/i.test(decoded)) return { decoded, encoded, unsafe: false };
    work += decoded.length;
    if (work > maxWork) return { decoded, encoded: true, unsafe: true };
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      // A value that mixes valid encoding with malformed escapes cannot be
      // proven secret-free. Callers fail closed instead of retaining it.
      return { decoded, encoded: true, unsafe: true };
    }
    encoded = true;
    if (next === decoded) return { decoded, encoded, unsafe: false };
    decoded = next;
  }
  return {
    decoded,
    encoded,
    unsafe: /%[0-9a-f]{2}/i.test(decoded),
  };
}

function normalizedKey(value) {
  let text = String(value || '');
  // Diagnostic serializers commonly escape separators in field names. Decode
  // nested layers solely for classification; the original key is retained in
  // output. Work is explicitly bounded and an ambiguous key fails closed.
  let work = 0;
  for (let pass = 0; pass < MAX_KEY_NORMALIZATION_PASSES; pass += 1) {
    work += text.length;
    if (work > MAX_KEY_NORMALIZATION_WORK) return 'credential';
    const unicodeEscaped = text.replace(/%u([0-9a-f]{4})/gi, (_match, hex) => (
      String.fromCharCode(Number.parseInt(hex, 16))
    ));
    let decoded = unicodeEscaped;
    if (/%[0-9a-f]{2}/i.test(unicodeEscaped)) {
      try {
        decoded = decodeURIComponent(unicodeEscaped);
      } catch {
        return 'credential';
      }
    }
    decoded = decodeSingleEscapeLayer(decoded).normalize('NFKC');
    if (decoded === text) break;
    text = decoded;
  }
  if (/%(?:[0-9a-f]{2}|u[0-9a-f]{4})|\\(?:u[0-9a-f]{4}|x[0-9a-f]{2})/i.test(text)) {
    return 'credential';
  }
  return text.normalize('NFKC').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isGsmSecretKey(key) {
  const raw = String(key || '');
  const normalized = normalizedKey(raw);
  // Classify the canonical key, not the attacker-controlled spelling.  Raw
  // matching lets punctuation split otherwise conventional credential names
  // (`pass.word`, `api.key`, ...), while every downstream matcher deliberately
  // accepts those separators.
  if (!normalized || !SECRET_KEY_TERM_PATTERN.test(normalized)) return false;
  if (SAFE_SECRET_METADATA_KEYS.has(normalized) || SAFE_SECRET_METADATA_PATTERN.test(normalized)) return false;
  return true;
}

function isGsmSecretMetadataKey(key) {
  const normalized = normalizedKey(key);
  return Boolean(
    normalized
    && SECRET_KEY_TERM_PATTERN.test(normalized)
    && (SAFE_SECRET_METADATA_KEYS.has(normalized) || SAFE_SECRET_METADATA_PATTERN.test(normalized)),
  );
}

function isPotentialGsmSecretKey(key) {
  const normalized = normalizedKey(key);
  return Boolean(normalized && SECRET_KEY_TERM_PATTERN.test(normalized));
}

function isSafeGsmSecretMetadataValue(key, value) {
  if (!isGsmSecretMetadataKey(key)) return false;
  const normalized = normalizedKey(key);
  if (/(?:configured|enabled|present|required)$/.test(normalized)) return typeof value === 'boolean';
  if (/(?:count|revision|version)$/.test(normalized)) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }
  if (normalized.endsWith('expiresat')) {
    return typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      && !Number.isNaN(Date.parse(value));
  }
  const normalizedValue = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : '';
  if (normalized.endsWith('status')) return SAFE_SECRET_STATUS_VALUES.has(normalizedValue);
  if (normalized.endsWith('type') || normalized.endsWith('method')) {
    return SAFE_SECRET_TYPE_VALUES.has(normalizedValue);
  }
  return false;
}

function shouldRedactGsmSecretValue(key, value, { metadataValueKnown = false } = {}) {
  if (isGsmSecretKey(key)) return true;
  return metadataValueKnown
    && isGsmSecretMetadataKey(key)
    && !isSafeGsmSecretMetadataValue(key, value);
}

function parseUnquotedMetadataScalar(value) {
  const text = String(value ?? '').trim();
  if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return Number(text);
  if (/^null$/i.test(text)) return null;
  return text;
}

function isHexFieldKey(key) {
  return ['rawhex', 'payloadhex', 'rawpayloadhex', 'datahex', 'bodyhex'].includes(normalizedKey(key));
}

function isRawPayloadKey(key) {
  return ['raw', 'payload', 'rawpayload', 'data', 'body'].includes(normalizedKey(key));
}

function isTrustedGsmIdentityPath(path = []) {
  const normalizedPath = path.map(normalizedKey);
  if (normalizedPath.length === 1) return TRUSTED_GSM_ROOT_IDENTITY_KEYS.has(normalizedPath[0]);
  return normalizedPath.length === 3
    && normalizedPath[0] === 'bindinghistory'
    && path[1] === '*'
    && TRUSTED_GSM_HISTORY_IDENTITY_KEYS.has(normalizedPath[normalizedPath.length - 1]);
}

function quotedScalarEnd(text, start, maxChars = MAX_ENCODED_CONTAINER_CHARS) {
  const quote = text[start];
  if (!['"', "'", '`'].includes(quote)) return -1;
  const maxIndex = Math.min(text.length, start + maxChars);
  let escaped = false;
  for (let index = start + 1; index < maxIndex; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === quote) return index + 1;
  }
  return -1;
}

function decodeSingleEscapeLayer(value, { withOffsets = false } = {}) {
  const text = String(value ?? '');
  let decoded = '';
  const rawEnds = [];
  const append = (character, rawEnd) => {
    decoded += character;
    if (withOffsets) rawEnds.push(rawEnd);
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '\\' || index + 1 >= text.length) {
      append(char, index + 1);
      continue;
    }
    const escaped = text[index + 1];
    const simple = {
      '"': '"',
      "'": "'",
      '`': '`',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    if (Object.prototype.hasOwnProperty.call(simple, escaped)) {
      append(simple[escaped], index + 2);
      index += 1;
      continue;
    }
    if (escaped === 'u' && /^[0-9a-f]{4}$/i.test(text.slice(index + 2, index + 6))) {
      append(String.fromCharCode(Number.parseInt(text.slice(index + 2, index + 6), 16)), index + 6);
      index += 5;
      continue;
    }
    if (escaped === 'x' && /^[0-9a-f]{2}$/i.test(text.slice(index + 2, index + 4))) {
      append(String.fromCharCode(Number.parseInt(text.slice(index + 2, index + 4), 16)), index + 4);
      index += 3;
      continue;
    }
    // Unknown escapes lose only the escaping slash, matching the single-layer
    // decoding performed by common diagnostic serializers.
    append(escaped, index + 2);
    index += 1;
  }
  return withOffsets ? { text: decoded, rawEnds } : decoded;
}

function decodeQuotedScalar(value, quote) {
  if (quote === '"') {
    try {
      return JSON.parse(value);
    } catch {
      // Malformed diagnostic strings still receive a bounded single-layer
      // inspection below.
    }
  }
  return decodeSingleEscapeLayer(value.slice(1, -1));
}

function jsonFragmentEnd(text, start, maxChars = 64 * 1024) {
  const stack = [];
  let quoted = false;
  let escaped = false;
  const maxIndex = Math.min(text.length, start + maxChars);
  for (let index = start; index < maxIndex; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack.pop() !== expected) return -1;
      if (stack.length === 0) return index + 1;
    }
  }
  return -1;
}

function redactEmbeddedJsonFragments(value) {
  const text = String(value ?? '');
  let cursor = 0;
  let result = '';
  let fragmentStart = -1;
  const stack = [];
  let quoted = false;
  let escaped = false;

  // Discover disjoint top-level fragments in one pass.  Restarting a bounded
  // structural scan at every opener makes malformed input such as "{{{{..."
  // quadratic.  Public GSM ingest can legitimately accept much larger payload
  // bounds, so malformed/oversized structures must instead fail closed in O(n).
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (fragmentStart >= 0 && index - fragmentStart >= MAX_ENCODED_CONTAINER_CHARS) return REDACTED;

    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (fragmentStart >= 0 && char === '"') {
      quoted = true;
      continue;
    }
    if (char === '{' || char === '[') {
      if (stack.length === 0) fragmentStart = index;
      stack.push(char);
      if (stack.length > MAX_REDACTION_DEPTH) return REDACTED;
      continue;
    }
    if ((char !== '}' && char !== ']') || stack.length === 0) continue;

    const expected = char === '}' ? '{' : '[';
    if (stack.pop() !== expected) return REDACTED;
    if (stack.length > 0) continue;

    const end = index + 1;
    const fragment = text.slice(fragmentStart, end);
    try {
      const parsed = JSON.parse(fragment);
      const serializedOriginal = JSON.stringify(parsed);
      const serialized = JSON.stringify(redactGsmSecretValue(parsed));
      if (serialized !== serializedOriginal) {
        result += text.slice(cursor, fragmentStart);
        result += serialized;
        cursor = end;
      }
    } catch {
      // A balanced but non-JSON fragment falls through to scalar key redaction.
    }
    fragmentStart = -1;
    quoted = false;
    escaped = false;
  }

  // An unfinished structural/quoted region cannot be proven credential-free.
  if (fragmentStart >= 0 || quoted || stack.length > 0) return REDACTED;
  return cursor > 0 ? result + text.slice(cursor) : text;
}

function redactSecretKeyQuotedScalars(value) {
  const text = String(value ?? '');
  const assignmentPattern = new RegExp(
    `(${RAW_SECRET_KEY_BOUNDARY_SOURCE})(["'\`]?)(${RAW_SECRET_KEY_SOURCE})\\2(\\s*[:=]\\s*)`,
    'giu',
  );
  let cursor = 0;
  let result = '';
  let match;
  while ((match = assignmentPattern.exec(text)) !== null) {
    if (!isPotentialGsmSecretKey(match[3])) continue;
    const valueStart = assignmentPattern.lastIndex;
    const quote = text[valueStart];
    if (!['"', "'", '`'].includes(quote)) continue;
    const end = quotedScalarEnd(text, valueStart);
    if (end < 0) {
      // An unterminated secret scalar may contain arbitrary credential data in
      // the remainder, so retain only the safe prefix.
      result += text.slice(cursor, valueStart);
      result += REDACTED;
      cursor = text.length;
      break;
    }
    const scalar = text.slice(valueStart, end);
    const decoded = decodeQuotedScalar(scalar, quote);
    if (!shouldRedactGsmSecretValue(match[3], decoded, { metadataValueKnown: true })) {
      assignmentPattern.lastIndex = end;
      continue;
    }
    result += text.slice(cursor, valueStart);
    result += `${quote}${REDACTED}${quote}`;
    cursor = end;
    assignmentPattern.lastIndex = end;
  }
  return cursor > 0 ? result + text.slice(cursor) : text;
}

function redactSecretKeyUnquotedScalars(value) {
  const text = String(value ?? '');
  const assignmentPattern = new RegExp(
    `(${RAW_SECRET_KEY_BOUNDARY_SOURCE})(${RAW_SECRET_KEY_SOURCE})(\\s*[:=]\\s*)`,
    'giu',
  );
  const scalarPattern = /^(?:(?:Basic|Bearer)\s+)?[^,"'`\[\s;}\])&#|]+/i;
  let cursor = 0;
  let result = '';
  let match;
  while ((match = assignmentPattern.exec(text)) !== null) {
    if (!isPotentialGsmSecretKey(match[2])) {
      // Retry inside a non-secret prefix such as `prefix:password=...` rather
      // than letting one broad assignment consume the nested credential key.
      assignmentPattern.lastIndex = match.index + 1;
      continue;
    }
    const valueStart = assignmentPattern.lastIndex;
    const scalar = text.slice(valueStart).match(scalarPattern)?.[0] || '';
    if (!scalar) continue;
    const end = valueStart + scalar.length;
    if (shouldRedactGsmSecretValue(match[2], parseUnquotedMetadataScalar(scalar), { metadataValueKnown: true })) {
      result += text.slice(cursor, valueStart);
      result += REDACTED;
      cursor = end;
    }
    assignmentPattern.lastIndex = end;
  }
  return cursor > 0 ? result + text.slice(cursor) : text;
}

function redactRawHexAssignments(value) {
  const text = String(value ?? '');
  const assignmentPattern = new RegExp(
    `(${RAW_SECRET_KEY_BOUNDARY_SOURCE})(${RAW_SECRET_KEY_SOURCE})(\\s*[:=]\\s*)`,
    'giu',
  );
  let cursor = 0;
  let result = '';
  let match;
  while ((match = assignmentPattern.exec(text)) !== null) {
    if (!isHexFieldKey(match[2])) {
      assignmentPattern.lastIndex = match.index + 1;
      continue;
    }
    const valueStart = assignmentPattern.lastIndex;
    const hex = text.slice(valueStart).match(/^[0-9a-f]{2,}/i)?.[0] || '';
    if (!hex) continue;
    const redactedHex = redactGsmSecretHex(hex);
    if (redactedHex !== hex) {
      result += text.slice(cursor, valueStart);
      result += redactedHex;
      cursor = valueStart + hex.length;
    }
    assignmentPattern.lastIndex = valueStart + hex.length;
  }
  return cursor > 0 ? result + text.slice(cursor) : text;
}

function parsedValueContainsSecret(value) {
  const pending = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    visited += 1;
    if (visited > MAX_REDACTION_NODES || current.depth >= MAX_REDACTION_DEPTH) return true;
    if (!current.value || typeof current.value !== 'object') continue;
    const entries = Object.entries(current.value);
    if (entries.length + visited > MAX_REDACTION_NODES) return true;
    for (const [key, item] of entries) {
      if (shouldRedactGsmSecretValue(key, item, { metadataValueKnown: true })) return true;
      if (item && typeof item === 'object') pending.push({ value: item, depth: current.depth + 1 });
      else if (typeof item === 'string' && redactGsmSecretTextInternal(item, { inspectEncodedContainers: false }) !== item) {
        return true;
      }
    }
  }
  return false;
}

function decodedPayloadContainsSecret(value) {
  const text = String(value ?? '');
  if (!text || text.length > MAX_ENCODED_CONTAINER_CHARS) return text.length > 0;
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return parsedValueContainsSecret(JSON.parse(trimmed));
    } catch {
      // Malformed JSON falls through to bounded scalar/container redaction.
    }
  }
  return redactGsmSecretTextInternal(text, { inspectEncodedContainers: false }) !== text;
}

function escapedJsonContainer(value, start) {
  const bounded = value.slice(start, start + MAX_ENCODED_CONTAINER_CHARS);
  const decoded = decodeSingleEscapeLayer(bounded, { withOffsets: true });
  const decodedEnd = jsonFragmentEnd(decoded.text, 0, MAX_ENCODED_CONTAINER_CHARS);
  if (decodedEnd < 0) return { end: -1, decoded: decoded.text };
  const rawEnd = decoded.rawEnds[decodedEnd - 1];
  return {
    end: Number.isInteger(rawEnd) ? start + rawEnd : -1,
    decoded: decoded.text.slice(0, decodedEnd),
  };
}

function redactEncodedRawPayloadAssignments(value) {
  const text = String(value ?? '');
  const assignmentPattern = new RegExp(
    `(${RAW_SECRET_KEY_BOUNDARY_SOURCE})(["'\`]?)(${RAW_SECRET_KEY_SOURCE})\\2(\\s*[:=]\\s*)`,
    'giu',
  );
  let cursor = 0;
  let result = '';
  let match;
  while ((match = assignmentPattern.exec(text)) !== null) {
    if (!isRawPayloadKey(match[3])) continue;
    const valueStart = assignmentPattern.lastIndex;
    const first = text[valueStart];
    let end = -1;
    let decoded = '';
    let replacement = REDACTED;
    let unbounded = false;
    let unsafeEncoding = false;

    if (['"', "'", '`'].includes(first)) {
      end = quotedScalarEnd(text, valueStart);
      if (end < 0) {
        unbounded = true;
        decoded = decodeSingleEscapeLayer(text.slice(valueStart + 1, valueStart + 1 + MAX_ENCODED_CONTAINER_CHARS));
      } else {
        const scalar = text.slice(valueStart, end);
        decoded = decodeQuotedScalar(scalar, first);
        replacement = `${first}${REDACTED}${first}`;
      }
    } else if (first === '{' || first === '[') {
      const container = escapedJsonContainer(text, valueStart);
      end = container.end;
      decoded = container.decoded;
      unbounded = end < 0;
    } else if (first === '%') {
      const boundedEnd = Math.min(text.length, valueStart + MAX_ENCODED_CONTAINER_CHARS);
      end = valueStart;
      while (end < boundedEnd && !/[\s&,;}\]]/.test(text[end])) end += 1;
      if (end === boundedEnd && end < text.length) unbounded = true;
      const encoded = text.slice(valueStart, end);
      const inspection = decodeBoundedPercentLayers(encoded);
      decoded = inspection.decoded;
      unsafeEncoding = inspection.unsafe;
    } else {
      continue;
    }

    const layeredInspection = decodeBoundedPercentLayers(decoded);
    decoded = layeredInspection.decoded;
    unsafeEncoding = unsafeEncoding || layeredInspection.unsafe;
    const containsSecret = decodedPayloadContainsSecret(decoded);
    if (!containsSecret && !unbounded && !unsafeEncoding) continue;

    result += text.slice(cursor, valueStart);
    result += replacement;
    if (unbounded) {
      // An unbounded encoded raw container cannot be proven secret-free.
      cursor = text.length;
      break;
    }
    cursor = end;
    assignmentPattern.lastIndex = end;
  }
  return cursor > 0 ? result + text.slice(cursor) : text;
}

function redactSecretKeyContainers(value) {
  const text = String(value ?? '');
  const containerKeyPattern = new RegExp(
    `(${RAW_SECRET_KEY_BOUNDARY_SOURCE})(["'\`]?)(${RAW_SECRET_KEY_SOURCE})\\2(\\s*[:=]\\s*)(?=[{[])`,
    'giu',
  );
  let cursor = 0;
  let result = '';
  let match;
  while ((match = containerKeyPattern.exec(text)) !== null) {
    if (!isPotentialGsmSecretKey(match[3])) continue;
    const containerStart = containerKeyPattern.lastIndex;
    const end = jsonFragmentEnd(text, containerStart);
    result += text.slice(cursor, match.index);
    result += `${match[0]}"${REDACTED}"`;
    if (end < 0) {
      // Once a secret-labelled container becomes unbounded or malformed, the
      // remainder is not safe diagnostic material: it may all be credential data.
      cursor = text.length;
      break;
    }
    cursor = end;
    containerKeyPattern.lastIndex = end;
  }
  return cursor > 0 ? result + text.slice(cursor) : text;
}

function redactGsmSecretTextInternal(value, { inspectEncodedContainers = true } = {}) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
  if (text.length > MAX_ENCODED_CONTAINER_CHARS) return REDACTED;
  if (inspectEncodedContainers && /%[0-9a-f]{2}/i.test(text)) {
    const inspection = decodeBoundedPercentLayers(text);
    if (inspection.unsafe || (
      inspection.encoded
      && decodedPayloadContainsSecret(inspection.decoded)
    )) return REDACTED;
  }
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.stringify(redactGsmSecretValue(JSON.parse(trimmed)));
    } catch {
      // Fall through to bounded text-pattern redaction for malformed payloads.
    }
  }
  const encodedRedacted = inspectEncodedContainers ? redactEncodedRawPayloadAssignments(text) : text;
  const quotedJsonStringPattern = new RegExp(
    `("(${RAW_SECRET_KEY_SOURCE})"\\s*:\\s*)("(?:\\\\.|[^"\\\\])*")`,
    'giu',
  );
  const quotedJsonScalarPattern = new RegExp(
    `("(${RAW_SECRET_KEY_SOURCE})"\\s*:\\s*)(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?|true|false|null)`,
    'giu',
  );
  const scalarRedacted = redactSecretKeyUnquotedScalars(
    redactSecretKeyQuotedScalars(redactSecretKeyContainers(redactEmbeddedJsonFragments(encodedRedacted))),
  );
  return redactRawHexAssignments(scalarRedacted)
    .replace(/(^|[^A-Za-z0-9#])(#L#[^;\r\n]{1,128};)[A-Za-z0-9._~+/=-]{1,4096}/gi, (
      _match,
      boundary,
      loginPrefix,
    ) => `${boundary}${loginPrefix}${REDACTED}`)
    .replace(quotedJsonStringPattern, (match, prefix, key, rawValue) => (
      shouldRedactGsmSecretValue(key, decodeQuotedScalar(rawValue, '"'), { metadataValueKnown: true })
        ? `${prefix}"${REDACTED}"`
        : match
    ))
    .replace(quotedJsonScalarPattern, (match, prefix, key, rawValue) => (
      shouldRedactGsmSecretValue(key, parseUnquotedMetadataScalar(rawValue), { metadataValueKnown: true })
        ? `${prefix}"${REDACTED}"`
        : match
    ))
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/(Basic\s+)[A-Za-z0-9+/_=-]{8,}/gi, `$1${REDACTED}`);
}

function redactGsmSecretText(value) {
  return redactGsmSecretTextInternal(value, { inspectEncodedContainers: true });
}

function redactGsmSecretHex(value) {
  const hex = String(value ?? '').trim();
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return value;
  if (hex.length > MAX_ENCODED_CONTAINER_CHARS * 2) {
    return Buffer.from(REDACTED, 'utf8').toString('hex').toUpperCase();
  }
  const decoded = Buffer.from(hex, 'hex').toString('utf8');
  const redacted = redactGsmSecretText(decoded);
  return redacted === decoded ? value : Buffer.from(redacted, 'utf8').toString('hex').toUpperCase();
}

function redactGsmSecretValue(value, key = '', context = {}) {
  const redactionState = context.redactionState || { remaining: MAX_REDACTION_NODES };
  const depth = Number.isInteger(context.depth) ? context.depth : 0;
  const path = Array.isArray(context.path) ? context.path : [];
  const preserveTrustedIdentity = Boolean(
    context.preserveTrustedIdentities
    && (context.trustedIdentityContainer || isTrustedGsmIdentityPath(path)),
  );
  if (depth >= MAX_REDACTION_DEPTH || redactionState.remaining <= 0) return REDACTED;
  redactionState.remaining -= 1;
  if (shouldRedactGsmSecretValue(key, value, { metadataValueKnown: true })) return REDACTED;
  const hexContainer = Boolean(context.hexContainer || isHexFieldKey(key));
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    if (preserveTrustedIdentity) return Buffer.isBuffer(value) ? Buffer.from(value) : value;
    if (isRawPayloadKey(key) && !Buffer.isBuffer(value)) {
      const inspection = decodeBoundedPercentLayers(value);
      if (inspection.unsafe) return REDACTED;
      if (inspection.encoded && decodedPayloadContainsSecret(inspection.decoded)) return REDACTED;
    }
    const redactedText = redactGsmSecretText(value);
    if (hexContainer || (context.hexEncoded && isRawPayloadKey(key))) {
      return redactGsmSecretHex(redactedText);
    }
    return redactedText;
  }
  if (Array.isArray(value)) {
    if (value.length > redactionState.remaining) return REDACTED;
    return value.map(item => redactGsmSecretValue(item, '', {
      ...context,
      depth: depth + 1,
      redactionState,
      hexContainer,
      path: [...path, '*'],
      trustedIdentityContainer: preserveTrustedIdentity,
    }));
  }
  if (!value || typeof value !== 'object') return value;
  const hexEncoded = context.hexEncoded || String(value.encoding || '').trim().toLowerCase() === 'hex';
  const entries = Object.entries(value);
  if (entries.length > redactionState.remaining) return REDACTED;
  return Object.fromEntries(
    entries.map(([childKey, item]) => [
      childKey,
      redactGsmSecretValue(item, childKey, {
        hexEncoded,
        hexContainer,
        depth: depth + 1,
        redactionState,
        path: [...path, childKey],
        preserveTrustedIdentities: context.preserveTrustedIdentities,
        trustedIdentityContainer: false,
      }),
    ]),
  );
}

function sanitizeGsmRecordForRead(record = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  return redactGsmSecretValue(record);
}

// Callers may use this only after proving that the record/binding is an
// authoritative tenant-scoped GSM entity. Canonical identifiers must round-trip
// byte-for-byte even when their legal value resembles diagnostic credential
// syntax. Raw/payload/parsed fields are not identity paths and remain redacted.
function sanitizeTrustedGsmRecordForRead(record = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  return redactGsmSecretValue(record, '', {
    preserveTrustedIdentities: true,
    path: [],
  });
}

// Packet ownership fields are canonical persistence data. They must retain the
// exact accepted device identity even when an identifier happens to look like
// a diagnostic `token=...` fragment. Only untrusted/raw diagnostic containers
// are redacted before persistence; the complete DTO is sanitized again on read.
function sanitizeGsmPacketForPersistence(record = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const next = { ...record };
  for (const field of ['rawText', 'payload', 'parseError', 'summary', 'protocol', 'alarmType']) {
    if (!Object.prototype.hasOwnProperty.call(next, field)) continue;
    next[field] = redactGsmSecretValue(next[field], field);
  }
  for (const field of ['rawHex', 'payloadHex']) {
    if (!Object.prototype.hasOwnProperty.call(next, field)) continue;
    next[field] = redactGsmSecretValue(next[field], field, { hexContainer: true });
  }
  for (const field of ['parsed', 'parsedPayload']) {
    if (!Object.prototype.hasOwnProperty.call(next, field)) continue;
    next[field] = redactGsmSecretValue(next[field], field);
  }
  return next;
}

module.exports = {
  REDACTED,
  isGsmSecretKey,
  quotedScalarEnd,
  redactEmbeddedJsonFragments,
  redactEncodedRawPayloadAssignments,
  redactSecretKeyQuotedScalars,
  redactSecretKeyContainers,
  redactGsmSecretHex,
  redactGsmSecretText,
  redactGsmSecretValue,
  sanitizeGsmPacketForPersistence,
  sanitizeGsmRecordForRead,
  sanitizeTrustedGsmRecordForRead,
};
