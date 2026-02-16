import type {
  Antenna,
  EPCPresence,
  EPCSkuMapping,
  InventorySnapshotByZone,
  InventorySource,
  ReplenishmentRule,
  ReplenishmentTask,
  ReceivingOrder,
  RFIDReadEvent,
  SalesEvent,
  StaffMember,
  TaskAuditEntry,
  TaskStatus,
  Zone
} from "../domain/models";
import type { SampleDataset } from "../data/sampleDataset";

export const ENGINE_CONFIG = {
  dedupWindowSec: 15,
  rfidPresenceTtlSec: 300
};

interface ConfirmPayload {
  confirmedQty: number;
  confirmedBy: string;
  confirmedAt: string;
  sourceZoneId?: string;
}

interface Customer {
  id: string;
  name: string;
}

interface CustomerBasketItem {
  id: string;
  customerId: string;
  zoneId: string;
  skuId: string;
  qty: number;
  pickedConfirmedQty: number;
  status: "IN_CART" | "SOLD" | "REMOVED";
  createdAt: string;
}

interface PendingRFIDPick {
  basketItemId: string;
  zoneId: string;
  skuId: string;
  qtyRemaining: number;
  consumedEpcs: string[];
  status: "IN_PROGRESS" | "COMPLETED";
}

interface ConfirmationMovement {
  zoneId: string;
  skuId: string;
  qty: number;
  timestamp: string;
  taskId: string;
}

interface ConfirmReceivingPayload {
  confirmedAt: string;
  confirmedBy: string;
}

function toMs(value: string): number {
  return new Date(value).getTime();
}

function taskIsOpen(status: TaskStatus): boolean {
  return status === "CREATED" || status === "ASSIGNED" || status === "IN_PROGRESS";
}

const CASHIER_STORAGE_ZONE_ID = "zone-cashier-storage";
const PRINTING_WALL_ZONE_ID = "zone-printing-wall";

interface TransferResult {
  movedQty: number;
  movedEpcs: string[];
  sourceType: InventorySource;
  destinationAntennaId?: string;
}

export class InventoryEngine {
  readonly zones: Zone[];
  readonly antennas: Antenna[];
  readonly mapping: EPCSkuMapping[];
  readonly rules: ReplenishmentRule[];
  readonly skuSourceById: Map<string, InventorySource>;
  readonly nonRfidBaselines: Map<string, InventorySnapshotByZone>;

  private snapshots: InventorySnapshotByZone[];
  private rfidEvents: RFIDReadEvent[];
  private salesEvents: SalesEvent[];
  private tasks: ReplenishmentTask[];
  private epcPresence: Map<string, EPCPresence>;
  private customers: Map<string, Customer>;
  private customerBasketItems: CustomerBasketItem[];
  private pendingRFIDPicks: PendingRFIDPick[];
  private replenishmentConfirmations: ConfirmationMovement[];
  private receivingOrders: ReceivingOrder[];
  private staff: StaffMember[];
  private taskAudit: TaskAuditEntry[];
  private nowCursor: string;
  private generatedEpcSeq: number;
  private personalizableSkuIds: Set<string>;

  constructor(dataset: SampleDataset) {
    this.zones = dataset.zones;
    this.antennas = dataset.antennas;
    this.mapping = dataset.epcSkuMapping;
    this.rules = dataset.replenishmentRules;
    this.skuSourceById = new Map(
      dataset.skus.map((sku) => [sku.id, sku.source as InventorySource])
    );
    this.nonRfidBaselines = new Map(
      dataset.inventorySeed
        .filter((snapshot) => snapshot.source === "NON_RFID")
        .map((snapshot) => [this.getBaselineKey(snapshot.zoneId, snapshot.skuId), { ...snapshot }])
    );

    this.snapshots = [...dataset.inventorySeed];
    this.rfidEvents = [];
    this.salesEvents = [];
    this.tasks = [];
    this.epcPresence = new Map<string, EPCPresence>();
    this.customers = new Map<string, Customer>();
    this.customerBasketItems = [];
    this.pendingRFIDPicks = [];
    this.replenishmentConfirmations = [];
    this.receivingOrders = [];
    this.staff = [...dataset.staff];
    this.taskAudit = [];
    this.nowCursor = "2026-02-10T10:00:00Z";
    this.generatedEpcSeq = dataset.epcSkuMapping.length + 1;
    this.personalizableSkuIds = new Set(
      dataset.catalogProducts.flatMap((product) =>
        product.variants
          .filter((variant) => {
            const role = variant.role;
            if (role === "player" || role === "goalkeeper") return true;
            return product.title.toUpperCase().includes("JSY");
          })
          .map((variant) => variant.skuId)
      )
    );
  }

  seedDemoEvents(): void {
    // Load RFID reads first, then sales to reproduce one task trigger.
    // Sales will drive SKU-NR-1 from 5 -> 1 (min is 2), generating an OPEN task.
    this.zones.forEach((z) => this.calculateZoneInventory(z.id));
  }

  ingestRFIDRead(event: RFIDReadEvent): { status: string; skuId?: string } {
    const antenna = this.antennas.find((a) => a.id === event.antennaId && a.zoneId === event.zoneId);
    if (!antenna) {
      return { status: "invalid_antenna_or_zone" };
    }

    if (this.deduplicateReads(event.epc, event.antennaId, ENGINE_CONFIG.dedupWindowSec, event.timestamp)) {
      return { status: "duplicate_ignored" };
    }

    const mapping = this.lookupSkuByEPC(event.epc, event.timestamp);
    if (!mapping) {
      return { status: "unknown_epc" };
    }

    this.rfidEvents.push(event);
    this.nowCursor = event.timestamp;
    this.epcPresence.set(event.epc, {
      epc: event.epc,
      skuId: mapping.skuId,
      zoneId: event.zoneId,
      antennaId: event.antennaId,
      lastSeenAt: event.timestamp,
      lastRssi: event.rssi
    });

    this.applyPendingRFIDPicks(event.zoneId);
    this.calculateZoneInventory(event.zoneId);
    return { status: "accepted", skuId: mapping.skuId };
  }

  forceZoneSweep(zoneId: string, timestamp: string): { status: string; removedEpcs?: number } {
    const zone = this.zones.find((entry) => entry.id === zoneId);
    if (!zone) return { status: "zone_not_found" };

    this.nowCursor = timestamp;
    // A forced zone scan implies tags still present in the zone are read again now.
    // Refreshing lastSeenAt prevents artificial TTL expiry drops between scans.
    for (const presence of this.epcPresence.values()) {
      if (presence.zoneId !== zoneId) continue;
      presence.lastSeenAt = timestamp;
    }

    // A zone scan only materializes customer picks in progress.
    // RFID presence can disappear only if there is an active sale consuming those EPCs.
    const removedEpcs = this.applyPendingRFIDPicks(zoneId);
    this.calculateZoneInventory(zoneId);
    return { status: "accepted", removedEpcs };
  }

  scanZone(zoneId: string, timestamp: string): { status: string } {
    const zone = this.zones.find((entry) => entry.id === zoneId);
    if (!zone) return { status: "zone_not_found" };
    this.nowCursor = timestamp;
    // Simulate a real periodic zone read: keep present EPCs alive in TTL window.
    for (const presence of this.epcPresence.values()) {
      if (presence.zoneId !== zoneId) continue;
      presence.lastSeenAt = timestamp;
    }
    this.calculateZoneInventory(zoneId);
    return { status: "accepted" };
  }

  deduplicateReads(epc: string, antennaId: string, timeWindowSec: number, eventTimestamp: string): boolean {
    const eventMs = toMs(eventTimestamp);
    const lowerBound = eventMs - timeWindowSec * 1000;
    const last = [...this.rfidEvents]
      .reverse()
      .find((e) => e.epc === epc && e.antennaId === antennaId);
    if (!last) return false;
    return toMs(last.timestamp) >= lowerBound;
  }

  calculateZoneInventory(zoneId: string): InventorySnapshotByZone[] {
    const nowMs = toMs(this.nowCursor);
    const ttlMs = ENGINE_CONFIG.rfidPresenceTtlSec * 1000;

    const bySku = new Map<string, Set<string>>();
    for (const p of this.epcPresence.values()) {
      if (p.zoneId !== zoneId) continue;
      if (toMs(p.lastSeenAt) < nowMs - ttlMs) continue;
      if (!bySku.has(p.skuId)) bySku.set(p.skuId, new Set<string>());
      bySku.get(p.skuId)?.add(p.epc);
    }

    const rfidSkuCandidates = new Set<string>([
      ...[...bySku.keys()],
      ...this.rules
        .filter((r) => r.zoneId === zoneId && r.source === "RFID" && r.isActive)
        .map((r) => r.skuId),
      ...this.snapshots
        .filter((s) => s.zoneId === zoneId && s.source === "RFID")
        .map((s) => s.skuId)
    ]);

    for (const skuId of rfidSkuCandidates) {
      const qty = bySku.get(skuId)?.size ?? 0;
      this.upsertSnapshot(zoneId, skuId, qty, "RFID", qty > 0 ? 0.9 : 0.7);
    }

    const nonRfidSkusInZone = this.rules
      .filter((r) => r.zoneId === zoneId && r.source === "NON_RFID" && r.isActive)
      .map((r) => r.skuId);

    for (const skuId of new Set(nonRfidSkusInZone)) {
      const qty = this.calculateNonRFIDInventory(skuId, zoneId);
      this.upsertSnapshot(zoneId, skuId, qty, "NON_RFID");
    }

    this.evaluateMinMax(zoneId);
    return this.getZoneSnapshots(zoneId);
  }

