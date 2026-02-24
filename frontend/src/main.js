import './style.css';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { searchKeymap, search } from '@codemirror/search';
// File operations are handled by custom Rust commands via invoke (no fs plugin scope issues)
import { open as dialogOpen, ask } from '@tauri-apps/plugin-dialog';
import { load as loadStore } from '@tauri-apps/plugin-store';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

// ── Tauri Detection ────────────────────────────────────────────────────────────
const IS_TAURI = '__TAURI_INTERNALS__' in window;

// ── Store (persistent settings) ────────────────────────────────────────────────
let store = null;
async function getStore() {
  if (store) return store;
  if (!IS_TAURI) return null;
  store = await loadStore('axiom-settings.json');
  return store;
}

async function getRecentProjects() {
  const s = await getStore();
  if (!s) return [];
  return (await s.get('recentProjects')) || [];
}

async function addRecentProject(folderPath, folderName) {
  const s = await getStore();
  if (!s) return;
  let recents = (await s.get('recentProjects')) || [];
  recents = recents.filter(r => r.path !== folderPath);
  recents.unshift({ path: folderPath, name: folderName, lastOpened: Date.now() });
  if (recents.length > 10) recents = recents.slice(0, 10);
  await s.set('recentProjects', recents);
  await s.save();
}

async function removeRecentProject(folderPath) {
  const s = await getStore();
  if (!s) return;
  let recents = (await s.get('recentProjects')) || [];
  recents = recents.filter(r => r.path !== folderPath);
  await s.set('recentProjects', recents);
  await s.save();
}

// ── File System State ──────────────────────────────────────────────────────────
let rootDirPath = null;
let rootName = 'AXIOM_PROJECT';
const fileContents = new Map();
const fileEditorStates = new Map();
const dirtyFiles = new Set();
let fileTree = null;
let expandedDirs = new Set();

let openTabs = [];
let currentFile = null;

let activeContextPath = null;
let activeContextIsDir = false;

let inlineCreator = null;

// ── Explorer Selection & Drag State ────────────────────────────────────────────
let selectedPaths = new Set();
let lastClickedPath = null;
let flatVisiblePaths = [];
let draggedPaths = null;

// ── CodeMirror Effects Flags ───────────────────────────────────────────────────
let isZoomEnabled = false;
let isGlowEnabled = false;
let isRgbGlowEnabled = false;
let isRgbTextEnabled = false;

// ── Path Helpers ───────────────────────────────────────────────────────────────
const SEP = navigator.platform.startsWith('Win') ? '\\' : '/';
function pathJoin(...parts) { return parts.filter(Boolean).join(SEP); }
function pathBasename(p) { return p.split(/[\\/]/).pop(); }
function pathDirname(p) { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i < 0 ? '' : p.substring(0, i); }

// ── Editor Factory ─────────────────────────────────────────────────────────────
function createEditorState(content) {
  return EditorState.create({
    doc: content,
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      drawSelection(),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      autocompletion(),
      search({ top: true }),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      python(),
      oneDark,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && currentFile) {
          const newContent = update.state.doc.toString();
          const savedContent = fileContents.get(currentFile) ?? '';
          const isDirtyNow = newContent !== savedContent;
          if (isDirtyNow && !dirtyFiles.has(currentFile)) {
            dirtyFiles.add(currentFile);
            patchTabDirty(currentFile);
            patchExplorerDirty(currentFile);
          } else if (!isDirtyNow && dirtyFiles.has(currentFile)) {
            dirtyFiles.delete(currentFile);
            patchTabDirty(currentFile);
            patchExplorerDirty(currentFile);
          }
        }
        if (update.selectionSet || update.docChanged) {
          if (typeof window.updateZoomOrigin === 'function') window.updateZoomOrigin();
          updateStatus();
        }
      })
    ]
  });
}

const view = new EditorView({
  state: createEditorState(''),
  parent: document.getElementById('editor-wrap'),
});

// ── File Icon ──────────────────────────────────────────────────────────────────
function getFileIcon(name) {
  let icon = 'document';
  const lower = name.toLowerCase();

  if (lower === 'package.json') icon = 'nodejs';
  else if (lower === 'package-lock.json') icon = 'nodejs';
  else if (lower === 'yarn.lock') icon = 'yarn';
  else if (lower === '.gitignore') icon = 'git';
  else if (lower === 'dockerfile') icon = 'docker';
  else if (lower === 'cargo.toml') icon = 'cargo';
  else if (lower === 'cargo.lock') icon = 'cargo';
  else if (lower === 'readme.md') icon = 'readme';
  else if (lower === 'license') icon = 'certificate';
  else if (lower.endsWith('.py')) icon = 'python';
  else if (lower.endsWith('.js') || lower.endsWith('.cjs') || lower.endsWith('.mjs')) icon = 'javascript';
  else if (lower.endsWith('.ts')) icon = 'typescript';
  else if (lower.endsWith('.jsx')) icon = 'react';
  else if (lower.endsWith('.tsx')) icon = 'react_ts';
  else if (lower.endsWith('.html') || lower.endsWith('.htm')) icon = 'html';
  else if (lower.endsWith('.css')) icon = 'css';
  else if (lower.endsWith('.json')) icon = 'json';
  else if (lower.endsWith('.md')) icon = 'markdown';
  else if (lower.endsWith('.txt')) icon = 'document';
  else if (lower.endsWith('.rs')) icon = 'rust';
  else if (lower.endsWith('.toml')) icon = 'toml';
  else if (lower.endsWith('.yml') || lower.endsWith('.yaml')) icon = 'yaml';
  else if (lower.endsWith('.xml')) icon = 'xml';
  else if (lower.endsWith('.csv')) icon = 'csv';
  else if (lower.endsWith('.sh') || lower.endsWith('.bash')) icon = 'console';
  else if (lower.endsWith('.bat') || lower.endsWith('.ps1')) icon = 'console';
  else if (lower.endsWith('.c')) icon = 'c';
  else if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) icon = 'cpp';
  else if (lower.endsWith('.h') || lower.endsWith('.hpp')) icon = 'h';
  else if (lower.endsWith('.java')) icon = 'java';
  else if (lower.endsWith('.php')) icon = 'php';
  else if (lower.endsWith('.rb')) icon = 'ruby';
  else if (lower.endsWith('.go')) icon = 'go';
  else if (lower.endsWith('.svg')) icon = 'svg';
  else if (lower.match(/\.(png|jpg|jpeg|gif|ico|webp)$/)) icon = 'image';
  else if (lower.match(/\.(mp4|mkv|avi|mov)$/)) icon = 'video';
  else if (lower.match(/\.(mp3|wav|ogg)$/)) icon = 'audio';
  else if (lower.match(/\.(zip|tar|gz|rar|7z)$/)) icon = 'zip';

  return `<img src="https://cdn.jsdelivr.net/gh/PKief/vscode-material-icon-theme@main/icons/${icon}.svg" style="width:16px; height:16px; object-fit:contain; flex-shrink:0; margin-right:4px;" onerror="this.onerror=null; this.src='https://cdn.jsdelivr.net/gh/PKief/vscode-material-icon-theme@main/icons/document.svg';">`;
}

