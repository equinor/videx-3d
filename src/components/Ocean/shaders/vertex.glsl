// Ocean surface vertex shader.
//
// The visible wave shape at oilfield scale comes almost entirely from the
// fragment shader's per-pixel normals (a single wave is sub-pixel to a few
// pixels across when the field spans tens of kilometres). Actual vertex
// displacement is therefore OFF by default (uDisplacement = 0): it only becomes
// perceptible when the camera is very close to the surface, and even then only
// the longest, lowest-frequency swells are displaced. Its purpose is to support
// floating objects that need to follow the real surface height.
//
// Displacement (when enabled) is evaluated in WORLD space so it is seamless
// across tiled/patched geometry.

#ifndef OCEAN_WAVE_COUNT
#define OCEAN_WAVE_COUNT 16
#endif
#ifndef OCEAN_DISPLACE_COUNT
#define OCEAN_DISPLACE_COUNT 3
#endif

uniform float uTime;
uniform float uSteepness; // Gerstner choppiness for the displaced swells
uniform float uDisplacement; // 0 = off (normals only), 1 = full swell height

varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec2 vUv;
// Undisplaced world X/Z of this vertex. The fragment shader evaluates the wave
// field (and foam/tonal/ripples) here rather than at the displaced world
// position: the horizontal Gerstner displacement, linearly interpolated across
// each triangle, otherwise warps the sampling coordinate into a regular
// vertex-grid moiré (a lens/polka-dot pattern). When displacement is off this
// equals vWorldPosition.xz, so the default look is unchanged.
varying vec2 vSurfaceXZ;

#include <common>
#include <logdepthbuf_pars_vertex>
#include ./waves.glsl

void main() {
  vUv = uv;

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vSurfaceXZ = worldPos.xz; // capture before displacement

  if(uDisplacement > 0.0) {
    // Shared displacement (see oceanDisplacement in waves.glsl): the horizontal
    // Gerstner orbit is proportional to each swell's own amplitude (flattened by
    // uSteepness) so it stays in proportion with the height and can never fold.
    // The water-body wall top uses the SAME helper, so the surface edge and wall
    // rim stay sealed together.
    vec3 disp = oceanDisplacement(worldPos.xz, uTime, uSteepness, uDisplacement, OCEAN_DISPLACE_COUNT);
    worldPos.xyz += disp;
  }

  vWorldPosition = worldPos.xyz;

  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;

  gl_Position = projectionMatrix * mvPosition;

  #include <logdepthbuf_vertex>
}
