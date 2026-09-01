import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import { createPr9bContext } from './canonical-actual-posting-fixtures.js';

const require = createRequire(import.meta.url);
const {
  createCanonicalActualPostingProductService,
} = require('../server/lib/canonical-actual-posting-product-service');
const {
  SQLITE_READONLY_STATEMENT_REQUIRED,
} = require('../server/lib/sqlite-readonly-statement');

function readScope(event) {
  return Object.freeze({
    authenticated: true,
    capabilities: Object.freeze(['receivables.read']),
    companyId: event.companyId,
    companyWideBranchAuthority: false,
    allowedBranchIds: Object.freeze([event.branchId]),
  });
}

test('canonical posting product preview keeps every prepared read behind Statement.readonly', () => {
  const context = createPr9bContext();
  try {
    const scope = readScope(context.event);
    const normal = createCanonicalActualPostingProductService({
      db: context.db,
      runtimeContract: context.runtimeContract,
      runtimeEnabled: true,
    });
    const preview = normal.listEligibleEvents(scope);
    assert.equal(preview.ok, true);
    assert.ok(preview.items.some(item => item.eventId === context.event.id));

    let hostileAllCalls = 0;
    let hostilePrepareCalls = 0;
    const armedDb = new Proxy(context.db, {
      get(target, property) {
        if (property === 'prepare') {
          return sql => {
            if (/ORDER BY\s+event\.createdAt DESC/i.test(String(sql))) {
              hostilePrepareCalls += 1;
              return Object.freeze({
                readonly: false,
                all() {
                  hostileAllCalls += 1;
                  return [];
                },
              });
            }
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const armed = createCanonicalActualPostingProductService({
      db: armedDb,
      runtimeContract: context.runtimeContract,
      runtimeEnabled: true,
    });
    assert.throws(
      () => armed.listEligibleEvents(scope),
      error => error.code === SQLITE_READONLY_STATEMENT_REQUIRED,
    );
    assert.equal(hostilePrepareCalls, 1);
    assert.equal(hostileAllCalls, 0);
  } finally {
    context.db.close();
  }
});
