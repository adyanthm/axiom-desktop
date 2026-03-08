import { invoke } from '@tauri-apps/api/core';
import { state } from './state.js';
import { view } from './editor.js';
import { getBreakpointsForFile, highlightDebugLine } from './breakpoints.js';

let debugSocket = null;
let seqCounter = 1;
const pendingRequests = new Map();
let isRunning = false; // true while a debug session is live

// ── Panel Elements ──────────────────────────────────────────────────────────
const debugPanel    = document.getElementById('debug-panel');
const consoleEl     = document.getElementById('debug-console-output');
const varsEl        = document.getElementById('debug-variables-list');
const stackEl       = document.getElementById('debug-callstack-list');

// ── Session State Badge ─────────────────────────────────────────────────────
// Inject a small status badge into the tab bar
const statusBadge = document.createElement('span');
statusBadge.id = 'debug-session-badge';
statusBadge.style.cssText = `
  font-size:10px; font-family: inherit; padding: 1px 8px; border-radius: 10px;
  margin-left: 8px; font-weight: 600; letter-spacing: 0.3px;
  background: rgba(97,175,239,0.15); color: #61AFEF; display: none;`;
document.getElementById('debug-panel-tabs')?.insertBefore(
  statusBadge,
  document.querySelector('.debug-tabs-spacer')
);

function setStatus(label, color) {
  statusBadge.textContent = label;
  statusBadge.style.display = label ? 'inline-flex' : 'none';
  statusBadge.style.color = color || '#61AFEF';
  statusBadge.style.background = (color || '#61AFEF').replace(')', ', 0.12)').replace('rgb', 'rgba').replace('#', 'rgba(') || 'rgba(97,175,239,0.12)';
  // Simple preset colours
  const presets = {
    'RUNNING':  { bg: 'rgba(152,195,121,0.12)', fg: '#98C379' },
    'PAUSED':   { bg: 'rgba(229,192,123,0.15)', fg: '#E5C07B' },
    'STOPPED':  { bg: 'rgba(171,178,191,0.1)',  fg: '#7c8592' },
    'ERROR':    { bg: 'rgba(224,108,117,0.12)', fg: '#E06C75' },
  };
  if (presets[label]) {
    statusBadge.style.background = presets[label].bg;
    statusBadge.style.color      = presets[label].fg;
  }
}

// ── Show / Hide ─────────────────────────────────────────────────────────────
function showPanel() {
  debugPanel?.classList.remove('hidden');
}

export function hidePanel() {
  // Clean up any live highlighting when user manually closes
  if (isRunning) {
    highlightDebugLine(view, -1);
  }
  debugPanel?.classList.add('hidden');
}

// ── Tab Switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.debug-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.debug-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.debug-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`debug-tab-${btn.dataset.tab}`)?.classList.add('active');
  });
});

// ── Resizable Panel (drag top edge) ─────────────────────────────────────────
(function initResize() {
  let dragging = false, startY = 0, startH = 0;
  debugPanel?.addEventListener('mousedown', e => {
    const rect = debugPanel.getBoundingClientRect();
    if (e.clientY < rect.top + 5) {
      dragging = true; startY = e.clientY; startH = debugPanel.offsetHeight;
      e.preventDefault();
    }
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const newH = Math.max(120, Math.min(window.innerHeight * 0.6, startH + (startY - e.clientY)));
    debugPanel.style.height = newH + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
})();

// ── Console Helpers ───────────────────────────────────────────────────────────
// Strip ANSI escape codes so raw text renders cleanly
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[mGKHF]/g, '');
}

