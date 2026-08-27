export const PRE_COMPATIBILITY_BACKUP_ONLY_MODE = 'pre-compatibility-backup-only';

export const BACKUP_ONLY_LOGIN_SENTINEL = Object.freeze({
  email: 'backup-only-smoke@example.invalid',
  password: 'backup-only-route-must-not-exist',
});

export const BACKUP_ONLY_LOGIN_SECURITY_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactNonblankString(value, label) {
  invariant(typeof value === 'string' && value.length > 0 && value === value.trim(), `${label} must be an exact nonblank string`);
  return value;
}

function canonicalIsoTimestamp(value, label) {
  const timestamp = exactNonblankString(value, label);
  let canonical;
  try {
    canonical = new Date(timestamp).toISOString();
  } catch {
    throw new Error(`${label} must be an exact ISO timestamp`);
  }
  invariant(canonical === timestamp, `${label} must be an exact ISO timestamp`);
  return timestamp;
}

function backupOnlyBuildIdentity(payload, label) {
  invariant(payload?.mode === PRE_COMPATIBILITY_BACKUP_ONLY_MODE, `${label} must expose the exact backup-only mode`);
  invariant(payload?.ok === true, `${label} must include ok=true`);
  const build = payload?.build;
  invariant(build && typeof build === 'object' && !Array.isArray(build), `${label} must expose build identity`);
  const commitFull = exactNonblankString(build.commitFull, `${label} build commitFull`);
  invariant(/^[a-f0-9]{40}$/.test(commitFull), `${label} build commitFull must be an exact lowercase Git SHA`);
  invariant(build.commit === commitFull.slice(0, 7), `${label} build short commit must match commitFull`);
  invariant(['backend', 'full-stack'].includes(build.releaseType), `${label} build releaseType must be backend or full-stack`);
  invariant(build?.release?.type === build.releaseType, `${label} build release type aliases must agree`);
  const deployment = build.deployment;
  invariant(deployment && typeof deployment === 'object' && !Array.isArray(deployment), `${label} must expose deployment identity`);
  invariant(deployment.railwayEnvironment === 'production', `${label} Railway environment must be production`);
  invariant(deployment.railwayService === 'rental-management', `${label} Railway service must be rental-management`);
  return {
    commitFull,
    releaseType: build.releaseType,
    startedAt: canonicalIsoTimestamp(build.startedAt, `${label} build startedAt`),
    railwayDeploymentId: exactNonblankString(deployment.railwayDeploymentId, `${label} Railway deployment ID`),
    railwayEnvironment: deployment.railwayEnvironment,
    railwayService: deployment.railwayService,
    railwayReplicaId: exactNonblankString(deployment.railwayReplicaId, `${label} Railway replica ID`),
  };
}

function validateSuccessfulProbe(probe, label) {
  invariant(probe?.status === 200, `${label} must return HTTP 200 before conserved login validation`);
  invariant(probe?.json?.ok === true, `${label} must include ok=true before conserved login validation`);
}

function responseHeader(headers, expectedName) {
  if (headers && typeof headers.get === 'function') return headers.get(expectedName);
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined;
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === expectedName);
  return entry?.[1];
}

function validateBackupOnlyLoginSecurityHeaders(headers) {
  for (const [name, expectedValue] of Object.entries(BACKUP_ONLY_LOGIN_SECURITY_HEADERS)) {
    invariant(responseHeader(headers, name) === expectedValue, `backup-only login 404 must include exact ${name}`);
  }
}

function validateBackupOnlyTerminalVersion(classification, terminalVersion) {
  validateSuccessfulProbe(terminalVersion, 'terminal version');
  invariant(terminalVersion.json?.app?.disabled === true, 'terminal version must prove app.disabled=true');
  const terminalIdentity = backupOnlyBuildIdentity(terminalVersion.json, 'terminal version');
  invariant(JSON.stringify(terminalIdentity) === JSON.stringify(classification.identity), 'terminal version backup-only identity must match the initial probes');
}

export function conservationEvidenceRequiresValidation({ environment, health, ready, version } = {}) {
  const modeObserved = [health?.json?.mode, ready?.json?.mode, version?.json?.mode]
    .some(mode => mode !== undefined);
  return modeObserved || (environment === 'production' && version?.json?.app?.disabled === true);
}

export function classifyConservedProductionProbes({ environment, health, ready, version } = {}) {
  invariant(environment === 'production', 'conserved login validation is production-only');
  validateSuccessfulProbe(health, 'health');
  validateSuccessfulProbe(ready, 'ready');
  validateSuccessfulProbe(version, 'version');
  invariant(version.json?.app?.disabled === true, 'version must prove app.disabled=true before conserved login validation');

  const observedModes = [health.json?.mode, ready.json?.mode, version.json?.mode];
  const ordinaryConserved = observedModes.every(mode => mode === undefined);
  if (ordinaryConserved) {
    return {
      appDisabled: true,
      backupOnly: false,
      mode: null,
      identity: null,
    };
  }

  invariant(observedModes.every(mode => mode === PRE_COMPATIBILITY_BACKUP_ONLY_MODE), 'backup-only mode must agree across health, ready, and version');
  invariant(ready.json?.ready === true, 'backup-only ready must include ready=true before conserved login validation');
  const identities = [
    backupOnlyBuildIdentity(health.json, 'health'),
    backupOnlyBuildIdentity(ready.json, 'ready'),
    backupOnlyBuildIdentity(version.json, 'version'),
  ];
  invariant(JSON.stringify(identities[0]) === JSON.stringify(identities[1]), 'health and ready backup-only identities must agree');
  invariant(JSON.stringify(identities[0]) === JSON.stringify(identities[2]), 'health and version backup-only identities must agree');
  return {
    appDisabled: true,
    backupOnly: true,
    mode: PRE_COMPATIBILITY_BACKUP_ONLY_MODE,
    identity: identities[0],
  };
}

export function conservedLoginCredentials(classification, { email, password } = {}) {
  if (classification?.backupOnly === true) return { ...BACKUP_ONLY_LOGIN_SENTINEL };
  return {
    email: exactNonblankString(email, 'conserved login email'),
    password: exactNonblankString(password, 'conserved login password'),
  };
}

export function validateConservedProductionLogin({ environment, health, ready, version, login, terminalVersion } = {}) {
  const classification = classifyConservedProductionProbes({ environment, health, ready, version });
  if (classification.backupOnly) {
    invariant(login?.status === 404, `/api/auth/login must be absent in the isolated backup-only runtime. HTTP ${login?.status}`);
    invariant(login.json && typeof login.json === 'object' && !Array.isArray(login.json), 'backup-only login 404 must return JSON');
    invariant(Object.keys(login.json).sort().join(',') === 'error,ok', 'backup-only login 404 must expose only ok and error');
    invariant(login.json.ok === false && login.json.error === 'Not found', 'backup-only login 404 must be the exact generic not-found response');
    validateBackupOnlyLoginSecurityHeaders(login.headers);
    validateBackupOnlyTerminalVersion(classification, terminalVersion);
    return { ...classification, loginStatus: 404 };
  }

  invariant(login?.status === 503, `/api/auth/login must return 503 when app.disabled=true. HTTP ${login?.status}`);
  return { ...classification, loginStatus: 503 };
}
