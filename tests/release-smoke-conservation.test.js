import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backendCommitGateResult } from '../scripts/release-preflight.mjs';
import {
  discoverRentalModeEquipment,
  financeSmokeFixtureDiagnostic,
  isFinanceSmokeFixtureRecord,
  isRentalModeEquipmentRecord,
  summarizeEquipmentCandidates,
} from '../scripts/finance-smoke-equipment-discovery.mjs';

const releaseSmokeSource = readFileSync(new URL('../e2e/helpers/releaseSmoke.ts', import.meta.url), 'utf8');
const deployWorkflowSource = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const productionUiSelectorSmokeSource = readFileSync(new URL('../e2e/production-ui-selector-smoke.spec.ts', import.meta.url), 'utf8');
const financeProductionSmokeSource = readFileSync(new URL('../e2e/finance-production-smoke.spec.ts', import.meta.url), 'utf8');
const financeProductionSmokeWorkflowSource = readFileSync(new URL('../.github/workflows/finance-production-smoke.yml', import.meta.url), 'utf8');
const productionDashboardVisualSmokeSource = readFileSync(new URL('../e2e/production-dashboard-visual-smoke.spec.ts', import.meta.url), 'utf8');
const productionDashboardVisualSmokeWorkflowSource = readFileSync(new URL('../.github/workflows/production-dashboard-visual-smoke.yml', import.meta.url), 'utf8');
const financeEquipmentDiscoverySource = readFileSync(new URL('../scripts/finance-smoke-equipment-discovery.mjs', import.meta.url), 'utf8');

