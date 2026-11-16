import { useFrame } from '@react-three/fiber';
import { createContext, RefObject, useContext, useState } from 'react';
import { Object3D, Vector2, Vector3 } from 'three';
import type { Globe } from '../../sdk/projection/globe';
import type { OceanCharts } from '../../sdk/projection/ocean-charts';
import { OceanMaterial } from './ocean-material';

/**
 * Read-only sampler for the live ocean surface. Lets non-rendering code (e.g.
 * floating objects) query the water height at any world X/Z, in sync with the
 * animated wave field shown on screen.
 *
 * The height is the material's sea state's (`SeaState.heightAtDepth`): the same
 * waves the surface draws, hex tiling included, at the material's clock, cut by
 * the water's depth as the shaders cut them, so it follows the wind and the
 * shore as the drawn sea does. Only what texture filtering smooths away differs
 * (millimetres).
 *
 * Coordinates are in the Ocean group's local frame (sea level = local y 0),
 * which equals world space for the typical flat, unrotated planar ocean. Under a
 * `Scenery` they are the scene's, which its sampler takes into the waves' plane
 * ({@link OceanPlane}).
 */
export interface OceanSampler {
  /** Water surface height (local y) at the given local X/Z. */
  getHeightAt(x: number, z: number): number;
  /** Significant wave height (m) of the current sea state. */
  readonly significantHeight: number;
  /**
   * The water's height over the still sea at world `point`, along the sea's up there (the
   * still sea's point is {@link stillSeaAt}'s): a `Scenery`'s, anywhere on its globe, in the
   * charts its sea is drawn in (`OceanCharts`). Absent where the waves lie in one plane (an
   * `Ocean`'s, a `ChunkStack`'s): there, {@link getHeightAt}.
   */
  heightAtWorld?(point: Vector3): number;
  /** The still sea's point under (or over) world `point`, along the sea's up there, into `target`. With {@link heightAtWorld}. */
  stillSeaAt?(point: Vector3, target: Vector3): Vector3;
}

/** What {@link chartedSeaHeights} reads a sea drawn in charts on a globe by. */
export type ChartedSea = {
  globe: Globe;
  charts: OceanCharts;
  /** the waves' height at chart point `x`, `z` over still water `depth` deep (`SeaState.heightAtDepth`) */
  heightAt: (x: number, z: number, depth: number) => number;
  /** the still water's depth under the still sea's world point */
  depthAt: (point: Vector3) => number;
};

/**
 * The world-space half of an {@link OceanSampler} for a sea drawn in charts on a globe (a
 * `Scenery`'s, `OceanCharts`): a point is taken along up onto the still sea, into the chart
 * it lies in (as `ocean-charts.glsl` takes it), and its waves are kept by how far it lies
 * from where two charts meet, as the drawn ones are. Over the field, the field's chart: what
 * the plane's sampler gives, to within millimetres.
 */
export function chartedSeaHeights(
  sea: ChartedSea,
): Required<Pick<OceanSampler, 'heightAtWorld' | 'stillSeaAt'>> {
  const up = new Vector3();
  const still = new Vector3();
  const coords = new Vector2();
  const stillSeaAt = (point: Vector3, target: Vector3) => {
    const { globe } = sea;
    globe.upAt(point, up);
    return target.copy(point).addScaledVector(up, -globe.altitude(point));
  };
  return {
    stillSeaAt,
    heightAtWorld(point: Vector3): number {
      stillSeaAt(point, still);
      const { chart, keep } = sea.charts.chartAt(still);
      if (keep <= 0) return 0;
      sea.charts.coords(chart, still, coords);
      return keep * sea.heightAt(coords.x, coords.y, sea.depthAt(still));
    },
  };
}

/**
 * The plane a sea's waves are laid out in, seen from the frame floating objects move in:
 * the waves' X along `east`, their Z along `-north`, both level (no Y), through the
 * frame's origin. Read live, so they may be a shader's uniform values. A `Scenery` lays
 * its sea out in true east and south at the field, which a projected grid (UTM, say) turns
 * from the scene's own X and Z by the grid's convergence: about 1° at Volve, so tens of
 * metres a few kilometres out. Without one, the frame's own X and Z.
 */
export type OceanPlane = {
  east: Vector3;
  north: Vector3;
};

