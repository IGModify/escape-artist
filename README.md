# Escape Artist

A desktop companion for Escape from Tarkov. Pick a map, or let the game pick it when you load into a raid. It shows:

- your **active quests** on that map, with each objective as a typed marker: marker, camera (CCTV), jammer, plant, visit, pick up, kill zone, use item, extract
- a **Bring** list: items to place, keys (with alternatives), items to use, required weapons
- **PMC spawn points** for the map (toggle with **Spawns**), with the one you spawned at highlighted
- the **shortest route** from your spawn through every remaining objective, optionally ending at the nearest extract

## Two modes

| Mode | What it is |
| --- | --- |
| Overlay | Transparent, frameless and always on top. Drag it by the top bar. Click-through lets clicks pass to the game. Needs EFT in **Borderless** mode. |
| Windowed | A normal app window with the map and quest list side by side. Good for a second monitor. |

Switch with the button in the top bar or **Ctrl+Alt+O**. The switch happens instantly, without a reload. Each mode remembers its own size and position.

Hotkeys: **Ctrl+Alt+O** switches overlay ↔ window · **Ctrl+Alt+L** toggles click-through · **Ctrl+Alt+H** hides or shows the window.

## How it knows things

- **Quests:** it reads EFT's `Logs` folder (read-only), the same way TarkovMonitor does. On start it replays every log folder to rebuild which quests are started, finished or failed, then follows new lines live. Quests can be ticked on or off by hand under **Settings → My quests**.
- **Map:** when the log shows a raid being matched, the app switches to that map.
- **Spawn and route:** EFT puts your coordinates in screenshot filenames. **Press your screenshot key (PrtSc) once you spawn**, and the app highlights your spawn and plots the route. Press it again any time to re-route from where you are. **Set start** lets you click the map instead. If another map is picked, the app switches to the raid's map (the game log names it; screenshot names only have coordinates, which overlap between maps). The map then centres on you with a short pulse (the overlay also switches to its Map tab), and a soft ring keeps your arrow easy to spot; if the position isn't on the map you're viewing, a notice says so. Once the position is read, the screenshot is deleted so the folder doesn't fill up (only screenshots whose name holds a position; turn it off in Settings).
- **Ticking off:** click a marker or tick an objective in the list when you've done it, and the route recomputes.
- **Game modes:** PvP, PvP Season and PvE each have their own quest progress. Each logged quest event is tagged with the session's mode, and the app shows the mode you're playing (or the one you pick in Settings). **Start fresh** hides a mode's older history after a wipe. If you've reached a quest, the quests before it in its chain are counted as done, which covers history older than your logs.
- **Not tracking a quest:** the eye button on a quest hides it from the map, list, Bring list and route (e.g. *Is This a Reference?* and its 27 camera spots). Settings → My quests lists untracked quests so you can bring them back.
- **Transit quests:** quests that need a transit between maps (e.g. *Use the transit from Woods to Reserve*) are listed in their own **Transit quests** section under the map's other quests. **Don't track these** hides them all at once; Settings → My quests → *Transit quests* lists every one.
- **Map colors:** quest objectives are round badges (one color per type: marker, camera, jammer, plant/stash, pick up, visit, kill, use, extract, transit), extracts are solid squares, PMC spawns are small dots. Every color can be changed in **Settings → Map colors**.
- **Floors (multi-level maps):** Labs, Factory, Customs, Reserve, Shoreline, Streets, Interchange and Ground Zero get a floor switcher on the map (top floor at the top: e.g. 2 / 1 / B on Labs). Each button shows how many objectives are left on that floor, and a dot marks your floor. Your screenshot switches to the floor you're on; **PageUp / PageDown** step through floors. The chosen floor is drawn over a faded ground floor. Nothing is ever hidden. Objectives on other floors are lighter, with ▲/▼ to show the way; clicking one jumps to its floor. Extracts stay at full strength, with ▲/▼ when on another floor. Spawns on other floors become rings. The quest list names the floor (e.g. *· 3rd Floor*), and the route summary lists the floors it passes through. Floor data comes from tarkov.dev's map config.
- **Location photos:** hovering a quest marker shows that quest's guide photos for this map from the [Escape from Tarkov Wiki](https://escapefromtarkov.fandom.com) (CC BY-SA), best match first ("The vehicle where the beacon is placed"). They're fetched only on the first hover of a quest (two small requests, ~5–30 KB per 320 px preview), then the list is kept on disk for a week; nothing is bundled or downloaded in the background. Turn off in Settings → Route.
- **Kill zones:** kill objectives tied to a place (about 20, e.g. *Provide Viewership*: inside the industrial plant on Customs; *No Place for Renegades*: the command bunker on Reserve) show their area as a dashed outline while you hover the marker. Click the marker or the **Zone** button on the objective in the quest list to keep it shown. Map-wide kill objectives ("Eliminate Scavs on Customs") have no area to draw.
- **Items with several spawns:** possible spawn spots of one quest item that are close together (e.g. the 6 spots for the package in *Secrets of Polikhim*) are one marker, and the route goes there once. Hovering it rings every spawn point on the map; clicking it (or **Spawns** on the objective in the quest list) keeps the rings until you click again. Tick it off in the quest list. Its hover shows all of the guide's photos for it.
- **Stacks and items:** on the ground floor with the whole map in view, objectives that would overlap on screen (several quests in one building, or one spot on several floors) become one marker with a count in the corner. Zooming in or picking another floor shows every objective at its own spot. Hover to list them; click to zoom in until they separate, or pick one from a list when they share a spot. A small picture beside a marker shows the item the objective needs (marker, camera, jammer, item to stash or pick up, or the key to get in). Arrows along the route show its direction.
- **Kappa:** quests needed for Collector (the Kappa container) have a purple **K** in lists and on their markers.
- **Main story (optional):** The **Story** tab turns on a per-map checklist of story chapter steps from the [Escape from Tarkov Wiki](https://escapefromtarkov.fandom.com/wiki/Story_chapters) (CC BY-SA). The logs don't record story progress and there are no positions, so you tick steps yourself (saved per game mode). Ticking a step also ticks the earlier steps of that chapter (on its own path, for chapters that branch). Like side quests, each map shows only the step you're on in each chapter (plus optional steps alongside it, and each path's next step at a fork); the Story tab keeps the full list with your current step highlighted. Chapters that need something to start them (a note to read, a place to visit) show as **Not started** with a "How to start" guide on the maps where they start, with in-game photos from the wiki; press **I've started it** (or tick any step) and its steps appear. The Story tab lists each chapter's state: Not started / In progress / Done. Settings opens from the ⚙ button in the top bar. The wiki is only contacted while the option is on, at most once a day.
- **Data:** tasks, zones, spawns and extracts come from [tarkov.dev](https://tarkov.dev), tried in this order:
  1. `json.tarkov.dev`, the data files the tarkov.dev website itself loads. ETags mean nothing is downloaded unless the data changed.
  2. The `api.tarkov.dev` GraphQL API, if the JSON files fail or change format. A broken download never overwrites the saved copy.
  3. The last good copy saved on this PC.
  4. The snapshot built into the installer (`npm run dist` refreshes it, including map images).

  Data is checked once at startup. **Settings → Data → Check for updates** checks again on demand.

The route uses straight-line distance plus a penalty for changing height, because the public data has no walls or paths. With up to 12 stops it is exactly optimal under that measure; with more it uses a strong heuristic.

Nothing here reads game memory or injects into the game. It only reads log files and screenshot filenames.

## Install

Run `src-tauri\target\release\bundle\nsis\Escape Artist_<version>_x64-setup.exe` (about 3 MB). It installs for the current user (no admin needed) and adds **Escape Artist** to the Desktop and the Start menu. Running a newer setup file updates in place. To uninstall, use Windows Settings → Apps.

It needs Microsoft's WebView2, which ships with Windows 10 and 11. If it's missing, the installer downloads it.

## How it's built

- **`src-tauri/` (Rust, Tauri 2)** handles the system work: one window that switches between overlay and windowed without reloading, click-through, global hotkeys, settings, file storage, finding the EFT install, tailing the game logs (every 2 s, complete lines only), and watching the screenshot folder.
- **`src/shared/` (TypeScript, no platform code)** holds the logic: log parsing, the tarkov.dev data source and converter, quest/map logic and the route solver.
- **`src/renderer/` (React + Leaflet)** is the UI. `platform.ts` is the bridge to the Rust side.

To stay light while you play:
- The UI renders without the GPU, so the graphics card is left to the game.
- While the app isn't focused, WebView2 is asked to trim its memory. Clicking into the app restores normal mode.
- There are no background timers. Data is checked once per start.
- Downloaded data is cut down to just the fields the app uses.

## Develop

```powershell
npm install
npm run dev                      # app with hot reload (needs Rust + MSVC build tools)
npm test                         # TypeScript tests (vitest) + Rust tests (cargo)
npm run dist                     # refresh the bundled data snapshot, then build the installer
node scripts/demo.mjs windowed   # built app + fake EFT install with real Customs quests
```

If the EFT logs folder isn't found automatically (registry, Steam libraries, `C:\Battlestate Games\…`), set it under Settings.
