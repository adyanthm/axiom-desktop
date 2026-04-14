import { Compartment } from '@codemirror/state';
import { closeBrackets } from '@codemirror/autocomplete';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { view } from './editor.js';
import { getStore } from './store.js';

export const autoCloseCompartment = new Compartment();
export const indentGuidesCompartment = new Compartment();

export let stateFeatures = {
  autoClose: true,
  indentGuides: true
};

export async function initFeatures() {
  const store = await getStore();
  if (store) {
    let changed = false;
    const ac = await store.get('feature_autoClose');
    if (typeof ac === 'boolean' && ac !== stateFeatures.autoClose) {
      stateFeatures.autoClose = ac;
      changed = true;
    }
    const ig = await store.get('feature_indentGuides');
    if (typeof ig === 'boolean' && ig !== stateFeatures.indentGuides) {
      stateFeatures.indentGuides = ig;
      changed = true;
    }
    if (changed) {
      _applyToAllFiles();
    }
  }
}

export function autoCloseCompartmentInit() {
  return autoCloseCompartment.of(stateFeatures.autoClose ? closeBrackets() : []);
}

export function indentGuidesCompartmentInit() {
  return indentGuidesCompartment.of(stateFeatures.indentGuides ? indentationMarkers() : []);
}

export async function toggleAutoClose() {
  stateFeatures.autoClose = !stateFeatures.autoClose;
  const store = await getStore();
  if (store) {
    await store.set('feature_autoClose', stateFeatures.autoClose);
    await store.save();
  }
  _applyToAllFiles();
}

export async function toggleIndentGuides() {
  stateFeatures.indentGuides = !stateFeatures.indentGuides;
  const store = await getStore();
  if (store) {
    await store.set('feature_indentGuides', stateFeatures.indentGuides);
    await store.save();
  }
  _applyToAllFiles();
}

function _applyToAllFiles() {
  import('./state.js').then(m => {
    const effect1 = autoCloseCompartment.reconfigure(stateFeatures.autoClose ? closeBrackets() : []);
    const effect2 = indentGuidesCompartment.reconfigure(stateFeatures.indentGuides ? indentationMarkers() : []);
    
    if (view) {
      view.dispatch({ effects: [effect1, effect2] });
    }
    
    for (const [path, editorState] of m.state.fileEditorStates.entries()) {
      if (path !== m.state.currentFile) {
        m.state.fileEditorStates.set(path, editorState.update({ effects: [effect1, effect2] }).state);
      }
    }
  });
}
