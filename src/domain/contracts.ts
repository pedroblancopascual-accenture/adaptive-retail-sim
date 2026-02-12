import type { InventorySource, TaskStatus } from "./models";

export interface ZoneInventoryDashboardResponse {
  asOf: string;
  zones: Array<{
    zoneId: string;
    zoneName: string;
    color: string;
    isSalesLocation: boolean;
    lowStockCount: number;
    openTaskCount: number;
    inventory: Array<{
      skuId: string;
      qty: number;
      source: InventorySource;
      confidence?: number;
    }>;
  }>;
}

export interface ZoneDetailResponse {
  zone: {
    zoneId: string;
    name: string;
    color: string;
    isSalesLocation: boolean;
    replenishmentSources: Array<{ sourceZoneId: string; sortOrder: number }>;
    mapPolygon: Array<{ x: number; y: number }>;
    antennas: Array<{ antennaId: string; name: string; isActive: boolean }>;
  };
  asOf: string;
  inventory: Array<{
    skuId: string;
    qty: number;
    source: InventorySource;
    confidence?: number;
    lastCalculatedAt: string;
  }>;
  recentRFIDReads: Array<{
    eventId: string;
    epc: string;
    antennaId: string;
    timestamp: string;
    rssi?: number;
  }>;
  openTasks: Array<{
    taskId: string;
    skuId: string;
    sourceZoneId?: string;
    sourceCandidates?: Array<{ sourceZoneId: string; sortOrder: number; availableQty: number }>;
    assignedStaffId?: string;
    status: Extract<TaskStatus, "CREATED" | "ASSIGNED" | "IN_PROGRESS">;
    deficitQty: number;
    targetQty: number;
    createdAt: string;
  }>;
}

export interface ReplenishmentTaskListResponse {
  filters: {
    zoneId: string | null;
    status: TaskStatus | null;
  };
  tasks: Array<{
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
    confirmedQty?: number;
    confirmedBy?: string;
    closeReason?: string;
    createdAt: string;
    updatedAt: string;
    closedAt?: string;
  }>;
  page: number;
  pageSize: number;
  total: number;
}
