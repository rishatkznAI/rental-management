#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ENVIRONMENTS = new Set(['staging', 'production']);
const RELEASE_TYPE_OPTIONS = ['frontend-only', 'backend', 'full-stack', 'deploy-tooling', 'frontend-deploy-tooling'];
const RELEASE_TYPES = new Set(RELEASE_TYPE_OPTIONS);
const FRONTEND_ONLY_FORBIDDEN_FILE_PATTERNS = [
  /^(server|backend|api)(\/|$)/,
  /^(routes|lib|db|storage|migrations)(\/|$)/,
  /^scripts\/(?!vite-build\.mjs$)/,
  /^\.github\/workflows\//,
  /^e2e\/helpers\/releaseSmoke\.ts$/,
  /^e2e\/production-smoke\.spec\.ts$/,
  /^e2e\/production-ui-selector-smoke\.spec\.ts$/,
  /^playwright\.production\.config\.ts$/,
  /^(?!package\.json$)(^|\/)package\.json$/,
  /^(?!package-lock\.json$)(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|deno\.lock)$/,
  /(^|\/)(railway\.json|railway\.toml|nixpacks\.toml|Procfile|Dockerfile(?:\.[^/]*)?|docker-compose\.ya?ml|render\.ya?ml|fly\.toml)$/,
  /^\.railway(\/|$)/,
  /(^|\/)\.env(?:$|[.-])/,
  /^(config|configs)(\/|$)/,
  /^(server|api|backend)\.(config|env)\./,
];
const DEPLOY_TOOLING_ALLOWED_FILE_PATTERNS = [
  /^\.github\/workflows\/.+/,
  /^scripts\/release-preflight\.mjs$/,
  /^scripts\/frontend-build-marker\.mjs$/,
  /^e2e\/helpers\/releaseSmoke\.ts$/,
  /^e2e\/production-smoke\.spec\.ts$/,
  /^e2e\/production-ui-selector-smoke\.spec\.ts$/,
  /^tests\/release-preflight\.test\.js$/,
  /^tests\/release-smoke-conservation\.test\.js$/,
  /^docs\/(?:release-runbook|deploy-checklist|production-smoke-checklist)\.md$/,
  /^docs\/.*(?:release|deploy|smoke|preflight).*\.md$/,
];
const FRONTEND_DEPLOY_TOOLING_ALLOWED_FILE_PATTERNS = [
  /^src\//,
  /^public\//,
  /^tests\/.*\.test\.js$/,
  /^docs\/.*\.md$/,
  /^index\.html$/,
  /^vite\.config\.[^/]+$/,
  /^postcss\.config\.[^/]+$/,
  /^tsconfig[^/]*\.json$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^scripts\/vite-build\.mjs$/,
  ...DEPLOY_TOOLING_ALLOWED_FILE_PATTERNS,
];
const FRONTEND_RUNTIME_FILE_PATTERNS = [
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
const RELEASE_CRITICAL_FILE_PATTERNS = [
  /^(server|backend|api)(\/|$)/,
  /^(routes|lib|db|storage|migrations)(\/|$)/,
  /^server\/data\//,
  /(^|\/)(app\.sqlite|.*\.sqlite(?:3)?|.*\.db)$/,
  /(^|\/)(railway\.json|railway\.toml|nixpacks\.toml|Procfile|Dockerfile(?:\.[^/]*)?|docker-compose\.ya?ml|render\.ya?ml|fly\.toml)$/,
  /^\.railway(\/|$)/,
  /(^|\/)\.env(?:$|[.-])/,
  /(^|\/)(?:[^/]*secret[^/]*|[^/]*token[^/]*|[^/]*credential[^/]*)(?:\.[^/]*)?$/i,
  /^(config|configs)(\/|$)/,
  /^(server|api|backend)\.(config|env)\./,
];

export function normalizeReleaseType(value = '') {
  return String(value || '').trim().toLowerCase() || 'full-stack';
}

export function parseArgs(argv) {
  const args = {
    env: '',
    expectedCommit: process.env.EXPECTED_RELEASE_COMMIT || process.env.GITHUB_SHA || '',
    oldCommit: process.env.RELEASE_PREFLIGHT_OLD_COMMIT || '',
    releaseType: normalizeReleaseType(process.env.RELEASE_TYPE || process.env.RELEASE_PREFLIGHT_RELEASE_TYPE || ''),
    changedFiles: process.env.RELEASE_PREFLIGHT_CHANGED_FILES || '',
    changedFilesFile: process.env.RELEASE_PREFLIGHT_CHANGED_FILES_FILE || '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env') args.env = argv[++index] || '';
    else if (arg === '--expected-commit') args.expectedCommit = argv[++index] || '';
    else if (arg === '--old-commit') args.oldCommit = argv[++index] || '';
    else if (arg === '--release-type') args.releaseType = normalizeReleaseType(argv[++index] || '');
    else if (arg === '--changed-files') args.changedFiles = argv[++index] || '';
    else if (arg === '--changed-files-file') args.changedFilesFile = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node scripts/release-preflight.mjs --env staging --expected-commit <sha>
  node scripts/release-preflight.mjs --env production --expected-commit <sha>

Required env by mode:
  STAGING_FRONTEND_URL, STAGING_API_URL
  PRODUCTION_FRONTEND_URL, PRODUCTION_API_URL

Optional:
  EXPECTED_RELEASE_COMMIT or GITHUB_SHA
  RELEASE_PREFLIGHT_OLD_COMMIT
  RELEASE_TYPE or --release-type ${RELEASE_TYPE_OPTIONS.join('|')}
  RELEASE_PREFLIGHT_CHANGED_FILES or --changed-files <newline-or-comma-separated paths>
  RELEASE_PREFLIGHT_CHANGED_FILES_FILE or --changed-files-file <path>`);
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

export function shortCommit(value = '') {
  return String(value || '').trim().slice(0, 12);
}

export function commitsMatch(actual = '', expected = '') {
  const left = String(actual || '').trim();
  const right = String(expected || '').trim();
  if (!left || !right) return false;
  return left.startsWith(right) || right.startsWith(left);
}

function backendCommitFromBuild(build = {}) {
  return build.commitFull || build.commit || '';
}

export function backendCommitMatchesExpected(backendBuild = {}, expectedCommit = '') {
  const backendCommit = backendCommitFromBuild(backendBuild);
  return commitsMatch(backendCommit, expectedCommit) || commitsMatch(backendBuild.commit, shortCommit(expectedCommit));
}

export function allowsBackendCommitDrift({ env = '', releaseType = '' } = {}) {
  const normalizedReleaseType = normalizeReleaseType(releaseType);
  return env === 'production' && (
    normalizedReleaseType === 'frontend-only' ||
    normalizedReleaseType === 'deploy-tooling' ||
    normalizedReleaseType === 'frontend-deploy-tooling'
  );
}

function backendDriftReleaseType(releaseType = '') {
  const normalizedReleaseType = normalizeReleaseType(releaseType);
  if (normalizedReleaseType === 'deploy-tooling' || normalizedReleaseType === 'frontend-deploy-tooling') return normalizedReleaseType;
  return 'frontend-only';
}

export function backendDriftMessage({ expectedCommit = '', backendCommit = '', releaseType = '' } = {}) {
  return `Backend commit differs from frontend commit: expected for ${backendDriftReleaseType(releaseType)} release. expected=${shortCommit(expectedCommit)} actual=${backendCommit}`;
}

function normalizeChangedFilePath(value = '') {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

export function parseChangedFiles(value = '') {
  return unique(String(value || '').split(/\r?\n|,/).map(normalizeChangedFilePath));
}

function gitChangedFiles({ expectedCommit = '', oldCommit = '' } = {}) {
  const commit = String(expectedCommit || 'HEAD').trim() || 'HEAD';
  const rangeCommands = [];
  const gitOutput = args => execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

  if (oldCommit) {
    rangeCommands.push(['diff', '--name-only', String(oldCommit).trim(), commit]);
  } else {
    try {
      const commitSha = gitOutput(['rev-parse', commit]);
      for (const baseRef of ['origin/main', 'origin/master']) {
        try {
          const mergeBase = gitOutput(['merge-base', commit, baseRef]);
          if (mergeBase && mergeBase !== commitSha) {
            rangeCommands.push(['diff', '--name-only', mergeBase, commit]);
          }
          break;
        } catch {
          // Try the next likely default branch ref.
        }
      }
    } catch {
      // Fall back to the single-commit checks below.
    }
    rangeCommands.push(['diff', '--name-only', `${commit}^1`, commit]);
    rangeCommands.push(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', commit]);
  }

  for (const args of rangeCommands) {
    try {
      const output = gitOutput(args);
      const files = parseChangedFiles(output);
      if (files.length > 0) return files;
    } catch {
      // Try the next strategy. The frontend-only gate below fails closed if none work.
    }
  }
  return [];
}

export function resolveChangedFiles(args = {}) {
  const explicitFiles = parseChangedFiles(args.changedFiles || '');
  if (explicitFiles.length > 0) return explicitFiles;

  if (args.changedFilesFile) {
    try {
      return parseChangedFiles(readFileSync(args.changedFilesFile, 'utf8'));
    } catch (error) {
      throw new Error(`could not read changed files file ${args.changedFilesFile}: ${error.message}`);
    }
  }

  return gitChangedFiles(args);
}

export function isFrontendOnlyUnsafeChangedFile(file = '') {
  const normalized = normalizeChangedFilePath(file);
  if (!normalized) return false;
  return FRONTEND_ONLY_FORBIDDEN_FILE_PATTERNS.some(pattern => pattern.test(normalized));
}

export function frontendOnlyUnsafeChangedFiles(changedFiles = []) {
  const files = Array.isArray(changedFiles) ? changedFiles : parseChangedFiles(changedFiles);
  return files.map(normalizeChangedFilePath).filter(isFrontendOnlyUnsafeChangedFile);
}

function normalizedChangedFiles(changedFiles = []) {
  return Array.isArray(changedFiles) ? changedFiles.map(normalizeChangedFilePath).filter(Boolean) : parseChangedFiles(changedFiles);
}

export function assertFrontendOnlyReleaseScope({ releaseType = '', changedFiles = [] } = {}) {
  if (normalizeReleaseType(releaseType) !== 'frontend-only') {
    return { checked: false, changedFiles: [], unsafeChangedFiles: [] };
  }

  const files = normalizedChangedFiles(changedFiles);
  assertOk(
    files.length > 0,
    'release_type=frontend-only requires changed file scope via RELEASE_PREFLIGHT_CHANGED_FILES, --changed-files, or git history',
  );

  const unsafeChangedFiles = frontendOnlyUnsafeChangedFiles(files);
  assertOk(
    unsafeChangedFiles.length === 0,
    `release_type=frontend-only is not allowed because backend/deploy-critical files changed: ${unsafeChangedFiles.join(', ')}`,
  );

  return { checked: true, changedFiles: files, unsafeChangedFiles };
}

export function isDeployToolingAllowedChangedFile(file = '') {
  const normalized = normalizeChangedFilePath(file);
  if (!normalized) return false;
  return DEPLOY_TOOLING_ALLOWED_FILE_PATTERNS.some(pattern => pattern.test(normalized));
}

export function deployToolingDisallowedChangedFiles(changedFiles = []) {
  return normalizedChangedFiles(changedFiles).filter(file => !isDeployToolingAllowedChangedFile(file));
}

export function assertDeployToolingReleaseScope({ releaseType = '', changedFiles = [] } = {}) {
  if (normalizeReleaseType(releaseType) !== 'deploy-tooling') {
    return { checked: false, changedFiles: [], disallowedChangedFiles: [] };
  }

  const files = normalizedChangedFiles(changedFiles);
  assertOk(
    files.length > 0,
    'release_type=deploy-tooling requires changed file scope via RELEASE_PREFLIGHT_CHANGED_FILES, --changed-files, or git history',
  );

  const disallowedChangedFiles = deployToolingDisallowedChangedFiles(files);
  assertOk(
    disallowedChangedFiles.length === 0,
    `release_type=deploy-tooling is allowed only for deploy/preflight/smoke tooling files. Disallowed files: ${disallowedChangedFiles.join(', ')}`,
  );

  return { checked: true, changedFiles: files, disallowedChangedFiles };
}

function matchesAnyPattern(file = '', patterns = []) {
  const normalized = normalizeChangedFilePath(file);
  return normalized && patterns.some(pattern => pattern.test(normalized));
}

export function isReleaseCriticalChangedFile(file = '') {
  return matchesAnyPattern(file, RELEASE_CRITICAL_FILE_PATTERNS);
}

export function isFrontendDeployToolingAllowedChangedFile(file = '') {
  return matchesAnyPattern(file, FRONTEND_DEPLOY_TOOLING_ALLOWED_FILE_PATTERNS);
}

export function isFrontendRuntimeChangedFile(file = '') {
  return matchesAnyPattern(file, FRONTEND_RUNTIME_FILE_PATTERNS);
}

export function frontendDeployToolingDisallowedChangedFiles(changedFiles = []) {
  return normalizedChangedFiles(changedFiles).filter(file =>
    isReleaseCriticalChangedFile(file) || !isFrontendDeployToolingAllowedChangedFile(file),
  );
}

export function assertFrontendDeployToolingReleaseScope({ releaseType = '', changedFiles = [] } = {}) {
  if (normalizeReleaseType(releaseType) !== 'frontend-deploy-tooling') {
    return { checked: false, changedFiles: [], disallowedChangedFiles: [] };
  }

  const files = normalizedChangedFiles(changedFiles);
  assertOk(
    files.length > 0,
    'release_type=frontend-deploy-tooling requires changed file scope via RELEASE_PREFLIGHT_CHANGED_FILES, --changed-files, or git history',
  );

  const disallowedChangedFiles = frontendDeployToolingDisallowedChangedFiles(files);
  assertOk(
    disallowedChangedFiles.length === 0,
    `release_type=frontend-deploy-tooling is allowed only for frontend runtime plus deploy/preflight/smoke tooling files. Disallowed files: ${disallowedChangedFiles.join(', ')}`,
  );

  assertOk(
    files.some(isFrontendRuntimeChangedFile) && files.some(isDeployToolingAllowedChangedFile),
    'release_type=frontend-deploy-tooling requires both frontend runtime and deploy/preflight/smoke tooling changes',
  );

  return { checked: true, changedFiles: files, disallowedChangedFiles };
}

export function classifyReleaseChangedFiles(changedFiles = []) {
  const files = normalizedChangedFiles(changedFiles);
  const blocked = files.filter(file => isReleaseCriticalChangedFile(file) || !isFrontendDeployToolingAllowedChangedFile(file));
  const hasFrontendRuntime = files.some(isFrontendRuntimeChangedFile);
  const hasDeployTooling = files.some(isDeployToolingAllowedChangedFile);

  if (blocked.length > 0) {
    return { allowed: false, releaseType: '', changedFiles: files, blockedFiles: blocked, hasFrontendRuntime, hasDeployTooling };
  }
  if (hasFrontendRuntime && hasDeployTooling) {
    return { allowed: true, releaseType: 'frontend-deploy-tooling', changedFiles: files, blockedFiles: [], hasFrontendRuntime, hasDeployTooling };
  }
  if (hasDeployTooling) {
    return { allowed: true, releaseType: 'deploy-tooling', changedFiles: files, blockedFiles: [], hasFrontendRuntime, hasDeployTooling };
  }
  if (hasFrontendRuntime) {
    return { allowed: true, releaseType: 'frontend-only', changedFiles: files, blockedFiles: [], hasFrontendRuntime, hasDeployTooling };
  }
  return { allowed: true, releaseType: 'docs-only', changedFiles: files, blockedFiles: [], hasFrontendRuntime, hasDeployTooling };
}

export function backendCommitGateResult({ env = '', releaseType = '', backendBuild = {}, expectedCommit = '' } = {}) {
  const backendCommit = backendCommitFromBuild(backendBuild);
  if (backendCommitMatchesExpected(backendBuild, expectedCommit)) {
    return { status: 'pass', backendCommit, message: '' };
  }
  if (allowsBackendCommitDrift({ env, releaseType })) {
    return {
      status: 'warn',
      backendCommit,
      message: backendDriftMessage({ expectedCommit, backendCommit, releaseType }),
    };
  }
  return {
    status: 'fail',
    backendCommit,
    message: `backend commit mismatch. expected=${shortCommit(expectedCommit)} actual=${backendCommit}`,
  };
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    ...options,
    headers: {
      'Cache-Control': 'no-cache',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return { response, text };
}

async function fetchJson(url) {
  const { response, text } = await fetchText(url, {
    headers: { Accept: 'application/json' },
  });
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON. HTTP ${response.status}. Body: ${text.slice(0, 300)}`);
  }
  return { response, json, text };
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeUrl(value = '') {
  return String(value || '').trim().replace(/\/$/, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function resolveAssetUrl(frontendUrl, assetPath) {
  return new URL(assetPath, `${frontendUrl.replace(/\/$/, '')}/`).toString();
}

function extractScriptUrls(html) {
  const urls = [];
  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = scriptPattern.exec(html))) {
    urls.push(match[1]);
  }
  return urls;
}

