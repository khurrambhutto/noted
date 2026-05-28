export function createSettingsUi({
  settingsButton,
  settingsPanel,
  shortcutTrigger,
  shortcutBody
}) {
  let shortcutOpen = true;

  function toggleSettings(forceOpen) {
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : settingsPanel.classList.contains('hidden');
    settingsPanel.classList.toggle('hidden', !shouldOpen);
    settingsPanel.setAttribute('aria-hidden', String(!shouldOpen));
    settingsButton.classList.toggle('open', shouldOpen);
    document.documentElement.dataset.settings = shouldOpen ? 'open' : '';
  }

  function toggleShortcut(force) {
    shortcutOpen = typeof force === 'boolean' ? force : !shortcutOpen;
    shortcutTrigger.setAttribute('aria-expanded', String(shortcutOpen));
    shortcutBody.hidden = !shortcutOpen;
  }

  function bind() {
    toggleShortcut(false);

    settingsButton?.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      toggleSettings();
    });

    shortcutTrigger?.addEventListener('click', () => {
      toggleShortcut();
    });

    shortcutTrigger?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleShortcut();
      }
      if (e.key === 'Escape' && shortcutOpen) {
        toggleShortcut(false);
        shortcutTrigger.focus();
      }
    });
  }

  return {
    bind,
    toggleSettings
  };
}
