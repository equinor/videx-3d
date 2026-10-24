// The void's walls (SkyAbyssWalls) as a mesh: one fixed grid round their outline and down
// from the lid (createSkyAbyssWallGeometry), each vertex holding its column and row and
// pushed out to the rock's face (skyAbyssWallVertex). Coarse: the finer relief is the
// fragment shader's, from the cliffs' normal map.
// ⚠️ Assumes the default `up` (+Y), as the stage does.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform vec3 uSkyUp;
uniform vec3 uSkyEast;
uniform vec3 uSkyNorth;
uniform float uSkyAbyssLevel;
#include ./sky-abyss-wall-shape.glsl

varying vec3 vSkyAbyssWall; // world
varying vec3 vSkyAbyssWallNormal; // facing the hollow
varying vec2 vSkyAbyssWallOutward; // out of the outline, in the stage's plane
varying vec4 vSkyAbyssWallAt; // the way round (to whole tiles of the relief), the depth below the lid, how far out of the walls' middle, and the share of the way round

void main() {
  vec2 ij = position.xy;
  float rows = uSkyAbyssWallGrid.y;
  vec4 vertex = skyAbyssWallVertex(ij);
  // Facing as the mesh lies, across its neighbours: round x down points out of the hollow,
  // as east = north x up (compassBasis).
  vec3 along = skyAbyssWallVertex(ij + vec2(1.0, 0.0)).xyz - skyAbyssWallVertex(ij - vec2(1.0, 0.0)).xyz;
  vec3 down = skyAbyssWallVertex(vec2(ij.x, min(ij.y + 1.0, rows))).xyz - skyAbyssWallVertex(vec2(ij.x, max(ij.y - 1.0, 0.0))).xyz;
  vSkyAbyssWallNormal = -normalize(cross(along, down));

  float lap = skyAbyssWallLap();
  float s = ij.x / uSkyAbyssWallGrid.x * lap;
  float tile = uSkyAbyssWalls.w * SKY_ABYSS_CLIFF_TILE / SKY_ABYSS_RELIEF_REPEAT;
  // Not wrapped: the last column runs on to a whole number of tiles, not back to 0. The share
  // runs on to 1, which the sand's waves, whole numbers of them round, take as 0.
  vSkyAbyssWallAt = vec4(s / lap * max(floor(lap / tile + 0.5), 1.0) * tile, skyAbyssWallRowDepth(ij.y), vertex.w, s / lap);
  s = mod(s, lap);
  vSkyAbyssWallOutward = skyAbyssWallOutline(s, 1.0) - skyAbyssWallOutline(s, 0.0);
  vSkyAbyssWall = vertex.xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vertex.xyz, 1.0);
  // ⚠️ Far off, clip z rounds past w in fp32 and clips vertices at random (relief-vertex.glsl).
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-7));
  #include <logdepthbuf_vertex>
}
