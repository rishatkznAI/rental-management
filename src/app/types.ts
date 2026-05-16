// Типы данных для системы управления арендой подъёмных платформ

import type { PhotoReference } from './lib/media';
export type { PhotoReference } from './lib/media';

export type EquipmentStatus = 'available' | 'rented' | 'reserved' | 'in_service' | 'inactive';
export type EquipmentType = string;
export type EquipmentDrive = 'diesel' | 'electric';
export type EquipmentOwnerType = 'own' | 'investor' | 'sublease';
export type EquipmentCategory = 'own' | 'sold' | 'client' | 'partner';
export type EquipmentPriority = 'low' | 'medium' | 'high' | 'critical';
export type EquipmentSaleCondition = 'new' | 'used';
export type EquipmentSalePdiStatus = 'not_started' | 'in_progress' | 'issues' | 'ready';
export type EquipmentSaleReceiptStatus =
  | 'planned_arrival'
  | 'arrived_waiting_acceptance'
  | 'acceptance_in_progress'
  | 'accepted'
  | 'acceptance_rejected'
  | 'cancelled';
export type RepairEventType = 'repair' | 'maintenance' | 'diagnostics' | 'breakdown';
export type RepairSource = 'manual' | 'bot';
export type ShippingEventType = 'shipping' | 'receiving';
export type EquipmentGsmSignalState = 'online' | 'location_only' | 'offline';
export type EquipmentGsmStatus = 'online' | 'offline' | 'unknown';
export type EquipmentGsmPointSource = 'gps' | 'parsed' | 'directory' | 'approximate';
export type EquipmentOperationPhotoCategory =
  | 'front'
  | 'rear'
  | 'side_1'
  | 'side_2'
  | 'plate'
  | 'hours_photo'
  | 'control_panel'
  | 'basket'
  | 'engine_bay'
  | 'damage_photo';

export type EquipmentHandoffChecklistKey =
  | 'exterior'
  | 'controlPanel'
  | 'batteryCharge'
  | 'basket'
  | 'tires'
  | 'leaksAndDamage';

export interface EquipmentHandoffChecklist {
  exterior: boolean;
  controlPanel: boolean;
  batteryCharge: boolean;
  basket: boolean;
  tires: boolean;
  leaksAndDamage: boolean;
}

export type EquipmentAcceptancePhotoKey =
  | 'front'
  | 'rear'
  | 'left'
  | 'right'
  | 'serial_plate'
  | 'hour_meter'
  | 'lower_controls'
  | 'upper_controls'
  | 'platform'
  | 'engine_bay'
  | 'undercarriage'
  | 'defects';

export interface EquipmentAcceptanceChecklist {
  serialNumberConfirmed?: boolean | string;
  modelConfirmed?: boolean | string;
  configurationChecked?: boolean | string;
  documentsReceived?: boolean | string;
  keysRemoteChargerSpareReceived?: 'yes' | 'no' | 'na' | string;
  visualDamageFound?: boolean | string;
  starts?: boolean | string;
  serviceRequired?: boolean | string;
  mechanicComment?: string;
}

export interface EquipmentReceiptHistoryEntry {
  date: string;
  oldStatus?: string;
  newStatus?: string;
  oldStatusLabel?: string;
  newStatusLabel?: string;
  userId?: string;
  userName?: string;
  comment?: string;
}

export interface EquipmentGsmPositionPoint {
  at: string;
  lat: number;
  lng: number;
  source: EquipmentGsmPointSource;
  address?: string;
  speedKph?: number;
}

export interface AuditEntry {
  date: string;
  text: string;
  author: string;
  type?: 'system' | 'comment';
}

export interface Equipment {
  id: string;
  inventoryNumber: string;
  manufacturer: string;
  model: string;
  type: EquipmentType;
  drive: EquipmentDrive;
  serialNumber: string;
  year: number;
  hours: number;
  liftHeight: number;
  workingHeight?: number;
  loadCapacity?: number;
  dimensions?: string;
  weight?: number;
  location: string;
  status: EquipmentStatus;
  owner: EquipmentOwnerType;
  ownerId?: string;
  ownerName?: string;
  category: EquipmentCategory;
  priority: EquipmentPriority;
  activeInFleet: boolean;
  subleasePrice?: number;
  plannedMonthlyRevenue: number;
  isForSale?: boolean;
  forSale?: boolean;
  saleMode?: boolean;
  saleStatus?: string;
  salesStatus?: string;
  saleCondition?: EquipmentSaleCondition;
  saleType?: EquipmentSaleCondition;
  salePdiStatus?: EquipmentSalePdiStatus;
  saleReceiptStatus?: EquipmentSaleReceiptStatus;
  plannedArrivalDate?: string;
  actualArrivalDate?: string;
  acceptedAt?: string;
  acceptedByUserId?: string;
  acceptedByName?: string;
  acceptanceComment?: string;
  acceptancePhotos?: Partial<Record<EquipmentAcceptancePhotoKey, PhotoReference[]>>;
  acceptanceChecklist?: EquipmentAcceptanceChecklist;
  acceptanceDefects?: string[];
  receiptHistory?: EquipmentReceiptHistoryEntry[];
  salePrice1?: number;
  salePrice2?: number;
  salePrice3?: number;
  nextMaintenance: string;
  maintenanceCHTO?: string;
  maintenancePTO?: string;
  maintenanceEngineFilter?: string;
  maintenanceFuelFilter?: string;
  maintenanceHydraulicFilter?: string;
  notes?: string;
  currentClient?: string;
  returnDate?: string;
  photo?: PhotoReference;
  gsmTrackerId?: string;
  gsmImei?: string | null;
  gsmDeviceId?: string | null;
  gsmProtocol?: string | null;
  gsmSimNumber?: string | null;
  gsmLastSeenAt?: string | null;
  gsmLastLat?: number | null;
  gsmLastLng?: number | null;
  gsmLastSpeed?: number | null;
  gsmLastVoltage?: number | null;
  gsmLastMotoHours?: number | null;
  gsmStatus?: EquipmentGsmStatus;
  gsmLatitude?: number;
  gsmLongitude?: number;
  gsmAddress?: string;
  gsmLastSignalAt?: string;
  gsmSignalStatus?: EquipmentGsmSignalState;
  gsmIgnitionOn?: boolean;
  gsmBatteryVoltage?: number;
  gsmHourmeter?: number;
  gsmSpeedKph?: number;
  gsmMovementHistory?: EquipmentGsmPositionPoint[];
  history?: AuditEntry[];
}

export type GsmPacketDirection = 'inbound' | 'outbound';
export type GsmPacketParseStatus = 'pending' | 'parsed' | 'failed';
export type GsmCommandStatus = 'queued' | 'sent' | 'acknowledged' | 'failed';

