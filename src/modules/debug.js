import { invoke } from '@tauri-apps/api/core';
import { state } from './state.js';
import { view } from './editor.js';
import { getBreakpointsForFile, highlightDebugLine } from './breakpoints.js';
import { saveFile } from './files.js';
import { startLiveServer } from './runner.js';

let debugSocket = null;
let currentDebugPort = null;
let seqCounter = 1;
const pendingRequests = new Map();
let isRunning = false;
let currentDebugType = 'python'; // 'python' | 'node' | 'chrome'

// ── Panel Elements ──────────────────────────────────────────────────────────
const debugPanel = document.getElementById('debug-panel');
const consoleEl  = document.getElementById('debug-console-output');
const varsEl     = document.getElementById('debug-variables-list');
const stackEl    = document.getElementById('debug-callstack-list');

// ── Session Status Badge ────────────────────────────────────────────────────
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
function showPanel() { debugPanel?.classList.remove('hidden'); }
export function hidePanel() {
  if (isRunning) highlightDebugLine(view, -1);
  debugPanel?.classList.add('hidden');
}

// ── Tab Switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.debug-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.debug-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.debug-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`debug-tab-${btn.dataset.tab}`)?.classList.add('active');
  });
});

// ── Resizable panel ──────────────────────────────────────────────────────────
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

// ── Console Helpers ──────────────────────────────────────────────────────────
function stripAnsi(str) {
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
function consoleClear() { if (consoleEl) consoleEl.innerHTML = ''; }

// ── REPL Console Input ────────────────────────────────────────────────────────
const consoleInput = document.getElementById('debug-console-input');
const consoleInputBtn = document.getElementById('debug-console-input-btn');
async function evalExpression(expr) {
  if (!expr?.trim() || !debugSocket || debugSocket.readyState !== WebSocket.OPEN) return;
  consolePrint(`> ${expr}\n`, 'info');
  try {
    const res = await sendDapRequest('evaluate', {
      expression: expr,
      context: 'repl',
      frameId: currentFrameId ?? undefined,
    });
    if (res?.result !== undefined) consolePrint(`${res.result}\n`, 'out');
  } catch (e) {
    consolePrint(`Error: ${e}\n`, 'err');
  }
}
if (consoleInput) {
  consoleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); evalExpression(consoleInput.value); consoleInput.value = ''; }
  });
}
if (consoleInputBtn) {
  consoleInputBtn.addEventListener('click', () => { evalExpression(consoleInput?.value); if (consoleInput) consoleInput.value = ''; });
}

// ── Variables Renderer (with inline editing) ─────────────────────────────────
let currentVarsRef = 0;
let currentFrameId = null;

