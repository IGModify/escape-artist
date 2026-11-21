// Floors (levels) of multi-storey maps, following tarkov.dev's map config: each extra floor has
// height ranges ("extents"), optionally limited to building outlines, that say which positions
// belong to it. Everything else is on the base ("Ground") floor.
import type { MapDisplay } from './tarkovTypes';
import type { Vec3 } from './types';

/** [[x1, z1], [x2, z2], name?] in game coordinates. */
export type FloorBounds = [[number, number], [number, number], string?];

export interface FloorExtent {
  height: [number, number];
  bounds?: FloorBounds[];
}

export interface MapLayerConfig {
  name: string;
  svgLayer?: string;
  tilePath?: string;
  show?: boolean;
  extents?: FloorExtent[];
}

export interface Floor {
  /** 'base' for the ground floor, otherwise the layer's name. */
  id: string;
  name: string;
  base: boolean;
  /** Group id inside the map SVG holding this floor's drawing. */
  svgLayer?: string;
  /** Raster tiles for this floor (used when the SVG has no group for it). */
  tilePath?: string;
  /** Floors tarkov.dev draws on top of the ground by default (e.g. the Interchange mall). */
  show: boolean;
  extents: FloorExtent[];
  /** Position in tarkov.dev's config; decides which floor wins where two overlap. */
  order: number;
  /** Sort key: 0 = ground, below ground < 0, 2nd floor = 1, 3rd = 2… */
  level: number;
}

const BELOW = /underground|tunnel|technical|garage|bunker|basement|sewer|cellar/i;
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];

/** "3rd Floor" / "Third Floor" / "Second Level" → 3 / 3 / 2. */
function floorNumber(name: string): number | null {
  const n = /\b(\d+)(?:st|nd|rd|th)?\b/i.exec(name);
  if (n) return Number(n[1]);
  const i = ORDINALS.findIndex((w) => new RegExp(`\\b${w}\\b`, 'i').test(name));
  return i >= 0 ? i + 1 : null;
}

const ANY: [number, number] = [-1e9, 1e9];

/** A floor's typical height, ignoring the open-ended ±10000 limits the config uses. */
function heightOf(extents: FloorExtent[]): number | null {
  const h = extents[0]?.height;
  if (!h) return null;
  const lo = Math.max(h[0], -60);
  const hi = Math.min(h[1], 120);
  return hi - lo >= 150 ? null : (lo + hi) / 2;
}

/**
 * Where a floor goes in the list. Heights alone can't order floors (each building has its own),
 * so names decide first: basements below ground, numbered floors by number; anything else
 * (e.g. Icebreaker's decks) by its height compared with the ground, keeping the config's order.
 */
function levelOf(name: string, extents: FloorExtent[], ground: number | null, index: number): number {
  if (BELOW.test(name)) return -1 - index / 100;
  const n = floorNumber(name);
  if (n !== null) return n - 1;
  const h = heightOf(extents);
  if (h !== null && ground !== null && h < ground) return -0.5 + index / 1000;
  return 0.5 + index / 1000;
}

/** The map's floors, lowest first. Empty when the map has only one level. */
export function floorsFor(d: MapDisplay): Floor[] {
  const layers = (d.layers ?? []).filter((l) => (l.svgLayer || l.tilePath) && l.extents?.length);
  if (layers.length === 0) return [];
  const baseExtents: FloorExtent[] = [{ height: d.heightRange ?? ANY }];
  const base: Floor = {
    id: 'base',
    // Match the map's own naming: Labs has "Second Level", so its base is the "First Level".
    name: layers.some((l) => /\blevel$/i.test(l.name)) ? 'First Level' : 'Ground',
    base: true,
    svgLayer: d.svgLayer,
    tilePath: d.tilePath,
    show: true,
    extents: baseExtents,
    order: -1,
    level: 0,
  };
  const ground = heightOf(baseExtents);
  const floors = layers.map<Floor>((l, i) => ({
    id: l.name,
    name: l.name,
    base: false,
    svgLayer: l.svgLayer,
    tilePath: l.tilePath,
    show: !!l.show,
    extents: l.extents!,
    order: i,
    level: levelOf(l.name, l.extents!, ground, i),
  }));
  return [base, ...floors].sort((a, b) => a.level - b.level);
}

function inBounds(p: Vec3, b: FloorBounds): boolean {
  const [[x1, z1], [x2, z2]] = b;
  return p.x >= Math.min(x1, x2) && p.x <= Math.max(x1, x2) && p.z >= Math.min(z1, z2) && p.z <= Math.max(z1, z2);
}

/** Is the position inside one of the floor's extents? Returns that extent, or null. */
function matchExtent(p: Vec3, f: Floor): FloorExtent | null {
  for (const e of f.extents) {
    if (p.y < e.height[0] || p.y >= e.height[1]) continue;
    if (!e.bounds || e.bounds.some((b) => inBounds(p, b))) return e;
  }
  return null;
}

/** Which floor a position is on: the first upper/lower floor that claims it, else the ground. */
export function floorOf(p: Vec3, floors: Floor[]): Floor | null {
  if (floors.length === 0) return null;
  let hit: Floor | null = null;
  for (const f of floors) if (!f.base && (!hit || f.order < hit.order) && matchExtent(p, f)) hit = f;
  return hit ?? floors.find((f) => f.base)!;
}

/**
 * Is a spot drawn at full strength while `active` is shown? Each spot belongs to one floor.
 * A floor that only covers some buildings (the Interchange mall, the Labs upper level) doesn't
 * hide the ground around them: ground spots outside its outlines stay at full strength.
 */
export function onActiveFloor(p: Vec3, floors: Floor[], active: Floor | null): boolean {
  if (!active || floors.length === 0) return true;
  const own = floorOf(p, floors)!;
  if (own.id === active.id) return true;
  if (!own.base || active.base) return false;
  const buildingsOnly = active.extents.every((e) => e.bounds?.length);
  return buildingsOnly && !active.extents.some((e) => e.bounds!.some((b) => inBounds(p, b)));
}

/** "Ground → Technical → Ground": the floors a route walks through, in order, without repeats in a row. */
export function floorSequence(points: Vec3[], floors: Floor[]): Floor[] {
  const out: Floor[] = [];
  for (const p of points) {
    const f = floorOf(p, floors);
    if (f && out[out.length - 1]?.id !== f.id) out.push(f);
  }
  return out;
}

/** The floor to show first: one drawn by default (Interchange mall), else the ground. */
export function defaultFloor(floors: Floor[]): Floor | null {
  return floors.find((f) => !f.base && f.show) ?? floors.find((f) => f.base) ?? null;
}