export interface GsmGatewayStatus {
  gatewayEnabled: boolean;
  tcpPort: number;
  uptimeSeconds: number;
  connectionsActive: number;
  packetsReceivedTotal: number;
  enabled: boolean;
  host: string;
  port: number;
  disabled?: boolean;
  startedAt?: string | null;
  startError?: string;
  onlineConnections: number;
  onlineDevices: number;
  packetsStored: number;
  packetsToday: number;
  queuedCommands: number;
  sentToday: number;
  failedCommands: number;
  lastPacketAt?: string | null;
}

export interface GsmGatewayCommandStatusSummary {
  total: number;
  queued: number;
  sent: number;
  acknowledged?: number;
  failed: number;
}

export interface GsmGatewayProtocolStat {
  protocol: string;
  count: number;
  lastPacketAt?: string | null;
}

export interface GsmGatewaySelectedAnalytics {
  equipmentId?: string | null;
  deviceId?: string | null;
  packets24h: number;
  inbound24h: number;
  outbound24h: number;
  lastPacketAt?: string | null;
  lastProtocol?: string | null;
  lastSummary?: string | null;
  commandStatus: GsmGatewayCommandStatusSummary;
  lastCommandAt?: string | null;
  lastCommandStatus?: GsmCommandStatus | null;
}

export interface GsmGatewayAnalytics {
  trackedEquipment: number;
  configuredTrackers: number;
  onlineTrackedEquipment: number;
  staleTrackers: number;
  unknownPackets24h: number;
  packets24h: number;
  inbound24h: number;
  outbound24h: number;
  commandStatus: GsmGatewayCommandStatusSummary;
  protocols: GsmGatewayProtocolStat[];
  selected: GsmGatewaySelectedAnalytics;
}

export interface GsmGatewayConnection {
  id: string;
  deviceId?: string | null;
  trackerId?: string | null;
  imei?: string | null;
  equipmentId?: string | null;
  equipmentLabel?: string | null;
  remoteAddress?: string | null;
  remotePort?: number | null;
  connectedAt: string;
  lastSeenAt: string;
  packetsReceived: number;
  bytesReceived: number;
  isOnline: boolean;
}

export interface GsmGatewayPacket {
  id: string;
  sourceIp?: string | null;
  remotePort?: number | null;
  receivedAt?: string;
  rawHex?: string;
  rawText?: string | null;
  protocol?: string | null;
  parseStatus?: GsmPacketParseStatus;
  parseError?: string | null;
  deviceId?: string | null;
  trackerId?: string | null;
  imei?: string | null;
  equipmentId?: string | null;
  deviceTime?: string | null;
  lat?: number | null;
  lng?: number | null;
  speed?: number | null;
  course?: number | null;
  satellites?: number | null;
  gsmSignal?: number | null;
  voltage?: number | null;
  motoHours?: number | null;
  alarmType?: string | null;
  parsed?: Record<string, unknown> | null;
  direction: GsmPacketDirection;
  equipmentLabel?: string | null;
  connectionId?: string | null;
  remoteAddress?: string | null;
  payload?: string | null;
  payloadHex: string;
  encoding: 'text' | 'hex';
  summary?: string | null;
  parsedPayload?: Record<string, unknown> | null;
  createdAt: string;
  createdBy?: string | null;
}

export interface GsmGatewayCommand {
  id: string;
  equipmentId?: string | null;
  equipmentLabel?: string | null;
  deviceId?: string | null;
  trackerId?: string | null;
  imei?: string | null;
  command?: string;
  payload: string | Record<string, unknown>;
  encoding: 'text' | 'hex';
  appendNewline: boolean;
  status: GsmCommandStatus;
  createdAt: string;
  createdBy?: string | null;
  sentAt?: string | null;
  ackAt?: string | null;
  failedAt?: string | null;
  error?: string | null;
  connectionId?: string | null;
  remoteAddress?: string | null;
  remotePort?: number | null;
}

export interface GsmGatewayDevice {
  id: string;
  equipmentId: string;
  equipmentName?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  inventoryNumber?: string | null;
  imei?: string | null;
  deviceId?: string | null;
  simNumber?: string | null;
  protocol?: string | null;
  status: EquipmentGsmStatus;
  lastSeenAt?: string | null;
  lastLat?: number | null;
  lastLng?: number | null;
  lastSpeed?: number | null;
  lastVoltage?: number | null;
  lastMotoHours?: number | null;
}

export interface GsmGatewayRoutePoint {
  receivedAt: string;
  deviceTime?: string | null;
  lat: number;
  lng: number;
  speed?: number | null;
  course?: number | null;
}

export interface RepairRecord {
  id: string;
  equipmentId: string;
  date: string;
  type: RepairEventType;
  description: string;
  comment?: string;
  mechanic: string;
  status: 'completed' | 'in_progress' | 'planned';
  cost?: number;
  totalNormHours?: number;
  source: RepairSource;
}

export interface ShippingPhoto {
  id: string;
  equipmentId: string;
  serialNumber?: string;
  date: string;
  type: ShippingEventType;
  uploadedBy: string;
  photos: PhotoReference[];
  comment?: string;
  rentalId?: string;
  source: RepairSource;
  photoCategories?: Partial<Record<EquipmentOperationPhotoCategory, PhotoReference[]>>;
  hoursValue?: number;
  damageDescription?: string;
  operationSessionId?: string;
  checklist?: EquipmentHandoffChecklist;
  signedBy?: string;
  signedAt?: string;
  signatureDataUrl?: string;
}

export type RentalStatus = 'new' | 'confirmed' | 'delivery' | 'active' | 'return_planned' | 'closed';

