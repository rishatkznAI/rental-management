import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createClient, createRentalPair, getAnyRentableEquipment, withAdminApi } from './helpers/api';

test('core product routes keep one readable page shell without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await loginAsAdmin(page);

  const routes = [
    { route: '/', heading: 'Dashboard' },
    { route: '/rentals', heading: 'Аренды' },
    { route: '/equipment', heading: 'Техника' },
    { route: '/clients', heading: 'Клиенты' },
    { route: '/finance', heading: 'Финансы' },
    { route: '/service', heading: 'Сервис' },
    { route: '/deliveries', heading: 'Доставка' },
    { route: '/documents', heading: 'Документы' },
    { route: '/manager-report', heading: 'Отчёт по менеджерам' },
  ];

  for (const item of routes) {
    await navigateInApp(page, item.route);
    await expect(page.getByRole('heading', { name: item.heading, level: 1 }).first()).toBeVisible();
    const viewport = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth, `${item.route} must not create page-level horizontal overflow`).toBeLessThanOrEqual(viewport.innerWidth);
  }
});

test('mobile shell keeps all global utility actions visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const mobileHeader = page.locator('header').filter({ visible: true }).first();
  await expect(mobileHeader.getByRole('button', { name: 'Открыть меню' })).toBeVisible();
  await expect(mobileHeader.getByTestId('theme-toggle')).toBeVisible();
  await expect(mobileHeader.getByRole('button', { name: 'Уведомления' })).toBeVisible();
  await expect(mobileHeader.getByRole('button', { name: 'Профиль пользователя' })).toBeVisible();
  await expect(mobileHeader.locator('.app-shell-title')).toBeHidden();

  const headerButtonsFit = await mobileHeader.locator('button').evaluateAll((buttons) =>
    buttons.every((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth && rect.width > 0 && rect.height > 0;
    }),
  );
  expect(headerButtonsFit).toBe(true);
});

test('rental detail exposes an accessible back action', async ({ page }) => {
  const suffix = `ux-a11y-${Date.now()}`;
  const { rental } = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const equipment = await getAnyRentableEquipment(api);
    return createRentalPair(api, {
      client: client.company,
      clientId: client.id,
      equipment,
      startDate: '2026-09-20',
      endDate: '2026-09-27',
      status: 'active',
      ganttStatus: 'active',
    });
  });

  await loginAsAdmin(page);
  await navigateInApp(page, `/rentals/${rental.id}`);

  const backButton = page.getByRole('button', { name: 'Вернуться назад' });
  await expect(backButton).toBeVisible();
  await expect(backButton).toHaveAttribute('title', 'Вернуться назад');
});
