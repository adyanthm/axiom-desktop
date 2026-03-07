import { view } from './editor.js';

// ── Keymap Config ────────────────────────────────────────────────────────────
export const keybindings = [
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
  { id: 'workbench.save',            command: 'Save',                       keys: 'Ctrl+S',          source: 'Default' },
  { id: 'workbench.openFolder',      command: 'Open Folder',                keys: 'Ctrl+K Ctrl+O',   source: 'Default' },
  { id: 'workbench.openFile',        command: 'Open File',                  keys: 'Ctrl+O',          source: 'Default' },
  { id: 'workbench.nextTab',         command: 'Next File Tab',              keys: 'Ctrl+Tab',        source: 'Default' },
  { id: 'workbench.prevTab',         command: 'Previous File Tab',          keys: 'Ctrl+Shift+Tab',  source: 'Default' },
  { id: 'preferences.glow',          command: 'Toggle Neon Glow',           keys: 'Ctrl+Alt+G',      source: 'Default' },
  { id: 'preferences.rgbGlow',       command: 'Toggle RGB Glow',            keys: 'Ctrl+Alt+R',      source: 'Default' },
  { id: 'preferences.rgbText',       command: 'Toggle RGB Text',            keys: 'Ctrl+Alt+T',      source: 'Default' },
  { id: 'preferences.zoom',          command: 'Toggle 300% Zoom',           keys: 'Ctrl+Alt+Z',      source: 'Default' },
  { id: 'view.zoomIn',               command: 'Zoom In (Editor)',           keys: 'Ctrl+=',          source: 'Default' },
  { id: 'view.zoomOut',              command: 'Zoom Out (Editor)',          keys: 'Ctrl+-',          source: 'Default' },
  { id: 'view.zoomReset',            command: 'Reset Zoom (Editor)',        keys: 'Ctrl+0',          source: 'Default' },
  { id: 'view.uiZoomIn',             command: 'Scale Up UI',                keys: 'Ctrl+Shift+=',    source: 'Default' },
  { id: 'view.uiZoomOut',            command: 'Scale Down UI',              keys: 'Ctrl+Shift+-',    source: 'Default' },
  { id: 'view.uiZoomReset',          command: 'Reset UI Scale',             keys: 'Ctrl+Shift+0',    source: 'Default' },
  { id: 'liveserver.changePort',     command: 'Change Live Server Port',    keys: '',                source: 'Default' },
];

const keymapOverlay = document.getElementById('keymap-overlay');
const keymapSearch  = document.getElementById('keymap-search');
const keymapBody    = document.getElementById('keymap-table-body');
let editRowId = null;

// ── Keyboard UI Toggles ───────────────────────────────────────────────────────
export function openKeymapSettings() {
  keymapOverlay.classList.add('active');
  keymapSearch.value = '';
  editRowId = null;
  renderKeymapRows();
  setTimeout(() => keymapSearch.focus(), 50);
}

export function closeKeymapSettings() {
  keymapOverlay.classList.remove('active');
  editRowId = null;
  view.focus();
}

document.getElementById('keymap-close-btn').addEventListener('click', closeKeymapSettings);

keymapOverlay.addEventListener('click', e => {
  if (e.target === keymapOverlay) closeKeymapSettings();
});

keymapOverlay.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !editRowId) {
    e.preventDefault();
    closeKeymapSettings();
  }
});

// ── Rendering & Input Binding ─────────────────────────────────────────────────
function fmtKeys(keys) {
  if (!keys) return '<span style="color:var(--text-muted);font-style:italic;font-size:11px">—</span>';
  return keys.split(' ').map((chord, i) => {
    const badges = chord.split('+').map(k => `<span class="kbd-badge">${k}</span>`).join('<span class="kbd-sep">+</span>');
    return (i > 0 ? '<span class="kbd-sep" style="margin:0 4px"> </span>' : '') + badges;
  }).join('');
}

function renderKeymapRows(q = '') {
  const s = q.toLowerCase();
  const filtered = keybindings.filter(kb =>
    kb.command.toLowerCase().includes(s) ||
    kb.keys.toLowerCase().includes(s)    ||
    kb.id.toLowerCase().includes(s)
  );

  keymapBody.innerHTML = '';
  if (!filtered.length) {
    keymapBody.innerHTML = '<div class="keymap-no-results">No keybindings found.</div>';
    return;
  }

  filtered.forEach(kb => {
    const row = document.createElement('div');
    row.className  = 'keymap-row' + (editRowId === kb.id ? ' keymap-row-editing' : '');
    row.dataset.id = kb.id;

    if (editRowId === kb.id) {
      row.innerHTML =
        `<span class="keymap-col-command">${kb.command}</span>` +
        `<span class="keymap-col-keybinding"><input type="text" class="keymap-edit-input" id="keymap-edit-active" placeholder="Press key combo..." readonly/></span>` +
        `<span class="keymap-col-source">${kb.source}</span>`;
    } else {
      row.innerHTML =
        `<span class="keymap-col-command">${kb.command}</span>` +
        `<span class="keymap-col-keybinding"><button class="keymap-edit-btn" title="Edit"><i class="fa-solid fa-pencil"></i></button>${fmtKeys(kb.keys)}</span>` +
        `<span class="keymap-col-source">${kb.source}</span>`;
    }
    keymapBody.appendChild(row);

    if (editRowId === kb.id) {
      const inp = row.querySelector('#keymap-edit-active');
      setTimeout(() => inp.focus(), 30);
      inp.addEventListener('keydown', e => {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') {
          editRowId = null;
          renderKeymapRows(keymapSearch.value);
          return;
        }

        const parts = [
          ...(e.ctrlKey  ? ['Ctrl']  : []),
          ...(e.shiftKey ? ['Shift'] : []),
          ...(e.altKey   ? ['Alt']   : []),
          ...(e.metaKey  ? ['Meta']  : [])
        ];

        if (!['Control','Shift','Alt','Meta'].includes(e.key)) {
          let dk = e.key.length === 1 ? e.key.toUpperCase() : e.key;
          if (e.key === 'ArrowUp')    dk = 'Up';
          if (e.key === 'ArrowDown')  dk = 'Down';
          if (e.key === 'ArrowLeft')  dk = 'Left';
          if (e.key === 'ArrowRight') dk = 'Right';
          if (e.key === ' ')          dk = 'Space';

          parts.push(dk);
          kb.keys   = parts.join('+');
          kb.source = 'User';
          editRowId = null;
          renderKeymapRows(keymapSearch.value);
        } else {
          inp.value = parts.join('+') + '+...';
        }
      });
    } else {
      row.querySelector('.keymap-edit-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        editRowId = kb.id;
        renderKeymapRows(keymapSearch.value);
      });
      row.addEventListener('dblclick', () => {
        editRowId = kb.id;
        renderKeymapRows(keymapSearch.value);
      });
    }
  });
}

keymapSearch.addEventListener('input', e => renderKeymapRows(e.target.value));
