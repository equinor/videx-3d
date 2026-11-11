// The clouds' cover volume (CloudCoverVolume, scenery-cloud-cover.ts): a tile of noise repeating
// every way, of how much each column is clouded over (any value: a level's share under cloud
// picks a level of it, softCoverLevel), read on the Earth's curved surface where each column
// stands (cloud-march.glsl), so the clouds are fixed to the Earth and keep their shape
// anywhere on the globe, as the 3D clouds' first noise was (documents/clouds.md, "Fixed to the
// Earth"). Broad patches of cloud and clear sky (gradient noise in octaves), and apart from them
// masses (rounded bumps of many sizes about scattered points, at three scales). The surface cuts
// each bump at a height of its own, so the masses come in more sizes still. The march reads the
// patches twice, here and a few times broader. Integer hashes, so every GPU makes the same.
//
// Out, slice by slice: (patches, masses, patches², masses²) at the texel's middle, so the
// mipmaps give what a footprint holds: each one's mean and spread. With COVER_SAMPLE, at two
// points scattered over the tile: the patches and the masses at the first, the patches at the
// second (the broad read's, which lies elsewhere in the tile), for the distribution. With
// COVER_SPREAD, the volume drawn read at the middles of texels scattered over each level of its
// mipmaps (COVER_SPREAD_ROWS rows a level), for the spread each level averages away.

precision highp float;
precision highp int;

// Texels along the volume's side (or the samples' grid, with COVER_SAMPLE), the slice drawn, and
// the seed.
uniform float uCoverSize;
uniform float uCoverSlice;
uniform float uCoverSeed;
#if defined(COVER_SPREAD)
uniform highp sampler3D uCoverVolume;
#endif

