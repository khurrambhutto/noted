export function createWindowControls({
  appWindow,
  closeButton,
  maximizeButton,
  minimizeButton,
  flushPendingSave,
  status
}) {
  let closingAfterSave = false;

  function bind() {
    minimizeButton?.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      appWindow.minimize();
    });

    maximizeButton?.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      appWindow.toggleMaximize();
    });

    closeButton?.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      closeAfterFlushingSave();
    });

    appWindow.onCloseRequested(async (event) => {
      if (closingAfterSave) return;
      event.preventDefault();
      await closeAfterFlushingSave();
    });
  }

  async function closeAfterFlushingSave() {
    if (closingAfterSave) return;
    closingAfterSave = true;
    try {
      await flushPendingSave();
    } catch (error) {
      console.error('Save before close failed:', error);
      status.show('Save failed');
      closingAfterSave = false;
      return;
    }

    await appWindow.close();
  }

  return {
    bind
  };
}
