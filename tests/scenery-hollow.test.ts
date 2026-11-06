import { describe, expect, it } from 'vitest';
import { sceneryHollowWallAt } from '../src/components/Scenery/scenery-hollow';

const floorDepth = 35000;
const rimLength = 2 * Math.PI * 500000;

describe('sceneryHollowWallAt', () => {
  it('starts at the rim and ends on the floor', () => {
    for (let k = 0; k < 64; k++) {
      const turn = (2 * Math.PI * k) / 64;
      const [inset, depth] = sceneryHollowWallAt(turn, 0, floorDepth, rimLength);
      expect(inset).toBeCloseTo(0, 6);
      expect(depth).toBeCloseTo(0, 6);
      expect(sceneryHollowWallAt(turn, 1, floorDepth, rimLength)[1]).toBeCloseTo(
        floorDepth,
        3,
      );
    }
  });

  it('meets itself where the rim wraps round', () => {
    let worst = 0;
    let where = '';
    for (let row = 0; row <= 72; row++) {
      const t = row / 72;
      const [a] = sceneryHollowWallAt(0, t, floorDepth, rimLength);
      const [b] = sceneryHollowWallAt(2 * Math.PI, t, floorDepth, rimLength);
      if (Math.abs(a - b) > worst) {
        worst = Math.abs(a - b);
        where = `t ${t.toFixed(3)}`;
      }
    }
    expect(worst, where).toBeLessThan(1);
  });

  it('moves its buttresses round the rim as they go down', () => {
    // Where the face stands farthest in round a stretch of rim, near the top and near the foot.
    const crest = (t: number) => {
      let best = -Infinity;
      let at = 0;
      for (let k = 0; k < 400; k++) {
        const turn = (0.2 * k) / 400;
        const [inset] = sceneryHollowWallAt(turn, t, floorDepth, rimLength);
        if (inset > best) {
          best = inset;
          at = turn;
        }
      }
      return at;
    };
    const apart = Math.abs(crest(0.25) - crest(0.65)) * 500000;
    expect(apart).toBeGreaterThan(500);
  });
});
