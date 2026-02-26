import { state } from './state.js';
import { pathBasename, pathDirname, esc } from './utils.js';
import { getFileIcon, getFolderIcon } from './icons.js';
import { openFile }         from './files.js';
import { handleDrop, startInlineCreate, deleteSelected, deleteItem, startRename, refreshTree } from './fs.js';

// ── Explorer Rendering ────────────────────────────────────────────────────────
export function renderExplorer() {
  const el = document.getElementById('file-explorer');
  if (!el) return;
  el.innerHTML = '';
  state.flatVisiblePaths = [];

  if (!state.rootDirPath) {
    const welcome = document.createElement('div');
    welcome.className = 'explorer-welcome';
    welcome.innerHTML = `<p>No folder open</p><button id="explorer-open-btn">Open Folder</button>`;
    welcome.querySelector('#explorer-open-btn').addEventListener('click', () => {
      import('./fs.js').then(m => m.openFolder());
    });
    el.appendChild(welcome);
    document.querySelector('.title-actions').style.display = 'none';
    return;
  }

  document.querySelector('.title-actions').style.display = 'flex';
  if (!state.fileTree) return;
  renderNodes(state.fileTree.children, el, 0, state.fileTree.path);

  // Click on empty space → deselect all
  el.addEventListener('click', e => {
    if (e.target === el) { state.selectedPaths.clear(); updateSelectionUI(); }
  });

  // ── Drag-over / drag-leave / drop (delegated to the container) ──
  el.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    const target = e.target.closest('.dir-item');
    if (target) target.classList.add('drop-target');
  });

  el.addEventListener('dragleave', e => {
    if (!el.contains(e.relatedTarget)) {
      document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    }
  });

  el.addEventListener('drop', async e => {
    e.preventDefault();
    document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    const dirEl  = e.target.closest('.dir-item');
    const fileEl = e.target.closest('.file-item');
    let destDir;
    if (dirEl)       destDir = dirEl.dataset.path;
    else if (fileEl) destDir = pathDirname(fileEl.dataset.path || fileEl.dataset.file);
    else             destDir = state.rootDirPath;
    if (destDir) await handleDrop(destDir);
  });
}

function renderNodes(nodes, container, depth, parentPath) {
  if (state.inlineCreator && state.inlineCreator.parentPath === parentPath) {
    container.appendChild(buildInlineCreatorEl(depth, parentPath));
  }
  if (!nodes) return;
  nodes.forEach(node => {
    const isDir = node.type === 'directory';
    state.flatVisiblePaths.push({ path: node.path, isDir });
    container.appendChild(buildExplorerItem(node, depth));
    if (isDir && state.expandedDirs.has(node.path)) {
      renderNodes(node.children, container, depth + 1, node.path);
    }
  });
}

function buildExplorerItem(node, depth) {
  const isDir    = node.type === 'directory';
  const expanded = isDir && state.expandedDirs.has(node.path);
  const dirty    = !isDir && state.dirtyFiles.has(node.path);
  const selected = state.selectedPaths.has(node.path);

  const div = document.createElement('div');
  div.className = (isDir ? 'dir-item' : 'file-item')
    + (selected ? ' selected' : '')
    + (!isDir && node.path === state.currentFile ? ' active' : '');
  div.dataset.path = node.path;
  if (!isDir) div.dataset.file = node.path;
  div.tabIndex = 0;
  div.style.paddingLeft = (6 + depth * 12 + (isDir ? 0 : 16)) + 'px';

  if (isDir) {
    div.innerHTML =
      `<i class="fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'} dir-chevron"></i>` +
      getFolderIcon(node.name, expanded) +
      `<span class="dir-name">${node.name}</span>`;
  } else {
    div.innerHTML =
      `${getFileIcon(node.name)}<span class="file-name">${node.name}</span>` +
      (dirty ? '<span class="explorer-dot">●</span>' : '');
  }

  // Single click: select + open/toggle
  div.addEventListener('click', e => {
    e.stopPropagation();
    div.focus();
    handleExplorerClick(node.path, isDir, e);
  });

  // Double click on file confirms opening
  if (!isDir) {
    div.addEventListener('dblclick', e => { e.stopPropagation(); openFile(node.path); });
  }

  // Delete key
  div.addEventListener('keydown', e => {
    if (e.key === 'Delete') {
      e.preventDefault();
      if (state.selectedPaths.size > 0) deleteSelected();
      else deleteItem(node.path, isDir);
    }
  });

  // Context menu
  div.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    if (!state.selectedPaths.has(node.path)) {
      state.selectedPaths.clear();
      state.selectedPaths.add(node.path);
      state.lastClickedPath = node.path;
      updateSelectionUI();
    }
    state.activeContextPath  = node.path;
    state.activeContextIsDir = isDir;
    import('./contextmenu.js').then(m => m.showCtxMenu(e.pageX, e.pageY));
  });

  // Drag
  div.draggable = true;
  div.addEventListener('dragstart', e => {
    e.stopPropagation();
    if (!state.selectedPaths.has(node.path)) {
      state.selectedPaths.clear();
      state.selectedPaths.add(node.path);
      updateSelectionUI();
    }
    state.draggedPaths = [...state.selectedPaths];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(state.draggedPaths));
    div.classList.add('dragging');
  });
  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    state.draggedPaths = null;
  });

  return div;
}

