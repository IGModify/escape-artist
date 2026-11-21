import type { Vec3 } from './types';

/**
 * A stop the route must visit. An objective can often be done at any of several
 * spots (several zones, or possible quest-item locations) — visiting one is enough.
 */
export interface RouteTarget {
  id: string;
  options: Vec3[];
}

export interface RouteEnd {
  id: string;
  point: Vec3;
}

export interface RouteStop {
  targetId: string;
  point: Vec3;
}

export interface RouteResult {
  stops: RouteStop[];
  end: RouteEnd | null;
  /** Estimated path length in metres (straight lines, see `travelCost`). */
  distance: number;
  /** True when the exact solver ran; false when the heuristic was used. */
  exact: boolean;
}

/**
 * Straight-line cost between two points. Maps have no navmesh in the public data,
 * so we approximate: horizontal distance plus a penalty for changing floors.
 */
export function travelCost(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz) + 1.5 * Math.abs(a.y - b.y);
}

const EXACT_MAX_TARGETS = 12;
const EXACT_MAX_OPTIONS = 64;

/**
 * Shortest order to visit one option of every target, starting at `start` and,
 * if `ends` is given, finishing at the cheapest of them (e.g. an extract).
 * Exact (Held–Karp over options) for small inputs; heuristic beyond that.
 */
export function solveRoute(start: Vec3, targets: RouteTarget[], ends: RouteEnd[] = []): RouteResult {
  const groups = targets.filter((t) => t.options.length > 0);
  if (groups.length === 0) {
    const end = cheapestEnd(start, ends);
    return { stops: [], end, distance: end ? travelCost(start, end.point) : 0, exact: true };
  }
  const optionCount = groups.reduce((n, g) => n + g.options.length, 0);
  if (groups.length <= EXACT_MAX_TARGETS && optionCount <= EXACT_MAX_OPTIONS) {
    return solveExact(start, groups, ends);
  }
  return solveHeuristic(start, groups, ends);
}

function cheapestEnd(from: Vec3, ends: RouteEnd[]): RouteEnd | null {
  let best: RouteEnd | null = null;
  let bestCost = Infinity;
  for (const e of ends) {
    const c = travelCost(from, e.point);
    if (c < bestCost) {
      bestCost = c;
      best = e;
    }
  }
  return best;
}

interface Node {
  group: number;
  point: Vec3;
}

function solveExact(start: Vec3, groups: RouteTarget[], ends: RouteEnd[]): RouteResult {
  const nodes: Node[] = [];
  groups.forEach((g, gi) => g.options.forEach((p) => nodes.push({ group: gi, point: p })));
  const n = nodes.length;
  const full = (1 << groups.length) - 1;
  const size = (full + 1) * n;
  const dp = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const cost = (i: number, j: number) => travelCost(nodes[i]!.point, nodes[j]!.point);

  for (let i = 0; i < n; i++) {
    dp[(1 << nodes[i]!.group) * n + i] = travelCost(start, nodes[i]!.point);
  }
  for (let mask = 1; mask <= full; mask++) {
    for (let i = 0; i < n; i++) {
      const cur = dp[mask * n + i]!;
      if (cur === Infinity || !(mask & (1 << nodes[i]!.group))) continue;
      for (let j = 0; j < n; j++) {
        const bit = 1 << nodes[j]!.group;
        if (mask & bit) continue;
        const nextIdx = (mask | bit) * n + j;
        const c = cur + cost(i, j);
        if (c < dp[nextIdx]!) {
          dp[nextIdx] = c;
          parent[nextIdx] = i;
        }
      }
    }
  }

  let bestLast = -1;
  let bestCost = Infinity;
  let bestEnd: RouteEnd | null = null;
  for (let i = 0; i < n; i++) {
    const base = dp[full * n + i]!;
    if (base === Infinity) continue;
    if (ends.length === 0) {
      if (base < bestCost) [bestCost, bestLast, bestEnd] = [base, i, null];
      continue;
    }
    for (const e of ends) {
      const c = base + travelCost(nodes[i]!.point, e.point);
      if (c < bestCost) [bestCost, bestLast, bestEnd] = [c, i, e];
    }
  }

  const order: number[] = [];
  let mask = full;
  let cur = bestLast;
  while (cur !== -1) {
    order.push(cur);
    const prev = parent[mask * n + cur]!;
    mask &= ~(1 << nodes[cur]!.group);
    cur = prev;
  }
  order.reverse();
  return {
    stops: order.map((i) => ({ targetId: groups[nodes[i]!.group]!.id, point: nodes[i]!.point })),
    end: bestEnd,
    distance: bestCost,
    exact: true,
  };
}

function pathCost(start: Vec3, points: Vec3[], end: Vec3 | null): number {
  let total = 0;
  let prev = start;
  for (const p of points) {
    total += travelCost(prev, p);
    prev = p;
  }
  return end ? total + travelCost(prev, end) : total;
}

function solveHeuristic(start: Vec3, groups: RouteTarget[], ends: RouteEnd[]): RouteResult {
  // 1. Nearest neighbour over groups, picking each group's closest option.
  const remaining = new Set(groups.map((_, i) => i));
  const order: number[] = [];
  const choice: Vec3[] = [];
  let at = start;
  while (remaining.size > 0) {
    let bestG = -1;
    let bestP: Vec3 | null = null;
    let bestC = Infinity;
    for (const gi of remaining) {
      for (const p of groups[gi]!.options) {
        const c = travelCost(at, p);
        if (c < bestC) [bestC, bestG, bestP] = [c, gi, p];
      }
    }
    remaining.delete(bestG);
    order.push(bestG);
    choice.push(bestP!);
    at = bestP!;
  }

  // 2. Alternate 2-opt on the order with re-picking each group's best option.
  const endFor = (pts: Vec3[]) => cheapestEnd(pts[pts.length - 1] ?? start, ends);
  let best = pathCost(start, choice, endFor(choice)?.point ?? null);
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const o2 = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const c2 = [...choice.slice(0, i), ...choice.slice(i, k + 1).reverse(), ...choice.slice(k + 1)];
        const c = pathCost(start, c2, endFor(c2)?.point ?? null);
        if (c + 1e-9 < best) {
          order.splice(0, order.length, ...o2);
          choice.splice(0, choice.length, ...c2);
          best = c;
          improved = true;
        }
      }
    }
    for (let i = 0; i < order.length; i++) {
      for (const p of groups[order[i]!]!.options) {
        const trial = [...choice];
        trial[i] = p;
        const c = pathCost(start, trial, endFor(trial)?.point ?? null);
        if (c + 1e-9 < best) {
          choice[i] = p;
          best = c;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return {
    stops: order.map((gi, i) => ({ targetId: groups[gi]!.id, point: choice[i]! })),
    end: endFor(choice),
    distance: best,
    exact: false,
  };
}
