const SWIPE_THRESHOLD = 80;
const GESTURE_TIMEOUT = 200;

export function createNavigation({
  canvas,
  container,
  notes
}) {
  let animating = false;
  let accumulatedX = 0;
  let gestureTimer = null;
  let gestureLocked = false;

  async function slideToNext() {
    if (animating) return;

    const deleted = await notes.deleteIfEmpty();

    if (deleted) {
      await animateSwap('slide-left-out', 'slide-left-in', notes.getCurrentContent());
      notes.updateIndicator();
      return;
    }

    const newContent = notes.isAtLastNote()
      ? await notes.appendNoteAfterSave()
      : await notes.moveToNextAfterSave();

    await animateSwap('slide-left-out', 'slide-left-in', newContent);
    notes.updateIndicator();
  }

  async function slideToPrev() {
    if (animating || notes.isAtFirstNote()) return;

    const deleted = await notes.deleteIfEmpty();

    if (deleted) {
      await animateSwap('slide-right-out', 'slide-right-in', notes.getCurrentContent());
      notes.updateIndicator();
      return;
    }

    const newContent = await notes.moveToPrevAfterSave();
    await animateSwap('slide-right-out', 'slide-right-in', newContent);
    notes.updateIndicator();
  }

  function bindWheel() {
    container.addEventListener('wheel', (e) => {
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

  function animateSwap(outClass, inClass, newContent) {
    return new Promise((resolve) => {
      animating = true;

      canvas.classList.add(outClass);

      setTimeout(() => {
        canvas.value = newContent;
        canvas.scrollTop = 0;

        canvas.classList.remove(outClass);
        canvas.classList.add(inClass);

        canvas.offsetHeight;

        canvas.classList.remove(inClass);

        setTimeout(() => {
          animating = false;
          canvas.focus();
          resolve();
        }, 200);
      }, 150);
    });
  }

  return {
    bindWheel,
    slideToNext,
    slideToPrev
  };
}
