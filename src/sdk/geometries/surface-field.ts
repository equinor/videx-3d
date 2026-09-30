/**
 * Generated surface fields — a declarative description of a surface's shape and of
 * where it has data, plus the rasterizer that turns one into the same
 * `surface-values` a parser would produce.
 *
 * Two reasons this exists:
 *
 * - **Lowering the barrier.** Seeing chunks work should not require mapping a field
 *   into our data types first.
 * - **Testing what one dataset cannot show.** Real coverage varies enormously —
 *   hole area in the demo set spans three orders of magnitude — so calibrating
 *   anything against a single survey over-fits to it. Holes of a chosen size, a
 *   chosen extent mismatch and a chosen rotation are otherwise unobtainable.
 *
 * ⭐ Generated surfaces enter the system as DATA, in the same encoding as real
 * surfaces (see {@link generateSurfaceValues}), so they exercise the real path —
 * the null sentinel, the coverage mask, the hole fill — rather than a parallel one.
 * They are NOT the same thing as a chunk's synthetic *layers*, which are data-free
 * boundaries evaluated during a build.
 *
 * Deliberately free of any three.js import: this runs inside the (inlined) workers
 * alongside the rest of the grid maths.
 *
 * @module
 */

import { Vec2 } from '../types/common';
import { ReliefSpec, reliefDepth } from './procedural-relief';
import { SurfaceClipHeader, surfaceGridToWorld } from './surface-clip';

/**
 * A region of the XZ plane, in WORLD coordinates — used to say where a generated
 * surface has data (`boundary`) and where it does not ({@link SurfaceFieldSpec.holes}).
 *
 * World coordinates, not grid indices, so the same region means the same ground
 * whatever grid is laid over it.
 *
 * @group Geometries
 */
export type RegionSpec =
  | { kind: 'rect'; min: Vec2; max: Vec2 }
  | { kind: 'ellipse'; center: Vec2; radius: Vec2 | number }
  | { kind: 'polygon'; points: Vec2[] };

/**
 * A generated surface: its shape, and where it is mapped.
 *
 * Depths are POSITIVE-DOWN throughout, matching how surfaces are given.
 *
 * @group Geometries
 */
export type SurfaceFieldSpec = {
  /** depth of the undisturbed surface, in metres below sea level. Default 0. */
  base?: number;
  /**
   * Regional dip: `gradient` metres of deepening per metre travelled along
   * `azimuth` (degrees clockwise from +Z). A gradient of 0.01 is 10 m per km.
   */
  dip?: { azimuth: number; gradient: number };
  /** relief components, summed. Each contributes ± `amplitude / 2` about the base. */
  relief?: ReliefSpec[];
  /**
   * Where the surface is mapped. Omitted means the whole grid — which is the
   * unrealistic case: a real grid is a rectangle, but the surface was interpreted
   * over some polygon inside it.
   */
  boundary?: RegionSpec;
  /** regions with no data INSIDE the boundary (poor imaging, salt, unpicked). */
  holes?: RegionSpec[];
};

const DEG = Math.PI / 180;

/** Whether a world XZ position falls inside a region. */
function inRegion(region: RegionSpec, x: number, z: number): boolean {
  switch (region.kind) {
    case 'rect':
      return (
        x >= region.min[0] &&
        x <= region.max[0] &&
        z >= region.min[1] &&
        z <= region.max[1]
      );
    case 'ellipse': {
      const [cx, cz] = region.center;
      const rx =
        typeof region.radius === 'number' ? region.radius : region.radius[0];
      const rz =
        typeof region.radius === 'number' ? region.radius : region.radius[1];
      const dx = (x - cx) / (rx || 1);
      const dz = (z - cz) / (rz || 1);
      return dx * dx + dz * dz <= 1;
    }
    case 'polygon': {
      // even-odd ray cast
      const pts = region.points;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, zi] = pts[i];
        const [xj, zj] = pts[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
          inside = !inside;
        }
      }
      return inside;
    }
  }
}

