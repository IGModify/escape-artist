import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { activeSteps, chapterState, cleanWikitext, stepsUpTo, parseChapter, parseChapterIndex, parseStory, storyForMap, type WikiPage } from './story';
import { StorySource } from './storySource';

// Trimmed from the real wiki pages.
const index: WikiPage = {
  title: 'Story chapters',
  content: `{| class="wikitable sortable"
!Icon
!Chapter
|-
|style="text-align:center;"|[[File:Tour Icon.png|link=Tour]]
|[[Tour]]
|[[File:Tour Banner.png|450px]]
|-
|style="text-align:center;"|[[File:X.png|link=Falling Skies]]
|[[Falling Skies]]
|-
|[[The Labyrinth (story chapter)|The Labyrinth]]
|}`,
};

const fallingSkies: WikiPage = {
  title: 'Falling Skies',
  content: `==Objectives==
* Locate the fallen plane
* Reach Loyalty Level 2 with [[Prapor]]
* (''Optional'') Hand over 2,000 [[Dollars|USD]] to [[Therapist]]
* Retrieve the [[G-Wagon flash drive|flash drive]] from one of the G-Wagon SUVs
* Wait for information from [[Prapor]]
* Wait for information from [[Prapor]]
** (''Optional'') Find any [[Note from Mr. Kerman|additional clues]]
* Hand over 3 found [[Found in raid|<font color="red">in raid</font>]] [[Rechargeable battery|Rechargeable batteries]]

==Guide==
===Locate the fallen plane===
The fallen plane is located on the eastern side of [[Woods]].
===Retrieve the flash drive===
One G-Wagon is on [[Streets of Tarkov|Streets]], the other on [[Lighthouse]].
`,
};

const tour: WikiPage = {
  title: 'Tour',
  content: `==Objectives==
* Escape [[Ground Zero]]
* Survive and extract from [[Customs]] or visit [[Customs]] 3 times
==Guide==
`,
};

describe('story parsing', () => {
  it('reads the chapter list from the index table', () => {
    expect(parseChapterIndex(index.content)).toEqual(['Tour', 'Falling Skies', 'The Labyrinth (story chapter)']);
  });

  it('cleans wikitext', () => {
    expect(cleanWikitext(`Hand over 3 found [[Found in raid|<font color="red">in raid</font>]] [[Rechargeable battery|Rechargeable batteries]]`)).toBe(
      'Hand over 3 found in raid Rechargeable batteries',
    );
  });

  it('finds each step map from its text or its guide section', () => {
    const c = parseChapter(fallingSkies);
    const byText = Object.fromEntries(c.steps.map((s) => [s.text, s.maps]));
    expect(byText['Locate the fallen plane']).toEqual(['woods']);
    expect(byText['Retrieve the flash drive from one of the G-Wagon SUVs']).toEqual(['streets-of-tarkov', 'lighthouse']);
    expect(byText['Reach Loyalty Level 2 with Prapor']).toEqual([]);
  });

  it('marks optional and sub-steps and keeps ids unique', () => {
    const c = parseChapter(fallingSkies);
    const opt = c.steps.find((s) => s.text.startsWith('Find any'))!;
    expect(opt).toMatchObject({ optional: true, depth: 1, text: 'Find any additional clues' });
    expect(c.steps.find((s) => s.text.startsWith('Hand over 2,000'))!.optional).toBe(true);
    expect(new Set(c.steps.map((s) => s.id)).size).toBe(c.steps.length);
  });

  it("lists a map's current story steps, in index order", () => {
    const chapters = parseStory([index, fallingSkies, tour]);
    expect(chapters.map((c) => c.name)).toEqual(['Tour', 'Falling Skies']);
    // Tour's current step is on Ground Zero; its Customs step comes after it.
    expect(storyForMap(chapters, 'ground-zero-21', new Set())[0]!.steps[0]!.text).toBe('Escape Ground Zero');
    expect(storyForMap(chapters, 'customs', new Set())).toEqual([]);
    const tourChapter = chapters[0]!;
    const escaped = new Set([tourChapter.steps[0]!.id]);
    const customs = storyForMap(chapters, 'customs', escaped);
    expect(customs.map((g) => g.steps.map((s) => s.text))).toEqual([['Survive and extract from Customs or visit Customs 3 times']]);
    expect(storyForMap(chapters, 'customs', new Set([...escaped, customs[0]!.steps[0]!.id]))).toEqual([]);
  });
});

// Optional: TQO_STORY_JSON=<MediaWiki query result> checks the real pages.
const real = process.env.TQO_STORY_JSON;
describe.skipIf(!real || !existsSync(real))('story parsing on the real wiki', () => {
  it('parses every chapter with steps, most tied to a map', () => {
    const json = JSON.parse(readFileSync(real!, 'utf8'));
    const pages: WikiPage[] = json.query.pages.map((p: any) => ({ title: p.title, content: p.revisions[0].slots.main.content }));
    const chapters = parseStory(pages);
    const steps = chapters.flatMap((c) => c.steps);
    const withMap = steps.filter((s) => s.maps.length);
    expect(chapters.length).toBeGreaterThanOrEqual(10);
    expect(withMap.length).toBeGreaterThan(100);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });
});

