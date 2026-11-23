import { parsePrestiges, parseQuestEvents, parseRaidEvents } from './parsers';
import type { QuestEvent, RaidEvent } from './types';

/** A piece of a game log file, as streamed by the native side (src-tauri/src/logs.rs). */
export interface LogChunk {
  file: string;
  /** backend: only prestige lines are sent (src-tauri filters them). */
  kind: 'application' | 'notifications' | 'backend';
  text: string;
  /** True while replaying history at startup (not live game events). */
  replay: boolean;
  /** The file is being read from its start (new file, or it was truncated). */
  reset: boolean;
}

const ENTRY_START = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/gm;

/**
 * Splits off a trailing entry that may still be being written. An entry is held back
 * if it doesn't end in a newline or has an unclosed JSON block.
 */
export function splitComplete(text: string): [complete: string, rest: string] {
  const starts = [...text.matchAll(ENTRY_START)].map((m) => m.index!);
  if (starts.length === 0) return ['', text];
  const lastStart = starts[starts.length - 1]!;
  const last = text.slice(lastStart);
  const opensJson = /^\{/m.test(last);
  const closesJson = /^\}\s*$/m.test(last);
  const done = last.endsWith('\n') && (!opensJson || closesJson);
  return done ? [text, ''] : [text.slice(0, lastStart), last];
}

/** Turns raw log chunks into quest and raid events, buffering half-written entries per file. */
export class LogStream {
  private pending = new Map<string, string>();

  constructor(
    private readonly handlers: {
      quests: (events: QuestEvent[], replay: boolean) => void;
      raid: (event: RaidEvent, replay: boolean) => void;
      prestige?: (event: { time: string; pve: boolean }, replay: boolean) => void;
    },
  ) {}

  push(chunk: LogChunk): void {
    const before = chunk.reset ? '' : (this.pending.get(chunk.file) ?? '');
    // History replays are whole files: nothing will follow, so parse everything.
    const [complete, rest] = chunk.replay && chunk.kind === 'notifications' ? [before + chunk.text, ''] : splitComplete(before + chunk.text);
    this.pending.set(chunk.file, rest);
    if (!complete) return;
    if (chunk.kind === 'backend') {
      for (const ev of parsePrestiges(complete)) this.handlers.prestige?.(ev, chunk.replay);
      return;
    }
    if (chunk.kind === 'notifications') {
      const events = parseQuestEvents(complete);
      if (events.length) this.handlers.quests(events, chunk.replay);
    }
    // Raid events live in application.log; UserMatchOver also shows up in notifications.
    for (const ev of parseRaidEvents(complete)) this.handlers.raid(ev, chunk.replay);
  }
}
