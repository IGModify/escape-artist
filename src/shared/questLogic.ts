import type { ApiItem, ApiMap, ApiObjective, ApiTask, MapDisplay, MapDisplayGroup } from './tarkovTypes';
import type { QuestEvent, Vec3 } from './types';

export type MarkerKind =
  | 'marker' // MS2000 / radio markers
  | 'cctv' // WI-FI cameras
  | 'jammer' // signal jammers
  | 'plant' // other items to place
  | 'visit'
  | 'pickup' // find quest item / item at a spot
  | 'shoot'
  | 'use'
  | 'extract'
  | 'transit' // use a transit to another map
  | 'other';

export const MARKER_LABEL: Record<MarkerKind, string> = {
  marker: 'Place marker',
  cctv: 'Place camera',
  jammer: 'Place jammer',
  plant: 'Plant / stash item',
  visit: 'Visit / locate',
  pickup: 'Pick up item',
  shoot: 'Kill zone',
  use: 'Use item',
  extract: 'Extract (quest)',
  transit: 'Use transit',
  other: 'Objective',
};

function kindFromItemName(name: string): MarkerKind | null {
  const n = name.toLowerCase();
  if (n.includes('camera')) return 'cctv';
  if (n.includes('jammer')) return 'jammer';
  if (n.includes('marker') || n.includes('ms2000')) return 'marker';
  return null;
}

/** "Use the transit from Woods to Reserve": transits are extract objectives in the data. */
const TRANSIT = /\btransit\b/i;

/** A quest that needs you to take a transit between maps. */
export function isTransitTask(t: ApiTask): boolean {
  return t.objectives.some((o) => o.type === 'extract' && TRANSIT.test(o.description));
}

/** How many kills a kill objective needs (the descriptions never say), or null. */
export function killCount(o: ApiObjective): number | null {
  return o.type === 'shoot' && typeof o.count === 'number' && o.count > 0 ? o.count : null;
}

/**
 * The item an objective is about, to show on its marker: what to place (marker, camera, jammer,
 * stash item), pick up, use, or shoot with. Falls back to the first key needed to get there.
 */
export function objectiveItem(o: ApiObjective): ApiItem | null {
  const main =
    o.type === 'mark' ? o.markerItem
    : o.type === 'plantItem' || o.type === 'findItem' ? o.items?.[0]
    : o.type === 'plantQuestItem' || o.type === 'findQuestItem' ? o.questItem
    : o.type === 'useItem' ? o.useAny?.[0]
    : o.type === 'shoot' ? o.usingWeapon?.[0]
    : null;
  return main ?? o.requiredKeys?.flat().find((k): k is ApiItem => !!k) ?? null;
}

export function markerKind(o: ApiObjective): MarkerKind {
  switch (o.type) {
    case 'mark':
      return kindFromItemName(o.markerItem?.name ?? '') ?? 'marker';
    case 'plantItem':
      return kindFromItemName(o.items?.[0]?.name ?? '') ?? 'plant';
    case 'plantQuestItem':
      return kindFromItemName(o.questItem?.name ?? '') ?? 'plant';
    case 'visit':
      return 'visit';
    case 'findQuestItem':
    case 'findItem':
      return 'pickup';
    case 'shoot':
      return 'shoot';
    case 'useItem':
      return 'use';
    case 'extract':
      return TRANSIT.test(o.description) ? 'transit' : 'extract';
    default:
      return 'other';
  }
}

// ---------- quest state ----------

export type QuestSource = 'manual' | 'log' | 'inferred';
export interface QuestInfo {
  active: boolean;
  /** Finished or failed: known from the logs, or inferred from a later quest. */
  closed: boolean;
  source: QuestSource | null;
}

