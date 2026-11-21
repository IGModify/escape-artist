// Main story chapters, parsed from the Escape from Tarkov Wiki (escapefromtarkov.fandom.com,
// text under CC BY-SA). The wiki has each chapter's steps as text only, with no map positions,
// so the app shows them as a checklist per map rather than as markers or route stops.

export interface StoryStep {
  /** Stable id: chapter + hash of the step text (survives reordering on the wiki). */
  id: string;
  chapter: string;
  text: string;
  /** 0 = step, 1 = sub-step (usually optional). */
  depth: number;
  optional: boolean;
  /** Maps this step happens on (tarkov.dev normalized names), from the step or its guide section. */
  maps: string[];
  /** For chapters that branch: the choice this step belongs to ("If the Armored case was given to Prapor…"). */
  branch?: string;
}

export interface StoryChapter {
  name: string;
  /** Wiki page title (some differ from the name: "The Labyrinth (story chapter)"). */
  page: string;
  wikiUrl: string;
  steps: StoryStep[];
  /** How the chapter starts (its "Requirements" on the wiki); null when the wiki doesn't say. */
  start: StoryStart | null;
}

/** How a chapter starts: something to find, read, visit or get first. */
export interface StoryStart {
  /** "Pick up and read the EMERCOM leaflet from one of the following locations:" */
  intro: string;
  /** Places it can be started from, each with its maps (empty when it isn't tied to a place). */
  options: { text: string; maps: string[] }[];
  /** Starts by itself (Tour is added when the game starts). */
  automatic: boolean;
}

export type ChapterState = 'not-started' | 'in-progress' | 'done';

export interface WikiPage {
  title: string;
  content: string;
}

/** Maps named in plain text as well as links ("…the dorms courtyard on Customs"). */
export function mapsMentioned(wikitext: string): string[] {
  const out = new Set(mapsIn(wikitext));
  const plain = cleanWikitext(wikitext).toLowerCase();
  for (const [name, key] of Object.entries(MAP_PAGES)) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(plain)) out.add(key);
  }
  return [...out];
}

/** Wiki page title of the chapter index. */
export const STORY_INDEX_TITLE = 'Story chapters';
export const WIKI_BASE = 'https://escapefromtarkov.fandom.com';

/** Wiki map page -> tarkov.dev normalizedName. */
export const MAP_PAGES: Record<string, string> = {
  customs: 'customs',
  woods: 'woods',
  interchange: 'interchange',
  factory: 'factory',
  shoreline: 'shoreline',
  reserve: 'reserve',
  lighthouse: 'lighthouse',
  'streets of tarkov': 'streets-of-tarkov',
  'ground zero': 'ground-zero',
  'the lab': 'the-lab',
  'the labyrinth': 'the-labyrinth',
  terminal: 'terminal',
};

/** Chapter page titles listed on the "Story chapters" index page (its table's chapter column). */
export function parseChapterIndex(content: string): string[] {
  const titles: string[] = [];
  for (const line of content.split('\n')) {
    const m = /^\|\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/.exec(line.trim());
    if (m && !/^(file|image):/i.test(m[1]!) && !titles.includes(m[1]!.trim())) titles.push(m[1]!.trim());
  }
  return titles;
}

/** Wikitext -> plain text: links to their label, templates/HTML/emphasis removed. */
export function cleanWikitext(s: string): string {
  return s
    .replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map links ([[Customs]], [[Streets of Tarkov|Streets]]) in a piece of wikitext. */
export function mapsIn(wikitext: string): string[] {
  const out = new Set<string>();
  for (const m of wikitext.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
    const key = MAP_PAGES[m[1]!.trim().toLowerCase()];
    if (key) out.add(key);
  }
  return [...out];
}

function section(content: string, name: string): string {
  const start = content.search(new RegExp(`^==\\s*${name}\\s*==\\s*$`, 'm'));
  if (start < 0) return '';
  const rest = content.slice(start).replace(/^.*\n/, '');
  const end = rest.search(/^==[^=]/m);
  return end < 0 ? rest : rest.slice(0, end);
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));

/**
 * Guide subsections ("===Locate the fallen plane===") with the maps they mention, from every
 * guide section on the page ("Guide", "Chapter Guide", "Terminal Guide"…). A guide section
 * named after a map ("Terminal Guide") counts that map for all its subsections.
 */