  calculateNonRFIDInventory(skuId: string, zoneId: string): number {
    const baseline = this.getBaselineSnapshot(zoneId, skuId);
    const baselineMs = toMs(baseline.lastCalculatedAt);

    const sold = this.salesEvents
      .filter((s) => s.zoneId === zoneId && s.skuId === skuId && s.eventType === "SALE" && toMs(s.timestamp) >= baselineMs)
      .reduce((acc, e) => acc + e.qty, 0);

    const returns = this.salesEvents
      .filter((s) => s.zoneId === zoneId && s.skuId === skuId && s.eventType === "RETURN" && toMs(s.timestamp) >= baselineMs)
      .reduce((acc, e) => acc + e.qty, 0);

    const confirmedReplenishment = this.replenishmentConfirmations
      .filter((c) => c.zoneId === zoneId && c.skuId === skuId && toMs(c.timestamp) >= baselineMs)
      .reduce((acc, c) => acc + c.qty, 0);

    return Math.max(0, baseline.qty - sold + returns + confirmedReplenishment);
  }

  evaluateMinMax(zoneId: string): void {
    const rules = this.rules.filter((r) => r.zoneId === zoneId && r.isActive);
    const zone = this.zones.find((entry) => entry.id === zoneId);
    if (!zone) return;

    for (const rule of rules) {
      const currentQty = this.getCurrentInventoryQty(zoneId, rule.skuId, rule.source);
      if (!zone.isSalesLocation) {
        this.evaluateInboundReceivingNeed(zone, rule, currentQty);
        continue;
      }
      let openTasks = this.tasks
        .filter((t) => t.ruleId === rule.id && taskIsOpen(t.status))
        .sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
      let autoRejectableTasks = openTasks.filter((task) => task.status !== "IN_PROGRESS");

      // Keep a single open task per SKU/rule when the destination effectively has one source.
      // Multi-source locations are intentionally allowed to split need across multiple tasks.
      if (autoRejectableTasks.length > 1) {
        const distinctTaskSources = new Set(
          autoRejectableTasks.map((task) => task.sourceZoneId ?? "__none__")
        );
        const singleSourceDestination = zone.replenishmentSources.length <= 1;
        const singleTaskSource = distinctTaskSources.size <= 1;
        if (singleSourceDestination || singleTaskSource) {
          const keeper = autoRejectableTasks[0];
          const mergedDeficit = autoRejectableTasks.reduce(
            (sum, task) => sum + Math.max(0, task.deficitQty),
            0
          );
          keeper.deficitQty = mergedDeficit;
          keeper.updatedAt = this.nowCursor;
          for (const extraTask of autoRejectableTasks.slice(1)) {
            this.closeReplenishmentTask(extraTask.id, "merged_plan");
          }
          openTasks = this.tasks
            .filter((t) => t.ruleId === rule.id && taskIsOpen(t.status))
            .sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
          autoRejectableTasks = openTasks.filter((task) => task.status !== "IN_PROGRESS");
        }
      }

      if (currentQty >= rule.maxQty) {
        for (const task of autoRejectableTasks) {
          this.closeReplenishmentTask(task.id, "stock_recovered");
        }
        continue;
      }

      const desiredQty = Math.max(0, rule.maxQty - currentQty);
      let plannedQty = openTasks.reduce((sum, task) => sum + task.deficitQty, 0);

      // Keep open plan aligned with current need; returns can reduce or remove pending tasks.
      if (plannedQty > desiredQty) {
        let overflow = plannedQty - desiredQty;
        for (let i = autoRejectableTasks.length - 1; i >= 0 && overflow > 0; i -= 1) {
          const task = autoRejectableTasks[i];
          if (task.deficitQty <= overflow) {
            overflow -= task.deficitQty;
            this.closeReplenishmentTask(task.id, "plan_adjusted");
          } else {
            task.deficitQty -= overflow;
            task.updatedAt = this.nowCursor;
            overflow = 0;
          }
        }
        plannedQty = desiredQty;
      }

      for (const task of openTasks) {
        task.sourceCandidates = this.buildSourceCandidates(rule, task.id);
        task.sourceZoneId =
          task.sourceZoneId ??
          task.sourceCandidates.find((source) => source.availableQty > 0)?.sourceZoneId ??
          task.sourceCandidates[0]?.sourceZoneId;
        task.updatedAt = this.nowCursor;
      }

      if (currentQty <= rule.minQty) {
        let remainingQty = Math.max(0, desiredQty - plannedQty);
        if (remainingQty <= 0) continue;

        const candidates = this.buildSourceCandidates(rule);
        let createdAnyTask = false;
        for (const source of candidates) {
          if (remainingQty <= 0) break;
          const allocQty = Math.min(remainingQty, source.availableQty);
          if (allocQty <= 0) continue;
          this.generateReplenishmentTask(rule, allocQty, currentQty, source.sourceZoneId, candidates);
          createdAnyTask = true;
          remainingQty -= allocQty;
        }

        // Even without available stock, keep a pending replenishment need visible.
        if (!createdAnyTask && remainingQty > 0) {
          this.generateReplenishmentTask(
            rule,
            remainingQty,
            currentQty,
            candidates[0]?.sourceZoneId,
            candidates
          );
        }
      }
    }
  }

  generateReplenishmentTask(
    rule: ReplenishmentRule,
    deficitQty: number,
    triggerQty: number,
    sourceZoneId?: string,
    sourceCandidatesInput?: Array<{ sourceZoneId: string; sortOrder: number; availableQty: number }>
  ): ReplenishmentTask {
    const sourceCandidates = sourceCandidatesInput ?? this.buildSourceCandidates(rule);
    const selectedSource =
      sourceZoneId ??
      sourceCandidates.find((source) => source.availableQty > 0)?.sourceZoneId ??
      sourceCandidates[0]?.sourceZoneId;
    const task: ReplenishmentTask = {
      id: `task-${this.tasks.length + 1}`,
      ruleId: rule.id,
      zoneId: rule.zoneId,
      skuId: rule.skuId,
      sourceCandidates,
      sourceZoneId: selectedSource,
      status: "CREATED",
      triggerQty,
      deficitQty,
      targetQty: rule.maxQty,
      createdAt: this.nowCursor,
      updatedAt: this.nowCursor
    };
    this.tasks.push(task);
    this.pushTaskAudit(task.id, "CREATED", undefined, `zone=${task.zoneId} sku=${task.skuId} deficit=${task.deficitQty}`);
    this.autoAssignPendingTasks(this.nowCursor);
    return task;
  }

  closeReplenishmentTask(taskId: string, reason = "confirmed"): ReplenishmentTask | undefined {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || !taskIsOpen(task.status)) return task;

