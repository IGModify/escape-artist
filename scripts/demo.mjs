// Runs the built app (src-tauri/target/release/escape-artist.exe) against a fake EFT install
// using REAL tarkov.dev data: a few real Customs quests with marker/camera/jammer objectives are
// "started" in fake logs, then the player "spawns" at a real Customs PMC spawn via a fake
// screenshot. Uses a throwaway profile, so your own settings are untouched.
//   node scripts/demo.mjs [overlay|windowed] [seconds-to-run] [hide-first]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv[2] ?? 'windowed';
const seconds = Number(process.argv[3] ?? 0);
const repo = join(import.meta.dirname, '..');
// TQO_EXE runs another copy instead, e.g. the installed app.
const exe = process.env.TQO_EXE ?? join(repo, 'src-tauri', 'target', 'release', 'escape-artist.exe');
const snap = join(repo, 'build', 'snapshot');
const tasks = Object.values(JSON.parse(readFileSync(join(snap, 'tasks.json'), 'utf8')).data.tasks);
const en = JSON.parse(readFileSync(join(snap, 'tasks_en.json'), 'utf8')).data ?? {};
const maps = Object.values(JSON.parse(readFileSync(join(snap, 'maps.json'), 'utf8')).data.maps);
const customs = maps.find((m) => m.normalizedName === 'customs');

const onCustoms = (o) => (o.zones ?? []).some((z) => z.map === customs.id);
const picked = [
  ...tasks.filter((t) => t.objectives.some((o) => ['mark', 'plantItem'].includes(o.type) && onCustoms(o))).slice(0, 3),
  ...tasks.filter((t) => t.objectives.some((o) => o.type === 'visit' && onCustoms(o))).slice(0, 2),
  // A Kappa-required quest, to show the purple K.
  ...tasks.filter((t) => t.kappaRequired && t.objectives.some(onCustoms)).slice(0, 1),
  // A kill quest with a zone on Customs, to show the kill-zone outline.
  ...tasks.filter((t) => t.objectives.some((o) => o.type === 'shoot' && (o.zones ?? []).some((z) => z.map === customs.id && z.outline?.length))).slice(0, 1),
  // A quest stashing several items at one spot (Lighthouse), to show several item chips on one marker.
  ...tasks.filter((t) => (en[t.name] ?? t.name) === 'Bullshit'),
  // A transit quest starting on Customs, to show the separate Transit quests section.
  ...tasks.filter((t) => t.objectives.some((o) => o.type === 'extract' && /transit from Customs/i.test(en[o.description] ?? o.description ?? ''))).slice(0, 1),
];
const spawnPoint = customs.spawns.find((s) => s.sides?.includes('pmc') && s.categories?.includes('player'))?.position;

const root = join(tmpdir(), 'tqo-demo');
rmSync(root, { recursive: true, force: true });
const dataDir = join(root, 'profile');
const logs = join(root, 'Logs');
const shots = join(root, 'Screenshots');
mkdirSync(dataDir, { recursive: true });
mkdirSync(shots, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000`;
const ago = (min) => stamp(new Date(now.getTime() - min * 60000));
const folder = join(logs, `log_${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}_${now.getHours()}-${pad(now.getMinutes())}-00_1.0.0.0`);
mkdirSync(folder, { recursive: true });

const started = (min, id) => `${ago(min)}|1.0|Info|push-notifications|Got notification | ChatMessageReceived\n{\n  "message": { "type": 10, "templateId": "${id} description" }\n}\n`;
writeFileSync(join(folder, 'notifications_000.log'), picked.map((t, i) => started(30 - i, t.id)).join(''));
writeFileSync(join(folder, 'application_000.log'),
  `${ago(3)}|1.0|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Profileid: x, Status: Busy, RaidMode: Online, Location: bigmap, shortId: DEMO01'\n` +
  `${ago(2)}|1.0|Info|application|GameStarted:1 real:1\n`);
const bounds = mode === 'overlay' ? { overlayBounds: { x: 100, y: 80, width: 420, height: 640 } } : { windowedBounds: { x: 100, y: 80, width: 1100, height: 720 } };
// Optional 3rd arg "hide-first": start with the first demo quest not tracked.
const hiddenQuests = process.argv[4] === 'hide-first' ? [picked[0].id] : [];
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ mode, logsPath: logs, screenshotsPath: shots, faction: 'pmc', hiddenQuests, showStory: true, ...bounds }));
console.log(`demo: started ${picked.length} real quests; spawning at ${JSON.stringify(spawnPoint)}`);

const child = spawn(exe, [], { stdio: 'inherit', env: { ...process.env, TQO_DATA_DIR: dataDir } });
setTimeout(() => {
  const f = (n) => n.toFixed(2);
  writeFileSync(join(shots, `${stamp(now).slice(0, 10)}[${pad(now.getHours())}-${pad(now.getMinutes())}]_${f(spawnPoint.x)}, ${f(spawnPoint.y)}, ${f(spawnPoint.z)}_0.00000, 0.70711, 0.00000, 0.70711_10.00 (0).png`), '');
}, 5000);
if (seconds > 0) setTimeout(() => child.kill(), seconds * 1000);
child.on('exit', (code) => process.exit(code ?? 0));
