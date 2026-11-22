// Game-world position as used by tarkov.dev and EFT screenshots (y is height).
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type QuestStatus = 'started' | 'failed' | 'finished';

/** One quest change read from EFT's notifications log. */
export interface QuestEvent {
  taskId: string;
  status: QuestStatus;
  time: string; // ISO timestamp from the log line
}

export type RaidEvent =
  | { kind: 'matched'; mapNameId: string; raidId: string; online: boolean; time: string }
  | { kind: 'started'; time: string }
  | { kind: 'ended'; time: string }
  /** Which profile the game session is on (separate quest progress per mode). */
  | { kind: 'mode'; mode: GameMode; time: string };

/** EFT keeps separate quest progress for PvP, PvP Season and PvE. */
export type GameMode = 'regular' | 'season' | 'pve';
export const GAME_MODE_LABEL: Record<GameMode, string> = { regular: 'PvP', season: 'PvP Season', pve: 'PvE' };

export interface PlayerPosition {
  position: Vec3;
  /** Facing in degrees, 0 = +z ("north" on tarkov.dev maps before rotation). */
  yaw: number;
  file: string;
}

export type WindowMode = 'overlay' | 'windowed';

export interface Settings {
  mode: WindowMode;
  /** Overlay only: ignore the mouse so clicks reach the game. */
  clickThrough: boolean;
  opacity: number;
  logsPath: string | null;
  screenshotsPath: string | null;
  faction: 'pmc' | 'scav';
  /** Finish the route at the nearest extract. */
  routeToExtract: boolean;
  /** Delete a screenshot once its position has been read (they're only taken to get it). */
  deleteScreenshots: boolean;
  /** Show location photos from the wiki when hovering a quest marker. */
  questPhotos: boolean;
  /** Map marker colors chosen in Settings (hex), keyed like icons.ts DEFAULT_COLORS; missing = default. */
  markerColors?: Record<string, string>;
  /** Which mode's quests to show; 'auto' follows the game. */
  gameMode: 'auto' | GameMode;
  /** Per mode: ignore quest history before this time (set after a wipe). */
  questResetAt: Partial<Record<GameMode, string>>;
  /** Per mode: story chapters marked as started (names). Others needing a start show how to start them. */
  storyStarted?: Partial<Record<GameMode, string[]>>;
  /** Per mode: objective ids you ticked (the game logs only record whole quests, not objectives). */
  objectivesDone?: Partial<Record<GameMode, string[]>>;
  /** Show the main story chapters (from the wiki) as a checklist. Off: the wiki isn't contacted. */
  showStory: boolean;
  /** Per mode: story step ids ticked off (story progress is separate per profile). */
  storyDone: Partial<Record<GameMode, string[]>>;
  /** Quests the user doesn't want to see (in any mode). They stay active, just not shown. */
  hiddenQuests: string[];
  /** Per mode manual overrides on top of what the logs say: taskId -> active? */
  manualQuests: Partial<Record<GameMode, Record<string, boolean>>>;
  overlayBounds?: { x: number; y: number; width: number; height: number };
  windowedBounds?: { x: number; y: number; width: number; height: number };
}

export interface AppStatus {
  logsPath: string | null;
  screenshotsPath: string | null;
  logsFound: boolean;
  screenshotsFound: boolean;
  lastLogEventAt: string | null;
}

/** Everything the renderer needs pushed from the main process. */
export interface MainState {
  settings: Settings;
  status: AppStatus;
  /** Latest status per task id for the mode being shown (history before its reset dropped). */
  questLog: Record<string, QuestEvent>;
  /** Manual overrides for the mode being shown. */
  manual: Record<string, boolean>;
  gameMode: { current: GameMode | null; viewing: GameMode };
  raid: {
    mapNameId: string | null;
    inRaid: boolean;
    startedAt: string | null;
  };
  player: PlayerPosition | null;
}