function consolePrint(raw, type = 'out') {
  if (!consoleEl) return;
  const text = stripAnsi(raw);
  if (!text) return;
  const span = document.createElement('span');
  span.className = type === 'err' ? 'debug-console-line-err'
                 : type === 'info' ? 'debug-console-line-info'
                 : 'debug-console-line-out';
  span.textContent = text;
  consoleEl.appendChild(span);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function consoleClear() {
  if (consoleEl) consoleEl.innerHTML = '';
}

// ── Variables Renderer (with inline editing) ─────────────────────────────────
let currentVarsRef = 0; // variablesReference of the current locals scope

function renderVariables(vars, hint) {
  if (!varsEl) return;
  if (hint !== undefined) {
    varsEl.innerHTML = `<span class="debug-empty-hint">${hint}</span>`;
    return;
  }
  varsEl.innerHTML = `
    <div class="debug-var-header">
      <span>Name</span><span>Type</span>
      <span>Value <span class="debug-edit-hint" title="Double-click a value to modify">✎ editable</span></span>
    </div>`;
  if (!vars || vars.length === 0) {
    varsEl.innerHTML += `<span class="debug-empty-hint">No local variables in this scope.</span>`;
    return;
  }
  // Filter out dunder items
  const visible = vars.filter(v => !v.name.startsWith('__') || v.name === '__name__');
  visible.forEach(v => {
    const row = document.createElement('div');
    row.className = 'debug-var-row';
    const safeVal = String(v.value).replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const nameEl  = document.createElement('span');
    nameEl.className = 'debug-var-name';
    nameEl.title = v.name;
    nameEl.textContent = v.name;

    const typeEl  = document.createElement('span');
    typeEl.className = 'debug-var-type';
    typeEl.textContent = v.type || '';

    const valEl   = document.createElement('span');
    valEl.className = 'debug-var-value editable-value';
    valEl.title = 'Double-click to edit';
    valEl.innerHTML = safeVal;

    // ── Inline edit on double-click ──────────────────────────────────────────
    valEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      if (valEl.querySelector('input')) return; // already editing

      const originalText = v.value;
      const input = document.createElement('input');
      input.className = 'debug-var-input';
      input.value = originalText;
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;

      valEl.innerHTML = '';
      valEl.appendChild(input);
      valEl.classList.add('editing');
      input.focus();
      input.select();

      const commit = async () => {
        const newVal = input.value.trim();
        valEl.classList.remove('editing');

        if (newVal === originalText) {
          // No change — just restore
          valEl.innerHTML = safeVal;
          return;
        }

        // Show spinner while waiting
        valEl.innerHTML = `<span class="debug-var-setting">setting…</span>`;

        try {
          await sendDapRequest('setVariable', {
            variablesReference: currentVarsRef,
            name: v.name,
            value: newVal,
          });
          // Re-fetch and re-render
          const fresh = await sendDapRequest('variables', { variablesReference: currentVarsRef });
          renderVariables(fresh?.variables || []);
        } catch (err) {
          // Show error inline, restore after 2s
          valEl.innerHTML = `<span class="debug-var-error" title="${err}">⚠ error</span>`;
          setTimeout(() => { valEl.innerHTML = safeVal; }, 2000);
        }
      };

      const cancel = () => {
        valEl.classList.remove('editing');
        valEl.innerHTML = safeVal;
      };

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      });
      input.addEventListener('blur', () => setTimeout(cancel, 150));
    });

    row.appendChild(nameEl);
    row.appendChild(typeEl);
    row.appendChild(valEl);
    varsEl.appendChild(row);
  });
}

// ── Call Stack Renderer ───────────────────────────────────────────────────────
function renderCallStack(frames, hint) {
  if (!stackEl) return;
  if (hint !== undefined) {
    stackEl.innerHTML = `<span class="debug-empty-hint">${hint}</span>`;
    return;
  }
  stackEl.innerHTML = '';
  (frames || []).forEach((frame, i) => {
    const row = document.createElement('div');
    row.className = `debug-frame-row${i === 0 ? ' active' : ''}`;
    const src = frame.source?.name || '';
    const loc = src ? `${src}:${frame.line}` : `Line ${frame.line}`;
    row.innerHTML = `
      <span class="debug-frame-name">${frame.name}</span>
      <span class="debug-frame-location">${loc}</span>`;
    stackEl.appendChild(row);
  });
}

