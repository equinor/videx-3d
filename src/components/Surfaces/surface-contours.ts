import type { ColorRepresentation } from 'three';
import type { ContourColorMode } from '../../common/types';
import {
  resolveReliefContours,
  type ReliefContours,
} from '../Scenery/scenery-relief-look';

/**
 * Contour lines over a surface, by depth: every `interval` metres from 0, a heavier one
 * every `major`-th, fading out where they crowd; and with `labels`, each line's depth
 * written along it on the surface. As a relief's (`ReliefContours`, but `seabed`); a
 * label's `maxHeight` is the camera's height over the surface's shallowest point.
 *
 * @group Components
 */
export type SurfaceContours = Omit<ReliefContours, 'seabed'>;

/**
 * The contour options a `Surface` (and `useSurfaceMaterial`) took before `contours`.
 * @internal
 */
export type SurfaceContourOptions = {
  showContours?: boolean;
  contoursInterval?: number;
  contoursColorMode?: ContourColorMode;
  contoursColorModeFactor?: number;
  contoursThickness?: number;
  contoursColor?: ColorRepresentation;
};

/**
 * A surface's contours with their defaults filled in, or null for none: `contours` where
 * given; else the options before it (`showContours` and the rest), without major lines,
 * as they had none.
 *
 * @internal
 */
export function resolveSurfaceContours(
  contours: boolean | SurfaceContours | undefined,
  options: SurfaceContourOptions,
): Required<ReliefContours> | null {
  if (contours !== undefined) return resolveReliefContours(contours);
  if (!options.showContours) return null;
  const given: ReliefContours = {
    interval: options.contoursInterval,
    colorMode: options.contoursColorMode,
    factor: options.contoursColorModeFactor,
    thickness: options.contoursThickness,
    color: options.contoursColor,
    major: 0,
  };
  return resolveReliefContours(
    Object.fromEntries(
      Object.entries(given).filter(([, value]) => value !== undefined),
    ) as ReliefContours,
  );
}
