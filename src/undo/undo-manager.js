/**
 * Undo/redo manager for textarea content.
 *
 * Uses editor-style undo stops: on the first `beforeinput` event in a change
 * group, the pre-edit state is pushed to the undo stack. The group is sealed
 * after `idleMs` ms of inactivity, by undo/redo, by a note switch, or
 * immediately after atomic edits such as paste/drop.
 *
 * ## Usage
 *
 * ```js
 * const mgr = new UndoManager({
 *   getValue:          () => textarea.value,
 *   setValue:          (v) => { textarea.value = v; },
 *   getSelectionStart: () => textarea.selectionStart,
 *   getSelectionEnd:   () => textarea.selectionEnd,
 *   setSelection:      (s, e) => { textarea.selectionStart = s; textarea.selectionEnd = e; },
 *   getNoteId:         () => currentNote?.id ?? null,
 * });
 *
 * textarea.addEventListener('beforeinput', (e) => mgr.beforeInput(e));
 * textarea.addEventListener('input',      () => mgr.activity());
 *
 * document.addEventListener('keydown', (e) => {
 *   if (e.ctrlKey || e.metaKey) {
 *     if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); mgr.undo(); }
 *     if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); mgr.redo(); }
 *   }
 * });
 * ```
 *
 * @typedef {{ v: string, s: number, e: number }} Snapshot
 */

const DEFAULT_MAX_UNDO = 80;
const DEFAULT_IDLE_MS = 900;

export class UndoManager {
  /**
   * @param {object} source
   * @param {() => string} source.getValue
   * @param {(v: string) => void} source.setValue
   * @param {() => number} source.getSelectionStart
   * @param {() => number} source.getSelectionEnd
   * @param {(start: number, end: number) => void} source.setSelection
   * @param {() => (number|null)} source.getNoteId
   * @param {object} [opts]
   * @param {number} [opts.maxUndo=80]
   * @param {number} [opts.idleMs=900]
   */
  constructor(source, opts = {}) {
    this.#source = source;
    this.#maxUndo = opts.maxUndo ?? DEFAULT_MAX_UNDO;
    this.#idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;

    /** @type {Map<number, { undo: Snapshot[], redo: Snapshot[] }>} */
    this.#stashes = new Map();
    this.#idleTimer = null;
    this.#groupOpen = false;
    this.#lastInputType = null;
    this.#closeAfterInput = false;
  }

  // ── Public API ──

  /**
   * Call on `beforeinput`.
   * Pushes a pre-edit snapshot when a new undo group should start.
   *
   * @param {InputEvent} [event]
   */
  beforeInput(event) {
    const inputType = event?.inputType || 'unknown';
    const startsNewGroup = !this.#groupOpen || this.#isBoundaryInput(inputType);

    if (startsNewGroup) this.#pushUndoStop();

    this.#groupOpen = true;
    this.#lastInputType = inputType;
    this.#closeAfterInput = this.#isAtomicInput(inputType);
  }

  /**
   * Call whenever user activity occurs (input, paste, cut, etc.).
   * Restarts the idle timer that seals the current undo group.
   */
  activity() {
    clearTimeout(this.#idleTimer);
    if (this.#closeAfterInput) {
      this.#closeGroup();
      return;
    }

    this.#idleTimer = setTimeout(() => {
      this.#closeGroup();
    }, this.#idleMs);
  }

  /**
   * Call before switching to a different note.
   * Seals the current undo point and resets for the new note.
   *
   * @param {number} newNoteId
   */
  onNoteSwitch(newNoteId) {
    this.#closeGroup();
    this.#stashOf(newNoteId); // ensure stash exists
  }

  /**
   * Discard all undo/redo history for a note (e.g. when it is deleted).
   *
   * @param {number} noteId
   */
  forget(noteId) {
    this.#stashes.delete(noteId);
  }

  /**
   * Perform undo.
   * @returns {boolean} true if something was undone
   */
  undo() {
    const noteId = this.#source.getNoteId();
    if (noteId == null) return false;

    const { undo, redo } = this.#stashOf(noteId);
    if (undo.length === 0) return false;

    this.#closeGroup();

    // Save current state to redo before restoring
    this.#pushSnapshot(redo, this.#read());

    const snap = /** @type {Snapshot} */ (undo.pop());
    this.#write(snap);
    return true;
  }

