/**
 * Undo/redo manager for textarea content.
 *
 * Uses an idle-snapshot strategy: on the first "beforeinput" event after an
 * idle pause, undo, redo, or note switch, the current state is pushed to the
 * undo stack BEFORE the edit occurs.  The undo group is sealed after
 * `idleMs` ms of inactivity.
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
 * textarea.addEventListener('beforeinput', () => mgr.beforeInput());
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
    this.#lastSnapValue = null;
    this.#needsSnapshot = true;
  }

  // ── Public API ──

  /**
   * Call on `beforeinput`.
   * Pushes a pre-edit snapshot if a new undo group should start.
   */
  beforeInput() {
    if (this.#needsSnapshot) this.#push();
  }

  /**
   * Call whenever user activity occurs (input, paste, cut, etc.).
   * Restarts the idle timer that seals the current undo group.
   */
  activity() {
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      this.#push();
      this.#needsSnapshot = true;
    }, this.#idleMs);
  }

  /**
   * Call before switching to a different note.
   * Seals the current undo point and resets for the new note.
   *
   * @param {number} newNoteId
   */
  onNoteSwitch(newNoteId) {
    this.#push();
    clearTimeout(this.#idleTimer);
    this.#lastSnapValue = null;
    this.#needsSnapshot = true;
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

    // Save current state to redo before restoring
    redo.push(this.#read());

    const snap = /** @type {Snapshot} */ (undo.pop());
    this.#write(snap);
    this.#lastSnapValue = snap.v;
    this.#needsSnapshot = true;
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

    // Save current state to undo before restoring
    undo.push(this.#read());

    const snap = /** @type {Snapshot} */ (redo.pop());
    this.#write(snap);
    this.#lastSnapValue = snap.v;
    this.#needsSnapshot = true;
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

  /** @type {string | null} */
  #lastSnapValue;

  /** @type {boolean} */
  #needsSnapshot;

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
   * Push the current state onto the undo stack and clear the redo stack.
   * Skips if the value hasn't changed since last snapshot.
   */
  #push() {
    const noteId = this.#source.getNoteId();
    if (noteId == null) return;

    const { v, s, e } = this.#read();

    // Skip if the value is identical to the last snapshot
    if (this.#lastSnapValue === v) return;

    const undo = this.#stashOf(noteId).undo;

    // Skip if the last entry already has this value (prevents consecutive dupes)
    if (undo.length > 0 && undo[undo.length - 1].v === v) return;

    undo.push({ v, s, e });
    if (undo.length > this.#maxUndo) undo.shift();

    // Clear redo — new edit invalidates redo history
    this.#stashOf(noteId).redo.length = 0;

    this.#lastSnapValue = v;
    this.#needsSnapshot = false;
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
