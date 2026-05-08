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

test('server permission matrix keeps carrier deliveries read-only', () => {
  const writeBlock = serverSource.match(/const WRITE_PERMISSIONS = \{(?<body>[\s\S]*?)\n\};/);
  const readBlock = serverSource.match(/const READ_PERMISSIONS = \{(?<body>[\s\S]*?)\n\};/);

  assert.ok(writeBlock?.groups?.body, 'WRITE_PERMISSIONS block must exist');
  assert.ok(readBlock?.groups?.body, 'READ_PERMISSIONS block must exist');
  assert.doesNotMatch(writeBlock.groups.body, /deliveries:\s*\[[^\]]*'Перевозчик'/);
  assert.match(readBlock.groups.body, /deliveries:\s*\[[^\]]*'Перевозчик'/);
});
