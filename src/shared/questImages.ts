// Location photos for quests, from the "Guide" section of each quest's page on the EFT Wiki.
// Guides group captioned photos into galleries, usually one per map ("The 'microwave on the
// 3rd floor of dorms' is in the kitchen … on [[Customs]]" followed by its photos).
import type { DataStorage, Fetcher } from './dataSource';
import { cleanWikitext, mapsMentioned, WIKI_BASE } from './story';

export interface GuideImage {
  /** Wiki file name, without "File:". */
  file: string;
  caption: string;
  /** Maps (tarkov.dev normalizedName) this photo is about; empty = not tied to a map. */
  maps: string[];
  /** Text around the photo (paragraph + caption), used to match it to an objective. */
  context: string;
  /** Small preview to show (filled in after the parse). */
  url?: string;
}

/** Wiki page title from a tarkov.dev wikiLink ("…/wiki/Chemical_-_Part_4" → "Chemical - Part 4"). */
export function wikiTitle(wikiLink: string | null | undefined): string | null {
  const m = /\/wiki\/([^?#]+)/.exec(wikiLink ?? '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!).replace(/_/g, ' ');
  } catch {
    return null;
  }
}

// Item icons and other decoration that aren't location photos.
const NOT_A_PHOTO = /icon|\.svg$|\.gif$|banner|logo|portrait/i;

/**
 * Map screenshots ("Warehouse marked on map", "BigCustomerMap.jpg"): the app already draws the
 * map, so only in-game photos of the spot are kept.
 */
export function isMapImage(file: string, caption: string): boolean {
  return /\bmaps?\b/i.test(caption) || /map/i.test(file);
}

/** Every captioned photo in a page section (a quest's Guide, a story chapter's Requirements). */
export function parseGuideImages(wikitext: string, sectionName = 'Guide'): GuideImage[] {
  const start = wikitext.search(new RegExp(`^==\\s*${sectionName}\\s*==\\s*$`, 'm'));
  if (start < 0) return [];
  const rest = wikitext.slice(start).replace(/^.*\n/, '');
  const end = rest.search(/^==[^=]/m);
  const guide = end >= 0 ? rest.slice(0, end) : rest;

  const out: GuideImage[] = [];
  const seen = new Set<string>();
  const add = (file: string, caption: string, around: string) => {
    file = file.trim().replace(/^(?:File|Image):/i, '').replace(/_/g, ' ');
    if (!file || NOT_A_PHOTO.test(file) || isMapImage(file, caption) || seen.has(file.toLowerCase())) return;
    seen.add(file.toLowerCase());
    const cap = cleanWikitext(caption);
    out.push({ file, caption: cap, maps: mapsMentioned(`${around}\n${caption}`), context: `${cleanWikitext(around)} ${cap}`.trim() });
  };

  // Walk galleries and inline [[File:…]] images in order; the text since the previous one
  // is the paragraph that introduces them (and usually names the map).
  const token = /<gallery[^>]*>([\s\S]*?)<\/gallery>|\[\[(?:File|Image):([^\]|]+)((?:\|[^\]]*)?)\]\]/gi;
  let last = 0;
  for (const m of guide.matchAll(token)) {
    let before = guide.slice(last, m.index);
    // A sub-heading ("===Factory tripwire spot===") starts a new part: only it and the text
    // under it describe these photos, not the intro above it.
    const headings = [...before.matchAll(/^={3,}[^=\n]+={3,}\s*$/gm)];
    const lastHeading = headings[headings.length - 1];
    if (lastHeading) before = before.slice(lastHeading.index);
    // Skip the item tables at the top of most guides ({| … |}): their files are item icons.
    const paragraph = before.replace(/\{\|[\s\S]*?\|\}/g, '');
    if (m[1] !== undefined) {
      for (const line of m[1].split('\n')) {
        const g = /^\s*(?:File|Image):([^|]+)\|?(.*)$/i.exec(line);
        if (g) add(g[1]!, g[2] ?? '', paragraph);
      }
    } else {
      const opts = (m[3] ?? '').split('|').slice(1);
      const isIcon = opts.some((o) => /^\d+px$|frameless|link=/i.test(o.trim())) && !opts.some((o) => /thumb/i.test(o));
      if (!isIcon) add(m[2]!, opts.filter((o) => !/^(thumb|frame|left|right|center|upright|\d+px)/i.test(o.trim())).pop() ?? '', paragraph);
    }
    last = (m.index ?? 0) + m[0].length;
  }
  return out;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

/**
 * The photos to show for one objective on one map: photos tied to this map (or to no map),
 * best match to the objective's text first.
 */
