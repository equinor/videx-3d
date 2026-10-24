import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  MathUtils,
  Matrix4,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import fillFragmentShader from './shaders/sky-abyss-wall-fill-fragment.glsl';
import fillVertexShader from './shaders/sky-abyss-wall-fill-vertex.glsl';
import fragmentShader from './shaders/sky-abyss-wall-fragment.glsl';
import vertexShader from './shaders/sky-abyss-wall-vertex.glsl';
import type { SkyMaterial } from './sky-material';

/** Rows down the void's walls' mesh, closer together near the lid. */
export const SKY_ABYSS_WALL_ROWS = 32;
/** The fewest and the most columns round the void's walls' mesh. */
export const SKY_ABYSS_WALL_COLUMNS = [128, 1024] as const;
// Texels of the cliffs to a column of the mesh.
const SKY_ABYSS_WALL_COLUMN_TEXELS = 4;
// How deep the mesh goes, in the depths the light on the walls fades to nearly black by.
const SKY_ABYSS_WALL_DEPTH = 2.5;
// Features across one tile of the cliffs (SKY_ABYSS_CLIFF_TILE in the shaders).
const SKY_ABYSS_CLIFF_TILE = 8;

/** The whole way round the walls' outline (`skyAbyssWallLap`). */
export function skyAbyssWallLap(half: [number, number], away: number) {
  return 4 * (half[0] + half[1] + (Math.PI / 2) * away);
}

/**
 * How far out from the stage's centre the void walls' rock can reach down to their mesh's
 * foot `depth` below the lid: past the stage's corner (half extents `half`) by `distance`,
 * leaning out by `flare` per unit of depth, and wandering and standing out by `wander` and
 * `relief` at most.
 */
export function skyAbyssWallReach(
  half: [number, number],
  distance: number,
  flare: number,
  depth: number,
  wander: number,
  relief: number,
) {
  return Math.hypot(half[0], half[1]) + distance + flare * depth + wander + relief;
}

/** `uSkyAbyssWallClip.w` when nothing is cut: the plane infinitely far behind. */
export const SKY_ABYSS_WALL_UNCUT = -1e30;

/** Where the void's walls are and how they are cut (`skyAbyssWallClipPlane`). */
export type SkyAbyssWallCut = {
  /** the stage's centre, world X and Z */
  centre: [number, number];
  /** the stage's half extents, world X and Z */
  half: [number, number];
  /** the lid's height along up */
  level: number;
  /** how deep their mesh goes below the lid; 0 before it is laid */
  depth: number;
  /** `SkyAbyssWalls.clip` */
  clip: number;
  /** `SkyAbyssWalls.distance` */
  distance: number;
  /** `SkyAbyssWalls.flare` */
  flare: number;
  /** `SkyAbyssWalls.wander` */
  wander: number;
  /** `SkyAbyssWalls.relief` */
  relief: number;
};

// Of the walls' `distance`, how far inside the hollow the view of the stage must be before
// the cut is gone: it eases open from where the view grazes their rock to there.
const SKY_ABYSS_WALL_OPEN_EASE = 0.5;
const STAGE_CORNERS: readonly [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * How far inside the void's hollow the view of the whole stage from a camera at `position`
 * stays, in world units: above 0, no rock of the walls stands between the camera and any of
 * it; -Infinity from above the lid. The hollow is taken at its narrowest, the stage's
 * rectangle pushed out by their `distance` less their `wander` and `relief`, leaning out by
 * their `flare` with depth. That is convex at every depth and as it widens, so the stage is
 * in view wherever its corners are. From between the lid and their foot it is how far
 * inside it the camera is; from below their foot, where their rock is solid, how far inside
 * it at the foot the sight lines to the stage's corners at the lid pass. ⚠️ Assumes the
 * default `up` (+Y), as the stage does.
 */
export function skyAbyssWallInView(
  position: Vector3,
  up: Vector3,
  walls: SkyAbyssWallCut,
) {
  const { centre, half, level, depth } = walls;
  const height = position.dot(up);
  if (height >= level) return -Infinity;
  const inner = (h: number) =>
    walls.distance +
    walls.flare * Math.max(level - h, 0) -
    walls.wander -
    walls.relief;
  // Out from the stage's rectangle, world X and Z: below 0 inside it.
  const out = (x: number, z: number) => {
    const dx = Math.abs(x - centre[0]) - half[0];
    const dz = Math.abs(z - centre[1]) - half[1];
    return (
      Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0)
    );
  };
  const foot = level - depth;
  if (height >= foot) return inner(height) - out(position.x, position.z);
  const t = (foot - height) / (level - height);
  let margin = Infinity;
  for (const [sx, sz] of STAGE_CORNERS) {
    const x = position.x + (centre[0] + sx * half[0] - position.x) * t;
    const z = position.z + (centre[1] + sz * half[1] - position.z) * t;
    margin = Math.min(margin, inner(foot) - out(x, z));
  }
  return margin;
}

