import { invoke }      from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { ask }          from '@tauri-apps/plugin-dialog';
import { state, IS_TAURI } from './state.js';
import { pathBasename, pathJoin, pathDirname, SEP } from './utils.js';
import { addRecentProject } from './store.js';
import { renderTabs }   from './tabs.js';
import { openFile, updateWindowTitle } from './files.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
export function findFirstFile(nodes, ext) {
  for (const n of nodes) {
    if (n.type === 'file' && n.name.endsWith(ext)) return n.path;
    if (n.type === 'directory' && n.children && n.children.length > 0) {
      const f = findFirstFile(n.children, ext);
      if (f) return f;
    }
  }
  return null;
}

export function getAllFilePaths(nodes) {
  const paths = [];
  if (!nodes) return paths;
  for (const n of nodes) {
    if (n.type === 'file') paths.push(n.path);
    else if (n.children && n.children.length > 0)  paths.push(...getAllFilePaths(n.children));
  }
  return paths;
}

// ── Directory Scan ────────────────────────────────────────────────────────────
export async function scanDir(dirPath) {
  const children = [];
  try {
    const entries = await invoke('list_dir', { path: dirPath });
    for (const entry of entries) {
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === '__pycache__' ||
        entry.name === 'target'
      ) continue;

      if (entry.is_directory) {
        children.push({ name: entry.name, path: entry.path, type: 'directory', children: null });
      } else {
        children.push({ name: entry.name, path: entry.path, type: 'file' });
      }
    }
  } catch (e) {
    console.error('scanDir failed:', dirPath, e);
  }

  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return children;
}

// ── Refresh Explorer Tree ─────────────────────────────────────────────────────
export async function refreshTree() {
  if (!state.rootDirPath) {
    const { renderExplorer } = await import('./explorer.js');
    renderExplorer();
    return;
  }
  // Shallow refresh of the root. 
  // TODO: In a more advanced impl, we might want to refresh all expanded dirs.
  const children = await scanDir(state.rootDirPath);
  state.fileTree = { name: state.rootName, path: state.rootDirPath, type: 'directory', children };
  const { renderExplorer } = await import('./explorer.js');
  renderExplorer();
}

// ── Open Folder ───────────────────────────────────────────────────────────────
export async function openFolder(folderPath) {
  let dirPath = folderPath;
  if (!dirPath) {
    if (!IS_TAURI) { alert('Desktop features require the Tauri runtime.'); return; }
    dirPath = await dialogOpen({ directory: true, multiple: false, title: 'Open Folder' });
    if (!dirPath) return;
  }

  state.rootDirPath = dirPath;
  state.rootName    = pathBasename(dirPath);

  // Reset all open-file state
  state.fileContents.clear();
  state.fileEditorStates.clear();
  state.dirtyFiles.clear();
  state.expandedDirs.clear();
  state.openTabs  = [];
  state.currentFile = null;

  const children = await scanDir(dirPath);
  state.fileTree  = { name: state.rootName, path: dirPath, type: 'directory', children };

  document.getElementById('sidebar-folder-name').textContent = state.rootName.toUpperCase();

  const { showWelcome }    = await import('./welcome.js');
  const { renderExplorer } = await import('./explorer.js');
  showWelcome(true);
  renderExplorer();
  renderTabs();
  updateWindowTitle();
  await addRecentProject(dirPath, state.rootName);
}

// ── File CRUD Operations ──────────────────────────────────────────────────────
export async function doCreateFile(parentPath, name) {
  const fullPath = pathJoin(parentPath, name);
  try {
    await invoke('create_file', { path: fullPath });
    state.fileContents.set(fullPath, '');
    await refreshTree();
    await openFile(fullPath);
  } catch (e) {
    console.error('Create file failed:', e);
  }
}

export async function doCreateDir(parentPath, name) {
  const fullPath = pathJoin(parentPath, name);
  try {
    await invoke('create_dir', { path: fullPath });
    state.expandedDirs.add(fullPath);
    await refreshTree();
  } catch (e) {
    console.error('Create dir failed:', e);
  }
}

export function startInlineCreate(parentPath, type) {
  if (parentPath && !state.expandedDirs.has(parentPath)) state.expandedDirs.add(parentPath);
  state.inlineCreator = { parentPath: parentPath || state.rootDirPath, type };
  import('./explorer.js').then(m => m.renderExplorer());
}

export async function deleteItem(filePath, isDir) {
  const name      = pathBasename(filePath);
  const confirmed = await ask(`Delete "${name}"? This cannot be undone.`, {
    title: 'Confirm Delete', kind: 'warning', okLabel: 'Delete', cancelLabel: 'Cancel',
  });
  if (!confirmed) return;
  try {
    await invoke('delete_item', { path: filePath, recursive: isDir });
    if (!isDir) {
      state.fileContents.delete(filePath);
      state.dirtyFiles.delete(filePath);
      if (state.openTabs.includes(filePath)) {
        state.openTabs = state.openTabs.filter(f => f !== filePath);
        state.fileEditorStates.delete(filePath);
        if (state.currentFile === filePath) {
          if (state.openTabs.length > 0) await openFile(state.openTabs[state.openTabs.length - 1]);
          else {
            state.currentFile = null;
            const { showWelcome } = await import('./welcome.js');
            showWelcome(true);
            renderTabs();
            updateWindowTitle();
          }
        } else renderTabs();
      }
    }
    state.selectedPaths.delete(filePath);
    await refreshTree();
  } catch (e) {
    console.error('Delete failed:', e);
  }
}

