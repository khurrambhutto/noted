import {
  applyTheme,
  getActiveThemeName,
  getThemeLoadWarnings,
  loadThemes,
  saveImportedTheme,
  setActiveThemeName,
  validateAntinoteTheme
} from './themes.js';

export function createThemeUi({
  dropdownTrigger,
  dropdownPanel,
  dropdownLabel,
  importThemeButton,
  themeFileInput,
  status
}) {
  let themes = [];
  let activeTheme = null;
  let dropdownOpen = false;

  async function init() {
    themes = await loadThemes();
    const preferredName = getActiveThemeName();
    activeTheme = themes.find((theme) => theme.name === preferredName) || themes[0];
    applyTheme(activeTheme);
    renderThemeSelect();

    const warnings = getThemeLoadWarnings();
    if (warnings.length > 0) {
      status.show(warnings.length === 1 ? warnings[0] : `Skipped ${warnings.length} invalid themes`);
    }
  }

  function bind() {
    dropdownTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    dropdownTrigger?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleDropdown();
      }
      if (e.key === 'Escape' && dropdownOpen) {
        closeDropdown();
        dropdownTrigger.focus();
      }
    });

    document.addEventListener('click', (e) => {
      if (dropdownOpen && !e.target.closest('.theme-dropdown')) {
        closeDropdown();
      }
    });

    importThemeButton?.addEventListener('click', () => themeFileInput.click());
    themeFileInput?.addEventListener('change', (e) => {
      const [file] = e.target.files || [];
      if (file) importThemeFile(file);
    });
  }

  function closeDropdown() {
    dropdownOpen = false;
    dropdownTrigger.setAttribute('aria-expanded', 'false');
    dropdownPanel.hidden = true;
  }

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
    dropdownTrigger.setAttribute('aria-expanded', String(dropdownOpen));
    dropdownPanel.hidden = !dropdownOpen;
  }

  function renderThemeSelect() {
    dropdownLabel.textContent = activeTheme.name;
    dropdownPanel.innerHTML = themes
      .map((theme) => {
        const selected = theme.name === activeTheme.name;
        const checkSvg = `<svg class="theme-option-check-icon" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const swatches = `<span class="theme-option-swatches" aria-hidden="true">
          <span class="theme-swatch" style="--swatch-color: ${escapeHtml(theme.background)}"></span>
          <span class="theme-swatch" style="--swatch-color: ${escapeHtml(theme.typeMain)}"></span>
          <span class="theme-swatch theme-swatch-accent" style="--swatch-color: ${escapeHtml(theme.accent1Main)}"></span>
        </span>`;
        return `<button class="theme-dropdown-option" role="option" aria-selected="${selected}" data-value="${escapeHtml(theme.name)}">
          <span class="theme-option-check">${selected ? checkSvg : ''}</span>
          ${swatches}
          <span class="theme-option-label">${escapeHtml(theme.name)}</span>
        </button>`;
      })
      .join('');
    dropdownPanel.querySelectorAll('.theme-dropdown-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        setThemeByName(btn.dataset.value);
        closeDropdown();
        dropdownTrigger.focus();
      });
    });
  }

  function setThemeByName(name) {
    const theme = themes.find((item) => item.name === name);
    if (!theme) return;
    activeTheme = theme;
    applyTheme(theme);
    setActiveThemeName(theme.name);
    renderThemeSelect();
  }

  async function importThemeFile(file) {
    try {
      const raw = await file.text();
      const imported = validateAntinoteTheme(JSON.parse(raw));
      const existingIndex = themes.findIndex((theme) => theme.name === imported.name);

      if (existingIndex >= 0) {
        themes[existingIndex] = imported;
      } else {
        themes.push(imported);
      }

      await saveImportedTheme(imported);
      setThemeByName(imported.name);
      status.show(`Imported ${imported.name}`);
    } catch (error) {
      console.error(error);
      status.show('Theme import failed');
    } finally {
      themeFileInput.value = '';
    }
  }

  return {
    bind,
    init
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"'`]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#x60;'
  }[char]));
}
