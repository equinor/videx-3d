// The soft clouds' cover map (CloudCoverMap, scenery-cloud-cover.ts): a tile of noise over the
// field, repeating, of how much each column is clouded over (any value: the layer's share under
// cloud picks a level of it, softCoverLevel). Broad patches of cloud and clear sky (gradient
// noise in octaves) with masses in them (rounded bumps of many sizes about scattered points, at
// three scales): clouds from some kilometres across down to a few hundred metres, clustered.
// Integer hashes, so every GPU makes the same.
//
// Out: (cover, cover²) at the texel's middle, so the mipmaps' filtering gives what a footprint
// holds: its mean and its spread. With COVER_SAMPLE, the cover at a point scattered over the
// tile, for its distribution (softCoverStatistics).

precision highp float;
precision highp int;

// Texels along the map's side (or the samples' grid, with COVER_SAMPLE), and the seed.
uniform vec2 uCoverSize;
uniform float uCoverSeed;
// How much the masses weigh against the patches.
uniform float uCoverMasses;

uint coverHash(uvec3 p) {
  uint h = (p.x * 0x8da6b343u) ^ (p.y * 0xd8163841u) ^ (p.z * 0xcb1ab31fu);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return h ^ (h >> 15u);
}

float coverRandom(uint h) {
  return float(h & 0xffffffu) / 16777216.0;
}

// Gradient noise at `p` (the tile is [0, 1)), `cells` cells across it, wrapping; about ±0.7.
float coverCorner(vec2 cell, vec2 o, vec2 f, float cells, uint layer) {
  uvec2 c = uvec2(mod(cell + o, cells));
  float a = 6.2831853 * coverRandom(coverHash(uvec3(c, layer)));
  return dot(vec2(cos(a), sin(a)), f - o);
}

float coverGradient(vec2 p, float cells, uint layer) {
  vec2 q = p * cells;
  vec2 cell = floor(q);
  vec2 f = q - cell;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = coverCorner(cell, vec2(0.0, 0.0), f, cells, layer);
  float b = coverCorner(cell, vec2(1.0, 0.0), f, cells, layer);
  float c = coverCorner(cell, vec2(0.0, 1.0), f, cells, layer);
  float d = coverCorner(cell, vec2(1.0, 1.0), f, cells, layer);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Rounded masses at `p`, `cells` cells across the tile, wrapping: a point in each cell, a bump
// about it of a size, a stretch and a turn of its own (an elliptic paraboloid, so its top is
// round), the bumps merged where they overlap (each takes its share of what the others leave),
// all warped by broad noise so they are neither round nor in rows; 0 to 1. A bump reaches no
// further than a cell, so the cells about this one hold every bump reaching it.
float coverMasses(vec2 p, float cells, uint layer) {
  vec2 warp = vec2(coverGradient(p, 0.5 * cells, layer + 32u), coverGradient(p, 0.5 * cells, layer + 48u));
  vec2 q = p * cells + 0.6 * warp;
  vec2 cell = floor(q);
  vec2 f = q - cell;
  float left = 1.0;
  for(int y = -1; y <= 1; y++) {
    for(int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      uint h = coverHash(uvec3(uvec2(mod(cell + o, cells)), layer));
      vec2 point = o + vec2(coverRandom(h), coverRandom(h * 0x9e3779b9u + 0x7f4a7c15u));
      float size = 0.4 + 0.4 * coverRandom(h * 0x85ebca6bu + 0x165667b1u);
      float stretch = 1.0 + 0.25 * coverRandom(h * 0xc2b2ae35u + 0x27d4eb2fu);
      float turn = 6.2831853 * coverRandom(h * 0x27d4eb2du + 0x9e3779b1u);
      vec2 d = f - point;
      d = vec2(cos(turn) * d.x + sin(turn) * d.y, cos(turn) * d.y - sin(turn) * d.x);
      d.x /= stretch;
      float bump = max(1.0 - dot(d, d) / (size * size), 0.0);
      left *= 1.0 - bump;
    }
  }
  return 1.0 - left;
}

// The cover at `p` in the tile.
float coverAt(vec2 p) {
  uint seed = uint(uCoverSeed) * 16u;
  float patches = 0.0;
  float weight = 0.0;
  float amplitude = 1.0;
  float cells = 4.0;
  for(int o = 0; o < 6; o++) {
    patches += amplitude * coverGradient(p, cells, seed + uint(o));
    weight += amplitude;
    amplitude *= 0.5;
    cells *= 2.0;
  }
  patches /= weight;
  float masses = 0.5 * coverMasses(p, 24.0, seed + 8u) + 0.3 * coverMasses(p, 48.0, seed + 9u) + 0.2 * coverMasses(p, 96.0, seed + 10u);
  return patches + uCoverMasses * masses;
}

void main() {
#if defined(COVER_SAMPLE)
  uvec2 at = uvec2(gl_FragCoord.xy);
  uint h = coverHash(uvec3(at, 0x51ed270bu + uint(uCoverSeed)));
  vec2 p = vec2(coverRandom(h), coverRandom(h * 0x9e3779b9u + 0x632be5abu));
  gl_FragColor = vec4(coverAt(p), 0.0, 0.0, 1.0);
#else
  float c = coverAt(gl_FragCoord.xy / uCoverSize);
  gl_FragColor = vec4(c, c * c, 0.0, 1.0);
#endif
}
