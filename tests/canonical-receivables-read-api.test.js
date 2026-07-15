import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createCanonicalReadContext,
  insertReceivable,
  trustedScope,
  withServer,
} from './canonical-receivables-read-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const {
  registerCanonicalReceivablesReadRoutes,
} = require('../server/routes/canonical-receivables-read.js');

function createApp(context, options = {}) {
  const app = express();
  const router = express.Router();
  app.use(express.json());
  const requireAuth = (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = { userId: token };
    return next();
  };
  registerCanonicalReceivablesReadRoutes(router, {
    enabled: options.enabled ?? true,
    db: context?.db,
    requireAuth,
    resolveTrustedScope: options.resolveTrustedScope === undefined
      ? ({ principal }) => trustedScope({ principalId: principal.userId })
      : options.resolveTrustedScope,
    cursorSecret: 'http-test-cursor-secret',
    now: () => new Date('2026-07-15T12:00:00.000Z'),
    service: options.service,
    logger: { error() {} },
  });
  app.use('/api', router);
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
  return app;
}

async function request(baseUrl, path, { method = 'GET', token = 'finance-user', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: token ? `Bearer ${token}` : '',
      'content-type': 'application/json',
      'x-request-id': 'request-test-1',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json().catch(() => null) };
}

test('feature flag disabled registers no canonical read route', async () => {
  const context = createCanonicalReadContext();
  try {
    await withServer(createApp(context, { enabled: false }), async baseUrl => {
      const result = await request(baseUrl, '/api/receivables');
      assert.equal(result.response.status, 404);
    });
  } finally {
    context.close();
  }
});

test('missing authentication, trusted scope, or read capability is denied with request ID', async () => {
  const context = createCanonicalReadContext();
  try {
    await withServer(createApp(context), async baseUrl => {
      const unauthenticated = await request(baseUrl, '/api/receivables', { token: '' });
      assert.equal(unauthenticated.response.status, 401);
      assert.equal(unauthenticated.json.error.code, 'UNAUTHENTICATED');
      assert.equal(unauthenticated.json.error.requestId, 'request-test-1');
    });
    await withServer(createApp(context, { resolveTrustedScope: null }), async baseUrl => {
      const denied = await request(baseUrl, '/api/receivables');
      assert.equal(denied.response.status, 403);
      assert.equal(denied.json.error.code, 'RECEIVABLES_SCOPE_DENIED');
    });
    await withServer(createApp(context, {
      resolveTrustedScope: () => trustedScope({ capabilities: [] }),
    }), async baseUrl => {
      const denied = await request(baseUrl, '/api/receivables');
      assert.equal(denied.response.status, 403);
      assert.equal(denied.json.error.code, 'RECEIVABLES_READ_FORBIDDEN');
    });
  } finally {
    context.close();
  }
});

test('GET list/detail/summary/aging expose canonical shapes and static route order', async () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, { id: 'rec-api', originalAmountMinor: 12345 });
    await withServer(createApp(context), async baseUrl => {
      const list = await request(baseUrl, '/api/receivables?asOfDate=2026-07-15');
      assert.equal(list.response.status, 200);
      assert.deepEqual(Object.keys(list.json).sort(), ['hasMore', 'items', 'nextCursor', 'scope']);
      assert.equal(list.json.items[0].id, 'rec-api');
      assert.equal(list.json.items[0].outstandingBalanceMinor, 12345);

      const detail = await request(baseUrl, '/api/receivables/rec-api?asOfDate=2026-07-15');
      assert.equal(detail.response.status, 200);
      assert.equal(detail.json.id, 'rec-api');
      assert.deepEqual(detail.json.canonicalLinks, {
        paymentAllocationIds: [], receivableAdjustmentIds: [],
      });

      const summary = await request(baseUrl, '/api/receivables/summary?asOfDate=2026-07-15');
      assert.equal(summary.response.status, 200);
      assert.equal(summary.json.receivableCount, 1);
      assert.equal(summary.json.totalOutstandingMinor, 12345);
      assert.equal(summary.json.requestId, 'request-test-1');

      const aging = await request(baseUrl, '/api/receivables/aging?asOfDate=2026-07-15');
      assert.equal(aging.response.status, 200);
      assert.equal(aging.json.calculationVersion, 'receivables-aging-v1');
      assert.equal(aging.json.totalOutstandingMinor, 12345);
      assert.equal(aging.json.reconciled, true);
      assert.equal(aging.json.requestId, 'request-test-1');
    });
  } finally {
    context.close();
  }
});

