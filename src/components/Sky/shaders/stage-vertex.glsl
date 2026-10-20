// A stage's real geometry: surface, seabed or wall.

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vStageWorld;
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;
#ifdef STAGE_WALL
// Scene Y of the seabed at the foot of this stretch of wall.
attribute float bedY;
varying float vStageBedY;
// 1 at the surface, 0 at the foot.
varying float vStageWallV;
#endif
#ifdef STAGE_RELIEF
varying vec3 vStageNormal;
#endif

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vStageWorld = world.xyz;
  #ifdef STAGE_WALL
  vStageBedY = bedY;
  vStageWallV = uv.y;
  #endif
  #ifdef STAGE_RELIEF
  vStageNormal = normalize(mat3(modelMatrix) * normal);
  #endif
  // As the water body's vertex shader orders it: its walls are drawn over these at equal depth.
  vec4 view = viewMatrix * world;
  vViewPosition = -view.xyz;
  gl_Position = projectionMatrix * view;
  #include <logdepthbuf_vertex>
}
