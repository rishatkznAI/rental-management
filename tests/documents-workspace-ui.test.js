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

test('documents workspace has KPI cards and type-specific generation wizard', () => {
  for (const label of ['Всего документов', 'Черновики', 'На подписи', 'Подписано', 'Просрочено', 'За месяц']) {
    assert.match(source, new RegExp(label));
  }

  assert.match(source, /documentWizardOpen/);
  assert.match(source, /handleGenerateDocument/);
  assert.match(source, /useGenerateDocument/);
  assert.match(source, /Предпросмотр/);
  assert.match(source, /Проверка обязательных полей/);
  assert.match(source, /Создайте юридическую рамку договора с клиентом/);
});

test('rental contract wizard uses searchable client selection and sends signer payload', () => {
  assert.match(source, /ClientCombobox/);
  assert.match(source, /valueId=\{wizardResolvedClientId\}/);
  assert.match(source, /clientId: wizardResolvedClientId \|\| undefined/);
  assert.match(source, /Клиенты не найдены/);
  assert.match(source, /field === 'clientId'[\s\S]*!\s*wizardResolvedClientId/);
  assert.match(source, /fillWizardClientFields/);
  assert.match(source, /signer:\s*\{/);
  assert.match(source, /requisites:\s*\{/);
  assert.match(source, /bank:\s*\{/);
  assert.match(source, /signerName: wizardForm\.signerName/);
  assert.match(source, /signerBasis: wizardForm\.signerBasis/);
  assert.match(source, /clientBankName/);
  assert.match(source, /Будет сгенерирован автоматически/);
  assert.match(source, /Будет установлена автоматически/);
});

test('rental contract form does not render universal operational fields in contract branch', () => {
  const contractBranch = source.slice(
    source.indexOf("wizardStep === 2 && wizardForm.type === 'rental_contract'"),
    source.indexOf("wizardStep === 3 && wizardForm.type === 'rental_contract'"),
  );

  for (const label of ['Аренда', 'Техника', 'Сервисная заявка', 'Доставка', 'Механик', 'Служебная машина', 'Срок подписи']) {
    assert.doesNotMatch(contractBranch, new RegExp(`>${label}<`));
  }

  for (const label of ['Клиент', 'Юридическое название клиента', 'ИНН', 'КПП', 'ОГРН', 'Юридический адрес', 'Почтовый адрес']) {
    assert.match(contractBranch, new RegExp(`>${label}<`));
  }

  assert.match(source, /ФИО подписанта/);
  assert.match(source, /Должность подписанта/);
  assert.match(source, /Основание подписания/);
  assert.match(source, /Расчётный счёт/);
  assert.match(source, /Корреспондентский счёт/);
});

test('document chain wizard renders type-specific fields and quick actions', () => {
  assert.match(source, /Спецификация привязывается к договору и фиксирует технику, срок аренды, ставку и сумму/);
  assert.match(source, /Акт подтверждает передачу конкретной техники клиенту/);
  assert.match(source, /Акт фиксирует возврат техники, состояние и замечания/);
  assert.match(source, /applyParentDocumentToWizard/);
  assert.match(source, /applySpecificationToWizard/);
  assert.match(source, /applyRentalToWizard/);
  assert.match(source, /specificationId/);
  assert.match(source, /Количество дней/);
  assert.match(source, /Создать спецификацию/);
  assert.match(source, /Создать акт передачи/);
  assert.match(source, /Создать акт возврата/);
  assert.match(source, /openDocumentChainAction\(doc, 'rental_specification'\)/);
  assert.match(source, /openDocumentChainAction\(doc, 'transfer_act_to_client'\)/);
  assert.match(source, /openDocumentChainAction\(doc, 'return_act_from_client'\)/);
});

test('documents quick action can open rental document wizard with chain context', () => {
  assert.match(source, /const requestedType = String\(quickActionContext\.type \|\| ''\)\.toLowerCase\(\)/);
  assert.match(source, /const wizardDocumentTypes: DocumentType\[\]/);
  assert.match(source, /wizardDocumentTypes\.includes\(requestedType as DocumentType\)/);
  assert.match(source, /parentDocumentId: quickActionContext\.parentDocumentId/);
  assert.match(source, /specificationId: quickActionContext\.specificationId/);
  assert.match(source, /transferDate: quickActionContext\.transferDate \|\| quickActionRental\?\.startDate/);
  assert.match(source, /returnDate: quickActionContext\.returnDate \|\| quickActionRental\?\.actualReturnDate/);
  assert.match(source, /setWizardForm\(initialClient \? fillWizardClientFields\(nextForm, initialClient\) : nextForm\)/);
});
