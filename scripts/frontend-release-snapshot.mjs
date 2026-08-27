#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RELEASE_TYPES = new Set([
  'frontend-only',
  'backend',
  'full-stack',
  'deploy-tooling',
  'frontend-deploy-tooling',
]);

const HTML_MEDIA_TYPES = new Set(['text/html']);
const JAVASCRIPT_MEDIA_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
]);
const CSS_MEDIA_TYPES = new Set(['text/css']);
const MAX_RESOURCE_COUNT = 512;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const REPRESENTATION_DOMAIN = 'skytech.frontend.release-representation.v1';
const GIT_SHA_PATTERN = /^[a-f0-9]{7,40}$/;
const EXACT_GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function exactMarkerCommit(value, label = 'frontend marker commit') {
  const marker = required(value, label);
  if (!GIT_SHA_PATTERN.test(marker)) {
    throw new Error(`${label} must be 7-40 lowercase hexadecimal characters`);
  }
  return marker;
}

function exactFullCommit(value, label) {
  const commit = required(value, label);
  if (!EXACT_GIT_SHA_PATTERN.test(commit)) {
    throw new Error(`${label} must be an exact 40-character lowercase Git SHA`);
  }
  return commit;
}

function exactSha256(value, label) {
  const digest = required(value, label).toLowerCase();
  if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} is invalid`);
  return digest;
}

function parsePublicHttpUrl(value, label, { allowQuery = false } = {}) {
  let url;
  try {
    url = new URL(required(value, label));
  } catch {
    throw new Error(`${label} must be a valid public HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label} must be a credential-free public HTTP(S) URL`);
  }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error(`${label} must use HTTPS unless it is an exact loopback host`);
  }
  if (url.hash) throw new Error(`${label} must not include a fragment`);
  if (!allowQuery && url.search) throw new Error(`${label} must not include a query string`);
  return url;
}

function safeUrlLabel(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(invalid public URL)';
  }
}

function mediaType(headers) {
  return String(headers?.get?.('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareCanonicalText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function framedHashUpdate(hash, label, value) {
  const bytes = Buffer.from(String(value), 'utf8');
  hash.update(`${label}\0${bytes.length}\0`, 'utf8');
  hash.update(bytes);
  hash.update('\0', 'utf8');
}

export function buildFrontendRepresentation(resources = []) {
  if (!Array.isArray(resources) || resources.length < 2) {
    throw new Error('frontend representation requires the root document and at least one asset');
  }
  const manifest = resources.map(resource => {
    const kind = required(resource?.kind, 'frontend resource kind');
    if (!['document', 'script', 'style'].includes(kind)) {
      throw new Error('frontend resource kind must be document, script, or style');
    }
    const parsedUrl = parsePublicHttpUrl(resource?.url, 'frontend resource URL', { allowQuery: true });
    if (parsedUrl.search) throw new Error('frontend representation resources must not include query strings');
    const url = parsedUrl.href;
    const bytes = Buffer.isBuffer(resource?.bytes)
      ? resource.bytes
      : (resource?.bytes instanceof Uint8Array ? Buffer.from(resource.bytes) : null);
    if (!bytes) throw new Error('frontend representation resources must contain raw Buffer bytes');
    return {
      kind,
      url,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    };
  }).sort((left, right) => compareCanonicalText(left.url, right.url) || compareCanonicalText(left.kind, right.kind));

  if (manifest.filter(resource => resource.kind === 'document').length !== 1) {
    throw new Error('frontend representation must contain exactly one root document');
  }
  const identities = new Set(manifest.map(resource => `${resource.kind}\0${resource.url}`));
  if (identities.size !== manifest.length) {
    throw new Error('frontend representation contains duplicate resource identities');
  }

  const hash = createHash('sha256');
  framedHashUpdate(hash, 'domain', REPRESENTATION_DOMAIN);
  framedHashUpdate(hash, 'resource-count', manifest.length);
  for (const resource of manifest) {
    framedHashUpdate(hash, 'resource-kind', resource.kind);
    framedHashUpdate(hash, 'resource-url', resource.url);
    framedHashUpdate(hash, 'resource-byte-length', resource.sizeBytes);
    framedHashUpdate(hash, 'resource-sha256', resource.sha256);
  }
  return {
    version: 1,
    domain: REPRESENTATION_DOMAIN,
    resources: manifest,
    representationSha256: hash.digest('hex'),
  };
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8 text`);
  }
}

