import { MathUtils, Object3D, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createSkyAbyssWallGeometry,
  SKY_ABYSS_WALL_COLUMNS,
  SKY_ABYSS_WALL_ROWS,
  SKY_ABYSS_WALL_UNCUT,
  SkyAbyssWallCut,
  skyAbyssWallClipPlane,
  skyAbyssWallGrid,
  skyAbyssWallInView,
  skyAbyssWallLap,
  skyAbyssWallReach,
} from '../src/components/Sky/sky-abyss-walls';

// Volve's stage, and the walls' defaults.
const half: [number, number] = [7548, 6946];
const away = 10500;
const scale = 9900;
const black = 8000;

describe('skyAbyssWallGrid', () => {
  it('lays a column about every 4 texels of the cliffs round the lap', () => {
    const grid = skyAbyssWallGrid(half, away, scale, black, 1024);
    const texel = (scale * 8) / 1024;
    const column = skyAbyssWallLap(half, away) / grid.columns;
    expect(column / texel).toBeGreaterThan(3.5);
    expect(column / texel).toBeLessThan(4.5);
    expect(grid.rows).toBe(SKY_ABYSS_WALL_ROWS);
    expect(grid.depth).toBe(2.5 * black);
  });

  it('keeps its columns within bounds', () => {
    const [fewest, most] = SKY_ABYSS_WALL_COLUMNS;
    expect(skyAbyssWallGrid([0, 0], 100, 1e6, black, 1024).columns).toBe(
      fewest,
    );
    expect(skyAbyssWallGrid(half, away, 10, black, 1024).columns).toBe(most);
  });
});

describe('createSkyAbyssWallGeometry', () => {
  const geometry = createSkyAbyssWallGeometry();
  const positions = geometry.getAttribute('position').array;
  const indices = geometry.index!.array;
  const at = (v: number) => [positions[3 * v], positions[3 * v + 1]];
  const rows = SKY_ABYSS_WALL_ROWS;

  it('holds each vertex’s column and row, column by column', () => {
    const [, most] = SKY_ABYSS_WALL_COLUMNS;
    expect(positions.length).toBe(3 * (most + 1) * (rows + 1));
    expect(at(0)).toEqual([0, 0]);
    expect(at(rows)).toEqual([0, rows]);
    expect(at(rows + 1)).toEqual([1, 0]);
  });

  it('draws a grid of fewer columns with the first indices alone', () => {
    const columns = 300;
    const drawn = indices.subarray(0, 6 * columns * rows);
    const cells = new Set<string>();
    let outside = 0;
    for (let k = 0; k < drawn.length; k += 3) {
      const corners = [0, 1, 2].map(n => at(drawn[k + n]));
      for (const [i, j] of corners) if (i > columns || j > rows) outside++;
      const i = Math.min(...corners.map(c => c[0]));
      const j = Math.min(...corners.map(c => c[1]));
      cells.add(`${i},${j}`);
    }
    expect(outside).toBe(0);
    expect(cells.size).toBe(columns * rows);
  });

  it('meets along each cell’s diagonal from (i + 1, j) to (i, j + 1), all wound alike', () => {
    let off = 0;
    for (let k = 0; k < indices.length; k += 3) {
      const [a, b, c] = [0, 1, 2].map(n => at(indices[k + n]));
      const i = Math.min(a[0], b[0], c[0]);
      const j = Math.min(a[1], b[1], c[1]);
      const keys = [a, b, c].map(([x, y]) => `${x - i},${y - j}`);
      // Round (i) then down (j): the same turn for every triangle.
      const turn =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const diagonal = keys.includes('1,0') && keys.includes('0,1');
      if (turn !== -1 || diagonal === false) off++;
    }
    expect(off).toBe(0);
  });
});

