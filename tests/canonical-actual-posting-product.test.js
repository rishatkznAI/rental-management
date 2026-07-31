import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createPr9bContext,
  postingGraphSnapshot,
  totalChanges,
} from './canonical-actual-posting-fixtures.js';
import { withServer } from './canonical-receivables-read-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const {
  DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
} = require('../server/lib/canonical-actual-posting-domain.js');
const {
  CANONICAL_ACTUAL_POSTING_PRODUCT_PATH,
  registerCanonicalActualPostingProductRoutes,
} = require('../server/routes/canonical-actual-posting-product.js');

function productApp(context, options = {}) {
  const app = express();
  const router = express.Router();
  app.use(express.json());
  registerCanonicalActualPostingProductRoutes(router, {
    db: context.db,
    runtimeConfig: options.enabled === false
      ? { enabled: false, runtimeContract: DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT }
      : { enabled: true, runtimeContract: context.runtimeContract },
    readUsers: context.readUsers,
    readClients: () => [{ id: 'client-1', name: 'Fixture client' }],
    resolveScope: options.resolveScope,
    service: options.service,
    requireAuth(req, res, next) {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
      if (!token) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      req.user = token === 'viewer-token'
        ? { userId: 'U-pr9-other', userRole: 'Менеджер по аренде' }
        : { userId: 'U-pr9', userRole: 'Администратор' };
      return next();
    },
    requireFinanceWrite(req, res, next) {
      if (req.user?.userRole !== 'Администратор') {
        return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role' });
      }
      return next();
    },
    logger: { log() {}, warn() {}, error() {} },
  });
  app.use('/api', router);
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'not-found' }));
  return app;
}

async function json(baseUrl, method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json() };
}

const eventPath = eventId => `/api${CANONICAL_ACTUAL_POSTING_PRODUCT_PATH}/${eventId}`;

test('product posting endpoint requires authentication and existing finance mutation permission', async () => {
  const context = createPr9bContext();
  try {
    await withServer(productApp(context), async baseUrl => {
      const unauthorized = await json(baseUrl, 'POST', eventPath(context.event.id), null, {});
      assert.equal(unauthorized.response.status, 401);

      const forbidden = await json(baseUrl, 'POST', eventPath(context.event.id), 'viewer-token', {});
      assert.equal(forbidden.response.status, 403);
    });
    assert.equal(context.db.prepare('SELECT COUNT(*) count FROM canonical_receivables').get().count, 0);
  } finally {
    context.db.close();
  }
});

test('preview exposes scoped product fields without internal authority or hash material', async () => {
  const context = createPr9bContext();
  try {
    await withServer(productApp(context), async baseUrl => {
      const result = await json(
        baseUrl,
        'GET',
        `/api${CANONICAL_ACTUAL_POSTING_PRODUCT_PATH}`,
        'admin-token',
      );
      assert.equal(result.response.status, 200);
      assert.equal(result.body.runtime.enabled, true);
      assert.equal(result.body.items.length, 1);
      assert.deepEqual(
        {
          eventId: result.body.items[0].eventId,
          companyId: result.body.items[0].companyId,
          branchId: result.body.items[0].branchId,
          client: result.body.items[0].client,
          canPost: result.body.items[0].canPost,
        },
        {
          eventId: context.event.id,
          companyId: context.event.companyId,
          branchId: context.event.branchId,
          client: 'Fixture client',
          canPost: true,
        },
      );
      const serialized = JSON.stringify(result.body);
      assert.doesNotMatch(serialized, /token|authority|configurationHash|policyHash|eventHash|stack|database/i);
    });
  } finally {
    context.db.close();
  }
});

test('company and branch isolation is enforced again by the product service', async () => {
  const context = createPr9bContext();
  try {
    const wrongScope = Object.freeze({
      ...context.platformScope,
      companyId: 'company-other',
      allowedBranchIds: Object.freeze(['branch-other']),
    });
    await withServer(productApp(context, { resolveScope: async () => wrongScope }), async baseUrl => {
      const result = await json(baseUrl, 'POST', eventPath(context.event.id), 'admin-token', {});
      assert.equal(result.response.status, 404);
      assert.equal(result.body.status, 'scope_denied');
      assert.equal(typeof result.body.requestId, 'string');
    });
    assert.equal(context.db.prepare('SELECT COUNT(*) count FROM canonical_receivables').get().count, 0);
  } finally {
    context.db.close();
  }
});

