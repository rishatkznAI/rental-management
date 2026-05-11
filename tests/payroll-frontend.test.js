import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const permissionsSource = readFileSync(new URL('../src/app/lib/permissions.ts', import.meta.url), 'utf8');
const navigationSource = readFileSync(new URL('../src/app/lib/navigation.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/app/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
const routesSource = readFileSync(new URL('../src/app/routes.ts', import.meta.url), 'utf8');
const payrollPageSource = readFileSync(new URL('../src/app/pages/Payroll.tsx', import.meta.url), 'utf8');
const payrollServiceSource = readFileSync(new URL('../src/app/services/payroll.service.ts', import.meta.url), 'utf8');

function roleBlock(role) {
  const escaped = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = permissionsSource.match(new RegExp(`'${escaped}':\\s*\\{(?<body>[\\s\\S]*?)\\n\\s*\\},`));
  assert.ok(match?.groups?.body, `${role} permission block must exist`);
  return match.groups.body;
}

test('admin sees payroll section and non-admin roles do not', () => {
  assert.match(roleBlock('Администратор'), /\bpayroll:\s+ALL/);

  for (const role of ['Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер', 'Перевозчик', 'Инвестор']) {
    assert.doesNotMatch(roleBlock(role), /\bpayroll:\s+/, `${role} must not have payroll section`);
  }
});

test('payroll route and sidebar navigation are wired as admin-only section', () => {
  assert.match(permissionsSource, /\|\s+'payroll'/);
  assert.match(permissionsSource, /pathname\.startsWith\('\/payroll'\)\)\s+return 'payroll'/);
  assert.match(permissionsSource, /\['payroll',\s+'\/payroll'\]/);
  assert.match(routesSource, /path:\s+'payroll'[\s\S]*lazyPage\('\.\/pages\/Payroll'\)/);
  assert.match(sidebarSource, /name:\s+'Зарплата'[\s\S]*href:\s+'\/payroll'[\s\S]*section:\s+'payroll'/);
  assert.match(navigationSource, /payroll:\s+'Зарплата'/);
});

test('payroll page blocks non-admin rendering and does not request payroll data for them', () => {
  assert.match(payrollPageSource, /const isAdmin = normalizeUserRole\(user\?\.role\) === 'Администратор'/);
  assert.match(payrollPageSource, /enabled: isAdmin/);
  assert.match(payrollPageSource, /enabled: isAdmin && \/\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$\/\.test\(month\)/);
  assert.match(payrollPageSource, /if \(!isAdmin\) \{[\s\S]*Нет доступа[\s\S]*Раздел зарплаты доступен только администратору/);
});

test('payroll page has required tabs, KPI cards and payroll tables', () => {
  for (const label of [
    'Расчёт месяца',
    'Профили сотрудников',
    'История выплат',
    'Настройки KPI',
    'Сотрудников в расчёте',
    'Оклады',
    'KPI',
    'Бонусы',
    'Удержания',
    'Авансы',
    'Компенсации',
    'К выплате',
    'Статус периода',
    'Итого к выплате',
  ]) {
    assert.match(payrollPageSource, new RegExp(label));
  }

  assert.match(payrollPageSource, /formatMoney\(record\.baseSalary\)/);
  assert.match(payrollPageSource, /KPI_SCHEME_LABELS\[profile\.kpiSchemeType\]/);
  assert.match(payrollPageSource, /formatMoney\(record\.netAmount\)/);
});

test('payroll profile form supports create edit deactivate and history actions', () => {
  for (const label of [
    'Создать профиль',
    'Редактировать',
    'Деактивировать',
    'История начислений',
    'Пользователь системы',
    'Имя сотрудника',
    'Роль',
    'Оклад',
    'Тип KPI',
    'Процент KPI',
    'Фиксированный KPI',
    'Описание KPI',
    'Активен',
    'Дата начала',
    'Дата окончания',
    'Комментарий',
    'Показать неактивных пользователей',
  ]) {
    assert.match(payrollPageSource, new RegExp(label));
  }

  assert.match(payrollPageSource, /queryFn: usersService\.getAll/);
  assert.match(payrollPageSource, /enabled: isAdmin/);
  assert.match(payrollPageSource, /selectedUser\?\.name/);
  assert.match(payrollPageSource, /selectedUser\?\.role/);
  assert.match(payrollPageSource, /profile\.isActive !== false/);
  assert.match(payrollPageSource, /Для этого пользователя уже есть активный зарплатный профиль/);
  assert.match(payrollPageSource, /kpiPercent < 0 \|\| kpiPercent > 100/);
  assert.match(payrollPageSource, /setActiveTab\('history'\)/);
  assert.match(payrollPageSource, /isActive: false/);
});

test('payroll service calls dedicated backend endpoints', () => {
  for (const endpoint of [
    '/api/payroll/profiles',
    '/api/payroll/periods',
    '/api/payroll/periods/calculate',
    '/api/payroll/records',
    '/approve',
    '/mark-paid',
    '/close',
    '/adjustments',
  ]) {
    assert.match(payrollServiceSource, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('payroll month workflow exposes calculation drawer and adjustment actions', () => {
  for (const label of [
    'Расчёт сотрудника',
    'Структура выплаты',
    'Корректировки',
    'Добавить бонус',
    'Добавить удержание',
    'Добавить аванс',
    'Добавить компенсацию',
    'Изменить KPI вручную',
    'История изменений',
    'Детали расчёта',
    'Закрыть период',
    'Период или запись уже зафиксированы',
  ]) {
    assert.match(payrollPageSource, new RegExp(label));
  }

  assert.match(payrollPageSource, /getPayrollRecordAdjustments/);
  assert.match(payrollPageSource, /addPayrollAdjustment/);
  assert.match(payrollPageSource, /closePayrollPeriod/);
  assert.match(payrollPageSource, /setSelectedRecord\(result\.record\)/);
  assert.match(payrollPageSource, /selectedRecord\.status !== 'draft'/);
});

test('payroll KPI settings tab has role sections and save workflow', () => {
  for (const label of [
    'Менеджер аренды',
    'Процент от прибыли без НДС',
    'Учитывать только оплаченные сделки',
    'Учитывать только закрытые аренды',
    'Минимальный план',
    'Ручная база KPI',
    'Менеджер продаж',
    'Процент от маржи',
    'Бонус за проданную технику',
    'Учитывать только оплаченные продажи',
    'Механик сервиса',
    'Бонус за закрытую заявку',
    'Бонус за выезд',
    'Ручной бонус',
    'Офис-менеджер',
    'Индивидуальные схемы',
    'Сохранить настройки KPI',
    'База KPI требует ручного ввода',
  ]) {
    assert.match(payrollPageSource, new RegExp(label));
  }

  assert.match(payrollPageSource, /getPayrollKpiSettings/);
  assert.match(payrollPageSource, /updatePayrollKpiSettings/);
  assert.match(payrollServiceSource, /\/api\/payroll\/kpi-settings/);
});

test('payroll payout history has filters and employee history drawer', () => {
  for (const label of [
    'История сотрудника',
    'Открыть историю сотрудника',
    'Начисления по месяцам',
    'Корректировки',
    'Audit trail',
    'Старое значение',
    'Новое значение',
    'Причина',
    'Сумма от',
    'Сумма до',
  ]) {
    assert.match(payrollPageSource, new RegExp(label));
  }

  assert.match(payrollPageSource, /historyFilters/);
  assert.match(payrollPageSource, /setSelectedEmployeeId/);
  assert.match(payrollPageSource, /getPayrollAdjustments/);
  assert.match(payrollPageSource, /getPayrollAuditEvents/);
  assert.match(payrollServiceSource, /\/api\/payroll\/audit-events/);
  assert.match(payrollServiceSource, /\/api\/payroll\/adjustments/);
});
