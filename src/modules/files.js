import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { state, IS_TAURI } from './state.js';
import { pathBasename, pathDirname } from './utils.js';
import { view, createEditorState } from './editor.js';
import { getLanguageExtension, getLspExtension } from './languages.js';
import { renderTabs, patchTabDirty } from './tabs.js';
import { updateBreadcrumb } from './breadcrumb.js';
import { updateStatus } from './statusbar.js';
import { showSaveDialog } from './dialogs.js';
import { getCurrentWindow } from '@tauri-apps/api/window';

// ── Window Title ──────────────────────────────────────────────────────────────
export async function updateWindowTitle() {
  if (!IS_TAURI) return;
  const win = getCurrentWindow();
  let title = 'Axiom Editor';
  if (state.rootName && state.rootDirPath) {
    title = `${state.currentFile ? pathBasename(state.currentFile) + ' — ' : ''}${state.rootName} — Axiom Editor`;
  } else if (state.currentFile) {
    title = `${pathBasename(state.currentFile)} — Axiom Editor`;
  }
  await win.setTitle(title);
}

// ── Open File ─────────────────────────────────────────────────────────────────
export async function openFile(filePath, focusEditor = true) {
  if (!filePath) return;

  // Persist the current view's state before switching
  if (state.currentFile) {
    state.fileEditorStates.set(state.currentFile, view.state);
  }

  // Load file content + language only the first time
  if (!state.fileEditorStates.has(filePath)) {
    let content = '';
    try {
      content = await invoke('read_file_text', { path: filePath });
      state.fileContents.set(filePath, content);
    } catch (e) {
      console.error('Read failed:', e);
      return;
    }
    const ext     = filePath.split('.').pop();
    const langExt = await getLanguageExtension(ext);
    const lspExt  = await getLspExtension(filePath);
    
    // Combine base language highlighting with LSP features
    state.fileEditorStates.set(filePath, createEditorState(content, [langExt, lspExt]));
  }

  if (!state.openTabs.includes(filePath)) state.openTabs.push(filePath);
  state.currentFile = filePath;

  // Show editor surfaces
  import('./welcome.js').then(m => m.showWelcome(false));
  document.getElementById('editor-wrap').style.display = 'flex';
  const ea = document.getElementById('editor-actions');
  if (ea) ea.style.display = 'flex';
  const bc = document.getElementById('editor-breadcrumb');
  if (bc) bc.style.display = 'flex';

  view.setState(state.fileEditorStates.get(filePath));
  updateBreadcrumb(filePath);

  // Sync explorer active highlight
  document.querySelectorAll('.file-item').forEach(el =>
    el.classList.toggle('active', el.dataset.file === filePath));

  renderTabs();
  updateStatus();
  updateWindowTitle();
  if (focusEditor) setTimeout(() => view.focus(), 30);
}
// Expose globally so welcome.js / fs.js can call it without circular import
window.openFile = openFile;

// ── Close Tab ─────────────────────────────────────────────────────────────────
export async function closeTab(filePath) {
  if (state.dirtyFiles.has(filePath)) {
    const result = await showSaveDialog(filePath);
    if (result === 'cancel') return;
    if (result === 'save')   await saveFile(filePath);
    state.dirtyFiles.delete(filePath);
  }

  state.openTabs = state.openTabs.filter(f => f !== filePath);
  state.fileEditorStates.delete(filePath);
  state.fileContents.delete(filePath); // aggressively free memory

  if (filePath === state.currentFile) {
    if (state.openTabs.length > 0) {
      await openFile(state.openTabs[state.openTabs.length - 1]);
    } else {
      state.currentFile = null;
      document.getElementById('editor-wrap').style.display = 'none';
      const ea = document.getElementById('editor-actions');
      if (ea) ea.style.display = 'none';
      const bc = document.getElementById('editor-breadcrumb');
      if (bc) { bc.style.display = 'none'; bc.innerHTML = ''; }
      import('./welcome.js').then(m => m.showWelcome(true));
      import('./explorer.js').then(m => m.renderExplorer());
      renderTabs();
      updateWindowTitle();
    }
  } else {
    renderTabs();
  }
}

// ── Save File ─────────────────────────────────────────────────────────────────
export async function saveFile(filePath) {
  const fp = filePath ?? state.currentFile;
  if (!fp) return;
  const content = fp === state.currentFile
    ? view.state.doc.toString()
    : (state.fileEditorStates.get(fp)?.doc.toString() ?? '');
  try {
    if (IS_TAURI) {
      await invoke('write_file_text', { path: fp, content });
    }
  } catch (e) {
    console.error('Save failed:', e);
    return;
  }
  state.fileContents.set(fp, content);
  state.dirtyFiles.delete(fp);
  patchTabDirty(fp);
  import('./explorer.js').then(m => m.patchExplorerDirty(fp));

  // Notify live server if an HTML file was saved
  if (fp.toLowerCase().endsWith('.html')) {
    try { await invoke('notify_live_server'); } catch (_) {}
  }
}

// ── Open Single File ──────────────────────────────────────────────────────────
export async function openSingleFile() {
  if (!IS_TAURI) return;
  const selected = await dialogOpen({
    multiple: false,
    title: 'Open File',
    filters: [
      { name: 'Code Files', extensions: ['py','js','ts','json','html','css','md','txt','rs','toml'] },
      { name: 'All Files',  extensions: ['*'] },
    ],
  });
  if (!selected) return;
  const filePath = typeof selected === 'string' ? selected : selected.path;
  if (!filePath) return;
  // If no folder is open yet, treat the file's parent dir as the project root
  if (!state.rootDirPath) {
    const { openFolder } = await import('./fs.js');
    await openFolder(pathDirname(filePath));
  }
  await openFile(filePath);
}
