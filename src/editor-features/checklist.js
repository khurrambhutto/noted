import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { activeEditorModeField } from './mode-detector.js';

const CHECK_TRIGGER_REGEX = /\s*\/x\s*$/i;
const HEADING_REGEX = /^#{1,3}(?:\s|$)/;

function isChecklistLine(text) {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  return !trimmed.startsWith('//') && !HEADING_REGEX.test(trimmed);
}

function isCheckedLine(text) {
  return CHECK_TRIGGER_REGEX.test(text);
}

class ChecklistBoxWidget extends WidgetType {
  constructor(lineFrom, checked) {
    super();
    this.lineFrom = lineFrom;
    this.checked = checked;
  }

  eq(other) {
    return other.lineFrom === this.lineFrom && other.checked === this.checked;
  }

  toDOM(view) {
    const button = document.createElement('button');
    button.className = `checklist-box${this.checked ? ' is-checked' : ''}`;
    button.type = 'button';
    button.tabIndex = -1;
    button.setAttribute('aria-label', this.checked ? 'Mark item unchecked' : 'Mark item checked');
    button.setAttribute('aria-pressed', String(this.checked));

    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleChecklistLine(view, this.lineFrom);
      view.focus();
    });

    return button;
  }

  ignoreEvent(event) {
    return event.type === 'mousedown' || event.type === 'mouseup' || event.type === 'click';
  }
}

function toggleChecklistLine(view, lineFrom) {
  const line = view.state.doc.lineAt(lineFrom);
  const match = line.text.match(CHECK_TRIGGER_REGEX);

  if (match) {
    view.dispatch({
      changes: {
        from: line.to - match[0].length,
        to: line.to,
        insert: ''
      }
    });
    return;
  }

  const trailingWhitespace = line.text.match(/\s*$/)[0].length;
  const insertFrom = line.to - trailingWhitespace;
  const marker = line.text.trim() === '' ? '/x' : ' /x';
  view.dispatch({
    changes: {
      from: insertFrom,
      to: line.to,
      insert: marker
    }
  });
}

function buildChecklistDecorations(view) {
  const builder = new RangeSetBuilder();
  if (view.state.field(activeEditorModeField) !== 'list') return builder.finish();

  const firstLine = view.state.doc.line(1);
  const keywordStart = firstLine.from + firstLine.text.search(/\S/);
  if (keywordStart >= firstLine.from) {
    builder.add(
      keywordStart,
      keywordStart + 'list'.length,
      Decoration.mark({ class: 'editor-mode-keyword editor-mode-keyword-list' })
    );
  }

  for (let lineNumber = 2; lineNumber <= view.state.doc.lines; lineNumber++) {
    const line = view.state.doc.line(lineNumber);
    if (!isChecklistLine(line.text)) continue;

    const checked = isCheckedLine(line.text);
    builder.add(
      line.from,
      line.from,
      Decoration.widget({
        widget: new ChecklistBoxWidget(line.from, checked),
        side: -1
      })
    );

    if (checked) {
      builder.add(line.from, line.to, Decoration.mark({ class: 'checklist-line-checked' }));
    }
  }

  return builder.finish();
}

export const checklistField = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = buildChecklistDecorations(view);
  }

  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildChecklistDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations
});
