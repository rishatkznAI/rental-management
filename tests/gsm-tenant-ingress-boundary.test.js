import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import { createPlatformIdentityContext } from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const { createGprsGateway } = require('../server/lib/gprs-gateway.js');
const { createTrustedGsmDeviceScopeResolver } = require('../server/lib/gsm/trusted-device-scope.js');
const {
  EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS,
  applyEquipmentGsmConfigurationProjection,
  advanceGsmDeviceBindingLifecycle,
  canonicalEquipmentGsmConfigurationProjection,
  ensureGsmDeviceBindingLifecycle,
} = require('../server/lib/gsm/trusted-device-scope.js');
const {
  createTenantDataBoundary,
  currentTenantContext,
  runWithTenantActorScope,
} = require('../server/lib/tenant-data-boundary.js');
const { assertTenantRelationships } = require('../server/lib/tenant-relationship-guard.js');

const SCOPE_A = Object.freeze({ companyId: 'COMPANY-A', tenantId: 'COMPANY-A' });
const SCOPE_B = Object.freeze({ companyId: 'COMPANY-B', tenantId: 'COMPANY-B' });

function scoped(scope, value) {
  return { ...value, companyId: scope.companyId, tenantId: scope.tenantId };
}

function canonicalDevice(scope, {
  id,
  equipmentId,
  deviceId,
  imei = '',
  protocol = 'GPRS',
  status = 'unknown',
} = {}) {
  return scoped(scope, {
    id,
    equipmentId,
    deviceId,
    imei: imei || null,
    trackerId: null,
    protocol,
    sim1: null,
    status,
    bindingRevision: 1,
    bindingHistory: [{
      revision: 1,
      equipmentId,
      companyId: scope.companyId,
      tenantId: scope.tenantId,
      imei: imei || null,
      deviceId: deviceId || null,
      linkedAt: '2026-08-30T09:00:00.000Z',
      unlinkedAt: null,
      reason: 'test_provisioned',
    }],
  });
}

function clearEquipmentGsmConfiguration(record) {
  const next = { ...record };
  for (const field of EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS) next[field] = null;
  return next;
}

