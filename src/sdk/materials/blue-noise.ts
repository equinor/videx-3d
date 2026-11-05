/**
 * Blue noise: a tileable square of values whose neighbours differ as much as they can, so its
 * error has no low frequencies. Used to jitter what a shader samples per pixel (the 3D clouds'
 * steps): what is left after blurring or accumulating frames is an even, fine grain rather
 * than the streaks and blotches white noise or interleaved gradient noise leave.
 *
 * @module
 */

/**
 * A `size` × `size` tile of blue noise: each texel's rank among all of them, as a byte (`0` the
 * first, `255` the last), x fastest. Every value is equally common, and it tiles.
 *
 * Made by Ulichney's void-and-cluster method, with a Gaussian of `sigma` texels: deterministic,
 * and some 30 ms at 64 × 64, so make it once and keep it.
 *
 * @group Materials
 */
export function createBlueNoise(size = 64, sigma = 1.5): Uint8Array {
  const n = size * size;
  const reach = Math.min(Math.ceil(4 * sigma), Math.floor((size - 1) / 2));
  const width = 2 * reach + 1;
  const kernel = new Float32Array(width * width);
  for (let y = -reach; y <= reach; y++)
    for (let x = -reach; x <= reach; x++)
      kernel[(y + reach) * width + x + reach] = Math.exp(
        -(x * x + y * y) / (2 * sigma * sigma),
      );

  // Each texel's closeness to the points on: the kernel splatted, wrapped, about each.
  const energy = new Float32Array(n);
  const on = new Uint8Array(n);
  const wrapped = new Int32Array(size + 2 * reach);
  for (let i = 0; i < wrapped.length; i++)
    wrapped[i] = (((i - reach) % size) + size) % size;
  const splat = (index: number, sign: number) => {
    const px = index % size;
    const py = (index - px) / size;
    for (let dy = 0; dy < width; dy++) {
      const row = wrapped[py + dy] * size;
      const k = dy * width;
      for (let dx = 0; dx < width; dx++)
        energy[row + wrapped[px + dx]] += sign * kernel[k + dx];
    }
  };
  const toggle = (index: number) => {
    on[index] ^= 1;
    splat(index, on[index] ? 1 : -1);
  };
  // The point on in the tightest cluster, and the texel off in the largest void.
  const tightest = () => {
    let best = -1;
    let most = -Infinity;
    for (let i = 0; i < n; i++)
      if (on[i] && energy[i] > most) {
        most = energy[i];
        best = i;
      }
    return best;
  };
  const largestVoid = () => {
    let best = -1;
    let least = Infinity;
    for (let i = 0; i < n; i++)
      if (!on[i] && energy[i] < least) {
        least = energy[i];
        best = i;
      }
    return best;
  };

  // A tenth of the texels on at random (a fixed sequence), then moved from clusters into voids
  // until none moves: the initial pattern.
  let state = 0x9e3779b9;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const initial = Math.max(1, Math.floor(n / 10));
  for (let placed = 0; placed < initial; ) {
    const i = Math.floor(random() * n);
    if (on[i]) continue;
    toggle(i);
    placed++;
  }
  for (let moves = 0; moves < n; moves++) {
    const cluster = tightest();
    toggle(cluster);
    const empty = largestVoid();
    toggle(empty);
    if (empty === cluster) break;
  }

  const rank = new Int32Array(n);
  const pattern = on.slice();
  const patternEnergy = energy.slice();
  // Ranks below the pattern's: its points taken out, tightest cluster first.
  for (let r = initial - 1; r >= 0; r--) {
    const cluster = tightest();
    toggle(cluster);
    rank[cluster] = r;
  }
  // And above: the voids filled in, largest first.
  on.set(pattern);
  energy.set(patternEnergy);
  for (let r = initial; r < n; r++) {
    const empty = largestVoid();
    toggle(empty);
    rank[empty] = r;
  }

  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor((rank[i] * 256) / n);
  return bytes;
}
