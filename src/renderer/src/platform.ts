// The app's engine on the UI side: game-log state, screenshots, data and settings.
// Native work (windows, files, log scanning/tailing, hotkeys) is done by src-tauri; this
// module talks to it and gives the screens one small API.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import { TarkovDataSource, type DataStorage } from '@shared/dataSource';
import { LogStream, type LogChunk } from '@shared/logStream';
import { StorySource } from '@shared/storySource';
import { QuestImageSource, type GuideImage } from '@shared/questImages';
import { parseScreenshotName, reduceQuestLog } from '@shared/parsers';
import type { TarkovData } from '@shared/tarkovTypes';
import type { GameMode, MainState, QuestEvent, RaidEvent, Settings, Vec3 } from '@shared/types';

const storage: DataStorage = {
  read: (p) => invoke<string | null>('store_read', { path: `cache/${p}` }),
  write: (p, text) => invoke('store_write', { path: `cache/${p}`, text }),
  readSnapshot: (p) => invoke<string | null>('snapshot_read', { path: p }),
};
// Requests go through Rust (no browser CORS limits); the allowed hosts are in capabilities/default.json.
const data = new TarkovDataSource(storage, (url, init) => httpFetch(url, init));
const story = new StorySource(storage, (url, init) => httpFetch(url, init));
const questImages = new QuestImageSource(storage, (url, init) => httpFetch(url, init));

/** What src-tauri's history scan returns: every quest event, tagged with its game mode. */
interface QuestHistory {
  events: (QuestEvent & { mode: GameMode })[];
  currentMode: GameMode | null;
}

const MODES: GameMode[] = ['regular', 'season', 'pve'];
/** Full quest history per mode (newest event per quest). */
let logs: Record<GameMode, Record<string, QuestEvent>> = { regular: {}, season: {}, pve: {} };
let currentMode: GameMode | null = null;
let state: MainState;
const listeners = new Set<(s: MainState) => void>();

const NO_MANUAL: Record<string, boolean> = Object.freeze({}) as Record<string, boolean>;
/** Last derived quest log and what it came from, so unchanged inputs give the same object. */
let lastLog: { all: Record<string, QuestEvent> | null; resetAt: string | undefined; questLog: Record<string, QuestEvent> } = {
  all: null,
  resetAt: undefined,
  questLog: {},
};

/**
 * Recomputes what the screens see: the chosen (or current) mode, minus history before its reset.
 * questLog and manual keep their identity unless they really changed, so the screens don't
 * recompute quests, the route and the map markers on every status update.
 */
function derive() {
  const s = state.settings;
  const viewing: GameMode = s.gameMode === 'auto' ? (currentMode ?? 'regular') : s.gameMode;
  const resetAt = s.questResetAt?.[viewing];
  const all = logs[viewing];
  if (lastLog.all !== all || lastLog.resetAt !== resetAt) {
    const questLog = resetAt ? Object.fromEntries(Object.entries(all).filter(([, e]) => Date.parse(e.time) >= Date.parse(resetAt))) : all;
    lastLog = { all, resetAt, questLog };
  }
  const manual = s.manualQuests?.[viewing];
  state = {
    ...state,
    questLog: lastLog.questLog,
    manual: manual && typeof manual === 'object' ? manual : NO_MANUAL,
    gameMode: state.gameMode.current === currentMode && state.gameMode.viewing === viewing ? state.gameMode : { current: currentMode, viewing },
  };
}

// Log events arrive in bursts: notify the screens once per burst.
let emitTimer: ReturnType<typeof setTimeout> | null = null;
function emit() {
  emitTimer ??= setTimeout(() => {
    emitTimer = null;
    derive();
    for (const l of listeners) l(state);
  }, 30);
}

/** Live quest changes belong to whichever mode the game is in right now. */
function onQuests(events: QuestEvent[]) {
  const mode = currentMode ?? 'regular';
  logs = { ...logs, [mode]: reduceQuestLog(logs[mode], events) };
  state.status = { ...state.status, lastLogEventAt: events[events.length - 1]?.time ?? state.status.lastLogEventAt };
  emit();
}

function onRaid(ev: RaidEvent, replay: boolean) {
  state.status = { ...state.status, lastLogEventAt: ev.time };
  if (ev.kind === 'mode') {
    currentMode = ev.mode;
  } else if (ev.kind === 'matched') {
    state.raid = { mapNameId: ev.mapNameId, inRaid: false, startedAt: null };
    state.player = null;
  } else if (ev.kind === 'started') {
    // When reading back the session's log at startup, a raid that started over an hour ago is over.
    const fresh = !replay || Date.now() - Date.parse(ev.time) < 60 * 60 * 1000;
    state.raid = { ...state.raid, inRaid: fresh, startedAt: ev.time };
  } else {
    state.raid = { ...state.raid, inRaid: false };
  }
  emit();
}

const stream = new LogStream({ quests: onQuests, raid: onRaid });
const seenShots = new Set<string>();

async function startWatchers() {
  const s = state.settings;
  const logsPath = s.logsPath ?? (await invoke<string | null>('find_logs_folder'));
  const shotsPath = s.screenshotsPath ?? (await invoke<string | null>('default_screenshots_folder'));
  logs = { regular: {}, season: {}, pve: {} }; // a different Logs folder means a different history
  currentMode = null;
  const [history, screenshotsFound] = await Promise.all([
    logsPath ? invoke<QuestHistory | null>('logs_watch', { path: logsPath }) : null,
    shotsPath ? invoke<boolean>('screenshots_watch', { path: shotsPath }) : false,
  ]);
  if (history) {
    const byMode: Record<GameMode, QuestEvent[]> = { regular: [], season: [], pve: [] };
    for (const e of history.events) byMode[MODES.includes(e.mode) ? e.mode : 'regular'].push(e);
    // Live events may already have arrived during the scan; keeping the newest per quest merges safely.
    for (const m of MODES) logs[m] = reduceQuestLog(logs[m], byMode[m]);
    currentMode ??= history.currentMode;
  }
  state.status = { ...state.status, logsPath, screenshotsPath: shotsPath, logsFound: !!history, screenshotsFound };
  emit();
}

