import { RefObject, useMemo } from 'react';
import { Group, Plane } from 'three';
import { fenceSideAt } from '../../sdk';
import { DEFAULT_OCEAN_DEEP_COLOR } from '../Ocean/ocean-material';
import { DEFAULT_OCEAN_BODY_FOG_DENSITY } from '../Ocean/ocean-volume-material';
import {
  ChunkFenceState,
  ChunkSectionState,
  StackImmersion,
  StackWater,
} from './chunk-defs';
import { SurfaceSampler } from './surface-sampler';
import { ImmersionMedium, useImmersionFog } from './useImmersionFog';

/** {@link StackImmersionFog} props. */
export type StackImmersionFogProps = {
  immersion: StackImmersion;
  water: StackWater | null;
  /** the drawn caps, for the sea bed and the top of the block alike */
  sampler: SurfaceSampler | null;
  /** the block's base in the stack's own frame — the carrier is not sampleable */
  base: number | null;
  section: ChunkSectionState | null;
  /** the stack's live fence, which removes a whole half of the block */
  fence: ChunkFenceState | null;
  frame: RefObject<Group | null>;
};

/**
 * Decide what the camera is standing in and hand it to {@link useImmersionFog}.
 *
 * ⚠️ Rendered ONLY when `ChunkStackProps.immersion` is declared. Installing
 * `scene.fog` at all changes every material's program cache key, so this cannot be
 * a hook that returns early — it has to not exist.
 *
 * ⚠️⚠️ "Below sea level" is not the test, and neither is "below the ground". Water
 * occupies the volume between the surface and the bed, over the footprint the bed
 * is drawn on; sediment occupies the block. A camera outside the footprint is
 * nowhere near the field, and fogging it there is a show-stopper: looking at
 * formations from kilometres away, everything blue.
 */
export const StackImmersionFog = ({
  immersion,
  water,
  sampler,
  base,
  section,
  fence,
  frame,
}: StackImmersionFogProps) => {
  const level = -(water?.depth ?? 0);
  const waterColor = water?.deepColor ?? DEFAULT_OCEAN_DEEP_COLOR;
  const waterDensity = water?.bodyFogDensity ?? DEFAULT_OCEAN_BODY_FOG_DENSITY;
  const rockColor = immersion.color ?? '#0b0a08';
  // ⚠️ `FogExp2` is exp(-(d * density)^2), so 1 / visibility puts ~63% fog at that
  // distance. Expressed as a distance because a useful density at field scale is a
  // number like 0.0025, which nobody can reason about.
  const rockDensity = 1 / Math.max(immersion.visibility ?? 400, 1e-3);
  const span = Math.max(immersion.transition ?? 5, 1e-3);
  const wantsWater = immersion.water !== false && !!water;
  const wantsRock = immersion.sediment !== false;

  const medium = useMemo(() => {
    const plane = new Plane();
    return (x: number, y: number, z: number): ImmersionMedium | null => {
      if (!sampler) return null;

      // ⚠️ The camera standing where the section took the block away is standing in
      // open air, whatever the heights say.
      if (section?.enabled) {
        plane.copy(section.plane);
        if (
          plane.normal.x * x + plane.normal.y * y + plane.normal.z * z >
          -plane.constant
        )
          return null;
      }

      // The same for a fence, which removes a whole half of the block.
      // ⭐ Asked EXACTLY, off the same segments the shader discards by, so the fog
      // switches at the cut rather than a few metres before or after it.
      if (fence?.enabled && fence.index && fence.field) {
        if (fenceSideAt(fence.index, fence.field, x, z) < 0) return null;
      }

      // The highest thing drawn over this point: the sea bed under the water, the
      // top of the block over land. `null` = nothing drawn here at all.
      const ground = sampler.getHeightAt(x, z);
      if (ground === null) return null;

      if (wantsWater && y < level && y > ground) {
        return {
          color: waterColor,
          density: waterDensity,
          amount: Math.min((level - y) / span, (y - ground) / span, 1),
        };
      }

      // ⚠️ Bounded below by the stack's own Y range rather than by the block's
      // base: a carrier floor is deliberately not sampleable (§5.3), so there is
      // nothing to ask. Approximate wherever the base is not flat.
      if (wantsRock && base !== null && y < ground && y > base) {
        return {
          color: rockColor,
          density: rockDensity,
          amount: Math.min((ground - y) / span, (y - base) / span, 1),
        };
      }
      return null;
    };
  }, [
    sampler,
    section,
    fence,
    base,
    level,
    span,
    wantsWater,
    wantsRock,
    waterColor,
    waterDensity,
    rockColor,
    rockDensity,
  ]);

  useImmersionFog({
    medium,
    frame,
    background: immersion.background !== false,
    settle: immersion.settle,
  });

  return null;
};
