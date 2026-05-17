import type { Equipment, GsmGatewayDevice, GsmGatewayPacket } from '../types';
import type { GsmEquipmentSnapshot } from './gsm';

export const UNLINKED_EQUIPMENT_LABEL: 'Техника не привязана';

export function buildGsmEquipmentLabel(
  equipment?: Partial<Equipment> | Partial<GsmGatewayDevice> | null,
  fallbackEquipmentId?: string,
): string;

export function buildGsmEquipmentLookup(
  snapshots?: GsmEquipmentSnapshot[],
  devices?: GsmGatewayDevice[],
): {
  byEquipmentId: Map<string, Partial<Equipment> | Partial<GsmGatewayDevice>>;
  byTrackerId: Map<string, string>;
};

export function resolveGsmPacketEquipment(
  packet?: Partial<GsmGatewayPacket>,
  lookup?: ReturnType<typeof buildGsmEquipmentLookup>,
): {
  linked: boolean;
  equipmentId: string;
  label: string;
  badge: string;
  trackerId: string;
};

export function toGsmCoordinateNumber(value: unknown): number | null;

export function getGsmCoordinateStatus(lat?: unknown, lng?: unknown): {
  status: 'real' | 'suspicious' | 'invalid' | 'missing';
  label: string;
  warning: string;
  lat: number | null;
  lng: number | null;
  valid: boolean;
};
