import type {
  GsmGatewayDevice,
  GsmGatewayPacket,
  GsmGatewayStatus,
} from '../types';

export type GsmGatewayOperationalState = {
  label: string;
  badge: 'success' | 'warning' | 'danger' | 'default';
  hint: string;
};

export function deriveGsmGatewayOperationalState(
  status?: Partial<GsmGatewayStatus>,
  recentPackets?: Partial<GsmGatewayPacket>[],
  devices?: Partial<GsmGatewayDevice>[],
  options?: { nowMs?: number; onlineWindowMs?: number },
): GsmGatewayOperationalState;
