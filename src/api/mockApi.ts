import { sampleDataset } from "../data/sampleDataset";
import type { CatalogProduct, CatalogVariant } from "../data/sampleDataset";
import type {
  ReplenishmentTaskListResponse,
  ZoneDetailResponse,
  ZoneInventoryDashboardResponse
} from "../domain/contracts";
import type { InventorySource, RFIDReadEvent, SalesEvent, TaskStatus, Zone } from "../domain/models";
import { InventoryEngine } from "../logic/inventoryEngine";

interface FlowEvent {
  id: string;
  at: string;
  type:
    | "RFID_READ"
    | "RFID_SWEEP"
    | "SALE_NON_RFID"
    | "SALE_RFID"
    | "RULE_UPSERT"
    | "RULE_DELETE"
    | "TASK_CONFIRM"
    | "TASK_ASSIGN"
    | "LOCATION_UPDATE"
    | "STAFF_SHIFT"
    | "CUSTOMER_PICK"
    | "CUSTOMER_CHECKOUT"
    | "CUSTOMER_REMOVE"
    | "RECEIVING_CREATE"
    | "RECEIVING_CONFIRM";
  title: string;
  details: string;
}

export interface CatalogVariantView extends CatalogVariant {
  source: InventorySource;
  rfidInStore: {
    totalEpcs: number;
    byLocation: Array<{ zoneId: string; zoneName: string; qty: number }>;
  } | null;
}

export interface CatalogProductView extends Omit<CatalogProduct, "variants"> {
  variants: CatalogVariantView[];
}

type CatalogKitValue = "home" | "away" | "third" | "forth";
type CatalogAgeGroupValue = "adults" | "youth" | "kids" | "baby";
type CatalogGenderValue = "women" | "men" | "unisex";
type CatalogRoleValue = "player" | "goalkeeper" | "staff";
type CatalogQualityValue = "match" | "stadium";

export interface MinMaxRuleAttributesSelector {
  kit?: CatalogKitValue;
  ageGroup?: CatalogAgeGroupValue;
  gender?: CatalogGenderValue;
  role?: CatalogRoleValue;
  quality?: CatalogQualityValue;
}

export interface MinMaxRuleTemplate {
  id: string;
  scope: "GENERIC" | "LOCATION";
  zoneId?: string;
  selectorMode: "SKU" | "ATTRIBUTES";
  skuId?: string;
  attributes?: MinMaxRuleAttributesSelector;
  source: InventorySource;
  inboundSourceLocationId?: string;
  minQty: number;
  maxQty: number;
  priority: number;
  isActive: boolean;
  updatedAt: string;
}

const flowEvents: FlowEvent[] = [];
const LOCATIONS_SETUP_STORAGE_KEY = "adaptive-sim:locations-setup:v1";
const DEFAULT_EXTERNAL_RECEIVING_LOCATIONS: Array<{ id: string; name: string }> = [
  { id: "external-esbo", name: "External Warehouse" }
];
let externalReceivingLocations = [...DEFAULT_EXTERNAL_RECEIVING_LOCATIONS];

function toMs(value: string): number {
  return new Date(value).getTime();
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function cloneDatasetFromSample() {
  return JSON.parse(JSON.stringify(sampleDataset)) as typeof sampleDataset;
}

function normalizeLocationsAntennaIds(
  locations: Zone[],
  antennas: Array<{ id: string; zoneId: string }>
): Zone[] {
  const antennaByZone = new Map<string, string>();
  for (const antenna of antennas) {
    if (!antennaByZone.has(antenna.zoneId)) {
      antennaByZone.set(antenna.zoneId, antenna.id);
    }
  }

  return locations.map((location) => {
    const primaryAntennaId = antennaByZone.get(location.id);
    return {
      ...location,
      antennaIds: primaryAntennaId ? [primaryAntennaId] : []
    };
  });
}

function loadPersistedLocations(): Zone[] | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(LOCATIONS_SETUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as Zone[];
  } catch {
    return null;
  }
}

function saveLocationsSetup(locations: Zone[]): void {
  if (!canUseStorage()) return;
  const normalized = normalizeLocationsAntennaIds(locations, sampleDataset.antennas);
  window.localStorage.setItem(LOCATIONS_SETUP_STORAGE_KEY, JSON.stringify(normalized));
}

