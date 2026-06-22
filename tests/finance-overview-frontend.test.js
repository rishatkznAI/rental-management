import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, '../src/app/pages/Finance.tsx'), 'utf8');
const receivablesSource = readFileSync(join(__dirname, '../src/app/components/finance/ReceivablesPanel.tsx'), 'utf8');
const leasingSource = readFileSync(join(__dirname, '../src/app/components/finance/LeasingPanel.tsx'), 'utf8');
const sidebarSource = readFileSync(join(__dirname, '../src/app/components/layout/Sidebar.tsx'), 'utf8');
const permissionsSource = readFileSync(join(__dirname, '../src/app/lib/permissions.ts'), 'utf8');
const dashboardSource = readFileSync(join(__dirname, '../src/app/pages/Dashboard.tsx'), 'utf8');

function roleBlock(role) {
  const start = permissionsSource.indexOf(`'${role}':`);
  if (start === -1) return '';
  const next = permissionsSource.indexOf("\n  '", start + role.length + 4);
  return permissionsSource.slice(start, next === -1 ? permissionsSource.length : next);
}

test('finance overview tab renders management dashboard blocks', () => {
  assert.match(source, /<TabsTrigger value="overview">Обзор<\/TabsTrigger>/);
  assert.match(source, /<TabsTrigger value="operations">Операции<\/TabsTrigger>/);
  assert.match(source, /<TabsTrigger value="expenses">Постоянные расходы<\/TabsTrigger>/);
  assert.match(source, /<TabsTrigger value="accounts">Счета и кассы<\/TabsTrigger>/);

  for (const label of ['Доходы', 'Расходы', 'Прибыль', 'Денежный поток', 'Остаток на счетах']) {
    assert.match(source, new RegExp(`title="${label}"|${label}`));
  }

  assert.match(source, /Динамика денежных потоков/);
  assert.match(source, /Структура расходов/);
  assert.match(source, /Последние операции/);
  assert.match(source, /Нет данных по счетам и кассам/);
});

test('finance operations tab exposes filters and operation form', () => {
  assert.match(source, /Добавить операцию/);
  assert.match(source, /operationDialogOpen/);
  assert.match(source, /handleOperationSubmit/);
  assert.match(source, /operationAmountFrom/);
  assert.match(source, /operationAmountTo/);
  assert.match(source, /operationCounterpartyFilter/);
  assert.match(source, /Счёт\/касса/);
  assert.match(source, /Связанная сущность/);
  assert.match(source, /Нельзя перевести деньги на тот же счёт/);
});

test('finance accounts tab manages real accounts and transfers', () => {
  assert.match(source, /financeService\.getAccounts/);
  assert.match(source, /financeService\.createAccount/);
  assert.match(source, /financeService\.updateAccount/);
  assert.match(source, /financeService\.transferBetweenAccounts/);
  assert.match(source, /activeFinanceAccounts/);
  assert.match(source, /accountsBalance/);

  for (const label of ['Добавить счёт', 'Изменить остаток', 'Перевод между счетами', 'Архивировать']) {
    assert.match(source, new RegExp(label));
  }

  for (const column of ['Название', 'Тип', 'Валюта', 'Остаток', 'Дата актуальности', 'Комментарий', 'Статус', 'Действия']) {
    assert.match(source, new RegExp(column));
  }

  assert.match(source, /Расчётный счёт/);
  assert.match(source, /Касса/);
  assert.match(source, /Карта/);
  assert.match(source, /Депозит/);
  assert.match(source, /Нельзя переводить на тот же счёт/);
  assert.match(source, /Проверьте активные связи перед архивированием/);
});

test('finance recurring expenses tab uses existing company expenses workflow', () => {
  assert.match(source, /COMPANY_EXPENSE_KEYS/);
  assert.match(source, /companyExpensesService\.getAll/);
  assert.match(source, /<TabsTrigger value="expenses">Постоянные расходы<\/TabsTrigger>/);

  for (const label of ['Активные расходы', 'Сумма в месяц', 'Ближайшие 7 дней', 'Просрочено', 'На паузе']) {
    assert.match(source, new RegExp(label));
  }

  for (const column of ['Название расхода', 'Категория', 'Периодичность', 'День оплаты', 'Ближайшая дата оплаты', 'Источник/счёт', 'Действия']) {
    assert.match(source, new RegExp(column));
  }

  assert.match(source, /activeExpenses = expenses\.filter\(item => item\.status === 'active'\)/);
  assert.match(source, /monthlyEquivalent\(item\)/);
  assert.match(source, /updateStatus\(expense, 'paused'\)/);
  assert.match(source, /updateStatus\(expense, 'active'\)/);
  assert.match(source, /updateStatus\(expense, 'archived'\)/);
  assert.match(source, /История расхода/);
});

