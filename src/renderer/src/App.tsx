import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  activeTasks,
  bringList,
  displayFor,
  extractsFor,
  questStates,
  MARKER_LABEL,
  isTransitTask,
  killCount,
  mapByNameId,
  mapForPosition,
  nearestSpawn,
  objectivesForMap,
  blackDivisionZones,
  isRareMap,
  playableMaps,
  playerSpawns,
  type BotZone,
  type MapObjective,
} from '@shared/questLogic';
import { mapPois, type MapPoi } from '@shared/mapPois';
import { defaultFloor, floorOf, floorSequence, floorsFor, type Floor } from '@shared/floors';
import { imagesForObjective, type GuideImage } from '@shared/questImages';
import { solveRoute } from '@shared/route';
import { activeSteps, chapterState, stepsUpTo, storyForMap, type ChapterState, type StoryChapter, type StoryStart } from '@shared/story';
import type { ApiTask, TarkovData } from '@shared/tarkovTypes';
import { GAME_MODE_LABEL, type GameMode, type MainState, type Settings, type Vec3 } from '@shared/types';
import { COLOR_GROUPS, colorsFrom, DEFAULT_COLORS, exfilGlyph, glyph, type ColorKey } from './icons';
import { MapView } from './MapView';
import { appVersion, checkForUpdate, installUpdate, type UpdateState } from './updates';
import type { Update } from '@tauri-apps/plugin-updater';
import { api } from './platform';

