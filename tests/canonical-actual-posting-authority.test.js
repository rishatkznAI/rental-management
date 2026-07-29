import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  authorityRecord,
  createPr9aContext,
  hash,
} from './canonical-actual-posting-fixtures.js';

const require = createRequire(import.meta.url);
const {
  ERROR_CODES,
  canonicalJson,
  computeGovernedAuthorityRecordHash,
  createFrozenAuthorityChainSnapshot,
  verifyFrozenAuthorityChainSnapshot,
} = require('../server/lib/canonical-actual-posting-domain.js');
const {
  createCanonicalActualPostingAuthorityRepository,
  selectGlobalAuthorityDenial,
} = require('../server/lib/canonical-actual-posting-authority-repository.js');

const DENIAL_ID = '01234567-89ab-4cde-8fab-0123456789ab';
const DENIED_AT = '2026-07-27T12:00:00.000Z';

function createAuthorityContext() {
  return createPr9aContext({ authorityNowMs: Date.parse(DENIED_AT) });
}

function nextAuthority(previous, version, overrides = {}) {
  const { recordHash: _recordHash, ...previousWithoutHash } = previous;
  return authorityRecord({
    kind: previous.authorityKind,
    ownershipHash: previous.sourceOwnershipManifestHash,
    overrides: {
      ...previousWithoutHash,
      recordId: `authority-record-${previous.authorityKind}-v${version}`,
      authorityVersion: version,
      previousRecordId: previous.recordId,
      createdAt: `2026-07-27T10:${String(version).padStart(2, '0')}:00.000Z`,
      ...overrides,
    },
  });
}

