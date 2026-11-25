import { RefObject, useCallback, useMemo } from 'react';
import { Group, Matrix4, Plane, Vector3 } from 'three';
import { useCameraProbe } from '../../hooks/useCameraSite';
import {
  CAMERA_PROBE_ORDER,
  type CameraProbe,
} from '../../sdk/utils/camera-site';
import { fenceSideAt } from '../../sdk/geometries/fence-segments';
import { WATER_FADE, waterOpticsOf } from '../../sdk/weather/water-optics';
import {
  ZoneFenceState,
  ZoneSectionState,
  ZoneStackInteriorFog,
  ZoneStackSea,
} from './zone-defs';
import { SurfaceSampler } from './surface-sampler';
import { FogMedium, useMediumFog } from '../../hooks/useMediumFog';

/** {@link StackInteriorFog} props. */
export type StackInteriorFogProps = {
  interiorFog: ZoneStackInteriorFog;
  sea: ZoneStackSea | null;
  /** the drawn caps, for the sea bed and the top of the block alike */
  sampler: SurfaceSampler | null;
  /** the block's base in the stack's own frame — the carrier is not sampleable */
  base: number | null;
  section: ZoneSectionState | null;
  /** whether the section takes the sea with it (see `ZoneSection.sea`) */
  sectionSea: boolean;
  /** the stack's live fence, which removes a whole half of the block */
  fence: ZoneFenceState | null;
  /** whether the fence takes the sea with it (see `ZoneFence.sea`) */
  fenceSea: boolean;
  frame: RefObject<Group | null>;
};

/**
 * Decide what the camera is standing in, as the camera site's medium (CameraSite.medium,
 * a probe of CAMERA_PROBE_ORDER.medium), and fade by it with {@link useMediumFog}.
 *
 * ⚠️ Rendered ONLY when `ZoneStackProps.interiorFog` is declared. Installing
 * `scene.fog` at all changes every material's program cache key, so this cannot be
 * a hook that returns early — it has to not exist.
 *
 * ⚠️⚠️ "Below sea level" is not the test, and neither is "below the ground". Water
 * occupies the volume between the surface and the bed, over the footprint the bed
 * is drawn on; sediment occupies the block. A camera outside the footprint is
 * nowhere near the field, and fogging it there is a show-stopper: looking at
 * formations from kilometres away, everything blue.
 */
export const StackInteriorFog = ({
  interiorFog,
  sea,
  sampler,
  base,
  section,
  sectionSea,
  fence,
  fenceSea,
  frame,
}: StackInteriorFogProps) => {
  const level = -(sea?.depth ?? 0);
  // The water's look (its optics): the fog in it is the water's own colour, and closes in as
  // what lies in the water fades, 5% of it left at the clarity. `FogExp2` is
  // exp(-(d * density)^2), so that is sqrt(ln 20) over the clarity.
  const waterOptics = waterOpticsOf(sea?.optics, sea ?? {});
  const waterColor = waterOptics.color;
  const waterDensity =
    Math.sqrt(WATER_FADE) / Math.max(waterOptics.clarity, 1e-3);
  const rockColor = interiorFog.rockColor ?? '#0b0a08';
  // ⚠️ `FogExp2` is exp(-(d * density)^2), so 1 / visibility puts ~63% fog at that
  // distance. Expressed as a distance because a useful density at field scale is a
  // number like 0.0025, which nobody can reason about.
  const rockDensity = 1 / Math.max(interiorFog.visibility ?? 400, 1e-3);
  const span = Math.max(interiorFog.transition ?? 5, 1e-3);
  const wantsWater = interiorFog.water !== false && !!sea;
  const wantsRock = interiorFog.rock !== false;

  const medium = useMemo(() => {
    const plane = new Plane();
    return (x: number, y: number, z: number): FogMedium | null => {
      if (!sampler) return null;

      // Whether the cut took the BLOCK away here. A cut that leaves the sea whole
      // opens the geology without draining the water above it, so the camera is
      // still inside the sea even where there is no longer any rock.
      let opened = false;

      if (section?.enabled) {
        plane.copy(section.plane);
        if (
          plane.normal.x * x + plane.normal.y * y + plane.normal.z * z >
          -plane.constant
        ) {
          if (sectionSea) return null;
          opened = true;
        }
      }

      // The same for a fence, which removes a whole half of the block.
      // ⭐ Asked EXACTLY, off the same segments the shader discards by, so the fog
      // switches at the cut rather than a few metres before or after it.
      if (fence?.enabled && fence.index && fence.field) {
        if (fenceSideAt(fence.index, fence.field, x, z) < 0) {
          if (fenceSea) return null;
          opened = true;
        }
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

      // ⭐ Asked per ZONE, not against one global top and base: zones with
      // different footprints leave open air between them, and a stack-wide extent
      // reads that as rock. `base` covers the carrier fill, which is deliberately
      // not sampleable (§5.3).
      if (wantsRock && !opened) {
        const depth = sampler.solidAt(x, y, z, base ?? undefined);
        if (depth !== null) {
          return {
            color: rockColor,
            density: rockDensity,
            amount: Math.min(depth / span, 1),
          };
        }
      }
      return null;
    };
  }, [
    sampler,
    section,
    sectionSea,
    fence,
    fenceSea,
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

  // In the stack's own frame: a vertical exaggeration moves everything in world space.
  const eye = useMemo(() => new Vector3(), []);
  const inverse = useMemo(() => new Matrix4(), []);
  const probe = useCallback<CameraProbe>(
    site => {
      if (site.medium) return;
      eye.copy(site.position);
      const root = frame.current;
      if (root) {
        root.updateWorldMatrix(true, false);
        eye.applyMatrix4(inverse.copy(root.matrixWorld).invert());
      }
      site.medium = medium(eye.x, eye.y, eye.z);
    },
    [medium, frame, eye, inverse],
  );
  useCameraProbe(probe, CAMERA_PROBE_ORDER.medium);

  useMediumFog({
    background: interiorFog.background !== false,
    settle: interiorFog.settle,
  });

  return null;
};
