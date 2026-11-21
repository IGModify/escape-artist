import { describe, expect, it } from 'vitest';
import { LogStream, splitComplete, type LogChunk } from './logStream';
import type { QuestEvent, RaidEvent } from './types';

const quest = (time: string, type: number, id: string) =>
  `${time}|1.0|Info|push-notifications|Got notification | ChatMessageReceived\n{\n  "message": { "type": ${type}, "templateId": "${id} x" }\n}\n`;

describe('splitComplete', () => {
  it('holds back an entry whose JSON block is still open', () => {
    const text = '2026-11-20 20:00:00.000|a|line one\n2026-11-20 20:00:01.000|b|Got notification\n{\n  "message": {';
    const [done, rest] = splitComplete(text);
    expect(done).toBe('2026-11-20 20:00:00.000|a|line one\n');
    expect(rest.startsWith('2026-11-20 20:00:01.000')).toBe(true);
  });

  it('releases a finished single line', () => {
    expect(splitComplete('2026-11-20 20:00:00.000|a|GameStarted\n')).toEqual(['2026-11-20 20:00:00.000|a|GameStarted\n', '']);
  });
});

describe('LogStream', () => {
  const setup = () => {
    const quests: Array<[QuestEvent[], boolean]> = [];
    const raids: Array<[RaidEvent, boolean]> = [];
    const stream = new LogStream({ quests: (e, r) => quests.push([e, r]), raid: (e, r) => raids.push([e, r]) });
    return { stream, quests, raids };
  };
  const chunk = (c: Partial<LogChunk> & Pick<LogChunk, 'text'>): LogChunk => ({ file: 'n.log', kind: 'notifications', replay: false, reset: false, ...c });

  it('reassembles an entry split across two reads', () => {
    const { stream, quests } = setup();
    const full = quest('2026-11-20 10:30:00.000', 12, 'taskB');
    stream.push(chunk({ text: full.slice(0, 70) }));
    expect(quests).toHaveLength(0);
    stream.push(chunk({ text: full.slice(70) }));
    expect(quests[0]![0]).toEqual([{ taskId: 'taskB', status: 'finished', time: '2026-11-20T10:30:00.000' }]);
  });

  it('marks history replays and parses whole replayed files', () => {
    const { stream, quests } = setup();
    stream.push(chunk({ text: quest('2026-11-19 10:00:00.000', 10, 'taskA'), replay: true }));
    expect(quests).toEqual([[[{ taskId: 'taskA', status: 'started', time: '2026-11-19T10:00:00.000' }], true]]);
  });

  it('reads raid events from the application log', () => {
    const { stream, raids } = setup();
    stream.push(chunk({ file: 'a.log', kind: 'application', text: "2026-11-20 10:01:00.000|1.0|Debug|application|TRACE-NetworkGameCreate profileStatus: 'RaidMode: Online, Location: Woods, shortId: ABCDEF'\n" }));
    expect(raids[0]![0]).toMatchObject({ kind: 'matched', mapNameId: 'Woods', raidId: 'ABCDEF' });
  });

  it('drops a half-written entry when the file restarts', () => {
    const { stream, quests } = setup();
    stream.push(chunk({ text: '2026-11-20 10:00:00.000|1.0|Info|x|Got notification | ChatMessageReceived\n{\n  "mess' }));
    stream.push(chunk({ text: quest('2026-11-20 11:00:00.000', 10, 'taskC'), reset: true }));
    expect(quests.flatMap(([e]) => e.map((x) => x.taskId))).toEqual(['taskC']);
  });
});
