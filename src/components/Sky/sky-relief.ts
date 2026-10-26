import {
  ClampToEdgeWrapping,
  Color,
  ColorRepresentation,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGFormat,
  ShaderMaterial,
  Uniform,
  Vector4,
} from 'three';
import type { ReliefGeoGrid } from '../../sdk/geometries/relief-grid';
import fragmentShader from './shaders/relief-fragment.glsl';
import skyVertexShader from './shaders/sky-vertex.glsl';
import type { SkyMaterial } from './sky-material';
import { skyOceanDefines } from './sky-stage';

/**
 * A {@link ReliefGeoGrid} as an RG half float texture with its mip levels, repeating east
 * and west where the grid goes all the way round. The caller disposes it.
 */
export function createSkyReliefTexture(grid: ReliefGeoGrid): DataTexture {
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
 * The overview behind a stage's relief drawn from tiles, for a far plane short of the
 * farthest ground in view: what `grid` (the relief's first layer, in longitude and
 * latitude) holds above the sea past `uReliefReach`, flat on the globe's sea, on a
 * fullscreen layer (`createSkyGeometry`) at the far plane, so only where nothing nearer is
 * drawn: from anywhere, the far side of the Earth included. Land as the tiles draw it (see
 * `relief-fragment.glsl`). It inherits the sky material's uniform objects, so it follows
 * every change to the sky, its globe and its water; a change to the sky's defines needs a
 * new one.
 *
 * @param color `'ramp'` colours the land by height; a colour, the land flat
 */
export function createSkyReliefFarMaterial(
  sky: SkyMaterial,
  texture: DataTexture,
  grid: ReliefGeoGrid,
  color: 'ramp' | ColorRepresentation,
) {
  const defines = skyOceanDefines(sky);
  defines.RELIEF_FAR = '';
  defines.SKY_AT_FAR = '';
  const uniforms = Object.create(sky.uniforms) as Record<string, Uniform>;
  const [first] = grid.levels;
  uniforms.uReliefMap = new Uniform(texture);
  uniforms.uReliefMapFrame = new Uniform(
    new Vector4(grid.origin[0], grid.origin[1], grid.cell[0], grid.cell[1]),
  );
  uniforms.uReliefMapSize = new Uniform(
    new Vector4(
      first.width,
      first.height,
      grid.levels.length - 1,
      grid.wraps ? 1 : 0,
    ),
  );
  uniforms.uReliefReach = new Uniform(1e30);
  if (color === 'ramp') {
    defines.RELIEF_RAMP = '';
  } else {
    uniforms.uReliefLandColor = new Uniform(new Color(color));
  }
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
