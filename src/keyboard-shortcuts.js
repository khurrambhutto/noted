export function bindKeyboardShortcuts({
  document,
  editor,
  navigation,
  notes,
  settings,
  links
}) {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const settingsOpen = document.documentElement.dataset.settings === 'open';

    if (mod && e.shiftKey && !e.altKey && key === 'v') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) links.saveClipboard();
      return;
    }

    if (mod && e.shiftKey && !e.altKey && key === 'l') {
      e.preventDefault();
      if (!e.repeat) links.open();
      return;
    }

    if (e.key === 'Escape') {
      if (settingsOpen) settings.toggleSettings(false);
      else if (links.isActive()) links.close();
      return;
    }

    if (settingsOpen || links.isActive() || !editor.isFocused()) return;

    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && editor.consumeLineCommand('/links')) {
      e.preventDefault();
      e.stopPropagation();
      links.open();
      return;
    }

    if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (editor.undo()) notes.saveCurrentNote().catch(() => {});
      return;
    }
    if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (editor.redo()) notes.saveCurrentNote().catch(() => {});
      return;
    }
    if (mod && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      if (editor.redo()) notes.saveCurrentNote().catch(() => {});
      return;
    }

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
  }, { capture: true });
}
