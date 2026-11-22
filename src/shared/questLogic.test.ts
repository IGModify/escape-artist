import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { convertJsonFiles, type JsonFiles } from './jsonSource';
import { activeTasks, blackDivisionZones, isRareMap, groupSpots, killAreas, killCount, mapForPosition, playableMaps, objectiveItem, objectiveLocations, questStates, bringList, displayFor, extractsFor, isTransitTask, markerKind, nearestSpawn, objectivesForMap, playerSpawns, spawnLabel } from './questLogic';
import type { ApiMap, ApiObjective, ApiTask } from './tarkovTypes';
import { pos } from './testFixtures';

const item = (id: string, name: string, shortName = name) => ({ id, name, shortName });
const zone = (mapId: string, x: number, z: number) => ({ id: `z${x}`, map: { id: mapId }, position: { x, y: 0, z } });

const obj = (o: Partial<ApiObjective> & { type: string }): ApiObjective => ({
  id: `${o.type}-${Math.random()}`,
  description: o.type,
  optional: false,
  maps: [],
  ...o,
});

const task = (id: string, objectives: ApiObjective[], mapId?: string): ApiTask => ({
  id,
  name: `Task ${id}`,
  normalizedName: id,
  minPlayerLevel: 1,
  kappaRequired: false,
  wikiLink: null,
  factionName: null,
  trader: { name: 'Prapor', normalizedName: 'prapor', imageLink: null },
  map: mapId ? { id: mapId, normalizedName: mapId } : null,
  taskRequirements: [],
  objectives,
});

const customs = 'customs-id';
const markerObj = obj({ type: 'mark', markerItem: item('ms', 'MS2000 Marker', 'MS2000'), zones: [zone(customs, 10, 10)], maps: [{ id: customs, normalizedName: 'customs' }] });
const cameraObj = obj({ type: 'plantItem', items: [item('cam', 'WI-FI Camera', 'Camera')], count: 1, zones: [zone(customs, 20, 20)] });
const jammerObj = obj({ type: 'plantItem', items: [item('jam', 'Signal Jammer', 'Jammer')], count: 1, zones: [zone(customs, 30, 30)] });
const handIn = obj({ type: 'giveItem', items: [item('x', 'Salewa')], maps: [] });
const keyed = obj({ type: 'visit', zones: [zone(customs, 40, 40)], requiredKeys: [[item('k1', 'Dorm room 114 key', '114'), item('k2', 'Master key', 'Master')]] });
const otherMap = obj({ type: 'visit', zones: [zone('woods-id', 1, 1)], maps: [{ id: 'woods-id', normalizedName: 'woods' }] });
const extractObj = obj({ type: 'extract', exitName: 'ZB-1011' });

const tasks = [
  task('a', [markerObj, cameraObj, handIn]),
  task('b', [jammerObj, keyed, otherMap]),
  task('c', [extractObj], customs),
  task('d', [obj({ type: 'visit', zones: [zone(customs, 1, 1)] })]),
];