function decodeHtmlAttribute(value = '') {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function parseAttributes(source = '') {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes.set(match[1].toLowerCase(), decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

function importedResourceKind(specifier = '', fallback = 'script') {
  let pathname = '';
  try {
    pathname = new URL(specifier, 'https://frontend.invalid/').pathname.toLowerCase();
  } catch {
    return fallback;
  }
  return pathname.endsWith('.css') ? 'style' : fallback;
}

function javascriptImports(source = '') {
  const imports = [];
  if (/["'](?:assets\/|\/assets\/|\.{1,2}\/)[^"']*\.(?:js|css)\?[^"']*["']/i.test(source)) {
    throw new Error('frontend representation contains a query-bearing active resource');
  }
  const patterns = [
    /\b(?:import|export)\s*[^"'`;]*?\bfrom\s*["']((?:\.{1,2}\/|\/|https?:\/\/)[^"']+)["']/g,
    /\bimport\s*["']((?:\.{1,2}\/|\/|https?:\/\/)[^"']+)["']/g,
    /\bimport\s*\(\s*["']((?:\.{1,2}\/|\/|https?:\/\/)[^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      imports.push({ specifier: match[1], kind: importedResourceKind(match[1], 'script') });
    }
  }
  const viteAssetPattern = /["']((?:assets\/|\/assets\/|\.{1,2}\/)[^"'?#]*\.(?:js|css))["']/gi;
  let viteAsset;
  while ((viteAsset = viteAssetPattern.exec(source))) {
    const applicationRelative = viteAsset[1].startsWith('assets/');
    const specifier = applicationRelative ? `./${viteAsset[1]}` : viteAsset[1];
    imports.push({
      specifier,
      kind: importedResourceKind(specifier, 'script'),
      applicationRelative,
    });
  }
  return imports;
}

function cssImports(source = '') {
  const imports = [];
  const pattern = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s);]+))\s*\)?/gi;
  let match;
  while ((match = pattern.exec(source))) {
    imports.push({ specifier: match[1] || match[2] || match[3], kind: 'style' });
  }
  return imports;
}

function htmlLinkedResources(html = '') {
  const resources = [];
  const tagPattern = /<(script|link)\b([^>]*)>/gi;
  let match;
  while ((match = tagPattern.exec(html))) {
    const tagName = match[1].toLowerCase();
    const attributes = parseAttributes(match[2]);
    if (tagName === 'script') {
      const source = attributes.get('src');
      if (source) resources.push({ specifier: source, kind: 'script' });
      continue;
    }
    const href = attributes.get('href');
    if (!href) continue;
    const rel = new Set(String(attributes.get('rel') || '').toLowerCase().split(/\s+/).filter(Boolean));
    const as = String(attributes.get('as') || '').toLowerCase();
    if (rel.has('modulepreload') || (rel.has('preload') && as === 'script')) {
      resources.push({ specifier: href, kind: 'script' });
    } else if (rel.has('stylesheet') || (rel.has('preload') && as === 'style')) {
      resources.push({ specifier: href, kind: 'style' });
    }
  }
  return resources;
}

function inlineImports(html = '') {
  const imports = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let script;
  while ((script = scriptPattern.exec(html))) {
    const attributes = parseAttributes(script[1]);
    if (!attributes.get('src') && String(attributes.get('type') || '').toLowerCase() === 'module') {
      imports.push(...javascriptImports(script[2]));
    }
  }
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let style;
  while ((style = stylePattern.exec(html))) imports.push(...cssImports(style[1]));
  return imports;
}

function isBareModuleSpecifier(value = '') {
  return !/^(?:\.\.?\/|\/|https?:\/\/)/i.test(String(value));
}

