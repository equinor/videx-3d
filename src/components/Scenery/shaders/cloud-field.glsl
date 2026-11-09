// The 3D clouds' field (SceneryCloudVolume): the frame their patterns lie on, fixed on the
// Earth.
//
// Positions are on the field's frame (uCloudFrameE/N/M: east, north and up at the weather's
// middle, in the world): (east, north, up less the sea's radius) from the Earth's centre, the
// camera's worked out on the CPU in 64-bit floats (uCloudCamera). The field is the plane
// touching the Earth there (gnomonic: a column is a point on it, a view's track a line), in
// metres; each level's pattern drifts on it with its own wind.

uniform vec3 uCloudFrameE;
uniform vec3 uCloudFrameN;
uniform vec3 uCloudFrameM;
uniform vec3 uCloudCamera;
// 1 / the sea's radius; 0 with the globe off (the field is the level plane).
uniform float uCloudInvRadius;
// The local weather's radius about its middle (metres): no cloud beyond it.
uniform float uCloudLocalRadius;
// The shape volume: Perlin-Worley (r) and billows (gba), tiling.
uniform sampler3D uCloudShape;

#define CLOUD_FAR 1e30

// The shape volume's Perlin-Worley's mean and standard deviation (measured,
// scenery-cloud-noise.ts), and its texels along a side.
#define CLOUD_PERLIN_WORLEY vec2(0.736, 0.094)
#define CLOUD_SHAPE_TEXELS 128.0

// A point `t` along a view whose way is `d` on the field's frame.
vec3 cloudFieldPoint(vec3 d, float t) {
  return uCloudCamera + d * t;
}

// Where a point `p` of the field's frame lies on the field (metres, fixed on the Earth).
vec2 cloudFieldOf(vec3 p) {
  return p.xy / (1.0 + p.z * uCloudInvRadius);
}

// Its height over the sea: |p| - R, written so it keeps its precision near the Earth.
float cloudAltitudeOf(vec3 p) {
  if(uCloudInvRadius <= 0.0)
    return p.z;
  float R = 1.0 / uCloudInvRadius;
  float a = p.z * (2.0 * R + p.z) + dot(p.xy, p.xy);
  return a / (R + sqrt(R * R + a));
}

// Stefan Gustavson's permutation polynomial modulo 289 (webgl-noise, MIT).
vec4 cloudPermute(vec4 x) {
  return mod(((x * 34.0) + 10.0) * x, 289.0);
}

// Value noise in [0, 1) at `p` in cells, smooth, repeating every 289 cells: the twin of
// cloudValueNoise in cloud-noise.ts.
float cloudValueNoise(vec3 p) {
  vec3 f = floor(p);
  vec3 i = mod(f, 289.0);
  vec3 j = mod(i + 1.0, 289.0);
  vec3 u = p - f;
  u = u * u * (3.0 - 2.0 * u);
  vec4 x = vec4(i.x, j.x, i.x, j.x);
  vec4 y = vec4(i.y, i.y, j.y, j.y);
  vec4 near = cloudPermute(cloudPermute(cloudPermute(vec4(i.z)) + y) + x) / 289.0;
  vec4 far = cloudPermute(cloudPermute(cloudPermute(vec4(j.z)) + y) + x) / 289.0;
  vec4 h = mix(near, far, u.z);
  vec2 rows = mix(h.xz, h.yw, u.x);
  return mix(rows.x, rows.y, u.y);
}
