import {
  DataTexture,
  FloatType,
  LinearFilter,
  RedFormat,
  RGFormat,
  UnsignedByteType,
} from 'three';
import { crossVec3, normalizeVec3, rotateVec3, subVec3, Vec3 } from '../../sdk';

export function triangleNormal(p0: Vec3, p1: Vec3, p2: Vec3) {
  const a = subVec3(p0, p1);
  const b = subVec3(p0, p2);
  return normalizeVec3(crossVec3(a, b));
}

/**
 * Calcukate and encode surface normals from an elevation grid as RGBA image values.
 */
export function elevationMapNormalsToRGBA(
  data: Float32Array,
  columns: number,
  xScale: number,
  yScale: number,
  rotation: number = 0,
  nullValue: number = -1,
) {
  const rows = data.length / columns;
  const w = columns - 1;
  const h = rows - 1;
  const buffer = new Uint8Array(w * h * 4);

  let i = 0;

  const value = (x: number, y: number) => data[y * columns + x];

  for (let y0 = 0; y0 < h; y0++) {
    const y1 = y0 + 1;
    const yc = y0 + 0.5;
    for (let x0 = 0; x0 < w; x0++) {
      const x1 = x0 + 1;
      const xc = x0 + 0.5;
      const z00 = value(x0, y0);
      if (z00 !== nullValue) {
        const z01 = value(x0, y1);
        const z10 = value(x1, y0);
        const z11 = value(x1, y1);

        const zc = (z00 + z01 + z10 + z11) / 4;
        const p00: Vec3 = [x0 * xScale, y0 * yScale, z00];
        const p01: Vec3 = [x0 * xScale, y1 * yScale, z01];
        const p10: Vec3 = [x1 * xScale, y0 * yScale, z10];
        const p11: Vec3 = [x1 * xScale, y1 * yScale, z11];
        const pc: Vec3 = [xc * xScale, yc * yScale, zc];
        const n0 = triangleNormal(pc, p00, p10);
        const n1 = triangleNormal(pc, p10, p11);
        const n2 = triangleNormal(pc, p11, p01);
        const n3 = triangleNormal(pc, p01, p00);

        const n = normalizeVec3([
          n0[0] + n1[0] + n2[0] + n3[0],
          n0[2] + n1[2] + n2[2] + n3[2],
          n0[1] + n1[1] + n2[1] + n3[1],
        ]);

        const rn = rotateVec3(n, [0, 1, 0], rotation * (Math.PI / 180));
        const r = Math.floor(((rn[0] + 1) / 2) * 255);
        const g = Math.floor(((rn[1] + 1) / 2) * 255);
        const b = Math.floor(((rn[2] + 1) / 2) * 255);

        buffer[i] = r;
        buffer[i + 1] = g;
        buffer[i + 2] = b;
        buffer[i + 3] = 255;
      } else {
        buffer[i] = 0;
        buffer[i + 1] = 0;
        buffer[i + 2] = 0;
        buffer[i + 3] = 0;
      }
      i += 4;
    }
  }
  return buffer;
}

/**
 * Create a data texture from RGBA encoded normals
 */
export function createNormalTexture(
  buffer: Uint8Array,
  width: number,
  height: number,
) {
  const normalTexture = new DataTexture(buffer, width, height);

  normalTexture.minFilter = LinearFilter;
  normalTexture.magFilter = LinearFilter;
  normalTexture.flipY = true;
  normalTexture.anisotropy = 4;
  normalTexture.needsUpdate = true;

  return normalTexture;
}

/**
 * Create a data texture from RGBA encoded depth values
 */
export function createElevationTexture(
  buffer: Float32Array,
  width: number,
  height: number,
) {
  const elevationTexture = new DataTexture(
    buffer,
    width,
    height,
    RedFormat,
    FloatType,
  );
  elevationTexture.minFilter = LinearFilter;
  elevationTexture.magFilter = LinearFilter;
  //elevationTexture.anisotropy = 4
  elevationTexture.needsUpdate = true;
  elevationTexture.flipY = true;

  return elevationTexture;
}

/**
 * Compute geometric surface normals from an elevation grid, encoded as a compact
 * RG8 buffer (2 bytes/texel) using a hemisphere encoding: only the grid-local
 * `x` and `z` components are stored (mapped to [0, 1]); the consumer reconstructs
 * `y = sqrt(1 - x^2 - z^2)`.
 *
 * This replicates the per-fragment normal that `SurfaceMaterial`'s shader derives
 * from the elevation texture (same four diagonal neighbours, cross products and
 * hole handling), but pays the cost once on the CPU instead of in every OIT pass.
 * The result is laid out to match the elevation buffer (row-major, intended for a
 * `flipY = true` texture), so it samples 1:1 with the same grid UVs.
 *
 * @param data elevation values (row-major, holes < 0)
 * @param columns number of columns (nx)
 * @param rows number of rows (ny)
 * @param xScale column spacing (xinc)
 * @param yScale row spacing (yinc)
 */
export function computeSurfaceNormalsRG(
  data: Float32Array,
  columns: number,
  rows: number,
  xScale: number,
  yScale: number,
) {
  const buffer = new Uint8Array(columns * rows * 2);

  const at = (r: number, c: number) => {
    const rr = r < 0 ? 0 : r >= rows ? rows - 1 : r;
    const cc = c < 0 ? 0 : c >= columns ? columns - 1 : c;
    return data[rr * columns + cc];
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      const e = data[i];

      let nx = 0;
      let ny = 0.0001;
      let nz = 0;

      if (e >= 0) {
        // `flipY` texture => +v (north) maps to a decreasing buffer row.
        const nw = at(r - 1, c - 1);
        const ne = at(r - 1, c + 1);
        const sw = at(r + 1, c - 1);
        const se = at(r + 1, c + 1);

        const p1: Vec3 = [-xScale, nw - e, -yScale];
        const p2: Vec3 = [xScale, ne - e, -yScale];
        const p3: Vec3 = [-xScale, sw - e, yScale];
        const p4: Vec3 = [xScale, se - e, yScale];

        if (nw >= 0 && ne >= 0) {
          const x = crossVec3(p2, p1);
          nx += x[0];
          ny += x[1];
          nz += x[2];
        }
        if (ne >= 0 && se >= 0) {
          const x = crossVec3(p4, p2);
          nx += x[0];
          ny += x[1];
          nz += x[2];
        }
        if (sw >= 0 && se >= 0) {
          const x = crossVec3(p3, p4);
          nx += x[0];
          ny += x[1];
          nz += x[2];
        }
        if (se >= 0 && nw >= 0) {
          const x = crossVec3(p1, p3);
          nx += x[0];
          ny += x[1];
          nz += x[2];
        }
      }

      const n = normalizeVec3([nx, ny, nz]);
      const bi = i * 2;
      buffer[bi] = Math.round(((n[0] + 1) / 2) * 255);
      buffer[bi + 1] = Math.round(((n[2] + 1) / 2) * 255);
    }
  }

  return buffer;
}

/**
 * Create an RG8 data texture from a buffer produced by {@link computeSurfaceNormalsRG}.
 */
export function createPackedNormalTexture(
  buffer: Uint8Array,
  width: number,
  height: number,
) {
  const texture = new DataTexture(
    buffer,
    width,
    height,
    RGFormat,
    UnsignedByteType,
  );
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.flipY = true;
  texture.needsUpdate = true;

  return texture;
}
