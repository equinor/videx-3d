/**
 * What one cap of a shared-tessellation stack is built from (see
 * {@link buildStackCapArrays}).
 *
 * ⚠️ `shared`, `own` and `peel` may be RE-WOUND in place, exactly as
 * `computeUpwardNormals` re-winds the index it is handed. Send copies across a
 * worker.
 *
 * @group Geometries
 */
export type StackCapInput = {
  /** scene XZ of every shared vertex */
  positionsXZ: Float32Array;
  /** the layer's height per shared vertex */
  y: Float32Array;
  /** the shared index; only read when the cap has neither `own` nor `peel` */
  shared: Uint32Array;
  /** the triangles the cap keeps, when it does not keep them all */
  own: Uint32Array | null;
  /** the widened index of a peelable cap (see `StackGeometryLayer.patchIndex`) */
  peel: Uint32Array | null;
};

/**
 * One cap's renderable arrays, computed without three.js so that the caps of a
 * stack can be built on the worker pool.
 *
 * @group Geometries
 */
export type StackCapArrays = {
  /**
   * Per vertex, unit normals as snorm16 (3 per vertex, a NORMALIZED attribute):
   * ~3e-5 resolution, half the bytes of the second-largest thing a cap holds.
   */
  normal: Int16Array;
  /** the index the cap draws, or `null` for the shared index, untouched */
  index: Uint32Array | null;
  /** see `StackGeometryLayer.patchIndex` */
  patchIndex: Uint32Array | null;
  /** `[minX, minY, minZ, maxX, maxY, maxZ]` over every vertex */
  box: [number, number, number, number, number, number];
  /** `[x, y, z, radius]`: centred on the box, as three's `computeBoundingSphere` */
  sphere: [number, number, number, number];
};

function reverseWinding(index: Uint32Array) {
  for (let t = 0; t + 2 < index.length; t += 3) {
    const swap = index[t + 1];
    index[t + 1] = index[t + 2];
    index[t + 2] = swap;
  }
}

/**
 * Smooth vertex normals over `index`, as three's `computeVertexNormals`: face
 * normals accumulated into float32 per vertex, then normalized. Returns the sum
 * of their Y, whose sign says which way the winding faces.
 */
function vertexNormals(
  xz: Float32Array,
  y: Float32Array,
  index: Uint32Array,
  out: Float32Array,
): number {
  out.fill(0);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    const ax = xz[2 * a];
    const ay = y[a];
    const az = xz[2 * a + 1];
    const bx = xz[2 * b];
    const by = y[b];
    const bz = xz[2 * b + 1];
    const cbx = xz[2 * c] - bx;
    const cby = y[c] - by;
    const cbz = xz[2 * c + 1] - bz;
    const abx = ax - bx;
    const aby = ay - by;
    const abz = az - bz;
    const nx = cby * abz - cbz * aby;
    const ny = cbz * abx - cbx * abz;
    const nz = cbx * aby - cby * abx;
    out[3 * a] += nx;
    out[3 * a + 1] += ny;
    out[3 * a + 2] += nz;
    out[3 * b] += nx;
    out[3 * b + 1] += ny;
    out[3 * b + 2] += nz;
    out[3 * c] += nx;
    out[3 * c + 1] += ny;
    out[3 * c + 2] += nz;
  }
  let sumY = 0;
  for (let v = 0; v < out.length; v += 3) {
    const x = out[v];
    const yy = out[v + 1];
    const z = out[v + 2];
    const s = 1 / (Math.sqrt(x * x + yy * yy + z * z) || 1);
    out[v] = x * s;
    out[v + 1] = yy * s;
    out[v + 2] = z * s;
    sumY += out[v + 1];
  }
  return sumY;
}

/**
 * The triangles `widest` has and `own` does not.
 *
 * Both are emitted by the same pass over the triangles in the same order, and
 * `own` is a subset, so one walk finds the difference exactly.
 */
function indexDifference(
  widest: Uint32Array,
  own: Uint32Array,
): Uint32Array | null {
  const patch = new Uint32Array(widest.length - own.length);
  let j = 0;
  let k = 0;
  for (let i = 0; i < widest.length; i += 3) {
    if (
      j < own.length &&
      widest[i] === own[j] &&
      widest[i + 1] === own[j + 1] &&
      widest[i + 2] === own[j + 2]
    ) {
      j += 3;
      continue;
    }
    patch[k++] = widest[i];
    patch[k++] = widest[i + 1];
    patch[k++] = widest[i + 2];
  }
  return k > 0 ? patch : null;
}

/**
 * Build one cap's normals, index, patch and bounds from plain arrays — what
 * `computeUpwardNormals`, the patch split and three's bounding volumes produce
 * for it, without three.js.
 *
 * ⚠️⚠️ Normals are accumulated over the WIDEST index available, not the cap's own:
 * a vertex used ONLY by triangles the collapse dropped would otherwise keep a zero
 * normal — and shade BLACK the moment the patch restores it.
 *
 * @group Geometries
 */
export function buildStackCapArrays(input: StackCapInput): StackCapArrays {
  const { positionsXZ: xz, y, shared, own, peel } = input;
  const widest = peel ?? own ?? shared;
  const normals = new Float32Array(y.length * 3);
  // Height fields face up: a downward sum means the winding is reversed.
  const flipped = vertexNormals(xz, y, widest, normals) < 0;
  if (flipped) {
    reverseWinding(widest);
    vertexNormals(xz, y, widest, normals);
  }

  let index: Uint32Array | null = widest;
  let patchIndex: Uint32Array | null = null;
  if (peel) {
    if (own && flipped) reverseWinding(own);
    // After the fix-up both are wound the same way, so the triples still match.
    patchIndex = own ? indexDifference(peel, own) : null;
    index = own ?? shared;
  }
  if (index === shared && !(flipped && widest === shared)) index = null;

  const normal = new Int16Array(normals.length);
  for (let i = 0; i < normals.length; i++) {
    normal[i] = Math.max(
      -32767,
      Math.min(32767, Math.round(normals[i] * 32767)),
    );
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let v = 0; v < y.length; v++) {
    const x = xz[2 * v];
    const h = y[v];
    const z = xz[2 * v + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (h < minY) minY = h;
    if (h > maxY) maxY = h;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  let radiusSq = 0;
  for (let v = 0; v < y.length; v++) {
    const dx = cx - xz[2 * v];
    const dy = cy - y[v];
    const dz = cz - xz[2 * v + 1];
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
  }

  return {
    normal,
    index,
    patchIndex,
    box: [minX, minY, minZ, maxX, maxY, maxZ],
    sphere: [cx, cy, cz, Math.sqrt(radiusSq)],
  };
}
