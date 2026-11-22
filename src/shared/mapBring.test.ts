import { describe, expect, it } from 'vitest';
import { mapBring } from './mapBring';

describe('mapBring', () => {
  it('lists an access item for each Terminal ending, then optional helpers', () => {
    const [access, optional] = mapBring('terminal');
    expect(access?.rows.map((r) => r.label)).toEqual(['Savior', 'Debtor', 'Survivor', 'Fallen']);
    expect(access?.rows[0]?.items).toHaveLength(2); // keycard + Alpha-1 evidence container
    expect(optional?.rows.map((r) => r.items[0]?.name)).toEqual(['Toolset', 'SZ-1 explosive charge']);
    expect(mapBring('customs')).toEqual([]);
  });
});
