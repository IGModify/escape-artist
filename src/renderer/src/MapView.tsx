import L from 'leaflet';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clusterPoints } from '@shared/cluster';
import { floorOf, onActiveFloor, type Floor } from '@shared/floors';
import { groupSpots, killCount, MARKER_LABEL, objectiveItem, type BotZone, type MapObjective } from '@shared/questLogic';
import type { MapPoi, MapPoiKind } from '@shared/mapPois';
import type { RouteResult } from '@shared/route';
import type { GuideImage } from '@shared/questImages';
import type { ApiItem, MapDisplay } from '@shared/tarkovTypes';
import type { PlayerPosition, Vec3 } from '@shared/types';
import { exfilGlyph, glyph, type ColorKey } from './icons';

// Coordinate system copied from tarkov.dev (src/pages/map/index.jsx) so their map
// config (transform, coordinateRotation, bounds) lines up with game coordinates.
function rotate(latLng: L.LatLng, rotation?: number): L.LatLng {
  if (!rotation || (!latLng.lng && !latLng.lat)) return latLng;
  const a = (rotation * Math.PI) / 180;
  const { lng: x, lat: y } = latLng;
  return L.latLng(x * Math.sin(a) + y * Math.cos(a), x * Math.cos(a) - y * Math.sin(a));
}

/**
 * `turn` is the user's extra rotation, clockwise in degrees (0/90/180/270). It only changes how game
 * coordinates are projected to the screen, so every marker, click and screenshot position stays
 * exact; the drawing itself is turned to match (see rotateSvg). A higher coordinateRotation turns
 * the view counter-clockwise, hence the minus.
 */
function crsFor(d: MapDisplay, turn = 0): L.CRS {
  const [sx, mx, sy, my] = d.transform ?? [1, 0, -1, 0];
  const rotation = (d.coordinateRotation ?? 0) - turn;
  return L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(sx, mx, sy * -1, my),
    projection: L.extend({}, L.Projection.LonLat, {
      project: (ll: L.LatLng) => L.Projection.LonLat.project(rotate(ll, rotation)),
      unproject: (p: L.Point) => rotate(L.Projection.LonLat.unproject(p), rotation * -1),
    }),
  }) as L.CRS;
}

/**
 * Turn the map drawing clockwise by `turn` inside its overlay. Leaflet places the overlay in the
 * (rotated) bounding box, so the content is rotated within a viewBox with width and height swapped
 * for quarter turns. Groups keep their ids, so floors still find them.
 */
function rotateSvg(outer: SVGSVGElement, content: Element, viewBox: string, turn: number) {
  const [, , w, h] = viewBox.split(/[\s,]+/).map(Number) as [number, number, number, number];
  // The drawing's own <svg> has no size and would take the (swapped) outer size: pin it to its own.
  content.setAttribute('width', String(w));
  content.setAttribute('height', String(h));
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  if (turn === 90) g.setAttribute('transform', `translate(${h} 0) rotate(90)`);
  else if (turn === 180) g.setAttribute('transform', `rotate(180 ${w / 2} ${h / 2})`);
  else g.setAttribute('transform', `translate(0 ${w}) rotate(-90)`);
  outer.setAttribute('viewBox', turn === 180 ? `0 0 ${w} ${h}` : `0 0 ${h} ${w}`);
  g.appendChild(content);
  outer.appendChild(g);
}

const poiSvg = (body: string) => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
/** Electrical panel, drawn like a quest marker: a lightning bolt at quest-glyph size. */
const PANEL_GLYPH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>';
/** Black Division: a crosshair. */
const BD_GLYPH = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/></svg>';
/** Panel: lightning bolt; Toolset: wrench; key; locked door: padlock. */
const POI_GLYPH: Record<MapPoiKind, string> = {
  panel: poiSvg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  toolset: poiSvg('<path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L2 10l8-8z" transform="scale(.9) translate(1 1)"/>'),
  key: poiSvg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M18 5l2 2"/>'),
  door: poiSvg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  // Drain button: a water drop (it drains the pumping station).
  button: poiSvg('<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>'),
  charge: poiSvg('<circle cx="10" cy="14" r="7"/><path d="M15 9l2.5-2.5"/>'),
};

const toLatLng = (p: Vec3): L.LatLngTuple => [p.z, p.x];
const boundsOf = (b: [[number, number], [number, number]]) => L.latLngBounds([b[0][1], b[0][0]], [b[1][1], b[1][0]]);

/** How much the ground drawing and off-floor markers fade while another floor is shown. */
const FADED = 0.22;

export interface MapViewProps {
  display: MapDisplay;
  svgText: string | null;
  objectives: MapObjective[];
  done: Set<string>;
  route: RouteResult | null;
  routeStart: Vec3 | null;
  player: PlayerPosition | null;
  extracts: { id: string; name: string | null; position: Vec3 }[];
  pickingStart: boolean;
  onPickStart: (p: Vec3) => void;
  onToggleDone: (objectiveId: string) => void;
  /** Player spawn points for your side; empty when hidden. */
  spawns: { name: string | null; position: Vec3 }[];
  /** Black Division spawn zones (Terminal); empty when hidden or the map has none. */
  bdZones: BotZone[];
  /** Hand-placed spots (Terminal: panels, Toolsets, keys, locked doors); empty when hidden. */
  pois: MapPoi[];
  /** The user's turn of the map, clockwise degrees (0/90/180/270). */
  rotation: number;
  /** Marker colors (defaults + the user's choices from Settings). */
  colors: Record<ColorKey, string>;
  /** The map's floors, lowest first (empty for single-level maps), and the one shown. */
  floors: Floor[];
  floor: Floor | null;
  onFloor: (id: string) => void;
  /** Objectives whose spawn points / kill zone are kept on the map (marker click or quest list). */
  pinned: Set<string>;
  onTogglePin: (objectiveId: string) => void;
  /** Location photos for an objective (wiki guide), or undefined when turned off. */
  photosFor?: (o: MapObjective) => Promise<GuideImage[]>;
}

