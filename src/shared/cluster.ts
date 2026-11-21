// Groups map markers that would overlap on screen into stacks.

export interface ClusterInput<T> {
  item: T;
  /** Screen position in pixels at the current zoom. */
  x: number;
  y: number;
}

/**
 * Greedy screen-space clustering: items are taken in the given order (most important first) and
 * each joins the first stack whose anchor is within `radius` px, else starts a new stack. The first
 * item of a stack is its anchor, so the stack sits where the most important marker is.
 */
export function clusterPoints<T>(items: ClusterInput<T>[], radius: number): T[][] {
  const stacks: { x: number; y: number; items: T[] }[] = [];
  const r2 = radius * radius;
  for (const it of items) {
    const hit = stacks.find((s) => (s.x - it.x) ** 2 + (s.y - it.y) ** 2 <= r2);
    if (hit) hit.items.push(it.item);
    else stacks.push({ x: it.x, y: it.y, items: [it.item] });
  }
  return stacks.map((s) => s.items);
}