/**
 * Works out which quests you're on from the game logs plus the quest graph.
 *
 * The logs say exactly when a quest was started, finished or failed, but only as far back
 * as the log folders still on disk. The graph fills the gap: if you've reached quest X
 * (started, finished or failed it), every prerequisite X requires to be *completed or failed*
 * must be closed, and so on down the chain. Requirements that allow the prerequisite to
 * still be active are never used, so nothing is guessed. Manual ticks always win.
 */
export function questStates(
  tasks: ApiTask[],
  log: Record<string, QuestEvent>,
  manual: Record<string, boolean>,
): Map<string, QuestInfo> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const inferred = new Set<string>();
  const close = (task: ApiTask | undefined) => {
    for (const r of task?.taskRequirements ?? []) {
      const id = r.task?.id;
      const closes = r.status.length > 0 && r.status.every((s) => s === 'complete' || s === 'failed');
      if (!id || !closes || inferred.has(id)) continue;
      inferred.add(id);
      close(byId.get(id)); // reaching a quest means its own prerequisites were met too
    }
  };
  for (const id of Object.keys(log)) close(byId.get(id));
  for (const [id, on] of Object.entries(manual)) if (on) close(byId.get(id));

  const out = new Map<string, QuestInfo>();
  for (const t of tasks) {
    const ev = log[t.id];
    const loggedClosed = ev?.status === 'finished' || ev?.status === 'failed';
    const closed = loggedClosed || inferred.has(t.id);
    if (t.id in manual) {
      out.set(t.id, { active: manual[t.id]!, closed, source: 'manual' });
    } else if (ev) {
      // "started" in the logs but required as done by a quest you reached later: it's done.
      out.set(t.id, { active: ev.status === 'started' && !inferred.has(t.id), closed, source: 'log' });
    } else {
      out.set(t.id, { active: false, closed, source: closed ? 'inferred' : null });
    }
  }
  return out;
}

export function activeTasks(tasks: ApiTask[], log: Record<string, QuestEvent>, manual: Record<string, boolean>): ApiTask[] {
  const states = questStates(tasks, log, manual);
  return tasks.filter((t) => states.get(t.id)?.active);
}

// ---------- per-map view ----------

