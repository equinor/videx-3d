import { toHalfFloatBits } from '../utils/half-float';

/**
 * Reference grid cells per {@link StackCapNormalMap} texel. 2 draws fault lines
 * dashed at the distance LOD first picks a coarser level (field-5c1be1, 15 km).
 *
 * @group Geometries
 */
export const CAP_NORMAL_MAP_CELLS = 1;

/**
 * A cap's full-level shading normals, baked onto a grid aligned with the reference
 * grid (see {@link CAP_NORMAL_MAP_CELLS}). A tile drawn at a coarser level shades
 * from this, so a coarse triangle never interpolates vertex normals across relief
 * it no longer has.
 *
 * @group Geometries
 */
export type StackCapNormalMap = {
  /**
   * Per texel, row-major, the unit normal's x and z as IEEE half floats (an RG
   * texture). Its y is positive on a cap and rebuilt from the two.
   */
  data: Uint16Array;
  width: number;
  height: number;
  /** object XZ to uv, as `[a, b, c, d, e, f]`: `u = a x + b z + c`, `v = d x + e z + f` */
  toUv: [number, number, number, number, number, number];
};

/** Texels around the cap filled from their neighbours, so filtering at its edge reads no blanks. */
const DILATE_RINGS = 2;
/** Barycentric slack: texel centres on grid nodes land exactly on vertices and edges. */
const INSIDE_EPS = 1e-6;

const EMPTY = 0;
const FULL = 1;
const LEVEL = 2;
const SPLAT = 3;

/**
 * Bake a cap's normals into a {@link StackCapNormalMap} over the cap's own window
 * of the grid `toGrid` maps to, one texel per grid node.
 *
 * Each texel inside a full-level triangle gets the vertex normals interpolated
 * there — what the cap shaded with as a `normal` attribute. A texel only a coarser
 * level covers gets that level's, a corner with no normal of its own taking the
 * face's. Every vertex then marks its nearest empty texel, so a sliver narrower
 * than a texel still leaves its normal, and {@link DILATE_RINGS} rings around the
 * result are filled from their neighbours.
 *
 * @param xz scene XZ per vertex
 * @param y height per vertex
 * @param normals unit normals per vertex (3 each), zero where no full-level triangle has the vertex
 * @param triangles the full level, wound upward
 * @param levels the coarser levels, finest first
 * @param toGrid scene XZ to the texel grid `(column, row)`, as `StackTiling.toGrid` does to the reference grid
 *
 * @group Geometries
 */
