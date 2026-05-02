import { expect, test, type Page } from '@playwright/test';
import { login, loginAsAdmin, navigateInApp } from './helpers/auth';
import {
  createClient,
  createDocument,
  createEquipment,
  createRentalPair,
  ensureUser,
  findClientByCompany,
  findEquipmentBySerialNumber,
  findRentalByClient,
  findServiceTicketByReason,
  withAdminApi,
} from './helpers/api';

const sidebar = (page: Page) => page.locator('aside');

async function openSidebarSection(page: Page, name: RegExp | string, heading: RegExp | string) {
  await sidebar(page).getByRole('button', { name }).click();
  await expect(page.getByRole('heading', { name: heading, exact: typeof heading === 'string' })).toBeVisible();
}

async function selectEquipment(page: Page, query: string) {
  await page.getByText('Введите модель, INV или серийный номер…').click();
  const combobox = page.getByPlaceholder('Введите модель, INV или серийный номер…');
  await combobox.fill(query);
  await page.locator('li[data-eq-item]').first().click();
}

test.describe('production smoke', () => {
  test('admin can sign in and open core sections from sidebar', async ({ page }) => {
    await loginAsAdmin(page);

    const menu = sidebar(page);
    for (const item of [
      /^Дашборд/,
      /^Техника/,
      /^Аренды/,
      /^Сервис/,
      /^Доставка/,
      /^Документы/,
      /^Платежи/,
      /^Финансы/,
      /^Панель администратора/,
    ]) {
      await expect(menu.getByRole('button', { name: item })).toBeVisible();
    }

    await openSidebarSection(page, /^Дашборд/, 'Дашборд');
    await openSidebarSection(page, /^Техника/, 'Техника');
    await openSidebarSection(page, /^Аренды/, 'Планировщик аренды');
    await openSidebarSection(page, /^Сервис/, 'Сервис');
    await page.getByRole('tab', { name: 'Очередь сервиса' }).click();
    await expect(page.getByText('Открытых сервисных задач нет').or(page.getByText('Критично'))).toBeVisible();
    await openSidebarSection(page, /^Доставка/, 'Доставка');
    await openSidebarSection(page, /^Документы/, 'Документы');
    await openSidebarSection(page, /^Платежи/, 'Платежи');
    await openSidebarSection(page, /^Финансы/, 'Финансы');
    await expect(page.getByRole('heading', { name: 'План взыскания дебиторки' })).toBeVisible();
    await openSidebarSection(page, /^Панель администратора/, /Панель администратора|Администрирование/);
  });

  test('admin can open equipment 360 card', async ({ page }) => {
    const suffix = `equipment-360-${Date.now()}`;
    const seed = await withAdminApi(async (api) => createEquipment(api, suffix));

    await loginAsAdmin(page);
    await navigateInApp(page, `/equipment/${seed.id}`);

    await expect(page.getByRole('heading', { name: /Техника 360°/ })).toBeVisible();
    await expect(page.getByText('Сводка по занятости, сервису, документам и рискам')).toBeVisible();
    await expect(page.getByText('Текущая занятость')).toBeVisible();
    await expect(page.getByText('Сервис и готовность')).toBeVisible();
    await expect(page.getByText('Красные флаги')).toBeVisible();
  });

  test('admin can create client, equipment, rental and service ticket', async ({ page }) => {
    const suffix = `smoke-${Date.now()}`;
    const company = `Smoke Client ${suffix}`;
    const serialNumber = `SMOKE-SN-${suffix}`;
    const inventoryNumber = `SMK-${String(Date.now()).slice(-8)}`;
    const serviceReason = `Smoke service reason ${suffix}`;

    await loginAsAdmin(page);

    await navigateInApp(page, '/clients/new');
    await expect(page.getByRole('heading', { name: 'Новый клиент' })).toBeVisible();
    await page.getByPlaceholder('ООО «Компания»').fill(company);
    await page.getByPlaceholder('1234567890').fill(String(Date.now()).slice(-10));
    await page.getByPlaceholder('info@company.ru').fill(`smoke-client-${suffix}@example.local`);
    await page.getByPlaceholder('Иванов Иван Иванович').fill('Smoke Contact');
    await page.getByPlaceholder('+7 (999) 123-45-67').fill('+79990000001');
    await page.getByRole('button', { name: 'Создать клиента' }).click();
    await expect(page).toHaveURL(/#\/clients\/.+/);
    await expect(page.getByRole('heading', { name: company })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Сводка по клиенту' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Риск и задолженность' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'План взыскания' })).toBeVisible();

    const client = await withAdminApi((api) => findClientByCompany(api, company));
    expect(client.id).toBeTruthy();

    await navigateInApp(page, '/equipment/new');
    await expect(page.getByRole('heading', { name: 'Добавить технику' })).toBeVisible();
    await page.getByPlaceholder('Например, GS-SN-20240012').fill(serialNumber);
    await page.getByPlaceholder('Например, INV-006').fill(inventoryNumber);
    await page.getByPlaceholder('Например, Genie, JLG, Haulotte').fill('Smoke');
    await page.getByPlaceholder('Например, GS-3246, S-40').fill(`Lift ${suffix}`.slice(0, 24));
    await page.getByPlaceholder('Например, 2022').fill('2026');
    await page.getByPlaceholder('Например, 12.0').fill('10');
    await page.getByPlaceholder('Например, 1250').fill('1');
    await page.getByPlaceholder('Например, 90 000').fill('10000');
    await page.getByRole('button', { name: /Сохранить/ }).click();
    await expect(page).toHaveURL(/#\/equipment$/);

    const equipment = await withAdminApi((api) => findEquipmentBySerialNumber(api, serialNumber));
    expect(equipment.id).toBeTruthy();

    await navigateInApp(page, `/rentals/new?clientId=${client.id}`);
    await expect(page.getByRole('heading', { name: 'Новая аренда' })).toBeVisible();
    await selectEquipment(page, serialNumber);
    await page.locator('input[type="number"]').first().fill('1500');
    await page.getByRole('button', { name: 'Создать договор' }).click();
    await expect(page).toHaveURL(/#\/rentals$/);

    const rental = await withAdminApi((api) => findRentalByClient(api, company));
    expect(rental.id).toBeTruthy();

    await navigateInApp(page, `/rentals/${rental.id}`);
    await expect(page.getByRole('heading', { name: rental.id })).toBeVisible();
    await expect(page.getByText(company).first()).toBeVisible();

    await navigateInApp(page, '/service/new');
    await expect(page.getByRole('heading', { name: 'Новая заявка в сервис' })).toBeVisible();
    await selectEquipment(page, serialNumber);
    await page.getByPlaceholder('Например: объект клиента, склад, адрес площадки').fill('Smoke объект');
    await page.locator('select').nth(1).selectOption('medium');
    await page.getByPlaceholder('Например: Не реагирует на команды, не поднимается, ошибка на дисплее').fill(serviceReason);
    await page.getByPlaceholder('Опишите неисправность или проблему, с которой обратились в сервис.').fill(`Smoke description ${suffix}`);
    await page.getByRole('button', { name: 'Создать заявку' }).click();
    await expect(page).toHaveURL(/#\/service\/.+/);
    await expect(page.getByText(serviceReason)).toBeVisible();

    const ticket = await withAdminApi((api) => findServiceTicketByReason(api, serviceReason));
    expect(ticket.id).toBeTruthy();
  });

  test('rental manager cannot see or open admin panel', async ({ page }) => {
    await login(page, { email: 'mp2@mantall.ru', password: '1234' });

    await expect(sidebar(page).getByRole('button', { name: /^Панель администратора/ })).toBeHidden();
    await navigateInApp(page, '/admin');
    await expect(page).not.toHaveURL(/#\/admin$/);
    await expect(sidebar(page).getByRole('button', { name: /^Панель администратора/ })).toBeHidden();
  });

  test('mechanic sees only permitted sidebar sections', async ({ page }) => {
    const suffix = `mechanic-${Date.now()}`;
    const mechanic = await withAdminApi((api) => ensureUser(api, {
      name: `Smoke Mechanic ${suffix}`,
      email: `smoke-mechanic-${suffix}@example.local`,
      role: 'Механик',
      password: '1234',
    }));

    await login(page, mechanic);
    await expect(sidebar(page).getByRole('button', { name: /^Техника/ })).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^GSM/ })).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^Планировщик/ })).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^Сервис/ })).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^Сл\. машины/ })).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /^Личные настройки/ })).toBeVisible();

    for (const forbidden of [
      /^Дашборд/,
      /^Аренды/,
      /^Доставка/,
      /^Клиенты/,
      /^Документы/,
      /^Платежи/,
      /^Финансы/,
      /^Панель администратора/,
    ]) {
      await expect(sidebar(page).getByRole('button', { name: forbidden })).toBeHidden();
    }
  });

  test('admin user deletion and deactivation require confirmation', async ({ page }) => {
    const suffix = `user-action-${Date.now()}`;
    const email = `smoke-user-action-${suffix}@example.local`;
    await withAdminApi((api) => ensureUser(api, {
      name: `Smoke User Action ${suffix}`,
      email,
      role: 'Менеджер по аренде',
      password: '1234',
    }));

    await loginAsAdmin(page);
    await navigateInApp(page, '/admin');
    await expect(page.getByRole('heading', { name: 'Панель администратора' })).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toBeVisible();

    await row.locator('button[title="Удалить"]').click();
    const deleteDialog = page.getByRole('dialog', { name: 'Удалить пользователя?' });
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog.getByText('Это опасное действие. Лучше деактивировать пользователя, чтобы сохранить историю.')).toBeVisible();
    await expect(deleteDialog.getByRole('button', { name: 'Удалить' })).toBeDisabled();
    await deleteDialog.getByPlaceholder(email).fill('wrong@example.local');
    await expect(deleteDialog.getByRole('button', { name: 'Удалить' })).toBeDisabled();
    await deleteDialog.getByRole('button', { name: 'Отмена' }).click();

    await row.getByRole('button', { name: 'Деактивировать' }).click();
    const deactivateDialog = page.getByRole('dialog', { name: 'Деактивировать пользователя?' });
    await expect(deactivateDialog).toBeVisible();
    await expect(deactivateDialog.getByText('Пользователь не сможет входить в систему, но история действий сохранится.')).toBeVisible();
    await deactivateDialog.getByRole('button', { name: 'Деактивировать' }).click();
    await expect(row.getByText('Неактивен')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Активировать' })).toBeVisible();
  });

  test('admin can see linked documents in registry, rental card and dashboard', async ({ page }) => {
    const suffix = `docs-${Date.now()}`;
    const manager = `Docs Manager ${suffix}`;
    const seed = await withAdminApi(async (api) => {
      const client = await createClient(api, suffix);
      const equipment = await createEquipment(api, suffix);
      const { rental } = await createRentalPair(api, {
        client: client.company,
        equipment,
        startDate: '2026-05-03',
        endDate: '2026-05-10',
        manager,
      });
      const unsigned = await createDocument(api, {
        type: 'contract',
        number: `DOC-UNSIGNED-${suffix}`,
        clientId: client.id,
        client: client.company,
        rentalId: rental.id,
        rental: rental.id,
        equipmentId: equipment.id,
        equipmentInv: equipment.inventoryNumber,
        status: 'sent',
        date: '2026-05-02',
        manager,
      });
      const signed = await createDocument(api, {
        type: 'act',
        number: `DOC-SIGNED-${suffix}`,
        clientId: client.id,
        client: client.company,
        rentalId: rental.id,
        rental: rental.id,
        equipmentId: equipment.id,
        equipmentInv: equipment.inventoryNumber,
        status: 'signed',
        date: '2026-05-02',
        manager,
      });
      return { client, equipment, rental, unsigned, signed };
    });

    await loginAsAdmin(page);
    await navigateInApp(page, '/documents');
    await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
    await expect(page.getByText(seed.unsigned.number)).toBeVisible();
    await expect(page.getByText(seed.client.company).first()).toBeVisible();
    await expect(page.getByText(seed.rental.id).first()).toBeVisible();
    await expect(page.getByText(seed.equipment.inventoryNumber).first()).toBeVisible();

    await page.getByRole('button', { name: /Фильтры/ }).click();
    const filterDialog = page.getByRole('dialog', { name: 'Фильтры документов' });
    await expect(filterDialog.locator('.app-filter-label', { hasText: 'Клиент' })).toBeVisible();
    await expect(filterDialog.locator('.app-filter-label', { hasText: 'Аренда' })).toBeVisible();
    await expect(filterDialog.locator('.app-filter-label', { hasText: 'Тип документа' })).toBeVisible();
    await expect(filterDialog.locator('.app-filter-label', { hasText: 'Статус' })).toBeVisible();
    await expect(filterDialog.locator('.app-filter-label', { hasText: 'Ответственный менеджер' })).toBeVisible();
    await page.getByRole('button', { name: 'Без подписи' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByText(seed.unsigned.number)).toBeVisible();
    await expect(page.getByText(seed.signed.number)).toBeHidden();

    await navigateInApp(page, `/rentals/${seed.rental.id}`);
    await expect(page.getByRole('heading', { name: seed.rental.id })).toBeVisible();
    await expect(page.getByText(seed.unsigned.number).first()).toBeVisible();

    await navigateInApp(page, '/');
    await expect(page.getByText('Документы без подписи').first()).toBeVisible();
    await expect(page.getByText('Есть договоры и акты, которые нужно довести до подписания')).toBeVisible();
  });
});
