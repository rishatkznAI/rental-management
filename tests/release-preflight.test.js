import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowsBackendCommitDrift,
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