/** The point `x`, `z` of the objects' frame in `plane`'s coordinates, into `out`. */
export function toOceanPlane(
  plane: OceanPlane,
  x: number,
  z: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const { east, north } = plane;
  const px = x * east.x + z * east.z;
  out.z = -(x * north.x + z * north.z);
  out.x = px;
  return out;
}

/**
 * Create an {@link OceanSampler} bound to an {@link OceanMaterial}. The sampler
 * reads the material's sea state, so it reflects sea-state and time changes
 * without any extra wiring. Its heights answer the water's depth as the drawn
 * waves do (`SeaState.heightAtDepth`): they shoal and die out toward a shore.
 *
 * @param level scene Y of the still water surface. The `Ocean` component leaves
 *   this at 0 because its own group IS sea level; a `ChunkStack` passes the sea's
 *   level so the heights come back ABSOLUTE in the stack's frame and a floating
 *   object needs no sea-level parent group of its own.
 * @param plane the plane the waves are laid out in, when it is not the frame's own X/Z
 *   (a `Scenery`'s): the point asked for is taken into it first, so an object rides the
 *   waves drawn under it.
 * @param depthAt the still water's depth at a point of the frame, where the material's own
 *   ({@link OceanMaterial.depthAt}) is not what its waves read (a `Scenery`'s, on the scene's
 *   ground); `undefined` there falls back to it.
 */
export function createOceanSampler(
  material: OceanMaterial,
  level = 0,
  plane?: OceanPlane,
  depthAt?: (x: number, z: number) => number | undefined,
): OceanSampler {
  const at = { x: 0, z: 0 };
  return {
    getHeightAt(x: number, z: number): number {
      const depth = depthAt?.(x, z) ?? material.depthAt(x, z);
      if (plane) {
        toOceanPlane(plane, x, z, at);
        x = at.x;
        z = at.z;
      }
      return (
        level +
        material.seaState.heightAtDepth(x, z, depth, material.shoreBreakDepth)
      );
    },
    get significantHeight(): number {
      return material.significantHeight;
    },
  };
}

/**
 * Context carrying the current {@link OceanSampler}. An `<Ocean>` provides this
 * to its children; floating components read it (directly or via
 * {@link useBuoyancy}) to follow the waves. `null` when the component is not
 * rendered inside an `<Ocean>` (so consumers can fall back to a static pose).
 */
export const OceanSamplerContext = createContext<OceanSampler | null>(null);

/**
 * Access the {@link OceanSampler} provided by an enclosing `<Ocean>`, or `null`
 * when there is none.
 */
export function useOceanSampler(): OceanSampler | null {
  return useContext(OceanSamplerContext);
}

/** A body-frame sample point `[x, z]` taken at the object's waterline (y 0). */
export type BuoyancyPoint = [x: number, z: number];

/**
 * Options for {@link useBuoyancy}.
 */
export type BuoyancyOptions = {
  /**
   * Sample points in the object's local X/Z (at its waterline). Required.
   *
   * Place them at the true hull extents (e.g. bow / stern / port / starboard):
   * this is how the object's length and width feed into the motion. Waves
   * shorter than the span between points decorrelate, so the fitted plane
   * yields little pitch/roll (a long ship barely reacts to short chop), while
   * swells longer than the object move it as a whole.
   */
  points: BuoyancyPoint[];
  /** Master switch; when `false` the object is left untouched. Default `true`. */
  enabled?: boolean;
  /**
   * Response rate (per second) of the heave/pitch/roll smoothing. Higher snaps
   * to the waves faster; lower is more sluggish. Default `3`.
   */
  damping?: number;
  /**
   * Relative mass / inertia of the object (default `1`). Models how heavy the
   * object is: the effective response rate is divided by this, so a heavier
   * object follows the surface more slowly and its motion amplitude shrinks for
   * fast waves it cannot keep up with. Use a value relative to a "typical"
   * object of its kind (e.g. `weight / referenceWeight`).
   */
  mass?: number;
};

