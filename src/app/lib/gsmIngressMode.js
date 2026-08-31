export const GSM_INGRESS_MODE_HTTP_TOKEN = 'http_token';
export const GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL = 'tcp_device_credential';

const HTTP_PROTOCOLS = new Set([
  'http',
  'https',
  'http ingest',
  'https ingest',
  'http json',
  'https json',
  'http webhook',
  'https webhook',
]);
const TCP_PROTOCOLS = new Set([
  'tcp',
  'gprs',
  'gprs tcp',
  'generic text',
  'raw text',
  'fallback text',
  'wialon',
  'wialon ips',
  'wialon ips tcp',
]);
const TRANSPORT_SAFE_SECRET_PATTERN = /^[A-Za-z0-9._~-]+$/;

function normalizedProtocol(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function inferGsmIngressMode(protocol) {
  const value = normalizedProtocol(protocol);
  if (HTTP_PROTOCOLS.has(value)) return GSM_INGRESS_MODE_HTTP_TOKEN;
  if (TCP_PROTOCOLS.has(value)) return GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL;
  return null;
}

export function normalizeGsmIngressMode(value) {
  if (value === GSM_INGRESS_MODE_HTTP_TOKEN || value === 'http') return GSM_INGRESS_MODE_HTTP_TOKEN;
  if (value === GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL || value === 'tcp') {
    return GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL;
  }
  return null;
}

export function resolveGsmIngressModeForForm({ ingressMode, protocol } = {}) {
  return normalizeGsmIngressMode(ingressMode)
    || inferGsmIngressMode(protocol)
    || GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL;
}

export function resolveGsmProtocolForMode({ protocol, ingressMode } = {}) {
  const mode = resolveGsmIngressModeForForm({ ingressMode, protocol });
  const value = String(protocol || '').trim();
  const inferredMode = inferGsmIngressMode(value);
  if (!value || (inferredMode && inferredMode !== mode)) {
    return mode === GSM_INGRESS_MODE_HTTP_TOKEN ? 'HTTPS JSON' : 'WIALON IPS TCP';
  }
  return value;
}

export function applyGsmProtocolSelection(form = {}, protocol = '') {
  const inferredMode = inferGsmIngressMode(protocol);
  const ingressMode = inferredMode || resolveGsmIngressModeForForm(form);
  return {
    ...form,
    gsmProtocol: String(protocol),
    ingressMode,
    ingressSecret: ingressMode === GSM_INGRESS_MODE_HTTP_TOKEN
      ? ''
      : String(form.ingressSecret || ''),
  };
}

export function applyGsmIngressModeSelection(form = {}, ingressMode) {
  const mode = normalizeGsmIngressMode(ingressMode)
    || resolveGsmIngressModeForForm(form);
  return {
    ...form,
    gsmProtocol: resolveGsmProtocolForMode({ protocol: form.gsmProtocol, ingressMode: mode }),
    ingressMode: mode,
    ingressSecret: mode === GSM_INGRESS_MODE_HTTP_TOKEN
      ? ''
      : String(form.ingressSecret || ''),
  };
}

export function buildGsmIngressTransportPayload(form = {}) {
  const ingressMode = resolveGsmIngressModeForForm(form);
  const protocol = resolveGsmProtocolForMode({
    protocol: form.gsmProtocol,
    ingressMode,
  });
  const ingressSecret = String(form.ingressSecret || '');
  return {
    protocol,
    ingressMode,
    ...(ingressMode === GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL && ingressSecret
      ? { ingressSecret }
      : {}),
  };
}

export function validateGsmIngressSecretForForm({ ingressMode, ingressSecret, credentialConfigured = false }) {
  const mode = normalizeGsmIngressMode(ingressMode);
  const secret = String(ingressSecret ?? '');
  if (mode === GSM_INGRESS_MODE_HTTP_TOKEN) {
    if (secret) throw new Error('Для HTTP/HTTPS token ingress индивидуальный пароль устройства не используется.');
    return;
  }
  if (mode !== GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL) {
    throw new Error('Выберите канонический режим приёма GSM-пакетов.');
  }
  if (!secret && !credentialConfigured) {
    throw new Error('Для новой публичной TCP-привязки задайте индивидуальный пароль устройства.');
  }
  if (secret && (
    secret.length < 8
    || secret.length > 256
    || !TRANSPORT_SAFE_SECRET_PATTERN.test(secret)
  )) {
    throw new Error('Пароль TCP-устройства: 8–256 символов; допустимы латиница, цифры, точка, _, ~ и дефис.');
  }
}
