import { Compartment } from '@codemirror/state';
import { view } from './editor.js';
import { getStore } from './store.js';
import { oneDark } from '@codemirror/theme-one-dark';
import { state } from './state.js';

// ── Theme Registry (mirrors themes.yaml) ─────────────────────────────────────
// We keep the UI palette inline here so YAML only serves as documentation.
// Each entry also has a `load` function that lazily imports the CM6 extension.
export const THEMES = [
  {
    id: 'one-dark',
    label: 'One Dark Pro',
    kind: 'dark',
    load: async () => oneDark,
    ui: {
      '--bg-main': '#282c34', '--bg-sidebar': '#21252b', '--bg-tabs': '#181a1f',
      '--bg-hover': '#2c313a', '--bg-active': '#3a3f4b', '--border-color': '#181a1f',
      '--text-main': '#abb2bf', '--text-muted': '#7f848e', '--text-active': '#d7dae0',
      '--accent-color': '#528bff', '--context-bg': '#252526', '--context-border': '#454545',
      '--context-hover': '#094771', '--context-text': '#cccccc',
    },
  },
  {
    id: 'vscode-dark',
    label: 'VS Code Dark+',
    kind: 'dark',
    load: () => import('@uiw/codemirror-theme-vscode').then(m => m.vscodeDark),
    ui: {
      '--bg-main': '#1e1e1e', '--bg-sidebar': '#252526', '--bg-tabs': '#181818',
      '--bg-hover': '#2a2d2e', '--bg-active': '#37373d', '--border-color': '#1e1e1e',
      '--text-main': '#d4d4d4', '--text-muted': '#858585', '--text-active': '#ffffff',
      '--accent-color': '#007acc', '--context-bg': '#252526', '--context-border': '#454545',
      '--context-hover': '#094771', '--context-text': '#cccccc',
    },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    kind: 'dark',
    load: () => import('@uiw/codemirror-theme-tokyo-night').then(m => m.tokyoNight),
    ui: {
      '--bg-main': '#1a1b26', '--bg-sidebar': '#16161e', '--bg-tabs': '#0f0f14',
      '--bg-hover': '#1f2335', '--bg-active': '#292e42', '--border-color': '#0f0f14',
      '--text-main': '#a9b1d6', '--text-muted': '#565f89', '--text-active': '#c0caf5',
      '--accent-color': '#7aa2f7', '--context-bg': '#1f2335', '--context-border': '#292e42',
      '--context-hover': '#2d3f76', '--context-text': '#a9b1d6',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    kind: 'dark',
    load: () => import('@uiw/codemirror-theme-dracula').then(m => m.dracula),
    ui: {
      '--bg-main': '#282a36', '--bg-sidebar': '#21222c', '--bg-tabs': '#191a21',
      '--bg-hover': '#2d2f3f', '--bg-active': '#44475a', '--border-color': '#191a21',
      '--text-main': '#f8f8f2', '--text-muted': '#6272a4', '--text-active': '#ffffff',
      '--accent-color': '#bd93f9', '--context-bg': '#21222c', '--context-border': '#44475a',
      '--context-hover': '#44475a', '--context-text': '#f8f8f2',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    kind: 'dark',
    load: () => import('@uiw/codemirror-theme-nord').then(m => m.nord),
    ui: {
      '--bg-main': '#2e3440', '--bg-sidebar': '#272c36', '--bg-tabs': '#1e2128',
      '--bg-hover': '#353b45', '--bg-active': '#3b4252', '--border-color': '#1e2128',
      '--text-main': '#d8dee9', '--text-muted': '#616e88', '--text-active': '#eceff4',
      '--accent-color': '#88c0d0', '--context-bg': '#272c36', '--context-border': '#3b4252',
      '--context-hover': '#4c566a', '--context-text': '#d8dee9',
    },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    kind: 'dark',
    load: () => import('@uiw/codemirror-theme-monokai').then(m => m.monokai),
    ui: {
      '--bg-main': '#272822', '--bg-sidebar': '#1e1f1c', '--bg-tabs': '#141411',
      '--bg-hover': '#2c2d27', '--bg-active': '#3e3d32', '--border-color': '#141411',
      '--text-main': '#f8f8f2', '--text-muted': '#75715e', '--text-active': '#ffffff',
      '--accent-color': '#a6e22e', '--context-bg': '#1e1f1c', '--context-border': '#3e3d32',
      '--context-hover': '#4e4e3e', '--context-text': '#f8f8f2',
    },
  },
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    kind: 'dark',
    load: () => import('@uiw/codemirror-theme-github').then(m => m.githubDark),
    ui: {
      '--bg-main': '#0d1117', '--bg-sidebar': '#161b22', '--bg-tabs': '#010409',
      '--bg-hover': '#1c2128', '--bg-active': '#21262d', '--border-color': '#010409',
      '--text-main': '#c9d1d9', '--text-muted': '#8b949e', '--text-active': '#e6edf3',
      '--accent-color': '#58a6ff', '--context-bg': '#161b22', '--context-border': '#30363d',
      '--context-hover': '#1f6feb', '--context-text': '#c9d1d9',
    },
  },
];

// ── Compartment for hot-swapping the CM6 theme extension ──────────────────────
export const themeCompartment = new Compartment();

// Active theme tracking
let _activeId = 'one-dark';
let _previewId = null;        // actively-previewed id (not yet committed)
const _extensionCache = new Map(); // id → CM6 extension

// ── CSS variable application ──────────────────────────────────────────────────
function applyUiPalette(themeEntry) {
  const root = document.documentElement;
  Object.entries(themeEntry.ui).forEach(([k, v]) => root.style.setProperty(k, v));
}

// ── CM6 Extension Loader (lazy + cached) ─────────────────────────────────────
async function loadThemeExtension(id) {
  if (_extensionCache.has(id)) return _extensionCache.get(id);
  const entry = THEMES.find(t => t.id === id);
  if (!entry) return null;
  const ext = await entry.load();
  _extensionCache.set(id, ext);
  return ext;
}

// ── Internal helpers ─────────────────────────────────────────────────────────
async function _applyEditorTheme(id) {
  const ext = await loadThemeExtension(id);
  if (!ext) return;
  const effect = themeCompartment.reconfigure(ext);
  
  // 1. Update the live view
  if (view) {
    view.dispatch({ effects: effect });
  }

  // 2. Update background tabs so they don't revert on switch
  for (const [path, editorState] of state.fileEditorStates.entries()) {
    if (path !== state.currentFile) {
      state.fileEditorStates.set(path, editorState.update({ effects: effect }).state);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Preview a theme instantly (no persistence). Call commitTheme() to save. */
export async function previewTheme(id) {
  _previewId = id;
  const entry = THEMES.find(t => t.id === id);
  if (!entry) return;
  applyUiPalette(entry);
  await _applyEditorTheme(id);
}

/** Cancel a live preview and restore the previously committed theme. */
export async function cancelPreview() {
  if (_previewId === null) return;
  _previewId = null;
  await previewTheme(_activeId); // revert to active
  _previewId = null;             // clear preview flag after revert
}

/** Commit the currently-previewed (or given) theme and persist to store. */
export async function applyTheme(id) {
  _activeId = id;
  _previewId = null;
  await previewTheme(id);
  _previewId = null; // finalize

  const store = await getStore();
  if (store) {
    await store.set('activeTheme', id);
    await store.save();
  }
}

/** Returns the id of the currently active (committed) theme. */
export function getActiveThemeId() { return _activeId; }

/** Called once at startup – loads persisted theme (or default). */
export async function initTheme() {
  const store = await getStore();
  const saved = store ? await store.get('activeTheme') : null;
  const id = saved && THEMES.find(t => t.id === saved) ? saved : 'one-dark';
  _activeId = id;
  await previewTheme(id);
  _previewId = null;
}

/** Returns the initial (unconfigured) compartment value for createEditorState. */
export function themeCompartmentInit() {
  // Use the currently active/previewed theme extension if loaded, else fallback to oneDark
  const currentExt = _extensionCache.get(_previewId || _activeId) || oneDark;
  return themeCompartment.of(currentExt);
}
