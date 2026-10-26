import proj4 from 'proj4';
import type { SurfaceMeta } from '../data/types/SurfaceMeta';
import type { CRS } from '../projection/crs';
import type { Vec2 } from '../types/common';
import { toHalfFloatBits } from '../utils/half-float';

// ⚠️ Free of three.js: it runs in a generator's worker.

/**
 * Where a scene lies on the map: the projection it is drawn in, and the point in it
 * that lies at the scene's `offset` (scene X/Z), as a `UtmArea` places a scene. Scene X
 * runs east, and scene Z south.
 *
 * @group Geometries
 */
export type ReliefFrame = {
  /** a proj4 definition, or a name proj4 knows (`EPSG:4326`) */
  projection: string;
  /** the map coordinates of the point at `offset` */
  origin: Vec2;
  /** scene X/Z of `origin`. Default `[0, 0]` */
  offset?: Vec2;
};

/**
 * A {@link ReliefFrame} for a scene whose origin lies at `longitude`, `latitude` (WGS84,
 * degrees): a transverse Mercator map about it, in metres.
 *
 * @group Geometries
 */
export function reliefFrameAt(
  longitude: number,
  latitude: number,
): ReliefFrame {
  return {
    projection: `+proj=tmerc +lat_0=${latitude} +lon_0=${longitude} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`,
    origin: [0, 0],
  };
}

/**
 * The {@link ReliefFrame} of a scene placed by `crs`, as a `UtmArea` given that CRS
 * places it: the CRS's projection, its origin at scene `offset` (X/Z; a `UtmArea`'s
 * `offset` X and Z, default `[0, 0]`). The reliefs then meet the field's own data.
 *
 * @group Geometries
 */
export function reliefFrameFromCrs(crs: CRS, offset?: Vec2): ReliefFrame {
  return {
    projection: crs.utmDef,
    origin: [crs.originUtm[0], crs.originUtm[1]],
    ...(offset && { offset }),
  };
}

/** One mip level of a {@link ReliefGrid}. */
export type ReliefGridLevel = {
  width: number;
  height: number;
  /** per texel, row-major from scene min Z: height times coverage, and coverage, as IEEE half floats */
  data: Uint16Array;
};

/**
 * A relief resampled onto a grid aligned with the scene, for an RG half float texture
 * with its mip levels. Heights are carried times their coverage, which is 1 where the
 * relief has data and 0 where it has none or beyond it, so filtering and mipmapping
 * blend a coast into no-data without inventing heights: a reader divides by coverage.
 *
 * @group Geometries
 */
export type ReliefGrid = {
  /** scene X/Z of the centre of texel (0, 0), the grid's min corner */
  origin: Vec2;
  /** scene units between texel centres, the same along X and Z */
  cell: number;
  /** the full size first, down to 1 x 1 */
  levels: ReliefGridLevel[];
  /** the lowest and highest heights it holds */
  min: number;
  max: number;
};

/** What to resample a relief onto (see {@link resampleRelief}). */
export type ReliefResampleOptions = {
  /** scene X/Z of the middle of the area to cover */
  center: Vec2;
  /** how far from `center` to cover, in scene units */
  radius: number;
  /** the most texels along either side. Default 2048 */
  maxSize?: number;
};

// Texels between the points whose map coordinates are projected exactly; the rest are
// interpolated, as a projection bends very little over that.
const LATTICE = 8;
// Points per side when tracing the relief's outline onto the scene.
const OUTLINE_POINTS = 64;

/**
 * Resample a relief grid — `values` in metres above mean sea level, NaN for no data,
 * placed by `meta` in its own `projection` — onto a grid aligned with the scene around
 * `center`, as fine as the relief is there, but no finer.
 *
 * @returns `null` where the relief does not reach the area
 *
 * @group Geometries
 */
