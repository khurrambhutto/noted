import {
  applyTheme,
  getActiveThemeName,
  loadThemes,
  saveImportedTheme,
  setActiveThemeName,
  validateAntinoteTheme
} from './themes.js';
import { UndoManager } from './undo/undo-manager.js';

const { invoke, Channel } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();

// ── State ──
let notes = [];
let currentIndex = 0;
let saveTimeout = null;
let animating = false;
let themes = [];
let activeTheme = null;
let undoManager = null;

// ── DOM ──
const canvas = document.getElementById('note-canvas');
const container = document.getElementById('canvas-container');
const indicator = document.getElementById('note-indicator');
const settingsButton = document.getElementById('btn-settings');
const settingsPanel = document.getElementById('settings-panel');

const importThemeButton = document.getElementById('btn-import-theme');
const themeFileInput = document.getElementById('theme-file-input');
// ── Custom Theme Dropdown ──
const dropdownTrigger = document.getElementById('theme-dropdown-trigger');
const dropdownPanel = document.getElementById('theme-dropdown-panel');
const dropdownLabel = document.getElementById('theme-dropdown-label');
let dropdownOpen = false;

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

// ── Theme System (Antinote JSON compatible) ──

async function initThemes() {
  themes = await loadThemes();
  const preferredName = getActiveThemeName();
  activeTheme = themes.find((theme) => theme.name === preferredName) || themes[0];
  applyTheme(activeTheme);
  renderThemeSelect();
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
  } catch (error) {
    console.error(error);
  } finally {
    themeFileInput.value = '';
  }
}

function toggleSettings(forceOpen) {
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : settingsPanel.classList.contains('hidden');
  settingsPanel.classList.toggle('hidden', !shouldOpen);
  settingsPanel.setAttribute('aria-hidden', String(!shouldOpen));
  settingsButton.classList.toggle('open', shouldOpen);
  document.documentElement.dataset.settings = shouldOpen ? 'open' : '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[char]));
}

// ── Load & Render ──

async function loadNotes() {
  notes = await invoke('list_notes');
  if (notes.length === 0) {
    const note = await invoke('create_note');
    notes = [note];
  }
  currentIndex = 0;
  renderCurrentNote(false);
}

function renderCurrentNote(animate) {
  if (animate) return; // animated transitions handle their own rendering
  canvas.value = notes[currentIndex]?.content || '';
  updateIndicator();
}

function updateIndicator() {
  if (notes.length <= 1) {
    indicator.classList.remove('visible');
    indicator.innerHTML = '';
    return;
  }

  indicator.classList.add('visible');

  if (notes.length <= 12) {
    let html = '';
    for (let i = 0; i < notes.length; i++) {
      html += `<div class="dot${i === currentIndex ? ' active' : ''}"></div>`;
    }
    indicator.innerHTML = html;
  } else {
    indicator.innerHTML = `<span class="note-count">${currentIndex + 1} / ${notes.length}</span>`;
  }
}

// ── Save ──

function saveCurrentNote() {
  const note = notes[currentIndex];
  if (!note) return;
  const content = canvas.value;
  notes[currentIndex].content = content;
  invoke('save_note', { id: note.id, content });
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveCurrentNote(), 300);
  undoManager.activity();
}

// ── Animation helper ──

