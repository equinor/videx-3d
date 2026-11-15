// Ocean water-body (volume) vertex shader.
//
// Renders the side walls of an ocean box so the interior reads as a tinted
// water body. World + view position are passed through for the depth-based fog
// tint in the fragment shader.
//
// When vertex displacement is enabled, the wall's TOP ring follows the same
// wave height as the ocean surface (seaHeight in sea-layers.glsl), tapered to
// zero at the sea bed via the unit-relative vertical coordinate (1 at the top
// edge, 0 at the bottom), so the rim stays sealed against the displaced surface.
// Evaluated in WORLD space so it is seamless with the surface.
//
// That coordinate is `uv.y` on the ocean builders' geometry, whose uv spans the
// wall. A chunk's interval wall carries a METRIC uv instead (arc length and world
// height, which is what anchors patterns in world space), so it supplies the same
// quantity as its own `wallV` attribute: OCEAN_WALL_ATTRIBUTE switches to that
// rather than renormalising a uv that has another job.

// The last of the sea's layers the surface is displaced by: the longest two.
#ifndef SEA_DISPLACE_LAST
#define SEA_DISPLACE_LAST 1
#endif

#ifdef OCEAN_WALL_ATTRIBUTE
attribute float wallV;
#endif

uniform float uDisplacement; // 0 = flat top edge, 1 = full swell height

varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying float vWallV; // 1 at the top (surface) edge, 0 at the sea bed

#ifdef OCEAN_SECTION
uniform vec4 sectionPlane;
varying float vSectionDist;
#endif

#ifdef OCEAN_FENCE
// OBJECT XZ, undisplaced — the fence's field is in the stack's own frame.
varying vec2 vObjectXZ;
#endif

#include <common>
#include <logdepthbuf_pars_vertex>
#include ./sea-layers.glsl
#include ../../../sdk/materials/shaderLib/water-body.glsl

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);

  #ifdef OCEAN_SECTION
  vSectionDist = dot(sectionPlane.xyz, position) + sectionPlane.w;
  #endif

  #ifdef OCEAN_FENCE
  vObjectXZ = position.xz;
  #endif

  #ifdef OCEAN_WALL_ATTRIBUTE
  float wallHeight = wallV;
  #else
  float wallHeight = uv.y;
  #endif

  vWallV = wallHeight;

  // Displace the top ring (wallHeight = 1) to follow the surface swells, tapering
  // to the anchored sea bed (0). Uses the SAME height as the surface shader
  // (seaHeight in sea-layers.glsl, by the same depth's factors) so the wall top
  // resolves to the identical world position as the surface edge — keeping the rim sealed.
  if(uDisplacement > 0.0 && wallHeight > 0.0) {
    float limit;
    vec4 shallow = seaShallowFactors(waterBodyFloorAt(vec3(worldPos.x, uWaterBody.w, worldPos.z)), limit);
    worldPos.y += uDisplacement * seaHeight(worldPos.xz, SEA_DISPLACE_LAST, shallow) * wallHeight;
  }

  vWorldPosition = worldPos.xyz;

  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;

  gl_Position = projectionMatrix * mvPosition;

  #include <logdepthbuf_vertex>
}
