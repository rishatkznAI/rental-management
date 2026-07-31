import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(
  new URL('../src/app/components/finance/CanonicalActualPostingPanel.tsx', import.meta.url),
  'utf8',
);
const receivables = fs.readFileSync(
  new URL('../src/app/components/finance/ReceivablesPanel.tsx', import.meta.url),
  'utf8',
);
const service = fs.readFileSync(
  new URL('../src/app/services/finance.service.ts', import.meta.url),
  'utf8',
);

test('manual posting UI is placed on the existing finance receivables screen', () => {
  assert.match(receivables, /<CanonicalActualPostingPanel canManageFinance=\{canManageFinance\}/);
  assert.match(panel, /if \(!canManageFinance\) return null/);
  assert.match(panel, /enabled: canManageFinance/);
  assert.match(panel, /Создать фактическое начисление/);
  assert.match(panel, /disabled=\{!item\.canPost \|\| posting\.isPending\}/);
  assert.match(panel, /item\.disabledReason/);
});

test('confirmation contains immutable preview values from the backend', () => {
  for (const label of ['Клиент', 'Источник', 'Филиал', 'Период', 'Сумма', 'Основание', 'Готовность']) {
    assert.match(panel, new RegExp(label));
  }
  assert.match(panel, /Будет создано фактическое начисление на сумму/);
  assert.match(panel, /для клиента \{confirmation\?\.client/);
  assert.match(panel, /изменять исходные данные через этот экран нельзя/);
  assert.match(panel, />Отмена</);
  assert.match(panel, /'Создать начисление'/);
});

test('synchronous UI lock and pending state prevent double submission', () => {
  assert.match(panel, /const postingLockRef = React\.useRef\(false\)/);
  assert.match(panel, /postingLockRef\.current \|\| posting\.isPending/);
  assert.match(panel, /postingLockRef\.current = true/);
  assert.match(panel, /postingLockRef\.current = false/);
  assert.match(panel, /disabled=\{posting\.isPending\}/);
});

test('created, replayed, disabled and controlled error states are distinct', () => {
  assert.match(panel, /Фактическое начисление создано/);
  assert.match(panel, /Начисление уже было создано ранее/);
  assert.match(panel, /Функция выключена/);
  assert.match(panel, /runtime\.message/);
  assert.match(panel, /Request ID: \{notice\.requestId\}/);
  assert.match(panel, /body\.requestId/);
});

test('browser uses only authenticated product endpoints and never imports internal trigger material', () => {
  assert.match(service, /\/api\/canonical-receivables\/actual-posting\/events/);
  assert.doesNotMatch(`${service}\n${panel}`, /\/api\/internal|CANONICAL_ACTUAL_POSTING_TRIGGER_TOKEN|RUNTIME_AUTHORITIES_JSON|Bearer/);
});
