import { SRGBColorSpace, Texture, TextureLoader } from 'three';
import moonMap from './textures/moon.jpg?inline';

/**
 * The moon's albedo for the sky shader (`uSkyMoonMap`): its whole globe, longitude by
 * latitude (0° in the middle, north up), 256×128, grey. From NASA's Scientific
 * Visualization Studio CGI Moon Kit (https://svs.gsfc.nasa.gov/4720, `lroc_color_poles_2k`,
 * from the Lunar Reconnaissance Orbiter Camera's mosaic; public domain): its luminance,
 * averaged in linear light. Inlined in the bundle (6 KB). Null without a DOM to decode it;
 * dispose of it when done.
 */
export async function loadSkyMoonTexture(): Promise<Texture | null> {
  if (typeof document === 'undefined') return null;
  const texture = await new TextureLoader().loadAsync(moonMap);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