async function readFrontendBundle(frontendUrl) {
  const cacheBust = `releasePreflight=${Date.now()}`;
  const separator = frontendUrl.includes('?') ? '&' : '?';
  const { response, text: html } = await fetchText(`${frontendUrl}${separator}${cacheBust}`, {
    headers: { Accept: 'text/html' },
  });
  assertOk(response.status === 200, `frontend URL must return 200. HTTP ${response.status}: ${frontendUrl}`);

  const scriptUrls = extractScriptUrls(html);
  assertOk(scriptUrls.length > 0, 'frontend HTML did not include any script assets');

  const assets = [];
  for (const scriptUrl of scriptUrls) {
    const assetUrl = resolveAssetUrl(frontendUrl, scriptUrl);
    const asset = await fetchText(assetUrl);
    assertOk(asset.response.status === 200, `frontend asset must return 200. HTTP ${asset.response.status}: ${assetUrl}`);
    assets.push({ url: assetUrl, text: asset.text });
  }

  return {
    html,
    assets,
    combinedText: [html, ...assets.map(asset => asset.text)].join('\n'),
  };
}

function extractHttpUrls(text) {
  return unique(
    [...String(text || '').matchAll(/https?:\/\/[^\s"'`\\)<>{}]+/g)]
      .map(match => normalizeUrl(match[0].replace(/\\\//g, '/'))),
  );
}

function detectApiUrlCandidates(text) {
  return extractHttpUrls(text).filter(url =>
    /railway\.app|vercel\.app|github\.io|localhost|127\.0\.0\.1|\/api($|[/?#])/i.test(url),
  );
}

function detectProductionLikeBackendUrls(urls, expectedApiUrl) {
  const productionApiUrl = normalizeUrl(process.env.PRODUCTION_API_URL || process.env.RELEASE_PREFLIGHT_PRODUCTION_API_URL || '');
  return urls.filter(url => {
    if (normalizeUrl(url) === normalizeUrl(expectedApiUrl)) return false;
    if (productionApiUrl && normalizeUrl(url) === productionApiUrl) return true;
    return /rental-management-production|production-[a-z0-9-]*\.up\.railway\.app/i.test(url);
  });
}

function classifyHost(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.endsWith('.up.railway.app')) return 'railway';
  if (hostname.endsWith('.vercel.app')) return 'vercel';
  if (hostname.endsWith('.github.io')) return 'github-pages';
  if (hostname.endsWith('.netlify.app')) return 'netlify';
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'local';
  return 'external-static';
}

function classifyApiTarget(url, expectedApiUrl, env = '') {
  const normalized = normalizeUrl(url);
  if (normalized === normalizeUrl(expectedApiUrl)) return env || 'expected';
  if (/rental-management-production|production-[a-z0-9-]*\.up\.railway\.app/i.test(normalized)) return 'prod';
  if (/staging|stage/i.test(normalized)) return 'staging-like';
  if (/railway\.app/i.test(normalized)) return 'railway-unknown';
  if (/localhost|127\.0\.0\.1/i.test(normalized)) return 'local';
  return 'unknown';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!ENVIRONMENTS.has(args.env)) {
    printUsage();
    throw new Error('--env must be staging or production');
  }
  if (!RELEASE_TYPES.has(args.releaseType)) {
    printUsage();
    throw new Error(`--release-type must be ${RELEASE_TYPE_OPTIONS.join(', ')}`);
  }

  const prefix = args.env === 'staging' ? 'STAGING' : 'PRODUCTION';
  const expectedCommit = String(args.expectedCommit || '').trim();
  assertOk(expectedCommit, 'expected commit is required via --expected-commit, EXPECTED_RELEASE_COMMIT, or GITHUB_SHA');

  console.log(`[release-preflight] environment=${args.env}`);
  console.log(`[release-preflight] expectedCommit=${shortCommit(expectedCommit)}`);
  console.log(`[release-preflight] releaseType=${args.releaseType}`);

  if (args.releaseType === 'frontend-only') {
    const changedFiles = resolveChangedFiles(args);
    const fileScope = assertFrontendOnlyReleaseScope({ releaseType: args.releaseType, changedFiles });
    console.log(`[release-preflight] frontend-only changed files=${fileScope.changedFiles.join(', ')}`);
    console.log(`[release-preflight] frontend-only file scope OK (${fileScope.changedFiles.length} file(s))`);
  }
  if (args.releaseType === 'deploy-tooling') {
    const changedFiles = resolveChangedFiles(args);
    const fileScope = assertDeployToolingReleaseScope({ releaseType: args.releaseType, changedFiles });
    console.log(`[release-preflight] deploy-tooling changed files=${fileScope.changedFiles.join(', ')}`);
    console.log(`[release-preflight] deploy-tooling file scope OK (${fileScope.changedFiles.length} file(s))`);
  }
  if (args.releaseType === 'frontend-deploy-tooling') {
    const changedFiles = resolveChangedFiles(args);
    const fileScope = assertFrontendDeployToolingReleaseScope({ releaseType: args.releaseType, changedFiles });
    console.log(`[release-preflight] frontend-deploy-tooling changed files=${fileScope.changedFiles.join(', ')}`);
    console.log(`[release-preflight] frontend-deploy-tooling file scope OK (${fileScope.changedFiles.length} file(s))`);
  }

  const frontendUrl = requiredEnv(`${prefix}_FRONTEND_URL`);
  const apiUrl = requiredEnv(`${prefix}_API_URL`);
  console.log(`[release-preflight] frontend=${frontendUrl}`);
  console.log(`[release-preflight] frontend host type=${classifyHost(frontendUrl)}`);
  console.log(`[release-preflight] api=${apiUrl}`);

  const healthUrl = `${apiUrl}/health`;
  const health = await fetchJson(healthUrl);
  assertOk(health.response.status === 200, `/health must return 200. HTTP ${health.response.status}`);
  assertOk(health.json?.ok === true, '/health JSON must include ok=true');
  console.log('[release-preflight] backend /health OK');

  const versionUrl = `${apiUrl}/api/version`;
  const version = await fetchJson(versionUrl);
  assertOk(version.response.status === 200, `/api/version must return 200. HTTP ${version.response.status}`);
  assertOk(version.json?.ok === true, '/api/version JSON must include ok=true');
  const backendBuild = version.json?.build || {};
  const backendCommit = backendCommitFromBuild(backendBuild);
  assertOk(backendCommit, '/api/version must expose backend build commit');
  const backendGate = backendCommitGateResult({
    env: args.env,
    releaseType: args.releaseType,
    backendBuild,
    expectedCommit,
  });
  if (backendGate.status === 'warn') {
    console.warn(`[release-preflight] WARN: ${backendGate.message}`);
  } else {
    assertOk(backendGate.status === 'pass', backendGate.message);
    console.log(`[release-preflight] backend commit OK (${shortCommit(backendCommit)})`);
  }

  const frontend = await readFrontendBundle(frontendUrl);
  const expectedShort = shortCommit(expectedCommit);
  const detectedApiUrls = detectApiUrlCandidates(frontend.combinedText);
  const productionLikeBackendUrls = detectProductionLikeBackendUrls(detectedApiUrls, apiUrl);
  const markerFound = frontend.combinedText.includes(expectedShort) || frontend.combinedText.includes(expectedCommit);
  const expectedApiFound = frontend.combinedText.includes(apiUrl);
  const apiTargetClasses = unique(detectedApiUrls.map(url => classifyApiTarget(url, apiUrl, args.env)));

  console.log(`[release-preflight] frontend marker expected=${expectedShort} found=${markerFound ? 'yes' : 'no'}`);
  if (!markerFound) {
    console.log(`[release-preflight] frontend marker status=BLOCKED url=${frontendUrl}`);
  }
  console.log(`[release-preflight] frontend API target class=${apiTargetClasses.join(', ') || 'unknown'}`);
  if (args.env === 'staging' && !apiTargetClasses.includes('staging')) {
    console.log('[release-preflight] staging API target status=RISK');
  }
  console.log(`[release-preflight] frontend detected API-like URLs=${detectedApiUrls.length ? detectedApiUrls.join(', ') : 'none'}`);
  if (args.env === 'staging' && productionLikeBackendUrls.length > 0) {
    console.warn(`[release-preflight] WARNING: staging frontend bundle contains production-like backend URL(s): ${productionLikeBackendUrls.join(', ')}`);
  }

  assertOk(
    markerFound,
    `frontend build marker does not contain expected commit ${expectedShort}. detectedApiUrls=${detectedApiUrls.join(', ') || 'none'}`,
  );
  assertOk(
    expectedApiFound,
    `frontend bundle does not contain expected API URL ${apiUrl}. detectedApiUrls=${detectedApiUrls.join(', ') || 'none'}`,
  );
  if (args.env === 'staging') {
    assertOk(
      productionLikeBackendUrls.length === 0,
      `staging frontend bundle contains production-like backend URL(s): ${productionLikeBackendUrls.join(', ')}`,
    );
  }
  if (args.oldCommit) {
    const oldShort = shortCommit(args.oldCommit);
    assertOk(
      !frontend.combinedText.includes(oldShort) && !frontend.combinedText.includes(args.oldCommit),
      `frontend still appears to contain old commit ${oldShort}`,
    );
  }
  console.log(`[release-preflight] frontend marker OK (${expectedShort})`);
  console.log('[release-preflight] frontend API URL OK');
  console.log('[release-preflight] PASS');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[release-preflight] FAIL: ${error.message}`);
    process.exit(1);
  });
}
