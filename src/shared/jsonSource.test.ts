import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertJsonFiles, JSON_FILES, type JsonFiles } from './jsonSource';
import { bringList, mapByNameId, objectivesForMap } from './questLogic';
import { CUSTOMS, pos, sample } from './testFixtures';

describe('convertJsonFiles', () => {
  const { tasks, maps } = convertJsonFiles(sample());
  const t0 = tasks.find((t) => t.id === 't0')!;

  it('resolves names, trader and map references', () => {
    expect(t0.name).toBe('Signal');
    expect(t0.trader.name).toBe('Mechanic');
    expect(t0.map).toEqual({ id: CUSTOMS, normalizedName: 'customs' });
    expect(t0.taskRequirements).toEqual([{ task: { id: 't1' }, status: ['complete'] }]);
  });

  it('resolves objective items, keys, zones and quest items', () => {
    const [mark, plant, find] = t0.objectives;
    expect(mark!.description).toBe('Mark the tanker');
    expect(mark!.markerItem).toMatchObject({ name: 'MS2000 Marker', iconLink: 'https://assets.tarkov.dev/ms2000-icon.webp' });
    expect(mark!.requiredKeys!.map((alts) => alts.map((k) => k!.shortName))).toEqual([['114', 'Master']]);
    expect(mark!.zones).toEqual([{ id: 'z', map: { id: CUSTOMS }, position: pos(10, 20) }]);
    expect(plant!.items![0]!.name).toBe('Signal Jammer');
    expect(find!.questItem!.name).toBe('Secure folder');
    expect(find!.possibleLocations![0]!.positions).toHaveLength(2);
  });

  it('resolves maps, extract names and drops spawns without position', () => {
    const customs = mapByNameId(maps, 'bigmap')!;
    expect(customs.name).toBe('Customs');
    expect(customs.spawns).toHaveLength(1);
    expect(customs.extracts!.map((e) => e.name)).toEqual(['ZB-1011', 'ex_nopos']);
  });

  it('feeds the quest logic end to end', () => {
    const objs = objectivesForMap([t0], CUSTOMS);
    expect(objs.map((o) => o.kind)).toEqual(['marker', 'jammer', 'pickup']);
    expect(bringList(objs).map((b) => `${b.count}x ${b.label}`)).toEqual(['1x MS2000 Marker', '2x Signal Jammer', '1x 114 or Master']);
  });

  it('rejects unexpected formats so the app can fall back', () => {
    expect(() => convertJsonFiles({ ...sample(), tasks: { tasks: {} } })).toThrow(/unexpected format/);
    expect(() => convertJsonFiles(sample(3))).toThrow(/suspiciously little/);
  });
});

// Optional check against real downloaded files: set TQO_JSON_DIR to a folder of <name>.json files.
const realDir = process.env.TQO_JSON_DIR;
describe.skipIf(!realDir || !existsSync(realDir))('convertJsonFiles on real json.tarkov.dev data', () => {
  it('converts every task and map', () => {
    const files = Object.fromEntries(JSON_FILES.map((n) => [n, JSON.parse(readFileSync(join(realDir!, `${n}.json`), 'utf8'))])) as JsonFiles;
    const { tasks, maps } = convertJsonFiles(files);
    const customs = mapByNameId(maps, 'bigmap')!;
    const objs = objectivesForMap(tasks, customs.id);
    console.log(`real data: ${tasks.length} tasks, ${maps.length} maps, ${objs.length} Customs objectives, ${objs.filter((o) => o.locations.length).length} with positions`);
    expect(tasks.every((t) => !t.name.endsWith(' name'))).toBe(true);
    expect(objs.some((o) => o.kind === 'marker' || o.kind === 'cctv' || o.kind === 'jammer')).toBe(true);
    expect(bringList(objs).every((b) => b.items.every((i) => !/^[0-9a-f]{24}$/.test(i.name)))).toBe(true);
  });
});

describe('trimRaw', () => {
  it('keeps everything the converter needs', async () => {
    const { trimRaw } = await import('./trimRaw');
    const files = sample() as Record<string, unknown>;
    const trimmed = Object.fromEntries(Object.entries(files).map(([n, b]) => [n, trimRaw(n, b)])) as JsonFiles;
    expect(convertJsonFiles(trimmed)).toEqual(convertJsonFiles(files as JsonFiles));
    // Idempotent: trimming a trimmed file changes nothing.
    expect(trimRaw('tasks', trimRaw('tasks', files.tasks))).toEqual(trimRaw('tasks', files.tasks));
  });
});

describe('trimRaw kill zones', () => {
  it('keeps the outline and heights of kill zones only', async () => {
    const { trimRaw } = await import('./trimRaw');
    const zone = { id: 'z', map: 'm', position: { x: 1, y: 2, z: 3 }, outline: [{ x: 1.234, y: 0, z: 1 }, { x: 2, y: 0, z: 2 }, { x: 3, y: 0, z: 1 }], top: 17.41, bottom: -0.2, name: 'killCam', size: 9 };
    const raw = { data: { tasks: { t: { id: 't', objectives: [{ type: 'shoot', zones: [zone] }, { type: 'visit', zones: [zone] }] } } } };
    const out = trimRaw('tasks', raw) as { data: { tasks: { t: { objectives: { zones: Record<string, unknown>[] }[] } } } };
    const [shoot, visit] = out.data.tasks.t.objectives;
    expect(shoot!.zones[0]).toEqual({ id: 'z', map: 'm', position: zone.position, outline: [{ x: 1.2, y: 0, z: 1 }, { x: 2, y: 0, z: 2 }, { x: 3, y: 0, z: 1 }], top: 17.4, bottom: -0.2 });
    expect(visit!.zones[0]).toEqual({ id: 'z', map: 'm', position: zone.position });
  });
});
