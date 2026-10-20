// A stage's real geometry: surface or seabed.

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vStageWorld;
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;
#ifdef STAGE_RELIEF
varying vec3 vStageNormal;
#endif

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vStageWorld = world.xyz;
  #ifdef STAGE_RELIEF
  vStageNormal = normalize(mat3(modelMatrix) * normal);
  #endif
  vec4 view = viewMatrix * world;
  vViewPosition = -view.xyz;
  gl_Position = projectionMatrix * view;
  #include <logdepthbuf_vertex>
}
