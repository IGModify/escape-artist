import { convertJsonFiles, JSON_BASE_URL, JSON_FILES, type JsonFiles } from './jsonSource';
import { MAPS_CONFIG_URL, TARKOV_API_URL, TARKOV_QUERY } from './tarkovQuery';
import type { ApiMap, ApiTask, MapDisplayGroup, TarkovData } from './tarkovTypes';
import { TRIM_FORMAT, trimRaw } from './trimRaw';

const UA = 'escape-artist/0.2 (desktop app)';

/** File access the data source needs; the app passes Tauri-backed functions, tests pass Node ones. */
export interface DataStorage {
  /** Read/write inside the app's cache folder ("raw/tasks.json", "svg-….svg"). Missing file → null. */
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  /** Read from the snapshot bundled with the installer ("tasks.json", "svg/svg-….svg"). Missing → null. */
  readSnapshot(path: string): Promise<string | null>;
}
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * A set of raw downloads: one file per json.tarkov.dev file plus the map display config,
 * and meta.json with each file's ETag. Same layout for the cache ("raw/") and the snapshot
 * (scripts/snapshot.mjs writes it).
 */
interface RawMeta {
  etags: Record<string, string>;
  fetchedAt: string;
  /** TRIM_FORMAT the files were saved with (missing = before formats existed). */
  format?: number;
}
const RAW_NAMES = [...JSON_FILES, 'display'] as const;
type RawName = (typeof RAW_NAMES)[number];
type RawSet = Record<RawName, unknown>;

function assemble(raw: RawSet, meta: Pick<TarkovData, 'fetchedAt' | 'source' | 'stale'>): TarkovData {
  const { tasks, maps } = convertJsonFiles(raw as JsonFiles);
  const display = raw.display;
  if (!Array.isArray(display)) throw new Error('map display config has an unexpected format');
  return { tasks, maps, display: display as MapDisplayGroup[], checkedAt: new Date().toISOString(), ...meta };
}

/** Cache file name for a map image URL; scripts/snapshot.mjs uses the same scheme. */
export async function svgFileName(url: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(url));
  return `svg-${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}.svg`;
}

/**
 * Loads tarkov.dev data in this order:
 *   1. json.tarkov.dev (only files whose ETag changed are downloaded)
 *   2. api.tarkov.dev GraphQL
 *   3. the last good copy saved on disk
 *   4. the snapshot shipped with the installer
 */
export class TarkovDataSource {
  private memo: TarkovData | null = null;
  private inflight: Promise<{ data: TarkovData; changed: boolean }> | null = null;

  constructor(
    private readonly storage: DataStorage,
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
  ) {}

  /** Current data; only goes online if nothing is loaded yet or `force` is set. */
  async get(force = false): Promise<TarkovData> {
    if (this.memo && !force) return this.memo;
    return (await this.check()).data;
  }

