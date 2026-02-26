import { view } from './editor.js';
import { state } from './state.js';

// ── Status Bar ───────────────────────────────────────────────────────────────
const cursorEl = document.getElementById('sb-cursor');
const wordsEl  = document.getElementById('sb-words');

export function updateStatus() {
  if (!state.currentFile) return;
  const sel  = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const col  = sel.head - line.from + 1;
  if (cursorEl) cursorEl.textContent = `Ln ${line.number}, Col ${col}`;
  const txt = view.state.doc.toString();
  if (wordsEl) wordsEl.textContent = `${txt.trim() === '' ? 0 : txt.trim().split(/\s+/).length} words`;
}

// Attach direct DOM listeners so cursor clicks update the bar immediately
view.dom.addEventListener('click', updateStatus);
view.dom.addEventListener('keyup',  updateStatus);
