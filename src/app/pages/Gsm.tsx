import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  ArrowUpRight,
  BatteryCharging,
  Cable,
  Clock3,
  Cpu,
  Gauge,
  History,
  Map as MapIcon,
  MapPinned,
  Navigation,
  Plus,
  Route,
  Search,
  SendHorizontal,
  Server,
  Siren,
  Truck,
  Wrench,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge, getEquipmentStatusBadge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { cn } from '../lib/utils';
import { useEquipmentList } from '../hooks/useEquipment';
import { useClientsList } from '../hooks/useClients';
import { useGanttData, useRentalsList } from '../hooks/useRentals';
import { useAuth } from '../contexts/AuthContext';
import { equipmentService } from '../services/equipment.service';
import { gsmGatewayService } from '../services/gsm-gateway.service';
import {
  buildGsmSnapshot,
  isPointInsideZone,
  type GsmEquipmentSnapshot,
  type GsmMovementEntry,
  type GsmNotification,
  type GsmResolvedPoint,
  type GsmRoutePoint,
  type GsmZone,
} from '../lib/gsm';
import type {
  Equipment,
  EquipmentGsmSignalState,
  EquipmentStatus,
  GsmGatewayAnalytics,
  GsmGatewayCommand,
  GsmGatewayConnection,
  GsmGatewayDevice,
  GsmGatewayPacket,
  GsmGatewayRoutePoint,
  GsmGatewayStatus,
  ShippingPhoto,
} from '../types';

declare global {
  interface Window {
    L?: any;
    __leafletPromise?: Promise<any>;
  }
}

type SignalFilter = 'all' | EquipmentGsmSignalState;
type StatusFilter = 'all' | EquipmentStatus;
type GsmTab = 'overview' | 'devices' | 'packets' | 'route' | 'live' | 'history' | 'gateway';
type RoutePeriod = 'day' | 'week';
type GsmCommandEncoding = 'text' | 'hex';
type GsmBindingForm = {
  equipmentId: string;
  gsmImei: string;
  gsmDeviceId: string;
  gsmSimNumber: string;
  gsmProtocol: string;
};

const EMPTY_GSM_BINDING_FORM: GsmBindingForm = {
  equipmentId: '',
  gsmImei: '',
  gsmDeviceId: '',
  gsmSimNumber: '',
  gsmProtocol: '',
};

const DEFAULT_CENTER: [number, number] = [55.796127, 49.106414];
const DEFAULT_GATEWAY_STATUS: GsmGatewayStatus = {
  gatewayEnabled: true,
  tcpPort: 5023,
  uptimeSeconds: 0,
  connectionsActive: 0,
  packetsReceivedTotal: 0,
  enabled: true,
  disabled: false,
  host: '0.0.0.0',
  port: 5023,
  startedAt: null,
  startError: '',
  onlineConnections: 0,
  onlineDevices: 0,
  packetsStored: 0,
  packetsToday: 0,
  queuedCommands: 0,
  sentToday: 0,
  failedCommands: 0,
  lastPacketAt: null,
};

const DEFAULT_GATEWAY_ANALYTICS: GsmGatewayAnalytics = {
  trackedEquipment: 0,
  configuredTrackers: 0,
  onlineTrackedEquipment: 0,
  staleTrackers: 0,
  unknownPackets24h: 0,
  packets24h: 0,
  inbound24h: 0,
  outbound24h: 0,
  commandStatus: {
    total: 0,
    queued: 0,
    sent: 0,
    acknowledged: 0,
    failed: 0,
  },
  protocols: [],
  selected: {
    equipmentId: null,
    deviceId: null,
    packets24h: 0,
    inbound24h: 0,
    outbound24h: 0,
    lastPacketAt: null,
    lastProtocol: null,
    lastSummary: null,
    commandStatus: {
      total: 0,
      queued: 0,
      sent: 0,
      acknowledged: 0,
      failed: 0,
    },
    lastCommandAt: null,
    lastCommandStatus: null,
  },
};

const SIGNAL_META: Record<EquipmentGsmSignalState, {
  label: string;
  hint: string;
  badge: 'success' | 'warning' | 'default';
  markerColor: string;
}> = {
  online: {
    label: 'Есть сигнал',
    hint: 'Точка пришла от GPS / трекера',
    badge: 'success',
    markerColor: '#10b981',
  },
  location_only: {
    label: 'По локации',
    hint: 'Показываем по карточке техники и истории движения',
    badge: 'warning',
    markerColor: '#f59e0b',
  },
  offline: {
    label: 'Нет сигнала',
    hint: 'Нет свежих данных от трекера',
    badge: 'default',
    markerColor: '#94a3b8',
  },
};

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  available: 'Свободна',
  rented: 'В аренде',
  reserved: 'В резерве',
  in_service: 'В сервисе',
  inactive: 'Неактивна',
};

const NOTIFICATION_META: Record<GsmNotification['type'], {
  badge: 'info' | 'warning' | 'danger';
  icon: React.ElementType;
}> = {
  warehouse_exit: { badge: 'info', icon: Truck },
  jobsite_arrival: { badge: 'warning', icon: MapPinned },
  signal_loss: { badge: 'danger', icon: Siren },
};

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ru-RU');
  } catch {
    return value;
  }
}

function formatRelativeSignal(value?: string | null) {
  if (!value) return 'Нет данных';
  const diffMs = Date.now() - new Date(value).getTime();
  const diffHours = Math.max(0, Math.round(diffMs / 36e5));
  if (diffHours < 1) return 'меньше часа назад';
  if (diffHours < 24) return `${diffHours} ч назад`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} дн назад`;
}

function formatEngineHours(value: number | null) {
  if (value === null) return '—';
  return `${value.toLocaleString('ru-RU')} м/ч`;
}

function formatVoltage(value: number | null) {
  if (value === null) return 'Нет данных';
  return `${value.toFixed(1)} В`;
}

function formatSpeed(value: number | null) {
  if (value === null) return '—';
  return `${value.toLocaleString('ru-RU')} км/ч`;
}

function formatBytes(value: number | null | undefined) {
  const amount = Number(value) || 0;
  if (amount >= 1024 * 1024) return `${(amount / (1024 * 1024)).toFixed(1)} МБ`;
  if (amount >= 1024) return `${(amount / 1024).toFixed(1)} КБ`;
  return `${amount} Б`;
}

function formatPercent(value: number, total: number) {
  if (!total) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

function formatCommandStatus(value?: GsmGatewayAnalytics['selected']['lastCommandStatus']) {
  if (value === 'sent') return 'Отправлено';
  if (value === 'acknowledged') return 'Подтверждено';
  if (value === 'failed') return 'Ошибка';
  if (value === 'queued') return 'В очереди';
  return 'Нет команд';
}

function compactPayloadText(packet: GsmGatewayPacket | GsmGatewayCommand) {
  const raw = typeof packet.payload === 'object' && packet.payload !== null
    ? JSON.stringify(packet.payload)
    : String(packet.payload || '');
  const text = raw.trim();
  if (!text) return 'HEX пакет';
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function packetReceivedAt(packet: GsmGatewayPacket) {
  return packet.receivedAt || packet.createdAt;
}

function packetRawHex(packet: GsmGatewayPacket) {
  return packet.rawHex || packet.payloadHex || '';
}

function packetRawText(packet: GsmGatewayPacket) {
  return packet.rawText ?? packet.payload ?? null;
}

function packetSourceIp(packet: GsmGatewayPacket) {
  return packet.sourceIp || packet.remoteAddress || '—';
}

function formatCoordinates(lat?: number | null, lng?: number | null) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return '—';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatGsmStatus(status?: string | null) {
  if (status === 'online') return 'Онлайн';
  if (status === 'offline') return 'Офлайн';
  return 'Неизвестно';
}

function formatGatewayState(status: GsmGatewayStatus) {
  if (status.gatewayEnabled) return 'Активен';
  if (status.disabled) return 'Отключён';
  return 'Ошибка';
}

function getParseStatusBadge(status?: string | null): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'parsed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'warning';
  return 'default';
}

function buildEquipmentLabel(snapshot: GsmEquipmentSnapshot) {
  return [
    snapshot.equipment.manufacturer,
    snapshot.equipment.model,
    snapshot.equipment.inventoryNumber ? `INV ${snapshot.equipment.inventoryNumber}` : '',
  ].filter(Boolean).join(' · ');
}

function buildEquipmentOptionLabel(equipment: Equipment) {
  const title = [
    equipment.inventoryNumber ? `INV ${equipment.inventoryNumber}` : '',
    equipment.manufacturer,
    equipment.model,
  ].filter(Boolean).join(' · ') || equipment.id;
  return equipment.serialNumber ? `${title} · SN ${equipment.serialNumber}` : title;
}

function makeGsmBindingForm(equipment?: Equipment | null): GsmBindingForm {
  if (!equipment) return EMPTY_GSM_BINDING_FORM;
  return {
    equipmentId: equipment.id,
    gsmImei: String(equipment.gsmImei || '').trim(),
    gsmDeviceId: String(equipment.gsmDeviceId || equipment.gsmTrackerId || '').trim(),
    gsmSimNumber: String(equipment.gsmSimNumber || '').trim(),
    gsmProtocol: String(equipment.gsmProtocol || '').trim(),
  };
}

function buildMapLink(point?: GsmResolvedPoint) {
  if (!point) return null;
  const { lat, lng } = point;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=11/${lat}/${lng}`;
}