function resolveSameOriginResource(specifier, parentUrl, frontendOrigin) {
  const candidate = required(specifier, 'frontend resource reference');
  if (isBareModuleSpecifier(candidate)) {
    throw new Error('frontend representation contains an unresolved bare module import');
  }
  let resolved;
  try {
    resolved = new URL(candidate, parentUrl);
  } catch {
    throw new Error('frontend representation contains an invalid resource URL');
  }
  if (!['http:', 'https:'].includes(resolved.protocol) || resolved.username || resolved.password) {
    throw new Error('frontend representation contains a non-public resource URL');
  }
  resolved.hash = '';
  if (resolved.origin !== frontendOrigin) {
    throw new Error(`frontend representation contains a cross-origin active resource at ${safeUrlLabel(resolved)}`);
  }
  if (resolved.search) {
    throw new Error('frontend representation contains a query-bearing active resource');
  }
  return resolved;
}

function expectedMediaTypes(kind) {
  if (kind === 'document') return HTML_MEDIA_TYPES;
  if (kind === 'style') return CSS_MEDIA_TYPES;
  return JAVASCRIPT_MEDIA_TYPES;
}

async function fetchRawResource(url, kind, {
  fetchImpl,
  timeoutMs,
  maximumBytes,
} = {}) {
  let response;
  try {
    response = await fetchImpl(url.href, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: kind === 'document'
          ? 'text/html'
          : (kind === 'style' ? 'text/css' : 'application/javascript, text/javascript'),
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache, no-store',
        Pragma: 'no-cache',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = /abort|timeout/i.test(`${error?.name || ''}`);
    throw new Error(`frontend ${kind} request ${timedOut ? 'timed out' : 'failed'} at ${safeUrlLabel(url)}`);
  }
  if (response?.status !== 200) {
    throw new Error(`frontend ${kind} must return exact HTTP 200 at ${safeUrlLabel(url)}. HTTP ${response?.status ?? 'network-error'}`);
  }
  let responseUrl;
  try {
    responseUrl = new URL(response.url);
  } catch {
    throw new Error(`frontend ${kind} response URL is missing at ${safeUrlLabel(url)}`);
  }
  if (responseUrl.href !== url.href || responseUrl.origin !== url.origin || responseUrl.pathname !== url.pathname) {
    throw new Error(`frontend ${kind} redirected or changed its exact URL at ${safeUrlLabel(url)}`);
  }
  const actualMediaType = mediaType(response.headers);
  if (!expectedMediaTypes(kind).has(actualMediaType)) {
    throw new Error(`frontend ${kind} returned an invalid content type at ${safeUrlLabel(url)}`);
  }
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`frontend ${kind} exceeds the byte limit at ${safeUrlLabel(url)}`);
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error(`frontend ${kind} response body could not be read at ${safeUrlLabel(url)}`);
  }
  if (bytes.length === 0 || bytes.length > maximumBytes) {
    throw new Error(`frontend ${kind} body must be nonempty and within the byte limit at ${safeUrlLabel(url)}`);
  }
  return bytes;
}

