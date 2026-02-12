export interface MapPolygonPoint {
  x: number;
  y: number;
}

export interface ShopfloorZone {
  id: string;
  label: string;
  linkedInventoryZoneId?: string;
  polygon: MapPolygonPoint[];
}

export interface ShopfloorAntenna {
  id: string;
  label: string;
  zoneId: string;
  x: number;
  y: number;
}

export const SHOPFLOOR_SIZE = {
  width: 1536,
  height: 1117
};

export const shopfloorZones: ShopfloorZone[] = [
  {
    id: "sf-sales-core",
    label: "Shelf A",
    linkedInventoryZoneId: "zone-shelf-a",
    polygon: [
      { x: 160, y: 150 },
      { x: 1110, y: 150 },
      { x: 1110, y: 920 },
      { x: 160, y: 920 }
    ]
  },
  {
    id: "sf-stockroom",
    label: "Warehouse",
    linkedInventoryZoneId: "zone-warehouse",
    polygon: [
      { x: 1108, y: 52 },
      { x: 1492, y: 52 },
      { x: 1492, y: 323 },
      { x: 1108, y: 323 }
    ]
  },
  {
    id: "sf-feature-table",
    label: "Shelf B",
    linkedInventoryZoneId: "zone-shelf-b",
    polygon: [
      { x: 860, y: 238 },
      { x: 1060, y: 238 },
      { x: 1060, y: 510 },
      { x: 860, y: 510 }
    ]
  },
  {
    id: "sf-cashier",
    label: "Cashier",
    linkedInventoryZoneId: "zone-cashier",
    polygon: [
      { x: 1060, y: 780 },
      { x: 1492, y: 780 },
      { x: 1492, y: 1108 },
      { x: 1060, y: 1108 }
    ]
  },
  {
    id: "sf-fitting-rooms",
    label: "Fitting Rooms",
    linkedInventoryZoneId: "zone-fitting-rooms",
    polygon: [
      { x: 170, y: 720 },
      { x: 470, y: 720 },
      { x: 470, y: 1108 },
      { x: 170, y: 1108 }
    ]
  },
  {
    id: "sf-entrance",
    label: "Entrance",
    linkedInventoryZoneId: "zone-entrance",
    polygon: [
      { x: 580, y: 1086 },
      { x: 960, y: 1086 },
      { x: 960, y: 1115 },
      { x: 580, y: 1115 }
    ]
  },
  {
    id: "sf-aisle-east",
    label: "Aisle East",
    linkedInventoryZoneId: "zone-aisle-east",
    polygon: [
      { x: 1060, y: 323 },
      { x: 1492, y: 323 },
      { x: 1492, y: 780 },
      { x: 1060, y: 780 }
    ]
  }
];

export const shopfloorAntennas: ShopfloorAntenna[] = [
  { id: "ant-z2-1", label: "SF-A1", zoneId: "sf-sales-core", x: 515, y: 235 },
  { id: "ant-z2-2", label: "SF-A2", zoneId: "sf-sales-core", x: 815, y: 235 },
  { id: "ant-z1-1", label: "SF-B1", zoneId: "sf-feature-table", x: 930, y: 330 },
  { id: "ant-z3-1", label: "ST-A1", zoneId: "sf-stockroom", x: 1298, y: 190 },
  { id: "ant-z3-2", label: "ST-A2", zoneId: "sf-stockroom", x: 1450, y: 285 },
  { id: "ant-cash-1", label: "CS-A1", zoneId: "sf-cashier", x: 1165, y: 835 },
  { id: "ant-fit-1", label: "FT-A1", zoneId: "sf-fitting-rooms", x: 315, y: 860 },
  { id: "ant-ent-1", label: "EN-A1", zoneId: "sf-entrance", x: 770, y: 1068 }
];