function getFolderIcon(name, expanded) {
  let icon = 'folder-base';
  const lower = name.toLowerCase();

  if (lower === 'src' || lower === 'source') icon = 'folder-src';
  else if (lower === 'components') icon = 'folder-components';
  else if (lower === 'assets' || lower === 'static' || lower === 'images') icon = 'folder-images';
  else if (lower === 'public') icon = 'folder-public';
  else if (lower === 'node_modules') icon = 'folder-node';
  else if (lower === 'docs' || lower === 'doc') icon = 'folder-docs';
  else if (lower === 'tests' || lower === '__tests__' || lower === 'test') icon = 'folder-test';
  else if (lower === 'target' || lower === 'build' || lower === 'dist' || lower === '.next') icon = 'folder-dist';
  else if (lower === '.git' || lower === '.github' || lower === '.vscode') icon = 'folder-git';
  else if (lower === 'scripts') icon = 'folder-scripts';

  if (expanded) icon += '-open';

  return `<img src="https://cdn.jsdelivr.net/gh/PKief/vscode-material-icon-theme@main/icons/${icon}.svg" class="dir-icon" style="width:16px; height:16px; object-fit:contain; flex-shrink:0; margin-right:4px;" onerror="this.onerror=null; this.src='https://cdn.jsdelivr.net/gh/PKief/vscode-material-icon-theme@main/icons/folder-base${expanded ? '-open' : ''}.svg';">`;
}

function esc(str) { return CSS.escape(str); }

// ── Window Title ───────────────────────────────────────────────────────────────
async function updateWindowTitle() {
  if (!IS_TAURI) return;
  const win = getCurrentWindow();
  let title = 'Axiom IDE';
  if (rootName && rootDirPath) title = `${currentFile ? pathBasename(currentFile) + ' - ' : ''}${rootName} - Axiom IDE`;
  else if (currentFile) title = `${pathBasename(currentFile)} - Axiom IDE`;
  await win.setTitle(title);
}

// ── Open Folder (Tauri native) ─────────────────────────────────────────────────
async function openFolder(folderPath) {
  let dirPath = folderPath;
  if (!dirPath) {
    if (!IS_TAURI) {
      alert('Desktop features require the Tauri runtime.');
      return;
    }
    dirPath = await dialogOpen({ directory: true, multiple: false, title: 'Open Folder' });
    if (!dirPath) return;
  }

  rootDirPath = dirPath;
  rootName = pathBasename(dirPath);

  fileContents.clear();
  fileEditorStates.clear();
  dirtyFiles.clear();
  expandedDirs.clear();
  openTabs = [];
  currentFile = null;

  const children = await scanDir(dirPath);
  fileTree = { name: rootName, path: dirPath, type: 'directory', children };

  document.getElementById('sidebar-folder-name').textContent = rootName.toUpperCase();
  showWelcome(false);
  renderExplorer();
  renderTabs();
  updateWindowTitle();
  await addRecentProject(dirPath, rootName);

  const first = findFirstFile(children, '.py') || findFirstFile(children, '.js') || findFirstFile(children, '.rs');
  if (first) openFile(first);
}

async function scanDir(dirPath) {
  const children = [];
  try {
    const entries = await invoke('list_dir', { path: dirPath });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === 'target') continue;
      if (entry.is_directory) {
        const sub = await scanDir(entry.path);
        children.push({ name: entry.name, path: entry.path, type: 'directory', children: sub });
      } else {
        children.push({ name: entry.name, path: entry.path, type: 'file' });
      }
    }
  } catch (e) { console.error('scanDir failed:', dirPath, e); }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return children;
}

function findFirstFile(nodes, ext) {
  for (const n of nodes) {
    if (n.type === 'file' && n.name.endsWith(ext)) return n.path;
    if (n.type === 'directory' && n.children) {
      const f = findFirstFile(n.children, ext);
      if (f) return f;
    }
  }
  return null;
}

async function refreshTree() {
  if (!rootDirPath) { renderExplorer(); return; }
  const children = await scanDir(rootDirPath);
  fileTree = { name: rootName, path: rootDirPath, type: 'directory', children };
  renderExplorer();
}

// ── Explorer Rendering ─────────────────────────────────────────────────────────
function renderExplorer() {
  const el = document.getElementById('file-explorer');
  if (!el) return;
  el.innerHTML = '';
  flatVisiblePaths = [];

  if (!rootDirPath) {
    const welcome = document.createElement('div');
    welcome.className = 'explorer-welcome';
    welcome.innerHTML = `<p>No folder open</p><button id="explorer-open-btn">Open Folder</button>`;
    welcome.querySelector('#explorer-open-btn').addEventListener('click', () => openFolder());
    el.appendChild(welcome);
    document.querySelector('.title-actions').style.display = 'none';
    return;
  }

  document.querySelector('.title-actions').style.display = 'flex';
  if (!fileTree) return;
  renderNodes(fileTree.children, el, 0, fileTree.path);

  // Click on empty explorer space → deselect all
  el.addEventListener('click', e => {
    if (e.target === el) { selectedPaths.clear(); updateSelectionUI(); }
  });

  // ── Delegated drag-drop on the whole explorer container ──
  el.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Find the nearest dir-item under cursor and highlight it
    document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    const target = e.target.closest('.dir-item');
    if (target) target.classList.add('drop-target');
  });

  el.addEventListener('dragleave', e => {
    // Only clear if leaving the explorer entirely
    if (!el.contains(e.relatedTarget)) {
      document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    }
  });

  el.addEventListener('drop', async e => {
    e.preventDefault();
    document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    // Find which directory to drop into
    const dirEl = e.target.closest('.dir-item');
    const fileEl = e.target.closest('.file-item');
    let destDir;
    if (dirEl) {
      destDir = dirEl.dataset.path;
    } else if (fileEl) {
      destDir = pathDirname(fileEl.dataset.path || fileEl.dataset.file);
    } else {
      destDir = rootDirPath;
    }
    if (destDir) await handleDrop(destDir);
  });
}

function renderNodes(nodes, container, depth, parentPath) {
  if (inlineCreator && inlineCreator.parentPath === parentPath) {
    container.appendChild(buildInlineCreatorEl(depth, parentPath));
  }
  if (!nodes) return;
  nodes.forEach(node => {
    const isDir = node.type === 'directory';
    flatVisiblePaths.push({ path: node.path, isDir });
    const el = buildExplorerItem(node, depth);
    container.appendChild(el);
    if (isDir && expandedDirs.has(node.path)) {
      renderNodes(node.children, container, depth + 1, node.path);
    }
  });
}

function buildExplorerItem(node, depth) {
  const isDir = node.type === 'directory';
  const expanded = isDir && expandedDirs.has(node.path);
  const dirty = !isDir && dirtyFiles.has(node.path);
  const selected = selectedPaths.has(node.path);

  const div = document.createElement('div');
  div.className = (isDir ? 'dir-item' : 'file-item')
    + (selected ? ' selected' : '')
    + (!isDir && node.path === currentFile ? ' active' : '');
  div.dataset.path = node.path;
  if (!isDir) div.dataset.file = node.path;
  div.tabIndex = 0;
  div.style.paddingLeft = (6 + depth * 12 + (isDir ? 0 : 16)) + 'px';

  if (isDir) {
    div.innerHTML = `
      <i class="fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'} dir-chevron"></i>
      ${getFolderIcon(node.name, expanded)}
      <span class="dir-name">${node.name}</span>`;
  } else {
    div.innerHTML = `${getFileIcon(node.name)}<span class="file-name">${node.name}</span>${dirty ? '<span class="explorer-dot">●</span>' : ''}`;
  }

  // Click handler: selection + navigation
  div.addEventListener('click', e => {
    e.stopPropagation();
    div.focus();
    handleExplorerClick(node.path, isDir, e);
  });

  // Double click on file opens it (single click selects + opens in VS Code style)
  if (!isDir) {
    div.addEventListener('dblclick', e => { e.stopPropagation(); openFile(node.path); });
  }

  // Keyboard: Del key
  div.addEventListener('keydown', e => {
    if (e.key === 'Delete') {
      e.preventDefault();
      if (selectedPaths.size > 0) deleteSelected();
      else deleteItem(node.path, isDir);
    }
  });

  // Context menu
  div.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    // If right-clicked item not in selection, select just it
    if (!selectedPaths.has(node.path)) {
      selectedPaths.clear();
      selectedPaths.add(node.path);
      lastClickedPath = node.path;
      updateSelectionUI();
    }
    activeContextPath = node.path; activeContextIsDir = isDir;
    showCtxMenu(e.pageX, e.pageY);
  });

  // Drag: make draggable
  div.draggable = true;
  div.addEventListener('dragstart', e => {
    e.stopPropagation();
    if (!selectedPaths.has(node.path)) {
      selectedPaths.clear();
      selectedPaths.add(node.path);
      updateSelectionUI();
    }
    draggedPaths = [...selectedPaths];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(draggedPaths));
    div.classList.add('dragging');
  });
  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    draggedPaths = null;
  });

  return div;
}

