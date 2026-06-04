import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowsBackendCommitDrift,
  assertDeployToolingReleaseScope,
  assertFrontendDeployToolingReleaseScope,
  assertFrontendOnlyReleaseScope,
  backendCommitGateResult,
  backendCommitMatchesExpected,
  backendDriftMessage,
  classifyReleaseChangedFiles,
  normalizeReleaseType,
  parseArgs,
} from '../scripts/release-preflight.mjs';

test('release preflight allows backend drift only for production frontend-only and deploy-tooling releases', () => {
  assert.equal(allowsBackendCommitDrift({ env: 'production', releaseType: 'frontend-only' }), true);
  assert.equal(allowsBackendCommitDrift({ env: 'production', releaseType: 'deploy-tooling' }), true);
  assert.equal(allowsBackendCommitDrift({ env: 'production', releaseType: 'frontend-deploy-tooling' }), true);
  assert.equal(allowsBackendCommitDrift({ env: 'production', releaseType: 'full-stack' }), false);
  assert.equal(allowsBackendCommitDrift({ env: 'production', releaseType: 'backend' }), false);
  assert.equal(allowsBackendCommitDrift({ env: 'staging', releaseType: 'frontend-only' }), false);
  assert.equal(allowsBackendCommitDrift({ env: 'staging', releaseType: 'deploy-tooling' }), false);
  assert.equal(allowsBackendCommitDrift({ env: 'staging', releaseType: 'frontend-deploy-tooling' }), false);
});

test('release preflight keeps backend commit matching strict for backend and full-stack releases', () => {
  const backendBuild = {
    commit: '7050d37628f5',
    commitFull: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
  };

  assert.equal(backendCommitMatchesExpected(backendBuild, '7050d37628f5e7469b59ec3f30741049b1c3aa94'), true);
  assert.equal(backendCommitMatchesExpected(backendBuild, '7050d37628f5'), true);
  assert.equal(backendCommitMatchesExpected(backendBuild, '4205a21f41e191b473a6a489f59069d671b8601e'), false);
});

test('release preflight reports frontend-only backend drift explicitly', () => {
  assert.match(
    backendDriftMessage({
      expectedCommit: '4205a21f41e191b473a6a489f59069d671b8601e',
      backendCommit: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
    }),
    /Backend commit differs from frontend commit: expected for frontend-only release\. expected=4205a21f41e1 actual=7050d37628f5e7469b59ec3f30741049b1c3aa94/,
  );
});

test('release preflight reports deploy-tooling backend drift explicitly', () => {
  assert.match(
    backendDriftMessage({
      expectedCommit: '4205a21f41e191b473a6a489f59069d671b8601e',
      backendCommit: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
      releaseType: 'deploy-tooling',
    }),
    /Backend commit differs from frontend commit: expected for deploy-tooling release\. expected=4205a21f41e1 actual=7050d37628f5e7469b59ec3f30741049b1c3aa94/,
  );
});

test('release preflight reports frontend-deploy-tooling backend drift explicitly', () => {
  assert.match(
    backendDriftMessage({
      expectedCommit: '4205a21f41e191b473a6a489f59069d671b8601e',
      backendCommit: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
      releaseType: 'frontend-deploy-tooling',
    }),
    /Backend commit differs from frontend commit: expected for frontend-deploy-tooling release\. expected=4205a21f41e1 actual=7050d37628f5e7469b59ec3f30741049b1c3aa94/,
  );
});

test('release preflight allows frontend-only safe file scope and reports backend drift as warning', () => {
  const changedFiles = [
    'src/app/pages/dashboard/DashboardPage.tsx',
    'src/app/components/dashboard/KpiCard.tsx',
    'public/favicon.svg',
    'package.json',
    'package-lock.json',
    'scripts/vite-build.mjs',
    'tests/dashboard-overdue-status.test.js',
    'docs/release-notes.md',
  ];

  const scope = assertFrontendOnlyReleaseScope({ releaseType: 'frontend-only', changedFiles });
  assert.equal(scope.checked, true);
  assert.deepEqual(scope.unsafeChangedFiles, []);

  const backendGate = backendCommitGateResult({
    env: 'production',
    releaseType: 'frontend-only',
    backendBuild: {
      commit: '7050d37628f5',
      commitFull: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
    },
    expectedCommit: '4205a21f41e191b473a6a489f59069d671b8601e',
  });
  assert.equal(backendGate.status, 'warn');
  assert.match(backendGate.message, /Backend commit differs from frontend commit: expected for frontend-only release/);
});

