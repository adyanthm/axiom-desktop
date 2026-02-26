// ── Tauri Detection ─────────────────────────────────────────────────────────
export const IS_TAURI = '__TAURI_INTERNALS__' in window;

// ── Shared Mutable State ─────────────────────────────────────────────────────
// Using a plain object so any module can mutate properties by reference
// (avoids the ES module live-binding limitation with re-assignable vars).
export const state = {
  // File system
  rootDirPath:     null,
  rootName:        'AXIOM_PROJECT',
  fileContents:    new Map(),       // path → saved text
  fileEditorStates: new Map(),      // path → CodeMirror EditorState
  dirtyFiles:      new Set(),       // paths with unsaved changes
  fileTree:        null,            // recursive tree object
  expandedDirs:    new Set(),       // paths of expanded directories

  // Tabs
  openTabs:        [],              // ordered list of open file paths
  currentFile:     null,            // active file path

  // Explorer selection & drag
  selectedPaths:   new Set(),
  lastClickedPath: null,
  flatVisiblePaths: [],             // [{path, isDir}] in render order
  draggedPaths:    null,

  // Context menu target
  activeContextPath:  null,
  activeContextIsDir: false,

  // Inline creator (new file/folder input inside explorer)
  inlineCreator:   null,            // {parentPath, type} | null

  // Visual effect flags
  isZoomEnabled:    false,
  isGlowEnabled:    false,
  isRgbGlowEnabled: false,
  isRgbTextEnabled: false,
};
