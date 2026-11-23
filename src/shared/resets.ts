import type { GameMode, QuestEvent } from './types';

/**
 * Profile resets (wipe or prestige) seen in the logs. The game doesn't log them, but after one
 * you start over: quests you had already finished get started again, several in a short burst
 * (Introduction, Gunsmith - Part 1…). Without this, quests started before the reset and never
 * finished would stay "active" forever.
 */
const MIN_RESTARTS = 5;
const BURST_MS = 3 * 24 * 60 * 60 * 1000;
/** Events closer together than this belong to the same play stretch (session). */
const SESSION_GAP_MS = 12 * 60 * 60 * 1000;

const ms = (t: string) => Date.parse(t);

/**
 * Per mode: the time from which quest history counts (the start of the play session in which the
 * latest reset happened), or nothing when no reset is seen. `events` may be in any order.
 */
export function detectResets(events: (QuestEvent & { mode: GameMode })[]): Partial<Record<GameMode, string>> {
  const out: Partial<Record<GameMode, string>> = {};
  const modes = [...new Set(events.map((e) => e.mode))];
  for (const mode of modes) {
    const ev = events.filter((e) => e.mode === mode).sort((a, b) => ms(a.time) - ms(b.time));
    // Find the first reset, then look again only at what came after it (a quest finished before
    // a reset and started after it is part of that reset, not a new one), until none is left.
    let from = 0;
    let found: number | null = null;
    for (;;) {
      const at = firstReset(ev, from);
      if (at === null) break;
      found = sessionStart(ev, at);
      from = at + 1;
      // Skip the rest of this burst: its restarts belong to the reset just found.
      const end = ms(ev[at]!.time) + BURST_MS;
      while (from < ev.length && ms(ev[from]!.time) <= end) from++;
    }
    if (found !== null) out[mode] = ev[found]!.time;
  }
  return out;
}

/**
 * Per mode, merges prestiges (exact times from the game) into detected resets: the latest one
 * wins, except that a prestige shortly before a detected reset is that same reset, and its
 * exact time is used.
 */
export function withPrestiges(
  resets: Partial<Record<GameMode, string>>,
  prestiges: { time: string; mode: GameMode }[],
): Partial<Record<GameMode, string>> {
  const out = { ...resets };
  for (const p of prestiges) {
    const cur = out[p.mode];
    const sameReset = cur && ms(cur) >= ms(p.time) && ms(cur) - ms(p.time) <= BURST_MS;
    if (!cur || sameReset || ms(p.time) > ms(cur)) out[p.mode] = p.time;
  }
  return out;
}

/** Index of the first restart of a burst (≥ MIN_RESTARTS within BURST_MS), counting from `from`. */
function firstReset(ev: QuestEvent[], from: number): number | null {
  const finished = new Set<string>();
  const restarts: number[] = [];
  for (let i = from; i < ev.length; i++) {
    const e = ev[i]!;
    if (e.status === 'finished') finished.add(e.taskId);
    else if (e.status === 'started' && finished.has(e.taskId)) restarts.push(i);
  }
  for (let a = 0; a < restarts.length; a++) {
    const first = ms(ev[restarts[a]!]!.time);
    let n = 0;
    for (let b = a; b < restarts.length && ms(ev[restarts[b]!]!.time) - first <= BURST_MS; b++) n++;
    if (n >= MIN_RESTARTS) return restarts[a]!;
  }
  return null;
}

/** Start of the play session containing `i`, so quests picked up right after a reset (before the
 *  first restart) still count. */
function sessionStart(ev: QuestEvent[], i: number): number {
  while (i > 0 && ms(ev[i]!.time) - ms(ev[i - 1]!.time) < SESSION_GAP_MS) i--;
  return i;
}
