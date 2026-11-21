import { describe, expect, it } from 'vitest';
import { COLOR_GROUPS, colorsFrom, DEFAULT_COLORS } from './icons';

describe('marker colors', () => {
  it('uses a different default color for everything on the map', () => {
    const values = Object.values(DEFAULT_COLORS).map((c) => c.toLowerCase());
    expect(new Set(values).size).toBe(values.length);
  });
  it('offers a picker for every color', () => {
    const keys = COLOR_GROUPS.flatMap((g) => g.keys.map(([k]) => k)).sort();
    expect(keys).toEqual(Object.keys(DEFAULT_COLORS).sort());
  });
  it('applies valid overrides and ignores junk', () => {
    const c = colorsFrom({ spawn: '#123456', exfil: 'red', nope: '#000000' });
    expect(c.spawn).toBe('#123456');
    expect(c.exfil).toBe(DEFAULT_COLORS.exfil);
    expect(colorsFrom(undefined)).toEqual(DEFAULT_COLORS);
  });
});
