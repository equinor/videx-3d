// A tileable square of rock (createRockTexture): every pattern repeats over the square, so
// the texture tiles. r, g: the relief's slope along x and y, 0.5 where it is level; b: the
// rock's shade, in broad blotches; a: cracks, 1 on one. Organic rather than cellular: value
// noise on a lattice wrapped at the square's edge, its domain warped by more of it (still
// wrapped, so still tiling), ridges for crags; and the cracks a network of cell edges in a
// warped domain, some of its edges left out, so they bend, fork and end as cracks in rock do.

precision highp float;
precision highp int;

uniform float uSize; // texels along a side
uniform float uSeed;
uniform float uSlopeScale; // the slope that maps to 1 (r and g at 0 or 1)
uniform vec2 uFissures; // lattice cells across the square of the coarse fissures, and of the fine
uniform vec2 uFissureWidth; // their widths, in texels

varying vec2 vUv;

uvec3 rockHash3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

// A value per lattice cell `c` wrapped at `period` cells, on layer `layer`: 0 to 1.
float rockHash(ivec2 c, int period, int layer) {
  ivec2 w = ivec2(mod(vec2(c), float(period)));
  return float(rockHash3(uvec3(uvec2(w), uint(layer) + uint(uSeed))).x) / 4294967295.0;
}

// Value noise over `period` cells across the square at `uv`, 0 to 1: quintic, so its slope
// is smooth too.
float rockNoise(vec2 uv, int period, int layer) {
  vec2 q = uv * float(period);
  vec2 i = floor(q);
  vec2 f = q - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  float a = rockHash(c, period, layer);
  float b = rockHash(c + ivec2(1, 0), period, layer);
  float d = rockHash(c + ivec2(0, 1), period, layer);
  float e = rockHash(c + ivec2(1, 1), period, layer);
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

// Fractal noise from `period` cells across, `octaves` of it, each half the last: 0 to 1.
float rockFbm(vec2 uv, int period, int octaves, int layer) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for(int i = 0; i < 8; i++) {
    if(i >= octaves)
      break;
    sum += amp * rockNoise(uv, period, layer + 17 * i);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

// Ridged noise: crests where noise crosses its middle, sharpened, each octave weighted by the
// last so crags gather on crags.
float rockRidged(vec2 uv, int period, int octaves, int layer) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  float weight = 1.0;
  for(int i = 0; i < 8; i++) {
    if(i >= octaves)
      break;
    float r = 1.0 - abs(2.0 * rockNoise(uv, period, layer + 17 * i) - 1.0);
    r *= r * weight;
    weight = clamp(r * 1.6, 0.0, 1.0);
    sum += amp * r;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

// `uv` pulled about by noise of its own, `strength` of the square: the forms bend and flow.
vec2 rockWarp(vec2 uv, int period, float strength, int layer) {
  vec2 w = vec2(rockFbm(uv, period, 4, layer), rockFbm(uv, period, 4, layer + 7)) - 0.5;
  return uv + w * strength;
}

// The relief, 0 to 1: rounded masses and crags in a warped domain.
float rockHeight(vec2 uv) {
  vec2 q = rockWarp(uv, 4, 0.35, 401);
  vec2 r = rockWarp(q, 8, 0.12, 501);
  return mix(rockFbm(r, 4, 7, 11), rockRidged(q, 8, 6, 211), 0.45);
}

// A crack network over `uv`, the edges between cells about jittered points `cells` across, in
// a domain warped so they bend; an edge kept only where a hash both its cells share passes
// `keep`, so the cracks fork and end rather than close into cells. How much a crack covers a
// texel: its distance in texels, about `width` wide, wavering, with a soft halo.
float rockCracks(vec2 uv, int cells, float width, float keep, int layer) {
  vec2 q = rockWarp(uv, max(cells / 4, 2), 1.4 / float(cells), layer);
  q = rockWarp(q, cells, 0.25 / float(cells), layer + 5);
  vec2 p = q * float(cells);
  vec2 i = floor(p);
  float d1 = 9.0;
  float d2 = 9.0;
  vec2 id1 = vec2(0.0);
  vec2 id2 = vec2(0.0);
  for(int y = -1; y <= 1; y++)
    for(int x = -1; x <= 1; x++) {
      vec2 c = i + vec2(x, y);
      ivec2 cell = ivec2(mod(c, float(cells)));
      vec2 at = c + 0.5 + 0.8 * (vec2(rockHash(cell, cells, layer + 11), rockHash(cell, cells, layer + 13)) - 0.5);
      float d = length(p - at);
      if(d < d1) {
        d2 = d1;
        id2 = id1;
        d1 = d;
        id1 = vec2(cell);
      } else if(d < d2) {
        d2 = d;
        id2 = vec2(cell);
      }
    }
  vec2 lo = min(id1, id2);
  vec2 hi = max(id1, id2);
  float shared = rockHash(ivec2(lo * 7.0 + hi * 13.0), 65536, layer + 17);
  float texels = 0.5 * (d2 - d1) * uSize / float(cells);
  float w = width * (0.6 + 0.8 * rockNoise(uv, cells * 2, layer + 9));
  float line = 1.0 - smoothstep(0.5 * w, w + 0.5, texels);
  float halo = 0.35 * exp(-texels / (3.0 * w));
  return max(line, halo) * step(1.0 - keep, shared);
}

void main() {
  vec2 uv = vUv;
  float pitch = 1.0 / uSize;
  float h = rockHeight(uv);
  float hx = rockHeight(uv + vec2(pitch, 0.0)) - rockHeight(uv - vec2(pitch, 0.0));
  float hy = rockHeight(uv + vec2(0.0, pitch)) - rockHeight(uv - vec2(0.0, pitch));
  // Per unit of the square.
  vec2 slope = vec2(hx, hy) / (2.0 * pitch);
  // The shade in blotches, some 16 to the square, their lattice bent away by a warp as strong as
  // a cell, a little of the relief in it: with fewer, each square's darkest blotch would sit
  // where it sits in every other, and the rock read dozens of times over shows them in a grid.
  float shade = mix(rockFbm(rockWarp(uv, 4, 0.3, 601), 4, 5, 701), h, 0.35);
  // The great cracks, most of their edges kept, and lesser ones between them, fewer kept: they
  // fork off the great ones and end.
  float fissures = max(rockCracks(uv, int(uFissures.x), uFissureWidth.x, 0.7, 801), 0.6 * rockCracks(uv, int(uFissures.y), uFissureWidth.y, 0.4, 901));
  gl_FragColor = vec4(clamp(0.5 + 0.5 * slope / uSlopeScale, 0.0, 1.0), shade, fissures);
}
