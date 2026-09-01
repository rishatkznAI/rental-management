import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  REDACTED,
  redactGsmSecretText,
  sanitizeGsmPacketForPersistence,
  sanitizeGsmRecordForRead,
  sanitizeTrustedGsmRecordForRead,
} = require('../server/lib/gsm/secret-redaction.js');

test('GSM raw JSON redaction handles string, numeric, array, and compound credential keys', () => {
  const secret = 'raw-json-secret-41';
  const redacted = JSON.parse(redactGsmSecretText(JSON.stringify({
    passwordConfigured: true,
    tokenCount: 3,
    authorizationStatus: 'approved',
    apiToken: secret,
    numericToken: 123456,
    accessToken: [secret],
  })));

  assert.equal(redacted.passwordConfigured, true);
  assert.equal(redacted.tokenCount, 3);
  assert.equal(redacted.authorizationStatus, 'approved');
  assert.equal(redacted.apiToken, REDACTED);
  assert.equal(redacted.numericToken, REDACTED);
  assert.equal(redacted.accessToken, REDACTED);
});

test('GSM secret classifier fails closed for value, material, and plaintext credential variants', () => {
  const secrets = {
    tokenValue: 'token-value-secret',
    passwordValue: 'password-value-secret',
    credentialMaterial: 'credential-material-secret',
    apiKeyValue: 'api-key-value-secret',
    secretPlaintext: 'plaintext-secret',
  };
  const safeMetadata = {
    passwordConfigured: true,
    tokenCount: 2,
    authorizationStatus: 'required',
    credentialExpiresAt: '2026-09-01T00:00:00.000Z',
    apiKeyType: 'device',
  };
  const sanitized = sanitizeGsmRecordForRead({ parsed: { ...secrets, ...safeMetadata } });

  for (const key of Object.keys(secrets)) assert.equal(sanitized.parsed[key], REDACTED, key);
  assert.deepEqual(
    Object.fromEntries(Object.keys(safeMetadata).map(key => [key, sanitized.parsed[key]])),
    safeMetadata,
  );
});

test('GSM safe credential metadata requires an exact non-secret value shape', () => {
  const secret = 'unsafe-metadata-value-fixture';
  const unsafeMetadata = {
    passwordConfigured: secret,
    tokenCount: secret,
    authorizationStatus: secret,
    authenticationType: secret,
    credentialsEnabled: secret,
    apiKeyPresent: secret,
  };
  const rawText = JSON.stringify(unsafeMetadata);
  const sanitized = {
    direct: sanitizeGsmRecordForRead(unsafeMetadata),
    packet: sanitizeGsmPacketForPersistence({
      rawText,
      rawHex: Buffer.from(rawText).toString('hex').toUpperCase(),
      parsed: unsafeMetadata,
    }),
  };
  const serialized = JSON.stringify(sanitized).toLowerCase();

  for (const key of Object.keys(unsafeMetadata)) assert.equal(sanitized.direct[key], REDACTED, key);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
});

test('GSM raw query and nested hex redaction cover credential variant suffixes', () => {
  const querySecret = 'query-material-secret';
  const hexSecret = 'hex-token-value-secret';
  const raw = redactGsmSecretText(`credentialMaterial=${querySecret}&passwordConfigured=true`);
  const hex = Buffer.from(JSON.stringify({ tokenValue: hexSecret })).toString('hex').toUpperCase();
  const sanitized = sanitizeGsmRecordForRead({ parsed: { rawPayloadHex: { chunk: hex } } });
  const serialized = JSON.stringify(sanitized).toLowerCase();

  assert.doesNotMatch(raw, new RegExp(querySecret));
  assert.match(raw, /credentialMaterial=\[REDACTED\]/);
  assert.match(raw, /passwordConfigured=true/);
  assert.doesNotMatch(serialized, new RegExp(hexSecret));
  assert.doesNotMatch(serialized, new RegExp(Buffer.from(hexSecret).toString('hex').toLowerCase()));
});