/**
 * Make an object float on the ocean by following the wave field provided by an
 * enclosing `<Ocean>`. Reusable for any floating component: pass a ref to the
 * object's group and a few body-frame sample points (e.g. bow / stern / port /
 * starboard at the waterline).
 *
 * Each frame the water height is sampled at those points (accounting for the
 * object's current heading and X/Z position) and a plane is fitted to them to
 * drive:
 *  - heave  → `position.y` (mean surface height),
 *  - pitch  → `rotation.z` (fore/aft slope),
 *  - roll   → `rotation.x` (port/starboard slope),
 * each critically-damped toward its target so the motion stays smooth and
 * frame-rate independent. The object's heading (`rotation.y`) is left untouched.
 *
 * No-op when there is no enclosing `<Ocean>` (the object keeps its static pose).
 * Allocation-free and only a handful of cheap samples per frame.
 *
 * Under a `Scenery` (a sampler with {@link OceanSampler.heightAtWorld}) the points are taken
 * into the world and read on the sea drawn there, anywhere on its globe, and the pose is
 * the parent's: its +Y is taken for the sea's up, as a `Wgs84Position` or `UtmPosition`
 * placing it on the globe gives, and its heave is over the still sea under it.
 */
export function useBuoyancy(
  ref: RefObject<Object3D | null>,
  options: BuoyancyOptions,
): void {
  const sampler = useOceanSampler();
  const [scratch] = useState(() => ({
    world: new Vector3(),
    still: new Vector3(),
  }));

  useFrame((_, delta) => {
    const obj = ref.current;
    if (!obj || !sampler || options.enabled === false) return;

    const points = options.points;
    const n = points.length;
    if (n === 0) return;

    // On a globe's sea: the points read in the world, the pose in the parent's frame.
    const parent = obj.parent;
    const onGlobe = !!parent && !!sampler.heightAtWorld && !!sampler.stillSeaAt;
    if (onGlobe) parent.updateWorldMatrix(true, false);
    const { world } = scratch;

    const yaw = obj.rotation.y;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const ox = obj.position.x;
    const oz = obj.position.z;

    // Accumulate sums for a least-squares plane fit h = a*x + b*z + c over the
    // body-frame sample points (decoupled axes — exact for symmetric layouts,
    // good enough otherwise).
    let sx = 0;
    let sz = 0;
    let sh = 0;
    let sxx = 0;
    let szz = 0;
    let sxh = 0;
    let szh = 0;

    for (let i = 0; i < n; i++) {
      const px = points[i][0];
      const pz = points[i][1];
      // Rotate the body point by the heading (Y rotation) and offset to the
      // object's local X/Z, then sample the surface there.
      const wx = ox + px * cos + pz * sin;
      const wz = oz - px * sin + pz * cos;
      const h = onGlobe
        ? sampler.heightAtWorld!(
            world.set(wx, obj.position.y, wz).applyMatrix4(parent!.matrixWorld),
          )
        : sampler.getHeightAt(wx, wz);
      sx += px;
      sz += pz;
      sh += h;
      sxx += px * px;
      szz += pz * pz;
      sxh += px * h;
      szh += pz * h;
    }

    const denomX = n * sxx - sx * sx;
    const denomZ = n * szz - sz * sz;
    const a = denomX > 1e-6 ? (n * sxh - sx * sh) / denomX : 0;
    const b = denomZ > 1e-6 ? (n * szh - sz * sh) / denomZ : 0;
    const c = (sh - a * sx - b * sz) / n;

    // On a globe's sea the heights are over the still sea: its height in the parent's frame
    // under the object, added.
    let level = 0;
    if (onGlobe) {
      world.copy(obj.position).applyMatrix4(parent!.matrixWorld);
      const still = sampler.stillSeaAt!(world, scratch.still);
      level = parent!.worldToLocal(still).y;
    }
    const targetY = level + c;
    const targetPitch = Math.atan(a); // about +Z: bow up when surface rises fore
    const targetRoll = -Math.atan(b); // about +X

    // Frame-rate independent critical-damping factor. A heavier object (mass
    // > 1) has more inertia, so it follows the surface more slowly.
    const mass = Math.max(options.mass ?? 1, 1e-3);
    const rate = (options.damping ?? 3) / mass;
    const f = 1 - Math.exp(-rate * delta);

    obj.position.y += (targetY - obj.position.y) * f;
    obj.rotation.z += (targetPitch - obj.rotation.z) * f;
    obj.rotation.x += (targetRoll - obj.rotation.x) * f;
  });
}
