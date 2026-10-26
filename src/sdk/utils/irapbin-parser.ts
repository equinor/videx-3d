/**
 * The header of an IRAP binary grid ("irapbin"): its nodes, where its south-west node
 * lies, its spacing and its rotation (degrees counter-clockwise about that node).
 */
export type IrapbinHeader = {
  ny: number;
  xori: number;
  xmax: number;
  yori: number;
  ymax: number;
  xinc: number;
  yinc: number;
  nx: number;
  rot: number;
};

/** The value IRAP writes for a node with no data. */
export const IRAPBIN_UNDEFINED = 9999900;

/**
 * Read an IRAP binary grid as stored: its header, and its values row-major from the
 * SOUTHERN row (the row through `yori`), exactly as written — no value is taken for
 * missing. Big-endian Fortran records; synchronous, and free of three.js.
 *
 * @group Utils
 */
export function readIrapbin(buffer: ArrayBuffer): {
  header: IrapbinHeader;
  values: Float32Array;
} {
  const view = new DataView(buffer);
  const header: IrapbinHeader = {
    ny: view.getInt32(8, false),
    xori: view.getFloat32(12, false),
    xmax: view.getFloat32(16, false),
    yori: view.getFloat32(20, false),
    ymax: view.getFloat32(24, false),
    xinc: view.getFloat32(28, false),
    yinc: view.getFloat32(32, false),
    nx: view.getInt32(44, false),
    rot: view.getFloat32(48, false),
  };
  const count = header.nx * header.ny;
  const values = new Float32Array(count);
  let n = 0;
  // The values' records start after the header's three.
  let pos = 100;
  while (pos < view.byteLength && n < count) {
    const batchSize = view.getInt32(pos, false);
    pos += 4;
    for (let i = 0; i < batchSize && n < count; i += 4) {
      values[n++] = view.getFloat32(pos + i, false);
    }
    pos += batchSize + 4;
  }
  return { header, values };
}

/**
 * Parses irabin surface/horizon binary files and return the header information and elevation data
 */
export async function parseIrapbin(
  blob: Blob,
  nullValue = -1,
  refDepth: number | null = null,
) {
  const { header, values } = readIrapbin(await blob.arrayBuffer());

  const maxValue = 1e30; // largest positive number
  const eplison = 1e-30; // smallest number

  const data = new Float32Array(header.nx * header.ny);

  for (let n = 0; n < values.length; n++) {
    const val = values[n];
    const col = n % header.nx;
    const row = header.ny - Math.floor(n / header.nx);
    const idx = (row - 1) * header.nx + col;
    data[idx] =
      val < eplison || val > maxValue
        ? nullValue
        : refDepth
          ? refDepth - val
          : val;
  }

  return { header, data };
}
