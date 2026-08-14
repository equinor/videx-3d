import {
  DataTexture,
  FloatType,
  Matrix3,
  NearestFilter,
  RGFormat,
} from 'three';
import { SurfaceMeta, surfaceWorldToGrid } from '../../sdk';

/** Scene XZ of a surface grid's origin. */
export type UtmToScene = (
  easting: number,
  northing: number,
  altitude: number,
) => [number, number, number];

/**
 * A depth grid uploaded as a texture the chunk shaders can sample from OBJECT XZ.
 *
 * ⭐ Pure appearance: nothing built from one enters a build spec, so the grid
 * behind it can be swapped without rebuilding any geometry. Used for fluid
 * contacts (a line where a face crosses the grid) and for the sea bed's
 * bathymetry (the water column standing over a map location).
 */
export type ChunkDepthMap = {
  texture: DataTexture;
  /** object XZ -> texture uv, as `uv = m * vec3(x, z, 1)` */
  toUv: Matrix3;
  /** grid spacing in metres, for a consumer that needs to differentiate the field */
  cellSize: number;
};

/**
 * Pack a surface's depth grid into a texture the chunk shaders can sample.
 *
 * ⚠️ Two channels, not one: R carries the surface's scene Y and G its validity,
 * because the grid's nodata sentinel is a legal float that would otherwise be
 * read as a depth of a few thousand metres.
 *
 * ⚠️ NEAREST filtering, deliberately. Linear filtering of a 32-bit float texture
 * needs `OES_texture_float_linear`, and half float cannot hold a depth of a few
 * thousand metres to better than a couple of metres — far coarser than what is
 * being drawn. The shader interpolates the four texels itself, which also lets it
 * reject a sample whose neighbours are unmapped instead of smearing across them.
 */
export function buildSurfaceDepthMap(
  surface: SurfaceMeta,
  values: Float32Array | number[],
  utmToScene: UtmToScene,
  nullValue = -1,
): ChunkDepthMap {
  const { header, max } = surface;
  const { nx, ny } = header;
  const count = nx * ny;
  // ⚠⚠ R is FILLED everywhere, G carries the truth. An unmapped node left at 0
  // would be a cliff of a couple of thousand metres at the edge of the mapped
  // area, and a consumer taking screen-space derivatives of this field — which a
  // contact line does — painted a vertical tick off the end of every line.
  let total = 0;
  let mapped = 0;
  for (let i = 0; i < count; i++) {
    const v = values[i];
    if (v !== nullValue && Number.isFinite(v)) {
      total += v - max;
      mapped++;
    }
  }
  const fill = mapped ? total / mapped : 0;

  const data = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const v = values[i];
    const valid = v !== nullValue && Number.isFinite(v);
    // Scene Y, upwards-positive: the grids are stored as `max - depth`.
    data[2 * i] = valid ? v - max : fill;
    data[2 * i + 1] = valid ? 1 : 0;
  }
  const texture = new DataTexture(data, nx, ny, RGFormat, FloatType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const origin = utmToScene(header.xori, header.yori, 0);
  const toGrid = surfaceWorldToGrid(header, [origin[0], origin[2]]);
  // Recovered by evaluation rather than rederived, so the mapping cannot drift
  // from the one the geometry is built with.
  const o = toGrid(0, 0);
  const ex = toGrid(1, 0);
  const ez = toGrid(0, 1);
  const toUv = new Matrix3().set(
    (ex[0] - o[0]) / nx,
    (ez[0] - o[0]) / nx,
    (o[0] + 0.5) / nx,
    (ex[1] - o[1]) / ny,
    (ez[1] - o[1]) / ny,
    (o[1] + 0.5) / ny,
    0,
    0,
    1,
  );
  return { texture, toUv, cellSize: Math.min(header.xinc, header.yinc) };
}
