import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  base32Rfc4648NoPadding,
  canonicalCompanyIdentityKey,
  deriveCanonicalCompanyId,
} = require('../server/lib/canonical-company-id.js');

const SKYTECH_IDENTITY = Object.freeze({
  jurisdiction: 'RU',
  registry: 'INN',
  value: '1660217548',
});

test('canonical Company ID uses the approved INN identity and RFC 4648 base32 without padding', () => {
  const result = deriveCanonicalCompanyId(SKYTECH_IDENTITY);

  assert.equal(
    result.canonicalIdentityKey,
    'rentcore:company:v1|jurisdiction=RU|registry=INN|value=1660217548',
  );
  assert.equal(result.sha256Hex, 'f9026198f378c197e6a565035b0299cac846c58ae97e6fa6209c2c3ca4e6c419');
  assert.equal(result.base32Digest, '7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ');
  assert.equal(result.companyId, 'cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ');
  assert.equal(result.companyId.length, 56);
});

test('canonical Company ID is independent of mutable legal display fields', () => {
  const initial = deriveCanonicalCompanyId({
    ...SKYTECH_IDENTITY,
    legalName: 'Initial name',
    shortName: 'Initial short name',
    kpp: '165501001',
    legalAddress: 'Initial address',
  });
  const renamed = deriveCanonicalCompanyId({
    ...SKYTECH_IDENTITY,
    legalName: 'Renamed company',
    shortName: 'Renamed',
    kpp: '000000000',
    legalAddress: 'New address',
  });

  assert.deepEqual(renamed, initial);
});

test('canonical Company identity normalizes registry tokens but rejects non-canonical INN values', () => {
  assert.equal(
    canonicalCompanyIdentityKey({ jurisdiction: ' ru ', registry: ' inn ', value: '1660217548' }),
    'rentcore:company:v1|jurisdiction=RU|registry=INN|value=1660217548',
  );
  assert.throws(
    () => deriveCanonicalCompanyId({ jurisdiction: 'RU', registry: 'INN', value: '1660 217548' }),
    /registry value is invalid/,
  );
  assert.throws(
    () => deriveCanonicalCompanyId({ jurisdiction: 'RU', registry: 'INN', value: '166021754' }),
    /10 or 12 digits/,
  );
});

test('base32 encoder follows independent RFC 4648 vectors without padding', () => {
  assert.equal(base32Rfc4648NoPadding(Buffer.from('foo')), 'MZXW6');
  assert.equal(base32Rfc4648NoPadding(Buffer.from('foobar')), 'MZXW6YTBOI');
});

test('offline remediation plan uses canonical scope only for explicit business mappings', () => {
  const plan = JSON.parse(readFileSync(
    new URL('../docs/production-scope-remediation-plan-2026-08-25.json', import.meta.url),
    'utf8',
  ));
  const companyId = deriveCanonicalCompanyId(SKYTECH_IDENTITY).companyId;
  const businessActorIds = new Set(['1775756913074', '1776673416137', '1787547467703']);
  const businessRecordIds = new Set([
    'CP-1787305873918-cb43be',
    'CPRA-19e67e15a554df5b2d434852',
    'C-1787305873917-d5aa12',
    'CO-1787567881301-0301ec',
  ]);
  const smokeRecordIds = new Set([
    'CP-1787585239479-4a34e4',
    'CPRA-206c0cc4343e162cbfd7dcf6',
    'CO-1787567867426-2c27d0',
    'CO-1787585252222-35e4d5',
  ]);

  assert.equal(plan.authority.companyId, companyId);
  assert.equal(plan.authority.tenantId, companyId);
  assert.equal(plan.canonicalCompanyIdStrategy.companyId, companyId);
  assert.equal(plan.canonicalCompanyIdStrategy.tenantId, companyId);
  for (const actor of plan.actorMappings) {
    if (businessActorIds.has(actor.userId)) {
      assert.equal(actor.companyId, companyId, actor.userId);
      assert.equal(actor.tenantId, companyId, actor.userId);
    }
  }
  const smokeActor = plan.actorMappings.find(actor => actor.userId === 'production-smoke-admin');
  assert.equal(smokeActor.companyId, null);
  assert.equal(smokeActor.tenantId, null);
  assert.equal(smokeActor.action, 'UNRESOLVED');

  for (const record of plan.recordMappings) {
    if (businessRecordIds.has(record.id)) {
      assert.equal(record.action, 'UPDATE_SCOPE', record.id);
      assert.equal(record.companyId, companyId, record.id);
      assert.equal(record.tenantId, companyId, record.id);
    }
    if (smokeRecordIds.has(record.id)) {
      assert.equal(record.action, 'UNRESOLVED', record.id);
      assert.equal(record.companyId, null, record.id);
      assert.equal(record.tenantId, null, record.id);
    }
  }
});
