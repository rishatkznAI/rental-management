import { api } from '../lib/api';
import type {
  GsmGatewayCommand,
  GsmGatewayConnection,
  GsmGatewayPacket,
  GsmGatewayStatus,
} from '../types';

type PacketQuery = {
  equipmentId?: string;
  deviceId?: string;
  limit?: number;
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
  if (params.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export const gsmGatewayService = {
  getStatus: (): Promise<GsmGatewayStatus> =>
    api.get<GsmGatewayStatus>('/api/gsm/gateway/status'),

  getConnections: (): Promise<GsmGatewayConnection[]> =>
    api.get<GsmGatewayConnection[]>('/api/gsm/gateway/connections'),

  getPackets: (params?: PacketQuery): Promise<GsmGatewayPacket[]> =>
    api.get<GsmGatewayPacket[]>(`/api/gsm/gateway/packets${buildQuery(params)}`),

  getCommands: (params?: PacketQuery): Promise<GsmGatewayCommand[]> =>
    api.get<GsmGatewayCommand[]>(`/api/gsm/gateway/commands${buildQuery(params)}`),

  sendCommand: (payload: SendGsmCommandPayload): Promise<GsmGatewayCommand> =>
    api.post<GsmGatewayCommand>('/api/gsm/gateway/send', payload),
};