function handleExplorerClick(path, isDir, e) {
  if (e.ctrlKey || e.metaKey) {
    // Toggle item in selection
    if (selectedPaths.has(path)) selectedPaths.delete(path);
    else selectedPaths.add(path);
    lastClickedPath = path;
  } else if (e.shiftKey && lastClickedPath) {
    // Range select
    const idx1 = flatVisiblePaths.findIndex(p => p.path === lastClickedPath);
    const idx2 = flatVisiblePaths.findIndex(p => p.path === path);
    if (idx1 >= 0 && idx2 >= 0) {
      const [start, end] = idx1 < idx2 ? [idx1, idx2] : [idx2, idx1];
      for (let i = start; i <= end; i++) {
        selectedPaths.add(flatVisiblePaths[i].path);
      }
    }
  } else {
    // Single click: select this item only
    selectedPaths.clear();
    selectedPaths.add(path);
    lastClickedPath = path;
    // For files, open in editor but keep explorer focus (VS Code behavior)
    if (!isDir) openFile(path, false);
    // For dirs, toggle expand/collapse
    if (isDir) toggleDir(path);
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  document.querySelectorAll('.file-item, .dir-item').forEach(el => {
    const path = el.dataset.path || el.dataset.file;
    el.classList.toggle('selected', selectedPaths.has(path));
  });
}

async function handleDrop(destDir) {
  if (!draggedPaths || draggedPaths.length === 0) return;
  // Don't drop into self or a child of self
  const invalid = draggedPaths.some(p => destDir === p || destDir.startsWith(p + SEP));
  if (invalid) return;
  for (const src of draggedPaths) {
    try {
      await invoke('move_item', { source: src, destDir });
      // Clean up if moved file was open
      const newPath = pathJoin(destDir, pathBasename(src));
      const tabIdx = openTabs.indexOf(src);
      if (tabIdx !== -1) openTabs[tabIdx] = newPath;
      if (currentFile === src) currentFile = newPath;
      const state = fileEditorStates.get(src);
      if (state) { fileEditorStates.set(newPath, state); fileEditorStates.delete(src); }
      const content = fileContents.get(src);
      if (content !== undefined) { fileContents.set(newPath, content); fileContents.delete(src); }
      if (dirtyFiles.has(src)) { dirtyFiles.add(newPath); dirtyFiles.delete(src); }
    } catch (e) { console.error('Move failed:', src, e); }
  }
  selectedPaths.clear();
  draggedPaths = null;
  await refreshTree();
  renderTabs();
  if (currentFile) { updateBreadcrumb(currentFile); updateWindowTitle(); }
}

async function deleteSelected() {
  if (selectedPaths.size === 0) return;
  const count = selectedPaths.size;
  const label = count === 1 ? `"${pathBasename([...selectedPaths][0])}"` : `${count} items`;
  const confirmed = await ask(`Delete ${label}? This cannot be undone.`, {
    title: 'Confirm Delete', kind: 'warning', okLabel: 'Delete', cancelLabel: 'Cancel'
  });
  if (!confirmed) return;
  for (const path of [...selectedPaths]) {
    const isDir = flatVisiblePaths.find(p => p.path === path)?.isDir ?? false;
    try {
      await invoke('delete_item', { path, recursive: isDir });
      fileContents.delete(path); dirtyFiles.delete(path);
      if (openTabs.includes(path)) {
        openTabs = openTabs.filter(f => f !== path);
        fileEditorStates.delete(path);
      }
    } catch (e) { console.error('Delete failed:', path, e); }
  }
  if (currentFile && selectedPaths.has(currentFile)) {
    if (openTabs.length > 0) await openFile(openTabs[openTabs.length - 1]);
    else { currentFile = null; showWelcome(true); renderTabs(); updateWindowTitle(); }
  }
  selectedPaths.clear();
  await refreshTree();
  renderTabs();
}

function buildInlineCreatorEl(depth, parentPath) {
  const wrap = document.createElement('div');
  wrap.className = 'inline-creator';
  wrap.style.paddingLeft = (6 + depth * 12 + 16) + 'px';
  const iconHtml = inlineCreator.type === 'file'
    ? getFileIcon('new')
    : getFolderIcon('new', false);
  wrap.innerHTML = `${iconHtml}<input type="text" class="inline-input" placeholder="${inlineCreator.type === 'file' ? 'filename.py' : 'folder'}" autocomplete="off" spellcheck="false"/>`;
  const input = wrap.querySelector('.inline-input');
  setTimeout(() => { input.focus(); input.select(); }, 30);
  const commit = async () => {
    const name = input.value.trim();
    if (name) {
      if (inlineCreator.type === 'file') await doCreateFile(parentPath, name);
      else await doCreateDir(parentPath, name);
    }
    inlineCreator = null;
    await refreshTree();
  };
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') { e.preventDefault(); await commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); inlineCreator = null; renderExplorer(); }
  });
  input.addEventListener('blur', () => setTimeout(async () => {
    if (inlineCreator) { inlineCreator = null; renderExplorer(); }
  }, 150));
  return wrap;
}

function toggleDir(path) {
  if (expandedDirs.has(path)) expandedDirs.delete(path);
  else expandedDirs.add(path);
  renderExplorer();
}

// ── Tab Rendering ──────────────────────────────────────────────────────────────
function renderTabs() {
  const c = document.getElementById('tabs-container');
  if (!c) return;
  c.innerHTML = '';
  openTabs.forEach(fp => {
    const fn = pathBasename(fp);
    const dirty = dirtyFiles.has(fp);
    const div = document.createElement('div');
    div.className = 'tab' + (fp === currentFile ? ' active' : '');
    div.dataset.file = fp;
    div.innerHTML = `${getFileIcon(fn)}<span class="tab-title">${fn}</span><div class="tab-close-btn ${dirty ? 'is-dirty' : ''}">${dirty ? '<span class="tab-dot">●</span>' : '<i class="fa-solid fa-xmark"></i>'}</div>`;
    div.addEventListener('click', e => { if (!e.target.closest('.tab-close-btn')) openFile(fp); });
    div.querySelector('.tab-close-btn').addEventListener('click', e => { e.stopPropagation(); closeTab(fp); });
    c.appendChild(div);
  });
}

function patchTabDirty(fp) {
  const btn = document.querySelector(`.tab[data-file="${esc(fp)}"] .tab-close-btn`);
  if (!btn) { renderTabs(); return; }
  const dirty = dirtyFiles.has(fp);
  btn.className = 'tab-close-btn' + (dirty ? ' is-dirty' : '');
  btn.innerHTML = dirty ? '<span class="tab-dot">●</span>' : '<i class="fa-solid fa-xmark"></i>';
}

function patchExplorerDirty(fp) {
  const el = document.querySelector(`.file-item[data-file="${esc(fp)}"]`);
  if (!el) return;
  let dot = el.querySelector('.explorer-dot');
  if (dirtyFiles.has(fp)) {
    if (!dot) { dot = document.createElement('span'); dot.className = 'explorer-dot'; dot.textContent = '●'; el.appendChild(dot); }
  } else { dot?.remove(); }
}