function createIngressContext() {
  const identity = createPlatformIdentityContext();
  const equipmentA = scoped(SCOPE_A, { id: 'EQ-A' });
  const equipmentA2 = scoped(SCOPE_A, { id: 'EQ-A-2' });
  const equipmentB = scoped(SCOPE_B, { id: 'EQ-B' });
  const deviceA = canonicalDevice(SCOPE_A, {
    id: 'GDEV-A', equipmentId: 'EQ-A', deviceId: 'DEVICE-A',
  });
  const deviceB = canonicalDevice(SCOPE_B, {
    id: 'GDEV-B', equipmentId: 'EQ-B', deviceId: 'DEVICE-B',
  });
  const state = {
    users: identity.readUsers(),
    equipment: [
      applyEquipmentGsmConfigurationProjection(equipmentA, deviceA),
      equipmentA2,
      applyEquipmentGsmConfigurationProjection(equipmentB, deviceB),
    ],
    gsm_devices: [deviceA, deviceB],
    gsm_packets: [],
    gsm_commands: [],
  };
  const batches = [];
  const readRawData = name => state[name] ?? null;
  const writeRawData = (name, value) => {
    state[name] = structuredClone(value);
  };
  const writeRawDataBatch = (entries) => {
    const next = structuredClone(state);
    for (const entry of entries) next[entry.name] = structuredClone(entry.value);
    for (const [name, value] of Object.entries(next)) state[name] = value;
    batches.push(entries.map(entry => entry.name));
  };
  const boundary = createTenantDataBoundary({
    db: identity.db,
    readRawData,
    writeRawData,
    writeRawDataBatch,
    assertRelationships: assertTenantRelationships,
  });
  const resolveTrustedDeviceScope = createTrustedGsmDeviceScopeResolver({ readData: readRawData });
  const gateway = createGprsGateway({
    readData: boundary.readData,
    writeData: boundary.writeData,
    writeDataBatch: boundary.writeDataBatch,
    resolveTrustedDeviceScope,
    withActorScope: runWithTenantActorScope,
    getCurrentScope: () => {
      const context = currentTenantContext();
      return context?.kind === 'tenant_actor' ? context.actorScope : null;
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: false,
  });
  return { ...identity, state, batches, boundary, gateway };
}

test('trusted GSM ingress enters the resolved tenant boundary and commits telemetry atomically', t => {
  const context = createIngressContext();
  t.after(() => context.close());

  context.gateway.processRawPacket(Buffer.from('deviceId:DEVICE-A LAT:55.1 LNG:49.1'));
  context.gateway.processRawPacket(Buffer.from('deviceId:DEVICE-B LAT:56.1 LNG:50.1'));

  assert.equal(context.state.gsm_packets.length, 2);
  assert.deepEqual(
    context.state.gsm_packets.map(item => [item.equipmentId, item.companyId, item.tenantId]).sort(),
    [
      ['EQ-A', 'COMPANY-A', 'COMPANY-A'],
      ['EQ-B', 'COMPANY-B', 'COMPANY-B'],
    ],
  );
  assert.deepEqual(context.batches, [
    ['gsm_packets', 'equipment', 'gsm_devices', 'audit_logs'],
    ['gsm_packets', 'equipment', 'gsm_devices', 'audit_logs'],
  ]);
  assert.deepEqual(
    context.state.audit_logs.map(item => [item.companyId, item.tenantId]),
    [['COMPANY-A', 'COMPANY-A'], ['COMPANY-B', 'COMPANY-B']],
  );

  runWithTenantActorScope(SCOPE_A, () => {
    assert.deepEqual(context.gateway.listPackets({ limit: 10 }).map(item => item.equipmentId), ['EQ-A']);
    assert.deepEqual(context.gateway.listDevices().map(item => item.equipmentId), ['EQ-A']);
    assert.equal(context.gateway.getStatus().packetsReceivedTotal, 1);
  });
  runWithTenantActorScope(SCOPE_B, () => {
    assert.deepEqual(context.gateway.listPackets({ limit: 10 }).map(item => item.equipmentId), ['EQ-B']);
    assert.deepEqual(context.gateway.listDevices().map(item => item.equipmentId), ['EQ-B']);
    assert.equal(context.gateway.getStatus().packetsReceivedTotal, 1);
  });
});

test('trusted GSM ingress materializes one legacy binding and writes an exact canonical projection', t => {
  const context = createIngressContext();
  t.after(() => context.close());
  const legacyDevice = { ...context.state.gsm_devices.find(item => item.id === 'GDEV-A') };
  delete legacyDevice.bindingRevision;
  delete legacyDevice.bindingHistory;
  context.state.gsm_devices = context.state.gsm_devices.map(item => (
    item.id === legacyDevice.id ? legacyDevice : item
  ));
  context.state.equipment = context.state.equipment.map(item => (
    item.id === 'EQ-A' ? clearEquipmentGsmConfiguration(item) : item
  ));

  context.gateway.processRawPacket(Buffer.from('deviceId:DEVICE-A LAT:55.1 LNG:49.1'));

  const materializedDevice = context.state.gsm_devices.find(item => item.id === 'GDEV-A');
  const projectedEquipment = context.state.equipment.find(item => item.id === 'EQ-A');
  assert.equal(materializedDevice.bindingRevision, 1);
  assert.equal(materializedDevice.bindingHistory.length, 1);
  assert.deepEqual(
    canonicalEquipmentGsmConfigurationProjection(materializedDevice),
    Object.fromEntries(EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS.map(field => [field, projectedEquipment[field] ?? null])),
  );
});

test('trusted GSM ingress rejects unknown and mismatched devices before the tenant boundary writes', t => {
  const context = createIngressContext();
  t.after(() => context.close());
  context.state.gsm_devices.push(canonicalDevice(SCOPE_B, {
    id: 'GDEV-MISMATCH',
    equipmentId: 'EQ-A-2',
    deviceId: 'DEVICE-MISMATCH',
  }));
  const before = structuredClone(context.state);

  assert.throws(
    () => context.gateway.processRawPacket(Buffer.from('deviceId:UNKNOWN LAT:55.1 LNG:49.1')),
    error => error.code === 'GSM_DEVICE_NOT_PROVISIONED',
  );
  assert.throws(
    () => context.gateway.processRawPacket(Buffer.from('deviceId:DEVICE-MISMATCH LAT:55.1 LNG:49.1')),
    error => error.code === 'GSM_DEVICE_SCOPE_MISMATCH',
  );
  assert.deepEqual(context.state, before);
  assert.deepEqual(context.batches, []);
});

test('GSM commands are anchored to the active provisioned device and isolated by tenant', t => {
  const context = createIngressContext();
  t.after(() => context.close());

  runWithTenantActorScope(SCOPE_A, () => {
    const command = context.gateway.createCommand({
      equipmentId: 'EQ-A',
      deviceId: 'DEVICE-A',
      command: 'PING-A',
    });
    assert.equal(command.gsmDeviceRecordId, 'GDEV-A');
    assert.throws(
      () => context.gateway.createCommand({ equipmentId: 'EQ-B', command: 'PING-B' }),
      /Техника не найдена/,
    );
    assert.deepEqual(context.gateway.listCommands({ limit: 10 }).map(item => item.id), [command.id]);
  });

  runWithTenantActorScope(SCOPE_B, () => {
    assert.deepEqual(context.gateway.listCommands({ limit: 10 }), []);
    const command = context.gateway.createCommand({
      equipmentId: 'EQ-B',
      deviceId: 'DEVICE-B',
      command: 'PING-B',
    });
    assert.equal(command.gsmDeviceRecordId, 'GDEV-B');
  });

  assert.deepEqual(
    context.state.gsm_commands.map(item => [item.equipmentId, item.gsmDeviceRecordId, item.companyId]).sort(),
    [
      ['EQ-A', 'GDEV-A', 'COMPANY-A'],
      ['EQ-B', 'GDEV-B', 'COMPANY-B'],
    ],
  );
});

test('central tenant boundary rejects same-tenant GSM device/equipment mismatches', t => {
  const context = createIngressContext();
  t.after(() => context.close());

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('gsm_packets', [{
      id: 'GPKT-MISMATCH',
      gsmDeviceRecordId: 'GDEV-A',
      gsmBindingRevision: 1,
      equipmentId: 'EQ-A-2',
      companyId: SCOPE_A.companyId,
      tenantId: SCOPE_A.tenantId,
    }])),
    error => error?.code === 'GSM_DEVICE_EQUIPMENT_MISMATCH',
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('gsm_commands', [{
      id: 'GCMD-MISMATCH',
      gsmDeviceRecordId: 'GDEV-A',
      gsmBindingRevision: 1,
      equipmentId: 'EQ-A-2',
      companyId: SCOPE_A.companyId,
      tenantId: SCOPE_A.tenantId,
    }])),
    error => error?.code === 'GSM_DEVICE_EQUIPMENT_MISMATCH',
  );
  assert.equal(context.state.gsm_packets.length, 0);
  assert.equal(context.state.gsm_commands.length, 0);
});

