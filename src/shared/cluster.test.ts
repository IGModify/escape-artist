import { describe, expect, it } from 'vitest';
import { clusterPoints } from './cluster';

describe('clusterPoints', () => {
  it('stacks markers that would overlap and leaves distant ones alone', () => {
    const groups = clusterPoints(
      [
        { item: 'a', x: 0, y: 0 },
        { item: 'b', x: 10, y: 5 },
        { item: 'c', x: 100, y: 100 },
        { item: 'd', x: 0, y: 0 }, // same spot, e.g. another floor of the same building
      ],
      26,
    );
    expect(groups).toEqual([['a', 'b', 'd'], ['c']]);
  });

  it('anchors each stack on its first (most important) item', () => {
    // 'b' is within reach of 'a' but 'c' is only within reach of 'b': it starts its own stack.
    const groups = clusterPoints(
      [
        { item: 'a', x: 0, y: 0 },
        { item: 'b', x: 20, y: 0 },
        { item: 'c', x: 40, y: 0 },
      ],
      26,
    );
    expect(groups).toEqual([['a', 'b'], ['c']]);
  });

  it('splits stacks apart as markers spread out (zooming in)', () => {
    const at = (scale: number) => clusterPoints([{ item: 'a', x: 0, y: 0 }, { item: 'b', x: 8 * scale, y: 0 }], 26).length;
    expect(at(1)).toBe(1);
    expect(at(8)).toBe(2);
  });
});
