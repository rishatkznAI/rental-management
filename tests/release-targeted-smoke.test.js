import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  findUnsafePayloadViolations,
  hasUnsafeText,
} from '../scripts/release-targeted-smoke.mjs';
import {
  BACKUP_ONLY_LOGIN_SENTINEL,
  BACKUP_ONLY_LOGIN_SECURITY_HEADERS,
  PRE_COMPATIBILITY_BACKUP_ONLY_MODE,
  classifyConservedProductionProbes,
  conservationEvidenceRequiresValidation,
  conservedLoginCredentials,
  validateConservedProductionLogin,
} from '../scripts/release-conservation-contract.mjs';

const smokeSource = readFileSync(new URL('../scripts/release-targeted-smoke.mjs', import.meta.url), 'utf8');
const conservationSource = readFileSync(new URL('../scripts/release-conservation-contract.mjs', import.meta.url), 'utf8');
const execFileAsync = promisify(execFile);

test('targeted smoke validates current action queue execution DTO', () => {
  assert.match(smokeSource, /function executionFieldsPresent\(items\)/);
  assert.match(smokeSource, /hasOwnProperty\.call\(item, 'executionStatus'\)/);
  assert.match(smokeSource, /hasOwnProperty\.call\(item, 'executionLabel'\)/);
  assert.match(smokeSource, /hasOwnProperty\.call\(item, 'executionOverdue'\)/);
  assert.match(smokeSource, /\/api\/management\/action-queue items must expose execution fields/);
});

test('targeted smoke covers service repeat breakdowns read-only analytics', () => {
  assert.match(smokeSource, /function repeatBreakdownsShapeValid\(payload\)/);
  assert.match(smokeSource, /\/api\/service\/repeat-breakdowns/);
  assert.match(smokeSource, /returned an unexpected response shape/);
  assert.match(smokeSource, /totalRepeats/);
  assert.match(smokeSource, /byEquipment/);
  assert.doesNotMatch(smokeSource, /JSON\.stringify\(repeatBreakdowns\.json\)/);
});