export async function deleteSelected() {
  if (state.selectedPaths.size === 0) return;
  const count     = state.selectedPaths.size;
  const label     = count === 1 ? `"${pathBasename([...state.selectedPaths][0])}"` : `${count} items`;
  const confirmed = await ask(`Delete ${label}? This cannot be undone.`, {
    title: 'Confirm Delete', kind: 'warning', okLabel: 'Delete', cancelLabel: 'Cancel',
  });
  if (!confirmed) return;

  for (const path of [...state.selectedPaths]) {
    const isDir = state.flatVisiblePaths.find(p => p.path === path)?.isDir ?? false;
    try {
      await invoke('delete_item', { path, recursive: isDir });
      state.fileContents.delete(path);
      state.dirtyFiles.delete(path);
      if (state.openTabs.includes(path)) {
        state.openTabs = state.openTabs.filter(f => f !== path);
        state.fileEditorStates.delete(path);
      }
    } catch (e) {
      console.error('Delete failed:', path, e);
    }
  }

  if (state.currentFile && state.selectedPaths.has(state.currentFile)) {
    if (state.openTabs.length > 0) await openFile(state.openTabs[state.openTabs.length - 1]);
    else {
      state.currentFile = null;
      const { showWelcome } = await import('./welcome.js');
      showWelcome(true);
      renderTabs();
      updateWindowTitle();
    }
  }
  state.selectedPaths.clear();
  await refreshTree();
  renderTabs();
}

// ── Rename ────────────────────────────────────────────────────────────────────
export function startRename(filePath, isDir) {
  import('./contextmenu.js').then(m => m.hideCtxMenu());
  const sel  = isDir
    ? `.dir-item[data-path="${CSS.escape(filePath)}"]`
    : `.file-item[data-file="${CSS.escape(filePath)}"]`;
  const el   = document.querySelector(sel);
  if (!el) return;
  const nameEl = el.querySelector('.file-name, .dir-name');
  if (!nameEl) return;

  const original = nameEl.textContent;
  const input    = document.createElement('input');
  input.type     = 'text';
  input.value    = original;
  input.className = 'inline-input rename-input';
  input.autocomplete = 'off';
  input.spellcheck   = false;
  nameEl.replaceWith(input);
  input.select();

  let committed = false;
  const commit  = async () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (!newName || newName === original) { input.replaceWith(nameEl); return; }
    await doRename(filePath, isDir, original, newName);
  };

  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter')  { e.preventDefault(); await commit(); }
    if (e.key === 'Escape') { e.preventDefault(); input.replaceWith(nameEl); }
  });
  input.addEventListener('blur', () => setTimeout(commit, 100));
}

async function doRename(filePath, isDir, _original, newName) {
  const parentPath = pathDirname(filePath);
  const newPath    = pathJoin(parentPath, newName);
  try {
    await invoke('rename_item', { oldPath: filePath, newPath });
    if (!isDir) {
      const content = state.fileContents.get(filePath);
      if (content !== undefined) { state.fileContents.set(newPath, content); state.fileContents.delete(filePath); }
      const tabIdx = state.openTabs.indexOf(filePath);
      if (tabIdx !== -1) state.openTabs[tabIdx] = newPath;
      if (state.currentFile === filePath) state.currentFile = newPath;
      const edState = state.fileEditorStates.get(filePath);
      if (edState) { state.fileEditorStates.set(newPath, edState); state.fileEditorStates.delete(filePath); }
      if (state.dirtyFiles.has(filePath)) { state.dirtyFiles.add(newPath); state.dirtyFiles.delete(filePath); }
    }
    await refreshTree();
    renderTabs();
    if (state.currentFile === newPath) {
      const { updateBreadcrumb } = await import('./breadcrumb.js');
      updateBreadcrumb(newPath);
      updateWindowTitle();
    }
  } catch (e) {
    console.error('Rename failed:', e);
  }
}

// ── Drag-and-Drop Move ────────────────────────────────────────────────────────
export async function handleDrop(destDir) {
  if (!state.draggedPaths || state.draggedPaths.length === 0) return;
  const invalid = state.draggedPaths.some(p => destDir === p || destDir.startsWith(p + SEP));
  if (invalid) return;

  for (const src of state.draggedPaths) {
    try {
      await invoke('move_item', { source: src, destDir });
      const newPath = pathJoin(destDir, pathBasename(src));
      const tabIdx  = state.openTabs.indexOf(src);
      if (tabIdx !== -1) state.openTabs[tabIdx] = newPath;
      if (state.currentFile === src) state.currentFile = newPath;
      const edState = state.fileEditorStates.get(src);
      if (edState) { state.fileEditorStates.set(newPath, edState); state.fileEditorStates.delete(src); }
      const content = state.fileContents.get(src);
      if (content !== undefined) { state.fileContents.set(newPath, content); state.fileContents.delete(src); }
      if (state.dirtyFiles.has(src)) { state.dirtyFiles.add(newPath); state.dirtyFiles.delete(src); }
    } catch (e) {
      console.error('Move failed:', src, e);
    }
  }

  state.selectedPaths.clear();
  state.draggedPaths = null;
  await refreshTree();
  renderTabs();
  if (state.currentFile) {
    const { updateBreadcrumb } = await import('./breadcrumb.js');
    updateBreadcrumb(state.currentFile);
    updateWindowTitle();
  }
}
