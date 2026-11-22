import type { Vec3 } from './types';

export interface ApiItem {
  id: string;
  name: string;
  shortName: string;
  iconLink?: string | null;
}

export interface ApiZone {
  id: string;
  map: { id: string } | null;
  position: Vec3 | null;
  /** Kill zones: the area's corners (game coordinates) and its floor/ceiling heights. */
  outline?: Vec3[] | null;
  top?: number | null;
  bottom?: number | null;
}

export interface ApiObjective {
  id: string;
  type: string;
  description: string;
  optional: boolean;
  maps: { id: string; normalizedName: string }[];
  zones?: ApiZone[] | null;
  requiredKeys?: (ApiItem | null)[][] | null;
  markerItem?: ApiItem | null;
  items?: ApiItem[] | null;
  questItem?: ApiItem | null;
  useAny?: ApiItem[] | null;
  usingWeapon?: ApiItem[] | null;
  count?: number;
  foundInRaid?: boolean;
  targetNames?: string[];
  zoneNames?: string[];
  exitName?: string | null;
  possibleLocations?: { map: { id: string } | null; positions: Vec3[] | null }[] | null;
}

export interface ApiTask {
  id: string;
  name: string;
  normalizedName: string;
  minPlayerLevel: number | null;
  kappaRequired: boolean | null;
  wikiLink: string | null;
  factionName: string | null;
  trader: { name: string; normalizedName: string; imageLink: string | null };
  map: { id: string; normalizedName: string } | null;
  taskRequirements: { task: { id: string } | null; status: string[] }[];
  objectives: ApiObjective[];
}

export interface ApiMap {
  id: string;
  name: string;
  normalizedName: string;
  nameId: string | null;
  spawns: { zoneName: string | null; sides: string[] | null; categories: string[] | null; position: Vec3 }[] | null;
  extracts: { id: string; name: string | null; faction: string | null; position: Vec3 | null }[] | null;
  /** Boss/squad groups (json.tarkov.dev only): who, which spawn zones, how many in the group. */
  bosses?: { mob: string; zones: string[]; size: number }[];
}

/** Entry of tarkov-dev's src/data/maps.json used for drawing. */
export interface MapDisplay {
  key: string;
  projection: string;
  transform?: [number, number, number, number];
  coordinateRotation?: number;
  bounds: [[number, number], [number, number]];
  svgBounds?: [[number, number], [number, number]];
  svgPath?: string;
  svgLayer?: string;
  tilePath?: string;
  minZoom?: number;
  maxZoom?: number;
  tileSize?: number;
  /** Heights that belong to the base (ground) floor. */
  heightRange?: [number, number];
  /** Extra floors (upper levels, basements); see floors.ts. */
  layers?: import('./floors').MapLayerConfig[];
}

export interface MapDisplayGroup {
  normalizedName: string;
  maps: MapDisplay[];
}

/**
 * Where the data shown came from:
 * - json: json.tarkov.dev (what the tarkov.dev website uses) — normal case
 * - graphql: api.tarkov.dev — used when the JSON files fail
 * - cache: last good download saved on this PC (both online sources failed)
 * - snapshot: copy built into the installer (nothing downloaded yet)
 */
export type DataSourceKind = 'json' | 'graphql' | 'cache' | 'snapshot';

export interface TarkovData {
  tasks: ApiTask[];
  maps: ApiMap[];
  display: MapDisplayGroup[];
  /** When this data was downloaded from tarkov.dev. */
  fetchedAt: string;
  /** When the app last checked online for newer data. */
  checkedAt: string;
  source: DataSourceKind;
  /** Why online sources failed, when showing cache or snapshot. */
  stale: string | null;
}