test('release preflight allows deploy-tooling safe file scope and reports backend drift as warning', () => {
  const changedFiles = [
    '.github/workflows/deploy.yml',
    'scripts/release-preflight.mjs',
    'e2e/helpers/releaseSmoke.ts',
    'e2e/production-smoke.spec.ts',
    'e2e/production-ui-selector-smoke.spec.ts',
    'tests/release-preflight.test.js',
    'tests/release-smoke-conservation.test.js',
    'docs/release-runbook.md',
    'docs/deploy-checklist.md',
    'docs/production-smoke-checklist.md',
  ];

  const scope = assertDeployToolingReleaseScope({ releaseType: 'deploy-tooling', changedFiles });
  assert.equal(scope.checked, true);
  assert.deepEqual(scope.disallowedChangedFiles, []);

  const backendGate = backendCommitGateResult({
    env: 'production',
    releaseType: 'deploy-tooling',
    backendBuild: {
      commit: '7050d37628f5',
      commitFull: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
    },
    expectedCommit: '4205a21f41e191b473a6a489f59069d671b8601e',
  });
  assert.equal(backendGate.status, 'warn');
  assert.match(backendGate.message, /Backend commit differs from frontend commit: expected for deploy-tooling release/);
});

test('release preflight allows frontend-deploy-tooling safe file scope and reports backend drift as warning', () => {
  const changedFiles = [
    '.github/workflows/deploy.yml',
    'e2e/helpers/releaseSmoke.ts',
    'e2e/production-smoke.spec.ts',
    'e2e/production-ui-selector-smoke.spec.ts',
    'tests/release-smoke-conservation.test.js',
    'src/app/pages/Dashboard.tsx',
  ];

  const scope = assertFrontendDeployToolingReleaseScope({ releaseType: 'frontend-deploy-tooling', changedFiles });
  assert.equal(scope.checked, true);
  assert.deepEqual(scope.disallowedChangedFiles, []);

  const backendGate = backendCommitGateResult({
    env: 'production',
    releaseType: 'frontend-deploy-tooling',
    backendBuild: {
      commit: '7050d37628f5',
      commitFull: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
    },
    expectedCommit: '4205a21f41e191b473a6a489f59069d671b8601e',
  });
  assert.equal(backendGate.status, 'warn');
  assert.match(backendGate.message, /Backend commit differs from frontend commit: expected for frontend-deploy-tooling release/);
});

test('release preflight blocks frontend-only when server routes changed', () => {
  assert.throws(
    () => assertFrontendOnlyReleaseScope({
      releaseType: 'frontend-only',
      changedFiles: ['src/app/pages/dashboard/DashboardPage.tsx', 'server/routes/example.js'],
    }),
    /release_type=frontend-only is not allowed because backend\/deploy-critical files changed: server\/routes\/example\.js/,
  );
});

test('release preflight blocks frontend-deploy-tooling when backend server changed', () => {
  assert.throws(
    () => assertFrontendDeployToolingReleaseScope({
      releaseType: 'frontend-deploy-tooling',
      changedFiles: ['.github/workflows/deploy.yml', 'src/app/pages/Dashboard.tsx', 'server/server.js'],
    }),
    /release_type=frontend-deploy-tooling is allowed only for frontend runtime plus deploy\/preflight\/smoke tooling files\. Disallowed files: server\/server\.js/,
  );
});

test('release preflight blocks frontend-deploy-tooling when production data or secrets changed', () => {
  assert.throws(
    () => assertFrontendDeployToolingReleaseScope({
      releaseType: 'frontend-deploy-tooling',
      changedFiles: ['.github/workflows/deploy.yml', 'src/app/pages/Dashboard.tsx', 'server/data/app.sqlite'],
    }),
    /Disallowed files: server\/data\/app\.sqlite/,
  );
  assert.throws(
    () => assertFrontendDeployToolingReleaseScope({
      releaseType: 'frontend-deploy-tooling',
      changedFiles: ['.github/workflows/deploy.yml', 'src/app/pages/Dashboard.tsx', '.env.production'],
    }),
    /Disallowed files: \.env\.production/,
  );
});

test('release preflight blocks deploy-tooling when server routes changed', () => {
  assert.throws(
    () => assertDeployToolingReleaseScope({
      releaseType: 'deploy-tooling',
      changedFiles: ['.github/workflows/deploy.yml', 'server/routes/example.js'],
    }),
    /release_type=deploy-tooling is allowed only for deploy\/preflight\/smoke tooling files\. Disallowed files: server\/routes\/example\.js/,
  );
});

test('release preflight blocks deploy-tooling when app runtime changed', () => {
  assert.throws(
    () => assertDeployToolingReleaseScope({
      releaseType: 'deploy-tooling',
      changedFiles: ['.github/workflows/deploy.yml', 'src/app/pages/Dashboard.tsx'],
    }),
    /release_type=deploy-tooling is allowed only for deploy\/preflight\/smoke tooling files\. Disallowed files: src\/app\/pages\/Dashboard\.tsx/,
  );
});

test('release classifier allows deploy-tooling only', () => {
  const result = classifyReleaseChangedFiles([
    '.github/workflows/deploy.yml',
    'scripts/release-preflight.mjs',
    'e2e/production-ui-selector-smoke.spec.ts',
    'tests/release-preflight.test.js',
  ]);

  assert.equal(result.allowed, true);
  assert.equal(result.releaseType, 'deploy-tooling');
  assert.deepEqual(result.blockedFiles, []);
});

