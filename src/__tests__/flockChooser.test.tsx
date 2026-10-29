// @vitest-environment jsdom
// Hold + for a flock (screens/lists/FlockChooser.tsx): a 450 ms hold opens the chooser and the click from lifting
// the finger adds nothing; a press that moves is a scroll; a right click or the context menu key opens it at once.
// The chooser offers 5, 10, 20 and 50, starts on +5, and a pick, Escape or Tab hands focus back to the +.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { FlockChooser, HOLD_MS, useHold } from '../screens/lists/FlockChooser';
import type { Species } from '../lib/data';

const SP = { id: 52, name: 'Australian White Ibis' } as Species;

function Row({ onOpen, onAdd }: { onOpen: (sp: Species) => void; onAdd: () => void }) {
  const hold = useHold((_anchor, sp) => onOpen(sp));
  return createElement('button', {
    type: 'button',
    'data-inc': SP.id,
    ...hold.bind(SP),
    onClick: (e: { detail: number }) => { if (!hold.swallowClick(e)) onAdd(); },
  }, '+');
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useHold', () => {
  it('opens after a 450 ms hold, and the release click adds nothing', () => {
    const onOpen = vi.fn();
    const onAdd = vi.fn();
    const { getByText } = render(createElement(Row, { onOpen, onAdd }));
    const btn = getByText('+');
    fireEvent.pointerDown(btn, { button: 0, isPrimary: true, clientX: 10, clientY: 10 });
    expect(btn.classList.contains('is-holding')).toBe(true);
    act(() => { vi.advanceTimersByTime(HOLD_MS - 50); });
    expect(onOpen).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(60); });
    expect(onOpen).toHaveBeenCalledWith(SP);
    expect(btn.classList.contains('is-holding')).toBe(false);
    fireEvent.pointerUp(btn);
    fireEvent.click(btn, { detail: 1 }); // a click from a finger or a mouse counts its clicks; one from a key is 0
    expect(onAdd).not.toHaveBeenCalled();
    // The next tap is an ordinary one.
    fireEvent.pointerDown(btn, { button: 0, isPrimary: true });
    fireEvent.pointerUp(btn);
    fireEvent.click(btn, { detail: 1 });
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('a quick tap counts and opens nothing; a press that moves is a scroll', () => {
    const onOpen = vi.fn();
    const onAdd = vi.fn();
    const { getByText } = render(createElement(Row, { onOpen, onAdd }));
    const btn = getByText('+');
    fireEvent.pointerDown(btn, { button: 0, isPrimary: true });
    act(() => { vi.advanceTimersByTime(80); });
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(btn, { button: 0, isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(btn, { clientX: 10, clientY: 40 });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a thumb kept down long after the chooser opens adds nothing when it lifts', () => {
    const onOpen = vi.fn();
    const onAdd = vi.fn();
    const { getByText } = render(createElement(Row, { onOpen, onAdd }));
    const btn = getByText('+');
    fireEvent.pointerDown(btn, { button: 0, isPrimary: true });
    act(() => { vi.advanceTimersByTime(HOLD_MS + 2500); }); // she keeps it there while she decides
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    act(() => { vi.advanceTimersByTime(30); });
    expect(fireEvent.mouseDown(btn)).toBe(false); // the lift's mousedown would take focus off the chooser
    fireEvent.click(btn, { detail: 1 });
    expect(onAdd).not.toHaveBeenCalled();
    // Enter on the + (a click from the keyboard) still counts.
    fireEvent.click(btn, { detail: 0 });
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('a long press\'s own context menu during the press is the hold (Android sends it at about 400 ms)', () => {
    const onOpen = vi.fn();
    const onAdd = vi.fn();
    const { getByText } = render(createElement(Row, { onOpen, onAdd }));
    const btn = getByText('+');
    fireEvent.pointerDown(btn, { button: 0, isPrimary: true });
    act(() => { vi.advanceTimersByTime(400); });
    expect(fireEvent.contextMenu(btn)).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains('is-holding')).toBe(false);
    act(() => { vi.advanceTimersByTime(HOLD_MS); }); // the hold timer doesn't open it a second time
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    fireEvent.click(btn, { detail: 1 });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('a right click or the context menu key opens it at once', () => {
    const onOpen = vi.fn();
    const { getByText } = render(createElement(Row, { onOpen, onAdd: () => {} }));
    const ev = fireEvent.contextMenu(getByText('+'));
    expect(ev).toBe(false); // the system menu is not shown
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('FlockChooser', () => {
  function Harness({ onPick }: { onPick: (n: number) => void }) {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const [open, setOpen] = useState(true);
    return createElement('div', null,
      createElement('button', { ref: setAnchor, 'data-inc': 52 }, '+'),
      anchor && open ? createElement(FlockChooser, { sp: SP, anchor, onPick, onClose: () => setOpen(false) }) : null);
  }

  it('offers 5, 10, 20 and 50, starts on +5, and a pick adds and hands focus back', () => {
    const onPick = vi.fn();
    render(createElement(Harness, { onPick }));
    // In a portal on <body>, so it sits in the top layer.
    const group = screen.getByRole('group', { name: /add a flock of australian white ibis/i });
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['+5', '+10', '+20', '+50']);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Add 5 Australian White Ibis', 'Add 10 Australian White Ibis', 'Add 20 Australian White Ibis', 'Add 50 Australian White Ibis']);
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.click(buttons[1]);
    expect(onPick).toHaveBeenCalledWith(10);
    expect(document.activeElement).toBe(screen.getByText('+'));
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('stays with the + while the page scrolls, and closes once the + has left the screen, focus back on the +', () => {
    render(createElement(Harness, { onPick: () => {} }));
    const plus = document.querySelector<HTMLButtonElement>('[data-inc="52"]')!;
    let top = 400;
    plus.getBoundingClientRect = () => ({ top, bottom: top + 44, left: 300, right: 344, width: 44, height: 44, x: 300, y: top, toJSON() {} }) as DOMRect;
    const group = screen.getByRole('group');
    expect(document.activeElement).toBe(group.querySelector('button'));
    top = 396; // a flick still settling
    act(() => { window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(50); });
    expect(screen.queryByRole('group')).toBe(group);
    const at = parseFloat(group.style.top);
    top = 300;
    act(() => { window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(50); });
    expect(parseFloat(group.style.top)).toBe(at - 96);
    top = -80; // scrolled away
    act(() => { window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(50); });
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.activeElement).toBe(plus);
  });

  it('Escape closes it and hands focus back to the +; a tap elsewhere closes it', () => {
    const onPick = vi.fn();
    render(createElement(Harness, { onPick }));
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('+'));
    cleanup();
    render(createElement(Harness, { onPick }));
    expect(screen.getByRole('group')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('the chooser on a narrow screen', () => {
  it('never puts +5, where focus lands, off the left edge, even when the screen is narrower than it', () => {
    const html = document.documentElement;
    const width = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(html, 'clientWidth', { configurable: true, get: () => 195 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('tally-chooser') ? 242 : 0; } });
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.matches('[data-inc]') ? ({ top: 300, bottom: 344, left: 140, right: 184, width: 44, height: 44, x: 140, y: 300, toJSON() {} } as DOMRect) : rect.call(this);
    };
    try {
      function Narrow() {
        const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
        return createElement('div', null,
          createElement('button', { ref: setAnchor, 'data-inc': 52 }, '+'),
          anchor ? createElement(FlockChooser, { sp: SP, anchor, onPick: () => {}, onClose: () => {} }) : null);
      }
      render(createElement(Narrow));
      expect(parseFloat(screen.getByRole('group').style.left)).toBe(8);
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Add 5 Australian White Ibis');
    } finally {
      delete (html as { clientWidth?: number }).clientWidth;
      if (width) Object.defineProperty(Element.prototype, 'clientWidth', width);
      if (offset) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offset);
      HTMLElement.prototype.getBoundingClientRect = rect;
    }
  });
});
