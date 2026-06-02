import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowsBackendCommitDrift,
  assertFrontendOnlyReleaseScope,
  backendCommitGateResult,
  backendCommitMatchesExpected,
  backendDriftMessage,
  normalizeReleaseType,
  parseArgs,
} from '../scripts/release-preflight.mjs';

test('release preflight allows backend drift only for production frontend-only releases', () => {
  assert.equal(allowsBackendCommitDrift({ env: 'production', releaseType: 'frontend-only' }), true);
  assert.equal(allowsBackendCommitDrift({ env: 'production', releaseType: 'full-stack' }), false);
  assert.equal(allowsBackendCommitDrift({ env: 'production', releaseType: 'backend' }), false);
  assert.equal(allowsBackendCommitDrift({ env: 'staging', releaseType: 'frontend-only' }), false);
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

test('release preflight allows frontend-only safe file scope and reports backend drift as warning', () => {
  const changedFiles = [
    'src/app/pages/dashboard/DashboardPage.tsx',
    'src/app/components/dashboard/KpiCard.tsx',
    'public/favicon.svg',
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

test('release preflight blocks frontend-only when server routes changed', () => {
  assert.throws(
    () => assertFrontendOnlyReleaseScope({
      releaseType: 'frontend-only',
      changedFiles: ['src/app/pages/dashboard/DashboardPage.tsx', 'server/routes/example.js'],
    }),
    /release_type=frontend-only is not allowed because backend\/deploy-critical files changed: server\/routes\/example\.js/,
  );
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
  } finally {
    if (previousReleaseType === undefined) delete process.env.RELEASE_TYPE;
    else process.env.RELEASE_TYPE = previousReleaseType;
    if (previousPreflightReleaseType === undefined) delete process.env.RELEASE_PREFLIGHT_RELEASE_TYPE;
    else process.env.RELEASE_PREFLIGHT_RELEASE_TYPE = previousPreflightReleaseType;
  }
});
