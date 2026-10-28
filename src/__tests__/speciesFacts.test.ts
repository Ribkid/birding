// The size line on the species page and Compare takes v1's label for the measure (v1 js/app.js sizeFact).
import { describe, expect, it } from 'vitest';
import { sizeFact } from '../screens/speciesFacts';
import type { Species } from '../lib/data';

const sp = (kind: string, sizeText: string) => ({ kind, sizeText }) as Species;

describe('sizeFact', () => {
  it('labels a bird or mammal size as Length', () => {
    expect(sizeFact(sp('bird', '50 cm'))).toEqual(['Length', '50 cm']);
    expect(sizeFact(sp('mammal', '1-2 m with tail'))).toEqual(['Length', '1-2 m with tail']);
  });

  it('names wingspan, shell and body sizes and drops the repeated word', () => {
    expect(sizeFact(sp('butterfly', 'wingspan 4-5 cm'))).toEqual(['Wingspan', '4-5 cm']);
    expect(sizeFact(sp('reptile', '25 cm shell'))).toEqual(['Shell', '25 cm']);
    expect(sizeFact(sp('frog', '7 cm body'))).toEqual(['Body', '7 cm']);
  });

  it('gives plants a Height, and Grows as when there is no measure', () => {
    expect(sizeFact(sp('plant', 'to 30 m'))).toEqual(['Height', 'Up to 30 m']);
    expect(sizeFact(sp('plant', 'climber'))).toEqual(['Grows as', 'Climber']);
    expect(sizeFact(sp('bird', ''))).toBeNull();
  });
});