// ── Open / Close File ──────────────────────────────────────────────────────────
async function openFile(filePath, focusEditor = true) {
  if (!filePath) return;
  if (currentFile) fileEditorStates.set(currentFile, view.state);

  if (!fileEditorStates.has(filePath)) {
    let content = '';
    try {
      content = await invoke('read_file_text', { path: filePath });
      fileContents.set(filePath, content);
    } catch (e) { console.error('Read failed:', e); return; }
    fileEditorStates.set(filePath, createEditorState(content));
  }

  if (!openTabs.includes(filePath)) openTabs.push(filePath);
  currentFile = filePath;

  showWelcome(false);
  document.getElementById('editor-wrap').style.display = 'flex';
  const bc = document.getElementById('editor-breadcrumb');
  if (bc) bc.style.display = 'flex';

  view.setState(fileEditorStates.get(filePath));
  updateBreadcrumb(filePath);

  document.querySelectorAll('.file-item').forEach(el =>
    el.classList.toggle('active', el.dataset.file === filePath));
  renderTabs();
  updateStatus();
  updateWindowTitle();
  if (focusEditor) setTimeout(() => view.focus(), 30);
}
window.openFile = openFile;

async function closeTab(filePath) {
  if (dirtyFiles.has(filePath)) {
    const result = await showSaveDialog(filePath);
    if (result === 'cancel') return;
    if (result === 'save') await saveFile(filePath);
    dirtyFiles.delete(filePath);
  }
  openTabs = openTabs.filter(f => f !== filePath);
  fileEditorStates.delete(filePath);
  if (filePath === currentFile) {
    if (openTabs.length > 0) {
      await openFile(openTabs[openTabs.length - 1]);
    } else {
      currentFile = null;
      document.getElementById('editor-wrap').style.display = 'none';
      const bc = document.getElementById('editor-breadcrumb');
      if (bc) { bc.style.display = 'none'; bc.innerHTML = ''; }
      showWelcome(true);
      renderExplorer();
      renderTabs();
      updateWindowTitle();
    }
  } else { renderTabs(); }
}

// ── Save File ───────────────────────────────────────────────────────────────────
async function saveFile(filePath) {
  const fp = filePath ?? currentFile;
  if (!fp) return;
  const content = fp === currentFile ? view.state.doc.toString() : (fileEditorStates.get(fp)?.doc.toString() ?? '');
  try {
    await invoke('write_file_text', { path: fp, content });
  } catch (e) { console.error('Save failed:', e); return; }
  fileContents.set(fp, content);
  dirtyFiles.delete(fp);
  patchTabDirty(fp);
  patchExplorerDirty(fp);
}

// ── Save Dialog ─────────────────────────────────────────────────────────────────
function showSaveDialog(filePath) {
  return new Promise(resolve => {
    const overlay = document.getElementById('save-dialog-overlay');
    document.getElementById('save-dialog-message').textContent =
      `Do you want to save changes to "${pathBasename(filePath)}"?`;
    overlay.classList.remove('hidden');
    const saveBtn = document.getElementById('save-dialog-save');
    const skipBtn = document.getElementById('save-dialog-dont-save');
    const cancelBtn = document.getElementById('save-dialog-cancel');
    const done = (result) => {
      overlay.classList.add('hidden');
      saveBtn.removeEventListener('click', onSave);
      skipBtn.removeEventListener('click', onSkip);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onSave = () => done('save');
    const onSkip = () => done('discard');
    const onCancel = () => done('cancel');
    saveBtn.addEventListener('click', onSave);
    skipBtn.addEventListener('click', onSkip);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ── Create File / Folder ────────────────────────────────────────────────────────
async function doCreateFile(parentPath, name) {
  const fullPath = pathJoin(parentPath, name);
  try {
    await invoke('create_file', { path: fullPath });
    fileContents.set(fullPath, '');
    await refreshTree();
    await openFile(fullPath);
  } catch (e) { console.error('Create file failed:', e); }
}

async function doCreateDir(parentPath, name) {
  const fullPath = pathJoin(parentPath, name);
  try {
    await invoke('create_dir', { path: fullPath });
    expandedDirs.add(fullPath);
    await refreshTree();
  } catch (e) { console.error('Create dir failed:', e); }
}

function startInlineCreate(parentPath, type) {
  if (parentPath && !expandedDirs.has(parentPath)) expandedDirs.add(parentPath);
  inlineCreator = { parentPath: parentPath || rootDirPath, type };
  renderExplorer();
}

// ── Delete Item ─────────────────────────────────────────────────────────────────
async function deleteItem(filePath, isDir) {
  const name = pathBasename(filePath);
  const confirmed = await ask(`Delete "${name}"? This cannot be undone.`, {
    title: 'Confirm Delete', kind: 'warning', okLabel: 'Delete', cancelLabel: 'Cancel'
  });
  if (!confirmed) return;
  try {
    await invoke('delete_item', { path: filePath, recursive: isDir });
    if (!isDir) {
      fileContents.delete(filePath);
      dirtyFiles.delete(filePath);
      if (openTabs.includes(filePath)) {
        openTabs = openTabs.filter(f => f !== filePath);
        fileEditorStates.delete(filePath);
        if (currentFile === filePath) {
          if (openTabs.length > 0) await openFile(openTabs[openTabs.length - 1]);
          else { currentFile = null; showWelcome(true); renderTabs(); updateWindowTitle(); }
        } else renderTabs();
      }
    }
    selectedPaths.delete(filePath);
    await refreshTree();
  } catch (e) { console.error('Delete failed:', e); }
}

// ── Rename ──────────────────────────────────────────────────────────────────────
function startRename(filePath, isDir) {
  hideCtxMenu();
  const sel = isDir ? `.dir-item[data-path="${esc(filePath)}"]` : `.file-item[data-file="${esc(filePath)}"]`;
  const el = document.querySelector(sel);
  if (!el) return;
  const nameEl = el.querySelector('.file-name, .dir-name');
  if (!nameEl) return;
  const original = nameEl.textContent;
  const input = document.createElement('input');
  input.type = 'text'; input.value = original;
  input.className = 'inline-input rename-input';
  input.autocomplete = 'off'; input.spellcheck = false;
  nameEl.replaceWith(input);
  input.select();
  let committed = false;
  const commit = async () => {
    if (committed) return; committed = true;
    const newName = input.value.trim();
    if (!newName || newName === original) { input.replaceWith(nameEl); return; }
    await doRename(filePath, isDir, original, newName);
  };
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') { e.preventDefault(); await commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); input.replaceWith(nameEl); }
  });
  input.addEventListener('blur', () => setTimeout(commit, 100));
}

async function doRename(filePath, isDir, original, newName) {
  const parentPath = pathDirname(filePath);
  const newPath = pathJoin(parentPath, newName);
  try {
    await invoke('rename_item', { oldPath: filePath, newPath });
    if (!isDir) {
      const content = fileContents.get(filePath);
      if (content !== undefined) { fileContents.set(newPath, content); fileContents.delete(filePath); }
      const tabIdx = openTabs.indexOf(filePath);
      if (tabIdx !== -1) openTabs[tabIdx] = newPath;
      if (currentFile === filePath) currentFile = newPath;
      const state = fileEditorStates.get(filePath);
      if (state) { fileEditorStates.set(newPath, state); fileEditorStates.delete(filePath); }
      if (dirtyFiles.has(filePath)) { dirtyFiles.add(newPath); dirtyFiles.delete(filePath); }
    }
    await refreshTree();
    renderTabs();
    if (currentFile === newPath) { updateBreadcrumb(newPath); updateWindowTitle(); }
  } catch (e) { console.error('Rename failed:', e); }
}

// ── Breadcrumb ──────────────────────────────────────────────────────────────────
function updateBreadcrumb(filePath) {
  const bc = document.getElementById('editor-breadcrumb');
  if (!bc) return;
  let parts;
  if (rootDirPath && filePath.startsWith(rootDirPath)) {
    const rel = filePath.substring(rootDirPath.length).replace(/^[\\/]/, '');
    parts = [rootName, ...rel.split(/[\\/]/)];
  } else {
    // File is outside the project — show the full absolute path
    parts = filePath.split(/[\\/]/);
  }
  bc.innerHTML = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    const isFirst = i === 0;
    const icon = isLast ? getFileIcon(p) : (isFirst ? '' : '<i class="fa-solid fa-folder" style="color:#E8AB4F;font-size:11px;"></i>');
    return `<span class="crumb${isLast ? ' current-file-crumb' : ''}">${icon ? icon + ' ' : ''}${p}</span>${!isLast ? '<i class="fa-solid fa-chevron-right crumb-separator"></i>' : ''}`;
  }).join('');
}