function renderVariables(scopesData, hint, socket) {
  if (!varsEl) return;
  if (hint !== undefined) {
    varsEl.innerHTML = `<span class="debug-empty-hint">${hint}</span>`;
    return;
  }
  varsEl.innerHTML = '';
  
  if (!scopesData || scopesData.length === 0) {
    varsEl.innerHTML = `<span class="debug-empty-hint">No variables available.</span>`;
    return;
  }

  scopesData.forEach(scope => {
    // Add Scope Header
    const header = document.createElement('div');
    header.className = 'debug-var-group-header';
    header.textContent = scope.name;
    varsEl.appendChild(header);

    const vars = scope.variables || [];
    if (vars.length === 0) {
      const emptyHint = document.createElement('div');
      emptyHint.className = 'debug-empty-hint small';
      emptyHint.textContent = 'Empty scope';
      varsEl.appendChild(emptyHint);
      return;
    }

    // Filter noise
    const visible = currentDebugType === 'python'
      ? vars.filter(v => !v.name.startsWith('__') || v.name === '__name__')
      : vars.filter(v => !['__proto__', 'constructor'].includes(v.name)).slice(0, 100);

    visible.forEach(v => {
      const row = document.createElement('div');
      row.className = 'debug-var-row';
      const safeVal = String(v.value).replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const nameEl = document.createElement('span');
      nameEl.className = 'debug-var-name';
      nameEl.title = v.name;
      nameEl.textContent = v.name;

      const typeEl = document.createElement('span');
      typeEl.className = 'debug-var-type';
      typeEl.textContent = v.type || '';

      const valEl = document.createElement('span');
      valEl.className = 'debug-var-value editable-value';
      valEl.title = 'Double-click to edit';
      valEl.innerHTML = safeVal;

      if (v.variablesReference && v.variablesReference > 0) {
        valEl.classList.add('has-children');
        const chevron = document.createElement('span');
        chevron.className = 'debug-var-expand';
        chevron.textContent = ' ▶';
        nameEl.appendChild(chevron);
        let expanded = false;
        chevron.addEventListener('click', async e => {
          e.stopPropagation();
          if (expanded) {
            expanded = false; chevron.textContent = ' ▶';
            row.querySelectorAll('.debug-var-child').forEach(c => c.remove());
            return;
          }
          try {
            const res = await sendDapRequest('variables', { variablesReference: v.variablesReference }, socket);
            (res?.variables || []).slice(0, 50).forEach(child => {
              const childRow = document.createElement('div');
              childRow.className = 'debug-var-row debug-var-child';
              childRow.innerHTML = `<span class="debug-var-name" style="padding-left:24px">${child.name}</span><span class="debug-var-type">${child.type || ''}</span><span class="debug-var-value">${String(child.value).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`;
              row.after(childRow);
            });
            expanded = true; chevron.textContent = ' ▼';
          } catch {}
        });
      }

      valEl.addEventListener('dblclick', e => {
        e.stopPropagation();
        if (valEl.querySelector('input')) return;
        const input = document.createElement('input');
        input.className = 'debug-var-input';
        input.value = v.value;
        input.autocomplete = 'off'; input.spellcheck = false;
        valEl.innerHTML = ''; valEl.appendChild(input); valEl.classList.add('editing');
        input.focus(); input.select();

        const cancel = () => { valEl.classList.remove('editing'); valEl.innerHTML = safeVal; };
        const commit = async () => {
          const newVal = input.value.trim();
          valEl.classList.remove('editing');
          if (newVal === v.value) { valEl.innerHTML = safeVal; return; }
          valEl.innerHTML = `…`;
          try {
            await sendDapRequest('setVariable', {
              variablesReference: scope.variablesReference,
              name: v.name,
              value: newVal,
            }, socket);
            valEl.innerHTML = newVal.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          } catch (err) {
            valEl.innerHTML = `⚠`;
            setTimeout(() => { valEl.innerHTML = safeVal; }, 2000);
          }
        };

        input.addEventListener('keydown', e => {
          if (e.key === 'Enter')  { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', () => setTimeout(cancel, 150));
      });

      row.appendChild(nameEl); row.appendChild(typeEl); row.appendChild(valEl);
      varsEl.appendChild(row);
    });
  });
}

// ── Call Stack Renderer ──────────────────────────────────────────────────────
function renderCallStack(frames, hint, socket) {
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
    // Click to jump to frame
    row.addEventListener('click', async () => {
      document.querySelectorAll('.debug-frame-row').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      await jumpToFrame(frame, socket);
    });
    stackEl.appendChild(row);
  });
}

async function jumpToFrame(frame, socket) {
  if (!frame) return;
  // Highlight line (source map already resolved by js-debug)
  if (frame.line > 0) highlightDebugLine(view, frame.line);

  // Fetch variables for ALL scopes (Local, Closure, Global, etc.)
  try {
    const scopeRes = await sendDapRequest('scopes', { frameId: frame.id }, socket);
    const scopes = scopeRes?.scopes || [];
    const scopesData = [];

    for (const scope of scopes) {
      try {
        const varRes = await sendDapRequest('variables', { variablesReference: scope.variablesReference }, socket);
        scopesData.push({
          name: scope.name,
          variablesReference: scope.variablesReference,
          variables: varRes?.variables || []
        });
      } catch (err) {
        console.error(`Failed to fetch variables for scope ${scope.name}`, err);
      }
    }

    currentFrameId = frame.id;
    if (scopesData.length > 0) {
      renderVariables(scopesData, undefined, socket);
    } else {
      renderVariables(null, 'No variables in any scope.', socket);
    }
  } catch (e) {
    console.error('Failed to resolve scopes', e);
  }
}

// ── Finish State ────────────────────────────────────────────────────────────
function showFinishedState(error = false) {
  isRunning = false;
  highlightDebugLine(view, -1);
  setStatus('STOPPED');
  consolePrint('\n─────────────────────────────────\n', 'info');
  consolePrint(error ? 'Process finished with a non-zero exit code.\n' : 'Process finished successfully.\n', 'info');
  document.querySelector('.debug-tab[data-tab="console"]')?.click();
  renderVariables(null, 'Session ended. Start a new debug session to inspect variables.');
  renderCallStack(null, 'No active frames. The process has exited.');
}

// ── On Pause ─────────────────────────────────────────────────────────────────
async function onPaused(threadId, socket) {
  setStatus('PAUSED');
  document.querySelector('.debug-tab[data-tab="variables"]')?.click();
  try {
    const res = await sendDapRequest('stackTrace', { threadId, levels: 50 }, socket);
    const frames = res?.stackFrames || [];
    renderCallStack(frames, undefined, socket);
    if (frames.length > 0) {
      currentFrameId = frames[0].id;
      await jumpToFrame(frames[0], socket);
      const { EditorView } = await import('@codemirror/view');
      const line = frames[0].line;
      if (line > 0 && view.state.doc.lines >= line) {
        view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'center' }) });
      }
    }
  } catch (e) { console.error('Failed to fetch debug state', e); }
}

