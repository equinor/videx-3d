// ============================================================================
// Casing stylization spliced into MeshStandardMaterial's stock fragment shader
// (inserted right after `#include <common>` by CasingMaterial.onBeforeCompile).
//
// Declares only the CUSTOM uniforms/varyings + the shared helper functions. The
// PBR staples (diffuse, emissive, roughness, metalness, opacity, vViewPosition,
// vNormal) are already declared by MeshStandardMaterial and must NOT be redeclared
// here. The small per-seam effect snippets that USE these helpers live as string
// constants in CasingMaterial.ts and are injected at their respective chunk seams.
// ============================================================================
// readability / stylization
uniform float sectionVariation;
uniform float silhouette;
uniform float silhouettePower;
uniform float edgeShading;
uniform float edgeShadingWidth; // distance in metres the edge shading reaches from each section edge
uniform float sectionIndex;
uniform float detailFadeNear;
uniform float detailFadeFar;
uniform float detailQuality; // 0..1 perf<->quality: scales weathering fbm octaves + gates the coarse scratch family
uniform float schematic; // 0 = realistic PBR, 1 = unlit flat "schematic" shading (color + silhouette only)

// procedural micro-normal detail: composable granular bumps + brushed grain + scratches.
// Each layer owns its strength (0 = off; also its blend weight), frequency (cells per
// world unit) and octaves; the layers simply sum.
uniform float granularStrength;
uniform float granularFrequency;
uniform int granularOctaves;
uniform float granularAnisotropy;
uniform float brushedStrength;
uniform float brushedFrequency;
uniform int brushedOctaves;
uniform float brushedAngle;
uniform float brushedSharpness;
uniform float brushedUniformity;
uniform float scratchStrength;
uniform float scratchFrequency;
uniform int scratchOctaves;
uniform float scratchAngle;
uniform float scratchDensity;
uniform float scratchLength;
uniform float scratchWander;
uniform float scratchWidth;

// procedural wear/tear/spill detail (no textures)
uniform float weathering;
uniform float weatheringScale; // noise cells per real-world metre

varying float vWall; // 0 = inner (bore-facing) wall, 1 = outer wall
varying float vCurvePos; // normalized position on the SHARED wellbore trajectory, 0-1
varying float vSectionPos; // section-relative position, 0 at this section's top edge, 1 at its bottom
varying float vSectionLength; // physical length of this section in metres
varying float vFragRadius; // world-space radius of this fragment (sizeMultiplier applied)
varying vec3 vWorldRadial; // world-space outward radial direction, stable under autoSlicePosition
varying vec3 vWorldAxis; // world-space well axis (tangent), for the cross-section shadow
varying vec3 vWorldRadialDisplay; // actual displayed radial (follows autoSlicePosition), for the rails
varying vec3 vWorldPos; // world-space fragment position, for world-stable seamless weathering
varying vec2 vWorldUv; // world-scaled (object-distance) UV, drives the procedural micro-normal

// Cheap 2D value-noise hash, used to derive per-section pseudo-random offsets/phases
// (wear amount, rail phase) from the section index.
float casingHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Procedural micro-normal patterns + normal-perturbation helper (pnFbm2,
// proceduralNormalHeight, perturbNormalHeight), shared from the shaderLib.
#include ../../../../sdk/materials/shaderLib/procedural-normal.glsl

// Cheap 3D value noise, sampled in WORLD space so the weathering is pinned to world
// coordinates: slicing/offsetting the casing only reveals different parts of a fixed
// 3D field (no drift) and there is no circumferential seam (3D space doesn't wrap) -
// unlike a 0-1 arc parameterisation.
float casingHash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float casingNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(casingHash3(i + vec3(0.0, 0.0, 0.0)), casingHash3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(casingHash3(i + vec3(0.0, 1.0, 0.0)), casingHash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y), mix(mix(casingHash3(i + vec3(0.0, 0.0, 1.0)), casingHash3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(casingHash3(i + vec3(0.0, 1.0, 1.0)), casingHash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

// Fractional Brownian motion for a more organic, less obviously-tiled corrosion/scuff
// base than a single lookup. `octaves` (1..4) is runtime-driven (via detailQuality): the
// loop bound stays a compile-time constant and `break` clamps it, so dropping the top
// octave(s) trades barely-visible fine detail for a real per-fragment cost cut.
float casingFbm3(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for(int o = 0; o < 4; o++) {
    if(o >= octaves)
      break;
    sum += amp * casingNoise3(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return sum;
}