describe('quest selection', () => {
  it('uses log status with manual overrides on top', () => {
    const log = {
      a: { taskId: 'a', status: 'started' as const, time: '' },
      b: { taskId: 'b', status: 'finished' as const, time: '' },
      c: { taskId: 'c', status: 'started' as const, time: '' },
    };
    const ids = activeTasks(tasks, log, { b: true, c: false }).map((t) => t.id);
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('objectivesForMap', () => {
  const objs = objectivesForMap(tasks.slice(0, 3), customs);

  it('keeps only in-raid objectives on this map', () => {
    expect(objs.map((o) => o.objective.type).sort()).toEqual(['extract', 'mark', 'plantItem', 'plantItem', 'visit']);
  });

  it('assigns icons by what is being placed', () => {
    const kinds = Object.fromEntries(objs.map((o) => [o.objective.id, o.kind]));
    expect(kinds[markerObj.id]).toBe('marker');
    expect(kinds[cameraObj.id]).toBe('cctv');
    expect(kinds[jammerObj.id]).toBe('jammer');
    expect(markerKind(extractObj)).toBe('extract');
  });

  it('gives positions only from this map', () => {
    expect(objs.find((o) => o.objective.id === markerObj.id)!.locations).toEqual([{ x: 10, y: 0, z: 10 }]);
  });
});

describe('bringList', () => {
  it('lists items to place and keys, merging duplicates', () => {
    const list = bringList(objectivesForMap(tasks, customs));
    expect(list.map((e) => [e.kind, e.label, e.count])).toEqual([
      ['place', 'MS2000 Marker', 1],
      ['place', 'Signal Jammer', 1],
      ['place', 'WI-FI Camera', 1],
      ['key', '114 or Master', 1],
    ]);
  });

  it('sums counts for the same item across quests', () => {
    const t2 = task('e', [obj({ type: 'mark', markerItem: item('ms', 'MS2000 Marker'), zones: [zone(customs, 5, 5)] })]);
    const list = bringList(objectivesForMap([tasks[0]!, t2], customs));
    expect(list.find((e) => e.label === 'MS2000 Marker')!.count).toBe(2);
  });
});

describe('maps', () => {
  const map: ApiMap = {
    id: customs,
    name: 'Customs',
    normalizedName: 'customs',
    nameId: 'bigmap',
    spawns: [
      { zoneName: 'Big red', sides: ['Pmc'], categories: ['Player'], position: { x: 100, y: 0, z: 0 } },
      { zoneName: 'Scav only', sides: ['Savage'], categories: ['Player'], position: { x: 1, y: 0, z: 0 } },
      { zoneName: 'Bot', sides: ['All'], categories: ['Bot'], position: { x: 0, y: 0, z: 0 } },
    ],
    extracts: [
      { id: '1', name: 'ZB-1011', faction: 'pmc', position: { x: 0, y: 0, z: 0 } },
      { id: '2', name: 'Scav checkpoint', faction: 'scav', position: { x: 0, y: 0, z: 0 } },
      { id: '3', name: 'No position', faction: 'shared', position: null },
    ],
  };

  it('snaps to the nearest player spawn for your side', () => {
    expect(nearestSpawn(map, { x: 0, y: 0, z: 0 }, 'pmc')?.name).toBe('Big red');
    expect(spawnLabel('ZoneFactorySide')).toBe('Factory Side');
    expect(spawnLabel('0327c5d1-cc7f-432f-92dc-f95fb4719f1b')).toBeNull();
    expect(nearestSpawn(map, { x: 0, y: 0, z: 0 }, 'scav')?.name).toBe('Scav only');
  });

  it('filters extracts by faction and position', () => {
    expect(extractsFor(map, 'pmc').map((e) => e.name)).toEqual(['ZB-1011']);
  });

  it('finds the drawable map, including aliases', () => {
    const groups = [{ normalizedName: 'factory', maps: [{ key: 'f', projection: 'interactive', svgPath: 'x.svg', bounds: [[0, 0], [1, 1]] as [[number, number], [number, number]] }] }];
    expect(displayFor(groups, { ...map, normalizedName: 'night-factory' })?.key).toBe('f');
    expect(displayFor(groups, map)).toBeNull();
  });
});

describe('Terminal (bundled snapshot)', () => {
  const dir = 'build/snapshot/';
  const has = existsSync(`${dir}maps.json`);
  const read = (n: string) => JSON.parse(readFileSync(`${dir}${n}.json`, 'utf8'));
  it.skipIf(!has)('lists Terminal last, without the tutorial, and finds its Black Division zones', () => {
    const files = Object.fromEntries(['tasks', 'tasks_en', 'maps', 'maps_en', 'items_en', 'traders', 'traders_en'].map((n) => [n, read(n)])) as JsonFiles;
    const { maps } = convertJsonFiles(files);
    const list = playableMaps(maps, read('display'));
    expect(list.at(-1)?.normalizedName).toBe('terminal');
    expect(list.filter(isRareMap)).toHaveLength(1);
    expect(list.some((m) => m.normalizedName === 'ground-zero-tutorial')).toBe(false);
    expect(list.some((m) => m.normalizedName === 'ground-zero')).toBe(true);
    const zones = blackDivisionZones(list.at(-1)!);
    expect(zones.map((z) => z.zone).sort()).toEqual(['Zone1BD1HangarAmbush11', 'Zone1BD1PortAmbush1', 'Zone2BDPort28', 'Zone2BDPort30', 'Zone2BDPort31', 'Zone2BDPort32', 'Zone2BDWarehouse18']);
    expect(zones.reduce((n, z) => n + z.points.length, 0)).toBe(36);
    expect(zones.find((z) => z.zone === 'Zone1BD1HangarAmbush11')?.label).toBe('Hangar Ambush');
    expect(blackDivisionZones(maps.find((m) => m.normalizedName === 'customs')!)).toEqual([]);
  });
});

describe('playerSpawns', () => {
  const map = {
    id: 'm', name: 'M', normalizedName: 'm', nameId: 'm', extracts: [],
    spawns: [
      { zoneName: 'ZoneBigRed', sides: ['pmc'], categories: ['player'], position: { x: 1, y: 0, z: 1 } },
      { zoneName: 'ZoneScav', sides: ['scav'], categories: ['player', 'bot'], position: { x: 2, y: 0, z: 2 } },
      { zoneName: 'ZoneAll', sides: ['all'], categories: ['player'], position: { x: 3, y: 0, z: 3 } },
      { zoneName: 'ZoneBots', sides: ['all'], categories: ['bot'], position: { x: 4, y: 0, z: 4 } },
    ],
  };
  it('lists player spawns for your side with readable names', () => {
    expect(playerSpawns(map, 'pmc').map((s) => s.name)).toEqual(['Big Red', 'All']);
    expect(playerSpawns(map, 'scav').map((s) => s.name)).toEqual(['Scav', 'All']);
  });
});

describe('questStates (logs + quest graph)', () => {
  // Chain: a -> b -> c (each requires the previous complete); d requires c to be complete OR active.
  const req = (id: string, status: string[]) => ({ task: { id }, status });
  const chain = [
    { ...task('a', []), taskRequirements: [] },
    { ...task('b', []), taskRequirements: [req('a', ['complete'])] },
    { ...task('c', []), taskRequirements: [req('b', ['complete'])] },
    { ...task('d', []), taskRequirements: [req('c', ['complete', 'active'])] },
    { ...task('e', []), taskRequirements: [req('x', ['failed'])] },
    { ...task('x', []), taskRequirements: [] },
  ];
  const ev = (taskId: string, status: 'started' | 'finished' | 'failed') => ({ taskId, status, time: '2026-11-20T10:00:00.000' });

  it('closes the whole chain behind a quest seen in the logs', () => {
    const s = questStates(chain, { c: ev('c', 'started') }, {});
    expect(s.get('c')).toEqual({ active: true, closed: false, source: 'log' });
    expect(s.get('b')).toEqual({ active: false, closed: true, source: 'inferred' });
    expect(s.get('a')).toEqual({ active: false, closed: true, source: 'inferred' });
  });

  it('does not guess when the prerequisite may still be active', () => {
    const s = questStates(chain, { d: ev('d', 'started') }, {});
    expect(s.get('c')!.closed).toBe(false);
  });

  it('treats "failed" requirements as closed too', () => {
    expect(questStates(chain, { e: ev('e', 'started') }, {}).get('x')!.closed).toBe(true);
  });

  it('drops a logged "started" quest once a later quest proves it was finished', () => {
    // Logs saw b start, then (finish lost) c start: b must be done.
    const s = questStates(chain, { b: ev('b', 'started'), c: ev('c', 'started') }, {});
    expect(s.get('b')!.active).toBe(false);
    expect(activeTasks(chain, { b: ev('b', 'started'), c: ev('c', 'started') }, {}).map((t) => t.id)).toEqual(['c']);
  });

  it('manual ticks win and also close their prerequisites', () => {
    const s = questStates(chain, { c: ev('c', 'started') }, { c: false, b: true });
    expect(s.get('c')!.active).toBe(false);
    expect(s.get('b')).toMatchObject({ active: true, source: 'manual' });
    expect(questStates(chain, {}, { c: true }).get('a')!.closed).toBe(true);
  });
});

describe('transit quests', () => {
  const transit = obj({ type: 'extract', description: 'Use the transit from Woods to Reserve' });
  it('spots transit objectives and quests', () => {
    expect(markerKind(transit)).toBe('transit');
    expect(isTransitTask(task('t', [obj({ type: 'shoot' }), transit]))).toBe(true);
  });
  it('leaves normal extracts and objectives that only mention a transit alone', () => {
    expect(isTransitTask(task('e', [obj({ type: 'extract', description: 'Survive and extract from Woods' })]))).toBe(false);
    expect(isTransitTask(task('s', [obj({ type: 'plantQuestItem', description: 'Stash the case near the Woods transit on Reserve' })]))).toBe(false);
  });
});

describe('objectiveItem', () => {
  const ms = item('ms', 'MS2000 Marker');
  const key = item('k', 'Dorm room 314 key');
  it('picks the item the objective is about', () => {
    expect(objectiveItem(obj({ type: 'mark', markerItem: ms }))?.id).toBe('ms');
    expect(objectiveItem(obj({ type: 'plantItem', items: [item('j', 'Signal Jammer')] }))?.id).toBe('j');
    expect(objectiveItem(obj({ type: 'findQuestItem', questItem: item('q', 'Package') }))?.id).toBe('q');
    expect(objectiveItem(obj({ type: 'useItem', useAny: [item('f', 'Flare')] }))?.id).toBe('f');
  });
  it('falls back to a key needed to get there, else nothing', () => {
    expect(objectiveItem(obj({ type: 'visit', requiredKeys: [[null, key]] }))?.id).toBe('k');
    expect(objectiveItem(obj({ type: 'visit' }))).toBeNull();
  });
});

describe('objectiveLocations', () => {
  it('lists a spot the data repeats only once', () => {
    const o = obj({ type: 'mark', zones: [zone('m', 10, 20), zone('m', 10, 20), zone('m', 50, 20)] });
    expect(objectiveLocations(o, 'm')).toHaveLength(2);
  });
});

describe('groupSpots', () => {
  it('merges close spots into one place on its most central spot, keeps far ones apart', () => {
    // Six package spawns in one room, plus one in another building far away.
    const room = [pos(88, -142), pos(92, -161), pos(88, -147), pos(76, -152), pos(88, -163), pos(81, -153)];
    const places = groupSpots([...room, pos(400, 300)]);
    expect(places).toHaveLength(2);
    expect(places[0]!.spots).toHaveLength(6);
    expect(room).toContain(places[0]!.at);
    expect(places[1]!.spots).toEqual([pos(400, 300)]);
  });
  it('leaves a single spot alone', () => {
    expect(groupSpots([pos(1, 2)])).toEqual([{ at: pos(1, 2), spots: [pos(1, 2)] }]);
  });
});

describe('killAreas', () => {
  const area = (mapId: string) => ({
    id: 'killCam',
    map: { id: mapId },
    position: { x: 267, y: 8, z: -51 },
    outline: [{ x: 199, y: 0, z: -111 }, { x: 227, y: 0, z: 29 }, { x: 334, y: 0, z: 7 }, { x: 306, y: 0, z: -132 }],
    top: 17,
    bottom: -0.2,
  });
  it("returns a kill objective's areas on this map only", () => {
    const o = obj({ type: 'shoot', zones: [area('customs'), area('woods')] });
    expect(killAreas(o, 'customs')).toEqual([{ outline: area('customs').outline, top: 17, bottom: -0.2 }]);
    expect(killAreas(o, 'shoreline')).toEqual([]);
  });
  it('has nothing for map-wide kills or other objective types', () => {
    expect(killAreas(obj({ type: 'shoot' }), 'customs')).toEqual([]);
    expect(killAreas(obj({ type: 'visit', zones: [area('customs')] }), 'customs')).toEqual([]);
  });
});

describe('mapForPosition', () => {
  const maps = [
    { id: 'customs', name: 'Customs', normalizedName: 'customs', nameId: 'bigmap', spawns: [], extracts: [] },
    { id: 'woods', name: 'Woods', normalizedName: 'woods', nameId: 'woods', spawns: [], extracts: [] },
    { id: 'factory', name: 'Factory', normalizedName: 'factory', nameId: 'factory4_day', spawns: [], extracts: [] },
  ] as unknown as ApiMap[];
  const groups = [
    { normalizedName: 'customs', maps: [{ key: 'customs', projection: 'interactive', svgPath: 'c.svg', bounds: [[698, -307], [-372, 237]] }] },
    { normalizedName: 'woods', maps: [{ key: 'woods', projection: 'interactive', svgPath: 'w.svg', bounds: [[646, -914], [-761, 442]] }] },
    { normalizedName: 'factory', maps: [{ key: 'factory', projection: 'interactive', svgPath: 'f.svg', bounds: [[77, -64.5], [-65.5, 67.4]] }] },
  ] as never;
  const dorms = { x: 180, y: 3, z: 150 }; // inside both Customs' and Woods' coordinate ranges

  it("switches to the raid's map from the game log, even if another map is picked", () => {
    expect(mapForPosition(maps, groups, dorms, { raidMapId: 'customs', currentMapId: 'woods' })?.id).toBe('customs');
  });
  it('keeps the picked map when the log has no raid map and the position fits it', () => {
    expect(mapForPosition(maps, groups, dorms, { currentMapId: 'woods' })?.id).toBe('woods');
  });
  it('does not guess: null when neither the raid map nor the picked map fits', () => {
    expect(mapForPosition(maps, groups, dorms, { raidMapId: 'factory', currentMapId: 'factory' })).toBeNull();
    expect(mapForPosition(maps, groups, { x: 5000, y: 0, z: 5000 }, { raidMapId: 'customs' })).toBeNull();
  });
});

describe('killCount', () => {
  it('gives the kills a kill objective needs, nothing for other objectives', () => {
    expect(killCount(obj({ type: 'shoot', count: 15 }))).toBe(15);
    expect(killCount(obj({ type: 'shoot' }))).toBeNull();
    expect(killCount(obj({ type: 'findItem', count: 3 }))).toBeNull();
  });
});
