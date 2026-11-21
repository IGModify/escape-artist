import { describe, expect, it } from 'vitest';
import { downloadQuestImages, imagesForObjective, isMapImage, parseGuideImages, QuestImageSource, wikiTitle } from './questImages';

// Shaped like the real "Chumming" page: an item table, then one paragraph + gallery per map.
const CHUMMING = `{{Infobox quest}}
==Objectives==
* Stash Golden neck chains in the microwave on the 3rd floor of the dorm on [[Customs]]
==Guide==
{|class="wikitable"
|-
|[[File:Golden neck chain Icon.png|frameless|64px|link=Golden neck chain]]
|[[Golden neck chain]]
|}
The "microwave on the 3rd floor of dorms" is located in the "kitchen" of the 3 story dorms on [[Customs]].
<li style="display: inline-block;"><gallery widths="300" heights="169" mode="packed">
File:Dorm 3.png|"Kitchen" location marked on map
File:Chumm micro.png|The wanted microwave
</gallery></li>

The "middle wooden cabin at the sawmill" means the wooden cabin #2 in the lumber yard on [[Woods]].
<gallery>
File:Cabin2Woods.png|Cabin #2 at the lumber yard
File:Chumm woods.png|The bed with the book near the safe
</gallery>
[[File:Extra shot.jpg|thumb|300px|Another angle of the sawmill]]

==Trivia==
[[File:Not in guide.png|thumb|Should be ignored]]
`;

describe('parseGuideImages', () => {
  const images = parseGuideImages(CHUMMING);

  it('finds the photos in the Guide section only, skipping item icons', () => {
    // "Dorm 3.png" is a map screenshot ("…marked on map") and is left out.
    expect(images.map((i) => i.file)).toEqual(['Chumm micro.png', 'Cabin2Woods.png', 'Chumm woods.png', 'Extra shot.jpg']);
  });

  it('keeps captions and ties each photo to the map its paragraph names', () => {
    expect(images[0]).toMatchObject({ caption: 'The wanted microwave', maps: ['customs'] });
    expect(images[2]!.maps).toEqual(['woods']);
    expect(images[3]).toMatchObject({ caption: 'Another angle of the sawmill', maps: [] });
  });

  it('returns nothing for pages without a guide', () => {
    expect(parseGuideImages('==Objectives==\n* Kill 5 Scavs')).toEqual([]);
  });
});

describe('imagesForObjective', () => {
  const images = parseGuideImages(CHUMMING);
  it("shows only this map's photos, best match to the objective first", () => {
    const customs = imagesForObjective(images, 'customs', 'Stash Golden neck chains in the microwave on the 3rd floor of the dorm on Customs');
    expect(customs.map((i) => i.file)).toEqual(['Chumm micro.png']);
    expect(imagesForObjective(images, 'woods', 'Stash chains in the cabin').map((i) => i.file)).toContain('Chumm woods.png');
    expect(imagesForObjective(images, 'woods', '').map((i) => i.file)).not.toContain('Dorm 3.png');
  });
});

describe('isMapImage', () => {
  it('spots map screenshots by caption or file name, and keeps in-game photos', () => {
    expect(isMapImage('BigCustomerMap.jpg', 'Warehouse marked on map')).toBe(true);
    expect(isMapImage('HCPP5.png', 'Location marked on map')).toBe(true);
    expect(isMapImage('Saving the Mole Map.png', 'TerraGroup buildings')).toBe(true);
    expect(isMapImage('The van inside the depot-building.png', 'The vehicle where the beacon is placed.')).toBe(false);
    expect(isMapImage('Shooting Cans AGS.png', 'The AGS grenade launcher in the back office')).toBe(false);
  });
});

describe('wikiTitle', () => {
  it('turns a wiki link into a page title', () => {
    expect(wikiTitle('https://escapefromtarkov.fandom.com/wiki/Chemical_-_Part_4')).toBe('Chemical - Part 4');
    expect(wikiTitle('https://escapefromtarkov.fandom.com/wiki/Is_this_a_reference%3F')).toBe('Is this a reference?');
    expect(wikiTitle(null)).toBeNull();
  });
});

// A fake wiki: the page request returns CHUMMING, the image request returns preview links.
function fakeWiki(calls: string[], fail = false) {
  return async (url: string) => {
    calls.push(url);
    if (fail) return new Response('down', { status: 503 });
    const q = new URL(url).searchParams;
    if (q.get('action') === 'parse') return new Response(JSON.stringify({ parse: { wikitext: CHUMMING } }));
    const pages = q.get('titles')!.split('|').map((t) => ({ title: t, imageinfo: [{ thumburl: `https://static.wikia.nocookie.net/x/${encodeURIComponent(t)}/320` }] }));
    return new Response(JSON.stringify({ query: { pages } }));
  };
}

function memoryStorage() {
  const files = new Map<string, string>();
  return {
    files,
    read: async (p: string) => files.get(p) ?? null,
    write: async (p: string, t: string) => void files.set(p, t),
    readSnapshot: async () => null,
  };
}

describe('QuestImageSource', () => {
  it('downloads once per quest, then serves the saved copy', async () => {
    const calls: string[] = [];
    const storage = memoryStorage();
    const src = new QuestImageSource(storage, fakeWiki(calls));
    const first = await src.get('t1', 'https://escapefromtarkov.fandom.com/wiki/Chumming');
    expect(first).toHaveLength(4);
    expect(first[0]!.url).toContain('static.wikia.nocookie.net');
    expect(calls).toHaveLength(2); // page text + preview links
    await src.get('t1', 'https://escapefromtarkov.fandom.com/wiki/Chumming');
    expect(calls).toHaveLength(2);
    // A fresh start reads the disk copy instead of the wiki.
    await new QuestImageSource(storage, fakeWiki(calls)).get('t1', 'https://escapefromtarkov.fandom.com/wiki/Chumming');
    expect(calls).toHaveLength(2);
  });

  it('shows no photos (and does not throw) when the wiki is down', async () => {
    const src = new QuestImageSource(memoryStorage(), fakeWiki([], true));
    await expect(src.get('t2', 'https://escapefromtarkov.fandom.com/wiki/Chumming')).resolves.toEqual([]);
  });

  it('asks the wiki for small previews only', async () => {
    const calls: string[] = [];
    await downloadQuestImages(fakeWiki(calls), 'Chumming');
    expect(new URL(calls[1]!).searchParams.get('iiurlwidth')).toBe('320');
  });
});

describe('guides split by sub-headings', () => {
  // Like "Every Hunter Knows This": an intro naming both maps, then one part per map.
  const page = `==Guide==
In this quest you have to locate tripwire spots on Factory and Customs.
===Factory tripwire spot===
The spot is in a room on the 3rd floor of the offices.
<gallery>
File:Factory spot.png|The office room
</gallery>
===Customs tripwire spot===
The spot is at the stairs of the three-story dorm.
<gallery>
File:Customs spot.png|The stairs
</gallery>
`;
  it('ties each part to the map in its own heading, not the intro', () => {
    const images = parseGuideImages(page);
    expect(images.map((i) => [i.file, i.maps])).toEqual([
      ['Factory spot.png', ['factory']],
      ['Customs spot.png', ['customs']],
    ]);
  });
});
