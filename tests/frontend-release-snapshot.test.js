import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildFrontendRepresentation,
  captureFrontendReleaseSnapshot,
  resolveFrontendMarkerCommit,
  verifyFrontendReleaseSnapshot,
} from '../scripts/frontend-release-snapshot.mjs';

const FRONTEND_URL = 'https://frontend.example.test/';
const API_URL = 'https://api.example.test';

function git(repositoryPath, args) {
  return execFileSync('git', args, {
    cwd: repositoryPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim().toLowerCase();
}

function commitFile(repositoryPath, name, value, message) {
  writeFileSync(join(repositoryPath, name), value, 'utf8');
  git(repositoryPath, ['add', name]);
  git(repositoryPath, ['commit', '-m', message]);
  return git(repositoryPath, ['rev-parse', 'HEAD']);
}

function createGitFixture() {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'frontend-release-snapshot-'));
  git(repositoryPath, ['init', '-b', 'main']);
  git(repositoryPath, ['config', 'user.email', 'snapshot-test@example.invalid']);
  git(repositoryPath, ['config', 'user.name', 'Snapshot Test']);
  const frontendCommit = commitFile(repositoryPath, 'frontend.txt', 'frontend-v1\n', 'frontend baseline');

  git(repositoryPath, ['checkout', '-b', 'side']);
  const sideCommit = commitFile(repositoryPath, 'side.txt', 'not-on-release-branch\n', 'side commit');
  git(repositoryPath, ['checkout', 'main']);
  const releaseCommit = commitFile(repositoryPath, 'backend.txt', 'backend-v2\n', 'backend release');

  return {
    repositoryPath,
    frontendCommit,
    sideCommit,
    releaseCommit,
    cleanup: () => rmSync(repositoryPath, { recursive: true, force: true }),
  };
}

