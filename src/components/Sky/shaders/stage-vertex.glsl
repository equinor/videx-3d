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
#ifdef STAGE_BAND
attribute float fade;
// How far the occupant's seabed rises above the band here, in world units.
attribute float slack;
varying float vStageFade;
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
  #ifdef STAGE_BAND
  vStageFade = fade;
  // It lies on the occupant's own seabed: pulled toward the camera along the view ray,
  // which changes its depth and nothing else.
  vec3 toCamera = cameraPosition - world.xyz;
  float range = length(toCamera);
  vec3 toward = toCamera / max(range, 1e-6);
  // A gap of `slack` under the occupant's seabed is slack / sin(angle) along the view ray.
  float grazing = max(abs(dot(toward, normalize(mat3(modelMatrix) * normal))), 0.02);
  float pull = max(range * 2e-3, 1.0) + slack / grazing;
  world.xyz += toward * min(pull, range * 0.5);
  #endif
  // As the water body's vertex shader orders it: its walls are drawn over these at equal depth.
  vec4 view = viewMatrix * world;
  vViewPosition = -view.xyz;
  gl_Position = projectionMatrix * view;
  #include <logdepthbuf_vertex>
}
