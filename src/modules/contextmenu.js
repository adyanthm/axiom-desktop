import { state } from './state.js';
import { deleteItem, startRename, startInlineCreate } from './fs.js';
import { pathDirname } from './utils.js';

// ── Context Menu ──────────────────────────────────────────────────────────────
const ctxMenu = document.getElementById('context-menu');

export function showCtxMenu(x, y) {
  if (!state.rootDirPath) return;
  ctxMenu.innerHTML = '';

  const isDir          = state.activeContextIsDir;
  const p              = state.activeContextPath;
  const parentOfSel    = isDir ? p : pathDirname(p);
  const createTarget   = isDir ? p : parentOfSel;

  const item = (label, icon, fn, danger = false) => {
    const d = document.createElement('div');
    d.className = 'context-item' + (danger ? ' ctx-danger' : '');
    d.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
    d.addEventListener('click', e => { e.stopPropagation(); hideCtxMenu(); fn(); });
    ctxMenu.appendChild(d);
  };
  const sep = () => {
    const s = document.createElement('div');
    s.className = 'ctx-sep';
    ctxMenu.appendChild(s);
  };

  item('New File',   'fa-file-circle-plus', () => startInlineCreate(createTarget, 'file'));
  item('New Folder', 'fa-folder-plus',       () => startInlineCreate(createTarget, 'directory'));
  sep();
  item('Rename',     'fa-pencil',            () => startRename(p, isDir));
  sep();
  item('Delete',     'fa-trash',             () => deleteItem(p, isDir), true);
  sep();
  item('Copy Path',  'fa-copy',              () => navigator.clipboard.writeText(p).catch(() => {}));

  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top  = y + 'px';
  ctxMenu.classList.remove('hidden');

  requestAnimationFrame(() => {
    const r = ctxMenu.getBoundingClientRect();
    if (r.right > window.innerWidth)  ctxMenu.style.left = (x - r.width)  + 'px';
    if (r.bottom > window.innerHeight) ctxMenu.style.top  = (y - r.height) + 'px';
  });
}

export function hideCtxMenu() {
  ctxMenu.classList.add('hidden');
}
window.addEventListener('click', hideCtxMenu);
