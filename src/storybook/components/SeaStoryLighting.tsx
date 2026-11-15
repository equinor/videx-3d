import { Environment } from '@react-three/drei';
import { Suspense } from 'react';
import type { Vec3 } from '../../sdk/types/common';

/**
 * The light of the stand-alone sea stories (in place of the canvas decorator's): a sun the
 * sea's glint takes (its scene's brightest directional light), the decorator's ambient, and
 * the studio HDR as `scene.environment` only when asked, which the sea then reflects in place
 * of its gradient.
 */
export const SeaStoryLighting = ({
  sunDirection,
  sunColor = '#fff6e0',
  sunIntensity = 1,
  environment = false,
}: {
  /** toward the sun (world) */
  sunDirection: Vec3;
  sunColor?: string;
  sunIntensity?: number;
  /** the decorator's studio HDR as the scene's environment */
  environment?: boolean;
}) => (
  <>
    <ambientLight intensity={0.5} />
    <directionalLight
      position={sunDirection}
      color={sunColor}
      intensity={sunIntensity}
    />
    {environment && (
      // Served from `public/` (see the canvas decorator), in a boundary of its own.
      <Suspense fallback={null}>
        <Environment
          files="/hdri/studio_small_03_1k.hdr"
          environmentIntensity={0.5}
        />
      </Suspense>
    )}
  </>
);
