import { useFrame } from '@react-three/fiber';
import { createContext, RefObject, useContext } from 'react';
import { Object3D, Vector4 } from 'three';
import { OceanMaterial } from './ocean-material';

/**
 * Read-only sampler for the live ocean surface. Lets non-rendering code (e.g.
 * floating objects) query the water height at any world X/Z, in sync with the
 * animated wave field shown on screen.
 *
 * The height is summed from the same spectral wave components the shader uses
 * (`uWaveA`/`uWaveB` + `uTime`, read by reference from the material), so it
 * always matches the current sea state, wind and animation time. The optional
 * Gerstner horizontal displacement and the render-time footprint LOD fade are
 * intentionally ignored — they are visual-only refinements, not needed for a
 * plausible floating response, and skipping them keeps sampling cheap.
 *
 * Coordinates are in the Ocean group's local frame (sea level = local y 0),
 * which equals world space for the typical flat, unrotated planar ocean.
 */
export interface OceanSampler {
  /** Water surface height (local y) at the given local X/Z. */
  getHeightAt(x: number, z: number): number;
  /** Significant wave height (m) of the current sea state. */
  readonly significantHeight: number;
}

/**
 * Create an {@link OceanSampler} bound to an {@link OceanMaterial}. The sampler
 * reads the material's wave uniforms by reference, so it reflects sea-state and
 * time changes without any extra wiring.
 */
export function createOceanSampler(material: OceanMaterial): OceanSampler {
  return {
    getHeightAt(x: number, z: number): number {
      const waveA = material.uniforms.uWaveA.value as Vector4[];
      const waveB = material.uniforms.uWaveB.value as Vector4[];
      const t = material.uniforms.uTime.value as number;
      let height = 0;
      for (let i = 0; i < waveA.length; i++) {
        const a = waveA[i];
        const dirX = a.x;
        const dirZ = a.y;
        const k = a.z;
        const omega = a.w;
        const amp = waveB[i].x;
        const phase = waveB[i].y;
        const ph = k * (dirX * x + dirZ * z) - omega * t + phase;
        height += amp * Math.sin(ph);
      }
      return height;
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
 */
export function useBuoyancy(
  ref: RefObject<Object3D | null>,
  options: BuoyancyOptions,
): void {
  const sampler = useOceanSampler();

  useFrame((_, delta) => {
    const obj = ref.current;
    if (!obj || !sampler || options.enabled === false) return;

    const points = options.points;
    const n = points.length;
    if (n === 0) return;

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
      const h = sampler.getHeightAt(wx, wz);
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

    const targetY = c;
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
