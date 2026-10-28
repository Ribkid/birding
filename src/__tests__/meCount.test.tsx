// @vitest-environment jsdom
// v1 js/me.js animateIn: Me's and a profile's numbers carry data-count and count up from 0 the first time each is
// shown in a session, and are written straight in after that. React draws zeros while IndexedDB answers, so a zero
// waits for a value, and a value that lands before the count starts is the one counted to.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Count } from '../screens/me/Count';

beforeAll(() => {
  // jsdom reports a hidden page, where countUp writes the final value at once.
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
afterEach(cleanup);

const num = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-count]')!;
const settle = () => act(() => new Promise((r) => setTimeout(r, 1400)));

describe("Me's counted numbers", () => {
  it('count up from 0 on the first view, then are written straight in', async () => {
    const first = render(<b><Count k="t1:species" n={12} /></b>);
    expect(num(first.container).tagName).toBe('B');
    expect(num(first.container).getAttribute('data-count')).toBe('12');
    expect(num(first.container).textContent).toBe('0');
    await settle();
    expect(num(first.container).textContent).toBe('12');
    first.unmount();

    const again = render(<dl><div><dt>Species</dt><Count tag="dd" k="t1:species" n={12} /></div></dl>);
    expect(num(again.container).tagName).toBe('DD');
    expect(num(again.container).textContent).toBe('12');
  });

  it('wait for a value while the data loads, and count to the value that lands', async () => {
    const r = render(<Count k="t2:life" n={0} />);
    expect(num(r.container).textContent).toBe('0');
    r.rerender(<Count k="t2:life" n={3} />);
    r.rerender(<Count k="t2:life" n={7} />);
    expect(num(r.container).textContent).toBe('0');
    await settle();
    expect(num(r.container).textContent).toBe('7');
    // A later change is written in, not counted again.
    r.rerender(<Count k="t2:life" n={8} />);
    expect(num(r.container).textContent).toBe('8');
  });

  it('end on the newest value when it changes while counting', async () => {
    const r = render(<Count k="t3:badges" n={13} />);
    await act(() => new Promise((res) => setTimeout(res, 300)));
    r.rerender(<Count k="t3:badges" n={14} />);
    await settle();
    expect(num(r.container).textContent).toBe('14');
  });

  it('count next time when left before the count began', async () => {
    render(<Count k="t4:month" n={5} />).unmount();
    const r = render(<Count k="t4:month" n={5} />);
    expect(num(r.container).textContent).toBe('0');
    await settle();
    expect(num(r.container).textContent).toBe('5');
  });
});