  /** Looks online for newer data. `changed` is true when the result differs from what was shown. */
  check(): Promise<{ data: TarkovData; changed: boolean }> {
    this.inflight ??= this.load().finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async readRaw(read: (p: string) => Promise<string | null>, prefix: string): Promise<{ files: RawSet; meta: RawMeta } | null> {
    try {
      const metaText = await read(`${prefix}meta.json`);
      if (!metaText) return null;
      const entries = await Promise.all(
        RAW_NAMES.map(async (n) => {
          const text = await read(`${prefix}${n}.json`);
          if (text === null) throw new Error(`missing ${n}`);
          return [n, trimRaw(n, JSON.parse(text))] as const;
        }),
      );
      return { files: Object.fromEntries(entries) as RawSet, meta: JSON.parse(metaText) as RawMeta };
    } catch {
      return null;
    }
  }

  private readCache = (p: string) => this.storage.read(p);
  private readSnap = (p: string) => this.storage.readSnapshot(p);

  private async load(): Promise<{ data: TarkovData; changed: boolean }> {
    const before = this.memo;
    const errors: string[] = [];
    let data: TarkovData | null = null;

    try {
      data = await this.fromJson();
    } catch (e) {
      errors.push(`json.tarkov.dev: ${(e as Error).message}`);
    }
    if (!data) {
      try {
        data = await this.fromGraphql();
      } catch (e) {
        errors.push(`api.tarkov.dev: ${(e as Error).message}`);
      }
    }
    const reason = errors.join(' · ') || null;
    data ??= await this.fromSaved('cache', reason);
    data ??= await this.fromGraphqlCache(reason);
    data ??= await this.fromSaved('snapshot', reason);
    if (!data) throw new Error(`Could not load quest data. ${reason ?? ''}`.trim());

    const changed = !before || before.fetchedAt !== data.fetchedAt || before.source !== data.source;
    this.memo = data;
    return { data, changed };
  }

  /** Conditional download of every raw file; only commits to disk once everything converts. */
  private async fromJson(): Promise<TarkovData> {
    const saved = await this.readRaw(this.readCache, 'raw/');
    // A copy trimmed under older rules lacks fields the app now uses: download everything again.
    const current = saved?.meta.format === TRIM_FORMAT ? saved : null;
    const etags = current?.meta.etags ?? {};
    const urlOf = (n: RawName) => (n === 'display' ? MAPS_CONFIG_URL : `${JSON_BASE_URL}${n}`);

    const results = await Promise.all(
      RAW_NAMES.map(async (name) => {
        const res = await this.fetcher(urlOf(name), {
          headers: { 'User-Agent': UA, ...(current && etags[name] ? { 'If-None-Match': etags[name] } : {}) },
          signal: AbortSignal.timeout(45_000),
        });
        if (res.status === 304) return { name, body: null, etag: etags[name]! };
        if (!res.ok) throw new Error(`${name} responded ${res.status}`);
        return { name, body: trimRaw(name, JSON.parse(await res.text())), etag: res.headers.get('etag') ?? '' };
      }),
    );

    const changedFiles = results.filter((r) => r.body !== null);
    if (current && changedFiles.length === 0) {
      // Nothing new upstream: keep the saved copy, it's current.
      const prev = this.memo?.source === 'json' ? this.memo : null;
      return prev
        ? { ...prev, checkedAt: new Date().toISOString() }
        : assemble(current.files, { fetchedAt: current.meta.fetchedAt, source: 'json', stale: null });
    }

    // Without a saved copy no ETags were sent, so every file is in `changedFiles`.
    const files = { ...(saved?.files ?? {}) } as RawSet;
    for (const r of changedFiles) files[r.name] = r.body;
    const fetchedAt = new Date().toISOString();
    const data = assemble(files, { fetchedAt, source: 'json', stale: null }); // throws on format change → nothing written

    await Promise.all(changedFiles.map((r) => this.storage.write(`raw/${r.name}.json`, JSON.stringify(r.body))));
    const meta: RawMeta = { etags: Object.fromEntries(results.map((r) => [r.name, r.etag])), fetchedAt, format: TRIM_FORMAT };
    await this.storage.write('raw/meta.json', JSON.stringify(meta));
    return data;
  }

  private async fromGraphql(): Promise<TarkovData> {
    const res = await this.fetcher(TARKOV_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query: TARKOV_QUERY }),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    let body: { data?: { tasks: ApiTask[]; maps: ApiMap[] }; errors?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`responded ${res.status} without JSON`);
    }
    if (!body.data?.tasks?.length || !body.data.maps?.length) {
      throw new Error(`responded ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 120)}`);
    }
    const now = new Date().toISOString();
    const data: TarkovData = {
      tasks: body.data.tasks,
      maps: body.data.maps,
      display: await this.displayConfig(),
      fetchedAt: now,
      checkedAt: now,
      source: 'graphql',
      stale: null,
    };
    await this.storage.write('graphql-data.json', JSON.stringify(data));
    return data;
  }

  /** Map display config: saved copy, else snapshot, else download. */
  private async displayConfig(): Promise<MapDisplayGroup[]> {
    const local = (await this.storage.read('raw/display.json')) ?? (await this.storage.readSnapshot('display.json'));
    if (local) return JSON.parse(local) as MapDisplayGroup[];
    const res = await this.fetcher(MAPS_CONFIG_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`map config responded ${res.status}`);
    return JSON.parse(await res.text()) as MapDisplayGroup[];
  }

  private async fromSaved(where: 'cache' | 'snapshot', stale: string | null): Promise<TarkovData | null> {
    const raw = where === 'cache' ? await this.readRaw(this.readCache, 'raw/') : await this.readRaw(this.readSnap, '');
    if (!raw) return null;
    try {
      return assemble(raw.files, { fetchedAt: raw.meta.fetchedAt, source: where, stale });
    } catch {
      return null;
    }
  }

  private async fromGraphqlCache(stale: string | null): Promise<TarkovData | null> {
    try {
      const text = await this.storage.read('graphql-data.json');
      if (!text) return null;
      return { ...(JSON.parse(text) as TarkovData), source: 'cache', stale, checkedAt: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  /** Map SVGs: on-disk cache, then download (and cache), then the installer snapshot. */
  async svg(url: string): Promise<string> {
    if (!/^https:\/\/(assets\.tarkov\.dev|raw\.githubusercontent\.com)\//.test(url)) throw new Error('Unexpected map URL');
    const name = await svgFileName(url);
    const cached = await this.storage.read(name);
    if (cached) return cached;
    try {
      const res = await this.fetcher(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`Map image download failed (${res.status})`);
      const text = await res.text();
      await this.storage.write(name, text);
      return text;
    } catch (e) {
      const bundled = await this.storage.readSnapshot(`svg/${name}`);
      if (bundled) return bundled;
      throw e;
    }
  }
}