describe('skyAbyssWallReach', () => {
  it('reaches past the stage’s corner by the walls’ distance, lean, wander and relief', () => {
    expect(skyAbyssWallReach([3000, 4000], 10500, 0.3, 20000, 4000, 5200)).toBe(
      5000 + 10500 + 6000 + 4000 + 5200,
    );
  });
});

describe('skyAbyssWallClipPlane', () => {
  const up = new Vector3(0, 1, 0);
  const walls: SkyAbyssWallCut = {
    centre: [5000, -3000],
    half: [12000, 4000],
    level: -100,
    depth: 20000,
    clip: 4800,
    distance: 10500,
    flare: 0.3,
    wander: 4000,
    relief: 5200,
  };
  const { centre, clip, level } = walls;
  const extent = walls.half;
  const above = new Vector3(2000, 2000, 40000);
  // Between the lid and the walls' foot, out in their rock.
  const outside = new Vector3(60000, -30000, 60000);

  // A camera at `position` looking `pitch` degrees above level (negative below), turned
  // `yaw` degrees from -Z toward -X, as orbit controls hold it: no roll.
  const cameraAt = (pitch: number, yaw: number, position: Vector3) => {
    const camera = new Object3D();
    camera.position.copy(position);
    camera.rotation.set(
      MathUtils.degToRad(pitch),
      MathUtils.degToRad(yaw),
      0,
      'YXZ',
    );
    camera.updateMatrixWorld();
    return camera;
  };
  const plane = (pitch: number, yaw: number, position: Vector3) => {
    const camera = cameraAt(pitch, yaw, position);
    return skyAbyssWallClipPlane(
      camera.matrixWorld,
      camera.position,
      up,
      walls,
      new Vector4(),
    );
  };
  const along = (p: Vector4, position: Vector3) =>
    p.x * position.x + p.y * position.y + p.z * position.z;
  const farCorner = (p: Vector4) =>
    Math.max(
      ...[-1, 1].flatMap(sx =>
        [-1, 1].map(
          sz => p.x * (centre[0] + sx * extent[0]) + p.z * (centre[1] + sz * extent[1]),
        ),
      ),
    );

  it('above the lid, is the plane it always was', () => {
    for (const yaw of [0, 37, 140, 270]) {
      for (const pitch of [0, -20, -60, -90]) {
        const m = cameraAt(pitch, yaw, above).matrixWorld.elements;
        // The screen's top plus the view, laid level; through the centre or `clip` ahead.
        const old = new Vector3(m[4] - m[8], 0, m[6] - m[10]).normalize();
        const w = Math.max(
          old.dot(above) + clip,
          old.x * centre[0] + old.z * centre[1],
        );
        const p = plane(pitch, yaw, above);
        expect(p.x).toBeCloseTo(old.x, 6);
        expect(p.y).toBeCloseTo(0, 6);
        expect(p.z).toBeCloseTo(old.z, 6);
        expect(p.w).toBeCloseTo(w, 3);
      }
    }
  });

  it('keeps its side as the view tilts up past 45°, and straight up', () => {
    for (const yaw of [0, 37, 140, 270]) {
      const heading = plane(10, yaw, outside);
      for (const pitch of [30, 44, 45, 46, 60, 89, 90]) {
        const p = plane(pitch, yaw, outside);
        expect(p.x * heading.x + p.z * heading.z).toBeCloseTo(1, 6);
      }
    }
  });

  it('below the lid, out of view of the stage, cuts away all the stage and the way to it', () => {
    for (const yaw of [0, 37, 140, 270]) {
      for (const pitch of [-30, 0, 20, 60]) {
        const p = plane(pitch, yaw, outside);
        // Short of the plane: the stage's every corner, and the camera.
        expect(p.w).toBeGreaterThanOrEqual(farCorner(p) - 1e-6);
        expect(p.w).toBeGreaterThanOrEqual(along(p, outside) + clip - 1e-6);
      }
    }
  });

  it('eases the push in over `clip` down from the lid, without a jump across it', () => {
    const at = (height: number) =>
      plane(20, 37, new Vector3(outside.x, height, outside.z));
    expect(Math.abs(at(level + 1).w - at(level - 1).w)).toBeLessThan(1);
    const pushed = at(level - clip);
    expect(pushed.w).toBeCloseTo(
      Math.max(
        along(pushed, new Vector3(outside.x, level - clip, outside.z)) + clip,
        farCorner(pushed),
      ),
      3,
    );
  });

  it('cuts nothing once the whole stage is in view through the hollow', () => {
    // In the hollow, over the stage.
    expect(plane(20, 37, new Vector3(5000, -15000, -3000)).w).toBe(
      SKY_ABYSS_WALL_UNCUT,
    );
    // Below the foot, under the stage.
    expect(plane(80, 37, new Vector3(5000, -60000, -3000)).w).toBe(
      SKY_ABYSS_WALL_UNCUT,
    );
    // Below the foot, far to the side: the near rim stands in front of the stage.
    const aside = new Vector3(90000, -60000, -3000);
    const p = plane(40, 90, aside);
    expect(p.w).toBeGreaterThan(along(p, aside));
  });
});

