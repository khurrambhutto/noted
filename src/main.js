import { createLinksController } from './links-controller.js';
import { bindKeyboardShortcuts } from './keyboard-shortcuts.js';
import { createEditorController } from './editor-controller.js';
import { createNavigation } from './navigation.js';
import { createNotesController } from './notes-controller.js';
import { createPinController } from './pin-controller.js';
import { createScrollAffordance } from './scroll-affordance.js';
import { createSettingsUi } from './settings-ui.js';
import { createStatusController } from './status-ui.js';
import { createThemeUi } from './theme-ui.js';
import { createUpdaterUi } from './updater-ui.js';
import { createWindowControls } from './window-controls.js';

const { invoke, Channel } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();

const editorMount = document.getElementById('note-editor');
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
const pinSection = document.getElementById('pin-section');
const pinSwitch = document.getElementById('pin-switch');
const pinButton = document.getElementById('btn-pin');

window.addEventListener('DOMContentLoaded', async () => {
  const status = createStatusController(appStatus);
  const editor = createEditorController({
    mount: editorMount,
    disabled: true
  });
  const notes = createNotesController({
    editor,
    indicator,
    invoke,
    status
  });

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
  let ready = false;
  let navigation;
  const links = createLinksController({
    panel: document.getElementById('links-panel'),
    openButton: document.getElementById('btn-links'),
    editor,
    notes,
    settings,
    invoke,
    status,
    canOpen: () => ready && !navigation.isBusy()
  });
  navigation = createNavigation({
    editor,
    container,
    notes,
    status,
    canNavigate: () => ready && !links.isActive() && document.documentElement.dataset.settings !== 'open'
  });
  const updater = createUpdaterUi({
    updateBtn,
    updateVersion,
    invoke,
    Channel
  });
  const pin = createPinController({
    invoke,
    pinButton,
    pinSection,
    pinSwitch
  });
  const windowControls = createWindowControls({
    appWindow,
    closeButton: document.getElementById('btn-close'),
    maximizeButton: document.getElementById('btn-maximize'),
    minimizeButton: document.getElementById('btn-minimize'),
    flushPendingSave: async () => {
      await notes.flushPendingSave();
      await links.flushPendingWrites();
    },
    invoke,
    status
  });
  const scrollAffordance = createScrollAffordance();

  editor.setDisabled(true);
  editor.onChange(notes.scheduleSave);

  links.bind();
  themeUi.bind();
  settings.bind();
  navigation.bindWheel();
  updater.bind();
  pin.bind();
  windowControls.bind();
  scrollAffordance.bind(editor.getScrollerElement());
  bindKeyboardShortcuts({
    document,
    editor,
    navigation,
    notes,
    settings,
    links
  });

  const startup = await Promise.allSettled([notes.init(), themeUi.init(), pin.init(), links.init()]);
  ready = startup[0].status === 'fulfilled';
  if (!ready) {
    console.error('Could not load notes:', startup[0].reason);
    status.show('Could not load notes');
  }
  editor.setDisabled(!ready);
  editor.focus();
});