function guideSections(content: string): { heading: string; maps: string[] }[] {
  const out: { heading: string; maps: string[] }[] = [];
  const level2 = content.split(/^==([^=\n].*?)==\s*$/m);
  for (let s = 1; s < level2.length; s += 2) {
    const name = level2[s]!.trim();
    if (!/guide/i.test(name)) continue;
    const sectionMap = MAP_PAGES[name.replace(/\s*guide\s*$/i, '').trim().toLowerCase()];
    const parts = (level2[s + 1] ?? '').split(/^===\s*([^=\n].*?)\s*===\s*$/m);
    for (let i = 1; i < parts.length; i += 2) {
      const maps = new Set([...mapsIn(parts[i]!), ...mapsIn(parts[i + 1] ?? '')]);
      if (sectionMap) maps.add(sectionMap);
      out.push({ heading: cleanWikitext(parts[i]!), maps: [...maps] });
    }
  }
  return out;
}

/** Best-matching guide subsection for a step: same words, or one text containing the other. */
function guideMapsFor(stepText: string, guides: { heading: string; maps: string[] }[]): string[] {
  const a = stepText.toLowerCase();
  const aw = words(stepText);
  let best: { score: number; maps: string[] } = { score: 0, maps: [] };
  for (const g of guides) {
    const b = g.heading.toLowerCase();
    let score = a.includes(b) || b.includes(a) ? 1 : 0;
    if (!score) {
      const bw = words(g.heading);
      const shared = [...bw].filter((w) => aw.has(w)).length;
      score = shared / Math.max(1, Math.min(aw.size, bw.size));
    }
    if (score > best.score) best = { score, maps: g.maps };
  }
  return best.score >= 0.6 ? best.maps : [];
}

const TRADER_STEP = /^(?:\(optional\)\s*)?(talk to|hand over|visit|wait for|tell|ask|reach|bring|pay|give|obtain .*(?:hideout|intelligence center)|gain access to|stay on good terms)/i;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The chapter's "Requirements" section: what starts it, and where. */
export function parseStart(content: string): StoryStart | null {
  const req = section(content, 'Requirements')
    .replace(/<gallery[\s\S]*?<\/gallery>/gi, '')
    .replace(/<\/?li[^>]*>/gi, '');
  if (!req.trim()) return null;
  const intro: string[] = [];
  const options: StoryStart['options'] = [];
  for (const line of req.split('\n')) {
    const bullet = /^\*+\s*(.+)$/.exec(line.trim());
    if (bullet) {
      const text = cleanWikitext(bullet[1]!);
      if (text) options.push({ text, maps: mapsMentioned(bullet[1]!) });
    } else if (cleanWikitext(line)) intro.push(cleanWikitext(line));
  }
  const introText = intro.join(' ');
  // No list of places: the sentence itself may name the place ("Locate the white car … on Customs").
  if (options.length === 0) {
    const maps = mapsMentioned(req);
    if (maps.length) options.push({ text: introText, maps });
  }
  return { intro: options.length === 1 && options[0]!.text === introText ? '' : introText, options, automatic: /automatically/i.test(introText) };
}