export function MapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const overlays = useRef<L.LayerGroup | null>(null);
  const baseTiles = useRef<L.TileLayer | null>(null);
  const [svgRoot, setSvgRoot] = useState<Element | null>(null);
  const userMoved = useRef(false);
  const handlers = useRef(props);
  handlers.current = props;

  // (Re)build the Leaflet map whenever the drawn map changes: CRS can't be swapped live.
  useEffect(() => {
    if (!el.current) return;
    const d = props.display;
    const bounds = boundsOf(d.bounds);
    const m = L.map(el.current, {
      crs: crsFor(d, props.rotation),
      attributionControl: false,
      zoomControl: false,
      zoomSnap: 0.25,
      minZoom: (d.minZoom ?? 1) - 2,
      maxZoom: Math.max(7, d.maxZoom ?? 6),
    });
    m.fitBounds(bounds);
    baseTiles.current =
      d.tilePath && !d.svgPath ? L.tileLayer(d.tilePath, tileOptions(d, bounds)).addTo(m) : null;
    overlays.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (!handlers.current.pickingStart) return;
      handlers.current.onPickStart({ x: e.latlng.lng, y: floorHeight(handlers.current.floor), z: e.latlng.lat });
    });
    // PageUp / PageDown step through floors while the map has focus.
    const onKey = (e: KeyboardEvent) => {
      const { floors, floor, onFloor } = handlers.current;
      if (!floors.length || !floor || (e.key !== 'PageUp' && e.key !== 'PageDown')) return;
      const i = floors.findIndex((f) => f.id === floor.id) + (e.key === 'PageUp' ? 1 : -1);
      if (floors[i]) onFloor(floors[i].id);
      e.preventDefault();
    };
    el.current.addEventListener('keydown', onKey);
    map.current = m;
    // Keep the whole map in view as the panel resizes, until the user pans/zooms themselves.
    userMoved.current = false;
    m.on('dragstart', () => (userMoved.current = true));
    el.current.addEventListener('wheel', () => (userMoved.current = true), { passive: true });
    const ro = new ResizeObserver(() => {
      m.invalidateSize();
      if (!userMoved.current) m.fitBounds(bounds, { animate: false });
    });
    ro.observe(el.current);
    const node = el.current;
    return () => {
      ro.disconnect();
      node.removeEventListener('keydown', onKey);
      m.remove();
      map.current = null;
      baseTiles.current = null;
    };
  }, [props.display, props.rotation]);

  // Crosshair while picking your start, toggled directly so Leaflet's own classes survive.
  useEffect(() => {
    el.current?.classList.toggle('picking', props.pickingStart);
  }, [props.pickingStart, props.display, props.rotation]);

  // SVG drawing: parsed once per map; which groups show is decided by the floor effect below.
  useEffect(() => {
    const m = map.current;
    const d = props.display;
    setSvgRoot(null);
    if (!m || !props.svgText || !d.svgPath) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = props.svgText;
    const root = svg.children[0];
    const viewBox = root?.getAttribute('viewBox');
    if (viewBox && root && props.rotation) rotateSvg(svg, root, viewBox, props.rotation);
    else if (viewBox) svg.setAttribute('viewBox', viewBox);
    const layer = L.svgOverlay(svg, boundsOf(d.svgBounds ?? d.bounds), { interactive: false }).addTo(m);
    layer.bringToBack();
    setSvgRoot(root ?? null);
    return () => {
      layer.remove();
    };
  }, [props.display, props.svgText, props.rotation]);

  // Floors: the ground stays visible (faded) under the floor being shown, like tarkov.dev.
  useEffect(() => {
    const m = map.current;
    const d = props.display;
    const f = props.floor;
    const upper = f && !f.base ? f : null;
    const fadeGround = !!upper && !upper.show;
    // A floor covering only some buildings (Customs dorms, Reserve) keeps the ground around them
    // readable; a floor covering the whole map (Factory, Labs basement) fades the ground more.
    const fade = upper?.extents.every((e) => e.bounds?.length) ? 0.55 : FADED;
    // SVG maps: the ground group, plus the chosen floor's group when the SVG has one.
    if (svgRoot) {
      const inGroup = (g: SVGGElement, id?: string) => !!id && (g.id === id || g.dataset?.keepWithGroup === id);
      for (const g of Array.from(svgRoot.children) as SVGGElement[]) {
        if (g.nodeName !== 'g' || !g.id) continue;
        const ground = inGroup(g, d.svgLayer);
        const floor = !!upper && inGroup(g, upper.svgLayer);
        g.style.display = ground || floor ? '' : 'none';
        g.style.opacity = ground && !floor && fadeGround ? String(fade) : '';
      }
    }
    baseTiles.current?.setOpacity(fadeGround ? fade : 1);
    // Floors drawn only as image tiles (Labs, some Reserve buildings) go on top as their own layer.
    // Image tiles can't be turned with the drawing, so a turned map skips them (markers still dim).
    if (!m || props.rotation || !upper?.tilePath || (svgRoot && upper.svgLayer)) return;
    const tiles = L.tileLayer(upper.tilePath, tileOptions(d, boundsOf(d.bounds))).addTo(m);
    return () => {
      tiles.remove();
    };
  }, [props.display, props.floor, svgRoot, props.rotation]);

  // Markers, route, player.
  useEffect(() => {
    const group = overlays.current;
    if (!group) return;
    group.clearLayers();
    const { floors, floor } = props;
    const multi = floors.length > 0 && !!floor;
    const on = (p: Vec3) => onActiveFloor(p, floors, floor);
    const floorNote = (p: Vec3) => (multi ? `<br><span class="muted">${escapeHtml(floorOf(p, floors)!.name)}</span>` : '');
    const order = new Map<string, number>();
    props.route?.stops.forEach((s, i) => order.set(`${s.targetId}@${s.point.x},${s.point.z}`, i + 1));

    // Spawn points: lightweight vector dots, drawn first so they sit under everything.
    // The one closest to where you are (within 40 m) is highlighted as "your spawn".
    let mine: Vec3 | null = null;
    if (props.routeStart) {
      let best = 40;
      for (const s of props.spawns) {
        const d = Math.hypot(s.position.x - props.routeStart.x, s.position.z - props.routeStart.z);
        if (d < best) [best, mine] = [d, s.position];
      }
    }
    const c = props.colors;
    for (const s of props.spawns) {
      const isMine = s.position === mine;
      const here = on(s.position);
      L.circleMarker(toLatLng(s.position), {
        radius: isMine ? 7 : 4,
        weight: isMine ? 2 : 1,
        // On another floor: dimmed, like every other marker that isn't on the floor shown.
        color: isMine ? '#ffffff' : '#000000',
        fillColor: c.spawn,
        fillOpacity: here ? (isMine ? 1 : 0.8) : 0.22,
        opacity: here ? 1 : 0.3,
        interactive: true,
      })
        .bindTooltip((isMine ? 'Your spawn' : s.name ? `Spawn: ${escapeHtml(s.name)}` : 'PMC spawn') + floorNote(s.position), { direction: 'top' })
        .addTo(group);
    }

    // Black Division (Terminal): a pill per spawn zone with how many operatives come there. Hovering
    // draws every point the squad may spawn at, tied to the pill.
    for (const z of props.bdZones) {
      const spread = L.layerGroup([
        ...z.points.map((p) => L.polyline([toLatLng(z.at), toLatLng(p)], { color: c.bd, weight: 1.2, opacity: 0.75, dashArray: '3 4', interactive: false })),
        ...z.points.map((p) =>
          L.circleMarker(toLatLng(p), { radius: 3.5, weight: 1.5, color: '#ffffff', fillColor: c.bd, fillOpacity: 1, interactive: false }),
        ),
      ]);
      const n = z.points.length;
      const count = z.operatives ? `<b>${z.operatives}</b>` : '';
      L.marker(toLatLng(z.at), {
        icon: L.divIcon({ className: `mk-wrap mk-c${on(z.at) ? '' : ' off-floor'}`, html: `<div class="bd" style="--c:${c.bd}">${BD_GLYPH}${count}</div>`, iconSize: [40, 20] }),
        keyboard: false,
        zIndexOffset: 200,
      })
        .bindTooltip(
          `<b>Black Division</b> · ${escapeHtml(z.label)}` +
            (z.operatives ? `<br>${z.operatives} operative${z.operatives === 1 ? '' : 's'}${z.groups > 1 ? ` over ${z.groups} waves` : ''}` : '') +
            `<br><span class="muted">${n} possible spawn point${n === 1 ? '' : 's'} · hover shows them</span>${floorNote(z.at)}`,
          { direction: 'top', offset: [0, -10] },
        )
        .on('mouseover', () => spread.addTo(group))
        .on('mouseout', () => spread.remove())
        .addTo(group);
    }

    // Hand-placed spots from the wiki map (Terminal). The same thing found close together (SZ-1
    // charges, Armory keys) is one marker with a count; hovering shows each spot.
    const byTitle = new Map<string, MapPoi[]>();
    for (const poi of props.pois) byTitle.set(poi.title, [...(byTitle.get(poi.title) ?? []), poi]);
    for (const same of byTitle.values()) {
      for (const { at, spots } of groupSpots(same.map((x) => x.position), 30)) {
        const here = same.filter((x) => spots.includes(x.position));
        const poi = here[0]!;
        const color = poi.kind === 'panel' || poi.kind === 'button' || poi.kind === 'toolset' ? c.panel : c.mapKey;
        const n = here.length;
        const badge = n > 1 ? `<span class="poi-n">${n}</span>` : '';
        const html = poi.icon
          ? `<div class="poi-item" style="--c:${color}"><img src="${escapeHtml(poi.icon)}" alt="" referrerpolicy="no-referrer" decoding="async">${badge}</div>`
          : poi.kind === 'door'
            ? `<div class="poi-door" style="--c:${color}">${POI_GLYPH.door}</div>`
            : poi.kind === 'button'
              ? `<div class="poi-button" style="--c:${color}">${POI_GLYPH.button}</div>`
            : `<div class="mk" style="--c:${color}">${PANEL_GLYPH}</div>`;
        const size: [number, number] = poi.icon ? [28, 28] : poi.kind === 'door' ? [20, 20] : poi.kind === 'button' ? [22, 22] : [26, 26];
        const notes = [...new Set(here.map((x) => x.note))];
        const tip =
          `<b>${escapeHtml(poi.title)}${n > 1 ? ` · ${n} spots` : ''}</b>` +
          (notes.length > 1 ? `<ul class="poi-list">${notes.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : `<br>${escapeHtml(notes[0]!)}`) +
          `<br><span class="muted">Approximate · from the EFT wiki map</span>`;
        const marker = L.marker(toLatLng(at), {
          icon: L.divIcon({ className: `mk-wrap mk-c${on(at) ? '' : ' off-floor'}`, html, iconSize: size }),
          keyboard: false,
          zIndexOffset: 300,
        }).bindTooltip(tip, { direction: 'top', offset: [0, -size[1] / 2 - 2], className: 'poi-tip' });
        if (n > 1) {
          const dots = L.layerGroup(
            here.map((x) => L.circleMarker(toLatLng(x.position), { radius: 3.5, weight: 1.5, color: '#000000', fillColor: color, fillOpacity: 1, interactive: false })),
          );
          marker.on('mouseover', () => dots.addTo(group)).on('mouseout', () => dots.remove());
        }
        marker.addTo(group);
      }
    }

    // Extracts on another floor are dimmed and say which way to go (▲/▼).
    for (const e of props.extracts) {
      L.marker(toLatLng(e.position), {
        icon: L.divIcon({
          className: `mk-wrap${on(e.position) ? '' : ' off-floor'}`,
          html: `<div class="exfil" style="--c:${c.exfil}">${exfilGlyph(13)}${on(e.position) ? '' : floorBadge(floorOf(e.position, floors)!, floor!)}</div>`,
          iconSize: [20, 20],
        }),
        keyboard: false,
      })
        .bindTooltip(`<b>Extract</b> · ${escapeHtml(e.name ?? 'unnamed')}${floorNote(e.position)}`, { direction: 'top', offset: [0, -8] })
        .addTo(group);
    }

    // Route: each leg is solid on the floor shown and faded where it runs on another floor.
    if (props.route && props.routeStart) {
      const pts = [props.routeStart, ...props.route.stops.map((s) => s.point)];
      if (props.route.end) pts.push(props.route.end.point);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const here = on(a) && on(b);
        L.polyline([toLatLng(a), toLatLng(b)], {
          color: c.route,
          weight: 3,
          dashArray: '6 6',
          opacity: here ? 0.9 : 0.3,
          interactive: false,
        }).addTo(group);
        // An arrow halfway along the leg shows which way the route goes. The map projection only
        // scales and rotates, so the on-screen angle stays right at every zoom.
        const m0 = map.current;
        if (!m0 || Math.hypot(b.x - a.x, b.z - a.z) < 8) continue;
        const pa = m0.latLngToLayerPoint(toLatLng(a));
        const pb = m0.latLngToLayerPoint(toLatLng(b));
        const deg = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
        const mid: Vec3 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        L.marker(toLatLng(mid), {
          icon: L.divIcon({
            className: 'mk-wrap',
            html: `<div class="route-arrow" style="transform: rotate(${deg}deg); opacity: ${here ? 1 : 0.35}"><svg viewBox="0 0 12 12" width="18" height="18"><path d="M1.5 1.5l9 4.5-9 4.5 2.2-4.5z" fill="${c.route}" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/></svg></div>`,
            iconSize: [18, 18],
          }),
          interactive: false,
          keyboard: false,
        }).addTo(group);
      }
    }

    // Quest objectives. Markers that would overlap on screen (several quests in one building,
    // spots on different floors) become one stack with a count; it's redone on every zoom.
    const entries: Entry[] = [];
    for (const o of props.objectives) {
      const isDone = props.done.has(o.objective.id);
      // Ticked objectives leave the map (they stay ticked in the quest list, where you can untick them).
      if (isDone) continue;
      const item = objectiveItem(o.objective);
      for (const [li, loc] of o.locations.entries()) {
        const n = order.get(`${o.objective.id}@${loc.x},${loc.z}`) ?? null;
        // Another spot for the same objective is on the route: this one is just an alternative.
        const alt = !n && !isDone && o.locations.length > 1 && !!props.route?.stops.some((s) => s.targetId === o.objective.id);
        const where = multi ? floorOf(loc, floors)! : null;
        entries.push({ o, loc, spots: o.spots[li] ?? [loc], n, isDone, alt, where, off: !!where && !on(loc), item, also: [] });
      }
    }
    // Most important first: it anchors its stack and its icon is the one shown on top.
    const rank = (e: Entry) => (e.off ? 2000 : 0) + (e.isDone ? 1000 : 0) + (e.alt ? 500 : 0) + (e.n ?? 400);
    entries.sort((a, b) => rank(a) - rank(b));
    // Objectives of one quest at the same spot (Bullshit: a rifle, a watch and a flash drive stashed
    // in the same trash bags) become one marker carrying all of their items. Spawn groups and kill
    // zones keep their own marker.
    const markers: Entry[] = [];
    const atSpot = new Map<string, Entry>();
    for (const e of entries) {
      const key = `${e.o.task.id}|${e.where?.id ?? ''}|${Math.round(e.loc.x / 2)}|${Math.round(e.loc.z / 2)}`;
      const first = atSpot.get(key);
      const plain = (x: Entry) => x.spots.length === 1 && x.o.spots.flat().length === 1 && x.o.areas.length === 0;
      if (first && plain(first) && plain(e)) first.also.push(e);
      else {
        atSpot.set(key, e);
        markers.push(e);
      }
    }
    const flat = (list: Entry[]) => list.flatMap((x) => [x, ...x.also]);

    const pick = (e: Entry) => (e.off ? handlers.current.onFloor(e.where!.id) : handlers.current.onToggleDone(e.o.objective.id));
    /** A small list at a spot to tick objectives off one by one (or jump to their floor). */
    const pickList = (list: Entry[], at: Vec3, marker: L.Marker) => {
      if (!m) return;
      marker.closeTooltip();
      const popup = L.popup({ className: 'stack-pop', offset: [0, -10], maxWidth: 340 })
        .setLatLng(toLatLng(at))
        .setContent(stackList(list, c, multi, true))
        .openOn(m);
      popup.getElement()?.addEventListener('click', (ev) => {
        const row = (ev.target as HTMLElement).closest<HTMLElement>('[data-i]');
        if (!row) return;
        m.closePopup(popup);
        pick(list[Number(row.dataset.i)]!);
      });
    };
    const objLayer = L.layerGroup().addTo(group);
    // Extras of one objective, shown while its marker is hovered, or kept by clicking the marker
    // (or its button in the quest list): rings on every possible spawn of a quest item, and the
    // area of a kill zone. Nothing is drawn otherwise.
    const pins = props.pinned;
    const ringLayer = L.layerGroup().addTo(group);
    const ringsOf = new Map<string, L.LayerGroup>();
    const showRings = (o: MapObjective) => {
      if (ringsOf.has(o.objective.id)) return;
      const lg = L.layerGroup().addTo(ringLayer);
      for (const a of o.areas) {
        const here = on(a.outline[0]!);
        L.polygon(a.outline.map(toLatLng), {
          color: c[o.kind],
          weight: 2.5,
          dashArray: '7 5',
          opacity: here ? 0.95 : 0.4,
          fillColor: c[o.kind],
          fillOpacity: here ? 0.16 : 0.06,
          interactive: false,
        }).addTo(lg);
      }
      if (o.spots.flat().length > 1) for (const sp of o.spots.flat()) {
        L.marker(toLatLng(sp), {
          icon: L.divIcon({
            className: `mk-wrap${on(sp) ? '' : ' off-floor'}`,
            html: `<div class="spawn-ring" style="--c:${c[o.kind]}"><span></span></div>`,
            iconSize: [22, 22],
          }),
          interactive: false,
          keyboard: false,
          zIndexOffset: -500,
        }).addTo(lg);
      }
      ringsOf.set(o.objective.id, lg);
    };
    const hideRings = (o: MapObjective) => {
      if (pins.has(o.objective.id)) return;
      ringsOf.get(o.objective.id)?.remove();
      ringsOf.delete(o.objective.id);
    };
    const m = map.current;
    const drawSingle = (e: Entry) => {
      const { o, loc, n, alt, where, off, spots } = e;
      const group = [e, ...e.also];
      const isDone = group.every((x) => x.isDone);
      const items = [...new Map(group.map((x) => x.item).filter((x): x is ApiItem => !!x).map((x) => [x.id, x])).values()];
      // Off-floor markers say which way to go: ▲ above the floor shown, ▼ below it.
      const dir = off ? floorBadge(where!, floor!) : '';
      const kills = killCount(o.objective);
      const html = `<div class="mk${isDone ? ' mk-done' : ''}${alt ? ' mk-alt' : ''}" style="--c:${c[o.kind]}">${glyph(o.kind, 14)}${kills ? `<span class="mk-kills">×${kills}</span>` : ''}${o.task.kappaRequired ? '<span class="mk-k">K</span>' : ''}${dir}${itemBadges(items)}</div>`;
      // A quest item with several possible spawns, or a kill zone: hovering shows its spawn points
      // or area, clicking keeps them (so clicking doesn't tick it off; the quest list does).
      const allSpots = o.spots.flat().length;
      const multi = allSpots > 1;
      const zone = o.areas.length > 0;
      const extras = multi || zone;
      const isPinned = () => pins.has(o.objective.id);
      const textOf = () => {
        const what = zone ? 'the kill zone' : 'the spawn points';
        const action = off
          ? `Click to show ${escapeHtml(where!.name)}`
          : group.length > 1
            ? 'Click to tick them off one by one'
            : extras
            ? `Click to ${isPinned() ? 'stop showing' : 'keep showing'} ${what} · tick it off in the quest list`
            : `Click to mark ${isDone ? 'not done' : 'done'}`;
        const many = multi
          ? `<br><b class="spots-n">${allSpots} possible spawn points</b>${spots.length < allSpots ? ` <span class="muted">(${spots.length} here)</span>` : ''} <span class="muted">· ringed on the map</span>`
          : zone
            ? `<br><b class="spots-n">Kill zone</b> <span class="muted">· the kills count inside the outlined area</span>`
            : '';
        // Several objectives here: one line each, with its item (ticked ones struck through).
        const lines =
          group.length > 1
            ? group
                .map((x) => `<div class="grp-row${x.isDone ? ' st-done' : ''}">${killCount(x.o.objective) ? `<b>×${killCount(x.o.objective)}</b> ` : ''}${escapeHtml(x.o.objective.description)}${x.item ? ` <span class="muted">· ${escapeHtml(x.item.name)}</span>` : ''}</div>`)
                .join('')
            : `<br>${escapeHtml(o.objective.description)}${many}${itemLine(e)}`;
        return `<b>${MARKER_LABEL[o.kind]}</b> · ${escapeHtml(o.task.name)}${o.task.kappaRequired ? ' <span class="kappa">K</span>' : ''}${group.length > 1 ? ` <span class="muted">· ${group.length} objectives here</span>` : ''}${lines}${where ? `<br><span class="muted">${escapeHtml(where.name)}</span>` : ''}<br><i>${action}</i>`;
      };
      let photoHtml = '';
      const marker = L.marker(toLatLng(loc), {
        icon: L.divIcon({ className: `mk-wrap${off ? ' off-floor' : ''}`, html, iconSize: [26, 26] }),
        zIndexOffset: off ? -1000 : n ? 1000 : 0,
        keyboard: false,
      })
        .bindTooltip(textOf(), { direction: 'top', offset: [0, -12] })
        .on('click', () => {
          if (!off && group.length > 1) return pickList(group, loc, marker);
          if (off || !extras) return pick(e);
          handlers.current.onTogglePin(o.objective.id); // redraws with the extras kept (or not)
        })
        .addTo(objLayer);
      if (extras) {
        marker.on('mouseover', () => showRings(o));
        marker.on('mouseout', () => hideRings(o));
        if (isPinned()) showRings(o);
      }
      // Location photos: asked for on first hover only, then shown from the saved copy.
      marker.on('tooltipopen', () => {
        marker.getTooltip()?.setContent(textOf() + photoHtml);
        const photosFor = handlers.current.photosFor;
        if (!photosFor) return;
        void photosFor(o).then((photos) => {
          const tip = marker.getTooltip();
          if (!photos.length || !tip || !marker.isTooltipOpen()) return;
          photoHtml = photosHtml(photos, multi ? 9 : 3);
          tip.setContent(textOf() + photoHtml);
          const el = tip.getElement();
          el?.classList.add('photo-tip');
          if (el && m) placeTall(m, marker, tip, el);
        });
      });
    };
    const draw = () => {
      objLayer.clearLayers();
      ringLayer.clearLayers();
      ringsOf.clear();
      if (!m) return;
      // Stacks only for the overview: the ground floor with the whole map in view. On another
      // floor, or once zoomed in at all, every objective is drawn at its own spot.
      const overview = m.getZoom() <= m.getBoundsZoom(boundsOf(props.display.bounds)) + 0.01;
      if (!overview || (floor && !floor.base)) {
        markers.forEach(drawSingle);
        return;
      }
      const stacks = clusterPoints(
        markers.map((e) => {
          const pt = m.latLngToLayerPoint(toLatLng(e.loc));
          return { item: e, x: pt.x, y: pt.y };
        }),
        STACK_RADIUS,
      );
      for (const st of stacks) {
        for (const e of st) if (pins.has(e.o.objective.id)) showRings(e.o); // pinned extras stay
        const top = st[0]!;
        if (st.length === 1) {
          drawSingle(top);
          continue;
        }
        const inside = flat(st);
        const allOff = inside.every((e) => e.off);
        // A small fanned pile: up to 3 markers in their own colours (different types first), the
        // most important in front, so a stack never hides what kinds of objectives are in it.
        const kinds = [...new Set(inside.map((e) => e.o.kind))];
        const pile = (kinds.length >= 3 ? kinds.slice(0, 3) : [...kinds, ...inside.map((e) => e.o.kind)].slice(0, Math.min(3, inside.length))).reverse();
        const html =
          `<div class="mk-pile">` +
          pile
            .slice(0, -1)
            .map((k, i) => `<span class="mk mk-under" style="--c:${c[k]};--i:${pile.length - 1 - i}">${glyph(k, 12)}</span>`)
            .join('') +
          `<div class="mk mk-stack" style="--c:${c[pile[pile.length - 1]!]}">` +
          glyph(pile[pile.length - 1]!, 14) +
          `<span class="mk-count">${inside.length}</span>` +
          (inside.some((e) => e.o.task.kappaRequired) ? '<span class="mk-k">K</span>' : '') +
          (allOff ? floorBadge(top.where!, floor!) : '') +
          itemBadges(top.item ? [top.item] : []) +
          '</div></div>';
        const pts = L.latLngBounds(st.map((e) => toLatLng(e.loc)));
        const canZoom = m.getZoom() < m.getMaxZoom() && m.getBoundsZoom(pts.pad(0.5)) > m.getZoom();
        const marker = L.marker(toLatLng(top.loc), {
          icon: L.divIcon({ className: `mk-wrap${allOff ? ' off-floor' : ''}`, html, iconSize: [26, 26] }),
          zIndexOffset: allOff ? -1000 : 1500,
          keyboard: false,
        })
          .bindTooltip(stackList(inside, c, multi) + `<div class="st-foot">${canZoom ? 'Click to zoom in' : 'Click to choose one'}</div>`, {
            direction: 'top',
            offset: [0, -12],
            className: 'stack-tip',
          })
          .addTo(objLayer);
        marker.on('click', () => {
          if (canZoom) {
            userMoved.current = true;
            m.fitBounds(pts, { padding: [80, 80], maxZoom: m.getMaxZoom() });
            return;
          }
          // Too close to separate (e.g. the same spot on several floors): pick from a list.
          pickList(inside, top.loc, marker);
        });
      }
    };
    draw();
    m?.on('zoomend', draw);

    const start = props.routeStart;
    if (start) {
      const yaw = (props.player?.yaw ?? 0) + (props.display.coordinateRotation ?? 0) + props.rotation;
      // A soft ring around the arrow keeps "you" easy to find at any zoom.
      const html = `<div class="you" style="--c:${c.player}"><div class="player" style="transform: rotate(${yaw}deg)"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2l7 19-7-4-7 4z" fill="${c.player}" stroke="#000" stroke-width="1.5"/></svg></div></div>`;
      L.marker(toLatLng(start), { icon: L.divIcon({ className: 'mk-wrap', html, iconSize: [34, 34] }), zIndexOffset: 2000, interactive: false }).addTo(group);
    }
    return () => {
      m?.off('zoomend', draw);
    };
  }, [props.objectives, props.done, props.route, props.routeStart, props.player, props.extracts, props.spawns, props.bdZones, props.pois, props.display, props.colors, props.floors, props.floor, props.pinned, props.rotation]);

  // A new screenshot position: pulse a few rings on the spot, so you see at a glance where you
  // are. The zoom stays as it is; the map only pans if you're off screen.
  const shot = props.player && props.player.file !== 'manual' ? props.player : null;
  const shotKey = shot ? `${shot.file}|${shot.position.x}|${shot.position.z}` : null;
  const [offMap, setOffMap] = useState(false);
  useEffect(() => {
    const m = map.current;
    if (!m || !shot) {
      setOffMap(false);
      return;
    }
    const at = L.latLng(toLatLng(shot.position));
    const inside = boundsOf(props.display.bounds).pad(0.05).contains(at);
    setOffMap(!inside);
    if (!inside) return;
    // No zoom: the pulse shows where you are. Only pan if you're outside the visible part of the map.
    if (!m.getBounds().contains(at)) {
      userMoved.current = true; // keep this view when the panel resizes
      m.panTo(at, { animate: true });
    }
    const pulse = L.marker(at, {
      icon: L.divIcon({ className: 'mk-wrap', html: `<div class="you-pulse" style="--c:${props.colors.player}"><i></i><i></i><i></i></div>`, iconSize: [120, 120] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1900,
    }).addTo(m);
    const t = setTimeout(() => pulse.remove(), 2600);
    return () => {
      clearTimeout(t);
      pulse.remove();
    };
    // Only a new screenshot (or a new map) triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotKey, props.display, props.rotation]);

  return (
    <>
      {offMap && (
        <div className="map-msg">Your screenshot position isn't on this map. Pick the map you're on from the list at the top.</div>
      )}
      {/* Route-number badges match the route line. */}
      {/* className stays fixed: Leaflet adds its own classes to this element, and React rewriting
          className (e.g. for "picking") would wipe them and break the map's layout. */}
      <div ref={el} className="map" style={{ '--route': props.colors.route } as CSSProperties} />
      {props.floors.length > 0 && props.floor && (
        <FloorPicker
          floors={props.floors}
          floor={props.floor}
          onFloor={props.onFloor}
          objectives={props.objectives}
          done={props.done}
          player={props.routeStart}
        />
      )}
    </>
  );
}

/**
 * Elevator-style floor buttons on the map's right edge (top floor at the top). Each shows how many
 * objectives are left on it, and a dot marks the floor you're on.
 */
function FloorPicker(p: {
  floors: Floor[];
  floor: Floor;
  onFloor: (id: string) => void;
  objectives: MapObjective[];
  done: Set<string>;
  player: Vec3 | null;
}) {
  const left = new Map<string, number>();
  for (const o of p.objectives) {
    if (o.objective.optional || p.done.has(o.objective.id)) continue;
    for (const id of new Set(o.locations.map((l) => floorOf(l, p.floors)!.id))) left.set(id, (left.get(id) ?? 0) + 1);
  }
  const you = p.player ? floorOf(p.player, p.floors)?.id : null;
  const labels = shortLabels(p.floors);
  return (
    <div className="floors" role="toolbar" aria-label="Floors">
      <div className="floors-stack" title={`${p.floor.name} shown · PageUp / PageDown to change`}>
        {[...p.floors].reverse().map((f) => {
          const n = left.get(f.id) ?? 0;
          return (
            <button
              key={f.id}
              className={`floor-btn${f.id === p.floor.id ? ' on' : ''}`}
              title={`${f.name}${n ? ` · ${n} objective${n === 1 ? '' : 's'} left` : ''}${f.id === you ? ' · you are here' : ''}`}
              onClick={() => p.onFloor(f.id)}
            >
              {labels.get(f.id)}
              {n > 0 && <span className="floor-n">{n}</span>}
              {f.id === you && <span className="floor-you" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Button labels: G for the ground, 2/3/4… for numbered floors, B1/B2 below ground, else a short name. */
function shortLabels(floors: Floor[]): Map<string, string> {
  const out = new Map<string, string>();
  const below = floors.filter((f) => f.level < 0).reverse(); // nearest the ground first
  for (const f of floors) {
    const num = /\b(\d+)(?:st|nd|rd|th)\b/i.exec(f.name)?.[1];
    if (f.base) out.set(f.id, f.name === 'First Level' ? '1' : 'G');
    else if (f.level < 0) out.set(f.id, below.length === 1 ? 'B' : `B${below.indexOf(f) + 1}`);
    else if (num) out.set(f.id, num);
    else if (Number.isInteger(f.level)) out.set(f.id, String(f.level + 1));
    else out.set(f.id, f.name.replace(/[^A-Za-z]/g, '').slice(0, 3));
  }
  return out;
}

/** Markers closer than this on screen (px) are stacked. */
const STACK_RADIUS = 24;

/** One objective spot on the map. */
interface Entry {
  o: MapObjective;
  loc: Vec3;
  /** Route stop number, if this spot is on the route. */
  n: number | null;
  isDone: boolean;
  alt: boolean;
  where: Floor | null;
  /** On a floor other than the one shown. */
  off: boolean;
  /** The item this objective needs (marker, camera, stash item, key…), shown on the marker. */
  item: ApiItem | null;
  /** Every exact spot this marker stands for (more than one: possible spawns close together). */
  spots: Vec3[];
  /** Other objectives of the same quest at the same spot, drawn as this one marker. */
  also: Entry[];
}

/** The items' pictures in a row of small chips on the marker's right side (up to 4, then "+n"). */
function itemBadges(items: ApiItem[]): string {
  const shown = items.filter((i) => i.iconLink);
  if (!shown.length) return '';
  const chips = shown
    .slice(0, 4)
    .map((i) => `<span class="mk-item" title="${escapeHtml(i.name)}"><img class="mk-item-img" src="${escapeHtml(i.iconLink!)}" alt="" loading="lazy" decoding="async"></span>`)
    .join('');
  const more = shown.length > 4 ? `<span class="mk-item mk-more">+${shown.length - 4}</span>` : '';
  return `<span class="mk-items">${chips}${more}</span>`;
}

function itemLine(e: Entry): string {
  const kills = killCount(e.o.objective);
  return (
    (kills ? `<br><span class="muted">Kills needed:</span> <b>${kills}</b>` : '') +
    (e.item ? `<br><span class="muted">Needs:</span> ${escapeHtml(e.item.name)}` : '')
  );
}

// Item pictures that fail to load (offline, missing) are removed instead of showing a broken image.
document.addEventListener(
  'error',
  (ev) => {
    const t = ev.target as HTMLElement | null;
    if (t?.classList?.contains('mk-item-img')) t.parentElement?.remove();
  },
  true,
);

/**
 * Puts a tall (photo) tooltip where it fits inside the map: above the marker, else below,
 * else beside it (left or right, centred), else a compact version (smaller photo, no thumbnails).
 */
function placeTall(m: L.Map, marker: L.Marker, tip: L.Tooltip, el: HTMLElement) {
  const size = m.getSize();
  const p = m.latLngToContainerPoint(marker.getLatLng());
  const pad = 18;
  el.classList.remove('ph-compact'); // the tooltip element is reused between hovers
  const room = { top: p.y - pad, bottom: size.y - p.y - pad, left: p.x - pad, right: size.x - p.x - pad };
  const fits = () => {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const centredX = p.x - w / 2 >= 4 && p.x + w / 2 <= size.x - 4;
    const centredY = p.y - h / 2 >= 4 && p.y + h / 2 <= size.y - 4;
    if (h <= room.top && centredX) return 'top';
    if (h <= room.bottom && centredX) return 'bottom';
    if (w <= room.right && centredY) return 'right';
    if (w <= room.left && centredY) return 'left';
    return null;
  };
  let dir = fits();
  if (!dir) {
    el.classList.add('ph-compact');
    dir = fits() ?? (room.bottom > room.top ? 'bottom' : 'top');
  }
  const offsets: Record<string, [number, number]> = { top: [0, -12], bottom: [0, 14], right: [14, 0], left: [-14, 0] };
  tip.options.direction = dir as L.Direction;
  tip.options.offset = offsets[dir]!;
  for (const d of ['top', 'bottom', 'left', 'right']) el.classList.toggle(`leaflet-tooltip-${d}`, d === dir);
  tip.update();
}

/**
 * Up to three guide photos: the best match large with its caption, the rest as thumbnails.
 * Fixed sizes, so the tooltip doesn't jump while they load.
 */
function photosHtml(photos: GuideImage[], max = 3): string {
  const [main, ...more] = photos.slice(0, max);
  if (!main?.url) return '';
  const img = (ph: GuideImage, cls: string) =>
    // no-referrer: Fandom's image server answers other sites' pages with a placeholder. The extra
    // "th" parameter keeps WebView2 from reusing a placeholder cached before this was fixed.
    `<img class="${cls}" src="${escapeHtml(ph.url! + (ph.url!.includes('?') ? '&' : '?') + 'th=1')}" alt="${escapeHtml(ph.caption)}" title="${escapeHtml(ph.caption)}" referrerpolicy="no-referrer" decoding="async">`;
  return (
    `<div class="ph">${img(main, 'ph-main')}` +
    (main.caption ? `<div class="ph-cap">${escapeHtml(main.caption)}</div>` : '') +
    (more.length ? `<div class="ph-more">${more.map((ph) => img(ph, 'ph-thumb')).join('')}</div>` : '') +
    `<div class="ph-credit">Photos: Escape from Tarkov Wiki (CC BY-SA)</div></div>`
  );
}

/** The quests in a stack, one row each (rows are clickable in the popup version). */
function stackList(st: Entry[], c: Record<ColorKey, string>, multi: boolean, clickable = false): string {
  const rows = st
    .map((e, i) => {
      const tag = clickable ? 'button' : 'div';
      return (
        `<${tag} class="st-row${e.isDone ? ' st-done' : ''}${e.off ? ' st-off' : ''}"${clickable ? ` data-i="${i}"` : ''}>` +
        `<span class="st-ic" style="color:${c[e.o.kind]}">${glyph(e.o.kind, 13)}</span>` +
        `<span class="st-txt"><b>${MARKER_LABEL[e.o.kind]}</b> · ${escapeHtml(e.o.task.name)}` +
        (e.o.task.kappaRequired ? ' <span class="kappa">K</span>' : '') +
        (e.item ? ` <span class="muted">· ${escapeHtml(e.item.shortName || e.item.name)}</span>` : '') +
        (e.spots.length > 1 ? ` <span class="muted">· ${e.spots.length} spots</span>` : '') +
        (killCount(e.o.objective) ? ` <span class="muted">· ×${killCount(e.o.objective)} kills</span>` : '') +
        (multi && e.where ? ` <span class="muted">· ${escapeHtml(e.where.name)}</span>` : '') +
        `</span>` +
        `</${tag}>`
      );
    })
    .join('');
  return `<div class="st-head">${st.length} objectives here</div>${rows}`;
}

/** ▲ for a spot above the floor shown, ▼ below it. */
function floorBadge(where: Floor, shown: Floor): string {
  return `<span class="mk-f" title="${escapeHtml(where.name)}">${where.level > shown.level ? '▲' : '▼'}</span>`;
}

/** A height on the floor shown, for a start point picked by clicking the map. */
function floorHeight(f: Floor | null): number {
  const h = f?.extents[0]?.height;
  if (!f || !h || (f.base && h[0] <= 0 && 0 < h[1])) return 0;
  const lo = Math.max(h[0], -50);
  const hi = Math.min(h[1], 100);
  return (lo + hi) / 2;
}

function tileOptions(d: MapDisplay, bounds: L.LatLngBounds): L.TileLayerOptions {
  return { bounds, tileSize: d.tileSize ?? 256, maxNativeZoom: d.maxZoom, maxZoom: Math.max(7, d.maxZoom ?? 6) };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
