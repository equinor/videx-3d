// The hollow under the seabed (scenery-hollow.ts): its floor (HOLLOW_FLOOR) or its walls,
// built on the CPU about the disc's centre and placed there, on the globe the sky shares, by
// uGlobeDisc: the World moving its anchor moves it, with nothing rebuilt but its curve.
// ⚠️ Assumes the default `up` (+Y), as the stage and the relief do.

#include <common>
#include <logdepthbuf_pars_vertex>
#include ../../../sdk/materials/shaderLib/globe.glsl

// Floor: where it lies across the axis, along true east and north (world units). Walls:
// along the rim, and the height over the seabed (0 at the seabed, below it negative).
attribute vec2 hollowUv;
// Floor: how far in from the walls' foot. Walls: the share of the way down their face.
attribute float hollowEdge;
// How open to the hollow, 0 shut in a crease (the walls'; 1 on the floor).
attribute float hollowOpen;

// The sky's: level toward the subsurface light (SceneryMaterial.setAbyssLight).
uniform vec3 uSkyAbyssLight;

varying vec3 vHollowWorld;
varying vec3 vHollowNormal;
varying vec2 vHollowUv;
varying float vHollowEdge;
varying float vHollowOpen;
// Up where the vertex lies on the globe, true east there, and toward the light raking the
// hollow from its opening: per vertex, as they turn by no more than the rim's angle across it.
varying vec3 vHollowUp;
varying vec3 vHollowEast;
varying vec3 vHollowRake;

#ifdef HOLLOW_FLOOR
// The rock (createRockTexture), and the slope its r and g span.
uniform sampler2D uHollowRock;
uniform float uHollowRockSlope;
// The floor's rock at its two largest sizes, read here per vertex (the floor's are some 3 to
// 10 km apart, finer than either needs), so the fragments skip three reads and fetch the rest
// without waiting on these: x the mantle's blotches' shade (some 1800 km a square); y the
// rock's shade some 180 km a square, zw its slope along true east and north.
varying vec4 vHollowLarge;

// The mip levels the two are read at: their texels about as far apart as the vertices.
#define HOLLOW_LARGE_LOD vec2(1.5, 4.75)

// The rock at `uv`, its square turned by `turn` and shifted by `region`, at mip level `lod`:
// hollowRockVaried (hollow-fragment), with no derivatives.
vec4 hollowRockVariedLod(vec2 uv, vec2 turn, float region, float lod) {
  mat2 m = mat2(turn.x, turn.y, -turn.y, turn.x);
  vec2 p = m * uv;
  float i = floor(region);
  float f = region - i;
  vec4 a = textureLod(uHollowRock, p + sin(vec2(3.0, 7.0) * i), lod);
  vec4 b = textureLod(uHollowRock, p + sin(vec2(3.0, 7.0) * (i + 1.0)), lod);
  vec4 rock = mix(a, b, smoothstep(0.2, 0.8, f - 0.3 * (a.z - b.z)));
  rock.xy = transpose(m) * ((rock.xy * 2.0 - 1.0) * uHollowRockSlope);
  return rock;
}
#endif

// How high the raking light stands over the horizon: 28°.
#define HOLLOW_RAKE_SIN 0.4695
#define HOLLOW_RAKE_COS 0.8829

void main() {
  // About the disc's centre, so a point far out keeps its precision (relief-tiles-vertex).
  vec3 world = uGlobeDisc.xyz + position;
  vHollowWorld = world;
  vHollowNormal = normal;
  vHollowUv = hollowUv;
  vHollowEdge = hollowEdge;
  vHollowOpen = hollowOpen;
  vec3 up = globeUpAt(world);
  vHollowUp = up;
  vHollowEast = normalize(uGlobeEast - up * dot(uGlobeEast, up));
  vec3 level = normalize(uSkyAbyssLight - up * dot(uSkyAbyssLight, up));
  vHollowRake = level * HOLLOW_RAKE_COS + up * HOLLOW_RAKE_SIN;
  #ifdef HOLLOW_FLOOR
  mat2 mantle = mat2(0.799, 0.602, -0.602, 0.799);
  float m = textureLod(uHollowRock, mantle * (hollowUv / 1800000.0 + vec2(0.13, 0.71)), HOLLOW_LARGE_LOD.x).z;
  vec4 r1 = hollowRockVariedLod(hollowUv / 180000.0 + vec2(0.37, 0.29), vec2(0.276, 0.961), m * 6.0, HOLLOW_LARGE_LOD.y);
  vHollowLarge = vec4(m, r1.z, r1.xy);
  #endif
  gl_Position = projectionMatrix * (viewMatrix * vec4(world, 1.0));
  // ⚠️ Far off, clip z rounds past w in fp32 and clips vertices at random: held at the far
  // plane, where the depth test still passes it (relief-tiles-vertex).
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-7));
  #include <logdepthbuf_vertex>
}