const clipForward = new Vector3();
const clipScreenUp = new Vector3();

/**
 * The plane the void's walls are cut away up to (`uSkyAbyssWallClip`), for a camera with
 * world matrix `matrix` at `position`, into `target`: xyz its normal, level and facing the
 * camera's heading, and w how far along it the cut reaches. What lies short of w is cut
 * away, whichever side of it the camera is on.
 *
 * The heading is the view's laid level, with the screen's top looking down, so it is
 * defined looking straight down too, and with its bottom looking up, so it keeps its side
 * as the view tilts up past 45° and straight up; the two agree looking level. Undefined, it
 * keeps `target`'s normal. The plane passes through the stage's `centre` (world X and Z),
 * or `clip` in front of the camera once that is further; below the lid it is pushed on past
 * the stage's far corner, easing in over `clip` down from the lid, so the whole stage lies
 * in what is cut away and no cut face stands behind it. Once the whole stage is in view
 * through the hollow (`skyAbyssWallInView`) the cut eases back past the camera and the far
 * rim, so less and less is cut, and then nothing is (SKY_ABYSS_WALL_UNCUT): from there,
 * the whole rim shows.
 */
export function skyAbyssWallClipPlane(
  matrix: Matrix4,
  position: Vector3,
  up: Vector3,
  walls: SkyAbyssWallCut,
  target: Vector4,
): Vector4 {
  const m = matrix.elements;
  const forward = clipForward.set(-m[8], -m[9], -m[10]);
  const lookUp = MathUtils.clamp(forward.dot(up), -1, 1);
  const screenUp = clipScreenUp.set(m[4], m[5], m[6]);
  const heading = forward.addScaledVector(screenUp, lookUp > 0 ? -1 : 1);
  heading.addScaledVector(up, -heading.dot(up));
  if (heading.lengthSq() > 1e-12) {
    heading.normalize();
    target.set(heading.x, heading.y, heading.z, 0);
  }
  const { centre, half, clip } = walls;
  // Down from the lid, the push past the stage and the opening come in together.
  const below = MathUtils.smoothstep(walls.level - position.dot(up), 0, clip);
  const opened =
    below *
    MathUtils.smoothstep(
      skyAbyssWallInView(position, up, walls),
      0,
      SKY_ABYSS_WALL_OPEN_EASE * walls.distance,
    );
  if (opened >= 1) {
    target.w = SKY_ABYSS_WALL_UNCUT;
    return target;
  }
  const at = target.x * position.x + target.y * position.y + target.z * position.z;
  const across = target.x * centre[0] + target.z * centre[1];
  let far = -Infinity;
  for (const [sx, sz] of STAGE_CORNERS) {
    far = Math.max(
      far,
      target.x * (centre[0] + sx * half[0]) + target.z * (centre[1] + sz * half[1]),
    );
  }
  let cut = Math.max(at + clip, across);
  cut += Math.max(far - cut, 0) * below;
  const reach = skyAbyssWallReach(
    half,
    walls.distance,
    walls.flare,
    walls.depth,
    walls.wander,
    walls.relief,
  );
  target.w = MathUtils.lerp(cut, Math.min(across - reach, at - clip), opened);
  return target;
}

