import { getStore } from './store.js';
import { view } from './editor.js';

const lspOverlay = document.getElementById('lsp-overlay');
const lspSearch = document.getElementById('lsp-search');
const lspBody = document.getElementById('lsp-table-body');
const lspCloseBtn = document.getElementById('lsp-close-btn');

const DEFAULT_LSPS = [
  { id: 'pyright', name: 'Pyright (Python)', isInstalledDefault: true }
];

let lspsState = [];

async function loadLspState() {
  const store = await getStore();
  let savedState = null;
  if (store) {
    savedState = await store.get('lspState');
  }

  // Merge default with saved state
  lspsState = DEFAULT_LSPS.map(def => {
    let saved = (savedState || []).find(s => s.id === def.id);
    if (!saved) {
      return {
        id: def.id,
        name: def.name,
        installed: def.isInstalledDefault,
        enabled: def.isInstalledDefault,
      };
    }
    return saved; // has installed, enabled properties
  });
}

async function saveLspState() {
  const store = await getStore();
  if (store) {
    await store.set('lspState', lspsState);
    await store.save();
  }
}

export async function openLspManager() {
  await loadLspState();
  lspOverlay.classList.add('active');
  lspSearch.value = '';
  renderLspRows();
  setTimeout(() => lspSearch.focus(), 50);
}

export function closeLspManager() {
  lspOverlay.classList.remove('active');
  view.focus();
}

lspCloseBtn?.addEventListener('click', closeLspManager);

lspOverlay?.addEventListener('click', e => {
  if (e.target === lspOverlay) closeLspManager();
});

lspOverlay?.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeLspManager();
  }
});

function renderLspRows(q = '') {
  const s = q.toLowerCase();
  const filtered = lspsState.filter(lsp => lsp.name.toLowerCase().includes(s));

  if (!lspBody) return;
  lspBody.innerHTML = '';
  
  if (!filtered.length) {
    lspBody.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">No language servers found.</div>';
    return;
  }

  filtered.forEach(lsp => {
    const row = document.createElement('div');
    row.className = 'lsp-row';

    let statusHtml = '';
    if (!lsp.installed) {
      statusHtml = '<span class="lsp-status-badge lsp-status-uninstalled">Not Installed</span>';
    } else if (lsp.enabled) {
      statusHtml = '<span class="lsp-status-badge lsp-status-installed">Enabled</span>';
    } else {
      statusHtml = '<span class="lsp-status-badge lsp-status-disabled">Disabled</span>';
    }

    let actionsHtml = '';
    if (!lsp.installed) {
      actionsHtml = `<button class="lsp-btn lsp-btn-primary" data-action="install" data-id="${lsp.id}">Install</button>`;
    } else {
      if (lsp.enabled) {
        actionsHtml += `<button class="lsp-btn" data-action="disable" data-id="${lsp.id}">Disable</button>`;
      } else {
        actionsHtml += `<button class="lsp-btn lsp-btn-primary" data-action="enable" data-id="${lsp.id}">Enable</button>`;
      }
      actionsHtml += `<button class="lsp-btn lsp-btn-danger" data-action="uninstall" data-id="${lsp.id}">Uninstall</button>`;
    }

    row.innerHTML = `
      <span class="lsp-col-name"><i class="fa-solid fa-code"></i> ${lsp.name}</span>
      <span class="lsp-col-status">${statusHtml}</span>
      <span class="lsp-col-actions">${actionsHtml}</span>
    `;

    // Add event listeners for actions
    const btns = row.querySelectorAll('button');
    btns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const targetLsp = lspsState.find(l => l.id === id);
        if (targetLsp) {
          if (action === 'install') { targetLsp.installed = true; targetLsp.enabled = true; }
          else if (action === 'uninstall') { targetLsp.installed = false; targetLsp.enabled = false; }
          else if (action === 'enable') { targetLsp.enabled = true; }
          else if (action === 'disable') { targetLsp.enabled = false; }
          
          await saveLspState();
          renderLspRows(lspSearch.value);
        }
      });
    });

    lspBody.appendChild(row);
  });
}

lspSearch?.addEventListener('input', e => renderLspRows(e.target.value));
