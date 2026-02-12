import type {
  Antenna,
  EPCSkuMapping,
  InventorySnapshotByZone,
  ReplenishmentRule,
  RFIDReadEvent,
  SalesEvent,
  StaffMember,
  Zone
} from "../domain/models";

export interface SKU {
  id: string;
  name: string;
  source: "RFID" | "NON_RFID";
}

export interface CatalogVariant {
  id: string;
  skuId: string;
  name: string;
  imageUrl: string;
  size: string;
  barcode: string;
  kit?: "home" | "away" | "third" | "forth";
  ageGroup?: "adults" | "youth" | "kids" | "baby";
  gender?: "women" | "men" | "unisex";
  role?: "player" | "goalkeeper" | "staff";
  quality?: "match" | "stadium";
}

export interface CatalogProduct {
  id: string;
  title: string;
  brand: string;
  variants: CatalogVariant[];
}

export interface SampleDataset {
  zones: Zone[];
  antennas: Antenna[];
  skus: SKU[];
  catalogProducts: CatalogProduct[];
  epcSkuMapping: EPCSkuMapping[];
  replenishmentRules: ReplenishmentRule[];
  inventorySeed: InventorySnapshotByZone[];
  rfidReadEvents: RFIDReadEvent[];
  salesEvents: SalesEvent[];
  staff: StaffMember[];
}

