import type { DataStorage, Fetcher } from './dataSource';
import { parseChapterIndex, parseStory, STORY_INDEX_TITLE, WIKI_BASE, type StoryChapter, type WikiPage } from './story';

/** Saved as cache/story.json (and build/snapshot/story.json by scripts/snapshot.mjs). */
export interface StoryFile {
  fetchedAt: string;
  pages: WikiPage[];
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const API = `${WIKI_BASE}/api.php`;

/** Raw wikitext of the given pages, in one request. */
async function fetchPages(fetcher: Fetcher, titles: string[]): Promise<WikiPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
    titles: titles.join('|'),
  });
  const res = await fetcher(`${API}?${params}`, { headers: { 'User-Agent': 'escape-artist/0.2 (desktop app)' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`wiki responded ${res.status}`);
  const json = JSON.parse(await res.text()) as { query?: { pages?: { title: string; missing?: boolean; revisions?: { slots: { main: { content: string } } }[] }[] } };
  return (json.query?.pages ?? [])
    .filter((p) => !p.missing && p.revisions?.[0])
    .map((p) => ({ title: p.title, content: p.revisions![0]!.slots.main.content }));
}

/** Downloads the chapter index, then every chapter page it lists. */
export async function downloadStory(fetcher: Fetcher): Promise<StoryFile> {
  const [index] = await fetchPages(fetcher, [STORY_INDEX_TITLE]);
  if (!index) throw new Error('wiki story index not found');
  const titles = parseChapterIndex(index.content);
  if (titles.length === 0) throw new Error('wiki story index has no chapters');
  const pages = await fetchPages(fetcher, titles);
  return { fetchedAt: new Date().toISOString(), pages: [index, ...pages] };
}

/**
 * Story chapters: the saved copy if it's less than a day old (wiki pages rarely change),
 * otherwise the wiki; on failure the saved copy, then the snapshot bundled with the installer.
 */
export class StorySource {
  private memo: { chapters: StoryChapter[]; fetchedAt: string } | null = null;

  constructor(
    private readonly storage: DataStorage,
    private readonly fetcher: Fetcher,
  ) {}

  async get(force = false): Promise<{ chapters: StoryChapter[]; fetchedAt: string }> {
    if (this.memo && !force) return this.memo;
    const saved = await this.read(() => this.storage.read('story.json'));
    let file = saved && !force && Date.now() - Date.parse(saved.fetchedAt) < MAX_AGE_MS ? saved : null;
    if (!file) {
      try {
        file = await downloadStory(this.fetcher);
        if (parseStory(file.pages).length === 0) throw new Error('no chapters parsed');
        await this.storage.write('story.json', JSON.stringify(file));
      } catch {
        file = saved ?? (await this.read(() => this.storage.readSnapshot('story.json')));
      }
    }
    if (!file) throw new Error('Story chapters unavailable (wiki unreachable and no saved copy).');
    this.memo = { chapters: parseStory(file.pages), fetchedAt: file.fetchedAt };
    return this.memo;
  }

  private async read(load: () => Promise<string | null>): Promise<StoryFile | null> {
    try {
      const text = await load();
      return text ? (JSON.parse(text) as StoryFile) : null;
    } catch {
      return null;
    }
  }
}
