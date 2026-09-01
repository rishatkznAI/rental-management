import type { Equipment, EquipmentGsmSignalState, GsmGatewayPacket } from '../types';

export const GSM_ONLINE_WINDOW_MS: number;

export function isGsmTimestampWithinWindow(
  value?: unknown,
  options?: { nowMs?: number; windowMs?: number },
): boolean;

export function hasUsableGsmCoordinates(lat?: unknown, lng?: unknown): boolean;

export function hasUsableGsmPacketCoordinates(packet?: Partial<GsmGatewayPacket>): boolean;

export function selectLatestNonFutureGsmPacket(
  packets?: Partial<GsmGatewayPacket>[],
  options?: { nowMs?: number },
): Partial<GsmGatewayPacket> | null;

export function selectLatestParsedGsmPacket(
  packets?: Partial<GsmGatewayPacket>[],
  options?: { nowMs?: number },
): Partial<GsmGatewayPacket> | null;

export function selectLatestGsmLocationPacket(
  packets?: Partial<GsmGatewayPacket>[],
  options?: { nowMs?: number },
): Partial<GsmGatewayPacket> | null;

export function hasMeaningfulEquipmentGsmData(equipment?: Partial<Equipment>): boolean;

export function hasVerifiedGsmDeviceForEquipment(
  device?: { id?: unknown; equipmentId?: unknown; bindingRevision?: unknown } | null,
  equipmentId?: unknown,
): boolean;

export function deriveEquipmentGsmSignalState(
  equipment?: Partial<Equipment>,
  lastSeenAt?: string | null,
  options?: { nowMs?: number; onlineWindowMs?: number },
): EquipmentGsmSignalState;

export function getEquipmentGsmSaleValue(
  equipment?: Partial<Equipment>,
  options?: { nowMs?: number; onlineWindowMs?: number },
): string;

export function deriveGsmPacketSignalState(
  packet?: Partial<GsmGatewayPacket>,
  options?: { nowMs?: number; onlineWindowMs?: number },
): EquipmentGsmSignalState;
