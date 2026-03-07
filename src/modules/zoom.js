import { view } from './editor.js';

// ═══════════════════════════════════════════════════════════════════════════════
// EDITOR FONT-SIZE ZOOM  (Ctrl + / Ctrl - / Ctrl 0)
// Changes --cm-font-size CSS variable → OS re-rasterises glyphs → stays sharp.
// After the var change, view.requestMeasure() forces CodeMirror to immediately
// re-measure gutter widths and line-number positions without waiting for a click.
// ═══════════════════════════════════════════════════════════════════════════════
const BASE_EDITOR_PX = 14;   // must match default in style.css
const MIN_EDITOR_PX  = 8;
const MAX_EDITOR_PX  = 42;
const EDITOR_STEP    = 2;    // px per Ctrl+/- step

let editorPx = BASE_EDITOR_PX;
const editorWrap = document.getElementById('editor-wrap');

function _applyEditorSize(px) {
  editorPx = Math.max(MIN_EDITOR_PX, Math.min(MAX_EDITOR_PX, px));

  // Applying the CSS var directly to view.dom creates a DOM mutation that 
  // CodeMirror's internal observer catches, immediately un-caching line heights.
  if (view && view.dom) {
    view.dom.style.setProperty('--cm-font-size', `${editorPx}px`);
    // Then queue a measure for the next frame so layout has time to calculate.
    window.requestAnimationFrame(() => {
      view.requestMeasure();
    });
  } else {
    editorWrap.style.setProperty('--cm-font-size', `${editorPx}px`);
  }

  _syncStatusBar();
}

export function zoomIn()    { _applyEditorSize(editorPx + EDITOR_STEP); }
export function zoomOut()   { _applyEditorSize(editorPx - EDITOR_STEP); }
export function zoomReset() { _applyEditorSize(BASE_EDITOR_PX); }
export function getEditorFontSize() { return editorPx; }

// ═══════════════════════════════════════════════════════════════════════════════
// UI SCALE  (Ctrl Shift + / Ctrl Shift - / Ctrl Shift 0)
// Scales the entire #app element using the CSS `zoom` property — not a CSS
// transform.  `zoom` causes the browser to re-layout every element at the new
// scale, so menus, sidebar, tabs, status bar, dialogs all grow proportionally.
// Text stays sharp because the OS rasterises at the scaled DPI.
// Range: 0.75x – 3.0x in steps of 0.25.
// ═══════════════════════════════════════════════════════════════════════════════
const BASE_UI_SCALE = 1.0;
const MIN_UI_SCALE  = 0.75;
const MAX_UI_SCALE  = 3.0;
const UI_STEP       = 0.25;

let uiScale = BASE_UI_SCALE;

function _snapToStep(val, step) {
  return Math.round(val / step) * step;
}

function _applyUIScale(scale) {
  uiScale = Math.max(MIN_UI_SCALE, Math.min(MAX_UI_SCALE, _snapToStep(scale, UI_STEP)));
  // Zooming the <body> directly allows Chromium to recalculate vw/vh and 100% 
  // heights perfectly without hiding the status bar off-screen.
  document.body.style.zoom = uiScale;
  _syncStatusBar();
}

export function uiZoomIn()    { _applyUIScale(uiScale + UI_STEP); }
export function uiZoomOut()   { _applyUIScale(uiScale - UI_STEP); }
export function uiZoomReset() { _applyUIScale(BASE_UI_SCALE); }
export function getUIScale()  { return uiScale; }

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS BAR BADGES
// • #sb-zoom     — shows editor font % when not at 100%  (e.g. "150%")
// • #sb-ui-scale — shows UI scale %  when not at 100%    (e.g. "UI 200%")
// Both are hidden at their default values to keep the bar clean.
// ═══════════════════════════════════════════════════════════════════════════════
function _syncStatusBar() {
  const edEl = document.getElementById('sb-zoom');
  if (edEl) {
    if (editorPx === BASE_EDITOR_PX) {
      edEl.textContent = ''; edEl.style.display = 'none';
    } else {
      edEl.textContent = `${Math.round((editorPx / BASE_EDITOR_PX) * 100)}%`;
      edEl.style.display = '';
    }
  }

  const uiEl = document.getElementById('sb-ui-scale');
  if (uiEl) {
    if (uiScale === BASE_UI_SCALE) {
      uiEl.textContent = ''; uiEl.style.display = 'none';
    } else {
      uiEl.textContent = `UI ${Math.round(uiScale * 100)}%`;
      uiEl.style.display = '';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// KEYBOARD + SCROLL LISTENERS
// ═══════════════════════════════════════════════════════════════════════════════
export function initZoom() {
  // Capture phase ensures we intercept before CodeMirror's own keydown handler.
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;

    if (!e.shiftKey) {
      // ── Editor font-size zoom ─────────────────────────────────────────────
      if      (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
      else if (e.key === '0')                  { e.preventDefault(); zoomReset(); }
    } else {
      // ── Whole-UI scale (Ctrl + Shift + ...) ──────────────────────────────
      if      (e.key === '=' || e.key === '+') { e.preventDefault(); uiZoomIn(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); uiZoomOut(); }
      else if (e.key === '0')                  { e.preventDefault(); uiZoomReset(); }
    }
  }, { capture: true });

  // Ctrl + Scroll on the editor area → editor font-size zoom.
  // passive: false required to call preventDefault() and suppress the native
  // browser page-zoom which would otherwise also fire.
  editorWrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  }, { passive: false });
}
