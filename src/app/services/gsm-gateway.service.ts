import { api, buildPaginatedQuery, type PaginatedQueryParams, type PaginatedResponse } from '../lib/api';
import type {
  Equipment,
  GsmGatewayCommand,
  GsmGatewayAnalytics,
  GsmGatewayConnection,
  GsmGatewayDevice,
  GsmGatewayPacket,
  GsmGatewayRoutePoint,
  GsmGatewayStatus,
} from '../types';
import type { GsmEquipmentSnapshot } from '../lib/gsm';

type PacketQuery = {
  equipmentId?: string;
  deviceId?: string;
  imei?: string;
  parseStatus?: string;
  from?: string;
  to?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  recentLimit?: number;
  offset?: number;
};

type SendGsmCommandPayload = {
  equipmentId?: string;
  deviceId?: string;
  payload: string;
  encoding: 'text' | 'hex';
  appendNewline: boolean;
};

type LinkGsmDevicePayload = {
  equipmentId?: string;
  model?: string;
  inventoryNumber?: string;
  imei: string;
  deviceType?: string;
  protocol?: string;
  sim1?: string;
  oldServer?: string;
  targetServer?: string;
};

export type GsmDashboardResponse = {
  status: GsmGatewayStatus;
  analytics: GsmGatewayAnalytics;
  counters: {
    total: number;
    mapped: number;
    realGps: number;
    locationDerived: number;
    rented: number;
    alerts: number;
  };
  devices: GsmGatewayDevice[];
  snapshots: GsmEquipmentSnapshot[];
  recentPackets: GsmGatewayPacket[];
  generatedAt: string;
  limits: {
    equipment: number;
    recentPackets: number;
  };
};

export type GsmBindingSearchResponse = {
  items: Equipment[];
  limit: number;
};

function buildQuery(params: PacketQuery = {}) {
  const searchParams = new URLSearchParams();
  if (params.equipmentId) searchParams.set('equipmentId', params.equipmentId);
  if (params.deviceId) searchParams.set('deviceId', params.deviceId);
  if (params.imei) searchParams.set('imei', params.imei);
  if (params.parseStatus) searchParams.set('parseStatus', params.parseStatus);
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
  if (params.dateTo) searchParams.set('dateTo', params.dateTo);
  if (params.search) searchParams.set('search', params.search);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.recentLimit) searchParams.set('recentLimit', String(params.recentLimit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export const gsmGatewayService = {
  getStatus: (): Promise<GsmGatewayStatus> =>
    api.get<GsmGatewayStatus>('/api/gsm/status'),

  getDashboard: (params: { limit?: number; recentLimit?: number } = {}): Promise<GsmDashboardResponse> =>
    api.get<GsmDashboardResponse>(`/api/gsm/dashboard${buildQuery(params)}`),

  getConnections: (): Promise<GsmGatewayConnection[]> =>
    api.get<GsmGatewayConnection[]>('/api/gsm/gateway/connections'),

  getPackets: (params?: PacketQuery): Promise<GsmGatewayPacket[]> =>
    api.get<GsmGatewayPacket[]>(`/api/gsm/packets${buildQuery(params)}`),

  getPacketsPaginated: (params?: PaginatedQueryParams & PacketQuery): Promise<PaginatedResponse<GsmGatewayPacket>> =>
    api.get<PaginatedResponse<GsmGatewayPacket>>(`/api/gsm/packets${buildPaginatedQuery({
      ...params,
      filters: {
        equipmentId: params?.equipmentId,
        deviceId: params?.deviceId,
        imei: params?.imei,
        parseStatus: params?.parseStatus,
      },
      dateFrom: params?.dateFrom || params?.from,
      dateTo: params?.dateTo || params?.to,
    })}`),

  getDevices: (): Promise<GsmGatewayDevice[]> =>
    api.get<GsmGatewayDevice[]>('/api/gsm/devices'),

  getDevice: (imei: string): Promise<GsmGatewayDevice> =>
    api.get<GsmGatewayDevice>(`/api/gsm/devices/${encodeURIComponent(imei)}`),

  getEquipmentTelemetry: (equipmentId: string): Promise<{ equipmentId: string; devices: GsmGatewayDevice[]; packets: GsmGatewayPacket[] }> =>
    api.get(`/api/gsm/equipment/${encodeURIComponent(equipmentId)}`),

  linkDevice: (payload: LinkGsmDevicePayload): Promise<{ ok: boolean; device: GsmGatewayDevice; equipment: unknown }> =>
    api.post('/api/gsm/devices/link', payload),

  getRoute: (params: { equipmentId: string; dateFrom: string; dateTo: string }): Promise<GsmGatewayRoutePoint[]> =>
    api.get<GsmGatewayRoutePoint[]>(`/api/gsm/route${buildQuery(params)}`),

  searchBindings: (params: { search?: string; limit?: number } = {}): Promise<GsmBindingSearchResponse> =>
    api.get<GsmBindingSearchResponse>(`/api/gsm/bindings${buildQuery(params)}`),

  getCommands: (params?: PacketQuery): Promise<GsmGatewayCommand[]> =>
    api.get<GsmGatewayCommand[]>(`/api/gsm/gateway/commands${buildQuery(params)}`),

  getCommandsPaginated: (params?: PaginatedQueryParams & PacketQuery): Promise<PaginatedResponse<GsmGatewayCommand>> =>
    api.get<PaginatedResponse<GsmGatewayCommand>>(`/api/gsm/gateway/commands${buildPaginatedQuery({
      ...params,
      filters: {
        equipmentId: params?.equipmentId,
        deviceId: params?.deviceId,
      },
    })}`),

  getAnalytics: (params?: PacketQuery): Promise<GsmGatewayAnalytics> =>
    api.get<GsmGatewayAnalytics>(`/api/gsm/gateway/analytics${buildQuery(params)}`),

  sendCommand: (payload: SendGsmCommandPayload): Promise<GsmGatewayCommand> =>
    api.post<GsmGatewayCommand>('/api/gsm/gateway/send', payload),

  createCommand: (payload: { equipmentId: string; command: string; payload?: Record<string, unknown> }): Promise<GsmGatewayCommand> =>
    api.post<GsmGatewayCommand>('/api/gsm/commands', payload),
};
