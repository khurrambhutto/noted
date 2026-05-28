export function bindKeyboardShortcuts({
  document,
  navigation,
  notes,
  settings,
  undoManager
}) {
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (undoManager.undo()) notes.saveCurrentNote().catch(() => {});
      return;
    }
    if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (undoManager.redo()) notes.saveCurrentNote().catch(() => {});
      return;
    }
    if (mod && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      if (undoManager.redo()) notes.saveCurrentNote().catch(() => {});
      return;
    }

    if (e.key === 'Escape') settings.toggleSettings(false);

    if (mod && e.shiftKey) {
      if (e.key === ']') {
        e.preventDefault();
        navigation.slideToNext();
      }
      if (e.key === '[') {
        e.preventDefault();
        navigation.slideToPrev();
      }
    }
  });
}