// ── Welcome Screen ──────────────────────────────────────────────────────────────
async function showWelcome(show) {
  const welcome = document.getElementById('editor-welcome');
  const wrap = document.getElementById('editor-wrap');
  const bc = document.getElementById('editor-breadcrumb');
  const header = document.querySelector('.editor-header');

  if (show) {
    welcome.style.display = 'flex';
    wrap.style.display = 'none';
    if (bc) bc.style.display = 'none';
    if (header) header.style.display = 'none';

    if (!rootDirPath) {
      await renderWelcomeScreen();
    } else {
      welcome.innerHTML = `
        <i class="fa-brands fa-python" style="font-size:48px;color:#4B8BBE;opacity:0.3;"></i>
        <p id="welcome-message">Select a file to start editing</p>`;
    }
  } else {
    welcome.style.display = 'none';
    wrap.style.display = 'flex';
    if (bc) bc.style.display = 'flex';
    if (header) header.style.display = 'flex';
  }
}

async function renderWelcomeScreen() {
  const welcome = document.getElementById('editor-welcome');
  const recents = await getRecentProjects();

  let recentsHtml = '';
  if (recents.length > 0) {
    recentsHtml = `
      <div class="welcome-section">
        <h3 class="welcome-section-title">Recent Projects</h3>
        <div class="recent-list">
          ${recents.map(r => `
            <div class="recent-item" data-path="${r.path}">
              <i class="fa-solid fa-folder" style="color:#E8AB4F;"></i>
              <div class="recent-info">
                <span class="recent-name">${r.name}</span>
                <span class="recent-path">${r.path}</span>
              </div>
              <button class="recent-remove" data-path="${r.path}" title="Remove from recents">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  welcome.innerHTML = `
    <div class="welcome-hero">
      <div class="welcome-logo">⚡</div>
      <h1 class="welcome-title">Axiom IDE</h1>
      <p class="welcome-subtitle">Blazing-fast code editor</p>
    </div>
    <div class="welcome-actions">
      <button class="welcome-action-btn" id="welcome-open-folder">
        <i class="fa-solid fa-folder-open"></i>
        <span>Open Folder</span>
        <span class="welcome-shortcut">Ctrl+K Ctrl+O</span>
      </button>
      <button class="welcome-action-btn" id="welcome-open-file">
        <i class="fa-solid fa-file"></i>
        <span>Open File</span>
        <span class="welcome-shortcut">Ctrl+O</span>
      </button>
    </div>
    ${recentsHtml}
  `;

  welcome.querySelector('#welcome-open-folder')?.addEventListener('click', () => openFolder());
  welcome.querySelector('#welcome-open-file')?.addEventListener('click', () => openSingleFile());
  welcome.querySelectorAll('.recent-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.recent-remove')) return;
      openFolder(el.dataset.path);
    });
  });
  welcome.querySelectorAll('.recent-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeRecentProject(btn.dataset.path);
      await renderWelcomeScreen();
    });
  });
}

