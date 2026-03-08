import { StateField, StateEffect, RangeSet } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';
import { state as appState } from './state.js';

// An effect to add or remove breakpoints
export const toggleBreakpointEffect = StateEffect.define();

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-breakpoint-marker';
    el.innerHTML = '<i class="fa-solid fa-circle"></i>';
    return el;
  }
}

const breakpointMarker = new BreakpointMarker();

// StateField representing breakpoints (a RangeSet of line positions)
export const breakpointState = StateField.define({
  create() {
    return RangeSet.empty;
  },
  update(set, tr) {
    set = set.map(tr.changes);
    for (let e of tr.effects) {
      if (e.is(toggleBreakpointEffect)) {
        if (e.value.on) {
            set = set.update({ add: [breakpointMarker.range(e.value.pos)] });
        } else {
            set = set.update({ filter: from => from !== e.value.pos });
        }
      }
    }
    return set;
  }
});

function toggleBreakpoint(view, pos) {
  // We need to keep our `appState` synced with CodeMirror's RangeSet.
  // When debugging starts, `debug.js` will read `appState.breakpoints` to send to Python.
  const line = view.state.doc.lineAt(pos);
  const filePath = appState.currentFile;
  
  if (!appState.breakpoints) appState.breakpoints = new Map();
  if (!appState.breakpoints.has(filePath)) appState.breakpoints.set(filePath, new Set());
  
  const fileBreakpoints = appState.breakpoints.get(filePath);
  const lineNum = line.number;
  
  let hasBreakpoint = false;
  let effects = [];
  
  view.state.field(breakpointState).between(line.from, line.from, () => { hasBreakpoint = true; });

  if (hasBreakpoint) {
    effects.push(toggleBreakpointEffect.of({ pos: line.from, on: false }));
    fileBreakpoints.delete(lineNum);
  } else {
    effects.push(toggleBreakpointEffect.of({ pos: line.from, on: true }));
    fileBreakpoints.add(lineNum);
  }

  view.dispatch({ effects });
}

export const breakpointGutter = [
  breakpointState,
  gutter({
    class: 'cm-breakpoint-gutter',
    markers: v => v.state.field(breakpointState),
    initialSpacer: () => breakpointMarker,
    domEventHandlers: {
      mousedown(view, line) {
        toggleBreakpoint(view, line.from);
        return true;
      }
    }
  })
];

// Helper to pull all active breakpoints for a specific file when the debugger starts
export function getBreakpointsForFile(filePath) {
   if (!appState.breakpoints || !appState.breakpoints.has(filePath)) return [];
   return Array.from(appState.breakpoints.get(filePath));
}

// ── Active Line Indicator ───────────────────────────────────────────────────
import { Decoration } from '@codemirror/view';

export const setDebugLineEffect = StateEffect.define();

const debugLineMark = Decoration.line({
  attributes: { class: 'cm-debug-active-line' }
});

export const debugLineState = StateField.define({
  create() { return Decoration.none; },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (let e of tr.effects) {
      if (e.is(setDebugLineEffect)) {
        // If line is > 0, set it. Otherwise clear it.
        if (e.value > 0 && e.value <= tr.state.doc.lines) {
           const pos = tr.state.doc.line(e.value).from;
           deco = Decoration.set([debugLineMark.range(pos)]);
        } else {
           deco = Decoration.none;
        }
      }
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f)
});

// We need to import EditorView here for the provide hook
import { EditorView } from '@codemirror/view';

export function highlightDebugLine(view, lineNumber) {
    if (!view) return;
    view.dispatch({
        effects: setDebugLineEffect.of(lineNumber)
    });
}