test('trusted company and branch predicates prevent cross-scope list/detail access', async () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, { id: 'rec-a1', branchId: 'branch-a1' });
    insertReceivable(context.db, { id: 'rec-a2', branchId: 'branch-a2' });
    insertReceivable(context.db, { id: 'rec-b', companyId: 'company-b', branchId: 'branch-b1' });
    const scopedApp = createApp(context, {
      resolveTrustedScope: () => trustedScope({
        companyWideBranchAccess: false,
        allowedBranchIds: ['branch-a1'],
      }),
    });
    await withServer(scopedApp, async baseUrl => {
      const list = await request(baseUrl, '/api/receivables');
      assert.deepEqual(list.json.items.map(item => item.id), ['rec-a1']);

      const allowedFilter = await request(baseUrl, '/api/receivables?branchId=branch-a1');
      assert.equal(allowedFilter.response.status, 200);
      const deniedFilter = await request(baseUrl, '/api/receivables?branchId=branch-a2');
      assert.equal(deniedFilter.response.status, 403);
      assert.equal(deniedFilter.json.error.code, 'BRANCH_SCOPE_FORBIDDEN');

      const branchDetail = await request(baseUrl, '/api/receivables/rec-a2');
      assert.equal(branchDetail.response.status, 404);
      const companyDetail = await request(baseUrl, '/api/receivables/rec-b');
      assert.equal(companyDetail.response.status, 404);
      const clientCompany = await request(baseUrl, '/api/receivables?companyId=company-b');
      assert.equal(clientCompany.response.status, 400);
      assert.equal(clientCompany.json.error.code, 'UNKNOWN_FILTER');
    });
    await withServer(createApp(context), async baseUrl => {
      const unknownBranch = await request(baseUrl, '/api/receivables?branchId=missing-branch');
      assert.equal(unknownBranch.response.status, 403);
      assert.equal(unknownBranch.json.error.code, 'BRANCH_SCOPE_FORBIDDEN');
    });
  } finally {
    context.close();
  }
});

test('list filters and deterministic signed cursor pagination validate tampering and limits', async () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, {
      id: 'rec-1', createdAt: '2026-06-01T09:00:00.000Z', sourceSystem: 'source-a',
    });
    insertReceivable(context.db, {
      id: 'rec-2', createdAt: '2026-06-01T09:00:00.000Z', sourceSystem: 'source-a', branchId: 'branch-a2',
    });
    insertReceivable(context.db, {
      id: 'rec-3', createdAt: '2026-06-02T09:00:00.000Z', sourceSystem: 'source-b', workflowStatus: 'draft',
    });
    await withServer(createApp(context), async baseUrl => {
      const first = await request(baseUrl, '/api/receivables?limit=1');
      assert.equal(first.response.status, 200);
      assert.equal(first.json.items[0].id, 'rec-1');
      assert.equal(first.json.hasMore, true);
      assert.ok(first.json.nextCursor);
      const second = await request(baseUrl, `/api/receivables?limit=1&cursor=${encodeURIComponent(first.json.nextCursor)}`);
      assert.equal(second.json.items[0].id, 'rec-2');

      const tampered = `${first.json.nextCursor.slice(0, -1)}x`;
      const invalid = await request(baseUrl, `/api/receivables?limit=1&cursor=${encodeURIComponent(tampered)}`);
      assert.equal(invalid.response.status, 400);
      assert.equal(invalid.json.error.code, 'INVALID_CURSOR');
      const reused = await request(baseUrl,
        `/api/receivables?limit=1&sourceSystem=source-b&cursor=${encodeURIComponent(first.json.nextCursor)}`);
      assert.equal(reused.response.status, 400);

      const filtered = await request(baseUrl, '/api/receivables?sourceSystem=source-b&status=draft');
      assert.deepEqual(filtered.json.items.map(item => item.id), ['rec-3']);
      for (const limit of ['0', '201', '1.5']) {
        const response = await request(baseUrl, `/api/receivables?limit=${limit}`);
        assert.equal(response.response.status, 400);
        assert.equal(response.json.error.code, 'INVALID_LIMIT');
      }
    });
  } finally {
    context.close();
  }
});