// ── DAP Message Handler ──────────────────────────────────────────────────────
function handleDapMessage(msg, socket) {
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
      sendDapRequest('setBreakpoints', {
        source: { path: file },
        breakpoints: bps,
      }, socket)
        .then(() => sendDapRequest('configurationDone', {}, socket))
        .then(() => {
          renderVariables(null, 'Debugger attached. Pause to inspect variables.', socket);
          renderCallStack(null, 'Process is running.', socket);
        })
        .catch(console.error);

    } else if (msg.event === 'output') {
      if (msg.body?.category === 'telemetry') return;
      const text = msg.body?.output || '';
      if (!text) return;
      if (text.includes('Frame skipped') || text.includes('justMyCode')) return;
      consolePrint(text, msg.body.category === 'stderr' ? 'err' : 'out');

    } else if (msg.event === 'stopped') {
      onPaused(msg.body.threadId, socket);

    } else if (msg.event === 'continued') {
      setStatus('RUNNING');
      highlightDebugLine(view, -1);
      renderVariables(null, 'Process is running. Pause to inspect variables.', socket);
      renderCallStack(null, 'No active frames (running).', socket);

    } else if (msg.event === 'terminated' || msg.event === 'exited') {
      const hasError = msg.body?.exitCode !== undefined && msg.body.exitCode !== 0;
      showFinishedState(hasError);
      debugSocket = null;
    }
  } else if (msg.type === 'request') {
    if (msg.command === 'startDebugging') {
      sendDapResponse(msg.seq, msg.command, true, {}, socket);
      // Open the actual debugging session (multiplexed on the same port)
      if (currentDebugPort) {
        connectDebugSocket(currentDebugPort, () => {
          sendDapRequest('initialize', {
            clientID: 'axiom', clientName: 'Axiom IDE', adapterID: currentDebugType === 'node' ? 'pwa-node' : 'pwa-chrome',
            pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true,
            supportsRunInTerminalRequest: false,
            supportsSetVariable: true,
            supportsEvaluateForHovers: true,
          }).then(() => sendDapRequest('launch', msg.arguments.configuration))
            .catch(e => console.error('Child session launch failed', e));
        });
      }
    }
  }
}

// ── WS Connection & DAP Framing ──────────────────────────────────────────────
function connectDebugSocket(port, onOpen) {
  currentDebugPort = port;
  // Multi-session support: We don't close the old socket here, 
  // we just let the new one take over the global 'debugSocket' for UI commands.
  // The old (broker) socket stays alive in the background to keep the process running.
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  debugSocket = socket;
  activeSockets.push(socket);
  let buffer = '';

  debugSocket.onopen  = onOpen;
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
      try { handleDapMessage(JSON.parse(jsonStr), socket); }
      catch (e) { console.error('DAP parse error', e); }
    }
  };
  debugSocket.onerror = () => { consolePrint('WebSocket error.\n', 'err'); setStatus('ERROR'); };
  debugSocket.onclose = () => {
    if (isRunning) { highlightDebugLine(view, -1); setStatus('STOPPED'); isRunning = false; }
  };
}

const activeSockets = [];

function close() {
  activeSockets.forEach(s => { if (s.readyState === WebSocket.OPEN) s.close(); });
  activeSockets.length = 0;
  debugSocket = null;
}

// ── Launch: Python ───────────────────────────────────────────────────────────
async function startPythonDebugging() {
  const file = state.currentFile;
  consoleClear();
  renderVariables(null, 'Launching Python debugger…');
  renderCallStack(null, 'Waiting for process to start…');
  showPanel();
  setStatus('RUNNING');
  isRunning = true;
  currentDebugType = 'python';
  document.querySelector('.debug-tab[data-tab="console"]')?.click();
  consolePrint(`Debugging (Python): ${file}\n`, 'info');
  consolePrint('─────────────────────────────────\n', 'info');

  try {
    const port = await invoke('get_debug_port');
    connectDebugSocket(port, () => {
      sendDapRequest('initialize', {
        clientID: 'axiom', clientName: 'Axiom IDE', adapterID: 'python',
        pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true,
        supportsRunInTerminalRequest: false,
      }).then(() => sendDapRequest('launch', {
        program: file, cwd: state.rootDirPath || '', console: 'internalConsole', justMyCode: false,
      })).catch(e => { consolePrint(`Launch failed: ${e}\n`, 'err'); setStatus('ERROR'); });
    });
  } catch (e) {
    consolePrint(`Failed to start Python debugger: ${e}\n`, 'err');
    setStatus('ERROR'); isRunning = false;
  }
}

