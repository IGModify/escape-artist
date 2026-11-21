// Downloads the current tarkov.dev data + map images into build/snapshot so the installer
// ships with working data (used on first launch or when tarkov.dev can't be reached).
// Runs automatically as part of `npm run dist`. Layout matches the app's on-disk cache.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRIM_FORMAT, trimRaw } from '../src/shared/trimRaw.ts';
import { parseChapterIndex, parseStory, STORY_INDEX_TITLE } from '../src/shared/story.ts';

/** Main story chapter pages from the wiki, same format the app caches (StoryFile). */
async function wikiStory() {
  const query = async (titles) => {
    const params = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', format: 'json', formatversion: '2', titles: titles.join('|') });
    const { body } = await get(`https://escapefromtarkov.fandom.com/api.php?${params}`);
    return body.query.pages.filter((p) => !p.missing).map((p) => ({ title: p.title, content: p.revisions[0].slots.main.content }));
  };
  const [index] = await query([STORY_INDEX_TITLE]);
  const pages = [index, ...(await query(parseChapterIndex(index.content)))];
  if (parseStory(pages).length === 0) throw new Error('no story chapters parsed');
  return { fetchedAt: new Date().toISOString(), pages };
}

const root = join(import.meta.dirname, '..');
const out = join(root, 'build', 'snapshot');
const files = JSON.parse(readFileSync(join(root, 'src', 'shared', 'jsonFiles.json'), 'utf8'));
const MAPS_CONFIG_URL = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json';
const UA = 'escape-artist/0.2 (build snapshot)';

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return { body: as === 'json' ? await res.json() : await res.text(), etag: res.headers.get('etag') ?? '' };
}

try {
  const results = await Promise.all([
    ...files.map(async (n) => [n, await get(`https://json.tarkov.dev/regular/${n}`)]),
    get(MAPS_CONFIG_URL).then((r) => ['display', r]),
  ]);
  const tasks = Object.keys(results.find(([n]) => n === 'tasks')[1].body?.data?.tasks ?? {}).length;
  if (tasks < 50) throw new Error(`only ${tasks} tasks in json.tarkov.dev data`);

  const staging = `${out}.tmp`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, 'svg'), { recursive: true });
  for (const [n, r] of results) writeFileSync(join(staging, `${n}.json`), JSON.stringify(trimRaw(n, r.body)));
  // ETags are deliberately left out: the app must download its own copy once online.
  writeFileSync(join(staging, 'meta.json'), JSON.stringify({ etags: {}, fetchedAt: new Date().toISOString(), format: TRIM_FORMAT }));

  const display = results.find(([n]) => n === 'display')[1].body;
  const svgs = [...new Set(display.flatMap((g) => g.maps.filter((m) => m.projection === 'interactive' && m.svgPath).map((m) => m.svgPath)))];
  let svgBytes = 0;
  for (const url of svgs) {
    try {
      const { body } = await get(url, 'text');
      writeFileSync(join(staging, 'svg', `svg-${createHash('sha1').update(url).digest('hex')}.svg`), body);
      svgBytes += body.length;
    } catch (e) {
      console.warn(`  map image skipped: ${e.message}`);
    }
  }
  rmSync(out, { recursive: true, force: true });
  try {
    const story = await wikiStory();
    writeFileSync(join(staging, 'story.json'), JSON.stringify(story));
    console.log(`  story: ${parseStory(story.pages).length} chapters from the wiki`);
  } catch (e) {
    console.warn(`  story chapters skipped: ${e.message}`);
  }
  renameSync(staging, out);
  console.log(`snapshot: ${tasks} tasks, ${svgs.length} map images (${(svgBytes / 1e6).toFixed(1)} MB) → build/snapshot`);
} catch (e) {
  if (existsSync(join(out, 'meta.json'))) {
    const age = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8')).fetchedAt;
    console.warn(`snapshot: download failed (${e.message}); keeping the previous snapshot from ${age}`);
  } else {
    console.warn(`snapshot: download failed (${e.message}); building without bundled data`);
  }
}
