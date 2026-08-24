import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Client Detail renders archive and conditional archived-object delete actions', () => {
  const source = fs.readFileSync(path.join(root, 'src/app/pages/ClientDetail.tsx'), 'utf8');
  assert.match(source, /object\.status !== 'archived'/);
  assert.match(source, /lifecycle\?\.canDelete/);
  assert.match(source, /handleArchiveObject/);
  assert.match(source, /handleDeleteObject/);
});

test('Client Detail explains history and fail-closed scope checks', () => {
  const source = fs.readFileSync(path.join(root, 'src/app/pages/ClientDetail.tsx'), 'utf8');
  assert.match(source, /Удаление недоступно: объект используется в истории клиента\./);
  assert.match(source, /не удалось безопасно проверить историю и scope объекта/);
});

test('Client Object frontend service uses only dedicated lifecycle endpoints', () => {
  const source = fs.readFileSync(path.join(root, 'src/app/services/client-objects.service.ts'), 'utf8');
  assert.match(source, /client_objects\/\$\{id\}\/lifecycle/);
  assert.match(source, /client_objects\/\$\{id\}\/archive/);
  assert.match(source, /api\.delete<[^>]+>\(`\/api\/client_objects\/\$\{id\}`\)/);
});