// ── Launch: Node.js ──────────────────────────────────────────────────────────
async function startNodeDebugging() {
  const file = state.currentFile;
  await saveFile();
  consoleClear();
  renderVariables(null, 'Launching Node.js debugger…');
  renderCallStack(null, 'Waiting for process to start…');
  showPanel();
  setStatus('RUNNING');
  isRunning = true;
  currentDebugType = 'node';
  document.querySelector('.debug-tab[data-tab="console"]')?.click();
  consolePrint(`Debugging (Node.js): ${file}\n`, 'info');
  consolePrint('─────────────────────────────────\n', 'info');

  try {
    const port = await invoke('get_js_debug_port');
    connectDebugSocket(port, () => {
      sendDapRequest('initialize', {
        clientID: 'axiom', clientName: 'Axiom IDE', adapterID: 'pwa-node',
        pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true,
        supportsRunInTerminalRequest: false,
        supportsSetVariable: true,
        supportsEvaluateForHovers: true,
        supportsStepInTargetsRequest: false,
      }).then(() => sendDapRequest('launch', {
        type: 'pwa-node',
        request: 'launch',
        name: 'Axiom Node.js Debug',
        program: file,
        cwd: state.rootDirPath || file.substring(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1) || '',
        stopOnEntry: true,
        console: 'internalConsole',
        internalConsoleOptions: 'neverOpen',
        skipFiles: ['<node_internals>/**'],
        sourceMaps: true,
        resolveSourceMapLocations: ['${workspaceFolder}/**', '!**/node_modules/**'],
      })).catch(e => { consolePrint(`Launch failed: ${e}\n`, 'err'); setStatus('ERROR'); });
    });
  } catch (e) {
    consolePrint(`Failed to start Node debugger: ${e}\n`, 'err');
    setStatus('ERROR'); isRunning = false;
  }
}

// ── Launch: Chrome ───────────────────────────────────────────────────────────
async function startChromeDebugging() {
  const file = state.currentFile;
  await saveFile();
  consoleClear();
  renderVariables(null, 'Launching Chrome debugger…');
  renderCallStack(null, 'Waiting for browser to start…');
  showPanel();
  setStatus('RUNNING');
  isRunning = true;
  currentDebugType = 'chrome';
  document.querySelector('.debug-tab[data-tab="console"]')?.click();
  consolePrint(`Debugging (Chrome): ${file}\n`, 'info');
  consolePrint('─────────────────────────────────\n', 'info');

  // Find the live server URL or fall back to file://
  let url;
  if (file.endsWith('.html')) {
    // Try to start the live server for the HTML file
    try {
      const actualPort = await startLiveServer(file, true); // true = silent (don't open in system browser)
      if (!actualPort) return; 

      const serveDir = state.rootDirPath || file.substring(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1) || '';
      let rel = file.substring(serveDir.length).replace(/\\/g, '/');
      if (rel.startsWith('/')) rel = rel.substring(1);
      url = `http://localhost:${actualPort}/${rel}`;
    } catch (e) {
      console.error('Chrome Debug: Live Server failed', e);
      url = `file:///${file.replace(/\\/g, '/')}`;
    }
  } else {
    // For JS files, we probably want to debug them in a generic page or the project root
    url = `file:///${file.replace(/\\/g, '/')}`;
  }

  try {
    const port = await invoke('get_js_debug_port');
    connectDebugSocket(port, () => {
      sendDapRequest('initialize', {
        clientID: 'axiom', clientName: 'Axiom IDE', adapterID: 'pwa-chrome',
        pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true,
        supportsRunInTerminalRequest: false,
        supportsSetVariable: true,
        supportsEvaluateForHovers: true,
      }).then(() => sendDapRequest('launch', {
        type: 'pwa-chrome',
        request: 'launch',
        name: 'Axiom Chrome Debug',
        url,
        webRoot: state.rootDirPath || file.substring(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1) || '',
        stopOnEntry: true,
        sourceMaps: true,
        skipFiles: ['<node_internals>/**'],
        userDataDir: true, // Use temporary profile to avoid conflicts
        runtimeArgs: ['--remote-allow-origins=*'], // Help with attachment
      })).catch(e => { consolePrint(`Launch failed: ${e}\n`, 'err'); setStatus('ERROR'); });
    });
  } catch (e) {
    consolePrint(`Failed to start Chrome debugger: ${e}\n`, 'err');
    setStatus('ERROR'); isRunning = false;
  }
}