function handleExplorerClick(path, isDir, e) {
  if (e.ctrlKey || e.metaKey) {
    if (state.selectedPaths.has(path)) state.selectedPaths.delete(path);
    else state.selectedPaths.add(path);
    state.lastClickedPath = path;
  } else if (e.shiftKey && state.lastClickedPath) {
    const idx1 = state.flatVisiblePaths.findIndex(p => p.path === state.lastClickedPath);
    const idx2 = state.flatVisiblePaths.findIndex(p => p.path === path);
    if (idx1 >= 0 && idx2 >= 0) {
      const [start, end] = idx1 < idx2 ? [idx1, idx2] : [idx2, idx1];
      for (let i = start; i <= end; i++) state.selectedPaths.add(state.flatVisiblePaths[i].path);
    }
  } else {
    state.selectedPaths.clear();
    state.selectedPaths.add(path);
    state.lastClickedPath = path;
    if (!isDir) openFile(path, false);
    if (isDir)  toggleDir(path);
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  document.querySelectorAll('.file-item, .dir-item').forEach(el => {
    const path = el.dataset.path || el.dataset.file;
    el.classList.toggle('selected', state.selectedPaths.has(path));
  });
}

function toggleDir(path) {
  if (state.expandedDirs.has(path)) state.expandedDirs.delete(path);
  else state.expandedDirs.add(path);
  renderExplorer();
}

// ── Inline Creator (new file/folder input inside the tree) ────────────────────
function buildInlineCreatorEl(depth, parentPath) {
  const wrap = document.createElement('div');
  wrap.className = 'inline-creator';
  wrap.style.paddingLeft = (6 + depth * 12 + 16) + 'px';

  const iconHtml = state.inlineCreator.type === 'file'
    ? getFileIcon('new')
    : getFolderIcon('new', false);
  wrap.innerHTML =
    `${iconHtml}<input type="text" class="inline-input" ` +
    `placeholder="${state.inlineCreator.type === 'file' ? 'filename.py' : 'folder'}" ` +
    `autocomplete="off" spellcheck="false"/>`;

  const input = wrap.querySelector('.inline-input');
  setTimeout(() => { input.focus(); input.select(); }, 30);

  const commit = async () => {
    const name = input.value.trim();
    if (name) {
      if (state.inlineCreator.type === 'file') await import('./fs.js').then(m => m.doCreateFile(parentPath, name));
      else                                      await import('./fs.js').then(m => m.doCreateDir(parentPath, name));
    }
    state.inlineCreator = null;
    await refreshTree();
  };

  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter')  { e.preventDefault(); await commit(); }
    if (e.key === 'Escape') { e.preventDefault(); state.inlineCreator = null; renderExplorer(); }
  });
  input.addEventListener('blur', () => setTimeout(async () => {
    if (state.inlineCreator) { state.inlineCreator = null; renderExplorer(); }
  }, 150));

  return wrap;
}

// ── Dirty-dot patch (avoids full re-render on every keystroke) ─────────────────
export function patchExplorerDirty(fp) {
  const el = document.querySelector(`.file-item[data-file="${esc(fp)}"]`);
  if (!el) return;
  let dot = el.querySelector('.explorer-dot');
  if (state.dirtyFiles.has(fp)) {
    if (!dot) {
      dot = document.createElement('span');
      dot.className   = 'explorer-dot';
      dot.textContent = '●';
      el.appendChild(dot);
    }
  } else {
    dot?.remove();
  }
}
