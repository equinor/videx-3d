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
