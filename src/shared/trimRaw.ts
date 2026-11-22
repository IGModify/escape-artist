// Shrinks raw json.tarkov.dev files to just the fields the app reads, before they are saved
// or held in memory. Cuts ~15 MB of JSON to ~3 MB (maps.json alone carries ~6 MB of loot/mob data).
// No imports and no TS-only runtime syntax: scripts/snapshot.mjs runs this file directly with Node.

type Obj = Record<string, unknown>;

const pick = (o: Obj, keys: string[]): Obj => {
  const out: Obj = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
};

const MAP_KEYS = ['id', 'name', 'normalizedName', 'nameId', 'spawns', 'extracts'];
const EXTRACT_KEYS = ['id', 'name', 'faction', 'position'];
const TASK_KEYS = ['id', 'name', 'normalizedName', 'trader', 'wikiLink', 'minPlayerLevel', 'taskRequirements', 'objectives', 'factionName', 'kappaRequired', 'map'];
const QUEST_ITEM_KEYS = ['id', 'name', 'shortName', 'iconLink'];

/**
 * Bump whenever the trimming keeps different fields: saved copies made under older rules are then
 * downloaded again in full (their ETags would otherwise say "unchanged" forever).
 */
export const TRIM_FORMAT = 3;

const r1 = (n: unknown) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);

/**
 * Zones: positions are all most objectives need. Kill zones also keep their outline (a few
 * corners) and floor/ceiling heights, so the area can be drawn on the map.
 */
function trimObjective(o: Obj): Obj {
  const out = { ...o };
  if (Array.isArray(o.zones)) {
    const area = o.type === 'shoot';
    out.zones = (o.zones as Obj[]).map((z) => {
      const keep: Obj = { id: z.id, map: z.map, position: z.position };
      if (area && Array.isArray(z.outline) && z.outline.length >= 3) {
        keep.outline = (z.outline as Obj[]).map((p) => ({ x: r1(p.x), y: r1(p.y), z: r1(p.z) }));
        keep.top = r1(z.top);
        keep.bottom = r1(z.bottom);
      }
      return keep;
    });
  }
  return out;
}

export function trimRaw(name: string, body: unknown): unknown {
  const data = (body as { data?: Obj } | null)?.data;
  if (!data || typeof data !== 'object') return body; // unknown shape: leave it for the converter to reject
  const map = (o: unknown, f: (v: Obj) => Obj) =>
    Object.fromEntries(Object.entries((o ?? {}) as Record<string, Obj>).map(([k, v]) => [k, f(v)]));

  switch (name) {
    case 'maps':
      return {
        data: {
          maps: map(data.maps, (m) => ({
            ...pick(m, MAP_KEYS),
            extracts: Array.isArray(m.extracts) ? (m.extracts as Obj[]).map((e) => pick(e, EXTRACT_KEYS)) : m.extracts,
            // Boss/squad groups: only who, where and how many (for Black Division squad sizes).
            bosses: Array.isArray(m.bosses)
              ? (m.bosses as Obj[]).map((b) => ({
                  mob: b.mob,
                  spawnLocations: Array.isArray(b.spawnLocations) ? (b.spawnLocations as Obj[]).map((l) => ({ spawnKey: l.spawnKey })) : [],
                  escorts: Array.isArray(b.escorts) ? (b.escorts as Obj[]).map((e) => ({ mob: e.mob, amount: e.amount })) : [],
                }))
              : undefined,
          })),
        },
      };
    case 'tasks':
      return {
        data: {
          tasks: map(data.tasks, (t) => ({
            ...pick(t, TASK_KEYS),
            objectives: Array.isArray(t.objectives) ? (t.objectives as Obj[]).map(trimObjective) : t.objectives,
          })),
          questItems: map(data.questItems, (q) => pick(q, QUEST_ITEM_KEYS)),
        },
      };
    case 'items_en':
      // Only item names are used; descriptions and armor-zone labels are dropped.
      return { data: Object.fromEntries(Object.entries(data).filter(([k]) => / (Name|ShortName)$/.test(k))) };
    case 'traders':
      return { data: map(data, (t) => pick(t, ['id', 'name', 'normalizedName', 'imageLink'])) };
    default:
      return body;
  }
}
