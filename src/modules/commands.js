import { state } from './state.js';
import { pathBasename } from './utils.js';
import { getFileIcon } from './icons.js';
import { view } from './editor.js';

const commandOverlay = document.getElementById('command-palette-overlay');
const commandInput   = document.getElementById('command-input');
const paletteList    = document.getElementById('palette-list');

const commands = [
  { id: 'toggle-terminal',         label: 'View: Toggle Terminal' },
  { id: 'toggle-zoom',             label: 'Preferences: Toggle 300% Zoom Tracking' },
  { id: 'toggle-rgb-text',         label: 'Preferences: Toggle RGB Text Effect' },
  { id: 'toggle-glow',             label: 'Preferences: Toggle Neon Glow Effect' },
  { id: 'toggle-rgb-glow',         label: 'Preferences: Toggle RGB Moving Glow Effect' },
  { id: 'open-keybindings',        label: 'Preferences: Open Keyboard Shortcuts' },
  { id: 'change-live-server-port', label: 'Live Server: Change Port' },
  { id: 'open-folder',             label: 'File: Open Folder...' },
  { id: 'open-file',               label: 'File: Open File...' },
  { id: 'new-file',                label: 'File: New File' },
  { id: 'new-folder',              label: 'File: New Folder' },
  { id: 'save-file',               label: 'File: Save' }
];

let filteredCmds = [];
let selIdx = 0;
let paletteFileCache = null;

// ── Palette UI Toggles ────────────────────────────────────────────────────────
export function togglePalette(forceClose = false, mode = 'command') {
  if (forceClose || commandOverlay.classList.contains('active')) {
    commandOverlay.classList.remove('active');
    view.focus();
    paletteFileCache = null;
  } else {
    commandOverlay.classList.add('active');
    paletteFileCache = null;
    commandInput.value = mode === 'command' ? '>' : '';
    renderPalette(commandInput.value);
    setTimeout(() => commandInput.focus(), 50);
  }
}

// ── Rendering & Filtering ─────────────────────────────────────────────────────
function getRelativePath(fullPath) {
  if (state.rootDirPath && fullPath.startsWith(state.rootDirPath)) {
    return fullPath.substring(state.rootDirPath.length).replace(/^[\\\/]/, '');
  }
  return fullPath;
}

function renderPalette(q) {
  if (q.startsWith('>')) {
    // Command Mode
    const s = q.slice(1).trim().toLowerCase();
    filteredCmds = commands.filter(c => c.label.toLowerCase().includes(s));
    _paintList();
  } else {
    // Go-to-File Mode
    const s = q.toLowerCase();
    if (!paletteFileCache) {
      import('./fs.js').then(m => {
        const allFiles = state.fileTree ? m.getAllFilePaths(state.fileTree.children) : [];
        paletteFileCache = allFiles.map(f => ({
          full: f, rel: getRelativePath(f), base: pathBasename(f)
        }));
        _renderFuzzyFiles(s);
      });
      return;
    }
    _renderFuzzyFiles(s);
  }
}

function _renderFuzzyFiles(s) {
  filteredCmds = paletteFileCache
    .filter(f => f.base.toLowerCase().includes(s) || f.rel.toLowerCase().includes(s))
    .slice(0, 100)
    .map(f => ({ id: 'open-file:' + f.full, label: f.base, sublabel: f.rel, isFile: true }));

  _paintList();
}

function _paintList() {
  selIdx = 0;
  paletteList.innerHTML = '';
  filteredCmds.forEach((cmd, i) => {
    const el = document.createElement('div');
    el.className = 'palette-item' + (i === 0 ? ' active' : '');

    if (cmd.isFile) {
      const dirPart = cmd.sublabel.includes('/') || cmd.sublabel.includes('\\')
        ? cmd.sublabel.split(/[\\\/]/).slice(0, -1).join('/')
        : '';
      el.innerHTML = `${getFileIcon(cmd.label)}<span style="margin-left:8px">${cmd.label}</span>` +
                     (dirPart ? `<span class="palette-path">${dirPart}</span>` : '');
    } else {
      el.innerHTML = cmd.label;
    }

    el.onclick = () => execCmd(cmd.id);
    el.addEventListener('mouseenter', () => {
      document.querySelectorAll('.palette-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      selIdx = i;
    });

    paletteList.appendChild(el);
  });
}

// ── Execution Router ──────────────────────────────────────────────────────────
export async function execCmd(id) {
  togglePalette(true);

  if (id.startsWith('open-file:')) {
    import('./files.js').then(m => m.openFile(id.slice(10)));
    return;
  }

  switch (id) {
    case 'open-folder':     import('./fs.js').then(m => m.openFolder()); break;
    case 'open-file':       import('./files.js').then(m => m.openSingleFile()); break;
    case 'new-file':
      if (!state.rootDirPath) { alert('Please open a folder first.'); return; }
      import('./fs.js').then(m => m.startInlineCreate(state.currentFile ? pathDirname(state.currentFile) : state.rootDirPath, 'file'));
      break;
    case 'new-folder':
      if (!state.rootDirPath) { alert('Please open a folder first.'); return; }
      import('./fs.js').then(m => m.startInlineCreate(state.currentFile ? pathDirname(state.currentFile) : state.rootDirPath, 'directory'));
      break;
    case 'save-file':       import('./files.js').then(m => m.saveFile()); break;
    
    // Effects
    case 'toggle-glow':     import('./effects.js').then(m => m.toggleGlow()); break;
    case 'toggle-rgb-glow': import('./effects.js').then(m => m.toggleRgbGlow()); break;
    case 'toggle-rgb-text': import('./effects.js').then(m => m.toggleRgbText()); break;
    case 'toggle-zoom':     import('./effects.js').then(m => m.toggleZoom()); break;

    case 'open-keybindings': import('./keymap.js').then(m => m.openKeymapSettings()); break;
    case 'toggle-terminal':  import('./terminal.js').then(m => m.toggleTerminal()); break;

    case 'change-live-server-port':
      import('./store.js').then(async storeMod => {
        const store = await storeMod.getStore();
        let defaultPort = store ? await store.get('liveServerPort') : '5500';
        import('./dialogs.js').then(async dialogm => {
          let port = await dialogm.showPrompt('Live Server', 'Enter new Live Server port:', defaultPort || '5500');
          if (port && !isNaN(parseInt(port, 10))) {
            if (store) {
              await store.set('liveServerPort', parseInt(port, 10));
              await store.save();
            }
          }
        });
      });
      break;
  }
}

// ── Keybindings for Palette Input ─────────────────────────────────────────────
commandInput.addEventListener('input', e => {
  if (paletteFileCache || e.target.value.startsWith('>')) {
      renderPalette(e.target.value);
  } else {
     // Trigger load of cache via renderPalette on first keystroke
     renderPalette(e.target.value);
  }
});

commandInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    togglePalette(true);
  }
  else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selIdx < filteredCmds.length - 1) {
      selIdx++;
      const items = document.querySelectorAll('.palette-item');
      items.forEach((el, i) => el.classList.toggle('active', i === selIdx));
      items[selIdx]?.scrollIntoView({ block: 'nearest' });
    }
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selIdx > 0) {
      selIdx--;
      const items = document.querySelectorAll('.palette-item');
      items.forEach((el, i) => el.classList.toggle('active', i === selIdx));
      items[selIdx]?.scrollIntoView({ block: 'nearest' });
    }
  }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredCmds[selIdx]) execCmd(filteredCmds[selIdx].id);
  }
});

commandOverlay.addEventListener('click', e => {
  if (e.target === commandOverlay) togglePalette(true);
});
