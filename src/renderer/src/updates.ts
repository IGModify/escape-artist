// App updates from GitHub Releases (Tauri updater). The app checks once, a few seconds after it
// starts; Settings has a button to check again. Updates are signed: the app only installs a
// download signed with the project's key (public half in tauri.conf.json → plugins.updater).
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'available'; update: Update }
  | { kind: 'downloading'; percent: number | null }
  | { kind: 'error'; message: string };

export const appVersion = (): Promise<string> => getVersion();

/** Looks for a newer version. Never throws: problems come back as an 'error' state. */
export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const update = await check({ timeout: 20_000 });
    return update ? { kind: 'available', update } : { kind: 'none' };
  } catch (e) {
    return { kind: 'error', message: (e as Error)?.message ?? String(e) };
  }
}

/** Downloads, installs and restarts. `onProgress` gets 0–100 (or null when the size is unknown). */
export async function installUpdate(update: Update, onProgress: (percent: number | null) => void): Promise<void> {
  let total = 0;
  let done = 0;
  await update.downloadAndInstall((ev) => {
    if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
    else if (ev.event === 'Progress') {
      done += ev.data.chunkLength;
      onProgress(total ? Math.min(100, Math.round((done / total) * 100)) : null);
    }
  });
  await relaunch();
}
