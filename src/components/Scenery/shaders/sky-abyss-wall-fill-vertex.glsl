// A quad the void walls' fill is drawn on as geometry (SceneryAbyssWallLayer, `flat` debug view):
// on the plane they are cut along, or on the lid, placed by its model matrix.

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vSkyAbyssWallFill;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vSkyAbyssWallFill = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  // ⚠️ Far off, clip z rounds past w in fp32 and clips vertices at random (relief-vertex.glsl).
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-7));
  #include <logdepthbuf_vertex>
}
