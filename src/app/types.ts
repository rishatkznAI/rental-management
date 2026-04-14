// Типы данных для системы управления арендой подъёмных платформ

export type EquipmentStatus = 'available' | 'rented' | 'reserved' | 'in_service' | 'inactive';
export type EquipmentType = 'scissor' | 'articulated' | 'telescopic';
export type EquipmentDrive = 'diesel' | 'electric';
export type EquipmentOwnerType = 'own' | 'investor' | 'sublease';
export type EquipmentCategory = 'own' | 'sold' | 'client' | 'partner';
export type EquipmentPriority = 'low' | 'medium' | 'high' | 'critical';
export type RepairEventType = 'repair' | 'maintenance' | 'diagnostics' | 'breakdown';
export type RepairSource = 'manual' | 'bot';
export type ShippingEventType = 'shipping' | 'receiving';

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
  nextMaintenance: string;
  maintenanceCHTO?: string;
  maintenancePTO?: string;
  notes?: string;
  currentClient?: string;
  returnDate?: string;
  photo?: string;
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

export type ServiceWorkCatalogItem = ServiceWork;
export type SparePartCatalogItem = SparePart;

export interface ServiceTicket {
  id: string;
  equipmentId: string;
  equipment: string;
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
  workLog: ServiceWorkLogEntry[];
  parts: ServicePartUsage[];
  createdAt: string;
  photos?: string[];
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
