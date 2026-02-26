// ── Path Helpers ─────────────────────────────────────────────────────────────
export const SEP = navigator.platform.startsWith('Win') ? '\\' : '/';

export function pathJoin(...parts) {
  return parts.filter(Boolean).join(SEP);
}

export function pathBasename(p) {
  return p.split(/[\\\/]/).pop();
}

export function pathDirname(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? '' : p.substring(0, i);
}

// CSS.escape is used to safely build attribute selectors for file paths
export function esc(str) {
  return CSS.escape(str);
}