function getMovementIcon(kind: GsmMovementEntry['kind']) {
  if (kind === 'shipping') return Truck;
  if (kind === 'receiving') return Route;
  if (kind === 'service') return Wrench;
  if (kind === 'telemetry') return Navigation;
  return MapPinned;
}

function getIgnitionLabel(value: boolean | null) {
  if (value === null) return 'Нет данных';
  return value ? 'Включено' : 'Выключено';
}

function ensureLeafletStyles() {
  if (document.querySelector('link[data-leaflet-css="true"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  link.setAttribute('data-leaflet-css', 'true');
  document.head.appendChild(link);
}

function loadLeaflet() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Leaflet is available only in browser.'));
  }
  if (window.L) return Promise.resolve(window.L);
  if (window.__leafletPromise) return window.__leafletPromise;

  ensureLeafletStyles();

  window.__leafletPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-leaflet-js="true"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L), { once: true });
      existing.addEventListener('error', () => reject(new Error('Не удалось загрузить Leaflet.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.setAttribute('data-leaflet-js', 'true');
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error('Не удалось загрузить карту.'));
    document.body.appendChild(script);
  });

  return window.__leafletPromise;
}

type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle: string;
  signalState: EquipmentGsmSignalState;
};

function GsmLeafletMap({
  markers,
  selectedId,
  onSelect,
  routePoints,
  zones,
}: {
  markers: MapMarker[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  routePoints: GsmRoutePoint[];
  zones: GsmZone[];
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const markersLayerRef = React.useRef<any>(null);
  const routeLayerRef = React.useRef<any>(null);
  const zonesLayerRef = React.useRef<any>(null);
  const [loadError, setLoadError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;

    void loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;

        if (!mapRef.current) {
          mapRef.current = L.map(containerRef.current, {
            zoomControl: false,
            attributionControl: true,
          }).setView(DEFAULT_CENTER, 5);

          L.control.zoom({ position: 'topright' }).addTo(mapRef.current);
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap',
          }).addTo(mapRef.current);
          markersLayerRef.current = L.layerGroup().addTo(mapRef.current);
          routeLayerRef.current = L.layerGroup().addTo(mapRef.current);
          zonesLayerRef.current = L.layerGroup().addTo(mapRef.current);
        }

        markersLayerRef.current?.clearLayers();
        routeLayerRef.current?.clearLayers();
        zonesLayerRef.current?.clearLayers();

        const latLngs: Array<[number, number]> = [];

        zones
          .filter(zone => zone.point)
          .forEach((zone) => {
            const isWarehouse = zone.kind === 'warehouse';
            const color = isWarehouse ? '#38bdf8' : '#f59e0b';
            const circle = L.circle([zone.point!.lat, zone.point!.lng], {
              radius: zone.radiusMeters,
              color,
              weight: 1.5,
              fillColor: color,
              fillOpacity: isWarehouse ? 0.08 : 0.12,
            });
            circle.bindTooltip(`${isWarehouse ? 'Геозона склада' : 'Геозона объекта'}\n${zone.label}`);
            circle.addTo(zonesLayerRef.current);
            latLngs.push([zone.point!.lat, zone.point!.lng]);
          });

        markers.forEach((marker) => {
          const meta = SIGNAL_META[marker.signalState];
          const circle = L.circleMarker([marker.lat, marker.lng], {
            radius: selectedId === marker.id ? 11 : 8,
            color: selectedId === marker.id ? '#f8fafc' : meta.markerColor,
            weight: selectedId === marker.id ? 3 : 2,
            fillColor: meta.markerColor,
            fillOpacity: marker.signalState === 'offline' ? 0.45 : 0.82,
          });

          circle.bindTooltip(`${marker.title}\n${marker.subtitle}`, {
            direction: 'top',
            opacity: 0.92,
          });
          circle.on('click', () => onSelect(marker.id));
          circle.addTo(markersLayerRef.current);
          latLngs.push([marker.lat, marker.lng]);
        });

        if (routePoints.length > 0) {
          const polylinePoints = routePoints.map(point => [point.lat, point.lng] as [number, number]);
          const polyline = L.polyline(polylinePoints, {
            color: '#22d3ee',
            weight: 4,
            opacity: 0.78,
          });
          polyline.addTo(routeLayerRef.current);
          polyline.bindTooltip(`Маршрут за период: ${routePoints.length} ${routePoints.length === 1 ? 'точка' : 'точки'}`);
          latLngs.push(...polylinePoints);

          routePoints.forEach((point, index) => {
            const marker = L.circleMarker([point.lat, point.lng], {
              radius: index === routePoints.length - 1 ? 7 : 5,
              color: '#082f49',
              weight: 2,
              fillColor: index === routePoints.length - 1 ? '#22d3ee' : '#bae6fd',
              fillOpacity: 0.95,
            });
            marker.bindTooltip(`${point.label}\n${point.address}\n${formatDateTime(point.at)}`);
            marker.addTo(routeLayerRef.current);
          });
        }

        if (latLngs.length === 0) {
          mapRef.current.setView(DEFAULT_CENTER, 5);
          setTimeout(() => mapRef.current?.invalidateSize(), 120);
          return;
        }

        if (selectedId) {
          const selected = markers.find((marker) => marker.id === selectedId);
          if (selected) {
            mapRef.current.setView([selected.lat, selected.lng], Math.max(mapRef.current.getZoom(), 10));
          } else {
            mapRef.current.fitBounds(latLngs, { padding: [30, 30] });
          }
        } else if (latLngs.length === 1) {
          mapRef.current.setView(latLngs[0], 10);
        } else {
          mapRef.current.fitBounds(latLngs, { padding: [30, 30] });
        }

        setTimeout(() => mapRef.current?.invalidateSize(), 120);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message || 'Не удалось загрузить карту.');
      });

    return () => {
      cancelled = true;
    };
  }, [markers, onSelect, routePoints, selectedId, zones]);

  React.useEffect(() => () => {
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      routeLayerRef.current = null;
      zonesLayerRef.current = null;
    }
  }, []);

  if (loadError) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-3xl border border-dashed border-white/10 bg-slate-950/40 px-6 text-center text-sm text-slate-300">
        {loadError} Список техники, уведомления и история ниже продолжают работать.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="min-h-[520px] rounded-3xl border border-white/10 bg-slate-950/40"
    />
  );
}

function filterRoutePoints(points: GsmRoutePoint[], period: RoutePeriod) {
  const now = Date.now();
  const windowMs = period === 'day' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return points.filter(point => now - new Date(point.at).getTime() <= windowMs);
}