test('targeted smoke allows conserved production only after public probes and blocked login', () => {
  assert.match(smokeSource, /timedJson\(apiUrl, '\/health'\)/);
  assert.match(smokeSource, /timedJson\(apiUrl, '\/health\/ready'\)/);
  assert.match(smokeSource, /timedJson\(apiUrl, '\/api\/version'\)/);
  assert.match(smokeSource, /version\.json\?\.app\?\.disabled === true/);
  assert.match(smokeSource, /conservationEvidenceRequiresValidation\(publicProbeEvidence\)/);
  assert.match(smokeSource, /classifyConservedProductionProbes\(publicProbeEvidence\)/);
  assert.match(smokeSource, /conservedLoginCredentials\(conservedProbe/);
  assert.match(smokeSource, /redirect: 'manual'/);
  assert.match(smokeSource, /validateConservedProductionLogin\(\{/);
  assert.match(smokeSource, /timedJson\(apiUrl, '\/api\/version'\)/);
  assert.match(smokeSource, /terminalVersion:/);
  assert.match(conservationSource, /login\?\.status === 503/);
  assert.match(conservationSource, /login\?\.status === 404/);
  assert.match(conservationSource, /backup-only mode must agree across health, ready, and version/);
  assert.match(conservationSource, /health and version backup-only identities must agree/);
  assert.match(conservationSource, /Object\.keys\(login\.json\)\.sort\(\)\.join\(','\) === 'error,ok'/);
  assert.match(smokeSource, /Production is conserved: login HTTP 503 is expected\./);
  assert.match(smokeSource, /exact isolated backup-only runtime has no login route \(HTTP 404\)/);
  assert.match(smokeSource, /login\.response\.status === 200/);
});

test('any observed conservation mode requires validation before credentials are selected', () => {
  const evidence = (environment, versionJson, healthMode, readyMode) => ({
    environment,
    health: { status: 200, json: { ok: true, ...(healthMode === undefined ? {} : { mode: healthMode }) } },
    ready: { status: 200, json: { ok: true, ...(readyMode === undefined ? {} : { mode: readyMode }) } },
    version: { status: 200, json: { ok: true, ...versionJson } },
  });

  assert.equal(conservationEvidenceRequiresValidation(evidence('production', { app: { disabled: true } })), true);
  assert.equal(conservationEvidenceRequiresValidation(evidence('production', { app: { disabled: false }, mode: PRE_COMPATIBILITY_BACKUP_ONLY_MODE })), true);
  assert.equal(conservationEvidenceRequiresValidation(evidence('production', { mode: PRE_COMPATIBILITY_BACKUP_ONLY_MODE })), true);
  assert.equal(conservationEvidenceRequiresValidation(evidence('production', { app: { disabled: false }, mode: null })), true);
  assert.equal(conservationEvidenceRequiresValidation(evidence('staging', { app: { disabled: false } }, 'unknown-mode')), true);
  assert.equal(conservationEvidenceRequiresValidation(evidence('production', { app: { disabled: false } })), false);
  assert.equal(conservationEvidenceRequiresValidation(evidence('staging', {})), false);
});

test('conserved login accepts 404 only for one exact backup-only runtime identity across every public probe', () => {
  const build = {
    commit: 'a'.repeat(7),
    commitFull: 'a'.repeat(40),
    releaseType: 'full-stack',
    release: { type: 'full-stack' },
    startedAt: '2026-08-27T08:30:00.000Z',
    deployment: {
      railwayDeploymentId: 'deployment-exact',
      railwayEnvironment: 'production',
      railwayService: 'rental-management',
      railwayReplicaId: 'replica-exact',
    },
  };
  const loginHeaders = { ...BACKUP_ONLY_LOGIN_SECURITY_HEADERS };
  const probe = (extra = {}) => ({
    status: 200,
    json: {
      ok: true,
      mode: PRE_COMPATIBILITY_BACKUP_ONLY_MODE,
      build: structuredClone(build),
      ...extra,
    },
  });
  const fixture = (overrides = {}) => ({
    environment: 'production',
    health: probe(),
    ready: probe({ ready: true }),
    version: probe({ app: { disabled: true } }),
    login: {
      status: 404,
      json: { ok: false, error: 'Not found' },
      headers: { ...loginHeaders },
    },
    terminalVersion: probe({ app: { disabled: true } }),
    ...overrides,
  });

  const accepted = validateConservedProductionLogin(fixture());
  assert.equal(accepted.backupOnly, true);
  assert.equal(accepted.loginStatus, 404);
  assert.equal(accepted.mode, PRE_COMPATIBILITY_BACKUP_ONLY_MODE);
  assert.equal(accepted.identity.commitFull, 'a'.repeat(40));
  assert.equal(accepted.identity.railwayDeploymentId, 'deployment-exact');
  assert.equal(accepted.identity.railwayReplicaId, 'replica-exact');

  const standardConserved = fixture({
    health: { status: 200, json: { ok: true } },
    ready: { status: 200, json: { ok: true } },
    version: { status: 200, json: { ok: true, app: { disabled: true } } },
    login: { status: 503, json: { ok: false } },
    terminalVersion: null,
  });
  assert.deepEqual(validateConservedProductionLogin(standardConserved), {
    appDisabled: true,
    backupOnly: false,
    loginStatus: 503,
    mode: null,
    identity: null,
  });

  const rejected = [
    fixture({ environment: 'staging' }),
    fixture({ health: { ...probe(), status: 204 } }),
    fixture({ ready: { ...probe({ ready: true }), status: 500 } }),
    fixture({ version: { ...probe({ app: { disabled: true } }), status: 401 } }),
    fixture({ login: { status: 503, json: { ok: false } } }),
    ...[200, 401, 403, 500].map(status => fixture({ login: { status, json: { ok: false, error: 'Not found' }, headers: { ...loginHeaders } } })),
    fixture({ login: { status: 404, json: null, headers: { ...loginHeaders } } }),
    fixture({ login: { status: 404, json: { ok: false, error: 'Not found', mode: 'backup' }, headers: { ...loginHeaders } } }),
    fixture({ login: { status: 404, json: { ok: false, error: 'Disabled' }, headers: { ...loginHeaders } } }),
    ...Object.keys(loginHeaders).map(name => fixture({
      login: {
        status: 404,
        json: { ok: false, error: 'Not found' },
        headers: { ...loginHeaders, [name]: 'wrong' },
      },
    })),
    fixture({ terminalVersion: null }),
    fixture({ terminalVersion: { ...probe({ app: { disabled: true } }), status: 503 } }),
    fixture({ terminalVersion: probe({ mode: undefined, app: { disabled: true } }) }),
    fixture({ terminalVersion: probe({ app: { disabled: false } }) }),
    fixture({ terminalVersion: probe({ app: { disabled: true }, build: { ...structuredClone(build), deployment: { ...build.deployment, railwayDeploymentId: 'terminal-drift' } } }) }),
    fixture({ health: probe({ mode: undefined }) }),
    fixture({ health: probe({ build: undefined }) }),
    fixture({ health: probe({ build: { ...structuredClone(build), commitFull: 'A'.repeat(40), commit: 'A'.repeat(7) } }) }),
    fixture({ health: probe({ build: { ...structuredClone(build), release: { type: 'backend' } } }) }),
    fixture({ ready: probe({ ready: false }) }),
    fixture({ version: probe({ app: { disabled: false } }) }),
    fixture({ version: probe({ app: { disabled: true }, build: { ...structuredClone(build), commitFull: 'b'.repeat(40), commit: 'b'.repeat(7) } }) }),
    fixture({ version: probe({ app: { disabled: true }, build: { ...structuredClone(build), startedAt: '2026-08-27T08:31:00.000Z' } }) }),
    fixture({ version: probe({ app: { disabled: true }, build: { ...structuredClone(build), deployment: { ...build.deployment, railwayDeploymentId: 'other-deployment' } } }) }),
    fixture({ version: probe({ app: { disabled: true }, build: { ...structuredClone(build), deployment: { ...build.deployment, railwayReplicaId: 'other-replica' } } }) }),
    fixture({ version: probe({ app: { disabled: true }, build: { ...structuredClone(build), releaseType: 'frontend-only', release: { type: 'frontend-only' } } }) }),
    {
      ...standardConserved,
      health: { status: 200, json: { ok: true, mode: 'unknown-conserved-mode' } },
    },
    {
      ...standardConserved,
      login: { status: 404, json: { ok: false, error: 'Not found' } },
    },
  ];
  for (const input of rejected) {
    assert.throws(() => validateConservedProductionLogin(input));
  }
});

test('backup-only conserved login always uses inert sentinel credentials', () => {
  const build = {
    commit: 'b'.repeat(7),
    commitFull: 'b'.repeat(40),
    releaseType: 'backend',
    release: { type: 'backend' },
    startedAt: '2026-08-27T09:00:00.000Z',
    deployment: {
      railwayDeploymentId: 'deployment-sentinel',
      railwayEnvironment: 'production',
      railwayService: 'rental-management',
      railwayReplicaId: 'replica-sentinel',
    },
  };
  const probe = (json) => ({ status: 200, json: { ok: true, mode: PRE_COMPATIBILITY_BACKUP_ONLY_MODE, build: structuredClone(build), ...json } });
  const classification = classifyConservedProductionProbes({
    environment: 'production',
    health: probe({}),
    ready: probe({ ready: true }),
    version: probe({ app: { disabled: true } }),
  });

  assert.deepEqual(conservedLoginCredentials(classification, {
    email: 'must-not-be-used@example.test',
    password: 'must-not-be-used',
  }), BACKUP_ONLY_LOGIN_SENTINEL);
  assert.deepEqual(conservedLoginCredentials({ backupOnly: false }, {
    email: 'configured@example.test',
    password: 'configured-password',
  }), {
    email: 'configured@example.test',
    password: 'configured-password',
  });
  assert.throws(() => conservedLoginCredentials({ backupOnly: false }, {}));
});

test('targeted smoke CLI accepts exact backup-only route absence without production credentials', async () => {
  const build = {
    commit: 'c'.repeat(7),
    commitFull: 'c'.repeat(40),
    releaseType: 'full-stack',
    release: { type: 'full-stack' },
    startedAt: '2026-08-27T09:15:00.000Z',
    deployment: {
      railwayDeploymentId: 'deployment-cli',
      railwayEnvironment: 'production',
      railwayService: 'rental-management',
      railwayReplicaId: 'replica-cli',
    },
  };
  let observedLoginBody = null;
  let observedLoginCount = 0;
  let observedTerminalCacheControl = null;
  let observedRedirectFallbackCount = 0;
  let serveNearMatch = false;
  let serveLoginRedirect = false;
  let versionAppDisabled = true;
  const server = createServer(async (request, response) => {
    for (const [name, value] of Object.entries(BACKUP_ONLY_LOGIN_SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    const probes = {
      '/health': { ok: true, mode: PRE_COMPATIBILITY_BACKUP_ONLY_MODE, build },
      '/health/ready': { ok: true, ready: true, mode: PRE_COMPATIBILITY_BACKUP_ONLY_MODE, build },
      '/api/version': {
        ok: true,
        ...(versionAppDisabled === 'missing' ? {} : { app: { disabled: versionAppDisabled } }),
        mode: serveNearMatch ? `${PRE_COMPATIBILITY_BACKUP_ONLY_MODE} ` : PRE_COMPATIBILITY_BACKUP_ONLY_MODE,
        build,
      },
    };
    if (request.method === 'GET' && probes[request.url]) {
      if (request.url === '/api/version' && observedLoginCount > 0) {
        observedTerminalCacheControl = request.headers['cache-control'];
      }
      response.end(JSON.stringify(probes[request.url]));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/auth/login') {
      observedLoginCount += 1;
      let rawBody = '';
      for await (const chunk of request) rawBody += chunk;
      observedLoginBody = JSON.parse(rawBody);
      if (serveLoginRedirect) {
        response.statusCode = 302;
        response.setHeader('location', '/generic-not-found');
        response.end(JSON.stringify({ ok: false, error: 'Not found' }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, error: 'Not found' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/generic-not-found') {
      observedRedirectFallbackCount += 1;
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, error: 'Not found' }));
      return;
    }
    response.statusCode = 500;
    response.end(JSON.stringify({ ok: false, error: 'Unexpected test route' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = {
      ...process.env,
      PRODUCTION_API_URL: `http://127.0.0.1:${server.address().port}`,
    };
    delete env.PRODUCTION_ADMIN_EMAIL;
    delete env.PRODUCTION_ADMIN_PASSWORD;
    const runSmoke = (runEnv = env) => execFileAsync(process.execPath, [
      'scripts/release-targeted-smoke.mjs',
      '--env',
      'production',
    ], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: runEnv,
      timeout: 10_000,
    });
    const { stdout } = await runSmoke();
    assert.match(stdout, /\[targeted-smoke\] PASS/);
    assert.deepEqual(observedLoginBody, BACKUP_ONLY_LOGIN_SENTINEL);
    assert.equal(observedLoginCount, 1);
    assert.equal(observedTerminalCacheControl, 'no-cache');

    serveNearMatch = true;
    await assert.rejects(runSmoke(), error => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /backup-only mode must agree across health, ready, and version/);
      return true;
    });
    assert.equal(observedLoginCount, 1, 'near-match evidence must fail before any login request');

    serveNearMatch = false;
    serveLoginRedirect = true;
    await assert.rejects(runSmoke(), error => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /isolated backup-only runtime\. HTTP 302/);
      return true;
    });
    assert.equal(observedLoginCount, 2, 'the direct login route should receive the redirect-negative probe once');
    assert.equal(observedRedirectFallbackCount, 0, 'the CLI must not follow a login redirect to a generic 404 fallback');

    serveLoginRedirect = false;
    const credentialedEnv = {
      ...env,
      PRODUCTION_ADMIN_EMAIL: 'real-credentials-must-not-send@example.test',
      PRODUCTION_ADMIN_PASSWORD: 'real-credentials-must-not-send',
    };
    for (const appDisabled of [false, 'missing']) {
      versionAppDisabled = appDisabled;
      const loginCountBeforeMalformedEvidence = observedLoginCount;
      await assert.rejects(runSmoke(credentialedEnv), error => {
        assert.notEqual(error.code, 0);
        assert.match(error.stderr, /version must prove app\.disabled=true before conserved login validation/);
        return true;
      });
      assert.equal(
        observedLoginCount,
        loginCountBeforeMalformedEvidence,
        `mode-bearing evidence with app.disabled=${appDisabled} must fail before any login request`,
      );
    }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('targeted smoke allows safe system control center diagnostic key names', () => {
  const payload = {
    dataRisks: {
      undefinedLikeCount: 0,
      nullLikeCount: 0,
      objectObjectLikeCount: 0,
    },
  };

  assert.equal(hasUnsafeText(payload), false);
  assert.deepEqual(findUnsafePayloadViolations(payload), []);
});

test('targeted smoke rejects unsafe placeholder string values', () => {
  assert.equal(hasUnsafeText({ status: 'undefined' }), true);
  assert.equal(findUnsafePayloadViolations({ status: 'undefined' })[0]?.type, 'placeholder-value');
  assert.equal(hasUnsafeText({ status: 'null' }), true);
  assert.equal(findUnsafePayloadViolations({ status: 'null' })[0]?.type, 'placeholder-value');
  assert.equal(hasUnsafeText({ status: '[object Object]' }), true);
  assert.equal(findUnsafePayloadViolations({ status: '[object Object]' })[0]?.type, 'placeholder-value');
});

test('targeted smoke rejects sensitive response keys and raw database URLs', () => {
  const tokenViolations = findUnsafePayloadViolations({ runtime: { token: 'abc' } });
  assert.equal(tokenViolations.some(item => item.path === '$.runtime.token' && item.type === 'sensitive-key'), true);

  const databaseUrlViolations = findUnsafePayloadViolations({ storage: { databaseUrl: 'postgres://example.invalid/db' } });
  assert.equal(databaseUrlViolations.some(item => item.path === '$.storage.databaseUrl' && item.type === 'sensitive-key'), true);
  assert.equal(databaseUrlViolations.some(item => item.path === '$.storage.databaseUrl' && item.type === 'sensitive-value'), true);
});

test('targeted smoke accepts normal system control center response shape with diagnostic counters', () => {
  const payload = {
    status: 'warning',
    version: {
      backendCommit: 'f94d83eef373',
      backendBuildTime: '2026-05-23T03:39:40.896Z',
      nodeEnv: 'production',
      frontendCommitFromRequestOrConfig: 'unknown',
      versionMatch: 'unknown',
    },
    runtime: {
      appDisabled: false,
      botDisabled: true,
      gsmDisabled: true,
      environment: 'production',
    },
    storage: {
      dbSafeLabel: 'sqlite',
      dbPathSafeLabel: 'data/app.sqlite',
      volumeSafeSignal: 'available',
      walPresent: true,
      dbSizeBytes: 123456,
    },
    health: {
      api: 'ok',
      ready: 'unknown',
      lastCheckedAt: '2026-05-23T03:39:40.896Z',
    },
    dataRisks: {
      undefinedLikeCount: 0,
      nullLikeCount: 0,
      objectObjectLikeCount: 0,
      brokenEquipmentLinks: 0,
      brokenRentalLinks: 0,
      brokenServiceLinks: 0,
    },
    serviceQuality: {
      totalRepeats: 0,
      critical: 0,
      high: 0,
      affectedEquipment: 0,
      affectedMechanics: 0,
      topScenario: 'Нет повторов',
    },
    recommendations: [
      {
        level: 'info',
        title: 'Страница read-only',
        description: 'Раздел не пишет данные и не меняет runtime flags.',
        action: 'Для изменений использовать утверждённые процедуры.',
      },
    ],
  };

  assert.equal(hasUnsafeText(payload), false);
  assert.deepEqual(findUnsafePayloadViolations(payload), []);
});
