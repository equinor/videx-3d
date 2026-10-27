import { describe, expect, it } from 'vitest';
import { createSceneryReliefTilePatch } from '../src/components/Scenery/scenery-relief-tiles';

describe('createSceneryReliefTilePatch', () => {
  it('ends every skirt triangle on a skirt vertex and every grid triangle on a grid node', () => {
    // The shader tells a skirt by its triangle's last (provoking) vertex: `vReliefSkirt` is flat.
    const patch = createSceneryReliefTilePatch(8, 1);
    const skirt = patch.getAttribute('reliefSkirt').array;
    const index = patch.getIndex()!.array;
    let skirts = 0;
    for (let t = 0; t < index.length; t += 3) {
      const onSkirt = [0, 1, 2].some(k => skirt[index[t + k]] > 0);
      expect(skirt[index[t + 2]] > 0).toBe(onSkirt);
      if (onSkirt) skirts++;
    }
    expect(skirts).toBe(2 * 4 * 8);
  });
});
