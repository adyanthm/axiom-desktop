import { state, IS_TAURI } from './state.js';
import { getRecentProjects, removeRecentProject } from './store.js';

// ── Welcome Screen ────────────────────────────────────────────────────────────
export async function showWelcome(show) {
  const welcome = document.getElementById('editor-welcome');
  const wrap    = document.getElementById('editor-wrap');
  const bc      = document.getElementById('editor-breadcrumb');
  const header  = document.querySelector('.editor-header');

  if (show) {
    welcome.style.display = 'flex';
    wrap.style.display    = 'none';
    if (bc)     bc.style.display     = 'none';
    if (header) header.style.display = 'none';

    if (!state.rootDirPath) {
      await renderWelcomeScreen();
    } else {
      welcome.innerHTML = `
        <img src="/logo.png" alt="Axiom Logo" 
             style="width:80px;height:80px;opacity:0.2;margin-bottom:15px;object-fit:contain;pointer-events:none;filter:grayscale(1);" />
        <p id="welcome-message">Select a file to start editing</p>`;
    }
  } else {
    welcome.style.display = 'none';
    wrap.style.display    = 'flex';
    if (bc)     bc.style.display     = 'flex';
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
      <img src="/logo.png" class="welcome-logo" alt="Logo"
           style="width:80px;height:80px;margin-bottom:20px;object-fit:contain;pointer-events:none;" />
      <h1 class="welcome-title">Axiom Editor</h1>
      <p class="welcome-subtitle">Blazing fast code editor with multi language support, and all other neccessary things</p>
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

  welcome.querySelector('#welcome-open-folder')?.addEventListener('click', () => {
    import('./fs.js').then(m => m.openFolder());
  });
  welcome.querySelector('#welcome-open-file')?.addEventListener('click', () => {
    import('./files.js').then(m => m.openSingleFile());
  });
  welcome.querySelectorAll('.recent-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.recent-remove')) return;
      import('./fs.js').then(m => m.openFolder(el.dataset.path));
    });
  });
  welcome.querySelectorAll('.recent-remove').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await removeRecentProject(btn.dataset.path);
      await renderWelcomeScreen();
    });
  });
}
