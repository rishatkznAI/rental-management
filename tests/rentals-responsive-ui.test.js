import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const readSource = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const rentalsSource = readSource('src/app/pages/Rentals.tsx');
const rentalDetailSource = readSource('src/app/pages/RentalDetail.tsx');
const rentalDrawerSource = readSource('src/app/components/gantt/RentalDrawer.tsx');
const ganttModalsSource = readSource('src/app/components/gantt/GanttModals.tsx');
const themeSource = readSource('src/styles/theme.css');

test('rentals desktop table is preserved while mobile cards are available', () => {
  assert.match(rentalsSource, /data-rental-desktop-table="true" className="hidden overflow-x-auto lg:block"/);
  assert.match(rentalsSource, /<table className="min-w-\[1180px\] w-full text-left text-sm">/);
  assert.match(rentalsSource, /data-rental-mobile-list="true" className="grid gap-3 p-3 lg:hidden"/);
  assert.match(rentalsSource, /data-rental-mobile-card="true"/);
  assert.match(rentalsSource, /paginatedRentalRows\.map\(renderRentalMobileCard\)/);
});

test('rentals mobile cards expose manager-safe rental fields and actions', () => {
  assert.match(rentalsSource, /data-rental-mobile-client/);
  assert.match(rentalsSource, /data-rental-mobile-equipment/);
  assert.match(rentalsSource, /data-rental-mobile-period/);
  assert.match(rentalsSource, /data-rental-mobile-status/);
  assert.match(rentalsSource, /data-rental-mobile-actions/);
  assert.match(rentalsSource, /safeRentalDateRangeLabel\(row\.rental\.startDate, row\.rental\.endDate\)/);
  assert.match(rentalsSource, /canViewPayments \? formatCurrency\(row\.amount\) : 'Скрыто'/);
  assert.match(rentalsSource, /setSelectedRental\(buildRentalDrawerRental\(row\.rental, row\.classicRental\)\)/);
});

test('rentals mobile list has readable empty state and reset path', () => {
  assert.match(rentalsSource, /Ничего не найдено/);
  assert.match(rentalsSource, /Попробуйте изменить поиск или сбросить фильтры/);
  assert.match(rentalsSource, /onClick=\{resetFilters\}/);
});

test('rental responsive containers prevent page-level horizontal overflow', () => {
  assert.match(rentalsSource, /data-rentals-responsive-root="true"/);
  assert.match(rentalsSource, /overflow-hidden overflow-x-clip bg-background/);
  assert.match(themeSource, /\.rentals-action-strip \{[\s\S]*flex flex-wrap[\s\S]*overflow-visible/);
  assert.match(rentalsSource, /flex max-w-full flex-wrap gap-x-4 gap-y-1 overflow-visible/);
  assert.doesNotMatch(rentalsSource, /data-rental-mobile-list="true"[\s\S]{0,240}<table/);
});

test('rental detail and drawer are mobile-safe without changing domain logic', () => {
  assert.match(rentalDetailSource, /data-rental-detail-responsive="true"/);
  assert.match(rentalDetailSource, /min-w-0 max-w-full[\s\S]*overflow-x-clip/);
  assert.match(rentalDetailSource, /data-rental-responsive-dialog="detail-extension"/);
  assert.match(rentalDetailSource, /data-rental-responsive-dialog="detail-document"/);
  assert.match(rentalDetailSource, /data-rental-responsive-dialog="detail-payment"/);
  assert.match(rentalDrawerSource, /data-rental-detail-drawer="true"/);
  assert.match(rentalDrawerSource, /max-w-full flex-col overflow-hidden/);
  assert.match(rentalDrawerSource, /overflow-y-auto overflow-x-hidden/);
  assert.match(rentalDrawerSource, /data-rental-responsive-dialog="drawer-extension"/);
});

test('rental create return downtime modal grids collapse on mobile', () => {
  assert.match(ganttModalsSource, /const modalBodyClass = 'min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 sm:py-5'/);
  assert.match(ganttModalsSource, /grid gap-3 sm:grid-cols-2/);
  assert.doesNotMatch(ganttModalsSource, /className="grid grid-cols-2 gap-3"/);
});