const bootDataset = cloneDatasetFromSample();
const persistedLocations = loadPersistedLocations();
if (persistedLocations && persistedLocations.length > 0) {
  bootDataset.zones = normalizeLocationsAntennaIds(persistedLocations, bootDataset.antennas);
}

const engine = new InventoryEngine(bootDataset);
engine.loadDemoStream(bootDataset.rfidReadEvents, bootDataset.salesEvents);
const skuSourceById = new Map(bootDataset.skus.map((sku) => [sku.id, sku.source]));
const antennaNameById = new Map(bootDataset.antennas.map((antenna) => [antenna.id, antenna.name]));
const catalogVariantBySku = new Map(
  bootDataset.catalogProducts.flatMap((product) =>
    product.variants.map((variant) => [variant.skuId, variant] as const)
  )
);
let minMaxRuleTemplates: MinMaxRuleTemplate[] = engine.getRules().map((rule, index) => ({
  id: `tpl-bootstrap-${index + 1}`,
  scope: "LOCATION",
  zoneId: rule.zoneId,
  selectorMode: "SKU",
  skuId: rule.skuId,
  source: rule.source,
  inboundSourceLocationId: rule.inboundSourceLocationId,
  minQty: rule.minQty,
  maxQty: rule.maxQty,
  priority: rule.priority,
  isActive: rule.isActive,
  updatedAt: rule.updatedAt
}));
let managedEffectiveRuleIds = new Set<string>();