describe('skyAbyssWallInView', () => {
  const up = new Vector3(0, 1, 0);
  const walls: SkyAbyssWallCut = {
    centre: [5000, -3000],
    half: [12000, 4000],
    level: -100,
    depth: 20000,
    clip: 4800,
    distance: 10500,
    flare: 0.3,
    wander: 4000,
    relief: 5200,
  };
  const { centre, level } = walls;
  const extent = walls.half;
  const foot = level - walls.depth;
  // Inside the hollow's narrowest outline by how much, at (x, h, z).
  const margin = (x: number, h: number, z: number) => {
    const dx = Math.abs(x - centre[0]) - extent[0];
    const dz = Math.abs(z - centre[1]) - extent[1];
    const out =
      Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
    const inner =
      walls.distance + walls.flare * (level - h) - walls.wander - walls.relief;
    return inner - out;
  };

  it('is the least margin along the sight lines to the stage, the stage’s own aside', () => {
    const random = (() => {
      let a = 20261024;
      return () => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return a / 4294967296;
      };
    })();
    // The stage's 8 corners, from the lid to the foot, and points inside it.
    const targets: [number, number, number][] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (const h of [level, foot])
          targets.push([centre[0] + sx * extent[0], h, centre[1] + sz * extent[1]]);
    for (let i = 0; i < 40; i++)
      targets.push([
        centre[0] + (2 * random() - 1) * extent[0],
        level - random() * walls.depth,
        centre[1] + (2 * random() - 1) * extent[1],
      ]);
    for (let k = 0; k < 60; k++) {
      const p = new Vector3(
        centre[0] + (2 * random() - 1) * 60000,
        foot + 1000 - random() * 80000,
        centre[1] + (2 * random() - 1) * 60000,
      );
      let least = Infinity;
      for (const [tx, th, tz] of targets) {
        // Along the sight line, from where it is up to the foot to the stage.
        const s0 = p.y < foot ? (foot - p.y) / (th - p.y) : 0;
        for (let i = 0; i <= 20; i++) {
          const s = s0 + ((1 - s0) * i) / 20;
          least = Math.min(
            least,
            margin(p.x + (tx - p.x) * s, p.y + (th - p.y) * s, p.z + (tz - p.z) * s),
          );
        }
      }
      // The stage's own corners are in the hollow at the lid and the foot whatever the camera.
      const own = Math.min(
        margin(centre[0] + extent[0], level, centre[1] + extent[1]),
        margin(centre[0] + extent[0], foot, centre[1] + extent[1]),
      );
      expect(least).toBeCloseTo(Math.min(skyAbyssWallInView(p, up, walls), own), 3);
    }
  });

  it('is -Infinity from above the lid', () => {
    expect(skyAbyssWallInView(new Vector3(0, 0, 0), up, walls)).toBe(-Infinity);
  });
});
