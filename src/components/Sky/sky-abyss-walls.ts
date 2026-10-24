import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  MathUtils,
  ShaderMaterial,
  Uniform,
  Vector2,
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
