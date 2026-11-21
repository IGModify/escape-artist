import { describe, expect, it } from 'vitest';
import {
  logFolderTimestamp,
  parseQuestEvents,
  parseRaidEvents,
  parseScreenshotName,
  quaternionToYaw,
  reduceQuestLog,
} from './parsers';

const notifications = `2026-11-20 20:01:02.345 +01:00|1.0.0.0|Info|push-notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "eventId": "abc",
  "message": {
    "type": 10,
    "templateId": "5936d90786f7742b1420ba5b description",
    "text": ""
  }
}
2026-11-20 20:05:00.000 +01:00|1.0.0.0|Info|push-notifications|Got notification | ChatMessageReceived
{
  "message": {
    "type": 12,
    "templateId": "5936d90786f7742b1420ba5b successMessageText"
  }
}
2026-11-20 20:06:00.000 +01:00|1.0.0.0|Info|push-notifications|Got notification | ChatMessageReceived
{
  "message": { "type": 1, "text": "hi from a player" }
}
2026-11-20 20:07:00.000 +01:00|1.0.0.0|Info|push-notifications|Got notification | ChatMessageReceived
{
  "message": {
    "type": 11,
    "templateId": "59674cd986f7744ab26e32f2 failMessageText"
  }
}
`;

const application = `2026-11-20 21:00:00.000 +01:00|1.0.0.0|Info|application|LocationLoaded:2.1 real:2.4
2026-11-20 21:00:10.000 +01:00|1.0.0.0|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Profileid: 123, Status: Busy, RaidMode: Online, Ip: 1.2.3.4, Port: 17000, Location: bigmap, Sid: x, GameMode: deathmatch, shortId: AB12CD'
2026-11-20 21:00:40.000 +01:00|1.0.0.0|Info|application|GameStarted:1.0 real:1.0
2026-11-20 21:30:00.000 +01:00|1.0.0.0|Info|push-notifications|Got notification | UserMatchOver
{
  "type": "userMatchOver"
}
`;

describe('log parsing', () => {
  it('reads quest start / finish / fail and ignores player chat', () => {
    const ev = parseQuestEvents(notifications);
    expect(ev.map((e) => [e.taskId, e.status])).toEqual([
      ['5936d90786f7742b1420ba5b', 'started'],
      ['5936d90786f7742b1420ba5b', 'finished'],
      ['59674cd986f7744ab26e32f2', 'failed'],
    ]);
  });

  it('keeps the newest status per task', () => {
    const log = reduceQuestLog({}, parseQuestEvents(notifications));
    expect(log['5936d90786f7742b1420ba5b']!.status).toBe('finished');
    // An older event arriving later must not overwrite a newer one.
    const stale = reduceQuestLog(log, [{ taskId: '5936d90786f7742b1420ba5b', status: 'started', time: '2026-01-01T00:00:00.000+01:00' }]);
    expect(stale['5936d90786f7742b1420ba5b']!.status).toBe('finished');
  });

  it('reads raid matched / started / ended', () => {
    const ev = parseRaidEvents(application);
    expect(ev).toEqual([
      { kind: 'matched', mapNameId: 'bigmap', raidId: 'AB12CD', online: true, time: '2026-11-20T21:00:10.000+01:00' },
      { kind: 'started', time: '2026-11-20T21:00:40.000+01:00' },
      { kind: 'ended', time: '2026-11-20T21:30:00.000+01:00' },
    ]);
  });

  it('sorts log folders by their timestamp', () => {
    const a = logFolderTimestamp('log_2026.11.20_9-05-01_1.0.0.0');
    const b = logFolderTimestamp('C:/EFT/Logs/log_2026.11.20_21-44-48_1.0.0.0');
    expect(a).not.toBeNull();
    expect(b! > a!).toBe(true);
    expect(logFolderTimestamp('random')).toBeNull();
  });
});

describe('screenshot parsing', () => {
  it('extracts position and heading', () => {
    const r = parseScreenshotName(
      'C:/Users/me/Documents/Escape From Tarkov/Screenshots/2026-11-20[21-44]_-123.45, 4.56, 78.90_0.00000, 0.70711, 0.00000, 0.70711_12.34 (0).png',
    );
    expect(r?.position).toEqual({ x: -123.45, y: 4.56, z: 78.9 });
    expect(r?.yaw).toBeCloseTo(90, 1);
  });

  it('ignores screenshots without coordinates', () => {
    expect(parseScreenshotName('2026-11-20[21-44] (0).png')).toBeNull();
    expect(parseScreenshotName('holiday.png')).toBeNull();
  });

  it('identity rotation faces 0°', () => {
    expect(quaternionToYaw(0, 0, 0, 1)).toBeCloseTo(0);
  });
});

describe('session mode', () => {
  it('reads which profile the session is on', () => {
    const text =
      '2026-06-09 18:02:40.483 +01:00|1.0.5.0|Info|application|Session mode: PvpSeason\n' +
      '2026-06-09 19:02:40.483 +01:00|1.0.5.0|Info|application|Session mode: Pve\n';
    expect(parseRaidEvents(text)).toEqual([
      { kind: 'mode', mode: 'season', time: '2026-06-09T18:02:40.483+01:00' },
      { kind: 'mode', mode: 'pve', time: '2026-06-09T19:02:40.483+01:00' },
    ]);
  });
});