// ── Open Single File ────────────────────────────────────────────────────────────
async function openSingleFile() {
  if (!IS_TAURI) return;
  const selected = await dialogOpen({
    multiple: false,
    title: 'Open File',
    filters: [
      { name: 'Code Files', extensions: ['py', 'js', 'ts', 'json', 'html', 'css', 'md', 'txt', 'rs', 'toml'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (!selected) return;
  const filePath = typeof selected === 'string' ? selected : selected.path;
  if (!filePath) return;
  // If no folder is open yet, open the parent folder of this file as a project
  if (!rootDirPath) {
    await openFolder(pathDirname(filePath));
  }
  await openFile(filePath);
}

// ── Context Menu ────────────────────────────────────────────────────────────────
const ctxMenu = document.getElementById('context-menu');

function showCtxMenu(x, y) {
  if (!rootDirPath) return;
  ctxMenu.innerHTML = '';
  const isDir = activeContextIsDir;
  const p = activeContextPath;
  const parentOfSelected = isDir ? p : pathDirname(p);
  const createTarget = isDir ? p : parentOfSelected;

  const item = (label, icon, fn, danger = false) => {
    const d = document.createElement('div');
    d.className = 'context-item' + (danger ? ' ctx-danger' : '');
    d.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
    d.addEventListener('click', e => { e.stopPropagation(); hideCtxMenu(); fn(); });
    ctxMenu.appendChild(d);
  };
  const sep = () => { const s = document.createElement('div'); s.className = 'ctx-sep'; ctxMenu.appendChild(s); };

  item('New File', 'fa-file-circle-plus', () => startInlineCreate(createTarget, 'file'));
  item('New Folder', 'fa-folder-plus', () => startInlineCreate(createTarget, 'directory'));
  sep();
  item('Rename', 'fa-pencil', () => startRename(p, isDir));
  sep();
  item('Delete', 'fa-trash', () => deleteItem(p, isDir), true);
  sep();
  item('Copy Path', 'fa-copy', () => navigator.clipboard.writeText(p).catch(() => {}));

  ctxMenu.style.left = x + 'px'; ctxMenu.style.top = y + 'px';
  ctxMenu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const r = ctxMenu.getBoundingClientRect();
    if (r.right > window.innerWidth) ctxMenu.style.left = (x - r.width) + 'px';
    if (r.bottom > window.innerHeight) ctxMenu.style.top = (y - r.height) + 'px';
  });
}

function hideCtxMenu() { ctxMenu.classList.add('hidden'); }
window.addEventListener('click', () => hideCtxMenu());

// ── Sidebar Resizer ─────────────────────────────────────────────────────────────
const resizer = document.getElementById('resizer');
const sidebar = document.getElementById('sidebar');
let isResizing = false;
resizer.addEventListener('mousedown', () => { isResizing = true; resizer.classList.add('resizing'); document.body.style.cursor = 'col-resize'; });
window.addEventListener('mousemove', e => { if (!isResizing) return; let w = Math.max(150, Math.min(600, e.clientX)); sidebar.style.width = w + 'px'; });
window.addEventListener('mouseup', () => { if (isResizing) { isResizing = false; resizer.classList.remove('resizing'); document.body.style.cursor = ''; } });

// ── Explorer Toolbar ────────────────────────────────────────────────────────────
document.getElementById('action-new-file').addEventListener('click', e => {
  e.stopPropagation();
  const parent = currentFile ? pathDirname(currentFile) : rootDirPath;
  startInlineCreate(parent || rootDirPath, 'file');
});
document.getElementById('action-new-folder').addEventListener('click', e => {
  e.stopPropagation();
  const parent = currentFile ? pathDirname(currentFile) : rootDirPath;
  startInlineCreate(parent || rootDirPath, 'directory');
});
document.getElementById('action-refresh').addEventListener('click', async e => { e.stopPropagation(); await refreshTree(); });
document.getElementById('action-collapse').addEventListener('click', e => { e.stopPropagation(); expandedDirs.clear(); renderExplorer(); });

// ── Status Bar ──────────────────────────────────────────────────────────────────
const cursorEl = document.getElementById('sb-cursor');
const wordsEl  = document.getElementById('sb-words');
function updateStatus() {
  if (!currentFile) return;
  const sel  = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const col  = sel.head - line.from + 1;
  if (cursorEl) cursorEl.textContent = `Ln ${line.number}, Col ${col}`;
  const txt = view.state.doc.toString();
  if (wordsEl) wordsEl.textContent = `${txt.trim() === '' ? 0 : txt.trim().split(/\s+/).length} words`;
}
view.dom.addEventListener('click', updateStatus);
view.dom.addEventListener('keyup',  updateStatus);

// ── Zoom Logic ──────────────────────────────────────────────────────────────────
window.updateZoomOrigin = function () {
  if (!isZoomEnabled || !view) return;
  if (!view.hasFocus) { document.body.classList.remove('zoom-active'); return; }
  const sel = view.state.selection.main;
  const coords = view.coordsAtPos(sel.head);
  if (coords) {
    const rect = view.dom.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const ux = ((coords.left - rect.left) / rect.width) * view.dom.offsetWidth;
      const uy = ((coords.top  - rect.top)  / rect.height) * view.dom.offsetHeight;
      const W = view.dom.offsetWidth, H = view.dom.offsetHeight;
      const mx = 400, my = 200;
      let tx = Math.max(mx, Math.min(W - mx, ux));
      let ty = Math.max(my, Math.min(H - my, uy));
      if (W < mx * 2) tx = W / 2;
      if (H < my * 2) ty = H / 2;
      const s = 3;
      view.dom.style.setProperty('--caret-x', `${(tx - s * ux) / (1 - s)}px`);
      view.dom.style.setProperty('--caret-y', `${(ty - s * uy) / (1 - s)}px`);
    }
  }
  document.body.classList.add('zoom-active');
};

// ── Command Palette ─────────────────────────────────────────────────────────────
const commandOverlay = document.getElementById('command-palette-overlay');
const commandInput   = document.getElementById('command-input');
const paletteList    = document.getElementById('palette-list');

const commands = [
  { id: 'open-folder',       label: 'File: Open Folder...' },
  { id: 'open-file',         label: 'File: Open File...' },
  { id: 'new-file',          label: 'File: New File' },
  { id: 'new-folder',        label: 'File: New Folder' },
  { id: 'save-file',         label: 'File: Save' },
  { id: 'close-editor',      label: 'View: Close Editor' },
  { id: 'toggle-glow',       label: 'Preferences: Toggle Neon Glow Effect' },
  { id: 'toggle-rgb-glow',   label: 'Preferences: Toggle RGB Moving Glow Effect' },
  { id: 'toggle-rgb-text',   label: 'Preferences: Toggle RGB Text Effect' },
  { id: 'toggle-zoom',       label: 'Preferences: Toggle 300% Zoom Tracking' },
  { id: 'open-keybindings',  label: 'Preferences: Open Keyboard Shortcuts' },
  { id: 'toggle-terminal',   label: 'View: Toggle Terminal' }
];

let filteredCmds = [], selIdx = 0;

function togglePalette(forceClose = false, mode = 'command') {
  if (forceClose || commandOverlay.classList.contains('active')) {
    commandOverlay.classList.remove('active');
    view.focus();
  } else {
    commandOverlay.classList.add('active');
    commandInput.value = mode === 'command' ? '>' : '';
    renderPalette(commandInput.value);
    setTimeout(() => commandInput.focus(), 50);
  }
}

function getRelativePath(fullPath) {
  if (rootDirPath && fullPath.startsWith(rootDirPath)) {
    return fullPath.substring(rootDirPath.length).replace(/^[\\/]/, '');
  }
  return fullPath;
}

function renderPalette(q) {
  if (q.startsWith('>')) {
    const s = q.slice(1).trim().toLowerCase();
    filteredCmds = commands.filter(c => c.label.toLowerCase().includes(s));
  } else {
    const s = q.toLowerCase();
    const allFiles = fileTree ? getAllFilePaths(fileTree.children) : [];
    const relPaths = allFiles.map(f => ({ full: f, rel: getRelativePath(f), base: pathBasename(f) }));
    filteredCmds = relPaths
      .filter(f => f.base.toLowerCase().includes(s) || f.rel.toLowerCase().includes(s))
      .map(f => ({ id: 'open-file:' + f.full, label: f.base, sublabel: f.rel, isFile: true }));
  }
  selIdx = 0;
  paletteList.innerHTML = '';
  filteredCmds.forEach((cmd, i) => {
    const el = document.createElement('div');
    el.className = 'palette-item' + (i === 0 ? ' active' : '');
    if (cmd.isFile) {
      // Show relative path from project root below the filename
      const dirPart = cmd.sublabel.includes('/') || cmd.sublabel.includes('\\') 
        ? cmd.sublabel.split(/[\\/]/).slice(0, -1).join('/') 
        : '';
      el.innerHTML = `${getFileIcon(cmd.label)}<span style="margin-left:8px">${cmd.label}</span>${dirPart ? `<span class="palette-path">${dirPart}</span>` : ''}`;
    } else {
      el.innerHTML = cmd.label;
    }
    el.onclick = () => execCmd(cmd.id);
    el.addEventListener('mouseenter', () => { document.querySelectorAll('.palette-item').forEach(x => x.classList.remove('active')); el.classList.add('active'); selIdx = i; });
    paletteList.appendChild(el);
  });
}

function getAllFilePaths(nodes) {
  const paths = [];
  if (!nodes) return paths;
  for (const n of nodes) {
    if (n.type === 'file') paths.push(n.path);
    else if (n.children) paths.push(...getAllFilePaths(n.children));
  }
  return paths;
}

function execCmd(id) {
  togglePalette(true);
  if (id.startsWith('open-file:')) { openFile(id.slice(10)); return; }
  switch (id) {
    case 'open-folder':     openFolder(); break;
    case 'open-file':       openSingleFile(); break;
    case 'new-file':
      if (!rootDirPath) { alert('Please open a folder first.'); return; }
      { const p = currentFile ? pathDirname(currentFile) : rootDirPath; startInlineCreate(p, 'file'); }
      break;
    case 'new-folder':
      if (!rootDirPath) { alert('Please open a folder first.'); return; }
      { const p = currentFile ? pathDirname(currentFile) : rootDirPath; startInlineCreate(p, 'directory'); }
      break;
    case 'save-file':       saveFile(); break;
    case 'close-editor':    if (currentFile) closeTab(currentFile); break;
    case 'toggle-glow':
      isGlowEnabled = !isGlowEnabled;
      isRgbGlowEnabled = false; isRgbTextEnabled = false;
      document.body.classList.toggle('glow-effect', isGlowEnabled);
      document.body.classList.remove('rgb-glow-effect', 'rgb-text-effect'); break;
    case 'toggle-rgb-glow':
      isRgbGlowEnabled = !isRgbGlowEnabled;
      isGlowEnabled = false; isRgbTextEnabled = false;
      document.body.classList.toggle('rgb-glow-effect', isRgbGlowEnabled);
      document.body.classList.remove('glow-effect', 'rgb-text-effect'); break;
    case 'toggle-rgb-text':
      isRgbTextEnabled = !isRgbTextEnabled;
      isGlowEnabled = false; isRgbGlowEnabled = false;
      document.body.classList.toggle('rgb-text-effect', isRgbTextEnabled);
      document.body.classList.remove('glow-effect', 'rgb-glow-effect'); break;
    case 'toggle-zoom':
      isZoomEnabled = !isZoomEnabled;
      document.body.classList.toggle('zoom-tracking-effect', isZoomEnabled);
      if (isZoomEnabled) { document.body.classList.add('zoom-active'); window.updateZoomOrigin(); }
      else { document.body.classList.remove('zoom-active'); view.dom.style.removeProperty('--caret-x'); view.dom.style.removeProperty('--caret-y'); } break;
    case 'open-keybindings': openKeymapSettings(); break;
    case 'toggle-terminal': toggleTerminal(); break;
  }
}

commandInput.addEventListener('input', e => renderPalette(e.target.value));
commandInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') togglePalette(true);
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (selIdx < filteredCmds.length - 1) { selIdx++; document.querySelectorAll('.palette-item').forEach((el,i) => el.classList.toggle('active', i === selIdx)); document.querySelectorAll('.palette-item')[selIdx]?.scrollIntoView({block:'nearest'}); } }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); if (selIdx > 0) { selIdx--; document.querySelectorAll('.palette-item').forEach((el,i) => el.classList.toggle('active', i === selIdx)); document.querySelectorAll('.palette-item')[selIdx]?.scrollIntoView({block:'nearest'}); } }
  else if (e.key === 'Enter')     { e.preventDefault(); if (filteredCmds[selIdx]) execCmd(filteredCmds[selIdx].id); }
});
commandOverlay.addEventListener('click', e => { if (e.target === commandOverlay) togglePalette(true); });