export interface RentalDowntimePeriod {
  id: string;
  rentalId?: string;
  ganttRentalId?: string;
  clientId?: string;
  equipmentId?: string;
  equipmentInv?: string;
  serialNumber?: string;
  startDate: string;
  endDate: string;
  reason: string;
  comment?: string;
  affectsBilling?: boolean;
  status?: 'active' | 'closed' | 'cancelled';
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Rental {
  id: string;
  clientId?: string;
  objectId?: string;
  contractId?: string;
  client: string;
  contact: string;
  startDate: string;
  plannedReturnDate: string;
  actualReturnDate?: string;
  equipment: string[];
  rate: string;
  price: number;
  discount: number;
  deliveryAddress: string;
  deliveryTime?: string;
  manager: string;
  status: RentalStatus;
  risk?: string;
  downtimeDays?: number;
  downtimeReason?: string;
  downtimeStartDate?: string;
  downtimeEndDate?: string;
  downtimeComment?: string;
  downtimeStatus?: 'active' | 'closed' | 'cancelled';
  downtimeAffectsBilling?: boolean;
  downtimeBillableDays?: number;
  billableDays?: number;
  activeRentalDays?: number;
  downtimePeriods?: RentalDowntimePeriod[];
  documents?: string[];
  comments?: string;
  history?: AuditEntry[];
}

export type RentalChangeRequestStatus = 'pending' | 'approved' | 'rejected';
export type RentalChangeEntityType = 'rental' | 'payment' | 'document';

export interface RentalChangeRequestFinancialImpact {
  amount: number;
  description: string;
}

export interface RentalChangeRequest {
  id: string;
  entityType: RentalChangeEntityType;
  entityId?: string;
  rentalId: string;
  sourceRentalId?: string;
  linkedGanttRentalId?: string;
  clientId?: string;
  client: string;
  clientName?: string;
  equipment: string[];
  rentalNumber?: string;
  equipmentName?: string;
  equipmentInventoryNumber?: string;
  equipmentSerialNumber?: string;
  typeLabel?: string;
  createdBy?: string;
  createdByName?: string;
  oldStartDate?: unknown;
  oldEndDate?: unknown;
  oldPlannedReturnDate?: unknown;
  newStartDate?: unknown;
  newEndDate?: unknown;
  newPlannedReturnDate?: unknown;
  requestedBy?: string;
  initiatorId: string;
  initiatorName: string;
  initiatorRole: string;
  createdAt: string;
  status: RentalChangeRequestStatus;
  statusLabel?: string;
  operation?: 'update' | 'delete';
  type: string;
  field: string;
  fieldLabel: string;
  oldValue: unknown;
  newValue: unknown;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changes?: Array<{
    field: string;
    label?: string;
    oldValue: unknown;
    newValue: unknown;
    type?: string;
    reason?: string;
  }>;
  reason: string;
  systemReason?: string;
  comment?: string;
  attachments?: string[];
  financialImpact?: RentalChangeRequestFinancialImpact;
  decidedAt?: string;
  appliedAt?: string;
  decidedById?: string;
  decidedByName?: string;
  adminComment?: string;
  rejectionReason?: string;
}

export type ServicePriority = 'low' | 'medium' | 'high' | 'critical';
export type ServiceStatus = 'new' | 'in_progress' | 'waiting_parts' | 'needs_revision' | 'ready' | 'closed';
export type ServiceScenario = 'repair' | 'to' | 'chto' | 'pto';
export type WarrantyClaimStatus =
  | 'draft'
  | 'sent_to_factory'
  | 'factory_review'
  | 'answer_received'
  | 'approved'
  | 'rejected'
  | 'parts_shipping'
  | 'closed';
export type ReferenceStatus = 'active' | 'inactive';

export interface Mechanic {
  id: string;
  name: string;
  userId?: string;
  email?: string;
  role?: string;
  type?: string;
  phone?: string;
  notes?: string;
  status: ReferenceStatus;
}

export interface ServiceWork {
  id: string;
  name: string;
  category?: string;
  equipmentType?: string;
  driveType?: string;
  defaultNormHours?: number;
  defaultMechanicRate?: number;
  fixedAmount?: number;
  payType?: 'hourly_norm' | 'fixed' | 'no_pay';
  description?: string;
  comment?: string;
  normHours: number;
  ratePerHour: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SparePart {
  id: string;
  name: string;
  article?: string;
  sku?: string;
  unit: string;
  defaultPrice: number;
  category?: string;
  manufacturer?: string;
  supplier?: string;
  comment?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepairWorkItem {
  id: string;
  repairId: string;
  serviceTicketId?: string;
  workId: string;
  workCatalogId?: string;
  quantity: number;
  normHoursSnapshot: number;
  ratePerHourSnapshot: number;
  fixedAmountSnapshot?: number;
  nameSnapshot: string;
  workNameSnapshot?: string;
  categorySnapshot?: string;
  mechanicId?: string;
  mechanicNameSnapshot?: string;
  equipmentInv?: string;
  serialNumber?: string;
  modelSnapshot?: string;
  equipmentType?: string;
  performedAt?: string;
  completedAt?: string;
  normHours?: number;
  rate?: number;
  fixedAmount?: number;
  amount?: number;
  payType?: 'hourly_norm' | 'fixed' | 'no_pay';
  status?: 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'rejected';
  source?: 'manual' | 'bot' | 'admin' | 'import' | 'legacy';
  comment?: string;
  createdAt: string;
  createdByUserId?: string;
  createdByUserName?: string;
  meterHours?: number;
  equipmentId?: string;
  equipmentSnapshot?: string;
}

export interface RepairPartItem {
  id: string;
  repairId: string;
  partId: string;
  quantity: number;
  priceSnapshot: number;
  nameSnapshot: string;
  articleSnapshot?: string;
  unitSnapshot: string;
  createdAt: string;
  createdByUserId?: string;
  createdByUserName?: string;
}

export interface ServiceWorkLogEntry {
  date: string;
  text: string;
  author: string;
  type?: 'comment' | 'status_change' | 'assign' | 'repair_result';
}

export interface ServicePartUsage {
  catalogId?: string;
  name: string;
  sku?: string;
  qty: number;
  cost: number;
}

export interface ServiceWorkPerformed {
  catalogId: string;
  name: string;
  normHours: number;
  qty: number;
  totalNormHours: number;
  ratePerHour: number;
  totalCost: number;
  meterHours?: number;
  equipmentId?: string;
  equipmentSnapshot?: string;
  createdAt?: string;
  createdByUserName?: string;
}

export interface ServiceRepairResult {
  summary?: string;
  partsUsed: ServicePartUsage[];
  worksPerformed: ServiceWorkPerformed[];
}

export interface ServiceRepairPhotos {
  before: string[];
  after: string[];
  beforeUploadedAt?: string;
  beforeUploadedBy?: string;
  afterUploadedAt?: string;
  afterUploadedBy?: string;
}

export interface ServiceCloseChecklist {
  faultEliminated: boolean;
  worksRecorded: boolean;
  partsRecordedOrNotRequired: boolean;
  beforePhotosAttached: boolean;
  afterPhotosAttached: boolean;
  summaryFilled: boolean;
}

export interface ServiceRevisionHistoryEntry {
  id: string;
  createdAt: string;
  createdBy?: string;
  createdByName?: string;
  assignedMechanicId?: string;
  mechanicName?: string;
  previousStatus?: ServiceStatus | string;
  reason: string;
  checklist?: string[];
  details?: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolvedByName?: string | null;
  resolutionComment?: string;
}

export type ServiceWorkCatalogItem = ServiceWork;
export type SparePartCatalogItem = SparePart;

export interface ServiceTicket {
  id: string;
  equipmentId: string;
  equipment: string;
  serviceKind?: ServiceScenario;
  type?: string;
  scenario?: string;
  saleMode?: boolean;
  pdiData?: Record<string, unknown>;
  inventoryNumber?: string;
  serialNumber?: string;
  equipmentType?: string;
  equipmentTypeLabel?: string;
  location?: string;
  reason: string;
  description: string;
  priority: ServicePriority;
  sla: string;
  assignedTo?: string;
  assignedMechanicId?: string;
  assignedMechanicName?: string;
  createdBy?: string;
  clientId?: string;
  client?: string;
  clientName?: string;
  rentalId?: string;
  objectId?: string;
  contractId?: string;
  objectName?: string;
  objectAddress?: string;
  objectContactName?: string;
  objectContactPhone?: string;
  contractNumber?: string;
  createdByUserId?: string;
  createdByUserName?: string;
  reporterContact?: string;
  source?: 'manual' | 'bot' | 'manager' | 'system' | 'sales';
  status: ServiceStatus;
  plannedDate?: string;
  scheduledDate?: string;
  dueDate?: string;
  deadline?: string;
  targetDate?: string;
  completedAt?: string;
  mechanicId?: string;
  assignedUserId?: string;
  responsibleUserId?: string;
  closedAt?: string;
  result?: string;
  resultData?: ServiceRepairResult;
  repairPhotos?: ServiceRepairPhotos;
  closeChecklist?: ServiceCloseChecklist;
  revisionHistory?: ServiceRevisionHistoryEntry[];
  revisionReason?: string;
  revisionDetails?: string;
  revisionChecklist?: string[];
  revisionReturnedAt?: string;
  revisionReturnedBy?: string;
  revisionReturnedByName?: string;
  revisionPreviousStatus?: ServiceStatus | string;
  revisionResolvedAt?: string;
  revisionResolvedBy?: string;
  revisionResolvedByName?: string;
  revisionResolutionComment?: string;
  workLog: ServiceWorkLogEntry[];
  parts: ServicePartUsage[];
  createdAt: string;
  photos?: PhotoReference[];
  serviceVehicleId?: string | null;   // Служебная машина, используемая в выезде
}

export interface WarrantyClaimHistoryEntry {
  date: string;
  text: string;
  author: string;
  type?: 'comment' | 'status_change' | 'factory_response' | 'document';
}

export interface WarrantyClaim {
  id: string;
  number?: string;
  serviceTicketId?: string;
  equipmentId?: string;
  clientId?: string;
  client?: string;
  clientName?: string;
  rentalId?: string;
  equipmentLabel: string;
  inventoryNumber?: string;
  serialNumber?: string;
  manufacturer?: string;
  factoryName: string;
  factoryContact?: string;
  factoryCaseNumber?: string;
  reason?: string;
  failureDescription: string;
  requestedResolution: string;
  status: WarrantyClaimStatus | string;
  priority: ServicePriority;
  responseDueDate?: string;
  deadline?: string;
  sentAt?: string;
  factoryResponse?: string;
  decision?: string;
  result?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt?: string;
  responsible?: string;
  responsibleUserId?: string;
  responsibleUserName?: string;
  createdByUserId?: string;
  createdByUserName?: string;
  history?: WarrantyClaimHistoryEntry[];
}

export interface ServiceRouteNorm {
  id: string;
  from: string;
  to: string;
  distanceKm: number;
  normSpeedKmh: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ServiceFieldTripStatus = 'started' | 'arrived' | 'completed' | 'cancelled';

export interface ServiceFieldTrip {
  id: string;
  serviceTicketId: string;
  mechanicId?: string | null;
  mechanicName: string;
  serviceVehicleId?: string | null;
  routeNormId?: string | null;
  routeFrom: string;
  routeTo: string;
  distanceKm: number;
  normSpeedKmh: number;
  closedNormHours: number;
  status: ServiceFieldTripStatus;
  startedAt: string;
  arrivedAt?: string | null;
  completedAt?: string | null;
  comment?: string | null;
  source?: 'bot' | 'manual' | 'system';
  equipmentId?: string | null;
  equipmentLabel?: string | null;
  inventoryNumber?: string | null;
  createdAt: string;
  createdByUserId?: string | null;
  createdByUserName?: string | null;
}

export type ClientStatus = 'active' | 'inactive' | 'blocked' | 'new';

export interface ClientContactPerson {
  id?: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  comment?: string;
}

export interface Client {
  id: string;
  company: string;
  inn: string;
  innNormalized?: string;
  kpp?: string;
  ogrn?: string;
  clientType?: 'legal' | 'individual_entrepreneur' | 'individual' | string;
  verified?: boolean;
  contact: string;
  phone: string;
  email: string;
  contacts?: ClientContactPerson[];
  address?: string;
  legalAddress?: string;
  actualAddress?: string;
  paymentTerms: string;
  creditLimit: number;
  debt: number;
  lastRentalDate?: string;
  totalRentals: number;
  manager?: string;
  managerRole?: string;
  managerAvatar?: string;
  status?: ClientStatus;
  notes?: string;
  partnerCardFileName?: string;
  partnerCardMimeType?: string;
  partnerCardDataUrl?: string;
  partnerCardUploadedAt?: string;
  partnerCardUploadedBy?: string;
  createdAt?: string;
  createdBy?: string;
  history?: AuditEntry[];
}

export interface ClientObject {
  id: string;
  clientId: string;
  name: string;
  address: string;
  contactName?: string;
  contactPhone?: string;
  contractId?: string;
  contractNumber?: string;
  notes?: string;
  status: 'active' | 'archived';
  createdAt?: string;
  updatedAt?: string;
}

export interface ClientContract {
  id: string;
  clientId: string;
  objectId?: string;
  number: string;
  date?: string;
  title?: string;
  status: 'active' | 'archived';
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type DocumentType =
  | 'contract'
  | 'commercial_offer'
  | 'act'
  | 'upd'
  | 'invoice'
  | 'service_act'
  | 'work_order'
  | 'debt_notification'
  | 'pretrial_claim'
  | 'court_document'
  | 'court_decision'
  | 'enforcement_writ'
  | 'other';
export type DocumentStatus = 'draft' | 'signed' | 'sent';
export type DocumentContractKind = 'rental' | 'supply';

export interface DocumentHistoryEntry {
  id: string;
  action: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  comment?: string;
  createdBy?: string;
  createdByUserId?: string;
  createdAt: string;
}

export interface DocumentRegistrySummary {
  total: number;
  withoutNumber: number;
  duplicateNumbers: number;
  unsigned: number;
  signed: number;
  currentMonth: number;
  duplicates?: Array<{ id: string; number: string; type: DocumentType; year: number }>;
  invalidNumbers?: Array<{ id: string; number: string; type: DocumentType; year: number }>;
}

export interface DocumentNumberingSetting {
  documentType: DocumentType;
  prefix: string;
  year: number;
  nextNumber: number;
  padding: number;
  resetPeriod: 'yearly' | 'never';
  isActive: boolean;
}

export interface Document {
  id: string;
  type: DocumentType;
  documentType?: DocumentType;
  contractKind?: DocumentContractKind;
  number: string;
  documentNumber?: string;
  clientId?: string;
  objectId?: string;
  contractId?: string;
  client: string;
  date: string;
  documentDate?: string;
  amount?: number;
  rentalBillingSnapshot?: {
    source?: string;
    rentalId?: string;
    generatedAt?: string;
    totalCalendarDays?: number;
    downtimeDays?: number;
    billingDowntimeDays?: number;
    nonBillingDowntimeDays?: number;
    billableDays?: number;
    activeRentalDays?: number;
    dailyRate?: number;
    grossRentalAmount?: number;
    downtimeAdjustmentAmount?: number;
    finalRentalAmount?: number;
    downtimePeriods?: Array<{
      id?: string;
      startDate?: string;
      endDate?: string;
      reason?: string;
      comment?: string;
      affectsBilling?: boolean;
      status?: string;
      days?: number;
    }>;
  };
  billingSnapshot?: Document['rentalBillingSnapshot'];
  status: DocumentStatus;
  signatoryName?: string;
  signatoryBasis?: string;
  rentalId?: string;
  rental?: string;
  equipmentId?: string;
  equipmentInv?: string;
  equipment?: string;
  serviceTicketId?: string;
  serviceTicket?: string;
  manager?: string;
  createdAt?: string;
  createdBy?: string;
  createdByUserId?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedByUserId?: string;
  contentHtml?: string;
  fileName?: string;
  fileUrl?: string;
  signedScanDataUrl?: string;
  signedScanFileName?: string;
  signedScanMimeType?: string;
  sentAt?: string;
  sentBy?: string;
  signedAt?: string;
  signedBy?: string;
  comment?: string;
  attachments?: unknown[];
  history?: DocumentHistoryEntry[];
}

export interface MechanicDocument {
  id: string;
  mechanicId: string;
  mechanicName: string;
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  uploadedBy?: string;
  dataUrl: string;
}

export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'partial';

export interface Payment {
  id: string;
  invoiceNumber: string;
  rentalId?: string;       // link to GanttRental id
  clientId?: string;
  objectId?: string;
  contractId?: string;
  client: string;
  amount: number;          // total amount due
  paidAmount?: number;     // amount actually paid (for partial)
  dueDate: string;
  paidDate?: string;
  status: PaymentStatus;
  comment?: string;
}

export interface PaymentAllocation {
  id: string;
  paymentId: string;
  clientId?: string;
  objectId?: string;
  contractId?: string;
  rentalId?: string;
  documentId?: string;
  managerId?: string;
  periodStart?: string;
  periodEnd?: string;
  amount: number;
  status?: string;
  source?: 'manual' | 'auto_suggested' | 'imported' | 'legacy_backfill' | string;
  comment?: string;
}

export type CompanyExpenseFrequency = 'monthly' | 'quarterly' | 'yearly';
export type CompanyExpenseStatus = 'active' | 'paused' | 'archived';

export interface CompanyExpense {
  id: string;
  name: string;
  category: string;
  amount: number;
  frequency: CompanyExpenseFrequency;
  paymentDay?: number;
  nextPaymentDate?: string;
  counterparty?: string;
  account?: string;
  status: CompanyExpenseStatus;
  comment?: string;
  customFields?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

export type FinanceOperationType = 'income' | 'expense' | 'transfer';
export type FinanceOperationStatus = 'active' | 'archived';
export type FinanceOperationSource = 'manual' | 'payments' | 'expenses' | 'leasing';
export type FinanceAccountType = 'bank_account' | 'cash' | 'card' | 'deposit' | 'other';
export type FinanceAccountStatus = 'active' | 'archived';

export interface FinanceOperation {
  id: string;
  type: FinanceOperationType;
  date: string;
  amount: number;
  category: string;
  description?: string;
  counterparty?: string;
  account?: string;
  accountFrom?: string;
  accountTo?: string;
  relatedEntityType?: 'rental' | 'client' | 'document' | 'equipment' | 'leasing' | 'other' | '';
  relatedEntityId?: string;
  relatedEntityLabel?: string;
  status: FinanceOperationStatus;
  comment?: string;
  source?: FinanceOperationSource;
  createdAt?: string;
  createdBy?: string;
  createdByUserId?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedByUserId?: string;
}

export interface FinanceAccount {
  id: string;
  name: string;
  type: FinanceAccountType;
  currency: string;
  balance: number;
  actualAt: string;
  comment?: string;
  status: FinanceAccountStatus;
  createdAt?: string;
  createdBy?: string;
  createdByUserId?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedByUserId?: string;
}

export type LeasingContractStatus = 'active' | 'closed' | 'paused' | 'overdue' | 'archived';
export type LeasingPaymentStatus = 'planned' | 'paid' | 'overdue' | 'skipped';

export interface LeasingPaymentScheduleItem {
  id: string;
  leasingContractId: string;
  dueDate: string;
  amount: number;
  status: LeasingPaymentStatus;
  paidDate?: string;
  paidAmount?: number;
  comment?: string;
  outstanding?: number;
  daysUntilDue?: number;
  overdueDays?: number;
}

export interface LeasingContract {
  id: string;
  contractNumber: string;
  leasingCompany: string;
  equipmentId?: string;
  equipmentName?: string;
  startDate: string;
  endDate: string;
  termMonths: number;
  monthlyPayment: number;
  paymentDay: number;
  status: LeasingContractStatus;
  initialPayment?: number;
  buyoutPayment?: number;
  totalAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  interestRate?: number;
  comment?: string;
  responsibleUserId?: string;
  paymentSource?: string;
  nextPaymentDate?: string;
  lastPaymentDate?: string;
  createdAt: string;
  updatedAt: string;
  schedule?: LeasingPaymentScheduleItem[];
  nextPayment?: LeasingPaymentScheduleItem | null;
  remainingPayments?: number;
  overduePayments?: number;
  overdueAmount?: number;
}

export interface LeasingSummary {
  contracts: LeasingContract[];
  activeContracts: number;
  pausedContracts?: number;
  currentMonthAmount: number;
  nextMonthAmount: number;
  overdueAmount: number;
  overdueContracts: number;
  remainingAmount: number;
  averageMonthlyLoad: number;
}

export type DebtCollectionPlanStatus =
  | 'new'
  | 'contacted'
  | 'promised'
  | 'partial_paid'
  | 'disputed'
  | 'escalation'
  | 'legal'
  | 'closed';

export type DebtCollectionNextActionType =
  | 'call'
  | 'message'
  | 'email'
  | 'documents'
  | 'restrict_equipment'
  | 'claim'
  | 'meeting'
  | 'wait_payment'
  | 'other';

export type DebtCollectionPlanPriority = 'low' | 'medium' | 'high' | 'critical';

export interface DebtCollectionPlan {
  id: string;
  clientId?: string;
  clientName: string;
  responsibleUserId?: string;
  responsibleName?: string;
  status: DebtCollectionPlanStatus;
  priority: DebtCollectionPlanPriority;
  lastContactDate?: string;
  promisedPaymentDate?: string;
  nextActionDate?: string;
  nextActionType: DebtCollectionNextActionType;
  comment?: string;
  result?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

export type ReceivableCollectionStatus =
  | 'new'
  | 'in_work'
  | 'promised'
  | 'payment_plan'
  | 'overdue_promise'
  | 'escalated'
  | 'closed'
  | 'disputed';

export type ReceivableCollectionStage =
  | 'new_debt'
  | 'notification_draft'
  | 'notification_sent'
  | 'notification_waiting'
  | 'pretrial_claim_draft'
  | 'pretrial_claim_sent'
  | 'pretrial_waiting'
  | 'court_preparing'
  | 'court_scheduled'
  | 'court_stage_1'
  | 'court_stage_2'
  | 'court_stage_3'
  | 'court_decision_received'
  | 'writ_received'
  | 'enforcement_sent'
  | 'enforcement_in_progress'
  | 'recovered'
  | 'closed'
  | 'written_off'
  | 'disputed';

export type ReceivableActionType =
  | 'call'
  | 'message'
  | 'email'
  | 'meeting'
  | 'legal_notice'
  | 'payment_promise'
  | 'payment_plan'
  | 'escalation'
  | 'generate_notification'
  | 'send_notification'
  | 'generate_pretrial_claim'
  | 'send_pretrial_claim'
  | 'court_preparing'
  | 'schedule_court'
  | 'court_stage_update'
  | 'court_decision'
  | 'receive_writ'
  | 'send_to_enforcement'
  | 'enforcement_update'
  | 'debt_recovered'
  | 'write_off'
  | 'comment';

export type ReceivableActionStatus = 'planned' | 'done' | 'missed' | 'cancelled';
export type ReceivablePaymentPlanStatus = 'planned' | 'paid' | 'missed' | 'cancelled';

export interface ReceivableCollectionAction {
  id: string;
  clientId?: string;
  rentalId?: string;
  paymentId?: string;
  documentId?: string;
  managerId?: string;
  responsibleUserId?: string;
  actionType: ReceivableActionType;
  status: ReceivableActionStatus;
  fromStage?: ReceivableCollectionStage;
  toStage?: ReceivableCollectionStage;
  actionDate: string;
  dueDate?: string;
  nextActionDate?: string;
  promisedPaymentDate?: string;
  promisedAmount?: number;
  sendMethod?: 'email' | 'messenger' | 'paper' | 'courier' | 'other';
  sentTo?: string;
  attachmentUrl?: string;
  fileUrl?: string;
  courtName?: string;
  caseNumber?: string;
  claimAmount?: number;
  courtDate?: string;
  nextCourtDate?: string;
  courtStageComment?: string;
  decisionDate?: string;
  decisionAmount?: number;
  decisionStatus?: 'won' | 'partially_won' | 'lost' | 'postponed' | 'settlement' | 'unknown';
  writNumber?: string;
  writDate?: string;
  writAmount?: number;
  receivedBy?: string;
  enforcementSentDate?: string;
  bailiffDepartment?: string;
  enforcementNumber?: string;
  enforcementStatus?: string;
  recoveredAmount?: number;
  remainingAmount?: number;
  nextControlDate?: string;
  override?: boolean;
  comment?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface ReceivablePaymentPlanItem {
  id: string;
  clientId?: string;
  rentalId?: string;
  paymentDate: string;
  amount: number;
  status: ReceivablePaymentPlanStatus;
  comment?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface ReceivableRentalBreakdown {
  rentalId: string;
  equipmentInv: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  outstanding: number;
  overdueDays: number;
  status: string;
}

export interface ReceivablePaymentBreakdown {
  id: string;
  rentalId?: string;
  invoiceNumber?: string;
  amount: number;
  paidAmount: number;
  dueDate?: string;
  paidDate?: string;
  status?: string;
  comment?: string;
}

export interface ReceivableDocumentRef {
  id?: string;
  type?: string;
  number?: string;
  date?: string;
  amount?: number;
  status?: string;
  rentalId?: string;
  rental?: string;
}

export interface ReceivableRow {
  clientId?: string;
  client: string;
  inn?: string;
  contacts?: {
    contact?: string;
    phone?: string;
    email?: string;
    address?: string;
  };
  manager: string;
  totalDebt: number;
  overdueDebt: number;
  oldestOverdueDays: number;
  rentals: ReceivableRentalBreakdown[];
  payments: ReceivablePaymentBreakdown[];
  documents: ReceivableDocumentRef[];
  actions: ReceivableCollectionAction[];
  paymentPlans: ReceivablePaymentPlanItem[];
  lastContactDate?: string;
  nextActionDate?: string;
  nextActionType?: ReceivableActionType | '';
  collectionStatus: ReceivableCollectionStatus;
  collectionStage?: ReceivableCollectionStage;
  lastWorkflowActionDate?: string;
  notificationSentDate?: string;
  notificationDueDate?: string;
  pretrialClaimSentDate?: string;
  pretrialClaimDueDate?: string;
  courtDate?: string;
  nextCourtDate?: string;
  caseNumber?: string;
  writNumber?: string;
  writDate?: string;
  enforcementNumber?: string;
  recoveredAmount?: number;
  remainingAmount?: number;
  promisedPaymentDate?: string;
  promisedAmount?: number;
  comment?: string;
  hasPaymentPlan?: boolean;
  noNextAction?: boolean;
  missedActions?: number;
  missedPlanPayments?: number;
}

export interface ReceivablesSummary {
  totalDebt: number;
  overdueDebt: number;
  age0_7: number;
  age8_30: number;
  age31_60: number;
  age60Plus: number;
  clientsWithDebt: number;
  withoutNextAction: number;
  promisedAmount: number;
  paymentPlanAmount: number;
  withoutNotification?: number;
  notificationOverdue?: number;
  pretrialOverdue?: number;
  courtNext7Days?: number;
  overdueNextAction?: number;
  writNotEnforced?: number;
  enforcementStale?: number;
}

export interface ReceivablesResponse {
  rows: ReceivableRow[];
  summary: ReceivablesSummary;
}

export interface ManagerBreakdownPayment {
  id: string;
  invoiceNumber: string;
  amount: number;
  paidAmount: number;
  dueDate: string;
  paidDate?: string;
  status: PaymentStatus;
  comment?: string;
}

export interface ManagerBreakdownRental {
  rentalId: string;
  client: string;
  equipmentInv: string;
  startDate: string;
  endDate: string;
  amount: number;
  status: 'created' | 'active' | 'returned' | 'closed';
}

export interface ManagerBreakdownDebtRow {
  rentalId: string;
  client: string;
  equipmentInv: string;
  startDate: string;
  endDate: string;
  expectedPaymentDate?: string;
  amount: number;
  paidAmount: number;
  outstanding: number;
  paymentStatus: 'paid' | 'unpaid' | 'partial';
  rentalStatus: 'created' | 'active' | 'returned' | 'closed';
  overdueDays: number;
  payments: ManagerBreakdownPayment[];
}

export interface ManagerBreakdownDocument {
  id: string;
  type: DocumentType;
  number: string;
  client: string;
  date: string;
  amount?: number;
  status: DocumentStatus;
  rental?: string;
}

export interface ManagerBreakdownResponse {
  summary: {
    name: string;
    activeRentals: number;
    monthRentals: number;
    monthRevenue: number;
    currentDebt: number;
    overdueDebt: number;
    returnsSoon: number;
    unsignedDocs: number;
  };
  monthRevenueRentals: ManagerBreakdownRental[];
  currentDebtRows: ManagerBreakdownDebtRow[];
  overdueDebtRows: ManagerBreakdownDebtRow[];
  returnsSoonRentals: ManagerBreakdownRental[];
  unsignedDocuments: ManagerBreakdownDocument[];
}

// ── CRM ───────────────────────────────────────────────────────────────────────

export type CrmPipelineType = 'rental' | 'sales';
export type CrmDealStatus = 'open' | 'won' | 'lost';
export type CrmDealPriority = 'low' | 'medium' | 'high';
export type CrmDealStage =
  | 'lead'
  | 'qualified'
  | 'proposal'
  | 'negotiation'
  | 'reserved'
  | 'demo'
  | 'invoice'
  | 'won'
  | 'lost';

export interface CrmDeal {
  id: string;
  pipeline: CrmPipelineType;
  title: string;
  stage: CrmDealStage;
  status: CrmDealStatus;
  priority: CrmDealPriority;
  company: string;
  clientId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  source?: string | null;
  budget?: number;
  probability?: number;
  equipmentNeed?: string | null;
  location?: string | null;
  expectedCloseDate?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  responsibleUserId?: string | null;
  responsibleUserName?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  history?: AuditEntry[];
}

// ── База знаний ──────────────────────────────────────────────────────────────

export type KnowledgeBaseAudience = 'rental' | 'sales' | 'all';
export type KnowledgeBaseProgressStatus = 'not_started' | 'in_progress' | 'passed' | 'failed';
export type KnowledgeBaseSectionId = 'manager_training' | 'equipment_review' | 'scripts_standards' | 'regulations';

export interface KnowledgeBaseQuestionOption {
  id: string;
  text: string;
}

export interface KnowledgeBaseQuestion {
  id: string;
  question: string;
  options: KnowledgeBaseQuestionOption[];
  correctOptionId: string;
  explanation?: string;
}

export interface KnowledgeBaseModule {
  id: string;
  title: string;
  section?: KnowledgeBaseSectionId;
  category: string;
  audience: KnowledgeBaseAudience;
  description: string;
  videoUrl?: string;
  videoDurationMin?: number;
  passingScorePercent: number;
  sortOrder: number;
  isActive: boolean;
  quiz: KnowledgeBaseQuestion[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseProgress {
  id: string;
  moduleId: string;
  userId: string;
  userName: string;
  userRole: string;
  status: KnowledgeBaseProgressStatus;
  watchedVideo: boolean;
  watchedAt?: string | null;
  score: number;
  maxScore: number;
  attemptsCount: number;
  lastAttemptAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface AppSetting {
  id: string;
  key: string;
  value: unknown;
  createdAt: string;
  updatedAt: string;
}

// ── Зарплата ─────────────────────────────────────────────────────────────────

export type PayrollKpiSchemeType =
  | 'none'
  | 'manual'
  | 'rental_manager'
  | 'sales_manager'
  | 'service_mechanic'
  | 'office_manager'
  | 'custom';

export type PayrollPeriodStatus = 'draft' | 'calculated' | 'approved' | 'paid' | 'closed';
export type PayrollRecordStatus = 'draft' | 'approved' | 'paid';
export type PayrollAdjustmentType = 'bonus' | 'deduction' | 'advance' | 'compensation' | 'manual_kpi';

export interface PayrollProfile {
  id: string;
  userId: string;
  employeeName: string;
  role: string;
  baseSalary: number;
  currency: 'RUB';
  kpiSchemeType: PayrollKpiSchemeType;
  kpiPercent?: number;
  kpiFixedAmount?: number;
  kpiDescription?: string;
  isActive: boolean;
  startedAt?: string;
  endedAt?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollPeriod {
  id: string;
  month: string;
  status: PayrollPeriodStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  paidAt?: string;
  closedAt?: string;
  notes?: string;
}

export interface PayrollCalculationDetail {
  label: string;
  amount: number;
  type: 'base' | 'kpi' | 'bonus' | 'deduction' | 'advance' | 'compensation' | 'info';
  comment?: string;
}

export interface PayrollRecord {
  id: string;
  periodId: string;
  month: string;
  userId: string;
  employeeName: string;
  role: string;
  baseSalary: number;
  kpiSchemeType: PayrollKpiSchemeType | string;
  kpiPercent?: number;
  kpiBaseAmount?: number;
  kpiAmount: number;
  bonusAmount: number;
  deductionAmount: number;
  advanceAmount: number;
  compensationAmount: number;
  grossAmount: number;
  netAmount: number;
  calculationDetails: PayrollCalculationDetail[];
  status: PayrollRecordStatus;
  adminComment?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  paidAt?: string;
}

export interface PayrollAdjustment {
  id: string;
  payrollRecordId: string;
  type: PayrollAdjustmentType;
  amount: number;
  reason: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  month?: string;
  employeeName?: string;
  userId?: string;
}

export interface PayrollAuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  before: unknown | null;
  after: unknown | null;
  reason?: string;
  createdAt: string;
}

export interface PayrollKpiSettings {
  rentalManager: {
    percentFromProfitWithoutVat: number;
    paidOnly: boolean;
    closedRentalsOnly: boolean;
    minimumPlan: number;
    manualBaseAmount: number;
    comment: string;
  };
  salesManager: {
    percentFromMargin: number;
    fixedBonusPerSoldEquipment: number;
    paidSalesOnly: boolean;
    manualMarginAmount: number;
    soldEquipmentCount: number;
    comment: string;
  };
  serviceMechanic: {
    bonusPerClosedTicket: number;
    bonusPerFieldTrip: number;
    manualBonus: number;
    manualClosedTickets: number;
    manualFieldTrips: number;
    comment: string;
  };
  officeManager: {
    fixedBonus: number;
    manualBonus: number;
    comment: string;
  };
  customSchemes: Array<{
    id: string;
    name: string;
    description?: string;
    manualBaseAmount?: number;
    percent?: number;
    fixedBonus?: number;
    isActive: boolean;
  }>;
}

// ── Боты ──────────────────────────────────────────────────────────────────────

export type BotStatus = 'online' | 'offline';
export type BotActivityType = 'session_started' | 'authorization' | 'command' | 'message' | 'callback';
export type BotConnectionRole =
  | 'Администратор'
  | 'Офис-менеджер'
  | 'Менеджер по аренде'
  | 'Менеджер по продажам'
  | 'Руководитель'
  | 'Механик'
  | 'Младший стационарный механик'
  | 'Выездной механик'
  | 'Старший стационарный механик'
  | 'Перевозчик';

export interface BotReplyTarget {
  chat_id?: number | null;
  user_id?: number | null;
}

export interface BotConnection {
  id: string;
  botId: string;
  phone: string;
  maxUserId: number | null;
  userId: string | null;
  userName: string | null;
  userRole: BotConnectionRole | string | null;
  role?: string | null;
  carrierId?: string | null;
  isActive?: boolean;
  email: string | null;
  replyTarget: BotReplyTarget | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
  pendingAction: string | null;
  pendingActionLabel: string | null;
  activeRepairId: string | null;
  sessionUpdatedAt: string | null;
}

export interface BotActivityEntry {
  id: string;
  botId: string;
  phone: string | null;
  maxUserId: number | null;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  role?: string | null;
  carrierId?: string | null;
  deliveryId?: string | null;
  oldStatus?: string | null;
  newStatus?: string | null;
  timestamp?: string | null;
  email: string | null;
  eventType: BotActivityType;
  action: string;
  details: string | null;
  createdAt: string | null;
}

export interface BotSummary {
  id: string;
  name: string;
  provider: string;
  description: string;
  status: BotStatus;
  webhookConfigured: boolean;
  totalConnections: number;
  pendingConnections: number;
  totalActivity: number;
  activity24h: number;
  lastActivityAt: string | null;
  connectionsPreview: BotConnection[];
  recentActivity: BotActivityEntry[];
}

export interface BotDetailResponse {
  bot: BotSummary;
  connections: BotConnection[];
  activity: BotActivityEntry[];
}

export interface BotConnectionMutationResponse {
  ok: boolean;
  connection?: BotConnection | null;
}

// ── Доставка ──────────────────────────────────────────────────────────────────

export type DeliveryType = 'shipping' | 'receiving';
export type DeliveryStatus = 'new' | 'sent' | 'accepted' | 'in_transit' | 'completed' | 'cancelled';

export interface Delivery {
  id: string;
  type: DeliveryType;
  status: DeliveryStatus;
  transportDate: string;
  pickupTime?: string | null;
  neededBy?: string | null;
  origin: string;
  destination: string;
  cargo: string;
  contactName: string;
  contactPhone: string;
  cost: number;
  comment?: string;
  client: string;
  clientId?: string | null;
  objectId?: string | null;
  contractId?: string | null;
  objectName?: string | null;
  objectAddress?: string | null;
  objectContactName?: string | null;
  objectContactPhone?: string | null;
  manager: string;
  carrierId?: string | null;
  carrierKey?: string | null;
  carrierName?: string | null;
  carrierPhone?: string | null;
  carrierChatId?: number | null;
  carrierUserId?: number | null;
  rentalId?: string | null;
  ganttRentalId?: string | null;
  classicRentalId?: string | null;
  equipmentId?: string | null;
  equipmentInv?: string | null;
  equipmentLabel?: string | null;
  botSentAt?: string | null;
  botSendError?: string | null;
  carrierInvoiceReceived?: boolean;
  carrierInvoiceReceivedAt?: string | null;
  clientPaymentVerified?: boolean;
  clientPaymentVerifiedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdByPhone?: string | null;
  createdByEmail?: string | null;
}

export interface DeliveryCarrier {
  id: string;
  name: string;
  company?: string;
  inn?: string;
  phone?: string;
  notes?: string;
  status: ReferenceStatus;
  key: string;
  systemUserId?: string | null;
  systemUserName?: string | null;
  systemUserEmail?: string | null;
  maxCarrierKey?: string | null;
  maxUserName?: string | null;
  email?: string;
  role?: string;
  maxConnected: boolean;
  chatId?: number | null;
  userId?: number | null;
}

// ── Служебные машины ──────────────────────────────────────────────────────────

export type VehicleStatus = 'active' | 'repair' | 'unavailable' | 'reserve';
export type VehicleType   = 'car' | 'van' | 'truck' | 'minibus' | 'other';

export interface ServiceVehicle {
  id: string;
  // Основные данные
  make: string;                       // Марка
  model: string;                      // Модель
  plateNumber: string;                // Госномер
  vin: string | null;
  year: number | null;
  vehicleType: VehicleType;
  color: string | null;
  // Эксплуатация
  currentMileage: number;
  mileageUpdatedAt: string | null;
  responsiblePerson: string;          // Ответственное лицо (≠ водитель)
  conditionNote: string;
  status: VehicleStatus;
  // Документы и обслуживание
  osagoExpiresAt: string | null;
  insuranceExpiresAt: string | null;
  nextServiceAt: string | null;
  serviceNote: string | null;
  // Мета
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface VehicleTrip {
  id: string;
  vehicleId: string;
  sheetNumber?: string;
  date: string;
  driver: string;                     // Legacy/display alias for driverName
  driverId?: string | null;
  driverName?: string;
  mechanicId?: string | null;
  serviceRequestId?: string | null;
  route: string;                      // Legacy/display route
  routeFrom?: string;
  routeTo?: string;
  purpose: string;
  startMileage: number;               // Legacy alias for odometerStart
  endMileage: number | null;          // Legacy alias for odometerEnd
  distance: number;                   // Legacy alias for distanceKm
  odometerStart?: number;
  odometerEnd?: number | null;
  distanceKm?: number;
  fuelStart?: number | null;
  fuelAdded?: number | null;
  fuelEnd?: number | null;
  fuelConsumption?: number | null;
  status?: 'draft' | 'issued' | 'in_progress' | 'completed' | 'cancelled';
  startedAt?: string | null;
  completedAt?: string | null;
  serviceTicketId: string | null;     // Связанная сервисная заявка
  clientId: string | null;
  comment: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

// ── Планировщик подготовки техники к аренде ───────────────────────────────────

/**
 * Статус подготовки техники под конкретную аренду.
 * Независим от общего статуса единицы техники.
 */
export type PrepStatus =
  | 'planned'          // Запланирована
  | 'needs_prep'       // Требует подготовки
  | 'inspection'       // На осмотре
  | 'in_repair'        // В ремонте
  | 'ready'            // Готова к отгрузке
  | 'shipped'          // Отгружена
  | 'on_hold'          // Ожидает решения
  | 'conflict'         // Конфликт
  | 'not_ready';       // Не готова

export type PlannerPriority = 'high' | 'medium' | 'low';

/**
 * Оверлей — хранит только то, что сервис меняет вручную.
 * Остальные поля вычисляются сервером на лету из данных аренды.
 */
export interface PlannerItemOverlay {
  id: string;
  rentalId: string;
  equipmentRef: string;       // inventoryNumber или equipmentId
  prepStatus: PrepStatus;
  priorityOverride: PlannerPriority | null;   // null = автовычисление
  riskOverride: boolean | null;               // null = автовычисление
  comment: string;
  updatedAt: string;
  updatedBy: string;
}

/**
 * Строка планировщика — результат объединения аренд, доставок, сервисных работ и оверлея.
 * Возвращается сервером из GET /api/planner.
 */
export interface PlannerRow {
  id: string;                     // составной: rentalId__equipmentRef
  rentalId: string;
  equipmentId: string | null;
  equipmentRef: string;           // inventoryNumber
  startDate: string;
  daysUntil: number;
  equipmentLabel: string;         // "Genie GS-2032"
  inventoryNumber: string;
  serialNumber: string | null;
  equipmentType: EquipmentType | null;
  client: string;
  deliveryAddress: string;
  manager: string;
  equipmentStatus: EquipmentStatus | null;
  prepStatus: PrepStatus;
  priority: PlannerPriority;
  risk: boolean;
  comment: string;
  rentalStatus: RentalStatus;
  sourceType?: 'rental' | 'delivery' | 'service';
  operationType?: 'rental' | DeliveryType | 'service';
}
