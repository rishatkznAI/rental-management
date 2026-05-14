import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const permissionsSource = readFileSync(new URL('../src/app/lib/permissions.ts', import.meta.url), 'utf8');
const userStorageSource = readFileSync(new URL('../src/app/lib/userStorage.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/app/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
const notificationCenterSource = readFileSync(new URL('../src/app/components/layout/NotificationCenter.tsx', import.meta.url), 'utf8');
const rentalApprovalHistorySheetSource = readFileSync(new URL('../src/app/components/gantt/RentalApprovalHistorySheet.tsx', import.meta.url), 'utf8');
const equipmentPageSource = readFileSync(new URL('../src/app/pages/Equipment.tsx', import.meta.url), 'utf8');
const equipmentDetailSource = readFileSync(new URL('../src/app/pages/EquipmentDetail.tsx', import.meta.url), 'utf8');
const rentalsPageSource = readFileSync(new URL('../src/app/pages/Rentals.tsx', import.meta.url), 'utf8');
const rentalDetailSource = readFileSync(new URL('../src/app/pages/RentalDetail.tsx', import.meta.url), 'utf8');
const servicePageSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');
const deliveriesPageSource = readFileSync(new URL('../src/app/pages/Deliveries.tsx', import.meta.url), 'utf8');
const equipmentHookSource = readFileSync(new URL('../src/app/hooks/useEquipment.ts', import.meta.url), 'utf8');
const serviceTicketsHookSource = readFileSync(new URL('../src/app/hooks/useServiceTickets.ts', import.meta.url), 'utf8');
const serviceDetailSource = readFileSync(new URL('../src/app/pages/ServiceDetail.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/app/lib/api.ts', import.meta.url), 'utf8');
const salesPageSource = readFileSync(new URL('../src/app/pages/Sales.tsx', import.meta.url), 'utf8');
const themeSource = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');

function warrantyPermissionBlock() {
  const match = permissionsSource.match(/\[WARRANTY_MECHANIC_ROLE\]:\s*\{(?<body>[\s\S]*?)\n\s*\},/);
  assert.ok(match?.groups?.body, 'warranty mechanic permission block must exist');
  return match.groups.body;
}

function rentalManagerPermissionBlock() {
  const match = permissionsSource.match(/'Менеджер по аренде':\s*\{(?<body>[\s\S]*?)\n\s*\},/);
  assert.ok(match?.groups?.body, 'rental manager permission block must exist');
  return match.groups.body;
}

function adminPermissionBlock() {
  const match = permissionsSource.match(/'Администратор':\s*\{(?<body>[\s\S]*?)\n\s*\},/);
  assert.ok(match?.groups?.body, 'admin permission block must exist');
  return match.groups.body;
}

function officeManagerPermissionBlock() {
  const match = permissionsSource.match(/'Офис-менеджер':\s*\{(?<body>[\s\S]*?)\n\s*\},/);
  assert.ok(match?.groups?.body, 'office manager permission block must exist');
  return match.groups.body;
}

function salesManagerPermissionBlock() {
  const match = permissionsSource.match(/'Менеджер по продажам':\s*\{(?<body>[\s\S]*?)\n\s*\},/);
  assert.ok(match?.groups?.body, 'sales manager permission block must exist');
  return match.groups.body;
}

function carrierPermissionBlock() {
  const match = permissionsSource.match(/'Перевозчик':\s*\{(?<body>[\s\S]*?)\n\s*\},/);
  assert.ok(match?.groups?.body, 'carrier permission block must exist');
  return match.groups.body;
}

function investorPermissionBlock() {
  const match = permissionsSource.match(/'Инвестор':\s*\{(?<body>[\s\S]*?)\n\s*\},/);
  assert.ok(match?.groups?.body, 'investor permission block must exist');
  return match.groups.body;
}

function headPermissionBlock() {
  const match = permissionsSource.match(/'Руководитель':\s*\{(?<body>[\s\S]*?)\n\s*\},/);
  assert.ok(match?.groups?.body, 'head permission block must exist');
  return match.groups.body;
}

test('frontend rental manager permissions match backend write limits', () => {
  const block = rentalManagerPermissionBlock();

  assert.match(block, /clients:\s+VIEW_CREATE/, 'rental manager can create clients through the UI');
  assert.match(block, /payments:\s+VIEW/, 'rental manager must not see payment mutation controls');
  assert.doesNotMatch(block, /payments:\s+\['view', 'create', 'edit'\]/);
  assert.doesNotMatch(block, /\bfinance:\s+/);
  assert.doesNotMatch(block, /\badmin_panel:\s+/);
});

test('frontend delivery create RBAC exposes active create only to operational roles', () => {
  const adminBlock = adminPermissionBlock();
  const officeBlock = officeManagerPermissionBlock();
  const rentalManagerBlock = rentalManagerPermissionBlock();
  const carrierBlock = carrierPermissionBlock();
  const headBlock = headPermissionBlock();
  const investorBlock = investorPermissionBlock();

  assert.match(adminBlock, /deliveries:\s+ALL/);
  assert.match(officeBlock, /deliveries:\s+ALL/);
  assert.match(rentalManagerBlock, /deliveries:\s+\['view', 'create', 'edit'\]/);
  assert.match(deliveriesPageSource, /const canCreate = can\('create', 'deliveries'\)/);
  assert.match(deliveriesPageSource, /canCreate && \(/);
  assert.match(deliveriesPageSource, /<Button onClick=\{\(\) => openCreateDialog\(\)\}>/);

  assert.match(carrierBlock, /deliveries:\s+VIEW/);
  assert.doesNotMatch(carrierBlock, /create/);
  assert.doesNotMatch(headBlock, /\bdeliveries:\s+/);
  assert.doesNotMatch(investorBlock, /\bdeliveries:\s+/);
});

test('frontend equipment registry RBAC separates rental sales and investor capabilities', () => {
  const rentalManagerBlock = rentalManagerPermissionBlock();
  const salesManagerBlock = salesManagerPermissionBlock();

  assert.match(rentalManagerBlock, /sales:\s+VIEW/);
  assert.doesNotMatch(rentalManagerBlock, /sales:\s+ALL/);
  assert.doesNotMatch(rentalManagerBlock, /sales:\s+\['view', 'create', 'edit'\]/);
  assert.doesNotMatch(rentalManagerBlock, /equipment:\s+ALL/);

  assert.match(salesManagerBlock, /sales:\s+ALL/);
  assert.match(salesManagerBlock, /equipment:\s+VIEW/);

  assert.match(equipmentPageSource, /const canViewSales = canPerform\(can, 'view', 'sales'\)/);
  assert.match(equipmentPageSource, /const canCreateSales = canPerform\(can, 'create', 'sales'\)/);
  assert.match(equipmentPageSource, /const canEditSales = canPerform\(can, 'edit', 'sales'\)/);
  assert.match(equipmentPageSource, /if \(canViewSales && canCreateSales && canCreateDocuments\)/);
  assert.match(equipmentPageSource, /if \(canManageSaleEquipment\)/);
  assert.match(equipmentDetailSource, /const canEditSales = can\('edit', 'sales'\)/);
  assert.match(equipmentDetailSource, /const canEditCurrentEquipment = saleMode \? \(canEditEquipment \|\| canEditSales\) : canEditEquipment/);
  assert.match(equipmentDetailSource, /show: canCreateSales && canCreateDocuments/);
  assert.match(equipmentDetailSource, /show: can\('create', 'rentals'\)/);
  assert.match(equipmentDetailSource, /show: can\('create', 'deliveries'\)/);
});

test('frontend warranty mechanic menu grants only working sections', () => {
  const block = warrantyPermissionBlock();

  for (const section of ['equipment', 'sales', 'rentals', 'service']) {
    assert.match(block, new RegExp(`\\b${section}:\\s+`), `${section} must be visible for warranty mechanic`);
  }

  for (const section of ['payments', 'finance', 'reports', 'admin_panel', 'profile_settings']) {
    assert.doesNotMatch(block, new RegExp(`\\b${section}:\\s+`), `${section} must not be granted to warranty mechanic`);
  }

  assert.match(sidebarSource, /section:\s*'equipment'/);
  assert.match(sidebarSource, /section:\s*'service'/);
  assert.match(sidebarSource, /section:\s*'sales'/);
});

test('frontend carrier permissions expose only deliveries and profile shell', () => {
  const block = carrierPermissionBlock();

  assert.match(block, /deliveries:\s+VIEW/);
  assert.match(block, /profile_settings:\s+\['view', 'edit'\]/);

  for (const section of ['dashboard', 'equipment', 'rentals', 'service', 'clients', 'documents', 'payments', 'finance', 'reports', 'admin_panel']) {
    assert.doesNotMatch(block, new RegExp(`\\b${section}:\\s+`), `${section} must not be granted to carrier`);
  }
});

test('frontend investor permissions expose only own equipment, rentals and profile shell', () => {
  const block = investorPermissionBlock();

  assert.match(block, /equipment:\s+VIEW/);
  assert.match(block, /rentals:\s+VIEW/);
  assert.match(block, /profile_settings:\s+\['view', 'edit'\]/);

  for (const section of ['dashboard', 'service', 'clients', 'documents', 'payments', 'finance', 'reports', 'admin_panel', 'deliveries']) {
    assert.doesNotMatch(block, new RegExp(`\\b${section}:\\s+`), `${section} must not be granted to investor`);
  }

  assert.match(equipmentPageSource, /getInvestorBinding/);
  assert.match(equipmentPageSource, /isInvestorUser/);
  assert.match(equipmentPageSource, /const scopedEquipmentList = React\.useMemo/);
  assert.match(equipmentPageSource, /equipmentList\.filter\(item => equipmentMatchesInvestorBinding\(item, investorBinding\)\)/);
  assert.match(equipmentPageSource, /normalizeEquipmentList\(enrichEquipment\(scopedEquipmentList, ganttRentals\)\)/);
});

test('frontend head role has read-only movement and equipment photo history view', () => {
  const block = headPermissionBlock();

  assert.match(block, /equipment:\s+VIEW/);
  assert.match(block, /rentals:\s+VIEW/);
  assert.match(block, /profile_settings:\s+\['view', 'edit'\]/);
  assert.doesNotMatch(block, /ALL/);
  assert.doesNotMatch(block, /create/);
  assert.doesNotMatch(block, /delete/);

  for (const section of ['dashboard', 'gsm', 'deliveries', 'planner', 'service', 'clients', 'documents', 'payments', 'finance', 'reports', 'admin_panel', 'bots']) {
    assert.doesNotMatch(block, new RegExp(`\\b${section}:\\s+`), `${section} must not be granted to head`);
  }

  assert.match(userStorageSource, /'Руководитель'/);
  assert.match(rentalsPageSource, /const isHeadRole = normalizedRole === 'Руководитель'/);
  assert.match(rentalsPageSource, /label: 'Движение техники'/);
  assert.match(rentalsPageSource, /Фото ещё не загружены/);
  assert.match(rentalsPageSource, /activeWorkspaceTab !== 'returns' && \(\s*activeWorkspaceTab !== 'movement'/);
});

test('frontend normalizes warranty mechanic role aliases', () => {
  assert.match(userStorageSource, /WARRANTY_MECHANIC_ROLE_ALIASES/);
  assert.match(userStorageSource, /'warranty_mechanic'/);
  assert.match(userStorageSource, /'mechanic_warranty'/);
  assert.match(userStorageSource, /'warrantyMechanic'/);
  assert.match(userStorageSource, /'mechanicWarranty'/);
  assert.match(userStorageSource, /'механик по гарантии'/);
  assert.match(userStorageSource, /normalizeRoleKey/);
  assert.match(permissionsSource, /normalizeUserRole\(user\?\.role\)/);
});

test('frontend does not mask equipment and service API failures as empty warranty data', () => {
  assert.match(equipmentPageSource, /const equipmentQuery = useEquipmentList\(\)/);
  assert.match(equipmentPageSource, /equipmentQuery\.data \?\? \[\]/);
  assert.match(equipmentPageSource, /GET \/api\/access-diagnostics/);
  assert.match(equipmentPageSource, /\/api\/equipment/);

  assert.match(servicePageSource, /const ticketsQuery = useServiceTicketsList\(\)/);
  assert.match(servicePageSource, /ticketsQuery\.data \?\? \[\]/);
  assert.match(servicePageSource, /GET \/api\/service/);
  assert.match(servicePageSource, /GET \/api\/access-diagnostics/);

  assert.match(salesPageSource, /const equipmentQuery = useEquipmentList\(\)/);
  assert.match(salesPageSource, /equipmentQuery\.data \?\? \[\]/);
  assert.match(salesPageSource, /GET \/api\/equipment/);
});

test('frontend warranty service detail avoids forbidden service vehicle fetches and redacted part-price crashes', () => {
  assert.match(serviceDetailSource, /const canViewServiceVehicles = can\('view', 'service_vehicles'\)/);
  assert.match(serviceDetailSource, /enabled: canViewServiceVehicles/);
  assert.match(serviceDetailSource, /Number\.isFinite\(Number\(item\.priceSnapshot\)\)/);
});

test('frontend warranty pages do not prefetch forbidden operational collections', () => {
  assert.match(equipmentHookSource, /enabled: options\.enabled \?\? true/);
  assert.match(serviceTicketsHookSource, /enabled: options\.enabled \?\? true/);
  assert.match(sidebarSource, /useEquipmentList\(\{ enabled: canSearchEquipment \}\)/);
  assert.match(sidebarSource, /useServiceTicketsList\(\{ enabled: canSearchService \}\)/);
  assert.match(sidebarSource, /queryKey: \['deliveries', 'global-search', user\?\.id \|\| 'anonymous', user\?\.role \|\| 'anonymous'\]/);

  assert.match(notificationCenterSource, /const canViewShippingPhotos = \['Администратор', 'Офис-менеджер', 'Менеджер по аренде'\]\.includes\(normalizedRole\)[\s\S]*isMechanicRole\(normalizedRole\)/);
  assert.match(notificationCenterSource, /enabled: canViewShippingPhotos/);

  assert.match(rentalsPageSource, /const canViewClients = can\('view', 'clients'\)/);
  assert.match(rentalsPageSource, /const canViewPayments = can\('view', 'payments'\) \|\| can\('view', 'finance'\)/);
  assert.match(rentalsPageSource, /const canViewStaffOptions = \['Администратор', 'Офис-менеджер', 'Менеджер по аренде', 'Менеджер по продажам'\]\.includes\(normalizedRole\)/);
  assert.match(rentalsPageSource, /enabled: canViewPayments/);
  assert.match(rentalsPageSource, /enabled: canViewStaffOptions/);
  assert.match(rentalsPageSource, /enabled: canViewClients/);
  assert.match(rentalsPageSource, /const canViewService = can\('view', 'service'\)/);
  assert.match(rentalsPageSource, /enabled: canViewService/);
  assert.match(rentalsPageSource, /const canViewApprovals = can\('view', 'approvals'\)/);
  assert.match(rentalsPageSource, /useRentalChangeRequestsList\(canViewApprovals\)/);

  assert.match(equipmentDetailSource, /const canViewShippingPhotos = \['Администратор', 'Офис-менеджер', 'Менеджер по аренде', 'Руководитель'\]\.includes\(normalizedRole\)[\s\S]*isMechanicRole\(normalizedRole\)/);
  assert.match(equipmentDetailSource, /enabled: !!id && canViewShippingPhotos/);

  assert.match(rentalApprovalHistorySheetSource, /useClientsList\(\{ enabled: open \}\)/);
});

test('rentals workspace active tabs keep readable contrast in light and dark themes', () => {
  assert.match(rentalsPageSource, /label:\s*'Список аренд'/);
  assert.match(rentalsPageSource, /label:\s*'План парка'/);
  assert.match(rentalsPageSource, /label:\s*'Возвраты'/);
  assert.match(rentalsPageSource, /label:\s*'Деньги и документы'/);
  assert.match(rentalsPageSource, /\.filter\(tab => tab\.id !== 'debt_docs' \|\| canViewPayments \|\| canViewDocuments\)/);
  assert.match(rentalsPageSource, /canViewPayments \? formatCurrency\(row\.amount\) : 'Скрыто'/);
  assert.match(rentalsPageSource, /canViewPayments \? formatCurrency\(row\.paidAmount\) : 'Скрыто'/);
  assert.match(rentalsPageSource, /canViewPayments \? formatCurrency\(row\.debtAmount\) : 'Скрыто'/);

  assert.match(rentalsPageSource, /aria-pressed=\{active\}/);
  assert.match(rentalsPageSource, /data-state=\{active \? 'active' : 'inactive'\}/);
  assert.match(rentalsPageSource, /rentals-workspace-tab-active border-blue-600 text-blue-700/);
  assert.match(rentalsPageSource, /rentals-workspace-tab-badge-active/);
  assert.match(themeSource, /\.rentals-workspace-tab-active\s*\{[\s\S]*border-bottom-color: #2563eb;[\s\S]*background-color: transparent;[\s\S]*color: #1d4ed8;/);
  assert.match(themeSource, /\.dark \.rentals-workspace-tab-active\s*\{[\s\S]*border-bottom-color: #60a5fa;[\s\S]*background-color: transparent;[\s\S]*color: #93c5fd;/);
  assert.match(themeSource, /\.rentals-workspace-tab-badge-active\s*\{[\s\S]*background-color: #ef4444;[\s\S]*color: #fff;/);
  assert.match(themeSource, /\.dark \.rentals-workspace-tab-badge-active\s*\{[\s\S]*background-color: #ef4444;[\s\S]*color: #fff;/);
  assert.doesNotMatch(rentalsPageSource, /activeWorkspaceTab === tab\.id\s*\?\s*'bg-\[--color-primary\] text-white shadow-sm'/);
  assert.doesNotMatch(rentalsPageSource, /activeWorkspaceTab === tab\.id \? 'bg-white\/20 text-white' : tab\.badgeTone/);
});

test('frontend investor rental surfaces avoid forbidden background reads', () => {
  assert.match(notificationCenterSource, /const canViewApprovals = canView\('approvals'\)/);
  assert.match(notificationCenterSource, /enabled: canViewApprovals/);

  assert.match(rentalsPageSource, /const canViewClients = can\('view', 'clients'\)/);
  assert.match(rentalsPageSource, /const canViewPayments = can\('view', 'payments'\) \|\| can\('view', 'finance'\)/);
  assert.match(rentalsPageSource, /const canViewService = can\('view', 'service'\)/);
  assert.match(rentalsPageSource, /const canViewApprovals = can\('view', 'approvals'\)/);
  assert.match(rentalsPageSource, /enabled: canViewClients/);
  assert.match(rentalsPageSource, /enabled: canViewPayments/);
  assert.match(rentalsPageSource, /enabled: canViewService/);
  assert.match(rentalsPageSource, /useRentalChangeRequestsList\(canViewApprovals\)/);

  assert.match(rentalDetailSource, /const canViewClients = can\('view', 'clients'\)/);
  assert.match(rentalDetailSource, /const canViewPayments = can\('view', 'payments'\) \|\| canViewFinance/);
  assert.match(rentalDetailSource, /const canViewService = can\('view', 'service'\)/);
  assert.match(rentalDetailSource, /const canViewApprovals = can\('view', 'approvals'\)/);
  assert.match(rentalDetailSource, /useServiceTicketsList\(\{ enabled: canViewService \}\)/);
  assert.match(rentalDetailSource, /usePaymentsList\(\{ enabled: canViewPayments \}\)/);
  assert.match(rentalDetailSource, /useClientsList\(\{ enabled: canViewClients \}\)/);
  assert.match(rentalDetailSource, /useClientObjectsList\(\{ enabled: canViewClients \}\)/);
  assert.match(rentalDetailSource, /useClientContractsList\(\{ enabled: canViewClients \}\)/);
  assert.match(rentalDetailSource, /useDocumentsList\(\{ enabled: canViewDocuments \}\)/);
  assert.match(rentalDetailSource, /useRentalChangeRequestsList\(canViewApprovals\)/);
  assert.match(rentalDetailSource, /useRentalAuditHistory\(canonicalRentalId, \{ enabled: !!rental \}\)/);
});

test('carrier deliveries page does not prefetch forbidden context or show finance controls', () => {
  assert.match(deliveriesPageSource, /const isCarrierView = normalizedRole === 'Перевозчик'/);
  assert.match(deliveriesPageSource, /const deliveryListQueryKey = useMemo/);
  assert.match(deliveriesPageSource, /queryKey: deliveryListQueryKey/);
  assert.match(deliveriesPageSource, /enabled: canManageDeliveries/);
  assert.match(deliveriesPageSource, /Мои активные доставки/);
  assert.match(deliveriesPageSource, /!isCarrierView && <th className="px-4 py-3 font-semibold">Клиент<\/th>/);
  assert.match(deliveriesPageSource, /!isCarrierView && <th className="px-4 py-3 font-semibold">Водитель<\/th>/);
  assert.match(deliveriesPageSource, /!isCarrierView && \(\s*<select value=\{carrierFilter\}/);
  assert.doesNotMatch(deliveriesPageSource, /Финконтроль/);
  assert.doesNotMatch(deliveriesPageSource, /formatCurrency\(delivery\.cost\)/);
});

test('frontend verifies session before clearing auth after data endpoint 401', () => {
  assert.match(apiSource, /function shouldClearTokenForUnauthorized\(path: string\)/);
  assert.match(apiSource, /normalizedPath\.startsWith\('\/api\/auth\/'\)/);
  assert.match(apiSource, /let unauthorizedSessionCheck: Promise<boolean> \| null = null/);
  assert.match(apiSource, /async function checkSessionAfterDataUnauthorized\(\): Promise<boolean>/);
  assert.match(apiSource, /fetch\(`\$\{API_BASE_URL\}\/api\/auth\/me`/);
  assert.match(apiSource, /if \(res\.status === 401\) \{[\s\S]*dispatchUnauthorizedForToken\(token\);[\s\S]*return false;/);
  assert.match(apiSource, /if \(shouldClearTokenForUnauthorized\(path\)\) \{[\s\S]*dispatchUnauthorizedForToken\(token\);[\s\S]*\} else \{[\s\S]*await checkSessionAfterDataUnauthorized\(\);/);
  assert.match(apiSource, /unauthorizedSessionCheck = null/);
});
