import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'business-write-error-ui-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const outfile = join(directory, 'businessWriteError.mjs');
await build({
  entryPoints: ['src/app/lib/businessWriteError.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
});
const { businessWriteErrorMessage } = await import(pathToFileURL(outfile).href);

test('save forms translate the known scope denial without displaying internal diagnostics', () => {
  for (const entity of ['client', 'equipment']) {
    const message = businessWriteErrorMessage({
      status: 409,
      message: 'USER_TENANT_PROFILE_SCOPE_REQUIRED',
      body: { code: 'USER_TENANT_PROFILE_SCOPE_REQUIRED', stack: 'server/db.js:123', userId: 'legacy-user' },
    }, entity);
    assert.match(message, /Не удалось подтвердить доступ к данным компании/);
    assert.match(message, /Введённые данные остались в форме/);
    assert.doesNotMatch(message, /USER_|server\/|legacy-user/);
  }
});

test('save forms explain validation and duplicate identifiers using known business codes', () => {
  assert.match(businessWriteErrorMessage({ body: { code: 'CLIENT_INN_INVALID' } }, 'client'), /10 цифр.*12 цифр/);
  assert.match(businessWriteErrorMessage({ body: { code: 'CLIENT_INN_DUPLICATE' } }, 'client'), /Клиент с таким ИНН уже существует/);
  assert.match(businessWriteErrorMessage({ body: { code: 'EQUIPMENT_IDENTIFIER_DUPLICATE' } }, 'equipment'), /инвентарным или серийным номером/);
  assert.match(businessWriteErrorMessage({ body: { error: 'SYSTEM_FIXTURE_PROTECTED' } }, 'equipment'), /Нельзя удалить, продать/);
});

test('unknown failures, stack traces and server messages are never rendered verbatim', () => {
  const technical = 'Внутренняя ошибка: SQLITE_CONSTRAINT\n at writeData (/app/server/db.js:42) secret=internal';
  for (const status of [400, 401, 403, 404, 409, 422, 500, 503, undefined]) {
    const message = businessWriteErrorMessage({ status, message: technical, body: { error: technical, code: '__proto__' } }, 'client');
    assert.match(message, /^Не удалось сохранить клиента\./);
    assert.doesNotMatch(message, /SQLITE|internal|server\/|__proto__|Внутренняя ошибка/);
  }
  assert.match(businessWriteErrorMessage(new TypeError('Failed to fetch'), 'equipment'), /Сервер недоступен/);
  assert.match(businessWriteErrorMessage(null, 'client'), /Повторите попытку позже/);
});
