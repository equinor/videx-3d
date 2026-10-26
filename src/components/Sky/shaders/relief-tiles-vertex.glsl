// A stage's relief drawn from tiles (SkyBoxStage `relief.layers`): one patch per tile,
// its heights read at its nodes from the tiles' texture array, a skirt down from each
// side closing the cracks between tiles at different depths, and placed on the globe
// (globePlace) as the sea is: flat over the disc about the scene, the sphere beyond.
// ⚠️ Assumes the default `up` (+Y), as the stage does.

#include <common>
#include <logdepthbuf_pars_vertex>
#include ../../../sdk/materials/shaderLib/globe.glsl

uniform float uSkyOceanLevel;

uniform highp sampler2DArray uReliefTileHeights;
uniform float uReliefTileCells;

attribute float reliefSkirt; // 1 on a skirt's lower edge
attribute vec4 reliefTile; // the tile's min X/Z, its width and its slot
attribute float reliefTileSkirt; // how far its skirt drops

varying vec3 vReliefWorld;
varying vec2 vReliefPlane;
// The node in the tile's texel grid (its border counted), and its slot.
varying vec2 vReliefTileNode;
flat varying float vReliefTileSlot;
// The tile's min X/Z and width.
flat varying vec3 vReliefTileSquare;
// Above 0 on a skirt, and the world height of the tile's edge it hangs from.
varying float vReliefSkirt;
varying float vReliefSkirtTop;
#ifdef RELIEF_CUT_OCCUPANT
// Where the ground lies, the curve's drop left out: the frame an occupant's cut is in.
varying vec3 vReliefFlat;
#endif
#ifdef USE_OIT
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;
#endif

void main() {
  ivec2 node = ivec2(position.xz + 0.5) + 1;
  float height = texelFetch(uReliefTileHeights, ivec3(node, int(reliefTile.w + 0.5)), 0).r;
  float top = height;
  height -= reliefSkirt * reliefTileSkirt;
  vec2 xz = reliefTile.xy + position.xz / uReliefTileCells * reliefTile.z;

  // Heights from the sea's level, which is the globe's.
  vec3 world = globePlace(xz, height);
  vReliefWorld = world;
  vReliefPlane = xz;
  vReliefTileNode = position.xz + 1.5;
  vReliefTileSlot = reliefTile.w;
  vReliefTileSquare = reliefTile.xyz;
  vReliefSkirt = reliefSkirt;
  vReliefSkirtTop = uSkyOceanLevel + top;
  #ifdef RELIEF_CUT_OCCUPANT
  vReliefFlat = vec3(xz.x, uSkyOceanLevel + height, xz.y);
  #endif
  vec4 view = viewMatrix * vec4(world, 1.0);
  #ifdef USE_OIT
  vViewPosition = -view.xyz;
  #endif
  gl_Position = projectionMatrix * view;
  // ⚠️ Far off, clip z rounds past w in fp32 (a near plane of centimetres, a far one of
  // thousands of km) and clips vertices at random; a logarithmic depth is the fragment's own.
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-7));
  #include <logdepthbuf_vertex>
}
