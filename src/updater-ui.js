export function createUpdaterUi({
  updateBtn,
  updateVersion,
  invoke,
  Channel
}) {
  let updateAvailable = null;

  function bind() {
    updateBtn?.addEventListener('click', async () => {
      if (updateAvailable) {
        try {
          updateBtn.textContent = 'Installing…';
          updateBtn.disabled = true;
          await invoke('plugin:updater|download_and_install', {
            onEvent: new Channel(),
            rid: updateAvailable.rid
          });
          await invoke('plugin:process|restart');
        } catch (err) {
          console.error('Update install failed:', err);
          updateBtn.textContent = 'Install failed';
          updateBtn.disabled = false;
          updateBtn.classList.remove('install');
          updateAvailable = null;
        }
      } else {
        checkForUpdates();
      }
    });
  }

  async function checkForUpdates() {
    try {
      const metadata = await invoke('plugin:updater|check');

      if (metadata) {
        updateAvailable = metadata;
        updateBtn.textContent = 'Install Update';
        updateBtn.classList.add('install');
        updateVersion.textContent = metadata.version ? `v${metadata.version}` : 'v0.1.7';
      } else {
        updateAvailable = null;
        updateBtn.textContent = 'Up to date';
        updateBtn.classList.remove('install');
        updateBtn.disabled = true;
        setTimeout(() => {
          updateBtn.textContent = 'Check for Updates';
          updateBtn.disabled = false;
        }, 3000);
      }
    } catch (err) {
      console.error('Update check failed:', err);
      updateBtn.textContent = 'Could not check';
      updateBtn.disabled = true;
      setTimeout(() => {
        updateBtn.textContent = 'Check for Updates';
        updateBtn.disabled = false;
      }, 3000);
    }
  }

  return {
    bind
  };
}