function frontendMarkers(texts = []) {
  const markers = new Map();
  const markerPattern = /service\s*:\s*["']frontend["'][\s\S]{0,500}?commit\s*:\s*["']([^"']*)["'][\s\S]{0,500}?releaseType\s*:\s*["']([^"']*)["']/g;
  for (const text of texts) {
    let match;
    while ((match = markerPattern.exec(text))) {
      const commit = exactMarkerCommit(match[1]);
      const releaseType = String(match[2] || '').trim().toLowerCase();
      if (!RELEASE_TYPES.has(releaseType)) throw new Error('frontend snapshot release type is missing or unknown');
      markers.set(`${commit}\0${releaseType}`, { commit, releaseType });
    }
  }
  if (markers.size !== 1) {
    throw new Error(markers.size === 0
      ? 'frontend build marker was not found in the captured resource graph'
      : 'frontend resource graph contains conflicting build markers');
  }
  return [...markers.values()][0];
}

function literalApiBindings(texts = []) {
  const bindings = new Map();
  const declarationPattern = /(?:\b(?:const|let|var)\s+|[,;])\s*([A-Za-z_$][\w$]*)\s*=\s*(["'])(https?:\/\/[^"']+)\2(\.replace\(\s*\/\\\/\$\/\s*,\s*(["'])\5\s*\))?(?=\s*[,;]|\s*$)/g;
  for (const text of texts) {
    let match;
    while ((match = declarationPattern.exec(text))) {
      const identifier = match[1];
      const literal = match[4] ? match[3].replace(/\/$/, '') : match[3];
      if (!bindings.has(identifier)) bindings.set(identifier, new Set());
      bindings.get(identifier).add(literal);
    }
  }
  return bindings;
}

function frontendBuildContexts(texts = []) {
  const contexts = [];
  const servicePattern = /service\s*:\s*["']frontend["']/g;
  for (const text of texts) {
    let match;
    while ((match = servicePattern.exec(text))) {
      const suffix = text.slice(match.index, match.index + 1_200);
      const objectEnd = suffix.indexOf('}');
      contexts.push({
        context: objectEnd >= 0 ? suffix.slice(0, objectEnd + 1) : suffix,
        sourceText: text,
      });
    }
  }
  return contexts;
}

function assertExpectedApiUrl(texts, expectedApiUrl) {
  const observed = new Set();
  const contexts = frontendBuildContexts(texts);
  if (contexts.length === 0) throw new Error('frontend snapshot API target is missing from the frontend build marker');

  for (const { context, sourceText } of contexts) {
    const expressionMatch = context.match(/apiBaseUrl\s*:\s*([^,}]+)/);
    if (!expressionMatch) throw new Error('frontend snapshot API target is missing from the frontend build marker');
    const expression = expressionMatch[1].trim();
    const direct = expression.match(/^["']([^"']+)["']$/);
    if (direct) {
      observed.add(direct[1]);
      continue;
    }
    const reference = expression.match(/^([A-Za-z_$][\w$]*)(?:\|\|window\.location\.origin)?$/);
    if (!reference) throw new Error('frontend snapshot API target expression is unsupported or ambiguous');
    const bindings = literalApiBindings([sourceText]);
    const values = bindings.get(reference[1]);
    if (!values || values.size !== 1) {
      throw new Error('frontend snapshot API target identifier does not resolve to one exact literal declaration');
    }
    observed.add([...values][0]);
  }
  if (observed.size !== 1 || !observed.has(expectedApiUrl)) {
    throw new Error('frontend snapshot API target does not exactly match the expected public API URL');
  }
}

function defaultGitExec(args, { cwd } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim().toLowerCase();
}

export function resolveFrontendMarkerCommit(markerCommit, {
  releaseCommit = '',
  repositoryPath = process.cwd(),
  gitExec = defaultGitExec,
} = {}) {
  const marker = exactMarkerCommit(markerCommit);
  const release = exactFullCommit(releaseCommit, 'expected release commit');
  let resolvedMarker;
  let resolvedRelease;
  try {
    resolvedMarker = String(gitExec(['rev-parse', '--verify', `${marker}^{commit}`], { cwd: repositoryPath }) || '').trim().toLowerCase();
    resolvedRelease = String(gitExec(['rev-parse', '--verify', `${release}^{commit}`], { cwd: repositoryPath }) || '').trim().toLowerCase();
  } catch {
    throw new Error('frontend marker or release commit could not be resolved uniquely in the checked-out repository');
  }
  exactFullCommit(resolvedMarker, 'resolved frontend commit');
  exactFullCommit(resolvedRelease, 'resolved release commit');
  if (resolvedRelease !== release) throw new Error('expected release commit did not resolve exactly');
  try {
    gitExec(['merge-base', '--is-ancestor', resolvedMarker, resolvedRelease], { cwd: repositoryPath });
  } catch {
    throw new Error('resolved frontend commit is not an ancestor of the expected release commit');
  }
  return resolvedMarker;
}

export async function captureFrontendReleaseSnapshot({
  frontendUrl = '',
  apiUrl = '',
  releaseCommit = '',
  repositoryPath = process.cwd(),
  fetchImpl = fetch,
  gitExec = defaultGitExec,
  timeoutMs = 30_000,
  cacheBustValue = randomBytes(16).toString('hex'),
} = {}) {
  const documentUrl = parsePublicHttpUrl(frontendUrl, 'frontend URL');
  const expectedApiUrl = parsePublicHttpUrl(apiUrl, 'API URL').href.replace(/\/$/, '');
  const publicCacheBust = String(cacheBustValue || '');
  if (!/^[a-f0-9]{32}$/.test(publicCacheBust)) {
    throw new Error('frontend snapshot cache-bust value must be a fresh nonsecret 32-character lowercase hexadecimal nonce');
  }
  const documentRequestUrl = new URL(documentUrl);
  documentRequestUrl.searchParams.set('frontendReleaseSnapshot', publicCacheBust);
  const applicationBaseUrl = new URL(documentUrl);
  if (!applicationBaseUrl.pathname.endsWith('/')) applicationBaseUrl.pathname += '/';
  const frontendOrigin = documentUrl.origin;
  const resources = [];
  const sourceTexts = [];
  const resourceKinds = new Map();
  const pending = [];
  let totalBytes = 0;

  const enqueue = (reference, parentUrl, kind) => {
    const resourceUrl = resolveSameOriginResource(reference, parentUrl, frontendOrigin);
    const knownKind = resourceKinds.get(resourceUrl.href);
    if (knownKind && knownKind !== kind) {
      throw new Error(`frontend resource has conflicting script/style types at ${safeUrlLabel(resourceUrl)}`);
    }
    if (!knownKind) {
      if (resourceKinds.size >= MAX_RESOURCE_COUNT) throw new Error('frontend resource graph exceeds the resource-count limit');
      resourceKinds.set(resourceUrl.href, kind);
      pending.push({ url: resourceUrl, kind });
    }
  };

  const documentBytes = await fetchRawResource(documentRequestUrl, 'document', {
    fetchImpl,
    timeoutMs,
    maximumBytes: MAX_DOCUMENT_BYTES,
  });
  totalBytes += documentBytes.length;
  const html = decodeUtf8(documentBytes, 'frontend document');
  resources.push({ kind: 'document', url: documentUrl.href, bytes: documentBytes });
  sourceTexts.push(html);
  for (const resource of htmlLinkedResources(html)) enqueue(resource.specifier, documentUrl, resource.kind);
  for (const resource of inlineImports(html)) enqueue(resource.specifier, documentUrl, resource.kind);
  if (pending.length === 0) throw new Error('frontend snapshot requires at least one same-origin script or style asset');

  for (let index = 0; index < pending.length; index += 1) {
    const { url, kind } = pending[index];
    const bytes = await fetchRawResource(url, kind, {
      fetchImpl,
      timeoutMs,
      maximumBytes: MAX_ASSET_BYTES,
    });
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('frontend resource graph exceeds the total byte limit');
    const text = decodeUtf8(bytes, `frontend ${kind}`);
    resources.push({ kind, url: url.href, bytes });
    sourceTexts.push(text);
    const imports = kind === 'style' ? cssImports(text) : javascriptImports(text);
    for (const resource of imports) {
      enqueue(resource.specifier, resource.applicationRelative ? applicationBaseUrl : url, resource.kind);
    }
  }

  const marker = frontendMarkers(sourceTexts);
  assertExpectedApiUrl(sourceTexts, expectedApiUrl);
  const frontendCommitFull = resolveFrontendMarkerCommit(marker.commit, {
    releaseCommit,
    repositoryPath,
    gitExec,
  });
  const representation = buildFrontendRepresentation(resources);
  return {
    frontendCommit: marker.commit,
    frontendCommitFull,
    releaseType: marker.releaseType,
    apiUrl: expectedApiUrl,
    representationSha256: representation.representationSha256,
    representation,
  };
}

export function verifyFrontendReleaseSnapshot(snapshot = {}, {
  expectedCommit = '',
  expectedCommitFull = '',
  expectedRepresentationSha256 = '',
} = {}) {
  const marker = exactMarkerCommit(snapshot.frontendCommit, 'actual conserved frontend marker commit');
  const expectedMarker = exactMarkerCommit(expectedCommit, 'expected conserved frontend marker commit');
  if (marker !== expectedMarker) {
    throw new Error(`conserved frontend marker mismatch. expected=${expectedMarker} actual=${marker}`);
  }
  const actualFull = exactFullCommit(snapshot.frontendCommitFull, 'actual conserved frontend full commit');
  const expectedFull = exactFullCommit(expectedCommitFull, 'expected conserved frontend full commit');
  if (actualFull !== expectedFull) {
    throw new Error(`conserved frontend full commit mismatch. expected=${expectedFull} actual=${actualFull}`);
  }
  const actualRepresentation = exactSha256(
    snapshot.representationSha256,
    'actual conserved frontend representation SHA-256',
  );
  const expectedRepresentation = exactSha256(
    expectedRepresentationSha256,
    'expected conserved frontend representation SHA-256',
  );
  if (actualRepresentation !== expectedRepresentation) {
    throw new Error('conserved frontend representation changed during backend-only deployment');
  }
  return { ...snapshot, conserved: true };
}

function parseArgs(argv) {
  const args = {
    mode: '',
    frontendUrl: process.env.PRODUCTION_FRONTEND_URL || '',
    apiUrl: process.env.PRODUCTION_API_URL || '',
    releaseCommit: process.env.EXPECTED_RELEASE_COMMIT || process.env.GITHUB_SHA || '',
    expectedCommit: process.env.EXPECTED_FRONTEND_COMMIT || '',
    expectedCommitFull: process.env.EXPECTED_FRONTEND_COMMIT_FULL || '',
    expectedRepresentationSha256: process.env.EXPECTED_FRONTEND_REPRESENTATION_SHA256 || '',
    githubOutput: process.env.GITHUB_OUTPUT || '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') args.mode = argv[++index] || '';
    else if (arg === '--frontend-url') args.frontendUrl = argv[++index] || '';
    else if (arg === '--api-url') args.apiUrl = argv[++index] || '';
    else if (arg === '--release-commit') args.releaseCommit = argv[++index] || '';
    else if (arg === '--expected-commit') args.expectedCommit = argv[++index] || '';
    else if (arg === '--expected-commit-full') args.expectedCommitFull = argv[++index] || '';
    else if (arg === '--expected-representation-sha256') args.expectedRepresentationSha256 = argv[++index] || '';
    else if (arg === '--github-output') args.githubOutput = argv[++index] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['capture', 'verify'].includes(args.mode)) throw new Error('--mode must be capture or verify');
  return args;
}