function rawResponse(requestUrl, body, contentType, {
  status = 200,
  responseUrl = requestUrl,
  headers = {},
} = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const responseHeaders = new Headers({
    'content-type': contentType,
    ...headers,
  });
  return {
    status,
    url: responseUrl,
    headers: responseHeaders,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function frontendRoutes(markerCommit, overrides = {}) {
  const html = `<!doctype html>
    <html><head>
      <link href="/assets/main.css" rel="stylesheet">
      <link rel="modulepreload" href="/assets/preload.js">
      <link rel="preload" as="script" href="/assets/preload-two.js">
      <link as="style" href="/assets/preload.css" rel="preload">
    </head><body>
      <script type="module" src="/assets/main.js"></script>
    </body></html>`;
  const main = [
    `const build={service:"frontend",commit:"${markerCommit}",releaseType:"full-stack",apiBaseUrl:"${API_URL}"};`,
    'import{chunk}from"./chunk.js";',
    'export{reexported}from"./reexport.js";',
    'import("./lazy.js");',
    'import "./from-js.css";',
    'const __vite__mapDeps=["assets/mapped.js","assets/mapped.css","./relative-map.js","./relative-map.css"];',
  ].join('\n');
  return new Map(Object.entries({
    [FRONTEND_URL]: { body: html, type: 'text/html; charset=utf-8' },
    [`${FRONTEND_URL}assets/main.js`]: { body: main, type: 'application/javascript' },
    [`${FRONTEND_URL}assets/main.css`]: { body: '@import "./theme.css";\nbody{color:#111}', type: 'text/css' },
    [`${FRONTEND_URL}assets/preload.js`]: { body: 'export const preload=true;', type: 'text/javascript' },
    [`${FRONTEND_URL}assets/preload-two.js`]: { body: 'export const preloadTwo=true;', type: 'application/javascript' },
    [`${FRONTEND_URL}assets/preload.css`]: { body: ':root{--preload:1}', type: 'text/css' },
    [`${FRONTEND_URL}assets/chunk.js`]: { body: 'export const chunk=true;', type: 'application/javascript' },
    [`${FRONTEND_URL}assets/reexport.js`]: { body: 'export const reexported=true;', type: 'application/javascript' },
    [`${FRONTEND_URL}assets/mapped.js`]: { body: 'export const mapped=true;', type: 'application/javascript' },
    [`${FRONTEND_URL}assets/mapped.css`]: { body: '.mapped{display:block}', type: 'text/css' },
    [`${FRONTEND_URL}assets/relative-map.js`]: { body: 'export const relativeMapped=true;', type: 'application/javascript' },
    [`${FRONTEND_URL}assets/relative-map.css`]: { body: '.relative-mapped{display:block}', type: 'text/css' },
    [`${FRONTEND_URL}assets/lazy.js`]: { body: 'export const lazy=true;', type: 'application/javascript' },
    [`${FRONTEND_URL}assets/from-js.css`]: { body: '.from-js{display:block}', type: 'text/css' },
    [`${FRONTEND_URL}assets/theme.css`]: { body: ':root{color-scheme:dark}', type: 'text/css' },
    ...overrides,
  }));
}

function routeFetch(routes, calls = []) {
  return async (requestUrl, options = {}) => {
    calls.push({ requestUrl, options });
    const parsed = new URL(requestUrl);
    if (parsed.searchParams.has('frontendReleaseSnapshot')) parsed.search = '';
    const route = routes.get(requestUrl) || routes.get(parsed.href);
    if (!route) return rawResponse(requestUrl, 'missing', 'text/plain', { status: 404 });
    return rawResponse(requestUrl, route.body, route.type, route);
  };
}

async function captureFixture(gitFixture, overrides = {}, calls = []) {
  return captureFrontendReleaseSnapshot({
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    releaseCommit: gitFixture.releaseCommit,
    repositoryPath: gitFixture.repositoryPath,
    fetchImpl: routeFetch(frontendRoutes(gitFixture.frontendCommit.slice(0, 12), overrides), calls),
    cacheBustValue: 'c'.repeat(32),
  });
}

test('canonical representation is raw-byte, domain-separated, and independent of resource enumeration order', () => {
  const resources = [
    { kind: 'document', url: FRONTEND_URL, bytes: Buffer.from('<script src="/a.js"></script>') },
    { kind: 'script', url: `${FRONTEND_URL}a.js`, bytes: Buffer.from('export const a=1;') },
    { kind: 'style', url: `${FRONTEND_URL}a.css`, bytes: Buffer.from('body{color:red}') },
  ];
  const forward = buildFrontendRepresentation(resources);
  const reverse = buildFrontendRepresentation([...resources].reverse());
  assert.equal(forward.domain, 'skytech.frontend.release-representation.v1');
  assert.equal(forward.representationSha256, reverse.representationSha256);
  assert.deepEqual(forward.resources, reverse.resources);
  assert.match(forward.representationSha256, /^[a-f0-9]{64}$/);

  const changedBytes = buildFrontendRepresentation([
    resources[0],
    resources[1],
    { ...resources[2], bytes: Buffer.from('body{color:blue}') },
  ]);
  assert.notEqual(changedBytes.representationSha256, forward.representationSha256);
});

test('public snapshot URLs require HTTPS while exact loopback HTTP remains available to local tests', async () => {
  assert.throws(() => buildFrontendRepresentation([
    { kind: 'document', url: 'http://frontend.example.test/', bytes: Buffer.from('<script src="/a.js"></script>') },
    { kind: 'script', url: 'http://frontend.example.test/a.js', bytes: Buffer.from('export{}') },
  ]), /must use HTTPS/);
  assert.doesNotThrow(() => buildFrontendRepresentation([
    { kind: 'document', url: 'http://127.0.0.1:4173/', bytes: Buffer.from('<script src="/a.js"></script>') },
    { kind: 'script', url: 'http://127.0.0.1:4173/a.js', bytes: Buffer.from('export{}') },
  ]));
  assert.throws(() => buildFrontendRepresentation([
    { kind: 'document', url: FRONTEND_URL, bytes: Buffer.from('<script src="/a.js"></script>') },
    { kind: 'script', url: `${FRONTEND_URL}a.js?token=must-not-enter-manifest`, bytes: Buffer.from('export{}') },
  ]), /must not include query strings/);
  await assert.rejects(() => captureFrontendReleaseSnapshot({
    frontendUrl: 'http://frontend.example.test/',
    apiUrl: API_URL,
    releaseCommit: 'a'.repeat(40),
    fetchImpl: async () => { throw new Error('must not fetch'); },
  }), /must use HTTPS/);
});

test('capture hashes root, HTML-linked assets, and recursive static JS/CSS imports with exact request policy', async t => {
  const fixture = createGitFixture();
  t.after(fixture.cleanup);
  const calls = [];
  const snapshot = await captureFixture(fixture, {}, calls);

  assert.equal(snapshot.frontendCommit, fixture.frontendCommit.slice(0, 12));
  assert.equal(snapshot.frontendCommitFull, fixture.frontendCommit);
  assert.equal(snapshot.releaseType, 'full-stack');
  assert.equal(snapshot.apiUrl, API_URL);
  assert.match(snapshot.representationSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    snapshot.representation.resources.map(resource => resource.url),
    [
      FRONTEND_URL,
      `${FRONTEND_URL}assets/chunk.js`,
      `${FRONTEND_URL}assets/from-js.css`,
      `${FRONTEND_URL}assets/lazy.js`,
      `${FRONTEND_URL}assets/main.css`,
      `${FRONTEND_URL}assets/main.js`,
      `${FRONTEND_URL}assets/mapped.css`,
      `${FRONTEND_URL}assets/mapped.js`,
      `${FRONTEND_URL}assets/preload-two.js`,
      `${FRONTEND_URL}assets/preload.css`,
      `${FRONTEND_URL}assets/preload.js`,
      `${FRONTEND_URL}assets/reexport.js`,
      `${FRONTEND_URL}assets/relative-map.css`,
      `${FRONTEND_URL}assets/relative-map.js`,
      `${FRONTEND_URL}assets/theme.css`,
    ],
  );
  assert.equal(calls.every(call => call.options.method === 'GET'), true);
  assert.equal(calls.every(call => call.options.redirect === 'manual'), true);
  assert.equal(calls.every(call => call.options.headers['Accept-Encoding'] === 'identity'), true);
  assert.match(calls[0].requestUrl, /\?frontendReleaseSnapshot=c{32}$/);
  assert.equal(calls.slice(1).some(call => /frontendReleaseSnapshot|releasePreflight|cacheBust/i.test(call.requestUrl)), false);
  assert.equal(snapshot.representation.resources.some(resource => resource.url.includes('frontendReleaseSnapshot')), false);
});

test('quoted Vite dependency-map assets resolve from a GitHub Pages application subpath', async t => {
  const fixture = createGitFixture();
  t.after(fixture.cleanup);
  const subpathFrontendUrl = 'https://frontend.example.test/rental-management/';
  const routes = new Map();
  for (const [url, route] of frontendRoutes(fixture.frontendCommit.slice(0, 12))) {
    if (url === FRONTEND_URL) {
      routes.set(subpathFrontendUrl, {
        ...route,
        body: route.body.replaceAll('/assets/', '/rental-management/assets/'),
      });
    } else {
      routes.set(url.replace(`${FRONTEND_URL}assets/`, `${subpathFrontendUrl}assets/`), route);
    }
  }
  const snapshot = await captureFrontendReleaseSnapshot({
    frontendUrl: subpathFrontendUrl,
    apiUrl: API_URL,
    releaseCommit: fixture.releaseCommit,
    repositoryPath: fixture.repositoryPath,
    fetchImpl: routeFetch(routes),
    cacheBustValue: 'e'.repeat(32),
  });
  assert.ok(snapshot.representation.resources.some(resource => (
    resource.url === `${subpathFrontendUrl}assets/mapped.js`
  )));
  assert.equal(snapshot.representation.resources.some(resource => (
    resource.url === `${FRONTEND_URL}assets/mapped.js`
  )), false);
});

test('recursive resource-byte changes alter the conserved representation even when HTML and marker do not', async t => {
  const fixture = createGitFixture();
  t.after(fixture.cleanup);
  const baseline = await captureFixture(fixture);
  const changedCss = await captureFixture(fixture, {
    [`${FRONTEND_URL}assets/theme.css`]: { body: ':root{color-scheme:light}', type: 'text/css' },
  });
  const changedChunk = await captureFixture(fixture, {
    [`${FRONTEND_URL}assets/chunk.js`]: { body: 'export const chunk=false;', type: 'application/javascript' },
  });
  assert.equal(changedCss.frontendCommitFull, baseline.frontendCommitFull);
  assert.notEqual(changedCss.representationSha256, baseline.representationSha256);
  assert.notEqual(changedChunk.representationSha256, baseline.representationSha256);
});

test('capture resolves the real minified Vite API identifier binding and rejects ambiguous declarations', async t => {
  const fixture = createGitFixture();
  t.after(fixture.cleanup);
  const marker = fixture.frontendCommit.slice(0, 12);
  const realBuildShape = [
    `const Yt="${API_URL}/".replace(/\\/$/,"");`,
    `const build={service:"frontend",commit:"${marker}",releaseType:"full-stack",apiBaseUrl:Yt||window.location.origin};`,
  ].join('');
  const accepted = await captureFixture(fixture, {
    [`${FRONTEND_URL}assets/main.js`]: { body: realBuildShape, type: 'application/javascript' },
    [`${FRONTEND_URL}assets/preload.js`]: {
      body: 'const Yt="https://unrelated-chunk-local.example.test";export const preload=true;',
      type: 'text/javascript',
    },
  });
  assert.equal(accepted.apiUrl, API_URL);

  const ambiguousShape = [
    `const Yt="${API_URL}";`,
    'let Yt="https://other-api.example.test";',
    `const build={service:"frontend",commit:"${marker}",releaseType:"full-stack",apiBaseUrl:Yt||window.location.origin};`,
  ].join('');
  await assert.rejects(() => captureFixture(fixture, {
    [`${FRONTEND_URL}assets/main.js`]: { body: ambiguousShape, type: 'application/javascript' },
  }), /does not resolve to one exact literal declaration/);
});

test('capture fails closed on redirects and exact response URL drift', async t => {
  const fixture = createGitFixture();
  t.after(fixture.cleanup);
  await assert.rejects(
    () => captureFixture(fixture, {
      [FRONTEND_URL]: {
        body: '',
        type: 'text/html',
        status: 302,
        headers: { location: `${FRONTEND_URL}moved` },
      },
    }),
    /must return exact HTTP 200/,
  );
  await assert.rejects(
    () => captureFixture(fixture, {
      [`${FRONTEND_URL}assets/main.js`]: {
        body: 'redirected body',
        type: 'application/javascript',
        responseUrl: `${FRONTEND_URL}assets/other.js`,
      },
    }),
    /redirected or changed its exact URL/,
  );
});

test('capture rejects cross-origin active resources without fetching or logging their query', async t => {
  const fixture = createGitFixture();
  t.after(fixture.cleanup);
  const secret = 'must-not-appear-in-diagnostics';
  const routes = frontendRoutes(fixture.frontendCommit.slice(0, 12), {
    [FRONTEND_URL]: {
      body: `<script src="https://cdn.example.test/app.js?token=${secret}"></script>`,
      type: 'text/html',
    },
  });
  const calls = [];
  await assert.rejects(
    () => captureFrontendReleaseSnapshot({
      frontendUrl: FRONTEND_URL,
      apiUrl: API_URL,
      releaseCommit: fixture.releaseCommit,
      repositoryPath: fixture.repositoryPath,
      fetchImpl: routeFetch(routes, calls),
    }),
    error => {
      assert.match(error.message, /cross-origin active resource/);
      assert.doesNotMatch(error.message, /token=|must-not-appear/);
      return true;
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].requestUrl).origin + new URL(calls[0].requestUrl).pathname, FRONTEND_URL);
  assert.match(new URL(calls[0].requestUrl).search, /^\?frontendReleaseSnapshot=[a-f0-9]{32}$/);

  const marker = fixture.frontendCommit.slice(0, 12);
  const querySecret = 'private-query-value';
  await assert.rejects(() => captureFixture(fixture, {
    [`${FRONTEND_URL}assets/main.js`]: {
      body: [
        `const build={service:"frontend",commit:"${marker}",releaseType:"full-stack",apiBaseUrl:"${API_URL}"};`,
        `const __vite__mapDeps=["assets/private.js?token=${querySecret}"];`,
      ].join(''),
      type: 'application/javascript',
    },
  }), error => {
    assert.match(error.message, /query-bearing active resource/);
    assert.doesNotMatch(error.message, /token=|private-query-value/);
    return true;
  });
});

test('capture fails closed when a required asset is missing or has the wrong content type', async t => {
  const fixture = createGitFixture();
  t.after(fixture.cleanup);
  await assert.rejects(
    () => captureFixture(fixture, {
      [`${FRONTEND_URL}assets/main.css`]: { body: 'missing', type: 'text/plain', status: 404 },
    }),
    /must return exact HTTP 200.*HTTP 404/,
  );
  await assert.rejects(
    () => captureFixture(fixture, {
      [`${FRONTEND_URL}assets/main.js`]: { body: '<html>wrong</html>', type: 'text/html' },
    }),
    /invalid content type/,
  );
});

test('marker resolution requires a unique exact Git object that is an ancestor of the release commit', t => {
  const fixture = createGitFixture();
  t.after(fixture.cleanup);
  assert.equal(resolveFrontendMarkerCommit(fixture.frontendCommit.slice(0, 12), {
    releaseCommit: fixture.releaseCommit,
    repositoryPath: fixture.repositoryPath,
  }), fixture.frontendCommit);
  assert.equal(resolveFrontendMarkerCommit(fixture.frontendCommit, {
    releaseCommit: fixture.releaseCommit,
    repositoryPath: fixture.repositoryPath,
  }), fixture.frontendCommit);
  assert.throws(() => resolveFrontendMarkerCommit(fixture.frontendCommit.slice(0, 6), {
    releaseCommit: fixture.releaseCommit,
    repositoryPath: fixture.repositoryPath,
  }), /7-40 lowercase hexadecimal/);
  assert.throws(() => resolveFrontendMarkerCommit(fixture.sideCommit.slice(0, 12), {
    releaseCommit: fixture.releaseCommit,
    repositoryPath: fixture.repositoryPath,
  }), /not an ancestor/);
  assert.throws(() => resolveFrontendMarkerCommit('f'.repeat(12), {
    releaseCommit: fixture.releaseCommit,
    repositoryPath: fixture.repositoryPath,
  }), /could not be resolved uniquely/);
});

test('verification requires exact baseline marker, resolved full commit, and representation digest', async t => {
  const fixture = createGitFixture();
  t.after(fixture.cleanup);
  const snapshot = await captureFixture(fixture);
  assert.equal(verifyFrontendReleaseSnapshot(snapshot, {
    expectedCommit: snapshot.frontendCommit,
    expectedCommitFull: snapshot.frontendCommitFull,
    expectedRepresentationSha256: snapshot.representationSha256,
  }).conserved, true);

  const cases = [
    [{ expectedCommit: '', expectedCommitFull: snapshot.frontendCommitFull, expectedRepresentationSha256: snapshot.representationSha256 }, /marker commit is required/],
    [{ expectedCommit: 'a'.repeat(12), expectedCommitFull: snapshot.frontendCommitFull, expectedRepresentationSha256: snapshot.representationSha256 }, /marker mismatch/],
    [{ expectedCommit: snapshot.frontendCommit, expectedCommitFull: 'a'.repeat(40), expectedRepresentationSha256: snapshot.representationSha256 }, /full commit mismatch/],
    [{ expectedCommit: snapshot.frontendCommit, expectedCommitFull: snapshot.frontendCommitFull, expectedRepresentationSha256: 'a'.repeat(64) }, /representation changed/],
  ];
  for (const [expected, pattern] of cases) {
    assert.throws(() => verifyFrontendReleaseSnapshot(snapshot, expected), pattern);
  }
});