test('disabled runtime is visible to the UI and fails closed without business DML', async () => {
  const context = createPr9bContext();
  try {
    const beforeGraph = postingGraphSnapshot(context.db);
    const beforeChanges = totalChanges(context.db);
    await withServer(productApp(context, { enabled: false }), async baseUrl => {
      const preview = await json(
        baseUrl,
        'GET',
        `/api${CANONICAL_ACTUAL_POSTING_PRODUCT_PATH}`,
        'admin-token',
      );
      assert.equal(preview.response.status, 200);
      assert.equal(preview.body.runtime.enabled, false);
      assert.equal(preview.body.runtime.message, 'Функция пока не включена в этом окружении.');
      assert.deepEqual(preview.body.items, []);

      const posting = await json(baseUrl, 'POST', eventPath(context.event.id), 'admin-token', {});
      assert.equal(posting.response.status, 409);
      assert.equal(posting.body.status, 'runtime_disabled');
    });
    assert.equal(totalChanges(context.db) - beforeChanges, 0);
    assert.equal(postingGraphSnapshot(context.db), beforeGraph);
  } finally {
    context.db.close();
  }
});

test('first product invocation returns created and exact replay returns already_created', async () => {
  const context = createPr9bContext();
  try {
    await withServer(productApp(context), async baseUrl => {
      const first = await json(baseUrl, 'POST', eventPath(context.event.id), 'admin-token', {});
      assert.equal(first.response.status, 200);
      assert.equal(first.body.status, 'created');
      assert.equal(first.body.replayed, false);
      assert.equal(first.body.amount, context.event.originalAmountMinor);
      assert.equal(Object.hasOwn(first.body, 'eventHash'), false);

      const second = await json(baseUrl, 'POST', eventPath(context.event.id), 'admin-token', {});
      assert.equal(second.response.status, 200);
      assert.equal(second.body.status, 'already_created');
      assert.equal(second.body.replayed, true);
      assert.equal(second.body.receivableId, first.body.receivableId);
      assert.equal(second.body.operationId, first.body.operationId);
    });
    assert.equal(context.db.prepare('SELECT COUNT(*) count FROM canonical_receivables').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) count FROM canonical_receivable_posting_operations').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) count FROM financial_audit_events').get().count, 1);
  } finally {
    context.db.close();
  }
});

test('parallel product invocations converge to one created result and one exact replay', async () => {
  const context = createPr9bContext();
  try {
    await withServer(productApp(context), async baseUrl => {
      const [left, right] = await Promise.all([
        json(baseUrl, 'POST', eventPath(context.event.id), 'admin-token', {}),
        json(baseUrl, 'POST', eventPath(context.event.id), 'admin-token', {}),
      ]);
      assert.deepEqual(
        [left.body.status, right.body.status].sort(),
        ['already_created', 'created'],
      );
      assert.equal(left.body.receivableId, right.body.receivableId);
      assert.equal(left.body.operationId, right.body.operationId);
    });
    assert.equal(context.db.prepare('SELECT COUNT(*) count FROM canonical_receivables').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) count FROM canonical_receivable_posting_operations').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) count FROM financial_audit_events').get().count, 1);
  } finally {
    context.db.close();
  }
});

test('product endpoint rejects caller-supplied scope and normalizes unexpected failures', async () => {
  const context = createPr9bContext();
  try {
    await withServer(productApp(context), async baseUrl => {
      const extraScope = await json(baseUrl, 'POST', eventPath(context.event.id), 'admin-token', {
        companyId: context.event.companyId,
        branchId: context.event.branchId,
      });
      assert.equal(extraScope.response.status, 400);
      assert.equal(extraScope.body.status, 'invalid_request');
    });

    const failingService = {
      enabled: true,
      assertEnabled() {},
      readEventScope() { return { companyId: 'company-a', branchId: 'branch-a-1' }; },
      postEligibleEvent() { throw new Error('private stack and database path /secret/app.sqlite'); },
    };
    await withServer(productApp(context, {
      service: failingService,
      resolveScope: async () => context.platformScope,
    }), async baseUrl => {
      const failed = await json(baseUrl, 'POST', eventPath(context.event.id), 'admin-token', {});
      assert.equal(failed.response.status, 500);
      assert.equal(failed.body.status, 'failed');
      assert.equal(typeof failed.body.requestId, 'string');
      assert.doesNotMatch(JSON.stringify(failed.body), /private stack|app\.sqlite|secret|Error:/i);
    });
  } finally {
    context.db.close();
  }
});
