// Типы данных для системы управления арендой подъёмных платформ

export type EquipmentStatus = 'available' | 'rented' | 'reserved' | 'in_service' | 'inactive';
export type EquipmentType = string;
export type EquipmentDrive = 'diesel' | 'electric';
export type EquipmentOwnerType = 'own' | 'investor' | 'sublease';
export type EquipmentCategory = 'own' | 'sold' | 'client' | 'partner';
export type EquipmentPriority = 'low' | 'medium' | 'high' | 'critical';
export type EquipmentSalePdiStatus = 'not_started' | 'in_progress' | 'ready';
export type RepairEventType = 'repair' | 'maintenance' | 'diagnostics' | 'breakdown';
export type RepairSource = 'manual' | 'bot';
export type ShippingEventType = 'shipping' | 'receiving';
export type EquipmentGsmSignalState = 'online' | 'location_only' | 'offline';
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
  salePdiStatus?: EquipmentSalePdiStatus;
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
  photo?: string;
  gsmTrackerId?: string;
  gsmImei?: string;
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
export type GsmCommandStatus = 'queued' | 'sent' | 'failed';

export interface GsmGatewayStatus {
  enabled: boolean;
  host: string;
  port: number;
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
  direction: GsmPacketDirection;
  deviceId?: string | null;
  trackerId?: string | null;
  imei?: string | null;
  equipmentId?: string | null;
  equipmentLabel?: string | null;
  connectionId?: string | null;
  remoteAddress?: string | null;
  remotePort?: number | null;
  payload?: string | null;
  payloadHex: string;
  encoding: 'text' | 'hex';
  protocol?: string | null;
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
  payload: string;
  encoding: 'text' | 'hex';
  appendNewline: boolean;
  status: GsmCommandStatus;
  createdAt: string;
  createdBy?: string | null;
  sentAt?: string | null;
  failedAt?: string | null;
  error?: string | null;
  connectionId?: string | null;
  remoteAddress?: string | null;
  remotePort?: number | null;
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
  date: string;
  type: ShippingEventType;
  uploadedBy: string;
  photos: string[];
  comment?: string;
  rentalId?: string;
  source: RepairSource;
  photoCategories?: Partial<Record<EquipmentOperationPhotoCategory, string[]>>;
  hoursValue?: number;
  damageDescription?: string;
  operationSessionId?: string;
  checklist?: EquipmentHandoffChecklist;
  signedBy?: string;
  signedAt?: string;
  signatureDataUrl?: string;
}

export type RentalStatus = 'new' | 'confirmed' | 'delivery' | 'active' | 'return_planned' | 'closed';

export interface Rental {
  id: string;
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
  documents?: string[];
  comments?: string;
}

export type ServicePriority = 'low' | 'medium' | 'high' | 'critical';
export type ServiceStatus = 'new' | 'in_progress' | 'waiting_parts' | 'ready' | 'closed';
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
  phone?: string;
  notes?: string;
  status: ReferenceStatus;
}

export interface ServiceWork {
  id: string;
  name: string;
  category?: string;
  description?: string;
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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepairWorkItem {
  id: string;
  repairId: string;
  workId: string;
  quantity: number;
  normHoursSnapshot: number;
  ratePerHourSnapshot: number;
  nameSnapshot: string;
  categorySnapshot?: string;
  createdAt: string;
  createdByUserId?: string;
  createdByUserName?: string;
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

export type ServiceWorkCatalogItem = ServiceWork;
export type SparePartCatalogItem = SparePart;

export interface ServiceTicket {
  id: string;
  equipmentId: string;
  equipment: string;
  serviceKind?: ServiceScenario;
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
  createdByUserId?: string;
  createdByUserName?: string;
  reporterContact?: string;
  source?: 'manual' | 'bot' | 'manager' | 'system';
  status: ServiceStatus;
  plannedDate?: string;
  closedAt?: string;
  result?: string;
  resultData?: ServiceRepairResult;
  repairPhotos?: ServiceRepairPhotos;
  closeChecklist?: ServiceCloseChecklist;
  workLog: ServiceWorkLogEntry[];
  parts: ServicePartUsage[];
  createdAt: string;
  photos?: string[];
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
  serviceTicketId?: string;
  equipmentId?: string;
  equipmentLabel: string;
  inventoryNumber?: string;
  serialNumber?: string;
  manufacturer?: string;
  factoryName: string;
  factoryContact?: string;
  factoryCaseNumber?: string;
  failureDescription: string;
  requestedResolution: string;
  status: WarrantyClaimStatus;
  priority: ServicePriority;
  responseDueDate?: string;
  sentAt?: string;
  factoryResponse?: string;
  decision?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt?: string;
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

export type ClientStatus = 'active' | 'inactive' | 'blocked';

export interface Client {
  id: string;
  company: string;
  inn: string;
  contact: string;
  phone: string;
  email: string;
  address?: string;
  paymentTerms: string;
  creditLimit: number;
  debt: number;
  lastRentalDate?: string;
  totalRentals: number;
  manager?: string;
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

export type DocumentType = 'contract' | 'act' | 'invoice' | 'work_order';
export type DocumentStatus = 'draft' | 'signed' | 'sent';
export type DocumentContractKind = 'rental' | 'supply';

export interface Document {
  id: string;
  type: DocumentType;
  contractKind?: DocumentContractKind;
  number: string;
  client: string;
  date: string;
  amount?: number;
  status: DocumentStatus;
  signatoryName?: string;
  signatoryBasis?: string;
  rental?: string;
  serviceTicket?: string;
  manager?: string;
  contentHtml?: string;
  signedScanDataUrl?: string;
  signedScanFileName?: string;
  signedScanMimeType?: string;
  signedAt?: string;
  signedBy?: string;
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
  client: string;
  amount: number;          // total amount due
  paidAmount?: number;     // amount actually paid (for partial)
  dueDate: string;
  paidDate?: string;
  status: PaymentStatus;
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

// ── Боты ──────────────────────────────────────────────────────────────────────

export type BotStatus = 'online' | 'offline';
export type BotActivityType = 'session_started' | 'authorization' | 'command' | 'message' | 'callback';

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
  userRole: string | null;
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

// ── Доставка ──────────────────────────────────────────────────────────────────

export type DeliveryType = 'shipping' | 'receiving';
export type DeliveryStatus = 'new' | 'sent' | 'accepted' | 'in_transit' | 'completed' | 'cancelled';

export interface Delivery {
  id: string;
  type: DeliveryType;
  status: DeliveryStatus;
  transportDate: string;
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
  manager: string;
  carrierKey?: string | null;
  carrierName?: string | null;
  carrierPhone?: string | null;
  carrierChatId?: number | null;
  carrierUserId?: number | null;
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
  date: string;
  driver: string;                     // Водитель (фактически ездил)
  route: string;
  purpose: string;
  startMileage: number;
  endMileage: number;
  distance: number;                   // авторасчёт: endMileage - startMileage
  serviceTicketId: string | null;     // Связанная сервисная заявка
  clientId: string | null;
  comment: string;
  createdAt: string;
  createdBy: string;
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
