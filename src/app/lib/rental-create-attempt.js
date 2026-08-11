const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const storageTokenForFingerprint = (scope, fingerprint) => {
  let left = 0x9e3779b9;
  let right = 0x85ebca6b;
  for (let index = 0; index < fingerprint.length; index += 1) {
    const code = fingerprint.charCodeAt(index);
    left = Math.imul(left ^ code, 0x85ebca6b);
    right = Math.imul(right ^ code, 0xc2b2ae35);
  }
  return `rental-mutation-attempt:${scope}:${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`;
};

const browserSessionStorage = () => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
};

const readPersistedKey = (storage, storageToken) => {
  try {
    return String(storage?.getItem(storageToken) || '').trim();
  } catch {
    return '';
  }
};

const persistKey = (storage, storageToken, key) => {
  try {
    storage?.setItem(storageToken, key);
  } catch {
    // In-memory ownership still protects retries while the form remains mounted.
  }
};

const removePersistedKey = (storage, storageToken) => {
  try {
    storage?.removeItem(storageToken);
  } catch {
    // The confirmed result is already safe; stale session data only causes a replay.
  }
};

export const idempotencyKeyForAttempt = (
  scope,
  payload,
  attempts,
  options = {},
) => {
  const fingerprint = stableJson(payload);
  const previous = attempts.get(fingerprint);
  if (previous) return previous;

  const storage = options.persist ? (options.storage ?? browserSessionStorage()) : null;
  const storageToken = storageTokenForFingerprint(scope, fingerprint);
  const persistedKey = readPersistedKey(storage, storageToken);
  const randomPart = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const attempt = {
    fingerprint,
    key: persistedKey || `${scope}:${randomPart}`,
    storageToken,
  };
  attempts.set(fingerprint, attempt);
  if (options.persist && !persistedKey) persistKey(storage, storageToken, attempt.key);
  return attempt;
};

export const forgetIdempotentAttempt = (attempt, attempts, options = {}) => {
  attempts.delete(attempt.fingerprint);
  if (!options.persist) return;
  const storage = options.storage ?? browserSessionStorage();
  removePersistedKey(storage, attempt.storageToken);
};

export const isUnknownMutationOutcome = (error) => {
  const status = Number(error?.status);
  return !Number.isInteger(status) || [408, 425, 502, 503, 504].includes(status);
};
