// The foam's life (SeaFoamLife, sea-foam-life.ts): a square of the wave plane about the camera,
// a texel at a time, run on a step. r: fresh foam, where a crest broke a moment ago, dense and
// white; g: old foam, thin, what the fresh leaves as it fades, gathered by the wind into streaks.
// What breaks is the surface's own whitecaps (waterWaves' crest over waterWindFoam's threshold),
// so a crest running on leaves its foam behind it as a trail. Its derivatives are a texel's, the
// footprint the waves are read at.

#include <common>
#include ./water-surface.glsl

uniform sampler2D uFoamPrev;
// The square now and a step ago: its corner in the wave plane (m), and its size (m).
uniform vec3 uFoamNow;
uniform vec3 uFoamPrevArea;
// How far the surface carried the foam this step (m): the wind's drift.
uniform vec2 uFoamDrift;
// x: what fresh foam keeps of itself this step; y: what old foam keeps; z: the share of what
// fresh foam loses that it leaves as old; w: how far the streaks pull old foam across the wind
// this step at most (m).
uniform vec4 uFoamStep;
// xy: across the wind (unit); z: the streaks' spacing's inverse (1 / m); w: their slow wander.
uniform vec4 uFoamStreaks;
// The share of the whitecaps' cover that breaks afresh (the rest is the foam they leave).
uniform float uFoamActive;
// How much a texel comes into its life this step (b, of 1: the step's seconds over the ease-in's).
uniform float uFoamEase;

varying vec2 vUv;

void main() {
  vec2 p = uFoamNow.xy + vUv * uFoamNow.z;
  // Where its foam lay a step ago: back along the drift, and across the wind from the streak
  // line it gathers toward (where the pull's sine crosses down through 0), the lines wandering
  // along the wind so they never run ruler-straight.
  vec2 across = uFoamStreaks.xy;
  vec2 along = vec2(-across.y, across.x);
  float s = dot(p, across) * uFoamStreaks.z + uFoamStreaks.w + 0.35 * sin(dot(p, along) * uFoamStreaks.z * 0.11 + uFoamStreaks.w);
  vec2 from = p - uFoamDrift + across * uFoamStep.w * sin(6.2831853 * s);
  vec2 uv = (from - uFoamPrevArea.xy) / uFoamPrevArea.z;
  vec3 before = vec3(0.0);
  if(uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0)
    before = textureLod(uFoamPrev, uv, 0.0).rgb;

  // A crest breaking here now, as the surface draws it.
  vec2 slope;
  float height;
  vec2 crest;
  float rough;
  waterWaves(p, 0.0, 1e6, slope, height, crest, rough);
  float threshold = 1.0 - waterWindFoamShare(uFoamActive);
  // The share of the texel the crests break over, as the surface draws them (waterFoam): with
  // those it does not show, and an edge of 0.02 (as waterFoam's, a normal of edge / √5).
  float spread = sqrt(waterCrestUnresolved * waterCrestUnresolved + 0.00288);
  float breaking = 1.0 / (1.0 + exp(-1.702 * (crest.x - threshold) * 2.0 * WATER_CREST_SPAN / spread));

  float fresh = max(before.r * uFoamStep.x, breaking);
  float old = min(before.g * uFoamStep.y + before.r * (1.0 - uFoamStep.x) * uFoamStep.z, 1.0);
  gl_FragColor = vec4(fresh, old, min(before.b + uFoamEase, 1.0), 1.0);
}