export default function Gsm() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: equipment = [] } = useEquipmentList();
  const { data: rentals = [] } = useRentalsList();
  const { data: ganttRentals = [] } = useGanttData();
  const { data: clients = [] } = useClientsList();
  const { data: shippingPhotos = [] } = useQuery<ShippingPhoto[]>({
    queryKey: ['shippingPhotos', 'all'],
    queryFn: equipmentService.getAllShippingPhotos,
    staleTime: 1000 * 60,
  });

  const [tab, setTab] = React.useState<GsmTab>('overview');
  const [search, setSearch] = React.useState('');
  const [signalFilter, setSignalFilter] = React.useState<SignalFilter>('all');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedPacket, setSelectedPacket] = React.useState<GsmGatewayPacket | null>(null);
  const [routeEquipmentId, setRouteEquipmentId] = React.useState('');
  const [routeFrom, setRouteFrom] = React.useState('');
  const [routeTo, setRouteTo] = React.useState('');
  const [routePeriod, setRoutePeriod] = React.useState<RoutePeriod>('day');
  const [commandPayload, setCommandPayload] = React.useState('');
  const [commandEncoding, setCommandEncoding] = React.useState<GsmCommandEncoding>('text');
  const [appendNewline, setAppendNewline] = React.useState(true);
  const [commandDeviceId, setCommandDeviceId] = React.useState('');
  const [gsmBindingOpen, setGsmBindingOpen] = React.useState(false);
  const [gsmBindingForm, setGsmBindingForm] = React.useState<GsmBindingForm>(EMPTY_GSM_BINDING_FORM);
  const canSendGprsCommands = user?.role === 'Администратор' || user?.role === 'Офис-менеджер';
  const canBindGsmEquipment = user?.role === 'Администратор' || user?.role === 'Офис-менеджер';

  const { data: gatewayStatus = DEFAULT_GATEWAY_STATUS } = useQuery({
    queryKey: ['gsmGateway', 'status'],
    queryFn: () => gsmGatewayService.getStatus().catch(() => DEFAULT_GATEWAY_STATUS),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const { data: gatewayConnections = [] } = useQuery<GsmGatewayConnection[]>({
    queryKey: ['gsmGateway', 'connections'],
    queryFn: () => gsmGatewayService.getConnections().catch(() => []),
    refetchInterval: 5_000,
    staleTime: 3_000,
  });
  const { data: gsmDevices = [] } = useQuery<GsmGatewayDevice[]>({
    queryKey: ['gsmGateway', 'devices'],
    queryFn: () => gsmGatewayService.getDevices().catch(() => []),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const { data: recentGatewayPackets = [] } = useQuery<GsmGatewayPacket[]>({
    queryKey: ['gsmGateway', 'packets', 'recent'],
    queryFn: () => gsmGatewayService.getPackets({ limit: 100 }).catch(() => []),
    refetchInterval: 5_000,
    staleTime: 3_000,
  });
  const { data: apiRoutePoints = [] } = useQuery<GsmGatewayRoutePoint[]>({
    queryKey: ['gsmGateway', 'route', routeEquipmentId || 'none', routeFrom || 'from-empty', routeTo || 'to-empty'],
    queryFn: () => routeEquipmentId
      ? gsmGatewayService.getRoute({ equipmentId: routeEquipmentId, from: routeFrom || undefined, to: routeTo || undefined }).catch(() => [])
      : Promise.resolve([]),
    enabled: Boolean(routeEquipmentId),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const snapshots = React.useMemo(
    () => equipment
      .map((item) => {
        try {
          return buildGsmSnapshot(item, shippingPhotos, ganttRentals, rentals, clients);
        } catch (error) {
          console.error('GSM snapshot build failed for equipment', item?.id, error);
          return null;
        }
      })
      .filter(Boolean) as GsmEquipmentSnapshot[],
    [clients, equipment, ganttRentals, rentals, shippingPhotos],
  );

  const equipmentOptions = React.useMemo(
    () => [...equipment].sort((left, right) => (
      buildEquipmentOptionLabel(left).localeCompare(buildEquipmentOptionLabel(right), 'ru', {
        numeric: true,
        sensitivity: 'base',
      })
    )),
    [equipment],
  );

  const filteredSnapshots = React.useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return snapshots.filter((snapshot) => {
      const matchesSearch = !normalizedSearch || [
        snapshot.equipment.inventoryNumber,
        snapshot.equipment.manufacturer,
        snapshot.equipment.model,
        snapshot.equipment.serialNumber,
        snapshot.equipment.location,
        snapshot.equipment.currentClient,
        snapshot.point?.address,
        snapshot.binding?.clientName,
        snapshot.binding?.deliveryAddress,
      ].some(value => String(value || '').toLowerCase().includes(normalizedSearch));

      const matchesSignal = signalFilter === 'all' || snapshot.signalState === signalFilter;
      const matchesStatus = statusFilter === 'all' || snapshot.equipment.status === statusFilter;

      return matchesSearch && matchesSignal && matchesStatus;
    });
  }, [search, signalFilter, snapshots, statusFilter]);

  React.useEffect(() => {
    if (filteredSnapshots.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredSnapshots.some(item => item.equipment.id === selectedId)) {
      setSelectedId(filteredSnapshots[0].equipment.id);
    }
  }, [filteredSnapshots, selectedId]);

  React.useEffect(() => {
    if (routeEquipmentId || gsmDevices.length === 0) return;
    setRouteEquipmentId(gsmDevices[0].equipmentId);
  }, [gsmDevices, routeEquipmentId]);

  const selectedSnapshot = React.useMemo(
    () => filteredSnapshots.find(item => item.equipment.id === selectedId) || filteredSnapshots[0] || null,
    [filteredSnapshots, selectedId],
  );
  const selectedTrackerId = React.useMemo(
    () => String(
      selectedSnapshot?.equipment.gsmDeviceId
      || selectedSnapshot?.equipment.gsmImei
      || selectedSnapshot?.equipment.gsmTrackerId
      || '',
    ).trim(),
    [selectedSnapshot],
  );

  const { data: gatewayAnalytics = DEFAULT_GATEWAY_ANALYTICS } = useQuery<GsmGatewayAnalytics>({
    queryKey: ['gsmGateway', 'analytics', selectedSnapshot?.equipment.id || 'all', selectedTrackerId || 'none'],
    queryFn: () => gsmGatewayService.getAnalytics({
      equipmentId: selectedSnapshot?.equipment.id || undefined,
      deviceId: selectedTrackerId || undefined,
    }).catch(() => DEFAULT_GATEWAY_ANALYTICS),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  React.useEffect(() => {
    setCommandDeviceId(selectedTrackerId);
  }, [selectedTrackerId]);

  const selectedRoutePoints = React.useMemo(
    () => selectedSnapshot ? filterRoutePoints(selectedSnapshot.routePoints, routePeriod) : [],
    [routePeriod, selectedSnapshot],
  );

  const mapMarkers = React.useMemo(() => (
    filteredSnapshots
      .filter(item => item.point)
      .map(item => ({
        id: item.equipment.id,
        lat: item.point!.lat,
        lng: item.point!.lng,
        title: buildEquipmentLabel(item),
        subtitle: [item.point!.address, SIGNAL_META[item.signalState].label].filter(Boolean).join(' · '),
        signalState: item.signalState,
      }))
  ), [filteredSnapshots]);

  const movementFeed = React.useMemo(() => {
    const feed = selectedSnapshot
      ? selectedSnapshot.movementEntries
      : filteredSnapshots.flatMap(item => item.movementEntries);

    const unique = new Map(feed.map(entry => [entry.id, entry]));
    return [...unique.values()]
      .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
      .slice(0, 100);
  }, [filteredSnapshots, selectedSnapshot]);

  const notificationFeed = React.useMemo(() => {
    const feed = selectedSnapshot
      ? selectedSnapshot.notifications
      : filteredSnapshots.flatMap(item => item.notifications);

    const unique = new Map(feed.map(entry => [entry.id, entry]));
    return [...unique.values()]
      .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
      .slice(0, 20);
  }, [filteredSnapshots, selectedSnapshot]);

  const metrics = React.useMemo(() => ({
    total: snapshots.length,
    mapped: snapshots.filter(item => item.point).length,
    realGps: snapshots.filter(item => item.point?.source === 'gps').length,
    locationDerived: snapshots.filter(item => item.point && item.point.source !== 'gps').length,
    rented: snapshots.filter(item => item.equipment.status === 'rented').length,
    alerts: snapshots.reduce((sum, item) => sum + item.notifications.length, 0),
  }), [snapshots]);

  const statusFilterOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'Все статусы' },
    { value: 'available', label: 'Свободна' },
    { value: 'rented', label: 'В аренде' },
    { value: 'reserved', label: 'В резерве' },
    { value: 'in_service', label: 'В сервисе' },
    { value: 'inactive', label: 'Неактивна' },
  ];

  const warehouseZone = selectedSnapshot?.zones.find(zone => zone.kind === 'warehouse');
  const jobsiteZone = selectedSnapshot?.zones.find(zone => zone.kind === 'jobsite');

  const selectedGatewayConnections = React.useMemo(() => {
    if (!selectedSnapshot) return gatewayConnections;
    return gatewayConnections.filter((item) => (
      item.equipmentId === selectedSnapshot.equipment.id
      || [item.deviceId, item.trackerId, item.imei].includes(selectedTrackerId)
    ));
  }, [gatewayConnections, selectedSnapshot, selectedTrackerId]);

  const { data: gatewayPackets = [] } = useQuery<GsmGatewayPacket[]>({
    queryKey: ['gsmGateway', 'packets', selectedSnapshot?.equipment.id || 'all', selectedTrackerId || 'none'],
    queryFn: () => gsmGatewayService.getPackets({
      equipmentId: selectedSnapshot?.equipment.id || undefined,
      deviceId: selectedTrackerId || undefined,
      limit: 60,
    }).catch(() => []),
    refetchInterval: 5_000,
    staleTime: 3_000,
  });

  const { data: gatewayCommands = [] } = useQuery<GsmGatewayCommand[]>({
    queryKey: ['gsmGateway', 'commands', selectedSnapshot?.equipment.id || 'all', selectedTrackerId || 'none'],
    queryFn: () => gsmGatewayService.getCommands({
      equipmentId: selectedSnapshot?.equipment.id || undefined,
      deviceId: selectedTrackerId || undefined,
      limit: 40,
    }).catch(() => []),
    refetchInterval: 5_000,
    staleTime: 3_000,
  });

  const sendCommandMutation = useMutation({
    mutationFn: gsmGatewayService.sendCommand,
    onSuccess: (result) => {
      toast.success(result.status === 'queued'
        ? 'Команда сохранена в очередь и уйдёт при следующем соединении'
        : 'Команда отправлена на устройство');
      setCommandPayload('');
      queryClient.invalidateQueries({ queryKey: ['gsmGateway'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Не удалось отправить пакет в GPRS канал');
    },
  });

  const bindGsmDeviceMutation = useMutation({
    mutationFn: (form: GsmBindingForm) => {
      const equipmentId = form.equipmentId.trim();
      const gsmImei = form.gsmImei.trim();
      const gsmDeviceId = form.gsmDeviceId.trim();
      const gsmSimNumber = form.gsmSimNumber.trim();
      const gsmProtocol = form.gsmProtocol.trim();

      if (!equipmentId) {
        throw new Error('Выберите технику для привязки GSM-устройства.');
      }
      if (!gsmImei && !gsmDeviceId) {
        throw new Error('Укажите GSM IMEI или Device ID трекера.');
      }

      return equipmentService.update(equipmentId, {
        gsmImei: gsmImei || null,
        gsmDeviceId: gsmDeviceId || null,
        gsmSimNumber: gsmSimNumber || null,
        gsmProtocol: gsmProtocol || null,
      });
    },
    onSuccess: (updated) => {
      toast.success('GSM-устройство привязано к технике');
      setGsmBindingOpen(false);
      setSelectedId(updated.id);
      setRouteEquipmentId(current => current || updated.id);
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      queryClient.invalidateQueries({ queryKey: ['gsmGateway'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Не удалось привязать GSM-устройство');
    },
  });

  const openGsmBinding = React.useCallback((equipmentId?: string) => {
    const selectedEquipment = equipment.find(item => item.id === equipmentId)
      || equipment.find(item => !String(item.gsmImei || '').trim() && !String(item.gsmDeviceId || item.gsmTrackerId || '').trim())
      || equipment[0]
      || null;
    setGsmBindingForm(makeGsmBindingForm(selectedEquipment));
    setGsmBindingOpen(true);
  }, [equipment]);

  const handleGsmBindingEquipmentChange = React.useCallback((equipmentId: string) => {
    setGsmBindingForm(makeGsmBindingForm(equipment.find(item => item.id === equipmentId) || null));
  }, [equipment]);

  const updateGsmBindingForm = React.useCallback((field: keyof GsmBindingForm, value: string) => {
    setGsmBindingForm(current => ({ ...current, [field]: value }));
  }, []);

  const handleSendGprsCommand = React.useCallback(() => {
    if (!canSendGprsCommands) return;
    sendCommandMutation.mutate({
      equipmentId: selectedSnapshot?.equipment.id,
      deviceId: commandDeviceId.trim() || undefined,
      payload: commandPayload,
      encoding: commandEncoding,
      appendNewline,
    });
  }, [
    appendNewline,
    canSendGprsCommands,
    commandDeviceId,
    commandEncoding,
    commandPayload,
    selectedSnapshot,
    sendCommandMutation,
  ]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(163,230,53,0.08),transparent_24%),linear-gradient(180deg,#050816_0%,#09101f_100%)] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/70 shadow-[0_32px_80px_-44px_rgba(15,23,42,0.9)] backdrop-blur-xl">
          <div className="grid gap-6 px-6 py-7 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
            <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
                <MapIcon className="h-3.5 w-3.5" />
                GSM
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Геозоны, уведомления и маршруты техники</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                Раздел показывает текущее положение техники, выезд со склада, прибытие на объект, пропажу сигнала, маршрут за день или неделю,
                а также телеметрию по моточасам, зажиганию и АКБ. Привязка идёт к активной аренде и адресу объекта клиента.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Точек на карте</div>
                <div className="mt-2 text-3xl font-black">{metrics.mapped}</div>
                <div className="mt-1 text-sm text-slate-300">из {metrics.total} единиц техники</div>
              </div>
              <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-emerald-200">Реальный GPS</div>
                <div className="mt-2 text-3xl font-black text-white">{metrics.realGps}</div>
                <div className="mt-1 text-sm text-emerald-100/80">точка пришла от трекера</div>
              </div>
              <div className="rounded-3xl border border-amber-400/20 bg-amber-400/10 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-amber-100">Расчётно по локации</div>
                <div className="mt-2 text-3xl font-black text-white">{metrics.locationDerived}</div>
                <div className="mt-1 text-sm text-amber-100/80">точка достроена по адресу и истории</div>
              </div>
              <div className="rounded-3xl border border-rose-400/20 bg-rose-400/10 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-rose-100">Уведомления</div>
                <div className="mt-2 text-3xl font-black text-white">{metrics.alerts}</div>
                <div className="mt-1 text-sm text-rose-100/80">только для техники с реальным трекером</div>
              </div>
            </div>
          </div>
        </section>

        <Card className="border-white/10 bg-slate-950/70 text-white">
          <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="text-xl font-bold text-white">Фильтры и режим просмотра</CardTitle>
              <CardDescription className="text-slate-400">
                Фильтруйте по сигналу, рабочему статусу техники и поиску по модели, INV, SN, клиенту или адресу объекта.
              </CardDescription>
            </div>
            <div className="w-full max-w-xl">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Поиск по технике, клиенту, адресу объекта или локации"
                  className="h-11 rounded-2xl border-white/10 bg-white/5 pl-10 text-white placeholder:text-slate-500"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'all', label: 'Все сигналы' },
                { value: 'online', label: 'Есть сигнал' },
                { value: 'location_only', label: 'По локации' },
                { value: 'offline', label: 'Нет сигнала' },
              ] as Array<{ value: SignalFilter; label: string }>).map(option => (
                <Button
                  key={option.value}
                  type="button"
                  variant={signalFilter === option.value ? 'default' : 'secondary'}
                  onClick={() => setSignalFilter(option.value)}
                  className={cn(
                    'rounded-full',
                    signalFilter === option.value
                      ? 'bg-lime-300 text-slate-950 hover:bg-lime-200'
                      : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10',
                  )}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {statusFilterOptions.map(option => (
                <Button
                  key={option.value}
                  type="button"
                  variant={statusFilter === option.value ? 'default' : 'secondary'}
                  onClick={() => setStatusFilter(option.value)}
                  className={cn(
                    'rounded-full',
                    statusFilter === option.value
                      ? 'bg-cyan-300 text-slate-950 hover:bg-cyan-200'
                      : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10',
                  )}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={(value) => setTab(value as GsmTab)} className="space-y-4">
          <TabsList className="h-auto rounded-2xl border border-white/10 bg-slate-950/70 p-1">
            <TabsTrigger value="overview" className="rounded-xl px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-slate-950">
              Обзор
            </TabsTrigger>
            <TabsTrigger value="devices" className="rounded-xl px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-slate-950">
              Устройства
            </TabsTrigger>
            <TabsTrigger value="packets" className="rounded-xl px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-slate-950">
              Последние пакеты
            </TabsTrigger>
            <TabsTrigger value="route" className="rounded-xl px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-slate-950">
              Маршрут
            </TabsTrigger>
            <TabsTrigger value="live" className="rounded-xl px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-slate-950">
              Карта и геозоны
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-xl px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-slate-950">
              История и маршрут
            </TabsTrigger>
            <TabsTrigger value="gateway" className="rounded-xl px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-slate-950">
              GPRS канал
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-cyan-300">
                      <Server className="h-5 w-5" />
                    </div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">GPRS-шлюз</div>
                    <div className="mt-2 text-2xl font-black text-white">
                      {formatGatewayState(gatewayStatus)}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">TCP :{gatewayStatus.tcpPort}</div>
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-emerald-300">
                      <Cable className="h-5 w-5" />
                    </div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Подключения</div>
                    <div className="mt-2 text-2xl font-black text-white">{gatewayStatus.connectionsActive}</div>
                    <div className="mt-1 text-sm text-slate-400">активных сейчас</div>
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-cyan-300">
                      <ArrowDownToLine className="h-5 w-5" />
                    </div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Пакетов всего</div>
                    <div className="mt-2 text-2xl font-black text-white">{gatewayStatus.packetsReceivedTotal}</div>
                    <div className="mt-1 text-sm text-slate-400">в журнале {gatewayStatus.packetsStored}</div>
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-amber-300">
                      <Clock3 className="h-5 w-5" />
                    </div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Последний пакет</div>
                    <div className="mt-2 text-sm font-semibold text-white">{formatDateTime(gatewayStatus.lastPacketAt)}</div>
                    <div className="mt-1 text-sm text-slate-400">uptime {gatewayStatus.uptimeSeconds} c</div>
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-lime-300">
                      <Cpu className="h-5 w-5" />
                    </div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Устройства</div>
                    <div className="mt-2 text-2xl font-black text-white">
                      {gsmDevices.filter(item => item.status === 'online').length}/{gsmDevices.length}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">онлайн / всего</div>
                  </CardContent>
                </Card>
              </div>

              {gatewayStatus.startError && (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                  {gatewayStatus.startError}
                </div>
              )}

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-white">Последние входящие пакеты</CardTitle>
                    <CardDescription className="text-slate-400">
                      Сырые пакеты сохраняются до добавления конкретных парсеров протоколов.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {recentGatewayPackets.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                        Пакетов пока нет.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[780px] text-left text-sm">
                          <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
                            <tr>
                              <th className="px-3 py-2">Время</th>
                              <th className="px-3 py-2">IP</th>
                              <th className="px-3 py-2">IMEI / ID</th>
                              <th className="px-3 py-2">Статус</th>
                              <th className="px-3 py-2">Координаты</th>
                              <th className="px-3 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {recentGatewayPackets.slice(0, 8).map(packet => (
                              <tr key={packet.id} className="border-t border-white/10">
                                <td className="px-3 py-2 text-slate-300">{formatDateTime(packetReceivedAt(packet))}</td>
                                <td className="px-3 py-2 text-slate-300">{packetSourceIp(packet)}</td>
                                <td className="px-3 py-2 text-slate-300">{packet.imei || packet.deviceId || '—'}</td>
                                <td className="px-3 py-2">
                                  <Badge variant={getParseStatusBadge(packet.parseStatus)}>{packet.parseStatus || 'pending'}</Badge>
                                </td>
                                <td className="px-3 py-2 text-slate-300">{formatCoordinates(packet.lat, packet.lng)}</td>
                                <td className="px-3 py-2 text-right">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setSelectedPacket(packet)}
                                    className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                                  >
                                    Открыть
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-white">Состояние парка</CardTitle>
                    <CardDescription className="text-slate-400">
                      Учитываются единицы техники с IMEI или Device ID.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(['online', 'offline', 'unknown'] as const).map(status => (
                      <div key={status} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        <span className="text-sm text-slate-300">{formatGsmStatus(status)}</span>
                        <Badge variant={status === 'online' ? 'success' : status === 'offline' ? 'warning' : 'default'}>
                          {gsmDevices.filter(item => item.status === status).length}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="devices">
            <Card className="border-white/10 bg-slate-950/70 text-white">
              <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-xl font-bold text-white">GSM-устройства техники</CardTitle>
                  <CardDescription className="text-slate-400">
                    Привязка выполняется по IMEI или Device ID. Добавить трекер можно прямо здесь.
                  </CardDescription>
                </div>
                {canBindGsmEquipment ? (
                  <Button
                    type="button"
                    onClick={() => openGsmBinding()}
                    className="rounded-full bg-lime-300 text-slate-950 hover:bg-lime-200"
                  >
                    <Plus className="h-4 w-4" />
                    Привязать технику
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                {gsmDevices.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                    <div>Пока нет техники с заполненным GSM IMEI или Device ID.</div>
                    {canBindGsmEquipment ? (
                      <Button
                        type="button"
                        onClick={() => openGsmBinding()}
                        className="mt-4 rounded-full bg-lime-300 text-slate-950 hover:bg-lime-200"
                      >
                        <Plus className="h-4 w-4" />
                        Привязать первое устройство
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1280px] text-left text-sm">
                      <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Техника</th>
                          <th className="px-3 py-2">Модель</th>
                          <th className="px-3 py-2">Серийный номер</th>
                          <th className="px-3 py-2">IMEI</th>
                          <th className="px-3 py-2">SIM</th>
                          <th className="px-3 py-2">Протокол</th>
                          <th className="px-3 py-2">Статус</th>
                          <th className="px-3 py-2">Последняя связь</th>
                          <th className="px-3 py-2">Координаты</th>
                          <th className="px-3 py-2">Скорость</th>
                          <th className="px-3 py-2">Напряжение</th>
                          <th className="px-3 py-2">Моточасы</th>
                          {canBindGsmEquipment ? <th className="px-3 py-2">Действия</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {gsmDevices.map(device => (
                          <tr key={device.equipmentId} className="border-t border-white/10 align-top">
                            <td className="px-3 py-2">
                              <Link to={`/equipment/${device.equipmentId}`} className="font-medium text-cyan-300 hover:text-cyan-200">
                                {device.inventoryNumber || device.equipmentName || device.equipmentId}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-slate-300">{[device.manufacturer, device.model].filter(Boolean).join(' ') || '—'}</td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-300">{device.serialNumber || '—'}</td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-300">{device.imei || '—'}</td>
                            <td className="px-3 py-2 text-slate-300">{device.simNumber || '—'}</td>
                            <td className="px-3 py-2 text-slate-300">{device.protocol || '—'}</td>
                            <td className="px-3 py-2">
                              <Badge variant={device.status === 'online' ? 'success' : device.status === 'offline' ? 'warning' : 'default'}>
                                {formatGsmStatus(device.status)}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-slate-300">{formatDateTime(device.lastSeenAt)}</td>
                            <td className="px-3 py-2 text-slate-300">{formatCoordinates(device.lastLat, device.lastLng)}</td>
                            <td className="px-3 py-2 text-slate-300">{formatSpeed(device.lastSpeed ?? null)}</td>
                            <td className="px-3 py-2 text-slate-300">{formatVoltage(device.lastVoltage ?? null)}</td>
                            <td className="px-3 py-2 text-slate-300">{formatEngineHours(device.lastMotoHours ?? null)}</td>
                            {canBindGsmEquipment ? (
                              <td className="px-3 py-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => openGsmBinding(device.equipmentId)}
                                  className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                                >
                                  Изменить
                                </Button>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="packets">
            <Card className="border-white/10 bg-slate-950/70 text-white">
              <CardHeader>
                <CardTitle className="text-xl font-bold text-white">Последние пакеты GSM/GPRS</CardTitle>
                <CardDescription className="text-slate-400">
                  Компактный журнал rawHex/rawText и результата безопасного fallback-парсинга.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {recentGatewayPackets.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                    Журнал пакетов пуст.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1220px] text-left text-sm">
                      <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Время получения</th>
                          <th className="px-3 py-2">IP</th>
                          <th className="px-3 py-2">IMEI / deviceId</th>
                          <th className="px-3 py-2">Техника</th>
                          <th className="px-3 py-2">Парсинг</th>
                          <th className="px-3 py-2">Координаты</th>
                          <th className="px-3 py-2">rawHex</th>
                          <th className="px-3 py-2">rawText</th>
                          <th className="px-3 py-2">parseError</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentGatewayPackets.map(packet => {
                          const device = packet.equipmentId ? gsmDevices.find(item => item.equipmentId === packet.equipmentId) : null;
                          return (
                            <tr key={packet.id} className="border-t border-white/10 align-top">
                              <td className="px-3 py-2 text-slate-300">{formatDateTime(packetReceivedAt(packet))}</td>
                              <td className="px-3 py-2 text-slate-300">{packetSourceIp(packet)}</td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-300">{packet.imei || packet.deviceId || '—'}</td>
                              <td className="px-3 py-2 text-slate-300">{device?.equipmentName || packet.equipmentLabel || packet.equipmentId || '—'}</td>
                              <td className="px-3 py-2">
                                <Badge variant={getParseStatusBadge(packet.parseStatus)}>{packet.parseStatus || 'pending'}</Badge>
                              </td>
                              <td className="px-3 py-2 text-slate-300">{formatCoordinates(packet.lat, packet.lng)}</td>
                              <td className="max-w-[220px] px-3 py-2 font-mono text-xs text-cyan-200">
                                <span className="block truncate">{packetRawHex(packet)}</span>
                              </td>
                              <td className="max-w-[220px] px-3 py-2 text-slate-300">
                                <span className="block truncate">{packetRawText(packet) || '—'}</span>
                              </td>
                              <td className="max-w-[220px] px-3 py-2 text-rose-300">
                                <span className="block truncate">{packet.parseError || '—'}</span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setSelectedPacket(packet)}
                                  className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                                >
                                  Детали
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="route">
            <div className="space-y-6">
              <Card className="border-white/10 bg-slate-950/70 text-white">
                <CardHeader>
                  <CardTitle className="text-xl font-bold text-white">Маршрут по GSM-пакетам</CardTitle>
                  <CardDescription className="text-slate-400">
                    На первом этапе выводится таблица точек; карту можно подключить отдельной задачей.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
                    <select
                      value={routeEquipmentId}
                      onChange={event => setRouteEquipmentId(event.target.value)}
                      className="h-11 rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-sm text-white"
                    >
                      <option value="">Выберите технику</option>
                      {gsmDevices.map(device => (
                        <option key={device.equipmentId} value={device.equipmentId}>
                          {device.inventoryNumber || device.equipmentName || device.equipmentId}
                        </option>
                      ))}
                    </select>
                    <Input
                      type="date"
                      value={routeFrom}
                      onChange={event => setRouteFrom(event.target.value)}
                      className="h-11 rounded-2xl border-white/10 bg-white/5 text-white"
                    />
                    <Input
                      type="date"
                      value={routeTo}
                      onChange={event => setRouteTo(event.target.value)}
                      className="h-11 rounded-2xl border-white/10 bg-white/5 text-white"
                    />
                  </div>

                  <div className="min-h-[220px] rounded-3xl border border-dashed border-white/10 bg-white/5 p-6">
                    <div className="flex h-full min-h-[170px] items-center justify-center text-center text-sm text-slate-400">
                      Карта маршрута появится после выбора картографической библиотеки. Сейчас источник маршрута — сохранённые точки из `gsm_packets`.
                    </div>
                  </div>

                  {apiRoutePoints.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                      Для выбранного периода точек нет.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-sm">
                        <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Получено</th>
                            <th className="px-3 py-2">Время устройства</th>
                            <th className="px-3 py-2">Координаты</th>
                            <th className="px-3 py-2">Скорость</th>
                            <th className="px-3 py-2">Курс</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apiRoutePoints.map((point, index) => (
                            <tr key={`${point.receivedAt}:${index}`} className="border-t border-white/10">
                              <td className="px-3 py-2 text-slate-300">{formatDateTime(point.receivedAt)}</td>
                              <td className="px-3 py-2 text-slate-300">{formatDateTime(point.deviceTime)}</td>
                              <td className="px-3 py-2 text-slate-300">{formatCoordinates(point.lat, point.lng)}</td>
                              <td className="px-3 py-2 text-slate-300">{formatSpeed(point.speed ?? null)}</td>
                              <td className="px-3 py-2 text-slate-300">{point.course ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="live">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_380px]">
              <Card className="border-white/10 bg-slate-950/70 text-white">
                <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <CardTitle className="text-xl font-bold text-white">Карта расположения техники</CardTitle>
                    <CardDescription className="text-slate-400">
                      Геозона склада и геозона объекта клиента рисуются прямо на карте. Для выбранной техники сверху показывается маршрут за период.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: 'day', label: 'Маршрут за день' },
                      { value: 'week', label: 'Маршрут за неделю' },
                    ] as Array<{ value: RoutePeriod; label: string }>).map(option => (
                      <Button
                        key={option.value}
                        type="button"
                        variant={routePeriod === option.value ? 'default' : 'secondary'}
                        onClick={() => setRoutePeriod(option.value)}
                        className={cn(
                          'rounded-full',
                          routePeriod === option.value
                            ? 'bg-white text-slate-950 hover:bg-slate-100'
                            : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10',
                        )}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <GsmLeafletMap
                    markers={mapMarkers}
                    selectedId={selectedSnapshot?.equipment.id || null}
                    onSelect={setSelectedId}
                    routePoints={selectedRoutePoints}
                    zones={selectedSnapshot?.zones || []}
                  />
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold text-white">Выбранная техника</CardTitle>
                    <CardDescription className="text-slate-400">
                      Сводка по сигналу, телеметрии, аренде и геозонам для текущей единицы.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!selectedSnapshot ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                        По текущим фильтрам техника не найдена.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                          <div className="flex flex-wrap items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-lg font-bold text-white">{buildEquipmentLabel(selectedSnapshot)}</div>
                              <div className="mt-1 text-sm text-slate-400">
                                {selectedSnapshot.equipment.serialNumber || 'Серийный номер не указан'}
                              </div>
                            </div>
                            <Badge variant={SIGNAL_META[selectedSnapshot.signalState].badge}>
                              {SIGNAL_META[selectedSnapshot.signalState].label}
                            </Badge>
                            {getEquipmentStatusBadge(selectedSnapshot.equipment.status)}
                          </div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Локация</div>
                              <div className="mt-1 text-sm font-medium text-white">
                                {selectedSnapshot.point?.address || selectedSnapshot.equipment.location || 'Не указана'}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Последний сигнал</div>
                              <div className="mt-1 text-sm font-medium text-white">
                                {formatRelativeSignal(selectedSnapshot.lastSeenAt)}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">{formatDateTime(selectedSnapshot.lastSeenAt)}</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Источник точки</div>
                              <div className="mt-1 text-sm font-medium text-white">
                                {selectedSnapshot.point?.source === 'gps'
                                  ? 'GPS / трекер'
                                  : selectedSnapshot.point?.source === 'parsed'
                                    ? 'Координаты в карточке'
                                    : selectedSnapshot.point?.source === 'directory'
                                      ? 'Справочник локаций'
                                      : selectedSnapshot.point?.source === 'approximate'
                                        ? 'Приблизительно по локации'
                                        : 'Нет координат'}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Текущий статус</div>
                              <div className="mt-1 text-sm font-medium text-white">
                                {STATUS_LABELS[selectedSnapshot.equipment.status]}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {selectedSnapshot.equipment.currentClient
                                  ? `Клиент: ${selectedSnapshot.equipment.currentClient}`
                                  : 'Без текущего клиента'}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button asChild className="rounded-full bg-lime-300 text-slate-950 hover:bg-lime-200">
                              <Link to={`/equipment/${selectedSnapshot.equipment.id}`}>Открыть карточку техники</Link>
                            </Button>
                            {buildMapLink(selectedSnapshot.point) ? (
                              <Button
                                asChild
                                variant="secondary"
                                className="rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10"
                              >
                                <a href={buildMapLink(selectedSnapshot.point) || '#'} target="_blank" rel="noreferrer">
                                  Внешняя карта
                                  <ArrowUpRight className="h-4 w-4" />
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                            <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-cyan-300">
                              <Gauge className="h-5 w-5" />
                            </div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Моточасы</div>
                            <div className="mt-2 text-xl font-bold text-white">{formatEngineHours(selectedSnapshot.telemetry.engineHours)}</div>
                          </div>
                          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                            <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-amber-300">
                              <Zap className="h-5 w-5" />
                            </div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Зажигание</div>
                            <div className="mt-2 text-xl font-bold text-white">{getIgnitionLabel(selectedSnapshot.telemetry.ignitionOn)}</div>
                          </div>
                          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                            <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-lime-300">
                              <BatteryCharging className="h-5 w-5" />
                            </div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">АКБ</div>
                            <div className="mt-2 text-xl font-bold text-white">{formatVoltage(selectedSnapshot.telemetry.batteryVoltage)}</div>
                          </div>
                          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                            <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sky-300">
                              <Activity className="h-5 w-5" />
                            </div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Скорость</div>
                            <div className="mt-2 text-xl font-bold text-white">{formatSpeed(selectedSnapshot.telemetry.speedKph)}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold text-white">Привязка к аренде и объекту</CardTitle>
                    <CardDescription className="text-slate-400">
                      Показываем, на каком объекте техника должна находиться, и сверяем это с текущей точкой.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!selectedSnapshot?.binding ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
                        Активная привязка к аренде не найдена.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <div className="text-sm font-semibold text-white">{selectedSnapshot.binding.clientName}</div>
                          <div className="mt-1 text-sm text-slate-400">
                            {selectedSnapshot.binding.objectAddress || 'Адрес объекта не указан'}
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Аренда</div>
                              <div className="mt-1 text-sm font-medium text-white">{selectedSnapshot.binding.rentalId}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {selectedSnapshot.binding.startDate || '—'} → {selectedSnapshot.binding.endDate || '—'}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Менеджер</div>
                              <div className="mt-1 text-sm font-medium text-white">{selectedSnapshot.binding.manager || 'Не указан'}</div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {warehouseZone ? (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-white">Геозона склада</div>
                                  <div className="text-xs text-slate-500">{warehouseZone.label}</div>
                                </div>
                                <Badge variant={isPointInsideZone(selectedSnapshot.point, warehouseZone) ? 'success' : 'default'}>
                                  {isPointInsideZone(selectedSnapshot.point, warehouseZone) ? 'Внутри' : 'Вне зоны'}
                                </Badge>
                              </div>
                            </div>
                          ) : null}
                          {jobsiteZone ? (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-white">Геозона объекта</div>
                                  <div className="text-xs text-slate-500">{jobsiteZone.label}</div>
                                </div>
                                <Badge variant={isPointInsideZone(selectedSnapshot.point, jobsiteZone) ? 'warning' : 'default'}>
                                  {isPointInsideZone(selectedSnapshot.point, jobsiteZone) ? 'На объекте' : 'Не на объекте'}
                                </Badge>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold text-white">Уведомления GSM</CardTitle>
                    <CardDescription className="text-slate-400">
                      Выезд со склада, прибытие на объект и пропажа сигнала формируются только для техники с настоящим трекером.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {selectedSnapshot && !selectedSnapshot.hasRealTracker ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
                        У этой техники нет реального GSM-трекера, поэтому уведомления скрыты.
                      </div>
                    ) : notificationFeed.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
                        Активных GSM-уведомлений нет.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {notificationFeed.map((item) => {
                          const Icon = NOTIFICATION_META[item.type].icon;
                          return (
                            <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <div className="flex gap-3">
                                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-2 text-cyan-300">
                                  <Icon className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-semibold text-white">{item.title}</div>
                                    <Badge variant={NOTIFICATION_META[item.type].badge}>{formatDateTime(item.occurredAt)}</Badge>
                                  </div>
                                  <div className="mt-1 text-sm text-slate-300">{item.description}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold text-white">Техника в текущей выборке</CardTitle>
                    <CardDescription className="text-slate-400">
                      {filteredSnapshots.length} единиц. Можно быстро переключаться между точками без выхода из экрана.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                      {filteredSnapshots.map((snapshot) => (
                        <button
                          key={snapshot.equipment.id}
                          type="button"
                          onClick={() => setSelectedId(snapshot.equipment.id)}
                          className={cn(
                            'w-full rounded-2xl border px-4 py-3 text-left transition-colors',
                            selectedSnapshot?.equipment.id === snapshot.equipment.id
                              ? 'border-cyan-300/50 bg-cyan-400/10'
                              : 'border-white/10 bg-white/5 hover:bg-white/10',
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className="mt-1 h-3.5 w-3.5 rounded-full"
                              style={{ backgroundColor: SIGNAL_META[snapshot.signalState].markerColor }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold text-white">{buildEquipmentLabel(snapshot)}</div>
                              <div className="mt-1 truncate text-xs text-slate-400">
                                {snapshot.binding?.clientName ? `${snapshot.binding.clientName} · ` : ''}
                                {snapshot.point?.address || snapshot.equipment.location || 'Локация не указана'}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-xs font-medium text-slate-200">{SIGNAL_META[snapshot.signalState].label}</div>
                              <div className="mt-1 text-[11px] text-slate-500">{formatRelativeSignal(snapshot.lastSeenAt)}</div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_420px]">
              <Card className="border-white/10 bg-slate-950/70 text-white">
                <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <CardTitle className="text-xl font-bold text-white">Маршрут за период</CardTitle>
                    <CardDescription className="text-slate-400">
                      {selectedSnapshot
                        ? `Точки маршрута по ${buildEquipmentLabel(selectedSnapshot)}.`
                        : 'Сначала выберите технику в живой карте.'}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: 'day', label: 'День' },
                      { value: 'week', label: 'Неделя' },
                    ] as Array<{ value: RoutePeriod; label: string }>).map(option => (
                      <Button
                        key={option.value}
                        type="button"
                        variant={routePeriod === option.value ? 'default' : 'secondary'}
                        onClick={() => setRoutePeriod(option.value)}
                        className={cn(
                          'rounded-full',
                          routePeriod === option.value
                            ? 'bg-cyan-300 text-slate-950 hover:bg-cyan-200'
                            : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10',
                        )}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  {!selectedSnapshot ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                      Выберите технику на вкладке «Карта и геозоны», чтобы увидеть маршрут.
                    </div>
                  ) : selectedRoutePoints.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                      За выбранный период точек маршрута нет.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedRoutePoints.map((point, index) => (
                        <div key={`${point.at}:${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <div className="flex gap-3">
                            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-2 text-cyan-300">
                              <Route className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold text-white">{point.label}</div>
                                <span className="text-xs text-slate-500">{formatDateTime(point.at)}</span>
                              </div>
                              <div className="mt-1 text-sm text-slate-300">{point.address}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-slate-950/70 text-white">
                <CardHeader>
                  <CardTitle className="text-xl font-bold text-white">История передвижений техники</CardTitle>
                  <CardDescription className="text-slate-400">
                    {selectedSnapshot
                      ? `Показываются события только по ${buildEquipmentLabel(selectedSnapshot)}.`
                      : 'Показываются последние события по текущей фильтрации GSM.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {movementFeed.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                      История перемещений пока пустая.
                    </div>
                  ) : (
                    <div className="max-h-[920px] space-y-3 overflow-y-auto pr-1">
                      {movementFeed.map((entry) => {
                        const Icon = getMovementIcon(entry.kind);
                        const equipmentSnapshot = snapshots.find(item => item.equipment.id === entry.equipmentId);
                        return (
                          <div key={entry.id} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                            <div className="flex gap-4">
                              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-cyan-300">
                                <Icon className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="font-semibold text-white">{entry.title}</div>
                                  <span className="text-xs text-slate-500">{formatDateTime(entry.occurredAt)}</span>
                                  {equipmentSnapshot ? (
                                    <Badge variant={SIGNAL_META[equipmentSnapshot.signalState].badge}>
                                      {SIGNAL_META[equipmentSnapshot.signalState].label}
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="mt-2 text-sm text-slate-300">{entry.description || 'Без комментария'}</div>
                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                  <span>{entry.location}</span>
                                  {equipmentSnapshot ? (
                                    <Link
                                      to={`/equipment/${entry.equipmentId}`}
                                      className="inline-flex items-center gap-1 text-cyan-300 transition-colors hover:text-cyan-200"
                                    >
                                      {buildEquipmentLabel(equipmentSnapshot)}
                                      <ArrowUpRight className="h-3.5 w-3.5" />
                                    </Link>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="gateway">
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-cyan-300">
                      <Server className="h-5 w-5" />
                    </div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Шлюз GPRS</div>
                    <div className="mt-2 text-2xl font-black text-white">
                      {formatGatewayState(gatewayStatus)}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      {gatewayStatus.host}:{gatewayStatus.port}
                    </div>
                    {gatewayStatus.startError ? (
                      <div className="mt-2 text-xs text-rose-300">{gatewayStatus.startError}</div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-500">Запущен: {formatDateTime(gatewayStatus.startedAt)}</div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-emerald-300">
                      <Cable className="h-5 w-5" />
                    </div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Онлайн соединения</div>
                    <div className="mt-2 text-2xl font-black text-white">{gatewayStatus.onlineConnections}</div>
                    <div className="mt-1 text-sm text-slate-400">{gatewayStatus.onlineDevices} устройств на линии</div>
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-cyan-300">
                      <ArrowDownToLine className="h-5 w-5" />
                    </div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Пакеты за сегодня</div>
                    <div className="mt-2 text-2xl font-black text-white">{gatewayStatus.packetsToday}</div>
                    <div className="mt-1 text-sm text-slate-400">в журнале всего {gatewayStatus.packetsStored}</div>
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-amber-300">
                      <ArrowUpToLine className="h-5 w-5" />
                    </div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Команды</div>
                    <div className="mt-2 text-2xl font-black text-white">{gatewayStatus.sentToday}</div>
                    <div className="mt-1 text-sm text-slate-400">
                      очередь {gatewayStatus.queuedCommands} · ошибок {gatewayStatus.failedCommands}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-white/10 bg-slate-950/70 text-white">
                <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle className="text-xl font-bold text-white">Данные GSM</CardTitle>
                    <CardDescription className="text-slate-400">
                      Сводка по привязке трекеров, свежести сигналов, неопознанным пакетам, протоколам и доставке команд.
                    </CardDescription>
                  </div>
                  <Badge variant={gatewayAnalytics.unknownPackets24h > 0 || gatewayAnalytics.staleTrackers > 0 ? 'warning' : 'success'}>
                    {gatewayAnalytics.unknownPackets24h > 0 || gatewayAnalytics.staleTrackers > 0 ? 'Есть что проверить' : 'Данные в норме'}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-cyan-300">
                        <Cpu className="h-5 w-5" />
                      </div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Привязано трекеров</div>
                      <div className="mt-2 text-2xl font-black text-white">{gatewayAnalytics.configuredTrackers}</div>
                      <div className="mt-1 text-sm text-slate-400">
                        {formatPercent(gatewayAnalytics.configuredTrackers, gatewayAnalytics.trackedEquipment)} от парка
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-emerald-300">
                        <Cable className="h-5 w-5" />
                      </div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Онлайн сейчас</div>
                      <div className="mt-2 text-2xl font-black text-white">{gatewayAnalytics.onlineTrackedEquipment}</div>
                      <div className="mt-1 text-sm text-slate-400">из {gatewayAnalytics.configuredTrackers} привязанных</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-amber-300">
                        <Clock3 className="h-5 w-5" />
                      </div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Без свежего сигнала</div>
                      <div className="mt-2 text-2xl font-black text-white">{gatewayAnalytics.staleTrackers}</div>
                      <div className="mt-1 text-sm text-slate-400">нет пакета за 24 часа</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-rose-300">
                        <AlertTriangle className="h-5 w-5" />
                      </div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Неопознано за 24ч</div>
                      <div className="mt-2 text-2xl font-black text-white">{gatewayAnalytics.unknownPackets24h}</div>
                      <div className="mt-1 text-sm text-slate-400">пакеты без техники</div>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Выбранная техника</div>
                          <div className="mt-1 text-lg font-bold text-white">
                            {selectedSnapshot ? buildEquipmentLabel(selectedSnapshot) : 'Не выбрана'}
                          </div>
                        </div>
                        <Badge variant={gatewayAnalytics.selected.packets24h > 0 ? 'info' : 'default'}>
                          {gatewayAnalytics.selected.packets24h} пакетов за 24ч
                        </Badge>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Вход / выход</div>
                          <div className="mt-1 text-sm font-medium text-white">
                            {gatewayAnalytics.selected.inbound24h} / {gatewayAnalytics.selected.outbound24h}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Последний протокол</div>
                          <div className="mt-1 text-sm font-medium text-white">{gatewayAnalytics.selected.lastProtocol || '—'}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Последний пакет</div>
                          <div className="mt-1 text-sm font-medium text-white">{formatDateTime(gatewayAnalytics.selected.lastPacketAt)}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Последняя команда</div>
                          <div className="mt-1 text-sm font-medium text-white">
                            {formatCommandStatus(gatewayAnalytics.selected.lastCommandStatus)}
                          </div>
                        </div>
                      </div>

                      {gatewayAnalytics.selected.lastSummary ? (
                        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-300">
                          {gatewayAnalytics.selected.lastSummary}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                        <History className="h-4 w-4 text-cyan-300" />
                        Протоколы за 24ч
                      </div>
                      {gatewayAnalytics.protocols.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/60 px-4 py-6 text-center text-sm text-slate-400">
                          Пакетов за последние 24 часа нет.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {gatewayAnalytics.protocols.map(item => (
                            <div key={item.protocol} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-white">{item.protocol}</div>
                                <div className="text-xs text-slate-500">{formatDateTime(item.lastPacketAt)}</div>
                              </div>
                              <Badge variant="info">{item.count}</Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-white">Отправка пакета на устройство</CardTitle>
                    <CardDescription className="text-slate-400">
                      Для выбранной техники можно отправить текстовую команду или HEX-пакет. Если устройство не в сети, команда встанет в очередь.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!selectedSnapshot ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                        Сначала выберите технику по текущим фильтрам, чтобы привязать команду к конкретному трекеру.
                      </div>
                    ) : (
                      <>
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-lg font-semibold text-white">{buildEquipmentLabel(selectedSnapshot)}</div>
                              <div className="mt-1 text-sm text-slate-400">
                                Трекер: {selectedTrackerId || 'не привязан в карточке техники'}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Последний пакет: {formatDateTime(gatewayStatus.lastPacketAt)}
                              </div>
                            </div>
                            <Badge variant={selectedGatewayConnections.length > 0 ? 'success' : 'default'}>
                              {selectedGatewayConnections.length > 0 ? 'Устройство онлайн' : 'Устройство офлайн'}
                            </Badge>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Device ID / IMEI
                            </label>
                            <Input
                              value={commandDeviceId}
                              onChange={(event) => setCommandDeviceId(event.target.value)}
                              placeholder="IMEI или deviceId трекера"
                              className="h-11 rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Формат пакета
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {([
                                { value: 'text', label: 'Текст' },
                                { value: 'hex', label: 'HEX' },
                              ] as Array<{ value: GsmCommandEncoding; label: string }>).map(option => (
                                <Button
                                  key={option.value}
                                  type="button"
                                  variant={commandEncoding === option.value ? 'default' : 'secondary'}
                                  onClick={() => setCommandEncoding(option.value)}
                                  className={cn(
                                    'rounded-full',
                                    commandEncoding === option.value
                                      ? 'bg-lime-300 text-slate-950 hover:bg-lime-200'
                                      : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10',
                                  )}
                                >
                                  {option.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Пакет команды
                          </label>
                          <Textarea
                            value={commandPayload}
                            onChange={(event) => setCommandPayload(event.target.value)}
                            placeholder={commandEncoding === 'hex'
                              ? 'Например: 78780D0101234567890123450D0A'
                              : 'Например: engine=off;relay=1'}
                            className="min-h-[140px] rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                          />
                          <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                            <input
                              type="checkbox"
                              checked={appendNewline}
                              onChange={(event) => setAppendNewline(event.target.checked)}
                              className="h-4 w-4 rounded border-white/20 bg-slate-950/70"
                            />
                            Добавлять перевод строки в текстовую команду
                          </label>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            onClick={handleSendGprsCommand}
                            disabled={!canSendGprsCommands || !commandPayload.trim() || sendCommandMutation.isPending}
                            className="rounded-full bg-lime-300 text-slate-950 hover:bg-lime-200"
                          >
                            <SendHorizontal className="h-4 w-4" />
                            {sendCommandMutation.isPending ? 'Отправляем...' : 'Отправить пакет'}
                          </Button>
                          {!canSendGprsCommands && (
                            <span className="text-sm text-slate-500">
                              Отправка доступна только администратору и офис-менеджеру.
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-white">Онлайн-соединения трекеров</CardTitle>
                    <CardDescription className="text-slate-400">
                      Активные GPRS/TCP соединения с сервером. Если техника выбрана, список сужается под неё.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {selectedGatewayConnections.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                        Активных соединений по текущей технике нет.
                      </div>
                    ) : (
                      <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                        {selectedGatewayConnections.map((connection) => (
                          <div key={connection.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white">
                                  {connection.equipmentLabel || connection.deviceId || connection.imei || 'Неопознанное устройство'}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {connection.remoteAddress}:{connection.remotePort || '—'}
                                </div>
                              </div>
                              <Badge variant={connection.isOnline ? 'success' : 'default'}>
                                {connection.isOnline ? 'Онлайн' : 'Отключено'}
                              </Badge>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Последний пакет</div>
                                <div className="mt-1 text-white">{formatDateTime(connection.lastSeenAt)}</div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Трафик</div>
                                <div className="mt-1 text-white">
                                  {connection.packetsReceived} пак. · {formatBytes(connection.bytesReceived)}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_420px]">
                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-white">Последние пакеты GPRS</CardTitle>
                    <CardDescription className="text-slate-400">
                      Входящие и исходящие сообщения по текущей технике. Для бинарных пакетов сохраняется HEX.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {gatewayPackets.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                        Пакетов по текущей выборке пока нет.
                      </div>
                    ) : (
                      <div className="max-h-[760px] space-y-3 overflow-y-auto pr-1">
                        {gatewayPackets.map((packet) => (
                          <div key={packet.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={packet.direction === 'inbound' ? 'info' : 'warning'}>
                                    {packet.direction === 'inbound' ? 'Входящий' : 'Исходящий'}
                                  </Badge>
                                  <span className="text-xs text-slate-500">{formatDateTime(packet.createdAt)}</span>
                                </div>
                                <div className="mt-2 text-sm font-semibold text-white">
                                  {packet.summary || packet.equipmentLabel || packet.deviceId || 'Пакет'}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {packet.deviceId || packet.imei || 'Устройство не опознано'} · {packet.protocol || 'raw'}
                                </div>
                              </div>
                              <div className="text-right text-xs text-slate-500">
                                <div>{packet.remoteAddress || '—'}</div>
                                <div>{packet.remotePort || '—'}</div>
                              </div>
                            </div>

                            <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Текст пакета</div>
                              <div className="mt-2 whitespace-pre-wrap break-all text-sm text-slate-200">
                                {compactPayloadText(packet)}
                              </div>
                            </div>

                            <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">HEX</div>
                              <div className="mt-2 break-all font-mono text-xs text-cyan-200">
                                {packet.payloadHex || '—'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-slate-950/70 text-white">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-white">Очередь и история команд</CardTitle>
                    <CardDescription className="text-slate-400">
                      Здесь видно, ушла ли команда сразу, встала в очередь или вернулась с ошибкой.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {gatewayCommands.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                        По текущей технике команды ещё не отправлялись.
                      </div>
                    ) : (
                      <div className="max-h-[760px] space-y-3 overflow-y-auto pr-1">
                        {gatewayCommands.map((command) => (
                          <div key={command.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white">
                                  {command.equipmentLabel || command.deviceId || command.imei || 'Команда'}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {command.createdBy || 'Оператор'} · {formatDateTime(command.createdAt)}
                                </div>
                              </div>
                              <Badge
                                variant={
                                  command.status === 'sent'
                                    ? 'success'
                                    : command.status === 'acknowledged'
                                      ? 'success'
                                    : command.status === 'failed'
                                      ? 'danger'
                                      : 'warning'
                                }
                              >
                                {command.status === 'sent' ? 'Отправлено' : command.status === 'acknowledged' ? 'Подтверждено' : command.status === 'failed' ? 'Ошибка' : 'В очереди'}
                              </Badge>
                            </div>

                            <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200">
                              {compactPayloadText(command)}
                            </div>

                            <div className="mt-3 space-y-1 text-xs text-slate-500">
                              <div>Формат: {command.encoding === 'hex' ? 'HEX' : 'Текст'}{command.appendNewline ? ' · с переводом строки' : ''}</div>
                              {command.sentAt && <div>Отправлено: {formatDateTime(command.sentAt)}</div>}
                              {command.error && <div className="text-rose-300">Ошибка: {command.error}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <Sheet open={gsmBindingOpen} onOpenChange={setGsmBindingOpen}>
          <SheetContent side="right" className="w-full overflow-y-auto border-white/10 bg-slate-950 text-white sm:max-w-xl">
            <SheetHeader className="border-b border-white/10 px-6 py-5 pr-12">
              <SheetTitle className="flex items-center gap-2 text-xl text-white">
                <Cable className="h-5 w-5 text-cyan-300" />
                Привязать GSM-устройство
              </SheetTitle>
              <SheetDescription className="text-slate-400">
                Выберите технику и заполните IMEI или Device ID трекера. После сохранения техника появится в списке GSM-устройств.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-6 py-5">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-200">Техника</span>
                <select
                  value={gsmBindingForm.equipmentId}
                  onChange={event => handleGsmBindingEquipmentChange(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-sm text-white outline-none focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
                >
                  <option value="">Выберите технику</option>
                  {equipmentOptions.map(item => (
                    <option key={item.id} value={item.id}>
                      {buildEquipmentOptionLabel(item)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">GSM IMEI</span>
                  <Input
                    value={gsmBindingForm.gsmImei}
                    onChange={event => updateGsmBindingForm('gsmImei', event.target.value)}
                    placeholder="866123456789012"
                    className="h-11 rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">Device ID</span>
                  <Input
                    value={gsmBindingForm.gsmDeviceId}
                    onChange={event => updateGsmBindingForm('gsmDeviceId', event.target.value)}
                    placeholder="TRACKER-001"
                    className="h-11 rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">SIM-карта</span>
                  <Input
                    value={gsmBindingForm.gsmSimNumber}
                    onChange={event => updateGsmBindingForm('gsmSimNumber', event.target.value)}
                    placeholder="+7 999 000-00-00"
                    className="h-11 rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">Протокол</span>
                  <Input
                    value={gsmBindingForm.gsmProtocol}
                    onChange={event => updateGsmBindingForm('gsmProtocol', event.target.value)}
                    placeholder="GT06 / Teltonika / Wialon IPS"
                    className="h-11 rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm leading-6 text-cyan-50">
                Для автоматической привязки входящих пакетов достаточно, чтобы IMEI или Device ID в карточке техники совпадал с тем,
                что передаёт трекер в GPRS-пакете.
              </div>
            </div>

            <SheetFooter className="border-t border-white/10 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setGsmBindingOpen(false)}
                className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={() => bindGsmDeviceMutation.mutate(gsmBindingForm)}
                disabled={bindGsmDeviceMutation.isPending}
                className="bg-lime-300 text-slate-950 hover:bg-lime-200"
              >
                {bindGsmDeviceMutation.isPending ? 'Сохраняем...' : 'Сохранить привязку'}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {selectedPacket && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
            <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-slate-950 p-6 text-white shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">GSM packet</div>
                  <h2 className="mt-1 text-xl font-bold">Детали пакета</h2>
                  <p className="mt-1 text-sm text-slate-400">{formatDateTime(packetReceivedAt(selectedPacket))}</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setSelectedPacket(null)}
                  className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                >
                  Закрыть
                </Button>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">IP</div>
                  <div className="mt-1 text-sm text-white">{packetSourceIp(selectedPacket)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Порт</div>
                  <div className="mt-1 text-sm text-white">{selectedPacket.remotePort || '—'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">IMEI / Device ID</div>
                  <div className="mt-1 text-sm text-white">{selectedPacket.imei || selectedPacket.deviceId || '—'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Статус парсинга</div>
                  <div className="mt-1">
                    <Badge variant={getParseStatusBadge(selectedPacket.parseStatus)}>{selectedPacket.parseStatus || 'pending'}</Badge>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">rawHex</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950/70 p-3 font-mono text-xs text-cyan-200">
                    {packetRawHex(selectedPacket) || '—'}
                  </pre>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">rawText</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950/70 p-3 text-sm text-slate-200">
                    {packetRawText(selectedPacket) || '—'}
                  </pre>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">parsed</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950/70 p-3 font-mono text-xs text-lime-200">
                    {JSON.stringify(selectedPacket.parsed || selectedPacket.parsedPayload || null, null, 2)}
                  </pre>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">parseError</div>
                  <div className="text-sm text-rose-300">{selectedPacket.parseError || '—'}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