describe('trader steps', () => {
  it('are not tied to a map by their guide section', () => {
    const c = parseChapter({
      title: 'X',
      content: `==Objectives==\n* Talk to [[Therapist]]\n* Hand over the [[Flash drive|drive]] to [[Prapor]]\n* Hand over the cash on [[Customs]]\n==Guide==\n===Talk to Therapist===\nShe is on [[Streets of Tarkov]].\n===Hand over the drive to Prapor===\nFound on [[Shoreline]].\n`,
    });
    expect(c.steps.map((s) => s.maps)).toEqual([[], [], ['customs']]);
  });
});

describe('StorySource', () => {
  const pages = { index, fallingSkies, tour };
  const fakeWiki = (fail = false) =>
    vi.fn(async (url: string) => {
      if (fail) throw new TypeError('offline');
      const titles = new URL(url).searchParams.get('titles')!.split('|');
      const found = Object.values(pages).filter((p) => titles.includes(p.title));
      return new Response(JSON.stringify({ query: { pages: found.map((p) => ({ title: p.title, revisions: [{ slots: { main: { content: p.content } } }] })) } }));
    });
  const memStorage = (snapshot: string | null = null) => {
    const files = new Map<string, string>();
    return { files, read: async (p: string) => files.get(p) ?? null, write: async (p: string, t: string) => void files.set(p, t), readSnapshot: async () => snapshot };
  };

  it('downloads the index then all chapters, and saves them', async () => {
    const storage = memStorage();
    const wiki = fakeWiki();
    const { chapters } = await new StorySource(storage, wiki).get();
    expect(chapters.map((c) => c.name)).toEqual(['Tour', 'Falling Skies']);
    expect(wiki).toHaveBeenCalledTimes(2);
    expect(storage.files.has('story.json')).toBe(true);
  });

  it('reuses a fresh saved copy without going online', async () => {
    const storage = memStorage();
    await new StorySource(storage, fakeWiki()).get();
    const wiki = fakeWiki();
    await new StorySource(storage, wiki).get();
    expect(wiki).not.toHaveBeenCalled();
  });

  it('falls back to the bundled snapshot when offline', async () => {
    const snap = JSON.stringify({ fetchedAt: '2026-11-01T00:00:00.000Z', pages: [index, tour] });
    const { chapters, fetchedAt } = await new StorySource(memStorage(snap), fakeWiki(true)).get();
    expect(chapters.map((c) => c.name)).toEqual(['Tour']);
    expect(fetchedAt).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('chapter starts', () => {
  const page = (title: string, requirements: string): WikiPage => ({
    title,
    content: `==Requirements==\n${requirements}\n==Objectives==\n* Talk to [[Mechanic]] about the EMP blast\n* Locate the fragment on [[Streets of Tarkov]]\n==Guide==\n`,
  });

  it('reads where a chapter can be started from, with each place\'s map', () => {
    const c = parseChapter(page('Blue Fire', `Pick up and read [[EMERCOM leaflet]] from one of the following locations:
* Inside a green shipping container at the Scav base/EMERCOM camp on [[Woods]]
<li style="display: inline-block;"><gallery>
File:Blue Fire Woods Container.png|The wanted container
</gallery></li>
* On a table in the Chekannaya 15 apartments on Streets of Tarkov`));
    expect(c.start).toEqual({
      intro: 'Pick up and read EMERCOM leaflet from one of the following locations:',
      options: [
        { text: 'Inside a green shipping container at the Scav base/EMERCOM camp on Woods', maps: ['woods'] },
        { text: 'On a table in the Chekannaya 15 apartments on Streets of Tarkov', maps: ['streets-of-tarkov'] },
      ],
      automatic: false,
    });
  });

  it('turns a single sentence naming a map into one start option', () => {
    const c = parseChapter(page('Accidental Witness', 'Locate the white scribbled-on car in the courtyard of the dormitories on [[Customs]].'));
    expect(c.start).toEqual({ intro: '', options: [{ text: 'Locate the white scribbled-on car in the courtyard of the dormitories on Customs.', maps: ['customs'] }], automatic: false });
  });

  it('knows chapters that start by themselves, or have no start on the wiki', () => {
    expect(parseChapter(page('Tour', 'This chapter gets automatically added to the quest list upon starting the game.')).start?.automatic).toBe(true);
    expect(parseChapter({ title: 'The Ticket', content: '==Objectives==\n* Talk to Mr. Kerman\n' }).start).toBeNull();
  });

  it('tracks not started → in progress → done, and only shows how to start until started', () => {
    const c = parseChapter(page('Blue Fire', '* Inside a green container on [[Woods]]'));
    const none = new Set<string>();
    expect(chapterState(c, none, none)).toBe('not-started');
    const woods = storyForMap([c], 'woods', none, none);
    expect(woods[0]).toMatchObject({ state: 'not-started', steps: [], starts: [{ text: 'Inside a green container on Woods' }] });
    expect(storyForMap([c], 'streets-of-tarkov', none, none)).toEqual([]); // its steps stay hidden until started
    const started = new Set(['Blue Fire']);
    expect(chapterState(c, none, started)).toBe('in-progress');
    // Started: its first step (talk to Mechanic) is in the menus; the Streets step comes next.
    expect(storyForMap([c], 'streets-of-tarkov', none, started)).toEqual([]);
    expect(storyForMap([c], 'streets-of-tarkov', new Set([c.steps[0]!.id]), started)[0]!.steps).toHaveLength(1);
    // Ticking a step also counts as started; ticking every required step finishes it.
    expect(chapterState(c, new Set([c.steps[0]!.id]), none)).toBe('in-progress');
    expect(chapterState(c, new Set(c.steps.map((s) => s.id)), none)).toBe('done');
  });
});

// The real chapters bundled with the app: every chapter that needs starting says how.
const SNAPSHOT_STORY = 'build/snapshot/story.json';
describe.skipIf(!existsSync(SNAPSHOT_STORY))('chapter starts in the real wiki copy', () => {
  const chapters = parseStory((JSON.parse(readFileSync(SNAPSHOT_STORY, 'utf8')) as { pages: WikiPage[] }).pages);
  const byName = (n: string) => chapters.find((c) => c.name === n)!;
  it('finds the places and maps', () => {
    expect(byName('Tour').start?.automatic).toBe(true);
    expect(byName('Accidental Witness').start?.options[0]?.maps).toEqual(['customs']);
    expect(byName('Blue Fire').start?.options.length).toBeGreaterThan(1);
    expect(byName('Blue Fire').start?.options.some((o) => o.maps.includes('woods'))).toBe(true);
    expect(byName('Batya').start?.options.some((o) => o.maps.includes('customs'))).toBe(true);
  });
});

describe('current story steps', () => {
  // Shaped like the wiki: steps, a sub-step, an optional step, then a fork into two paths.
  const c = parseChapter({
    title: 'Fork',
    content: `==Objectives==
* Locate the fallen plane on [[Woods]]
** (''Optional'') Obtain the patch
* Ask the traders about the plane
* (''Optional'') Pay Therapist for details
* Retrieve the flash drive on [[Shoreline]]
'''If you gave the case to Prapor'''
* Talk to [[Prapor]]
* Visit [[Customs]] with Prapor's man
'''If you kept the case'''
* Talk to [[Mechanic]]
* Visit [[Woods]] with Mechanic's man
`,
  });
  const ids = (texts: string[]) => texts.map((t) => c.steps.find((s) => s.text.startsWith(t))!.id);
  const texts = (done: string[]) => activeSteps(c, new Set(ids(done))).map((s) => s.text);

  it('starts at the first step with its sub-steps', () => {
    expect(texts([])).toEqual(['Locate the fallen plane on Woods', 'Obtain the patch']);
  });
  it('shows optional steps alongside the next required one', () => {
    expect(texts(['Locate the fallen plane', 'Ask the traders'])).toEqual(['Pay Therapist for details', 'Retrieve the flash drive on Shoreline']);
  });
  it("shows each path's next step at a fork, then only the path you took", () => {
    const beforeFork = ['Locate the fallen plane', 'Ask the traders', 'Retrieve the flash drive'];
    expect(texts(beforeFork)).toEqual(['Talk to Prapor', 'Talk to Mechanic']);
    expect(texts([...beforeFork, 'Talk to Mechanic'])).toEqual(['Visit Woods with Mechanic\'s man']);
  });
  it('ticks every earlier step on the same path, never the other path', () => {
    const upTo = stepsUpTo(c, ids(["Visit Woods with Mechanic's man"])[0]!);
    expect(upTo).toEqual(ids(['Locate the fallen plane', 'Obtain the patch', 'Ask the traders', 'Pay Therapist', 'Retrieve the flash drive', 'Talk to Mechanic', "Visit Woods with Mechanic's man"]));
    expect(upTo).not.toContain(ids(['Talk to Prapor'])[0]);
  });
  it('per map: only the current step, on the map it happens', () => {
    expect(storyForMap([c], 'woods', new Set(), new Set(['Fork']))[0]!.steps.map((s) => s.text)).toEqual(['Locate the fallen plane on Woods']);
    // Later steps on Shoreline don't show until you get there.
    expect(storyForMap([c], 'shoreline', new Set(), new Set(['Fork']))).toEqual([]);
  });
});
