import { describe, expect, it } from 'vitest';
import { detectResets } from './resets';
import type { GameMode, QuestEvent } from './types';

const ev = (mode: GameMode, time: string, taskId: string, status: QuestEvent['status']) => ({ mode, time, taskId, status });

describe('detectResets', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((id, i) => [
    ev('pve', `2026-01-0${i + 1}T10:00:00.000`, id, 'started'),
    ev('pve', `2026-01-0${i + 1}T11:00:00.000`, id, 'finished'),
  ]);
  const stale = ev('pve', '2026-02-01T10:00:00.000', 'old', 'started'); // never finished, pre-reset
  const after = [
    ev('pve', '2026-10-07T20:00:00.000', 'new', 'started'), // same session, just before the first restart
    ...['a', 'b', 'c', 'd', 'e'].map((id, i) => ev('pve', `2026-10-07T20:1${i}:00.000`, id, 'started')),
  ];

  it('finds a burst of finished quests being started again, from the start of that session', () => {
    expect(detectResets([...before, stale, ...after])).toEqual({ pve: '2026-10-07T20:00:00.000' });
  });

  it('ignores a few scattered restarts and keeps modes apart', () => {
    const scattered = [ev('regular', '2026-01-01T10:00:00.000', 'x', 'finished'), ev('regular', '2026-03-01T10:00:00.000', 'x', 'started')];
    const r = detectResets([...before, ...scattered, ...after.map((e) => ({ ...e, mode: 'season' as GameMode }))]);
    expect(r).toEqual({});
  });
});
