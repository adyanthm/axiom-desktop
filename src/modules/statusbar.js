import { view } from './editor.js';
import { state } from './state.js';

// ── Language display names ────────────────────────────────────────────────────
// Maps file extension → human-readable label shown in the status bar.
const LANG_NAMES = {
  js:   'JavaScript',
  mjs:  'JavaScript',
  cjs:  'JavaScript',
  ts:   'TypeScript',
  jsx:  'JavaScript (JSX)',
  tsx:  'TypeScript (TSX)',
  html: 'HTML',
  htm:  'HTML',
  css:  'CSS',
  scss: 'SCSS',
  less: 'Less',
  vue:  'Vue',
  php:  'PHP',
  py:   'Python 3',
  rs:   'Rust',
  cpp:  'C++',
  cc:   'C++',
  cxx:  'C++',
  c:    'C',
  h:    'C / C++ Header',
  java: 'Java',
  json: 'JSON',
  md:   'Markdown',
  toml: 'TOML',
  yaml: 'YAML',
  yml:  'YAML',
  sh:   'Shell Script',
  bash: 'Bash',
  ps1:  'PowerShell',
  rb:   'Ruby',
  go:   'Go',
  kt:   'Kotlin',
  swift:'Swift',
  xml:  'XML',
  svg:  'SVG',
  txt:  'Plain Text',
};

// ── Status Bar ───────────────────────────────────────────────────────────────
const cursorEl = document.getElementById('sb-cursor');
const wordsEl  = document.getElementById('sb-words');
const langEl   = document.getElementById('sb-lang');

export function updateStatus() {
  // ── Language label ──────────────────────────────────────────────────────
  if (langEl) {
    if (state.currentFile) {
      const ext  = state.currentFile.split('.').pop()?.toLowerCase() ?? '';
      langEl.textContent = LANG_NAMES[ext] ?? (ext.toUpperCase() || 'Plain Text');
    } else {
      langEl.textContent = 'Plain Text';
    }
  }

  if (!state.currentFile) return;

  // ── Cursor / word count ─────────────────────────────────────────────────
  const sel  = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const col  = sel.head - line.from + 1;
  if (cursorEl) cursorEl.textContent = `Ln ${line.number}, Col ${col}`;
  const txt = view.state.doc.toString();
  if (wordsEl) wordsEl.textContent = `${txt.trim() === '' ? 0 : txt.trim().split(/\s+/).length} words`;

  // ── LSP status ──────────────────────────────────────────────────────────
  const lspStatusEl = document.getElementById('sb-lsp-status');
  if (lspStatusEl) {
    if (state.lspError) {
      lspStatusEl.textContent = state.lspError;
      lspStatusEl.style.color = '#ff9800';
    } else {
      lspStatusEl.textContent = 'LSP Active';
      lspStatusEl.style.color = 'var(--accent-color)';
    }
  }
}

// Attach direct DOM listeners so cursor clicks update the bar immediately
view.dom.addEventListener('click', updateStatus);
view.dom.addEventListener('keyup',  updateStatus);