test('central tenant boundary requires stable device record and binding revision on new telemetry', t => {
  const context = createIngressContext();
  t.after(() => context.close());

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('gsm_packets', [{
      id: 'GPKT-PARENTLESS',
      equipmentId: 'EQ-A',
      companyId: SCOPE_A.companyId,
      tenantId: SCOPE_A.tenantId,
    }])),
    error => error?.code === 'GSM_DEVICE_RECORD_REQUIRED',
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('gsm_packets', [{
      id: 'GPKT-NO-REVISION',
      gsmDeviceRecordId: 'GDEV-A',
      equipmentId: 'EQ-A',
      companyId: SCOPE_A.companyId,
      tenantId: SCOPE_A.tenantId,
    }])),
    error => error?.code === 'GSM_BINDING_REVISION_REQUIRED',
  );
  assert.equal(context.state.gsm_packets.length, 0);
});

test('central tenant boundary rejects stale projections and prevents invalid parents from authorizing new rows', t => {
  const context = createIngressContext();
  t.after(() => context.close());

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('equipment',
      context.boundary.readData('equipment').map(item => (
        item.id === 'EQ-A' ? { ...item, gsmProtocol: 'STALE-PROTOCOL' } : item
      )),
    )),
    error => error?.code === 'GSM_EQUIPMENT_PROJECTION_MISMATCH',
  );

  context.state.equipment = context.state.equipment.map(item => (
    item.id === 'EQ-A' ? { ...item, gsmImei: 'STALE-IMEI' } : item
  ));
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('equipment',
    context.boundary.readData('equipment').map(item => (
      item.id === 'EQ-A' ? { ...item, name: 'Safe unrelated equipment edit' } : item
    )),
  ));
  assert.equal(
    context.state.equipment.find(item => item.id === 'EQ-A').name,
    'Safe unrelated equipment edit',
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('equipment',
      context.boundary.readData('equipment').map(item => (
        item.id === 'EQ-A' ? { ...item, gsmImei: 'ANOTHER-STALE-IMEI' } : item
      )),
    )),
    error => error?.code === 'GSM_EQUIPMENT_PROJECTION_MISMATCH',
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('gsm_packets', [{
      id: 'GPKT-NEW-UNDER-INVALID-PARENT',
      gsmDeviceRecordId: 'GDEV-A',
      gsmBindingRevision: 1,
      equipmentId: 'EQ-A',
      companyId: SCOPE_A.companyId,
      tenantId: SCOPE_A.tenantId,
    }])),
    error => error?.code === 'GSM_DEVICE_PARENT_INVALID',
  );
  assert.equal(context.state.gsm_packets.length, 0);
});

