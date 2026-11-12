// Hex-tile sampling of a sea layer's tile: the twin of sdk/weather/sea-hex.ts, hashing in the
// same 32-bit integers, so a point blends the same copies on the CPU and the GPU.

#define SEA_HEX_SCALE 3.4641016

// A cell's offset in tile units: one hash, its halves the two 16-bit offsets. Three integer
// multiplies (the layer's folds away), as Intel's GPUs emulate them.
vec2 seaHexOffset(ivec2 cell, int layer) {
  uint h = (uint(cell.x) * 0x8da6b343u) ^ (uint(cell.y) * 0xd8163841u) ^ (uint(layer) * 0xcb1ab31fu);
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  return vec2(float(h & 0xffffu), float(h >> 16u)) / 65536.0;
}

// The three copies blended at `uv` (tile units): offsets o1–o3, weights w.
void seaHexTiles(vec2 uv, int layer, out vec2 o1, out vec2 o2, out vec2 o3, out vec3 w) {
  vec2 st = uv * SEA_HEX_SCALE;
  vec2 skewed = vec2(st.x, -0.57735027 * st.x + 1.15470054 * st.y);
  vec2 base = floor(skewed);
  vec2 f = skewed - base;
  float fz = 1.0 - f.x - f.y;
  float s = fz < 0.0 ? 1.0 : 0.0;
  float s2 = 2.0 * s - 1.0;
  w = vec3(-fz * s2, s - f.y * s2, s - f.x * s2);
  ivec2 b = ivec2(base);
  int si = int(s);
  o1 = seaHexOffset(b + ivec2(si, si), layer);
  o2 = seaHexOffset(b + ivec2(si, 1 - si), layer);
  o3 = seaHexOffset(b + ivec2(1 - si, si), layer);
}
