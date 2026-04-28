import type {
  Client,
  Equipment,
  EquipmentGsmPointSource,
  EquipmentGsmPositionPoint,
  EquipmentGsmSignalState,
  Rental,
  ShippingPhoto,
} from '../types';
import type { GanttRentalData } from '../mock-data';

export type GsmMovementKind = 'shipping' | 'receiving' | 'movement' | 'service' | 'telemetry';
export type GsmNotificationType = 'warehouse_exit' | 'jobsite_arrival' | 'signal_loss';
export type GsmZoneKind = 'warehouse' | 'jobsite';

export interface GsmResolvedPoint {
  lat: number;
  lng: number;
  source: EquipmentGsmPointSource;
  address: string;
}

export interface GsmRoutePoint extends GsmResolvedPoint {
  at: string;
  label: string;
}

export interface GsmMovementEntry {
  id: string;
  equipmentId: string;
  occurredAt: string;
  kind: GsmMovementKind;
  title: string;
  description: string;
  location: string;
  point?: GsmResolvedPoint;
}

export interface GsmZone {
  id: string;
  label: string;
  kind: GsmZoneKind;
  radiusMeters: number;
  point?: GsmResolvedPoint;
}

export interface GsmNotification {
  id: string;
  type: GsmNotificationType;
  occurredAt: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'danger';
}

export interface GsmRentalBinding {
  rentalId: string;
  clientName: string;
  manager?: string;
  startDate?: string;
  endDate?: string;
  deliveryAddress?: string;
  objectAddress?: string;
  objectPoint?: GsmResolvedPoint;
  ganttStatus?: GanttRentalData['status'];
  rentalStatus?: Rental['status'];
}

export interface GsmTelemetrySummary {
  engineHours: number | null;
  ignitionOn: boolean | null;
  batteryVoltage: number | null;
  speedKph: number | null;
}

export interface GsmEquipmentSnapshot {
  equipment: Equipment;
  point?: GsmResolvedPoint;
  hasRealTracker: boolean;
  signalState: EquipmentGsmSignalState;
  lastSeenAt: string | null;
  binding: GsmRentalBinding | null;
  telemetry: GsmTelemetrySummary;
  zones: GsmZone[];
  notifications: GsmNotification[];
  movementEntries: GsmMovementEntry[];
  routePoints: GsmRoutePoint[];
}

const CITY_DIRECTORY: Array<{
  patterns: string[];
  lat: number;
  lng: number;
  address: string;
}> = [
  { patterns: ['казань', 'kazan', 'e2e площадка', 'e2e'], lat: 55.796127, lng: 49.106414, address: 'Казань' },
  { patterns: ['набережные челны', 'челны', 'naberezhnye chelny'], lat: 55.743553, lng: 52.39582, address: 'Набережные Челны' },
  { patterns: ['елабуга', 'алабуга', 'elabuga', 'alabuga'], lat: 55.76127, lng: 52.06493, address: 'Елабуга / Алабуга' },
  { patterns: ['нижнекамск', 'nizhnekamsk'], lat: 55.6313, lng: 51.8143, address: 'Нижнекамск' },
  { patterns: ['альметьевск', 'almetyevsk'], lat: 54.9014, lng: 52.2971, address: 'Альметьевск' },
  { patterns: ['москва', 'moscow'], lat: 55.751244, lng: 37.618423, address: 'Москва' },
  { patterns: ['санкт-петербург', 'питер', 'saint petersburg'], lat: 59.939095, lng: 30.315868, address: 'Санкт-Петербург' },
  { patterns: ['самара', 'samara'], lat: 53.195878, lng: 50.100202, address: 'Самара' },
  { patterns: ['уфа', 'ufa'], lat: 54.738762, lng: 55.972055, address: 'Уфа' },
  { patterns: ['екатеринбург', 'ekaterinburg'], lat: 56.838011, lng: 60.597465, address: 'Екатеринбург' },
  { patterns: ['нижний новгород', 'nizhny novgorod'], lat: 56.296503, lng: 43.936059, address: 'Нижний Новгород' },
  { patterns: ['краснодар', 'krasnodar'], lat: 45.03547, lng: 38.975313, address: 'Краснодар' },
  { patterns: ['ростов', 'rostov-on-don'], lat: 47.222079, lng: 39.720349, address: 'Ростов-на-Дону' },
  { patterns: ['пермь', 'perm'], lat: 58.010258, lng: 56.234203, address: 'Пермь' },
  { patterns: ['челябинск', 'chelyabinsk'], lat: 55.160283, lng: 61.400856, address: 'Челябинск' },
  { patterns: ['тюмень', 'tyumen'], lat: 57.152985, lng: 65.541227, address: 'Тюмень' },
];