test('central tenant boundary rejects active-device cardinality and global identity collisions', t => {
  const context = createIngressContext();
  t.after(() => context.close());

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('gsm_devices', [
      ...context.boundary.readData('gsm_devices'),
      canonicalDevice(SCOPE_A, {
        id: 'GDEV-A-SECOND',
        equipmentId: 'EQ-A',
        deviceId: 'DEVICE-A-SECOND',
      }),
    ])),
    error => error?.code === 'GSM_EQUIPMENT_DEVICE_AMBIGUOUS',
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('gsm_devices', [
      ...context.boundary.readData('gsm_devices'),
      canonicalDevice(SCOPE_A, {
        id: 'GDEV-A-COLLISION',
        equipmentId: 'EQ-A-2',
        deviceId: 'DEVICE-B',
      }),
    ])),
    error => error?.code === 'GSM_DEVICE_IDENTITY_CONFLICT',
  );
});

test('central tenant boundary reserves rotated identities across tenants', t => {
  const context = createIngressContext();
  t.after(() => context.close());

  runWithTenantActorScope(SCOPE_A, () => {
    const devices = context.boundary.readData('gsm_devices');
    const current = devices.find(item => item.id === 'GDEV-A');
    const rotated = advanceGsmDeviceBindingLifecycle({
      ...current,
      deviceId: 'DEVICE-A-NEW',
    }, { at: '2026-08-30T10:00:00.000Z', reason: 'test_identity_rotation' });
    const equipment = context.boundary.readData('equipment').map(item => (
      item.id === 'EQ-A' ? applyEquipmentGsmConfigurationProjection(item, rotated) : item
    ));
    context.boundary.writeDataBatch([
      { name: 'gsm_devices', value: devices.map(item => item.id === rotated.id ? rotated : item) },
      { name: 'equipment', value: equipment },
    ]);
  });

  runWithTenantActorScope(SCOPE_B, () => {
    context.boundary.writeData('equipment', [
      ...context.boundary.readData('equipment'),
      scoped(SCOPE_B, { id: 'EQ-B-2' }),
    ]);
    const conflicting = canonicalDevice(SCOPE_B, {
      id: 'GDEV-B-OLD-IDENTITY',
      equipmentId: 'EQ-B-2',
      deviceId: 'DEVICE-A',
    });
    const nextEquipment = context.boundary.readData('equipment').map(item => (
      item.id === 'EQ-B-2' ? applyEquipmentGsmConfigurationProjection(item, conflicting) : item
    ));
    const before = structuredClone(context.state);
    assert.throws(
      () => context.boundary.writeDataBatch([
        { name: 'gsm_devices', value: [...context.boundary.readData('gsm_devices'), conflicting] },
        { name: 'equipment', value: nextEquipment },
      ]),
      error => error?.code === 'GSM_DEVICE_IDENTITY_CONFLICT',
    );
    assert.deepEqual(context.state, before);
  });
});

test('binding history preserves old packet ownership after an audited rebind', t => {
  const context = createIngressContext();
  t.after(() => context.close());
  context.gateway.processRawPacket(Buffer.from('deviceId:DEVICE-A LAT:55.1 LNG:49.1'));

  runWithTenantActorScope(SCOPE_A, () => {
    const devices = context.boundary.readData('gsm_devices');
    const current = ensureGsmDeviceBindingLifecycle(devices.find(item => item.id === 'GDEV-A'), {
      at: '2026-08-30T10:00:00.000Z',
    });
    const rebound = advanceGsmDeviceBindingLifecycle({
      ...current,
      equipmentId: 'EQ-A-2',
    }, {
      at: '2026-08-30T10:01:00.000Z',
      reason: 'test_rebind',
    });
    const equipment = context.boundary.readData('equipment').map(item => {
      if (item.id === 'EQ-A') return clearEquipmentGsmConfiguration(item);
      if (item.id === 'EQ-A-2') return applyEquipmentGsmConfigurationProjection(item, rebound);
      return item;
    });
    context.boundary.writeDataBatch([
      { name: 'gsm_devices', value: devices.map(item => item.id === rebound.id ? rebound : item) },
      { name: 'equipment', value: equipment },
    ]);
  });

  assert.equal(context.state.gsm_packets[0].equipmentId, 'EQ-A');
  assert.equal(context.state.gsm_packets[0].gsmBindingRevision, 1);
  assert.equal(context.state.gsm_devices.find(item => item.id === 'GDEV-A').bindingRevision, 2);
});

