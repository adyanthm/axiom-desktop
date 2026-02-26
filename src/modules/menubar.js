import { view } from './editor.js';
import { execCmd, togglePalette } from './commands.js';
import { openKeymapSettings } from './keymap.js';
import { state } from './state.js';
import { deleteSelected, openFolder } from './fs.js';
import { saveFile, closeTab, openSingleFile } from './files.js';
import { toggleTerminal } from './terminal.js';
import { runCurrentFile } from './runner.js';
import { refreshTree } from './fs.js';

// ── Menu Bar Logic ───────────────────────────────────────────────────────────
let activeMenu = null;

function closeAllMenus() {
  document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
  activeMenu = null;
}

document.querySelectorAll('.menu-item').forEach(item => {
  item.querySelector('.menu-label').addEventListener('click', e => {
    e.stopPropagation();
    if (item.classList.contains('open')) closeAllMenus();
    else {
      closeAllMenus();
      item.classList.add('open');
      activeMenu = item.dataset.menu;
    }
  });
  item.addEventListener('mouseenter', () => {
    if (activeMenu && activeMenu !== item.dataset.menu) {
      closeAllMenus();
      item.classList.add('open');
      activeMenu = item.dataset.menu;
    }
  });
});

document.querySelectorAll('.menu-entry').forEach(e => {
  e.addEventListener('click', ev => {
    ev.stopPropagation();
    closeAllMenus();
    handleMenu(e.dataset.action);
  });
});

window.addEventListener('click', () => { if (activeMenu) closeAllMenus(); });

// ── Dropdown Actions ─────────────────────────────────────────────────────────
function handleMenu(action) {
  switch (action) {
    case 'new-file':          execCmd('new-file'); break;
    case 'new-folder':        execCmd('new-folder'); break;
    case 'open-folder':       openFolder(); break;
    case 'open-file':         openSingleFile(); break;
    case 'save-file':         saveFile(); break;
    case 'refresh-explorer':  refreshTree(); break;

    // CodeMirror Built-in Operations
    case 'undo':              import('@codemirror/commands').then(m => m.undo(view)); break;
    case 'redo':              import('@codemirror/commands').then(m => m.redo(view)); break;
    case 'cut':               document.execCommand('cut'); break;
    case 'copy':              document.execCommand('copy'); break;
    case 'paste':             navigator.clipboard.readText().then(t => view.dispatch(view.state.replaceSelection(t))).catch(()=>{}); break;
    case 'find':              import('@codemirror/search').then(m => m.openSearchPanel(view)); break;
    case 'replace':           import('@codemirror/search').then(m => m.openSearchPanel(view)); break;

    case 'command-palette':   togglePalette(false, 'command'); break;
    case 'keyboard-shortcuts':openKeymapSettings(); break;
    case 'change-live-server-port': execCmd('change-live-server-port'); break;

    case 'toggle-glow':       execCmd('toggle-glow'); break;
    case 'toggle-rgb-glow':   execCmd('toggle-rgb-glow'); break;
    case 'toggle-rgb-text':   execCmd('toggle-rgb-text'); break;
    case 'toggle-zoom':       execCmd('toggle-zoom'); break;

    case 'go-to-file':        togglePalette(false, 'file'); break;
  }
}

// ── Global Keyboard Shortcuts ────────────────────────────────────────────────
let ctrlKPending = false;

window.addEventListener('keydown', async e => {
  const ctrl  = e.ctrlKey;
  const shift = e.shiftKey;
  const alt   = e.altKey;
  const k     = e.key.toLowerCase();

  // Explorer delete handler
  if (e.key === 'Delete' && !ctrl && !shift && !alt) {
    // Only fire if the active element is NOT inside the CodeMirror text surface
    const editorFocused = document.activeElement?.closest('.cm-editor');
    if (!editorFocused && state.selectedPaths.size > 0) {
      e.preventDefault();
      await deleteSelected();
      return;
    }
  }

  // Ctrl combos
  if (ctrl && !shift && !alt && k === 's') { e.preventDefault(); await saveFile(); return; }
  if (ctrl && !shift && !alt && k === 'n') { e.preventDefault(); execCmd('new-file'); return; }
  if (ctrl && !shift && !alt && k === 'w') {
    e.preventDefault();
    if (state.currentFile) closeTab(state.currentFile);
    return;
  }
  if (ctrl && !shift && !alt && k === 'p') { e.preventDefault(); togglePalette(false, 'file'); return; }
  if (ctrl &&  shift && !alt && k === 'p') { e.preventDefault(); togglePalette(false, 'command'); return; }
  if (ctrl && !shift && !alt && k === 'o') { e.preventDefault(); openSingleFile(); return; }

  // Ctrl+K sequences (VS Code style)
  if (ctrl && !shift && !alt && k === 'k') { e.preventDefault(); ctrlKPending = true; return; }
  if (ctrlKPending) {
    if (ctrl && k === 's') { e.preventDefault(); ctrlKPending = false; openKeymapSettings(); return; }
    if (ctrl && k === 'o') { e.preventDefault(); ctrlKPending = false; openFolder(); return; }
    ctrlKPending = false; // Reset if some other key is pressed
  }

  // Alt combos (Effects)
  if (ctrl && alt && k === 'g') { e.preventDefault(); execCmd('toggle-glow'); return; }
  if (ctrl && alt && k === 'r') { e.preventDefault(); execCmd('toggle-rgb-glow'); return; }
  if (ctrl && alt && k === 't') { e.preventDefault(); execCmd('toggle-rgb-text'); return; }
  if (ctrl && alt && k === 'z') { e.preventDefault(); execCmd('toggle-zoom'); return; }

  // Execution
  if (!ctrl && !shift && !alt && k === 'f5') { e.preventDefault(); runCurrentFile(); return; }
  if (ctrl && shift && !alt && k === 'r')    { e.preventDefault(); runCurrentFile(); return; }

  // Toggle Terminal
  if (ctrl && shift && !alt && (e.key === '`' || e.key === '~' || e.code === 'Backquote')) {
    e.preventDefault();
    toggleTerminal();
    return;
  }
});