// ── Keymap Settings ─────────────────────────────────────────────────────────────
const keybindings = [
  { id: 'editor.undo',               command: 'Undo',                       keys: 'Ctrl+Z',          source: 'Default' },
  { id: 'editor.redo',               command: 'Redo',                       keys: 'Ctrl+Y',          source: 'Default' },
  { id: 'editor.cut',                command: 'Cut',                        keys: 'Ctrl+X',          source: 'Default' },
  { id: 'editor.copy',               command: 'Copy',                       keys: 'Ctrl+C',          source: 'Default' },
  { id: 'editor.paste',              command: 'Paste',                      keys: 'Ctrl+V',          source: 'Default' },
  { id: 'editor.selectAll',          command: 'Select All',                 keys: 'Ctrl+A',          source: 'Default' },
  { id: 'editor.find',               command: 'Find',                       keys: 'Ctrl+F',          source: 'Default' },
  { id: 'editor.replace',            command: 'Find and Replace',           keys: 'Ctrl+H',          source: 'Default' },
  { id: 'editor.indent',             command: 'Indent Line',                keys: 'Tab',             source: 'Default' },
  { id: 'editor.outdent',            command: 'Outdent Line',               keys: 'Shift+Tab',       source: 'Default' },
  { id: 'workbench.quickOpen',       command: 'Go to File',                 keys: 'Ctrl+P',          source: 'Default' },
  { id: 'workbench.commandPalette',  command: 'Open Command Palette',       keys: 'Ctrl+Shift+P',    source: 'Default' },
  { id: 'workbench.openKeybindings', command: 'Open Keyboard Shortcuts',    keys: 'Ctrl+K Ctrl+S',   source: 'Default' },
  { id: 'workbench.newFile',         command: 'New File',                   keys: 'Ctrl+N',          source: 'Default' },
  { id: 'workbench.saveFile',        command: 'Save File',                  keys: 'Ctrl+S',          source: 'Default' },
  { id: 'workbench.closeEditor',     command: 'Close Editor',               keys: 'Ctrl+W',          source: 'Default' },
  { id: 'workbench.openFolder',      command: 'Open Folder',                keys: 'Ctrl+K Ctrl+O',   source: 'Default' },
  { id: 'workbench.openFile',        command: 'Open File',                  keys: 'Ctrl+O',          source: 'Default' },
  { id: 'preferences.glow',         command: 'Toggle Neon Glow',           keys: 'Ctrl+Alt+G',      source: 'Default' },
  { id: 'preferences.rgbGlow',      command: 'Toggle RGB Glow',            keys: 'Ctrl+Alt+R',      source: 'Default' },
  { id: 'preferences.rgbText',      command: 'Toggle RGB Text',            keys: 'Ctrl+Alt+T',      source: 'Default' },
  { id: 'preferences.zoom',         command: 'Toggle 300% Zoom',           keys: 'Ctrl+Alt+Z',      source: 'Default' },
];

const keymapOverlay = document.getElementById('keymap-overlay');
const keymapSearch  = document.getElementById('keymap-search');
const keymapBody    = document.getElementById('keymap-table-body');
let editRowId = null;

function openKeymapSettings() {
  keymapOverlay.classList.add('active');
  keymapSearch.value = ''; editRowId = null;
  renderKeymapRows(); setTimeout(() => keymapSearch.focus(), 50);
}
function closeKeymapSettings() { keymapOverlay.classList.remove('active'); editRowId = null; view.focus(); }

document.getElementById('keymap-close-btn').addEventListener('click', closeKeymapSettings);
keymapOverlay.addEventListener('click', e => { if (e.target === keymapOverlay) closeKeymapSettings(); });
keymapOverlay.addEventListener('keydown', e => { if (e.key === 'Escape' && !editRowId) { e.preventDefault(); closeKeymapSettings(); } });

function fmtKeys(keys) {
  if (!keys) return '<span style="color:var(--text-muted);font-style:italic;font-size:11px">—</span>';
  return keys.split(' ').map((chord, i) => {
    const badges = chord.split('+').map(k => `<span class="kbd-badge">${k}</span>`).join('<span class="kbd-sep">+</span>');
    return (i > 0 ? '<span class="kbd-sep" style="margin:0 4px"> </span>' : '') + badges;
  }).join('');
}

function renderKeymapRows(q = '') {
  const s = q.toLowerCase();
  const filtered = keybindings.filter(kb => kb.command.toLowerCase().includes(s) || kb.keys.toLowerCase().includes(s) || kb.id.toLowerCase().includes(s));
  keymapBody.innerHTML = '';
  if (!filtered.length) { keymapBody.innerHTML = '<div class="keymap-no-results">No keybindings found.</div>'; return; }
  filtered.forEach(kb => {
    const row = document.createElement('div');
    row.className = 'keymap-row' + (editRowId === kb.id ? ' keymap-row-editing' : '');
    row.dataset.id = kb.id;
    if (editRowId === kb.id) {
      row.innerHTML = `<span class="keymap-col-command">${kb.command}</span><span class="keymap-col-keybinding"><input type="text" class="keymap-edit-input" id="keymap-edit-active" placeholder="Press key combo..." readonly/></span><span class="keymap-col-source">${kb.source}</span>`;
    } else {
      row.innerHTML = `<span class="keymap-col-command">${kb.command}</span><span class="keymap-col-keybinding"><button class="keymap-edit-btn" title="Edit"><i class="fa-solid fa-pencil"></i></button>${fmtKeys(kb.keys)}</span><span class="keymap-col-source">${kb.source}</span>`;
    }
    keymapBody.appendChild(row);
    if (editRowId === kb.id) {
      const inp = row.querySelector('#keymap-edit-active');
      setTimeout(() => inp.focus(), 30);
      inp.addEventListener('keydown', e => {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { editRowId = null; renderKeymapRows(keymapSearch.value); return; }
        const parts = [...(e.ctrlKey?['Ctrl']:[]), ...(e.shiftKey?['Shift']:[]), ...(e.altKey?['Alt']:[]), ...(e.metaKey?['Meta']:[])];
        if (!['Control','Shift','Alt','Meta'].includes(e.key)) {
          let dk = e.key.length === 1 ? e.key.toUpperCase() : e.key;
          if (e.key === 'ArrowUp') dk = 'Up'; if (e.key === 'ArrowDown') dk = 'Down';
          if (e.key === 'ArrowLeft') dk = 'Left'; if (e.key === 'ArrowRight') dk = 'Right';
          if (e.key === ' ') dk = 'Space';
          parts.push(dk); kb.keys = parts.join('+'); kb.source = 'User';
          editRowId = null; renderKeymapRows(keymapSearch.value);
        } else inp.value = parts.join('+') + '+...';
      });
    } else {
      row.querySelector('.keymap-edit-btn')?.addEventListener('click', e => { e.stopPropagation(); editRowId = kb.id; renderKeymapRows(keymapSearch.value); });
      row.addEventListener('dblclick', () => { editRowId = kb.id; renderKeymapRows(keymapSearch.value); });
    }
  });
}
keymapSearch.addEventListener('input', e => renderKeymapRows(e.target.value));

