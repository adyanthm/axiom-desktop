import './style.css';
import { showWelcome } from './modules/welcome.js';
import { renderExplorer } from './modules/explorer.js';
import { renderTabs } from './modules/tabs.js';
import hljs from 'highlight.js';
window.hljs = hljs;

// Load modules that bind global event listeners to the DOM
import './modules/editor.js';
import './modules/statusbar.js';
import './modules/runner.js';
import './modules/commands.js';
import './modules/menubar.js';
import './modules/contextmenu.js';
import './modules/debug.js';
import { initZoom } from './modules/zoom.js';
initZoom();

// ── Sidebar Resizer ──────────────────────────────────────────────────────────
const resizer = document.getElementById('resizer');
const sidebar = document.getElementById('sidebar');

let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  e.preventDefault();
  resizer.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
});

window.addEventListener('mousemove', e => {
  if (!isResizing) return;
  // Min 150px, Max 600px
  let w = Math.max(150, Math.min(600, e.clientX));
  sidebar.style.width = w + 'px';
});

window.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove('resizing');
    document.body.style.cursor = '';
  }
});

// ── Explorer Toolbar Hooks ────────────────────────────────────────────────────
document.getElementById('action-new-file').addEventListener('click', async e => {
  e.stopPropagation();
  const { state } = await import('./modules/state.js');
  const { pathDirname } = await import('./modules/utils.js');
  const { startInlineCreate } = await import('./modules/fs.js');
  
  const parent = state.currentFile ? pathDirname(state.currentFile) : state.rootDirPath;
  startInlineCreate(parent || state.rootDirPath, 'file');
});

document.getElementById('action-new-folder').addEventListener('click', async e => {
  e.stopPropagation();
  const { state } = await import('./modules/state.js');
  const { pathDirname } = await import('./modules/utils.js');
  const { startInlineCreate } = await import('./modules/fs.js');

  const parent = state.currentFile ? pathDirname(state.currentFile) : state.rootDirPath;
  startInlineCreate(parent || state.rootDirPath, 'directory');
});

document.getElementById('action-refresh').addEventListener('click', async e => {
  e.stopPropagation();
  const { refreshTree } = await import('./modules/fs.js');
  await refreshTree();
});

document.getElementById('action-collapse').addEventListener('click', async e => {
  e.stopPropagation();
  const { state } = await import('./modules/state.js');
  const { renderExplorer } = await import('./modules/explorer.js');
  
  state.expandedDirs.clear();
  renderExplorer();
});

// ── Initial Render ────────────────────────────────────────────────────────────
showWelcome(true);
renderExplorer();
renderTabs();
