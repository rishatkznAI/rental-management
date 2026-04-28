import { api } from '../lib/api';
import type {
  GsmGatewayCommand,
  GsmGatewayAnalytics,
  GsmGatewayConnection,
  GsmGatewayDevice,
  GsmGatewayPacket,
  GsmGatewayRoutePoint,
  GsmGatewayStatus,
} from '../types';

type PacketQuery = {
  equipmentId?: string;
  deviceId?: string;
  imei?: string;
  parseStatus?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

type SendGsmCommandPayload = {
  equipmentId?: string;
  deviceId?: string;
  payload: string;
  encoding: 'text' | 'hex';
  appendNewline: boolean;
};

function buildQuery(params: PacketQuery = {}) {
  const searchParams = new URLSearchParams();
  if (params.equipmentId) searchParams.set('equipmentId', params.equipmentId);
  if (params.deviceId) searchParams.set('deviceId', params.deviceId);
  if (params.imei) searchParams.set('imei', params.imei);
  if (params.parseStatus) searchParams.set('parseStatus', params.parseStatus);
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export const gsmGatewayService = {
  getStatus: (): Promise<GsmGatewayStatus> =>
    api.get<GsmGatewayStatus>('/api/gsm/status'),

  getConnections: (): Promise<GsmGatewayConnection[]> =>
    api.get<GsmGatewayConnection[]>('/api/gsm/gateway/connections'),

  getPackets: (params?: PacketQuery): Promise<GsmGatewayPacket[]> =>
    api.get<GsmGatewayPacket[]>(`/api/gsm/packets${buildQuery(params)}`),

  getDevices: (): Promise<GsmGatewayDevice[]> =>
    api.get<GsmGatewayDevice[]>('/api/gsm/devices'),

  getRoute: (params: { equipmentId: string; from?: string; to?: string }): Promise<GsmGatewayRoutePoint[]> =>
    api.get<GsmGatewayRoutePoint[]>(`/api/gsm/route${buildQuery(params)}`),

  getCommands: (params?: PacketQuery): Promise<GsmGatewayCommand[]> =>
    api.get<GsmGatewayCommand[]>(`/api/gsm/gateway/commands${buildQuery(params)}`),

  getAnalytics: (params?: PacketQuery): Promise<GsmGatewayAnalytics> =>
    api.get<GsmGatewayAnalytics>(`/api/gsm/gateway/analytics${buildQuery(params)}`),

  sendCommand: (payload: SendGsmCommandPayload): Promise<GsmGatewayCommand> =>
    api.post<GsmGatewayCommand>('/api/gsm/gateway/send', payload),

  createCommand: (payload: { equipmentId: string; command: string; payload?: Record<string, unknown> }): Promise<GsmGatewayCommand> =>
    api.post<GsmGatewayCommand>('/api/gsm/commands', payload),
};