/** Positions on `mapId` where an objective can be done. Empty if the data has none. */
export function objectiveLocations(o: ApiObjective, mapId: string): Vec3[] {
  const out: Vec3[] = [];
  for (const z of o.zones ?? []) if (z.map?.id === mapId && z.position) out.push(z.position);
  for (const l of o.possibleLocations ?? []) if (l.map?.id === mapId) out.push(...(l.positions ?? []));
  // The data sometimes lists the same spot twice (e.g. two zones at one vehicle): keep one.
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = `${Math.round(p.x * 2)},${Math.round(p.y * 2)},${Math.round(p.z * 2)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function objectiveOnMap(o: ApiObjective, task: ApiTask, mapId: string): boolean {
  if (o.maps.some((m) => m.id === mapId)) return true;
  if (objectiveLocations(o, mapId).length > 0) return true;
  // Objectives with no map listed belong to the task's map, if it has one (e.g. "extract").
  return o.maps.length === 0 && task.map?.id === mapId && IN_RAID_TYPES.has(o.type);
}

/** Objective types that happen inside a raid (hand-ins, skills, levels don't). */
const IN_RAID_TYPES = new Set([
  'visit', 'mark', 'plantItem', 'plantQuestItem', 'findQuestItem', 'findItem', 'shoot', 'extract', 'useItem', 'experience',
]);

export interface MapObjective {
  task: ApiTask;
  objective: ApiObjective;
  kind: MarkerKind;
  /** One point per place to go (route stops, markers). Close-together spots share one. */
  locations: Vec3[];
  /** For each location, every exact spot it stands for (e.g. 6 possible spawns in one room). */
  spots: Vec3[][];
  /** Kill zones: the areas on this map to get the kills in (empty for map-wide kills). */
  areas: KillArea[];
}

export interface KillArea {
  /** Corners in game coordinates. */
  outline: Vec3[];
  top: number | null;
  bottom: number | null;
}

/** The areas a kill objective must be done in, on this map (most kill objectives have none: map-wide). */
export function killAreas(o: ApiObjective, mapId: string): KillArea[] {
  if (o.type !== 'shoot') return [];
  return (o.zones ?? [])
    .filter((z) => z.map?.id === mapId && (z.outline?.length ?? 0) >= 3)
    .map((z) => ({ outline: z.outline!, top: z.top ?? null, bottom: z.bottom ?? null }));
}

/** Possible spots of one objective closer than this (m, horizontal) count as one place. */
export const SPOT_GROUP_RADIUS = 40;

/**
 * Groups an objective's possible spots into places: spots within `radius` of each other (chained)
 * form one place, represented by its most central spot so the marker sits inside the building.
 */
export function groupSpots(points: Vec3[], radius = SPOT_GROUP_RADIUS): { at: Vec3; spots: Vec3[] }[] {
  const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
  const group = points.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i]!)));
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) if (flat(points[i]!, points[j]!) < radius) group[root(i)] = root(j);
  const byRoot = new Map<number, Vec3[]>();
  points.forEach((p, i) => byRoot.set(root(i), [...(byRoot.get(root(i)) ?? []), p]));
  return [...byRoot.values()].map((spots) => {
    // Medoid: the spot with the smallest total distance to the others.
    let at = spots[0]!;
    let best = Infinity;
    for (const a of spots) {
      const d = spots.reduce((sum, b) => sum + flat(a, b), 0);
      if (d < best) [best, at] = [d, a];
    }
    return { at, spots };
  });
}

export function objectivesForMap(tasks: ApiTask[], mapId: string): MapObjective[] {
  const out: MapObjective[] = [];
  for (const task of tasks) {
    for (const objective of task.objectives) {
      if (!IN_RAID_TYPES.has(objective.type)) continue;
      if (!objectiveOnMap(objective, task, mapId)) continue;
      const places = groupSpots(objectiveLocations(objective, mapId));
      out.push({
        task,
        objective,
        kind: markerKind(objective),
        locations: places.map((g) => g.at),
        spots: places.map((g) => g.spots),
        areas: killAreas(objective, mapId),
      });
    }
  }
  return out;
}

// ---------- what to bring ----------

export interface BringEntry {
  key: string;
  label: string;
  /** Interchangeable items — any one of them works. */
  items: ApiItem[];
  count: number;
  reason: string;
  kind: 'place' | 'key' | 'use' | 'weapon';
}

export function bringList(objectives: MapObjective[]): BringEntry[] {
  const byKey = new Map<string, BringEntry>();
  const add = (e: BringEntry) => {
    const prev = byKey.get(e.key);
    if (prev) {
      prev.count += e.kind === 'key' ? 0 : e.count;
      if (!prev.reason.includes(e.reason)) prev.reason += `; ${e.reason}`;
    } else byKey.set(e.key, { ...e, items: [...e.items] });
  };
  for (const { task, objective: o } of objectives) {
    if (o.optional) continue;
    const why = task.name;
    if (o.type === 'mark' && o.markerItem) {
      add({ key: `place:${o.markerItem.id}`, label: o.markerItem.name, items: [o.markerItem], count: 1, reason: why, kind: 'place' });
    }
    if (o.type === 'plantItem' && o.items?.length) {
      const items = o.items;
      add({ key: `place:${items.map((i) => i.id).sort().join('|')}`, label: items[0]!.name, items, count: o.count ?? 1, reason: why, kind: 'place' });
    }
    if (o.type === 'plantQuestItem' && o.questItem) {
      add({ key: `place:${o.questItem.id}`, label: `${o.questItem.name} (quest item, in your stash)`, items: [o.questItem], count: o.count ?? 1, reason: why, kind: 'place' });
    }
    if (o.type === 'useItem' && o.useAny?.length) {
      add({ key: `use:${o.useAny.map((i) => i.id).sort().join('|')}`, label: o.useAny.map((i) => i.shortName).join(' / '), items: o.useAny, count: 1, reason: why, kind: 'use' });
    }
    if (o.type === 'shoot' && o.usingWeapon?.length) {
      add({ key: `weapon:${o.usingWeapon.map((i) => i.id).sort().join('|')}`, label: o.usingWeapon.map((i) => i.shortName).join(' / '), items: o.usingWeapon, count: 1, reason: why, kind: 'weapon' });
    }
    for (const alternatives of o.requiredKeys ?? []) {
      const keys = alternatives.filter((k): k is ApiItem => !!k);
      if (!keys.length) continue;
      add({ key: `key:${keys.map((k) => k.id).sort().join('|')}`, label: keys.map((k) => k.shortName).join(' or '), items: keys, count: 1, reason: why, kind: 'key' });
    }
  }
  const order = { place: 0, key: 1, use: 2, weapon: 3 } as const;
  return [...byKey.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
}

// ---------- maps ----------

const DISPLAY_ALIASES: Record<string, string> = {
  'night-factory': 'factory',
  'ground-zero-21': 'ground-zero',
  'ground-zero-tutorial': 'ground-zero',
};

export function displayFor(groups: MapDisplayGroup[], map: ApiMap): MapDisplay | null {
  const name = map.normalizedName;
  const group = groups.find((g) => g.normalizedName === name) ?? groups.find((g) => g.normalizedName === DISPLAY_ALIASES[name]);
  if (!group) return null;
  return group.maps.find((m) => m.projection === 'interactive' && (m.svgPath || m.tilePath)) ?? null;
}

/** Map EFT's internal location id (e.g. "bigmap") to the API map. Case-insensitive. */
export function mapByNameId(maps: ApiMap[], nameId: string): ApiMap | null {
  const id = nameId.toLowerCase();
  return maps.find((m) => m.nameId?.toLowerCase() === id) ?? null;
}

/** Is a game position inside a map drawing's bounds (`[[x, z], [x, z]]`), with a little margin? */
function insideDisplay(d: MapDisplay, p: Vec3): boolean {
  const [[x1, z1], [x2, z2]] = d.bounds;
  const mx = Math.abs(x2 - x1) * 0.05;
  const mz = Math.abs(z2 - z1) * 0.05;
  return p.x >= Math.min(x1, x2) - mx && p.x <= Math.max(x1, x2) + mx && p.z >= Math.min(z1, z2) - mz && p.z <= Math.max(z1, z2) + mz;
}

/**
 * Which map to show for a screenshot position. The file name has coordinates but not the map,
 * and map coordinate ranges overlap (guessing from nearby spawns is right only ~half the time),
 * so the map the game log says the raid is on decides, when the position fits it. Otherwise the
 * map already shown stays. Returns null when neither fits (the screen then says so).
 */
export function mapForPosition(
  maps: ApiMap[],
  groups: MapDisplayGroup[],
  p: Vec3,
  opts: { raidMapId?: string | null; currentMapId?: string | null } = {},
): ApiMap | null {
  const fits = (id: string | null | undefined) => {
    const m = id ? maps.find((x) => x.id === id) : undefined;
    const d = m ? displayFor(groups, m) : null;
    return m && d && insideDisplay(d, p) ? m : null;
  };
  return fits(opts.raidMapId) ?? fits(opts.currentMapId);
}

/** Maps worth showing in the picker: ones we can draw. */
/** Maps nobody raids for quests: kept out of the map list. */
const HIDDEN_MAPS = new Set(['ground-zero-tutorial']);
/** Maps played rarely (the story's end): listed last, after a divider. */
const RARE_MAPS = new Set(['terminal']);
export const isRareMap = (m: ApiMap) => RARE_MAPS.has(m.normalizedName);

export function playableMaps(maps: ApiMap[], groups: MapDisplayGroup[]): ApiMap[] {
  return maps
    .filter((m) => !HIDDEN_MAPS.has(m.normalizedName) && displayFor(groups, m))
    .sort((a, b) => Number(isRareMap(a)) - Number(isRareMap(b)) || a.name.localeCompare(b.name));
}

/** "ZoneFactorySide" -> "Factory Side"; internal ids (GUIDs) -> null. */
export function spawnLabel(zoneName: string | null): string | null {
  if (!zoneName || /^[0-9a-f-]{16,}$/i.test(zoneName)) return null;
  const label = zoneName
    .replace(/^Zone_?/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return label || null;
}

export function nearestSpawn(map: ApiMap, p: Vec3, faction: 'pmc' | 'scav'): { name: string | null; distance: number } | null {
  let best: { name: string | null; distance: number } | null = null;
  for (const s of map.spawns ?? []) {
    const sides = (s.sides ?? []).map((x) => x.toLowerCase());
    if (sides.length && !sides.includes('all') && !sides.includes(faction === 'pmc' ? 'pmc' : 'savage') && !sides.includes(faction)) continue;
    if (s.categories && !s.categories.map((c) => c.toLowerCase()).includes('player')) continue;
    const d = Math.hypot(s.position.x - p.x, s.position.z - p.z);
    if (!best || d < best.distance) best = { name: spawnLabel(s.zoneName), distance: d };
  }
  return best;
}

/** Where players of your side can spawn on this map (bot-only spawns excluded). */
export function playerSpawns(map: ApiMap, faction: 'pmc' | 'scav'): { name: string | null; position: Vec3 }[] {
  const side = faction === 'pmc' ? 'pmc' : 'savage';
  return (map.spawns ?? [])
    .filter((s) => {
      const sides = (s.sides ?? []).map((x) => x.toLowerCase());
      const cats = (s.categories ?? []).map((c) => c.toLowerCase());
      const forSide = sides.includes('all') || sides.includes(side) || sides.includes(faction);
      return forSide && (cats.length === 0 || cats.includes('player'));
    })
    .map((s) => ({ name: spawnLabel(s.zoneName), position: s.position }));
}

/** A Black Division bot zone: where a squad can appear, and every point it may spawn at. */
export interface BotZone {
  zone: string;
  label: string;
  /** The point closest to all the others (where the zone's marker goes). */
  at: Vec3;
  points: Vec3[];
}

/** Black Division zones are named like "Zone1BD1PortAmbush1" or "Zone2BDWarehouse18". */
const BD_ZONE = /^Zone\d*BD\d*([A-Za-z]+?)\d*$/;

/** Black Division spawn zones on a map (Terminal); empty on maps without them. */
export function blackDivisionZones(map: ApiMap): BotZone[] {
  const byZone = new Map<string, Vec3[]>();
  for (const s of map.spawns ?? []) {
    if (!s.zoneName || !BD_ZONE.test(s.zoneName)) continue;
    byZone.set(s.zoneName, [...(byZone.get(s.zoneName) ?? []), s.position]);
  }
  const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
  return [...byZone].map(([zone, points]) => {
    let at = points[0]!;
    let best = Infinity;
    for (const a of points) {
      const total = points.reduce((sum, b) => sum + flat(a, b), 0);
      if (total < best) [best, at] = [total, a];
    }
    return { zone, label: zone.replace(BD_ZONE, '$1').replace(/([a-z])([A-Z])/g, '$1 $2'), at, points };
  });
}

export function extractsFor(map: ApiMap, faction: 'pmc' | 'scav') {
  return (map.extracts ?? []).filter(
    (e) => e.position && (!e.faction || e.faction === 'shared' || e.faction === faction),
  ) as { id: string; name: string | null; faction: string | null; position: Vec3 }[];
}
