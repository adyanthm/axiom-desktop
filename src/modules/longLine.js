import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { ViewPlugin, Decoration, WidgetType } from '@codemirror/view';

// ── Config ────────────────────────────────────────────────────────────────────
// Characters per line before truncation kicks in.  Matches VS Code's default.
export const LONG_LINE_LIMIT = 10_000;

// ── State: which lines are manually expanded ──────────────────────────────────
// Stores the `line.from` character offset for every line the user has clicked
// "Load full line" on.  Using the start-offset (not the line number) means we
// don't need to remap on trivial cursor moves, though we do clear on any doc
// change because offsets become invalid the moment text is inserted/deleted.

export const expandLineEffect = StateEffect.define();

export const expandedLinesField = StateField.define({
  create: () => new Set(),
  update(expanded, tr) {
    // Any document mutation invalidates all stored offsets.
    if (tr.docChanged) return new Set();
    let next = expanded;
    for (const effect of tr.effects) {
      if (effect.is(expandLineEffect)) {
        if (next === expanded) next = new Set(expanded); // copy-on-write
        next.add(effect.value);
      }
    }
    return next;
  },
});

// ── Widget rendered at the truncation point ───────────────────────────────────
class LongLineBadge extends WidgetType {
  constructor(lineFrom, charsHidden) {
    super();
    this.lineFrom   = lineFrom;
    this.charsHidden = charsHidden;
  }

  eq(other) {
    return this.lineFrom === other.lineFrom && this.charsHidden === other.charsHidden;
  }

  toDOM(view) {
    const wrap  = document.createElement('span');
    wrap.className = 'cm-ll-wrap';

    const badge = document.createElement('span');
    badge.className = 'cm-ll-badge';
    badge.textContent =
      `\u26a1 ${this.charsHidden.toLocaleString()} chars not shown`;

    const btn = document.createElement('button');
    btn.className   = 'cm-ll-btn';
    btn.textContent = 'Load full line';
    btn.title       = 'Expand this line (may freeze the editor for very long lines)';

    // Dispatch the expand effect when clicked.
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus in editor
      view.dispatch({ effects: expandLineEffect.of(this.lineFrom) });
    });

    wrap.append(badge, btn);
    return wrap;
  }

  // Let clicks through to the button's own handler.
  ignoreEvent() { return false; }
}

// ── ViewPlugin: builds Replace decorations for every truncated line ───────────
const longLinePlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this._build(view);
    }

    update(update) {
      // Rebuild only when viewport, document, or the expanded set changes.
      const expandChanged = update.transactions.some(tr =>
        tr.effects.some(e => e.is(expandLineEffect)),
      );
      if (update.docChanged || update.viewportChanged || expandChanged) {
        this.decorations = this._build(update.view);
      }
    }

    _build(view) {
      const builder  = new RangeSetBuilder();
      const expanded = view.state.field(expandedLinesField);

      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);

          if (line.length > LONG_LINE_LIMIT && !expanded.has(line.from)) {
            const cutoff      = line.from + LONG_LINE_LIMIT;
            const charsHidden = line.to - cutoff;

            // Replace everything from cutoff → line end with the badge widget.
            // This means CodeMirror never renders those characters as DOM text
            // nodes, and the Lezer parser receives a shorter surface to tokenize.
            builder.add(
              cutoff,
              line.to,
              Decoration.replace({
                widget:    new LongLineBadge(line.from, charsHidden),
                inclusive: false,
              }),
            );
          }

          pos = line.to + 1;
          if (pos > to) break;
        }
      }

      return builder.finish();
    }
  },
  { decorations: instance => instance.decorations },
);

// ── Public export ─────────────────────────────────────────────────────────────
// Add this to any EditorState's extension list.
export const longLineExtension = [expandedLinesField, longLinePlugin];
