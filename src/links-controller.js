export function createLinksController({
  panel,
  openButton,
  editor,
  notes,
  settings,
  invoke,
  status,
  canOpen
}) {
  const search = panel.querySelector('#links-search');
  const list = panel.querySelector('#links-list');
  const count = panel.querySelector('#links-count');
  const more = panel.querySelector('#links-more');
  const form = panel.querySelector('#links-add-form');
  const input = panel.querySelector('#links-input');
  const titleSwitch = document.getElementById('fetch-link-titles');
  let active = false;
  let opening = false;
  let rows = [];
  let total = 0;
  let request = 0;
  let viewRequest = 0;
  let searchTimer;
  let pendingWrite = Promise.resolve();
  let fetchingTitles = false;
  let fetchAgain = false;
  let fetchTitles = false;

  function write(operation) {
    pendingWrite = pendingWrite.catch(() => {}).then(operation);
    return pendingWrite;
  }

  function report(error, message) {
    console.error(message, error);
    status.show(message);
  }

  function domain(url) {
    return new URL(url).hostname;
  }

  function name(link) {
    return link.label || link.title || domain(link.url);
  }

  function button(text, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = text;
    element.addEventListener('click', action);
    return element;
  }

  function linkRow(link) {
    const row = document.createElement('li');
    row.className = 'links-row';
    row.dataset.linkId = link.id;
    const content = document.createElement('div');
    content.className = 'links-row-content';
    const anchor = document.createElement('a');
    anchor.className = 'links-title';
    anchor.textContent = name(link);
    anchor.href = link.url;
    anchor.title = name(link);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      invoke('plugin:opener|open_url', { url: link.url })
        .catch((error) => report(error, 'Could not open link'));
    });
    const url = document.createElement('span');
    url.className = 'links-url';
    url.textContent = link.url.replace(/^https?:\/\//, '');
    url.title = link.url;
    content.append(anchor, url);

    const actions = document.createElement('details');
    actions.className = 'links-actions';
    const summary = document.createElement('summary');
    summary.textContent = '...';
    summary.setAttribute('aria-label', `Actions for ${name(link)}`);
    const menu = document.createElement('div');
    menu.className = 'links-menu';
    menu.append(
      button('Rename', () => {
        actions.open = false;
        rename(row, link);
      }),
      button('Refresh title', async () => {
        actions.open = false;
        if (!fetchTitles) {
          status.show('Turn on page title fetching in Settings first');
          return;
        }
        try {
          updateTitle(await invoke('refresh_link_title', { id: link.id }));
          status.show('Title updated');
        } catch (error) {
          report(error, 'Could not fetch title. You can rename this link');
        }
      }),
      button('Remove', () => {
        actions.open = false;
        write(async () => {
          await invoke('delete_link', { id: link.id });
          await load();
          status.show('Link removed');
          search.focus();
        }).catch((error) => report(error, 'Could not remove link'));
      })
    );
    actions.append(summary, menu);
    row.append(content, actions);
    return row;
  }

  function rename(row, link) {
    if (row.querySelector('form')) return;
    const renameForm = document.createElement('form');
    renameForm.className = 'links-rename';
    const label = document.createElement('label');
    label.textContent = 'Name';
    const field = document.createElement('input');
    field.type = 'text';
    field.maxLength = 300;
    field.value = link.label || '';
    field.placeholder = link.title || domain(link.url);
    label.append(field);
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save';
    renameForm.append(label, save, button('Cancel', () => renameForm.remove()));
    renameForm.addEventListener('submit', (event) => {
      event.preventDefault();
      save.disabled = true;
      write(async () => {
        await invoke('rename_link', { id: link.id, label: field.value });
        await load();
        search.focus();
      }).catch((error) => {
        save.disabled = false;
        report(error, 'Could not rename link');
      });
    });
    row.append(renameForm);
    field.focus();
  }

  function render() {
    list.replaceChildren(...rows.map(linkRow));
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'links-empty';
      empty.textContent = search.value.trim()
        ? 'No matching links.'
        : 'Your links live here. Paste URLs with Ctrl+Shift+V, or add them below.';
      list.append(empty);
    }
    count.textContent = `${total} ${search.value.trim() ? 'matching' : 'saved'} ${total === 1 ? 'link' : 'links'}`;
    more.hidden = rows.length >= total;
  }

  async function load(append = false) {
    const token = ++request;
    const offset = append ? rows.length : 0;
    const page = await invoke('list_links', { query: search.value.trim(), offset });
    if (token !== request) return;
    rows = append ? [...rows, ...page.links] : page.links;
    total = page.total;
    render();
  }

  function updateTitle(updated) {
    const existing = rows.find((link) => link.id === updated.id);
    if (!existing) return;
    // Only replace fetched metadata. A rename may have completed during the request.
    existing.title = updated.title;
    existing.title_checked = updated.title_checked;
    const anchor = list.querySelector(`[data-link-id="${updated.id}"] .links-title`);
    if (anchor) {
      anchor.textContent = name(existing);
      anchor.title = name(existing);
      list.querySelector(`[data-link-id="${updated.id}"] summary`)
        .setAttribute('aria-label', `Actions for ${name(existing)}`);
    }
  }

  async function fetchPendingTitles() {
    if (fetchingTitles) {
      fetchAgain = true;
      return;
    }
    if (!fetchTitles) return;
    fetchingTitles = true;
    const attempted = new Set();
    try {
      while (fetchTitles) {
        const ids = (await invoke('pending_link_titles')).filter((id) => !attempted.has(id));
        if (!ids.length) break;
        for (let start = 0; start < ids.length && fetchTitles; start += 2) {
          await Promise.all(ids.slice(start, start + 2).map(async (id) => {
            attempted.add(id);
            try {
              updateTitle(await invoke('refresh_link_title', { id }));
            } catch {
              // The URL is already saved. Missing titles can be retried from its menu.
            }
          }));
        }
      }
    } catch (error) {
      console.error('Could not load pending page titles:', error);
    } finally {
      fetchingTitles = false;
      if (fetchAgain) {
        fetchAgain = false;
        fetchPendingTitles();
      }
    }
  }

  async function saveText(text) {
    const result = await invoke('add_links', { text: text || '' });
    const messages = [];
    if (result.added.length) messages.push(`Saved ${result.added.length} ${result.added.length === 1 ? 'link' : 'links'}`);
    if (result.duplicates) messages.push(`${result.duplicates} duplicates skipped`);
    if (result.invalid) messages.push(`${result.invalid} invalid URLs skipped`);
    status.show(messages.join('. ') || 'No URLs to save');
    if (active) await load();
    fetchPendingTitles();
    return result;
  }

  function saveClipboard() {
    return write(async () => {
      const text = await invoke('plugin:clipboard-manager|read_text');
      await saveText(text);
    }).catch((error) => report(error, 'Could not save clipboard links. Try Add links'));
  }

  async function open() {
    if (active) {
      settings.toggleSettings(false);
      search.focus();
      return;
    }
    if (opening || !canOpen()) return;
    opening = true;
    const token = ++viewRequest;
    editor.setDisabled(true);
    try {
      await notes.flushPendingSave();
      if (token !== viewRequest) return;
      settings.toggleSettings(false);
      active = true;
      panel.hidden = false;
      document.documentElement.dataset.view = 'links';
      openButton.setAttribute('aria-pressed', 'true');
      openButton.setAttribute('aria-label', 'Back to note');
      openButton.title = 'Back to note';
      await load();
      if (active) search.focus();
    } catch (error) {
      close();
      report(error, 'Could not open Links');
    } finally {
      opening = false;
    }
  }

  function close() {
    ++viewRequest;
    ++request;
    active = false;
    settings.toggleSettings(false);
    panel.hidden = true;
    delete document.documentElement.dataset.view;
    openButton.setAttribute('aria-pressed', 'false');
    openButton.setAttribute('aria-label', 'Open Links');
    openButton.title = 'Links';
    editor.setDisabled(false);
    editor.focus();
  }

  async function init() {
    try {
      fetchTitles = await invoke('get_fetch_link_titles');
      titleSwitch.setAttribute('aria-checked', String(fetchTitles));
      titleSwitch.disabled = false;
      fetchPendingTitles();
    } catch (error) {
      report(error, 'Could not load Links settings');
    }
  }

  function bind() {
    openButton.addEventListener('click', () => active ? close() : open());
    panel.querySelector('#links-back').addEventListener('click', close);
    panel.querySelector('#links-add').addEventListener('click', () => {
      form.hidden = !form.hidden;
      if (!form.hidden) input.focus();
    });
    panel.querySelector('#links-cancel').addEventListener('click', () => {
      form.hidden = true;
      search.focus();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const text = input.value;
      write(async () => {
        const result = await saveText(text);
        if (!result.invalid) {
          input.value = '';
          form.hidden = true;
          search.focus();
        }
      }).catch((error) => report(error, 'Could not save links'))
        .finally(() => { submit.disabled = false; });
    });
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      ++request;
      searchTimer = setTimeout(() => load().catch((error) => report(error, 'Could not search links')), 150);
    });
    more.addEventListener('click', async () => {
      more.disabled = true;
      try { await load(true); } catch (error) { report(error, 'Could not load more links'); }
      finally { more.disabled = false; }
    });
    titleSwitch.addEventListener('click', async () => {
      const next = !fetchTitles;
      titleSwitch.disabled = true;
      try {
        await write(() => invoke('set_fetch_link_titles', { enabled: next }));
        fetchTitles = next;
        titleSwitch.setAttribute('aria-checked', String(fetchTitles));
        if (fetchTitles) fetchPendingTitles();
      } catch (error) {
        report(error, 'Could not save page title setting');
      } finally {
        titleSwitch.disabled = false;
      }
    });
  }

  return {
    bind,
    close,
    init,
    isActive: () => active || opening,
    open,
    saveClipboard,
    flushPendingWrites: () => pendingWrite
  };
}