function appendOutput(path, name, value) {
  if (path) appendFileSync(path, `${name}=${value}\n`, 'utf8');
}

function appendSummary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await captureFrontendReleaseSnapshot({
    frontendUrl: args.frontendUrl,
    apiUrl: args.apiUrl,
    releaseCommit: args.releaseCommit,
  });
  const result = args.mode === 'verify'
    ? verifyFrontendReleaseSnapshot(snapshot, {
      expectedCommit: args.expectedCommit,
      expectedCommitFull: args.expectedCommitFull,
      expectedRepresentationSha256: args.expectedRepresentationSha256,
    })
    : snapshot;

  appendOutput(args.githubOutput, 'frontend_commit', result.frontendCommit);
  appendOutput(args.githubOutput, 'frontend_commit_full', result.frontendCommitFull);
  appendOutput(args.githubOutput, 'frontend_representation_sha256', result.representationSha256);
  appendSummary([
    `### Production frontend ${args.mode === 'capture' ? 'pre-deploy baseline' : 'conservation verification'}`,
    '',
    `- frontend marker commit: \`${result.frontendCommit}\``,
    `- frontend full commit: \`${result.frontendCommitFull}\``,
    `- release type: \`${result.releaseType}\``,
    `- representation SHA-256: \`${result.representationSha256}\``,
    `- resource count: \`${result.representation.resources.length}\``,
    `- result: \`${args.mode === 'verify' ? 'CONSERVED' : 'CAPTURED'}\``,
  ]);
  console.log(`[frontend-release-snapshot] mode=${args.mode}`);
  console.log(`[frontend-release-snapshot] markerCommit=${result.frontendCommit}`);
  console.log(`[frontend-release-snapshot] fullCommit=${result.frontendCommitFull}`);
  console.log(`[frontend-release-snapshot] representationSha256=${result.representationSha256}`);
  console.log(`[frontend-release-snapshot] resourceCount=${result.representation.resources.length}`);
  console.log('[frontend-release-snapshot] PASS');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[frontend-release-snapshot] FAIL: ${error.message}`);
    process.exit(1);
  });
}
