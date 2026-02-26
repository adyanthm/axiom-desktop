import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { invoke }   from '@tauri-apps/api/core';
import { listen }   from '@tauri-apps/api/event';
import { state, IS_TAURI } from './state.js';
import { view }     from './editor.js';

let term = null;
let fitAddon = null;
let unlistenOutput = null;

// ── Shared Terminal Export ──────────────────────────────────────────────────
export function getTerminal() {
  return term;
}

export async function toggleTerminal() {
  const panel   = document.getElementById('terminal-panel');
  const resizer = document.getElementById('terminal-resizer');

  if (panel.style.display === 'none') {
    panel.style.display   = 'flex';
    resizer.style.display = 'block';

    if (!term) {
      term = new Terminal({
        theme: {
          background: getComputedStyle(document.body).getPropertyValue('--bg-color').trim() || '#1e1e1e',
          foreground: '#cccccc',
          cursor:     '#ffffff'
        },
        fontFamily: 'monospace',
        fontSize:   14,
        cursorBlink: true
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal-body'));

      setTimeout(() => fitAddon.fit(), 30);

      term.onData(data => {
        if (IS_TAURI) invoke('terminal_input', { input: data });
      });
      term.onResize(size => {
        if (IS_TAURI) invoke('resize_terminal', { rows: size.rows, cols: size.cols });
      });

      if (IS_TAURI) {
        unlistenOutput = await listen('terminal-output', event => {
          term.write(event.payload);
        });
        await invoke('start_terminal', { cwd: state.rootDirPath || null }).catch(err => {
          console.error("Terminal start failed:", err);
          term.write(`\x1b[31mFailed to start terminal: ${err}\x1b[0m\r\n`);
        });
      }

      // Drag to resize height
      let isDragging = false;
      resizer.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
      });
      document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        const totalHeight = document.getElementById('editor-area').clientHeight;
        const newTerminalHeight = document.getElementById('editor-area').getBoundingClientRect().bottom - e.clientY;
        if (newTerminalHeight > 100 && newTerminalHeight < totalHeight - 100) {
          panel.style.height = newTerminalHeight + 'px';
          fitAddon.fit();
        }
      });
      document.addEventListener('mouseup', () => isDragging = false);

      window.addEventListener('resize', () => {
        if (panel.style.display !== 'none') fitAddon.fit();
      });

      document.getElementById('action-close-terminal').addEventListener('click', () => {
        panel.style.display   = 'none';
        resizer.style.display = 'none';
        view.focus();
      });
    } else {
      setTimeout(() => fitAddon.fit(), 30);
    }

    setTimeout(() => term.focus(), 50);
  } else {
    panel.style.display   = 'none';
    resizer.style.display = 'none';
    view.focus();
  }
}
