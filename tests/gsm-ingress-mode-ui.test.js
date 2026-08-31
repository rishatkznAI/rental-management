import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  GSM_INGRESS_MODE_HTTP_TOKEN,
  GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
  applyGsmIngressModeSelection,
  applyGsmProtocolSelection,
  buildGsmIngressTransportPayload,
  inferGsmIngressMode,
  resolveGsmIngressModeForForm,
  validateGsmIngressSecretForForm,
} from '../src/app/lib/gsmIngressMode.js';

const gsmPageSource = readFileSync(new URL('../src/app/pages/Gsm.tsx', import.meta.url), 'utf8');

test('UI ingress classifier recognizes only explicit documented HTTP/HTTPS and TCP aliases', () => {
  for (const protocol of ['HTTP', 'HTTPS', 'HTTP JSON', 'HTTPS JSON', 'https-webhook']) {
    assert.equal(inferGsmIngressMode(protocol), GSM_INGRESS_MODE_HTTP_TOKEN, protocol);
  }
  for (const protocol of ['GPRS TCP', 'WIALON IPS TCP', 'fallback-text']) {
    assert.equal(inferGsmIngressMode(protocol), GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL, protocol);
  }
  assert.equal(inferGsmIngressMode('http-maybe-custom'), null);
  assert.equal(inferGsmIngressMode('Manufacturer Cloud v2'), null);
});

test('backend ingressMode remains authoritative for manufacturer-specific labels', () => {
  assert.equal(resolveGsmIngressModeForForm({
    ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
    protocol: 'Manufacturer Cloud v2',
  }), GSM_INGRESS_MODE_HTTP_TOKEN);
  assert.equal(resolveGsmIngressModeForForm({ protocol: 'Teltonika TCP' }), GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL);
});

test('UI credential validation follows mode and the transport-safe grammar', () => {
  assert.doesNotThrow(() => validateGsmIngressSecretForForm({
    ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
    ingressSecret: '',
  }));
  assert.throws(() => validateGsmIngressSecretForForm({
    ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
    ingressSecret: 'not-used-secret',
  }), /не используется/);
  assert.throws(() => validateGsmIngressSecretForForm({
    ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    ingressSecret: '',
    credentialConfigured: false,
  }), /пароль/);
  assert.doesNotThrow(() => validateGsmIngressSecretForForm({
    ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    ingressSecret: '',
    credentialConfigured: true,
  }));
  assert.throws(() => validateGsmIngressSecretForForm({
    ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    ingressSecret: 'line\nbreak-secret',
  }), /допустимы/);
  assert.doesNotThrow(() => validateGsmIngressSecretForForm({
    ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    ingressSecret: 'safe-device_secret~2026',
  }));
});

test('GSM binding UI does not inject rollout-specific device metadata on save', () => {
  const mutationStart = gsmPageSource.indexOf('return gsmGatewayService.linkDevice({');
  const mutationEnd = gsmPageSource.indexOf('});', mutationStart);
  assert.ok(mutationStart >= 0 && mutationEnd > mutationStart);
  const mutationPayload = gsmPageSource.slice(mutationStart, mutationEnd);

  assert.doesNotMatch(mutationPayload, /deviceType\s*:/);
  assert.doesNotMatch(mutationPayload, /oldServer\s*:/);
  assert.doesNotMatch(mutationPayload, /targetServer\s*:/);
  assert.doesNotMatch(mutationPayload, /gw1\.glonasssoft\.ru|UMKA/);
});

test('GSM form composes a mode-compatible protocol and clears inaccessible HTTP secrets', () => {
  const switchedByProtocol = applyGsmProtocolSelection({
    gsmProtocol: 'WIALON IPS TCP',
    ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    ingressSecret: 'tcp-device-secret',
  }, 'HTTPS JSON');
  assert.equal(switchedByProtocol.ingressMode, GSM_INGRESS_MODE_HTTP_TOKEN);
  assert.equal(switchedByProtocol.ingressSecret, '');
  assert.deepEqual(buildGsmIngressTransportPayload(switchedByProtocol), {
    protocol: 'HTTPS JSON',
    ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
  });

  const switchedByMode = applyGsmIngressModeSelection({
    gsmProtocol: 'WIALON IPS TCP',
    ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    ingressSecret: 'tcp-device-secret',
  }, GSM_INGRESS_MODE_HTTP_TOKEN);
  assert.equal(switchedByMode.gsmProtocol, 'HTTPS JSON');
  assert.equal(switchedByMode.ingressSecret, '');

  assert.deepEqual(buildGsmIngressTransportPayload({
    gsmProtocol: '',
    ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
    ingressSecret: '',
  }), {
    protocol: 'HTTPS JSON',
    ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
  });
  assert.deepEqual(buildGsmIngressTransportPayload({
    gsmProtocol: '',
    ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    ingressSecret: 'tcp-device-secret',
  }), {
    protocol: 'WIALON IPS TCP',
    ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    ingressSecret: 'tcp-device-secret',
  });
});