test('filtered cursor pagination continues across bounded canonical query batches', async () => {
  const context = createCanonicalReadContext();
  try {
    for (let index = 0; index < 205; index += 1) {
      insertReceivable(context.db, {
        id: `rec-batch-${String(index).padStart(3, '0')}`,
        sourceSystem: 'source-nonmatch',
      });
    }
    insertReceivable(context.db, { id: 'rec-batch-205', sourceSystem: 'source-match' });
    insertReceivable(context.db, { id: 'rec-batch-206', sourceSystem: 'source-match' });

    await withServer(createApp(context), async baseUrl => {
      const first = await request(baseUrl, '/api/receivables?sourceSystem=source-match&limit=1');
      assert.equal(first.response.status, 200);
      assert.deepEqual(first.json.items.map(item => item.id), ['rec-batch-205']);
      assert.equal(first.json.hasMore, true);
      assert.ok(first.json.nextCursor);

      const second = await request(baseUrl,
        `/api/receivables?sourceSystem=source-match&limit=1&cursor=${encodeURIComponent(first.json.nextCursor)}`);
      assert.equal(second.response.status, 200);
      assert.deepEqual(second.json.items.map(item => item.id), ['rec-batch-206']);
      assert.equal(second.json.hasMore, false);
      assert.equal(second.json.nextCursor, null);
    });
  } finally {
    context.close();
  }
});

test('validation rejects malformed dates, unsupported currency, unknown filters, and invalid timezone data', async () => {
  const context = createCanonicalReadContext();
  try {
    await withServer(createApp(context), async baseUrl => {
      for (const date of ['bad-date', '2026-02-30']) {
        const result = await request(baseUrl, `/api/receivables/aging?asOfDate=${date}`);
        assert.equal(result.response.status, 400);
        assert.equal(result.json.error.code, 'INVALID_DATE');
      }
      const currency = await request(baseUrl, '/api/receivables/aging?currency=USD');
      assert.equal(currency.response.status, 422);
      assert.equal(currency.json.error.code, 'UNSUPPORTED_CURRENCY');
      const timezoneOverride = await request(baseUrl, '/api/receivables/aging?timezone=UTC');
      assert.equal(timezoneOverride.response.status, 400);
      assert.equal(timezoneOverride.json.error.code, 'UNKNOWN_FILTER');
    });
    context.db.prepare("UPDATE canonical_companies SET receivablesTimezone = 'Invalid/Timezone' WHERE id = 'company-a'").run();
    await withServer(createApp(context), async baseUrl => {
      const result = await request(baseUrl, '/api/receivables/aging');
      assert.equal(result.response.status, 500);
      assert.equal(result.json.error.code, 'INVALID_COMPANY_TIMEZONE');
      assert.equal(result.json.error.message, 'Canonical receivables read calculation failed.');
    });
  } finally {
    context.close();
  }
});

test('canonical routes expose no POST, PATCH, or DELETE capability and reconciliation failure returns no partial result', async () => {
  const context = createCanonicalReadContext();
  try {
    await withServer(createApp(context), async baseUrl => {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        const result = await request(baseUrl, '/api/receivables', { method, body: {} });
        assert.equal(result.response.status, 404);
      }
    });
    const failingService = {
      summary() { throw Object.assign(new Error('forced'), { code: 'RECEIVABLES_RECONCILIATION_FAILED' }); },
      aging() { throw Object.assign(new Error('forced'), { code: 'RECEIVABLES_RECONCILIATION_FAILED' }); },
      list() { return { items: [], nextCursor: null, hasMore: false, scope: {} }; },
      detail() { return null; },
    };
    await withServer(createApp(context, { service: failingService }), async baseUrl => {
      const result = await request(baseUrl, '/api/receivables/aging');
      assert.equal(result.response.status, 500);
      assert.equal(result.json.error.code, 'RECEIVABLES_RECONCILIATION_FAILED');
      assert.equal(result.json.totalOutstandingMinor, undefined);
      assert.equal(result.json.error.requestId, 'request-test-1');
    });
  } finally {
    context.close();
  }
});
