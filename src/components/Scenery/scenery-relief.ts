import { ShaderMaterial, Texture, Uniform } from 'three';
import { colorRampTexture } from '../../common/color-ramps';
import fragmentShader from './shaders/relief-fragment.glsl';
import skyVertexShader from './shaders/sky-vertex.glsl';
import type { SceneryMaterial } from './scenery-material';
import type { SceneryReliefAtlas } from './scenery-relief-atlas';
import { sceneryOceanDefines } from './scenery-stage';

/**
 * The overview behind a stage's relief drawn from tiles, for a far plane short of the
 * farthest ground in view: the relief's own tiles, read per pixel through `atlas` (indexed
 * in `geoTileSquare`'s coordinates: longitude east, latitude south), above the sea past
 * `uReliefReach`, looked as the tiles look them, flat on the globe's sea, on a fullscreen
 * layer (`createSceneryGeometry`) at the far plane, so only where nothing nearer is drawn:
 * from anywhere, the far side of the Earth included. Land as the tiles draw it (see
 * `relief-fragment.glsl`). It inherits the sky material's uniform objects, so it follows
 * every change to the sky, its globe and its water; a change to the sky's defines needs a
 * new one.
 *
 * @param atlas the tiles chosen for the overview (`SceneryReliefAtlas`), read as they change
 * @param base the height where no layer has data, metres over the sea (`ReliefLayersSource.base`, the tiles')
 * @param looks the relief's looks (`SceneryReliefLooks.texture`): each layer takes its own,
 * as on the tiles
 */
export function createSceneryReliefFarMaterial(
  sky: SceneryMaterial,
  atlas: SceneryReliefAtlas,
  base: number,
  looks: Texture,
) {
  const defines = sceneryOceanDefines(sky);
  defines.RELIEF_FAR = '';
  defines.SKY_AT_FAR = '';
  const uniforms = Object.create(sky.uniforms) as Record<string, Uniform>;
  Object.assign(uniforms, atlas.uniforms);
  uniforms.uReliefBase = new Uniform(base);
  uniforms.uReliefReach = new Uniform(1e30);
  uniforms.uReliefLook = new Uniform(looks);
  uniforms.uColorRamps = new Uniform(colorRampTexture);
  return new ShaderMaterial({
    vertexShader: skyVertexShader,
    fragmentShader,
    uniforms,
    defines,
    depthWrite: false,
    lights: true,
    dithering: true,
  });
}
