import { state } from './state.js';
import { getFileIcon } from './icons.js';

// ── Breadcrumb Navigation ─────────────────────────────────────────────────────
export function updateBreadcrumb(filePath) {
  const bc = document.getElementById('editor-breadcrumb');
  if (!bc) return;

  let parts;
  if (state.rootDirPath && filePath.startsWith(state.rootDirPath)) {
    const rel = filePath.substring(state.rootDirPath.length).replace(/^[\\\/]/, '');
    parts = [state.rootName, ...rel.split(/[\\\/]/)];
  } else {
    // File is outside the project — show the full absolute path split by separator
    parts = filePath.split(/[\\\/]/);
  }

  bc.innerHTML = parts.map((p, i) => {
    const isLast  = i === parts.length - 1;
    const isFirst = i === 0;
    const icon    = isLast
      ? getFileIcon(p)
      : (isFirst ? '' : '<i class="fa-solid fa-folder" style="color:#E8AB4F;font-size:11px;"></i>');
    return (
      `<span class="crumb${isLast ? ' current-file-crumb' : ''}">${icon ? icon + ' ' : ''}${p}</span>` +
      (!isLast ? '<i class="fa-solid fa-chevron-right crumb-separator"></i>' : '')
    );
  }).join('');

  // Auto-scroll to the end so the current file is always visible
  setTimeout(() => { bc.scrollLeft = bc.scrollWidth; }, 10);
}
