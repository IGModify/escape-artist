import { describe, expect, it } from 'vitest';
import { solveRoute, travelCost, type RouteTarget } from './route';
import type { Vec3 } from './types';

const p = (x: number, z: number, y = 0): Vec3 => ({ x, y, z });

function bruteForce(start: Vec3, targets: RouteTarget[], ends: Vec3[]): number {
  let best = Infinity;
  const permute = (rest: RouteTarget[], at: Vec3, acc: number) => {
    if (acc >= best) return;
    if (rest.length === 0) {
      const tail = ends.length ? Math.min(...ends.map((e) => travelCost(at, e))) : 0;
      best = Math.min(best, acc + tail);
      return;
    }
    rest.forEach((t, i) => {
      const others = rest.filter((_, j) => j !== i);
      for (const o of t.options) permute(others, o, acc + travelCost(at, o));
    });
  };
  permute(targets, start, 0);
  return best;
}

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

describe('solveRoute', () => {
  it('visits points on a line in order', () => {
    const r = solveRoute(p(0, 0), [
      { id: 'c', options: [p(30, 0)] },
      { id: 'a', options: [p(10, 0)] },
      { id: 'b', options: [p(20, 0)] },
    ]);
    expect(r.stops.map((s) => s.targetId)).toEqual(['a', 'b', 'c']);
    expect(r.distance).toBeCloseTo(30);
    expect(r.exact).toBe(true);
  });

  it('picks the closer option of a multi-location objective', () => {
    const r = solveRoute(p(0, 0), [{ id: 'item', options: [p(100, 100), p(5, 0)] }]);
    expect(r.stops[0]!.point).toEqual(p(5, 0));
  });

  it('ends at the cheapest extract', () => {
    const r = solveRoute(p(0, 0), [{ id: 'a', options: [p(50, 0)] }], [
      { id: 'far', point: p(-100, 0) },
      { id: 'near', point: p(60, 0) },
    ]);
    expect(r.end?.id).toBe('near');
    expect(r.distance).toBeCloseTo(60);
  });

  it('penalises floor changes', () => {
    expect(travelCost(p(0, 0, 0), p(0, 0, 10))).toBeCloseTo(15);
  });

  it('matches brute force on random small instances', () => {
    const rand = seeded(42);
    for (let trial = 0; trial < 25; trial++) {
      const targets: RouteTarget[] = Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`,
        options: Array.from({ length: 1 + Math.floor(rand() * 3) }, () => p(rand() * 500, rand() * 500)),
      }));
      const ends = [p(rand() * 500, rand() * 500), p(rand() * 500, rand() * 500)];
      const r = solveRoute(p(250, 250), targets, ends.map((e, i) => ({ id: `e${i}`, point: e })));
      expect(r.distance).toBeCloseTo(bruteForce(p(250, 250), targets, ends), 6);
      expect(new Set(r.stops.map((s) => s.targetId)).size).toBe(5);
    }
  });

  it('falls back to a heuristic for large inputs and still visits everything', () => {
    const rand = seeded(7);
    const targets = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, options: [p(rand() * 800, rand() * 800)] }));
    const r = solveRoute(p(0, 0), targets);
    expect(r.exact).toBe(false);
    expect(new Set(r.stops.map((s) => s.targetId)).size).toBe(20);
    // Nearest-neighbour + 2-opt should beat visiting in the given order.
    const naive = targets.reduce((acc, t, i) => acc + travelCost(i ? targets[i - 1]!.options[0]! : p(0, 0), t.options[0]!), 0);
    expect(r.distance).toBeLessThan(naive);
  });

  it('handles no targets', () => {
    expect(solveRoute(p(0, 0), []).stops).toEqual([]);
  });
});
