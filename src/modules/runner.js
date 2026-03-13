import { invoke } from '@tauri-apps/api/core';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { state, IS_TAURI } from './state.js';
import { saveFile } from './files.js';
import { toggleTerminal, getTerminal } from './terminal.js';
import { getStore } from './store.js';
import { showPrompt } from './dialogs.js';
import { pathBasename, pathDirname } from './utils.js';

// ── Run Current File ─────────────────────────────────────────────────────────
export async function runCurrentFile() {
  if (!state.currentFile) return;
  await saveFile(); // Auto-save

  const ext = state.currentFile.split('.').pop().toLowerCase();

  // HTML runs via Live Server
  if (ext === 'html') {
    startLiveServer(state.currentFile);
    return;
  }

  // CLI scripts run via integrated Terminal
  const panel = document.getElementById('terminal-panel');
  if (panel.style.display === 'none') {
    await toggleTerminal();
  } else {
    const term = getTerminal();
    if (term) term.focus();
  }

  // brief delay so UI has mounted before injecting command
  setTimeout(() => {
    let cmd = '';
    const quoted = `"${state.currentFile}"`;
    if      (ext === 'py') cmd = `python ${quoted}\r`;
    else if (ext === 'js') cmd = `node ${quoted}\r`;
    else if (ext === 'rs') cmd = `cargo run ${quoted} || rustc ${quoted} && .\\${pathBasename(state.currentFile).replace('.rs', '.exe')}\r`;
    else cmd = `echo "Cannot run file type: .${ext}"\r`;

    if (cmd && IS_TAURI) {
      invoke('terminal_input', { input: cmd });
    }
  }, 100);
}

// Attach hook to the play icon
document.getElementById('run-btn')?.addEventListener('click', runCurrentFile);

// ── Live Server ───────────────────────────────────────────────────────────────
export async function startLiveServer(file, silent = false) {
  let defaultPort = await getStore().then(s => s ? s.get('liveServerPort') : null);
  if (!defaultPort) {
    const p = await showPrompt('Live Server', 'Select port for Live Server (e.g. 5500):', '5500');
    if (!p) return null;
    defaultPort = parseInt(p, 10);
    if (isNaN(defaultPort) || defaultPort <= 0) {
      await showPrompt('Error', 'Invalid port. Please specify a number.', '');
      return null;
    }
    const store = await getStore();
    if (store) {
      await store.set('liveServerPort', defaultPort);
      await store.save();
    }
  }

  const serveDir = state.rootDirPath || pathDirname(file);
  try {
    const finalPort = await invoke('start_live_server', {
      port: defaultPort,
      dir: serveDir
    });

    if (finalPort !== defaultPort) {
      console.log(`Live Server: Port ${defaultPort} was in use. Using ${finalPort}.`);
    }

    let relPath = file.substring(serveDir.length).replace(/\\/g, '/');
    if (relPath.startsWith('/')) relPath = relPath.substring(1);

    const url = `http://localhost:${finalPort}/${relPath}`;

    if (!silent) {
      if (IS_TAURI) {
        await openUrl(url);
      } else {
        window.open(url, '_blank');
      }
    }
    return finalPort;
  } catch (err) {
    console.error('Failed to start Live Server:', err);
    await showPrompt('Error', 'Failed to start Live Server: ' + err, '');
    return null;
  }
}
