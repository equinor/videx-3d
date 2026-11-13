// Ocean water-body (volume) fragment shader.
//
// Shades the box side walls as the water along the sight line
// (water-body.glsl's waterBodyLayer, one model with the sea's): the longer the line runs below
// the surface, the more of the water's own light it shows. This gives the "inside a water body"
// feel when the camera is within the box, and the body seen through the (transparent) surface
// from outside, without a separate fullscreen pass. Animated caustic light play near the
// surface breaks up the flat tint.
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
#include ../../../sdk/materials/shaderLib/water-body.glsl

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

  // The water behind the wall along the sight line (waterBodyLayer): one model with the sea's.
  // A wall facing out has none in front of it: what lies behind it fades by its own path.
  // The glass part (OCEAN_WALL_GLASS, the outer faces drawn last) carries only the light play.
  vec4 layer = vec4(0.0);
  #ifndef OCEAN_WALL_GLASS
  layer = waterBodyLayer(vWorldPosition);
  #endif

  // Animated underwater light play (see ocean-body.glsl): light in the water just behind the
  // glass, added over what shows through, so it neither tints nor hides it.
  // ⚠️ Only on the glass the sight line enters the water by, seen from outside: never on the
  // walls across the box or from inside. A wall's inner face stands in for the body of water,
  // so light play painted on it reads as a texture on a pane of glass. Doing this properly
  // means marching the volume, which is a long way past what this material is.
  #ifndef OCEAN_WALL_WATER
  if(uShimmer > 0.0) {
    float glass = gl_FrontFacing && !waterBodyCameraIn() ? 1.0 : 0.0;
    // Lit as the water looking up, where the light comes from.
    vec3 light = uWaterBodyColor * WATER_GLOW * WATER_GLOW;
    layer.rgb += oceanBodyLight(vec3(0.0), vWorldPosition, vWallV, uTime, uShimmer * glass, light);
  }
  #endif

  #ifdef OCEAN_WALL_GLASS
  if(max(layer.r, max(layer.g, layer.b)) < 1e-4)
    discard;
  #endif

  // As colour and opacity, its colour no brighter than 1 (as the surface's, oceanStraight).
  float coverage = clamp(max(layer.a, max(layer.r, max(layer.g, layer.b))), 1e-3, 1.0);
  vec3 color = layer.rgb / coverage;
  float alpha = coverage * uMasterOpacity;

  gl_FragColor = vec4(color, alpha);

  #include <colorspace_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
