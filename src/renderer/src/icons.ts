import type { MarkerKind } from '@shared/questLogic';

// 24x24 stroke glyphs, drawn in currentColor.
const G: Record<MarkerKind, string> = {
  marker:
    '<path d="M12 21v-8"/><circle cx="12" cy="10" r="2"/><path d="M8.5 6.5a5 5 0 0 0 0 7M15.5 6.5a5 5 0 0 1 0 7M5.6 3.6a9 9 0 0 0 0 12.8M18.4 3.6a9 9 0 0 1 0 12.8"/>',
  cctv: '<rect x="3" y="7" width="12" height="9" rx="1.5"/><path d="M15 10l5-3v9l-5-3"/><circle cx="9" cy="11.5" r="2"/>',
  jammer:
    '<rect x="5" y="9" width="14" height="11" rx="1.5"/><path d="M9 9V4M15 9V5"/><path d="M13 11l-3 4h4l-3 4"/>',
  plant: '<path d="M12 3v10M8 9l4 4 4-4"/><path d="M4 15v4h16v-4"/>',
  visit: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pickup: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  shoot: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  use: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  extract: '<path d="M14 4h5v16h-5"/><path d="M10 16l4-4-4-4M3 12h11"/>',
  transit: '<circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="7" r="2.5"/><path d="M7.5 17H13a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5.5"/>',
  other: '<circle cx="12" cy="12" r="4"/>',
};

export function glyph(kind: MarkerKind, size = 16): string {
  return svg(G[kind], size);
}

/** Map extracts: a running figure leaving through a door, so they never look like a quest marker. */
export function exfilGlyph(size = 14): string {
  return svg('<path d="M13 3h7v18h-7"/><circle cx="7" cy="5" r="1.6"/><path d="M9 21l1.5-5-2.5-2 1-5-3 1.5L5 13M8 9l3 3 3-1"/>', size, 2.4);
}

function svg(body: string, size: number, width = 2): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** Everything drawn on the map that has a color the user can change in Settings. */
export type ColorKey = MarkerKind | 'spawn' | 'exfil' | 'player' | 'route' | 'bd';

// Spread around the color wheel so no two neighbours are easy to confuse.
export const DEFAULT_COLORS: Record<ColorKey, string> = {
  spawn: '#facc15',
  exfil: '#22c55e',
  bd: '#e11d48', // Black Division spawns (Terminal)
  player: '#ffffff',
  route: '#e2e8f0',
  marker: '#2dd4bf', // teal, so markers don't share the spawns' yellow
  cctv: '#3b82f6',
  jammer: '#c026d3',
  plant: '#f97316',
  visit: '#f472b6',
  pickup: '#d6a36a',
  shoot: '#ef4444',
  use: '#a3e635',
  extract: '#0ea5e9',
  transit: '#a78bfa',
  other: '#6b7280',
};

/** Settings order and names: map things first, then each quest objective type. */
export const COLOR_GROUPS: { title: string; keys: [ColorKey, string][] }[] = [
  {
    title: 'Map',
    keys: [
      ['spawn', 'PMC spawns'],
      ['exfil', 'Extracts'],
      ['bd', 'Black Division spawns'],
      ['player', 'You'],
      ['route', 'Route line'],
    ],
  },
  {
    title: 'Quest objectives',
    keys: [
      ['marker', 'Place marker'],
      ['cctv', 'Place camera (CCTV)'],
      ['jammer', 'Place jammer'],
      ['plant', 'Plant / stash item'],
      ['pickup', 'Pick up item'],
      ['visit', 'Visit / locate'],
      ['shoot', 'Kill zone'],
      ['use', 'Use item'],
      ['extract', 'Extract (quest)'],
      ['transit', 'Use transit'],
      ['other', 'Other'],
    ],
  },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Defaults with the user's overrides on top (bad values are ignored). */
export function colorsFrom(custom: Partial<Record<string, string>> | undefined): Record<ColorKey, string> {
  const out = { ...DEFAULT_COLORS };
  for (const k of Object.keys(out) as ColorKey[]) {
    const v = custom?.[k];
    if (typeof v === 'string' && HEX.test(v)) out[k] = v;
  }
  return out;
}