test('GSM raw text redacts embedded JSON scalars and containers inside surrounding diagnostics', () => {
  const secrets = ['numeric-secret', 'array-secret', 'object-secret', 'null-secret'];
  const embedded = [
    'prefix',
    JSON.stringify({ tokenValue: 123456, accessToken: [secrets[1]], nested: { credentialMaterial: secrets[2] }, apiKeyValue: null }),
    'suffix',
  ].join(' ');
  const redacted = redactGsmSecretText(embedded);

  assert.match(redacted, /^prefix /);
  assert.match(redacted, / suffix$/);
  assert.doesNotMatch(redacted, /123456/);
  assert.doesNotMatch(redacted, new RegExp(secrets[1]));
  assert.doesNotMatch(redacted, new RegExp(secrets[2]));
  assert.equal((redacted.match(/\[REDACTED\]/g) || []).length >= 4, true);
});

test('GSM raw text redaction handles query credentials and Basic authorization', () => {
  const secret = 'query-secret-42';
  const basic = Buffer.from(`user:${secret}`).toString('base64');
  const redacted = redactGsmSecretText(
    `GET /x?apiToken=${secret}&mode=1 Authorization: Basic ${basic}`,
  );
  assert.doesNotMatch(redacted, new RegExp(secret));
  assert.doesNotMatch(redacted, new RegExp(basic));
  assert.match(redacted, /apiToken=\[REDACTED\]/);
  assert.match(redacted, /Authorization:.*\[REDACTED\]/);
});

test('GSM redaction fails closed for secret containers after the embedded-fragment budget', () => {
  const secret = 'secret-after-fragment-limit';
  const input = `${Array.from({ length: 16 }, () => '{}').join(' ')} ${JSON.stringify({
    tokenValue: [secret],
  })}`;
  const redacted = redactGsmSecretText(input);

  assert.doesNotMatch(redacted, new RegExp(secret));
  assert.match(redacted, /tokenValue[^}]*\[REDACTED\]/);
});

test('GSM redaction fails closed for balanced malformed secret containers', () => {
  const secret = 'secret-in-malformed-container';
  const redacted = redactGsmSecretText(
    `prefix {"tokenValue":["${secret}",]} suffix`,
  );

  assert.doesNotMatch(redacted, new RegExp(secret));
  assert.match(redacted, /^prefix /);
  assert.match(redacted, / suffix$/);
});

test('GSM redaction removes the credential following authorization=Basic', () => {
  const basic = Buffer.from('device:basic-assignment-secret').toString('base64');
  const redacted = redactGsmSecretText(`authorization=Basic ${basic}&mode=1`);

  assert.doesNotMatch(redacted, new RegExp(basic));
  assert.match(redacted, /^authorization=\[REDACTED\]&mode=1$/);
});

test('GSM read sanitizer recursively redacts nested hex and hex-encoded raw payloads', () => {
  const secret = 'nested-hex-secret-43';
  const login = `#L#860000000000043;${secret}`;
  const hex = Buffer.from(login).toString('hex').toUpperCase();
  const sanitized = sanitizeGsmRecordForRead({
    parsed: {
      rawPayload: { rawHex: hex },
      rawPayloadHex: Buffer.from(JSON.stringify({ apiToken: secret })).toString('hex').toUpperCase(),
    },
    encoding: 'hex',
    payload: { raw: hex },
  });
  const serialized = JSON.stringify(sanitized).toLowerCase();
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
});

test('GSM read sanitizer propagates raw hex semantics through arrays and objects', () => {
  const arraySecret = 'array-hex-secret-44';
  const objectSecret = 'object-hex-secret-45';
  const arrayHex = Buffer.from(JSON.stringify({ password: arraySecret })).toString('hex').toUpperCase();
  const objectHex = Buffer.from(`token=${objectSecret}`).toString('hex').toUpperCase();
  const sanitized = sanitizeGsmRecordForRead({
    parsed: {
      rawPayloadHex: [arrayHex, { chunk: objectHex }],
    },
  });
  const serialized = JSON.stringify(sanitized).toLowerCase();

  for (const secret of [arraySecret, objectSecret]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
    assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
  }
  assert.match(serialized, /5245444143544544/i);
});