const ready = (async () => {
  const settings = await invoke<Settings>('settings_get');
  state = {
    settings,
    status: { logsPath: null, screenshotsPath: null, logsFound: false, screenshotsFound: false, lastLogEventAt: null },
    questLog: {},
    manual: {},
    gameMode: { current: null, viewing: 'regular' },
    raid: { mapNameId: null, inRaid: false, startedAt: null },
    player: null,
  };
  derive();
  await Promise.all([
    listen<Settings>('settings', (e) => {
      state.settings = e.payload; // hotkeys change settings natively
      emit();
    }),
    listen<LogChunk>('log-chunk', (e) => stream.push(e.payload)),
    listen<string>('screenshot', (e) => {
      if (seenShots.has(e.payload)) return;
      const pos = parseScreenshotName(e.payload);
      if (!pos) return;
      seenShots.add(e.payload);
      state.player = pos;
      emit();
      // Only files whose name held a position are deleted; other screenshots are left alone.
      if (state.settings.deleteScreenshots !== false) void invoke('screenshot_delete', { name: e.payload });
    }),
  ]);
  await startWatchers();
})();

export const api = {
  getState: async (): Promise<MainState> => {
    await ready;
    derive();
    return state;
  },
  onState: (cb: (s: MainState) => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  /** Checks tarkov.dev once at startup; `force` is the "Check for updates" button. */
  getData: async (force = false): Promise<TarkovData> => (force ? (await data.check()).data : data.get()),
  getSvg: (url: string) => data.svg(url),
  setSettings: async (patch: Partial<Settings>): Promise<Settings> => {
    await ready;
    state.settings = await invoke<Settings>('settings_set', { patch });
    if ('logsPath' in patch || 'screenshotsPath' in patch) await startWatchers();
    emit();
    return state.settings;
  },
  /** Manual override for a quest in the mode being shown (null = follow the logs again). */
  setManualQuest: async (taskId: string, active: boolean | null) => {
    await ready;
    const mode = state.gameMode.viewing;
    const forMode = { ...(state.settings.manualQuests?.[mode] ?? {}) };
    if (active === null) delete forMode[taskId];
    else forMode[taskId] = active;
    await api.setSettings({ manualQuests: { ...state.settings.manualQuests, [mode]: forMode } });
  },
  /** A quest's location photos from its wiki guide; fetched on first hover, then from disk. */
  getQuestImages: (taskId: string, wikiLink: string | null): Promise<GuideImage[]> => questImages.get(taskId, wikiLink),
  /** Story chapters from the wiki (only called while the story checklist is turned on). */
  getStory: (force = false) => story.get(force),
  /** Mark a story chapter started (or not) for the mode being shown. */
  setStoryStarted: async (chapter: string, started: boolean) => {
    await ready;
    const mode = state.gameMode.viewing;
    const set = new Set(state.settings.storyStarted?.[mode] ?? []);
    if (started) set.add(chapter);
    else set.delete(chapter);
    await api.setSettings({ storyStarted: { ...state.settings.storyStarted, [mode]: [...set] } });
  },
  /** In-game photos of where a story chapter starts (its wiki "Requirements"), fetched when first shown. */
  getStoryStartPhotos: (page: string, wikiUrl: string): Promise<GuideImage[]> =>
    questImages.get(`story-${page.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, wikiUrl, 'Requirements'),
  /** Tick a story step done/undone for the mode being shown. */
  setStoryDone: async (stepIds: string[], done: boolean) => {
    await ready;
    const mode = state.gameMode.viewing;
    const set = new Set(state.settings.storyDone?.[mode] ?? []);
    for (const id of stepIds) {
      if (done) set.add(id);
      else set.delete(id);
    }
    await api.setSettings({ storyDone: { ...state.settings.storyDone, [mode]: [...set] } });
  },
  /** Track or stop tracking one or more quests (applies to every game mode). */
  setQuestHidden: async (taskIds: string | string[], hide: boolean) => {
    await ready;
    const set = new Set(state.settings.hiddenQuests ?? []);
    for (const id of typeof taskIds === 'string' ? [taskIds] : taskIds) {
      if (hide) set.add(id);
      else set.delete(id);
    }
    await api.setSettings({ hiddenQuests: [...set] });
  },
  /** After a wipe: forget this mode's quest history up to now (and its manual ticks). */
  startFresh: async () => {
    await ready;
    const mode = state.gameMode.viewing;
    await api.setSettings({
      questResetAt: { ...state.settings.questResetAt, [mode]: new Date().toISOString() },
      manualQuests: { ...state.settings.manualQuests, [mode]: {} },
    });
  },
  undoFresh: async () => {
    await ready;
    const resets = { ...state.settings.questResetAt };
    delete resets[state.gameMode.viewing];
    await api.setSettings({ questResetAt: resets });
  },
  setPlayer: async (position: Vec3 | null) => {
    await ready;
    state.player = position ? { position, yaw: 0, file: 'manual' } : null;
    emit();
  },
  pickFolder: async (title: string): Promise<string | null> => {
    const r = await open({ directory: true, title });
    return typeof r === 'string' ? r : null;
  },
  minimize: () => invoke('window_minimize'),
  close: () => invoke('app_quit'),
};
