#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FRONTEND_RUNTIME_PATTERNS = [
  /^src\//,
  /^public\//,
  /^index\.html$/,
  /^vite\.config\.[^/]+$/,
  /^postcss\.config\.[^/]+$/,
  /^tsconfig[^/]*\.json$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^scripts\/vite-build\.mjs$/,
];

// Product E2E specs cover the browser application. They are deployment-neutral
// when runtime files are also present and must never imply a backend release.
const FRONTEND_TEST_PATTERNS = [
  /^src\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /^e2e\/[^/]+\.spec\.ts$/,
];

// These files control the release gate itself, production/staging probes, or
// CI assertions for that tooling. Keep them distinct from ordinary E2E specs.
const DEPLOY_TOOLING_PATTERNS = [
  /^\.github\/workflows\/(?:deploy|.*smoke)\.yml$/,
  /^\.github\/workflows\/skytech-clean-production-reset\.yml$/,
  /^scripts\/release-classifier\.mjs$/,
  /^scripts\/release-conservation-contract\.mjs$/,
  /^scripts\/release-preflight\.mjs$/,
  /^scripts\/frontend-release-snapshot\.mjs$/,
  /^scripts\/release-targeted-smoke\.mjs$/,
  /^scripts\/frontend-build-marker\.mjs$/,
  /^scripts\/backend-release-marker\.mjs$/,
  /^scripts\/railway-backend-release\.mjs$/,
  /^scripts\/release-outcome\.mjs$/,
  /^scripts\/finance-smoke-equipment-discovery\.mjs$/,
  /^e2e\/helpers\/(?:api|auth|releaseSmoke)\.ts$/,
  /^e2e\/clean-production-zero-state-audit\.spec\.ts$/,
  /^e2e\/.*smoke\.spec\.ts$/,
  /^e2e\/auth-login\.spec\.ts$/,
  /^e2e\/sidebar-navigation\.spec\.ts$/,
  /^playwright(?:\.[^/]+)?\.config\.ts$/,
  /^tests\/.*\.test\.js$/,
  /^docs\/(?:release-runbook|deploy-checklist|production-smoke-checklist)\.md$/,
  /^docs\/.*(?:release|deploy|smoke|preflight).*\.md$/,
];

const BACKEND_RUNTIME_PATTERNS = [
  /^(?:server|backend|api)(?:\/|$)/,
  /^(?:routes|lib|db|storage|migrations|schema|schemas)(?:\/|$)/,
  /(?:^|\/)(?:app\.sqlite|.*\.sqlite(?:3)?|.*\.db)$/,
  /(?:^|\/)(?:railway\.json|railway\.toml|nixpacks\.toml|Procfile|render\.ya?ml|fly\.toml)$/,
  /^\.railway(?:\/|$)/,
  /^(?:server|api|backend)\.(?:config|env)\./,
];

// These paths can alter both deployment targets or their runtime contract.
// They require an explicit full-stack release decision rather than Pages-only.
const SHARED_RUNTIME_PATTERNS = [
  /(?:^|\/)\.env(?:$|[.-])/,
  /(?:^|\/)(?:[^/]*secret[^/]*|[^/]*token[^/]*|[^/]*credential[^/]*)(?:\.[^/]*)?$/i,
  /^(?:config|configs|shared|common|infrastructure|infra)(?:\/|$)/,
  /(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|docker-compose\.ya?ml)$/,
];

const DOCUMENTATION_PATTERNS = [
  /^docs\//,
  /^(?:README|AGENTS|ATTRIBUTIONS)\.md$/,
  /^guidelines\//,
];

