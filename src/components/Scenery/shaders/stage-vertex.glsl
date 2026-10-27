// A stage's real geometry: surface or seabed.

#include <common>
#include <logdepthbuf_pars_vertex>
#include ../../../sdk/materials/shaderLib/globe.glsl

varying vec3 vStageWorld;
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;

// The planes only carry fragments: stage-fragment shades the view ray, not the plane. Far
// off, where the globe has fallen away below the scene's level, a level's plane would lie
// over the camera; there a vertex sinks to the plane touching its level under the camera,
// which lies over all of that level on the globe, so every ray reaching it crosses the stage
// first. Over the disc that plane is the level, and the stage stays as it is.
vec3 stageSink(vec3 world) {
  vec3 under = globeFoot(cameraPosition);
  vec3 across = under - uGlobeDisc.xyz;
  if(!globeOn() || dot(across, across) <= uGlobe.z)
    return world;
  under = globePlace(under.xz, dot(world - uGlobeDisc.xyz, uGlobeUp));
  vec3 up = globeUpAt(under);
  float over = dot(world - under, up);
  return over > 0.0 ? world - uGlobeUp * (over / dot(uGlobeUp, up)) : world;
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.xyz = stageSink(world.xyz);
  vStageWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vViewPosition = -view.xyz;
  gl_Position = projectionMatrix * view;
  // ⚠️ Its planes reach thousands of km: there clip z rounds past w in fp32 and clips at random.
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-7));
  #include <logdepthbuf_vertex>
}
