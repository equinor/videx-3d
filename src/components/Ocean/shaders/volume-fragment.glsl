// Ocean water-body (volume) fragment shader.
//
// Shades the box side walls (rendered back-face) as a depth-tinted water body:
// the further a wall fragment is from the camera, the denser the water tint
// between the camera and that fragment, like an exponential fog. This gives the
// "inside a water body" feel when the camera is within the box, and a tinted
// body seen through the (transparent) surface from outside — without a separate
// fullscreen pass. Animated caustic light play near the surface breaks up the
// flat tint.
//
// OIT-compatible: includes the shared oit.glsl chunk and routes its final colour
// through oitProcess() so it composites with the surface and subsurface geometry.

uniform float uTime;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform float uFogDensity;   // per-meter tint build-up
uniform float uMaxOpacity;   // densest tint (far through the water)
uniform float uShimmer;      // animated brightness variation (0 = off)
uniform float uMasterOpacity;

varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying float vWallV; // 1 at the top (surface) edge, 0 at the sea bed

#ifdef OCEAN_SECTION
varying float vSectionDist;
#endif

#ifdef OCEAN_FENCE
// x: 1 while the cut is live, 0 to pass everything; y: +1 normally, -1 to keep only
// what the fence removed.
uniform vec2 fenceParams;
uniform sampler2D fenceMap;
uniform mat3 fenceToUv;   // object XZ -> uv
uniform vec2 fenceSize;   // grid size in texels
varying vec2 vObjectXZ;
#include ../../../sdk/materials/shaderLib/fence-field.glsl
#endif

#include <common>
#include <logdepthbuf_pars_fragment>
#include ./ocean-body.glsl

#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

void main() {
  #ifdef OCEAN_SECTION
  if(vSectionDist > 0.0)
    discard;
  #endif

  #ifdef OCEAN_FENCE
  if(fenceParams.x > 0.5 && fenceParams.y * fenceSide(fenceMap, fenceToUv, fenceSize, vObjectXZ) < 0.0)
    discard;
  #endif

  #include <logdepthbuf_fragment>

  float dist = length(vViewPosition);

  // Exponential fog build-up with view distance through the water.
  float fog = 1.0 - exp(-dist * uFogDensity);

  // Tint shifts from the shallow toward the deep colour as the body deepens.
  vec3 color = mix(uShallowColor, uDeepColor, clamp(fog, 0.0, 1.0));

  // Animated underwater light play (see ocean-body.glsl). Replaces the old axis-aligned
  // product-of-sines, which read as a flat, blocky pulsing grid.
  // ⚠️ Outward-facing side only. Caustics are light LANDING on a surface, and the
  // inner face of a wall is not one — it stands in for the body of water, so light
  // play painted on it reads as a texture on a pane of glass. Doing this properly
  // means marching the volume, which is a long way past what this material is.
  if(uShimmer > 0.0 && gl_FrontFacing) {
    color = oceanBodyLight(color, vWorldPosition, vWallV, uTime, uShimmer, uShallowColor);
  }

  float alpha = clamp(fog * uMaxOpacity, 0.0, 1.0) * uMasterOpacity;

  gl_FragColor = vec4(color, alpha);

  #include <colorspace_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