export function normalizeChangedFilePath(value = '') {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function matchesAny(file, patterns) {
  return patterns.some(pattern => pattern.test(file));
}

export function classifyReleasePath(value = '') {
  const path = normalizeChangedFilePath(value);
  if (!path) return { path, kind: 'unknown' };

  // Priority matters: production smoke specs are deploy tooling even though
  // the broader E2E pattern classifies ordinary product specs as frontend tests.
  if (matchesAny(path, BACKEND_RUNTIME_PATTERNS)) return { path, kind: 'backend-runtime' };
  if (matchesAny(path, SHARED_RUNTIME_PATTERNS)) return { path, kind: 'shared-runtime' };
  if (matchesAny(path, DEPLOY_TOOLING_PATTERNS)) return { path, kind: 'deploy-tooling' };
  if (matchesAny(path, FRONTEND_TEST_PATTERNS)) return { path, kind: 'frontend-test' };
  if (matchesAny(path, FRONTEND_RUNTIME_PATTERNS)) return { path, kind: 'frontend-runtime' };
  if (matchesAny(path, DOCUMENTATION_PATTERNS)) return { path, kind: 'documentation' };
  return { path, kind: 'unknown' };
}

export function isFrontendRuntimeChangedFile(file = '') {
  return classifyReleasePath(file).kind === 'frontend-runtime';
}

export function isFrontendTestChangedFile(file = '') {
  return classifyReleasePath(file).kind === 'frontend-test';
}

export function isDeployToolingAllowedChangedFile(file = '') {
  return ['deploy-tooling', 'documentation'].includes(classifyReleasePath(file).kind);
}

export function isReleaseCriticalChangedFile(file = '') {
  return ['backend-runtime', 'shared-runtime'].includes(classifyReleasePath(file).kind);
}

export function isFrontendDeployToolingAllowedChangedFile(file = '') {
  return ['frontend-runtime', 'frontend-test', 'deploy-tooling', 'documentation'].includes(classifyReleasePath(file).kind);
}

export function classifyReleaseChangedFiles(changedFiles = []) {
  const paths = [...new Set((Array.isArray(changedFiles) ? changedFiles : [changedFiles])
    .map(normalizeChangedFilePath)
    .filter(Boolean))];
  const entries = paths.map(classifyReleasePath);
  const filesOfKind = kind => entries.filter(entry => entry.kind === kind).map(entry => entry.path);
  const frontendRuntimeFiles = filesOfKind('frontend-runtime');
  const frontendTestFiles = filesOfKind('frontend-test');
  const deployToolingFiles = filesOfKind('deploy-tooling');
  const backendFiles = filesOfKind('backend-runtime');
  const sharedRuntimeFiles = filesOfKind('shared-runtime');
  const unknownFiles = filesOfKind('unknown');
  const blockedFiles = [...backendFiles, ...sharedRuntimeFiles, ...unknownFiles];
  const hasFrontendRuntime = frontendRuntimeFiles.length > 0;
  const hasFrontendTests = frontendTestFiles.length > 0;
  const hasDeployTooling = deployToolingFiles.length > 0;
  let releaseType = 'docs-only';

  if (unknownFiles.length > 0 || paths.length === 0) releaseType = 'unknown';
  else if (sharedRuntimeFiles.length > 0) releaseType = 'full-stack';
  else if (backendFiles.length > 0 && hasFrontendRuntime) releaseType = 'full-stack';
  else if (backendFiles.length > 0) releaseType = 'backend';
  else if (hasFrontendRuntime && hasDeployTooling) releaseType = 'frontend-deploy-tooling';
  else if (hasFrontendRuntime) releaseType = 'frontend-only';
  else if (hasDeployTooling) releaseType = 'deploy-tooling';
  else if (hasFrontendTests) releaseType = 'frontend-only';

  const allowed = ['frontend-only', 'deploy-tooling', 'frontend-deploy-tooling', 'docs-only'].includes(releaseType);
  return {
    allowed,
    failClosed: !allowed,
    releaseType,
    changedFiles: paths,
    blockedFiles,
    entries,
    hasFrontendRuntime,
    hasFrontendTests,
    hasDeployTooling,
    requiresFrontendDeploy: hasFrontendRuntime || sharedRuntimeFiles.length > 0,
    requiresBackendDeploy: backendFiles.length > 0 || sharedRuntimeFiles.length > 0 || unknownFiles.length > 0 || paths.length === 0,
  };
}

const MANUAL_RELEASE_TYPES = new Set([
  'frontend-only',
  'backend',
  'full-stack',
  'deploy-tooling',
  'frontend-deploy-tooling',
]);

export function validateRequestedReleaseType(result = {}, requestedReleaseType = '') {
  const requested = String(requestedReleaseType || '').trim().toLowerCase();
  if (!requested) throw new Error('manual release type is required');
  if (!MANUAL_RELEASE_TYPES.has(requested)) {
    throw new Error(`unknown manual release type "${requested}"`);
  }
  const detected = String(result.releaseType || '').trim().toLowerCase();
  if (!detected || detected === 'unknown' || detected === 'docs-only') {
    throw new Error(`manual release cannot use unresolved classifier result "${detected || 'missing'}"`);
  }
  if (requested !== detected) {
    throw new Error(`manual release type mismatch: requested=${requested} detected=${detected}`);
  }
  return requested;
}

function parseArgs(argv) {
  const args = {
    changedFilesFile: '',
    githubOutput: '',
    githubSummary: '',
    expectedCommit: '',
    requestedReleaseType: '',
    requestedReleaseTypeProvided: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--changed-files-file') args.changedFilesFile = argv[++index] || '';
    else if (arg === '--github-output') args.githubOutput = argv[++index] || '';
    else if (arg === '--github-summary') args.githubSummary = argv[++index] || '';
    else if (arg === '--expected-commit') args.expectedCommit = argv[++index] || '';
    else if (arg === '--requested-release-type') {
      args.requestedReleaseTypeProvided = true;
      args.requestedReleaseType = argv[++index] || '';
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function appendLine(file, line) {
  if (file) appendFileSync(file, `${line}\n`);
}

function markdownFileList(files) {
  return files.length > 0 ? files.map(file => `- \`${file}\``).join('\n') : '- `(none)`';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.changedFilesFile) throw new Error('--changed-files-file is required');
  const files = readFileSync(args.changedFilesFile, 'utf8').split(/\r?\n/).filter(Boolean);
  const result = classifyReleaseChangedFiles(files);
  const manualReleaseType = args.requestedReleaseTypeProvided
    ? validateRequestedReleaseType(result, args.requestedReleaseType)
    : '';
  appendLine(args.githubOutput, `release_type=${result.releaseType}`);
  appendLine(args.githubOutput, `changed_files=${result.changedFiles.join(',')}`);
  appendLine(args.githubOutput, `requires_backend=${result.requiresBackendDeploy}`);

  if (result.allowed || manualReleaseType) {
    appendLine(args.githubSummary, '### Release classification');
    appendLine(args.githubSummary, '');
    appendLine(args.githubSummary, `- event: ${manualReleaseType ? 'workflow_dispatch' : 'push'}`);
    if (manualReleaseType) appendLine(args.githubSummary, `- requested release_type: \`${manualReleaseType}\``);
    appendLine(args.githubSummary, `- release_type: \`${result.releaseType}\``);
    if (args.expectedCommit) appendLine(args.githubSummary, `- expected commit: \`${args.expectedCommit}\``);
    appendLine(args.githubSummary, '- changed files:');
    appendLine(args.githubSummary, markdownFileList(result.changedFiles).replace(/^- /gm, '  - '));
    console.log(`[release-classifier] release_type=${result.releaseType}`);
    return;
  }

  appendLine(args.githubSummary, '### Production deploy blocked');
  appendLine(args.githubSummary, '');
  appendLine(args.githubSummary, `Automatic GitHub Pages deploy did not run. Required scope: \`${result.releaseType}\`.`);
  appendLine(args.githubSummary, 'Backend/shared/unknown paths require an explicit backend or full-stack release decision.');
  appendLine(args.githubSummary, '');
  appendLine(args.githubSummary, 'Blocked files:');
  appendLine(args.githubSummary, markdownFileList(result.blockedFiles));
  console.error(`[release-classifier] blocked release_type=${result.releaseType}`);
  for (const file of result.blockedFiles) console.error(` - ${file}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[release-classifier] FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