test('GSM quoted secret scalars consume spaces, escapes, and unterminated remainders', () => {
  const secrets = [
    'double quoted alpha beta',
    'single quoted alpha beta',
    'backtick quoted alpha beta',
    'escaped quote alpha beta',
    'unterminated alpha beta',
  ];
  const inputs = [
    `password="${secrets[0]}" mode=1`,
    `password='${secrets[1]}' mode=1`,
    `password=\`${secrets[2]}\` mode=1`,
    `password="${secrets[3].replace('quote', '\\"quote\\"')}" mode=1`,
    `password="${secrets[4]}`,
  ];

  for (const [index, input] of inputs.entries()) {
    const redacted = redactGsmSecretText(input);
    assert.doesNotMatch(redacted, new RegExp(secrets[index]), input);
    assert.match(redacted, /\[REDACTED\]/, input);
  }
});

test('GSM secret classifier covers short and common credential aliases without widening metadata', () => {
  const aliases = {
    pwd: 'pwd-secret',
    psw: 'psw-secret',
    passcode: 'passcode-secret',
    access_key: 'access-key-secret',
    privateKey: 'private-key-secret',
  };
  const metadata = {
    passcodeConfigured: true,
    accessKeyStatus: 'configured',
    privateKeyType: 'device',
  };
  const sanitized = sanitizeGsmRecordForRead({ ...aliases, ...metadata });

  for (const key of Object.keys(aliases)) assert.equal(sanitized[key], REDACTED, key);
  for (const [key, value] of Object.entries(metadata)) assert.equal(sanitized[key], value, key);
});

test('GSM secret classifier canonicalizes punctuation-obfuscated credential keys everywhere', () => {
  const aliases = [
    'pass.word',
    'pass_word',
    'pass-word',
    'pass:word',
    'pass@word',
    'pass|word',
    'pass#word',
    'pass$word',
    'pass!word',
    'pass(word)',
    'api.key',
    'api:key',
    'api@key',
    'access.key',
    'private.key',
    'api%2Ekey',
    'access%5Fkey',
    'pass%2Fword',
    'api%25252Ekey',
    'pass%25252Fword',
    'api%25255Cu002ekey',
    String.raw`api\u002ekey`,
    String.raw`api\\\\u005cu002ekey`,
    'pass/word',
    'pass\u200Bword',
    'api／key',
  ];
  const secret = 'punctuation-obfuscated-secret';
  const rawText = aliases.map(key => `${key}=${secret}`).join('&');
  const rawHex = Buffer.from(rawText).toString('hex').toUpperCase();

  const direct = sanitizeGsmRecordForRead(Object.fromEntries(aliases.map(key => [key, secret])));
  const persisted = sanitizeGsmPacketForPersistence({ rawText, rawHex, parsed: { [aliases[0]]: secret } });
  const serialized = JSON.stringify({ direct, persisted }).toLowerCase();

  for (const key of aliases) assert.equal(direct[key], REDACTED, key);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
  assert.match(serialized, /redacted/);
});

test('GSM raw text redacts credential keys beyond ordinary field-name lengths', () => {
  const secret = 'overlong-key-secret';
  const overlongKey = `${'x'.repeat(4096)}password`;
  const rawText = `${overlongKey}=${secret}`;
  const sanitized = sanitizeGsmPacketForPersistence({
    rawText,
    rawHex: Buffer.from(rawText).toString('hex').toUpperCase(),
  });
  const serialized = JSON.stringify(sanitized).toLowerCase();

  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
  assert.match(serialized, /redacted/);
});

test('GSM raw diagnostics fail closed at the sanitizer budget before the 1 MiB transport ceiling', () => {
  const secret = 'transport-budget-secret';
  const suffix = `password=${secret}`;
  const atBudget = `${'x'.repeat((64 * 1024) - suffix.length)}${suffix}`;
  const overBudget = `${'x'.repeat(64 * 1024)}${suffix}`;
  const persisted = sanitizeGsmPacketForPersistence({
    rawText: overBudget,
    rawHex: Buffer.from(overBudget).toString('hex').toUpperCase(),
  });
  const serialized = JSON.stringify(persisted).toLowerCase();

  assert.equal(atBudget.length, 64 * 1024);
  assert.doesNotMatch(redactGsmSecretText(atBudget), new RegExp(secret));
  assert.equal(redactGsmSecretText(overBudget), REDACTED);
  assert.equal(persisted.rawText, REDACTED);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
});

