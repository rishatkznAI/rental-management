#!/usr/bin/env node

const ENVIRONMENTS = new Set(['staging', 'production']);

function parseArgs(argv) {
  const args = {
    env: '',
    expectedCommit: process.env.EXPECTED_RELEASE_COMMIT || process.env.GITHUB_SHA || '',
    oldCommit: process.env.RELEASE_PREFLIGHT_OLD_COMMIT || '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env') args.env = argv[++index] || '';
    else if (arg === '--expected-commit') args.expectedCommit = argv[++index] || '';
    else if (arg === '--old-commit') args.oldCommit = argv[++index] || '';
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
  RELEASE_PREFLIGHT_OLD_COMMIT`);
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

function shortCommit(value = '') {
  return String(value || '').trim().slice(0, 12);
}

function commitsMatch(actual = '', expected = '') {
  const left = String(actual || '').trim();
  const right = String(expected || '').trim();
  if (!left || !right) return false;
  return left.startsWith(right) || right.startsWith(left);
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
  assertOk(response.ok, `frontend URL must return 2xx. HTTP ${response.status}: ${frontendUrl}`);

  const scriptUrls = extractScriptUrls(html);
  assertOk(scriptUrls.length > 0, 'frontend HTML did not include any script assets');

  const assets = [];
  for (const scriptUrl of scriptUrls) {
    const assetUrl = resolveAssetUrl(frontendUrl, scriptUrl);
    const asset = await fetchText(assetUrl);
    assertOk(asset.response.ok, `frontend asset must return 2xx. HTTP ${asset.response.status}: ${assetUrl}`);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!ENVIRONMENTS.has(args.env)) {
    printUsage();
    throw new Error('--env must be staging or production');
  }

  const prefix = args.env === 'staging' ? 'STAGING' : 'PRODUCTION';
  const frontendUrl = requiredEnv(`${prefix}_FRONTEND_URL`);
  const apiUrl = requiredEnv(`${prefix}_API_URL`);
  const expectedCommit = String(args.expectedCommit || '').trim();
  assertOk(expectedCommit, 'expected commit is required via --expected-commit, EXPECTED_RELEASE_COMMIT, or GITHUB_SHA');

  console.log(`[release-preflight] environment=${args.env}`);
  console.log(`[release-preflight] frontend=${frontendUrl}`);
  console.log(`[release-preflight] api=${apiUrl}`);
  console.log(`[release-preflight] expectedCommit=${shortCommit(expectedCommit)}`);

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
  const backendCommit = backendBuild.commitFull || backendBuild.commit || '';
  assertOk(backendCommit, '/api/version must expose backend build commit');
  assertOk(
    commitsMatch(backendCommit, expectedCommit) || commitsMatch(backendBuild.commit, shortCommit(expectedCommit)),
    `backend commit mismatch. expected=${shortCommit(expectedCommit)} actual=${backendCommit}`,
  );
  console.log(`[release-preflight] backend commit OK (${shortCommit(backendCommit)})`);

  const frontend = await readFrontendBundle(frontendUrl);
  const expectedShort = shortCommit(expectedCommit);
  const detectedApiUrls = detectApiUrlCandidates(frontend.combinedText);
  const productionLikeBackendUrls = detectProductionLikeBackendUrls(detectedApiUrls, apiUrl);
  const markerFound = frontend.combinedText.includes(expectedShort) || frontend.combinedText.includes(expectedCommit);
  const expectedApiFound = frontend.combinedText.includes(apiUrl);

  console.log(`[release-preflight] frontend marker expected=${expectedShort} found=${markerFound ? 'yes' : 'no'}`);
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

main().catch(error => {
  console.error(`[release-preflight] FAIL: ${error.message}`);
  process.exit(1);
});