// ── Debug Picker (JS files) ──────────────────────────────────────────────────
const pickerOverlay = document.getElementById('js-debug-picker-overlay');
const pickerFileName = document.getElementById('js-debug-file-name');

function showJsDebugPicker() {
  return new Promise(resolve => {
    const file = state.currentFile;
    if (pickerFileName) pickerFileName.textContent = file?.split(/[/\\]/).pop() || 'file.js';
    pickerOverlay?.classList.remove('hidden');

    const onNode = () => { cleanup(); resolve('node'); };
    const onChrome = () => { cleanup(); resolve('chrome'); };
    const onCancel = () => { cleanup(); resolve(null); };

    const nodeBtn   = document.getElementById('js-debug-node-btn');
    const chromeBtn = document.getElementById('js-debug-chrome-btn');
    const cancelBtn = document.getElementById('js-debug-cancel-btn');

    nodeBtn?.addEventListener('click',   onNode,   { once: true });
    chromeBtn?.addEventListener('click', onChrome, { once: true });
    cancelBtn?.addEventListener('click', onCancel, { once: true });

    function cleanup() {
      pickerOverlay?.classList.add('hidden');
      nodeBtn?.removeEventListener('click', onNode);
      chromeBtn?.removeEventListener('click', onChrome);
      cancelBtn?.removeEventListener('click', onCancel);
    }
  });
}

// ── Main Entry Point ─────────────────────────────────────────────────────────
export async function startDebugging() {
  const file = state.currentFile;
  if (!file) return;
  const ext = file.split('.').pop()?.toLowerCase();

  if (ext === 'py') {
    await startPythonDebugging();
  } else if (['js', 'mjs', 'ts', 'tsx', 'jsx', 'html'].includes(ext)) {
    await saveFile();
    const mode = await showJsDebugPicker();
    if (!mode) return;
    if (mode === 'node') await startNodeDebugging();
    else if (mode === 'chrome') await startChromeDebugging();
  } else {
    showPanel();
    consoleClear();
    consolePrint(`Cannot debug .${ext} files.\nSupported: Python (.py), JavaScript (.js/.ts/.jsx/.tsx), HTML (Chrome).\n`, 'err');
  }
}

// ── Stop ─────────────────────────────────────────────────────────────────────
export function stopDebugging() {
  if (debugSocket?.readyState === WebSocket.OPEN) {
    sendDapRequest('disconnect', { terminateDebuggee: true }).catch(() => {});
  }
  debugSocket = null;
  showFinishedState(false);
}

// ── DAP Request ──────────────────────────────────────────────────────────────
export function sendDapRequest(command, args, socket = null) {
  const targetSocket = socket || debugSocket;
  return new Promise((resolve, reject) => {
    if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
      reject('Socket not open'); return;
    }
    const seq = seqCounter++;
    pendingRequests.set(seq, { resolve, reject });
    targetSocket.send(JSON.stringify({ seq, type: 'request', command, arguments: args }));
  });
}

export function sendDapResponse(requestSeq, command, success = true, body = {}, socket = null) {
  const targetSocket = socket || debugSocket;
  if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) return;
  const seq = seqCounter++;
  targetSocket.send(JSON.stringify({ seq, type: 'response', request_seq: requestSeq, command, success, body }));
}

// ── Button Listeners ─────────────────────────────────────────────────────────
document.getElementById('debug-continue')?.addEventListener('click',  () => sendDapRequest('continue', { threadId: 1 }).catch(() => {}));
document.getElementById('debug-step-over')?.addEventListener('click', () => sendDapRequest('next',     { threadId: 1 }).catch(() => {}));
document.getElementById('debug-step-into')?.addEventListener('click', () => sendDapRequest('stepIn',   { threadId: 1 }).catch(() => {}));
document.getElementById('debug-step-out')?.addEventListener('click',  () => sendDapRequest('stepOut',  { threadId: 1 }).catch(() => {}));
document.getElementById('debug-stop')?.addEventListener('click',          stopDebugging);
document.getElementById('debug-panel-close')?.addEventListener('click',   hidePanel);
document.getElementById('debug-editor-btn')?.addEventListener('click',    startDebugging);
