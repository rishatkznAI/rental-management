import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/pages/Documents.tsx', 'utf8');
const registry = readFileSync('src/app/lib/documentRegistry.ts', 'utf8');

test('documents workspace exposes required document types and quick filters', () => {
  for (const token of [
    'rental_contract',
    'rental_specification',
    'transfer_act_to_client',
    'return_act_from_client',
    'work_order',
    'trip_ticket',
  ]) {
    assert.match(registry, new RegExp(token));
    assert.match(source, new RegExp(token));
  }

  for (const label of ['Все', 'Договоры', 'Спецификации', 'Акты передачи', 'Акты возврата', 'Заказ-наряды', 'Путевые листы', 'Без подписи', 'Просроченные', 'Черновики']) {
    assert.match(source, new RegExp(label));
  }
});

test('documents workspace has KPI cards and unified generation wizard', () => {
  for (const label of ['Всего документов', 'Черновики', 'На подписи', 'Подписано', 'Просрочено', 'За месяц']) {
    assert.match(source, new RegExp(label));
  }

  assert.match(source, /documentWizardOpen/);
  assert.match(source, /handleGenerateDocument/);
  assert.match(source, /useGenerateDocument/);
  assert.match(source, /Предпросмотр/);
  assert.match(source, /Проверка обязательных полей/);
});

test('document generation wizard uses searchable client selection and sends clientId', () => {
  assert.match(source, /ClientCombobox/);
  assert.match(source, /valueId=\{wizardResolvedClientId\}/);
  assert.match(source, /clientId: wizardResolvedClientId \|\| undefined/);
  assert.match(source, /Клиенты не найдены/);
  assert.match(source, /field === 'clientId'[\s\S]*!\s*wizardResolvedClientId/);
  assert.match(source, /clientId: rental\?\.clientId \|\| current\.clientId \|\| ''/);
});
