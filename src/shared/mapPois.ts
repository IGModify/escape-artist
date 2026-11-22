// Terminal spots tarkov.dev has no data for: electrical panels to repair (Toolset), where Toolsets
// and keys spawn, and the doors they open. Placed from the EFT wiki's interactive map (Map:Terminal,
// CC BY-NC-SA) by fitting its pixels to game coordinates with shared anchors (locked doors, PMC and
// bot spawns): about 5 m off in the port area, up to ~25 m at the far pier. Shown as approximate.
import type { Vec3 } from './types';

export type MapPoiKind = 'panel' | 'button' | 'toolset' | 'key' | 'charge' | 'door';

export interface MapPoi {
  kind: MapPoiKind;
  title: string;
  note: string;
  position: Vec3;
  /** In-game item icon for item spawns (Toolset, keys, charges); none for panels and doors. */
  icon: string | null;
}

const ASSET = (id: string) => `https://assets.tarkov.dev/${id}-icon.webp`;
/** Item icons by spot title: tarkov.dev's icons, and the wiki's for the Armory key (tarkov.dev has none). */
const ICONS: Record<string, string> = {
  Toolset: ASSET('590c2e1186f77425357b6124'),
  'Black Division Keycard': ASSET('6866ad3853330f9b83064cf9'),
  'Pier Door Key': ASSET('6866adbe09b973bf45094339'),
  'SZ-1 Explosive Charge': ASSET('69a0174087a75d2cbd0842e8'),
  // Bundled (1.8 KB) so it shows offline and without the wiki's hotlink rules.
  'Armory Key': 'data:image/webp;base64,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',
};

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
  { kind: 'button', title: "Pumping station drain button", note: "Drains the water in the pumping station.", x: 174.9, z: 250.9 },
  { kind: 'toolset', title: "Toolset", note: "On the barrier in front of the BRDM", x: 129.6, z: 19.8 },
  { kind: 'toolset', title: "Toolset", note: "On the barrels", x: 106.7, z: 56.4 },
  { kind: 'toolset', title: "Toolset", note: "On the base of the pillar", x: 94.5, z: 25.8 },
  { kind: 'key', title: "Armory Key", note: "Inside the dead RUAF soldier", x: 199, z: -255.9 },
  { kind: 'key', title: "Armory Key", note: "On the corner of the desk", x: 197.6, z: -246.1 },
  { kind: 'key', title: "Armory Key", note: "In the hand of a dead RUAF soldier", x: 126.1, z: -406.7 },
  { kind: 'key', title: "Armory Key", note: "In the hand of a dead RUAF soldier", x: 177.4, z: -342.1 },
  { kind: 'key', title: "Black Division Keycard", note: "In a Weapon box (6x2) on a tipped over ATM", x: 272.4, z: -262.5 },
  { kind: 'key', title: "Pier Door Key", note: "In the safe", x: 137.8, z: 257.6 },
  { kind: 'charge', title: "SZ-1 Explosive Charge", note: "In an open wooden box on the ground next to the tent", x: 190.2, z: -31.8 },
  { kind: 'charge', title: "SZ-1 Explosive Charge", note: "In the tent, on a table next to the radio equipment", x: 191.7, z: -38.3 },
  { kind: 'charge', title: "SZ-1 Explosive Charge", note: "On the green wooden crates", x: 196.1, z: -33.5 },
  { kind: 'charge', title: "SZ-1 Explosive Charge", note: "On the corner of the lat bed truck trailer", x: 197.7, z: 22.8 },
  { kind: 'charge', title: "SZ-1 Explosive Charge", note: "On the metal barrels", x: 182.5, z: -55.1 },
  { kind: 'charge', title: "SZ-1 Explosive Charge", note: "On the desk under the canopy", x: 211.7, z: 0 },
  { kind: 'charge', title: "SZ-1 Explosive Charge", note: "On the desk under the canopy", x: 199.3, z: -41.8 },
  { kind: 'door', title: "Administration Building Passageway", note: "Opens with: Black Division keycard", x: 70.9, z: -157.9 },
  { kind: 'door', title: "Armory", note: "Opens with: Armory key", x: 192.1, z: -247 },
  { kind: 'door', title: "Metal Gate", note: "Opens with: SZ-1 explosive charge, or push it open (Elite Strength or 2 players).", x: 123.2, z: 4.1 },
  { kind: 'door', title: "Pier Door", note: "Opens with: Pier door key · Entering this door starts the 3 minute extraction timer.", x: -256.2, z: 343.9 },
];

const BY_MAP: Record<string, MapPoi[]> = {
  terminal: TERMINAL.map(({ x, z, ...p }) => ({ ...p, position: { x, y: Y, z }, icon: ICONS[p.title] ?? null })),
};

/** Hand-placed points for a map (normalizedName); empty for maps tarkov.dev covers. */
export function mapPois(normalizedName: string): MapPoi[] {
  return BY_MAP[normalizedName] ?? [];
}
