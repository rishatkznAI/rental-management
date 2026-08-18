import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile shell protects primary controls from long branding and the demo indicator', () => {
  const layoutSource = readSource('src/app/components/layout/Layout.tsx');
  const demoBadgeSource = readSource('src/app/components/ui/DemoModeBadge.tsx');

  assert.match(layoutSource, /flex min-w-0 flex-1 items-center gap-2/);
  assert.match(layoutSource, /hidden min-w-0 truncate[^\n]+min-\[480px\]:block/);
  assert.match(layoutSource, /flex shrink-0 items-center gap-1\.5/);
  assert.match(demoBadgeSource, /left-1\/2 top-2[^\n]+sm:left-auto sm:right-3/);
  assert.match(demoBadgeSource, /sr-only font-normal sm:not-sr-only sm:block/);
});

test('equipment action summary keeps readable light and dark theme contrast', () => {
  const equipmentSource = readSource('src/app/pages/Equipment.tsx');

  assert.match(equipmentSource, /text-warning-foreground/);
  assert.match(equipmentSource, /text-success-foreground/);
  assert.match(equipmentSource, /text-warning sm:mt-0/);
  assert.match(equipmentSource, /text-success sm:mt-0/);
});

test('rental and manager detail pages expose clear page-level navigation semantics', () => {
  const rentalDetailSource = readSource('src/app/pages/RentalDetail.tsx');
  const managerReportSource = readSource('src/app/pages/ManagerReport.tsx');

  assert.match(rentalDetailSource, /aria-label="Вернуться назад"/);
  assert.match(rentalDetailSource, /title="Вернуться назад"/);
  assert.match(managerReportSource, /<h1[^>]*>Отчёт по менеджерам<\/h1>/);
});

test('document registry keeps linked client context and row actions accessible without opening a wizard', () => {
  const documentsSource = readSource('src/app/pages/Documents.tsx');

  assert.match(documentsSource, /doc\.client \|\| doc\.clientName \|\| rental\?\.client/);
  assert.match(documentsSource, /selectedDocument\.client \|\| selectedDocument\.clientName/);
  assert.match(documentsSource, /aria-label=\{`Действия для документа \$\{row\.docNumber/);
});