export function parseChapter(page: WikiPage): StoryChapter {
  const objectives = section(page.content, 'Objectives');
  const guides = guideSections(page.content);
  const steps: StoryStep[] = [];
  const seen = new Map<string, number>();
  let branch: string | undefined;
  for (const line of objectives.split('\n')) {
    // Bold lines start a branch: "'''If the Armored case was given to Prapor in Falling Skies'''".
    const bold = /^'''(.+)'''\s*$/.exec(line.trim());
    if (bold) {
      branch = cleanWikitext(bold[1]!) || undefined;
      continue;
    }
    const m = /^(\*+)\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const text = cleanWikitext(m[2]!);
    if (!text) continue;
    const direct = mapsIn(m[2]!);
    const base = `${page.title}#${hash(`${branch ?? ''}|${text.toLowerCase()}`)}`;
    const n = (seen.get(base) ?? 0) + 1; // identical steps ("Wait for information from Prapor") get distinct ids
    seen.set(base, n);
    steps.push({
      id: n === 1 ? base : `${base}-${n}`,
      chapter: page.title,
      text: text.replace(/^\(Optional\)\s*/i, ''),
      depth: Math.min(m[1]!.length - 1, 2),
      optional: /^\(optional\)/i.test(text),
      // Trader/menu steps happen in the menus: only trust a map their own text names.
      maps: direct.length || TRADER_STEP.test(text) ? direct : guideMapsFor(text, guides),
      ...(branch ? { branch } : {}),
    });
  }
  return {
    name: page.title.replace(/\s*\(story chapter\)$/i, ''),
    page: page.title,
    start: parseStart(page.content),
    wikiUrl: `${WIKI_BASE}/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    steps,
  };
}

/** All chapters, in the wiki index order, skipping pages without objectives. */
export function parseStory(pages: WikiPage[]): StoryChapter[] {
  const index = pages.find((p) => p.title === STORY_INDEX_TITLE);
  const order = index ? parseChapterIndex(index.content) : pages.map((p) => p.title);
  return order
    .map((t) => pages.find((p) => p.title === t))
    .filter((p): p is WikiPage => !!p)
    .map(parseChapter)
    .filter((c) => c.steps.length > 0);
}

/** Story steps that happen on a map, minus the ones ticked off, grouped by chapter. */
/** A step with the sub-steps listed under it. */
interface StepUnit {
  head: StoryStep;
  kids: StoryStep[];
  index: number;
}

function units(c: StoryChapter): StepUnit[] {
  const out: StepUnit[] = [];
  for (const st of c.steps) {
    const last = out[out.length - 1];
    if (st.depth > 0 && last) last.kids.push(st);
    else out.push({ head: st, kids: [], index: out.length });
  }
  return out;
}

/**
 * The step(s) you're on in a chapter, like a side quest's active objectives: everything after the
 * last ticked step up to and including the next required one (optional steps in between run
 * alongside it), with their unticked sub-steps. At a fork, each path's next step is shown until
 * a step on one path is ticked; from then on only that path continues.
 */
export function activeSteps(c: StoryChapter, done: Set<string>): StoryStep[] {
  const all = units(c);
  const isDone = (u: StepUnit) => done.has(u.head.id);
  const chosen = new Set(all.filter((u) => u.head.branch && isDone(u)).map((u) => u.head.branch!));
  const onPath = (u: StepUnit) => !u.head.branch || chosen.size === 0 || chosen.has(u.head.branch);
  let last = -1;
  for (const u of all) if (onPath(u) && isDone(u)) last = u.index;
  const out: StoryStep[] = [];
  const take = (u: StepUnit) => out.push(u.head, ...u.kids.filter((k) => !done.has(k.id)));
  const branchesTaken = new Set<string>();
  for (const u of all.slice(last + 1)) {
    if (!onPath(u) || isDone(u)) continue;
    const b = u.head.branch;
    if (b && branchesTaken.has(b)) continue;
    take(u);
    if (u.head.optional) continue; // optional steps run alongside the next required one
    if (!b) break; // a shared required step: that's the one you're on
    branchesTaken.add(b); // this path's next step; other paths may still show theirs
  }
  return out;
}

/**
 * The steps to tick along with `stepId`: every earlier step of its chapter on the same path
 * (shared steps, and the same branch) — doing a step means the ones before it are done too.
 */
export function stepsUpTo(c: StoryChapter, stepId: string): string[] {
  const i = c.steps.findIndex((st) => st.id === stepId);
  if (i < 0) return [stepId];
  const branch = c.steps[i]!.branch;
  return c.steps.slice(0, i + 1).filter((st) => !st.branch || st.branch === branch).map((st) => st.id);
}

/**
 * Where a chapter is at. It's started once it was marked started, starts by itself, has any
 * step ticked, or the wiki says nothing about starting it; done once every required step is ticked.
 */
export function chapterState(c: StoryChapter, done: Set<string>, started: Set<string>): ChapterState {
  const required = c.steps.filter((s) => !s.optional);
  if (required.length > 0 && required.every((s) => done.has(s.id))) return 'done';
  if (!c.start || c.start.automatic || started.has(c.name) || c.steps.some((s) => done.has(s.id))) return 'in-progress';
  return 'not-started';
}

/**
 * The story for one map: the current steps of chapters in progress, and how to start chapters that
 * haven't started yet (only start options on this map).
 */
export function storyForMap(chapters: StoryChapter[], mapNormalizedName: string, done: Set<string>, started: Set<string> = new Set()) {
  const key = mapNormalizedName === 'night-factory' ? 'factory' : mapNormalizedName.replace(/-21$/, '');
  return chapters
    .map((c) => {
      const state = chapterState(c, done, started);
      return {
        chapter: c,
        state,
        steps: state === 'in-progress' ? activeSteps(c, done).filter((s) => s.maps.includes(key)) : [],
        starts: state === 'not-started' ? (c.start?.options ?? []).filter((o) => o.maps.includes(key)) : [],
      };
    })
    .filter((g) => g.steps.length > 0 || g.starts.length > 0);
}
