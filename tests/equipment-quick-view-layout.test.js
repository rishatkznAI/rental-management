import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const equipmentPageSource = readFileSync(new URL('../src/app/pages/Equipment.tsx', import.meta.url), 'utf8');
const quickViewSource = readFileSync(new URL('../src/app/pages/equipment/EquipmentQuickViewPanel.tsx', import.meta.url), 'utf8');
const registryTableSource = readFileSync(new URL('../src/app/pages/equipment/EquipmentRegistryTable.tsx', import.meta.url), 'utf8');
const mobileCardsSource = readFileSync(new URL('../src/app/pages/equipment/EquipmentMobileCards.tsx', import.meta.url), 'utf8');

test('equipment quick view is rendered outside table markup', () => {
  const quickViewIndex = equipmentPageSource.indexOf('<EquipmentQuickViewPanel');
  assert.notEqual(quickViewIndex, -1);

  for (const tag of ['table', 'tbody', 'tr']) {
    const openTagBeforePanel = equipmentPageSource.lastIndexOf(`<${tag}`, quickViewIndex);
    const closeTagBeforePanel = equipmentPageSource.lastIndexOf(`</${tag}>`, quickViewIndex);
    assert.ok(
      openTagBeforePanel === -1 || closeTagBeforePanel > openTagBeforePanel,
      `EquipmentQuickViewPanel must not be nested inside <${tag}>`,
    );
  }

  assert.doesNotMatch(registryTableSource, /EquipmentQuickViewPanel/);
});

test('equipment quick view has a single render source for the selected equipment', () => {
  assert.equal(equipmentPageSource.match(/<EquipmentQuickViewPanel\b/g)?.length ?? 0, 1);
  assert.match(equipmentPageSource, /const renderQuickViewPanel = React\.useCallback/);
  assert.match(equipmentPageSource, /renderSelectedQuickView=\{isMobileQuickView \? renderQuickViewPanel : undefined\}/);
  assert.match(equipmentPageSource, /quickViewPanelData && !isMobileQuickView/);
  assert.doesNotMatch(equipmentPageSource, /createPortal\(.*EquipmentQuickViewPanel/s);
});

test('selecting equipment opens a panel with model title and inventory number context', () => {
  assert.match(equipmentPageSource, /const selectedEquipment = React\.useMemo/);
  assert.match(equipmentPageSource, /onSelectEquipment=\{\(equipment\) => setSelectedEquipmentId\(equipment\.id\)\}/);
  assert.match(mobileCardsSource, /onSelectEquipment\?\.\(equipment\)/);
  assert.match(registryTableSource, /selectedEquipmentId === equipment\.id/);
  assert.match(quickViewSource, /<h2 className="app-shell-title truncate text-lg font-extrabold text-foreground">\{title\}<\/h2>/);
  assert.match(quickViewSource, /INV \{inventoryNumber \|\| '—'\}/);
});

test('quick view close button clears selected equipment', () => {
  assert.match(equipmentPageSource, /onClose=\{\(\) => setSelectedEquipmentId\(null\)\}/);
  assert.match(quickViewSource, /aria-label="Закрыть панель техники"/);
  assert.match(quickViewSource, /onClick=\{onClose\}/);
});

test('quick view tabs are stateful and render distinct sections', () => {
  assert.match(equipmentPageSource, /activeTab=\{activeQuickViewTab\}/);
  assert.match(equipmentPageSource, /onTabChange=\{setActiveQuickViewTab\}/);
  assert.match(equipmentPageSource, /setActiveQuickViewTab\('overview'\)/);
  assert.match(quickViewSource, /EQUIPMENT_PREVIEW_TABS\.map/);
  assert.match(quickViewSource, /onClick=\{\(\) => onTabChange\(tab\.key\)\}/);

  for (const tab of ['overview', 'specs', 'documents', 'history']) {
    assert.match(quickViewSource, new RegExp(`activeTab === '${tab}'`));
  }
});

test('desktop equipment workspace keeps registry and detail panel as sibling columns', () => {
  assert.match(equipmentPageSource, /data-testid="equipment-workspace-grid"/);
  assert.match(equipmentPageSource, /equipment-workspace-grid grid min-w-0 grid-cols-1 gap-3 overflow-x-hidden/);
  assert.match(equipmentPageSource, /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(360px,430px\)\]/);
  assert.match(equipmentPageSource, /data-testid="equipment-registry-workspace"/);
  assert.match(equipmentPageSource, /data-testid="equipment-quick-view-slot"/);
  assert.match(equipmentPageSource, /className="min-w-0 overflow-hidden xl:min-w-\[360px\] xl:max-w-\[430px\]"/);

  const workspaceIndex = equipmentPageSource.indexOf('data-testid="equipment-workspace-grid"');
  const registryIndex = equipmentPageSource.indexOf('data-testid="equipment-registry-workspace"', workspaceIndex);
  const quickViewSlotIndex = equipmentPageSource.indexOf('data-testid="equipment-quick-view-slot"', workspaceIndex);
  assert.ok(workspaceIndex !== -1 && registryIndex > workspaceIndex && quickViewSlotIndex > registryIndex);
});

