import { load as loadStore } from '@tauri-apps/plugin-store';
import { IS_TAURI } from './state.js';

// ── Persistent Store ─────────────────────────────────────────────────────────
let store = null;

export async function getStore() {
  if (store) return store;
  if (!IS_TAURI) return null;
  store = await loadStore('axiom-settings.json');
  return store;
}

// ── Recent Projects ──────────────────────────────────────────────────────────
export async function getRecentProjects() {
  const s = await getStore();
  if (!s) return [];
  return (await s.get('recentProjects')) || [];
}

export async function addRecentProject(folderPath, folderName) {
  const s = await getStore();
  if (!s) return;
  let recents = (await s.get('recentProjects')) || [];
  recents = recents.filter(r => r.path !== folderPath);
  recents.unshift({ path: folderPath, name: folderName, lastOpened: Date.now() });
  if (recents.length > 3) recents = recents.slice(0, 3);
  await s.set('recentProjects', recents);
  await s.save();
}

export async function removeRecentProject(folderPath) {
  const s = await getStore();
  if (!s) return;
  let recents = (await s.get('recentProjects')) || [];
  recents = recents.filter(r => r.path !== folderPath);
  await s.set('recentProjects', recents);
  await s.save();
}