function cleanupSelectorAttributes(
  attributes?: MinMaxRuleAttributesSelector
): MinMaxRuleAttributesSelector | undefined {
  if (!attributes) return undefined;
  const cleaned: MinMaxRuleAttributesSelector = {};
  if (attributes.kit) cleaned.kit = attributes.kit;
  if (attributes.ageGroup) cleaned.ageGroup = attributes.ageGroup;
  if (attributes.gender) cleaned.gender = attributes.gender;
  if (attributes.role) cleaned.role = attributes.role;
  if (attributes.quality) cleaned.quality = attributes.quality;
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function variantMatchesAttributes(
  variant: CatalogVariant | undefined,
  attributes: MinMaxRuleAttributesSelector | undefined
): boolean {
  if (!variant) return false;
  if (!attributes) return true;
  if (attributes.kit && variant.kit !== attributes.kit) return false;
  if (attributes.ageGroup && variant.ageGroup !== attributes.ageGroup) return false;
  if (attributes.gender && variant.gender !== attributes.gender) return false;
  if (attributes.role && variant.role !== attributes.role) return false;
  if (attributes.quality && variant.quality !== attributes.quality) return false;
  return true;
}

function resolveTemplateSkuIds(template: MinMaxRuleTemplate): string[] {
  const sourceMatches = bootDataset.skus
    .filter((sku) => sku.source === template.source)
    .map((sku) => sku.id);
  if (template.selectorMode === "SKU") {
    if (!template.skuId || !sourceMatches.includes(template.skuId)) return [];
    return [template.skuId];
  }

  return sourceMatches.filter((skuId) =>
    variantMatchesAttributes(catalogVariantBySku.get(skuId), template.attributes)
  );
}

function resolveTemplateZoneIds(template: MinMaxRuleTemplate): string[] {
  if (template.scope === "LOCATION") {
    if (!template.zoneId) return [];
    return engine.getLocations().some((zone) => zone.id === template.zoneId) ? [template.zoneId] : [];
  }
  return engine.getLocations().map((zone) => zone.id);
}

function effectiveRuleId(zoneId: string, skuId: string, source: InventorySource): string {
  return `rule-${zoneId}-${skuId}-${source}`.toLowerCase();
}

function shouldReplaceWinner(
  nextTemplate: MinMaxRuleTemplate,
  currentTemplate: MinMaxRuleTemplate
): boolean {
  const nextScopeWeight = nextTemplate.scope === "LOCATION" ? 2 : 1;
  const currentScopeWeight = currentTemplate.scope === "LOCATION" ? 2 : 1;
  if (nextScopeWeight !== currentScopeWeight) return nextScopeWeight > currentScopeWeight;
  if (nextTemplate.priority !== currentTemplate.priority) return nextTemplate.priority > currentTemplate.priority;
  return toMs(nextTemplate.updatedAt) >= toMs(currentTemplate.updatedAt);
}

function syncEffectiveRulesFromTemplates(): void {
  const winnerByKey = new Map<string, MinMaxRuleTemplate>();
  for (const template of minMaxRuleTemplates.filter((entry) => entry.isActive)) {
    const skuIds = resolveTemplateSkuIds(template);
    const zoneIds = resolveTemplateZoneIds(template);
    for (const zoneId of zoneIds) {
      for (const skuId of skuIds) {
        const key = `${zoneId}::${skuId}::${template.source}`;
        const currentWinner = winnerByKey.get(key);
        if (!currentWinner || shouldReplaceWinner(template, currentWinner)) {
          winnerByKey.set(key, template);
        }
      }
    }
  }

  const desiredRuleIds = new Set<string>();
  for (const [key, template] of winnerByKey.entries()) {
    const [zoneId, skuId, sourceRaw] = key.split("::");
    const source = sourceRaw as InventorySource;
    const rule = engine.upsertRule({
      zoneId,
      skuId,
      source,
      inboundSourceLocationId: template.inboundSourceLocationId,
      minQty: template.minQty,
      maxQty: template.maxQty,
      priority: template.priority
    });
    desiredRuleIds.add(rule.id);
  }

  for (const ruleId of managedEffectiveRuleIds) {
    if (desiredRuleIds.has(ruleId)) continue;
    engine.deleteRule(ruleId);
  }
  managedEffectiveRuleIds = desiredRuleIds;
}

function upsertMinMaxRuleTemplateInternal(payload: {
  id?: string;
  scope: "GENERIC" | "LOCATION";
  zoneId?: string;
  selectorMode: "SKU" | "ATTRIBUTES";
  skuId?: string;
  attributes?: MinMaxRuleAttributesSelector;
  source: InventorySource;
  inboundSourceLocationId?: string;
  minQty: number;
  maxQty: number;
  priority?: number;
}): { status: string; template?: MinMaxRuleTemplate } {
  if (payload.maxQty < payload.minQty) return { status: "invalid_min_max" };
  if (payload.scope === "LOCATION" && !payload.zoneId) return { status: "zone_required" };
  if (
    payload.scope === "LOCATION" &&
    payload.zoneId &&
    !engine.getLocations().some((zone) => zone.id === payload.zoneId)
  ) {
    return { status: "zone_not_found" };
  }
  if (payload.selectorMode === "SKU" && !payload.skuId) return { status: "sku_required" };

  const now = engine.getNow();
  const existingIndex = payload.id
    ? minMaxRuleTemplates.findIndex((entry) => entry.id === payload.id)
    : -1;

  const nextTemplate: MinMaxRuleTemplate = {
    id: existingIndex >= 0 ? minMaxRuleTemplates[existingIndex].id : `tpl-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    scope: payload.scope,
    zoneId: payload.scope === "LOCATION" ? payload.zoneId : undefined,
    selectorMode: payload.selectorMode,
    skuId: payload.selectorMode === "SKU" ? payload.skuId : undefined,
    attributes: payload.selectorMode === "ATTRIBUTES" ? cleanupSelectorAttributes(payload.attributes) : undefined,
    source: payload.source,
    inboundSourceLocationId: payload.inboundSourceLocationId,
    minQty: payload.minQty,
    maxQty: payload.maxQty,
    priority: payload.priority ?? 2,
    isActive: true,
    updatedAt: now
  };

  if (existingIndex >= 0) {
    minMaxRuleTemplates[existingIndex] = nextTemplate;
  } else {
    minMaxRuleTemplates = [...minMaxRuleTemplates, nextTemplate];
  }
  syncEffectiveRulesFromTemplates();
  return { status: existingIndex >= 0 ? "updated" : "created", template: nextTemplate };
}

function deleteMinMaxRuleTemplateInternal(templateId: string): { status: string } {
  const index = minMaxRuleTemplates.findIndex((entry) => entry.id === templateId);
  if (index < 0) return { status: "not_found" };
  minMaxRuleTemplates[index] = {
    ...minMaxRuleTemplates[index],
    isActive: false,
    updatedAt: engine.getNow()
  };
  syncEffectiveRulesFromTemplates();
  return { status: "deleted" };
}

syncEffectiveRulesFromTemplates();

function zoneLabel(zoneId: string): string {
  const zone = engine.getLocations().find((entry) => entry.id === zoneId);
  return zone?.name ?? zoneId;
}

function locationLabel(locationId: string): string {
  const external = externalReceivingLocations.find((entry) => entry.id === locationId);
  if (external) return external.name;
  return zoneLabel(locationId);
}

function pushFlow(event: Omit<FlowEvent, "id">): void {
  flowEvents.unshift({
    id: `flow-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    ...event
  });
}

