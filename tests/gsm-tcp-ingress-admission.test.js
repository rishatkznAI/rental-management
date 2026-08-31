import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTcpIngressAdmissionController } = require('../server/lib/gsm/tcp-ingress-admission.js');

test('TCP admission enforces global and per-IP connection limits with idempotent release', () => {
  const controller = createTcpIngressAdmissionController({
    maxConnections: 2,
    maxConnectionsPerIp: 1,
  });
  const first = controller.admitConnection('10.0.0.1');
  assert.equal(first.ok, true);
  assert.equal(controller.admitConnection('10.0.0.1').code, 'GSM_TCP_IP_CONNECTION_LIMIT');
  const second = controller.admitConnection('10.0.0.2');
  assert.equal(second.ok, true);
  assert.equal(controller.admitConnection('10.0.0.3').code, 'GSM_TCP_GLOBAL_CONNECTION_LIMIT');
  first.release();
  first.release();
  const replacement = controller.admitConnection('10.0.0.3');
  assert.equal(replacement.ok, true);
  assert.equal(controller.getStatus().activeConnections, 2);
  second.release();
  replacement.release();
  assert.equal(controller.getStatus().activeConnections, 0);
});

test('TCP admission bounds expensive authentication attempts globally and per IP', () => {
  let nowMs = 1_000_000;
  const controller = createTcpIngressAdmissionController({
    maxAuthAttemptsPerMinute: 2,
    maxAuthAttemptsPerIpPerMinute: 1,
    now: () => nowMs,
  });
  assert.equal(controller.consumeAuthAttempt('10.0.0.1').ok, true);
  assert.equal(controller.consumeAuthAttempt('10.0.0.1').code, 'GSM_TCP_IP_AUTH_RATE_LIMIT');
  assert.equal(controller.consumeAuthAttempt('10.0.0.2').ok, true);
  assert.equal(controller.consumeAuthAttempt('10.0.0.3').code, 'GSM_TCP_GLOBAL_AUTH_RATE_LIMIT');
  nowMs += 60_000;
  assert.equal(controller.consumeAuthAttempt('10.0.0.1').ok, true);
  assert.equal(controller.getStatus().rejectedAuthAttempts, 2);
});

test('TCP admission prunes expired source windows and cannot grow on globally rejected IPs', () => {
  let nowMs = 1_000_000;
  const controller = createTcpIngressAdmissionController({
    maxAuthAttemptsPerMinute: 2,
    maxAuthAttemptsPerIpPerMinute: 2,
    now: () => nowMs,
  });
  assert.equal(controller.consumeAuthAttempt('10.0.0.1').ok, true);
  assert.equal(controller.consumeAuthAttempt('10.0.0.2').ok, true);
  for (let index = 3; index < 100; index += 1) {
    assert.equal(controller.consumeAuthAttempt(`10.0.0.${index}`).ok, false);
  }
  assert.equal(controller.getStatus().trackedAuthSourceIps, 2);

  nowMs += 60_000;
  assert.equal(controller.consumeAuthAttempt('10.1.0.1').ok, true);
  assert.equal(controller.getStatus().trackedAuthSourceIps, 1);
});

test('TCP admission applies one process-wide telemetry packet and byte budget', () => {
  let nowMs = 1_000_000;
  const controller = createTcpIngressAdmissionController({
    maxPacketsPerMinute: 3,
    maxPacketsPerIpPerMinute: 2,
    maxBytesPerMinute: 12,
    maxBytesPerIpPerMinute: 8,
    now: () => nowMs,
  });
  assert.equal(controller.consumeTelemetry('10.0.0.1', { byteLength: 4 }).ok, true);
  assert.equal(controller.consumeTelemetry('10.0.0.1', { byteLength: 4 }).ok, true);
  assert.equal(
    controller.consumeTelemetry('10.0.0.1', { byteLength: 1 }).code,
    'GSM_TCP_IP_PACKET_RATE_LIMIT',
  );
  assert.equal(controller.consumeTelemetry('10.0.0.2', { byteLength: 4 }).ok, true);
  assert.equal(
    controller.consumeTelemetry('10.0.0.3', { byteLength: 1 }).code,
    'GSM_TCP_GLOBAL_PACKET_RATE_LIMIT',
  );
  assert.equal(controller.getStatus().trackedTelemetrySourceIps, 2);

  nowMs += 60_000;
  assert.equal(controller.consumeTelemetry('10.0.0.3', { byteLength: 8 }).ok, true);
  assert.equal(controller.getStatus().trackedTelemetrySourceIps, 1);
});

test('TCP admission rejects an oversized observation instead of clamping it into the byte budget', () => {
  const controller = createTcpIngressAdmissionController({
    maxPacketsPerMinute: 2,
    maxPacketsPerIpPerMinute: 2,
    maxBytesPerMinute: 2,
    maxBytesPerIpPerMinute: 2,
  });

  assert.equal(
    controller.consumeTelemetry('10.0.0.1', { byteLength: 100 }).code,
    'GSM_TCP_GLOBAL_BYTE_RATE_LIMIT',
  );
  assert.equal(controller.consumeTelemetry('10.0.0.1', { byteLength: 2 }).ok, true);
  assert.equal(
    controller.consumeTelemetry('10.0.0.1', { packetCount: Number.NaN, byteLength: 0 }).code,
    'GSM_TCP_TRAFFIC_OBSERVATION_INVALID',
  );
});

test('TCP admission clamps invalid resource-limit configuration to finite safe values', () => {
  const controller = createTcpIngressAdmissionController({
    maxConnections: Number.NaN,
    maxConnectionsPerIp: Number.POSITIVE_INFINITY,
    maxAuthAttemptsPerMinute: -1,
    maxAuthAttemptsPerIpPerMinute: 0,
    maxPacketsPerMinute: Number.NaN,
    maxPacketsPerIpPerMinute: Number.NEGATIVE_INFINITY,
    maxBytesPerMinute: -1,
    maxBytesPerIpPerMinute: 0,
    preAuthTimeoutMs: Number.NaN,
  });
  for (const value of Object.values(controller.limits)) {
    assert.equal(Number.isSafeInteger(value), true);
    assert.equal(value > 0, true);
  }
});
