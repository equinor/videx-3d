// The 3D clouds' shape volume (scenery-cloud-noise.ts), a slice at a time: a tileable cube,
// each texel worked out once per page. Integer hashes, so every GPU makes the same noise.
//   r  Perlin-Worley: gradient noise at 4, 8 and 16 cells, its low end lifted into the
//      billows of g (GPU Pro 7, "Real-time volumetric cloudscapes"); the lumps
//      (cloud-march.glsl, cloudDensity) read only this
//   g  Worley at 4, 8 and 16 cells, inverted (1 in a billow's core)
//   b  Worley at 8, 16 and 32 cells, inverted
//   a  Worley at 16 and 32 cells, inverted

precision highp float;
precision highp int;

uniform float uNoiseSize; // texels along a side
uniform float uNoiseSlice; // the slice drawn, in texels

uint cloudHash(uvec3 p, uint seed) {
  uint h = (p.x * 0x8da6b343u) ^ (p.y * 0xd8163841u) ^ (p.z * 0xcb1ab31fu) ^ ((seed + 0x9e3779b9u) * 0x85ebca6bu);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return h ^ (h >> 15u);
}

// Worley's distance to the nearest feature point, a point per cell, `cells` cells across the
// tile, inverted: 1 at a point, 0 a cell or more from all of them. `p` in [0, 1).
float cloudWorley(vec3 p, float cells, uint seed) {
  vec3 q = p * cells;
  vec3 cell = floor(q);
  vec3 f = q - cell;
  float nearest = 1e9;
  for(int z = -1; z <= 1; z++)
    for(int y = -1; y <= 1; y++)
      for(int x = -1; x <= 1; x++) {
        vec3 o = vec3(x, y, z);
        uint h = cloudHash(uvec3(mod(cell + o, cells)), seed);
        vec3 feature = vec3(uvec3(h, h >> 10u, h >> 20u) & 1023u) / 1024.0;
        vec3 r = o + feature - f;
        nearest = min(nearest, dot(r, r));
      }
  return 1.0 - clamp(sqrt(nearest), 0.0, 1.0);
}

const vec3 CLOUD_GRADIENTS[12] = vec3[](vec3(1, 1, 0), vec3(-1, 1, 0), vec3(1, -1, 0), vec3(-1, -1, 0), vec3(1, 0, 1), vec3(-1, 0, 1), vec3(1, 0, -1), vec3(-1, 0, -1), vec3(0, 1, 1), vec3(0, -1, 1), vec3(0, 1, -1), vec3(0, -1, -1));

float cloudCorner(vec3 cell, vec3 o, vec3 f, float cells, uint seed) {
  uint h = cloudHash(uvec3(mod(cell + o, cells)), seed);
  return dot(CLOUD_GRADIENTS[h % 12u], f - o);
}

// Perlin's gradient noise, `cells` cells across the tile, about [-1, 1].
float cloudPerlin(vec3 p, float cells, uint seed) {
  vec3 q = p * cells;
  vec3 cell = floor(q);
  vec3 f = q - cell;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = cloudCorner(cell, vec3(0, 0, 0), f, cells, seed);
  float b = cloudCorner(cell, vec3(1, 0, 0), f, cells, seed);
  float c = cloudCorner(cell, vec3(0, 1, 0), f, cells, seed);
  float d = cloudCorner(cell, vec3(1, 1, 0), f, cells, seed);
  float e = cloudCorner(cell, vec3(0, 0, 1), f, cells, seed);
  float g = cloudCorner(cell, vec3(1, 0, 1), f, cells, seed);
  float h = cloudCorner(cell, vec3(0, 1, 1), f, cells, seed);
  float k = cloudCorner(cell, vec3(1, 1, 1), f, cells, seed);
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

void main() {
  vec3 p = vec3(gl_FragCoord.xy, uNoiseSlice + 0.5) / uNoiseSize;
  float w4 = cloudWorley(p, 4.0, 11u);
  float w8 = cloudWorley(p, 8.0, 12u);
  float w16 = cloudWorley(p, 16.0, 13u);
  float w32 = cloudWorley(p, 32.0, 14u);
  float perlin = cloudPerlin(p, 4.0, 1u) * 0.5714 + cloudPerlin(p, 8.0, 2u) * 0.2857 + cloudPerlin(p, 16.0, 3u) * 0.1429;
  perlin = clamp(0.5 + 0.75 * perlin, 0.0, 1.0);
  float billows = w4 * 0.625 + w8 * 0.25 + w16 * 0.125;
  float perlinWorley = billows + perlin * (1.0 - billows);
  gl_FragColor = vec4(perlinWorley, billows, w8 * 0.625 + w16 * 0.25 + w32 * 0.125, w16 * 0.75 + w32 * 0.25);
}
