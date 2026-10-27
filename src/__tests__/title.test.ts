// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { titleFor, watchTitle } from '../lib/title';

afterEach(() => { document.body.innerHTML = ''; document.title = ''; });

const view = (html: string) => {
  const el = document.createElement('main');
  el.id = 'view';
  el.innerHTML = html;
  document.body.append(el);
  return el;
};

describe('page title (v1 afterDraw)', () => {
  it('drops the <small> line and keeps the app name alone on the Dex', () => {
    expect(titleFor(view('<h1><img alt=""><span>Sarah\'s BirdyDex<small>South East Queensland</small></span></h1>'))).toBe("Sarah's BirdyDex");
    expect(titleFor(view('<h1>  Life\n  list </h1>'))).toBe('Life list – BirdyDex');
    expect(titleFor(view('<p>No heading</p>'))).toBe("Sarah's BirdyDex");
  });

  it('follows a heading that renders or changes after the route change', async () => {
    const v = view('<p>Loading…</p>');
    const bar = document.createElement('div');
    bar.id = 'topbar';
    bar.innerHTML = '<span class="topbar-title"></span>';
    document.body.append(bar);
    const stop = watchTitle(v);
    expect(document.title).toBe("Sarah's BirdyDex");
    v.innerHTML = '<h1>Outing</h1>';
    await Promise.resolve();
    expect(document.title).toBe('Outing – BirdyDex');
    v.querySelector('h1')!.firstChild!.textContent = 'Oxley Creek Common';
    await Promise.resolve();
    expect(document.title).toBe('Oxley Creek Common – BirdyDex');
    expect(bar.textContent).toBe('Oxley Creek Common');
    stop();
  });
});
