import { bindKeyboardShortcuts } from './keyboard-shortcuts.js';
import { createNavigation } from './navigation.js';
import { createNotesController } from './notes-controller.js';
import { createSettingsUi } from './settings-ui.js';
import { createStatusController } from './status-ui.js';
import { createThemeUi } from './theme-ui.js';
import { UndoManager } from './undo/undo-manager.js';
import { createUpdaterUi } from './updater-ui.js';
import { createWindowControls } from './window-controls.js';

const { invoke, Channel } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();

const canvas = document.getElementById('note-canvas');
const container = document.getElementById('canvas-container');
const indicator = document.getElementById('note-indicator');
const settingsButton = document.getElementById('btn-settings');
const settingsPanel = document.getElementById('settings-panel');
const appStatus = document.getElementById('app-status');
const shortcutTrigger = document.getElementById('shortcut-trigger');
const shortcutBody = document.getElementById('shortcut-body');
const importThemeButton = document.getElementById('btn-import-theme');
const themeFileInput = document.getElementById('theme-file-input');
const dropdownTrigger = document.getElementById('theme-dropdown-trigger');
const dropdownPanel = document.getElementById('theme-dropdown-panel');
const dropdownLabel = document.getElementById('theme-dropdown-label');
const updateBtn = document.getElementById('update-btn');
const updateVersion = document.getElementById('update-version');

window.addEventListener('DOMContentLoaded', async () => {
  const status = createStatusController(appStatus);
  const notes = createNotesController({
    canvas,
    indicator,
    invoke,
    status
  });
  const undoManager = new UndoManager({
    getValue:           () => canvas.value,
    setValue:           (value) => { canvas.value = value; },
    getSelectionStart:  () => canvas.selectionStart,
    getSelectionEnd:    () => canvas.selectionEnd,
    setSelection:       (start, end) => { canvas.selectionStart = start; canvas.selectionEnd = end; },
    getNoteId:          () => notes.getCurrentNoteId()
  });
  notes.setUndoManager(undoManager);

  const themeUi = createThemeUi({
    dropdownTrigger,
    dropdownPanel,
    dropdownLabel,
    importThemeButton,
    themeFileInput,
    status
  });
  const settings = createSettingsUi({
    settingsButton,
    settingsPanel,
    shortcutTrigger,
    shortcutBody
  });
  const navigation = createNavigation({
    canvas,
    container,
    notes
  });
  const updater = createUpdaterUi({
    updateBtn,
    updateVersion,
    invoke,
    Channel
  });
  const windowControls = createWindowControls({
    appWindow,
    closeButton: document.getElementById('btn-close'),
    maximizeButton: document.getElementById('btn-maximize'),
    minimizeButton: document.getElementById('btn-minimize'),
    flushPendingSave: notes.flushPendingSave,
    status
  });

  canvas.disabled = true;
  canvas.addEventListener('input', notes.scheduleSave);
  canvas.addEventListener('beforeinput', (e) => undoManager.beforeInput(e));

  themeUi.bind();
  settings.bind();
  navigation.bindWheel();
  updater.bind();
  windowControls.bind();
  bindKeyboardShortcuts({
    document,
    navigation,
    notes,
    settings,
    undoManager
  });

  try {
    await themeUi.init();
    await notes.init();
  } catch (error) {
    console.error('Startup failed:', error);
    status.show('Could not load notes');
  } finally {
    canvas.disabled = false;
    canvas.focus();
  }
});
