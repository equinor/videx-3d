import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Color } from 'three';
import {
  createVoidGradientTexture,
  VOID_GRADIENT_DEFAULTS,
  type VoidGradient,
} from '../../sdk/materials/void-gradient';

/**
 * VoidBackground props
 * @expand
 */
export type VoidBackgroundProps = VoidGradient & {
  /** scales the background (`scene.backgroundIntensity`). Default 1 */
  intensity?: number;
};

const scratch = new Color();
const toHex = (value: NonNullable<VoidGradient['ceiling']>) =>
  scratch.set(value).getHex();

/**
 * The void's gradient ({@link VoidGradient}) as the scene's background
 * (`scene.background`), while mounted; the background before it is put back after. Behind a
 * {@link Scenery} with `sky={false}` it matches the light the scene and its seas then take,
 * given the void's colours; it works without one too.
 *
 * @example
 * <Scenery sky={false}>
 *   <VoidBackground />
 * </Scenery>
 *
 * @group Components
 */
export const VoidBackground = ({
  ceiling = VOID_GRADIENT_DEFAULTS.ceiling,
  horizon = VOID_GRADIENT_DEFAULTS.horizon,
  depth = VOID_GRADIENT_DEFAULTS.depth,
  falloff = VOID_GRADIENT_DEFAULTS.falloff,
  intensity = 1,
}: VoidBackgroundProps) => {
  const scene = useThree(state => state.scene);
  // By value, as colours may be given as new objects each render.
  const ceilingHex = toHex(ceiling);
  const horizonHex = toHex(horizon);
  const depthHex = toHex(depth);
  const texture = useMemo(
    () =>
      createVoidGradientTexture({
        ceiling: ceilingHex,
        horizon: horizonHex,
        depth: depthHex,
        falloff,
      }),
    [ceilingHex, horizonHex, depthHex, falloff],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  useLayoutEffect(() => {
    const previous = scene.background;
    scene.background = texture;
    return () => {
      if (scene.background === texture) scene.background = previous;
    };
  }, [scene, texture]);

  useLayoutEffect(() => {
    const previous = scene.backgroundIntensity;
    scene.backgroundIntensity = intensity;
    return () => {
      scene.backgroundIntensity = previous;
    };
  }, [scene, intensity]);

  return null;
};
