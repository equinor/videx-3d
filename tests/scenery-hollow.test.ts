import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  sceneryHollowInside,
  sceneryHollowWallAt,
} from '../src/components/Scenery/scenery-hollow';
import { Globe } from '../src/sdk/projection/globe';

const floorDepth = 35000;
const terraces = 0.8;

describe('sceneryHollowWallAt', () => {
  it('starts at the rim and ends on the floor', () => {
    for (let k = 0; k < 64; k++) {
      const turn = (2 * Math.PI * k) / 64;
      const [inset, depth] = sceneryHollowWallAt(turn, 0, floorDepth, terraces);
      expect(inset).toBeCloseTo(0, 6);
      expect(depth).toBeCloseTo(0, 6);
      expect(sceneryHollowWallAt(turn, 1, floorDepth, terraces)[1]).toBeCloseTo(
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
      const [a] = sceneryHollowWallAt(0, t, floorDepth, terraces);
      const [b] = sceneryHollowWallAt(2 * Math.PI, t, floorDepth, terraces);
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
        const turn = (0.6 * k) / 400;
        const [inset] = sceneryHollowWallAt(turn, t, floorDepth, terraces);
        if (inset > best) {
          best = inset;
          at = turn;
        }
      }
      return at;
    };
    // Along the rim of the default hollow, 100 km out.
    const apart = Math.abs(crest(0.25) - crest(0.65)) * 100000;
    expect(apart).toBeGreaterThan(500);
  });

  it('goes down evenly with no terraces', () => {
    let worst = 0;
    let where = '';
    for (let k = 0; k < 64; k++)
      for (let row = 0; row <= 24; row++) {
        const turn = (2 * Math.PI * k) / 64;
        const t = row / 24;
        const [, depth] = sceneryHollowWallAt(turn, t, floorDepth, 0);
        const off = Math.abs(depth - floorDepth * t);
        if (off > worst) {
          worst = off;
          where = `turn ${turn.toFixed(3)}, t ${t.toFixed(3)}`;
        }
      }
    expect(worst, where).toBeLessThan(1e-6);
  });

  it('keeps its proportions at any floor depth', () => {
    let worst = 0;
    let where = '';
    for (let k = 0; k < 64; k++)
      for (let row = 0; row <= 24; row++) {
        const turn = (2 * Math.PI * k) / 64;
        const t = row / 24;
        const [inset, depth] = sceneryHollowWallAt(turn, t, floorDepth, terraces);
        const [inset2, depth2] = sceneryHollowWallAt(turn, t, 2 * floorDepth, terraces);
        const off = Math.max(Math.abs(inset2 - 2 * inset), Math.abs(depth2 - 2 * depth));
        if (off > worst) {
          worst = off;
          where = `turn ${turn.toFixed(3)}, t ${t.toFixed(3)}`;
        }
      }
    expect(worst, where).toBeLessThan(1e-6);
  });
});

describe('sceneryHollowInside', () => {
  const globe = new Globe();
  globe.enabled = false;
  const radius = 100000;
  // The rim's reach at each of `count` turns round the axis, as a share of the radius.
  const rim = (wander: number, count = 2048) => {
    const reach: number[] = [];
    const point = new Vector3();
    for (let k = 0; k < count; k++) {
      const turn = (2 * Math.PI * k) / count;
      point.set(Math.cos(turn), 0, -Math.sin(turn)).multiplyScalar(radius);
      // Inside by as much as the rim lies past the radius.
      reach.push(1 + sceneryHollowInside(globe, radius, point, wander) / radius);
    }
    return reach;
  };

  it('is round with no wander', () => {
    const reach = rim(0);
    expect(Math.min(...reach)).toBeCloseTo(1, 9);
    expect(Math.max(...reach)).toBeCloseTo(1, 9);
  });

  it('wanders by as much as asked, at most', () => {
    for (const wander of [0.036, 0.15]) {
      const reach = rim(wander);
      const most = Math.max(...reach.map(r => Math.abs(r - 1)));
      expect(most, `wander ${wander}`).toBeLessThanOrEqual(wander + 1e-9);
      expect(most, `wander ${wander}`).toBeGreaterThan(0.5 * wander);
    }
  });
});
