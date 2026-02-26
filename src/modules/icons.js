// ── File Icons ───────────────────────────────────────────────────────────────
// Uses the VS Code Material Icon Theme CDN for consistent, recognisable icons.
const MAT_ICON = 'https://cdn.jsdelivr.net/gh/PKief/vscode-material-icon-theme@main/icons';

export function getFileIcon(name) {
  let icon = 'document';
  const lower = name.toLowerCase();

  if      (lower === 'package.json')        icon = 'nodejs';
  else if (lower === 'package-lock.json')   icon = 'nodejs';
  else if (lower === 'yarn.lock')           icon = 'yarn';
  else if (lower === '.gitignore')          icon = 'git';
  else if (lower === 'dockerfile')          icon = 'docker';
  else if (lower === 'cargo.toml')          icon = 'cargo';
  else if (lower === 'cargo.lock')          icon = 'cargo';
  else if (lower === 'readme.md')           icon = 'readme';
  else if (lower === 'license')             icon = 'certificate';
  else if (lower.endsWith('.py'))           icon = 'python';
  else if (lower.endsWith('.js') || lower.endsWith('.cjs') || lower.endsWith('.mjs')) icon = 'javascript';
  else if (lower.endsWith('.ts'))           icon = 'typescript';
  else if (lower.endsWith('.jsx'))          icon = 'react';
  else if (lower.endsWith('.tsx'))          icon = 'react_ts';
  else if (lower.endsWith('.html') || lower.endsWith('.htm')) icon = 'html';
  else if (lower.endsWith('.css'))          icon = 'css';
  else if (lower.endsWith('.json'))         icon = 'json';
  else if (lower.endsWith('.md'))           icon = 'markdown';
  else if (lower.endsWith('.txt'))          icon = 'document';
  else if (lower.endsWith('.rs'))           icon = 'rust';
  else if (lower.endsWith('.toml'))         icon = 'toml';
  else if (lower.endsWith('.yml') || lower.endsWith('.yaml')) icon = 'yaml';
  else if (lower.endsWith('.xml'))          icon = 'xml';
  else if (lower.endsWith('.csv'))          icon = 'csv';
  else if (lower.endsWith('.sh') || lower.endsWith('.bash')) icon = 'console';
  else if (lower.endsWith('.bat') || lower.endsWith('.ps1')) icon = 'console';
  else if (lower.endsWith('.c'))            icon = 'c';
  else if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) icon = 'cpp';
  else if (lower.endsWith('.h') || lower.endsWith('.hpp')) icon = 'h';
  else if (lower.endsWith('.java'))         icon = 'java';
  else if (lower.endsWith('.php'))          icon = 'php';
  else if (lower.endsWith('.rb'))           icon = 'ruby';
  else if (lower.endsWith('.go'))           icon = 'go';
  else if (lower.endsWith('.svg'))          icon = 'svg';
  else if (lower.match(/\.(png|jpg|jpeg|gif|ico|webp)$/)) icon = 'image';
  else if (lower.match(/\.(mp4|mkv|avi|mov)$/))           icon = 'video';
  else if (lower.match(/\.(mp3|wav|ogg)$/))               icon = 'audio';
  else if (lower.match(/\.(zip|tar|gz|rar|7z)$/))         icon = 'zip';

  return `<img src="${MAT_ICON}/${icon}.svg" style="width:16px;height:16px;object-fit:contain;flex-shrink:0;margin-right:4px;" `
       + `onerror="this.onerror=null;this.src='${MAT_ICON}/document.svg';">`;
}

// ── Folder Icons ─────────────────────────────────────────────────────────────
export function getFolderIcon(name, expanded) {
  let icon = 'folder-base';
  const lower = name.toLowerCase();

  if      (lower === 'src' || lower === 'source')                          icon = 'folder-src';
  else if (lower === 'components')                                          icon = 'folder-components';
  else if (lower === 'assets' || lower === 'static' || lower === 'images') icon = 'folder-images';
  else if (lower === 'public')                                              icon = 'folder-public';
  else if (lower === 'node_modules')                                        icon = 'folder-node';
  else if (lower === 'docs' || lower === 'doc')                            icon = 'folder-docs';
  else if (lower === 'tests' || lower === '__tests__' || lower === 'test') icon = 'folder-test';
  else if (lower === 'target' || lower === 'build' || lower === 'dist' || lower === '.next') icon = 'folder-dist';
  else if (lower === '.git' || lower === '.github' || lower === '.vscode') icon = 'folder-git';
  else if (lower === 'scripts')                                             icon = 'folder-scripts';

  if (expanded) icon += '-open';

  const fallback = `${MAT_ICON}/folder-base${expanded ? '-open' : ''}.svg`;
  return `<img src="${MAT_ICON}/${icon}.svg" class="dir-icon" style="width:16px;height:16px;object-fit:contain;flex-shrink:0;margin-right:4px;" `
       + `onerror="this.onerror=null;this.src='${fallback}';">`;
}
