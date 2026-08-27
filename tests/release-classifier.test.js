import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyReleaseChangedFiles,
  classifyReleasePath,
} from '../scripts/release-classifier.mjs';

const deployWorkflowSource = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

function expectFrontendOnly(files, { runtime = true, tests = false } = {}) {
  const result = classifyReleaseChangedFiles(files);
  assert.equal(result.allowed, true);
  assert.equal(result.failClosed, false);
  assert.equal(result.releaseType, 'frontend-only');
  assert.equal(result.requiresBackendDeploy, false);
  assert.equal(result.hasFrontendRuntime, runtime);
  assert.equal(result.hasFrontendTests, tests);
  assert.deepEqual(result.blockedFiles, []);
  return result;
}

test('release classifier keeps frontend source frontend-only', () => {
  expectFrontendOnly(['src/app/pages/Clients.tsx']);
});

test('release classifier keeps frontend source plus ordinary E2E coverage frontend-only', () => {
  expectFrontendOnly([
    'src/app/pages/ClientDetail.tsx',
    'e2e/client-detail-tabs.spec.ts',
  ], { runtime: true, tests: true });
});

test('release classifier keeps ordinary E2E-only changes out of backend scope', () => {
  const result = expectFrontendOnly(['e2e/client-detail-tabs.spec.ts'], { runtime: false, tests: true });
  assert.equal(result.requiresFrontendDeploy, false);
  assert.equal(classifyReleasePath('e2e/client-detail-tabs.spec.ts').kind, 'frontend-test');
});

test('release classifier recognizes colocated frontend unit tests without backend scope', () => {
  expectFrontendOnly(['src/app/pages/Clients.test.tsx'], { runtime: false, tests: true });
});

test('release classifier requires backend release for a backend route', () => {
  const result = classifyReleaseChangedFiles(['server/routes/clients.js']);
  assert.equal(result.allowed, false);
  assert.equal(result.releaseType, 'backend');
  assert.equal(result.requiresBackendDeploy, true);
  assert.deepEqual(result.blockedFiles, ['server/routes/clients.js']);
});

test('release classifier requires backend release for DB schema or migration changes', () => {
  for (const file of ['server/db.js', 'migrations/20260821_add_index.sql', 'server/data/app.sqlite']) {
    const result = classifyReleaseChangedFiles([file]);
    assert.equal(result.allowed, false, file);
    assert.equal(result.releaseType, 'backend', file);
    assert.equal(result.requiresBackendDeploy, true, file);
    assert.deepEqual(result.blockedFiles, [file]);
  }
});

test('release classifier requires full-stack release for frontend plus backend runtime', () => {
  const result = classifyReleaseChangedFiles([
    'src/app/pages/Clients.tsx',
    'server/routes/clients.js',
  ]);
  assert.equal(result.allowed, false);
  assert.equal(result.releaseType, 'full-stack');
  assert.equal(result.requiresFrontendDeploy, true);
  assert.equal(result.requiresBackendDeploy, true);
});

test('release classifier treats shared runtime config as full-stack', () => {
  const result = classifyReleaseChangedFiles(['.env.example']);
  assert.equal(result.allowed, false);
  assert.equal(result.releaseType, 'full-stack');
  assert.equal(result.requiresFrontendDeploy, true);
  assert.equal(result.requiresBackendDeploy, true);
  assert.equal(result.entries[0].kind, 'shared-runtime');
});

test('release classifier fails closed for an unknown path', () => {
  const result = classifyReleaseChangedFiles(['platform/runtime.policy']);
  assert.equal(result.allowed, false);
  assert.equal(result.failClosed, true);
  assert.equal(result.releaseType, 'unknown');
  assert.equal(result.requiresBackendDeploy, true);
  assert.deepEqual(result.blockedFiles, ['platform/runtime.policy']);
});

test('release classifier preserves explicit deploy-tooling treatment for production smoke files', () => {
  const result = classifyReleaseChangedFiles(['e2e/production-smoke.spec.ts']);
  assert.equal(result.allowed, true);
  assert.equal(result.releaseType, 'deploy-tooling');
  assert.equal(result.requiresBackendDeploy, false);
  assert.equal(result.entries[0].kind, 'deploy-tooling');
});

test('release classifier treats the guarded clean-production backup workflow as deploy tooling', () => {
  const result = classifyReleaseChangedFiles([
    '.github/workflows/skytech-clean-production-reset.yml',
  ]);
  assert.equal(result.releaseType, 'deploy-tooling');
  assert.equal(result.failClosed, false);
});

test('deploy workflow delegates push classification to the tested classifier', () => {
  assert.match(deployWorkflowSource, /node scripts\/release-classifier\.mjs/);
  assert.match(deployWorkflowSource, /--changed-files-file "\$changed_files_file"/);
  assert.match(deployWorkflowSource, /requires_backend: \$\{\{ steps\.classify\.outputs\.requires_backend \}\}/);
  assert.doesNotMatch(deployWorkflowSource, /frontend_allowed=/);
  assert.doesNotMatch(deployWorkflowSource, /deploy_tooling_allowed=/);
  assert.doesNotMatch(deployWorkflowSource, /release_critical=/);
});
