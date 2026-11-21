// Publishes a new version: node scripts/release.mjs 0.3.0
// Sets the version in package.json, tauri.conf.json and Cargo.toml, commits, tags and pushes.
// GitHub then builds, signs and publishes the release (.github/workflows/release.yml), and
// installed apps offer the update the next time they start.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: node scripts/release.mjs <version>   e.g. node scripts/release.mjs 0.3.0');
  process.exit(1);
}
const root = join(import.meta.dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'inherit' });

if (execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString().trim()) {
  console.error('Commit or discard your changes first, so the release contains exactly what you mean.');
  process.exit(1);
}

const json = (file, edit) => {
  const p = join(root, file);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  edit(data);
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
};
json('package.json', (j) => (j.version = version));
json('package-lock.json', (j) => {
  j.version = version;
  if (j.packages?.['']) j.packages[''].version = version;
});
json('src-tauri/tauri.conf.json', (j) => (j.version = version));
const cargo = join(root, 'src-tauri', 'Cargo.toml');
writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = "[^"]+"/m, `version = "${version}"`));

git('add', 'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml');
git('commit', '-m', `Release v${version}`);
git('tag', `v${version}`);
git('push');
git('push', 'origin', `v${version}`);
console.log(`\nv${version} pushed. GitHub is building it: see the Actions tab; the release appears when it finishes.`);