const WAREHOUSE_TEXT_RE = /склад|площадк|база|депо|стоянк|гараж/iu;
const CLIENT_OBJECT_TEXT_RE = /объект|строй|цех|площадка|территория|корпус|завод|комбинат|парк|улица|дом|проспект|шоссе/iu;
const MOVEMENT_TEXT_RE = /аренд|отгруж|прием|приём|достав|локац|перемещ|выдан|возврат|клиент|склад|база/iu;
const DEFAULT_CENTER = { lat: 55.796127, lng: 49.106414 };
const DEFAULT_WAREHOUSE_LABEL = 'Склад / база';
const GSM_SIGNAL_STATES = new Set<EquipmentGsmSignalState>(['online', 'location_only', 'offline']);

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizeText(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function stableHash(value: string) {
  let hash = 0;
  const text = normalizeText(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCoordinates(value: string) {
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = toNumber(match[1]);
  const lng = toNumber(match[2]);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function isValidCoordinatePair(lat: number | null, lng: number | null) {
  return lat !== null
    && lng !== null
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180;
}

function buildPointFromTelemetryEntry(
  entry: EquipmentGsmPositionPoint,
  fallbackAddress: string,
): GsmResolvedPoint | undefined {
  const lat = toNumber(entry?.lat);
  const lng = toNumber(entry?.lng);
  if (!isValidCoordinatePair(lat, lng)) return undefined;
  return {
    lat,
    lng,
    source: entry?.source || 'gps',
    address: entry?.address || fallbackAddress,
  };
}

function jitterPoint(lat: number, lng: number, seed: string) {
  const hash = stableHash(seed);
  const latOffset = ((hash % 17) - 8) * 0.0032;
  const lngOffset = (((Math.floor(hash / 17)) % 17) - 8) * 0.0048;
  return {
    lat: lat + latOffset,
    lng: lng + lngOffset,
  };
}

export function resolveNamedPoint(value: string | undefined | null, seed = ''): GsmResolvedPoint | undefined {
  const text = String(value || '').trim();
  if (!text) return undefined;

  const parsed = parseCoordinates(text);
  if (parsed) {
    return {
      ...parsed,
      source: 'parsed',
      address: text,
    };
  }

  const haystack = normalizeText(text);
  const city = CITY_DIRECTORY.find(item =>
    item.patterns.some(pattern => haystack.includes(pattern)),
  );
  if (city) {
    const jittered = jitterPoint(city.lat, city.lng, seed || text);
    return {
      ...jittered,
      source: 'directory',
      address: text || city.address,
    };
  }

  const approximate = jitterPoint(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng, seed || text);
  return {
    ...approximate,
    source: 'approximate',
    address: text,
  };
}

function getLatestMovementDate(equipment: Equipment, shippingPhotos: ShippingPhoto[]) {
  const history = asArray<Equipment['history'][number]>(equipment.history);
  const movementHistory = asArray<EquipmentGsmPositionPoint>(equipment.gsmMovementHistory);
  const dates = [
    equipment.gsmLastSeenAt,
    equipment.gsmLastSignalAt,
    ...shippingPhotos.map(item => item.date),
    ...history.map(item => item?.date),
    ...movementHistory.map(item => item?.at),
  ].filter(Boolean) as string[];

  if (dates.length === 0) return null;

  return dates.reduce((latest, current) => (
    new Date(current).getTime() > new Date(latest).getTime() ? current : latest
  ));
}

function hasRealTracker(equipment: Equipment) {
  const gpsLat = toNumber(equipment.gsmLastLat) ?? toNumber(equipment.gsmLatitude);
  const gpsLng = toNumber(equipment.gsmLastLng) ?? toNumber(equipment.gsmLongitude);
  const movementHistory = asArray<EquipmentGsmPositionPoint>(equipment.gsmMovementHistory);

  return Boolean(
    String(equipment.gsmTrackerId || '').trim()
    || String(equipment.gsmImei || '').trim()
    || String(equipment.gsmDeviceId || '').trim()
    || equipment.gsmLastSeenAt
    || equipment.gsmLastSignalAt
    || (equipment.gsmSignalStatus && equipment.gsmSignalStatus !== 'location_only')
    || isValidCoordinatePair(gpsLat, gpsLng)
    || movementHistory.some(entry => (
      entry?.source === 'gps'
      && isValidCoordinatePair(toNumber(entry?.lat), toNumber(entry?.lng))
    ))
  );
}

export function deriveSignalState(equipment: Equipment, lastSeenAt: string | null): EquipmentGsmSignalState {
  if (equipment.gsmStatus === 'online') return 'online';
  if (equipment.gsmStatus === 'offline') return 'offline';
  if (equipment.gsmSignalStatus && GSM_SIGNAL_STATES.has(equipment.gsmSignalStatus)) return equipment.gsmSignalStatus;
  if (equipment.gsmLastSeenAt || equipment.gsmLastSignalAt) {
    const ageHours = Math.max(0, (Date.now() - new Date(equipment.gsmLastSeenAt || equipment.gsmLastSignalAt || '').getTime()) / 36e5);
    return ageHours <= 24 ? 'online' : 'offline';
  }
  return lastSeenAt ? 'location_only' : 'offline';
}

function getTelemetrySummary(equipment: Equipment): GsmTelemetrySummary {
  const movementHistory = asArray<EquipmentGsmPositionPoint>(equipment.gsmMovementHistory);
  const movementSpeed = [...movementHistory]
    .reverse()
    .find(entry => typeof entry.speedKph === 'number');

  const speedKph = toNumber(equipment.gsmLastSpeed) ?? toNumber(equipment.gsmSpeedKph) ?? movementSpeed?.speedKph ?? null;
  const ignitionOn = typeof equipment.gsmIgnitionOn === 'boolean'
    ? equipment.gsmIgnitionOn
    : speedKph !== null
      ? speedKph > 1
      : null;

  return {
    engineHours: toNumber(equipment.gsmLastMotoHours) ?? toNumber(equipment.gsmHourmeter) ?? toNumber(equipment.hours),
    ignitionOn,
    batteryVoltage: toNumber(equipment.gsmLastVoltage) ?? toNumber(equipment.gsmBatteryVoltage),
    speedKph,
  };
}

function matchesGanttRental(equipment: Equipment, rental: GanttRentalData) {
  if (rental.equipmentId && equipment.id === rental.equipmentId) return true;
  if (rental.equipmentInv && equipment.inventoryNumber && rental.equipmentInv === equipment.inventoryNumber) return true;
  if (equipment.currentClient && normalizeText(rental.client) === normalizeText(equipment.currentClient)) return true;
  return false;
}

function findClassicRentalForBinding(
  ganttRental: GanttRentalData | undefined,
  equipment: Equipment,
  rentals: Rental[],
) {
  const candidates = rentals.filter(rental =>
    asArray<string>(rental.equipment).includes(equipment.inventoryNumber)
    || (ganttRental ? normalizeText(rental.client) === normalizeText(ganttRental.client) : false)
    || (equipment.currentClient ? normalizeText(rental.client) === normalizeText(equipment.currentClient) : false),
  );

  return candidates.sort((left, right) => (
    new Date(right.startDate).getTime() - new Date(left.startDate).getTime()
  ))[0];
}

function buildRentalBinding(
  equipment: Equipment,
  ganttRentals: GanttRentalData[],
  rentals: Rental[],
  clients: Client[],
): GsmRentalBinding | null {
  const activeGantt = ganttRentals
    .filter(rental => matchesGanttRental(equipment, rental))
    .sort((left, right) => {
      const score = (status: GanttRentalData['status']) => (status === 'active' ? 0 : status === 'created' ? 1 : status === 'returned' ? 2 : 3);
      return score(left.status) - score(right.status)
        || new Date(right.startDate).getTime() - new Date(left.startDate).getTime();
    })[0];

  const classicRental = findClassicRentalForBinding(activeGantt, equipment, rentals);
  const clientName = activeGantt?.client || classicRental?.client || equipment.currentClient;
  if (!clientName) return null;

  const client = clients.find(item => normalizeText(item.company) === normalizeText(clientName));
  const deliveryAddress = classicRental?.deliveryAddress || '';
  const objectAddress = deliveryAddress || client?.address || clientName;
  const objectPoint = resolveNamedPoint(objectAddress, `jobsite:${equipment.id}:${clientName}`);

  return {
    rentalId: activeGantt?.id || classicRental?.id || `${equipment.id}:binding`,
    clientName,
    manager: activeGantt?.manager || classicRental?.manager || client?.manager || undefined,
    startDate: activeGantt?.startDate || classicRental?.startDate,
    endDate: activeGantt?.endDate || classicRental?.plannedReturnDate,
    deliveryAddress: deliveryAddress || undefined,
    objectAddress,
    objectPoint,
    ganttStatus: activeGantt?.status,
    rentalStatus: classicRental?.status,
  };
}

function buildWarehouseZone(equipment: Equipment) {
  const warehouseLabel = WAREHOUSE_TEXT_RE.test(equipment.location || '')
    ? equipment.location
    : DEFAULT_WAREHOUSE_LABEL;
  const warehousePoint = resolveNamedPoint(
    WAREHOUSE_TEXT_RE.test(equipment.location || '') ? equipment.location : 'E2E площадка',
    `warehouse:${equipment.id}`,
  );

  return {
    id: `${equipment.id}:warehouse`,
    label: warehouseLabel || DEFAULT_WAREHOUSE_LABEL,
    kind: 'warehouse' as const,
    radiusMeters: 900,
    point: warehousePoint,
  };
}

function resolveEquipmentPoint(equipment: Equipment, binding: GsmRentalBinding | null): GsmResolvedPoint | undefined {
  const gpsLat = toNumber(equipment.gsmLastLat) ?? toNumber(equipment.gsmLatitude);
  const gpsLng = toNumber(equipment.gsmLastLng) ?? toNumber(equipment.gsmLongitude);
  if (gpsLat !== null && gpsLng !== null) {
    return {
      lat: gpsLat,
      lng: gpsLng,
      source: 'gps',
      address: equipment.gsmAddress || equipment.location || 'GPS',
    };
  }

  const coordinateSource = [equipment.gsmAddress, equipment.location]
    .map(value => String(value || '').trim())
    .find(Boolean);
  if (coordinateSource) {
    const parsed = parseCoordinates(coordinateSource);
    if (parsed) {
      return {
        ...parsed,
        source: 'parsed',
        address: coordinateSource,
      };
    }
  }

  if (equipment.status === 'rented' && binding?.objectPoint) {
    return binding.objectPoint;
  }

  return resolveNamedPoint(
    equipment.location || binding?.objectAddress || binding?.clientName,
    `equipment:${equipment.id}:${equipment.location || binding?.clientName || ''}`,
  );
}

function buildZones(
  equipment: Equipment,
  binding: GsmRentalBinding | null,
): GsmZone[] {
  const warehouse = buildWarehouseZone(equipment);
  const zones: GsmZone[] = [warehouse];

  if (binding?.objectPoint) {
    zones.push({
      id: `${equipment.id}:jobsite`,
      label: binding.objectAddress || binding.clientName,
      kind: 'jobsite',
      radiusMeters: CLIENT_OBJECT_TEXT_RE.test(binding.objectAddress || '')
        ? 700
        : 1100,
      point: binding.objectPoint,
    });
  }

  return zones;
}

function getPointForHistoryEntry(
  entryText: string,
  currentPoint: GsmResolvedPoint | undefined,
  warehouseZone: GsmZone | undefined,
  jobsiteZone: GsmZone | undefined,
) {
  if (/возврат|склад|площадк|база/iu.test(entryText)) return warehouseZone?.point || currentPoint;
  if (/выдан|клиент|аренд|объект|достав/iu.test(entryText)) return jobsiteZone?.point || currentPoint;
  if (/сервис|ремонт/iu.test(entryText)) return currentPoint;
  return currentPoint;
}

export function buildMovementEntries(
  equipment: Equipment,
  shippingPhotos: ShippingPhoto[],
  currentPoint: GsmResolvedPoint | undefined,
  zones: GsmZone[],
  binding: GsmRentalBinding | null,
): GsmMovementEntry[] {
  const warehouseZone = zones.find(zone => zone.kind === 'warehouse');
  const jobsiteZone = zones.find(zone => zone.kind === 'jobsite');

  const shippingEntries = shippingPhotos.map(photo => {
    const isShipping = photo.type === 'shipping';
    const point = isShipping
      ? jobsiteZone?.point || currentPoint
      : warehouseZone?.point || currentPoint;
    const location = isShipping
      ? binding?.objectAddress || binding?.clientName || currentPoint?.address || equipment.location || 'Объект клиента'
      : warehouseZone?.label || equipment.location || 'Склад / база';

    const descriptionParts = [
      binding?.clientName ? `Клиент: ${binding.clientName}` : '',
      photo.uploadedBy ? `Оформил: ${photo.uploadedBy}` : '',
      typeof photo.hoursValue === 'number' ? `Моточасы: ${photo.hoursValue}` : '',
      photo.comment || photo.damageDescription || '',
    ].filter(Boolean);

    return {
      id: `${photo.id}:${photo.type}`,
      equipmentId: equipment.id,
      occurredAt: photo.date,
      kind: photo.type,
      title: isShipping ? 'Отгрузка техники' : 'Приёмка техники',
      description: descriptionParts.join(' · '),
      location,
      point,
    } satisfies GsmMovementEntry;
  });

  const historyEntries = asArray<NonNullable<Equipment['history']>[number]>(equipment.history)
    .filter(Boolean)
    .filter(entry => MOVEMENT_TEXT_RE.test(entry.text))
    .map((entry, index) => {
      const point = getPointForHistoryEntry(entry.text, currentPoint, warehouseZone, jobsiteZone);
      return {
        id: `${equipment.id}:history:${index}:${entry.date}`,
        equipmentId: equipment.id,
        occurredAt: entry.date,
        kind: /сервис|ремонт/iu.test(entry.text) ? 'service' : 'movement',
        title: /сервис|ремонт/iu.test(entry.text) ? 'Сервисное перемещение' : 'Перемещение / смена статуса',
        description: entry.text,
        location: point?.address || equipment.location || 'Локация не указана',
        point,
      } satisfies GsmMovementEntry;
    });

  const telemetryEntries = asArray<EquipmentGsmPositionPoint>(equipment.gsmMovementHistory)
    .map((entry, index) => {
      const point = buildPointFromTelemetryEntry(
        entry,
        equipment.gsmAddress || equipment.location || 'Точка GSM',
      );
      if (!point) return null;

      return {
        id: `${equipment.id}:telemetry:${index}:${entry.at}`,
        equipmentId: equipment.id,
        occurredAt: entry.at,
        kind: 'telemetry' as const,
        title: 'Точка GSM',
        description: [
          entry.address || '',
          typeof entry.speedKph === 'number' ? `Скорость: ${entry.speedKph} км/ч` : '',
        ].filter(Boolean).join(' · '),
        location: entry.address || equipment.gsmAddress || equipment.location || 'Точка без адреса',
        point,
      } satisfies GsmMovementEntry;
    })
    .filter(Boolean) as GsmMovementEntry[];

  if (!shippingEntries.length && !historyEntries.length && !telemetryEntries.length && currentPoint) {
    historyEntries.push({
      id: `${equipment.id}:current-location`,
      equipmentId: equipment.id,
      occurredAt: equipment.gsmLastSeenAt || equipment.gsmLastSignalAt || new Date().toISOString(),
      kind: 'movement',
      title: 'Текущая известная локация',
      description: equipment.currentClient
        ? `Техника закреплена за клиентом ${equipment.currentClient}`
        : 'Локация взята из карточки техники',
      location: currentPoint.address,
      point: currentPoint,
    });
  }

  return [...telemetryEntries, ...shippingEntries, ...historyEntries]
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
}

function dedupeRoutePoints(points: GsmRoutePoint[]) {
  const unique: GsmRoutePoint[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (
      previous
      && Math.abs(previous.lat - point.lat) < 0.000001
      && Math.abs(previous.lng - point.lng) < 0.000001
      && previous.label === point.label
    ) {
      continue;
    }
    unique.push(point);
  }
  return unique;
}

function buildRoutePoints(
  equipment: Equipment,
  movementEntries: GsmMovementEntry[],
): GsmRoutePoint[] {
  const telemetryPoints = (asArray<EquipmentGsmPositionPoint>(equipment.gsmMovementHistory)
    .map(entry => {
      const point = buildPointFromTelemetryEntry(
        entry,
        equipment.gsmAddress || equipment.location || 'Точка GSM',
      );
      if (!point) return null;
      return {
        at: entry.at,
        lat: point.lat,
        lng: point.lng,
        source: point.source,
        address: point.address,
        label: 'Точка GSM',
      } satisfies GsmRoutePoint;
    })
    .filter(Boolean) as GsmRoutePoint[])
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());

  if (telemetryPoints.length > 0) {
    return dedupeRoutePoints(telemetryPoints);
  }

  const movementPoints = movementEntries
    .filter(entry => entry.point)
    .map(entry => ({
      at: entry.occurredAt,
      lat: entry.point!.lat,
      lng: entry.point!.lng,
      source: entry.point!.source,
      address: entry.point!.address,
      label: entry.title,
    }))
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());

  return dedupeRoutePoints(movementPoints);
}

function distanceMeters(left: GsmResolvedPoint, right: GsmResolvedPoint) {
  const toRad = (value: number) => value * Math.PI / 180;
  const earthRadius = 6371e3;
  const dLat = toRad(right.lat - left.lat);
  const dLng = toRad(right.lng - left.lng);
  const lat1 = toRad(left.lat);
  const lat2 = toRad(right.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isPointInsideZone(point: GsmResolvedPoint | undefined, zone: GsmZone | undefined) {
  if (!point || !zone?.point) return false;
  return distanceMeters(point, zone.point) <= zone.radiusMeters;
}

function buildNotifications(
  hasTracker: boolean,
  equipment: Equipment,
  signalState: EquipmentGsmSignalState,
  lastSeenAt: string | null,
  currentPoint: GsmResolvedPoint | undefined,
  movementEntries: GsmMovementEntry[],
  zones: GsmZone[],
  binding: GsmRentalBinding | null,
): GsmNotification[] {
  if (!hasTracker) return [];

  const notifications: GsmNotification[] = [];
  const warehouseZone = zones.find(zone => zone.kind === 'warehouse');
  const jobsiteZone = zones.find(zone => zone.kind === 'jobsite');
  const shippingEntry = movementEntries.find(entry => entry.kind === 'shipping');

  if (signalState === 'offline' && lastSeenAt) {
    notifications.push({
      id: `${equipment.id}:signal-loss`,
      type: 'signal_loss',
      occurredAt: lastSeenAt,
      title: 'Пропажа сигнала',
      description: `Последняя связь была ${new Date(lastSeenAt).toLocaleString('ru-RU')}. Стоит проверить трекер и питание.`,
      severity: 'danger',
    });
  }

  if (shippingEntry && warehouseZone?.point && currentPoint && !isPointInsideZone(currentPoint, warehouseZone)) {
    notifications.push({
      id: `${equipment.id}:warehouse-exit`,
      type: 'warehouse_exit',
      occurredAt: shippingEntry.occurredAt,
      title: 'Выезд со склада',
      description: `Техника вышла из геозоны склада и сейчас находится вне базы: ${currentPoint.address}.`,
      severity: 'info',
    });
  }

  if (binding?.objectPoint && currentPoint && isPointInsideZone(currentPoint, jobsiteZone)) {
    notifications.push({
      id: `${equipment.id}:jobsite-arrival`,
      type: 'jobsite_arrival',
      occurredAt: lastSeenAt || shippingEntry?.occurredAt || new Date().toISOString(),
      title: 'Прибытие на объект',
      description: `Техника находится в геозоне объекта клиента ${binding.clientName}${binding.objectAddress ? `: ${binding.objectAddress}` : ''}.`,
      severity: 'warning',
    });
  }

  return notifications.sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
}

export function buildGsmSnapshot(
  equipment: Equipment,
  allShippingPhotos: ShippingPhoto[],
  ganttRentals: GanttRentalData[],
  rentals: Rental[],
  clients: Client[],
): GsmEquipmentSnapshot {
  const shippingPhotos = allShippingPhotos.filter(item => item.equipmentId === equipment.id);
  const binding = buildRentalBinding(equipment, ganttRentals, rentals, clients);
  const point = resolveEquipmentPoint(equipment, binding);
  const lastSeenAt = getLatestMovementDate(equipment, shippingPhotos);
  const hasTracker = hasRealTracker(equipment);
  const signalState = deriveSignalState(equipment, lastSeenAt);
  const telemetry = getTelemetrySummary(equipment);
  const zones = buildZones(equipment, binding);
  const movementEntries = buildMovementEntries(equipment, shippingPhotos, point, zones, binding);
  const routePoints = buildRoutePoints(equipment, movementEntries);
  const notifications = buildNotifications(hasTracker, equipment, signalState, lastSeenAt, point, movementEntries, zones, binding);

  return {
    equipment,
    point,
    hasRealTracker: hasTracker,
    signalState,
    lastSeenAt,
    binding,
    telemetry,
    zones,
    notifications,
    movementEntries,
    routePoints,
  };
}