export function imagesForObjective(images: GuideImage[], mapNormalizedName: string, objectiveText: string): GuideImage[] {
  const map = mapNormalizedName.replace(/^night-factory$/, 'factory').replace(/-21$/, '');
  const here = images.filter((i) => i.maps.length === 0 || i.maps.includes(map));
  // A guide that names maps for some photos: photos without a map belong to the others.
  const tied = here.filter((i) => i.maps.includes(map));
  const pool = tied.length ? tied : here;
  const want = words(objectiveText);
  // Words shared with the photo's own caption count double: photos in one gallery share a paragraph.
  const hits = (s: string) => [...words(s)].filter((w) => want.has(w)).length;
  const score = (i: GuideImage) => hits(i.context) + 2 * hits(i.caption);
  return [...pool].sort((a, b) => score(b) - score(a));
}

// ---------- download + cache ----------

const API = `${WIKI_BASE}/api.php`;
const UA = { 'User-Agent': 'escape-artist/0.2 (desktop app)' };
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Preview width: sharp in a tooltip, ~5–30 KB each. */
const THUMB_WIDTH = 320;

/** Bump when parsing changes, so copies saved by an older version are fetched again. */
const FORMAT = 3;

interface ImagesFile {
  format?: number;
  fetchedAt: string;
  images: GuideImage[];
}

async function getJson<T>(fetcher: Fetcher, params: Record<string, string>): Promise<T> {
  const res = await fetcher(`${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, {
    headers: UA,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`wiki responded ${res.status}`);
  return JSON.parse(await res.text()) as T;
}

/** A quest page's guide photos with preview links: two small requests. */
export async function downloadQuestImages(fetcher: Fetcher, title: string, sectionName = 'Guide'): Promise<GuideImage[]> {
  const page = await getJson<{ parse?: { wikitext?: string } }>(fetcher, { action: 'parse', page: title, prop: 'wikitext', redirects: '1' });
  const images = parseGuideImages(page.parse?.wikitext ?? '', sectionName);
  if (images.length === 0) return [];
  const info = await getJson<{ query?: { pages?: { title: string; imageinfo?: { thumburl?: string; url?: string }[] }[]; normalized?: { from: string; to: string }[] } }>(fetcher, {
    action: 'query',
    titles: images.map((i) => `File:${i.file}`).join('|'),
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: String(THUMB_WIDTH),
  });
  const urls = new Map<string, string>();
  for (const p of info.query?.pages ?? []) {
    const u = p.imageinfo?.[0]?.thumburl ?? p.imageinfo?.[0]?.url;
    if (u) urls.set(p.title.replace(/^File:/, '').toLowerCase(), u);
  }
  return images.map((i) => ({ ...i, url: urls.get(i.file.toLowerCase()) })).filter((i) => i.url);
}

/**
 * Guide photos per quest, fetched the first time a quest is hovered and saved on disk
 * (cache/quest-images/<taskId>.json) for a week. Wiki problems just mean no photos.
 */
export class QuestImageSource {
  private memo = new Map<string, Promise<GuideImage[]>>();

  constructor(
    private readonly storage: DataStorage,
    private readonly fetcher: Fetcher,
  ) {}

  /** `key` names the saved copy (a task id, or "story-…" for a chapter's start photos). */
  get(key: string, wikiLink: string | null | undefined, sectionName = 'Guide'): Promise<GuideImage[]> {
    let p = this.memo.get(key);
    if (!p) {
      p = this.load(key, wikiLink, sectionName);
      this.memo.set(key, p);
    }
    return p;
  }

  private async load(key: string, wikiLink: string | null | undefined, sectionName: string): Promise<GuideImage[]> {
    const taskId = key;
    const path = `quest-images/${key}.json`;
    let saved: ImagesFile | null = null;
    try {
      const text = await this.storage.read(path);
      saved = text ? (JSON.parse(text) as ImagesFile) : null;
    } catch {
      saved = null;
    }
    if (saved && saved.format === FORMAT && Date.now() - Date.parse(saved.fetchedAt) < MAX_AGE_MS) return saved.images;
    const title = wikiTitle(wikiLink);
    if (!title) return saved?.images ?? [];
    try {
      const images = await downloadQuestImages(this.fetcher, title, sectionName);
      await this.storage.write(path, JSON.stringify({ format: FORMAT, fetchedAt: new Date().toISOString(), images } satisfies ImagesFile));
      return images;
    } catch {
      this.memo.delete(taskId); // try again on a later hover
      return saved?.images ?? [];
    }
  }
}
