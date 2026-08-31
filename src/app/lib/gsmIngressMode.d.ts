export type GsmIngressMode = 'http_token' | 'tcp_device_credential';

export const GSM_INGRESS_MODE_HTTP_TOKEN: 'http_token';
export const GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL: 'tcp_device_credential';

export function inferGsmIngressMode(protocol?: unknown): GsmIngressMode | null;
export function normalizeGsmIngressMode(value?: unknown): GsmIngressMode | null;
export function resolveGsmIngressModeForForm(input?: {
  ingressMode?: unknown;
  protocol?: unknown;
}): GsmIngressMode;
export function resolveGsmProtocolForMode(input?: {
  protocol?: unknown;
  ingressMode?: unknown;
}): string;
export function applyGsmProtocolSelection<T extends Record<string, unknown>>(
  form: T,
  protocol?: unknown,
): T & { gsmProtocol: string; ingressMode: GsmIngressMode; ingressSecret: string };
export function applyGsmIngressModeSelection<T extends Record<string, unknown>>(
  form: T,
  ingressMode?: unknown,
): T & { gsmProtocol: string; ingressMode: GsmIngressMode; ingressSecret: string };
export function buildGsmIngressTransportPayload(form?: {
  gsmProtocol?: unknown;
  protocol?: unknown;
  ingressMode?: unknown;
  ingressSecret?: unknown;
}): {
  protocol: string;
  ingressMode: GsmIngressMode;
  ingressSecret?: string;
};
export function validateGsmIngressSecretForForm(input: {
  ingressMode?: unknown;
  ingressSecret?: unknown;
  credentialConfigured?: boolean;
}): void;
