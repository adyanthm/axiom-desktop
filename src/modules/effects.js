import { state } from './state.js';
import { view }  from './editor.js';

// ── Glow Effects ─────────────────────────────────────────────────────────────
export function toggleGlow() {
  state.isGlowEnabled = !state.isGlowEnabled;
  state.isRgbGlowEnabled = false;
  state.isRgbTextEnabled = false;
  document.body.classList.toggle('glow-effect', state.isGlowEnabled);
  document.body.classList.remove('rgb-glow-effect', 'rgb-text-effect');
}

export function toggleRgbGlow() {
  state.isRgbGlowEnabled = !state.isRgbGlowEnabled;
  state.isGlowEnabled = false;
  state.isRgbTextEnabled = false;
  document.body.classList.toggle('rgb-glow-effect', state.isRgbGlowEnabled);
  document.body.classList.remove('glow-effect', 'rgb-text-effect');
}

export function toggleRgbText() {
  state.isRgbTextEnabled = !state.isRgbTextEnabled;
  state.isGlowEnabled = false;
  state.isRgbGlowEnabled = false;
  document.body.classList.toggle('rgb-text-effect', state.isRgbTextEnabled);
  document.body.classList.remove('glow-effect', 'rgb-glow-effect');
}

// ── Zoom Logic ──────────────────────────────────────────────────────────────────
export function updateZoomOrigin() {
  if (!state.isZoomEnabled || !view) return;
  if (!view.hasFocus) { document.body.classList.remove('zoom-active'); return; }

  const sel = view.state.selection.main;
  const coords = view.coordsAtPos(sel.head);
  if (coords) {
    const rect = view.dom.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const ux = ((coords.left - rect.left) / rect.width) * view.dom.offsetWidth;
      const uy = ((coords.top  - rect.top)  / rect.height) * view.dom.offsetHeight;

      const W = view.dom.offsetWidth, H = view.dom.offsetHeight;
      const mx = 400, my = 200;
      let tx = Math.max(mx, Math.min(W - mx, ux));
      let ty = Math.max(my, Math.min(H - my, uy));

      if (W < mx * 2) tx = W / 2;
      if (H < my * 2) ty = H / 2;

      const s = 3; // 300% zoom
      view.dom.style.setProperty('--caret-x', `${(tx - s * ux) / (1 - s)}px`);
      view.dom.style.setProperty('--caret-y', `${(ty - s * uy) / (1 - s)}px`);
    }
  }
  document.body.classList.add('zoom-active');
}
window.updateZoomOrigin = updateZoomOrigin; // Called by editor updateListener

export function toggleZoom() {
  state.isZoomEnabled = !state.isZoomEnabled;
  document.body.classList.toggle('zoom-tracking-effect', state.isZoomEnabled);
  if (state.isZoomEnabled) {
    document.body.classList.add('zoom-active');
    updateZoomOrigin();
  } else {
    document.body.classList.remove('zoom-active');
    view.dom.style.removeProperty('--caret-x');
    view.dom.style.removeProperty('--caret-y');
  }
}