test('mobile equipment quick view is inserted immediately after the selected card', () => {
  assert.match(mobileCardsSource, /renderSelectedQuickView\?: \(equipment: EquipmentEntity\) => ReactNode/);
  assert.match(mobileCardsSource, /<Fragment key=\{equipment\.id\}>/);
  assert.match(mobileCardsSource, /data-testid="equipment-mobile-card"/);
  assert.match(mobileCardsSource, /isSelected && renderSelectedQuickView \? \(/);
  assert.match(mobileCardsSource, /data-testid="equipment-mobile-inline-quick-view"/);
  assert.match(mobileCardsSource, /\{renderSelectedQuickView\(equipment\)\}/);

  const cardIndex = mobileCardsSource.indexOf('data-testid="equipment-mobile-card"');
  const inlineQuickViewIndex = mobileCardsSource.indexOf('data-testid="equipment-mobile-inline-quick-view"');
  assert.ok(cardIndex !== -1 && inlineQuickViewIndex > cardIndex);
});

test('mobile equipment quick view is not rendered after the full card list', () => {
  assert.doesNotMatch(equipmentPageSource, /<EquipmentMobileCards[\s\S]*<\/EquipmentMobileCards>[\s\S]*<EquipmentQuickViewPanel/);
  assert.doesNotMatch(equipmentPageSource, /sm:hidden[\s\S]*<EquipmentMobileCards[\s\S]*<\/div>[\s\S]*<EquipmentQuickViewPanel/);
  assert.match(equipmentPageSource, /renderSelectedQuickView=\{isMobileQuickView \? renderQuickViewPanel : undefined\}/);
});

test('equipment quick view layout avoids page horizontal overflow at common smoke widths', () => {
  assert.match(equipmentPageSource, /<div className="space-y-3 overflow-x-hidden p-4/);
  assert.match(equipmentPageSource, /equipment-workspace-grid grid min-w-0 grid-cols-1 gap-3 overflow-x-hidden/);
  assert.match(equipmentPageSource, /<div className="min-w-0" data-testid="equipment-registry-workspace">/);
  assert.match(equipmentPageSource, /className="hidden min-w-0 overflow-hidden rounded-2xl/);
  assert.match(registryTableSource, /<div className="app-scroll-fade-x min-w-0 overflow-x-auto">/);
  assert.match(quickViewSource, /max-h-\[calc\(100vh-2rem\)\]/);
  assert.match(quickViewSource, /w-full min-w-0 max-w-full/);
});

test('embedded desktop quick view does not use absolute or fixed positioning', () => {
  const embeddedClassMatch = quickViewSource.match(/mode === 'embedded'\s*\n\s*\? '([^']+)'/);
  assert.ok(embeddedClassMatch, 'embedded quick view class should be explicit');
  assert.doesNotMatch(embeddedClassMatch[1], /\b(?:absolute|fixed|inset-|z-50|z-40)\b/);
});

test('quick view actions and footer controls remain clickable without blocking overlay on workspace layout', () => {
  assert.doesNotMatch(equipmentPageSource, /mode="overlay"/);
  assert.doesNotMatch(equipmentPageSource, /createPortal/);
  assert.match(equipmentPageSource, /mode="embedded"/);
  assert.match(quickViewSource, /pointer-events-auto/);
  assert.match(quickViewSource, /<EquipmentQuickActions actions=\{quickActions\} \/>/);
  assert.match(quickViewSource, /<Link to=\{`\$\{detailPath\}\?action=edit`\}/);
  assert.match(quickViewSource, /<Link to=\{detailPath\}/);
});