// ── Finish Summary (PyCharm-style) ───────────────────────────────────────────
function showFinishedState(exitedWithError) {
  isRunning = false;
  highlightDebugLine(view, -1);
  setStatus('STOPPED');

  // Console gets a clear summary footer
  consolePrint('\n─────────────────────────────────\n', 'info');
  consolePrint(exitedWithError
    ? 'Process finished with a non-zero exit code.\n'
    : 'Process finished successfully.\n', 'info');
  // Switch to console tab so user sees output
  document.querySelector('.debug-tab[data-tab="console"]')?.click();

  // Variables & Call Stack show idle placeholders  
  renderVariables(null, 'Session ended. Start a new debug session to inspect variables.');
  renderCallStack(null, 'No active frames. The process has exited.');
}

// ── On Pause: Fetch Full Debug State ─────────────────────────────────────────
async function onPaused(threadId) {
  setStatus('PAUSED');
  // Switch to variables tab automatically
  document.querySelector('.debug-tab[data-tab="variables"]')?.click();

  try {
    const res = await sendDapRequest('stackTrace', { threadId });
    const frames = res?.stackFrames || [];
    renderCallStack(frames);

    if (frames.length > 0) {
      const top = frames[0];
      highlightDebugLine(view, top.line);
      const { EditorView } = await import('@codemirror/view');
      if (view.state.doc.lines >= top.line) {
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.doc.line(top.line).from, { y: 'center' })
        });
      }

      // Fetch local variables
      const scopeRes = await sendDapRequest('scopes', { frameId: top.id });
      const scopes = scopeRes?.scopes || [];
      const locals = scopes.find(s => s.name === 'Locals')
                  || scopes.find(s => !s.expensive)
                  || scopes[0];
      if (locals) {
        currentVarsRef = locals.variablesReference; // track for edits
        const varRes = await sendDapRequest('variables', { variablesReference: currentVarsRef });
        renderVariables(varRes?.variables || []);
      } else {
        currentVarsRef = 0;
        renderVariables([]);
      }
    }
  } catch (e) {
    console.error('Failed to fetch debug state', e);
  }
}

// ── DAP Message Handler ───────────────────────────────────────────────────────
function handleDapMessage(msg) {
  if (msg.type === 'response') {
    const def = pendingRequests.get(msg.request_seq);
    if (def) {
      msg.success ? def.resolve(msg.body) : def.reject(msg.message);
      pendingRequests.delete(msg.request_seq);
    }

  } else if (msg.type === 'event') {

    if (msg.event === 'initialized') {
      const file = state.currentFile;
      const bps = getBreakpointsForFile(file).map(line => ({ line }));
      sendDapRequest('setBreakpoints', { source: { path: file }, breakpoints: bps })
        .then(() => sendDapRequest('configurationDone', {}))
        .catch(console.error);

    } else if (msg.event === 'output') {
      if (msg.body?.category === 'telemetry') return;
      const text = msg.body?.output || '';
      if (!text) return;
      if (text.includes('Frame skipped') || text.includes('justMyCode')) return;
      consolePrint(text, msg.body.category === 'stderr' ? 'err' : 'out');

    } else if (msg.event === 'stopped') {
      onPaused(msg.body.threadId);

    } else if (msg.event === 'continued') {
      // Don't wipe variables/stack — just clear highlight and show running state
      setStatus('RUNNING');
      highlightDebugLine(view, -1);

    } else if (msg.event === 'terminated' || msg.event === 'exited') {
      showFinishedState(false);
      debugSocket = null;
    }
  }
}

