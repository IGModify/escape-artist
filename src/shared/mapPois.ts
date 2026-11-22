// Terminal spots tarkov.dev has no data for: electrical panels to repair (Toolset), where Toolsets
// and keys spawn, and the doors they open. Placed from the EFT wiki's interactive map (Map:Terminal,
// CC BY-NC-SA) by fitting its pixels to game coordinates with shared anchors (locked doors, PMC and
// bot spawns): about 5 m off in the port area, up to ~25 m at the far pier. Shown as approximate.
import type { Vec3 } from './types';

export type MapPoiKind = 'panel' | 'toolset' | 'key' | 'door';

export interface MapPoi {
  kind: MapPoiKind;
  title: string;
  note: string;
  position: Vec3;
}

/** Terminal is flat (one level at about y = -60). */
const Y = -60;

const TERMINAL: { kind: MapPoiKind; title: string; note: string; x: number; z: number }[] = [
  { kind: 'panel', title: "Electrical panel No. 1", note: "Repair with a Toolset (guaranteed; by hand it often fails). Which panels need repair depends on how many players entered.", x: 94.1, z: -394.3 },
  { kind: 'panel', title: "Electrical panel No. 2", note: "Repair with a Toolset (guaranteed; by hand it often fails). Which panels need repair depends on how many players entered.", x: 150.2, z: -254.2 },
  { kind: 'panel', title: "Electrical panel No. 3", note: "Repair with a Toolset (guaranteed; by hand it often fails). Which panels need repair depends on how many players entered.", x: 106, z: -246.6 },
  { kind: 'panel', title: "Electrical panel No. 4", note: "Repair with a Toolset (guaranteed; by hand it often fails). Which panels need repair depends on how many players entered.", x: 61.3, z: -266.9 },
  { kind: 'panel', title: "Electrical panel No. 5", note: "Repair with a Toolset (guaranteed; by hand it often fails). Which panels need repair depends on how many players entered.", x: 69.6, z: -189.1 },
  { kind: 'panel', title: "Electrical panel No. 6", note: "Repair with a Toolset (guaranteed; by hand it often fails). Which panels need repair depends on how many players entered.", x: 86.5, z: -113 },
  { kind: 'panel', title: "Electrical panel No. 7", note: "Repair with a Toolset (guaranteed; by hand it often fails). Which panels need repair depends on how many players entered.", x: 87, z: -39.2 },
  { kind: 'panel', title: "Electrical panel No. 8", note: "Repair with a Toolset (guaranteed; by hand it often fails). Which panels need repair depends on how many players entered.", x: 176.7, z: -44.9 },
  { kind: 'panel', title: "Electrical panel No. 9", note: "Repair with a Toolset (guaranteed; by hand it often fails). Which panels need repair depends on how many players entered.", x: 163.6, z: 7.8 },
  { kind: 'panel', title: "Electrical panel No. 10", note: "Repair with a Toolset (guaranteed; by hand it often fails). Which panels need repair depends on how many players entered.", x: 179.2, z: 249.4 },
  { kind: 'panel', title: "Pumping station drain button", note: "Drains the water in the pumping station.", x: 174.9, z: 250.9 },
  { kind: 'toolset', title: "Toolset", note: "On the barrier in front of the BRDM", x: 129.6, z: 19.8 },
  { kind: 'toolset', title: "Toolset", note: "On the barrels", x: 106.7, z: 56.4 },
  { kind: 'toolset', title: "Toolset", note: "On the base of the pillar", x: 94.5, z: 25.8 },
  { kind: 'key', title: "Armory Key", note: "Inside the dead RUAF soldier", x: 199, z: -255.9 },
  { kind: 'key', title: "Armory Key", note: "On the corner of the desk", x: 197.6, z: -246.1 },
  { kind: 'key', title: "Armory Key", note: "In the hand of a dead RUAF soldier", x: 126.1, z: -406.7 },
  { kind: 'key', title: "Armory Key", note: "In the hand of a dead RUAF soldier", x: 177.4, z: -342.1 },
  { kind: 'key', title: "Black Division Keycard", note: "In a Weapon box (6x2) on a tipped over ATM", x: 272.4, z: -262.5 },
  { kind: 'key', title: "Pier Door Key", note: "In the safe", x: 137.8, z: 257.6 },
  { kind: 'key', title: "SZ-1 Explosive Charge", note: "In an open wooden box on the ground next to the tent", x: 190.2, z: -31.8 },
  { kind: 'key', title: "SZ-1 Explosive Charge", note: "In the tent, on a table next to the radio equipment", x: 191.7, z: -38.3 },
  { kind: 'key', title: "SZ-1 Explosive Charge", note: "On the green wooden crates", x: 196.1, z: -33.5 },
  { kind: 'key', title: "SZ-1 Explosive Charge", note: "On the corner of the lat bed truck trailer", x: 197.7, z: 22.8 },
  { kind: 'key', title: "SZ-1 Explosive Charge", note: "On the metal barrels", x: 182.5, z: -55.1 },
  { kind: 'key', title: "SZ-1 Explosive Charge", note: "On the desk under the canopy", x: 211.7, z: 0 },
  { kind: 'key', title: "SZ-1 Explosive Charge", note: "On the desk under the canopy", x: 199.3, z: -41.8 },
  { kind: 'door', title: "Administration Building Passageway", note: "Opens with: Black Division keycard", x: 70.9, z: -157.9 },
  { kind: 'door', title: "Armory", note: "Opens with: Armory key", x: 192.1, z: -247 },
  { kind: 'door', title: "Metal Gate", note: "Opens with: SZ-1 explosive charge, or push it open (Elite Strength or 2 players).", x: 123.2, z: 4.1 },
  { kind: 'door', title: "Pier Door", note: "Opens with: Pier door key · Entering this door starts the 3 minute extraction timer.", x: -256.2, z: 343.9 },
];

const BY_MAP: Record<string, MapPoi[]> = {
  terminal: TERMINAL.map(({ x, z, ...p }) => ({ ...p, position: { x, y: Y, z } })),
};

/** Hand-placed points for a map (normalizedName); empty for maps tarkov.dev covers. */
export function mapPois(normalizedName: string): MapPoi[] {
  return BY_MAP[normalizedName] ?? [];
}
