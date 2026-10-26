// A stage's real geometry: surface or seabed.

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vStageWorld;
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vStageWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vViewPosition = -view.xyz;
  gl_Position = projectionMatrix * view;
  // ⚠️ Its planes reach thousands of km: there clip z rounds past w in fp32 and clips at random.
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-7));
  #include <logdepthbuf_vertex>
}
