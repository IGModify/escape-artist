// Converts tarkov.dev's static JSON files (https://json.tarkov.dev/regular/<name>), the data
// the tarkov.dev website itself loads, into the same shapes the GraphQL API returns.
// Those files reference things by id and keep text in separate "_en" dictionaries.
import type { ApiItem, ApiMap, ApiObjective, ApiTask } from './tarkovTypes';
import type { Vec3 } from './types';
import jsonFileList from './jsonFiles.json';

export const JSON_BASE_URL = 'https://json.tarkov.dev/regular/';
export const JSON_FILES = jsonFileList as readonly JsonFileName[];
export type JsonFileName = 'tasks' | 'tasks_en' | 'maps' | 'maps_en' | 'items_en' | 'traders' | 'traders_en';
export type JsonFiles = Record<JsonFileName, unknown>;

type Dict = Record<string, string>;
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function dataOf(file: unknown, name: string): Raw {
  const d = (file as { data?: unknown })?.data;
  if (!d || typeof d !== 'object') throw new Error(`json.tarkov.dev "${name}" has an unexpected format`);
  return d as Raw;
}

function vec(p: unknown): Vec3 | null {
  const v = p as Partial<Vec3> | null;
  return v && typeof v.x === 'number' && typeof v.z === 'number' ? { x: v.x, y: v.y ?? 0, z: v.z } : null;
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function convertJsonFiles(files: JsonFiles): { tasks: ApiTask[]; maps: ApiMap[] } {
  const T = dataOf(files.tasks, 'tasks');
  const tasksEn = dataOf(files.tasks_en, 'tasks_en') as Dict;
  const M = dataOf(files.maps, 'maps');
  const mapsEn = dataOf(files.maps_en, 'maps_en') as Dict;
  const itemsEn = dataOf(files.items_en, 'items_en') as Dict;
  const traders = dataOf(files.traders, 'traders');
  const tradersEn = dataOf(files.traders_en, 'traders_en') as Dict;
  if (!T.tasks || !M.maps) throw new Error('json.tarkov.dev tasks/maps are missing');

  const questItems: Raw = T.questItems ?? {};
  const item = (id: string): ApiItem => {
    const q = questItems[id];
    if (q) {
      return { id, name: tasksEn[q.name] ?? id, shortName: tasksEn[q.shortName] ?? tasksEn[q.name] ?? id, iconLink: q.iconLink ?? null };
    }
    return {
      id,
      name: itemsEn[`${id} Name`] ?? id,
      shortName: itemsEn[`${id} ShortName`] ?? itemsEn[`${id} Name`] ?? id,
      iconLink: `https://assets.tarkov.dev/${id}-icon.webp`,
    };
  };
  const items = (v: unknown) => ids(v).map(item);

  const mapRaw: Raw = M.maps;
  const mapRef = (id: string) => ({ id, normalizedName: mapRaw[id]?.normalizedName ?? id });

  const maps: ApiMap[] = Object.values(mapRaw).map((m: Raw) => ({
    id: m.id,
    name: mapsEn[m.name] ?? m.name,
    normalizedName: m.normalizedName,
    nameId: m.nameId ?? null,
    spawns: (m.spawns ?? [])
      .map((s: Raw) => ({ zoneName: s.zoneName ?? null, sides: s.sides ?? null, categories: s.categories ?? null, position: vec(s.position) }))
      .filter((s: { position: Vec3 | null }) => s.position),
    extracts: (m.extracts ?? []).map((e: Raw) => ({
      id: e.id,
      name: mapsEn[e.name] ?? e.name ?? null,
      faction: e.faction ?? null,
      position: vec(e.position),
    })),
  }));

  const objective = (o: Raw): ApiObjective => {
    const out: ApiObjective = {
      id: o.id,
      type: o.type,
      description: tasksEn[o.description] ?? o.description ?? '',
      optional: !!o.optional,
      maps: ids(o.maps).map(mapRef),
    };
    if (Array.isArray(o.zones)) {
      out.zones = o.zones.map((z: Raw) => ({
        id: z.id,
        map: typeof z.map === 'string' ? { id: z.map } : null,
        position: vec(z.position),
        ...(Array.isArray(z.outline) && z.outline.length >= 3
          ? { outline: z.outline.map(vec).filter((p: Vec3 | null): p is Vec3 => !!p), top: typeof z.top === 'number' ? z.top : null, bottom: typeof z.bottom === 'number' ? z.bottom : null }
          : {}),
      }));
    }
    if (Array.isArray(o.requiredKeys)) out.requiredKeys = o.requiredKeys.map((alts: unknown) => items(alts));
    if (typeof o.markerItem === 'string') out.markerItem = item(o.markerItem);
    if (Array.isArray(o.items)) out.items = items(o.items);
    if (typeof o.questItem === 'string') out.questItem = item(o.questItem);
    if (Array.isArray(o.useAny)) out.useAny = items(o.useAny);
    if (Array.isArray(o.usingWeapon)) out.usingWeapon = items(o.usingWeapon);
    if (typeof o.count === 'number') out.count = o.count;
    if (typeof o.foundInRaid === 'boolean') out.foundInRaid = o.foundInRaid;
    if (Array.isArray(o.targetNames)) out.targetNames = o.targetNames;
    if (Array.isArray(o.zoneNames)) out.zoneNames = o.zoneNames;
    if ('exitName' in o) out.exitName = o.exitName ?? null;
    if (Array.isArray(o.possibleLocations)) {
      out.possibleLocations = o.possibleLocations.map((l: Raw) => ({
        map: typeof l.map === 'string' ? { id: l.map } : null,
        positions: Array.isArray(l.positions) ? l.positions.map(vec).filter((p: Vec3 | null): p is Vec3 => !!p) : null,
      }));
    }
    return out;
  };

  const tasks: ApiTask[] = Object.values(T.tasks as Raw).map((t: Raw) => {
    const trader: Raw = traders[t.trader] ?? {};
    return {
      id: t.id,
      name: tasksEn[t.name] ?? t.name,
      normalizedName: t.normalizedName,
      minPlayerLevel: t.minPlayerLevel ?? null,
      kappaRequired: t.kappaRequired ?? null,
      wikiLink: t.wikiLink ?? null,
      factionName: t.factionName ?? null,
      trader: { name: tradersEn[trader.name] ?? trader.normalizedName ?? 'Unknown', normalizedName: trader.normalizedName ?? '', imageLink: trader.imageLink ?? null },
      map: typeof t.map === 'string' ? mapRef(t.map) : null,
      taskRequirements: (t.taskRequirements ?? []).map((r: Raw) => ({ task: typeof r.task === 'string' ? { id: r.task } : null, status: r.status ?? [] })),
      objectives: (t.objectives ?? []).map(objective),
    };
  });

  if (tasks.length < 50 || maps.length < 5) {
    throw new Error(`json.tarkov.dev returned suspiciously little data (${tasks.length} tasks, ${maps.length} maps)`);
  }
  return { tasks, maps };
}
