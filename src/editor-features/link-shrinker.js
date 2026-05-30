import { StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
const MAX_DISPLAY = 28;

const expandLinkEffect = StateEffect.define();

function truncateUrl(url) {
  let display = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const cleaned = display.split('?')[0].split('#')[0];
  const hadQueryOrFragment = cleaned !== display;

  if (hadQueryOrFragment) {
    const pathParts = cleaned.split('/');
    if (pathParts.length <= 2) {
      return pathParts[0] + '/...';
    }
  }

  if (cleaned.length <= MAX_DISPLAY && !hadQueryOrFragment) return cleaned;

  const parts = cleaned.split('/');
  const domain = parts[0];

  if (parts.length === 1) {
    return domain.length > MAX_DISPLAY
      ? domain.slice(0, MAX_DISPLAY - 3) + '...'
      : domain;
  }

  const domainLen = domain.length;
  const firstSeg = parts[1];
  const needed = domainLen + 1 + firstSeg.length + 4;

  if (needed <= MAX_DISPLAY) {
    return domain + '/' + firstSeg + '/...';
  }

  const budget = MAX_DISPLAY - domain.length - 4;
  if (budget > 0) {
    return domain + '/' + firstSeg.slice(0, budget) + '...';
  }

  return domain.length > MAX_DISPLAY - 4
    ? domain.slice(0, MAX_DISPLAY - 4) + '/...'
    : domain + '/...';
}

function findUrlsInText(text, offset) {
  const results = [];
  URL_REGEX.lastIndex = 0;
  let match;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const url = match[0];
    const stripped = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (stripped !== url) {
      results.push({
        from: offset + match.index,
        to: offset + match.index + url.length,
        url
      });
    }
  }
  return results;
}

class ShrunkLinkWidget extends WidgetType {
  constructor(display, url) {
    super();
    this.display = display;
    this.url = url;
  }

  eq(other) {
    return other.display === this.display && other.url === this.url;
  }

  toDOM(view) {
    const span = document.createElement('span');
    span.className = 'shrunk-link';
    span.textContent = this.display;
    span.title = this.url;
    span.dataset.url = this.url;

    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey) {
        const pos = view.posAtDOM(span);
        view.dispatch({
          effects: expandLinkEffect.of(pos)
        });
      } else {
        try {
          const opener = window.__TAURI__?.opener;
          if (opener?.openUrl) {
            opener.openUrl(this.url);
          } else {
            window.open(this.url, '_blank');
          }
        } catch {
          window.open(this.url, '_blank');
        }
      }
    });

    return span;
  }

  ignoreEvent(event) {
    return event.type === 'mousedown' || event.type === 'mouseup' || event.type === 'click';
  }
}

const shrunkLinksField = StateField.define({
  create(state) {
    const map = new Map();
    for (const { from, to, url } of findUrlsInText(state.doc.toString(), 0)) {
      map.set(from, { to, url });
    }
    return map;
  },

  update(shrunk, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(expandLinkEffect)) {
        const pos = effect.value;
        for (const [from, info] of shrunk) {
          if (from <= pos && info.to >= pos) {
            const next = new Map(shrunk);
            next.delete(from);
            return next;
          }
        }
        return shrunk;
      }
    }

    if (!transaction.docChanged) return shrunk;

    const next = new Map();

    for (const [oldFrom, { to: oldTo, url }] of shrunk) {
      let overlaps = false;
      transaction.changes.iterChanges((fromA, toA) => {
        if (oldFrom < toA && oldTo > fromA) overlaps = true;
      });
      if (!overlaps) {
        next.set(
          transaction.changes.mapPos(oldFrom, 1),
          { to: transaction.changes.mapPos(oldTo, -1), url }
        );
      }
    }

    transaction.changes.iterChanges((_a, _b, fromB, _c, inserted) => {
      if (inserted.length === 0) return;
      for (const { from, to, url } of findUrlsInText(inserted.toString(), fromB)) {
        let covered = false;
        for (const [rf, { to: rt }] of next) {
          if (rf <= from && rt >= to) { covered = true; break; }
        }
        if (!covered) next.set(from, { to, url });
      }
    });

    return next;
  },

  provide(field) {
    return EditorView.decorations.compute([field], (state) => {
      const shrunk = state.field(field);
      const decos = [];
      for (const [from, { to, url }] of shrunk) {
        decos.push(Decoration.replace({
          widget: new ShrunkLinkWidget(truncateUrl(url), url)
        }).range(from, to));
      }
      return Decoration.set(decos);
    });
  }
});

export { shrunkLinksField, expandLinkEffect };
