import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { defaultFloor, floorOf, floorSequence, floorsFor, onActiveFloor, type Floor } from './floors';
import type { MapDisplay } from './tarkovTypes';

const p = (x: number, y: number, z: number) => ({ x, y, z });

// Shaped like tarkov.dev's Labs entry: a bounded upper level and an open-ended basement.
const labs: MapDisplay = {
  key: 'the-lab',
  projection: 'interactive',
  bounds: [[0, 0], [1, 1]],
  tilePath: 'base/{z}/{x}/{y}.png',
  heightRange: [-0.9, 3],
  layers: [
    { name: 'Second Level', tilePath: '2nd/{z}/{x}/{y}.png', extents: [{ height: [3, 10000], bounds: [[[-101, -422], [-271, -270]]] }] },
    { name: 'Technical', tilePath: 'tech/{z}/{x}/{y}.png', extents: [{ height: [-10000, -0.9] }] },
  ],
};

describe('floors', () => {
  const floors = floorsFor(labs);
  const [tech, first, second] = floors as [Floor, Floor, Floor];

  it('lists floors bottom to top, naming the base after the map', () => {
    expect(floors.map((f) => f.name)).toEqual(['Technical', 'First Level', 'Second Level']);
    expect(first.base).toBe(true);
  });

  it('puts positions on the right floor by height and building outline', () => {
    expect(floorOf(p(-200, 1, -300), floors)?.id).toBe(first.id);
    expect(floorOf(p(-200, 5, -300), floors)?.id).toBe(second.id);
    // Above the ground's range but outside the 2nd level's outline: still the ground floor.
    expect(floorOf(p(0, 5, 0), floors)?.id).toBe(first.id);
    expect(floorOf(p(-200, -4, -300), floors)?.id).toBe(tech.id);
  });

  it('shows each spot at full strength on its own floor', () => {
    expect(onActiveFloor(p(-200, 5, -300), floors, second)).toBe(true);
    expect(onActiveFloor(p(-200, 5, -300), floors, first)).toBe(false);
    expect(onActiveFloor(p(-200, -4, -300), floors, first)).toBe(false);
    expect(onActiveFloor(p(-200, 5, -300), [], null)).toBe(true);
  });

  it("keeps ground spots outside a building-only floor's outline at full strength", () => {
    // The Second Level only covers one building: spots on the ground elsewhere stay readable…
    expect(onActiveFloor(p(0, 1, 0), floors, second)).toBe(true);
    // …but ground spots under that building fade, and so does the basement.
    expect(onActiveFloor(p(-200, 1, -300), floors, second)).toBe(false);
    expect(onActiveFloor(p(0, -4, 0), floors, second)).toBe(false);
  });

  it('describes the floors a route passes through', () => {
    const seq = floorSequence([p(-200, 1, -300), p(-150, 1, -300), p(-200, -4, -300), p(-200, 1, -300)], floors);
    expect(seq.map((f) => f.name)).toEqual(['First Level', 'Technical', 'First Level']);
  });

  it('starts on a floor drawn by default, else the ground', () => {
    expect(defaultFloor(floors)?.id).toBe(first.id);
    const mall = floorsFor({ ...labs, layers: [{ name: '2nd Floor', svgLayer: 'F', show: true, extents: [{ height: [25, 34] }] }] });
    expect(defaultFloor(mall)?.name).toBe('2nd Floor');
  });

  it('has no floors for single-level maps', () => {
    expect(floorsFor({ ...labs, layers: [] })).toEqual([]);
  });
});

// Real tarkov.dev config (bundled snapshot): every multi-level map gets a sensible order.
const SNAPSHOT = 'build/snapshot/display.json';
describe.skipIf(!existsSync(SNAPSHOT))('floors in the real map config', () => {
  const groups = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as { normalizedName: string; maps: MapDisplay[] }[];
  const order = (name: string) => floorsFor(groups.find((g) => g.normalizedName === name)!.maps[0]!).map((f) => f.name);
  it('orders basements below ground and numbered floors upward', () => {
    expect(order('the-lab')).toEqual(['Technical', 'First Level', 'Second Level']);
    expect(order('reserve')).toEqual(['Bunkers', 'Ground', '2nd Floor', '3rd Floor', '4th Floor', '5th Floor']);
    expect(order('customs')).toEqual(['Underground', 'Ground', '2nd Floor', '3rd Floor', '4th Floor']);
  });
});

// POIs: known extracts must land on the floor they're really on.
const MAPS = 'build/snapshot/maps.json';
describe.skipIf(!existsSync(SNAPSHOT) || !existsSync(MAPS))('points of interest on multi-level maps', () => {
  const groups = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as { normalizedName: string; maps: MapDisplay[] }[];
  const maps = Object.values(JSON.parse(readFileSync(MAPS, 'utf8')).data.maps) as {
    normalizedName: string;
    extracts?: { name?: string; position?: { x: number; y: number; z: number } }[];
  }[];
  const floorOfExtract = (map: string, extract: string) => {
    const floors = floorsFor(groups.find((g) => g.normalizedName === map)!.maps[0]!);
    const e = maps.find((m) => m.normalizedName === map)!.extracts!.find((x) => x.name === extract)!;
    return floorOf(e.position!, floors)!.name;
  };
  it('puts extracts on their real floors', () => {
    expect(floorOfExtract('the-lab', 'lab_Hangar_Gate')).toBe('First Level');
    expect(floorOfExtract('the-lab', 'lab_Elevator_Med')).toBe('Technical');
    expect(floorOfExtract('the-lab', 'lab_Elevator_Cargo')).toBe('Second Level');
    expect(floorOfExtract('factory', 'Cellars')).toBe('Tunnels');
    expect(floorOfExtract('factory', 'Office Window')).toBe('3rd Floor');
    expect(floorOfExtract('reserve', 'EXFIL_Bunker_D2')).toBe('Bunkers');
    expect(floorOfExtract('reserve', 'Exit1')).toBe('Ground');
  });
});
