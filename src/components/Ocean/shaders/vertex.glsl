// Ocean surface vertex shader.
//
// The visible waves come from the fragment shader's per-pixel normals (sea-layers.glsl): at
// oilfield scale a wave is sub-pixel to a few pixels across. Actual vertex displacement is
// therefore OFF by default (uDisplacement = 0): it only shows with the camera close to the
// surface, and then only the longest layers displace, vertically. Its purpose is to let the
// surface meet floating objects, which ride the same heights (SeaState.heightAt).
//
// Displacement (when enabled) is evaluated in WORLD space so it is seamless
// across tiled/patched geometry.

// The last of the sea's layers the surface is displaced by: the longest two.
#ifndef SEA_DISPLACE_LAST
#define SEA_DISPLACE_LAST 1
#endif

uniform float uDisplacement; // 0 = off (normals only), 1 = full swell height

varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec2 vUv;
// Undisplaced world X/Z of this vertex: the fragment shader reads the waves and
// foam here rather than at the displaced world position, so the surface's
// texture stays where the waves are, however the vertices move. When
// displacement is off this equals vWorldPosition.xz.
varying vec2 vSurfaceXZ;

#if defined(OCEAN_BATHYMETRY) || defined(OCEAN_FENCE)
// OBJECT XZ, undisplaced. The bathymetry's affine and the fence's field are both
// in the stack's own frame, and a vertical exaggeration or a group offset would
// move a world-space one.
varying vec2 vObjectXZ;
#endif

#ifdef OCEAN_SECTION
// A `ChunkStack`'s section plane, in OBJECT space — the same uniform object the
// chunk materials read, so the sea is cut on exactly the same plane as the block.
// ⚠️ Taken BEFORE the wave displacement, or the cut edge would ripple.
uniform vec4 sectionPlane;
varying float vSectionDist;
#endif

#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include ./sea-layers.glsl

void main() {
  vUv = uv;

  #if defined(OCEAN_BATHYMETRY) || defined(OCEAN_FENCE)
  vObjectXZ = position.xz;
  #endif

  #ifdef OCEAN_SECTION
  vSectionDist = dot(sectionPlane.xyz, position) + sectionPlane.w;
  #endif

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vSurfaceXZ = worldPos.xz; // capture before displacement

  if(uDisplacement > 0.0)
    // The same height as the water-body wall's top ring (volume-vertex.glsl), so the rim
    // stays sealed.
    worldPos.y += uDisplacement * seaHeight(worldPos.xz, SEA_DISPLACE_LAST);

  vWorldPosition = worldPos.xyz;

  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;

  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
  #include <logdepthbuf_vertex>
}