test('GSM raw containers fail closed across nested and malformed percent encoding', () => {
  const malformedSecret = 'MALFORMEDSECRET';
  const tripleSecret = 'TRIPLESECRET';
  const malformed = `%7B%22password%22%3A%22${malformedSecret}%ZZ`;
  const triple = `%25257B%252522password%252522%25253A%252522${tripleSecret}%252522%25257D`;
  const rawText = `raw=${malformed}&mode=1&rawPayload=${triple}`;
  const sanitized = {
    direct: sanitizeGsmRecordForRead({ raw: malformed, payload: triple }),
    persisted: sanitizeGsmPacketForPersistence({
      rawText,
      rawHex: Buffer.from(rawText).toString('hex').toUpperCase(),
      parsed: { raw: malformed, payload: triple },
    }),
  };
  const serialized = JSON.stringify(sanitized).toLowerCase();

  assert.equal(sanitized.direct.raw, REDACTED);
  assert.equal(sanitized.direct.payload, REDACTED);
  for (const secret of [malformedSecret, tripleSecret]) {
    assert.doesNotMatch(serialized, new RegExp(secret.toLowerCase()));
    assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
  }
  assert.match(serialized, /redacted/);
});

test('GSM diagnostics inspect fully percent-encoded credentials without a raw assignment wrapper', () => {
  const secret = 'fully-encoded-diagnostic-secret';
  const samples = [
    encodeURIComponent(`password=${secret}`),
    encodeURIComponent(encodeURIComponent(`api.key=${secret}`)),
    encodeURIComponent(JSON.stringify({ accessToken: secret })),
  ];
  const rawText = samples.join('|');
  const sanitized = sanitizeGsmPacketForPersistence({
    rawText,
    rawHex: Buffer.from(rawText).toString('hex').toUpperCase(),
  });
  const serialized = JSON.stringify(sanitized).toLowerCase();

  for (const sample of samples) assert.equal(redactGsmSecretText(sample), REDACTED);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
  assert.match(serialized, /redacted/);
});

test('GSM embedded-fragment scan stays bounded on adversarial malformed openers', () => {
  const malformed = '{'.repeat(32 * 1024);
  const startedAt = performance.now();
  const redacted = redactGsmSecretText(malformed);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(redacted, REDACTED);
  assert.ok(elapsedMs < 1500, `malformed GSM redaction took ${elapsedMs.toFixed(1)}ms`);
});

test('GSM text redaction recognizes safe non-key boundaries and standalone auth schemes', () => {
  const secret = 'boundary-and-auth-secret';
  const basic = Buffer.from(`device:${secret}`).toString('base64');
  const inputs = [
    `(password=${secret})`,
    `[password=${secret}]`,
    `|password=${secret}`,
    `prefix:password=${secret}`,
    `#password=${secret}`,
    `upstream Basic ${basic} failed`,
    `error: #L#123;${secret}`,
    `raw=#L#123;${secret}`,
    `[#L#123;${secret}]`,
  ];
  const rawText = inputs.join(' ');
  const sanitized = sanitizeGsmPacketForPersistence({
    rawText,
    parseError: rawText,
    rawHex: Buffer.from(rawText).toString('hex').toUpperCase(),
  });
  const serialized = JSON.stringify(sanitized).toLowerCase();

  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(basic.toLowerCase()));
  assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
});

test('GSM encoded raw and hex container aliases use normalized key classification', () => {
  const secret = 'encoded-container-alias-secret';
  const encoded = encodeURIComponent(JSON.stringify({ password: secret }));
  const secretHex = Buffer.from(`password=${secret}`).toString('hex').toUpperCase();
  const rawAliases = [
    'raw.payload',
    'raw_payload',
    'raw-payload',
    'raw%2Epayload',
    String.raw`raw\u002epayload`,
    'pay.load',
  ];
  const hexAliases = ['raw.hex', 'raw_hex', 'raw-hex', 'raw%2Ehex', 'payload.hex'];
  const rawText = [
    ...rawAliases.map(key => `${key}=${encoded}`),
    ...hexAliases.map(key => `${key}=${secretHex}`),
  ].join('&');
  const sanitized = sanitizeGsmPacketForPersistence({
    rawText,
    rawHex: Buffer.from(rawText).toString('hex').toUpperCase(),
    parsed: {
      raw: encoded,
      'ra.w': encoded,
      payload: encoded,
    },
  });
  const serialized = JSON.stringify(sanitized).toLowerCase();

  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
  assert.match(serialized, /redacted/);
});

