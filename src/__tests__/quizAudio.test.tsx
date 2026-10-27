// @vitest-environment jsdom
// Item 33: the big call player and the answer's play buttons share one clip, as v1's single audio does.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CallPlayer, PlayButton, stopCalls, usePlayButtons } from '../screens/learn/QuizMedia';

const made: HTMLAudioElement[] = [];
beforeAll(() => {
  // jsdom has no media playback: track paused state by hand.
  const proto = window.HTMLMediaElement.prototype as any;
  Object.defineProperty(proto, 'paused', { configurable: true, get() { return this._paused ?? true; } });
  proto.play = function () { this._paused = false; if (!made.includes(this)) made.push(this); return Promise.resolve(); };
  proto.pause = function () { this._paused = true; };
});
afterEach(() => { cleanup(); made.length = 0; });

const clip = { src: 'https://example.org/a.m4a' };
function Harness() {
  const buttons = usePlayButtons();
  return (
    <>
      <CallPlayer call={clip} seed="a" />
      <PlayButton on={buttons.on} which="answer" label="Hear it again" onPlay={(w) => buttons.toggle(w, { src: 'https://example.org/b.m4a' })} />
    </>
  );
}
const playing = () => made.filter((a) => !a.paused).length;
const big = () => document.querySelector('.lq-play')!;
const again = () => screen.getByText('Hear it again').closest('button')!;

describe('one clip at a time', () => {
  it('Hear it again stops the big player and shows the pause state', async () => {
    render(<Harness />);
    await act(async () => { fireEvent.click(big()); });
    expect(big().className).toContain('is-playing');
    expect(playing()).toBe(1);

    await act(async () => { fireEvent.click(again()); });
    expect(playing()).toBe(1);
    expect(big().className).not.toContain('is-playing');
    expect(again().className).toContain('is-playing');
    expect(again().querySelector('path')!.getAttribute('d')).toBe('M7 5h4v14H7zM13 5h4v14h-4z');

    // A second tap pauses it; a third carries on.
    await act(async () => { fireEvent.click(again()); });
    expect(playing()).toBe(0);
    expect(again().className).not.toContain('is-playing');
    await act(async () => { fireEvent.click(again()); });
    expect(playing()).toBe(1);
    expect(again().className).toContain('is-playing');

    // The big player in turn stops the button's clip.
    await act(async () => { fireEvent.click(big()); });
    expect(playing()).toBe(1);
    expect(again().className).not.toContain('is-playing');
    expect(big().className).toContain('is-playing');

    // A new question stops everything.
    await act(async () => { stopCalls(); });
    expect(playing()).toBe(0);
    expect(big().className).not.toContain('is-playing');
  });
});