  /**
   * Perform redo.
   * @returns {boolean} true if something was redone
   */
  redo() {
    const noteId = this.#source.getNoteId();
    if (noteId == null) return false;

    const { undo, redo } = this.#stashOf(noteId);
    if (redo.length === 0) return false;

    this.#closeGroup();

    // Save current state to undo before restoring
    this.#pushSnapshot(undo, this.#read());

    const snap = /** @type {Snapshot} */ (redo.pop());
    this.#write(snap);
    return true;
  }

  /**
   * Clean up timers.  Call when the app is destroyed.
   */
  destroy() {
    clearTimeout(this.#idleTimer);
    this.#stashes.clear();
  }

  // ── Private ──

  /** @type {UndoManager['source']} */
  #source;

  /** @type {number} */
  #maxUndo;

  /** @type {number} */
  #idleMs;

  /** @type {Map<number, { undo: Snapshot[], redo: Snapshot[] }>} */
  #stashes;

  /** @type {ReturnType<typeof setTimeout> | null} */
  #idleTimer;

  /** @type {boolean} */
  #groupOpen;

  /** @type {string | null} */
  #lastInputType;

  /** @type {boolean} */
  #closeAfterInput;

  /**
   * Read the current canvas state as a Snapshot.
   * @returns {Snapshot}
   */
  #read() {
    return {
      v: this.#source.getValue(),
      s: this.#source.getSelectionStart(),
      e: this.#source.getSelectionEnd(),
    };
  }

  /**
   * Apply a snapshot to the canvas.
   * @param {Snapshot} snap
   */
  #write(snap) {
    this.#source.setValue(snap.v);
    this.#source.setSelection(snap.s, snap.e);
  }

  /**
   * Push the current state as an undo stop and clear the redo stack.
   */
  #pushUndoStop() {
    const noteId = this.#source.getNoteId();
    if (noteId == null) return;

    const { undo, redo } = this.#stashOf(noteId);
    this.#pushSnapshot(undo, this.#read());
    redo.length = 0;
  }

  /**
   * Push a snapshot onto a history stack, avoiding consecutive duplicates.
   * @param {Snapshot[]} stack
   * @param {Snapshot} snap
   */
  #pushSnapshot(stack, snap) {
    if (stack.length > 0 && stack[stack.length - 1].v === snap.v) return;

    stack.push(snap);
    if (stack.length > this.#maxUndo) stack.shift();
  }

  #closeGroup() {
    clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    this.#groupOpen = false;
    this.#lastInputType = null;
    this.#closeAfterInput = false;
  }

  /**
   * A different edit kind should start a new undo group while another group is
   * open. This mirrors the transaction-boundary behavior users expect from
   * editors: typing can coalesce, but a delete, line break, or paste gets its
   * own undo stop.
   * @param {string} inputType
   * @returns {boolean}
   */
  #isBoundaryInput(inputType) {
    if (this.#lastInputType == null || inputType === this.#lastInputType) return false;
    if (this.#isTypingInput(inputType) && this.#isTypingInput(this.#lastInputType)) return false;
    return true;
  }

  /**
   * @param {string} inputType
   * @returns {boolean}
   */
  #isTypingInput(inputType) {
    return inputType === 'insertText' || inputType === 'insertCompositionText';
  }

  /**
   * @param {string} inputType
   * @returns {boolean}
   */
  #isAtomicInput(inputType) {
    return inputType === 'insertFromPaste'
      || inputType === 'insertFromDrop'
      || inputType === 'insertReplacementText'
      || inputType === 'insertFromYank';
  }

  /**
   * Get (or create) the undo/redo stash for a given note id.
   * @param {number} noteId
   * @returns {{ undo: Snapshot[], redo: Snapshot[] }}
   */
  #stashOf(noteId) {
    if (!this.#stashes.has(noteId)) {
      this.#stashes.set(noteId, { undo: [], redo: [] });
    }
    return /** @type {{ undo: Snapshot[], redo: Snapshot[] }} */ (
      this.#stashes.get(noteId)
    );
  }
}