test('production release smoke checks app.disabled before authenticated smoke', () => {
  assert.match(releaseSmokeSource, /type VersionInfo = \{/);
  assert.match(releaseSmokeSource, /normalizedConfig\.environmentName === 'production' && versionJson\?\.app\?\.disabled === true/);
  assert.match(releaseSmokeSource, /directConservedLoginSmoke/);
  assert.match(releaseSmokeSource, /directLoginSmoke\(normalizedConfig\)/);
});

test('conserved release smoke requires login 503 and maintenance UI', () => {
  assert.match(releaseSmokeSource, /conserved login should be blocked with HTTP 503/);
  assert.match(releaseSmokeSource, /toBe\(503\)/);
  assert.match(releaseSmokeSource, /expectMaintenanceUiVisible/);
  assert.match(releaseSmokeSource, /hasMaintenanceUiText\(bodyText: string, appDisabledMessage\?: string\)/);
  assert.match(releaseSmokeSource, /bodyText\.includes\(expectedMessage\)/);
  assert.match(releaseSmokeSource, /Система временно отключена\|Работа приложения приостановлена/);
  assert.match(releaseSmokeSource, /техническ\(\?:ое\|ого\|ом\|ий\|ая\)\\s\+обслуживан/);
  assert.match(releaseSmokeSource, /временно\\s\+\(\?:закрыто\|отключена\|недоступн\)/);
  assert.match(releaseSmokeSource, /conserved\|maintenance/);
  assert.match(releaseSmokeSource, /Production is conserved: login HTTP 503 is expected, authenticated smoke skipped\./);
});

test('conserved release smoke opens root with commit cache bust and waits for UI render', () => {
  assert.match(releaseSmokeSource, /function conservedAppUrl\(frontendUrl: string, expectedCommit\?: string\)/);
  assert.match(releaseSmokeSource, /url\.searchParams\.set\('v', shortCommit\(expectedCommit\) \|\| String\(Date\.now\(\)\)\)/);
  assert.match(releaseSmokeSource, /page\.goto\(conservedAppUrl\(normalizedConfig\.frontendUrl, normalizedConfig\.expectedCommit\)/);
  assert.doesNotMatch(releaseSmokeSource, /page\.goto\(appUrl\(normalizedConfig\.frontendUrl, '\/login'\)[\s\S]*frontend conservation/);
  assert.match(releaseSmokeSource, /expect\.poll\(/);
  assert.match(releaseSmokeSource, /hasMaintenanceUiText\(await visibleBodyText\(page\), appDisabledMessage\)/);
});

test('conserved release smoke fails when maintenance UI is missing', () => {
  assert.match(releaseSmokeSource, /conserved frontend should render maintenance\/conservation UI/);
  assert.match(releaseSmokeSource, /frontend did not render maintenance\/conservation state/);
  assert.match(releaseSmokeSource, /failWithPageDiagnostics\(/);
});

test('non-conserved release smoke keeps strict login behavior', () => {
  assert.match(releaseSmokeSource, /const directLogin = await directLoginSmoke\(normalizedConfig\)/);
  assert.match(releaseSmokeSource, /if \(!login\.ok\(\)\) \{/);
  assert.match(releaseSmokeSource, /direct login smoke failed/);
  assert.match(releaseSmokeSource, /expectAdminLoginSucceeded/);
});

test('non-conserved production smoke proves dashboard executive cockpit and screenshots', () => {
  for (const marker of [
    'expectExecutiveCockpitVisible',
    'dashboard-executive-cockpit',
    'dashboard-key-signals-command',
    'dashboard-key-signals',
    'dashboard-month-dynamics-command',
    'dashboard-month-dynamics',
    'dashboard-company-health',
    'dashboard-company-health-compact',
    'healthSvgCount',
    'healthWidthShare',
    'dashboard-kpi-overdue-debt',
    'dashboard-kpi-fleet-utilization',
    'dashboard-kpi-service-load',
    'dashboard-kpi-operational-load',
    'Пульт управления арендным бизнесом',
    'Очередь внимания',
    'Динамика месяца',
    'Здоровье компании',
    'dashboard visual acceptance',
    'expectDashboardCompanyHealthLayout',
    'expectNoHorizontalOverflow',
    'above the desktop fold',
    'firstViewportHeadingCounts',
    'duplicate Динамика месяца',
    'duplicate Здоровье компании',
    'production-dashboard-cockpit-desktop.png',
    'production-dashboard-cockpit-mobile.png',
    'production-dashboard-cockpit-tablet.png',
  ]) {
    assert.match(releaseSmokeSource, new RegExp(marker));
  }
  assert.match(releaseSmokeSource, /toHaveAttribute\('href', \/#\\\/service\$\//);
  assert.match(releaseSmokeSource, /captureExecutiveCockpitScreenshots\(page, normalizedConfig\.frontendUrl, testInfo\)/);
});

test('dashboard cockpit helper preserves caller viewport for mobile artifacts', () => {
  const helper = releaseSmokeSource.match(/async function expectExecutiveCockpitVisible[\s\S]*?\n}\n\nasync function elementRect/)?.[0] || '';
  assert.match(releaseSmokeSource, /await page\.setViewportSize\(\{ width: 390, height: 844 \}\)/);
  assert.doesNotMatch(helper, /setViewportSize\(\{ width: 1440, height: 900 \}\)/);
  assert.match(helper, /if \(viewport\.width >= 1024\) \{[\s\S]*dashboard key signals should be above the desktop fold/);
});

test('production release smoke allows backend drift only for frontend-only and deploy-tooling releases', () => {
  assert.match(releaseSmokeSource, /type ReleaseType = 'frontend-only' \| 'backend' \| 'full-stack' \| 'deploy-tooling' \| 'frontend-deploy-tooling'/);
  assert.match(releaseSmokeSource, /releaseType\?: ReleaseType \| string/);
  assert.match(releaseSmokeSource, /releaseType === 'frontend-only' \|\|[\s\S]*releaseType === 'deploy-tooling' \|\|[\s\S]*releaseType === 'frontend-deploy-tooling'/);
  assert.match(releaseSmokeSource, /expectedDriftReleaseType\(details\.releaseType\)/);
  assert.match(releaseSmokeSource, /releaseType: normalizeReleaseType\(String\(config\.releaseType \|\| ''\)\)/);
  assert.match(releaseSmokeSource, /releaseType: normalizedConfig\.releaseType/);
});

test('production UI selector smoke passes frontend marker release type into release smoke', () => {
  assert.match(productionUiSelectorSmokeSource, /async function readPublicFrontendBuildMarker/);
  assert.match(productionUiSelectorSmokeSource, /frontend marker should match expected release commit before selector smoke preflight/);
  assert.match(productionUiSelectorSmokeSource, /releaseType: String\(marker\?\.releaseType \|\| ''\)\.trim\(\) \|\| 'full-stack'/);
  assert.match(productionUiSelectorSmokeSource, /const frontendMarker = await readPublicFrontendBuildMarker\(page, frontendUrl, apiUrl, expectedCommit\)/);
  assert.match(productionUiSelectorSmokeSource, /releaseType: frontendMarker\.releaseType/);
  assert.match(productionUiSelectorSmokeSource, /label: 'Техника'/);
  assert.match(productionUiSelectorSmokeSource, /route: '\/equipment'/);
  assert.match(productionUiSelectorSmokeSource, /safeSmokeLog\('actionQueueEmpty', \{ allowed: true \}\)/);
  assert.match(productionUiSelectorSmokeSource, /safeSmokeLog\('actionQueueRowsEmpty', \{ allowed: true \}\)/);
  assert.match(productionUiSelectorSmokeSource, /safeSmokeLog\('clientCardCrmHiddenSkipped', \{ reason: 'no_client_card_link' \}\)/);
  assert.match(productionUiSelectorSmokeSource, /safeSmokeLog\('legacyAttentionBelowFoldSkipped', \{ reason: 'covered_by_deploy_visual_smoke'/);
  assert.match(productionUiSelectorSmokeSource, /safeSmokeLog\('dashboardAttentionSkipped', \{ reason: 'covered_by_deploy_visual_smoke' \}\)/);
  assert.match(productionUiSelectorSmokeSource, /safeSmokeLog\('equipmentActionQueueSkipped', \{ reason: 'section_not_rendered' \}\)/);
  assert.match(productionUiSelectorSmokeSource, /safeSmokeLog\('equipmentReadinessVisible', \{ mode: 'kpi-strip' \}\)/);
  assert.match(productionUiSelectorSmokeSource, /fleet readiness KPI/);
  assert.match(productionUiSelectorSmokeSource, /if \(actionRowCount > 0\)/);
});

test('finance production smoke uses release type policy for backend commit drift', () => {
  assert.match(financeProductionSmokeSource, /backendCommitGateResult\(\{/);
  assert.match(financeProductionSmokeSource, /env: 'production'/);
  assert.match(financeProductionSmokeSource, /resolveFinanceSmokeReleaseType/);
  assert.match(financeProductionSmokeSource, /envReleaseType: String\(process\.env\.RELEASE_TYPE \|\| ''\)/);
  assert.match(financeProductionSmokeSource, /frontendReleaseType: frontendBuild\?\.releaseType/);
  assert.match(financeProductionSmokeSource, /backendReleaseType: backendBuild\?\.releaseType/);
  assert.match(financeProductionSmokeSource, /safeSmokeLog\('backendCommitDrift'/);
  assert.match(financeProductionSmokeSource, /expect\(gate\.status, `\$\{input\.label\}: \$\{gate\.message\}`\)\.toBe\('pass'\)/);
});

test('finance production smoke release policy warns only for frontend and deploy tooling drift', () => {
  const backendBuild = { commitFull: '3b445384ab16263c620a08db3a84a0316d7c3719' };
  const expectedCommit = '287e2127a7efd14ddc37c09b4092dba67cd00e6a';

  for (const releaseType of ['frontend-only', 'deploy-tooling', 'frontend-deploy-tooling']) {
    const result = backendCommitGateResult({ env: 'production', releaseType, backendBuild, expectedCommit });
    assert.equal(result.status, 'warn', `${releaseType} backend drift should warn`);
    assert.match(result.message, new RegExp(`expected for ${releaseType === 'frontend-only' ? 'frontend-only' : releaseType} release`));
  }

  for (const releaseType of ['backend', 'full-stack']) {
    const result = backendCommitGateResult({ env: 'production', releaseType, backendBuild, expectedCommit });
    assert.equal(result.status, 'fail', `${releaseType} backend drift should fail`);
  }
});

test('finance production smoke workflow passes release type with auto default', () => {
  assert.match(financeProductionSmokeWorkflowSource, /release_type:/);
  assert.match(financeProductionSmokeWorkflowSource, /default: auto/);
  assert.match(financeProductionSmokeWorkflowSource, /- frontend-only/);
  assert.match(financeProductionSmokeWorkflowSource, /- backend/);
  assert.match(financeProductionSmokeWorkflowSource, /- full-stack/);
  assert.match(financeProductionSmokeWorkflowSource, /- deploy-tooling/);
  assert.match(financeProductionSmokeWorkflowSource, /- frontend-deploy-tooling/);
  assert.match(financeProductionSmokeWorkflowSource, /RELEASE_TYPE: \$\{\{ inputs\.release_type \}\}/);
});

test('production dashboard visual smoke uses release type policy for backend commit drift', () => {
  assert.match(productionDashboardVisualSmokeSource, /backendCommitGateResult\(\{/);
  assert.match(productionDashboardVisualSmokeSource, /env: 'production'/);
  assert.match(productionDashboardVisualSmokeSource, /resolveDashboardSmokeReleaseType/);
  assert.match(productionDashboardVisualSmokeSource, /envReleaseType: String\(process\.env\.RELEASE_TYPE \|\| ''\)/);
  assert.match(productionDashboardVisualSmokeSource, /frontendReleaseType: marker\?\.releaseType/);
  assert.match(productionDashboardVisualSmokeSource, /backendReleaseType: backendBuild\?\.releaseType/);
  assert.match(productionDashboardVisualSmokeSource, /logStage\('backendCommitDrift'/);
  assert.match(productionDashboardVisualSmokeSource, /expect\(gate\.status, `\$\{input\.label\}: \$\{gate\.message\}`\)\.toBe\('pass'\)/);
  assert.ok(
    productionDashboardVisualSmokeSource.indexOf('frontendReleaseType: marker?.releaseType') <
      productionDashboardVisualSmokeSource.indexOf("label: 'backend expected release commit'"),
    'dashboard smoke should resolve auto release type from frontend marker before backend expected-commit gate',
  );
});

test('production dashboard visual smoke workflow passes release type with auto default', () => {
  assert.match(productionDashboardVisualSmokeWorkflowSource, /release_type:/);
  assert.match(productionDashboardVisualSmokeWorkflowSource, /default: auto/);
  assert.match(productionDashboardVisualSmokeWorkflowSource, /- frontend-only/);
  assert.match(productionDashboardVisualSmokeWorkflowSource, /- backend/);
  assert.match(productionDashboardVisualSmokeWorkflowSource, /- full-stack/);
  assert.match(productionDashboardVisualSmokeWorkflowSource, /- deploy-tooling/);
  assert.match(productionDashboardVisualSmokeWorkflowSource, /- frontend-deploy-tooling/);
  assert.match(productionDashboardVisualSmokeWorkflowSource, /RELEASE_TYPE: \$\{\{ inputs\.release_type \}\}/);
});

test('finance production smoke opens a rental-mode equipment economics tab with diagnostics', () => {
  assert.match(financeProductionSmokeSource, /getRentalModeEquipmentForEconomicsTab/);
  assert.match(financeProductionSmokeSource, /discoverRentalModeEquipment\(\{/);
  assert.match(financeEquipmentDiscoverySource, /saleState=available_for_rent/);
  assert.match(financeEquipmentDiscoverySource, /FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER = 'SMOKE-RENTAL-001'/);
  assert.match(financeEquipmentDiscoverySource, /Production data contract violation: \$\{FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER\}/);
  assert.match(financeEquipmentDiscoverySource, /equipmentEconomicsDiscoveryPage/);
  assert.match(financeEquipmentDiscoverySource, /productionFixture/);
  assert.match(financeProductionSmokeSource, /safeSmokeLog\('equipmentEconomicsCandidate'/);
  assert.match(financeProductionSmokeSource, /pagesFetched: discovery\.diagnostics\.requests\.length/);
  assert.match(financeProductionSmokeSource, /safeSmokeLog\('productionFixtureWarning'/);
  assert.match(financeProductionSmokeSource, /getByTestId\('equipment-economics-tab'\)/);
  assert.match(financeProductionSmokeSource, /getByTestId\('equipment-economics-panel'\)/);
  assert.match(financeProductionSmokeSource, /scrollIntoViewIfNeeded\(\)/);
  assert.match(financeProductionSmokeSource, /toBeEnabled\(\)/);
  assert.match(financeProductionSmokeSource, /safeSmokeLog\('equipmentEconomicsTabBeforeClick'/);
  assert.match(financeProductionSmokeSource, /safeSmokeLog\('equipmentEconomicsTabClickFailed'/);
  assert.match(financeProductionSmokeSource, /attachSmokeScreenshot\(page, testInfo, 'finance-smoke-equipment-economics-before-click'\)/);
  assert.match(financeProductionSmokeSource, /attachSmokeScreenshot\(page, testInfo, 'finance-smoke-equipment-economics-opened'\)/);
});

test('finance production smoke keeps equipment economics content assertions strong', () => {
  assert.match(financeProductionSmokeSource, /EQUIPMENT_ECONOMICS_UI_STATE_PATTERN/);
  assert.match(financeProductionSmokeSource, /assertEquipmentEconomicsUiStateSafe\(await economicsPanel\.innerText\(\)\)/);
  assert.match(financeProductionSmokeSource, /throw new Error\(`Finance production smoke could not find rental-mode equipment with an economics tab candidate: \$\{JSON\.stringify\(equipmentDiscovery\.diagnostics\)\}`\)/);
  assert.doesNotMatch(financeProductionSmokeSource, /equipmentEconomicsChecked: Boolean\(equipment\?\.id\)[\s\S]*return/);
});

test('finance equipment discovery does not choose sale-mode equipment for rental economics', async () => {
  const result = await discoverRentalModeEquipment({
    getJson: async () => ({ items: [{ id: 'sale-1', status: 'available', saleMode: true }], pagination: { hasNextPage: false } }),
  });

  assert.equal(result.selected, null);
  assert.equal(result.diagnostics.fetched.totalEquipment, 1);
  assert.equal(result.diagnostics.fetched.skippedSaleMode, 1);
  assert.equal(result.diagnostics.fetched.rentalModeCandidates, 0);
});

test('finance equipment discovery scans beyond the first sale-mode page', async () => {
  const responses = new Map([
    ['/api/equipment?paginated=true&page=1&pageSize=100&saleState=available_for_rent&sortBy=inventoryNumber&sortDir=asc', {
      items: [{ id: 'sale-1', status: 'available', saleMode: true }],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 2, hasNextPage: true },
    }],
    ['/api/equipment?paginated=true&page=2&pageSize=100&saleState=available_for_rent&sortBy=inventoryNumber&sortDir=asc', {
      items: [{ id: 'rent-1', status: 'available', category: 'own', inventoryNumber: '002' }],
      pagination: { page: 2, pageSize: 100, total: 2, totalPages: 2, hasNextPage: false },
    }],
  ]);
  const requested = [];

  const result = await discoverRentalModeEquipment({
    getJson: async (path) => {
      requested.push(path);
      return responses.get(path) || [];
    },
  });

  assert.equal(result.selected.id, 'rent-1');
  assert.deepEqual(requested, [...responses.keys()]);
  assert.equal(result.diagnostics.strategy, 'paginated_available_for_rent');
});

test('finance equipment discovery reports explicit diagnostics when rental-mode equipment is absent', async () => {
  const result = await discoverRentalModeEquipment({
    getJson: async (path) => path.includes('paginated=true')
      ? {
          items: [{ id: 'sale-1', status: 'available', saleStatus: 'removed' }],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1, hasNextPage: false },
        }
      : [{ id: 'sale-1', status: 'available', saleStatus: 'removed' }],
  });

  assert.equal(result.selected, null);
  assert.equal(result.diagnostics.strategy, 'not_found');
  assert.equal(result.diagnostics.requests.length, 2);
  assert.equal(result.diagnostics.fetched.totalEquipment, 1);
  assert.equal(result.diagnostics.fetched.skippedSaleMode, 1);
  assert.equal(result.diagnostics.fetched.rentalModeCandidates, 0);
  assert.equal(result.diagnostics.productionFixture.page1.present, false);
  assert.match(result.diagnostics.productionFixture.page1.warning, /Production data contract violation: SMOKE-RENTAL-001/);
});

test('finance smoke fixture contract requires available own rental-mode equipment', () => {
  const fixture = {
    id: 'eq-smoke',
    inventoryNumber: 'SMOKE-RENTAL-001',
    serialNumber: 'SMOKE-RENTAL-001',
    status: 'available',
    category: 'own',
    saleMode: null,
    saleStatus: null,
    salesStatus: null,
  };

  assert.equal(isFinanceSmokeFixtureRecord(fixture), true);
  assert.equal(isFinanceSmokeFixtureRecord({ ...fixture, saleMode: true }), false);
  assert.equal(isFinanceSmokeFixtureRecord({ ...fixture, category: 'client' }), false);
  assert.equal(isFinanceSmokeFixtureRecord({ ...fixture, status: 'in_service' }), false);

  const diagnostic = financeSmokeFixtureDiagnostic([fixture], { source: 'test' });
  assert.equal(diagnostic.present, true);
  assert.equal(diagnostic.warning, '');

  const missing = financeSmokeFixtureDiagnostic([], { source: 'test' });
  assert.equal(missing.present, false);
  assert.match(missing.warning, /Production data contract violation: SMOKE-RENTAL-001/);
});

test('finance equipment discovery rental-mode classifier excludes repair and sale records', () => {
  assert.equal(isRentalModeEquipmentRecord({ id: 'sale', saleMode: true, status: 'available' }), false);
  assert.equal(isRentalModeEquipmentRecord({ id: 'repair', category: 'client', status: 'available' }), false);
  assert.equal(isRentalModeEquipmentRecord({ id: 'service', category: 'own', status: 'in_service' }), false);
  assert.equal(isRentalModeEquipmentRecord({ id: 'rental', category: 'own', status: 'available' }), true);
  assert.deepEqual(summarizeEquipmentCandidates([
    { id: 'sale', saleMode: true },
    { id: 'repair', category: 'client' },
    { id: 'rental', category: 'own', status: 'available' },
  ]), {
    totalEquipment: 3,
    rentalModeCandidates: 1,
    skippedSaleMode: 1,
    skippedRepairMode: 1,
  });
});

test('deploy workflow embeds release_type into frontend build metadata', () => {
  assert.match(deployWorkflowSource, /release_type: \$\{\{ steps\.classify\.outputs\.release_type \}\}/);
  assert.match(deployWorkflowSource, /VITE_GIT_COMMIT_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(deployWorkflowSource, /VITE_RELEASE_TYPE: \$\{\{ needs\.classify-release\.outputs\.release_type \}\}/);
  assert.match(deployWorkflowSource, /scripts\/finance-smoke-equipment-discovery\\\.mjs/);
});

test('deploy workflow writes backend release marker metadata', () => {
  assert.match(deployWorkflowSource, /scripts\/backend-release-marker\.mjs/);
  assert.match(deployWorkflowSource, /node scripts\/backend-release-marker\.mjs --commit "\$GITHUB_SHA" --release-type "\$RELEASE_TYPE"/);
  assert.match(deployWorkflowSource, /RELEASE_TYPE: \$\{\{ needs\.classify-release\.outputs\.release_type \}\}/);
});

test('release smoke diagnostics do not print smoke credentials or auth tokens', () => {
  const diagnosticHeader = releaseSmokeSource.match(/function diagnosticHeader[\s\S]*?\n}\n/)?.[0] || '';
  const thrownErrors = [...releaseSmokeSource.matchAll(/throw new Error\(`[\s\S]*?`\);/g)].map(match => match[0]).join('\n');
  const consoleLogs = [...releaseSmokeSource.matchAll(/console\.log\([^;]+;/g)].map(match => match[0]).join('\n');

  assert.doesNotMatch(`${diagnosticHeader}\n${thrownErrors}\n${consoleLogs}`, /adminEmail|adminPassword|config\.adminEmail|config\.adminPassword/);
  assert.doesNotMatch(releaseSmokeSource, /console\.log\([^)]*token/i);
  assert.doesNotMatch(releaseSmokeSource, /Authorization: `Bearer \$\{token\}`[\s\S]{0,160}(console|throw new Error)/);
});