function toExternalLocationId(name: string, existingIds: Set<string>): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const normalized = base || "location";
  let candidate = `external-${normalized}`;
  let seq = 2;
  while (existingIds.has(candidate)) {
    candidate = `external-${normalized}-${seq}`;
    seq += 1;
  }
  return candidate;
}

function toDashboard(): ZoneInventoryDashboardResponse {
  const asOf = engine.getNow();
  const locations = engine.getLocations();

  return {
    asOf,
    zones: locations.map((zone) => {
      const snapshots = engine.getZoneSnapshots(zone.id);
      const lowStockCount = engine.getRules(zone.id).filter((rule) => {
        const item = snapshots.find((s) => s.skuId === rule.skuId && s.source === rule.source);
        return (item?.qty ?? 0) <= rule.minQty;
      }).length;

      const openTaskCount = engine
        .getTasks()
        .filter((t) => t.zoneId === zone.id && (t.status === "CREATED" || t.status === "ASSIGNED" || t.status === "IN_PROGRESS")).length;

      return {
        zoneId: zone.id,
        zoneName: zone.name,
        color: zone.color,
        isSalesLocation: zone.isSalesLocation,
        lowStockCount,
        openTaskCount,
        inventory: snapshots.map((s) => ({
          skuId: s.skuId,
          qty: s.qty,
          source: s.source,
          confidence: s.confidence
        }))
      };
    })
  };
}

function toZoneDetail(zoneId: string): ZoneDetailResponse | null {
  const zone = engine.getLocations().find((z) => z.id === zoneId);
  if (!zone) return null;

  return {
    zone: {
      zoneId: zone.id,
      name: zone.name,
      color: zone.color,
      isSalesLocation: zone.isSalesLocation,
      replenishmentSources: zone.replenishmentSources,
      mapPolygon: zone.mapPolygon,
      antennas: bootDataset.antennas
        .filter((a) => a.zoneId === zone.id)
        .map((a) => ({ antennaId: a.id, name: a.name, isActive: a.isActive }))
    },
    asOf: engine.getNow(),
    inventory: engine.getZoneSnapshots(zone.id).map((s) => ({
      skuId: s.skuId,
      qty: s.qty,
      source: s.source,
      confidence: s.confidence,
      lastCalculatedAt: s.lastCalculatedAt
    })),
    recentRFIDReads: engine.getRecentRFIDReads(zone.id).map((e) => ({
      eventId: e.id,
      epc: e.epc,
      antennaId: e.antennaId,
      timestamp: e.timestamp,
      rssi: e.rssi
    })),
    openTasks: engine
      .getTasks()
      .filter((t) => t.zoneId === zone.id && (t.status === "CREATED" || t.status === "ASSIGNED" || t.status === "IN_PROGRESS"))
      .map((t) => ({
        taskId: t.id,
        skuId: t.skuId,
        sourceZoneId: t.sourceZoneId,
        assignedStaffId: t.assignedStaffId,
        status: t.status as "CREATED" | "ASSIGNED" | "IN_PROGRESS",
        deficitQty: t.deficitQty,
        targetQty: t.targetQty,
        createdAt: t.createdAt
      }))
  };
}

function toTasks(zoneId?: string, status?: TaskStatus): ReplenishmentTaskListResponse {
  let tasks = engine.getTasks(status);
  if (zoneId) tasks = tasks.filter((t) => t.zoneId === zoneId);

  return {
    filters: {
      zoneId: zoneId ?? null,
      status: status ?? null
    },
    tasks: tasks.map((t) => ({ ...t })),
    page: 1,
    pageSize: 50,
    total: tasks.length
  };
}

function toCatalog(): CatalogProductView[] {
  const locations = engine.getLocations();
  return bootDataset.catalogProducts.map((product) => ({
    ...product,
    variants: product.variants.map((variant) => {
      const source = skuSourceById.get(variant.skuId) ?? "NON_RFID";
      if (source !== "RFID") {
        return {
          ...variant,
          source,
          rfidInStore: null
        };
      }
      const byLocation = locations
        .map((location) => {
          const qty = engine
            .getZoneSnapshots(location.id)
            .find((snapshot) => snapshot.skuId === variant.skuId && snapshot.source === "RFID")?.qty ?? 0;
          return {
            zoneId: location.id,
            zoneName: location.name,
            qty
          };
        })
        .filter((entry) => entry.qty > 0);

      return {
        ...variant,
        source,
        rfidInStore: {
          totalEpcs: byLocation.reduce((sum, entry) => sum + entry.qty, 0),
          byLocation
        }
      };
    })
  }));
}

