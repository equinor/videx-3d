import {
  ClampToEdgeWrapping,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGFormat,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector4,
} from 'three';
import { colorRampTexture } from '../../common/color-ramps';
import type { ReliefGeoGrid } from '../../sdk/geometries/relief-grid';
import fragmentShader from './shaders/relief-fragment.glsl';
import skyVertexShader from './shaders/sky-vertex.glsl';
import type { SceneryMaterial } from './scenery-material';
import { sceneryOceanDefines } from './scenery-stage';

/**
 * A {@link ReliefGeoGrid} as an RG half float texture with its mip levels, repeating east
 * and west where the grid goes all the way round. The caller disposes it.
 */
export function createSceneryReliefTexture(grid: ReliefGeoGrid): DataTexture {
  const [first] = grid.levels;
  const texture = new DataTexture(
    first.data,
    first.width,
    first.height,
    RGFormat,
    HalfFloatType,
  );
  texture.mipmaps = grid.levels.map(({ data, width, height }) => ({
    data,
    width,
    height,
  }));
  texture.generateMipmaps = false;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = grid.wraps ? RepeatWrapping : ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The most of a relief's layers the overview merges: each is a texture unit of its
 * material's, which uses about ten of the sixteen WebGL 2 promises. A relief with more
 * merges its first ones there, coarse to fine.
 */
export const SCENERY_RELIEF_FAR_MAX_LAYERS = 6;

/** One of a relief's layers in the overview: its grid, its texture, and its look (1 + its index in the relief, as the tiles number it). */
export type SceneryReliefFarLayer = {
  grid: ReliefGeoGrid;
  texture: DataTexture;
  look: number;
};

/**
 * The overview behind a stage's relief drawn from tiles, for a far plane short of the
 * farthest ground in view: what `layers` (the relief's, each in longitude and latitude,
 * weighted by its feather) hold above the sea past `uReliefReach`, merged and looked as the
 * tiles merge and look them, flat on the globe's sea, on a fullscreen layer
 * (`createSceneryGeometry`) at the far plane, so only where nothing nearer is drawn: from
 * anywhere, the far side of the Earth included. Land as the tiles draw it (see
 * `relief-fragment.glsl`). It inherits the sky material's uniform objects, so it follows
 * every change to the sky, its globe and its water; a change to the sky's defines, or to
 * how many layers it has, needs a new one.
 *
 * @param layers the relief's layers in its order, at most
 *   {@link SCENERY_RELIEF_FAR_MAX_LAYERS} (the rest are left out)
 * @param base the height where no layer has data, metres over the sea (`ReliefLayersSource.base`, the tiles')
 * @param looks the relief's looks (`SceneryReliefLooks.texture`): each layer takes its own,
 * as on the tiles
 */
export function createSceneryReliefFarMaterial(
  sky: SceneryMaterial,
  layers: SceneryReliefFarLayer[],
  base: number,
  looks: Texture,
) {
  const used = layers.slice(0, SCENERY_RELIEF_FAR_MAX_LAYERS);
  const defines = sceneryOceanDefines(sky);
  defines.RELIEF_FAR = '';
  defines.SKY_AT_FAR = '';
  defines.RELIEF_FAR_LAYERS = used.length;
  const uniforms = Object.create(sky.uniforms) as Record<string, Uniform>;
  used.forEach(({ texture }, i) => {
    uniforms[`uReliefMap${i}`] = new Uniform(texture);
  });
  uniforms.uReliefMapFrames = new Uniform(
    used.map(
      ({ grid }) =>
        new Vector4(grid.origin[0], grid.origin[1], grid.cell[0], grid.cell[1]),
    ),
  );
  uniforms.uReliefMapSizes = new Uniform(
    used.map(
      ({ grid }) =>
        new Vector4(
          grid.levels[0].width,
          grid.levels[0].height,
          grid.levels.length - 1,
          grid.wraps ? 1 : 0,
        ),
    ),
  );
  uniforms.uReliefMapLooks = new Uniform(used.map(({ look }) => look));
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