export const sampleDataset: SampleDataset = {
  zones: [
    {
      id: "zone-shelf-a",
      name: "Woman",
      color: "#3b82f6",
      mapPolygon: [
        { x: 245.8983799705449, y: 98.24538392164928 },
        { x: 509.540500736377, y: 98.77116197015964 },
        { x: 511.16642120765835, y: 129.6992824707688 },
        { x: 244.3917525773196, y: 128.39588310681455 }
      ],
      antennaIds: ["ant-woman-1"],
      ruleIds: ["rule-nr-1"],
      isSalesLocation: true,
      replenishmentSources: [{ sourceZoneId: "zone-warehouse", sortOrder: 1 }],
      isActive: true,
      createdAt: "2026-02-10T09:00:00Z"
    },
    {
      id: "zone-shelf-b",
      name: "Kids",
      color: "#f59e0b",
      mapPolygon: [
        { x: 604.060382916053, y: 101.17030046042119 },
        { x: 927.3799705449189, y: 96.97291267819566 },
        { x: 926.4698085419734, y: 132.2398066547474 },
        { x: 600.7334315169367, y: 132.465140104109 }
      ],
      antennaIds: ["ant-kids-1"],
      ruleIds: ["rule-rfid-1"],
      isSalesLocation: true,
      replenishmentSources: [{ sourceZoneId: "zone-warehouse", sortOrder: 1 }],
      isActive: true,
      createdAt: "2026-02-10T09:00:00Z"
    },
    {
      id: "zone-warehouse",
      name: "Warehouse",
      color: "#22c55e",
      mapPolygon: [
        { x: 1053.0751104565538, y: 86.24527316741293 },
        { x: 1382.4079528718705, y: 86.20109013812636 },
        { x: 1380.8173784977907, y: 303.7539080423398 },
        { x: 1052.4344624447717, y: 304.6419869310001 }
      ],
      antennaIds: ["ant-warehouse-1"],
      ruleIds: ["rule-wh-rfid-1", "rule-wh-rfid-2"],
      isSalesLocation: false,
      replenishmentSources: [{ sourceZoneId: "external-esbo", sortOrder: 1 }],
      isActive: true,
      createdAt: "2026-02-10T09:00:00Z"
    },
    {
      id: "zone-cashier",
      name: "Cashier",
      color: "#ef4444",
      mapPolygon: [
        { x: 951.4374079528719, y: 687.0858701327469 },
        { x: 992.2533136966126, y: 686.0254774298688 },
        { x: 990.6936671575846, y: 622.8083991266237 },
        { x: 1384.7893961708396, y: 620.4136789392909 },
        { x: 1382.7525773195875, y: 928.4577591253579 },
        { x: 950.3107511045655, y: 925.6742282803032 }
      ],
      antennaIds: ["ant-cashier-1"],
      ruleIds: [],
      isSalesLocation: false,
      replenishmentSources: [{ sourceZoneId: "zone-warehouse", sortOrder: 1 }],
      isActive: true,
      createdAt: "2026-02-10T09:00:00Z"
    },
    {
      id: "zone-fitting-rooms",
      name: "Fitting Rooms",
      color: "#6366f1",
      mapPolygon: [
        { x: 170.51840942562592, y: 631.9233580684461 },
        { x: 381.04860088365245, y: 632.6081950223881 },
        { x: 382.1885125184094, y: 927.3929481195513 },
        { x: 172.0559646539028, y: 929.3900210433048 }
      ],
      antennaIds: ["ant-fitting-1"],
      ruleIds: [],
      isSalesLocation: false,
      replenishmentSources: [{ sourceZoneId: "zone-warehouse", sortOrder: 1 }],
      isActive: true,
      createdAt: "2026-02-10T09:00:00Z"
    },
    {
      id: "zone-entrance",
      name: "Entrance",
      color: "#0ea5e9",
      mapPolygon: [
        { x: 508.2503681885125, y: 687.1079616473902 },
        { x: 949.5552282768778, y: 687.2140009176779 },
        { x: 951.9366715758467, y: 928.9040077211524 },
        { x: 508.2636229749632, y: 927.2692356375488 }
      ],
      antennaIds: ["ant-entrance-1"],
      ruleIds: [],
      isSalesLocation: false,
      replenishmentSources: [{ sourceZoneId: "zone-warehouse", sortOrder: 1 }],
      isActive: true,
      createdAt: "2026-02-10T09:00:00Z"
    },
    {
      id: "zone-aisle-east",
      name: "Aisle East",
      color: "#14b8a6",
      mapPolygon: [
        { x: 1028.783505154639, y: 315.56403177064385 },
        { x: 1380.7864506627393, y: 316.5669865354493 },
        { x: 1382.1914580265095, y: 619.8348812556367 },
        { x: 991.0338733431518, y: 621.8452090881761 },
        { x: 990.8350515463917, y: 463.57276157777324 },
        { x: 1029.7334315169367, y: 462.5123688748952 }
      ],
      antennaIds: ["ant-aisle-east-1"],
      ruleIds: [],
      isSalesLocation: false,
      replenishmentSources: [{ sourceZoneId: "zone-warehouse", sortOrder: 1 }],
      isActive: true,
      createdAt: "2026-02-10T09:00:00Z"
    },
    {
      id: "zone-mlhrerbe",
      name: "Men",
      color: "#a855f7",
      mapPolygon: [
        { x: 179.61058923996586, y: 196.5356376146789 },
        { x: 209.6618274978651, y: 196.85844036697247 },
        { x: 209.39026473099915, y: 390.8987614678899 },
        { x: 180.58923996584116, y: 390.6886834862385 }
      ],
      antennaIds: ["ant-men-1"],
      ruleIds: [],
      isSalesLocation: true,
      replenishmentSources: [{ sourceZoneId: "zone-warehouse", sortOrder: 1 }],
      isActive: true,
      createdAt: "2026-02-10T10:04:00Z"
    }
  ],
  antennas: [
    { id: "ant-woman-1", zoneId: "zone-shelf-a", name: "WOMAN-1", x: 515, y: 235, isActive: true, createdAt: "2026-02-10T09:00:00Z" },
    { id: "ant-kids-1", zoneId: "zone-shelf-b", name: "KIDS-1", x: 930, y: 330, isActive: true, createdAt: "2026-02-10T09:00:00Z" },
    { id: "ant-warehouse-1", zoneId: "zone-warehouse", name: "WH-1", x: 1298, y: 190, isActive: true, createdAt: "2026-02-10T09:00:00Z" },
    { id: "ant-cashier-1", zoneId: "zone-cashier", name: "CS-1", x: 1165, y: 835, isActive: true, createdAt: "2026-02-10T09:00:00Z" },
    { id: "ant-fitting-1", zoneId: "zone-fitting-rooms", name: "FIT-1", x: 315, y: 860, isActive: true, createdAt: "2026-02-10T09:00:00Z" },
    { id: "ant-entrance-1", zoneId: "zone-entrance", name: "ENT-1", x: 770, y: 1068, isActive: true, createdAt: "2026-02-10T09:00:00Z" },
    { id: "ant-aisle-east-1", zoneId: "zone-aisle-east", name: "AIE-1", x: 1210, y: 520, isActive: true, createdAt: "2026-02-10T09:00:00Z" },
    { id: "ant-men-1", zoneId: "zone-mlhrerbe", name: "MEN-1", x: 196, y: 294, isActive: true, createdAt: "2026-02-10T09:00:00Z" }
  ],
  skus: [
    { id: "SKU-RFID-1", name: "RFID Jacket", source: "RFID" },
    { id: "SKU-RFID-2", name: "RFID Jeans", source: "RFID" },
    { id: "SKU-RFID-3", name: "RFID Shoes", source: "RFID" },
    { id: "SKU-RFID-4", name: "JSY Y AW MTCH UCL 25/26", source: "RFID" },
    { id: "SKU-RFID-5", name: "JSY Y HM UCL 25/26", source: "RFID" },
    { id: "SKU-NR-1", name: "BUFANDA TELAR HOME 25_26", source: "NON_RFID" },
    { id: "SKU-NR-2", name: "CLAUER XARXA PORTERIA", source: "NON_RFID" },
    { id: "SKU-NR-3", name: "IMAN ESCUDO DORADO PURPURINA", source: "NON_RFID" }
  ],
  catalogProducts: [
    {
      id: "prod-sku-rfid-1",
      title: "JSY M 4TA MTCH UCL LAMINE 25/26",
      brand: "Retail Demo Store",
      variants: [
        {
          id: "var-rfid-1",
          skuId: "SKU-RFID-1",
          name: "JSY M 4TA MTCH UCL LAMINE 25/26 - XS",
          imageUrl: "/catalog-sku-rfid-1.jpg",
          size: "XS",
          barcode: "3300181901590",
          kit: "forth",
          ageGroup: "adults",
          gender: "men",
          role: "player",
          quality: "match"
        }
      ]
    },
    {
      id: "prod-sku-rfid-2",
      title: "JSY M GK VIOLET UCL 25/26",
      brand: "Retail Demo Store",
      variants: [
        {
          id: "var-rfid-2",
          skuId: "SKU-RFID-2",
          name: "JSY M GK VIOLET UCL 25/26 - S",
          imageUrl: "/catalog-sku-rfid-2.webp",
          size: "S",
          barcode: "3300181891143",
          kit: "away",
          ageGroup: "adults",
          gender: "men",
          role: "goalkeeper",
          quality: "stadium"
        }
      ]
    },
    {
      id: "prod-sku-rfid-3",
      title: "JSY W HM UCL 25/26",
      brand: "Retail Demo Store",
      variants: [
        {
          id: "var-rfid-3",
          skuId: "SKU-RFID-3",
          name: "JSY W HM UCL 25/26 - L",
          imageUrl: "/catalog-sku-rfid-3.jpg",
          size: "L",
          barcode: "3300181884909",
          kit: "home",
          ageGroup: "adults",
          gender: "women",
          role: "player",
          quality: "stadium"
        }
      ]
    },
    {
      id: "prod-sku-rfid-4",
      title: "JSY Y AW MTCH UCL 25/26",
      brand: "Retail Demo Store",
      variants: [
        {
          id: "var-rfid-4",
          skuId: "SKU-RFID-4",
          name: "JSY Y AW MTCH UCL 25/26 - XS",
          imageUrl: "/catalog-sku-nr-1.webp",
          size: "XS",
          barcode: "3300181891846",
          kit: "away",
          ageGroup: "youth",
          gender: "unisex",
          role: "player",
          quality: "match"
        }
      ]
    },
    {
      id: "prod-sku-rfid-5",
      title: "JSY Y HM UCL 25/26",
      brand: "Retail Demo Store",
      variants: [
        {
          id: "var-rfid-5",
          skuId: "SKU-RFID-5",
          name: "JSY Y HM UCL 25/26 - XS",
          imageUrl: "/catalog-sku-nr-2.jpg",
          size: "XS",
          barcode: "3300181884091",
          kit: "home",
          ageGroup: "youth",
          gender: "unisex",
          role: "player",
          quality: "stadium"
        }
      ]
    },
    {
      id: "prod-sku-nr-1-inventory",
      title: "BUFANDA TELAR HOME 25_26",
      brand: "Retail Demo Store",
      variants: [
        {
          id: "var-nr-1-inventory",
          skuId: "SKU-NR-1",
          name: "BUFANDA TELAR HOME 25_26 - Default Title",
          imageUrl: "/catalog-sku-nr-4.jpg",
          size: "Default Title",
          barcode: "8435765007742"
        }
      ]
    },
    {
      id: "prod-sku-nr-2-inventory",
      title: "CLAUER XARXA PORTERIA",
      brand: "Retail Demo Store",
      variants: [
        {
          id: "var-nr-2-inventory",
          skuId: "SKU-NR-2",
          name: "CLAUER XARXA PORTERIA - Default Title",
          imageUrl: "/catalog-sku-nr-5.jpg",
          size: "Default Title",
          barcode: "7778800675560"
        }
      ]
    },
    {
      id: "prod-sku-nr-3",
      title: "IMAN ESCUDO DORADO PURPURINA",
      brand: "Retail Demo Store",
      variants: [
        {
          id: "var-nr-3",
          skuId: "SKU-NR-3",
          name: "IMAN ESCUDO DORADO PURPURINA - Default Title",
          imageUrl: "/catalog-sku-nr-3.jpg",
          size: "Default Title",
          barcode: "8436563583612"
        }
      ]
    }
  ],
  epcSkuMapping: [
    { id: "m1", epc: "EPC-0001", skuId: "SKU-RFID-1", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m2", epc: "EPC-0002", skuId: "SKU-RFID-1", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m3", epc: "EPC-0003", skuId: "SKU-RFID-1", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m4", epc: "EPC-0004", skuId: "SKU-RFID-1", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m5", epc: "EPC-0005", skuId: "SKU-RFID-2", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m6", epc: "EPC-0006", skuId: "SKU-RFID-2", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m7", epc: "EPC-0007", skuId: "SKU-RFID-2", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m8", epc: "EPC-0008", skuId: "SKU-RFID-3", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m9", epc: "EPC-0009", skuId: "SKU-RFID-3", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m10", epc: "EPC-0010", skuId: "SKU-RFID-3", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m11", epc: "EPC-0011", skuId: "SKU-RFID-4", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m12", epc: "EPC-0012", skuId: "SKU-RFID-4", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m13", epc: "EPC-0013", skuId: "SKU-RFID-5", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" },
    { id: "m14", epc: "EPC-0014", skuId: "SKU-RFID-5", inventorySource: "RFID", activeFrom: "2026-01-01T00:00:00Z" }
  ],
  replenishmentRules: [
    {
      id: "rule-nr-1",
      zoneId: "zone-shelf-a",
      skuId: "SKU-NR-1",
      source: "NON_RFID",
      minQty: 2,
      maxQty: 8,
      priority: 1,
      isActive: true,
      updatedAt: "2026-02-10T09:00:00Z"
    },
    {
      id: "rule-rfid-1",
      zoneId: "zone-shelf-b",
      skuId: "SKU-RFID-1",
      source: "RFID",
      minQty: 1,
      maxQty: 4,
      priority: 2,
      isActive: true,
      updatedAt: "2026-02-10T09:00:00Z"
    },
    {
      id: "rule-wh-rfid-1",
      zoneId: "zone-warehouse",
      skuId: "SKU-RFID-1",
      source: "RFID",
      inboundSourceLocationId: "external-esbo",
      minQty: 4,
      maxQty: 10,
      priority: 1,
      isActive: true,
      updatedAt: "2026-02-10T09:00:00Z"
    },
    {
      id: "rule-wh-rfid-2",
      zoneId: "zone-warehouse",
      skuId: "SKU-RFID-2",
      source: "RFID",
      inboundSourceLocationId: "external-esbo",
      minQty: 4,
      maxQty: 10,
      priority: 1,
      isActive: true,
      updatedAt: "2026-02-10T09:00:00Z"
    }
  ],
  inventorySeed: [
    {
      id: "seed-1",
      zoneId: "zone-shelf-a",
      skuId: "SKU-NR-1",
      qty: 7,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-2",
      zoneId: "zone-shelf-a",
      skuId: "SKU-NR-2",
      qty: 4,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-3",
      zoneId: "zone-shelf-b",
      skuId: "SKU-NR-1",
      qty: 6,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-4",
      zoneId: "zone-shelf-b",
      skuId: "SKU-NR-2",
      qty: 5,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-5",
      zoneId: "zone-warehouse",
      skuId: "SKU-NR-1",
      qty: 180,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-6",
      zoneId: "zone-warehouse",
      skuId: "SKU-NR-2",
      qty: 150,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-7",
      zoneId: "zone-aisle-east",
      skuId: "SKU-NR-1",
      qty: 8,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-8",
      zoneId: "zone-aisle-east",
      skuId: "SKU-NR-2",
      qty: 6,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-9",
      zoneId: "zone-cashier",
      skuId: "SKU-NR-1",
      qty: 3,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-10",
      zoneId: "zone-cashier",
      skuId: "SKU-NR-2",
      qty: 2,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-11",
      zoneId: "zone-fitting-rooms",
      skuId: "SKU-NR-1",
      qty: 2,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-12",
      zoneId: "zone-fitting-rooms",
      skuId: "SKU-NR-2",
      qty: 2,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-13",
      zoneId: "zone-entrance",
      skuId: "SKU-NR-1",
      qty: 1,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-14",
      zoneId: "zone-entrance",
      skuId: "SKU-NR-2",
      qty: 1,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-15",
      zoneId: "zone-mlhrerbe",
      skuId: "SKU-NR-1",
      qty: 5,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    },
    {
      id: "seed-16",
      zoneId: "zone-mlhrerbe",
      skuId: "SKU-NR-2",
      qty: 4,
      source: "NON_RFID",
      lastCalculatedAt: "2026-02-10T09:55:00Z",
      version: 1
    }
  ],
  rfidReadEvents: [
    { id: "rr1", epc: "EPC-0001", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:05Z", rssi: -55.2, ingestedAt: "2026-02-10T10:00:05Z" },
    { id: "rr2", epc: "EPC-0002", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:06Z", rssi: -54.1, ingestedAt: "2026-02-10T10:00:06Z" },
    { id: "rr3", epc: "EPC-0003", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:07Z", rssi: -53.8, ingestedAt: "2026-02-10T10:00:07Z" },
    { id: "rr4", epc: "EPC-0004", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:08Z", rssi: -53.6, ingestedAt: "2026-02-10T10:00:08Z" },
    { id: "rr5", epc: "EPC-0005", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:09Z", rssi: -56.3, ingestedAt: "2026-02-10T10:00:09Z" },
    { id: "rr6", epc: "EPC-0006", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:10Z", rssi: -56.1, ingestedAt: "2026-02-10T10:00:10Z" },
    { id: "rr7", epc: "EPC-0007", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:11Z", rssi: -56.0, ingestedAt: "2026-02-10T10:00:11Z" },
    { id: "rr8", epc: "EPC-0008", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:12Z", rssi: -58.7, ingestedAt: "2026-02-10T10:00:12Z" },
    { id: "rr9", epc: "EPC-0009", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:13Z", rssi: -57.0, ingestedAt: "2026-02-10T10:00:13Z" },
    { id: "rr10", epc: "EPC-0010", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:14Z", rssi: -56.9, ingestedAt: "2026-02-10T10:00:14Z" },
    { id: "rr11", epc: "EPC-0011", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:15Z", rssi: -55.9, ingestedAt: "2026-02-10T10:00:15Z" },
    { id: "rr12", epc: "EPC-0012", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:16Z", rssi: -55.6, ingestedAt: "2026-02-10T10:00:16Z" },
    { id: "rr13", epc: "EPC-0013", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:17Z", rssi: -55.1, ingestedAt: "2026-02-10T10:00:17Z" },
    { id: "rr14", epc: "EPC-0014", antennaId: "ant-warehouse-1", zoneId: "zone-warehouse", timestamp: "2026-02-10T10:00:18Z", rssi: -54.9, ingestedAt: "2026-02-10T10:00:18Z" }
  ],
  salesEvents: [
    { id: "s1", skuId: "SKU-NR-1", zoneId: "zone-shelf-a", eventType: "SALE", qty: 2, timestamp: "2026-02-10T10:01:00Z", posTxnId: "POS-1", ingestedAt: "2026-02-10T10:01:00Z" },
    { id: "s2", skuId: "SKU-NR-1", zoneId: "zone-shelf-a", eventType: "SALE", qty: 1, timestamp: "2026-02-10T10:02:00Z", posTxnId: "POS-2", ingestedAt: "2026-02-10T10:02:00Z" },
    { id: "s3", skuId: "SKU-NR-1", zoneId: "zone-shelf-a", eventType: "SALE", qty: 1, timestamp: "2026-02-10T10:03:00Z", posTxnId: "POS-3", ingestedAt: "2026-02-10T10:03:00Z" },
    { id: "s4", skuId: "SKU-NR-2", zoneId: "zone-shelf-a", eventType: "SALE", qty: 1, timestamp: "2026-02-10T10:04:00Z", posTxnId: "POS-4", ingestedAt: "2026-02-10T10:04:00Z" }
  ],
  staff: [
    {
      id: "staff-001",
      name: "Marta Soler",
      role: "SUPERVISOR",
      activeShift: true,
      shiftLabel: "Morning",
      scopeAllZones: true,
      zoneScopeZoneIds: []
    },
    {
      id: "staff-002",
      name: "Pol Serra",
      role: "ASSOCIATE",
      activeShift: true,
      shiftLabel: "Morning",
      scopeAllZones: false,
      zoneScopeZoneIds: ["zone-shelf-a", "zone-shelf-b"]
    },
    {
      id: "staff-003",
      name: "Nora Vidal",
      role: "ASSOCIATE",
      activeShift: true,
      shiftLabel: "Evening",
      scopeAllZones: false,
      zoneScopeZoneIds: ["zone-warehouse"]
    }
  ]
};
