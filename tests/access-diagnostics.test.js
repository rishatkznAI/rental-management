import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSource = readFileSync(new URL('../server/server.js', import.meta.url), 'utf8');

test('access diagnostics expose service endpoint details safely', () => {
  assert.match(serverSource, /'\/api\/service': \{\s*\.\.\.serviceEndpoint/);
  assert.match(serverSource, /rawCount/);
  assert.match(serverSource, /sanitizedCount/);
  assert.match(serverSource, /statusCode/);
  assert.match(serverSource, /rawRole/);
  assert.match(serverSource, /normalizedRole/);
  assert.match(serverSource, /readableCollections/);
  assert.match(serverSource, /safeSamples/);
  assert.match(serverSource, /sampleServiceForDiagnostics/);
});
