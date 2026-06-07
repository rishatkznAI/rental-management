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
  findServiceTicketByReason,
  withAdminApi,
} from './helpers/api';

const sidebar = (page: Page) => page.locator('aside');

function collectCriticalConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  return errors;
}

async function selectEquipment(page: Page, query: string) {
  await page.getByText('Введите модель, INV или серийный номер…').click();
  const combobox = page.getByPlaceholder('Введите модель, INV или серийный номер…');
  await combobox.fill(query);
  await page.locator('li[data-eq-item]').first().click();
}

const visibleDocumentRegistryEntry = (page: Page, text: string) => page
  .locator('main article:visible, main table:visible tbody tr:visible')
  .filter({ hasText: text });

test.describe('production smoke', () => {
  test('admin can sign in and see core sidebar sections', async ({ page }) => {
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
  });

  test('admin can open equipment card and search from registry', async ({ page }) => {
    const consoleErrors = collectCriticalConsoleErrors(page);
    const suffix = `equipment-card-${Date.now()}`;
    const seed = await withAdminApi(async (api) => createEquipment(api, suffix));

    await loginAsAdmin(page);
    await navigateInApp(page, '/equipment');

    await expect(page.getByRole('heading', { name: 'Техника' })).toBeVisible();
    await page.getByPlaceholder('Модель, инв. №, SN, собственник, локация…').fill(seed.inventoryNumber);
    const equipmentLink = page.locator('main table a', { hasText: seed.inventoryNumber }).first();
    await expect(equipmentLink).toBeVisible();
    await equipmentLink.click();

    await expect(page).toHaveURL(new RegExp(`#/equipment/${seed.id}`));
    await expect(page.getByRole('heading', { name: new RegExp(seed.model) })).toBeVisible();
    await expect(page.getByText('Карточка техники')).toBeVisible();
    await expect(page.getByText('Паспорт техники')).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Аренды', exact: true })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Сервис', exact: true })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Документы', exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: new RegExp(seed.model) })).toBeVisible();
    await navigateInApp(page, '/equipment');
    await expect(page.getByRole('heading', { name: 'Техника' })).toBeVisible();
    await page.getByPlaceholder('Модель, инв. №, SN, собственник, локация…').fill(seed.serialNumber);
    await expect(page.locator('main table a', { hasText: seed.inventoryNumber }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Фильтры/ })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('admin can create client, equipment, rental and service ticket', async ({ page }) => {
    const suffix = String(Date.now());
    const company = `SMOKE-UI-Клиент-${suffix}`;
    const serialNumber = `SMOKE-UI-SN-${suffix}`;
    const inventoryNumber = `SMK-${String(Date.now()).slice(-8)}`;
    const serviceReason = `SMOKE-UI-service-${suffix}`;

    await loginAsAdmin(page);

    await navigateInApp(page, '/clients/new');
    await expect(page.getByRole('heading', { name: 'Новый клиент' })).toBeVisible();
    await page.getByPlaceholder('ООО «Компания»').fill(company);
    await page.getByPlaceholder('1234567890').fill(String(Date.now()).slice(-10));
    await page.getByPlaceholder('info@company.ru').fill(`smoke-ui-client-${suffix}@example.local`);
    await page.getByPlaceholder('Иванов Иван Иванович').fill('SMOKE UI Contact');
    await page.getByPlaceholder('+7 (999) 123-45-67').fill('+79990000001');
    await page.getByRole('button', { name: 'Создать клиента' }).click();
    await expect(page).toHaveURL(/#\/clients\/.+/);
    await expect(page.getByRole('heading', { name: company })).toBeVisible();
    await expect(page.getByText(/NaN|undefined|null/)).toHaveCount(0);

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

    const { rental } = await withAdminApi((api) => createRentalPair(api, {
      client: company,
      clientId: client.id,
      equipment,
      startDate: '2026-06-01',
      endDate: '2026-06-08',
      amount: 12000,
      manager: 'SMOKE-UI',
    }));
    expect(rental.id).toBeTruthy();

    await navigateInApp(page, `/rentals/${rental.id}`);
    await expect(page.getByRole('heading', { name: rental.id })).toBeVisible();
    await expect(page.getByText(company).first()).toBeVisible();
    await expect(page.getByText(inventoryNumber).first()).toBeVisible();

    await navigateInApp(page, '/service/new');
    await expect(page.getByRole('heading', { name: 'Новая заявка в сервис' })).toBeVisible();
    await selectEquipment(page, serialNumber);
    await page.getByPlaceholder('Например: объект клиента, склад, адрес площадки').fill('SMOKE-UI объект');
    await page.getByPlaceholder('Например: Не реагирует на команды, не поднимается, ошибка на дисплее').fill(serviceReason);
    await page.getByPlaceholder('Опишите неисправность или проблему, с которой обратились в сервис.').fill(`SMOKE-UI description ${suffix}`);
    await page.getByRole('button', { name: 'Создать заявку' }).click();
    await expect(page).toHaveURL(/#\/service\/.+/);
    const problemCard = page
      .getByRole('heading', { name: 'Проблема', exact: true })
      .locator('xpath=ancestor::*[@data-slot="card"][1]');
    await expect(problemCard.getByText(serviceReason, { exact: true })).toBeVisible();

    const ticket = await withAdminApi((api) => findServiceTicketByReason(api, serviceReason));
    expect(ticket.id).toBeTruthy();
  });

  test('rental manager cannot see or open admin panel', async ({ page }) => {
    const manager = await withAdminApi((api) => ensureUser(api, {
      name: 'mp2',
      email: 'mp2@mantall.ru',
      role: 'Менеджер по аренде',
      password: '1234',
    }));
    await login(page, manager);

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

    await page.getByRole('button', { name: /Показать всех пользователей/ }).click();
    const usersDialog = page.getByRole('dialog', { name: 'Пользователи' });
    await expect(usersDialog).toBeVisible();

    const detailedUsers = usersDialog.getByTestId('admin-users-table');
    const row = detailedUsers.getByRole('row', { name: new RegExp(email) });
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
    const documentDate = new Date().toISOString().slice(0, 10);
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
        date: documentDate,
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
        date: documentDate,
        manager,
      });
      return { client, equipment, rental, unsigned, signed };
    });

    await loginAsAdmin(page);
    await navigateInApp(page, '/documents');
    await expect(page.getByRole('heading', { name: 'Документы', exact: true })).toBeVisible();
    const unsignedRegistryEntry = visibleDocumentRegistryEntry(page, seed.unsigned.number);
    await expect(unsignedRegistryEntry).toBeVisible();
    await expect(unsignedRegistryEntry).toContainText(seed.client.company);
    await expect(unsignedRegistryEntry).toContainText(seed.rental.id);
    await expect(unsignedRegistryEntry).toContainText(seed.equipment.inventoryNumber);

    await page.getByRole('button', { name: /Контроль/ }).click();
    await expect(page.getByText('Контроль документов').first()).toBeVisible();
    await expect(page.getByText('Без подписи').first()).toBeVisible();
    await expect(page.getByText('Отправлено, ждём подпись').first()).toBeVisible();
    await expect(page.getByText(seed.client.company).first()).toBeVisible();
    await expect(page.getByText(/NaN|undefined|null/)).toHaveCount(0);

    await page.locator('main').getByRole('button', { name: /^Документы$/ }).click();

    await page.getByRole('button', { name: /Фильтры/ }).click();
    const filterDialog = page.getByRole('dialog', { name: 'Фильтры документов' });
    await expect(filterDialog.locator('.app-filter-label', { hasText: 'Клиент' })).toBeVisible();
    await expect(filterDialog.locator('.app-filter-label', { hasText: 'Аренда' })).toBeVisible();
    await expect(filterDialog.locator('.app-filter-label', { hasText: 'Тип документа' })).toBeVisible();
    await expect(filterDialog.locator('.app-filter-label', { hasText: 'Статус' })).toBeVisible();
    await expect(filterDialog.locator('.app-filter-label', { hasText: 'Ответственный менеджер' })).toBeVisible();
    await page.getByRole('button', { name: 'Без подписи' }).click();
    await page.keyboard.press('Escape');
    await expect(visibleDocumentRegistryEntry(page, seed.unsigned.number)).toBeVisible();
    await expect(visibleDocumentRegistryEntry(page, seed.signed.number)).toHaveCount(0);

    await navigateInApp(page, `/rentals/${seed.rental.id}`);
    await expect(page.getByRole('heading', { name: seed.rental.id })).toBeVisible();
    await expect(page.getByText('Документы по аренде')).toBeVisible();
    await expect(page.getByText(seed.unsigned.number).first()).toBeVisible();

    await navigateInApp(page, '/');
    await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
    await expect(page.getByText(/NaN|undefined|null/)).toHaveCount(0);
  });
});
