import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  approvedTestPolicyManifest,
  dryRunCommand,
} from './actual-source-eligibility-dry-run-fixtures.js';

const require = createRequire(import.meta.url);
const {
  GATE_KEYS,
  createActualSourceDryRunContext,
  materializeActualSourceDryRunCommand,
  normalizePolicyManifest,
} = require('../server/lib/actual-source-eligibility-dry-run-domain.js');

test('policy manifest is complete, versioned, deterministically ordered, and fills missing gates unresolved', () => {
  const partial = approvedTestPolicyManifest({
    gates: { vat_basis: null },
  });
  const normalized = normalizePolicyManifest(partial);
  assert.deepEqual(normalized.gates.map(gate => gate.key), GATE_KEYS);
  assert.equal(normalized.gates.find(gate => gate.key === 'vat_basis').status, 'unresolved');
  assert.equal(normalized.gates.find(gate => gate.key === 'vat_basis').decisionRef, null);
  assert.equal(normalized.gates.length, 15);
});

test('unknown, duplicate, invalid, or reference-free policy gates are rejected', () => {
  const manifest = approvedTestPolicyManifest();
  assert.throws(
    () => normalizePolicyManifest({ ...manifest, gates: [...manifest.gates, { ...manifest.gates[0] }] }),
    error => error.code === 'ACTUAL_SOURCE_DUPLICATE_GATE',
  );
  assert.throws(
    () => normalizePolicyManifest({ ...manifest, gates: [{ ...manifest.gates[0], key: 'invented_gate' }] }),
    error => error.code === 'ACTUAL_SOURCE_UNKNOWN_GATE',
  );
  assert.throws(
    () => normalizePolicyManifest({ ...manifest, gates: [{ ...manifest.gates[0], status: 'eligible' }] }),
    error => error.code === 'ACTUAL_SOURCE_GATE_STATUS_INVALID',
  );
  assert.equal(normalizePolicyManifest({
    ...manifest,
    gates: [{
      ...manifest.gates[0],
      decisionHash: undefined,
    }],
  }).gates[0].status, 'unresolved');
  assert.throws(
    () => normalizePolicyManifest({
      ...manifest,
      gates: [{
        ...manifest.gates[0],
        status: 'unresolved',
      }],
    }),
    error => error.code === 'ACTUAL_SOURCE_UNRESOLVED_GATE_CONTENT_REJECTED',
  );
});

test('command boundary rejects unknown fields, invalid civil dates, unsafe numbers, and secret-like fields', () => {
  assert.throws(
    () => materializeActualSourceDryRunCommand({ ...dryRunCommand(), companyId: 'caller-company' }),
    error => error.code === 'ACTUAL_SOURCE_UNKNOWN_FIELD',
  );
  assert.throws(
    () => materializeActualSourceDryRunCommand({ ...dryRunCommand(), asOfDate: '2026-02-30' }),
    error => error.code === 'ACTUAL_SOURCE_INVALID_DATE',
  );
  assert.throws(
    () => materializeActualSourceDryRunCommand({ ...dryRunCommand(), policyManifest: { manifestId: 'x', manifestVersion: 1.2, schemaVersion: 1, gates: [] } }),
    error => error.code === 'ACTUAL_SOURCE_INPUT_NOT_INERT',
  );
  assert.throws(
    () => materializeActualSourceDryRunCommand({ ...dryRunCommand(), policyManifest: { manifestId: 'x', manifestVersion: 1, schemaVersion: 1, gates: [], apiToken: 'no' } }),
    error => error.code === 'ACTUAL_SOURCE_SECRET_FIELD_REJECTED',
  );
});

test('command boundary rejects proxies, getters, toJSON, class instances, cycles, sparse arrays, and symbols', () => {
  const base = dryRunCommand();
  assert.throws(
    () => materializeActualSourceDryRunCommand(new Proxy(base, {})),
    error => error.code === 'ACTUAL_SOURCE_INPUT_NOT_INERT',
  );

  const getter = { ...base };
  Object.defineProperty(getter, 'reasonText', { enumerable: true, get: () => 'unsafe' });
  assert.throws(() => materializeActualSourceDryRunCommand(getter), /deeply inert/);

  const withToJson = { ...base, toJSON() { return {}; } };
  assert.throws(() => materializeActualSourceDryRunCommand(withToJson), /deeply inert/);

  class Command {}
  assert.throws(() => materializeActualSourceDryRunCommand(Object.assign(new Command(), base)), /deeply inert/);

  const cycle = { ...base };
  cycle.self = cycle;
  assert.throws(() => materializeActualSourceDryRunCommand(cycle), /deeply inert/);

  const sparse = { ...base, policyManifest: { ...base.policyManifest, gates: new Array(2) } };
  assert.throws(() => materializeActualSourceDryRunCommand(sparse), /deeply inert/);

  const symbol = { ...base };
  symbol[Symbol('hidden')] = true;
  assert.throws(() => materializeActualSourceDryRunCommand(symbol), /deeply inert/);
});

test('command byte/depth/node budgets fail closed', () => {
  assert.throws(
    () => materializeActualSourceDryRunCommand({
      ...dryRunCommand(),
      reasonText: 'x'.repeat(1024 * 1024),
    }),
    error => error.code === 'ACTUAL_SOURCE_INPUT_MAX_BYTES',
  );
  let nested = {};
  for (let index = 0; index < 40; index += 1) nested = { child: nested };
  assert.throws(
    () => materializeActualSourceDryRunCommand({ ...dryRunCommand(), policyManifest: nested }),
    error => error.code === 'ACTUAL_SOURCE_INPUT_NOT_INERT',
  );
});

test('PR8 context requires a live human-like trusted scope carrying existing receivables.read', () => {
  const scope = {
    authenticated: true,
    principalType: 'user',
    principalId: 'user-1',
    companyId: 'company-a',
    companyTimezone: 'Europe/Moscow',
    membershipId: 'membership-1',
    membershipVersion: 1,
    roleTemplateKey: 'role-1',
    roleTemplateVersion: 1,
    capabilityCatalogVersion: 1,
    capabilities: ['receivables.read'],
    companyWideBranchAuthority: false,
    allowedBranchIds: ['branch-a-1'],
  };
  assert.equal(createActualSourceDryRunContext(scope).principalType, 'user');
  assert.throws(
    () => createActualSourceDryRunContext({ ...scope, principalType: 'system' }),
    error => error.code === 'ACTUAL_SOURCE_SCOPE_REJECTED',
  );
  assert.throws(
    () => createActualSourceDryRunContext({ ...scope, capabilities: [] }),
    error => error.code === 'ACTUAL_SOURCE_SCOPE_REJECTED',
  );
});