/**
 * Evaluate a generated surface at a world position.
 *
 * @returns the depth in metres below sea level (positive-down), or `null` where the
 *   surface has no data.
 *
 * @group Geometries
 */
export function evaluateSurfaceField(
  spec: SurfaceFieldSpec,
  x: number,
  z: number,
): number | null {
  if (spec.boundary && !inRegion(spec.boundary, x, z)) return null;
  if (spec.holes) {
    for (const hole of spec.holes) if (inRegion(hole, x, z)) return null;
  }

  let depth = spec.base ?? 0;

  if (spec.dip) {
    const a = spec.dip.azimuth * DEG;
    depth += spec.dip.gradient * (x * Math.sin(a) + z * Math.cos(a));
  }

  if (spec.relief) {
    for (const relief of spec.relief) {
      depth += reliefDepth(relief, x, z);
    }
  }

  return depth;
}

/** The result of rasterizing a {@link SurfaceFieldSpec} onto a grid. */
export type GeneratedSurface = {
  /**
   * Depth-normalized samples in the library's storage convention:
   * `value = referenceDepth - depth`, with {@link GeneratedSurface.nullValue}
   * where the surface has no data.
   */
  values: Float32Array;
  /** shallowest depth over the mapped area (metres, positive-down) */
  min: number;
  /** deepest depth over the mapped area — and the `referenceDepth` used */
  max: number;
  /** the sentinel written where there is no data */
  nullValue: number;
  /** nodes with real data */
  covered: number;
};

/**
 * Rasterize a generated surface onto a grid, in the SAME encoding a parser
 * produces: depth-normalized as `referenceDepth - depth`, with a null sentinel.
 *
 * The encoding is not a detail. Reading it back is what exercises `sampleStrict`,
 * the coverage mask and the hole fill — a generator that handed over plain depths
 * with `NaN` holes would test a path no real data ever takes.
 *
 * `referenceDepth` is the realized MAXIMUM depth, matching the convention the chunk
 * spec uses (`referenceDepth: meta.max`), so values land in `[0, max - min]`.
 *
 * Node positions come from {@link surfaceGridToWorld}, the same mapping used to read
 * a surface back, so a generated grid cannot disagree with how it is sampled.
 *
 * @param spec what to generate
 * @param header the target grid (`nx`, `ny`, `xinc`, `yinc`, `rot`)
 * @param worldPosition the grid origin in scene XZ
 * @param nullValue sentinel for nodata. Default `-1`, matching `StackLayer.nullValue`.
 *
 * @group Geometries
 */
export function generateSurfaceValues(
  spec: SurfaceFieldSpec,
  header: SurfaceClipHeader,
  worldPosition: Vec2 = [0, 0],
  nullValue = -1,
): GeneratedSurface {
  const { nx, ny } = header;
  const toWorld = surfaceGridToWorld(header, worldPosition);
  const depths = new Float32Array(nx * ny);
  const has = new Uint8Array(nx * ny);

  let min = Infinity;
  let max = -Infinity;
  let covered = 0;

  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const i = row * nx + col;
      const [x, z] = toWorld(col, row);
      const depth = evaluateSurfaceField(spec, x, z);
      if (depth === null) continue;
      depths[i] = depth;
      has[i] = 1;
      covered++;
      if (depth < min) min = depth;
      if (depth > max) max = depth;
    }
  }

  // Nothing mapped: still a valid (empty) surface rather than a throw, so a story
  // with a bad boundary shows an empty chunk instead of failing to load.
  if (covered === 0) {
    return {
      values: new Float32Array(nx * ny).fill(nullValue),
      min: 0,
      max: 0,
      nullValue,
      covered: 0,
    };
  }

  const values = new Float32Array(nx * ny);
  for (let i = 0; i < values.length; i++) {
    values[i] = has[i] ? max - depths[i] : nullValue;
  }

  return { values, min, max, nullValue, covered };
}
