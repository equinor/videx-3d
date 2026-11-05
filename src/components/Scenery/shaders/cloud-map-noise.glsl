// What both of the cloud map's passes (scenery-cloud-map.ts) draw with: where a texel of a face
// lies, and integer-hashed noise, so every GPU makes the same weather.

precision highp float;
precision highp int;

uniform int uMapFace; // 0 +x, 1 −x, 2 +y, 3 −y, 4 +z, 5 −z, as GL lays a cube map out
uniform float uMapSize; // texels along a face's side
uniform float uMapSeed;

#define MAP_PI 3.141592653589793
#define MAP_EARTH_KM 6371.0

float mapSquare(float x) {
  return x * x;
}

uint mapHash(ivec3 p, uint salt) {
  uvec3 q = uvec3(p);
  uint seed = uint(int(uMapSeed)) * 0x9e3779b9u;
  uint h = (q.x * 0x8da6b343u) ^ (q.y * 0xd8163841u) ^ (q.z * 0xcb1ab31fu) ^ ((salt + seed) * 0x85ebca6bu);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return h ^ (h >> 15u);
}

vec3 mapRandom3(ivec3 p, uint salt) {
  uint h = mapHash(p, salt);
  return vec3(uvec3(h, h >> 10u, h >> 20u) & 1023u) / 1024.0;
}

float mapCorner(ivec3 cell, ivec3 o, vec3 f, uint salt) {
  vec3 g = mapRandom3(cell + o, salt) * 2.0 - 1.0;
  return dot(g, f - vec3(o));
}

// Gradient noise at `p`, about [−1, 1].
float mapNoise(vec3 p, uint salt) {
  ivec3 cell = ivec3(floor(p));
  vec3 f = p - floor(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = mapCorner(cell, ivec3(0, 0, 0), f, salt);
  float b = mapCorner(cell, ivec3(1, 0, 0), f, salt);
  float c = mapCorner(cell, ivec3(0, 1, 0), f, salt);
  float d = mapCorner(cell, ivec3(1, 1, 0), f, salt);
  float e = mapCorner(cell, ivec3(0, 0, 1), f, salt);
  float g = mapCorner(cell, ivec3(1, 0, 1), f, salt);
  float h = mapCorner(cell, ivec3(0, 1, 1), f, salt);
  float k = mapCorner(cell, ivec3(1, 1, 1), f, salt);
  return 1.6 * mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

// The standard deviation of mapFbm's sum, measured (some 0.16 for 2 to 6 octaves).
#define MAP_FBM_DEVIATION 0.16

// `octaves` of gradient noise from `p`, each twice as fine and half as strong, in standard
// deviations (MAP_FBM_DEVIATION).
float mapFbm(vec3 p, int octaves, uint salt) {
  float sum = 0.0;
  float amplitude = 0.5;
  float total = 0.0;
  for(int o = 0; o < 6; o++) {
    if(o >= octaves)
      break;
    sum += amplitude * mapNoise(p, salt + uint(o) * 101u);
    total += amplitude;
    amplitude *= 0.5;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
  }
  return sum / total / MAP_FBM_DEVIATION;
}

// Worley's nearest two distances at `p`, a feature point per cell.
vec2 mapWorley(vec3 p, uint salt) {
  ivec3 cell = ivec3(floor(p));
  float first = 1e9;
  float second = 1e9;
  for(int z = -1; z <= 1; z++)
    for(int y = -1; y <= 1; y++)
      for(int x = -1; x <= 1; x++) {
        ivec3 c = cell + ivec3(x, y, z);
        float d = length(vec3(c) + mapRandom3(c, salt) - p);
        if(d < first) {
          second = first;
          first = d;
        } else if(d < second)
          second = d;
      }
  return vec2(first, second);
}

// The direction of the texel at `st` (−1 to 1 across the face, t from its first row) of the
// face `uMapFace`, as GL's cube maps take them.
vec3 mapDirection(vec2 st) {
  float s = st.x;
  float t = st.y;
  if(uMapFace == 0)
    return vec3(1.0, -t, -s);
  if(uMapFace == 1)
    return vec3(-1.0, -t, s);
  if(uMapFace == 2)
    return vec3(s, 1.0, t);
  if(uMapFace == 3)
    return vec3(s, -1.0, -t);
  if(uMapFace == 4)
    return vec3(s, -t, 1.0);
  return vec3(-s, -t, -1.0);
}

// The place this fragment draws, on the unit sphere fixed on the Earth (z toward the north
// pole), and its latitude (degrees).
vec3 mapPlace(out float latitude) {
  vec2 st = gl_FragCoord.xy / uMapSize * 2.0 - 1.0;
  vec3 d = normalize(mapDirection(st));
  latitude = degrees(asin(clamp(d.z, -1.0, 1.0)));
  return d;
}

// Due east and north at `d` (unit, fixed on the Earth): toward +x at the poles.
void mapTangents(vec3 d, out vec3 east, out vec3 north) {
  vec3 axis = abs(d.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  east = normalize(cross(axis, d));
  north = cross(d, east);
}