function mutateAppendOnlyTable(db, table, mutation) {
  const triggers = db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL
    ORDER BY name
  `).all(table);
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
  try {
    mutation();
  } finally {
    for (const trigger of triggers) db.exec(trigger.sql);
  }
}

test('authority repository appends and replays an exact root-to-head chain', () => {
  const context = createAuthorityContext();
  try {
    const repository = createCanonicalActualPostingAuthorityRepository(context.db);
    const root = context.authority.source;
    assert.equal(repository.appendAuthorityRecord(root).replayed, true);
    let previous = root;
    for (let version = 2; version <= 10; version += 1) {
      const record = nextAuthority(previous, version);
      assert.equal(repository.appendAuthorityRecord(record).replayed, false);
      previous = record;
    }
    const chain = repository.readAuthorityChain(root);
    assert.equal(chain.length, 10);
    assert.deepEqual(chain.map(row => row.authorityVersion), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(repository.readLatestAuthority(root).recordId, previous.recordId);
    const invalidSuccessor = { ...nextAuthority(previous, 11), previousRecordId: root.recordId };
    invalidSuccessor.recordHash = computeGovernedAuthorityRecordHash(invalidSuccessor);
    assert.throws(
      () => repository.appendAuthorityRecord(invalidSuccessor),
      error => error.code === 'CANONICAL_AUTHORITY_VERSION_CHAIN_INVALID',
    );
  } finally {
    context.db.close();
  }
});

test('full record hash is recomputed and exact append conflicts fail closed', () => {
  const context = createAuthorityContext();
  try {
    const repository = context.authority.repository;
    const record = context.authority.producer;
    assert.equal(computeGovernedAuthorityRecordHash(record), record.recordHash);
    assert.throws(
      () => repository.appendAuthorityRecord({ ...record, ownerRef: 'mutated-owner' }),
      error => error.code === ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED,
    );
    assert.equal(repository.readAuthorityRecord(record.recordId).ownerRef, record.ownerRef);
  } finally {
    context.db.close();
  }
});

test('frozen snapshots prove every member and reject missing, mutated, or reordered input', () => {
  const context = createAuthorityContext();
  try {
    const row = context.authority.source;
    const built = createFrozenAuthorityChainSnapshot({
      authorityRows: [row],
      candidates: [],
      denialAttemptId: DENIAL_ID,
      deniedAttemptedAt: DENIED_AT,
      precedenceState: 'unaffected_active_latest',
    });
    const verified = verifyFrozenAuthorityChainSnapshot({
      snapshot: built.snapshot,
      snapshotHash: built.hash,
      persistedRows: [row],
      expectedAuthorityKind: 'source_adapter',
    });
    assert.equal(verified.memberCount, 1);
    assert.equal(verified.members[0].authorityRecordHash, row.recordHash);
    assert.throws(
      () => verifyFrozenAuthorityChainSnapshot({
        snapshot: built.snapshot,
        snapshotHash: built.hash,
        persistedRows: [],
        expectedAuthorityKind: 'source_adapter',
      }),
      error => error.code === ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED,
    );
    assert.throws(
      () => verifyFrozenAuthorityChainSnapshot({
        snapshot: built.snapshot,
        snapshotHash: built.hash,
        persistedRows: [{ ...row, ownerRef: 'mutated-but-old-hash' }],
        expectedAuthorityKind: 'source_adapter',
      }),
      error => error.code === ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED,
    );
  } finally {
    context.db.close();
  }
});

test('post-boundary descendants are excluded from historical frozen classification', () => {
  const context = createAuthorityContext();
  try {
    const repository = context.authority.repository;
    const root = context.authority.source;
    const frozen = repository.freezeAuthorityState({
      scope: root,
      binding: {
        recordId: root.recordId,
        recordHash: root.recordHash,
        companyId: root.companyId,
        branchId: root.branchId,
      },
      attemptedAt: DENIED_AT,
      denialAttemptId: DENIAL_ID,
      precedenceState: 'unaffected_active_latest',
    });
    const descendant = nextAuthority(root, 2, {
      configurationHash: hash('post-boundary-configuration'),
    });
    repository.appendAuthorityRecord(descendant);
    const verified = repository.verifyFrozenAuthorityState({
      snapshot: frozen.snapshot,
      snapshotHash: frozen.hash,
      expectedAuthorityKind: 'source_adapter',
    });
    assert.equal(verified.memberCount, 1);
    assert.equal(verified.boundary.maximumObservedAuthorityVersion, 1);
    assert.equal(repository.readLatestAuthority(root).authorityVersion, 2);
  } finally {
    context.db.close();
  }
});

test('frozen authority verification rejects malformed suffixes, gaps, and pre-boundary mutation', async t => {
  await t.test('malformed contiguous suffix row', () => {
    const context = createAuthorityContext();
    try {
      const repository = context.authority.repository;
      const root = context.authority.source;
      const frozen = repository.freezeAuthorityState({
        scope: root,
        binding: {
          recordId: root.recordId,
          recordHash: root.recordHash,
          companyId: root.companyId,
          branchId: root.branchId,
        },
        attemptedAt: DENIED_AT,
        denialAttemptId: DENIAL_ID,
        precedenceState: 'unaffected_active_latest',
      });
      const descendant = nextAuthority(root, 2);
      repository.appendAuthorityRecord(descendant);
      mutateAppendOnlyTable(context.db, 'governed_adapter_authority_records', () => {
        context.db.prepare(`
          UPDATE governed_adapter_authority_records SET ownerRef = 'mutated-suffix-owner'
          WHERE recordId = ?
        `).run(descendant.recordId);
      });
      assert.throws(
        () => repository.verifyFrozenAuthorityState({
          snapshot: frozen.snapshot,
          snapshotHash: frozen.hash,
          expectedAuthorityKind: 'source_adapter',
        }),
        error => error.code === ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED,
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('gap above frozen maximum', () => {
    const context = createAuthorityContext();
    try {
      const repository = context.authority.repository;
      const root = context.authority.source;
      const frozen = repository.freezeAuthorityState({
        scope: root,
        binding: {
          recordId: root.recordId,
          recordHash: root.recordHash,
          companyId: root.companyId,
          branchId: root.branchId,
        },
        attemptedAt: DENIED_AT,
        denialAttemptId: DENIAL_ID,
        precedenceState: 'unaffected_active_latest',
      });
      const second = nextAuthority(root, 2);
      const third = nextAuthority(second, 3);
      repository.appendAuthorityRecord(second);
      repository.appendAuthorityRecord(third);
      context.db.pragma('foreign_keys = OFF');
      try {
        mutateAppendOnlyTable(context.db, 'governed_adapter_authority_records', () => {
          context.db.prepare(`
            DELETE FROM governed_adapter_authority_records WHERE recordId = ?
          `).run(second.recordId);
        });
      } finally {
        context.db.pragma('foreign_keys = ON');
      }
      assert.throws(
        () => repository.verifyFrozenAuthorityState({
          snapshot: frozen.snapshot,
          snapshotHash: frozen.hash,
          expectedAuthorityKind: 'source_adapter',
        }),
        error => error.code === ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED,
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('mutation at or below frozen maximum', () => {
    const context = createAuthorityContext();
    try {
      const repository = context.authority.repository;
      const root = context.authority.source;
      const second = nextAuthority(root, 2);
      repository.appendAuthorityRecord(second);
      const frozen = repository.freezeAuthorityState({
        scope: root,
        binding: {
          recordId: second.recordId,
          recordHash: second.recordHash,
          companyId: second.companyId,
          branchId: second.branchId,
        },
        attemptedAt: DENIED_AT,
        denialAttemptId: DENIAL_ID,
        precedenceState: 'unaffected_active_latest',
      });
      mutateAppendOnlyTable(context.db, 'governed_adapter_authority_records', () => {
        context.db.prepare(`
          UPDATE governed_adapter_authority_records SET ownerRef = 'mutated-frozen-owner'
          WHERE recordId = ?
        `).run(root.recordId);
      });
      assert.throws(
        () => repository.verifyFrozenAuthorityState({
          snapshot: frozen.snapshot,
          snapshotHash: frozen.hash,
          expectedAuthorityKind: 'source_adapter',
        }),
        error => error.code === ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED,
      );
    } finally {
      context.db.close();
    }
  });
});

test('candidate ordering and global kind-major precedence are input-order independent for versions 2 and 10', () => {
  const candidates = [
    { authorityRecordHash: 'a'.repeat(64), authorityRecordId: 'v2', authorityVersion: 2, precedenceRank: 3, stateCode: 'EXPIRED' },
    { authorityRecordHash: 'b'.repeat(64), authorityRecordId: 'v10', authorityVersion: 10, precedenceRank: 3, stateCode: 'EXPIRED' },
  ];
  const first = selectGlobalAuthorityDenial([
    { authorityKind: 'canonical_posting_adapter', candidates: [...candidates].reverse() },
    { authorityKind: 'eligibility_producer', candidates: [] },
    { authorityKind: 'source_adapter', candidates: [{ ...candidates[0], precedenceRank: 9 }] },
  ]);
  const second = selectGlobalAuthorityDenial([
    { authorityKind: 'source_adapter', candidates: [{ ...candidates[0], precedenceRank: 9 }] },
    { authorityKind: 'canonical_posting_adapter', candidates },
    { authorityKind: 'eligibility_producer', candidates: [] },
  ]);
  assert.equal(first.authorityKind, 'source_adapter');
  assert.equal(second.authorityKind, 'source_adapter');
  assert.equal(canonicalJson(first), canonicalJson(second));
});
