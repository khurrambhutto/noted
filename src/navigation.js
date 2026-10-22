const SWIPE_THRESHOLD = 80;
const GESTURE_TIMEOUT = 200;

export function createNavigation({
  editor,
  container,
  notes,
  status,
  canNavigate = () => true
}) {
  let animating = false;
  let navigating = false;
  let accumulatedX = 0;
  let gestureTimer = null;
  let gestureLocked = false;

  async function navigate(direction) {
    if (navigating || !canNavigate() || (direction === 'prev' && notes.isAtFirstNote())) return;
    // Lock before the first save so opening Links cannot race a note switch.
    navigating = true;
    try {
      const deleted = await notes.deleteIfEmpty();
      let nextDocument = notes.getCurrentDocument();
      if (!deleted) {
        nextDocument = direction === 'next'
          ? await (notes.isAtLastNote() ? notes.appendNoteAfterSave() : notes.moveToNextAfterSave())
          : await notes.moveToPrevAfterSave();
      }
      const side = direction === 'next' ? 'left' : 'right';
      await animateSwap(`slide-${side}-out`, `slide-${side}-in`, nextDocument);
      notes.updateIndicator();
    } catch (error) {
      console.error('Navigation failed:', error);
      status.show('Could not switch notes');
    } finally {
      navigating = false;
    }
  }

  function slideToNext() {
    return navigate('next');
  }

  function slideToPrev() {
    return navigate('prev');
  }

  function bindWheel() {
    container.addEventListener('wheel', (e) => {
      if (!canNavigate()) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

      e.preventDefault();

      if (gestureLocked || animating) return;

      accumulatedX += e.deltaX;

      if (gestureTimer) clearTimeout(gestureTimer);
      gestureTimer = setTimeout(() => {
        accumulatedX = 0;
        gestureLocked = false;
      }, GESTURE_TIMEOUT);

      if (Math.abs(accumulatedX) >= SWIPE_THRESHOLD) {
        gestureLocked = true;
        if (accumulatedX > 0) {
          slideToNext();
        } else {
          slideToPrev();
        }
        accumulatedX = 0;

        setTimeout(() => {
          gestureLocked = false;
        }, 400);
      }
    }, { passive: false });
  }

  function animateSwap(outClass, inClass, newDocument) {
    return new Promise((resolve) => {
      animating = true;

      editor.applyTransition(outClass, true);

      setTimeout(() => {
        editor.setDocument(newDocument.content, newDocument.id);
        editor.scrollToTop();

        editor.applyTransition(outClass, false);
        editor.applyTransition(inClass, true);

        editor.getRootElement().offsetHeight;

        editor.applyTransition(inClass, false);

        setTimeout(() => {
          animating = false;
          editor.focus();
          resolve();
        }, 200);
      }, 150);
    });
  }

  return {
    bindWheel,
    isBusy: () => navigating,
    slideToNext,
    slideToPrev
  };
}
