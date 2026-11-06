import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { watchSharedTextures } from '../common/shared-textures';

/**
 * @internal
 * For a component whose materials bind a shared texture (`shareTexture`), such as the colour
 * ramps: its renderer lets go of them as it goes (`watchSharedTextures`). For materials drawn
 * through variants of their own (OIT), whose `onBeforeRender` the base does not see.
 */
export function useSharedTextures() {
  const gl = useThree(state => state.gl);
  useEffect(() => watchSharedTextures(gl), [gl]);
}
