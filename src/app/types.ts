// Типы данных для системы управления арендой подъёмных платформ

export type EquipmentStatus = 'available' | 'rented' | 'reserved' | 'in_service' | 'inactive';
export type EquipmentType = 'scissor' | 'articulated' | 'telescopic';
export type EquipmentDrive = 'diesel' | 'electric';
export type EquipmentOwnerType = 'own' | 'investor' | 'sublease';
export type EquipmentCategory = 'own' | 'sold' | 'client' | 'partner';
export type EquipmentPriority = 'low' | 'medium' | 'high' | 'critical';
export type EquipmentSalePdiStatus = 'not_started' | 'in_progress' | 'ready';
export type RepairEventType = 'repair' | 'maintenance' | 'diagnostics' | 'breakdown';
export type RepairSource = 'manual' | 'bot';
export type ShippingEventType = 'shipping' | 'receiving';
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
  notes?: string;
  currentClient?: string;
  returnDate?: string;
  photo?: string;
  history?: AuditEntry[];
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
  createdAt?: string;
  createdBy?: string;
  history?: AuditEntry[];
}

export type DocumentType = 'contract' | 'act' | 'invoice';
export type DocumentStatus = 'draft' | 'signed' | 'sent';

export interface Document {
  id: string;
  type: DocumentType;
  number: string;
  client: string;
  date: string;
  amount?: number;
  status: DocumentStatus;
  rental?: string;
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
export type DeliveryStatus = 'new' | 'sent' | 'accepted' | 'completed' | 'cancelled';

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