// ── Menu Bar ────────────────────────────────────────────────────────────────────
let activeMenu = null;
function closeAllMenus() { document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); activeMenu = null; }
document.querySelectorAll('.menu-item').forEach(item => {
  item.querySelector('.menu-label').addEventListener('click', e => {
    e.stopPropagation();
    if (item.classList.contains('open')) closeAllMenus();
    else { closeAllMenus(); item.classList.add('open'); activeMenu = item.dataset.menu; }
  });
  item.addEventListener('mouseenter', () => {
    if (activeMenu && activeMenu !== item.dataset.menu) { closeAllMenus(); item.classList.add('open'); activeMenu = item.dataset.menu; }
  });
});
document.querySelectorAll('.menu-entry').forEach(e => {
  e.addEventListener('click', ev => { ev.stopPropagation(); closeAllMenus(); handleMenu(e.dataset.action); });
});
window.addEventListener('click', () => { if (activeMenu) closeAllMenus(); });

function handleMenu(action) {
  switch (action) {
    case 'new-file':          execCmd('new-file'); break;
    case 'new-folder':        execCmd('new-folder'); break;
    case 'open-folder':       openFolder(); break;
    case 'open-file':         openSingleFile(); break;
    case 'save-file':         saveFile(); break;
    case 'close-editor':      if (currentFile) closeTab(currentFile); break;
    case 'refresh-explorer':  refreshTree(); break;
    case 'undo':              import('@codemirror/commands').then(m => m.undo(view)); break;
    case 'redo':              import('@codemirror/commands').then(m => m.redo(view)); break;
    case 'cut':               document.execCommand('cut'); break;
    case 'copy':              document.execCommand('copy'); break;
    case 'paste':             navigator.clipboard.readText().then(t => view.dispatch(view.state.replaceSelection(t))).catch(()=>{}); break;
    case 'find':              import('@codemirror/search').then(m => m.openSearchPanel(view)); break;
    case 'replace':           import('@codemirror/search').then(m => m.openSearchPanel(view)); break;
    case 'command-palette':   togglePalette(false, 'command'); break;
    case 'keyboard-shortcuts':openKeymapSettings(); break;
    case 'toggle-glow':       execCmd('toggle-glow'); break;
    case 'toggle-rgb-glow':   execCmd('toggle-rgb-glow'); break;
    case 'toggle-rgb-text':   execCmd('toggle-rgb-text'); break;
    case 'toggle-zoom':       execCmd('toggle-zoom'); break;
    case 'go-to-file':        togglePalette(false, 'file'); break;
  }
}

// ── Global Keyboard Shortcuts ───────────────────────────────────────────────────
let ctrlKPending = false;
window.addEventListener('keydown', async e => {
  const ctrl = e.ctrlKey, shift = e.shiftKey, alt = e.altKey;
  const k = e.key.toLowerCase();

  // Delete key: delete selected items in explorer (skip if editor has focus)
  if (e.key === 'Delete' && !ctrl && !shift && !alt) {
    const editorFocused = document.activeElement?.closest('.cm-editor');
    if (!editorFocused && selectedPaths.size > 0) {
      e.preventDefault();
      await deleteSelected();
      return;
    }
  }

  if (ctrl && !shift && !alt && k === 's') { e.preventDefault(); await saveFile(); return; }
  if (ctrl && !shift && !alt && k === 'n') { e.preventDefault(); execCmd('new-file'); return; }
  if (ctrl && !shift && !alt && k === 'w') { e.preventDefault(); if (currentFile) closeTab(currentFile); return; }
  if (ctrl && !shift && !alt && k === 'p') { e.preventDefault(); togglePalette(false, 'file'); return; }
  if (ctrl && shift  && !alt && k === 'p') { e.preventDefault(); togglePalette(false, 'command'); return; }
  if (ctrl && !shift && !alt && k === 'o') { e.preventDefault(); openSingleFile(); return; }
  if (ctrl && !shift && !alt && k === 'k') { e.preventDefault(); ctrlKPending = true; return; }
  if (ctrlKPending) {
    if (ctrl && k === 's') { e.preventDefault(); ctrlKPending = false; openKeymapSettings(); return; }
    if (ctrl && k === 'o') { e.preventDefault(); ctrlKPending = false; openFolder(); return; }
    ctrlKPending = false;
  }
  if (ctrl && alt && k === 'g') { e.preventDefault(); execCmd('toggle-glow'); return; }
  if (ctrl && alt && k === 'r') { e.preventDefault(); execCmd('toggle-rgb-glow'); return; }
  if (ctrl && alt && k === 't') { e.preventDefault(); execCmd('toggle-rgb-text'); return; }
  if (ctrl && alt && k === 'z') { e.preventDefault(); execCmd('toggle-zoom'); return; }
  
  if (ctrl && shift && !alt && e.key === '`') { e.preventDefault(); toggleTerminal(); return; }
});

// ── Terminal ──────────────────────────────────────────────────────────────────
let term = null;
let fitAddon = null;
let unlistenOutput = null;

async function toggleTerminal() {
  const panel = document.getElementById('terminal-panel');
  const resizer = document.getElementById('terminal-resizer');
  if (panel.style.display === 'none') {
    panel.style.display = 'flex';
    resizer.style.display = 'block';
    
    if (!term) {
      term = new Terminal({
        theme: {
          background: getComputedStyle(document.body).getPropertyValue('--bg-color').trim() || '#1e1e1e',
          foreground: '#cccccc',
          cursor: '#ffffff'
        },
        fontFamily: 'monospace',
        fontSize: 14,
        cursorBlink: true
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal-body'));
      
      // Small delay so DOM settles before fit
      setTimeout(() => fitAddon.fit(), 30);
      
      term.onData(data => {
        if (IS_TAURI) invoke('terminal_input', { input: data });
      });
      term.onResize(size => {
        if (IS_TAURI) invoke('resize_terminal', { rows: size.rows, cols: size.cols });
      });
      
      if (IS_TAURI) {
        unlistenOutput = await listen('terminal-output', event => {
          term.write(event.payload);
        });
        await invoke('start_terminal').catch(err => {
          console.error("Terminal start failed:", err);
          term.write("\x1b[31mFailed to start terminal: " + err + "\x1b[0m\r\n");
        });
      }
      
      // Resizer
      let isDragging = false;
      resizer.addEventListener('mousedown', () => isDragging = true);
      document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        const totalHeight = document.getElementById('editor-area').clientHeight;
        const newTerminalHeight = document.getElementById('editor-area').getBoundingClientRect().bottom - e.clientY;
        if (newTerminalHeight > 100 && newTerminalHeight < totalHeight - 100) {
          panel.style.height = newTerminalHeight + 'px';
          fitAddon.fit();
        }
      });
      document.addEventListener('mouseup', () => isDragging = false);
      window.addEventListener('resize', () => {
        if (panel.style.display !== 'none') fitAddon.fit();
      });

      document.getElementById('action-close-terminal').addEventListener('click', () => {
        panel.style.display = 'none';
        resizer.style.display = 'none';
        view.focus();
      });
    } else {
      setTimeout(() => fitAddon.fit(), 30);
    }
    
    setTimeout(() => term.focus(), 50);
  } else {
    panel.style.display = 'none';
    resizer.style.display = 'none';
    view.focus();
  }
}

// ── Init ────────────────────────────────────────────────────────────────────────
showWelcome(true);
renderExplorer();
renderTabs();
