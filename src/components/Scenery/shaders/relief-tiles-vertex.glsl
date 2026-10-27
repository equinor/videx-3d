// A stage's relief drawn from geographic tiles (SceneryStage `relief.layers`): one patch per
// tile, its heights read at its nodes from the tiles' texture array, a skirt down from each
// side closing the cracks between tiles at different depths, each node placed on the globe
// where its latitude and longitude lie (globeGeodetic): flat over the disc about the scene,
// the sphere beyond, the far side of the Earth too.
// ⚠️ Assumes the default `up` (+Y), as the stage does.

#include <common>
#include <logdepthbuf_pars_vertex>
#include ../../../sdk/materials/shaderLib/globe.glsl

uniform float uSkyOceanLevel;

uniform highp sampler2DArray uReliefTileHeights;
uniform float uReliefTileCells;

attribute float reliefSkirt; // 1 on a skirt's lower edge
// The tile on the conformal sphere, from the disc's centre (Globe.sphereOffset): its west
// and east edges' longitude, its depth and its slot; and its north edge's, middle's and
// south edge's latitude.
attribute vec4 reliefTile;
attribute vec3 reliefTileChi;
attribute float reliefTileSkirt; // how far its skirt drops

varying vec3 vReliefWorld;
varying vec2 vReliefPlane;
// Up and true east where the vertex lies on the globe, for the fragment's normal.
varying vec3 vReliefUp;
varying vec3 vReliefEast;
// The node in the tile's texel grid (its border counted), and its slot.
varying vec2 vReliefTileNode;
flat varying float vReliefTileSlot;
// The tile on the sphere: its west edge's and east edge's longitude, and its north edge's,
// middle's and south edge's latitude (the attributes').
flat varying vec2 vReliefTileLongitude;
flat varying vec3 vReliefTileLatitude;
// Its depth, and its cells' width along a meridian.
flat varying vec2 vReliefTileDepthCell;
// 1 on a skirt, 0 on the grid: flat, from a triangle's last vertex (the provoking vertex in
// WebGL 2), which the patch's index order makes a skirt's lower edge on every skirt's
// triangle and a grid node on every other (createSceneryReliefTilePatch). Interpolated, a
// skirt seen edge-on, a sliver under a pixel, is sampled past its edge, where the value
// falls to 0 and below.
flat varying float vReliefSkirt;
#ifdef RELIEF_CUT_OCCUPANT
// Where the ground lies, the curve's drop left out: the frame an occupant's cut is in.
varying vec3 vReliefFlat;
#endif
#ifdef USE_OIT
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;
#endif

// A latitude along the tile, `t` from its north edge (0) to its south edge (1): the
// quadratic through its three, which neighbours along an edge share.
float reliefTileLatitudeAt(vec3 chi, float t) {
  return chi.x * (1.0 - t) * (1.0 - 2.0 * t) + chi.y * 4.0 * t * (1.0 - t) + chi.z * t * (2.0 * t - 1.0);
}

void main() {
  ivec2 node = ivec2(position.xz + 0.5) + 1;
  float height = texelFetch(uReliefTileHeights, ivec3(node, int(reliefTile.w + 0.5)), 0).r;
  height -= reliefSkirt * reliefTileSkirt;
  vec2 t = position.xz / uReliefTileCells;
  vec2 offset = vec2(reliefTileLatitudeAt(reliefTileChi, t.y), mix(reliefTile.x, reliefTile.y, t.x));

  // Heights from the sea's level, which is the globe's.
  vec3 world = globeGeodetic(offset, height);
  vReliefWorld = world;
  // Over the disc, where occupants and the stage lie, the plane's X/Z.
  vReliefPlane = world.xz;
  vec3 up = globeUpAt(world);
  vReliefUp = up;
  vec3 east = globeGeodeticEast(offset);
  vReliefEast = normalize(east - up * dot(east, up));
  vReliefTileNode = position.xz + 1.5;
  vReliefTileSlot = reliefTile.w;
  vReliefTileLongitude = reliefTile.xy;
  vReliefTileLatitude = reliefTileChi;
  vReliefTileDepthCell = vec2(reliefTile.z, abs(reliefTileChi.z - reliefTileChi.x) * uGlobe.x / uReliefTileCells);
  vReliefSkirt = reliefSkirt;
  #ifdef RELIEF_CUT_OCCUPANT
  vReliefFlat = vec3(world.x, uSkyOceanLevel + height, world.z);
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
