import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sample } from './testFixtures';
import { TarkovDataSource as Source, type DataStorage } from './dataSource';

/** Node-backed storage, the same shape the app gets from Tauri. */
function nodeStorage(cacheDir: string, snapshotDir: string | null): DataStorage {
  const rd = async (f: string) => (existsSync(f) ? readFile(f, 'utf8') : null);
  return {
    read: (p) => rd(join(cacheDir, p)),
    write: async (p, t) => {
      await mkdir(dirname(join(cacheDir, p)), { recursive: true });
      await writeFile(join(cacheDir, p), t);
    },
    readSnapshot: async (p) => (snapshotDir ? rd(join(snapshotDir, p)) : null),
  };
}
const TarkovDataSource = class { constructor(cache: string, snap: string | null) { return new Source(nodeStorage(cache, snap)); } } as unknown as new (cache: string, snap: string | null) => Source;

const display = [{ normalizedName: 'customs', maps: [{ key: 'customs', projection: 'interactive', svgPath: 'x', bounds: [[0, 0], [1, 1]] }] }];

type Mode = 'ok' | 'down' | 'broken';
interface FakeNet {
  json: Mode;
  graphql: Mode;
  etagVersion: number;
  requests: { url: string; ifNoneMatch?: string }[];
}

function fakeFetch(net: FakeNet) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    net.requests.push({ url, ifNoneMatch: headers['If-None-Match'] });
    if (url.includes('api.tarkov.dev')) {
      if (net.graphql !== 'ok') return new Response('{"errors":["GraphQL server unavailable. Try again later."]}', { status: 422 });
      const { tasks, maps } = (await import('./jsonSource')).convertJsonFiles(sample());
      return new Response(JSON.stringify({ data: { tasks, maps } }));
    }
    if (net.json === 'down') throw new TypeError('fetch failed');
    const name = url.endsWith('maps.json') ? 'display' : url.split('/').pop()!;
    const etag = `W/"${name}-v${net.etagVersion}"`;
    if (headers['If-None-Match'] === etag) return new Response(null, { status: 304 });
    const files = sample() as Record<string, unknown>;
    let body: unknown = name === 'display' ? display : files[name];
    if (net.json === 'broken' && name === 'tasks') body = { totally: 'different' };
    return new Response(JSON.stringify(body), { headers: { etag } });
  });
}

describe('TarkovDataSource', () => {
  let dir: string;
  let net: FakeNet;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tqo-data-'));
    net = { json: 'ok', graphql: 'ok', etagVersion: 1, requests: [] };
    vi.stubGlobal('fetch', fakeFetch(net));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses json.tarkov.dev first and saves it', async () => {
    const src = new TarkovDataSource(join(dir, 'cache'), null);
    const { data, changed } = await src.check();
    expect(data.source).toBe('json');
    expect(data.tasks.find((t) => t.id === 't0')!.name).toBe('Signal');
    expect(changed).toBe(true);
    expect(net.requests.some((r) => r.url.includes('api.tarkov.dev'))).toBe(false);
  });

  it('later checks send ETags and download nothing when unchanged', async () => {
    const src = new TarkovDataSource(join(dir, 'cache'), null);
    const first = await src.check();
    net.requests.length = 0;
    const second = await src.check();
    expect(net.requests.every((r) => r.ifNoneMatch)).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.data.fetchedAt).toBe(first.data.fetchedAt);

    net.etagVersion = 2; // upstream updated
    const third = await src.check();
    expect(third.changed).toBe(true);
  });

  it('downloads everything again when the saved copy was trimmed under older rules', async () => {
    await new TarkovDataSource(join(dir, 'cache'), null).check();
    // An older app version saved this copy: its meta.json has no format number.
    const metaPath = join(dir, 'cache', 'raw', 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    delete meta.format;
    writeFileSync(metaPath, JSON.stringify(meta));
    net.requests.length = 0;
    await new TarkovDataSource(join(dir, 'cache'), null).check();
    expect(net.requests.length).toBeGreaterThan(0);
    expect(net.requests.every((r) => !r.ifNoneMatch)).toBe(true);
    // …and the fresh copy is marked current, so the next start sends ETags again.
    expect(JSON.parse(readFileSync(metaPath, 'utf8')).format).toBeGreaterThan(1);
  });

  it('falls back to the GraphQL API when the JSON format changes, without overwriting the saved copy', async () => {
    const src = new TarkovDataSource(join(dir, 'cache'), null);
    await src.check();
    const savedTasks = readFileSync(join(dir, 'cache', 'raw', 'tasks.json'), 'utf8');
    net.json = 'broken';
    net.etagVersion = 2;
    const { data } = await src.check();
    expect(data.source).toBe('graphql');
    expect(readFileSync(join(dir, 'cache', 'raw', 'tasks.json'), 'utf8')).toBe(savedTasks);
  });

  it('uses the saved copy when both online sources are down', async () => {
    await new TarkovDataSource(join(dir, 'cache'), null).check();
    net.json = 'down';
    net.graphql = 'down';
    const { data } = await new TarkovDataSource(join(dir, 'cache'), null).check();
    expect(data.source).toBe('cache');
    expect(data.stale).toMatch(/json\.tarkov\.dev.*api\.tarkov\.dev/);
    expect(data.tasks.length).toBeGreaterThan(50);
  });

  it('uses the bundled snapshot on a fresh install while everything is down', async () => {
    const snap = join(dir, 'snapshot');
    mkdirSync(snap);
    const files = sample() as Record<string, unknown>;
    for (const [n, body] of Object.entries({ ...files, display })) writeFileSync(join(snap, `${n}.json`), JSON.stringify(body));
    writeFileSync(join(snap, 'meta.json'), JSON.stringify({ etags: {}, fetchedAt: '2026-11-01T00:00:00.000Z' }));
    net.json = 'down';
    net.graphql = 'down';
    const { data } = await new TarkovDataSource(join(dir, 'cache'), snap).check();
    expect(data.source).toBe('snapshot');
    expect(data.fetchedAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('errors clearly when there is nothing at all', async () => {
    net.json = 'down';
    net.graphql = 'down';
    await expect(new TarkovDataSource(join(dir, 'cache'), null).check()).rejects.toThrow(/Could not load quest data/);
  });
});
