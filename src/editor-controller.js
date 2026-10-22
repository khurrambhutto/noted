import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, redo, undo } from '@codemirror/commands';
import { activeEditorModeField, createEditorFeatureExtensions } from './editor-features/index.js';

export function createEditorController({
  mount,
  initialValue = '',
  disabled = true
}) {
  const editableCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const callbacks = new Set();
  const statesByDocument = new Map();
  let currentDocumentKey = null;
  let isDisabled = disabled;

  function baseExtensions() {
    return [
      history(),
      keymap.of([
        ...defaultKeymap
      ]),
      EditorView.lineWrapping,
      placeholder('Start typing...'),
      editableCompartment.of(EditorView.editable.of(!isDisabled)),
      readOnlyCompartment.of(EditorState.readOnly.of(isDisabled)),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        for (const callback of callbacks) callback(update);
      }),
      createEditorFeatureExtensions()
    ];
  }

  const extensions = baseExtensions();

  function createState(doc) {
    // Fresh compartment defaults must reflect the CURRENT disabled flag:
    // view.setState() installs these defaults verbatim, so a stale default
    // would leave a new note read-only with no later fixup.
    return EditorState.create({
      doc,
      extensions: isDisabled ? extensions : baseExtensions()
    });
  }

  const view = new EditorView({
    state: createState(initialValue),
    parent: mount
  });
  mount.classList.toggle('is-disabled', isDisabled);

  function rememberCurrentState() {
    if (currentDocumentKey == null) return;
    statesByDocument.set(currentDocumentKey, view.state);
  }

  function stateForDocument(value, documentKey) {
    if (documentKey == null) return createState(value);

    const existing = statesByDocument.get(documentKey);
    if (existing && existing.doc.toString() === value) return existing;
    return createState(value);
  }

  function setValue(value) {
    const current = view.state.doc.toString();
    if (current === value) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false)
    });
  }

  function setDocument(value, documentKey) {
    rememberCurrentState();
    currentDocumentKey = documentKey ?? null;
    view.setState(stateForDocument(value, currentDocumentKey));
    setDisabled(isDisabled);
  }

  function setDisabled(nextDisabled) {
    nextDisabled = Boolean(nextDisabled);
    if (isDisabled === nextDisabled) return;
    isDisabled = nextDisabled;
    mount.classList.toggle('is-disabled', isDisabled);
    view.dispatch({
      effects: [
        editableCompartment.reconfigure(EditorView.editable.of(!isDisabled)),
        readOnlyCompartment.reconfigure(EditorState.readOnly.of(isDisabled))
      ],
      annotations: Transaction.addToHistory.of(false)
    });
  }

  function consumeLineCommand(command) {
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.head);
    if (!selection.empty || line.text.trim() !== command) return false;
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } });
    return true;
  }

  function getSelection() {
    const selection = view.state.selection.main;
    return {
      anchor: selection.anchor,
      head: selection.head
    };
  }

  function setSelection(anchor, head = anchor) {
    view.dispatch({
      selection: { anchor, head },
      scrollIntoView: true,
      annotations: Transaction.addToHistory.of(false)
    });
  }

  function replaceRange(from, to, text) {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true
    });
  }

  function applyTransition(className, enabled = true) {
    mount.classList.toggle(className, enabled);
  }

  return {
    applyTransition,
    consumeLineCommand,
    focus: () => view.focus(),
    getCursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    getMode: () => view.state.field(activeEditorModeField),
    getRootElement: () => mount,
    getScrollerElement: () => view.scrollDOM,
    getSelection,
    getValue: () => view.state.doc.toString(),
    isFocused: () => view.hasFocus,
    onChange(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    redo: () => redo({ state: view.state, dispatch: view.dispatch }),
    replaceRange,
    scrollToTop: () => { view.scrollDOM.scrollTop = 0; },
    setDisabled,
    setDocument,
    setSelection,
    setValue,
    undo: () => undo({ state: view.state, dispatch: view.dispatch })
  };
}
