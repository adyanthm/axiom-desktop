import { EditorState } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers,
  highlightActiveLine, highlightActiveLineGutter, drawSelection,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { expandAbbreviation } from '@emmetio/codemirror6-plugin';

// Extensions for which Emmet Tab-expansion is allowed.
// In every other language, Tab falls through to normal indentation.
const EMMET_EXTS = new Set(['html', 'htm', 'css', 'scss', 'less', 'jsx', 'tsx', 'vue', 'php']);

function emmetExpand(view) {
  const ext = state.currentFile?.split('.').pop()?.toLowerCase();
  if (!EMMET_EXTS.has(ext)) return false;
  return expandAbbreviation(view);
}
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { searchKeymap, search } from '@codemirror/search';
import { foldGutter, foldKeymap } from '@codemirror/language';
import { state } from './state.js';
import { longLineExtension } from './longLine.js';
import { breakpointGutter, debugLineState } from './breakpoints.js';

// ── Dirty-version tracking ───────────────────────────────────────────────────
// Maps filePath → the doc.version (integer) at the time the file was last
// saved to or freshly loaded from disk.  A file is "clean" iff its current
// doc.version equals the stored clean version.  No string comparison ever
// occurs — this runs in O(1) with zero allocations on every keystroke.
const cleanVersions = new Map();

// Call this immediately after a file is saved OR freshly loaded so that
// the current document version becomes the new "clean" baseline.
export function markClean(filePath, docVersion) {
  cleanVersions.set(filePath, docVersion);
  state.dirtyFiles.delete(filePath);
}

// Returns the stored clean version for a path, or -1 if unknown.
export function getCleanVersion(filePath) {
  return cleanVersions.get(filePath) ?? -1;
}

// Remove tracking when a tab is closed (prevents map from growing forever).
export function forgetCleanVersion(filePath) {
  cleanVersions.delete(filePath);
}

// ── Editor State Factory ─────────────────────────────────────────────────────
// Creates a fresh CodeMirror EditorState for a given document + language extension.
// The updateListener handles the dirty-flag logic so the tab/explorer dot stays
// in sync without a full re-render on every keystroke.
//
// Dirty detection uses transaction tracking (O(1) integer comparison):
//   • markClean(path, version) is called on file-open and file-save.
//   • Every update compares update.state.doc.version against that baseline.
//   • No doc.toString() is ever called for dirty detection.
export function createEditorState(content, langExt = []) {
  return EditorState.create({
    doc: content,
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      drawSelection(),
      breakpointGutter,
      debugLineState,
      lineNumbers(),
      foldGutter({
        markerDOM: (open) => {
          let el = document.createElement('span');
          el.className = open ? 'cm-fold-open' : 'cm-fold-closed';
          el.innerHTML = open 
            ? '<i class="fa-solid fa-chevron-down"></i>' 
            : '<i class="fa-solid fa-chevron-right"></i>';
          return el;
        }
      }),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      autocompletion({
        compareCompletions(a, b) {
          // Tier 1: Keywords take absolute precedence
          if (a.type === 'keyword' && b.type !== 'keyword') return -1;
          if (b.type === 'keyword' && a.type !== 'keyword') return 1;

          // Tier 2: De-prioritize Auto-imports to the very bottom
          const isAutoA = a.label.includes('Auto-import');
          const isAutoB = b.label.includes('Auto-import');
          if (isAutoA && !isAutoB) return 1;
          if (!isAutoA && isAutoB) return -1;

          // Tier 3: Category-based priority
          const typePriority = {
            function: 900,
            method: 900,
            variable: 800,
            parameter: 800,
            property: 800,
            field: 800,
            constant: 800,
            class: 700,
            interface: 700,
            type: 700,
            module: 600,
            snippet: 500
          };

          const prioA = typePriority[a.type] || 0;
          const prioB = typePriority[b.type] || 0;

          if (prioA !== prioB) return prioB - prioA;

          // Tier 4: Use LSP boost, then label alpha
          return (b.boost || 0) - (a.boost || 0) || a.label.localeCompare(b.label);
        }
      }),
      search({ top: true }),
      keymap.of([
        // Emmet expands first on Tab; falls through to indentWithTab if not in an abbreviation
        { key: 'Tab', run: emmetExpand },
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      longLineExtension,
      langExt,
      oneDark,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && state.currentFile) {
          // ── Transaction-tracking dirty check (O(1), zero allocations) ────
          // doc.version is a monotonically-increasing integer maintained by
          // CodeMirror internally. We simply compare it to the version we
          // recorded when the file was last saved/loaded — no string work at all.
          const currentVersion = update.state.doc.version;
          const cleanVersion   = cleanVersions.get(state.currentFile) ?? -1;
          const isDirtyNow     = currentVersion !== cleanVersion;

          if (isDirtyNow && !state.dirtyFiles.has(state.currentFile)) {
            state.dirtyFiles.add(state.currentFile);
            // patchTabDirty / patchExplorerDirty are imported lazily to avoid
            // a circular dependency at module init time.
            import('./tabs.js').then(m => m.patchTabDirty(state.currentFile));
            import('./explorer.js').then(m => m.patchExplorerDirty(state.currentFile));
          } else if (!isDirtyNow && state.dirtyFiles.has(state.currentFile)) {
            state.dirtyFiles.delete(state.currentFile);
            import('./tabs.js').then(m => m.patchTabDirty(state.currentFile));
            import('./explorer.js').then(m => m.patchExplorerDirty(state.currentFile));
          }
        }

        if (update.selectionSet || update.docChanged) {
          if (typeof window.updateZoomOrigin === 'function') window.updateZoomOrigin();
          
          // Debounced status bar update to prevent UI stutter on high-speed typing
          clearTimeout(window._sbTimeout);
          window._sbTimeout = setTimeout(() => {
            import('./statusbar.js').then(m => m.updateStatus());
          }, 50);
        }
      }),
    ],
  });
}

// ── Singleton EditorView ─────────────────────────────────────────────────────
// A single view is used for the lifetime of the app; switching files swaps
// the EditorState rather than destroying and re-creating the DOM node.
export const view = new EditorView({
  state: createEditorState(''),
  parent: document.getElementById('editor-wrap'),
});
