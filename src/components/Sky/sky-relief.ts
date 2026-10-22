import {
  BufferAttribute,
  ClampToEdgeWrapping,
  Color,
  ColorRepresentation,
  DataTexture,
  DynamicDrawUsage,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGFormat,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector4,
} from 'three';
import { colorRampPalette } from '../../common/color-ramps';
import type { ReliefGrid } from '../../sdk/geometries/relief-grid';
import fragmentShader from './shaders/relief-fragment.glsl';
import vertexShader from './shaders/relief-vertex.glsl';
import type { SkyMaterial } from './sky-material';
import { skyOceanDefines } from './sky-stage';

/** Cells along the side of the patch a relief draws every node with. */
export const SKY_RELIEF_CELLS = 32;
/** The most nodes a relief draws at once. */
export const SKY_RELIEF_MAX_NODES = 1024;
/** The most levels of detail a relief has (its shader's morph table). */
export const SKY_RELIEF_LEVELS = 16;
// The earth ramp's row in `colorRampTexture`.
const EARTH_RAMP = 3;

/** A {@link ReliefGrid} as an RG half float texture with its mip levels. The caller disposes it. */
export function createSkyReliefTexture(grid: ReliefGrid): DataTexture {
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
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The patch a relief draws each node with: a grid of `cells` x `cells` over the unit
 * square in X/Z, facing up, instanced by a `reliefNode` (min X/Z, size, level) per node.
 * Draws no instances until they are written (see `selectTerrainNodes`).
 */
export function createSkyReliefPatch(
  cells = SKY_RELIEF_CELLS,
  maxNodes = SKY_RELIEF_MAX_NODES,
): InstancedBufferGeometry {
  const n = cells + 1;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      positions[3 * (j * n + i)] = i / cells;
      positions[3 * (j * n + i) + 2] = j / cells;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * n + i;
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const nodes = new InstancedBufferAttribute(new Float32Array(4 * maxNodes), 4);
  nodes.setUsage(DynamicDrawUsage);
  geometry.setAttribute('reliefNode', nodes);
  geometry.instanceCount = 0;
  return geometry;
}

/**
 * A material for a stage's relief: land above the sea and seabed below it, drawn as the
 * stage draws its own seabed and sea (see `relief-fragment.glsl`), opaque. It inherits the
 * sky material's uniform objects, so it follows every change to the sky and its water; a
 * change to the sky's defines needs a new one.
 *
 * @param color `'ramp'` colours by height with the earth ramp; a colour, the land flat
 */
export function createSkyReliefMaterial(
  sky: SkyMaterial,
  texture: DataTexture,
  grid: ReliefGrid,
  color: 'ramp' | ColorRepresentation,
) {
  const defines = skyOceanDefines(sky);
  defines.RELIEF_LEVELS = SKY_RELIEF_LEVELS;
  const uniforms = Object.create(sky.uniforms) as Record<string, Uniform>;
  const [first] = grid.levels;
  uniforms.uReliefMap = new Uniform(texture);
  uniforms.uReliefMapFrame = new Uniform(
    new Vector4(
      grid.origin[0],
      grid.origin[1],
      grid.cell,
      grid.levels.length - 1,
    ),
  );
  uniforms.uReliefMapSize = new Uniform(new Vector2(first.width, first.height));
  uniforms.uReliefArea = new Uniform(new Vector4());
  uniforms.uReliefFalloff = new Uniform(0);
  uniforms.uReliefCells = new Uniform(SKY_RELIEF_CELLS);
  uniforms.uReliefMorph = new Uniform(
    Array.from({ length: SKY_RELIEF_LEVELS }, () => new Vector2()),
  );
  uniforms.uReliefDy = new Uniform(0);
  if (color === 'ramp') {
    defines.RELIEF_RAMP = '';
    uniforms.uReliefPalette = new Uniform(colorRampPalette(EARTH_RAMP));
    uniforms.uReliefRange = new Uniform(new Vector2(grid.min, grid.max));
  } else {
    uniforms.uReliefLandColor = new Uniform(new Color(color));
  }
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    defines,
    lights: true,
  });
}
