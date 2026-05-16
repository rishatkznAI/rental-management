import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const {
  buildPaginatedResponse,
  itemMatchesSearch,
  normalizePaginationParams,
  normalizeSortParams,
  wantsPaginatedResponse,
} = require('../server/lib/pagination');

test('normalizePaginationParams keeps stable defaults and caps page size', () => {
  assert.deepEqual(normalizePaginationParams({}), { page: 1, pageSize: 25, offset: 0, limit: 25 });
  assert.deepEqual(normalizePaginationParams({ page: '3', pageSize: '50' }), { page: 3, pageSize: 50, offset: 100, limit: 50 });
  assert.deepEqual(normalizePaginationParams({ page: '-1', pageSize: '1000' }), { page: 1, pageSize: 100, offset: 0, limit: 100 });
});

test('normalizeSortParams uses allowlist and safe direction', () => {
  const fields = { name: item => item.name, createdAt: item => item.createdAt };
  assert.deepEqual(normalizeSortParams({ sortBy: 'name', sortDir: 'desc' }, fields), { sortBy: 'name', sortDir: 'desc' });
  assert.deepEqual(
    normalizeSortParams({ sortBy: 'DROP TABLE', sortDir: 'sideways' }, fields, { sortBy: 'createdAt', sortDir: 'desc' }),
    { sortBy: 'createdAt', sortDir: 'desc' },
  );
});

test('buildPaginatedResponse filters and sorts before callers slice data', () => {
  const rows = [
    { id: '1', name: 'Gamma', amount: 30 },
    { id: '2', name: 'Alpha', amount: 10 },
    { id: '3', name: 'Beta', amount: 20 },
  ];
  const response = buildPaginatedResponse(rows, { page: '1', pageSize: '10', sortBy: 'amount', sortDir: 'asc' }, {
    sortFields: { amount: item => item.amount },
    defaultSort: { sortBy: 'amount', sortDir: 'desc' },
  });
  assert.deepEqual(response.items.map(item => item.id), ['2', '3', '1']);
  assert.deepEqual(response.pagination, {
    page: 1,
    pageSize: 10,
    total: 3,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });
});

test('itemMatchesSearch and wantsPaginatedResponse are defensive', () => {
  assert.equal(itemMatchesSearch({ name: 'ООО Скайтех', inn: '123' }, 'скай', ['name']), true);
  assert.equal(itemMatchesSearch({ name: 'ООО Скайтех', inn: '123' }, '999', ['name', 'inn']), false);
  assert.equal(wantsPaginatedResponse({ paginated: 'true' }), true);
  assert.equal(wantsPaginatedResponse({ paginated: '1' }), false);
});

test('frontend paginated query sends opt-in page search sort and filters', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/lib/api.ts'), 'utf8');
  assert.match(source, /searchParams\.set\('paginated', 'true'\)/);
  assert.match(source, /searchParams\.set\('page', String\(params\.page\)\)/);
  assert.match(source, /searchParams\.set\('pageSize', String\(params\.pageSize\)\)/);
  assert.match(source, /searchParams\.set\('search', params\.search\)/);
  assert.match(source, /searchParams\.set\('sortBy', params\.sortBy\)/);
  assert.match(source, /searchParams\.set\(key, String\(value\)\)/);
  assert.match(source, /value === 'all'/);
});

test('server pagination hook resets page on search filter and page size changes', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/hooks/useServerPagination.ts'), 'utf8');
  assert.match(source, /setPageSizeState\(normalized\);[\s\S]*setPageState\(1\);/);
  assert.match(source, /setSearchState\(nextSearch\);[\s\S]*setPageState\(1\);/);
  assert.match(source, /setFiltersState\(\(current\) => \(\{ \.\.\.current, \.\.\.nextFilters \}\)\);[\s\S]*setPageState\(1\);/);
  assert.match(source, /\[10, 25, 50, 100\]\.includes\(nextPageSize\)/);
});

test('first wave pages render shared controls and paginated hooks', () => {
  const files = [
    ['src/app/pages/Service.tsx', 'usePaginatedServiceTickets'],
    ['src/app/pages/Deliveries.tsx', 'usePaginatedDeliveries'],
    ['src/app/pages/Clients.tsx', 'usePaginatedClients'],
    ['src/app/pages/Documents.tsx', 'usePaginatedDocuments'],
    ['src/app/pages/Payments.tsx', 'usePaginatedPayments'],
  ];
  for (const [file, hook] of files) {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.match(source, new RegExp(hook));
    assert.match(source, /<PaginationControls/);
  }
});

test('documents page uses bounded reference search instead of loading full registry for wizard chains', () => {
  const pageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Documents.tsx'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(process.cwd(), 'src/app/services/documents.service.ts'), 'utf8');
  const routeSource = fs.readFileSync(path.join(process.cwd(), 'server/routes/documents.js'), 'utf8');

  assert.doesNotMatch(pageSource, /useDocumentsList\(/);
  assert.match(pageSource, /useDocumentReferences\(/);
  assert.match(pageSource, /documentWizardOpen/);
  assert.match(serviceSource, /\/api\/documents\/references/);
  assert.match(routeSource, /documentsRouter\.get\('\/documents\/references'/);
  assert.match(routeSource, /compactDocumentReference/);
  assert.match(routeSource, /pageSize: req\.query\.pageSize \|\| '25'/);
});

test('clients page receives backend financial summary without frontend full rentals payments load', () => {
  const pageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Clients.tsx'), 'utf8');
  const routeSource = fs.readFileSync(path.join(process.cwd(), 'server/routes/crud.js'), 'utf8');

  assert.doesNotMatch(pageSource, /useGanttData/);
  assert.doesNotMatch(pageSource, /usePaymentsList/);
  assert.doesNotMatch(pageSource, /mergeClientsWithFinancials/);
  assert.match(routeSource, /buildClientFinancialSnapshots/);
  assert.match(routeSource, /enrichClientsWithBackendFinancials/);
  assert.match(routeSource, /collection === 'clients'[\s\S]*enrichClientsWithBackendFinancials/);
});
