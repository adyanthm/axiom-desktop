import { state } from './state.js';
import { pathBasename } from './utils.js';
import { getFileIcon } from './icons.js';
import { view } from './editor.js';
import { THEMES, previewTheme, applyTheme, cancelPreview, getActiveThemeId } from './themes.js';
import { stateFeatures, toggleAutoClose, toggleIndentGuides } from './features.js';

const commandOverlay = document.getElementById('command-palette-overlay');
const commandInput   = document.getElementById('command-input');
const paletteList    = document.getElementById('palette-list');

const commands = [
  { id: 'toggle-terminal',         label: 'View: Toggle Terminal' },
  { id: 'toggle-zoom',             label: 'Preferences: Toggle 300% Zoom Tracking' },
  { id: 'toggle-rgb-text',         label: 'Preferences: Toggle RGB Text Effect' },
  { id: 'toggle-glow',             label: 'Preferences: Toggle Neon Glow Effect' },
  { id: 'toggle-rgb-glow',         label: 'Preferences: Toggle RGB Moving Glow Effect' },
  { id: 'change-theme',            label: 'Preferences: Color Theme' },
  { id: 'change-features',         label: 'Preferences: Toggle Editor Features' },
  { id: 'open-keybindings',        label: 'Preferences: Open Keyboard Shortcuts' },
  { id: 'change-live-server-port', label: 'Live Server: Change Port' },
  { id: 'open-folder',             label: 'File: Open Folder...' },
  { id: 'open-file',               label: 'File: Open File...' },
  { id: 'new-file',                label: 'File: New File' },
  { id: 'new-folder',              label: 'File: New Folder' },
  { id: 'save-file',               label: 'File: Save' },
  { id: 'global-search',           label: 'File: Global Search' },
  
  // ── View / Scale Commands ──
  { id: 'editor-zoom-in',          label: 'View: Zoom In (Editor Font)' },
  { id: 'editor-zoom-out',         label: 'View: Zoom Out (Editor Font)' },
  { id: 'editor-zoom-reset',       label: 'View: Reset Zoom (Editor Font)' },
  { id: 'ui-scale-in',             label: 'View: Scale Up UI' },
  { id: 'ui-scale-out',            label: 'View: Scale Down UI' },
  { id: 'ui-scale-reset',          label: 'View: Reset UI Scale' },
];

let filteredCmds = [];
let selIdx = 0;
let paletteFileCache = null;
let _themePickerMode = false;  // true when palette is in theme-picker mode
let _featurePickerMode = false; // true when palette is in feature-picker mode

// ── Palette UI Toggles ────────────────────────────────────────────────────────
export function togglePalette(forceClose = false, mode = 'command') {
  if (forceClose || commandOverlay.classList.contains('active')) {
    // If we were previewing a theme and didn't commit, revert
    if (_themePickerMode) { cancelPreview(); _themePickerMode = false; }
    commandOverlay.classList.remove('active');
    view.focus();
    paletteFileCache = null;
  } else {
    commandOverlay.classList.add('active');
    paletteFileCache = null;
    _themePickerMode = mode === 'theme';
    _featurePickerMode = mode === 'features';
    if (mode === 'theme') {
      commandInput.value = '';
      commandInput.placeholder = 'Select a color theme (type to filter)...';
      _renderThemePicker('');
    } else if (mode === 'features') {
      commandInput.value = '';
      commandInput.placeholder = 'Toggle features...';
      _renderFeaturePicker('');
    } else {
      commandInput.value = mode === 'command' ? '>' : '';
      commandInput.placeholder = 'Type a command...';
      renderPalette(commandInput.value);
    }
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
        ? cmd.sublabel.split(/[\\/]/).slice(0, -1).join('/')
        : '';
      el.innerHTML = `${getFileIcon(cmd.label)}<span style="margin-left:8px">${cmd.label}</span>` +
                     (dirPart ? `<span class="palette-path">${dirPart}</span>` : '');
    } else if (cmd.isTheme) {
      const active = cmd.id === 'apply-theme:' + getActiveThemeId();
      el.innerHTML =
        `<span class="theme-swatch" style="background:${cmd.swatch};"></span>` +
        `<span class="theme-item-label">${cmd.label}</span>` +
        (active ? `<i class="fa-solid fa-check theme-item-check"></i>` : '');
    } else if (cmd.isFeature) {
      el.innerHTML =
        `<span class="theme-item-label">${cmd.label}</span>` +
        `<i class="fa-solid fa-toggle-${cmd.active ? 'on' : 'off'} theme-item-check" style="color:var(--${cmd.active ? 'accent-color' : 'text-muted'})"></i>`;
    } else {
      el.innerHTML = cmd.label;
    }

    el.onclick = () => execCmd(cmd.id);
    el.addEventListener('mouseenter', () => {
      document.querySelectorAll('.palette-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      selIdx = i;
      // Live-preview theme on hover
      if (cmd.isTheme) previewTheme(cmd.themeId);
    });

    paletteList.appendChild(el);
  });
}