test('trusted GSM read DTOs preserve canonical identities but still redact diagnostic identities', () => {
  const canonicalDeviceId = 'token:canonical-device-identity';
  const historicalDeviceId = 'password=historical-canonical-identity';
  const diagnosticSecret = 'diagnostic-device-secret';
  const untrustedActionSecret = 'untrusted-root-action-secret';
  const sanitized = sanitizeTrustedGsmRecordForRead({
    id: 'token:canonical-record-id',
    deviceId: canonicalDeviceId,
    trackerId: canonicalDeviceId,
    gsmImei: 'token:canonical-equipment-imei',
    equipmentId: 'api.key=canonical-equipment-id',
    actionId: `password=${untrustedActionSecret}`,
    bindingHistory: [{
      deviceId: historicalDeviceId,
      identities: [historicalDeviceId],
      raw: { deviceId: `token:${diagnosticSecret}` },
    }],
    parsed: { deviceId: `token:${diagnosticSecret}` },
    payload: { trackerId: `password=${diagnosticSecret}` },
  });

  assert.equal(sanitized.id, 'token:canonical-record-id');
  assert.equal(sanitized.deviceId, canonicalDeviceId);
  assert.equal(sanitized.trackerId, canonicalDeviceId);
  assert.equal(sanitized.gsmImei, 'token:canonical-equipment-imei');
  assert.equal(sanitized.equipmentId, 'api.key=canonical-equipment-id');
  assert.equal(sanitized.actionId, `password=${REDACTED}`);
  assert.equal(sanitized.bindingHistory[0].deviceId, historicalDeviceId);
  assert.deepEqual(sanitized.bindingHistory[0].identities, [historicalDeviceId]);
  assert.doesNotMatch(JSON.stringify(sanitized.parsed), new RegExp(diagnosticSecret));
  assert.doesNotMatch(JSON.stringify(sanitized.payload), new RegExp(diagnosticSecret));
  assert.doesNotMatch(JSON.stringify(sanitized.bindingHistory[0].raw), new RegExp(diagnosticSecret));
  assert.doesNotMatch(JSON.stringify(sanitized), new RegExp(untrustedActionSecret));
});

test('GSM redaction inspects one encoded raw-container layer with strict bounds', () => {
  const quotedSecret = 'quoted embedded secret';
  const escapedSecret = 'escaped-embedded-secret';
  const urlSecret = 'urljson-secret';
  const rawText = [
    `payload="{\\"password\\":\\"${quotedSecret}\\"}"`,
    `rawPayload={\\"apiToken\\":\\"${escapedSecret}\\"}`,
    `body=${encodeURIComponent(JSON.stringify({ access_key: urlSecret }))}`,
  ].join(' | ');
  const sanitized = sanitizeGsmRecordForRead({
    rawText,
    rawHex: Buffer.from(rawText).toString('hex').toUpperCase(),
    parsed: { rawPayload: rawText },
  });
  const serialized = JSON.stringify(sanitized).toLowerCase();

  for (const secret of [quotedSecret, escapedSecret, urlSecret]) {
    assert.doesNotMatch(serialized, new RegExp(secret.toLowerCase()));
    assert.doesNotMatch(serialized, new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
  }
  assert.match(serialized, /redacted/i);
});

test('GSM recursive sanitizer fails closed beyond its depth budget without throwing', () => {
  const secret = 'secret-beyond-redaction-depth-budget';
  const source = {};
  let cursor = source;
  for (let depth = 0; depth < 2200; depth += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  cursor.privateKey = secret;

  let sanitized;
  assert.doesNotThrow(() => {
    sanitized = sanitizeGsmRecordForRead(source);
  });
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.match(serialized, /REDACTED/);
});
