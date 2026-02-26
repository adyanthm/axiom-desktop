import { EditorState } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers,
  highlightActiveLine, highlightActiveLineGutter, drawSelection,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { searchKeymap, search } from '@codemirror/search';
import { state } from './state.js';

// ── Editor State Factory ─────────────────────────────────────────────────────
// Creates a fresh CodeMirror EditorState for a given document + language extension.
// The updateListener handles the dirty-flag logic so the tab/explorer dot stays
// in sync without a full re-render on every keystroke.
export function createEditorState(content, langExt = []) {
  return EditorState.create({
    doc: content,
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      drawSelection(),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      autocompletion(),
      search({ top: true }),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      langExt,
      oneDark,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && state.currentFile) {
          const newContent   = update.state.doc.toString();
          const savedContent = state.fileContents.get(state.currentFile) ?? '';
          const isDirtyNow   = newContent !== savedContent;

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
          import('./statusbar.js').then(m => m.updateStatus());
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