/** The grid the void's walls' mesh is laid on (`uSkyAbyssWallGrid`). */
export type SkyAbyssWallGrid = {
  /** columns round their outline */
  columns: number;
  /** rows down from the lid */
  rows: number;
  /** how deep it goes below the lid, in world units */
  depth: number;
};

/**
 * The grid for walls `away` out from a stage of half extents `half`, their rock's features
 * `scale` across and their light black by `black` below the lid, from cliffs baked `texels`
 * across: a column every few texels of the cliffs, and as deep as the walls show.
 */
export function skyAbyssWallGrid(
  half: [number, number],
  away: number,
  scale: number,
  black: number,
  texels: number,
): SkyAbyssWallGrid {
  const texel = (scale * SKY_ABYSS_CLIFF_TILE) / texels;
  const [fewest, most] = SKY_ABYSS_WALL_COLUMNS;
  const columns = Math.round(
    skyAbyssWallLap(half, away) / (SKY_ABYSS_WALL_COLUMN_TEXELS * texel),
  );
  return {
    columns: MathUtils.clamp(columns, fewest, most),
    rows: SKY_ABYSS_WALL_ROWS,
    depth: SKY_ABYSS_WALL_DEPTH * black,
  };
}

/**
 * The void's walls' mesh, for as many columns as it can have: each vertex holds its column
 * and row (X, Y), column by column, so a grid of fewer columns is the first
 * `6 * columns * SKY_ABYSS_WALL_ROWS` indices (`setDrawRange`). A cell's two triangles meet
 * along its diagonal from (i + 1, j) to (i, j + 1), and face the hollow as the vertex shader
 * lays them (`skyAbyssWallVertex`).
 */
export function createSkyAbyssWallGeometry(): BufferGeometry {
  const columns = SKY_ABYSS_WALL_COLUMNS[1];
  const rows = SKY_ABYSS_WALL_ROWS;
  const stride = rows + 1;
  const positions = new Float32Array(3 * (columns + 1) * stride);
  for (let i = 0; i <= columns; i++) {
    for (let j = 0; j <= rows; j++) {
      positions[3 * (i * stride + j)] = i;
      positions[3 * (i * stride + j) + 1] = j;
    }
  }
  const indices = new Uint16Array(6 * columns * rows);
  let k = 0;
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      const at = i * stride + j;
      const next = at + stride;
      indices.set([at, at + 1, next, next, at + 1, next + 1], k);
      k += 6;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/**
 * A material for the void's walls' mesh (`SkyAbyssWallLayer`). It inherits the sky
 * material's uniform objects, so it follows every change to the walls.
 */
export function createSkyAbyssWallMaterial(sky: SkyMaterial) {
  const uniforms = Object.create(sky.uniforms) as Record<string, Uniform>;
  // Debug views: drawn in one colour (for a wireframe), and without their relief.
  uniforms.uSkyAbyssWallDebug = new Uniform(new Vector2());
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    defines: { SKY_ABYSS: '', SKY_ABYSS_WALLS: '' },
    dithering: true,
  });
}

/**
 * A material for the void walls' fill drawn as geometry, on a quad on the plane they are
 * cut along, or on the lid (`lid`): where it lies in their rock, shaded as the background
 * shades their fill, with its depth. A debug view (`SkyDebug.walls.flat`).
 */
export function createSkyAbyssWallFillMaterial(sky: SkyMaterial, lid: boolean) {
  const uniforms = Object.create(sky.uniforms) as Record<string, Uniform>;
  uniforms.uSkyAbyssWallFillLid = new Uniform(lid ? 1 : 0);
  return new ShaderMaterial({
    vertexShader: fillVertexShader,
    fragmentShader: fillFragmentShader,
    uniforms,
    defines: { SKY_ABYSS: '', SKY_ABYSS_WALLS: '' },
    side: DoubleSide,
    dithering: true,
  });
}