// ── Theme Picker Rendering ────────────────────────────────────────────────────
function _renderThemePicker(q) {
  const s = q.toLowerCase();
  filteredCmds = THEMES
    .filter(t => t.label.toLowerCase().includes(s))
    .map(t => ({
      id: 'apply-theme:' + t.id,
      label: t.label,
      isTheme: true,
      swatch: t.ui['--bg-main'],
      themeId: t.id,
    }));
  _paintList();
  // Preview first item immediately
  if (filteredCmds.length > 0) previewTheme(filteredCmds[0].themeId);
}

// ── Feature Picker Rendering ──────────────────────────────────────────────────
function _renderFeaturePicker(q) {
  const s = q.toLowerCase();
  const list = [
    { id: 'toggle-feat-autoclose', label: 'Feature: Auto Close Brackets & Quotes', active: stateFeatures.autoClose, isFeature: true },
    { id: 'toggle-feat-indent', label: 'Feature: Indent Guides (Lines under functions)', active: stateFeatures.indentGuides, isFeature: true }
  ];
  filteredCmds = list.filter(f => f.label.toLowerCase().includes(s));
  _paintList();
}

// ── Execution Router ──────────────────────────────────────────────────────────
export async function execCmd(id) {
  if (!id.startsWith('apply-theme:') && !id.startsWith('toggle-feat-')) {
    togglePalette(true);
  }

  if (id === 'change-features') { togglePalette(false, 'features'); return; }

  if (id === 'toggle-feat-autoclose') {
    await toggleAutoClose();
    _renderFeaturePicker(commandInput.value);
    return;
  }
  if (id === 'toggle-feat-indent') {
    await toggleIndentGuides();
    _renderFeaturePicker(commandInput.value);
    return;
  }

  if (id.startsWith('open-file:')) {
    import('./files.js').then(m => m.openFile(id.slice(10)));
    return;
  }

  if (id.startsWith('apply-theme:')) {
    const themeId = id.slice(12);
    _themePickerMode = false;
    commandOverlay.classList.remove('active');
    view.focus();
    await applyTheme(themeId);
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
    case 'global-search':   import('./search.js').then(m => m.openGlobalSearch()); break;
    
    // Effects
    case 'toggle-glow':     import('./effects.js').then(m => m.toggleGlow()); break;
    case 'toggle-rgb-glow': import('./effects.js').then(m => m.toggleRgbGlow()); break;
    case 'toggle-rgb-text': import('./effects.js').then(m => m.toggleRgbText()); break;
    case 'toggle-zoom':     import('./effects.js').then(m => m.toggleZoom()); break;
    case 'change-theme':    togglePalette(false, 'theme'); break;

    // Zoom & Scale
    case 'editor-zoom-in':    import('./zoom.js').then(m => m.zoomIn()); break;
    case 'editor-zoom-out':   import('./zoom.js').then(m => m.zoomOut()); break;
    case 'editor-zoom-reset': import('./zoom.js').then(m => m.zoomReset()); break;
    case 'ui-scale-in':       import('./zoom.js').then(m => m.uiZoomIn()); break;
    case 'ui-scale-out':      import('./zoom.js').then(m => m.uiZoomOut()); break;
    case 'ui-scale-reset':    import('./zoom.js').then(m => m.uiZoomReset()); break;

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
  if (_themePickerMode) {
    _renderThemePicker(e.target.value);
  } else if (paletteFileCache || e.target.value.startsWith('>')) {
      renderPalette(e.target.value);
  } else {
     // Trigger load of cache via renderPalette on first keystroke
     renderPalette(e.target.value);
  }
});

commandInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (_themePickerMode) cancelPreview();
    togglePalette(true);
  }
  else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selIdx < filteredCmds.length - 1) {
      selIdx++;
      const items = document.querySelectorAll('.palette-item');
      items.forEach((el, i) => el.classList.toggle('active', i === selIdx));
      items[selIdx]?.scrollIntoView({ block: 'nearest' });
      // Live-preview on arrow navigation in theme mode
      if (_themePickerMode && filteredCmds[selIdx]?.isTheme) {
        previewTheme(filteredCmds[selIdx].themeId);
      }
    }
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selIdx > 0) {
      selIdx--;
      const items = document.querySelectorAll('.palette-item');
      items.forEach((el, i) => el.classList.toggle('active', i === selIdx));
      items[selIdx]?.scrollIntoView({ block: 'nearest' });
      // Live-preview on arrow navigation in theme mode
      if (_themePickerMode && filteredCmds[selIdx]?.isTheme) {
        previewTheme(filteredCmds[selIdx].themeId);
      }
    }
  }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredCmds[selIdx]) execCmd(filteredCmds[selIdx].id);
  }
});

commandOverlay.addEventListener('click', e => {
  if (e.target === commandOverlay) {
    if (_themePickerMode) cancelPreview();
    togglePalette(true);
  }
});
