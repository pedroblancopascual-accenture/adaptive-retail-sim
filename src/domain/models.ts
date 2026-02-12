export type InventorySource = "RFID" | "NON_RFID";
export type TaskStatus = "CREATED" | "ASSIGNED" | "IN_PROGRESS" | "CONFIRMED" | "REJECTED";
export type SalesEventType = "SALE" | "RETURN";
export type ReceivingStatus = "IN_TRANSIT" | "CONFIRMED" | "CANCELLED";

export interface ReplenishmentSourceRef {
  sourceZoneId: string;
  sortOrder: number;
}

export interface Zone {
  id: string;
  name: string;
  color: string;
  mapPolygon: Array<{ x: number; y: number }>;
  antennaIds: string[];
  ruleIds: string[];
  isSalesLocation: boolean; // true => customer orders can be created from this location
  replenishmentSources: ReplenishmentSourceRef[];
  isActive: boolean;
  createdAt: string;
}

export interface Antenna {
  id: string;
  zoneId: string;
  name: string;
  x: number;
  y: number;
  isActive: boolean;
  createdAt: string;
}

export interface RFIDReadEvent {
  id: string;
  epc: string;
  antennaId: string;
  zoneId: string;
  timestamp: string;
  rssi?: number;
  ingestedAt: string;
}

export interface EPCSkuMapping {
  id: string;
  epc: string;
  skuId: string;
  skuName?: string;
  inventorySource: "RFID";
  activeFrom: string;
  activeTo?: string;
}

export interface InventorySnapshotByZone {
  id: string;
  zoneId: string;
  skuId: string;
  qty: number;
  source: InventorySource;
  confidence?: number;
  lastCalculatedAt: string;
  version: number;
}

export interface ReplenishmentRule {
  id: string;
  zoneId: string;
  skuId: string;
  source: InventorySource;
  inboundSourceLocationId?: string;
  minQty: number;
  maxQty: number;
  priority: number;
  isActive: boolean;
  updatedAt: string;
}

export interface ReplenishmentTask {
  id: string;
  ruleId: string;
  zoneId: string;
  skuId: string;
  sourceZoneId?: string;
  sourceCandidates?: Array<{ sourceZoneId: string; sortOrder: number; availableQty: number }>;
  assignedStaffId?: string;
  assignedAt?: string;
  status: TaskStatus;
  triggerQty: number;
  deficitQty: number;
  targetQty: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  confirmedQty?: number;
  confirmedBy?: string;
  closeReason?: string;
}

export interface SalesEvent {
  id: string;
  skuId: string;
  zoneId: string;
  eventType: SalesEventType;
  qty: number;
  timestamp: string;
  posTxnId?: string;
  ingestedAt: string;
}

export interface EPCPresence {
  epc: string;
  skuId: string;
  zoneId: string;
  antennaId: string;
  lastSeenAt: string;
  lastRssi?: number;
}

export interface StaffMember {
  id: string;
  name: string;
  role: "ASSOCIATE" | "SUPERVISOR";
  activeShift: boolean;
  shiftLabel: string;
  scopeAllZones: boolean;
  zoneScopeZoneIds: string[];
}

export interface TaskAuditEntry {
  id: string;
  taskId: string;
  action: "CREATED" | "ASSIGNED" | "STARTED" | "CONFIRMED" | "CLOSED" | "CANCELLED";
  actorId?: string;
  details: string;
  timestamp: string;
}

export interface ReceivingOrder {
  id: string;
  sourceLocationId: string;
  destinationZoneId: string;
  skuId: string;
  source: InventorySource;
  assignedStaffId?: string;
  assignedAt?: string;
  requestedQty: number;
  confirmedQty: number;
  status: ReceivingStatus;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  note?: string;
}
