// Ocean water-body (volume) fragment shader.
//
// Shades the box side walls, both faces, as a tinted water body: the further a wall fragment
// is from the camera, the denser the tint between the camera and it, like an exponential fog.
// This gives the "inside a water body" feel when the camera is within the box, and a tinted
// body seen through the walls from outside, without a separate fullscreen pass. Its colour is
// the water's own (WaterBody: its optics), lit at the wall's depth, so the walls match the
// surface. From in the water, the walls show the water from the camera to them by its optics
// instead: the line to the wall the camera sees runs all in the water, so it holds for any
// outline. Animated caustic light play near the surface breaks up the flat tint.
//
// OIT-compatible: includes the shared oit.glsl chunk and routes its final colour
// through oitProcess() so it composites with the surface and subsurface geometry.

uniform float uTime;
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

  float dist = length(vViewPosition);

  // Exponential fog build-up with view distance through the water.
  float fog = 1.0 - exp(-dist * uFogDensity);

  // The water's own colour, lit at the wall's depth, as seen looking along the view.
  vec3 up = uWaterBody.xyz;
  float depth = clamp(uWaterBody.w - dot(vWorldPosition, up), 0.0, uWaterBodyFloor.x);
  vec3 extinction = uWaterBodyExtinction;
  vec3 light = waterFogLight(waterLitDepth(depth, extinction), extinction, uWaterBodyFloor.y);
  vec3 color = uWaterBodyColor * light * waterGlow(dot(normalize(vWorldPosition - cameraPosition), up));

  // Animated underwater light play (see ocean-body.glsl).
  // ⚠️ Outward-facing side only. Caustics are light LANDING on a surface, and the
  // inner face of a wall is not one — it stands in for the body of water, so light
  // play painted on it reads as a texture on a pane of glass. Doing this properly
  // means marching the volume, which is a long way past what this material is.
  if(uShimmer > 0.0 && gl_FrontFacing)
    color = oceanBodyLight(color, vWorldPosition, vWallV, uTime, uShimmer, uWaterBodyColor * WATER_GLOW * WATER_GLOW);

  float alpha = clamp(fog * uMaxOpacity, 0.0, 1.0);

  // From in the water, the water between the camera and the wall, as what lies in it fades
  // (waterBodyFog): its part of the line, under the surface and over the seabed. ⚠️ A wall
  // seen past a notch of a concave outline counts the notch's air too.
  if(waterBodyCameraIn()) {
    float floorDepth = waterBodyFloorAt(vWorldPosition);
    float wallDepth = clamp(uWaterBody.w - dot(vWorldPosition, up), 0.0, floorDepth);
    float path = waterBodyPath(vWorldPosition, floorDepth);
    vec4 layer = waterFogOver(vec4(0.0), path, extinction, uWaterBodyColor, waterBodyLight(vWorldPosition, wallDepth, floorDepth, path), waterBodyFacing(vWorldPosition));
    // As colour and opacity, its colour no brighter than 1 (as the surface's, oceanStraight).
    alpha = clamp(max(layer.a, max(layer.r, max(layer.g, layer.b))), 1e-3, 1.0);
    color = layer.rgb / alpha;
  }

  gl_FragColor = vec4(color, alpha * uMasterOpacity);

  #include <colorspace_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
