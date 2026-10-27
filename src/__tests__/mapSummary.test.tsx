// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MapSummary, noteLines } from '../screens/map/MapScreen';
import { SPECIES } from '../lib/data';

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, details, [tabindex]';

describe('map screen-reader summary', () => {
  it('turns popup HTML into plain lines without links', () => {
    expect(
      noteLines(
        '<span class="pop-h">Oxley Creek Common</span><span class="pop-sub">Park, Rocklea</span>' +
          '<p class="pop-desc">A wetland. <a href="https://en.wikipedia.org/x">Wikipedia</a></p>' +
          '<p class="pop-desc">Look out for the <a href="#/bird/3">Brown Quail</a> (rare).</p>',
      ),
    ).toEqual([
      'Oxley Creek Common',
      'Park, Rocklea',
      'A wetland. Wikipedia',
      'Look out for the Brown Quail (rare).',
    ]);
  });

  it('holds nothing a keyboard user could Tab to', () => {
    const [a, b, c] = SPECIES;
    const hotspot = { name: 'Oxley Creek Common', lat: -27.55, lng: 152.98, rich: 180, sp: [[a.id, 3]] as [number, number][] };
    const { container } = render(
      <MapSummary
        focus={a}
        unknownSpecies={false}
        focusPoints={[[-27.5, 153, 12]]}
        patches={[{ id: 1, name: 'Home patch', lat: -27.47, lng: 153.02, radiusKm: 2 }]}
        groups={[
          {
            key: '-27.5000,153.0000',
            lat: -27.5,
            lng: 153,
            items: [{ id: 1, speciesId: b.id, date: '2026-10-01', place: 'Home' } as never],
            names: [b, c],
          },
        ]}
        show="all"
        hotOn
        hotspotView={[{ h: hotspot, got: 0, needAll: [a], need: [a] }]}
        notes={[{ key: 'spot', html: '<span class="pop-h">Spot</span><p><a href="#/bird/1">Bird</a></p>', lat: -27.5, lng: 153 }]}
      />,
    );
    expect(container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    const text = container.textContent ?? '';
    expect(text).toContain('Home patch, 2 km radius');
    expect(text).toContain(`Home: ${b.name}, ${c.name}`);
    expect(text).toContain(`Oxley Creek Common: 180 dex species recorded here. You have seen 0. Still to find (1): ${a.name}.`);
    expect(text).toContain('SpotBird');
  });
});