    task.status = reason.startsWith("confirmed") ? "CONFIRMED" : "REJECTED";
    task.closeReason = reason;
    task.closedAt = this.nowCursor;
    task.updatedAt = this.nowCursor;
    this.pushTaskAudit(task.id, "CLOSED", task.confirmedBy, `reason=${reason}`);
    this.autoAssignPendingTasks(this.nowCursor);
    this.autoAssignPendingReceivingOrders(this.nowCursor);
    return task;
  }

  ingestSalesEvent(event: SalesEvent): { status: string } {
    this.salesEvents.push(event);
    this.nowCursor = event.timestamp;
    const source = this.skuSourceById.get(event.skuId) ?? "NON_RFID";

    if (source === "RFID" && event.eventType === "SALE") {
      this.deductRFIDImmediate(event.zoneId, event.skuId, event.qty);
      return { status: "accepted_rfid_immediate" };
    }

    this.calculateZoneInventory(event.zoneId);
    return { status: "accepted" };
  }

  upsertCustomer(payload: { id: string; name?: string }): Customer {
    const existing = this.customers.get(payload.id);
    if (existing) {
      if (payload.name) existing.name = payload.name;
      return existing;
    }
    const customer: Customer = {
      id: payload.id,
      name: payload.name ?? payload.id
    };
    this.customers.set(customer.id, customer);
    return customer;
  }

  getCustomers(): Customer[] {
    return [...this.customers.values()];
  }

  addCustomerItem(payload: {
    customerId: string;
    zoneId: string;
    skuId: string;
    qty: number;
    timestamp: string;
  }): { status: string; basketItemId?: string; availableQty?: number } {
    this.nowCursor = payload.timestamp;
    this.upsertCustomer({ id: payload.customerId });
    const zone = this.zones.find((entry) => entry.id === payload.zoneId);
    if (!zone) return { status: "zone_not_found" };
    if (!zone.isSalesLocation) return { status: "zone_not_orderable" };
    this.calculateZoneInventory(payload.zoneId);

    const source = this.skuSourceById.get(payload.skuId) ?? "NON_RFID";
    const availableQty = this.getAvailableQtyForCart(payload.zoneId, payload.skuId, source);
    if (payload.qty > availableQty) {
      return { status: "insufficient_inventory", availableQty };
    }

    const item: CustomerBasketItem = {
      id: `basket-${Date.now()}-${this.customerBasketItems.length + 1}`,
      customerId: payload.customerId,
      zoneId: payload.zoneId,
      skuId: payload.skuId,
      qty: payload.qty,
      pickedConfirmedQty: 0,
      status: "IN_CART",
      createdAt: payload.timestamp
    };
    this.customerBasketItems.push(item);

    if (source === "RFID") {
      this.pendingRFIDPicks.push({
        basketItemId: item.id,
        zoneId: payload.zoneId,
        skuId: payload.skuId,
        qtyRemaining: payload.qty,
        consumedEpcs: [],
        status: "IN_PROGRESS"
      });
    }

    // Keep on-hand unchanged until next zone scan; reserve only for cart validations.
    this.evaluateMinMax(payload.zoneId);
    return { status: "accepted", basketItemId: item.id };
  }

  getCustomerBasket(customerId: string): CustomerBasketItem[] {
    return this.customerBasketItems.filter((item) => item.customerId === customerId && item.status === "IN_CART");
  }

  removeCustomerItem(payload: { basketItemId: string; timestamp: string }): { status: string; restoredQty: number } {
    this.nowCursor = payload.timestamp;
    const item = this.customerBasketItems.find((entry) => entry.id === payload.basketItemId);
    if (!item || item.status !== "IN_CART") {
      return { status: "not_found_or_closed", restoredQty: 0 };
    }

    const source = this.skuSourceById.get(item.skuId) ?? "NON_RFID";

    let restoredQty = 0;
    if (source === "RFID") {
      const destinationAntenna =
        this.antennas.find((antenna) => antenna.zoneId === item.zoneId)?.id ?? "system-transfer";
      for (const pending of this.pendingRFIDPicks) {
        if (pending.basketItemId !== item.id) continue;
        for (const epc of pending.consumedEpcs) {
          this.epcPresence.set(epc, {
            epc,
            skuId: item.skuId,
            zoneId: item.zoneId,
            antennaId: destinationAntenna,
            lastSeenAt: payload.timestamp
          });
          restoredQty += 1;
        }
        pending.consumedEpcs = [];
        pending.status = "COMPLETED";
        pending.qtyRemaining = 0;
      }

      // Fallback for legacy / unmatched state: recreate missing RFID units.
      if (item.pickedConfirmedQty > restoredQty) {
        const missing = item.pickedConfirmedQty - restoredQty;
        restoredQty += this.createExternalRFIDForDestination(
          item.skuId,
          item.zoneId,
          missing,
          payload.timestamp
        );
      }
      item.pickedConfirmedQty = 0;
    } else {
      for (const pending of this.pendingRFIDPicks) {
        if (pending.basketItemId === item.id) {
          pending.status = "COMPLETED";
          pending.qtyRemaining = 0;
        }
      }
    }

    item.status = "REMOVED";
    this.calculateZoneInventory(item.zoneId);
    return { status: "removed", restoredQty };
  }

  checkoutCustomer(customerId: string, timestamp: string): { status: string; soldItems: number } {
    this.nowCursor = timestamp;
    const items = this.customerBasketItems.filter((item) => item.customerId === customerId && item.status === "IN_CART");
    if (items.length === 0) return { status: "empty_cart", soldItems: 0 };

    let soldItems = 0;
    const affectedZones = new Set<string>();

    for (const item of items) {
      const source = this.skuSourceById.get(item.skuId) ?? "NON_RFID";
      if (this.personalizableSkuIds.has(item.skuId)) {
        this.processPersonalizationSale(item, source, timestamp);
      } else if (source === "NON_RFID") {
        this.ingestSalesEvent({
          id: `sale-${Date.now()}-${soldItems + 1}`,
          skuId: item.skuId,
          zoneId: item.zoneId,
          eventType: "SALE",
          qty: item.qty,
          timestamp,
          posTxnId: `POS-${Date.now()}`,
          ingestedAt: timestamp
        });
      } else {
        const outstanding = Math.max(0, item.qty - item.pickedConfirmedQty);
        if (outstanding > 0) {
          this.deductRFIDImmediate(item.zoneId, item.skuId, outstanding);
        }
      }

      item.status = "SOLD";
      soldItems += 1;
      affectedZones.add(item.zoneId);
      affectedZones.add(CASHIER_STORAGE_ZONE_ID);
      affectedZones.add(PRINTING_WALL_ZONE_ID);
    }

    for (const pending of this.pendingRFIDPicks) {
      const basket = this.customerBasketItems.find((item) => item.id === pending.basketItemId);
      if (basket?.customerId === customerId) {
        pending.status = "COMPLETED";
        pending.qtyRemaining = 0;
      }
    }

    for (const zoneId of affectedZones) {
      this.calculateZoneInventory(zoneId);
    }

    return { status: "checked_out", soldItems };
  }

  confirmTask(
    taskId: string,
    payload: ConfirmPayload
  ): { task: ReplenishmentTask; transfer: TransferResult } | null {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || task.status !== "IN_PROGRESS") return null;

    this.nowCursor = payload.confirmedAt;
    const requestedQty = Math.max(0, payload.confirmedQty);
    const sourceZoneId = payload.sourceZoneId ?? task.sourceZoneId;
    let transfer: TransferResult = {
      movedQty: requestedQty,
      movedEpcs: [],
      sourceType: this.skuSourceById.get(task.skuId) ?? "NON_RFID"
    };
    const attemptedSources: string[] = [];
    if (sourceZoneId) {
      transfer = this.applyTransferFromSource(sourceZoneId, task.zoneId, task.skuId, requestedQty);
      task.sourceZoneId = sourceZoneId;
      attemptedSources.push(sourceZoneId);
    }

    if (transfer.movedQty <= 0) {
      const fallbackSources = this.getFallbackSourceZoneIds(task, attemptedSources);
      for (const candidateSourceZoneId of fallbackSources) {
        const candidateTransfer = this.applyTransferFromSource(
          candidateSourceZoneId,
          task.zoneId,
          task.skuId,
          requestedQty
        );
        attemptedSources.push(candidateSourceZoneId);
        if (candidateTransfer.movedQty <= 0) continue;
        transfer = candidateTransfer;
        task.sourceZoneId = candidateSourceZoneId;
        break;
      }
    }

    const movedQty = transfer.movedQty;
    if (movedQty <= 0) {
      return null;
    }
    task.confirmedQty = movedQty;
    task.confirmedBy = payload.confirmedBy;
    task.updatedAt = payload.confirmedAt;

    this.replenishmentConfirmations.push({
      zoneId: task.zoneId,
      skuId: task.skuId,
      qty: movedQty,
      timestamp: payload.confirmedAt,
      taskId: task.id
    });
    this.pushTaskAudit(
      task.id,
      "CONFIRMED",
      payload.confirmedBy,
      `confirmed_qty=${movedQty} source_zone=${sourceZoneId ?? "n/a"}`
    );

    const partial = movedQty < Math.max(0, task.deficitQty);
    this.closeReplenishmentTask(task.id, partial ? "confirmed_partial" : "confirmed");
    this.calculateZoneInventory(task.zoneId);
    if (sourceZoneId && sourceZoneId !== task.zoneId) {
      this.calculateZoneInventory(sourceZoneId);
    }
    return { task, transfer };
  }

  private getFallbackSourceZoneIds(task: ReplenishmentTask, exclude: string[]): string[] {
    const excludeSet = new Set(exclude);
    const candidates: string[] = [];

    const taskSources = task.sourceCandidates ?? [];
    for (const source of [...taskSources].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (excludeSet.has(source.sourceZoneId)) continue;
      candidates.push(source.sourceZoneId);
      excludeSet.add(source.sourceZoneId);
    }

    const zone = this.zones.find((entry) => entry.id === task.zoneId);
    if (zone) {
      for (const source of [...zone.replenishmentSources].sort((a, b) => a.sortOrder - b.sortOrder)) {
        if (excludeSet.has(source.sourceZoneId)) continue;
        candidates.push(source.sourceZoneId);
        excludeSet.add(source.sourceZoneId);
      }
    }

    return candidates;
  }

  loadDemoStream(rfidEvents: RFIDReadEvent[], salesEvents: SalesEvent[]): void {
    for (const e of rfidEvents) this.ingestRFIDRead(e);
    for (const e of salesEvents) this.ingestSalesEvent(e);
    // Ensure every zone evaluates min-max after boot stream ingestion.
    for (const zone of this.zones) {
      this.calculateZoneInventory(zone.id);
    }
  }

  getZoneSnapshots(zoneId: string): InventorySnapshotByZone[] {
    return this.snapshots.filter((s) => s.zoneId === zoneId);
  }

  getAllSnapshots(): InventorySnapshotByZone[] {
    return this.snapshots;
  }

  getTasks(status?: TaskStatus): ReplenishmentTask[] {
    this.autoAssignPendingTasks(this.nowCursor);
    if (!status) return this.tasks;
    return this.tasks.filter((t) => t.status === status);
  }

  getReceivingOrders(status?: ReceivingOrder["status"]): ReceivingOrder[] {
    this.autoAssignPendingReceivingOrders(this.nowCursor);
    if (!status) return [...this.receivingOrders];
    return this.receivingOrders.filter((order) => order.status === status);
  }

  createReceivingOrder(payload: {
    sourceLocationId: string;
    destinationZoneId: string;
    skuId: string;
    source: InventorySource;
    requestedQty: number;
    note?: string;
    createdAt: string;
  }): { status: string; order?: ReceivingOrder } {
    const requestedQty = Math.max(0, Math.floor(payload.requestedQty));
    if (requestedQty <= 0) return { status: "invalid_qty" };
    const destination = this.zones.find((zone) => zone.id === payload.destinationZoneId);
    if (!destination) return { status: "destination_not_found" };
    if (!this.skuSourceById.has(payload.skuId)) return { status: "sku_not_found" };
    const skuSource = this.skuSourceById.get(payload.skuId) ?? "NON_RFID";
    if (skuSource !== payload.source) return { status: "source_mismatch" };

    const isExternalSource = payload.sourceLocationId.startsWith("external-");
    if (!isExternalSource && !this.zones.some((zone) => zone.id === payload.sourceLocationId)) {
      return { status: "source_not_found" };
    }
    if (!isExternalSource && payload.sourceLocationId === payload.destinationZoneId) {
      return { status: "source_equals_destination" };
    }

    this.nowCursor = payload.createdAt;
    const order: ReceivingOrder = {
      id: `recv-${this.receivingOrders.length + 1}`,
      sourceLocationId: payload.sourceLocationId,
      destinationZoneId: payload.destinationZoneId,
      skuId: payload.skuId,
      source: payload.source,
      requestedQty,
      confirmedQty: 0,
      status: "IN_TRANSIT",
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
      note: payload.note
    };
    this.receivingOrders.unshift(order);
    this.autoAssignPendingReceivingOrders(payload.createdAt);
    return { status: "created", order };
  }

  confirmReceivingOrder(
    orderId: string,
    payload: ConfirmReceivingPayload
  ): { status: string; order?: ReceivingOrder; movedQty?: number } {
    const order = this.receivingOrders.find((entry) => entry.id === orderId);
    if (!order) return { status: "order_not_found" };
    if (order.status !== "IN_TRANSIT") return { status: "order_not_open", order };

    this.nowCursor = payload.confirmedAt;
    const sourceIsExternal = order.sourceLocationId.startsWith("external-");
    let movedQty = order.requestedQty;

    if (order.source === "RFID") {
      if (sourceIsExternal) {
        movedQty = this.createExternalRFIDForDestination(
          order.skuId,
          order.destinationZoneId,
          order.requestedQty,
          payload.confirmedAt
        );
        if (movedQty > 0) {
          const destinationCurrent = this.getCurrentInventoryQty(order.destinationZoneId, order.skuId, "RFID");
          this.upsertSnapshot(order.destinationZoneId, order.skuId, destinationCurrent + movedQty, "RFID", 0.9);
        }
      } else {
        const movedEpcs = this.moveRFIDEpcs(
          order.sourceLocationId,
          order.destinationZoneId,
          order.skuId,
          order.requestedQty,
          payload.confirmedAt
        );
        movedQty = movedEpcs.length;
      }
    } else {
      if (!sourceIsExternal) {
        const sourceCurrent = this.getCurrentInventoryQty(order.sourceLocationId, order.skuId, "NON_RFID");
        movedQty = Math.min(order.requestedQty, sourceCurrent);
        if (movedQty > 0) {
          this.upsertSnapshot(order.sourceLocationId, order.skuId, sourceCurrent - movedQty, "NON_RFID");
          this.replenishmentConfirmations.push({
            zoneId: order.sourceLocationId,
            skuId: order.skuId,
            qty: -movedQty,
            timestamp: payload.confirmedAt,
            taskId: order.id
          });
        }
      }
      if (movedQty > 0) {
        const destinationCurrent = this.getCurrentInventoryQty(order.destinationZoneId, order.skuId, "NON_RFID");
        this.upsertSnapshot(order.destinationZoneId, order.skuId, destinationCurrent + movedQty, "NON_RFID");
        this.replenishmentConfirmations.push({
          zoneId: order.destinationZoneId,
          skuId: order.skuId,
          qty: movedQty,
          timestamp: payload.confirmedAt,
          taskId: order.id
        });
      }
    }

    if (movedQty <= 0) return { status: "no_inventory_moved", order, movedQty: 0 };

    order.confirmedQty = movedQty;
    order.status = "CONFIRMED";
    order.confirmedAt = payload.confirmedAt;
    order.confirmedBy = payload.confirmedBy;
    order.updatedAt = payload.confirmedAt;

    this.calculateZoneInventory(order.destinationZoneId);
    this.recalculateZonesDependingOnSource(order.destinationZoneId);
    if (!sourceIsExternal) {
      this.calculateZoneInventory(order.sourceLocationId);
      this.recalculateZonesDependingOnSource(order.sourceLocationId);
    }
    this.refreshOpenTaskSourceCandidates();
    this.autoAssignPendingTasks(payload.confirmedAt);
    this.autoAssignPendingReceivingOrders(payload.confirmedAt);
    return { status: movedQty < order.requestedQty ? "confirmed_partial" : "confirmed", order, movedQty };
  }

  private recalculateZonesDependingOnSource(sourceZoneId: string): void {
    for (const zone of this.zones) {
      if (zone.id === sourceZoneId) continue;
      if (!zone.replenishmentSources.some((source) => source.sourceZoneId === sourceZoneId)) continue;
      this.calculateZoneInventory(zone.id);
    }
  }

  private refreshOpenTaskSourceCandidates(): void {
    for (const task of this.tasks) {
      if (!taskIsOpen(task.status)) continue;
      const rule = this.rules.find((entry) => entry.id === task.ruleId);
      if (!rule || !rule.isActive) continue;
      const candidates = this.buildSourceCandidates(rule, task.id);
      task.sourceCandidates = candidates;
      if (!task.sourceZoneId || !candidates.some((entry) => entry.sourceZoneId === task.sourceZoneId)) {
        task.sourceZoneId = candidates.find((entry) => entry.availableQty > 0)?.sourceZoneId ?? candidates[0]?.sourceZoneId;
      }
      task.updatedAt = this.nowCursor;
    }
  }

  private evaluateInboundReceivingNeed(
    zone: Zone,
    rule: ReplenishmentRule,
    currentQty: number
  ): void {
    for (const task of this.tasks) {
      if (task.ruleId !== rule.id) continue;
      if (!taskIsOpen(task.status)) continue;
      if (task.status === "IN_PROGRESS") continue;
      this.closeReplenishmentTask(task.id, "non_sales_receiving_flow");
    }

    if (currentQty > rule.minQty) return;

    const desiredQty = Math.max(0, rule.maxQty - currentQty);
    if (desiredQty <= 0) return;

    const plannedInTransitQty = this.receivingOrders
      .filter(
        (order) =>
          order.status === "IN_TRANSIT" &&
          order.destinationZoneId === zone.id &&
          order.skuId === rule.skuId &&
          order.source === rule.source
      )
      .reduce((sum, order) => sum + Math.max(0, order.requestedQty), 0);

    const remainingQty = Math.max(0, desiredQty - plannedInTransitQty);
    if (remainingQty <= 0) return;

    const sourceLocationId = this.resolveInboundSourceLocation(zone, rule, remainingQty);

    this.createReceivingOrder({
      sourceLocationId,
      destinationZoneId: zone.id,
      skuId: rule.skuId,
      source: rule.source,
      requestedQty: remainingQty,
      note: "auto_replenishment_non_sales",
      createdAt: this.nowCursor
    });
  }

  private resolveInboundSourceLocation(zone: Zone, rule: ReplenishmentRule, requiredQty: number): string {
    const ordered = [...zone.replenishmentSources].sort((a, b) => a.sortOrder - b.sortOrder);
    if (ordered.length === 0) return "external-esbo";

    const internalCandidates = ordered
      .filter((source) => !source.sourceZoneId.startsWith("external-"))
      .map((source) => ({
        sourceZoneId: source.sourceZoneId,
        availableQty: this.getCurrentInventoryQty(source.sourceZoneId, rule.skuId, rule.source)
      }));

    const enoughInternal = internalCandidates.find((candidate) => candidate.availableQty >= requiredQty);
    if (enoughInternal) return enoughInternal.sourceZoneId;

    const someInternal = internalCandidates.find((candidate) => candidate.availableQty > 0);
    if (someInternal) return someInternal.sourceZoneId;

    const firstExternal = ordered.find((source) => source.sourceZoneId.startsWith("external-"));
    if (firstExternal) return firstExternal.sourceZoneId;

    return ordered[0].sourceZoneId;
  }

  getRules(zoneId?: string): ReplenishmentRule[] {
    if (!zoneId) return this.rules.filter((rule) => rule.isActive);
    return this.rules.filter((rule) => rule.zoneId === zoneId && rule.isActive);
  }

  getLocations(): Zone[] {
    return this.zones.map((zone) => ({
      ...zone,
      replenishmentSources: [...zone.replenishmentSources].sort((a, b) => a.sortOrder - b.sortOrder)
    }));
  }

  updateLocation(payload: {
    zoneId: string;
    name?: string;
    color?: string;
    isSalesLocation?: boolean;
    mapPolygon?: Array<{ x: number; y: number }>;
    replenishmentSources?: Array<{ sourceZoneId: string; sortOrder: number }>;
  }): { status: string; zone?: Zone } {
    const zone = this.zones.find((entry) => entry.id === payload.zoneId);
    if (!zone) return { status: "zone_not_found" };
    const previousSourceIds = new Set(zone.replenishmentSources.map((source) => source.sourceZoneId));
    if (payload.name !== undefined) zone.name = payload.name.trim() || zone.name;
    if (payload.color !== undefined) zone.color = payload.color;
    if (payload.isSalesLocation !== undefined) zone.isSalesLocation = payload.isSalesLocation;
    if (payload.mapPolygon !== undefined && payload.mapPolygon.length >= 3) {
      zone.mapPolygon = payload.mapPolygon;
    }
    if (payload.replenishmentSources !== undefined) {
      const unique = new Map<string, number>();
      for (const source of payload.replenishmentSources) {
        const isExternal = source.sourceZoneId.startsWith("external-");
        if (!isExternal && !this.zones.some((entry) => entry.id === source.sourceZoneId)) continue;
        if (source.sourceZoneId === zone.id) continue;
        unique.set(source.sourceZoneId, source.sortOrder);
      }
      zone.replenishmentSources = [...unique.entries()]
        .map(([sourceZoneId, sortOrder]) => ({ sourceZoneId, sortOrder }))
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const currentSourceIds = new Set(zone.replenishmentSources.map((source) => source.sourceZoneId));
      const removedSourceIds = [...previousSourceIds].filter((sourceId) => !currentSourceIds.has(sourceId));
      if (removedSourceIds.length > 0) {
        for (const task of this.tasks) {
          if (task.zoneId !== zone.id) continue;
          if (!taskIsOpen(task.status)) continue;
          if (!task.sourceZoneId || !removedSourceIds.includes(task.sourceZoneId)) continue;
          task.status = "REJECTED";
          task.closeReason = "source_removed";
          task.closedAt = this.nowCursor;
          task.updatedAt = this.nowCursor;
          this.pushTaskAudit(
            task.id,
            "CANCELLED",
            undefined,
            `source_removed=${task.sourceZoneId}`
          );
        }
      }
    }
    this.calculateZoneInventory(zone.id);
    return { status: "updated", zone };
  }

  createLocation(payload: {
    zoneId: string;
    name: string;
    color: string;
    isSalesLocation: boolean;
    mapPolygon: Array<{ x: number; y: number }>;
    replenishmentSources?: Array<{ sourceZoneId: string; sortOrder: number }>;
  }): { status: string; zone?: Zone } {
    if (!payload.zoneId.trim()) return { status: "invalid_zone_id" };
    if (payload.mapPolygon.length < 3) return { status: "invalid_polygon" };
    if (this.zones.some((zone) => zone.id === payload.zoneId)) return { status: "zone_exists" };

    const zone: Zone = {
      id: payload.zoneId,
      name: payload.name.trim() || payload.zoneId,
      color: payload.color,
      mapPolygon: payload.mapPolygon,
      antennaIds: [],
      ruleIds: [],
      isSalesLocation: payload.isSalesLocation,
      replenishmentSources: (payload.replenishmentSources ?? [])
        .filter((source) => {
          if (source.sourceZoneId === payload.zoneId) return false;
          return source.sourceZoneId.startsWith("external-") || this.zones.some((entry) => entry.id === source.sourceZoneId);
        })
        .sort((a, b) => a.sortOrder - b.sortOrder),
      isActive: true,
      createdAt: this.nowCursor
    };

    this.zones.push(zone);
    return { status: "created", zone };
  }

  getStaff(activeOnly = false): StaffMember[] {
    if (!activeOnly) return [...this.staff];
    return this.staff.filter((member) => member.activeShift);
  }

  updateStaffShift(payload: { staffId: string; activeShift: boolean }): { status: string } {
    const member = this.staff.find((entry) => entry.id === payload.staffId);
    if (!member) return { status: "staff_not_found" };
    member.activeShift = payload.activeShift;
    this.autoAssignPendingTasks(this.nowCursor);
    this.autoAssignPendingReceivingOrders(this.nowCursor);
    return { status: "updated" };
  }

  updateStaffScope(payload: {
    staffId: string;
    scopeAllZones: boolean;
    zoneScopeZoneIds: string[];
  }): { status: string } {
    const member = this.staff.find((entry) => entry.id === payload.staffId);
    if (!member) return { status: "staff_not_found" };
    member.scopeAllZones = payload.scopeAllZones;
    member.zoneScopeZoneIds = payload.scopeAllZones
      ? []
      : payload.zoneScopeZoneIds.filter((zoneId) =>
          this.zones.some((zone) => zone.id === zoneId)
        );
    this.autoAssignPendingTasks(this.nowCursor);
    this.autoAssignPendingReceivingOrders(this.nowCursor);
    return { status: "updated" };
  }

  assignTask(payload: { taskId: string; staffId: string; at: string }): { status: string; task?: ReplenishmentTask } {
    const task = this.tasks.find((entry) => entry.id === payload.taskId);
    if (!task) return { status: "task_not_found" };
    if (!taskIsOpen(task.status)) return { status: "task_not_open" };
    const member = this.staff.find((entry) => entry.id === payload.staffId && entry.activeShift);
    if (!member) return { status: "staff_not_active" };
    if (!member.scopeAllZones && !member.zoneScopeZoneIds.includes(task.zoneId)) {
      return { status: "staff_not_eligible_for_zone" };
    }
    task.assignedStaffId = member.id;
    task.assignedAt = payload.at;
    task.status = "ASSIGNED";
    task.updatedAt = payload.at;
    this.nowCursor = payload.at;
    this.pushTaskAudit(task.id, "ASSIGNED", member.id, `assigned_to=${member.name}`);
    return { status: "assigned", task };
  }

  startTask(payload: { taskId: string; staffId: string; at: string }): { status: string; task?: ReplenishmentTask } {
    const task = this.tasks.find((entry) => entry.id === payload.taskId);
    if (!task) return { status: "task_not_found" };
    if (!taskIsOpen(task.status)) return { status: "task_not_open" };
    if (task.status === "IN_PROGRESS") return { status: "already_in_progress", task };
    const member = this.staff.find((entry) => entry.id === payload.staffId && entry.activeShift);
    if (!member) return { status: "staff_not_active" };
    const inScope = member.scopeAllZones || member.zoneScopeZoneIds.includes(task.zoneId);
    const outOfScopeFallbackAssigned =
      !inScope &&
      task.assignedStaffId === member.id &&
      !this.hasAnyAssignableStaffInScope(task.zoneId);
    if (!inScope && !outOfScopeFallbackAssigned) {
      return { status: "staff_not_eligible_for_zone" };
    }
    if (task.assignedStaffId && task.assignedStaffId !== member.id) {
      return { status: "task_assigned_to_other_staff" };
    }
    task.assignedStaffId = member.id;
    task.assignedAt = task.assignedAt ?? payload.at;
    task.status = "IN_PROGRESS";
    task.updatedAt = payload.at;
    this.nowCursor = payload.at;
    this.pushTaskAudit(task.id, "STARTED", member.id, `started_by=${member.name} status=IN_PROGRESS`);
    return { status: "started", task };
  }

  getTaskAudit(taskId?: string): TaskAuditEntry[] {
    if (!taskId) return [...this.taskAudit];
    return this.taskAudit.filter((entry) => entry.taskId === taskId);
  }

  upsertRule(payload: {
    zoneId: string;
    skuId: string;
    source: InventorySource;
    inboundSourceLocationId?: string;
    minQty: number;
    maxQty: number;
    priority?: number;
  }): ReplenishmentRule {
    const existing = this.rules.find(
      (rule) =>
        rule.zoneId === payload.zoneId && rule.skuId === payload.skuId && rule.source === payload.source
    );

    if (existing) {
      existing.minQty = payload.minQty;
      existing.maxQty = payload.maxQty;
      existing.inboundSourceLocationId = payload.inboundSourceLocationId;
      existing.priority = payload.priority ?? existing.priority;
      existing.updatedAt = this.nowCursor;
      existing.isActive = true;
      this.calculateZoneInventory(payload.zoneId);
      return existing;
    }

    const rule: ReplenishmentRule = {
      id: `rule-${payload.zoneId}-${payload.skuId}-${payload.source}`.toLowerCase(),
      zoneId: payload.zoneId,
      skuId: payload.skuId,
      source: payload.source,
      inboundSourceLocationId: payload.inboundSourceLocationId,
      minQty: payload.minQty,
      maxQty: payload.maxQty,
      priority: payload.priority ?? 2,
      isActive: true,
      updatedAt: this.nowCursor
    };

    this.rules.push(rule);
    this.calculateZoneInventory(payload.zoneId);
    return rule;
  }

  deleteRule(ruleId: string): { status: string; zoneId?: string } {
    const rule = this.rules.find((entry) => entry.id === ruleId);
    if (!rule) return { status: "not_found" };
    if (!rule.isActive) return { status: "already_inactive", zoneId: rule.zoneId };

    rule.isActive = false;
    rule.updatedAt = this.nowCursor;

    for (const task of this.tasks) {
      if (task.ruleId !== rule.id) continue;
      if (!taskIsOpen(task.status)) continue;
      task.status = "REJECTED";
      task.closeReason = "rule_deleted";
      task.closedAt = this.nowCursor;
      task.updatedAt = this.nowCursor;
      this.pushTaskAudit(task.id, "CANCELLED", undefined, "rule_deleted");
    }

    this.calculateZoneInventory(rule.zoneId);
    return { status: "deleted", zoneId: rule.zoneId };
  }

  getRecentRFIDReads(zoneId: string, limit = 10): RFIDReadEvent[] {
    return this.rfidEvents.filter((e) => e.zoneId === zoneId).slice(-limit).reverse();
  }

  getNow(): string {
    return this.nowCursor;
  }

  private lookupSkuByEPC(epc: string, at: string): EPCSkuMapping | undefined {
    const atMs = toMs(at);
    return this.mapping.find((m) => {
      if (m.epc !== epc) return false;
      const startOk = toMs(m.activeFrom) <= atMs;
      const endOk = !m.activeTo || toMs(m.activeTo) >= atMs;
      return startOk && endOk;
    });
  }

  private applyPendingRFIDPicks(zoneId: string): number {
    const pending = this.pendingRFIDPicks.filter((pick) => pick.zoneId === zoneId && pick.status === "IN_PROGRESS");
    if (pending.length === 0) return 0;
    let removedEpcs = 0;

    for (const pick of pending) {
      const epcs = this.getPresentEPCs(pick.zoneId, pick.skuId).slice(0, pick.qtyRemaining);
      if (epcs.length === 0) continue;
      for (const epc of epcs) {
        this.epcPresence.delete(epc);
      }
      removedEpcs += epcs.length;
      pick.consumedEpcs.push(...epcs);
      pick.qtyRemaining -= epcs.length;
      if (pick.qtyRemaining <= 0) {
        pick.qtyRemaining = 0;
        pick.status = "COMPLETED";
      }

      const basket = this.customerBasketItems.find((item) => item.id === pick.basketItemId);
      if (basket) {
        basket.pickedConfirmedQty += epcs.length;
      }
    }
    this.evaluateMinMax(zoneId);
    return removedEpcs;
  }

  private deductRFIDImmediate(zoneId: string, skuId: string, qty: number): void {
    const beforeQty = this.getCurrentInventoryQty(zoneId, skuId, "RFID");
    const epcs = this.getPresentEPCs(zoneId, skuId).slice(0, qty);
    for (const epc of epcs) {
      this.epcPresence.delete(epc);
    }

    this.calculateZoneInventory(zoneId);
    const targetQty = Math.max(0, beforeQty - qty);
    const recalculatedQty = this.getCurrentInventoryQty(zoneId, skuId, "RFID");
    if (recalculatedQty > targetQty) {
      this.upsertSnapshot(zoneId, skuId, targetQty, "RFID", 0.55);
      this.evaluateMinMax(zoneId);
    }
  }

  private restoreRFIDQty(zoneId: string, skuId: string, qty: number): void {
    const currentQty = this.getCurrentInventoryQty(zoneId, skuId, "RFID");
    this.upsertSnapshot(zoneId, skuId, currentQty + qty, "RFID", 0.55);
    this.evaluateMinMax(zoneId);
  }

  private getAvailableQtyForCart(zoneId: string, skuId: string, source: InventorySource): number {
    const currentQty = this.getCurrentInventoryQty(zoneId, skuId, source);
    const reservedQty = this.getReservedOpenQty(zoneId, skuId);
    return Math.max(0, currentQty - reservedQty);
  }

  private getReservedOpenQty(zoneId: string, skuId: string): number {
    return this.customerBasketItems
      .filter((item) => item.status === "IN_CART" && item.zoneId === zoneId && item.skuId === skuId)
      .reduce((sum, item) => {
        const source = this.skuSourceById.get(item.skuId) ?? "NON_RFID";
        if (source === "RFID") {
          return sum + Math.max(0, item.qty - item.pickedConfirmedQty);
        }
        return sum + item.qty;
      }, 0);
  }

  private getPresentEPCs(zoneId: string, skuId: string): string[] {
    const nowMs = toMs(this.nowCursor);
    const ttlMs = ENGINE_CONFIG.rfidPresenceTtlSec * 1000;
    const candidates: Array<{ epc: string; seenAt: string }> = [];

    for (const presence of this.epcPresence.values()) {
      if (presence.zoneId !== zoneId || presence.skuId !== skuId) continue;
      if (toMs(presence.lastSeenAt) < nowMs - ttlMs) continue;
      candidates.push({ epc: presence.epc, seenAt: presence.lastSeenAt });
    }

    return candidates
      .sort((a, b) => toMs(a.seenAt) - toMs(b.seenAt))
      .map((entry) => entry.epc);
  }

  private processPersonalizationSale(
    item: CustomerBasketItem,
    source: InventorySource,
    timestamp: string
  ): void {
    const cashierStorage = this.zones.find((zone) => zone.id === CASHIER_STORAGE_ZONE_ID);
    const originZone = this.zones.find((zone) => zone.id === item.zoneId);
    if (!cashierStorage || !originZone) return;

    if (source === "RFID") {
      const pickedFromReads = Math.max(0, item.pickedConfirmedQty);
      const restoredFromPending = this.transferConsumedPendingEpcsToZone(
        item.id,
        item.skuId,
        CASHIER_STORAGE_ZONE_ID,
        timestamp
      );

      // If consumed EPCs are not present in pending picks anymore, recreate them in cashier storage
      // so task source availability reflects physical item flow after checkout.
      if (pickedFromReads > restoredFromPending) {
        this.createExternalRFIDForDestination(
          item.skuId,
          CASHIER_STORAGE_ZONE_ID,
          pickedFromReads - restoredFromPending,
          timestamp
        );
      }

      const outstanding = Math.max(0, item.qty - pickedFromReads);
      if (outstanding > 0) {
        this.moveRFIDEpcs(item.zoneId, CASHIER_STORAGE_ZONE_ID, item.skuId, outstanding, timestamp);
      }
      item.pickedConfirmedQty = 0;
    } else {
      const movedQty = this.transferNonRfid(item.zoneId, CASHIER_STORAGE_ZONE_ID, item.skuId, item.qty);
      if (movedQty <= 0) return;
    }

    // Refresh snapshots before calculating "last unit" and source candidates.
    this.calculateZoneInventory(item.zoneId);
    this.calculateZoneInventory(CASHIER_STORAGE_ZONE_ID);

    const sourceZone = this.zones.find((zone) => zone.id === item.zoneId);
    if (!sourceZone) return;
    const projectedSupply = this.getProjectedSupplyForOrigin(sourceZone, item.skuId, source);
    const isLastUnit = projectedSupply <= 0;
    const destinationZoneId = isLastUnit ? PRINTING_WALL_ZONE_ID : item.zoneId;
    this.createPersonalizationTask(destinationZoneId, item.skuId, item.qty, source, projectedSupply);
  }

  private transferConsumedPendingEpcsToZone(
    basketItemId: string,
    skuId: string,
    destinationZoneId: string,
    at: string
  ): number {
    const destinationAntenna =
      this.antennas.find((antenna) => antenna.zoneId === destinationZoneId)?.id ?? "system-transfer";
    let moved = 0;
    for (const pending of this.pendingRFIDPicks) {
      if (pending.basketItemId !== basketItemId) continue;
      for (const epc of pending.consumedEpcs) {
        this.epcPresence.set(epc, {
          epc,
          skuId,
          zoneId: destinationZoneId,
          antennaId: destinationAntenna,
          lastSeenAt: at
        });
        moved += 1;
      }
      pending.consumedEpcs = [];
      pending.qtyRemaining = 0;
      pending.status = "COMPLETED";
    }
    return moved;
  }

  private transferNonRfid(
    sourceZoneId: string,
    destinationZoneId: string,
    skuId: string,
    qty: number
  ): number {
    const currentSource = this.getCurrentInventoryQty(sourceZoneId, skuId, "NON_RFID");
    const movedQty = Math.min(Math.max(0, qty), currentSource);
    if (movedQty <= 0) return 0;
    this.upsertSnapshot(sourceZoneId, skuId, currentSource - movedQty, "NON_RFID");
    const currentDestination = this.getCurrentInventoryQty(destinationZoneId, skuId, "NON_RFID");
    this.upsertSnapshot(destinationZoneId, skuId, currentDestination + movedQty, "NON_RFID");
    return movedQty;
  }

  private createPersonalizationTask(
    destinationZoneId: string,
    skuId: string,
    qty: number,
    source: InventorySource,
    projectedSupply: number
  ): void {
    const normalizedQty = Math.max(1, Math.floor(qty));
    const sourceCandidates = this.buildManualSourceCandidates(
      destinationZoneId,
      skuId,
      source,
      CASHIER_STORAGE_ZONE_ID
    );
    const selectedSource =
      sourceCandidates.find((candidate) => candidate.availableQty > 0)?.sourceZoneId ??
      sourceCandidates[0]?.sourceZoneId ??
      CASHIER_STORAGE_ZONE_ID;
    const currentDestinationQty = this.getCurrentInventoryQty(destinationZoneId, skuId, source);

    const task: ReplenishmentTask = {
      id: `task-${this.tasks.length + 1}`,
      ruleId: `rule-printing-sale-${destinationZoneId}-${skuId}`.toLowerCase(),
      zoneId: destinationZoneId,
      skuId,
      sourceZoneId: selectedSource,
      sourceCandidates,
      status: "CREATED",
      triggerQty: currentDestinationQty,
      deficitQty: normalizedQty,
      targetQty: currentDestinationQty + normalizedQty,
      createdAt: this.nowCursor,
      updatedAt: this.nowCursor
    };
    this.tasks.push(task);
    this.pushTaskAudit(
      task.id,
      "CREATED",
      undefined,
      `sale_personalization source=${CASHIER_STORAGE_ZONE_ID} destination=${destinationZoneId} qty=${normalizedQty} projected_supply=${projectedSupply}`
    );
    this.autoAssignPendingTasks(this.nowCursor);
  }

  private getProjectedSupplyForOrigin(zone: Zone, skuId: string, source: InventorySource): number {
    const currentInOrigin = this.getCurrentInventoryQty(zone.id, skuId, source);
    const openInboundQty = this.tasks
      .filter((task) => task.zoneId === zone.id && task.skuId === skuId && taskIsOpen(task.status))
      .reduce((sum, task) => sum + Math.max(0, task.deficitQty), 0);
    const sourcePotentialQty = [...zone.replenishmentSources]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .reduce((sum, sourceRef) => {
        const available = Math.max(
          0,
          this.getCurrentInventoryQty(sourceRef.sourceZoneId, skuId, source) -
            this.getReservedTaskQtyFromSource(sourceRef.sourceZoneId, skuId)
        );
        return sum + available;
      }, 0);
    return currentInOrigin + openInboundQty + sourcePotentialQty;
  }

  private buildManualSourceCandidates(
    destinationZoneId: string,
    skuId: string,
    source: InventorySource,
    preferredSourceZoneId?: string
  ): Array<{ sourceZoneId: string; sortOrder: number; availableQty: number }> {
    const candidates: Array<{ sourceZoneId: string; sortOrder: number; availableQty: number }> = [];
    if (preferredSourceZoneId) {
      candidates.push({
        sourceZoneId: preferredSourceZoneId,
        sortOrder: 1,
        availableQty: Math.max(
          0,
          this.getCurrentInventoryQty(preferredSourceZoneId, skuId, source) -
            this.getReservedTaskQtyFromSource(preferredSourceZoneId, skuId)
        )
      });
    }

    const destination = this.zones.find((zone) => zone.id === destinationZoneId);
    if (!destination) return candidates;
    for (const sourceRef of [...destination.replenishmentSources].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (candidates.some((entry) => entry.sourceZoneId === sourceRef.sourceZoneId)) continue;
      candidates.push({
        sourceZoneId: sourceRef.sourceZoneId,
        sortOrder: sourceRef.sortOrder + 1,
        availableQty: Math.max(
          0,
          this.getCurrentInventoryQty(sourceRef.sourceZoneId, skuId, source) -
            this.getReservedTaskQtyFromSource(sourceRef.sourceZoneId, skuId)
        )
      });
    }
    return candidates;
  }

  private buildSourceCandidates(
    rule: ReplenishmentRule,
    excludeTaskId?: string
  ): Array<{ sourceZoneId: string; sortOrder: number; availableQty: number }> {
    const zone = this.zones.find((entry) => entry.id === rule.zoneId);
    if (!zone) return [];
    return [...zone.replenishmentSources]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((source) => ({
        sourceZoneId: source.sourceZoneId,
        sortOrder: source.sortOrder,
        availableQty: Math.max(
          0,
          this.getCurrentInventoryQty(source.sourceZoneId, rule.skuId, rule.source) -
            this.getReservedTaskQtyFromSource(source.sourceZoneId, rule.skuId, excludeTaskId)
        )
      }));
  }

  private applyTransferFromSource(
    sourceZoneId: string,
    destinationZoneId: string,
    skuId: string,
    qty: number
  ): TransferResult {
    const sourceType = this.skuSourceById.get(skuId) ?? "NON_RFID";
    if (sourceType === "RFID") {
      const movedEpcs = this.getPresentEPCs(sourceZoneId, skuId).slice(0, qty);
      const destinationAntenna =
        this.antennas.find((antenna) => antenna.zoneId === destinationZoneId)?.id ?? "system-transfer";
      const baseTs = toMs(this.nowCursor);
      for (const epc of movedEpcs) {
        const presence = this.epcPresence.get(epc);
        if (!presence) continue;
        presence.zoneId = destinationZoneId;
        presence.antennaId = destinationAntenna;
        presence.lastSeenAt = this.nowCursor;
      }
      movedEpcs.forEach((epc, index) => {
        const ts = new Date(baseTs + index).toISOString();
        this.rfidEvents.push({
          id: `rr-transfer-${sourceZoneId}-${destinationZoneId}-${epc}-${baseTs}-${index}`,
          epc,
          antennaId: destinationAntenna,
          zoneId: destinationZoneId,
          timestamp: ts,
          rssi: -47.5,
          ingestedAt: ts
        });
      });
      return {
        movedQty: movedEpcs.length,
        movedEpcs,
        sourceType,
        destinationAntennaId: destinationAntenna
      };
    }

    const current = this.getCurrentInventoryQty(sourceZoneId, skuId, "NON_RFID");
    const movedQty = Math.min(Math.max(0, qty), current);
    this.upsertSnapshot(sourceZoneId, skuId, current - movedQty, "NON_RFID");
    return {
      movedQty,
      movedEpcs: [],
      sourceType
    };
  }

  private moveRFIDEpcs(
    sourceZoneId: string,
    destinationZoneId: string,
    skuId: string,
    qty: number,
    at: string
  ): string[] {
    const movedEpcs = this.getPresentEPCs(sourceZoneId, skuId).slice(0, qty);
    const destinationAntenna =
      this.antennas.find((antenna) => antenna.zoneId === destinationZoneId)?.id ?? "system-transfer";
    for (const epc of movedEpcs) {
      const presence = this.epcPresence.get(epc);
      if (!presence) continue;
      presence.zoneId = destinationZoneId;
      presence.antennaId = destinationAntenna;
      presence.lastSeenAt = at;
    }
    return movedEpcs;
  }

  private createExternalRFIDForDestination(
    skuId: string,
    destinationZoneId: string,
    qty: number,
    at: string
  ): number {
    const destinationAntenna =
      this.antennas.find((antenna) => antenna.zoneId === destinationZoneId)?.id ?? "system-transfer";
    let created = 0;
    for (let i = 0; i < qty; i += 1) {
      const epc = `EPC-RCV-${String(this.generatedEpcSeq).padStart(6, "0")}`;
      this.generatedEpcSeq += 1;
      this.mapping.push({
        id: `map-rcv-${epc.toLowerCase()}`,
        epc,
        skuId,
        inventorySource: "RFID",
        activeFrom: at
      });
      this.epcPresence.set(epc, {
        epc,
        skuId,
        zoneId: destinationZoneId,
        antennaId: destinationAntenna,
        lastSeenAt: at
      });
      created += 1;
    }
    return created;
  }

  private getReservedTaskQtyFromSource(
    sourceZoneId: string,
    skuId: string,
    excludeTaskId?: string
  ): number {
    return this.tasks
      .filter(
        (task) =>
          task.id !== excludeTaskId &&
          taskIsOpen(task.status) &&
          task.skuId === skuId &&
          task.sourceZoneId === sourceZoneId
      )
      .reduce((sum, task) => sum + Math.max(0, task.deficitQty), 0);
  }

  private pushTaskAudit(taskId: string, action: TaskAuditEntry["action"], actorId: string | undefined, details: string): void {
    this.taskAudit.unshift({
      id: `audit-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      taskId,
      action,
      actorId,
      details,
      timestamp: this.nowCursor
    });
  }

  private getAssignableActiveStaff(): StaffMember[] {
    const activeAssociates = this.staff.filter(
      (member) => member.activeShift && member.role === "ASSOCIATE"
    );
    if (activeAssociates.length > 0) return activeAssociates;
    return this.staff.filter((member) => member.activeShift);
  }

  private hasAnyAssignableStaffInScope(zoneId: string): boolean {
    return this.getAssignableActiveStaff().some(
      (member) => member.scopeAllZones || member.zoneScopeZoneIds.includes(zoneId)
    );
  }

  private autoAssignPendingTasks(at: string): void {
    const pendingTasks = this.tasks
      .filter((task) => task.status === "CREATED" && !task.assignedStaffId)
      .sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));

    if (pendingTasks.length === 0) return;

    const availableStaff = this.getAssignableActiveStaff();
    if (availableStaff.length === 0) return;

    const loadByStaff = new Map<string, number>();
    for (const member of availableStaff) {
      loadByStaff.set(member.id, 0);
    }
    for (const task of this.tasks) {
      if (!taskIsOpen(task.status) || !task.assignedStaffId) continue;
      if (!loadByStaff.has(task.assignedStaffId)) continue;
      loadByStaff.set(task.assignedStaffId, (loadByStaff.get(task.assignedStaffId) ?? 0) + 1);
    }
    for (const order of this.receivingOrders) {
      if (order.status !== "IN_TRANSIT" || !order.assignedStaffId) continue;
      if (!loadByStaff.has(order.assignedStaffId)) continue;
      loadByStaff.set(order.assignedStaffId, (loadByStaff.get(order.assignedStaffId) ?? 0) + 1);
    }

    for (const task of pendingTasks) {
      const eligibleByScope = availableStaff.filter(
        (member) =>
          member.scopeAllZones || member.zoneScopeZoneIds.includes(task.zoneId)
      );
      const assignPool = eligibleByScope.length > 0 ? eligibleByScope : availableStaff;
      const member = assignPool.reduce((selected, candidate) => {
        const selectedLoad = loadByStaff.get(selected.id) ?? 0;
        const candidateLoad = loadByStaff.get(candidate.id) ?? 0;
        if (candidateLoad === selectedLoad) {
          return candidate.id < selected.id ? candidate : selected;
        }
        return candidateLoad < selectedLoad ? candidate : selected;
      });
      task.assignedStaffId = member.id;
      task.assignedAt = at;
      task.status = "ASSIGNED";
      task.updatedAt = at;
      loadByStaff.set(member.id, (loadByStaff.get(member.id) ?? 0) + 1);
      this.nowCursor = at;
      this.pushTaskAudit(
        task.id,
        "ASSIGNED",
        member.id,
        eligibleByScope.length > 0
          ? `auto_assigned_to=${member.name}`
          : `auto_assigned_fallback_to=${member.name} reason=no_scope_match`
      );
    }
  }

  private autoAssignPendingReceivingOrders(at: string): void {
    const pendingOrders = this.receivingOrders
      .filter((order) => order.status === "IN_TRANSIT" && !order.assignedStaffId)
      .sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));

    if (pendingOrders.length === 0) return;

    const availableStaff = this.getAssignableActiveStaff();
    if (availableStaff.length === 0) return;

    const loadByStaff = new Map<string, number>();
    for (const member of availableStaff) {
      loadByStaff.set(member.id, 0);
    }
    for (const task of this.tasks) {
      if (!taskIsOpen(task.status) || !task.assignedStaffId) continue;
      if (!loadByStaff.has(task.assignedStaffId)) continue;
      loadByStaff.set(task.assignedStaffId, (loadByStaff.get(task.assignedStaffId) ?? 0) + 1);
    }
    for (const order of this.receivingOrders) {
      if (order.status !== "IN_TRANSIT" || !order.assignedStaffId) continue;
      if (!loadByStaff.has(order.assignedStaffId)) continue;
      loadByStaff.set(order.assignedStaffId, (loadByStaff.get(order.assignedStaffId) ?? 0) + 1);
    }

    for (const order of pendingOrders) {
      const eligibleByScope = availableStaff.filter((member) =>
        member.scopeAllZones || member.zoneScopeZoneIds.includes(order.destinationZoneId)
      );
      const assignPool = eligibleByScope.length > 0 ? eligibleByScope : availableStaff;
      const member = assignPool.reduce((selected, candidate) => {
        const selectedLoad = loadByStaff.get(selected.id) ?? 0;
        const candidateLoad = loadByStaff.get(candidate.id) ?? 0;
        if (candidateLoad === selectedLoad) {
          return candidate.id < selected.id ? candidate : selected;
        }
        return candidateLoad < selectedLoad ? candidate : selected;
      });
      order.assignedStaffId = member.id;
      order.assignedAt = at;
      order.updatedAt = at;
      loadByStaff.set(member.id, (loadByStaff.get(member.id) ?? 0) + 1);
      this.nowCursor = at;
    }
  }

  private getBusyStaffIds(): Set<string> {
    const busy = new Set<string>();
    for (const task of this.tasks) {
      if (!taskIsOpen(task.status)) continue;
      if (!task.assignedStaffId) continue;
      busy.add(task.assignedStaffId);
    }
    for (const order of this.receivingOrders) {
      if (order.status !== "IN_TRANSIT") continue;
      if (!order.assignedStaffId) continue;
      busy.add(order.assignedStaffId);
    }
    return busy;
  }

  private getBaselineSnapshot(zoneId: string, skuId: string): InventorySnapshotByZone {
    const exact = this.nonRfidBaselines.get(this.getBaselineKey(zoneId, skuId));

    if (exact) return { ...exact };

    return {
      id: `baseline-${zoneId}-${skuId}`,
      zoneId,
      skuId,
      qty: 0,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:00:00Z",
      version: 1
    };
  }

  private getBaselineKey(zoneId: string, skuId: string): string {
    return `${zoneId}::${skuId}`;
  }

  private getCurrentInventoryQty(zoneId: string, skuId: string, source: InventorySource): number {
    const snapshot = this.snapshots
      .filter((s) => s.zoneId === zoneId && s.skuId === skuId && s.source === source)
      .sort((a, b) => toMs(b.lastCalculatedAt) - toMs(a.lastCalculatedAt))[0];
    return snapshot?.qty ?? 0;
  }

  private upsertSnapshot(
    zoneId: string,
    skuId: string,
    qty: number,
    source: InventorySource,
    confidence?: number
  ): void {
    const existing = this.snapshots.find((s) => s.zoneId === zoneId && s.skuId === skuId && s.source === source);
    if (zoneId === CASHIER_STORAGE_ZONE_ID && qty <= 0) {
      if (existing) {
        this.snapshots = this.snapshots.filter((s) => s !== existing);
      }
      return;
    }
    if (!existing) {
      this.snapshots.push({
        id: `snap-${zoneId}-${skuId}-${source}`,
        zoneId,
        skuId,
        qty,
        source,
        confidence,
        lastCalculatedAt: this.nowCursor,
        version: 1
      });
      return;
    }

    existing.qty = qty;
    existing.lastCalculatedAt = this.nowCursor;
    existing.version += 1;
    if (confidence !== undefined) existing.confidence = confidence;
  }
}

export const inventoryPseudocode = `
CONSTANTS:
  DEDUP_WINDOW_SEC = 15
  RFID_PRESENCE_TTL_SEC = 300

ingestRFIDRead(event):
  validate antenna-zone
  if deduplicateReads(event.epc, event.antenna_id, DEDUP_WINDOW_SEC): ignore
  mapping = EPC -> SKU lookup at event timestamp
  store read
  upsert EPC last seen presence
  calculateZoneInventory(event.zone_id)

ingestSalesEvent(event):
  if SKU source is NON_RFID -> decrement by sales movement
  if SKU source is RFID -> deduct immediately in sale zone
  readings after sale only refine observed presence/confidence

addCustomerItem(customer, zone, sku, qty):
  append item to IN_CART basket
  if sku is RFID -> create pending RFID pick

ingestRFIDRead(event):
  refresh EPC presence
  apply pending RFID picks in that zone (customer removed items before checkout)
  recalculate + evaluate min-max

checkoutCustomer(customer):
  finalize IN_CART items
  NON_RFID -> create sales movements
  RFID -> deduct outstanding qty not yet confirmed by picks

deduplicateReads(epc, antenna, window):
  return true if same epc+antenna was accepted inside window

calculateZoneInventory(zoneId):
  RFID qty = distinct EPC count where last_seen >= now - TTL
  NON_RFID qty = baseline - sales + returns + confirmed_replenishment
  write snapshots
  evaluateMinMax(zoneId)

evaluateMinMax(zoneId):
  for each rule in zone:
    if current < min: create/update OPEN task with deficit = max-current
    if current >= max: close OPEN task

upsertRule(zone, sku, source, min, max):
  create or update replenishment rule
  re-run calculateZoneInventory(zone)

generateReplenishmentTask(rule, deficitQty):
  create task(status=OPEN, trigger_qty=current, deficit_qty, target_qty=max)

closeReplenishmentTask(taskId):
  set COMPLETED + closed timestamp
`;