type Tab = 'map' | 'quests' | 'loadout' | 'story' | 'settings';
// Window dragging: Tauri moves the window from elements marked data-tauri-drag-region.

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function App() {
  const [main, setMain] = useState<MainState | null>(null);
  const [data, setData] = useState<TarkovData | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  // App updates: one check a few seconds after start (after the quest data), or from Settings.
  const [appUpdate, setAppUpdate] = useState<UpdateState>({ kind: 'idle' });
  const [version, setVersion] = useState('');
  useEffect(() => {
    void appVersion().then(setVersion, () => undefined);
    const t = setTimeout(() => void checkForUpdate().then(setAppUpdate), 4000);
    return () => clearTimeout(t);
  }, []);
  const checkApp = useCallback(async () => {
    setAppUpdate({ kind: 'checking' });
    setAppUpdate(await checkForUpdate());
  }, []);
  const runUpdate = useCallback(async (u: Update) => {
    setAppUpdate({ kind: 'downloading', percent: 0 });
    try {
      await installUpdate(u, (percent) => setAppUpdate({ kind: 'downloading', percent }));
    } catch (e) {
      setAppUpdate({ kind: 'error', message: `Update failed: ${(e as Error)?.message ?? String(e)}` });
    }
  }, []);
  const [loading, setLoading] = useState(false);
  const [mapId, setMapId] = useState<string | null>(() => load('mapId', null));
  const [tab, setTab] = useState<Tab>('map');
  // Settings opens from the cogwheel; closing it returns to the tab you were on.
  const lastTab = useRef<Tab>('map');
  const toggleSettings = () => {
    if (tab === 'settings') setTab(lastTab.current);
    else {
      lastTab.current = tab;
      setTab('settings');
    }
  };

  const [pickingStart, setPickingStart] = useState(false);
  const [showSpawns, setShowSpawns] = useState<boolean>(() => load('showSpawns', true));
  const [showExtracts, setShowExtracts] = useState<boolean>(() => load('showExtracts', true));
  const [showBd, setShowBd] = useState<boolean>(() => load('showBd', true));
  const [showFix, setShowFix] = useState<boolean>(() => load('showFix', true));
  const [showKeys, setShowKeys] = useState<boolean>(() => load('showKeys', true));
  const [svgText, setSvgText] = useState<string | null>(null);
  const [svgError, setSvgError] = useState<string | null>(null);

  useEffect(() => {
    void api.getState().then(setMain);
    return api.onState(setMain);
  }, []);

  const fetchData = useCallback(async (force: boolean) => {
    setLoading(true);
    try {
      setData(await api.getData(force));
      setDataError(null);
    } catch (e) {
      setDataError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void fetchData(false), [fetchData]);

  // Main story: only loaded (and the wiki only contacted) while the checklist is turned on.
  const [story, setStory] = useState<{ chapters: StoryChapter[]; fetchedAt: string } | null>(null);
  const [storyError, setStoryError] = useState<string | null>(null);
  const showStory = !!main?.settings.showStory;
  const loadStory = useCallback(async (force: boolean) => {
    try {
      setStory(await api.getStory(force));
      setStoryError(null);
    } catch (e) {
      setStoryError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (showStory) void loadStory(false);
  }, [showStory, loadStory]);
  const refreshAll = useCallback(() => {
    void fetchData(true);
    if (showStory) void loadStory(true);
  }, [fetchData, loadStory, showStory]);

  // Follow the game: when a raid is matched, switch to that map.
  const raidMapNameId = main?.raid.mapNameId ?? null;
  useEffect(() => {
    if (!data || !raidMapNameId) return;
    // Only maps in the list (the Ground Zero tutorial isn't, so the picker never goes blank).
    const m = mapByNameId(playableMaps(data.maps, data.display), raidMapNameId);
    if (m) setMapId(m.id);
  }, [data, raidMapNameId]);
  useEffect(() => save('mapId', mapId), [mapId]);
  useEffect(() => save('showSpawns', showSpawns), [showSpawns]);
  useEffect(() => save('showBd', showBd), [showBd]);
  useEffect(() => save('showFix', showFix), [showFix]);
  useEffect(() => save('showKeys', showKeys), [showKeys]);
  useEffect(() => save('showExtracts', showExtracts), [showExtracts]);

  // Objectives you ticked, saved per game mode: the logs only record whole quests, so these
  // survive restarts, raids and map changes until the quest itself is finished.
  const objectivesDone = main?.settings.objectivesDone;
  const viewingMode = main?.gameMode.viewing;
  const done = useMemo(() => new Set(viewingMode ? (objectivesDone?.[viewingMode] ?? []) : []), [objectivesDone, viewingMode]);

  const settings = main?.settings;
  const maps = useMemo(() => (data ? playableMaps(data.maps, data.display) : []), [data]);
  const map = maps.find((m) => m.id === mapId) ?? null;
  const display = useMemo(() => (data && map ? displayFor(data.display, map) : null), [data, map]);

  useEffect(() => {
    setSvgText(null);
    setSvgError(null);
    if (!display?.svgPath) return;
    let alive = true;
    api.getSvg(display.svgPath).then(
      (t) => alive && setSvgText(t),
      (e: Error) => alive && setSvgError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [display]);

  // Only recomputed when quest progress changes, not on every status update (that would re-run
  // the route solver and redraw every map marker).
  const questLog = main?.questLog;
  const manual = main?.manual;
  const active = useMemo(
    () => (data && questLog && manual ? activeTasks(data.tasks, questLog, manual) : []),
    [data, questLog, manual],
  );
  // Quests the user chose not to track: still active in the game, just not shown anywhere.
  const hidden = useMemo(() => new Set(main?.settings.hiddenQuests ?? []), [main?.settings.hiddenQuests]);
  const tracked = useMemo(() => active.filter((t) => !hidden.has(t.id)), [active, hidden]);
  const objectives = useMemo(() => (map ? objectivesForMap(tracked, map.id) : []), [tracked, map]);
  const storyDone = useMemo(
    () => new Set(main?.settings.storyDone?.[main.gameMode.viewing] ?? []),
    [main?.settings.storyDone, main?.gameMode.viewing],
  );
  const storyStarted = useMemo(
    () => new Set(main?.settings.storyStarted?.[main.gameMode.viewing] ?? []),
    [main?.settings.storyStarted, main?.gameMode.viewing],
  );
  const storyHere = useMemo(
    () => (showStory && story && map ? storyForMap(story.chapters, map.normalizedName, storyDone, storyStarted) : []),
    [showStory, story, map, storyDone, storyStarted],
  );
  const hiddenHere = useMemo(
    () => (map ? active.filter((t) => hidden.has(t.id) && objectivesForMap([t], map.id).length > 0) : []),
    [active, hidden, map],
  );
  const required = useMemo(() => objectives.filter((o) => !o.objective.optional), [objectives]);
  const colors = useMemo(() => colorsFrom(main?.settings.markerColors), [main?.settings.markerColors]);
  const bring = useMemo(() => bringList(objectives), [objectives]);
  const extracts = useMemo(() => (map && settings ? extractsFor(map, settings.faction) : []), [map, settings]);
  const spawns = useMemo(() => (map && settings && showSpawns ? playerSpawns(map, settings.faction) : []), [map, settings, showSpawns]);
  const bdZones = useMemo(() => (map ? blackDivisionZones(map) : []), [map]);
  const pois = useMemo(() => (map ? mapPois(map.normalizedName) : []), [map]);
  const shownPois = useMemo(() => pois.filter((p) => (isFixPoi(p) ? showFix : showKeys)), [pois, showFix, showKeys]);

  const routeStart: Vec3 | null = main?.player?.position ?? null;
  const route = useMemo(() => {
    if (!routeStart || !settings) return null;
    const targets = required
      .filter((o) => !done.has(o.objective.id) && o.locations.length > 0)
      .map((o) => ({ id: o.objective.id, options: o.locations }));
    const ends = settings.routeToExtract ? extracts.map((e) => ({ id: e.id, point: e.position })) : [];
    return solveRoute(routeStart, targets, ends);
  }, [routeStart, required, done, extracts, settings]);
  const spawn = map && routeStart && settings ? nearestSpawn(map, routeStart, settings.faction) : null;
  // Hiding extracts still keeps the one the route ends at, so the route never points at nothing.
  const shownExtracts = useMemo(
    () => (showExtracts ? extracts : extracts.filter((e) => e.id === route?.end?.id)),
    [showExtracts, extracts, route],
  );

  // Multi-level maps (Labs, Factory, Reserve…): which floor is drawn. Starts on the map's default
  // floor, and follows you to your floor whenever a screenshot gives a new position.
  const floors = useMemo(() => (display ? floorsFor(display) : []), [display]);
  const [floorId, setFloorId] = useState<string | null>(null);
  useEffect(() => setFloorId(defaultFloor(floors)?.id ?? null), [floors]);
  const overlayMode = main?.settings.mode === 'overlay';
  const shot = main?.player && main.player.file !== 'manual' ? main.player : null;
  const shotKey = shot ? `${shot.file}|${shot.position.x}|${shot.position.y}|${shot.position.z}` : null;
  // A new screenshot: show the map you're on. The game log names the raid's map; if the position
  // fits it and another map is picked, switch (the map view then centres on you and pulses).
  useEffect(() => {
    if (!shot || !data) return;
    const raidMap = raidMapNameId ? mapByNameId(maps, raidMapNameId) : null;
    const target = mapForPosition(maps, data.display, shot.position, { raidMapId: raidMap?.id, currentMapId: mapId });
    if (target && target.id !== mapId) setMapId(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotKey, data]);
  // A new screenshot in the overlay: show the map, wherever you were.
  useEffect(() => {
    if (shotKey && overlayMode && (tab === 'quests' || tab === 'loadout' || tab === 'story')) setTab('map');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotKey]);
  useEffect(() => {
    if (shot && floors.length) setFloorId(floorOf(shot.position, floors)!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotKey, floors]);
  const floor = floors.find((f) => f.id === floorId) ?? defaultFloor(floors);
  // Wiki location photos for a hovered marker: this map's photos, best match to the objective first.
  const mapKey = map?.normalizedName ?? null;
  const photosOn = settings?.questPhotos !== false;
  const photosFor = useCallback(
    async (o: MapObjective) =>
      mapKey ? imagesForObjective(await api.getQuestImages(o.task.id, o.task.wikiLink), mapKey, o.objective.description) : [],
    [mapKey],
  );
  /** "2nd Floor" for objectives off the ground (all floors their spots are on). */
  const floorLabel = useCallback(
    (o: MapObjective) => {
      if (!floors.length) return '';
      const names = [...new Set(o.locations.map((l) => floorOf(l, floors)!))];
      return names.every((f) => f.base) ? '' : names.map((f) => f.name).join(' / ');
    },
    [floors],
  );

  // Spawn points / kill zones kept on the map, per objective (marker click or quest-list button).
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  useEffect(() => setPinned(new Set()), [mapId]);
  const togglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleDone = useCallback((id: string) => {
    void api.setObjectivesDone([id], !done.has(id));
  }, [done]);
  const onPickStart = useCallback((p: Vec3) => {
    void api.setPlayer(p);
    setPickingStart(false);
  }, []);

  if (!main || !settings) return <div className="shell loading">Starting…</div>;
  const overlay = settings.mode === 'overlay';
  const set = (patch: Partial<Settings>) => void api.setSettings(patch);

  const mapPanel = (
    <div className="map-panel">
      {display ? (
        <>
          <MapView
            display={display}
            svgText={svgText}
            objectives={objectives}
            done={done}
            route={route}
            routeStart={routeStart}
            player={main.player}
            extracts={shownExtracts}
            spawns={spawns}
            bdZones={showBd ? bdZones : NO_ZONES}
            pois={shownPois}
            colors={colors}
            floors={floors}
            floor={floor}
            onFloor={setFloorId}
            photosFor={photosOn ? photosFor : undefined}
            pinned={pinned}
            onTogglePin={togglePin}
            pickingStart={pickingStart}
            onPickStart={onPickStart}
            onToggleDone={toggleDone}
          />
          <div className="map-hud">
            <RouteSummary route={route} spawn={spawn} objectives={required} pickingStart={pickingStart} routeStart={routeStart} floors={floors} compact={overlay} />
            <div className="hud-buttons hud-group">
              <button
                className={`hud-ic${showSpawns ? ' on' : ''}`}
                onClick={() => setShowSpawns((v) => !v)}
                title="Spawns: show or hide spawn points for your side"
                aria-label="Spawns"
                dangerouslySetInnerHTML={{ __html: IC_SPAWNS }}
              />
              {bdZones.length > 0 && (
                <button
                  className={`hud-ic${showBd ? ' on' : ''}`}
                  onClick={() => setShowBd((v) => !v)}
                  title="Black Division: show or hide their spawn zones and squad sizes"
                  aria-label="Black Division"
                  dangerouslySetInnerHTML={{ __html: IC_BD }}
                />
              )}
              {pois.some(isFixPoi) && (
                <button
                  className={`hud-ic${showFix ? ' on' : ''}`}
                  onClick={() => setShowFix((v) => !v)}
                  title="Fix: electrical panels to repair, the drain button and where Toolsets spawn (approximate, from the wiki map)"
                  aria-label="Panels and Toolsets"
                  dangerouslySetInnerHTML={{ __html: IC_FIX }}
                />
              )}
              {pois.some((p) => !isFixPoi(p)) && (
                <button
                  className={`hud-ic${showKeys ? ' on' : ''}`}
                  onClick={() => setShowKeys((v) => !v)}
                  title="Keys: where keys and charges spawn, and the doors they open (approximate, from the wiki map)"
                  aria-label="Keys"
                  dangerouslySetInnerHTML={{ __html: IC_POI }}
                />
              )}
              <button
                className={`hud-ic${showExtracts ? ' on' : ''}`}
                onClick={() => setShowExtracts((v) => !v)}
                title="Extracts: show or hide extracts (the one your route ends at stays visible)"
                aria-label="Extracts"
                dangerouslySetInnerHTML={{ __html: IC_EXTRACTS }}
              />
              <button
                className={`hud-ic${pickingStart ? ' on' : ''}`}
                onClick={() => setPickingStart((v) => !v)}
                title={pickingStart ? 'Click the map where you are' : 'Set start: click the map where you are'}
                aria-label="Set start"
                dangerouslySetInnerHTML={{ __html: IC_START }}
              />
              {routeStart && (
                <button className="hud-ic" onClick={() => void api.setPlayer(null)} title="Clear your position" aria-label="Clear" dangerouslySetInnerHTML={{ __html: IC_CLEAR }} />
              )}
            </div>
          </div>
          {svgError && <div className="map-msg">Map image failed to load: {svgError}</div>}
        </>
      ) : (
        <div className="empty">{map ? 'No drawable map for this location.' : 'Pick a map to start.'}</div>
      )}
    </div>
  );

  const questCount = new Set(objectives.map((o) => o.task.id)).size;
  const tabsNav = (
    <nav className="tabs">
      {(overlay ? (['map', 'quests', 'loadout', 'story'] as Tab[]) : (['map', 'loadout', 'story'] as Tab[])).map((t) => (
        <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
          {t === 'map' && overlay ? 'Map' : t === 'map' || t === 'quests' ? 'Quests' : t === 'loadout' ? 'Bring' : 'Story'}
          {(t === 'quests' || (t === 'map' && !overlay)) && questCount > 0 && <span className="tab-n">{questCount}</span>}
          {t === 'loadout' && bring.length > 0 && <span className="tab-n">{bring.length}</span>}
        </button>
      ))}
    </nav>
  );
  const side = (
    <div className="side">
      {!overlay && tabsNav}
      {tab === 'quests' || (!overlay && tab === 'map') ? (
        <QuestPanel
          objectives={objectives}
          done={done}
          onToggle={toggleDone}
          mapName={map?.name}
          hiddenHere={hiddenHere}
          onHide={(id, hide) => void api.setQuestHidden(id, hide)}
          story={storyHere}
          onStoryDone={(ids, d) => void api.setStoryDone(d && story ? withEarlierSteps(story.chapters, ids) : ids, d)}
          colors={colors}
          floorLabel={floorLabel}
          pinned={pinned}
          onTogglePin={togglePin}
          mapKey={map?.normalizedName}
        />
      ) : null}
      {tab === 'loadout' && <LoadoutPanel bring={bring} />}
      {tab === 'story' && (
        <StoryPanel
          settings={settings}
          set={set}
          story={story}
          storyError={storyError}
          storyDone={storyDone}
          storyStarted={storyStarted}
        />
      )}
      {tab === 'settings' && data && (
        <SettingsPanel
          main={main}
          tasks={data.tasks}
          set={set}
          refresh={refreshAll}
          loading={loading}
          data={data}
          version={version}
          appUpdate={appUpdate}
          onCheckApp={() => void checkApp()}
          onInstallApp={(u) => void runUpdate(u)}
        />
      )}
    </div>
  );

  return (
    <div
      className={`shell ${overlay ? 'overlay' : 'windowed'}${settings.clickThrough && overlay ? ' ghost' : ''}`}
      style={overlay ? { opacity: settings.opacity } : undefined}
    >
      <header className="bar" data-tauri-drag-region={overlay ? true : undefined}>
        <span className="brand" title="Escape Artist" data-tauri-drag-region={overlay ? true : undefined}>
          {overlay ? 'EA' : 'Escape Artist'}
        </span>
        <select className="no-drag" value={mapId ?? ''} onChange={(e) => setMapId(e.target.value || null)}>
          <option value="">Choose map…</option>
          {maps.map((m, i) => [
            // Rarely played maps (Terminal) sit at the end, under a divider.
            isRareMap(m) && !isRareMap(maps[i - 1] ?? m) ? (
              <option key="rare" disabled>
                ──────────
              </option>
            ) : null,
            <option key={m.id} value={m.id}>
              {m.name}
            </option>,
          ])}
        </select>
        <span className="pill mode" title="Quests shown are for this game mode (change in Settings)">
          {GAME_MODE_LABEL[main.gameMode.viewing]}
        </span>
        {main.raid.inRaid && <span className="pill live">In raid</span>}
        <span className="grow" data-tauri-drag-region={overlay ? true : undefined} />
        <button
          className={`no-drag icon gear${tab === 'settings' ? ' on' : ''}`}
          title={tab === 'settings' ? 'Close settings' : 'Settings'}
          aria-label="Settings"
          onClick={toggleSettings}
          dangerouslySetInnerHTML={{ __html: GEAR }}
        />
        <button
          className="no-drag icon"
          title={overlay ? 'Switch to windowed app (Ctrl+Alt+O)' : 'Switch to transparent overlay (Ctrl+Alt+O)'}
          onClick={() => set({ mode: overlay ? 'windowed' : 'overlay' })}
        >
          {overlay ? '▭' : '◫'}
        </button>
        {overlay && (
          <button
            className={`no-drag icon${settings.clickThrough ? ' on' : ''}`}
            title="Click-through: clicks pass to the game (toggle with Ctrl+Alt+L)"
            onClick={() => set({ clickThrough: !settings.clickThrough })}
          >
            ⌖
          </button>
        )}
        {overlay && (
          <>
            <button className="no-drag icon" title="Minimise" onClick={() => void api.minimize()}>
              –
            </button>
            <button className="no-drag icon" title="Quit" onClick={() => void api.close()}>
              ✕
            </button>
          </>
        )}
      </header>

      {appUpdate.kind === 'available' && (
        <div className="banner update-banner">
          Escape Artist {appUpdate.update.version} is available.{' '}
          <button onClick={() => void runUpdate(appUpdate.update)}>Update now</button>{' '}
          <button onClick={() => setAppUpdate({ kind: 'idle' })}>Later</button>
        </div>
      )}
      {appUpdate.kind === 'downloading' && (
        <div className="banner update-banner">Downloading the update{appUpdate.percent !== null ? ` · ${appUpdate.percent}%` : '…'} The app restarts when it's done.</div>
      )}
      {(dataError || (data && (data.source === 'cache' || data.source === 'snapshot'))) && (
        <div className="banner" title={data?.stale ?? undefined}>
          {dataError
            ? `Quest data unavailable: ${dataError}`
            : `tarkov.dev can't be reached — using ${data!.source === 'snapshot' ? 'the data built into the app' : 'saved data'} from ${ago(data!.fetchedAt)}.`}{' '}
          <button onClick={() => void fetchData(true)} disabled={loading}>
            {loading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}
      {!dataError && !data && <div className="banner">Loading quest data from tarkov.dev…</div>}

      {overlay && tabsNav}

      <main className="body">
        {overlay ? (tab === 'map' ? mapPanel : side) : (
          <>
            {mapPanel}
            {side}
          </>
        )}
      </main>

      <footer className="status">
        <StatusLine main={main} activeCount={data ? active.length : null} hiddenCount={data ? active.length - tracked.length : 0} />
      </footer>
      {settings.clickThrough && overlay && <div className="ghost-hint">Click-through on · Ctrl+Alt+L to interact</div>}
    </div>
  );
}

function RouteSummary(p: {
  route: ReturnType<typeof solveRoute> | null;
  spawn: { name: string | null; distance: number } | null;
  objectives: MapObjective[];
  pickingStart: boolean;
  routeStart: Vec3 | null;
  floors: Floor[];
  /** Overlay: no room for a summary; the route line on the map says it all. */
  compact?: boolean;
}) {
  // The floors the route walks through, e.g. "First Level → Technical → First Level".
  const seq =
    p.route && p.routeStart && p.floors.length && !p.compact
      ? floorSequence([p.routeStart, ...p.route.stops.map((s) => s.point), ...(p.route.end ? [p.route.end.point] : [])], p.floors)
      : [];
  if (!p.route) {
    return (
      <div className="hud-text">
        {p.objectives.length
          ? 'In raid, press your screenshot key (PrtSc) to plot the route from where you are.'
          : 'No active quest objectives on this map.'}
      </div>
    );
  }
  // Overlay: keep the map clear; an empty spacer keeps the buttons on the right.
  if (p.compact) return <div className="grow" />;
  return (
    <div className="hud-text" title={seq.length > 1 ? `Floors: ${seq.map((f) => f.name).join(' → ')}` : undefined}>
      {p.spawn && p.spawn.distance < 60 && p.spawn.name && <b>{p.spawn.name} · </b>}
      {p.route.stops.length} stop{p.route.stops.length === 1 ? '' : 's'}
      {p.route.end ? ' to extract' : ''} · ~{Math.round(p.route.distance).toLocaleString()} m
      {!p.route.exact && ' (approx.)'}
      {seq.length > 1 && <span className="muted"> · {seq.length} floors</span>}
    </div>
  );
}

const EYE_OFF =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.1 3.7M6.6 6.6C3.7 8.4 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

/** Purple "K": this quest is needed for the Kappa container. */
function KappaBadge({ task }: { task: ApiTask }) {
  return task.kappaRequired ? (
    <span className="kappa" title="Required for Kappa">
      K
    </span>
  ) : null;
}

const EYE_ON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

function QuestPanel(p: {
  objectives: MapObjective[];
  done: Set<string>;
  onToggle: (id: string) => void;
  mapName?: string;
  hiddenHere: ApiTask[];
  onHide: (taskIds: string | string[], hide: boolean) => void;
  story: ReturnType<typeof storyForMap>;
  onStoryDone: (stepIds: string[], done: boolean) => void;
  colors: Record<ColorKey, string>;
  floorLabel: (o: MapObjective) => string;
  pinned: Set<string>;
  onTogglePin: (objectiveId: string) => void;
  /** tarkov.dev normalizedName of the map shown, for the story start photos. */
  mapKey?: string;
}) {
  const storySection = p.story.length > 0 && (
    <section className="story">
      <h4>Main story on {p.mapName}</h4>
      {p.story.map(({ chapter, steps, starts }) => (
        <div key={chapter.name} className="story-chapter">
          <div className="story-name">
            {chapter.name} {starts.length > 0 && <span className="story-state ns">Not started</span>}
          </div>
          {starts.length > 0 && <StoryStartGuide chapter={chapter} starts={starts} mapKey={p.mapKey} />}
          {steps.map((s) => (
            <label key={s.id} className="obj" style={{ paddingLeft: s.depth * 16 }}>
              <input type="checkbox" checked={false} onChange={() => p.onStoryDone([s.id], true)} />
              <span>
                {s.text}
                {s.optional && <em> (optional)</em>}
                {s.branch && <span className="muted"> · {s.branch}</span>}
              </span>
            </label>
          ))}
        </div>
      ))}
      <p className="muted credit">Story steps from the Escape from Tarkov Wiki (CC BY-SA). Not on the map: the wiki has no positions.</p>
    </section>
  );
  const byTask = new Map<string, { task: ApiTask; items: MapObjective[] }>();
  for (const o of p.objectives) {
    const g = byTask.get(o.task.id) ?? { task: o.task, items: [] };
    g.items.push(o);
    byTask.set(o.task.id, g);
  }
  if (!p.mapName) return <div className="empty">Pick a map to see your quests there.</div>;
  const hiddenList = p.hiddenHere.length > 0 && (
    <section className="hidden-quests">
      <h4>Not tracked on {p.mapName}</h4>
      {p.hiddenHere.map((t) => (
        <div key={t.id} className="row">
          <span className="grow muted">
            {t.name} <KappaBadge task={t} />
          </span>
          <button onClick={() => p.onHide(t.id, false)}>Show</button>
        </div>
      ))}
    </section>
  );
  if (byTask.size === 0)
    return (
      <div className="list">
        <div className="empty">No tracked quests on {p.mapName}. If that's wrong, check Settings → My quests.</div>
        {storySection}
        {hiddenList}
      </div>
    );
  const renderQuest = ({ task, items }: { task: ApiTask; items: MapObjective[] }) => (
    <section key={task.id} className="quest">
      <h3 className="quest-head">
        <span className="grow">
          {task.name} <KappaBadge task={task} /> <small>{task.trader.name}</small>
        </span>
        <span className="q-prog" title="Objectives ticked on this map">
          {items.filter((o) => p.done.has(o.objective.id)).length}/{items.length}
        </span>
        <button
          className="icon hide-btn"
          title="Don't track this quest (hides it from the map, list, Bring list and route)"
          onClick={() => p.onHide(task.id, true)}
          dangerouslySetInnerHTML={{ __html: EYE_OFF }}
        />
      </h3>
      {items.map((o) => (
        <label key={o.objective.id} className={`obj${p.done.has(o.objective.id) ? ' done' : ''}`}>
          <input type="checkbox" checked={p.done.has(o.objective.id)} onChange={() => p.onToggle(o.objective.id)} />
          <span className="obj-ic" title={MARKER_LABEL[o.kind]} style={{ color: p.colors[o.kind] }} dangerouslySetInnerHTML={{ __html: glyph(o.kind, 14) }} />
          <span>
            {killCount(o.objective) !== null && (
              <span className="obj-kills" title={`${killCount(o.objective)} kills needed`}>
                ×{killCount(o.objective)}
              </span>
            )}
            {o.objective.description}
            {o.objective.optional && <em> (optional)</em>}
            {o.locations.length === 0 && <em className="muted"> · no map position</em>}
            {p.floorLabel(o) && <span className="obj-floor"> · {p.floorLabel(o)}</span>}
            {(o.areas.length > 0 || o.spots.flat().length > 1) && (
              <button
                className={`obj-pin${p.pinned.has(o.objective.id) ? ' on' : ''}`}
                title={o.areas.length > 0 ? 'Show the kill zone on the map' : 'Show every spawn point on the map'}
                onClick={(ev) => {
                  ev.preventDefault(); // inside the objective's label: don't tick it off
                  p.onTogglePin(o.objective.id);
                }}
              >
                {o.areas.length > 0 ? 'Zone' : `Spawns (${o.spots.flat().length})`}
              </button>
            )}
          </span>
        </label>
      ))}
    </section>
  );
  const groups = [...byTask.values()];
  const regular = groups.filter((g) => !isTransitTask(g.task));
  const transit = groups.filter((g) => isTransitTask(g.task));
  return (
    <div className="list">
      {regular.map(renderQuest)}
      {regular.length === 0 && <div className="empty">No other tracked quests on {p.mapName}.</div>}
      {transit.length > 0 && (
        <div className="transit-quests">
          <h4 className="quest-head">
            <span className="grow">Transit quests ({transit.length})</span>
            <button
              title="Stop tracking every transit quest on this map (bring them back under Not tracked or Settings → My quests)"
              onClick={() => p.onHide(transit.map((g) => g.task.id), true)}
            >
              Don't track these
            </button>
          </h4>
          {transit.map(renderQuest)}
        </div>
      )}
      {storySection}
      {hiddenList}
    </div>
  );
}

function LoadoutPanel(p: { bring: ReturnType<typeof bringList> }) {
  if (p.bring.length === 0) return <div className="empty">Nothing special to bring for your quests on this map.</div>;
  const titles = { place: 'Items to place', key: 'Keys', use: 'Items to use', weapon: 'Required weapons' } as const;
  return (
    <div className="list">
      {(Object.keys(titles) as (keyof typeof titles)[]).map((k) => {
        const rows = p.bring.filter((b) => b.kind === k);
        if (!rows.length) return null;
        return (
          <section key={k}>
            <h4>{titles[k]}</h4>
            {rows.map((b) => (
              <div key={b.key} className="bring">
                {b.items[0]?.iconLink && (
                  <img src={b.items[0].iconLink} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                )}
                <div>
                  <div>
                    {b.count > 1 && <b>{b.count}× </b>}
                    {b.label}
                  </div>
                  <div className="muted">{b.reason}</div>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function SettingsPanel(p: {
  main: MainState;
  tasks: ApiTask[];
  data: TarkovData;
  set: (s: Partial<Settings>) => void;
  refresh: () => void;
  loading: boolean;
  version: string;
  appUpdate: UpdateState;
  onCheckApp: () => void;
  onInstallApp: (u: Update) => void;
}) {
  const { settings, status, questLog } = p.main;
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'active' | 'transit' | 'hidden' | 'all'>('active');
  const states = useMemo(() => questStates(p.tasks, questLog, p.main.manual), [p.tasks, questLog, p.main.manual]);
  const hidden = new Set(settings.hiddenQuests ?? []);
  const list = p.tasks
    .filter((t) => q || show === 'all' || (show === 'hidden' ? hidden.has(t.id) : show === 'transit' ? isTransitTask(t) : states.get(t.id)?.active))
    .filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.trader.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 150);
  const pick = async (key: 'logsPath' | 'screenshotsPath', title: string) => {
    const dir = await api.pickFolder(title);
    if (dir) p.set({ [key]: dir });
  };
  return (
    <div className="list settings">
      <section>
        <h4>Game folders</h4>
        <div className="row">
          <span className={status.logsFound ? 'ok' : 'bad'}>{status.logsFound ? '●' : '○'}</span>
          <span className="path">Logs: {status.logsPath ?? 'not found'}</span>
          <button onClick={() => void pick('logsPath', 'Select the EFT "Logs" folder')}>Change</button>
        </div>
        <div className="row">
          <span className={status.screenshotsFound ? 'ok' : 'bad'}>{status.screenshotsFound ? '●' : '○'}</span>
          <span className="path">Screenshots: {status.screenshotsPath ?? 'not found'}</span>
          <button onClick={() => void pick('screenshotsPath', 'Select the EFT "Screenshots" folder')}>Change</button>
        </div>
        <label className="row">
          <input type="checkbox" checked={settings.deleteScreenshots !== false} onChange={(e) => p.set({ deleteScreenshots: e.target.checked })} />
          Delete screenshots after reading my position
        </label>
      </section>
      <section>
        <h4>Route</h4>
        <label className="row">
          Side
          <select value={settings.faction} onChange={(e) => p.set({ faction: e.target.value as 'pmc' | 'scav' })}>
            <option value="pmc">PMC</option>
            <option value="scav">Scav</option>
          </select>
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.routeToExtract} onChange={(e) => p.set({ routeToExtract: e.target.checked })} />
          Finish the route at the nearest extract
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.questPhotos !== false} onChange={(e) => p.set({ questPhotos: e.target.checked })} />
          Show location photos when hovering a quest (from the wiki, loaded on first hover)
        </label>
        {settings.mode === 'overlay' && (
          <label className="row">
            Overlay opacity
            <input type="range" min={0.4} max={1} step={0.02} value={settings.opacity} onChange={(e) => p.set({ opacity: Number(e.target.value) })} />
          </label>
        )}
        <p className="muted">
          Hotkeys: Ctrl+Alt+O overlay ↔ window · Ctrl+Alt+L click-through · Ctrl+Alt+H hide/show. The overlay needs EFT in Borderless mode.
        </p>
      </section>
      <MarkerColors colors={settings.markerColors ?? {}} set={p.set} />
      <section>
        <h4>
          My quests <small className="muted">synced from your game logs</small>
        </h4>
        <p className="muted">
          Updates by itself as you accept and finish quests. Earlier quests in a chain are marked done automatically. Tick a
          quest here only if something looks wrong.
        </p>
        <label className="row">
          Game mode
          <select value={settings.gameMode} onChange={(e) => p.set({ gameMode: e.target.value as Settings['gameMode'] })}>
            <option value="auto">
              Follow the game{p.main.gameMode.current ? ` (now ${GAME_MODE_LABEL[p.main.gameMode.current]})` : ''}
            </option>
            {(Object.keys(GAME_MODE_LABEL) as GameMode[]).map((m) => (
              <option key={m} value={m}>
                {GAME_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">PvP, PvP Season and PvE each have their own quests. Showing {GAME_MODE_LABEL[p.main.gameMode.viewing]}.</p>
        <div className="row">
          {settings.questResetAt?.[p.main.gameMode.viewing] ? (
            <>
              <span className="muted grow">
                Ignoring {GAME_MODE_LABEL[p.main.gameMode.viewing]} history before{' '}
                {new Date(settings.questResetAt[p.main.gameMode.viewing]!).toLocaleDateString()} (wipe).
              </span>
              <button onClick={() => void api.undoFresh()}>Undo</button>
            </>
          ) : (
            <>
              <span className="muted grow">After a wipe, start this mode's quests from scratch.</span>
              <button
                onClick={() => {
                  if (confirm(`Start ${GAME_MODE_LABEL[p.main.gameMode.viewing]} quests fresh? Older log history for this mode will be ignored.`)) void api.startFresh();
                }}
              >
                Start fresh
              </button>
            </>
          )}
        </div>
        <div className="row">
          <input className="grow" placeholder="Search all quests or traders…" value={q} onChange={(e) => setQ(e.target.value)} />
          {!q && (
            <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} title="Which quests to list">
              <option value="active">Active</option>
              <option value="transit">Transit quests</option>
              <option value="hidden">Not tracked ({hidden.size})</option>
              <option value="all">All</option>
            </select>
          )}
        </div>
        <p className="muted">
          First box: the quest is active. Eye: track it on the map. Untracked quests stay active but are left off the map,
          quest list, Bring list and route.
        </p>
        {list.map((t) => {
          const manual = p.main.manual[t.id];
          const st = states.get(t.id);
          const on = !!st?.active;
          const why =
            manual !== undefined ? 'set by you'
            : on ? 'active'
            : st?.source === 'inferred' ? 'done (earlier in a chain)'
            : questLog[t.id]?.status === 'failed' ? 'failed'
            : st?.closed ? 'finished'
            : '';
          return (
            <div key={t.id} className="row task">
              <input type="checkbox" checked={on} onChange={(e) => void api.setManualQuest(t.id, e.target.checked)} />
              <span className="grow">
                {t.name} <KappaBadge task={t} /> <small className="muted">{t.trader.name}</small>
              </span>
              <small className="muted">{why}</small>
              <button
                className={`icon track-btn${hidden.has(t.id) ? '' : ' on'}`}
                title={hidden.has(t.id) ? 'Not tracked: click to show it on the map again' : 'Tracked: click to hide it from the map'}
                onClick={() => void api.setQuestHidden(t.id, !hidden.has(t.id))}
                dangerouslySetInnerHTML={{ __html: hidden.has(t.id) ? EYE_OFF : EYE_ON }}
              />
              {manual !== undefined && (
                <button title="Use the game logs again" onClick={() => void api.setManualQuest(t.id, null)}>
                  ↺
                </button>
              )}
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="muted">{show === 'hidden' && !q ? 'You track every quest.' : 'No quests here. Search above to find any quest.'}</div>
        )}
      </section>
      <section>
        <h4>Data</h4>
        <div className="row">
          <span className="grow">
            {SOURCE_LABEL[p.data.source]}
            <br />
            <span className="muted">
              Downloaded {ago(p.data.fetchedAt)} · last checked {ago(p.data.checkedAt)} · {p.data.tasks.length} quests
            </span>
          </span>
          <button onClick={p.refresh} disabled={p.loading}>
            {p.loading ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
        {p.data.stale && <div className="muted">{p.data.stale}</div>}
        <p className="muted">Checked once when the app starts. Use the button to check again.</p>
      </section>
      <section>
        <h4>App</h4>
        <div className="row">
          <span className="grow">
            Escape Artist {p.version}
            <br />
            <span className="muted">
              {p.appUpdate.kind === 'checking'
                ? 'Checking for a new version…'
                : p.appUpdate.kind === 'none'
                  ? "You're on the latest version."
                  : p.appUpdate.kind === 'available'
                    ? `Version ${p.appUpdate.update.version} is available.`
                    : p.appUpdate.kind === 'downloading'
                      ? `Downloading the update${p.appUpdate.percent !== null ? ` · ${p.appUpdate.percent}%` : '…'}`
                      : p.appUpdate.kind === 'error'
                        ? `Couldn't check for updates (${p.appUpdate.message}).`
                        : 'Updates are checked when the app starts.'}
            </span>
          </span>
          {p.appUpdate.kind === 'available' ? (
            <button onClick={() => p.appUpdate.kind === 'available' && p.onInstallApp(p.appUpdate.update)}>Update now</button>
          ) : (
            <button onClick={p.onCheckApp} disabled={p.appUpdate.kind === 'checking' || p.appUpdate.kind === 'downloading'}>
              Check for app updates
            </button>
          )}
        </div>
        <p className="muted">New versions come from the project's GitHub releases and are verified before installing.</p>
      </section>
    </div>
  );
}

const SOURCE_LABEL: Record<TarkovData['source'], string> = {
  json: 'tarkov.dev (live data files)',
  graphql: 'tarkov.dev API',
  cache: 'Saved copy on this PC (tarkov.dev unreachable)',
  snapshot: 'Data built into the app (tarkov.dev unreachable)',
};

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago (${new Date(iso).toLocaleDateString()})`;
}

function StatusLine({ main, activeCount, hiddenCount }: { main: MainState; activeCount: number | null; hiddenCount: number }) {
  const s = main.status;
  if (!s.logsFound) return <span className="bad">EFT logs not found — set the folder in Settings.</span>;
  return (
    <span>
      Logs ✓{activeCount !== null && ` · ${activeCount} active quests`}
      {hiddenCount > 0 && ` (${hiddenCount} not tracked)`}
      {main.player && ` · position from ${main.player.file === 'manual' ? 'map click' : 'screenshot'}`}
    </span>
  );
}

/** "streets-of-tarkov" -> "Streets of Tarkov" for story step map tags. */
function mapLabel(normalized: string): string {
  const special: Record<string, string> = { 'streets-of-tarkov': 'Streets of Tarkov', 'the-lab': 'The Lab', 'the-labyrinth': 'The Labyrinth', 'ground-zero': 'Ground Zero' };
  return special[normalized] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** Settings → Map colors: one picker per thing drawn on the map. Saved shortly after you stop dragging. */
function MarkerColors(p: { colors: Record<string, string>; set: (s: Partial<Settings>) => void }) {
  const [local, setLocal] = useState(p.colors);
  useEffect(() => setLocal(p.colors), [p.colors]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (next: Record<string, string>) => {
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => p.set({ markerColors: next }), 250);
  };
  const resolved = colorsFrom(local);
  const changed = Object.keys(local).length > 0;
  return (
    <section>
      <details className="colors-details">
        <summary>
          <h4 className="colors-h">Map colors</h4>
          <span className="muted"> {changed ? `${Object.keys(local).length} changed` : 'default colors'} · click to change</span>
        </summary>
      <div className="row">
        <span className="muted grow">Quest objectives are round, extracts are solid squares, spawns are small dots.</span>
        {changed && <button onClick={() => save({})}>Reset all</button>}
      </div>
      {COLOR_GROUPS.map((g) => (
        <div key={g.title} className="color-group">
          <div className="muted color-title">{g.title}</div>
          {g.keys.map(([key, label]) => (
            <label key={key} className="row color-row">
              <input type="color" value={resolved[key]} onChange={(e) => save({ ...local, [key]: e.target.value })} />
              <ColorPreview k={key} c={resolved[key]} />
              <span className="grow">{label}</span>
              {local[key] && local[key] !== DEFAULT_COLORS[key] && (
                <button
                  className="icon"
                  title="Back to the default color"
                  onClick={(e) => {
                    e.preventDefault();
                    const { [key]: _, ...rest } = local;
                    save(rest);
                  }}
                >
                  ↺
                </button>
              )}
            </label>
          ))}
        </div>
      ))}
      </details>
    </section>
  );
}

/** A small copy of how the thing looks on the map. */
function ColorPreview({ k, c }: { k: ColorKey; c: string }) {
  if (k === 'spawn') return <span className="pv-dot" style={{ background: c }} />;
  if (k === 'route') return <span className="pv-line" style={{ borderColor: c }} />;
  if (k === 'player')
    return (
      <svg viewBox="0 0 24 24" width="18" height="18">
        <path d="M12 2l7 19-7-4-7 4z" fill={c} stroke="#000" strokeWidth="1.5" />
      </svg>
    );
  if (k === 'panel' || k === 'mapKey') return <span className="poi pv" style={{ '--c': c } as CSSProperties} />;
  if (k === 'bd') return <span className="bd-zone pv" style={{ '--c': c } as CSSProperties} />;
  if (k === 'exfil') return <span className="exfil pv" style={{ '--c': c } as CSSProperties} dangerouslySetInnerHTML={{ __html: exfilGlyph(11) }} />;
  return <span className="mk pv" style={{ '--c': c } as CSSProperties} dangerouslySetInnerHTML={{ __html: glyph(k, 12) }} />;
}

/** Story tab order: what you're doing, then what you can start, then what's finished. */
const STATE_ORDER: Record<ChapterState, number> = { 'in-progress': 0, 'not-started': 1, done: 2 };

const STATE_LABEL: Record<ChapterState, string> = { 'not-started': 'Not started', 'in-progress': 'In progress', done: 'Done' };

/**
 * How to start a story chapter on this map: the places from the wiki's "Requirements", their
 * in-game photos (fetched when first shown), and a button once it's started.
 */
function StoryStartGuide(p: { chapter: StoryChapter; starts: StoryStart['options']; mapKey?: string }) {
  const [photos, setPhotos] = useState<GuideImage[]>([]);
  useEffect(() => {
    let alive = true;
    void api.getStoryStartPhotos(p.chapter.page, p.chapter.wikiUrl).then((all) => {
      if (alive && p.mapKey) setPhotos(imagesForObjective(all, p.mapKey, p.starts.map((s) => s.text).join(' ')).slice(0, 4));
    });
    return () => {
      alive = false;
    };
  }, [p.chapter, p.mapKey, p.starts]);
  return (
    <div className="story-start">
      <div>
        <b>How to start{p.chapter.start?.intro ? ':' : ''}</b> {p.chapter.start?.intro}
      </div>
      <ul>
        {p.starts.map((o) => (
          <li key={o.text}>{o.text}</li>
        ))}
      </ul>
      {photos.length > 0 && (
        <div className="story-photos">
          {photos.map((ph) => (
            <figure key={ph.file}>
              <img src={`${ph.url}${ph.url!.includes('?') ? '&' : '?'}th=1`} alt={ph.caption} title={ph.caption} referrerPolicy="no-referrer" decoding="async" />
              {ph.caption && <figcaption>{ph.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      <button onClick={() => void api.setStoryStarted(p.chapter.name, true)}>I've started it</button>
    </div>
  );
}

/** Story tab: main story chapters (from the wiki), their state, how to start them and their steps. */
function StoryPanel(p: {
  settings: Settings;
  set: (s: Partial<Settings>) => void;
  story: { chapters: StoryChapter[]; fetchedAt: string } | null;
  storyError: string | null;
  storyDone: Set<string>;
  storyStarted: Set<string>;
}) {
  const { settings } = p;
  return (
    <div className="list settings">
      <section>
        <h4>Main story</h4>
        <label className="row">
          <input type="checkbox" checked={settings.showStory} onChange={(e) => p.set({ showStory: e.target.checked })} />
          Show main story steps for each map (checklist)
        </label>
        <p className="muted">
          The game logs don't record story progress and the wiki has no positions, so story steps are a checklist you tick
          yourself (saved per game mode). Tick everything you've already done once here.
        </p>
        {settings.showStory && p.storyError && !p.story && <div className="bad">{p.storyError}</div>}
        {settings.showStory && !p.story && !p.storyError && <div className="muted">Loading story chapters…</div>}
        {settings.showStory &&
          [...(p.story?.chapters ?? [])]
            .sort((a, b) => STATE_ORDER[chapterState(a, p.storyDone, p.storyStarted)] - STATE_ORDER[chapterState(b, p.storyDone, p.storyStarted)])
            .map((c) => {
            const ids = c.steps.map((s) => s.id);
            const doneCount = ids.filter((id) => p.storyDone.has(id)).length;
            const st = chapterState(c, p.storyDone, p.storyStarted);
            // Where you are in the chapter: highlighted in the list.
            const current = new Set(st === 'in-progress' ? activeSteps(c, p.storyDone).map((x) => x.id) : []);
            const markedOnly = st === 'in-progress' && p.storyStarted.has(c.name) && doneCount === 0;
            // The step you're on, shown without opening the chapter.
            const nextStep = st === 'in-progress' ? (activeSteps(c, p.storyDone).find((x) => !x.optional) ?? null) : null;
            return (
              <details key={c.name} className="story-details">
                <summary>
                  {c.name} <span className={`story-state ${st === 'not-started' ? 'ns' : st === 'done' ? 'dn' : 'ip'}`}>{STATE_LABEL[st]}</span>{' '}
                  <span className={doneCount === ids.length ? 'ok' : 'muted'}>
                    {doneCount}/{ids.length}
                  </span>
                  {nextStep && (
                    <span className="story-next">
                      Next: {nextStep.text}
                      {nextStep.maps.length > 0 && <span className="muted"> · {nextStep.maps.map(mapLabel).join(', ')}</span>}
                    </span>
                  )}
                </summary>
                {st === 'not-started' && c.start && (
                  <div className="story-start">
                    <b>How to start:</b> {c.start.intro}
                    {c.start.options.length > 0 && (
                      <ul>
                        {c.start.options.map((o) => (
                          <li key={o.text}>
                            {o.text}
                            {o.maps.length > 0 && <span className="muted"> · {o.maps.map(mapLabel).join(', ')}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="row">
                  {st === 'not-started' && <button onClick={() => void api.setStoryStarted(c.name, true)}>Mark started</button>}
                  {markedOnly && <button onClick={() => void api.setStoryStarted(c.name, false)}>Mark not started</button>}
                  <button onClick={() => void api.setStoryDone(ids, true)}>Mark chapter done</button>
                  <button onClick={() => void api.setStoryDone(ids, false)}>Clear</button>
                </div>
                {c.steps.map((s, i) => {
                  const branchStart = s.branch && s.branch !== c.steps[i - 1]?.branch;
                  return (
                    <div key={s.id}>
                      {branchStart && <div className="story-branch">{s.branch}</div>}
                      <label className={`obj${p.storyDone.has(s.id) ? ' done' : ''}${current.has(s.id) ? ' story-current' : ''}`} style={{ paddingLeft: s.depth * 16 }}>
                        <input
                          type="checkbox"
                          checked={p.storyDone.has(s.id)}
                          onChange={(e) => void api.setStoryDone(e.target.checked ? stepsUpTo(c, s.id) : [s.id], e.target.checked)}
                        />
                        <span>
                          {s.text}
                          {s.optional && <em> (optional)</em>}
                          {s.maps.length > 0 && <span className="muted"> · {s.maps.map(mapLabel).join(', ')}</span>}
                        </span>
                      </label>
                    </div>
                  );
                })}
              </details>
            );
          })}
        {settings.showStory && p.story && (
          <p className="muted credit">Story chapters from the Escape from Tarkov Wiki (escapefromtarkov.fandom.com), CC BY-SA.</p>
        )}
      </section>
    </div>
  );
}

/** Cogwheel for the Settings button. */
const GEAR =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

/** Ticking story steps: each one also ticks the earlier steps of its chapter (same path). */
function withEarlierSteps(chapters: StoryChapter[], ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const c = chapters.find((ch) => ch.steps.some((st) => st.id === id));
    for (const x of c ? stepsUpTo(c, id) : [id]) out.add(x);
  }
  return [...out];
}

/** Map button icons (line icons, drawn in the button's text colour). */
const NO_ZONES: BotZone[] = [];
/** Panels and Toolsets go under the "Fix" button; keys and locked doors under "Keys". */
const isFixPoi = (p: MapPoi) => p.kind === 'panel' || p.kind === 'toolset';
/** Fix: a wrench. */
const IC_FIX = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L2 10l8-8z" transform="scale(.9) translate(1 1)"/></svg>';
/** Keys: a key. */
const IC_POI = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M18 5l2 2"/></svg>';
/** Black Division: a diamond, matching their map marker. */
const IC_BD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l9 9-9 9-9-9z"/><path d="M12 9l3 3-3 3-3-3z" fill="currentColor"/></svg>';
const IC_SPAWNS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/></svg>';
const IC_EXTRACTS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4h6v16h-6"/><path d="M10 16l4-4-4-4M4 12h10"/></svg>';
const IC_START = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
const IC_CLEAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