export function bakeCapNormalMap(
  xz: Float32Array,
  y: Float32Array,
  normals: Float32Array,
  triangles: Uint32Array,
  levels: Uint32Array[] | null | undefined,
  toGrid: [number, number, number, number, number, number],
): StackCapNormalMap {
  const [ta, tb, tc, td, te, tf] = toGrid;
  const lists = [triangles, ...(levels ?? [])];
  const gx = new Float32Array(y.length);
  const gy = new Float32Array(y.length);
  const located = new Uint8Array(y.length);
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (located[v]) continue;
      located[v] = 1;
      const x = xz[2 * v];
      const z = xz[2 * v + 1];
      const col = ta * x + tb * z + tc;
      const row = td * x + te * z + tf;
      gx[v] = col;
      gy[v] = row;
      if (col < minC) minC = col;
      if (col > maxC) maxC = col;
      if (row < minR) minR = row;
      if (row > maxR) maxR = row;
    }
  }
  if (!(minC <= maxC)) {
    return { data: new Uint16Array(2), width: 1, height: 1, toUv: [0, 0, 0.5, 0, 0, 0.5] };
  }

  const c0 = Math.floor(minC) - DILATE_RINGS;
  const r0 = Math.floor(minR) - DILATE_RINGS;
  const width = Math.ceil(maxC) + DILATE_RINGS - c0 + 1;
  const height = Math.ceil(maxR) + DILATE_RINGS - r0 + 1;
  const texels = width * height;
  const acc = new Float32Array(texels * 3);
  const state = new Uint8Array(texels);

  // A corner's normal: its own, or for a vertex only a coarser level uses, the face's.
  let fnx = 0;
  let fny = 0;
  let fnz = 0;
  const corner = (v: number, k: number) =>
    normals[3 * v] || normals[3 * v + 1] || normals[3 * v + 2]
      ? normals[3 * v + k]
      : k === 0
        ? fnx
        : k === 1
          ? fny
          : fnz;

  const raster = (list: Uint32Array, level: boolean) => {
    for (let t = 0; t + 2 < list.length; t += 3) {
      const ia = list[t];
      const ib = list[t + 1];
      const ic = list[t + 2];
      const ax = gx[ia];
      const ay = gy[ia];
      const bx = gx[ib];
      const by = gy[ib];
      const cx = gx[ic];
      const cy = gy[ic];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (!(Math.abs(area) > 1e-12)) continue;
      const inv = 1 / area;
      if (level) {
        // As `computeVertexNormals`: (c - b) x (a - b), turned to face up.
        const pbx = xz[2 * ib];
        const pby = y[ib];
        const pbz = xz[2 * ib + 1];
        const cbx = xz[2 * ic] - pbx;
        const cby = y[ic] - pby;
        const cbz = xz[2 * ic + 1] - pbz;
        const abx = xz[2 * ia] - pbx;
        const aby = y[ia] - pby;
        const abz = xz[2 * ia + 1] - pbz;
        fnx = cby * abz - cbz * aby;
        fny = cbz * abx - cbx * abz;
        fnz = cbx * aby - cby * abx;
        const s =
          (fny < 0 ? -1 : 1) /
          (Math.sqrt(fnx * fnx + fny * fny + fnz * fnz) || 1);
        fnx *= s;
        fny *= s;
        fnz *= s;
      }
      const nax = corner(ia, 0);
      const nay = corner(ia, 1);
      const naz = corner(ia, 2);
      const nbx = corner(ib, 0);
      const nby = corner(ib, 1);
      const nbz = corner(ib, 2);
      const ncx = corner(ic, 0);
      const ncy = corner(ic, 1);
      const ncz = corner(ic, 2);
      const i0 = Math.max(Math.ceil(Math.min(ax, bx, cx)), c0);
      const i1 = Math.min(Math.floor(Math.max(ax, bx, cx)), c0 + width - 1);
      const j0 = Math.max(Math.ceil(Math.min(ay, by, cy)), r0);
      const j1 = Math.min(Math.floor(Math.max(ay, by, cy)), r0 + height - 1);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const texel = (j - r0) * width + (i - c0);
          // The full level first, then each level finest first: the first to cover a texel keeps it.
          if (state[texel] === FULL || state[texel] === LEVEL) continue;
          const w1 = ((i - ax) * (cy - ay) - (j - ay) * (cx - ax)) * inv;
          const w2 = ((bx - ax) * (j - ay) - (by - ay) * (i - ax)) * inv;
          const w0 = 1 - w1 - w2;
          if (w0 < -INSIDE_EPS || w1 < -INSIDE_EPS || w2 < -INSIDE_EPS) continue;
          acc[3 * texel] = w0 * nax + w1 * nbx + w2 * ncx;
          acc[3 * texel + 1] = w0 * nay + w1 * nby + w2 * ncy;
          acc[3 * texel + 2] = w0 * naz + w1 * nbz + w2 * ncz;
          state[texel] = level ? LEVEL : FULL;
        }
      }
    }
  };
  lists.forEach((list, k) => raster(list, k > 0));

  // Every vertex leaves its normal in its nearest texel, if no triangle covered it.
  const splatted = new Uint8Array(y.length);
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (splatted[v]) continue;
      splatted[v] = 1;
      if (!normals[3 * v] && !normals[3 * v + 1] && !normals[3 * v + 2]) continue;
      const texel =
        (Math.round(gy[v]) - r0) * width + (Math.round(gx[v]) - c0);
      if (state[texel] !== EMPTY && state[texel] !== SPLAT) continue;
      state[texel] = SPLAT;
      acc[3 * texel] += normals[3 * v];
      acc[3 * texel + 1] += normals[3 * v + 1];
      acc[3 * texel + 2] += normals[3 * v + 2];
    }
  }

  const normalize = (texel: number) => {
    const x = acc[3 * texel];
    const h = acc[3 * texel + 1];
    const z = acc[3 * texel + 2];
    const s = 1 / (Math.sqrt(x * x + h * h + z * z) || 1);
    acc[3 * texel] = x * s;
    acc[3 * texel + 1] = h * s;
    acc[3 * texel + 2] = z * s;
  };
  for (let texel = 0; texel < texels; texel++) {
    if (state[texel] !== EMPTY) normalize(texel);
  }

  for (let ring = 0; ring < DILATE_RINGS; ring++) {
    const filled = state.slice();
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const texel = j * width + i;
        if (filled[texel] !== EMPTY) continue;
        let x = 0;
        let h = 0;
        let z = 0;
        let any = false;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= height) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= width) continue;
            const n = jj * width + ii;
            if (filled[n] === EMPTY) continue;
            x += acc[3 * n];
            h += acc[3 * n + 1];
            z += acc[3 * n + 2];
            any = true;
          }
        }
        if (!any) continue;
        acc[3 * texel] = x;
        acc[3 * texel + 1] = h;
        acc[3 * texel + 2] = z;
        state[texel] = SPLAT;
        normalize(texel);
      }
    }
  }

  // An untouched texel stays 0, 0: straight up.
  const data = new Uint16Array(texels * 2);
  for (let texel = 0; texel < texels; texel++) {
    if (state[texel] === EMPTY) continue;
    data[2 * texel] = toHalfFloatBits(acc[3 * texel]);
    data[2 * texel + 1] = toHalfFloatBits(acc[3 * texel + 2]);
  }

  return {
    data,
    width,
    height,
    toUv: [
      ta / width,
      tb / width,
      (tc - c0 + 0.5) / width,
      td / height,
      te / height,
      (tf - r0 + 0.5) / height,
    ],
  };
}
