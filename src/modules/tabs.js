// ── Tab Rendering ─────────────────────────────────────────────────────────────
// Tabs depend on files.js (openFile / closeTab) — those are imported lazily
// inside event handlers to avoid circular import issues at module init time.

import { state } from './state.js';
import { pathBasename, esc } from './utils.js';
import { getFileIcon } from './icons.js';

const container = document.getElementById('tabs-container');

export function renderTabs() {
  if (!container) return;
  container.innerHTML = '';
  let activeTabEl = null;

  state.openTabs.forEach(fp => {
    const fn    = pathBasename(fp);
    const dirty = state.dirtyFiles.has(fp);
    const isActive = fp === state.currentFile;

    const div = document.createElement('div');
    div.className  = 'tab' + (isActive ? ' active' : '');
    div.dataset.file = fp;
    div.innerHTML =
      `${getFileIcon(fn)}<span class="tab-title">${fn}</span>` +
      `<div class="tab-close-btn ${dirty ? 'is-dirty' : ''}">` +
      (dirty ? '<span class="tab-dot">●</span>' : '<i class="fa-solid fa-xmark"></i>') +
      `</div>`;

    div.addEventListener('click', e => {
      if (!e.target.closest('.tab-close-btn')) {
        import('./files.js').then(m => m.openFile(fp));
      }
    });
    div.querySelector('.tab-close-btn').addEventListener('click', e => {
      e.stopPropagation();
      import('./files.js').then(m => m.closeTab(fp));
    });

    container.appendChild(div);
    if (isActive) activeTabEl = div;
  });

  // Scroll the active tab into view (VS Code sliding behaviour)
  if (activeTabEl) {
    setTimeout(() => {
      activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 10);
  }
}

// ── Dirty-state patches (avoid full re-render on every keystroke) ────────────
export function patchTabDirty(fp) {
  const btn = document.querySelector(`.tab[data-file="${esc(fp)}"] .tab-close-btn`);
  if (!btn) { renderTabs(); return; }
  const dirty = state.dirtyFiles.has(fp);
  btn.className = 'tab-close-btn' + (dirty ? ' is-dirty' : '');
  btn.innerHTML = dirty
    ? '<span class="tab-dot">●</span>'
    : '<i class="fa-solid fa-xmark"></i>';
}

// ── Tab Navigation ────────────────────────────────────────────────────────────
export function cycleTab(direction = 1) {
  if (state.openTabs.length < 2) return;
  const currentIndex = state.openTabs.indexOf(state.currentFile);
  if (currentIndex === -1) return; // shouldn't happen while a file is active
  
  let nextIndex = (currentIndex + direction) % state.openTabs.length;
  if (nextIndex < 0) nextIndex = state.openTabs.length - 1;
  
  const nextFile = state.openTabs[nextIndex];
  import('./files.js').then(m => m.openFile(nextFile));
}