uint coverHash(uvec3 p, uint layer) {
  uint h = (p.x * 0x8da6b343u) ^ (p.y * 0xd8163841u) ^ (p.z * 0xcb1ab31fu) ^ (layer * 0x9e3779b9u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return h ^ (h >> 15u);
}

float coverRandom(uint h) {
  return float(h & 0xffffffu) / 16777216.0;
}

// A way picked evenly over the sphere by `h`.
vec3 coverWay(uint h) {
  float z = 2.0 * coverRandom(h) - 1.0;
  float a = 6.2831853 * coverRandom(h * 0x9e3779b9u + 0x7f4a7c15u);
  float r = sqrt(max(1.0 - z * z, 0.0));
  return vec3(r * cos(a), r * sin(a), z);
}

float coverCorner(vec3 cell, vec3 o, vec3 f, float cells, uint layer) {
  return dot(coverWay(coverHash(uvec3(mod(cell + o, cells)), layer)), f - o);
}

// Gradient noise at `p` (the tile is [0, 1)³), `cells` cells across it, wrapping.
float coverGradient(vec3 p, float cells, uint layer) {
  vec3 q = p * cells;
  vec3 cell = floor(q);
  vec3 f = q - cell;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = mix(coverCorner(cell, vec3(0, 0, 0), f, cells, layer), coverCorner(cell, vec3(1, 0, 0), f, cells, layer), u.x);
  float b = mix(coverCorner(cell, vec3(0, 1, 0), f, cells, layer), coverCorner(cell, vec3(1, 1, 0), f, cells, layer), u.x);
  float c = mix(coverCorner(cell, vec3(0, 0, 1), f, cells, layer), coverCorner(cell, vec3(1, 0, 1), f, cells, layer), u.x);
  float d = mix(coverCorner(cell, vec3(0, 1, 1), f, cells, layer), coverCorner(cell, vec3(1, 1, 1), f, cells, layer), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}

// Rounded masses at `p`, `cells` cells across the tile, wrapping: a point in each cell, a bump
// about it of a size and a stretch of its own (an ellipsoid, so the surface cuts it in a round
// patch), the bumps merged where they overlap (each takes its share of what the others leave),
// all warped by broad noise so they are neither round nor in rows; 0 to 1. A bump reaches no
// further than a cell, so the cells about this one hold every bump reaching it.
float coverMasses(vec3 p, float cells, uint layer) {
  float broad = 0.5 * cells;
  vec3 warp = vec3(coverGradient(p, broad, layer + 32u), coverGradient(p, broad, layer + 48u), coverGradient(p, broad, layer + 64u));
  vec3 q = p * cells + 0.6 * warp;
  vec3 cell = floor(q);
  vec3 f = q - cell;
  float left = 1.0;
  for(int z = -1; z <= 1; z++) {
    for(int y = -1; y <= 1; y++) {
      for(int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        uint h = coverHash(uvec3(mod(cell + o, cells)), layer);
        vec3 point = o + vec3(coverRandom(h), coverRandom(h * 0x9e3779b9u + 0x7f4a7c15u), coverRandom(h * 0x632be5abu + 0x85ebca6bu));
        float size = 0.4 + 0.4 * coverRandom(h * 0x85ebca6bu + 0x165667b1u);
        vec3 stretch = 1.0 + 0.25 * vec3(coverRandom(h * 0xc2b2ae35u + 0x27d4eb2fu), coverRandom(h * 0x27d4eb2du + 0x9e3779b1u), coverRandom(h * 0x165667b1u + 0xd3a2646cu));
        vec3 d = (f - point) / stretch;
        float bump = max(1.0 - dot(d, d) / (size * size), 0.0);
        left *= 1.0 - bump;
      }
    }
  }
  return 1.0 - left;
}

// The cover at `p` in the tile: its broad patches (x) and its masses (y), which a level weighs
// against each other as its look says (its masses' weight).
vec2 coverAt(vec3 p) {
  uint seed = uint(uCoverSeed) * 16u;
  float patches = (coverGradient(p, 4.0, seed) + 0.5 * coverGradient(p, 8.0, seed + 1u) + 0.25 * coverGradient(p, 16.0, seed + 2u)) / 1.75;
  float masses = 0.5 * coverMasses(p, 4.0, seed + 8u) + 0.3 * coverMasses(p, 8.0, seed + 9u) + 0.2 * coverMasses(p, 16.0, seed + 10u);
  return vec2(patches, masses);
}

void main() {
#if defined(COVER_SAMPLE)
  uvec3 at = uvec3(uvec2(gl_FragCoord.xy), 0x51ed270bu + uint(uCoverSeed));
  uint h = coverHash(at, 0u);
  uint g = coverHash(at, 1u);
  vec3 first = vec3(coverRandom(h), coverRandom(h * 0x9e3779b9u + 0x632be5abu), coverRandom(h * 0x85ebca6bu + 0x27d4eb2fu));
  vec3 second = vec3(coverRandom(g), coverRandom(g * 0x9e3779b9u + 0x632be5abu), coverRandom(g * 0x85ebca6bu + 0x27d4eb2fu));
  gl_FragColor = vec4(coverAt(first), coverAt(second).x, 1.0);
#elif defined(COVER_SPREAD)
  // A texel of a level of the mipmaps (by the pixel's row), picked by the pixel, read at its
  // middle: the spread of the patches and of the masses within it (its mean square less its mean
  // squared), and their means.
  ivec2 px = ivec2(gl_FragCoord.xy);
  int level = px.y / COVER_SPREAD_ROWS;
  uint side = max(uint(uCoverSize) >> uint(level), 1u);
  uvec3 at = uvec3(uvec2(px), 0x2545f491u + uint(uCoverSeed));
  uvec3 texel = uvec3(coverHash(at, 2u), coverHash(at, 3u), coverHash(at, 4u)) % side;
  vec4 v = texelFetch(uCoverVolume, ivec3(texel), level);
  gl_FragColor = vec4(v.zw - v.xy * v.xy, v.xy);
#else
  vec2 c = coverAt(vec3(gl_FragCoord.xy, uCoverSlice + 0.5) / uCoverSize);
  gl_FragColor = vec4(c, c * c);
#endif
}