export function resampleRelief(
  values: Float32Array,
  meta: SurfaceMeta,
  frame: ReliefFrame,
  { center, radius, maxSize = 2048 }: ReliefResampleOptions,
): ReliefGrid | null {
  const { nx, ny, xori, yori, xinc, yinc, rot } = meta.header;
  const theta = (rot * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const converter = proj4(meta.projection, frame.projection);
  const [ox, oy] = frame.origin;
  const [sx, sz] = frame.offset ?? [0, 0];

  // A grid node (fractional) to the scene, and a scene point to a grid node.
  const nodeToScene = (col: number, row: number): Vec2 => {
    const u = col * xinc;
    const v = (ny - 1 - row) * yinc;
    const [x, y] = converter.forward([
      xori + cos * u - sin * v,
      yori + sin * u + cos * v,
    ]);
    return [x - ox + sx, oy - y + sz];
  };
  const sceneToNode = (x: number, z: number): Vec2 => {
    const [px, py] = converter.inverse([x - sx + ox, oy - (z - sz)]);
    const du = px - xori;
    const dv = py - yori;
    return [
      (cos * du + sin * dv) / xinc,
      ny - 1 - (-sin * du + cos * dv) / yinc,
    ];
  };

  // The area: the relief's outline traced onto the scene, within `radius` of `center`.
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  const include = ([x, z]: Vec2) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  };
  for (let i = 0; i <= OUTLINE_POINTS; i++) {
    const t = i / OUTLINE_POINTS;
    include(nodeToScene(t * (nx - 1), 0));
    include(nodeToScene(t * (nx - 1), ny - 1));
    include(nodeToScene(0, t * (ny - 1)));
    include(nodeToScene(nx - 1, t * (ny - 1)));
  }
  minX = Math.max(minX, center[0] - radius);
  minZ = Math.max(minZ, center[1] - radius);
  maxX = Math.min(maxX, center[0] + radius);
  maxZ = Math.min(maxZ, center[1] + radius);
  if (!(minX < maxX && minZ < maxZ)) return null;

  // As fine as the relief's own spacing where it lies nearest the centre.
  const [nc, nr] = sceneToNode(
    Math.min(Math.max(center[0], minX), maxX),
    Math.min(Math.max(center[1], minZ), maxZ),
  );
  const col = Math.min(Math.max(Math.round(nc), 0), Math.max(nx - 2, 0));
  const row = Math.min(Math.max(Math.round(nr), 0), Math.max(ny - 2, 0));
  const at = nodeToScene(col, row);
  const across = nodeToScene(col + 1, row);
  const down = nodeToScene(col, row + 1);
  let cell = Math.min(
    Math.hypot(across[0] - at[0], across[1] - at[1]),
    Math.hypot(down[0] - at[0], down[1] - at[1]),
  );
  cell = Math.max(
    cell,
    (maxX - minX) / (maxSize - 1),
    (maxZ - minZ) / (maxSize - 1),
  );
  const width = Math.max(Math.ceil((maxX - minX) / cell) + 1, 2);
  const height = Math.max(Math.ceil((maxZ - minZ) / cell) + 1, 2);

  // Grid nodes of every LATTICE-th texel; interpolated between.
  const lw = Math.ceil((width - 1) / LATTICE) + 1;
  const lh = Math.ceil((height - 1) / LATTICE) + 1;
  const lattice = new Float64Array(lw * lh * 2);
  for (let j = 0; j < lh; j++) {
    for (let i = 0; i < lw; i++) {
      const [c, r] = sceneToNode(
        minX + i * LATTICE * cell,
        minZ + j * LATTICE * cell,
      );
      lattice[2 * (j * lw + i)] = c;
      lattice[2 * (j * lw + i) + 1] = r;
    }
  }

  const premultiplied = new Float32Array(width * height);
  const coverage = new Float32Array(width * height);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < height; j++) {
    const lj = Math.min(Math.floor(j / LATTICE), lh - 2);
    const fj = j / LATTICE - lj;
    for (let i = 0; i < width; i++) {
      const li = Math.min(Math.floor(i / LATTICE), lw - 2);
      const fi = i / LATTICE - li;
      const k00 = 2 * (lj * lw + li);
      const k10 = k00 + 2;
      const k01 = k00 + 2 * lw;
      const k11 = k01 + 2;
      const c =
        (lattice[k00] * (1 - fi) + lattice[k10] * fi) * (1 - fj) +
        (lattice[k01] * (1 - fi) + lattice[k11] * fi) * fj;
      const r =
        (lattice[k00 + 1] * (1 - fi) + lattice[k10 + 1] * fi) * (1 - fj) +
        (lattice[k01 + 1] * (1 - fi) + lattice[k11 + 1] * fi) * fj;

      // Bilinear over the nodes that hold data.
      const c0 = Math.floor(c);
      const r0 = Math.floor(r);
      const tc = c - c0;
      const tr = r - r0;
      let weight = 0;
      let sum = 0;
      for (let b = 0; b < 2; b++) {
        const rr = r0 + b;
        if (rr < 0 || rr >= ny) continue;
        for (let a = 0; a < 2; a++) {
          const cc = c0 + a;
          if (cc < 0 || cc >= nx) continue;
          const value = values[rr * nx + cc];
          if (Number.isNaN(value)) continue;
          const w = (a ? tc : 1 - tc) * (b ? tr : 1 - tr);
          weight += w;
          sum += w * value;
        }
      }
      const texel = j * width + i;
      premultiplied[texel] = sum;
      coverage[texel] = weight;
      if (weight > 0) {
        const value = sum / weight;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  }
  if (!(min <= max)) return null;

  return {
    origin: [minX, minZ],
    cell,
    levels: mipLevels(premultiplied, coverage, width, height),
    min,
    max,
  };
}

// Every level, as WebGL sizes them (halved, rounded down, at least 1), each texel the
// mean of the up to 2 x 2 under it.
function mipLevels(
  premultiplied: Float32Array,
  coverage: Float32Array,
  width: number,
  height: number,
): ReliefGridLevel[] {
  const levels: ReliefGridLevel[] = [];
  let h = premultiplied;
  let c = coverage;
  let w0 = width;
  let h0 = height;
  for (;;) {
    const data = new Uint16Array(w0 * h0 * 2);
    for (let i = 0; i < w0 * h0; i++) {
      data[2 * i] = toHalfFloatBits(h[i]);
      data[2 * i + 1] = toHalfFloatBits(c[i]);
    }
    levels.push({ width: w0, height: h0, data });
    if (w0 === 1 && h0 === 1) return levels;
    const w1 = Math.max(w0 >> 1, 1);
    const h1 = Math.max(h0 >> 1, 1);
    const nh = new Float32Array(w1 * h1);
    const nc = new Float32Array(w1 * h1);
    for (let j = 0; j < h1; j++) {
      for (let i = 0; i < w1; i++) {
        let sh = 0;
        let sc = 0;
        let n = 0;
        for (let b = 0; b < 2; b++) {
          const y = Math.min(2 * j + b, h0 - 1);
          for (let a = 0; a < 2; a++) {
            const x = Math.min(2 * i + a, w0 - 1);
            sh += h[y * w0 + x];
            sc += c[y * w0 + x];
            n++;
          }
        }
        nh[j * w1 + i] = sh / n;
        nc[j * w1 + i] = sc / n;
      }
    }
    h = nh;
    c = nc;
    w0 = w1;
    h0 = h1;
  }
}