export const api = {
  postRFIDRead(payload: RFIDReadEvent) {
    const result = engine.ingestRFIDRead(payload);
    const zone = zoneLabel(payload.zoneId);
    const antenna = antennaNameById.get(payload.antennaId) ?? payload.antennaId;
    pushFlow({
      at: payload.timestamp,
      type: "RFID_READ",
      title: `RFID pulse in ${zone}`,
      details: `epc=${payload.epc} antenna=${antenna} status=${result.status}`
    });

    return {
      status: result.status,
      eventId: payload.id,
      skuId: result.skuId,
      zoneId: payload.zoneId
    };
  },

  postRFIDZoneSweep(payload: { zoneId: string; timestamp: string }) {
    const result = engine.forceZoneSweep(payload.zoneId, payload.timestamp);
    const zone = zoneLabel(payload.zoneId);
    pushFlow({
      at: payload.timestamp,
      type: "RFID_SWEEP",
      title: `RFID sweep in ${zone}`,
      details: `removed_epcs=${result.removedEpcs ?? 0} status=${result.status}`
    });
    return result;
  },

  postRFIDZoneScan(payload: { zoneId: string; timestamp: string }) {
    const result = engine.scanZone(payload.zoneId, payload.timestamp);
    const zone = zoneLabel(payload.zoneId);
    pushFlow({
      at: payload.timestamp,
      type: "RFID_SWEEP",
      title: `RFID auto-scan in ${zone}`,
      details: `status=${result.status}`
    });
    return result;
  },

  postSalesEvent(payload: SalesEvent) {
    const result = engine.ingestSalesEvent(payload);
    const source = skuSourceById.get(payload.skuId) ?? "NON_RFID";
    const eventType = source === "RFID" ? "SALE_RFID" : "SALE_NON_RFID";
    pushFlow({
      at: payload.timestamp,
      type: eventType,
      title: `POS sale in ${payload.zoneId}`,
      details: `sku=${payload.skuId} source=${source} qty=${payload.qty} status=${result.status}`
    });

    return {
      status: result.status,
      eventId: payload.id,
      recalculationTriggered: true
    };
  },

  getCustomers() {
    return engine.getCustomers();
  },

  addCustomerItem(payload: {
    customerId: string;
    zoneId: string;
    skuId: string;
    qty: number;
    timestamp: string;
  }) {
    const source = skuSourceById.get(payload.skuId) ?? "NON_RFID";
    const result = engine.addCustomerItem(payload);
    pushFlow({
      at: payload.timestamp,
      type: "CUSTOMER_PICK",
      title: `Customer ${payload.customerId} picked in ${payload.zoneId}`,
      details: `sku=${payload.skuId} source=${source} qty=${payload.qty} status=${result.status}${result.availableQty !== undefined ? ` available=${result.availableQty}` : ""}`
    });
    return result;
  },

  getCustomerBasket(customerId: string) {
    return engine.getCustomerBasket(customerId);
  },

  checkoutCustomer(payload: { customerId: string; timestamp: string }) {
    const result = engine.checkoutCustomer(payload.customerId, payload.timestamp);
    pushFlow({
      at: payload.timestamp,
      type: "CUSTOMER_CHECKOUT",
      title: `Customer ${payload.customerId} checkout`,
      details: `sold_items=${result.soldItems} status=${result.status}`
    });
    return result;
  },

  removeCustomerItem(payload: { basketItemId: string; timestamp: string }) {
    const result = engine.removeCustomerItem(payload);
    pushFlow({
      at: payload.timestamp,
      type: "CUSTOMER_REMOVE",
      title: `Customer cart item removed`,
      details: `basket_item=${payload.basketItemId} status=${result.status} restored_qty=${result.restoredQty}`
    });
    return result;
  },

  upsertMinMaxRule(payload: {
    zoneId: string;
    skuId: string;
    source: InventorySource;
    inboundSourceLocationId?: string;
    minQty: number;
    maxQty: number;
    priority?: number;
  }) {
    const existingTemplate = minMaxRuleTemplates.find(
      (entry) =>
        entry.isActive &&
        entry.scope === "LOCATION" &&
        entry.selectorMode === "SKU" &&
        entry.zoneId === payload.zoneId &&
        entry.skuId === payload.skuId &&
        entry.source === payload.source
    );
    const result = upsertMinMaxRuleTemplateInternal({
      id: existingTemplate?.id,
      scope: "LOCATION",
      zoneId: payload.zoneId,
      selectorMode: "SKU",
      skuId: payload.skuId,
      source: payload.source,
      inboundSourceLocationId: payload.inboundSourceLocationId,
      minQty: payload.minQty,
      maxQty: payload.maxQty,
      priority: payload.priority
    });
    const rule = engine
      .getRules(payload.zoneId)
      .find((entry) => entry.skuId === payload.skuId && entry.source === payload.source);
    pushFlow({
      at: engine.getNow(),
      type: "RULE_UPSERT",
      title: `Rule updated in ${payload.zoneId}`,
      details: `sku=${payload.skuId} source=${payload.source} min=${payload.minQty} max=${payload.maxQty} status=${result.status}`
    });
    return rule ?? null;
  },

  deleteRule(ruleId: string) {
    const resolvedRule = engine.getRules().find((entry) => entry.id === ruleId);
    let result: { status: string; zoneId?: string };
    if (resolvedRule) {
      const matchingTemplate = minMaxRuleTemplates.find(
        (entry) =>
          entry.isActive &&
          entry.scope === "LOCATION" &&
          entry.selectorMode === "SKU" &&
          entry.zoneId === resolvedRule.zoneId &&
          entry.skuId === resolvedRule.skuId &&
          entry.source === resolvedRule.source
      );
      if (matchingTemplate) {
        const deleted = deleteMinMaxRuleTemplateInternal(matchingTemplate.id);
        result = { status: deleted.status, zoneId: resolvedRule.zoneId };
      } else {
        result = engine.deleteRule(ruleId);
      }
    } else {
      result = engine.deleteRule(ruleId);
    }
    pushFlow({
      at: engine.getNow(),
      type: "RULE_DELETE",
      title: "Rule deleted",
      details: `rule_id=${ruleId} status=${result.status}`
    });
    return result;
  },

  getRules(zoneId?: string) {
    return engine.getRules(zoneId).map((rule) => ({ ...rule }));
  },

  getMinMaxRuleTemplates() {
    return minMaxRuleTemplates
      .filter((entry) => entry.isActive)
      .sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt))
      .map((entry) => ({ ...entry, attributes: entry.attributes ? { ...entry.attributes } : undefined }));
  },

  upsertMinMaxRuleTemplate(payload: {
    id?: string;
    scope: "GENERIC" | "LOCATION";
    zoneId?: string;
    selectorMode: "SKU" | "ATTRIBUTES";
    skuId?: string;
    attributes?: MinMaxRuleAttributesSelector;
    source: InventorySource;
    inboundSourceLocationId?: string;
    minQty: number;
    maxQty: number;
    priority?: number;
  }) {
    const result = upsertMinMaxRuleTemplateInternal(payload);
    pushFlow({
      at: engine.getNow(),
      type: "RULE_UPSERT",
      title: `Rule template ${result.status}`,
      details: `scope=${payload.scope} zone=${payload.zoneId ?? "all"} selector=${payload.selectorMode} source=${payload.source}`
    });
    return result;
  },

  deleteMinMaxRuleTemplate(templateId: string) {
    const result = deleteMinMaxRuleTemplateInternal(templateId);
    pushFlow({
      at: engine.getNow(),
      type: "RULE_DELETE",
      title: "Rule template deleted",
      details: `template_id=${templateId} status=${result.status}`
    });
    return result;
  },

  getLocations() {
    return engine.getLocations();
  },

  updateLocation(payload: {
    zoneId: string;
    name?: string;
    color?: string;
    isSalesLocation?: boolean;
    mapPolygon?: Array<{ x: number; y: number }>;
    replenishmentSources?: Array<{ sourceZoneId: string; sortOrder: number }>;
  }) {
    const result = engine.updateLocation(payload);
    if (result.status === "updated") {
      saveLocationsSetup(engine.getLocations());
    }
    pushFlow({
      at: engine.getNow(),
      type: "LOCATION_UPDATE",
      title: `Location updated ${payload.zoneId}`,
      details: `status=${result.status} name=${payload.name ?? "-"} sales=${payload.isSalesLocation ?? "-"}`
    });
    return result;
  },

  createLocation(payload: {
    zoneId: string;
    name: string;
    color: string;
    isSalesLocation: boolean;
    mapPolygon: Array<{ x: number; y: number }>;
    replenishmentSources?: Array<{ sourceZoneId: string; sortOrder: number }>;
  }) {
    const result = engine.createLocation(payload);
    if (result.status === "created") {
      saveLocationsSetup(engine.getLocations());
    }
    pushFlow({
      at: engine.getNow(),
      type: "LOCATION_UPDATE",
      title: `Location created ${payload.zoneId}`,
      details: `status=${result.status} name=${payload.name} sales=${payload.isSalesLocation}`
    });
    return result;
  },

  getRfidCatalog() {
    return {
      antennas: bootDataset.antennas.map((antenna) => ({
        id: antenna.id,
        zoneId: antenna.zoneId,
        name: antenna.name,
        x: antenna.x,
        y: antenna.y
      })),
      epcMappings: bootDataset.epcSkuMapping.map((mapping) => ({
        epc: mapping.epc,
        skuId: mapping.skuId
      }))
    };
  },

  getStaff(activeOnly = false) {
    return engine.getStaff(activeOnly);
  },

  updateStaffShift(payload: { staffId: string; activeShift: boolean }) {
    const result = engine.updateStaffShift(payload);
    pushFlow({
      at: engine.getNow(),
      type: "STAFF_SHIFT",
      title: `Staff shift updated`,
      details: `staff=${payload.staffId} active=${payload.activeShift} status=${result.status}`
    });
    return result;
  },

  updateStaffScope(payload: {
    staffId: string;
    scopeAllZones: boolean;
    zoneScopeZoneIds: string[];
  }) {
    const result = engine.updateStaffScope(payload);
    pushFlow({
      at: engine.getNow(),
      type: "STAFF_SHIFT",
      title: `Staff scope updated`,
      details: `staff=${payload.staffId} all_zones=${payload.scopeAllZones} zones=${payload.zoneScopeZoneIds.join(",")} status=${result.status}`
    });
    return result;
  },

  assignTask(payload: { taskId: string; staffId: string; at: string }) {
    const result = engine.assignTask(payload);
    pushFlow({
      at: payload.at,
      type: "TASK_ASSIGN",
      title: `Task assigned`,
      details: `task=${payload.taskId} staff=${payload.staffId} status=${result.status}`
    });
    return result;
  },

  startTask(payload: { taskId: string; staffId: string; at: string }) {
    const result = engine.startTask(payload);
    pushFlow({
      at: payload.at,
      type: "TASK_ASSIGN",
      title: `Task started`,
      details: `task=${payload.taskId} staff=${payload.staffId} status=${result.status}`
    });
    return result;
  },

  getTaskAudit(taskId?: string) {
    return engine.getTaskAudit(taskId);
  },

  getInventoryZones() {
    return toDashboard();
  },

  getInventoryZoneById(zoneId: string) {
    return toZoneDetail(zoneId);
  },

  getReplenishmentTasks(query?: { status?: TaskStatus; zoneId?: string }) {
    return toTasks(query?.zoneId, query?.status);
  },

  getReceivingLocations() {
    const locations = engine.getLocations().map((zone) => ({
      id: zone.id,
      name: zone.name,
      type: "internal" as const
    }));
    return {
      internal: locations,
      external: externalReceivingLocations.map((entry) => ({ ...entry, type: "external" as const }))
    };
  },

  createExternalReceivingLocation(payload: { name: string }) {
    const name = payload.name.trim();
    if (!name) return { status: "invalid_name" };
    const id = toExternalLocationId(name, new Set(externalReceivingLocations.map((entry) => entry.id)));
    externalReceivingLocations = [...externalReceivingLocations, { id, name }];
    pushFlow({
      at: engine.getNow(),
      type: "LOCATION_UPDATE",
      title: `External location created`,
      details: `id=${id} name=${name}`
    });
    return { status: "created", location: { id, name, type: "external" as const } };
  },

  updateExternalReceivingLocation(payload: { id: string; name: string }) {
    const id = payload.id.trim();
    const name = payload.name.trim();
    if (!id) return { status: "invalid_id" };
    if (!name) return { status: "invalid_name" };
    const index = externalReceivingLocations.findIndex((entry) => entry.id === id);
    if (index < 0) return { status: "external_location_not_found" };
    externalReceivingLocations[index] = {
      ...externalReceivingLocations[index],
      name
    };
    pushFlow({
      at: engine.getNow(),
      type: "LOCATION_UPDATE",
      title: "External location updated",
      details: `id=${id} name=${name}`
    });
    return {
      status: "updated",
      location: { ...externalReceivingLocations[index], type: "external" as const }
    };
  },

  getReceivingOrders() {
    return engine.getReceivingOrders().map((order) => ({ ...order }));
  },

  getCatalog() {
    return toCatalog();
  },

  createReceivingOrder(payload: {
    sourceLocationId: string;
    destinationZoneId: string;
    skuId: string;
    source: InventorySource;
    requestedQty: number;
    note?: string;
    createdAt: string;
  }) {
    const result = engine.createReceivingOrder(payload);
    pushFlow({
      at: payload.createdAt,
      type: "RECEIVING_CREATE",
      title: `Receiving in transit`,
      details:
        `source=${locationLabel(payload.sourceLocationId)} destination=${zoneLabel(payload.destinationZoneId)} ` +
        `sku=${payload.skuId} source_type=${payload.source} qty=${payload.requestedQty} ` +
        `assigned=${result.order?.assignedStaffId ?? "-"} status=${result.status}`
    });
    return result;
  },

  confirmReceivingOrder(payload: { orderId: string; confirmedAt: string; confirmedBy: string }) {
    const result = engine.confirmReceivingOrder(payload.orderId, {
      confirmedAt: payload.confirmedAt,
      confirmedBy: payload.confirmedBy
    });
    const order = result.order;
    pushFlow({
      at: payload.confirmedAt,
      type: "RECEIVING_CONFIRM",
      title: `Receiving confirmed`,
      details: order
        ? `order=${order.id} source=${locationLabel(order.sourceLocationId)} destination=${zoneLabel(order.destinationZoneId)} ` +
          `sku=${order.skuId} moved=${result.movedQty ?? 0}/${order.requestedQty} status=${result.status}`
        : `order=${payload.orderId} status=${result.status}`
    });
    return result;
  },

  confirmReplenishmentTask(
    id: string,
    payload: { confirmedQty: number; confirmedBy: string; confirmedAt: string; sourceZoneId?: string }
  ) {
    const result = engine.confirmTask(id, payload);
    if (!result) return null;
    const { task, transfer } = result;

    if (transfer.sourceType === "RFID" && transfer.movedEpcs.length > 0) {
      const baseTs = new Date(payload.confirmedAt).getTime();
      transfer.movedEpcs.forEach((epc, index) => {
        const ts = new Date(baseTs + index).toISOString();
        pushFlow({
          at: ts,
          type: "RFID_READ",
          title: `RFID pulse in ${task.zoneId}`,
          details: `epc=${epc} antenna=${transfer.destinationAntennaId ?? "system-transfer"} status=accepted (task_confirm=${id})`
        });
      });
    }

    pushFlow({
      at: payload.confirmedAt,
      type: "TASK_CONFIRM",
      title: `Task ${id} confirmed`,
      details: `sku=${task.skuId} zone=${task.zoneId} source_zone=${task.sourceZoneId ?? "-"} confirmed_qty=${payload.confirmedQty} by=${payload.confirmedBy}`
    });

    return {
      id: task.id,
      status: task.status,
      closedAt: task.closedAt,
      inventoryRecalculated: true
    };
  },

  getFlowEvents() {
    return flowEvents.slice(0, 40);
  }
};

export const restEndpointExamples = {
  postRFIDRead: {
    method: "POST",
    url: "/rfid/read"
  },
  postSalesEvent: {
    method: "POST",
    url: "/sales/event"
  },
  putMinMaxRule: {
    method: "PUT",
    url: "/rules/minmax",
    request: {
      zoneId: "zone-shelf-b",
      skuId: "SKU-RFID-1",
      source: "RFID",
      minQty: 4,
      maxQty: 6
    }
  },
  getRules: {
    method: "GET",
    url: "/rules?zoneId=zone-shelf-b"
  }
};