test('release classifier allows frontend runtime only as frontend deploy', () => {
  const result = classifyReleaseChangedFiles(['src/app/pages/Dashboard.tsx']);

  assert.equal(result.allowed, true);
  assert.equal(result.releaseType, 'frontend-only');
  assert.deepEqual(result.blockedFiles, []);
});

test('release classifier allows frontend runtime with deploy tooling as GitHub Pages deploy', () => {
  const result = classifyReleaseChangedFiles([
    '.github/workflows/deploy.yml',
    'e2e/helpers/releaseSmoke.ts',
    'e2e/production-smoke.spec.ts',
    'e2e/production-ui-selector-smoke.spec.ts',
    'tests/release-smoke-conservation.test.js',
    'src/app/pages/Dashboard.tsx',
  ]);

  assert.equal(result.allowed, true);
  assert.equal(result.releaseType, 'frontend-deploy-tooling');
  assert.deepEqual(result.blockedFiles, []);
});

test('release classifier blocks frontend runtime with deploy tooling and backend server changes', () => {
  const result = classifyReleaseChangedFiles([
    '.github/workflows/deploy.yml',
    'src/app/pages/Dashboard.tsx',
    'server/server.js',
  ]);

  assert.equal(result.allowed, false);
  assert.equal(result.releaseType, '');
  assert.deepEqual(result.blockedFiles, ['server/server.js']);
});

test('release classifier keeps docs-only out of frontend deploy classification', () => {
  const result = classifyReleaseChangedFiles(['docs/product-notes.md']);

  assert.equal(result.allowed, true);
  assert.equal(result.releaseType, 'docs-only');
  assert.equal(result.hasFrontendRuntime, false);
  assert.equal(result.hasDeployTooling, false);
});

test('release classifier blocks production data and secret files', () => {
  const result = classifyReleaseChangedFiles([
    '.github/workflows/deploy.yml',
    'src/app/pages/Dashboard.tsx',
    'server/data/app.sqlite',
    '.env.production',
    'config/production-secrets.json',
  ]);

  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockedFiles, ['server/data/app.sqlite', '.env.production', 'config/production-secrets.json']);
});

test('release preflight blocks frontend-only when release gate scripts changed', () => {
  assert.throws(
    () => assertFrontendOnlyReleaseScope({
      releaseType: 'frontend-only',
      changedFiles: ['scripts/release-preflight.mjs'],
    }),
    /release_type=frontend-only is not allowed because backend\/deploy-critical files changed: scripts\/release-preflight\.mjs/,
  );
});

test('release preflight blocks frontend-only when non-build scripts changed', () => {
  assert.throws(
    () => assertFrontendOnlyReleaseScope({
      releaseType: 'frontend-only',
      changedFiles: ['scripts/backup-sqlite.cjs'],
    }),
    /release_type=frontend-only is not allowed because backend\/deploy-critical files changed: scripts\/backup-sqlite\.cjs/,
  );
});

test('release preflight keeps full-stack backend mismatch as failure', () => {
  const backendGate = backendCommitGateResult({
    env: 'production',
    releaseType: 'full-stack',
    backendBuild: {
      commit: '7050d37628f5',
      commitFull: '7050d37628f5e7469b59ec3f30741049b1c3aa94',
    },
    expectedCommit: '4205a21f41e191b473a6a489f59069d671b8601e',
  });

  assert.equal(backendGate.status, 'fail');
  assert.match(backendGate.message, /backend commit mismatch\. expected=4205a21f41e1 actual=7050d37628f5e7469b59ec3f30741049b1c3aa94/);
});

test('release preflight release type defaults to strict full-stack', () => {
  const previousReleaseType = process.env.RELEASE_TYPE;
  const previousPreflightReleaseType = process.env.RELEASE_PREFLIGHT_RELEASE_TYPE;
  delete process.env.RELEASE_TYPE;
  delete process.env.RELEASE_PREFLIGHT_RELEASE_TYPE;

  assert.equal(normalizeReleaseType(''), 'full-stack');
  try {
    assert.equal(parseArgs(['--env', 'production', '--expected-commit', 'abc123']).releaseType, 'full-stack');
    assert.equal(
      parseArgs(['--env', 'production', '--expected-commit', 'abc123', '--release-type', 'frontend-only']).releaseType,
      'frontend-only',
    );
    assert.equal(
      parseArgs(['--env', 'production', '--expected-commit', 'abc123', '--release-type', 'deploy-tooling']).releaseType,
      'deploy-tooling',
    );
    assert.equal(
      parseArgs(['--env', 'production', '--expected-commit', 'abc123', '--release-type', 'frontend-deploy-tooling']).releaseType,
      'frontend-deploy-tooling',
    );
  } finally {
    if (previousReleaseType === undefined) delete process.env.RELEASE_TYPE;
    else process.env.RELEASE_TYPE = previousReleaseType;
    if (previousPreflightReleaseType === undefined) delete process.env.RELEASE_PREFLIGHT_RELEASE_TYPE;
    else process.env.RELEASE_PREFLIGHT_RELEASE_TYPE = previousPreflightReleaseType;
  }
});