function prepareForNoteSwitch(newNoteId) {
  undoManager.onNoteSwitch(newNoteId);
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

// ── Delete empty note helper ──

async function deleteIfEmpty() {
  const content = canvas.value.trim();
  if (content === '' && notes.length > 1) {
    const note = notes[currentIndex];
    undoManager.forget(note.id);
    await invoke('delete_note', { id: note.id });
    notes.splice(currentIndex, 1);
    if (currentIndex >= notes.length) currentIndex = notes.length - 1;
    return true;
  }
  return false;
}

// ── Slide ──

async function slideToNext() {
  if (animating) return;

  const deleted = await deleteIfEmpty();

  if (deleted) {
    await animateSwap('slide-left-out', 'slide-left-in', notes[currentIndex].content);
    updateIndicator();
    return;
  }

  if (currentIndex >= notes.length - 1) {
    saveCurrentNote();
    const newNote = await invoke('create_note');
    notes.push(newNote);
    prepareForNoteSwitch(newNote.id);
    currentIndex = notes.length - 1;
    await animateSwap('slide-left-out', 'slide-left-in', '');
  } else {
    saveCurrentNote();
    prepareForNoteSwitch(notes[currentIndex + 1].id);
    currentIndex++;
    await animateSwap('slide-left-out', 'slide-left-in', notes[currentIndex].content);
  }

  updateIndicator();
}

async function slideToPrev() {
  if (animating || currentIndex <= 0) return;

  const deleted = await deleteIfEmpty();

  if (deleted) {
    await animateSwap('slide-right-out', 'slide-right-in', notes[currentIndex].content);
    updateIndicator();
    return;
  }

  saveCurrentNote();
  prepareForNoteSwitch(notes[currentIndex - 1].id);
  currentIndex--;
  await animateSwap('slide-right-out', 'slide-right-in', notes[currentIndex].content);
  updateIndicator();
}

// ── Swipe Gesture (trackpad two-finger) ──

let accumulatedX = 0;
let gestureTimer = null;
let gestureLocked = false;
const SWIPE_THRESHOLD = 80;
const GESTURE_TIMEOUT = 200;

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

// ── Keyboard shortcuts ──

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;

  // Undo / Redo
  if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undoManager.undo();
    return;
  }
  if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undoManager.redo();
    return;
  }
  if (mod && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    undoManager.redo();
    return;
  }

  if (e.key === 'Escape') toggleSettings(false);

  if (mod && e.shiftKey) {
    if (e.key === ']') { e.preventDefault(); slideToNext(); }
    if (e.key === '[') { e.preventDefault(); slideToPrev(); }
  }
});

// ── Updater ──

const updateBtn = document.getElementById('update-btn');
const updateVersion = document.getElementById('update-version');
let updateAvailable = null;

async function checkForUpdates() {
  try {
    const metadata = await invoke('plugin:updater|check');

    if (metadata) {
      updateAvailable = metadata;
      updateBtn.textContent = 'Install Update';
      updateBtn.classList.add('install');
      updateVersion.textContent = metadata.version ? `v${metadata.version}` : 'v0.1.0';
    } else {
      updateBtn.textContent = 'Up to date';
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

updateBtn?.addEventListener('click', async () => {
  if (updateAvailable) {
    try {
      updateBtn.textContent = 'Installing…';
      updateBtn.disabled = true;
      await invoke('plugin:updater|download_and_install', {
        onEvent: new Channel(),
        rid: updateAvailable.rid
      });
      const { relaunch } = window.__TAURI__.process;
      await relaunch();
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

// ── Init ──

window.addEventListener('DOMContentLoaded', () => {
  initThemes();
  loadNotes();

  undoManager = new UndoManager({
    getValue:           () => canvas.value,
    setValue:           (v) => { canvas.value = v; },
    getSelectionStart:  () => canvas.selectionStart,
    getSelectionEnd:    () => canvas.selectionEnd,
    setSelection:       (s, e) => { canvas.selectionStart = s; canvas.selectionEnd = e; },
    getNoteId:          () => notes[currentIndex]?.id ?? null
  });

  canvas.addEventListener('input', scheduleSave);
  canvas.addEventListener('beforeinput', () => undoManager.beforeInput());

  settingsButton?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    toggleSettings();
  });

  importThemeButton?.addEventListener('click', () => themeFileInput.click());
  themeFileInput?.addEventListener('change', (e) => {
    const [file] = e.target.files || [];
    if (file) importThemeFile(file);
  });

  document.getElementById('btn-minimize')?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    appWindow.minimize();
  });
  document.getElementById('btn-maximize')?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    appWindow.toggleMaximize();
  });
  document.getElementById('btn-close')?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    appWindow.close();
  });
});
