import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const servicePageSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');
const warrantyTabSource = readFileSync(new URL('../src/app/components/service/WarrantyClaimsTab.tsx', import.meta.url), 'utf8');
const warrantyServiceSource = readFileSync(new URL('../src/app/services/warranty-claims.service.ts', import.meta.url), 'utf8');

test('service exposes reclamations as a top-level warranty_claims tab', () => {
  assert.match(servicePageSource, /value="warranty"/);
  assert.match(servicePageSource, /Рекламации/);
  assert.match(servicePageSource, /<WarrantyClaimsTab/);
  assert.match(warrantyServiceSource, /\/api\/warranty_claims/);
  assert.match(warrantyTabSource, /useWarrantyClaimsList\(\)/);
});

test('reclamations are sourced from warranty_claims and not duplicated from ordinary service tickets', () => {
  assert.match(warrantyTabSource, /const \{ data: claims = \[\], isLoading \} = useWarrantyClaimsList\(\)/);
  assert.match(warrantyTabSource, /return claims\s*\n\s*\.filter/);
  assert.doesNotMatch(warrantyTabSource, /tickets\s*\.\s*filter\([^)]*reclam/i);
  assert.match(servicePageSource, /filter\(isRegularServiceTicket\)/);
});

test('reclamations search covers number equipment client linked ticket and reason', () => {
  for (const field of [
    'claim.id',
    'claim.number',
    'claim.serviceTicketId',
    'claim.equipmentLabel',
    'claim.client',
    'claim.clientName',
    'claim.reason',
    'claim.failureDescription',
  ]) {
    assert.match(warrantyTabSource, new RegExp(field.replace('.', '\\.')));
  }
  assert.match(warrantyTabSource, /placeholder="№, техника, клиент, заявка, причина\.\.\."/);
});

test('reclamations status filter normalizes legacy statuses only for display', () => {
  assert.match(warrantyTabSource, /function normalizeManagementStatus\(status\?: string\)/);
  assert.match(warrantyTabSource, /normalizeManagementStatus\(claim\.status\) === statusFilter/);
  assert.match(warrantyTabSource, /MANAGEMENT_STATUS_META/);
  for (const label of ['Новая', 'На рассмотрении', 'Требует ремонта', 'Ожидание клиента', 'Закрыта', 'Отклонена']) {
    assert.match(warrantyTabSource, new RegExp(label));
  }
});

test('reclamations expose required KPIs including overdue and closed this month', () => {
  for (const label of ['Активные', 'Новые', 'На рассмотрении', 'Просрочены', 'Закрыты за месяц']) {
    assert.match(warrantyTabSource, new RegExp(label));
  }
  assert.match(warrantyTabSource, /isResponseOverdue/);
  assert.match(warrantyTabSource, /isClaimClosedThisMonth/);
  assert.match(warrantyTabSource, /Срок реакции прошёл/);
});

test('reclamations table and card show linked service ticket with quick open action', () => {
  for (const header of ['№ рекламации', 'Техника', 'Клиент', 'Заявка', 'Причина', 'Статус', 'Ответственный', 'Срок реакции', 'Обновлено']) {
    assert.match(warrantyTabSource, new RegExp(header));
  }
  assert.match(warrantyTabSource, /claim\.serviceTicketId \|\| '—'/);
  assert.match(warrantyTabSource, /Открыть сервисную заявку \{selectedClaim\.serviceTicketId\}/);
  assert.match(warrantyTabSource, /onOpenTicket\(selectedClaim\.serviceTicketId!\)/);
});

test('reclamations frontend RBAC does not broaden tab access to all mechanics', () => {
  assert.match(servicePageSource, /const canManageWarrantyClaims = \['Администратор', 'Офис-менеджер'\]\.includes\(normalizedRole\) \|\| isWarrantyMechanicRole\(normalizedRole\)/);
  assert.doesNotMatch(servicePageSource, /const canManageWarrantyClaims = can\('edit', 'service'\)/);
});
