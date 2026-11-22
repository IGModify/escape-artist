// What to bring to a map beyond quest items: Terminal's access item for each ending, and optional
// helpers. From the EFT wiki (The Ticket → Terminal Guide); item ids/icons from tarkov.dev.

export interface BringItem {
  name: string;
  icon: string;
}

export interface BringRow {
  /** e.g. the ending this is for ("Savior"); null for plain items. */
  label: string | null;
  items: BringItem[];
  note: string;
}

export interface BringSection {
  title: string;
  /** One line under the title. */
  intro: string | null;
  rows: BringRow[];
}

const item = (id: string, name: string): BringItem => ({ name, icon: `https://assets.tarkov.dev/${id}-icon.webp` });

const TERMINAL: BringSection[] = [
  {
    title: 'Access item (by ending)',
    intro: 'Bring the one for the ending you want. Terminal is entered by transit from Shoreline, 21:00–06:00, at the port garrison intercom.',
    rows: [
      {
        label: 'Savior',
        items: [
          item('67c033fd0610e91bea056998', "Reprogrammed RFID keycard with Mr. Kerman's hash codes"),
          item('67c033719dacd7c19f0f9f46', 'Secure container Alpha-1 with TerraGroup evidence'),
        ],
        note: 'Keep the Alpha-1 container in your task inventory: without it you cannot transit, and the boat needs it too.',
      },
      {
        label: 'Debtor',
        items: [item('67c04dac9320f644db06f45c', 'RFID keycard with unknown name')],
        note: 'Lightkeeper sells it once per raid for 1 TerraGroup "Blue Folders" materials (needs a free special slot).',
      },
      {
        label: 'Survivor',
        items: [item('68f213f8ea61d1803707cf7a', "Prapor's letter for the port checkpoint")],
        note: 'Prapor sells it (5,000,000 ₽, twice per restock). Use the intercom call button instead of the card reader.',
      },
      {
        label: 'Fallen',
        items: [item('67c04a6f9152fbdfa306cc66', "Reprogrammed RFID keycard with Prapor's hash codes")],
        note: 'Swipe it at the intercom card reader.',
      },
    ],
  },
  {
    title: 'Optional',
    intro: 'Not required, but they save time in the raid.',
    rows: [
      {
        label: null,
        items: [item('590c2e1186f77425357b6124', 'Toolset')],
        note: 'Repairs the electrical panels every time (by hand they often fail). Not used up.',
      },
      {
        label: null,
        items: [item('69a0174087a75d2cbd0842e8', 'SZ-1 explosive charge')],
        note: 'Blows the metal gate open (otherwise it takes 2 players or Elite Strength to push).',
      },
    ],
  },
];

const BY_MAP: Record<string, BringSection[]> = { terminal: TERMINAL };

/** Extra Bring sections for a map (normalizedName); empty for most maps. */
export function mapBring(normalizedName: string): BringSection[] {
  return BY_MAP[normalizedName] ?? [];
}
