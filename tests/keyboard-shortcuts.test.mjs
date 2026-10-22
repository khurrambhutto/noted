import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindKeyboardShortcuts } from '../src/keyboard-shortcuts.js';
import { createNavigation } from '../src/navigation.js';

function shortcuts({ focused = true, active = false, settingsOpen = false, command = false } = {}) {
  const calls = [];
  let handler;
  bindKeyboardShortcuts({
    document: {
      documentElement: { dataset: { settings: settingsOpen ? 'open' : '' } },
      addEventListener: (_, callback) => { handler = callback; }
    },
    editor: {
      isFocused: () => focused,
      consumeLineCommand: () => command,
      undo: () => { calls.push('undo'); return true; },
      redo: () => { calls.push('redo'); return true; }
    },
    links: {
      isActive: () => active,
      saveClipboard: () => calls.push('capture'),
      open: () => calls.push('open'),
      close: () => calls.push('close')
    },
    notes: { saveCurrentNote: async () => calls.push('save') },
    navigation: { slideToNext: () => calls.push('next'), slideToPrev: () => calls.push('prev') },
    settings: { toggleSettings: () => calls.push('settings-close') }
  });
  function press(key, options = {}) {
    const event = {
      key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
      defaultPrevented: false, isComposing: false, repeat: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      ...options
    };
    handler(event);
    return event;
  }
  return { calls, press };
}

test('Ctrl+Shift+V captures URLs while Ctrl+V keeps native paste', () => {
  const { calls, press } = shortcuts();
  assert.equal(press('v', { ctrlKey: true }).defaultPrevented, false);
  assert.deepEqual(calls, []);
  assert.equal(press('V', { ctrlKey: true, shiftKey: true }).defaultPrevented, true);
  assert.deepEqual(calls, ['capture']);
  press('V', { ctrlKey: true, shiftKey: true, repeat: true });
  assert.deepEqual(calls, ['capture']);
});

test('capture works in Links inputs and settings without modifying the note', () => {
  for (const state of [{ focused: false, active: true }, { focused: false, settingsOpen: true }]) {
    const { calls, press } = shortcuts(state);
    press('V', { ctrlKey: true, shiftKey: true });
    assert.deepEqual(calls, ['capture']);
  }
});

test('Links inputs keep their own undo and cannot navigate the hidden note', () => {
  const { calls, press } = shortcuts({ active: true, focused: false });
  assert.equal(press('z', { ctrlKey: true }).defaultPrevented, false);
  press(']', { ctrlKey: true, shiftKey: true });
  assert.deepEqual(calls, []);
  press('Escape');
  assert.deepEqual(calls, ['close']);
});

test('Escape closes settings before the underlying Links view', () => {
  const { calls, press } = shortcuts({ active: true, settingsOpen: true });
  press('Escape');
  assert.deepEqual(calls, ['settings-close']);
});

test('standalone /links opens on Enter only in the focused note', () => {
  const { calls, press } = shortcuts({ command: true });
  assert.equal(press('Enter').defaultPrevented, true);
  assert.deepEqual(calls, ['open']);
  const input = shortcuts({ focused: false, command: true });
  assert.equal(input.press('Enter').defaultPrevented, false);
  assert.deepEqual(input.calls, []);
  const composing = shortcuts({ command: true });
  composing.press('Enter', { isComposing: true });
  assert.deepEqual(composing.calls, []);
});

test('opening shortcut and editor undo keep their own actions', () => {
  const { calls, press } = shortcuts();
  press('L', { ctrlKey: true, shiftKey: true });
  press('z', { ctrlKey: true });
  assert.deepEqual(calls, ['open', 'undo', 'save']);
});

test('navigation locks before awaiting saves and clears its lock after failure', async (t) => {
  t.mock.method(console, 'error', () => {});
  let rejectSave;
  let attempts = 0;
  const navigation = createNavigation({
    editor: {}, container: {},
    notes: { deleteIfEmpty: () => { attempts++; return new Promise((_, reject) => { rejectSave = reject; }); } },
    status: { show() {} }
  });
  const operation = navigation.slideToNext();
  assert.equal(navigation.isBusy(), true);
  await navigation.slideToNext();
  assert.equal(attempts, 1);
  rejectSave(new Error('expected save failure'));
  await operation;
  assert.equal(navigation.isBusy(), false);
});

test('inactive navigation never starts a note operation', async () => {
  const navigation = createNavigation({
    editor: {}, container: {}, notes: {}, status: {}, canNavigate: () => false
  });
  await navigation.slideToNext();
  await navigation.slideToPrev();
  assert.equal(navigation.isBusy(), false);
});