test('finance receivables tab keeps verified debt workflow in new structure', () => {
  assert.match(source, /<TabsTrigger value="receivables">Дебиторка<\/TabsTrigger>/);
  assert.match(source, /<ReceivablesPanel canManageFinance=\{canManageFinance\}/);
  assert.match(receivablesSource, /financeService\.getReceivables/);
  assert.match(receivablesSource, /начислено по аренде минус фактически полученные оплаты/);

  for (const label of ['Общий долг', 'Просрочено', 'Долг 0–7 дней', 'Долг 8–30 дней', 'Долг 31–60 дней', 'Долг 60+ дней']) {
    assert.ok(receivablesSource.includes(label), `missing label: ${label}`);
  }

  for (const column of ['Клиент', 'Менеджер', 'Сумма долга', 'Просрочено дней', 'Последняя оплата', 'Связанная аренда', 'Статус взыскания', 'Действия']) {
    assert.ok(receivablesSource.includes(column), `missing column: ${column}`);
  }

  assert.match(receivablesSource, /lastPaymentDate/);
  assert.match(receivablesSource, /primaryRental/);
  assert.match(receivablesSource, /Создать уведомление/);
  assert.match(receivablesSource, /Создать претензию/);
  assert.match(receivablesSource, /Отметить спор/);
  assert.match(receivablesSource, /Закрыть\/списать/);
  assert.match(receivablesSource, /canManageFinance \? \(/);
});

test('finance leasing tab keeps paused contracts out of active load', () => {
  assert.match(source, /<TabsTrigger value="leasing">Лизинг<\/TabsTrigger>/);
  assert.match(source, /<LeasingPanel canManageFinance=\{canManageFinance\}/);
  assert.match(leasingSource, /leasingService\.getSummary/);

  for (const label of ['Активные договоры', 'Платежи в этом месяце', 'Просрочено', 'Остаток обязательств', 'Ближайшие 7 дней', 'Ближайшие 30 дней']) {
    assert.ok(leasingSource.includes(label), `missing label: ${label}`);
  }

  for (const column of ['Договор лизинга', 'Техника/предмет', 'Лизингодатель', 'Дата начала', 'Срок', 'Ежемесячный платёж', 'Следующий платёж', 'Остаток', 'Статус', 'Действия']) {
    assert.ok(leasingSource.includes(column), `missing column: ${column}`);
  }

  assert.match(leasingSource, /isFinanciallyActiveStatus\(contract\.status\)/);
  assert.match(leasingSource, /updateStatus\(contract, 'paused'\)/);
  assert.match(leasingSource, /updateStatus\(contract, 'active'\)/);
  assert.match(leasingSource, /updateStatus\(contract, 'closed'\)/);
  assert.match(leasingSource, /Открыть график платежей/);
});

test('finance leasing tab handles legacy contracts without labels safely', () => {
  assert.match(leasingSource, /function safeText\(value: unknown\): string/);
  assert.match(leasingSource, /contracts\.map\(item => safeText\(item\.leasingCompany\)\)/);
  assert.match(leasingSource, /safeText\(contract\.contractNumber\)\.toLowerCase\(\)\.includes\(query\)/);
  assert.match(leasingSource, /safeText\(contract\.leasingCompany\)\.toLowerCase\(\)\.includes\(query\)/);
  assert.match(leasingSource, /safeText\(left\.contractNumber\)\.localeCompare\(safeText\(right\.contractNumber\), 'ru'\)/);
});

test('finance overview does not expose payroll details', () => {
  assert.doesNotMatch(source, /payrollService|getPayrollRecords|getPayrollProfiles/);
  assert.match(source, /Зарплата/);
  assert.doesNotMatch(source, /employeeName|baseSalary|kpiAmount/);
});

test('finance page keeps permission guard for roles without finance access', () => {
  assert.match(source, /const canViewFinance = can\('view', 'finance'\)/);
  assert.match(source, /if \(!canViewFinance\)/);
  assert.match(source, /enabled: canViewFinance/);
  assert.match(source, /companyExpensesService\.getAll[\s\S]*enabled: canViewFinance/);
  assert.match(source, /leasingService\.getSummary[\s\S]*enabled: canViewFinance/);
  assert.match(source, /paymentsService\.getAll[\s\S]*enabled: canViewFinance/);
  assert.match(source, /financeService\.getOperations[\s\S]*enabled: canViewFinance/);
  assert.match(source, /<Navigate to="\/" replace \/>/);
  assert.match(sidebarSource, /name: 'Финансы'.+section: 'finance'/);
  assert.match(sidebarSource, /items: navigation[\s\S]*\.filter\(item =>[\s\S]*canView\(item\.section\)[\s\S]*\)/);
  assert.match(sidebarSource, /enabled: hasSearchInput && canView\('finance'\)/);
  assert.match(roleBlock('Администратор'), /finance:\s+ALL/);
  assert.match(roleBlock('Офис-менеджер'), /finance:\s+VIEW_CREATE_EDIT/);
  assert.doesNotMatch(roleBlock('Менеджер по аренде'), /finance:/);
  assert.doesNotMatch(roleBlock('Менеджер по продажам'), /finance:/);
  assert.doesNotMatch(roleBlock('Инвестор'), /finance:/);
  assert.match(dashboardSource, /enabled: canViewFinance && !!managerBreakdownName/);
});