test('existing commands remain immutable revision history across rebind while new historical commands fail', t => {
  const context = createIngressContext();
  t.after(() => context.close());
  let historicalCommandId = '';

  runWithTenantActorScope(SCOPE_A, () => {
    historicalCommandId = context.gateway.createCommand({
      equipmentId: 'EQ-A',
      deviceId: 'DEVICE-A',
      command: 'PING-BEFORE-REBIND',
    }).id;
    const devices = context.boundary.readData('gsm_devices');
    const current = devices.find(item => item.id === 'GDEV-A');
    const rebound = advanceGsmDeviceBindingLifecycle({
      ...current,
      equipmentId: 'EQ-A-2',
    }, { at: '2026-08-30T10:01:00.000Z', reason: 'test_rebind_with_command_history' });
    const equipment = context.boundary.readData('equipment').map(item => {
      if (item.id === 'EQ-A') return clearEquipmentGsmConfiguration(item);
      if (item.id === 'EQ-A-2') return applyEquipmentGsmConfigurationProjection(item, rebound);
      return item;
    });
    context.boundary.writeDataBatch([
      { name: 'gsm_devices', value: devices.map(item => item.id === rebound.id ? rebound : item) },
      { name: 'equipment', value: equipment },
    ]);

    context.boundary.writeData('gsm_commands', context.boundary.readData('gsm_commands').map(item => (
      item.id === historicalCommandId ? { ...item, status: 'acknowledged' } : item
    )));

    assert.throws(
      () => context.boundary.writeData('gsm_commands', context.boundary.readData('gsm_commands').map(item => (
        item.id === historicalCommandId
          ? { ...item, equipmentId: 'EQ-A-2', gsmBindingRevision: 2 }
          : item
      ))),
      error => error?.code === 'GSM_COMMAND_BINDING_IMMUTABLE',
    );

    assert.throws(
      () => context.boundary.writeData('gsm_commands', [
        ...context.boundary.readData('gsm_commands'),
        {
          id: 'GCMD-INVALID-HISTORICAL-CREATE',
          gsmDeviceRecordId: 'GDEV-A',
          gsmBindingRevision: 1,
          equipmentId: 'EQ-A',
          companyId: SCOPE_A.companyId,
          tenantId: SCOPE_A.tenantId,
          command: 'PING-OLD-BINDING',
        },
      ]),
      error => error?.code === 'GSM_COMMAND_BINDING_NOT_CURRENT',
    );
  });

  const historical = context.state.gsm_commands.find(item => item.id === historicalCommandId);
  assert.equal(historical.status, 'acknowledged');
  assert.equal(historical.equipmentId, 'EQ-A');
  assert.equal(historical.gsmBindingRevision, 1);
  assert.equal(context.state.gsm_commands.some(item => item.id === 'GCMD-INVALID-HISTORICAL-CREATE'), false);
});

test('legacy parentless GSM rows remain quarantined and cannot authorize visibility', t => {
  const context = createIngressContext();
  t.after(() => context.close());
  context.state.gsm_packets.push(scoped(SCOPE_A, {
    id: 'GPKT-LEGACY-UNLINKED',
    imei: 'DEVICE-A',
    equipmentId: null,
  }));

  runWithTenantActorScope(SCOPE_A, () => {
    assert.equal(context.boundary.readData('gsm_packets').some(item => item.id === 'GPKT-LEGACY-UNLINKED'), false);
    const equipment = context.boundary.readData('equipment');
    context.boundary.writeData('equipment', equipment.map(item => (
      item.id === 'EQ-A-2' ? { ...item, notes: 'unrelated safe mutation' } : item
    )));
  });
  assert.equal(context.state.gsm_packets.some(item => item.id === 'GPKT-LEGACY-UNLINKED'), true);
});
