import type { GameMode, PlayerPosition, QuestEvent, QuestStatus, RaidEvent } from './types';

// Formats below mirror what TarkovMonitor (the-hideout/TarkovMonitor) parses.
// Log line: "2026-11-20 21:44:48.123 +01:00|1.0.0.0|Info|application|LocationLoaded..."
// Some lines are followed by a multi-line JSON block that starts and ends at column 0.
const LOG_ENTRY =
  /^(?<date>\d{4}-\d{2}-\d{2}) (?<time>\d{2}:\d{2}:\d{2}\.\d{3})(?<tz> [+-]\d{2}:\d{2})?\|(?<message>.+)$\s*(?<json>^\{[\s\S]+?^\})?/gm;

export interface LogEntry {
  time: string;
  message: string;
  json: string | null;
}

export function splitLogEntries(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const m of text.matchAll(LOG_ENTRY)) {
    const g = m.groups!;
    const tz = g.tz ? g.tz.trim() : '';
    const time = `${g.date}T${g.time}${tz}`;
    out.push({ time, message: g.message!, json: g.json ?? null });
  }
  return out;
}

const TASK_STATUS: Record<number, QuestStatus> = { 10: 'started', 11: 'failed', 12: 'finished' };

/** Quest changes from notifications.log ("Got notification | ChatMessageReceived" + JSON). */
export function parseQuestEvents(text: string): QuestEvent[] {
  const events: QuestEvent[] = [];
  for (const entry of splitLogEntries(text)) {
    if (!entry.message.includes('Got notification | ChatMessageReceived') || !entry.json) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(entry.json);
    } catch {
      continue;
    }
    const message = (payload as { message?: { type?: number; templateId?: string } }).message;
    const status = message?.type !== undefined ? TASK_STATUS[message.type] : undefined;
    if (!status || typeof message?.templateId !== 'string') continue;
    // templateId looks like "<taskId> successMessageText" — the task id is the first token.
    const taskId = message.templateId.split(' ')[0];
    if (!taskId) continue;
    events.push({ taskId, status, time: entry.time });
  }
  return events;
}

/** Same mapping as src-tauri/src/history.rs. */
export function normalizeMode(raw: string): GameMode {
  const m = raw.trim().toLowerCase();
  if (m === 'pve') return 'pve';
  if (m === 'pvpseason' || m === 'seasonal' || m === 'szn') return 'season';
  return 'regular';
}

/** Prestiges from backend.log (the server confirming one). `pve` when it was on the PvE server. */
export function parsePrestiges(text: string): { time: string; pve: boolean }[] {
  return splitLogEntries(text)
    .filter((e) => e.message.includes('|backend|<--- Response') && e.message.includes('/client/prestige/obtain'))
    .map((e) => ({ time: e.time, pve: e.message.includes('://gw-pve.') }));
}

/** Raid lifecycle (and session mode) from application.log. */
export function parseRaidEvents(text: string): RaidEvent[] {
  const events: RaidEvent[] = [];
  for (const entry of splitLogEntries(text)) {
    const msg = entry.message;
    if (msg.includes('application|TRACE-NetworkGameCreate profileStatus')) {
      const map = /Location: (?<map>[^,]+)/.exec(msg)?.groups?.map;
      if (!map) continue;
      events.push({
        kind: 'matched',
        mapNameId: map.trim(),
        raidId: /shortId: (?<id>[A-Z0-9]{6})/.exec(msg)?.groups?.id ?? '',
        online: msg.includes('RaidMode: Online'),
        time: entry.time,
      });
    } else if (msg.includes('application|Session mode: ')) {
      const raw = /Session mode: (?<m>[^\s|]+)/.exec(msg)?.groups?.m ?? '';
      events.push({ kind: 'mode', mode: normalizeMode(raw), time: entry.time });
    } else if (msg.includes('application|GameStarted')) {
      events.push({ kind: 'started', time: entry.time });
    } else if (
      msg.includes('Got notification | UserMatchOver') ||
      msg.includes('application|Network game matching aborted') ||
      msg.includes('application|Network game matching cancelled')
    ) {
      events.push({ kind: 'ended', time: entry.time });
    }
  }
  return events;
}

/** Keeps the newest event per task. Events must be given oldest first. */
export function reduceQuestLog(
  log: Record<string, QuestEvent>,
  events: QuestEvent[],
): Record<string, QuestEvent> {
  const next = { ...log };
  for (const e of events) {
    const prev = next[e.taskId];
    if (!prev || Date.parse(e.time) >= Date.parse(prev.time)) next[e.taskId] = e;
  }
  return next;
}

// EFT screenshot name: "2026-11-20[21-44]_-123.45, 4.56, 78.90_0.00000, 0.70711, 0.00000, 0.70711_12.34 (0).png"
const SCREENSHOT_NAME = /\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\]_?(?<position>.+) \(\d+\)\.png$/i;
const SCREENSHOT_POS =
  /(?<x>-?\d+\.\d{2}), (?<y>-?\d+\.\d{2}), (?<z>-?\d+\.\d{2})_?(?<rx>-?\d+\.\d{1,5}), (?<ry>-?\d+\.\d{1,5}), (?<rz>-?\d+\.\d{1,5}), (?<rw>-?\d+\.\d{1,5})/;

export function parseScreenshotName(file: string): PlayerPosition | null {
  const name = file.split(/[\\/]/).pop() ?? file;
  const pos = SCREENSHOT_NAME.exec(name)?.groups?.position;
  if (!pos) return null;
  const g = SCREENSHOT_POS.exec(pos)?.groups;
  if (!g) return null;
  const n = (k: string) => Number.parseFloat(g[k]!);
  return {
    position: { x: n('x'), y: n('y'), z: n('z') },
    yaw: quaternionToYaw(n('rx'), n('ry'), n('rz'), n('rw')),
    file: name,
  };
}

/** Unity quaternion (x, y, z, w) -> heading around the vertical axis in degrees [0, 360). */
export function quaternionToYaw(x: number, y: number, z: number, w: number): number {
  const siny = 2 * (w * y + x * z);
  const cosy = 1 - 2 * (y * y + x * x);
  const deg = (Math.atan2(siny, cosy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** "log_2026.11.20_21-44-48_1.0.0.0" -> sortable timestamp, or null. */
export function logFolderTimestamp(folder: string): number | null {
  const m = /log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{2})-(\d{2})/.exec(folder);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  return new Date(y!, mo! - 1, d!, h!, mi!, s!).getTime();
}
