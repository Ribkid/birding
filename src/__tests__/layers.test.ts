// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllLayers, closeLayer, focusFirst, layers, openLayer } from '../lib/layers';

afterEach(() => {
  closeAllLayers('test');
  document.body.innerHTML = '';
});

const card = (html: string) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.append(el);
  return el;
};

describe('focusFirst (v1 openSheet autofocus)', () => {
  it('focuses the first control in document order, skipping hidden and file inputs', () => {
    const el = card('<p>Text</p><input type="hidden"><input type="file"><button id="b">Change</button><input id="i">');
    expect(focusFirst(el)).toBe(true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('leaves focus alone when the first control is marked data-noautofocus', () => {
    const el = card('<input id="i" data-noautofocus><button>Go</button>');
    expect(focusFirst(el)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('does not move focus that is already inside', () => {
    const el = card('<button id="a">A</button><button id="b">B</button>');
    (el.querySelector('#b') as HTMLElement).focus();
    expect(focusFirst(el)).toBe(false);
    expect(document.activeElement?.id).toBe('b');
  });
});

describe('the layer stack', () => {
  it('makes the rest of the page inert and gives focus back on close', () => {
    const page = card('<button id="opener">Open</button>');
    const wrap = card('<div class="d"><h2>Hello</h2><button>OK</button></div>');
    (page.querySelector('#opener') as HTMLElement).focus();
    const layer = openLayer(wrap, { dialog: wrap.querySelector('.d') as HTMLElement, close: () => {} });
    expect(page.inert).toBe(true);
    expect(wrap.inert).toBeFalsy();
    expect(layers()).toHaveLength(1);
    (wrap.querySelector('button') as HTMLElement).focus();
    closeLayer(layer);
    expect(page.inert).toBe(false);
    expect(document.activeElement?.id).toBe('opener');
  });
});

describe('Escape', () => {
  it('closes only the top layer, once, however many layers are open', () => {
    const closed: string[] = [];
    const a = card('<div class="a"><button>A</button></div>');
    const b = card('<div class="b"><button>B</button></div>');
    const la = openLayer(a, { close: () => { closed.push('a'); closeLayer(la); } });
    const lb = openLayer(b, { close: () => { closed.push('b'); closeLayer(lb); } });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toEqual(['b']);
    expect(layers()).toEqual([la]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toEqual(['b', 'a']);
    expect(layers()).toHaveLength(0);
  });
});
