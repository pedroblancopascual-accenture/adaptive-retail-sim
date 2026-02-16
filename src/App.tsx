import {
  Fragment,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { api, type MinMaxRuleTemplate } from "./api/mockApi";
import { sampleDataset } from "./data/sampleDataset";
import type { InventorySource } from "./domain/models";
import { LANG_FLAGS, LANG_LABELS, type Lang, t } from "./i18n";

type InventoryZoneId = string;
type ZoneDrawerSection = "inventory" | "settings" | "rules" | "tasks";
type ZoneScope = InventoryZoneId | "all";
type MainContentView = "map" | "staff" | "catalog" | "analytics" | "tasks" | "rules";
type AppDisplayMode = "admin" | "staff";
type TaskTypeValue = "REPLENISHMENT" | "RECEIVING";
type TaskStatusValue = "CREATED" | "ASSIGNED" | "IN_PROGRESS" | "IN_TRANSIT" | "CONFIRMED" | "REJECTED";
type TaskHubFilterKey = "TYPE" | "DESTINATION" | "STATUS";
type CatalogSourceFilterValue = "RFID" | "NON_RFID";
type CatalogKitValue = "home" | "away" | "third" | "forth";
type CatalogAgeGroupValue = "adults" | "youth" | "kids" | "baby";
type CatalogGenderValue = "women" | "men" | "unisex";
type CatalogRoleValue = "player" | "goalkeeper" | "staff";
type CatalogQualityValue = "match" | "stadium";
type CatalogFilterKey = "SOURCE" | "KIT" | "AGE_GROUP" | "GENDER" | "ROLE" | "QUALITY";
type RuleTemplateSelectorMode = "SKU" | "ATTRIBUTES";
type CartMarkerAnimation = {
  customerId: string;
  customerName: string;
  originZoneId: string;
  startedAt: number;
};
type TaskAssignmentNotice = {
  id: string;
  taskKey: string;
  title: string;
  detail: string;
  tone: "admin" | "runner";
  startedAt: number;
};
type ExitMarkerAnimation = {
  id: string;
  customerId: string;
  customerName: string;
  startedAt: number;
};
const SHOPFLOOR_SIZE = { width: 1536, height: 1117 };
const AUTO_SWEEP_INTERVAL_SEC = 30;
const ALL_LOCATIONS_OPTION_ID = "__all_locations__";
const CART_TRAVEL_MS = 4200;
const CART_EXIT_MS = 1600;
const REPLENISHMENT_TRAVEL_MS = 1400;
const REPLENISHMENT_CONFIRM_FADE_MS = 1800;
const TASK_ASSIGNMENT_FLASH_MS = 4600;
const TASK_ASSIGNMENT_NOTICE_MS = 5600;
const ALL_SKUS = sampleDataset.skus;
const SKU_SOURCE_BY_ID = new Map(ALL_SKUS.map((sku) => [sku.id, sku.source]));

function getUnifiedTaskKey(task: { type: TaskTypeValue; id: string }): string {
  return `${task.type}:${task.id}`;
}

function polygonToPoints(points: Array<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

function shortZone(zoneId: string): string {
  return zoneId.replace("zone-", "").replace(/-/g, " ");
}

function polygonCenter(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function getCartItemState(source: string, qty: number, pickedConfirmedQty: number): "IN_CART" | "PARTIAL_PICK" | "PICK_CONFIRMED" {
  if (source !== "RFID") return "IN_CART";
  if (pickedConfirmedQty <= 0) return "IN_CART";
  if (pickedConfirmedQty < qty) return "PARTIAL_PICK";
  return "PICK_CONFIRMED";
}

function toTimestampMs(value?: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toDurationLabel(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "-";
  const rounded = Math.round(totalSeconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function parseCustomerSeq(customerId: string): number {
  const match = customerId.match(/cust-(\d+)/i);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quadraticPoint(
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  t: number
): { x: number; y: number } {
  const inv = 1 - t;
  return {
    x: inv * inv * x1 + 2 * inv * t * cx + t * t * x2,
    y: inv * inv * y1 + 2 * inv * t * cy + t * t * y2
  };
}

function buildQuadraticSegmentPath(
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  startT: number,
  endT: number,
  steps = 14
): string {
  const a = Math.max(0, Math.min(1, startT));
  const b = Math.max(0, Math.min(1, endT));
  if (b - a <= 0.0001) return "";
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = a + ((b - a) * i) / steps;
    points.push(quadraticPoint(x1, y1, cx, cy, x2, y2, t));
  }
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function buildArrowPolygonOnQuadratic(
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  t: number
): string {
  const px =
    (1 - t) * (1 - t) * x1 +
    2 * (1 - t) * t * cx +
    t * t * x2;
  const py =
    (1 - t) * (1 - t) * y1 +
    2 * (1 - t) * t * cy +
    t * t * y2;
  const tx = 2 * (1 - t) * (cx - x1) + 2 * t * (x2 - cx);
  const ty = 2 * (1 - t) * (cy - y1) + 2 * t * (y2 - cy);
  const norm = Math.max(0.0001, Math.hypot(tx, ty));
  const ux = tx / norm;
  const uy = ty / norm;
  const nx = -uy;
  const ny = ux;
  const tipX = px + ux * 8;
  const tipY = py + uy * 8;
  const leftX = px - ux * 2.8 + nx * 3.6;
  const leftY = py - uy * 2.8 + ny * 3.6;
  const rightX = px - ux * 2.8 - nx * 3.6;
  const rightY = py - uy * 2.8 - ny * 3.6;
  return `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const stored = localStorage.getItem("sim-lang");
    return stored === "en" || stored === "es" || stored === "ca" ? stored : "ca";
  });
  const [selectedZone, setSelectedZone] = useState<ZoneScope>("all");
  const [dashboard, setDashboard] = useState(api.getInventoryZones());
  const [locations, setLocations] = useState(api.getLocations());
  const [staff, setStaff] = useState(api.getStaff());
  const [tasks, setTasks] = useState(api.getReplenishmentTasks());
  const [catalogEntries, setCatalogEntries] = useState<ReturnType<typeof api.getCatalog>>(api.getCatalog());
  const [zoneDetail, setZoneDetail] = useState<ReturnType<typeof api.getInventoryZoneById>>(null);
  const [rules, setRules] = useState(api.getRules());
  const [ruleTemplates, setRuleTemplates] = useState(api.getMinMaxRuleTemplates());
  const [flow, setFlow] = useState(api.getFlowEvents());
  const [taskAudit, setTaskAudit] = useState(api.getTaskAudit());
  const [customers, setCustomers] = useState(api.getCustomers());
  const [selectedCustomerId, setSelectedCustomerId] = useState(api.getCustomers()[0]?.id ?? "");
  const [customerBasket, setCustomerBasket] = useState(api.getCustomerBasket(api.getCustomers()[0]?.id ?? ""));
  const [showZoneDrawer, setShowZoneDrawer] = useState(false);
  const [zoneDrawerSection, setZoneDrawerSection] = useState<ZoneDrawerSection>("inventory");
  const [mainContentView, setMainContentView] = useState<MainContentView>("map");
  const [appDisplayMode, setAppDisplayMode] = useState<AppDisplayMode>("admin");
  const [runnerStaffId, setRunnerStaffId] = useState<string>("");
  const [receivingOrders, setReceivingOrders] = useState(api.getReceivingOrders());
  const [receivingLocations, setReceivingLocations] = useState(api.getReceivingLocations());
  const [showSalesDrawer, setShowSalesDrawer] = useState(false);
  const [showRfidDrawer, setShowRfidDrawer] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [signedInStaffId, setSignedInStaffId] = useState<string>("");
  const [taskSourceById, setTaskSourceById] = useState<Record<string, string>>({});
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [mapEditMode, setMapEditMode] = useState(false);
  const [showMapZones, setShowMapZones] = useState(true);
  const [showMapLegend, setShowMapLegend] = useState(false);
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isMapPanning, setIsMapPanning] = useState(false);
  const [mapPanStart, setMapPanStart] = useState<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [draftPolygon, setDraftPolygon] = useState<Array<{ x: number; y: number }>>([]);
  const [newZonePolygon, setNewZonePolygon] = useState<Array<{ x: number; y: number }>>([]);
  const [newZoneForm, setNewZoneForm] = useState({
    zoneId: "zone-new",
    name: "New Zone",
    color: "#a855f7",
    locationType: "sales" as "sales" | "warehouse" | "external"
  });
  const [dragVertexIndex, setDragVertexIndex] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<"existing" | "new" | null>(null);
  const [isDraggingVertex, setIsDraggingVertex] = useState(false);
  const [dragPolygonStart, setDragPolygonStart] = useState<{ x: number; y: number } | null>(null);
  const [rfidCatalog] = useState(api.getRfidCatalog());
  const [rfidForm, setRfidForm] = useState(() => ({
    epc: api.getRfidCatalog().epcMappings[0]?.epc ?? "",
    antennaId: api.getRfidCatalog().antennas[0]?.id ?? "",
    rssi: -54
  }));
  const [rfidSweepZoneId, setRfidSweepZoneId] = useState<InventoryZoneId>(() => api.getLocations()[0]?.id ?? "zone-shelf-a");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const suppressMapClickRef = useRef(false);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const prevTaskStatusRef = useRef<Record<string, string>>({});
  const prevTaskAssigneeRef = useRef<Record<string, string>>({});
  const hasTaskAssigneeSnapshotRef = useRef(false);

  const [ruleForm, setRuleForm] = useState<{
    skuId: string;
    source: InventorySource;
    minQty: number;
    maxQty: number;
  }>({
    skuId: "SKU-NR-1",
    source: "NON_RFID" as InventorySource,
    minQty: 2,
    maxQty: 8
  });

  const [saleForm, setSaleForm] = useState({
    skuId: "SKU-NR-1",
    qty: 1
  });
  const [saleZoneId, setSaleZoneId] = useState<InventoryZoneId>("zone-shelf-a");
  const [zoneEditForm, setZoneEditForm] = useState({
    name: "",
    color: "#3b82f6",
    isSalesLocation: true
  });
  const [previewZoneColor, setPreviewZoneColor] = useState<string | null>(null);
  const [hoverZoneId, setHoverZoneId] = useState<InventoryZoneId | null>(null);
  const [sourceEditor, setSourceEditor] = useState<Array<{ sourceZoneId: string; sortOrder: number }>>([]);
  const [salesStatusMessage, setSalesStatusMessage] = useState("");
  const [receivingStatusMessage, setReceivingStatusMessage] = useState("");
  const [autoSweepEnabled, setAutoSweepEnabled] = useState(true);
  const [autoSweepRemainingSec, setAutoSweepRemainingSec] = useState(AUTO_SWEEP_INTERVAL_SEC);
  const [taskHubTypeFilters, setTaskHubTypeFilters] = useState<TaskTypeValue[]>([]);
  const [taskHubLocationFilters, setTaskHubLocationFilters] = useState<string[]>([]);
  const [taskHubStatusFilters, setTaskHubStatusFilters] = useState<TaskStatusValue[]>([]);
  const [taskHubPendingFilterKey, setTaskHubPendingFilterKey] = useState<TaskHubFilterKey | "">("");
  const [taskHubFilterSearch, setTaskHubFilterSearch] = useState("");
  const [catalogSourceFilters, setCatalogSourceFilters] = useState<CatalogSourceFilterValue[]>([]);
  const [catalogKitFilters, setCatalogKitFilters] = useState<CatalogKitValue[]>([]);
  const [catalogAgeGroupFilters, setCatalogAgeGroupFilters] = useState<CatalogAgeGroupValue[]>([]);
  const [catalogGenderFilters, setCatalogGenderFilters] = useState<CatalogGenderValue[]>([]);
  const [catalogRoleFilters, setCatalogRoleFilters] = useState<CatalogRoleValue[]>([]);
  const [catalogQualityFilters, setCatalogQualityFilters] = useState<CatalogQualityValue[]>([]);
  const [catalogPendingFilterKey, setCatalogPendingFilterKey] = useState<CatalogFilterKey | "">("");
  const [catalogFilterSearch, setCatalogFilterSearch] = useState("");
  const [catalogMapSkuId, setCatalogMapSkuId] = useState<string | null>(null);
  const [cartMarkers, setCartMarkers] = useState<Record<string, CartMarkerAnimation>>({});
  const [exitMarkers, setExitMarkers] = useState<ExitMarkerAnimation[]>([]);
  const [confirmedReplenishmentFx, setConfirmedReplenishmentFx] = useState<Record<string, number>>({});
  const [recentAssignedTaskFx, setRecentAssignedTaskFx] = useState<Record<string, number>>({});
  const [taskAssignmentNotices, setTaskAssignmentNotices] = useState<TaskAssignmentNotice[]>([]);
  const [animationTick, setAnimationTick] = useState(Date.now());
  const [rulesLocationFilter, setRulesLocationFilter] = useState<string>("all");
  const [rulesFormMode, setRulesFormMode] = useState<"closed" | "create" | "edit">("closed");
  const [ruleCenterForm, setRuleCenterForm] = useState<{
    id?: string;
    zoneId: string;
    selectorMode: RuleTemplateSelectorMode;
    skuId: string;
    source: InventorySource;
    minQty: number;
    maxQty: number;
    priority: number;
    kit?: CatalogKitValue;
    ageGroup?: CatalogAgeGroupValue;
    gender?: CatalogGenderValue;
    role?: CatalogRoleValue;
    quality?: CatalogQualityValue;
  }>({
    zoneId: ALL_LOCATIONS_OPTION_ID,
    selectorMode: "SKU",
    skuId: sampleDataset.skus[0]?.id ?? "",
    source: "RFID",
    minQty: 1,
    maxQty: 4,
    priority: 1
  });

  const openTasks = useMemo(
    () => tasks.tasks.filter((task) => task.status === "CREATED" || task.status === "ASSIGNED" || task.status === "IN_PROGRESS"),
    [tasks.tasks]
  );

  const zoneRules = useMemo(
    () => (selectedZone === "all" ? rules : rules.filter((rule) => rule.zoneId === selectedZone)),
    [rules, selectedZone]
  );

  const selectedZoneSkuOptions = useMemo(() => {
    const fromInventory = (zoneDetail?.inventory ?? []).map((item) => item.skuId);
    const fromRules = zoneRules.map((rule) => rule.skuId);
    return Array.from(new Set([...fromInventory, ...fromRules]));
  }, [zoneDetail, zoneRules]);

  const selectedZoneSummary = useMemo(() => {
    if (selectedZone === "all") return undefined;
    return dashboard.zones.find((zone) => zone.zoneId === selectedZone);
  }, [dashboard.zones, selectedZone]);

  const selectedLocation = useMemo(() => {
    if (selectedZone === "all") return undefined;
    return locations.find((zone) => zone.id === selectedZone);
  }, [locations, selectedZone]);

  const salesEnabledLocations = useMemo(() => {
    const zoneMetaById = new Map(locations.map((zone) => [zone.id, zone]));
    return dashboard.zones
      .filter((zone) => zone.isSalesLocation)
      .map((zone) => ({
        id: zone.zoneId as InventoryZoneId,
        name: zoneMetaById.get(zone.zoneId)?.name ?? zone.zoneName
      }));
  }, [dashboard.zones, locations]);

  const orderableZoneIds = useMemo(
    () => salesEnabledLocations.map((zone) => zone.id),
    [salesEnabledLocations]
  );
  const locationNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const location of locations) {
      map.set(location.id, location.name);
    }
    for (const external of receivingLocations.external) {
      map.set(external.id, external.name);
    }
    return map;
  }, [locations, receivingLocations.external]);
  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of staff) {
      map.set(member.id, member.name);
    }
    return map;
  }, [staff]);
  const sourceEditorOptions = useMemo(() => {
    if (!selectedLocation) return [];
    if (selectedLocation.isSalesLocation) {
      return locations
        .filter((zone) => zone.id !== selectedLocation.id)
        .map((zone) => ({ id: zone.id, name: zone.name }));
    }
    return receivingLocations.external.map((entry) => ({ id: entry.id, name: entry.name }));
  }, [locations, receivingLocations.external, selectedLocation]);
  const pendingReceivingOrders = useMemo(
    () => receivingOrders.filter((order) => order.status === "IN_TRANSIT"),
    [receivingOrders]
  );
  const openUnifiedTaskCount = useMemo(
    () => openTasks.length + pendingReceivingOrders.length,
    [openTasks.length, pendingReceivingOrders.length]
  );
  const zoneDrawerTaskRows = useMemo(() => {
    const zoneId = selectedZone === "all" ? null : selectedZone;
    const replenishmentRows = openTasks.filter((task) => (zoneId ? task.zoneId === zoneId : true));
    const receivingRows = pendingReceivingOrders.filter((order) =>
      zoneId ? order.destinationZoneId === zoneId : true
    );
    return [...replenishmentRows, ...receivingRows];
  }, [openTasks, pendingReceivingOrders, selectedZone]);
  const unifiedTaskRows = useMemo(() => {
    const replenRows = tasks.tasks.map((task) => {
      const zoneName = locationNameById.get(task.zoneId) ?? task.zoneId;
      const isResolved = task.status === "CONFIRMED" || task.status === "REJECTED";
      const statusTags: TaskStatusValue[] = [];
      if (task.status === "CREATED") statusTags.push("CREATED");
      if (task.status === "ASSIGNED") statusTags.push("ASSIGNED");
      if (task.status === "IN_PROGRESS") statusTags.push("IN_PROGRESS");
      if (task.status === "CONFIRMED") statusTags.push("CONFIRMED");
      if (task.status === "REJECTED") statusTags.push("REJECTED");
      return {
        id: task.id,
        type: "REPLENISHMENT" as const,
        locationId: task.zoneId,
        locationName: zoneName,
        skuId: task.skuId,
        sourceLabel: task.sourceZoneId ? (locationNameById.get(task.sourceZoneId) ?? task.sourceZoneId) : "-",
        status: task.status,
        assignedStaffId: task.assignedStaffId,
        createdAt: task.createdAt,
        qtyLabel: `${task.deficitQty}`,
        isOpen: !isResolved,
        statusTags
      };
    });

    const receivingRows = receivingOrders.map((order) => {
      const destinationName = locationNameById.get(order.destinationZoneId) ?? order.destinationZoneId;
      const sourceName = locationNameById.get(order.sourceLocationId) ?? order.sourceLocationId;
      const isResolved = order.status === "CONFIRMED" || order.status === "CANCELLED";
      const statusTags: TaskStatusValue[] = [];
      if (order.status === "IN_TRANSIT") statusTags.push("IN_TRANSIT");
      if (order.status === "CONFIRMED") statusTags.push("CONFIRMED");
      if (order.status === "CANCELLED") statusTags.push("REJECTED");
      return {
        id: order.id,
        type: "RECEIVING" as const,
        locationId: order.destinationZoneId,
        locationName: destinationName,
        skuId: order.skuId,
        sourceLabel: sourceName,
        status: order.status,
        assignedStaffId: order.assignedStaffId,
        createdAt: order.createdAt,
        qtyLabel: `${order.confirmedQty}/${order.requestedQty}`,
        isOpen: !isResolved,
        statusTags
      };
    });

    return [...replenRows, ...receivingRows].sort(
      (a, b) => toTimestampMs(b.createdAt)! - toTimestampMs(a.createdAt)!
    );
  }, [tasks.tasks, receivingOrders, locationNameById]);
  const filteredUnifiedTaskRows = useMemo(() => {
    return unifiedTaskRows.filter((row) => {
      if (taskHubTypeFilters.length > 0 && !taskHubTypeFilters.includes(row.type)) return false;
      if (taskHubLocationFilters.length > 0 && !taskHubLocationFilters.includes(row.locationId)) return false;
      if (taskHubStatusFilters.length > 0 && !taskHubStatusFilters.some((status) => row.statusTags.includes(status))) return false;
      return true;
    });
  }, [unifiedTaskRows, taskHubTypeFilters, taskHubLocationFilters, taskHubStatusFilters]);
  const replenishmentTaskById = useMemo(
    () => new Map(tasks.tasks.map((task) => [task.id, task] as const)),
    [tasks.tasks]
  );
  const taskHubDestinationLocationOptions = useMemo(() => {
    const onlyReplenishment =
      taskHubTypeFilters.length > 0 &&
      taskHubTypeFilters.every((type) => type === "REPLENISHMENT");
    const onlyReceiving =
      taskHubTypeFilters.length > 0 &&
      taskHubTypeFilters.every((type) => type === "RECEIVING");
    const baseLocations = onlyReplenishment
      ? locations.filter((location) => location.isSalesLocation)
      : onlyReceiving
        ? locations.filter((location) => !location.isSalesLocation)
        : locations;
    return baseLocations.map((location) => ({ id: location.id, name: location.name }));
  }, [locations, taskHubTypeFilters]);
  const taskHubStatusOptions = useMemo(
    () => [
      { id: "CREATED", label: t(lang, "taskFilterStatusCreated") },
      { id: "ASSIGNED", label: t(lang, "taskFilterStatusAssigned") },
      { id: "IN_PROGRESS", label: t(lang, "taskFilterStatusInProgress") },
      { id: "IN_TRANSIT", label: t(lang, "taskFilterStatusInTransit") },
      { id: "CONFIRMED", label: t(lang, "taskFilterStatusConfirmed") },
      { id: "REJECTED", label: t(lang, "taskFilterStatusRejected") }
    ],
    [lang]
  );
  const taskStatusLabelById = useMemo(
    () => new Map(taskHubStatusOptions.map((option) => [option.id, option.label] as const)),
    [taskHubStatusOptions]
  );
  const taskHubTypeOptions = useMemo(
    () => [
      { id: "REPLENISHMENT", label: t(lang, "taskFilterTypeReplenishment") },
      { id: "RECEIVING", label: t(lang, "taskFilterTypeReceiving") }
    ],
    [lang]
  );
  const taskHubActiveFilters = useMemo(() => {
    const filters: Array<{ key: TaskHubFilterKey; label: string; valueLabel: string }> = [];
    if (taskHubTypeFilters.length > 0) {
      filters.push({
        key: "TYPE",
        label: t(lang, "taskFilterTypeLabel"),
        valueLabel: taskHubTypeFilters
          .map((selected) => taskHubTypeOptions.find((option) => option.id === selected)?.label ?? selected)
          .join(", ")
      });
    }
    if (taskHubLocationFilters.length > 0) {
      filters.push({
        key: "DESTINATION",
        label: t(lang, "taskFilterDestinationLabel"),
        valueLabel: taskHubLocationFilters
          .map(
            (selected) =>
              taskHubDestinationLocationOptions.find((option) => option.id === selected)?.name ?? selected
          )
          .join(", ")
      });
    }
    if (taskHubStatusFilters.length > 0) {
      filters.push({
        key: "STATUS",
        label: t(lang, "taskFilterStatusLabel"),
        valueLabel: taskHubStatusFilters
          .map((selected) => taskHubStatusOptions.find((option) => option.id === selected)?.label ?? selected)
          .join(", ")
      });
    }
    return filters;
  }, [
    taskHubTypeFilters,
    taskHubLocationFilters,
    taskHubStatusFilters,
    taskHubTypeOptions,
    taskHubDestinationLocationOptions,
    taskHubStatusOptions,
    lang
  ]);
  const taskHubAddableFilterKeys = useMemo(() => {
    const keys: TaskHubFilterKey[] = [];
    if (taskHubTypeFilters.length === 0) keys.push("TYPE");
    if (taskHubLocationFilters.length === 0) keys.push("DESTINATION");
    if (taskHubStatusFilters.length === 0) keys.push("STATUS");
    return keys;
  }, [taskHubTypeFilters, taskHubLocationFilters, taskHubStatusFilters]);
  const taskHubPendingOptions = useMemo(() => {
    if (!taskHubPendingFilterKey) return [];
    const source =
      taskHubPendingFilterKey === "TYPE"
        ? taskHubTypeOptions.map((option) => ({ id: option.id, label: option.label }))
        : taskHubPendingFilterKey === "DESTINATION"
          ? taskHubDestinationLocationOptions.map((option) => ({ id: option.id, label: option.name }))
          : taskHubStatusOptions.map((option) => ({ id: option.id, label: option.label }));
    const search = taskHubFilterSearch.trim().toLowerCase();
    if (!search) return source;
    return source.filter((option) => option.label.toLowerCase().includes(search));
  }, [
    taskHubPendingFilterKey,
    taskHubTypeOptions,
    taskHubDestinationLocationOptions,
    taskHubStatusOptions,
    taskHubFilterSearch
  ]);

  const catalogSourceOptions = useMemo(
    () => [
      { id: "RFID" as CatalogSourceFilterValue, label: "RFID" },
      { id: "NON_RFID" as CatalogSourceFilterValue, label: "NO-RFID" }
    ],
    []
  );
  const catalogKitOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogEntries
            .flatMap((product) => product.variants.map((variant) => variant.kit))
            .filter((value): value is CatalogKitValue => value !== undefined)
        )
      )
        .map((id) => ({ id, label: t(lang, `catalogValue_${id}`) })),
    [catalogEntries, lang]
  );
  const catalogAgeGroupOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogEntries
            .flatMap((product) => product.variants.map((variant) => variant.ageGroup))
            .filter((value): value is CatalogAgeGroupValue => value !== undefined)
        )
      )
        .map((id) => ({ id, label: t(lang, `catalogValue_${id}`) })),
    [catalogEntries, lang]
  );
  const catalogGenderOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogEntries
            .flatMap((product) => product.variants.map((variant) => variant.gender))
            .filter((value): value is CatalogGenderValue => value !== undefined)
        )
      )
        .map((id) => ({ id, label: t(lang, `catalogValue_${id}`) })),
    [catalogEntries, lang]
  );
  const catalogRoleOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogEntries
            .flatMap((product) => product.variants.map((variant) => variant.role))
            .filter((value): value is CatalogRoleValue => value !== undefined)
        )
      )
        .map((id) => ({ id, label: t(lang, `catalogValue_${id}`) })),
    [catalogEntries, lang]
  );
  const catalogQualityOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogEntries
            .flatMap((product) => product.variants.map((variant) => variant.quality))
            .filter((value): value is CatalogQualityValue => value !== undefined)
        )
      )
        .map((id) => ({ id, label: t(lang, `catalogValue_${id}`) })),
    [catalogEntries, lang]
  );
  const catalogActiveFilters = useMemo(() => {
    const filters: Array<{ key: CatalogFilterKey; label: string; valueLabel: string }> = [];
    if (catalogSourceFilters.length > 0) {
      filters.push({
        key: "SOURCE",
        label: t(lang, "catalogSourceLabel"),
        valueLabel: catalogSourceFilters
          .map((selected) => catalogSourceOptions.find((option) => option.id === selected)?.label ?? selected)
          .join(", ")
      });
    }
    if (catalogKitFilters.length > 0) {
      filters.push({
        key: "KIT",
        label: t(lang, "catalogKit"),
        valueLabel: catalogKitFilters
          .map((selected) => catalogKitOptions.find((option) => option.id === selected)?.label ?? selected)
          .join(", ")
      });
    }
    if (catalogAgeGroupFilters.length > 0) {
      filters.push({
        key: "AGE_GROUP",
        label: t(lang, "catalogAgeGroup"),
        valueLabel: catalogAgeGroupFilters
          .map((selected) => catalogAgeGroupOptions.find((option) => option.id === selected)?.label ?? selected)
          .join(", ")
      });
    }
    if (catalogGenderFilters.length > 0) {
      filters.push({
        key: "GENDER",
        label: t(lang, "catalogGender"),
        valueLabel: catalogGenderFilters
          .map((selected) => catalogGenderOptions.find((option) => option.id === selected)?.label ?? selected)
          .join(", ")
      });
    }
    if (catalogRoleFilters.length > 0) {
      filters.push({
        key: "ROLE",
        label: t(lang, "catalogRole"),
        valueLabel: catalogRoleFilters
          .map((selected) => catalogRoleOptions.find((option) => option.id === selected)?.label ?? selected)
          .join(", ")
      });
    }
    if (catalogQualityFilters.length > 0) {
      filters.push({
        key: "QUALITY",
        label: t(lang, "catalogQuality"),
        valueLabel: catalogQualityFilters
          .map((selected) => catalogQualityOptions.find((option) => option.id === selected)?.label ?? selected)
          .join(", ")
      });
    }
    return filters;
  }, [
    catalogSourceFilters,
    catalogKitFilters,
    catalogAgeGroupFilters,
    catalogGenderFilters,
    catalogRoleFilters,
    catalogQualityFilters,
    catalogSourceOptions,
    catalogKitOptions,
    catalogAgeGroupOptions,
    catalogGenderOptions,
    catalogRoleOptions,
    catalogQualityOptions,
    lang
  ]);
  const catalogAddableFilterKeys = useMemo(() => {
    const keys: CatalogFilterKey[] = [];
    if (catalogSourceFilters.length === 0) keys.push("SOURCE");
    if (catalogKitFilters.length === 0) keys.push("KIT");
    if (catalogAgeGroupFilters.length === 0) keys.push("AGE_GROUP");
    if (catalogGenderFilters.length === 0) keys.push("GENDER");
    if (catalogRoleFilters.length === 0) keys.push("ROLE");
    if (catalogQualityFilters.length === 0) keys.push("QUALITY");
    return keys;
  }, [
    catalogSourceFilters,
    catalogKitFilters,
    catalogAgeGroupFilters,
    catalogGenderFilters,
    catalogRoleFilters,
    catalogQualityFilters
  ]);
  const catalogPendingOptions = useMemo(() => {
    if (!catalogPendingFilterKey) return [];
    const source =
      catalogPendingFilterKey === "SOURCE"
        ? catalogSourceOptions.map((option) => ({ id: option.id, label: option.label }))
        : catalogPendingFilterKey === "KIT"
          ? catalogKitOptions.map((option) => ({ id: option.id, label: option.label }))
          : catalogPendingFilterKey === "AGE_GROUP"
            ? catalogAgeGroupOptions.map((option) => ({ id: option.id, label: option.label }))
            : catalogPendingFilterKey === "GENDER"
              ? catalogGenderOptions.map((option) => ({ id: option.id, label: option.label }))
              : catalogPendingFilterKey === "ROLE"
                ? catalogRoleOptions.map((option) => ({ id: option.id, label: option.label }))
                : catalogQualityOptions.map((option) => ({ id: option.id, label: option.label }));
    const search = catalogFilterSearch.trim().toLowerCase();
    if (!search) return source;
    return source.filter((option) => option.label.toLowerCase().includes(search));
  }, [
    catalogPendingFilterKey,
    catalogSourceOptions,
    catalogKitOptions,
    catalogAgeGroupOptions,
    catalogGenderOptions,
    catalogRoleOptions,
    catalogQualityOptions,
    catalogFilterSearch
  ]);
  const filteredCatalogEntries = useMemo(
    () =>
      catalogEntries
        .map((product) => ({
          ...product,
          variants: product.variants.filter((variant) => {
            if (catalogSourceFilters.length > 0 && !catalogSourceFilters.includes(variant.source)) return false;
            if (catalogKitFilters.length > 0 && (!variant.kit || !catalogKitFilters.includes(variant.kit))) return false;
            if (catalogAgeGroupFilters.length > 0 && (!variant.ageGroup || !catalogAgeGroupFilters.includes(variant.ageGroup))) return false;
            if (catalogGenderFilters.length > 0 && (!variant.gender || !catalogGenderFilters.includes(variant.gender))) return false;
            if (catalogRoleFilters.length > 0 && (!variant.role || !catalogRoleFilters.includes(variant.role))) return false;
            if (catalogQualityFilters.length > 0 && (!variant.quality || !catalogQualityFilters.includes(variant.quality))) return false;
            return true;
          })
        }))
        .filter((product) => product.variants.length > 0),
    [
      catalogEntries,
      catalogSourceFilters,
      catalogKitFilters,
      catalogAgeGroupFilters,
      catalogGenderFilters,
      catalogRoleFilters,
      catalogQualityFilters
    ]
  );
  const catalogMapPulseZones = useMemo(() => {
    if (!catalogMapSkuId) return [];
    return locations
      .filter((location) =>
        (dashboard.zones.find((zone) => zone.zoneId === location.id)?.inventory ?? []).some(
          (item) => item.skuId === catalogMapSkuId && item.qty > 0
        )
      )
      .map((location) => location.id);
  }, [dashboard.zones, locations, catalogMapSkuId]);
  const catalogMapSkuLabel = useMemo(() => {
    if (!catalogMapSkuId) return "";
    return ALL_SKUS.find((sku) => sku.id === catalogMapSkuId)?.name ?? catalogMapSkuId;
  }, [catalogMapSkuId]);
  const skuNameById = useMemo(
    () => new Map(ALL_SKUS.map((sku) => [sku.id, sku.name])),
    []
  );
  const ruleLocationOptions = useMemo(
    () =>
      locations.map((location) => ({
        id: location.id,
        name: location.name
      })),
    [locations]
  );
  const catalogSkuVariantMeta = useMemo(
    () =>
      catalogEntries.flatMap((product) =>
        product.variants.map((variant) => ({
          skuId: variant.skuId,
          source: variant.source as InventorySource,
          kit: variant.kit,
          ageGroup: variant.ageGroup,
          gender: variant.gender,
          role: variant.role,
          quality: variant.quality
        }))
      ),
    [catalogEntries]
  );
  const rulesSkuOptions = useMemo(
    () =>
      ALL_SKUS.filter((sku) => sku.source === ruleCenterForm.source).map((sku) => ({
        id: sku.id,
        label: `${sku.id} · ${sku.name}`
      })),
    [ruleCenterForm.source]
  );
  const rulesAttrKitOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogSkuVariantMeta
            .filter((entry) => entry.source === ruleCenterForm.source)
            .map((entry) => entry.kit)
            .filter((value): value is CatalogKitValue => value !== undefined)
        )
      ),
    [catalogSkuVariantMeta, ruleCenterForm.source]
  );
  const rulesAttrAgeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogSkuVariantMeta
            .filter((entry) => entry.source === ruleCenterForm.source)
            .map((entry) => entry.ageGroup)
            .filter((value): value is CatalogAgeGroupValue => value !== undefined)
        )
      ),
    [catalogSkuVariantMeta, ruleCenterForm.source]
  );
  const rulesAttrGenderOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogSkuVariantMeta
            .filter((entry) => entry.source === ruleCenterForm.source)
            .map((entry) => entry.gender)
            .filter((value): value is CatalogGenderValue => value !== undefined)
        )
      ),
    [catalogSkuVariantMeta, ruleCenterForm.source]
  );
  const rulesAttrRoleOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogSkuVariantMeta
            .filter((entry) => entry.source === ruleCenterForm.source)
            .map((entry) => entry.role)
            .filter((value): value is CatalogRoleValue => value !== undefined)
        )
      ),
    [catalogSkuVariantMeta, ruleCenterForm.source]
  );
  const rulesAttrQualityOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogSkuVariantMeta
            .filter((entry) => entry.source === ruleCenterForm.source)
            .map((entry) => entry.quality)
            .filter((value): value is CatalogQualityValue => value !== undefined)
        )
      ),
    [catalogSkuVariantMeta, ruleCenterForm.source]
  );
  const ruleCenterMatchedSkuIds = useMemo(() => {
    if (ruleCenterForm.selectorMode === "SKU") {
      return ruleCenterForm.skuId ? [ruleCenterForm.skuId] : [];
    }
    return Array.from(
      new Set(
        catalogSkuVariantMeta
          .filter((entry) => entry.source === ruleCenterForm.source)
          .filter((entry) => (ruleCenterForm.kit ? entry.kit === ruleCenterForm.kit : true))
          .filter((entry) => (ruleCenterForm.ageGroup ? entry.ageGroup === ruleCenterForm.ageGroup : true))
          .filter((entry) => (ruleCenterForm.gender ? entry.gender === ruleCenterForm.gender : true))
          .filter((entry) => (ruleCenterForm.role ? entry.role === ruleCenterForm.role : true))
          .filter((entry) => (ruleCenterForm.quality ? entry.quality === ruleCenterForm.quality : true))
          .map((entry) => entry.skuId)
      )
    );
  }, [
    catalogSkuVariantMeta,
    ruleCenterForm.selectorMode,
    ruleCenterForm.skuId,
    ruleCenterForm.source,
    ruleCenterForm.kit,
    ruleCenterForm.ageGroup,
    ruleCenterForm.gender,
    ruleCenterForm.role,
    ruleCenterForm.quality
  ]);
  const filteredRuleTemplates = useMemo(
    () =>
      ruleTemplates.filter((entry) => {
        if (rulesLocationFilter !== "all") {
          if (entry.scope === "LOCATION" && entry.zoneId !== rulesLocationFilter) return false;
          if (entry.scope === "GENERIC") return false;
        }
        return true;
      }),
    [ruleTemplates, rulesLocationFilter]
  );

  const activeStaff = useMemo(() => staff.filter((member) => member.activeShift), [staff]);
  const activeRunnerStaff = useMemo(
    () => staff.filter((member) => member.activeShift && member.role === "ASSOCIATE"),
    [staff]
  );
  const runnerDefaultStaffId = useMemo(() => {
    if (activeRunnerStaff[0]) return activeRunnerStaff[0].id;
    const anyActive = staff.find((member) => member.activeShift);
    if (anyActive) return anyActive.id;
    return staff[0]?.id ?? "";
  }, [activeRunnerStaff, staff]);
  useEffect(() => {
    if (!runnerDefaultStaffId) {
      if (runnerStaffId) setRunnerStaffId("");
      return;
    }
    const exists = staff.some((member) => member.id === runnerStaffId);
    if (!runnerStaffId || !exists) {
      setRunnerStaffId(runnerDefaultStaffId);
    }
  }, [runnerDefaultStaffId, runnerStaffId, staff]);
  const runnerStaffMember = useMemo(
    () => staff.find((member) => member.id === runnerStaffId) ?? null,
    [staff, runnerStaffId]
  );
  const managerSessionUser = useMemo(
    () =>
      staff.find((member) => member.activeShift && member.role === "SUPERVISOR") ??
      staff.find((member) => member.activeShift) ??
      staff[0] ??
      null,
    [staff]
  );
  const signedInStaffMember = useMemo(() => {
    if (!signedInStaffId) return null;
    return (
      staff.find((member) => member.id === signedInStaffId && member.activeShift && member.role === "ASSOCIATE") ??
      null
    );
  }, [signedInStaffId, staff]);
  useEffect(() => {
    if (!signedInStaffId) return;
    if (!signedInStaffMember) {
      setSignedInStaffId("");
    }
  }, [signedInStaffId, signedInStaffMember]);
  const currentSessionUser = useMemo(() => {
    if (signedInStaffMember) return signedInStaffMember;
    if (appDisplayMode === "staff" && runnerStaffMember) return runnerStaffMember;
    return managerSessionUser;
  }, [appDisplayMode, managerSessionUser, runnerStaffMember, signedInStaffMember]);
  const currentSessionRoleLabel = currentSessionUser
    ? currentSessionUser.role === "SUPERVISOR"
      ? t(lang, "accountRoleSupervisor")
      : t(lang, "accountRoleAssociate")
    : "";
  const effectiveMainContentView: MainContentView | "runner" =
    appDisplayMode === "staff" ? "runner" : mainContentView;
  const runnerAssignedTaskRows = useMemo(() => {
    if (!runnerStaffMember) return [];
    return unifiedTaskRows.filter(
      (row) => {
        if (!row.isOpen) return false;
        if (row.assignedStaffId === runnerStaffMember.id) return true;
        if (row.assignedStaffId) return false;
        return runnerStaffMember.scopeAllZones || runnerStaffMember.zoneScopeZoneIds.includes(row.locationId);
      }
    );
  }, [unifiedTaskRows, runnerStaffMember]);
  const runnerTaskSummary = useMemo(() => {
    return runnerAssignedTaskRows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.status === "CREATED" || row.status === "ASSIGNED") acc.pending += 1;
        if (row.status === "IN_PROGRESS") acc.inProgress += 1;
        if (row.status === "IN_TRANSIT") acc.inTransit += 1;
        return acc;
      },
      { total: 0, pending: 0, inProgress: 0, inTransit: 0 }
    );
  }, [runnerAssignedTaskRows]);
  const isTaskRecentlyAssigned = (taskKey: string): boolean => {
    const startedAt = recentAssignedTaskFx[taskKey];
    return startedAt !== undefined && animationTick - startedAt <= TASK_ASSIGNMENT_FLASH_MS;
  };

  useEffect(() => {
    const nextAssignedByTask: Record<string, string> = {};
    const justAssignedRows: Array<(typeof unifiedTaskRows)[number]> = [];

    for (const row of unifiedTaskRows) {
      const taskKey = getUnifiedTaskKey(row);
      const assignedStaffId = row.isOpen ? row.assignedStaffId ?? "" : "";
      if (!assignedStaffId) continue;
      nextAssignedByTask[taskKey] = assignedStaffId;
      const previousAssignedStaffId = prevTaskAssigneeRef.current[taskKey];
      if (hasTaskAssigneeSnapshotRef.current && previousAssignedStaffId !== assignedStaffId) {
        justAssignedRows.push(row);
      }
    }

    prevTaskAssigneeRef.current = nextAssignedByTask;
    if (!hasTaskAssigneeSnapshotRef.current) {
      hasTaskAssigneeSnapshotRef.current = true;
      return;
    }
    if (justAssignedRows.length === 0) return;

    const now = Date.now();
    const ownRunnerId = runnerStaffMember?.id ?? "";
    const fxBatch: Record<string, number> = {};
    const toastBatch: TaskAssignmentNotice[] = [];

    for (const row of justAssignedRows) {
      const taskKey = getUnifiedTaskKey(row);
      const assignedStaffId = row.assignedStaffId;
      if (!assignedStaffId) continue;
      fxBatch[taskKey] = now;
      const isOwnRunnerTask = ownRunnerId.length > 0 && assignedStaffId === ownRunnerId;
      const shouldShowToast = appDisplayMode === "admin" || (appDisplayMode === "staff" && isOwnRunnerTask);
      if (!shouldShowToast) continue;
      const typeLabel =
        row.type === "REPLENISHMENT"
          ? t(lang, "taskFilterTypeReplenishment")
          : t(lang, "taskFilterTypeReceiving");
      const detailBase = t(lang, "taskAssignedToastDetail", {
        type: typeLabel,
        skuId: row.skuId,
        locationName: row.locationName
      });
      const assigneeName = staffNameById.get(assignedStaffId) ?? assignedStaffId;
      const detail =
        appDisplayMode === "admin" && !isOwnRunnerTask
          ? `${detailBase} · ${t(lang, "assigned")}: ${assigneeName}`
          : detailBase;
      toastBatch.push({
        id: `${taskKey}-${now}-${toastBatch.length}`,
        taskKey,
        title: isOwnRunnerTask ? t(lang, "taskAssignedRunnerTitle") : t(lang, "taskAssignedAdminTitle"),
        detail,
        tone: isOwnRunnerTask ? "runner" : "admin",
        startedAt: now
      });
    }

    if (Object.keys(fxBatch).length > 0) {
      setRecentAssignedTaskFx((current) => ({ ...current, ...fxBatch }));
    }
    if (toastBatch.length > 0) {
      setTaskAssignmentNotices((current) => [...toastBatch, ...current].slice(0, 4));
    }
  }, [unifiedTaskRows, runnerStaffMember, appDisplayMode, staffNameById, lang]);
  const zoneOrder = useMemo(() => locations.map((zone) => zone.id as InventoryZoneId), [locations]);
  const hasMinMaxRulesByZone = useMemo(() => {
    const byZone = new Map<string, boolean>();
    for (const rule of rules) {
      if (!rule.isActive) continue;
      byZone.set(rule.zoneId, true);
    }
    return byZone;
  }, [rules]);
  const analyticsData = useMemo(() => {
    const allTasks = tasks.tasks;
    const statusCounts: Record<"CREATED" | "ASSIGNED" | "IN_PROGRESS" | "CONFIRMED" | "REJECTED", number> = {
      CREATED: 0,
      ASSIGNED: 0,
      IN_PROGRESS: 0,
      CONFIRMED: 0,
      REJECTED: 0
    };
    for (const task of allTasks) {
      statusCounts[task.status] += 1;
    }

    const queueUnassigned = tasks.tasks.filter((task) => task.status === "CREATED").length;
    const openInProgress = allTasks.filter((task) => task.status === "IN_PROGRESS").length;
    const openBlocked = allTasks.filter((task) => {
      if (task.status !== "CREATED" && task.status !== "ASSIGNED" && task.status !== "IN_PROGRESS") return false;
      if (!task.sourceCandidates || task.sourceCandidates.length === 0) return true;
      return task.sourceCandidates.every((candidate) => candidate.availableQty <= 0);
    }).length;
    const confirmedTasks = allTasks.filter(
      (task) => task.closeReason?.startsWith("confirmed") && (task.confirmedQty ?? 0) > 0
    );
    const partialConfirmedCount = allTasks.filter((task) => task.closeReason === "confirmed_partial").length;

    const confirmDurations = confirmedTasks
      .map((task) => {
        const assignedAtMs = toTimestampMs(task.assignedAt);
        const closedAtMs = toTimestampMs(task.closedAt);
        if (assignedAtMs === null || closedAtMs === null || closedAtMs <= assignedAtMs) return null;
        return (closedAtMs - assignedAtMs) / 1000;
      })
      .filter((value): value is number => value !== null);

    const avgConfirmSeconds =
      confirmDurations.length === 0
        ? null
        : confirmDurations.reduce((sum, value) => sum + value, 0) / confirmDurations.length;

    const skuMap = new Map<
      string,
      { skuId: string; taskCount: number; totalDeficit: number; totalConfirmed: number; confirmDurations: number[] }
    >();
    for (const task of allTasks) {
      const current =
        skuMap.get(task.skuId) ??
        { skuId: task.skuId, taskCount: 0, totalDeficit: 0, totalConfirmed: 0, confirmDurations: [] };
      current.taskCount += 1;
      current.totalDeficit += Math.max(0, task.deficitQty);
      current.totalConfirmed += Math.max(0, task.confirmedQty ?? 0);
      if (task.closeReason?.startsWith("confirmed")) {
        const assignedAtMs = toTimestampMs(task.assignedAt);
        const closedAtMs = toTimestampMs(task.closedAt);
        if (assignedAtMs !== null && closedAtMs !== null && closedAtMs > assignedAtMs) {
          current.confirmDurations.push((closedAtMs - assignedAtMs) / 1000);
        }
      }
      skuMap.set(task.skuId, current);
    }

    const skuStats = [...skuMap.values()]
      .map((entry) => ({
        skuId: entry.skuId,
        taskCount: entry.taskCount,
        totalDeficit: entry.totalDeficit,
        totalConfirmed: entry.totalConfirmed,
        avgConfirmSeconds:
          entry.confirmDurations.length === 0
            ? null
            : entry.confirmDurations.reduce((sum, value) => sum + value, 0) / entry.confirmDurations.length
      }))
      .sort((a, b) => b.totalConfirmed - a.totalConfirmed || b.taskCount - a.taskCount);

    const movementByZone = new Map<
      string,
      { zoneId: string; confirmedQty: number; confirmedTasks: number; openDemandQty: number }
    >();
    for (const zone of locations) {
      movementByZone.set(zone.id, {
        zoneId: zone.id,
        confirmedQty: 0,
        confirmedTasks: 0,
        openDemandQty: 0
      });
    }
    for (const task of allTasks) {
      const current =
        movementByZone.get(task.zoneId) ??
        { zoneId: task.zoneId, confirmedQty: 0, confirmedTasks: 0, openDemandQty: 0 };
      if (task.closeReason?.startsWith("confirmed")) {
        current.confirmedQty += Math.max(0, task.confirmedQty ?? 0);
        current.confirmedTasks += 1;
      }
      if (task.status === "CREATED" || task.status === "ASSIGNED" || task.status === "IN_PROGRESS") {
        current.openDemandQty += Math.max(0, task.deficitQty);
      }
      movementByZone.set(task.zoneId, current);
    }
    const zoneMovement = [...movementByZone.values()].sort(
      (a, b) => b.confirmedQty - a.confirmedQty || b.confirmedTasks - a.confirmedTasks
    );
    const topZoneMovement = zoneMovement[0];

    const staffStats = staff.map((member) => {
      const assigned = tasks.tasks.filter((task) => task.assignedStaffId === member.id);
      const open = assigned.filter((task) => task.status === "CREATED").length;
      const assignedOnly = assigned.filter((task) => task.status === "ASSIGNED").length;
      const inProgress = assigned.filter((task) => task.status === "IN_PROGRESS").length;
      const completed = assigned.filter((task) => task.status === "CONFIRMED").length;
      const cancelled = assigned.filter((task) => task.status === "REJECTED").length;
      const confirmed = assigned.filter((task) => task.confirmedBy === member.id).length;
      const confirmedQty = assigned.reduce((sum, task) => sum + Math.max(0, task.confirmedQty ?? 0), 0);

      const cycleSeconds = assigned
        .map((task) => {
          const assignedAtMs = toTimestampMs(task.assignedAt);
          const closedAtMs = toTimestampMs(task.closedAt);
          if (assignedAtMs === null || closedAtMs === null || closedAtMs <= assignedAtMs) return null;
          return (closedAtMs - assignedAtMs) / 1000;
        })
        .filter((value): value is number => value !== null);

      const confirmSeconds = assigned
        .filter((task) => task.confirmedBy === member.id && task.closeReason?.startsWith("confirmed"))
        .map((task) => {
          const assignedAtMs = toTimestampMs(task.assignedAt);
          const closedAtMs = toTimestampMs(task.closedAt);
          if (assignedAtMs === null || closedAtMs === null || closedAtMs <= assignedAtMs) return null;
          return (closedAtMs - assignedAtMs) / 1000;
        })
        .filter((value): value is number => value !== null);

      const avgCycleSeconds =
        cycleSeconds.length === 0 ? null : cycleSeconds.reduce((sum, value) => sum + value, 0) / cycleSeconds.length;
      const avgConfirmSeconds =
        confirmSeconds.length === 0
          ? null
          : confirmSeconds.reduce((sum, value) => sum + value, 0) / confirmSeconds.length;

      return {
        memberId: member.id,
        memberName: member.name,
        open,
        assignedOnly,
        inProgress,
        completed,
        cancelled,
        confirmed,
        confirmedQty,
        assignedTotal: assigned.length,
        avgCycleSeconds,
        avgConfirmSeconds
      };
    }).sort((a, b) => b.completed - a.completed || b.confirmedQty - a.confirmedQty);

    return {
      totalTasks: allTasks.length,
      backlog: statusCounts.CREATED + statusCounts.ASSIGNED + statusCounts.IN_PROGRESS,
      avgConfirmSeconds,
      partialConfirmedCount,
      statusCounts,
      queueUnassigned,
      openInProgress,
      openBlocked,
      skuStats,
      staffStats,
      zoneMovement,
      topZoneMovement
    };
  }, [staff, tasks.tasks, locations]);

  const selectedZoneUnits = useMemo(() => {
    const rows =
      selectedZone === "all"
        ? dashboard.zones.flatMap((zone) => zone.inventory)
        : selectedZoneSummary?.inventory ?? [];
    const total = rows.reduce((sum, row) => sum + row.qty, 0);
    const rfid = rows.filter((row) => row.source === "RFID").reduce((sum, row) => sum + row.qty, 0);
    return {
      total,
      rfid,
      nonRfid: total - rfid
    };
  }, [dashboard.zones, selectedZone, selectedZoneSummary]);

  const globalInventoryRows = useMemo(() => {
    const grouped = new Map<string, { skuId: string; source: InventorySource; qty: number }>();
    for (const zone of dashboard.zones) {
      for (const item of zone.inventory) {
        const key = `${item.skuId}::${item.source}`;
        const current = grouped.get(key) ?? { skuId: item.skuId, source: item.source, qty: 0 };
        current.qty += item.qty;
        grouped.set(key, current);
      }
    }
    return [...grouped.values()].sort((a, b) => a.skuId.localeCompare(b.skuId));
  }, [dashboard.zones]);

  const visibleInventoryRows = useMemo(() => {
    if (selectedZone === "all") {
      return globalInventoryRows.map((item) => ({ ...item, confidence: undefined as number | undefined }));
    }
    return (zoneDetail?.inventory ?? []).map((item) => ({
      skuId: item.skuId,
      source: item.source,
      qty: item.qty,
      confidence: item.confidence
    }));
  }, [globalInventoryRows, selectedZone, zoneDetail]);

  const totals = useMemo(() => {
    const totalUnits = dashboard.zones.flatMap((z) => z.inventory).reduce((sum, row) => sum + row.qty, 0);
    const rfidUnits = dashboard.zones
      .flatMap((z) => z.inventory)
      .filter((row) => row.source === "RFID")
      .reduce((sum, row) => sum + row.qty, 0);

    return {
      zones: dashboard.zones.length,
      totalUnits,
      rfidUnits,
      nonRfidUnits: totalUnits - rfidUnits,
      openTasks: openUnifiedTaskCount,
      lowStockZones: dashboard.zones.filter((z) => z.lowStockCount > 0).length
    };
  }, [dashboard, openUnifiedTaskCount]);

  const saleSkuAvailability = useMemo(() => {
    const zoneInventory = dashboard.zones.find((zone) => zone.zoneId === saleZoneId)?.inventory ?? [];
    const zoneInventoryBySku = new Map<string, number>();
    for (const sku of ALL_SKUS) {
      const source = SKU_SOURCE_BY_ID.get(sku.id) ?? "NON_RFID";
      const qty = zoneInventory.find((row) => row.skuId === sku.id && row.source === source)?.qty ?? 0;
      zoneInventoryBySku.set(sku.id, qty);
    }

    const reservedBySku = new Map<string, number>();
    for (const customer of customers) {
      const basket = api.getCustomerBasket(customer.id);
      for (const item of basket) {
        if (item.zoneId !== saleZoneId) continue;
        const source = SKU_SOURCE_BY_ID.get(item.skuId) ?? "NON_RFID";
        const reserved = source === "RFID" ? Math.max(0, item.qty - item.pickedConfirmedQty) : item.qty;
        reservedBySku.set(item.skuId, (reservedBySku.get(item.skuId) ?? 0) + reserved);
      }
    }

    return ALL_SKUS.map((sku) => {
      const currentQty = zoneInventoryBySku.get(sku.id) ?? 0;
      const reservedQty = reservedBySku.get(sku.id) ?? 0;
      const availableQty = Math.max(0, currentQty - reservedQty);
      return {
        skuId: sku.id,
        source: sku.source,
        currentQty,
        reservedQty,
        availableQty
      };
    });
  }, [dashboard.zones, saleZoneId, customers, customerBasket]);

  const availableBySku = useMemo(
    () => new Map(saleSkuAvailability.map((row) => [row.skuId, row.availableQty])),
    [saleSkuAvailability]
  );

  const maxSaleQty = availableBySku.get(saleForm.skuId) ?? 0;
  const canAddToCart =
    orderableZoneIds.includes(saleZoneId) &&
    Number.isFinite(saleForm.qty) &&
    saleForm.qty > 0 &&
    saleForm.qty <= maxSaleQty;

  const customersInProgress = useMemo(() => {
    return customers
      .map((customer) => ({
        customerId: customer.id,
        customerName: customer.name,
        items: api.getCustomerBasket(customer.id)
      }))
      .filter((entry) => entry.items.length > 0);
  }, [customers, customerBasket, flow]);

  const otherCustomersInProgress = useMemo(() => {
    return customersInProgress.filter((entry) => entry.customerId !== selectedCustomerId);
  }, [customersInProgress, selectedCustomerId]);

  const salesInProgressCount = useMemo(
    () => customersInProgress.length,
    [customersInProgress]
  );

  useEffect(() => {
    if (selectedZoneSkuOptions.length === 0) return;
    if (!selectedZoneSkuOptions.includes(ruleForm.skuId)) {
      setRuleForm((prev) => ({ ...prev, skuId: selectedZoneSkuOptions[0] }));
    }
  }, [ruleForm.skuId, selectedZoneSkuOptions]);

  useEffect(() => {
    const existing = zoneRules.find(
      (rule) => rule.skuId === ruleForm.skuId && rule.source === ruleForm.source
    );
    if (!existing) return;

    setRuleForm((prev) => {
      if (
        prev.minQty === existing.minQty &&
        prev.maxQty === existing.maxQty
      ) {
        return prev;
      }
      return {
        ...prev,
        minQty: existing.minQty,
        maxQty: existing.maxQty
      };
    });
  }, [zoneRules, ruleForm.skuId, ruleForm.source]);

  const zoneCenterById = useMemo(() => {
    const byId = new Map<string, { x: number; y: number }>();
    for (const location of locations) {
      if (location.mapPolygon.length < 3) continue;
      byId.set(location.id, polygonCenter(location.mapPolygon));
    }
    return byId;
  }, [locations]);

  const cashierCenter = zoneCenterById.get("zone-cashier") ?? { x: 1200, y: 835 };
  const entranceCenter = zoneCenterById.get("zone-entrance") ?? { x: 770, y: 1060 };

  const activeCustomerMapMarkers = useMemo(() => {
    return customersInProgress.map((entry) => {
      const marker = cartMarkers[entry.customerId];
      const startedAt = marker?.startedAt ?? animationTick;
      const originZoneId = marker?.originZoneId ?? entry.items[0]?.zoneId ?? "zone-cashier";
      const origin = zoneCenterById.get(originZoneId) ?? cashierCenter;
      const progressRaw = Math.max(0, Math.min(1, (animationTick - startedAt) / CART_TRAVEL_MS));
      const progress = 1 - Math.pow(1 - progressRaw, 2);
      return {
        id: entry.customerId,
        cartsCount: customersInProgress.length,
        progressRaw,
        x: origin.x + (cashierCenter.x - origin.x) * progress,
        y: origin.y + (cashierCenter.y - origin.y) * progress
      };
    });
  }, [customersInProgress, cartMarkers, animationTick, zoneCenterById, cashierCenter]);

  const showFinalCartBadge = useMemo(() => {
    if (activeCustomerMapMarkers.length <= 1) return false;
    return activeCustomerMapMarkers.every((marker) => marker.progressRaw >= 0.98);
  }, [activeCustomerMapMarkers]);

  const exitingCustomerMapMarkers = useMemo(() => {
    return exitMarkers.map((entry) => {
      const progressRaw = Math.max(0, Math.min(1, (animationTick - entry.startedAt) / CART_EXIT_MS));
      const progress = Math.pow(progressRaw, 0.9);
      return {
        id: entry.id,
        opacity: 1 - progressRaw,
        x: cashierCenter.x + (entranceCenter.x - cashierCenter.x) * progress,
        y: cashierCenter.y + (entranceCenter.y - cashierCenter.y) * progress
      };
    });
  }, [exitMarkers, animationTick, cashierCenter, entranceCenter]);

  const replenishmentFlowMarkers = useMemo(() => {
    return tasks.tasks
      .filter((task) => task.sourceZoneId && task.status !== "REJECTED")
      .map((task) => {
        const source = zoneCenterById.get(task.sourceZoneId as string);
        const destination = zoneCenterById.get(task.zoneId);
        if (!source || !destination) return null;

        const dx = destination.x - source.x;
        const dy = destination.y - source.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 6) return null;
        const ux = dx / distance;
        const uy = dy / distance;

        const x1 = source.x + ux * 22;
        const y1 = source.y + uy * 22;
        const x2 = destination.x - ux * 24;
        const y2 = destination.y - uy * 24;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const nx = -uy;
        const ny = ux;
        const seed = Number(task.id.replace(/\D/g, "")) || 1;
        const curveSign = seed % 2 === 0 ? 1 : -1;
        const curveAmp = Math.min(52, Math.max(16, distance * 0.12)) * curveSign;
        const cx = mx + nx * curveAmp;
        const cy = my + ny * curveAmp;
        const path = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

        if (task.status === "CONFIRMED") {
          const startedAt = confirmedReplenishmentFx[task.id];
          if (!startedAt) return null;
          const elapsed = animationTick - startedAt;
          if (elapsed > REPLENISHMENT_CONFIRM_FADE_MS) return null;
          return {
            id: task.id,
            x1,
            y1,
            x2,
            y2,
            cx,
            cy,
            path,
            opacity: Math.max(0, 1 - elapsed / REPLENISHMENT_CONFIRM_FADE_MS),
            status: "confirmed" as const,
            progress: 0
          };
        }

        if (task.status === "IN_PROGRESS") {
          const phase = ((animationTick + seed * 137) % REPLENISHMENT_TRAVEL_MS) / REPLENISHMENT_TRAVEL_MS;
          return { id: task.id, x1, y1, x2, y2, cx, cy, path, opacity: 1, status: "moving" as const, progress: phase };
        }

        if (task.status === "CREATED" || task.status === "ASSIGNED") {
          const pendingPhase = ((animationTick + seed * 173) % (REPLENISHMENT_TRAVEL_MS * 1.9)) / (REPLENISHMENT_TRAVEL_MS * 1.9);
          return { id: task.id, x1, y1, x2, y2, cx, cy, path, opacity: 1, status: "pending" as const, progress: pendingPhase };
        }

        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [tasks.tasks, zoneCenterById, confirmedReplenishmentFx, animationTick]);

  const legendFlowMarkers = useMemo(() => {
    const x1 = 2;
    const y1 = 12;
    const cx = 26;
    const cy = 2;
    const x2 = 54;
    const y2 = 8;
    const pendingPhase = (animationTick % (REPLENISHMENT_TRAVEL_MS * 1.9)) / (REPLENISHMENT_TRAVEL_MS * 1.9);
    const movingPhase = (animationTick % REPLENISHMENT_TRAVEL_MS) / REPLENISHMENT_TRAVEL_MS;
    const pendingTrailStart = Math.max(0, pendingPhase - 0.2);
    const pendingFadeStart = Math.max(0, pendingTrailStart - 0.12);
    const movingTrailStart = Math.max(0, movingPhase - 0.26);
    const movingFadeStart = Math.max(0, movingTrailStart - 0.16);

    return {
      pending: {
        fadePath: buildQuadraticSegmentPath(x1, y1, cx, cy, x2, y2, pendingFadeStart, pendingTrailStart, 12),
        trailPath: buildQuadraticSegmentPath(x1, y1, cx, cy, x2, y2, pendingTrailStart, pendingPhase, 12),
        arrow: buildArrowPolygonOnQuadratic(x1, y1, cx, cy, x2, y2, pendingPhase)
      },
      moving: {
        fadePath: buildQuadraticSegmentPath(x1, y1, cx, cy, x2, y2, movingFadeStart, movingTrailStart, 12),
        trailPath: buildQuadraticSegmentPath(x1, y1, cx, cy, x2, y2, movingTrailStart, movingPhase, 12),
        arrow: buildArrowPolygonOnQuadratic(x1, y1, cx, cy, x2, y2, movingPhase)
      },
      confirmed: {
        path: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`,
        arrow: buildArrowPolygonOnQuadratic(x1, y1, cx, cy, x2, y2, 1)
      }
    };
  }, [animationTick]);

  useEffect(() => {
    const now = Date.now();
    const prev = prevTaskStatusRef.current;
    const next: Record<string, string> = {};
    const justConfirmed: Record<string, number> = {};

    for (const task of tasks.tasks) {
      next[task.id] = task.status;
      if (task.status === "CONFIRMED" && prev[task.id] !== "CONFIRMED") {
        justConfirmed[task.id] = now;
      }
    }

    prevTaskStatusRef.current = next;
    if (Object.keys(justConfirmed).length > 0) {
      setConfirmedReplenishmentFx((current) => ({ ...current, ...justConfirmed }));
    }
  }, [tasks.tasks]);

  useEffect(() => {
    setConfirmedReplenishmentFx((current) => {
      const next = { ...current };
      let changed = false;
      for (const [taskId, startedAt] of Object.entries(current)) {
        if (animationTick - startedAt > REPLENISHMENT_CONFIRM_FADE_MS + 180) {
          delete next[taskId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setRecentAssignedTaskFx((current) => {
      const next = { ...current };
      let changed = false;
      for (const [taskKey, startedAt] of Object.entries(current)) {
        if (animationTick - startedAt > TASK_ASSIGNMENT_FLASH_MS + 180) {
          delete next[taskKey];
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setTaskAssignmentNotices((current) => {
      const next = current.filter((entry) => animationTick - entry.startedAt <= TASK_ASSIGNMENT_NOTICE_MS);
      return next.length === current.length ? current : next;
    });
  }, [animationTick]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerBasket([]);
      return;
    }
    setCustomerBasket(api.getCustomerBasket(selectedCustomerId));
  }, [selectedCustomerId]);

  useEffect(() => {
    if (customers.length === 0) {
      if (selectedCustomerId !== "") setSelectedCustomerId("");
      return;
    }
    if (!selectedCustomerId || !customers.some((entry) => entry.id === selectedCustomerId)) {
      setSelectedCustomerId(customers[0].id);
    }
  }, [customers, selectedCustomerId]);

  useEffect(() => {
    const activeByCustomer = new Map(
      customersInProgress.map((entry) => [entry.customerId, entry] as const)
    );

    setCartMarkers((prev) => {
      const next: Record<string, CartMarkerAnimation> = {};
      const now = Date.now();
      for (const [customerId, entry] of activeByCustomer.entries()) {
        const existing = prev[customerId];
        const originZoneId = existing?.originZoneId ?? entry.items[0]?.zoneId ?? "zone-cashier";
        next[customerId] = existing ?? {
          customerId,
          customerName: entry.customerName,
          originZoneId,
          startedAt: now
        };
      }
      return next;
    });
  }, [customersInProgress]);

  useEffect(() => {
    const timer = window.setInterval(() => setAnimationTick(Date.now()), 120);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (exitMarkers.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setExitMarkers((prev) => prev.filter((entry) => now - entry.startedAt < CART_EXIT_MS + 200));
    }, 120);
    return () => window.clearInterval(timer);
  }, [exitMarkers]);

  useEffect(() => {
    if (selectedZone !== "all") {
      setSaleZoneId(selectedZone);
    }
  }, [selectedZone]);

  useEffect(() => {
    if (orderableZoneIds.length === 0) return;
    if (!orderableZoneIds.includes(saleZoneId)) {
      setSaleZoneId(orderableZoneIds[0]);
    }
  }, [orderableZoneIds, saleZoneId]);

  useEffect(() => {
    if (locations.length === 0) return;
    if (!locations.some((zone) => zone.id === rfidSweepZoneId)) {
      setRfidSweepZoneId(locations[0].id);
    }
  }, [locations, rfidSweepZoneId]);

  useEffect(() => {
    if (!autoSweepEnabled) return;
    setAutoSweepRemainingSec(AUTO_SWEEP_INTERVAL_SEC);
  }, [autoSweepEnabled]);

  useEffect(() => {
    if (taskHubLocationFilters.length === 0) return;
    const allowedIds = new Set(taskHubDestinationLocationOptions.map((option) => option.id));
    setTaskHubLocationFilters((prev) => {
      const next = prev.filter((id) => allowedIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [taskHubDestinationLocationOptions, taskHubLocationFilters]);

  useEffect(() => {
    const currentAvailable = availableBySku.get(saleForm.skuId) ?? 0;
    if (saleForm.qty > currentAvailable && currentAvailable > 0) {
      setSaleForm((prev) => ({ ...prev, qty: currentAvailable }));
    }
  }, [saleForm.skuId, saleForm.qty, saleSkuAvailability, availableBySku]);

  useEffect(() => {
    if (ruleCenterForm.selectorMode !== "SKU") return;
    if (rulesSkuOptions.length === 0) return;
    if (!rulesSkuOptions.some((option) => option.id === ruleCenterForm.skuId)) {
      setRuleCenterForm((prev) => ({ ...prev, skuId: rulesSkuOptions[0].id }));
    }
  }, [ruleCenterForm.selectorMode, ruleCenterForm.skuId, rulesSkuOptions]);

  useEffect(() => {
    if (!selectedLocation) return;
    const allowedSourceIds = new Set(
      selectedLocation.isSalesLocation
        ? locations.filter((zone) => zone.id !== selectedLocation.id).map((zone) => zone.id)
        : receivingLocations.external.map((entry) => entry.id)
    );
    setZoneEditForm({
      name: selectedLocation.name,
      color: selectedLocation.color,
      isSalesLocation: selectedLocation.isSalesLocation
    });
    setPreviewZoneColor(null);
    setSourceEditor(
      [...selectedLocation.replenishmentSources]
        .filter((source) => allowedSourceIds.has(source.sourceZoneId))
        .sort((a, b) => a.sortOrder - b.sortOrder)
    );
    setDraftPolygon([...selectedLocation.mapPolygon]);
  }, [selectedLocation, locations, receivingLocations.external]);

  useEffect(() => {
    if (sourceEditorOptions.length === 0) {
      if (sourceEditor.length > 0) setSourceEditor([]);
      return;
    }
    const allowed = new Set(sourceEditorOptions.map((entry) => entry.id));
    const filtered = sourceEditor.filter((entry) => allowed.has(entry.sourceZoneId));
    if (filtered.length !== sourceEditor.length) {
      setSourceEditor(filtered.map((entry, index) => ({ ...entry, sortOrder: index + 1 })));
    }
  }, [sourceEditor, sourceEditorOptions]);

  useEffect(() => {
    if (showZoneDrawer && zoneDrawerSection === "settings") return;
    setPreviewZoneColor(null);
    if (!selectedLocation) return;
    setZoneEditForm((prev) =>
      prev.color === selectedLocation.color ? prev : { ...prev, color: selectedLocation.color }
    );
  }, [showZoneDrawer, zoneDrawerSection, selectedLocation]);

  useEffect(() => {
    localStorage.setItem("sim-lang", lang);
  }, [lang]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent): void {
      if (!showHeaderMenu && !showSessionMenu) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (headerMenuRef.current?.contains(target)) return;
      if (sessionMenuRef.current?.contains(target)) return;
      setShowHeaderMenu(false);
      setShowSessionMenu(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [showHeaderMenu, showSessionMenu]);

  function refresh(zone: ZoneScope = selectedZone): void {
    setDashboard(api.getInventoryZones());
    setLocations(api.getLocations());
    setStaff(api.getStaff());
    setTasks(api.getReplenishmentTasks());
    setCatalogEntries(api.getCatalog());
    setReceivingOrders(api.getReceivingOrders());
    setReceivingLocations(api.getReceivingLocations());
    setZoneDetail(zone === "all" ? null : api.getInventoryZoneById(zone));
    setRules(api.getRules());
    setRuleTemplates(api.getMinMaxRuleTemplates());
    setFlow(api.getFlowEvents());
    setTaskAudit(api.getTaskAudit());
    setCustomers(api.getCustomers());
    setCustomerBasket(api.getCustomerBasket(selectedCustomerId));
  }

  function selectZone(zone: ZoneScope): void {
    setPreviewZoneColor(null);
    setSelectedZone(zone);
    refresh(zone);
  }

  function selectZoneFromMapInteraction(zoneId: InventoryZoneId): void {
    if (suppressMapClickRef.current) {
      suppressMapClickRef.current = false;
      return;
    }
    if (mapEditMode) return;
    selectZone(zoneId);
    openZoneDrawer("inventory");
  }

  function openZoneDrawer(section: ZoneDrawerSection): void {
    if (section !== "settings") {
      setPreviewZoneColor(null);
    }
    setShowSalesDrawer(false);
    setShowRfidDrawer(false);
    setZoneDrawerSection(section);
    setShowZoneDrawer(true);
  }

  function closeZoneDrawer(): void {
    setShowZoneDrawer(false);
    if (createMode) {
      setCreateMode(false);
      setMapEditMode(false);
      setNewZonePolygon([]);
      releaseDragVertex();
      return;
    }
    if (mapEditMode) {
      setMapEditMode(false);
      releaseDragVertex();
    }
  }

  function openStaffMainView(): void {
    setMainContentView("staff");
    setShowHeaderMenu(false);
    closeZoneDrawer();
  }

  function openAnalyticsMainView(): void {
    setMainContentView("analytics");
    setShowHeaderMenu(false);
    closeZoneDrawer();
  }

  function openCatalogMainView(): void {
    setMainContentView("catalog");
    setShowHeaderMenu(false);
    closeZoneDrawer();
  }

  function openTasksMainView(): void {
    setMainContentView("tasks");
    setShowHeaderMenu(false);
    closeZoneDrawer();
  }

  function openRulesMainView(): void {
    setMainContentView("rules");
    setShowHeaderMenu(false);
    closeZoneDrawer();
  }

  function openMapMainView(): void {
    setMainContentView("map");
    setShowHeaderMenu(false);
  }

  function openAdminDisplayView(): void {
    setAppDisplayMode("admin");
    setSignedInStaffId("");
    setShowHeaderMenu(false);
    setShowSessionMenu(false);
  }

  function openStaffDisplayView(): void {
    setAppDisplayMode("staff");
    setShowHeaderMenu(false);
    setShowSessionMenu(false);
    closeZoneDrawer();
    setShowSalesDrawer(false);
    setShowRfidDrawer(false);
  }

  function signInAsStaff(staffId: string): void {
    const selected = activeRunnerStaff.find((member) => member.id === staffId);
    if (!selected) return;
    setRunnerStaffId(selected.id);
    setSignedInStaffId(selected.id);
    setAppDisplayMode("staff");
    setShowSessionMenu(false);
    setShowHeaderMenu(false);
    closeZoneDrawer();
    setShowSalesDrawer(false);
    setShowRfidDrawer(false);
  }

  function signInAsManager(): void {
    setSignedInStaffId("");
    setAppDisplayMode("admin");
    setShowSessionMenu(false);
    setShowHeaderMenu(false);
    closeZoneDrawer();
    setShowSalesDrawer(false);
    setShowRfidDrawer(false);
  }

  function signOutSession(): void {
    setShowSessionMenu(false);
    setShowHeaderMenu(false);
    setSignedInStaffId("");
    setMainContentView("map");
    closeZoneDrawer();
    setShowSalesDrawer(false);
    setShowRfidDrawer(false);
    setAppDisplayMode("admin");
    setRunnerStaffId(runnerDefaultStaffId);
  }

  function zoomInMap(): void {
    setMapZoom((prev) => Math.min(2.5, Number((prev + 0.2).toFixed(2))));
  }

  function zoomOutMap(): void {
    setMapZoom((prev) => Math.max(0.8, Number((prev - 0.2).toFixed(2))));
  }

  function resetMapZoom(): void {
    setMapZoom(1);
    setMapPan({ x: 0, y: 0 });
    setIsMapPanning(false);
    setMapPanStart(null);
    suppressMapClickRef.current = false;
    const viewport = mapViewportRef.current;
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
    requestAnimationFrame(() => {
      setMapPan({ x: 0, y: 0 });
    });
  }

  function onMapWheelZoom(evt: ReactWheelEvent<HTMLDivElement>): void {
    evt.preventDefault();
    evt.stopPropagation();
    const delta = evt.deltaY > 0 ? -0.1 : 0.1;
    setMapZoom((prev) => {
      const next = Number((prev + delta).toFixed(2));
      return Math.max(0.8, Math.min(2.5, next));
    });
  }

  function clampMapPan(nextX: number, nextY: number): { x: number; y: number } {
    if (mapZoom <= 1) return { x: 0, y: 0 };
    const viewport = mapViewportRef.current;
    if (!viewport) return { x: nextX, y: nextY };

    const minX = -(viewport.clientWidth * (mapZoom - 1));
    const minY = -(viewport.clientHeight * (mapZoom - 1));

    return {
      x: Math.max(minX, Math.min(0, nextX)),
      y: Math.max(minY, Math.min(0, nextY))
    };
  }

  function startMapPan(evt: ReactPointerEvent<HTMLDivElement>): void {
    if (evt.button !== 0) return;
    if (mapZoom <= 1) return;
    if (mapEditMode) return;
    if (isDraggingVertex) return;
    if (evt.target instanceof Element && evt.target.closest(".map-zoom-controls")) return;
    evt.currentTarget.setPointerCapture(evt.pointerId);
    setIsMapPanning(true);
    setMapPanStart({
      x: evt.clientX,
      y: evt.clientY,
      originX: mapPan.x,
      originY: mapPan.y
    });
  }

  function moveMapPan(evt: ReactPointerEvent<HTMLDivElement>): void {
    if (!isMapPanning || !mapPanStart) return;
    const dx = evt.clientX - mapPanStart.x;
    const dy = evt.clientY - mapPanStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      suppressMapClickRef.current = true;
    }
    setMapPan(clampMapPan(mapPanStart.originX + dx, mapPanStart.originY + dy));
  }

  function endMapPan(): void {
    setIsMapPanning(false);
    setMapPanStart(null);
  }

  useEffect(() => {
    if (mapZoom <= 1) {
      setMapPan({ x: 0, y: 0 });
      return;
    }
    setMapPan((prev) => clampMapPan(prev.x, prev.y));
  }, [mapZoom]);

  function eventTs(offsetSec = 0): string {
    const base = new Date(dashboard.asOf).getTime();
    return new Date(base + offsetSec * 1000).toISOString();
  }

  function createAutoCustomer(
    timestamp = eventTs(8),
    refreshAfter = true
  ): { id: string; name: string } {
    const maxSeq = customers.reduce((max, customer) => Math.max(max, parseCustomerSeq(customer.id)), 0);
    const nextSeq = maxSeq + 1;
    const id = `cust-${String(nextSeq).padStart(3, "0")}`;
    const name = `Customer ${String(nextSeq).padStart(3, "0")}`;
    const created = api.upsertCustomer({ id, name, timestamp });
    setSelectedCustomerId(created.id);
    setCustomerBasket(api.getCustomerBasket(created.id));
    if (refreshAfter) {
      refresh();
    }
    return created;
  }

  function resetSalesFormOnOpen(): void {
    const defaultZoneId = salesEnabledLocations[0]?.id ?? "zone-shelf-a";
    const zoneInventory = dashboard.zones.find((zone) => zone.zoneId === defaultZoneId)?.inventory ?? [];
    const defaultSkuId =
      ALL_SKUS.find((sku) => {
        const source = SKU_SOURCE_BY_ID.get(sku.id) ?? "NON_RFID";
        const qty = zoneInventory.find((row) => row.skuId === sku.id && row.source === source)?.qty ?? 0;
        return qty > 0;
      })?.id ??
      ALL_SKUS[0]?.id ??
      "SKU-NR-1";

    setSelectedCustomerId("");
    setCustomerBasket([]);
    setSaleZoneId(defaultZoneId);
    setSaleForm({ skuId: defaultSkuId, qty: 1 });
    setSalesStatusMessage("");
  }

  function injectRFIDPulse(): void {
    const antenna = rfidCatalog.antennas.find((entry) => entry.id === rfidForm.antennaId);
    if (!antenna || !rfidForm.epc) return;
    api.postRFIDRead({
      id: `rr-live-${Date.now()}`,
      epc: rfidForm.epc,
      antennaId: antenna.id,
      zoneId: antenna.zoneId,
      timestamp: eventTs(5),
      rssi: Number(rfidForm.rssi),
      ingestedAt: eventTs(5)
    });
    refresh();
  }

  function forceRfidZoneSweep(): void {
    if (!rfidSweepZoneId) return;
    api.postRFIDZoneSweep({
      zoneId: rfidSweepZoneId,
      timestamp: eventTs(6)
    });
    refresh();
  }

  function runAutomaticRfidSweep(): void {
    if (locations.length === 0) return;
    const baseMs = Date.now();
    locations.forEach((zone, index) => {
      const timestamp = new Date(baseMs + index).toISOString();
      api.postRFIDZoneSweep({
        zoneId: zone.id,
        timestamp
      });
    });
    refresh();
  }

  useEffect(() => {
    if (!autoSweepEnabled) return;
    const timer = window.setInterval(() => {
      setAutoSweepRemainingSec((prev) => {
        if (prev <= 1) {
          runAutomaticRfidSweep();
          return AUTO_SWEEP_INTERVAL_SEC;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [autoSweepEnabled, locations, selectedZone, selectedCustomerId, dashboard.asOf]);

  function getSvgCoords(evt: ReactPointerEvent<SVGElement>): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * SHOPFLOOR_SIZE.width;
    const y = ((evt.clientY - rect.top) / rect.height) * SHOPFLOOR_SIZE.height;
    return { x: Math.max(0, Math.min(SHOPFLOOR_SIZE.width, x)), y: Math.max(0, Math.min(SHOPFLOOR_SIZE.height, y)) };
  }

  function addPolygonPoint(evt: ReactPointerEvent<SVGSVGElement>): void {
    if (!mapEditMode || isDraggingVertex) return;
    const next = getSvgCoords(evt);
    if (createMode) {
      setNewZonePolygon((prev) => [...prev, next]);
      return;
    }
    if (selectedZone === "all") return;
    setDraftPolygon((prev) => [...prev, next]);
  }

  function updateDraggedVertex(evt: ReactPointerEvent<SVGSVGElement>): void {
    if (!mapEditMode) return;
    const next = getSvgCoords(evt);
    if (createMode && dragPolygonStart && newZonePolygon.length > 0) {
      const minX = Math.min(...newZonePolygon.map((point) => point.x));
      const maxX = Math.max(...newZonePolygon.map((point) => point.x));
      const minY = Math.min(...newZonePolygon.map((point) => point.y));
      const maxY = Math.max(...newZonePolygon.map((point) => point.y));

      const dx = next.x - dragPolygonStart.x;
      const dy = next.y - dragPolygonStart.y;
      const clampedDx = Math.min(
        Math.max(dx, -minX),
        SHOPFLOOR_SIZE.width - maxX
      );
      const clampedDy = Math.min(
        Math.max(dy, -minY),
        SHOPFLOOR_SIZE.height - maxY
      );

      setNewZonePolygon((prev) =>
        prev.map((point) => ({
          x: point.x + clampedDx,
          y: point.y + clampedDy
        }))
      );
      setDragPolygonStart({
        x: dragPolygonStart.x + clampedDx,
        y: dragPolygonStart.y + clampedDy
      });
      return;
    }

    if (dragVertexIndex === null || !dragTarget) return;
    if (dragTarget === "new") {
      setNewZonePolygon((prev) => prev.map((point, idx) => (idx === dragVertexIndex ? next : point)));
      return;
    }
    setDraftPolygon((prev) => prev.map((point, idx) => (idx === dragVertexIndex ? next : point)));
  }

  function releaseDragVertex(): void {
    setDragVertexIndex(null);
    setDragTarget(null);
    setIsDraggingVertex(false);
    setDragPolygonStart(null);
  }

  function clearCurrentPolygonPoints(): void {
    if (createMode) {
      setNewZonePolygon([]);
    } else {
      setDraftPolygon([]);
    }
    releaseDragVertex();
  }

  function savePolygon(): void {
    if (selectedZone === "all" || draftPolygon.length < 3) return;
    api.updateLocation({ zoneId: selectedZone, mapPolygon: draftPolygon });
    setMapEditMode(false);
    releaseDragVertex();
    refresh(selectedZone);
  }

  function startCreateZone(): void {
    setCreateMode(true);
    setMapEditMode(true);
    setSelectedZone("all");
    setNewZonePolygon([]);
    setNewZoneForm((prev) => ({
      ...prev,
      zoneId: `zone-${Date.now().toString(36)}`,
      name: "New Zone",
      locationType: "sales"
    }));
    setShowZoneDrawer(true);
    setZoneDrawerSection("settings");
  }

  function saveNewZone(): void {
    if (newZoneForm.locationType === "external") {
      const result = api.createExternalReceivingLocation({ name: newZoneForm.name });
      setReceivingStatusMessage(`External location create: ${result.status}`);
      refresh();
      if (result.status === "created") {
        setCreateMode(false);
        setMapEditMode(false);
        setNewZonePolygon([]);
      }
      return;
    }
    if (newZonePolygon.length < 3) return;
    const result = api.createLocation({
      zoneId: newZoneForm.zoneId.trim(),
      name: newZoneForm.name,
      color: newZoneForm.color,
      isSalesLocation: newZoneForm.locationType === "sales",
      mapPolygon: newZonePolygon,
      replenishmentSources: []
    });
    refresh();
    if (result.status === "created" && result.zone) {
      setCreateMode(false);
      setMapEditMode(false);
      setNewZonePolygon([]);
      selectZone(result.zone.id);
    }
  }

  function createPosSale(forceNewCart = false): void {
    const activeCustomerId = forceNewCart
      ? createAutoCustomer(eventTs(9), false).id
      : (selectedCustomerId || createAutoCustomer(eventTs(9), false).id);
    const availableQty = availableBySku.get(saleForm.skuId) ?? 0;
    if (saleForm.qty > availableQty) {
      setSalesStatusMessage(
        t(lang, "noStock", { requested: saleForm.qty, available: availableQty })
      );
      return;
    }

    const result = api.addCustomerItem({
      customerId: activeCustomerId,
      zoneId: saleZoneId,
      skuId: saleForm.skuId,
      qty: Number(saleForm.qty),
      timestamp: eventTs(10)
    });
    if (result.status === "zone_not_orderable") {
      setSalesStatusMessage(t(lang, "zoneNotCommercial", { zoneId: saleZoneId }));
    } else if (result.status === "insufficient_inventory") {
      setSalesStatusMessage(
        t(lang, "noStock", { requested: saleForm.qty, available: result.availableQty ?? 0 })
      );
    } else {
      setSalesStatusMessage(t(lang, "itemAdded", { status: result.status }));
    }
    setSelectedCustomerId(activeCustomerId);
    setCustomerBasket(api.getCustomerBasket(activeCustomerId));
    refresh();
  }

  function checkoutCustomer(customerId = selectedCustomerId): void {
    if (!customerId) return;
    const result = api.checkoutCustomer({ customerId, timestamp: eventTs(20) });
    setSalesStatusMessage(t(lang, "checkoutResult", { status: result.status, soldItems: result.soldItems }));
    if (result.status === "checked_out" && result.soldItems > 0) {
      const customerName = customers.find((entry) => entry.id === customerId)?.name ?? customerId;
      setExitMarkers((prev) => [
        ...prev,
        {
          id: `${customerId}-${Date.now()}`,
          customerId,
          customerName,
          startedAt: Date.now()
        }
      ]);
    }
    setCustomerBasket(api.getCustomerBasket(selectedCustomerId));
    refresh();
  }

  function removeCustomerItem(basketItemId: string): void {
    const result = api.removeCustomerItem({ basketItemId, timestamp: eventTs(15) });
    setSalesStatusMessage(t(lang, "itemRemoved", { status: result.status, restoredQty: result.restoredQty }));
    setCustomerBasket(api.getCustomerBasket(selectedCustomerId));
    refresh();
  }

  function confirmReceivingOrder(orderId: string): void {
    const order = pendingReceivingOrders.find((entry) => entry.id === orderId);
    const result = api.confirmReceivingOrder({
      orderId,
      confirmedAt: eventTs(19),
      confirmedBy: order?.assignedStaffId ?? activeStaff[0]?.id ?? "receiving-operator"
    });
    setReceivingStatusMessage(
      t(lang, "receivingConfirmResult", {
        status: result.status,
        movedQty: result.movedQty ?? 0
      })
    );
    refresh();
  }

  function upsertRule(): void {
    if (selectedZone === "all") return;
    if (Number(ruleForm.maxQty) < Number(ruleForm.minQty)) return;
    api.upsertMinMaxRule({
      zoneId: selectedZone,
      skuId: ruleForm.skuId,
      source: ruleForm.source,
      minQty: Number(ruleForm.minQty),
      maxQty: Number(ruleForm.maxQty)
    });
    refresh(selectedZone);
  }

  function deleteRule(ruleId: string): void {
    const result = api.deleteRule(ruleId);
    setSalesStatusMessage(t(lang, "ruleDelete", { status: result.status }));
    refresh();
  }

  function resetRuleCenterForm(): void {
    setRuleCenterForm({
      zoneId: ALL_LOCATIONS_OPTION_ID,
      selectorMode: "SKU",
      skuId: sampleDataset.skus[0]?.id ?? "",
      source: "RFID",
      minQty: 1,
      maxQty: 4,
      priority: 1
    });
  }

  function openCreateRuleForm(): void {
    resetRuleCenterForm();
    setRulesFormMode("create");
  }

  function closeRuleForm(): void {
    resetRuleCenterForm();
    setRulesFormMode("closed");
  }

  function editRuleTemplate(template: MinMaxRuleTemplate): void {
    setRuleCenterForm({
      id: template.id,
      zoneId: template.scope === "GENERIC" ? ALL_LOCATIONS_OPTION_ID : (template.zoneId ?? ALL_LOCATIONS_OPTION_ID),
      selectorMode: template.selectorMode,
      skuId: template.skuId ?? "",
      source: template.source,
      minQty: template.minQty,
      maxQty: template.maxQty,
      priority: template.priority,
      kit: template.attributes?.kit,
      ageGroup: template.attributes?.ageGroup,
      gender: template.attributes?.gender,
      role: template.attributes?.role,
      quality: template.attributes?.quality
    });
    setRulesFormMode("edit");
  }

  function saveRuleTemplateFromCenter(): void {
    if (ruleCenterForm.maxQty < ruleCenterForm.minQty) return;
    const isGenericRule = ruleCenterForm.zoneId === ALL_LOCATIONS_OPTION_ID;
    const result = api.upsertMinMaxRuleTemplate({
      id: ruleCenterForm.id,
      scope: isGenericRule ? "GENERIC" : "LOCATION",
      zoneId: isGenericRule ? undefined : ruleCenterForm.zoneId,
      selectorMode: ruleCenterForm.selectorMode,
      skuId: ruleCenterForm.selectorMode === "SKU" ? ruleCenterForm.skuId : undefined,
      attributes:
        ruleCenterForm.selectorMode === "ATTRIBUTES"
          ? {
              kit: ruleCenterForm.kit,
              ageGroup: ruleCenterForm.ageGroup,
              gender: ruleCenterForm.gender,
              role: ruleCenterForm.role,
              quality: ruleCenterForm.quality
            }
          : undefined,
      source: ruleCenterForm.source,
      minQty: Number(ruleCenterForm.minQty),
      maxQty: Number(ruleCenterForm.maxQty),
      priority: Number(ruleCenterForm.priority)
    });
    setSalesStatusMessage(t(lang, "ruleTemplateSaveStatus", { status: result.status }));
    if (result.status === "created" || result.status === "updated") {
      closeRuleForm();
    }
    refresh();
  }

  function removeRuleTemplate(templateId: string): void {
    const result = api.deleteMinMaxRuleTemplate(templateId);
    setSalesStatusMessage(t(lang, "ruleTemplateDeleteStatus", { status: result.status }));
    refresh();
  }

  function saveLocationSettings(): void {
    if (selectedZone === "all") return;
    api.updateLocation({
      zoneId: selectedZone,
      name: zoneEditForm.name,
      color: zoneEditForm.color,
      isSalesLocation: zoneEditForm.isSalesLocation,
      replenishmentSources: sourceEditor
    });
    setPreviewZoneColor(null);
    setMapEditMode(false);
    releaseDragVertex();
    refresh(selectedZone);
  }

  function addSourceRow(): void {
    if (selectedZone === "all" || !selectedLocation) return;
    const candidates = sourceEditorOptions.filter(
      (entry) => !sourceEditor.some((source) => source.sourceZoneId === entry.id)
    );
    if (candidates.length === 0) return;
    const nextSort = sourceEditor.length + 1;
    setSourceEditor((prev) => [...prev, { sourceZoneId: candidates[0].id, sortOrder: nextSort }]);
  }

  function reorderSourceLocations(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    setSourceEditor((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next.map((entry, index) => ({ ...entry, sortOrder: index + 1 }));
    });
  }

  function onSourceDragStart(index: number): void {
    setDragSourceIndex(index);
  }

  function onSourceDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    event.preventDefault();
  }

  function onSourceDrop(targetIndex: number): void {
    if (dragSourceIndex === null) return;
    reorderSourceLocations(dragSourceIndex, targetIndex);
    setDragSourceIndex(null);
  }

  function onSourceDragEnd(): void {
    setDragSourceIndex(null);
  }

  function updateStaffZoneScope(
    staffId: string,
    scopeAllZones: boolean,
    zoneScopeZoneIds: string[]
  ): void {
    api.updateStaffScope({ staffId, scopeAllZones, zoneScopeZoneIds });
    refresh();
  }

  function confirmTask(
    taskId: string,
    deficitQty: number,
    sourceZoneId?: string,
    confirmedBy?: string
  ): void {
    api.confirmReplenishmentTask(taskId, {
      confirmedQty: deficitQty,
      confirmedBy: confirmedBy ?? activeStaff[0]?.id ?? "associate-12",
      confirmedAt: eventTs(25),
      sourceZoneId
    });
    refresh();
  }

  function startTask(taskId: string, staffId?: string): void {
    const by = staffId ?? activeStaff[0]?.id;
    if (!by) return;
    api.startTask({
      taskId,
      staffId: by,
      at: eventTs(24)
    });
    refresh();
  }

  function runRunnerTaskAction(taskRow: (typeof runnerAssignedTaskRows)[number]): void {
    if (!runnerStaffMember) return;
    if (taskRow.type === "RECEIVING") {
      if (taskRow.status === "IN_TRANSIT") {
        confirmReceivingOrder(taskRow.id);
      }
      return;
    }
    const task = replenishmentTaskById.get(taskRow.id);
    if (!task) return;
    if (taskRow.status === "CREATED" || taskRow.status === "ASSIGNED") {
      startTask(taskRow.id, runnerStaffMember.id);
      return;
    }
    if (taskRow.status === "IN_PROGRESS") {
      const selectedSource = taskSourceById[task.id] ?? task.sourceZoneId;
      const selectedSourceAvailable =
        (task.sourceCandidates ?? []).find((source) => source.sourceZoneId === selectedSource)?.availableQty ?? 0;
      if (selectedSourceAvailable <= 0) return;
      confirmTask(task.id, task.deficitQty, selectedSource, runnerStaffMember.id);
    }
  }

  function removeTaskHubFilter(key: TaskHubFilterKey): void {
    if (key === "TYPE") {
      setTaskHubTypeFilters([]);
      return;
    }
    if (key === "DESTINATION") {
      setTaskHubLocationFilters([]);
      return;
    }
    setTaskHubStatusFilters([]);
  }

  function clearTaskHubFilters(): void {
    setTaskHubTypeFilters([]);
    setTaskHubLocationFilters([]);
    setTaskHubStatusFilters([]);
    setTaskHubPendingFilterKey("");
    setTaskHubFilterSearch("");
  }

  function toggleTaskHubPendingOption(optionId: string): void {
    if (!taskHubPendingFilterKey) return;
    if (taskHubPendingFilterKey === "TYPE") {
      setTaskHubTypeFilters((prev) =>
        prev.includes(optionId as TaskTypeValue)
          ? prev.filter((value) => value !== optionId)
          : [...prev, optionId as TaskTypeValue]
      );
    } else if (taskHubPendingFilterKey === "DESTINATION") {
      setTaskHubLocationFilters((prev) =>
        prev.includes(optionId)
          ? prev.filter((value) => value !== optionId)
          : [...prev, optionId]
      );
    } else {
      setTaskHubStatusFilters((prev) =>
        prev.includes(optionId as TaskStatusValue)
          ? prev.filter((value) => value !== optionId)
          : [...prev, optionId as TaskStatusValue]
      );
    }
    // Shopify-like UX: once an option is selected, close picker and return CTA to "Add filter"
    setTaskHubPendingFilterKey("");
    setTaskHubFilterSearch("");
  }

  function isTaskHubPendingOptionSelected(optionId: string): boolean {
    if (!taskHubPendingFilterKey) return false;
    if (taskHubPendingFilterKey === "TYPE") return taskHubTypeFilters.includes(optionId as TaskTypeValue);
    if (taskHubPendingFilterKey === "DESTINATION") return taskHubLocationFilters.includes(optionId);
    return taskHubStatusFilters.includes(optionId as TaskStatusValue);
  }

  function removeCatalogFilter(key: CatalogFilterKey): void {
    if (key === "SOURCE") {
      setCatalogSourceFilters([]);
      return;
    }
    if (key === "KIT") {
      setCatalogKitFilters([]);
      return;
    }
    if (key === "AGE_GROUP") {
      setCatalogAgeGroupFilters([]);
      return;
    }
    if (key === "GENDER") {
      setCatalogGenderFilters([]);
      return;
    }
    if (key === "ROLE") {
      setCatalogRoleFilters([]);
      return;
    }
    setCatalogQualityFilters([]);
  }

  function clearCatalogFilters(): void {
    setCatalogSourceFilters([]);
    setCatalogKitFilters([]);
    setCatalogAgeGroupFilters([]);
    setCatalogGenderFilters([]);
    setCatalogRoleFilters([]);
    setCatalogQualityFilters([]);
    setCatalogPendingFilterKey("");
    setCatalogFilterSearch("");
  }

  function toggleCatalogPendingOption(optionId: string): void {
    if (!catalogPendingFilterKey) return;
    if (catalogPendingFilterKey === "SOURCE") {
      setCatalogSourceFilters((prev) =>
        prev.includes(optionId as CatalogSourceFilterValue)
          ? prev.filter((value) => value !== optionId)
          : [...prev, optionId as CatalogSourceFilterValue]
      );
    } else if (catalogPendingFilterKey === "KIT") {
      setCatalogKitFilters((prev) =>
        prev.includes(optionId as CatalogKitValue)
          ? prev.filter((value) => value !== optionId)
          : [...prev, optionId as CatalogKitValue]
      );
    } else if (catalogPendingFilterKey === "AGE_GROUP") {
      setCatalogAgeGroupFilters((prev) =>
        prev.includes(optionId as CatalogAgeGroupValue)
          ? prev.filter((value) => value !== optionId)
          : [...prev, optionId as CatalogAgeGroupValue]
      );
    } else if (catalogPendingFilterKey === "GENDER") {
      setCatalogGenderFilters((prev) =>
        prev.includes(optionId as CatalogGenderValue)
          ? prev.filter((value) => value !== optionId)
          : [...prev, optionId as CatalogGenderValue]
      );
    } else if (catalogPendingFilterKey === "ROLE") {
      setCatalogRoleFilters((prev) =>
        prev.includes(optionId as CatalogRoleValue)
          ? prev.filter((value) => value !== optionId)
          : [...prev, optionId as CatalogRoleValue]
      );
    } else {
      setCatalogQualityFilters((prev) =>
        prev.includes(optionId as CatalogQualityValue)
          ? prev.filter((value) => value !== optionId)
          : [...prev, optionId as CatalogQualityValue]
      );
    }
    // Shopify-like UX: once an option is selected, close picker and return CTA to "Add filter"
    setCatalogPendingFilterKey("");
    setCatalogFilterSearch("");
  }

  function isCatalogPendingOptionSelected(optionId: string): boolean {
    if (!catalogPendingFilterKey) return false;
    if (catalogPendingFilterKey === "SOURCE") return catalogSourceFilters.includes(optionId as CatalogSourceFilterValue);
    if (catalogPendingFilterKey === "KIT") return catalogKitFilters.includes(optionId as CatalogKitValue);
    if (catalogPendingFilterKey === "AGE_GROUP") return catalogAgeGroupFilters.includes(optionId as CatalogAgeGroupValue);
    if (catalogPendingFilterKey === "GENDER") return catalogGenderFilters.includes(optionId as CatalogGenderValue);
    if (catalogPendingFilterKey === "ROLE") return catalogRoleFilters.includes(optionId as CatalogRoleValue);
    return catalogQualityFilters.includes(optionId as CatalogQualityValue);
  }

  function focusSkuOnMap(skuId: string): void {
    setCatalogMapSkuId(skuId);
  }

  function renderRuleEditor(): JSX.Element {
    return (
      <>
        {ruleCenterForm.id ? (
          <p className="drawer-subtitle">{t(lang, "rulesHubEditing", { id: ruleCenterForm.id })}</p>
        ) : null}
        <div className="form-grid">
          <label>
            {t(lang, "rulesHubLocation")}
            <select
              value={ruleCenterForm.zoneId}
              onChange={(e) => setRuleCenterForm((prev) => ({ ...prev, zoneId: e.target.value }))}
            >
              <option value={ALL_LOCATIONS_OPTION_ID}>{t(lang, "allZonesGlobal")}</option>
              {ruleLocationOptions.map((location) => (
                <option key={`rule-location-${location.id}`} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(lang, "source")}
            <select
              value={ruleCenterForm.source}
              onChange={(e) =>
                setRuleCenterForm((prev) => ({
                  ...prev,
                  source: e.target.value as InventorySource
                }))
              }
            >
              <option value="RFID">RFID</option>
              <option value="NON_RFID">NON_RFID</option>
            </select>
          </label>
          <label>
            {t(lang, "rulesHubSelector")}
            <select
              value={ruleCenterForm.selectorMode}
              onChange={(e) =>
                setRuleCenterForm((prev) => ({
                  ...prev,
                  selectorMode: e.target.value as RuleTemplateSelectorMode
                }))
              }
            >
              <option value="SKU">{t(lang, "rulesHubSelectorSku")}</option>
              <option value="ATTRIBUTES">{t(lang, "rulesHubSelectorAttributes")}</option>
            </select>
          </label>
          {ruleCenterForm.selectorMode === "SKU" ? (
            <label>
              {t(lang, "sku")}
              <select
                value={ruleCenterForm.skuId}
                onChange={(e) => setRuleCenterForm((prev) => ({ ...prev, skuId: e.target.value }))}
              >
                {rulesSkuOptions.map((option) => (
                  <option key={`rule-sku-${option.id}`} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                {t(lang, "catalogKit")}
                <select
                  value={ruleCenterForm.kit ?? ""}
                  onChange={(e) =>
                    setRuleCenterForm((prev) => ({ ...prev, kit: (e.target.value || undefined) as CatalogKitValue | undefined }))
                  }
                >
                  <option value="">{t(lang, "any")}</option>
                  {rulesAttrKitOptions.map((value) => (
                    <option key={`rule-kit-${value}`} value={value}>{t(lang, `catalogValue_${value}`)}</option>
                  ))}
                </select>
              </label>
              <label>
                {t(lang, "catalogAgeGroup")}
                <select
                  value={ruleCenterForm.ageGroup ?? ""}
                  onChange={(e) =>
                    setRuleCenterForm((prev) => ({ ...prev, ageGroup: (e.target.value || undefined) as CatalogAgeGroupValue | undefined }))
                  }
                >
                  <option value="">{t(lang, "any")}</option>
                  {rulesAttrAgeOptions.map((value) => (
                    <option key={`rule-age-${value}`} value={value}>{t(lang, `catalogValue_${value}`)}</option>
                  ))}
                </select>
              </label>
              <label>
                {t(lang, "catalogGender")}
                <select
                  value={ruleCenterForm.gender ?? ""}
                  onChange={(e) =>
                    setRuleCenterForm((prev) => ({ ...prev, gender: (e.target.value || undefined) as CatalogGenderValue | undefined }))
                  }
                >
                  <option value="">{t(lang, "any")}</option>
                  {rulesAttrGenderOptions.map((value) => (
                    <option key={`rule-gender-${value}`} value={value}>{t(lang, `catalogValue_${value}`)}</option>
                  ))}
                </select>
              </label>
              <label>
                {t(lang, "catalogRole")}
                <select
                  value={ruleCenterForm.role ?? ""}
                  onChange={(e) =>
                    setRuleCenterForm((prev) => ({ ...prev, role: (e.target.value || undefined) as CatalogRoleValue | undefined }))
                  }
                >
                  <option value="">{t(lang, "any")}</option>
                  {rulesAttrRoleOptions.map((value) => (
                    <option key={`rule-role-${value}`} value={value}>{t(lang, `catalogValue_${value}`)}</option>
                  ))}
                </select>
              </label>
              <label>
                {t(lang, "catalogQuality")}
                <select
                  value={ruleCenterForm.quality ?? ""}
                  onChange={(e) =>
                    setRuleCenterForm((prev) => ({ ...prev, quality: (e.target.value || undefined) as CatalogQualityValue | undefined }))
                  }
                >
                  <option value="">{t(lang, "any")}</option>
                  {rulesAttrQualityOptions.map((value) => (
                    <option key={`rule-quality-${value}`} value={value}>{t(lang, `catalogValue_${value}`)}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            {t(lang, "min")}
            <input
              type="number"
              min={0}
              value={ruleCenterForm.minQty}
              onChange={(e) => setRuleCenterForm((prev) => ({ ...prev, minQty: Number(e.target.value) }))}
            />
          </label>
          <label>
            {t(lang, "max")}
            <input
              type="number"
              min={0}
              value={ruleCenterForm.maxQty}
              onChange={(e) => setRuleCenterForm((prev) => ({ ...prev, maxQty: Number(e.target.value) }))}
            />
          </label>
          <label>
            {t(lang, "rulesHubPriority")}
            <input
              type="number"
              min={1}
              max={99}
              value={ruleCenterForm.priority}
              onChange={(e) => setRuleCenterForm((prev) => ({ ...prev, priority: Number(e.target.value) }))}
            />
          </label>
        </div>
        <p className="drawer-subtitle">
          {t(lang, "rulesHubMatches", { count: ruleCenterMatchedSkuIds.length })}
        </p>
        <div className="panel-head-actions">
          <button
            className="action-btn"
            disabled={ruleCenterForm.selectorMode === "SKU" && !ruleCenterForm.skuId}
            onClick={saveRuleTemplateFromCenter}
          >
            {ruleCenterForm.id ? t(lang, "rulesHubSaveChanges") : t(lang, "applyRule")}
          </button>
          <button className="inline-btn" onClick={closeRuleForm}>{t(lang, "close")}</button>
        </div>
      </>
    );
  }

  const breadcrumbSectionLabel =
    effectiveMainContentView === "runner"
      ? t(lang, "runnerMyTasks")
      : effectiveMainContentView === "staff"
      ? t(lang, "staff")
      : effectiveMainContentView === "catalog"
        ? t(lang, "catalog")
        : effectiveMainContentView === "rules"
          ? t(lang, "rules")
          : effectiveMainContentView === "tasks"
            ? t(lang, "tasks")
            : effectiveMainContentView === "analytics"
              ? t(lang, "analytics")
              : null;

  return (
    <main className="page-shell">
      {taskAssignmentNotices.length > 0 ? (
        <section className="task-assignment-notice-stack" aria-live="polite" aria-atomic="false">
          {taskAssignmentNotices.map((notice) => (
            <article
              key={notice.id}
              className={
                "task-assignment-notice" +
                (notice.tone === "runner" ? " task-assignment-notice--runner" : "")
              }
            >
              <strong>{notice.title}</strong>
              <small>{notice.detail}</small>
            </article>
          ))}
        </section>
      ) : null}
      <section className="mode-prestep-wrap" aria-label={t(lang, "viewModeLabel")}>
        <div className="mode-prestep-dock">
          <div className="mode-prestep-actions" role="group" aria-label={t(lang, "viewModeLabel")}>
            <button
              className={appDisplayMode === "admin" ? "mode-icon-btn mode-icon-btn--active" : "mode-icon-btn"}
              onClick={openAdminDisplayView}
              aria-label={t(lang, "admin")}
              title={t(lang, "admin")}
            >
              <svg className="mode-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="4" rx="1.5" />
                <rect x="3" y="10" width="18" height="4" rx="1.5" />
                <rect x="3" y="15" width="18" height="4" rx="1.5" />
                <circle cx="8" cy="7" r="1.1" />
                <circle cx="14" cy="12" r="1.1" />
                <circle cx="18" cy="17" r="1.1" />
              </svg>
              {appDisplayMode === "admin" ? <span className="mode-active-tick" aria-hidden="true">✓</span> : null}
            </button>
            <button
              className={appDisplayMode === "staff" ? "mode-icon-btn mode-icon-btn--active" : "mode-icon-btn"}
              onClick={openStaffDisplayView}
              aria-label={t(lang, "staff")}
              title={t(lang, "staff")}
            >
              <svg className="mode-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="14.5" cy="5" r="2.3" />
                <path d="M8 21l1.8-5.6L7 12.8l2-3.1 3.3 2.1 3.6-1.2 1 2-3 1.2-1.2 2.6 2.4 2-1.1 2.6h-2l.5-1.8-2.3-2-1.4 3.8z" />
              </svg>
              {appDisplayMode === "staff" ? <span className="mode-active-tick" aria-hidden="true">✓</span> : null}
            </button>
          </div>
        </div>
      </section>
      <header className="hero">
        <div>
          <p className="eyebrow">{t(lang, "appEyebrow")}</p>
          <h1>{t(lang, "appTitle")}</h1>
          <p className="subtitle">{t(lang, "legalDisclaimer")}</p>
        </div>
        <div className="hero-actions hero-actions--stack">
          <div className="lang-switch">
            <div className="lang-switch-row" role="group" aria-label="Language selector">
              <label htmlFor="lang-select" className="lang-switch-label">Lang</label>
              <select
                id="lang-select"
                className="lang-select"
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
              >
                {(["ca", "es", "en"] as Lang[]).map((option) => (
                  <option key={option} value={option}>
                    {LANG_FLAGS[option]} - {LANG_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            {currentSessionUser ? (
              <div ref={sessionMenuRef} className="session-chip-wrap">
                <button
                  type="button"
                  className="session-chip-btn"
                  aria-expanded={showSessionMenu}
                  aria-label={t(lang, "accountMenuLabel")}
                  onClick={() => {
                    setShowHeaderMenu(false);
                    setShowSessionMenu((prev) => !prev);
                  }}
                >
                  <span className="session-chip-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <circle cx="12" cy="8" r="3.4" />
                      <path d="M5.6 19.4a6.4 6.4 0 0 1 12.8 0" />
                    </svg>
                  </span>
                  <span className="session-chip-text">
                    <span className="session-chip-name">{currentSessionUser.name}</span>
                    <span className="session-chip-role">{currentSessionRoleLabel}</span>
                  </span>
                </button>
                {showSessionMenu ? (
                  <div className="session-chip-popover">
                    <p className="session-chip-section-title">{t(lang, "accountSignInAs")}</p>
                    <div className="session-chip-login-list">
                      <button
                        type="button"
                        className={appDisplayMode === "admin" ? "session-chip-login-item session-chip-login-item--active" : "session-chip-login-item"}
                        onClick={signInAsManager}
                      >
                        <span className="session-chip-login-name">
                          {managerSessionUser?.name ?? t(lang, "admin")}
                        </span>
                        {appDisplayMode === "admin" ? <span className="session-chip-login-check">✓</span> : null}
                      </button>
                      {activeRunnerStaff.map((member) => {
                        const isActive = appDisplayMode === "staff" && member.id === runnerStaffId;
                        return (
                          <button
                            key={member.id}
                            type="button"
                            className={isActive ? "session-chip-login-item session-chip-login-item--active" : "session-chip-login-item"}
                            onClick={() => signInAsStaff(member.id)}
                          >
                            <span className="session-chip-login-name">{member.name}</span>
                            {isActive ? <span className="session-chip-login-check">✓</span> : null}
                          </button>
                        );
                      })}
                    </div>
                    {activeRunnerStaff.length === 0 ? (
                      <p className="session-chip-empty">{t(lang, "accountNoActiveRunners")}</p>
                    ) : null}
                    <div className="session-chip-divider" />
                    <button
                      type="button"
                      className="session-chip-action"
                      onClick={signOutSession}
                    >
                      {t(lang, "accountSignOut")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {appDisplayMode === "admin" ? (
            <div ref={headerMenuRef} className="header-menu-wrap">
              <button
                className="hamburger-btn"
                aria-label="Open main menu"
                aria-expanded={showHeaderMenu}
                onClick={() => {
                  setShowSessionMenu(false);
                  setShowHeaderMenu((prev) => !prev);
                }}
              >
                <span />
                <span />
                <span />
              </button>
              {showHeaderMenu ? (
                <div className="header-menu-popover">
                  <button className="header-menu-item" onClick={openStaffMainView}>
                    {t(lang, "staff")}
                  </button>
                  <button className="header-menu-item" onClick={openAnalyticsMainView}>
                    {t(lang, "analytics")}
                  </button>
                  <button className="header-menu-item" onClick={openCatalogMainView}>
                    {t(lang, "catalog")}
                  </button>
                  <button className="header-menu-item header-menu-item--with-badge" onClick={openTasksMainView}>
                    {t(lang, "tasks")}
                    {openUnifiedTaskCount > 0 ? <span className="task-badge">{openUnifiedTaskCount}</span> : null}
                  </button>
                  <button className="header-menu-item" onClick={openRulesMainView}>
                    {t(lang, "rules")}
                  </button>
                  <button
                    className="header-menu-item header-menu-item--with-badge"
                    onClick={() => {
                      setShowHeaderMenu(false);
                      closeZoneDrawer();
                      setShowRfidDrawer(false);
                      if (!showSalesDrawer) {
                        resetSalesFormOnOpen();
                      }
                      setShowSalesDrawer((v) => !v);
                    }}
                  >
                    {t(lang, "sales")}
                    {salesInProgressCount > 0 ? <span className="task-badge">{salesInProgressCount}</span> : null}
                  </button>
                  <button
                    className="header-menu-item"
                    onClick={() => {
                      setShowHeaderMenu(false);
                      closeZoneDrawer();
                      setShowSalesDrawer(false);
                      setShowRfidDrawer((v) => !v);
                    }}
                  >
                    RFID
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      {appDisplayMode === "admin" && breadcrumbSectionLabel ? (
        <nav className="view-breadcrumbs" aria-label="Breadcrumb">
          <button type="button" className="crumb-home" onClick={openMapMainView}>
            {t(lang, "home")}
          </button>
          <span className="crumb-sep" aria-hidden="true">
            {">"}
          </span>
          <span className="crumb-current">{breadcrumbSectionLabel}</span>
        </nav>
      ) : null}

      {appDisplayMode === "admin" ? (
        <section className="kpi-grid">
          <article className="kpi-card"><span>{t(lang, "zones")}</span><strong>{totals.zones}</strong></article>
          <article className="kpi-card"><span>{t(lang, "totalUnits")}</span><strong>{totals.totalUnits}</strong></article>
          <article className="kpi-card"><span>{t(lang, "rfidUnits")}</span><strong>{totals.rfidUnits}</strong></article>
          <article className="kpi-card"><span>{t(lang, "nonRfidUnits")}</span><strong>{totals.nonRfidUnits}</strong></article>
          <article className={totals.openTasks > 0 ? "kpi-card kpi-card--alert" : "kpi-card"}><span>{t(lang, "openTasks")}</span><strong>{totals.openTasks}</strong></article>
          <article className="kpi-card"><span>{t(lang, "lowStockZones")}</span><strong>{totals.lowStockZones}</strong></article>
        </section>
      ) : null}

      <section className="layout-grid layout-grid--single">
        {effectiveMainContentView === "runner" ? (
          <article className="panel map-panel">
            <div className="panel-head">
              <h2>{t(lang, "runnerMyTasks")}</h2>
            </div>
            <p className="drawer-subtitle">
              {t(lang, "runnerLoggedAs", { name: runnerStaffMember?.name ?? t(lang, "pendingAssignment") })}
            </p>
            <div className="runner-summary-grid">
              <article className="runner-summary-card">
                <small>{t(lang, "tasks")}</small>
                <strong>{runnerTaskSummary.total}</strong>
              </article>
              <article className="runner-summary-card">
                <small>{t(lang, "runnerPending")}</small>
                <strong>{runnerTaskSummary.pending}</strong>
              </article>
              <article className="runner-summary-card">
                <small>{t(lang, "runnerInProgress")}</small>
                <strong>{runnerTaskSummary.inProgress}</strong>
              </article>
              <article className="runner-summary-card">
                <small>{t(lang, "taskFilterStatusInTransit")}</small>
                <strong>{runnerTaskSummary.inTransit}</strong>
              </article>
            </div>
            <div className="inventory-available-list">
              {runnerAssignedTaskRows.length === 0 ? (
                <p className="empty">{t(lang, "runnerNoAssignedTasks")}</p>
              ) : (
                runnerAssignedTaskRows.map((row) => {
                  const taskKey = getUnifiedTaskKey(row);
                  const isOutOfScopeAssignedTask =
                    !!runnerStaffMember &&
                    row.assignedStaffId === runnerStaffMember.id &&
                    !runnerStaffMember.scopeAllZones &&
                    !runnerStaffMember.zoneScopeZoneIds.includes(row.locationId);
                  const taskTypeLabel =
                    row.type === "REPLENISHMENT"
                      ? t(lang, "taskFilterTypeReplenishment")
                      : t(lang, "taskFilterTypeReceiving");
                  const taskStatusLabel =
                    row.type === "REPLENISHMENT"
                      ? row.status === "CREATED" || row.status === "ASSIGNED"
                        ? t(lang, "replenishmentPendingAcceptance")
                        : row.status === "IN_PROGRESS"
                          ? t(lang, "replenishmentInProgress")
                          : row.status === "CONFIRMED"
                            ? t(lang, "replenishmentFinished")
                            : taskStatusLabelById.get(row.status) ?? row.status
                      : taskStatusLabelById.get(row.status) ?? row.status;
                  const primaryActionLabel =
                    row.type === "REPLENISHMENT"
                      ? row.status === "IN_PROGRESS"
                        ? t(lang, "finish")
                        : t(lang, "start")
                      : t(lang, "confirm");
                  const replenTask = row.type === "REPLENISHMENT" ? replenishmentTaskById.get(row.id) : null;
                  const selectedSource = replenTask ? taskSourceById[replenTask.id] ?? replenTask.sourceZoneId : undefined;
                  const sourceAvailable =
                    replenTask && selectedSource
                      ? (replenTask.sourceCandidates ?? []).find((source) => source.sourceZoneId === selectedSource)?.availableQty ?? 0
                      : 1;
                  const isActionDisabled =
                    row.type === "REPLENISHMENT"
                      ? row.status !== "CREATED" &&
                        row.status !== "ASSIGNED" &&
                        (row.status !== "IN_PROGRESS" || sourceAvailable <= 0)
                      : row.status !== "IN_TRANSIT";
                  return (
                    <div
                      key={`runner-task-${row.type}-${row.id}`}
                      className={
                        "inventory-available-item runner-task-item" +
                        (isTaskRecentlyAssigned(taskKey) ? " task-assigned-flash" : "")
                      }
                    >
                      <div>
                        <strong>{row.skuId}</strong>
                        {isOutOfScopeAssignedTask ? (
                          <small className="runner-task-scope-warning">
                            {t(lang, "runnerOutOfScopeAssigned")}
                          </small>
                        ) : null}
                        <small>{taskTypeLabel} · {taskStatusLabel}</small>
                        <small>{t(lang, "taskFilterDestinationLabel")}: {row.locationName}</small>
                        <small>{t(lang, "source")}: {row.sourceLabel}</small>
                        <small>{t(lang, "assigned")}: {row.assignedStaffId ?? "-"}</small>
                      </div>
                      <div className="staff-item-actions">
                        <button
                          className="action-btn"
                          disabled={isActionDisabled}
                          onClick={() => runRunnerTaskAction(row)}
                        >
                          {primaryActionLabel}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </article>
        ) : effectiveMainContentView === "map" ? (
          <article className="panel map-panel">
            <div className="panel-head">
              <h2>{t(lang, "shopfloorDigitalTwin")}</h2>
              <div className="map-panel-actions">
                <button className="action-btn" onClick={startCreateZone}>
                  + {t(lang, "newLocation")}
                </button>
              </div>
            </div>
            <div className="zone-tabs">
                <button
                  key="all-zones"
                  className={selectedZone === "all" ? "tab tab--active" : "tab"}
                  onClick={() => selectZone("all")}
                >
                  {t(lang, "allZones")}
                </button>
                {zoneOrder.map((zoneId) => {
                  const zoneKpi = dashboard.zones.find((z) => z.zoneId === zoneId);
                  const location = locations.find((entry) => entry.id === zoneId);
                  const hasMinMaxRules = hasMinMaxRulesByZone.get(zoneId) ?? false;
                  const low =
                    hasMinMaxRules &&
                    ((zoneKpi?.lowStockCount ?? 0) > 0 || (zoneKpi?.openTaskCount ?? 0) > 0);
                  return (
                  <button
                    key={zoneId}
                    className={zoneId === selectedZone ? "tab tab--active" : "tab"}
                    onClick={() => selectZoneFromMapInteraction(zoneId)}
                  >
                    {location?.name ?? shortZone(zoneId)}
                    {low ? <span className="warn-icon" title={t(lang, "belowThreshold")}>⚠</span> : null}
                  </button>
                  );
                })}
              </div>

            <div className="zone-units-banner">
              <strong>{selectedZone === "all" ? t(lang, "allZones") : selectedLocation?.name ?? selectedZone}</strong>
              <span>{t(lang, "totalUnits")}: {selectedZoneUnits.total} {t(lang, "unitsSuffix")}</span>
              <span>{t(lang, "rfidUnits")}: {selectedZoneUnits.rfid} {t(lang, "unitsSuffix")}</span>
              <span>{t(lang, "nonRfidUnits")}: {selectedZoneUnits.nonRfid} {t(lang, "unitsSuffix")}</span>
            </div>

            <div
              ref={mapViewportRef}
              className={
                "map-canvas-wrap" +
                (isMapPanning ? " map-canvas-wrap--panning" : mapZoom > 1 && !mapEditMode ? " map-canvas-wrap--draggable" : "")
              }
              onWheel={onMapWheelZoom}
              onWheelCapture={onMapWheelZoom}
              onPointerDown={startMapPan}
              onPointerMove={moveMapPan}
              onPointerUp={endMapPan}
              onPointerLeave={endMapPan}
              onPointerCancel={endMapPan}
            >
            <div className="map-zoom-controls" role="group" aria-label="Map zoom controls">
              <button
                className="map-zoom-btn"
                type="button"
                aria-label={t(lang, "zoomIn")}
                title={t(lang, "zoomIn")}
                onClick={zoomInMap}
              >
                +
              </button>
              <button
                className="map-zoom-btn"
                type="button"
                aria-label={t(lang, "zoomOut")}
                title={t(lang, "zoomOut")}
                onClick={zoomOutMap}
              >
                -
              </button>
              <button
                className="map-zoom-btn map-zoom-btn--reset"
                type="button"
                aria-label={t(lang, "zoomReset")}
                title={t(lang, "zoomReset")}
                onClick={resetMapZoom}
              >
                1:1
              </button>
              <button
                className="map-zoom-btn map-zoom-btn--toggle"
                type="button"
                aria-label={showMapZones ? t(lang, "hideZonesOnMap") : t(lang, "showZonesOnMap")}
                title={showMapZones ? t(lang, "hideZonesOnMap") : t(lang, "showZonesOnMap")}
                onClick={() => setShowMapZones((prev) => !prev)}
              >
                <span
                  className={showMapZones ? "map-eye-icon" : "map-eye-icon map-eye-icon--off"}
                  aria-hidden="true"
                >
                  👁
                </span>
              </button>
              <button
                className="map-zoom-btn map-zoom-btn--toggle map-zoom-btn--info"
                type="button"
                aria-label={t(lang, "mapFlowLegend")}
                title={t(lang, "mapFlowLegend")}
                onClick={() => setShowMapLegend((prev) => !prev)}
              >
                <span className="map-info-pin" aria-hidden="true">
                  <span className="map-info-pin-inner">i</span>
                </span>
              </button>
            </div>
            {showMapLegend ? (
              <div className="map-flow-legend-popover">
                <strong>{t(lang, "mapFlowLegend")}</strong>
                <div className="map-flow-legend-row">
                  <svg className="map-flow-legend-svg" viewBox="0 0 56 16" aria-hidden="true">
                    {legendFlowMarkers.pending.fadePath ? (
                      <path
                        d={legendFlowMarkers.pending.fadePath}
                        className="map-flow-legend-trail-fade map-flow-legend-trail-fade--pending"
                      />
                    ) : null}
                    {legendFlowMarkers.pending.trailPath ? (
                      <path
                        d={legendFlowMarkers.pending.trailPath}
                        className="map-flow-legend-trail map-flow-legend-trail--pending"
                      />
                    ) : null}
                    <polygon
                      className="map-flow-legend-arrow map-flow-legend-arrow--pending"
                      points={legendFlowMarkers.pending.arrow}
                    />
                  </svg>
                  <small>{t(lang, "mapFlowLegendPending")}</small>
                </div>
                <div className="map-flow-legend-row">
                  <svg className="map-flow-legend-svg" viewBox="0 0 56 16" aria-hidden="true">
                    {legendFlowMarkers.moving.fadePath ? (
                      <path
                        d={legendFlowMarkers.moving.fadePath}
                        className="map-flow-legend-trail-fade map-flow-legend-trail-fade--moving"
                      />
                    ) : null}
                    {legendFlowMarkers.moving.trailPath ? (
                      <path
                        d={legendFlowMarkers.moving.trailPath}
                        className="map-flow-legend-trail map-flow-legend-trail--moving"
                      />
                    ) : null}
                    <polygon
                      className="map-flow-legend-arrow map-flow-legend-arrow--moving"
                      points={legendFlowMarkers.moving.arrow}
                    />
                  </svg>
                  <small>{t(lang, "mapFlowLegendInTransit")}</small>
                </div>
                <div className="map-flow-legend-row">
                  <svg className="map-flow-legend-svg" viewBox="0 0 56 16" aria-hidden="true">
                    <path d={legendFlowMarkers.confirmed.path} className="map-flow-legend-confirmed" />
                    <polygon
                      className="map-flow-legend-arrow map-flow-legend-arrow--confirmed"
                      points={legendFlowMarkers.confirmed.arrow}
                    />
                  </svg>
                  <small>{t(lang, "mapFlowLegendConfirmed")}</small>
                </div>
              </div>
            ) : null}
            <svg
              ref={svgRef}
              className={mapEditMode ? "shopfloor shopfloor--editing" : "shopfloor"}
              style={{ transform: `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapZoom})`, transformOrigin: "top left" }}
              viewBox={`0 0 ${SHOPFLOOR_SIZE.width} ${SHOPFLOOR_SIZE.height}`}
              role="img"
              aria-label="Shopfloor map"
              onPointerDown={addPolygonPoint}
              onPointerMove={updateDraggedVertex}
              onPointerUp={releaseDragVertex}
              onPointerLeave={releaseDragVertex}
              onPointerCancel={releaseDragVertex}
            >
              <defs>
                <radialGradient id="pulse" cx="50%" cy="50%" r="55%">
                  <stop offset="0%" stopColor="#5eead4" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="replenishment-line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#60a5fa" />
                  <stop offset="52%" stopColor="#2563eb" />
                  <stop offset="100%" stopColor="#1d4ed8" />
                </linearGradient>
                <linearGradient id="replenishment-arrow-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#93c5fd" />
                  <stop offset="100%" stopColor="#1d4ed8" />
                </linearGradient>
                <marker id="replenishment-arrow-pending" viewBox="0 0 12 12" refX="10.1" refY="6" markerWidth="5.8" markerHeight="5.8" orient="auto-start-reverse">
                  <path d="M 1 1 L 11 6 L 1 11 z" fill="url(#replenishment-arrow-grad)" stroke="#1e3a8a" strokeWidth="0.55" />
                  <path d="M 2.2 2.8 L 8.8 6 L 2.2 9.2" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="0.55" />
                </marker>
                <marker id="replenishment-arrow-confirmed" viewBox="0 0 12 12" refX="10.1" refY="6" markerWidth="5.8" markerHeight="5.8" orient="auto-start-reverse">
                  <path d="M 1 1 L 11 6 L 1 11 z" fill="#16a34a" stroke="#14532d" strokeWidth="0.55" />
                </marker>
              </defs>

              <image href="/shopfloor-map.png" x="0" y="0" width={SHOPFLOOR_SIZE.width} height={SHOPFLOOR_SIZE.height} preserveAspectRatio="none" />
              <rect x="10" y="10" width="1516" height="1097" fill="transparent" stroke="#404040" strokeWidth="6" rx="8" />

              {showMapZones ? locations.map((zone) => {
                const kpi = dashboard.zones.find((z) => z.zoneId === zone.id);
                const selected = selectedZone !== "all" && zone.id === selectedZone;
                const hovered = hoverZoneId === zone.id;
                const hasMinMaxRules = hasMinMaxRulesByZone.get(zone.id) ?? false;
                const low =
                  hasMinMaxRules &&
                  ((kpi?.lowStockCount ?? 0) > 0 || (kpi?.openTaskCount ?? 0) > 0);
                const zoneInventory = kpi?.inventory ?? [];
                const hoverRfidQty = zoneInventory
                  .filter((item) => item.source === "RFID")
                  .reduce((sum, item) => sum + item.qty, 0);
                const hoverNonRfidQty = zoneInventory
                  .filter((item) => item.source === "NON_RFID")
                  .reduce((sum, item) => sum + item.qty, 0);
                const zoneColor = selected && previewZoneColor ? previewZoneColor : zone.color;
                const renderedPolygon =
                  mapEditMode && !createMode && selected ? draftPolygon : zone.mapPolygon;
                const safePolygon = renderedPolygon.length > 0 ? renderedPolygon : zone.mapPolygon;
                const anchorPoint = safePolygon[0] ?? { x: 0, y: 0 };
                const warningX = Math.max(...safePolygon.map((point) => point.x)) - 16;
                const warningY = Math.min(...safePolygon.map((point) => point.y)) + 14;
                const centerPoint = polygonCenter(safePolygon);

                return (
                  <g
                    key={zone.id}
                    className="map-zone-group"
                    onPointerEnter={() => setHoverZoneId(zone.id as InventoryZoneId)}
                    onPointerLeave={() => setHoverZoneId((current) => (current === zone.id ? null : current))}
                  >
                    <polygon
                      points={polygonToPoints(safePolygon)}
                      className={selected ? "zone-overlay zone-overlay--selected zone-overlay--clickable" : "zone-overlay zone-overlay--clickable"}
                      style={{ fill: `${zoneColor}33`, stroke: zoneColor }}
                      onClick={() => selectZoneFromMapInteraction(zone.id as InventoryZoneId)}
                    />
                    <text x={anchorPoint.x + 14} y={anchorPoint.y + 26} className="zone-label">
                      {zone.name}
                    </text>
                    {low ? (
                      <g className="zone-warning-icon">
                        <path d={`M ${warningX} ${warningY - 11} L ${warningX - 10} ${warningY + 9} L ${warningX + 10} ${warningY + 9} Z`} />
                        <text x={warningX - 2.4} y={warningY + 6}>!</text>
                      </g>
                    ) : null}
                    {hovered ? (
                      <g className="zone-hover-card">
                        <rect
                          x={Math.min(anchorPoint.x + 13, SHOPFLOOR_SIZE.width - 191)}
                          y={Math.max(15, anchorPoint.y + 39)}
                          width="188"
                          height="94"
                          rx="14"
                          className="zone-hover-card-shadow"
                        />
                        <rect
                          x={Math.min(anchorPoint.x + 8, SHOPFLOOR_SIZE.width - 176)}
                          y={Math.max(10, anchorPoint.y + 32)}
                          width="188"
                          height="94"
                          rx="14"
                          style={{ fill: `${zoneColor}e6`, stroke: "rgba(15,23,42,0.95)" }}
                        />
                        <text className="zone-hover-card-title" x={Math.min(anchorPoint.x + 18, SHOPFLOOR_SIZE.width - 166)} y={Math.max(30, anchorPoint.y + 52)}>
                          {zone.name}
                        </text>
                        <text className="zone-hover-card-value" x={Math.min(anchorPoint.x + 18, SHOPFLOOR_SIZE.width - 166)} y={Math.max(50, anchorPoint.y + 74)}>
                          {t(lang, "rfidUnits")}: {hoverRfidQty}
                        </text>
                        <text className="zone-hover-card-value" x={Math.min(anchorPoint.x + 18, SHOPFLOOR_SIZE.width - 166)} y={Math.max(70, anchorPoint.y + 94)}>
                          {t(lang, "nonRfidUnits")}: {hoverNonRfidQty}
                        </text>
                      </g>
                    ) : null}
                  </g>
                );
              }) : null}

              {activeCustomerMapMarkers.map((marker) => (
                <g key={`cart-marker-${marker.id}`} className="customer-cart-marker customer-cart-marker--active">
                  <circle className="customer-cart-glow" cx={marker.x} cy={marker.y} r="22" />
                  <circle className="customer-cart-head" cx={marker.x} cy={marker.y - 8} r="5.5" />
                  <path
                    className="customer-cart-body"
                    d={`M ${marker.x - 8} ${marker.y + 8} Q ${marker.x} ${marker.y - 1} ${marker.x + 8} ${marker.y + 8}`}
                  />
                  <path
                    className="customer-cart-basket"
                    d={`M ${marker.x + 10} ${marker.y + 2} L ${marker.x + 17} ${marker.y + 2} L ${marker.x + 15} ${marker.y + 9} L ${marker.x + 11} ${marker.y + 9} Z`}
                  />
                </g>
              ))}

              {showFinalCartBadge ? (
                <g className="customer-cart-badge customer-cart-badge--final">
                  <circle cx={cashierCenter.x + 21} cy={cashierCenter.y - 22} r="10" />
                  <text x={cashierCenter.x + 21} y={cashierCenter.y - 18}>
                    {activeCustomerMapMarkers[0]?.cartsCount ?? 0}
                  </text>
                </g>
              ) : null}

              {exitingCustomerMapMarkers.map((marker) => (
                <g
                  key={`cart-exit-marker-${marker.id}`}
                  className="customer-cart-marker customer-cart-marker--exit"
                  style={{ opacity: marker.opacity }}
                >
                  <circle className="customer-cart-glow" cx={marker.x} cy={marker.y} r="20" />
                  <circle className="customer-cart-head" cx={marker.x} cy={marker.y - 8} r="5.5" />
                  <path
                    className="customer-cart-body"
                    d={`M ${marker.x - 8} ${marker.y + 8} Q ${marker.x} ${marker.y - 1} ${marker.x + 8} ${marker.y + 8}`}
                  />
                  <path
                    className="customer-cart-basket"
                    d={`M ${marker.x + 10} ${marker.y + 2} L ${marker.x + 17} ${marker.y + 2} L ${marker.x + 15} ${marker.y + 9} L ${marker.x + 11} ${marker.y + 9} Z`}
                  />
                </g>
              ))}

              {createMode && newZonePolygon.length > 1 ? (
                <g className="map-zone-group">
                  <polygon
                    points={polygonToPoints(newZonePolygon)}
                    className="zone-overlay zone-overlay--selected"
                    style={{ fill: `${newZoneForm.color}33`, stroke: newZoneForm.color, strokeDasharray: "8 4" }}
                    onPointerDown={(evt) => {
                      evt.stopPropagation();
                      evt.currentTarget.setPointerCapture(evt.pointerId);
                      setIsDraggingVertex(true);
                      setDragPolygonStart(getSvgCoords(evt));
                    }}
                  />
                  <text x={newZonePolygon[0].x + 14} y={newZonePolygon[0].y + 26} className="zone-label">
                    {newZoneForm.name}
                  </text>
                </g>
              ) : null}

              {mapEditMode && selectedZone !== "all"
                ? draftPolygon.map((point, index) => (
                    <g key={`vertex-${index}`}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="8"
                        className="polygon-vertex"
                        onPointerDown={(evt) => {
                          evt.stopPropagation();
                          evt.currentTarget.setPointerCapture(evt.pointerId);
                          setDragVertexIndex(index);
                          setDragTarget("existing");
                          setIsDraggingVertex(true);
                        }}
                      />
                      <text className="polygon-vertex-label" x={point.x + 10} y={point.y - 10}>{index + 1}</text>
                    </g>
                  ))
                : null}

              {mapEditMode && createMode
                ? newZonePolygon.map((point, index) => (
                    <g key={`new-vertex-${index}`}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="8"
                        className="polygon-vertex polygon-vertex--new"
                        onPointerDown={(evt) => {
                          evt.stopPropagation();
                          evt.currentTarget.setPointerCapture(evt.pointerId);
                          setDragVertexIndex(index);
                          setDragTarget("new");
                          setIsDraggingVertex(true);
                        }}
                      />
                      <text className="polygon-vertex-label" x={point.x + 10} y={point.y - 10}>{index + 1}</text>
                    </g>
                  ))
                : null}

              {showMapZones ? replenishmentFlowMarkers.map((flow) => (
                <g key={`replenish-flow-${flow.id}`} className="replenishment-flow" style={{ opacity: flow.opacity }}>
                  {flow.status === "confirmed" ? (
                    <>
                      <path d={flow.path} className="replenishment-flow-line-volume" />
                      <path
                        d={flow.path}
                        className="replenishment-flow-line replenishment-flow-line--confirmed"
                        markerEnd="url(#replenishment-arrow-confirmed)"
                      />
                      <path
                        d={flow.path}
                        className="replenishment-flow-line-gloss replenishment-flow-line-gloss--confirmed"
                      />
                    </>
                  ) : (
                    <>
                      {(() => {
                        const headT = flow.progress;
                        const trailLen = flow.status === "moving" ? 0.26 : 0.2;
                        const fadeLen = flow.status === "moving" ? 0.16 : 0.12;
                        const trailStartT = Math.max(0, headT - trailLen);
                        const fadeStartT = Math.max(0, trailStartT - fadeLen);
                        const fadePath = buildQuadraticSegmentPath(flow.x1, flow.y1, flow.cx, flow.cy, flow.x2, flow.y2, fadeStartT, trailStartT);
                        const trailPath = buildQuadraticSegmentPath(flow.x1, flow.y1, flow.cx, flow.cy, flow.x2, flow.y2, trailStartT, headT);
                        return (
                          <>
                            {fadePath ? (
                              <path
                                d={fadePath}
                                className={
                                  flow.status === "moving"
                                    ? "replenishment-flow-trail-fade replenishment-flow-trail-fade--moving"
                                    : "replenishment-flow-trail-fade replenishment-flow-trail-fade--pending"
                                }
                              />
                            ) : null}
                            {trailPath ? (
                              <path
                                d={trailPath}
                                className={
                                  flow.status === "moving"
                                    ? "replenishment-flow-trail replenishment-flow-trail--moving"
                                    : "replenishment-flow-trail replenishment-flow-trail--pending"
                                }
                              />
                            ) : null}
                          </>
                        );
                      })()}
                    </>
                  )}
                  {flow.status !== "confirmed" ? (() => {
                    const t = flow.progress;
                    const px =
                      (1 - t) * (1 - t) * flow.x1 +
                      2 * (1 - t) * t * flow.cx +
                      t * t * flow.x2;
                    const py =
                      (1 - t) * (1 - t) * flow.y1 +
                      2 * (1 - t) * t * flow.cy +
                      t * t * flow.y2;
                    const tx = 2 * (1 - t) * (flow.cx - flow.x1) + 2 * t * (flow.x2 - flow.cx);
                    const ty = 2 * (1 - t) * (flow.cy - flow.y1) + 2 * t * (flow.y2 - flow.cy);
                    const norm = Math.max(0.0001, Math.hypot(tx, ty));
                    const ux = tx / norm;
                    const uy = ty / norm;
                    const nx = -uy;
                    const ny = ux;
                    const tipX = px + ux * 10;
                    const tipY = py + uy * 10;
                    const leftX = px - ux * 3 + nx * 4.8;
                    const leftY = py - uy * 3 + ny * 4.8;
                    const rightX = px - ux * 3 - nx * 4.8;
                    const rightY = py - uy * 3 - ny * 4.8;
                    const arrowPoints = `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`;
                    return (
                      <polygon
                        className={
                          flow.status === "moving"
                            ? "replenishment-flow-arrow-live replenishment-flow-arrow-live--moving"
                            : "replenishment-flow-arrow-live replenishment-flow-arrow-live--pending"
                        }
                        points={arrowPoints}
                      />
                    );
                  })() : null}
                </g>
              )) : null}
            </svg>
            </div>
          </article>
        ) : effectiveMainContentView === "staff" ? (
          <article className="panel map-panel">
            <div className="panel-head">
              <h2>{t(lang, "staff")}</h2>
            </div>
            <div className="inventory-available-list">
              {staff.map((member) => (
                <div key={member.id} className="inventory-available-item">
                  <div>
                    <strong>{member.name}</strong>
                    <small>{member.role} · {member.shiftLabel}</small>
                  </div>
                  <div className="staff-item-actions">
                    <button
                      className="inline-btn"
                      onClick={() => {
                        api.updateStaffShift({ staffId: member.id, activeShift: !member.activeShift });
                        refresh();
                      }}
                    >
                      {member.activeShift ? t(lang, "setOffShift") : t(lang, "setActive")}
                    </button>
                    <div className="staff-scope-wrap">
                      <label className="staff-scope-option">
                        <input
                          type="checkbox"
                          checked={member.scopeAllZones}
                          onChange={(e) =>
                            updateStaffZoneScope(
                              member.id,
                              e.target.checked,
                              member.zoneScopeZoneIds
                            )
                          }
                        />
                        {t(lang, "allZonesScope")}
                      </label>
                      {!member.scopeAllZones ? (
                        <div className="staff-scope-list">
                          {locations.map((zone) => (
                            <label key={`${member.id}-${zone.id}`} className="staff-scope-option">
                              <input
                                type="checkbox"
                                checked={member.zoneScopeZoneIds.includes(zone.id)}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...member.zoneScopeZoneIds, zone.id]
                                    : member.zoneScopeZoneIds.filter((id) => id !== zone.id);
                                  updateStaffZoneScope(member.id, false, Array.from(new Set(next)));
                                }}
                              />
                              {zone.name}
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ) : effectiveMainContentView === "catalog" ? (
          <article className="panel map-panel">
            <div className="panel-head">
              <h2>{t(lang, "catalogTitle")}</h2>
            </div>
            <p className="drawer-subtitle">{t(lang, "catalogSubtitle")}</p>
            <div className="control-group">
              <div className="task-filter-bar">
                <div className="task-filter-chip-list">
                  {catalogActiveFilters.map((filter) => (
                    <div key={`catalog-filter-chip-${filter.key}`} className="task-filter-anchor">
                      <button
                        type="button"
                        className="task-filter-chip"
                        onClick={() => {
                          setCatalogPendingFilterKey(filter.key);
                          setCatalogFilterSearch("");
                        }}
                        title="Edit filter"
                      >
                        {filter.label}: {filter.valueLabel}
                        <span
                          className="task-filter-chip-close-inline"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            removeCatalogFilter(filter.key);
                          }}
                          aria-hidden="true"
                          title="Remove filter"
                        >
                          ×
                        </span>
                      </button>
                      {catalogPendingFilterKey === filter.key ? (
                        <div className="task-filter-picker">
                          <input
                            className="task-filter-search"
                            placeholder={t(lang, "taskFilterSearchPlaceholder")}
                            value={catalogFilterSearch}
                            onChange={(e) => setCatalogFilterSearch(e.target.value)}
                          />
                          <div className="task-filter-option-list">
                            {catalogPendingOptions.map((option) => (
                              <label key={`catalog-filter-option-${catalogPendingFilterKey}-${option.id}`} className="task-filter-option">
                                <input
                                  type="checkbox"
                                  checked={isCatalogPendingOptionSelected(option.id)}
                                  onChange={() => toggleCatalogPendingOption(option.id)}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                            {catalogPendingOptions.length === 0 ? (
                              <p className="empty">{t(lang, "taskFilterNoOptions")}</p>
                            ) : null}
                          </div>
                          <button className="task-filter-clear" onClick={() => removeCatalogFilter(catalogPendingFilterKey as CatalogFilterKey)}>
                            {t(lang, "taskFilterClear")}
                          </button>
                          <button
                            className="inline-btn"
                            onClick={() => {
                              setCatalogPendingFilterKey("");
                              setCatalogFilterSearch("");
                            }}
                          >
                            {t(lang, "close")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  <div className="task-filter-anchor">
                    {catalogAddableFilterKeys.length > 0 ? (
                      <select
                        className="task-filter-add"
                        value={catalogPendingFilterKey}
                        onChange={(e) => {
                          setCatalogPendingFilterKey(e.target.value as CatalogFilterKey | "");
                          setCatalogFilterSearch("");
                        }}
                      >
                        <option value="">{t(lang, "taskFilterAdd")}</option>
                        {catalogAddableFilterKeys.includes("SOURCE") ? <option value="SOURCE">{t(lang, "catalogSourceLabel")}</option> : null}
                        {catalogAddableFilterKeys.includes("KIT") ? <option value="KIT">{t(lang, "catalogKit")}</option> : null}
                        {catalogAddableFilterKeys.includes("AGE_GROUP") ? <option value="AGE_GROUP">{t(lang, "catalogAgeGroup")}</option> : null}
                        {catalogAddableFilterKeys.includes("GENDER") ? <option value="GENDER">{t(lang, "catalogGender")}</option> : null}
                        {catalogAddableFilterKeys.includes("ROLE") ? <option value="ROLE">{t(lang, "catalogRole")}</option> : null}
                        {catalogAddableFilterKeys.includes("QUALITY") ? <option value="QUALITY">{t(lang, "catalogQuality")}</option> : null}
                      </select>
                    ) : null}
                    {catalogPendingFilterKey && catalogAddableFilterKeys.includes(catalogPendingFilterKey as CatalogFilterKey) ? (
                      <div className="task-filter-picker">
                        <input
                          className="task-filter-search"
                          placeholder={t(lang, "taskFilterSearchPlaceholder")}
                          value={catalogFilterSearch}
                          onChange={(e) => setCatalogFilterSearch(e.target.value)}
                        />
                        <div className="task-filter-option-list">
                          {catalogPendingOptions.map((option) => (
                            <label key={`catalog-filter-option-${catalogPendingFilterKey}-${option.id}`} className="task-filter-option">
                              <input
                                type="checkbox"
                                checked={isCatalogPendingOptionSelected(option.id)}
                                onChange={() => toggleCatalogPendingOption(option.id)}
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                          {catalogPendingOptions.length === 0 ? (
                            <p className="empty">{t(lang, "taskFilterNoOptions")}</p>
                          ) : null}
                        </div>
                        <button className="task-filter-clear" onClick={() => removeCatalogFilter(catalogPendingFilterKey as CatalogFilterKey)}>
                          {t(lang, "taskFilterClear")}
                        </button>
                        <button
                          className="inline-btn"
                          onClick={() => {
                            setCatalogPendingFilterKey("");
                            setCatalogFilterSearch("");
                          }}
                        >
                          {t(lang, "close")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {catalogActiveFilters.length > 0 ? (
                    <button className="task-filter-clear" onClick={clearCatalogFilters}>{t(lang, "taskFilterClearAll")}</button>
                  ) : null}
                </div>
              </div>
            </div>
            {catalogMapSkuId ? (
              <div className="catalog-map-preview">
                <div className="catalog-map-head">
                  <h4>{t(lang, "mapFocusSku")}: {catalogMapSkuId}</h4>
                  <small>{catalogMapSkuLabel}</small>
                  <button className="inline-btn" onClick={() => setCatalogMapSkuId(null)}>
                    {t(lang, "mapFocusClear")}
                  </button>
                </div>
                <div className="catalog-inline-map-wrap">
                  <svg
                    className="shopfloor"
                    viewBox={`0 0 ${SHOPFLOOR_SIZE.width} ${SHOPFLOOR_SIZE.height}`}
                    role="img"
                    aria-label="Shopfloor map catalog focus"
                  >
                    <image href="/shopfloor-map.png" x="0" y="0" width={SHOPFLOOR_SIZE.width} height={SHOPFLOOR_SIZE.height} preserveAspectRatio="none" />
                    <rect x="10" y="10" width="1516" height="1097" fill="transparent" stroke="#404040" strokeWidth="6" rx="8" />
                    {locations.map((zone) => {
                      const safePolygon = zone.mapPolygon.length > 0 ? zone.mapPolygon : [];
                      const centerPoint = polygonCenter(safePolygon);
                      const isHighlighted = catalogMapPulseZones.includes(zone.id);
                      return (
                        <g key={`catalog-map-zone-${zone.id}`} className="map-zone-group">
                          <polygon
                            points={polygonToPoints(safePolygon)}
                            className="zone-overlay"
                            style={{
                              fill: isHighlighted ? `${zone.color}44` : `${zone.color}22`,
                              stroke: zone.color
                            }}
                          />
                          <text x={(safePolygon[0]?.x ?? 0) + 14} y={(safePolygon[0]?.y ?? 0) + 26} className="zone-label">
                            {zone.name}
                          </text>
                          {isHighlighted ? (
                            <g className="sku-pulse-marker">
                              <circle cx={centerPoint.x} cy={centerPoint.y} r="10" className="sku-pulse-dot" />
                              <circle cx={centerPoint.x} cy={centerPoint.y} r="12" className="sku-pulse-wave sku-pulse-wave--a" />
                              <circle cx={centerPoint.x} cy={centerPoint.y} r="12" className="sku-pulse-wave sku-pulse-wave--b" />
                            </g>
                          ) : null}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            ) : null}
            <div className="catalog-grid">
              {filteredCatalogEntries.map((product) => (
                <article key={product.id} className="catalog-card">
                  <header className="catalog-card-head">
                    <h3>{product.title}</h3>
                    <small>{product.brand}</small>
                  </header>
                  <div className="catalog-variant-list">
                    {product.variants.map((variant) => (
                      <section key={variant.id} className="catalog-variant-row">
                        <img
                          className="catalog-variant-image"
                          src={variant.imageUrl}
                          alt={`${product.title} ${variant.name}`}
                        />
                        <div className="catalog-variant-main">
                          <strong>{variant.name}</strong>
                          <div className="catalog-attribute-tags catalog-attribute-tags--compact">
                            <span className="catalog-attr-tag">{t(lang, "catalogVariant")}: {variant.skuId}</span>
                            <span className="catalog-attr-tag">{t(lang, "catalogBarcode")}: {variant.barcode}</span>
                            <span className="catalog-attr-tag">{t(lang, "catalogSize")}: {variant.size}</span>
                            <span className="catalog-attr-tag">{t(lang, "catalogSourceLabel")}: {variant.source}</span>
                            {variant.kit ? (
                              <span className="catalog-attr-tag">{t(lang, "catalogKit")}: {t(lang, `catalogValue_${variant.kit}`)}</span>
                            ) : null}
                            {variant.ageGroup ? (
                              <span className="catalog-attr-tag">{t(lang, "catalogAgeGroup")}: {t(lang, `catalogValue_${variant.ageGroup}`)}</span>
                            ) : null}
                            {variant.gender ? (
                              <span className="catalog-attr-tag">{t(lang, "catalogGender")}: {t(lang, `catalogValue_${variant.gender}`)}</span>
                            ) : null}
                            {variant.role ? (
                              <span className="catalog-attr-tag">{t(lang, "catalogRole")}: {t(lang, `catalogValue_${variant.role}`)}</span>
                            ) : null}
                            {variant.quality ? (
                              <span className="catalog-attr-tag">{t(lang, "catalogQuality")}: {t(lang, `catalogValue_${variant.quality}`)}</span>
                            ) : null}
                          </div>
                          <div className="catalog-variant-actions">
                            <button className="inline-btn" onClick={() => focusSkuOnMap(variant.skuId)}>
                              {t(lang, "catalogLocateOnMap")}
                            </button>
                          </div>
                          {variant.source === "RFID" ? (
                            <div className="catalog-rfid-block">
                              <small>{t(lang, "catalogRfidEpcs")}: {variant.rfidInStore?.totalEpcs ?? 0}</small>
                              <div className="catalog-location-tags">
                                {(variant.rfidInStore?.byLocation ?? []).length > 0 ? (
                                  (variant.rfidInStore?.byLocation ?? []).map((entry: { zoneId: string; zoneName: string; qty: number }) => (
                                    <span key={`${variant.id}-${entry.zoneId}`} className="catalog-location-tag">
                                      {t(lang, "catalogInLocation", { zoneName: entry.zoneName, qty: entry.qty })}
                                    </span>
                                  ))
                                ) : (
                                  <span className="catalog-location-tag">{t(lang, "catalogNoEpcs")}</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <small>{t(lang, "catalogNoRfidTag")}</small>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </article>
        ) : effectiveMainContentView === "rules" ? (
          <article className="panel map-panel">
            <div className="panel-head">
              <h2>{t(lang, "rulesHubTitle")}</h2>
            </div>
            <p className="drawer-subtitle">{t(lang, "rulesHubSubtitle")}</p>

            <div className="control-group">
              <h4>{t(lang, "rulesHubCreateEdit")}</h4>
              <div className="panel-head-actions">
                <button className="action-btn" onClick={openCreateRuleForm}>
                  {t(lang, "rulesHubCreateNew")}
                </button>
              </div>
              {rulesFormMode === "create" ? renderRuleEditor() : null}
            </div>

            <div className="control-group">
              <h4>{t(lang, "rulesHubList")}</h4>
              <div className="form-grid">
                <label>
                  {t(lang, "taskFilterDestinationLabel")}
                  <select
                    value={rulesLocationFilter}
                    onChange={(e) => setRulesLocationFilter(e.target.value)}
                  >
                    <option value="all">{t(lang, "allZonesGlobal")}</option>
                    {ruleLocationOptions.map((location) => (
                      <option key={`rule-filter-location-${location.id}`} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>{t(lang, "taskFilterDestinationLabel")}</th>
                    <th>{t(lang, "rulesHubSelector")}</th>
                    <th>{t(lang, "sku")}</th>
                    <th>{t(lang, "source")}</th>
                    <th>{t(lang, "min")}</th>
                    <th>{t(lang, "max")}</th>
                    <th>{t(lang, "rulesHubPriority")}</th>
                    <th>{t(lang, "action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuleTemplates.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="empty">{t(lang, "taskFilterNoOptions")}</td>
                    </tr>
                  ) : (
                    filteredRuleTemplates.map((template) => {
                      const selectorLabel =
                        template.selectorMode === "SKU"
                          ? template.skuId ?? "-"
                          : [
                              template.attributes?.kit ? `${t(lang, "catalogKit")}: ${t(lang, `catalogValue_${template.attributes.kit}`)}` : null,
                              template.attributes?.ageGroup ? `${t(lang, "catalogAgeGroup")}: ${t(lang, `catalogValue_${template.attributes.ageGroup}`)}` : null,
                              template.attributes?.gender ? `${t(lang, "catalogGender")}: ${t(lang, `catalogValue_${template.attributes.gender}`)}` : null,
                              template.attributes?.role ? `${t(lang, "catalogRole")}: ${t(lang, `catalogValue_${template.attributes.role}`)}` : null,
                              template.attributes?.quality ? `${t(lang, "catalogQuality")}: ${t(lang, `catalogValue_${template.attributes.quality}`)}` : null
                            ]
                              .filter((value): value is string => Boolean(value))
                              .join(" · ") || "-";
                      return (
                        <Fragment key={template.id}>
                          <tr>
                            <td>{template.scope === "GENERIC" ? "-" : (template.zoneId ? (locationNameById.get(template.zoneId) ?? template.zoneId) : "-")}</td>
                            <td>{template.selectorMode === "SKU" ? t(lang, "rulesHubSelectorSku") : t(lang, "rulesHubSelectorAttributes")}</td>
                            <td>{template.selectorMode === "SKU" ? `${template.skuId ?? "-"} · ${skuNameById.get(template.skuId ?? "") ?? ""}` : selectorLabel}</td>
                            <td>{template.source}</td>
                            <td>{template.minQty}</td>
                            <td>{template.maxQty}</td>
                            <td>{template.priority}</td>
                            <td>
                              <button className="inline-btn" onClick={() => editRuleTemplate(template)}>{t(lang, "edit")}</button>
                              <button className="inline-btn" onClick={() => removeRuleTemplate(template.id)}>{t(lang, "delete")}</button>
                            </td>
                          </tr>
                          {rulesFormMode === "edit" && ruleCenterForm.id === template.id ? (
                            <tr>
                              <td colSpan={8}>
                                <div className="control-group">
                                  {renderRuleEditor()}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </article>
        ) : effectiveMainContentView === "tasks" ? (
          <article className="panel map-panel">
            <div className="panel-head">
              <h2>{t(lang, "tasks")}</h2>
            </div>
            <div className="control-group">
              <h4>Task Hub</h4>
              <div className="task-filter-bar">
                <div className="task-filter-chip-list">
                  {taskHubActiveFilters.map((filter) => (
                    <div key={`task-filter-chip-${filter.key}`} className="task-filter-anchor">
                      <button
                        type="button"
                        className="task-filter-chip"
                        onClick={() => {
                          setTaskHubPendingFilterKey(filter.key);
                          setTaskHubFilterSearch("");
                        }}
                        title="Edit filter"
                      >
                        {filter.label}: {filter.valueLabel}
                        <span
                          className="task-filter-chip-close-inline"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            removeTaskHubFilter(filter.key);
                          }}
                          aria-hidden="true"
                          title="Remove filter"
                        >
                          ×
                        </span>
                      </button>
                      {taskHubPendingFilterKey === filter.key ? (
                        <div className="task-filter-picker">
                          <input
                            className="task-filter-search"
                            placeholder={t(lang, "taskFilterSearchPlaceholder")}
                            value={taskHubFilterSearch}
                            onChange={(e) => setTaskHubFilterSearch(e.target.value)}
                          />
                          <div className="task-filter-option-list">
                            {taskHubPendingOptions.map((option) => (
                              <label key={`task-filter-option-${taskHubPendingFilterKey}-${option.id}`} className="task-filter-option">
                                <input
                                  type="checkbox"
                                  checked={isTaskHubPendingOptionSelected(option.id)}
                                  onChange={() => toggleTaskHubPendingOption(option.id)}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                            {taskHubPendingOptions.length === 0 ? (
                              <p className="empty">{t(lang, "taskFilterNoOptions")}</p>
                            ) : null}
                          </div>
                          <button className="task-filter-clear" onClick={() => removeTaskHubFilter(taskHubPendingFilterKey as TaskHubFilterKey)}>
                            {t(lang, "taskFilterClear")}
                          </button>
                          <button
                            className="inline-btn"
                            onClick={() => {
                              setTaskHubPendingFilterKey("");
                              setTaskHubFilterSearch("");
                            }}
                          >
                            {t(lang, "close")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  <div className="task-filter-anchor">
                    {taskHubAddableFilterKeys.length > 0 ? (
                      <select
                        className="task-filter-add"
                        value={taskHubPendingFilterKey}
                        onChange={(e) => {
                          setTaskHubPendingFilterKey(e.target.value as TaskHubFilterKey | "");
                          setTaskHubFilterSearch("");
                        }}
                      >
                        <option value="">{t(lang, "taskFilterAdd")}</option>
                        {taskHubAddableFilterKeys.includes("TYPE") ? <option value="TYPE">{t(lang, "taskFilterTypeLabel")}</option> : null}
                        {taskHubAddableFilterKeys.includes("DESTINATION") ? <option value="DESTINATION">{t(lang, "taskFilterDestinationLabel")}</option> : null}
                        {taskHubAddableFilterKeys.includes("STATUS") ? <option value="STATUS">{t(lang, "taskFilterStatusLabel")}</option> : null}
                      </select>
                    ) : null}
                    {taskHubPendingFilterKey && taskHubAddableFilterKeys.includes(taskHubPendingFilterKey as TaskHubFilterKey) ? (
                      <div className="task-filter-picker">
                        <input
                          className="task-filter-search"
                          placeholder={t(lang, "taskFilterSearchPlaceholder")}
                          value={taskHubFilterSearch}
                          onChange={(e) => setTaskHubFilterSearch(e.target.value)}
                        />
                        <div className="task-filter-option-list">
                          {taskHubPendingOptions.map((option) => (
                            <label key={`task-filter-option-${taskHubPendingFilterKey}-${option.id}`} className="task-filter-option">
                              <input
                                type="checkbox"
                                checked={isTaskHubPendingOptionSelected(option.id)}
                                onChange={() => toggleTaskHubPendingOption(option.id)}
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                          {taskHubPendingOptions.length === 0 ? (
                            <p className="empty">{t(lang, "taskFilterNoOptions")}</p>
                          ) : null}
                        </div>
                        <button className="task-filter-clear" onClick={() => removeTaskHubFilter(taskHubPendingFilterKey as TaskHubFilterKey)}>
                          {t(lang, "taskFilterClear")}
                        </button>
                        <button
                          className="inline-btn"
                          onClick={() => {
                            setTaskHubPendingFilterKey("");
                            setTaskHubFilterSearch("");
                          }}
                        >
                          {t(lang, "close")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {taskHubActiveFilters.length > 0 ? (
                    <button className="task-filter-clear" onClick={clearTaskHubFilters}>{t(lang, "taskFilterClearAll")}</button>
                  ) : null}
                </div>
              </div>
              <div className="inventory-available-list">
                {filteredUnifiedTaskRows.length === 0 ? (
                  <p className="empty">No hay tasks para los filtros seleccionados.</p>
                ) : (
                  filteredUnifiedTaskRows.map((row) => {
                    const taskKey = getUnifiedTaskKey(row);
                    return (
                      <div
                        key={`hub-task-${row.type}-${row.id}`}
                        className={
                          "inventory-available-item" +
                          (isTaskRecentlyAssigned(taskKey) ? " task-assigned-flash" : "")
                        }
                      >
                        <div>
                          <strong>{row.id} · {row.skuId}</strong>
                          <small>
                            type={row.type} · location={row.locationName} · source={row.sourceLabel} · qty={row.qtyLabel}
                          </small>
                          <small>
                            assigned={row.assignedStaffId ?? t(lang, "pendingAssignment")} · status={
                              row.type === "REPLENISHMENT"
                                ? row.status === "CREATED" || row.status === "ASSIGNED"
                                  ? t(lang, "replenishmentPendingAcceptance")
                                  : row.status === "IN_PROGRESS"
                                    ? t(lang, "replenishmentInProgress")
                                    : row.status === "CONFIRMED"
                                      ? t(lang, "replenishmentFinished")
                                      : taskStatusLabelById.get(row.status) ?? row.status
                                : taskStatusLabelById.get(row.status) ?? row.status
                            } · {row.createdAt}
                          </small>
                        </div>
                        {row.type === "RECEIVING" && row.status === "IN_TRANSIT" ? (
                          <div className="staff-item-actions">
                            <button
                              className="action-btn"
                              disabled={!row.assignedStaffId}
                              onClick={() => confirmReceivingOrder(row.id)}
                            >
                              Confirmar recepción
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            {receivingStatusMessage ? <p className="drawer-subtitle">{receivingStatusMessage}</p> : null}
          </article>
        ) : (
          <article className="panel map-panel">
            <div className="panel-head">
              <h2>{t(lang, "analytics")}</h2>
            </div>
            <div className="analytics-kpi-grid">
              <article className="analytics-kpi-card">
                <small>{t(lang, "analyticsTotalTasks")}</small>
                <strong>{analyticsData.totalTasks}</strong>
              </article>
              <article className="analytics-kpi-card">
                <small>{t(lang, "analyticsBacklog")}</small>
                <strong>{analyticsData.backlog}</strong>
              </article>
              <article className="analytics-kpi-card">
                <small>{t(lang, "analyticsAvgConfirmTime")}</small>
                <strong>{analyticsData.avgConfirmSeconds === null ? "-" : toDurationLabel(analyticsData.avgConfirmSeconds)}</strong>
              </article>
              <article className="analytics-kpi-card">
                <small>{t(lang, "analyticsPartialConfirmations")}</small>
                <strong>{analyticsData.partialConfirmedCount}</strong>
              </article>
              <article className="analytics-kpi-card">
                <small>{t(lang, "staffQueuePending")}</small>
                <strong>{analyticsData.queueUnassigned}</strong>
              </article>
              <article className="analytics-kpi-card">
                <small>{t(lang, "staffTasksBlocked")}</small>
                <strong>{analyticsData.openBlocked}</strong>
              </article>
            </div>
            <div className="analytics-grid">
              <section className="analytics-panel">
                <h4>{t(lang, "analyticsTasksByStatus")}</h4>
                {(["CREATED", "ASSIGNED", "IN_PROGRESS", "CONFIRMED", "REJECTED"] as const).map((status) => {
                  const total = Math.max(1, analyticsData.totalTasks);
                  const value = analyticsData.statusCounts[status];
                  const pct = Math.round((value / total) * 100);
                  const statusLabel =
                    status === "CREATED"
                      ? t(lang, "taskStatusCreated")
                      : status === "ASSIGNED"
                        ? t(lang, "taskStatusAssigned")
                        : status === "IN_PROGRESS"
                          ? t(lang, "taskStatusInProgress")
                          : status === "CONFIRMED"
                            ? t(lang, "taskStatusConfirmed")
                            : t(lang, "taskStatusRejected");
                  return (
                    <div key={status} className="analytics-row">
                      <span>{statusLabel}</span>
                      <div className="analytics-bar-track">
                        <div className="analytics-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <strong>{value}</strong>
                    </div>
                  );
                })}
              </section>

              <section className="analytics-panel">
                <h4>{t(lang, "analyticsTopReplenishedSkus")}</h4>
                {(analyticsData.skuStats.length === 0 ? [] : analyticsData.skuStats.slice(0, 8)).map((sku) => {
                  const maxConfirmed = Math.max(1, ...analyticsData.skuStats.map((entry) => entry.totalConfirmed));
                  const pct = Math.round((sku.totalConfirmed / maxConfirmed) * 100);
                  return (
                    <div key={sku.skuId} className="analytics-row">
                      <span>{sku.skuId}</span>
                      <div className="analytics-bar-track">
                        <div className="analytics-bar-fill analytics-bar-fill--alt" style={{ width: `${pct}%` }} />
                      </div>
                      <strong>{sku.totalConfirmed}</strong>
                    </div>
                  );
                })}
                {analyticsData.skuStats.length === 0 ? <p className="empty">{t(lang, "noAnalyticsData")}</p> : null}
              </section>

              <section className="analytics-panel analytics-panel--wide">
                <h4>{t(lang, "analyticsStaffPerformance")}</h4>
                <div className="analytics-staff-list">
                  {analyticsData.staffStats.map((entry) => (
                    <div key={entry.memberId} className="analytics-staff-item">
                      <strong>{entry.memberName}</strong>
                      <small>
                        {t(lang, "staffTasksCompleted")}: {entry.completed} · {t(lang, "staffTasksConfirmed")}: {entry.confirmed} ·
                        {" "}{t(lang, "analyticsConfirmedUnits")}: {entry.confirmedQty}
                      </small>
                      <small>
                        {t(lang, "staffAvgCycleTime")}: {entry.avgCycleSeconds === null ? "-" : toDurationLabel(entry.avgCycleSeconds)} ·
                        {" "}{t(lang, "staffAvgAssignToConfirm")}: {entry.avgConfirmSeconds === null ? "-" : toDurationLabel(entry.avgConfirmSeconds)}
                      </small>
                    </div>
                  ))}
                  {analyticsData.staffStats.length === 0 ? <p className="empty">{t(lang, "noAnalyticsData")}</p> : null}
                </div>
              </section>

              <section className="analytics-panel analytics-panel--wide">
                <h4>{t(lang, "analyticsReplenishmentHeatmap")}</h4>
                <div className="analytics-heatmap-wrap">
                  <svg
                    className="analytics-heatmap"
                    viewBox={`0 0 ${SHOPFLOOR_SIZE.width} ${SHOPFLOOR_SIZE.height}`}
                    role="img"
                    aria-label={t(lang, "analyticsReplenishmentHeatmap")}
                  >
                    <image
                      href="/shopfloor-map.png"
                      x="0"
                      y="0"
                      width={SHOPFLOOR_SIZE.width}
                      height={SHOPFLOOR_SIZE.height}
                      preserveAspectRatio="none"
                    />
                    {locations.map((zone) => {
                      const movement = analyticsData.zoneMovement.find((entry) => entry.zoneId === zone.id);
                      const maxQty = Math.max(1, ...analyticsData.zoneMovement.map((entry) => entry.confirmedQty));
                      const intensity = Math.max(0, Math.min(1, (movement?.confirmedQty ?? 0) / maxQty));
                      const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
                      const paletteStart = [34, 197, 94]; // green
                      const paletteMid = [245, 158, 11]; // amber
                      const paletteEnd = [239, 68, 68]; // red
                      const localT = intensity <= 0.5 ? intensity / 0.5 : (intensity - 0.5) / 0.5;
                      const from = intensity <= 0.5 ? paletteStart : paletteMid;
                      const to = intensity <= 0.5 ? paletteMid : paletteEnd;
                      const r = Math.round(lerp(from[0], to[0], localT));
                      const g = Math.round(lerp(from[1], to[1], localT));
                      const b = Math.round(lerp(from[2], to[2], localT));
                      const alpha = 0.2 + intensity * 0.55;
                      const stroke = `rgb(${r}, ${g}, ${b})`;
                      return (
                        <g key={`heat-${zone.id}`}>
                          <polygon
                            points={polygonToPoints(zone.mapPolygon)}
                            className="analytics-heat-zone"
                            style={{ fill: `rgba(${r}, ${g}, ${b}, ${alpha})`, stroke }}
                          />
                          <text
                            x={zone.mapPolygon[0].x + 12}
                            y={zone.mapPolygon[0].y + 24}
                            className="analytics-heat-label"
                          >
                            {zone.name}
                          </text>
                          <text
                            x={zone.mapPolygon[0].x + 12}
                            y={zone.mapPolygon[0].y + 42}
                            className="analytics-heat-sub"
                          >
                            {t(lang, "analyticsConfirmedUnits")}: {movement?.confirmedQty ?? 0}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  <div className="analytics-heat-legend">
                    <span>{t(lang, "analyticsHeatLow")}</span>
                    <div className="analytics-heat-ramp" />
                    <span>{t(lang, "analyticsHeatHigh")}</span>
                  </div>
                  {analyticsData.topZoneMovement ? (
                    <p className="analytics-heat-top">
                      {t(lang, "analyticsTopMovingLocation")}:
                      {" "}
                      <strong>
                        {locations.find((zone) => zone.id === analyticsData.topZoneMovement?.zoneId)?.name ?? analyticsData.topZoneMovement.zoneId}
                      </strong>
                      {" "}
                      ({analyticsData.topZoneMovement.confirmedQty} {t(lang, "unitsSuffix")})
                    </p>
                  ) : null}
                  <div className="analytics-staff-list">
                    {analyticsData.zoneMovement.map((entry) => (
                      <div key={`movement-${entry.zoneId}`} className="analytics-staff-item">
                        <strong>{locations.find((zone) => zone.id === entry.zoneId)?.name ?? entry.zoneId}</strong>
                        <small>
                          {t(lang, "analyticsConfirmedUnits")}: {entry.confirmedQty} · {t(lang, "tasks")}: {entry.confirmedTasks}
                        </small>
                        <small>
                          {t(lang, "analyticsOpenDemandUnits")}: {entry.openDemandQty}
                        </small>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </article>
        )}
      </section>

      {appDisplayMode === "admin" ? (
        <section className="panel">
          <article>
            <h2>{t(lang, "storeFlowTimeline")}</h2>
            <div className="timeline timeline--full">
              {flow.length === 0 ? (
                <p className="empty">{t(lang, "noActionsYet")}</p>
              ) : (
                flow.map((event) => (
                  <div className="timeline-item" key={event.id}>
                    <strong>{event.title}</strong>
                    <small>{event.at}</small>
                    <p>{event.details}</p>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      ) : null}

      {effectiveMainContentView === "map" ? (
      <aside className={showZoneDrawer ? "side-drawer side-drawer--open side-drawer--zone" : "side-drawer side-drawer--zone"}>
        <div className="side-drawer-head">
          <h3>{t(lang, "zonePanel")}</h3>
          <button className="inline-btn" onClick={closeZoneDrawer}>{t(lang, "close")}</button>
        </div>
        <p className="drawer-subtitle">{t(lang, "zoneLabel")}: {selectedZone === "all" ? t(lang, "allZonesGlobal") : selectedZoneSummary?.zoneName ?? selectedZone}</p>
        <div className="drawer-nav">
          <button
            className={zoneDrawerSection === "inventory" ? "drawer-pill drawer-pill--active" : "drawer-pill"}
            onClick={() => setZoneDrawerSection("inventory")}
          >
            {t(lang, "inventory")}
          </button>
          <button
            className={zoneDrawerSection === "rules" ? "drawer-pill drawer-pill--active" : "drawer-pill"}
            onClick={() => setZoneDrawerSection("rules")}
          >
            {t(lang, "rules")}
          </button>
          <button
            className={zoneDrawerSection === "tasks" ? "drawer-pill drawer-pill--active task-toggle" : "drawer-pill task-toggle"}
            onClick={() => setZoneDrawerSection("tasks")}
          >
            {t(lang, "tasks")}
            {(openTasks.filter((task) => selectedZone === "all" || task.zoneId === selectedZone).length +
              pendingReceivingOrders.filter((order) => selectedZone === "all" || order.destinationZoneId === selectedZone).length) > 0 ? (
              <span className="task-badge">
                {openTasks.filter((task) => selectedZone === "all" || task.zoneId === selectedZone).length +
                  pendingReceivingOrders.filter((order) => selectedZone === "all" || order.destinationZoneId === selectedZone).length}
              </span>
            ) : null}
          </button>
          <button
            className={zoneDrawerSection === "settings" ? "drawer-pill drawer-pill--active" : "drawer-pill"}
            onClick={() => setZoneDrawerSection("settings")}
          >
            Settings
          </button>
        </div>

        {zoneDrawerSection === "inventory" ? (
          <details className="drawer-accordion" open>
            <summary>Inventory Available In Zone</summary>
            <div className="inventory-available-list">
              {visibleInventoryRows.length === 0 ? (
                <p className="empty">{t(lang, "noSkuRows")}</p>
              ) : (
                visibleInventoryRows.map((item) => (
                  <div key={`${item.skuId}-${item.source}`} className="inventory-available-item">
                    <div>
                      <strong>{item.skuId}</strong>
                      <small>{item.source}</small>
                    </div>
                    <div className="inventory-available-metrics">
                      <strong>{item.qty} {t(lang, "unitsSuffix")}</strong>
                      <small>{item.confidence !== undefined ? `${Math.round(item.confidence * 100)}% conf.` : t(lang, "deterministic")}</small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </details>
        ) : null}

        {zoneDrawerSection === "settings" ? (
          <>
            <details className="drawer-accordion" open>
              <summary>Location Settings</summary>
              {selectedZone === "all" && !createMode ? (
                <div className="control-group">
                  <p className="empty">Select one zone to edit, or create a new one.</p>
                  <button className="action-btn" onClick={startCreateZone}>Create New Zone</button>
                </div>
              ) : (
                <div className="control-group">
                  {createMode ? (
                    <div className="form-grid">
                      <label>
                        Location Type
                        <select
                          value={newZoneForm.locationType}
                          onChange={(e) => {
                            const locationType = e.target.value as "sales" | "warehouse" | "external";
                            setNewZoneForm((prev) => ({
                              ...prev,
                              locationType
                            }));
                            if (locationType === "external") {
                              setMapEditMode(false);
                              setNewZonePolygon([]);
                            } else {
                              setMapEditMode(true);
                            }
                          }}
                        >
                          <option value="sales">sales</option>
                          <option value="warehouse">warehouse</option>
                          <option value="external">external</option>
                        </select>
                      </label>
                      {newZoneForm.locationType !== "external" ? (
                        <label>
                          Zone ID
                          <input
                            type="text"
                            value={newZoneForm.zoneId}
                            onChange={(e) => setNewZoneForm((prev) => ({ ...prev, zoneId: e.target.value }))}
                          />
                        </label>
                      ) : null}
                      <label>
                        Name
                        <input
                          type="text"
                          value={newZoneForm.name}
                          onChange={(e) => setNewZoneForm((prev) => ({ ...prev, name: e.target.value }))}
                        />
                      </label>
                      {newZoneForm.locationType !== "external" ? (
                        <>
                          <label>
                            Color
                            <input
                              type="color"
                              value={newZoneForm.color}
                              onChange={(e) => setNewZoneForm((prev) => ({ ...prev, color: e.target.value }))}
                            />
                          </label>
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  {!createMode ? (
                  <div className="form-grid">
                    <label>
                      Name
                      <input
                        type="text"
                        value={zoneEditForm.name}
                        onChange={(e) => setZoneEditForm((prev) => ({ ...prev, name: e.target.value }))}
                      />
                    </label>
                    <label>
                      Color
                      <input
                        type="color"
                        value={zoneEditForm.color}
                        onChange={(e) => {
                          const color = e.target.value;
                          setZoneEditForm((prev) => ({ ...prev, color }));
                          setPreviewZoneColor(color);
                        }}
                      />
                    </label>
                    <label>
                      Location Type
                      <select
                        value={zoneEditForm.isSalesLocation ? "sales" : "warehouse"}
                        onChange={(e) =>
                          setZoneEditForm((prev) => ({
                            ...prev,
                            isSalesLocation: e.target.value === "sales"
                          }))
                        }
                      >
                        <option value="sales">sales</option>
                        <option value="warehouse">warehouse</option>
                        <option value="external" disabled>external</option>
                      </select>
                    </label>
                  </div>
                  ) : null}
                  {!createMode || newZoneForm.locationType !== "external" ? (
                    <>
                      <h4>Polygon Editor</h4>
                      <div className="header-action-row">
                        <button
                          className={mapEditMode ? "action-btn" : "inline-btn"}
                          onClick={() => setMapEditMode((prev) => !prev)}
                        >
                          {mapEditMode ? "Stop editing" : "Edit polygon on map"}
                        </button>
                        <button
                          className="inline-btn"
                          onClick={clearCurrentPolygonPoints}
                        >
                          Clear points
                        </button>
                        {createMode ? (
                          <>
                            <button className="action-btn" disabled={newZonePolygon.length < 3} onClick={saveNewZone}>Create zone</button>
                            <button
                              className="inline-btn"
                              onClick={() => {
                                setCreateMode(false);
                                setMapEditMode(false);
                                setNewZonePolygon([]);
                              }}
                            >
                              Cancel create
                            </button>
                          </>
                        ) : (
                          <button className="action-btn" disabled={draftPolygon.length < 3} onClick={savePolygon}>Save polygon</button>
                        )}
                      </div>
                      <pre className="coords-preview">{JSON.stringify(createMode ? newZonePolygon : draftPolygon, null, 2)}</pre>
                    </>
                  ) : (
                    <div className="header-action-row">
                      <button className="action-btn" onClick={saveNewZone}>Create external location</button>
                      <button
                        className="inline-btn"
                        onClick={() => {
                          setCreateMode(false);
                          setMapEditMode(false);
                          setNewZonePolygon([]);
                        }}
                      >
                        Cancel create
                      </button>
                    </div>
                  )}

                  {!createMode ? (
                    <h4>
                      {selectedLocation?.isSalesLocation
                        ? "Replenishment Source Locations (sorted)"
                        : "External Source Locations (sorted)"}
                    </h4>
                  ) : null}
                  {!createMode ? (
                  <div className="inventory-available-list">
                    {sourceEditor.map((row, index) => (
                      <div
                        key={`${row.sourceZoneId}-${index}`}
                        className={
                          "inventory-available-item source-sort-item" +
                          (dragSourceIndex === index ? " source-sort-item--dragging" : "")
                        }
                        draggable
                        onDragStart={() => onSourceDragStart(index)}
                        onDragOver={onSourceDragOver}
                        onDrop={() => onSourceDrop(index)}
                        onDragEnd={onSourceDragEnd}
                      >
                        <button
                          type="button"
                          className="source-drag-handle"
                          aria-label="Drag source location to reorder"
                          title="Drag to reorder"
                        >
                          ⋮⋮
                        </button>
                        <label>
                          <select
                            value={row.sourceZoneId}
                            aria-label="Source location"
                            onChange={(e) =>
                              setSourceEditor((prev) =>
                                prev.map((entry, i) => (i === index ? { ...entry, sourceZoneId: e.target.value } : entry))
                              )
                            }
                          >
                            {sourceEditorOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <div className="source-sort-order">#{row.sortOrder}</div>
                        <button
                          className="inline-btn"
                          onClick={() => setSourceEditor((prev) => prev.filter((_, i) => i !== index))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  ) : null}
                  {!createMode ? (
                    <div className="header-action-row">
                      <button className="inline-btn" onClick={addSourceRow} disabled={sourceEditorOptions.length === 0}>
                        Add Source
                      </button>
                      <button className="action-btn" onClick={saveLocationSettings}>Save Location</button>
                    </div>
                  ) : null}
                </div>
              )}
            </details>
          </>
        ) : null}

        {zoneDrawerSection === "rules" ? (
          <>
            <details className="drawer-accordion" open>
              <summary>{t(lang, "defineMinMaxRule")}</summary>
              <div className="control-group">
                <div className="form-grid">
                  <label>
                    {t(lang, "sku")}
                    <select value={ruleForm.skuId} onChange={(e) => setRuleForm((v) => ({ ...v, skuId: e.target.value }))}>
                      {selectedZoneSkuOptions.length === 0 ? (
                        <option value={ruleForm.skuId}>{ruleForm.skuId}</option>
                      ) : (
                        selectedZoneSkuOptions.map((skuId) => <option key={skuId} value={skuId}>{skuId}</option>)
                      )}
                    </select>
                  </label>
                  <label>
                    {t(lang, "source")}
                    <select value={ruleForm.source} onChange={(e) => setRuleForm((v) => ({ ...v, source: e.target.value as InventorySource }))}>
                      <option value="NON_RFID">NON_RFID</option>
                      <option value="RFID">RFID</option>
                    </select>
                  </label>
                  <label>
                    {t(lang, "min")}
                    <input type="number" min={0} value={ruleForm.minQty} onChange={(e) => setRuleForm((v) => ({ ...v, minQty: Number(e.target.value) }))} />
                  </label>
                  <label>
                    {t(lang, "max")}
                    <input type="number" min={0} value={ruleForm.maxQty} onChange={(e) => setRuleForm((v) => ({ ...v, maxQty: Number(e.target.value) }))} />
                  </label>
                </div>
                <button className="action-btn" disabled={selectedZone === "all"} onClick={upsertRule}>{t(lang, "applyRule")}</button>
              </div>
            </details>
            <details className="drawer-accordion" open>
              <summary>{t(lang, "rulesInZone")}</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>{t(lang, "sku")}</th><th>{t(lang, "source")}</th><th>{t(lang, "min")}</th><th>{t(lang, "max")}</th><th>{t(lang, "action")}</th></tr>
                  </thead>
                  <tbody>
                    {zoneRules.map((rule) => (
                      <tr key={rule.id}>
                        <td>{rule.skuId}</td>
                        <td>{rule.source}</td>
                        <td>{rule.minQty}</td>
                        <td>{rule.maxQty}</td>
                        <td>
                          <button className="inline-btn" onClick={() => deleteRule(rule.id)}>{t(lang, "delete")}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : null}

        {zoneDrawerSection === "tasks" ? (
          <details className="drawer-accordion" open>
            <summary>{t(lang, "tasks")}</summary>
            <div className="task-list">
              {zoneDrawerTaskRows.length === 0 ? (
                <p className="empty">
                  {selectedZone === "all" ? t(lang, "noOpenTasks") : t(lang, "noOpenTasksInZone")}
                </p>
              ) : (
                zoneDrawerTaskRows.map((task) =>
                  "destinationZoneId" in task ? (
                    <div key={task.id} className="task-card">
                      <div className="task-card-top">
                        <div className="task-main">
                          <strong>{task.skuId}</strong>
                          <p>{locationNameById.get(task.destinationZoneId) ?? task.destinationZoneId}</p>
                          <p>{t(lang, "assigned")}: {task.assignedStaffId ?? t(lang, "pendingAssignment")}</p>
                          <p>{t(lang, "source")}: {locationNameById.get(task.sourceLocationId) ?? task.sourceLocationId}</p>
                        </div>
                        <div className="task-controls">
                          <p>in_transit: {task.confirmedQty}/{task.requestedQty}</p>
                          <button
                            className="inline-btn"
                            disabled={task.status !== "IN_TRANSIT" || !task.assignedStaffId}
                            onClick={() => confirmReceivingOrder(task.id)}
                          >
                            {t(lang, "confirm")}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={task.id} className="task-card">
                      <div className="task-card-top">
                        <div className="task-main">
                          <strong>{task.skuId}</strong>
                          <p>{task.zoneId}</p>
                          <p>{t(lang, "assigned")}: {task.assignedStaffId ?? t(lang, "pendingAssignment")}</p>
                          <p>{t(lang, "source")}: {task.sourceZoneId ?? "-"}</p>
                        </div>
                        <div className="task-controls">
                          <p>{t(lang, "deficit")}: {task.deficitQty}</p>
                          <label>
                            {t(lang, "source")}
                            <select
                              value={taskSourceById[task.id] ?? task.sourceZoneId ?? ""}
                              onChange={(e) =>
                                setTaskSourceById((prev) => ({ ...prev, [task.id]: e.target.value }))
                              }
                            >
                              {(task.sourceCandidates ?? []).map((source: { sourceZoneId: string; sortOrder: number; availableQty: number }) => (
                                <option key={source.sourceZoneId} value={source.sourceZoneId}>
                                  {t(lang, "taskSourceOption", {
                                    sourceZoneId: source.sourceZoneId,
                                    sortOrder: source.sortOrder,
                                    availableQty: source.availableQty
                                  })}
                                </option>
                              ))}
                            </select>
                          </label>
                          {task.status === "ASSIGNED" || task.status === "CREATED" ? (
                            <button
                              className="inline-btn"
                              disabled={!task.assignedStaffId && activeStaff.length === 0}
                              onClick={() =>
                                startTask(
                                  task.id,
                                  task.assignedStaffId ?? undefined
                                )
                              }
                            >
                              {t(lang, "accept")}
                            </button>
                          ) : null}
                          <button
                            className="inline-btn"
                            disabled={
                              task.status !== "IN_PROGRESS" ||
                              ((task.sourceCandidates ?? []).find(
                                (source) =>
                                  source.sourceZoneId === (taskSourceById[task.id] ?? task.sourceZoneId ?? "")
                              )?.availableQty ?? 0) <= 0
                            }
                            onClick={() =>
                              confirmTask(
                                task.id,
                                task.deficitQty,
                                taskSourceById[task.id] ?? task.sourceZoneId,
                                task.assignedStaffId ?? undefined
                              )
                            }
                          >
                            {t(lang, "finish")}
                          </button>
                        </div>
                      </div>
                      <div className="task-audit-mini">
                        {(taskAudit.filter((entry) => entry.taskId === task.id).slice(0, 3)).map((entry) => (
                          <small key={entry.id}>
                            {entry.timestamp} · {entry.action} · {entry.actorId ?? t(lang, "system")}
                          </small>
                        ))}
                      </div>
                    </div>
                  )
                )
              )}
            </div>
          </details>
        ) : null}

      </aside>
      ) : null}

      {appDisplayMode === "admin" ? (
      <>
      <aside className={showRfidDrawer ? "side-drawer side-drawer--open side-drawer--rfid" : "side-drawer side-drawer--rfid"}>
        <div className="side-drawer-head">
          <h3>RFID Pulse & Data</h3>
          <button className="inline-btn" onClick={() => setShowRfidDrawer(false)}>{t(lang, "close")}</button>
        </div>
        <p className="drawer-subtitle">{t(lang, "rfidDrawerSubtitle")}</p>
        <div className="control-group">
          <h4>{t(lang, "autoSweep")}</h4>
          <div className="auto-sweep-pill auto-sweep-pill--subtle">
            <small>{t(lang, "autoSweepEvery")}</small>
            <strong>{t(lang, "autoSweepNextIn", { seconds: autoSweepRemainingSec })}</strong>
            <button className="auto-sweep-toggle-btn" onClick={() => setAutoSweepEnabled((prev) => !prev)}>
              {autoSweepEnabled ? t(lang, "autoSweepPause") : t(lang, "autoSweepResume")}
            </button>
          </div>
        </div>
        <div className="control-group">
          <h4>{t(lang, "rfidManualPulseSection")}</h4>
          <p className="drawer-subtitle">{t(lang, "rfidManualPulseHint")}</p>
          <div className="form-grid">
            <label>
              EPC
              <select value={rfidForm.epc} onChange={(e) => setRfidForm((prev) => ({ ...prev, epc: e.target.value }))}>
                {rfidCatalog.epcMappings.map((entry) => (
                  <option key={entry.epc} value={entry.epc}>{entry.epc} ({entry.skuId})</option>
                ))}
              </select>
            </label>
            <label>
              Antenna
              <select value={rfidForm.antennaId} onChange={(e) => setRfidForm((prev) => ({ ...prev, antennaId: e.target.value }))}>
                {rfidCatalog.antennas.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.id} ({entry.zoneId}) [{Math.round(entry.x)},{Math.round(entry.y)}]
                  </option>
                ))}
              </select>
            </label>
            <label>
              RSSI
              <input
                type="number"
                step="0.1"
                value={rfidForm.rssi}
                onChange={(e) => setRfidForm((prev) => ({ ...prev, rssi: Number(e.target.value) }))}
              />
            </label>
          </div>
          <button className="action-btn" onClick={injectRFIDPulse}>{t(lang, "injectRfidPulse")}</button>
        </div>
        <div className="control-group">
          <h4>{t(lang, "rfidZoneSweepSection")}</h4>
          <p className="drawer-subtitle">{t(lang, "rfidZoneSweepHint")}</p>
          <div className="form-grid">
            <label>
              {t(lang, "zoneLabel")}
              <select value={rfidSweepZoneId} onChange={(e) => setRfidSweepZoneId(e.target.value as InventoryZoneId)}>
                {locations.map((zone) => (
                  <option key={`rfid-sweep-${zone.id}`} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="action-btn action-btn--ghost" onClick={forceRfidZoneSweep}>{t(lang, "forceZoneSweep")}</button>
        </div>
        <details className="drawer-accordion" open>
          <summary>{t(lang, "rfidCatalogPreview")}</summary>
          <pre className="coords-preview">{JSON.stringify(rfidCatalog, null, 2)}</pre>
        </details>
      </aside>

      <aside className={showSalesDrawer ? "side-drawer side-drawer--open side-drawer--sales" : "side-drawer side-drawer--sales"}>
        <div className="side-drawer-head">
          <h3>{t(lang, "customerCartCheckout")}</h3>
          <button className="inline-btn" onClick={() => setShowSalesDrawer(false)}>{t(lang, "close")}</button>
        </div>
        <p className="drawer-subtitle">{t(lang, "createItemsAndCheckout")}</p>
        <div className="control-group">
          <div className="form-grid">
            <label>
              {t(lang, "zoneLabel")}
              <select value={saleZoneId} onChange={(e) => setSaleZoneId(e.target.value as InventoryZoneId)}>
                {salesEnabledLocations.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t(lang, "sku")}
              <select value={saleForm.skuId} onChange={(e) => setSaleForm((v) => ({ ...v, skuId: e.target.value }))}>
                {saleSkuAvailability.map((sku) => (
                  <option key={sku.skuId} value={sku.skuId} disabled={sku.availableQty <= 0}>
                    {sku.skuId} ({sku.source}) - {sku.availableQty} {t(lang, "unitsSuffix")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t(lang, "qty")}
              <input
                type="number"
                min={1}
                max={Math.max(1, maxSaleQty)}
                value={saleForm.qty}
                onChange={(e) =>
                  setSaleForm((v) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return v;
                    const clamped = Math.max(1, Math.min(raw, Math.max(1, maxSaleQty)));
                    return { ...v, qty: clamped };
                  })
                }
              />
            </label>
          </div>
          <button className="action-btn" disabled={!canAddToCart} onClick={() => createPosSale(false)}>
            {selectedCustomerId ? t(lang, "addItemToCart") : t(lang, "createCartAndAddItem")}
          </button>
          {selectedCustomerId ? (
            <button className="inline-btn" disabled={!canAddToCart} onClick={() => createPosSale(true)}>
              {t(lang, "createAnotherCart")}
            </button>
          ) : null}
          {salesStatusMessage ? <p className="drawer-subtitle">{salesStatusMessage}</p> : null}
        </div>
        <details className="drawer-accordion" open>
          <summary>{t(lang, "customerItemsInCart")}</summary>
          <div className="sales-cart-items-head">
            <div className="sales-cart-items-head-main">
              <strong>{t(lang, "activeCart")}: {customers.find((entry) => entry.id === selectedCustomerId)?.name ?? t(lang, "autoCartPending")}</strong>
              <small>
                {selectedCustomerId
                  ? `${t(lang, "customer")}: ${selectedCustomerId} · ${customerBasket.length} ${t(lang, "items")}`
                  : t(lang, "autoCartPendingDetail")}
              </small>
            </div>
            <div className="sales-cart-items-head-actions">
              <button
                className="action-btn"
                disabled={!selectedCustomerId || customerBasket.length === 0}
                onClick={() => checkoutCustomer(selectedCustomerId)}
              >
                {t(lang, "checkoutCustomer")}
              </button>
            </div>
          </div>
          <div className="inventory-available-list">
            {customerBasket.length === 0 ? (
              <p className="empty">{t(lang, "noItemsInCart")}</p>
            ) : (
              customerBasket.map((item) => {
                const source = SKU_SOURCE_BY_ID.get(item.skuId) ?? "NON_RFID";
                const state = getCartItemState(source, item.qty, item.pickedConfirmedQty);
                return (
                  <div key={item.id} className="inventory-available-item">
                    <div>
                      <strong>{item.skuId}</strong>
                      <small>{item.zoneId} · {source}</small>
                    </div>
                    <div className="inventory-available-metrics">
                      <strong>{item.qty} {t(lang, "unitsSuffix")}</strong>
                      <small>{t(lang, "pickedRfid")}: {item.pickedConfirmedQty}</small>
                      <span className={`state-badge state-badge--${state.toLowerCase()}`}>{state}</span>
                      <button className="inline-btn" onClick={() => removeCustomerItem(item.id)}>{t(lang, "remove")}</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <p className="drawer-subtitle">{t(lang, "tipRfidPulse")}</p>
        </details>
        <details className="drawer-accordion" open>
          <summary>{t(lang, "otherCustomersInProgress")}</summary>
          <div className="inventory-available-list">
            {otherCustomersInProgress.length === 0 ? (
              <p className="empty">{t(lang, "noOtherCustomersInProgress")}</p>
            ) : (
              otherCustomersInProgress.map((entry) => (
                <div key={entry.customerId} className="inventory-available-item">
                  <div>
                    <strong>{entry.customerName}</strong>
                    <small>{entry.customerId}</small>
                  </div>
                  <div className="inventory-available-metrics">
                    <strong>{entry.items.length} {t(lang, "items")}</strong>
                    <small>
                      {entry.items
                        .map((item) => {
                          const source = SKU_SOURCE_BY_ID.get(item.skuId) ?? "NON_RFID";
                          return `${item.skuId} x${item.qty} (${item.zoneId}, ${source})`;
                        })
                        .join(" | ")}
                    </small>
                    <button className="inline-btn" onClick={() => setSelectedCustomerId(entry.customerId)}>
                      {t(lang, "useCart")}
                    </button>
                    <button className="inline-btn" onClick={() => checkoutCustomer(entry.customerId)}>
                      {t(lang, "checkoutCustomer")}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </details>
      </aside>
      </>
      ) : null}
    </main>
  );
}
