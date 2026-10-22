// A stage's relief (SkyBoxStage `relief`): one patch of a grid per node the level of detail
// picks (selectTerrainNodes), morphing into its parent's grid toward the end of its range
// so neighbouring levels meet without cracks, and falling away with the Earth's curve
// beyond the disc about the scene the sea stays flat over, as the sea does (skyOceanReach).
// ⚠️ Assumes the default `up` (+Y), as the stage does.

#include <common>
#include <logdepthbuf_pars_vertex>
#include ./relief.glsl

uniform float uSkyOceanLevel;
uniform float uSkyOceanDepth;
uniform float uSkyCurvature;
uniform vec4 uSkyFlat;

uniform float uReliefCells; // the cells along a patch's side
uniform vec2 uReliefMorph[RELIEF_LEVELS]; // per level, the distances it starts and ends morphing over
uniform float uReliefDy; // how far the camera is above or below every height the relief holds

attribute vec4 reliefNode; // the node's min X/Z, its size and its level

varying vec3 vReliefWorld;
varying vec2 vReliefPlane;

void main() {
  float cell = reliefNode.z / uReliefCells;
  vec2 grid = position.xz * uReliefCells;
  vec2 xz = reliefNode.xy + grid * cell;
  vec2 morph = uReliefMorph[int(reliefNode.w + 0.5)];
  vec2 away = xz - cameraPosition.xz;
  float dist = sqrt(dot(away, away) + uReliefDy * uReliefDy);
  float k = clamp((dist - morph.x) / max(morph.y - morph.x, 1e-6), 0.0, 1.0);
  grid -= fract(grid * 0.5) * 2.0 * k;
  xz = reliefNode.xy + grid * cell;

  // Read as coarsely as the grid it morphs into, so a vertex shared with a coarser
  // neighbour gets that neighbour's height.
  float spacing = cell * (1.0 + k);
  float lod = clamp(log2(spacing / uReliefMapFrame.z), 0.0, uReliefMapFrame.w);
  vec2 ground = reliefGround(xz, lod, 1.5 * spacing, -uSkyOceanDepth);

  float drop = 0.0;
  if(uSkyCurvature > 0.0) {
    vec2 level = xz - cameraPosition.xz;
    float run = length(level);
    if(run > 1e-3) {
      float inner = uSkyFlat.w - dot(cameraPosition.xz - uSkyFlat.xz, level / run);
      float past = max(run - inner, 0.0);
      drop = 0.5 * uSkyCurvature * past * past;
    }
  }

  vec3 world = vec3(xz.x, uSkyOceanLevel + ground.x - drop, xz.y);
  vReliefWorld = world;
  vReliefPlane = xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