// ── DAP WebSocket ─────────────────────────────────────────────────────────────
export async function startDebugging() {
  const file = state.currentFile;
  if (!file?.endsWith('.py')) {
    showPanel();
    consoleClear();
    consolePrint('Only Python (.py) files can be debugged.\n', 'err');
    return;
  }

  // Reset UI for new session
  consoleClear();
  renderVariables(null, 'Launching debugger…');
  renderCallStack(null, 'Waiting for process to start…');
  showPanel();
  setStatus('RUNNING');
  isRunning = true;

  // Always start on console so user sees output
  document.querySelector('.debug-tab[data-tab="console"]')?.click();
  consolePrint(`Debugging: ${file}\n`, 'info');
  consolePrint('─────────────────────────────────\n', 'info');

  try {
    const port = await invoke('get_debug_port');
    debugSocket = new WebSocket(`ws://127.0.0.1:${port}`);
    let buffer = '';

    debugSocket.onopen = () => {
      sendDapRequest('initialize', {
        clientID: 'axiom',
        clientName: 'Axiom IDE',
        adapterID: 'python',
        pathFormat: 'path',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsRunInTerminalRequest: false,
      }).then(() => sendDapRequest('launch', {
        program: file,
        cwd: state.rootDirPath || '',
        console: 'internalConsole',
        justMyCode: false,
      })).catch(e => {
        consolePrint(`Launch failed: ${e}\n`, 'err');
        setStatus('ERROR');
      });
    };

    debugSocket.onmessage = event => {
      buffer += event.data;
      while (buffer.length > 0) {
        buffer = buffer.trimStart();
        if (!buffer.startsWith('{')) { buffer = ''; break; }
        let braces = 0, endIdx = -1, inStr = false, esc = false;
        for (let i = 0; i < buffer.length; i++) {
          const c = buffer[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (!inStr) {
            if (c === '{') braces++;
            else if (c === '}' && --braces === 0) { endIdx = i; break; }
          }
        }
        if (endIdx === -1) break;
        const jsonStr = buffer.substring(0, endIdx + 1);
        buffer = buffer.substring(endIdx + 1);
        try { handleDapMessage(JSON.parse(jsonStr)); }
        catch (e) { console.error('DAP parse error', e); }
      }
    };

    debugSocket.onerror = () => {
      consolePrint('Connection error.\n', 'err');
      setStatus('ERROR');
    };
    // onclose fires after terminated event; we already handled cleanup there.
    // But guard against unexpected disconnects.
    debugSocket.onclose = () => {
      if (isRunning) {
        highlightDebugLine(view, -1);
        setStatus('STOPPED');
        isRunning = false;
      }
    };

  } catch (e) {
    consolePrint(`Failed to start debugger: ${e}\n`, 'err');
    setStatus('ERROR');
    isRunning = false;
  }
}

// ── Stop ──────────────────────────────────────────────────────────────────────
export function stopDebugging() {
  if (debugSocket?.readyState === WebSocket.OPEN) {
    sendDapRequest('disconnect', { terminateDebuggee: true }).catch(() => {});
  }
  debugSocket = null;
  showFinishedState(false);
}

// ── DAP Request ───────────────────────────────────────────────────────────────
export function sendDapRequest(command, args) {
  return new Promise((resolve, reject) => {
    if (!debugSocket || debugSocket.readyState !== WebSocket.OPEN) {
      reject('Socket not open'); return;
    }
    const seq = seqCounter++;
    pendingRequests.set(seq, { resolve, reject });
    debugSocket.send(JSON.stringify({ seq, type: 'request', command, arguments: args }));
  });
}

// ── Button Listeners ──────────────────────────────────────────────────────────
document.getElementById('debug-continue')?.addEventListener('click',   () => sendDapRequest('continue', { threadId: 1 }).catch(() => {}));
document.getElementById('debug-step-over')?.addEventListener('click',  () => sendDapRequest('next',     { threadId: 1 }).catch(() => {}));
document.getElementById('debug-step-into')?.addEventListener('click',  () => sendDapRequest('stepIn',   { threadId: 1 }).catch(() => {}));
document.getElementById('debug-step-out')?.addEventListener('click',   () => sendDapRequest('stepOut',  { threadId: 1 }).catch(() => {}));
document.getElementById('debug-stop')?.addEventListener('click',         stopDebugging);
document.getElementById('debug-panel-close')?.addEventListener('click',  hidePanel);
document.getElementById('debug-editor-btn')?.addEventListener('click',   startDebugging);
