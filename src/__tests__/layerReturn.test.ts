// @vitest-environment jsdom
// Closing a layer that was opened while nothing had focus: <body> can't take focus back, so it goes to the screen's
// heading, whether or not the layer's own element is still in the page when it is taken off the stack.
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllLayers, closeLayer, openLayer } from '../lib/layers';

afterEach(() => {
  closeAllLayers('test');
  document.body.innerHTML = '';
});

function page() {
  document.body.innerHTML = '<main id="view" tabindex="-1"><h1>Dex</h1><button id="b">Go</button></main>';
  const ov = document.createElement('div');
  ov.innerHTML = '<input id="q">';
  document.body.append(ov);
  return ov;
}

describe('focus after a layer opened with nothing focused', () => {
  it('lands on the heading when the layer is taken off the stack before it is removed', () => {
    const ov = page();
    (document.activeElement as HTMLElement | null)?.blur();
    const layer = openLayer(ov, { returnTo: document.body });
    (ov.querySelector('#q') as HTMLElement).focus();
    closeLayer(layer);
    ov.remove();
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('lands on the heading when the layer is already gone', () => {
    const ov = page();
    const layer = openLayer(ov, { returnTo: document.body });
    (ov.querySelector('#q') as HTMLElement).focus();
    ov.remove();
    closeLayer(layer);
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('still goes back to the control that opened it', () => {
    const ov = page();
    const b = document.getElementById('b') as HTMLElement;
    b.focus();
    const layer = openLayer(ov);
    (ov.querySelector('#q') as HTMLElement).focus();
    closeLayer(layer);
    expect(document.activeElement).toBe(b);
  });
});
