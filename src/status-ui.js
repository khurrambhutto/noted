export function createStatusController(appStatus) {
  let statusTimeout = null;

  function show(message) {
    if (!appStatus) return;
    if (statusTimeout) clearTimeout(statusTimeout);
    appStatus.textContent = message;
    appStatus.classList.add('visible');
    statusTimeout = setTimeout(() => {
      appStatus.classList.remove('visible');
    }, 3200);
  }

  return { show };
}
