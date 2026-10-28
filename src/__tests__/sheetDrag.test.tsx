// @vitest-environment jsdom
// v1 wireSheetDrag: a sheet follows the finger down, closes past 30% of its height (or on a flick) and springs back
// from a shorter drag.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from '../components/Sheet';
import { closeAllLayers } from '../lib/layers';

afterEach(() => {
  cleanup();
  closeAllLayers('test');
  vi.useRealTimers();
});

let clock = 0;
const pointer = (type: string, target: EventTarget, y: number, step = 16) => {
  clock += step;
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 200, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'timeStamp', { value: clock });
  act(() => { target.dispatchEvent(e); });
};

function openSheet(onClose: (why?: string) => void) {
  render(<Sheet open onClose={onClose} label="Add a sighting"><h2>Add a sighting</h2><button type="button">Log one sighting</button></Sheet>);
  const sheet = document.querySelector<HTMLElement>('.sheet')!;
  sheet.getBoundingClientRect = () => ({ top: 400, height: 400, bottom: 800, left: 0, right: 390, width: 390, x: 0, y: 400, toJSON: () => ({}) });
  return sheet;
}

// A slow drag from the grip: no flick, so only the distance decides.
function drag(sheet: HTMLElement, dy: number) {
  pointer('pointerdown', sheet.querySelector('.sheet-grip')!, 420);
  const steps = 10;
  for (let i = 1; i <= steps; i++) pointer('pointermove', window, 420 + (dy * i) / steps, 60);
  const moved = sheet.style.transform;
  pointer('pointerup', window, 420 + dy, 200);
  return moved;
}

describe('dragging a sheet', () => {
  it('follows the finger and closes once dragged past 30% of its height', () => {
    const onClose = vi.fn();
    const sheet = openSheet(onClose);
    expect(drag(sheet, 216)).toBe('translateY(216px)');
    expect(onClose).toHaveBeenCalledWith('drag');
  });

  it('springs back from a short drag and stays open', () => {
    const onClose = vi.fn();
    const sheet = openSheet(onClose);
    expect(drag(sheet, 43)).toBe('translateY(43px)');
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');
  });

  it('leaves a sideways swipe to the chips', () => {
    const onClose = vi.fn();
    const sheet = openSheet(onClose);
    pointer('pointerdown', sheet.querySelector('.sheet-grip')!, 420);
    const e = new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 425 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    act(() => { window.dispatchEvent(e); });
    expect(sheet.style.transform).toBe('');
    pointer('pointerup', window, 425);
    expect(onClose).not.toHaveBeenCalled();
  });
});
