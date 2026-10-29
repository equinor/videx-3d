// A stage's relief drawn from geographic tiles (SceneryStage `relief.layers`): one patch per
// tile, its heights read at its nodes from the tiles' texture array, a skirt down from each
// side closing the cracks between tiles at different depths, each node placed on the globe
// where its latitude and longitude lie (globeGeodetic): flat over the disc about the scene,
// the sphere beyond, the far side of the Earth too.
// ⚠️ Assumes the default `up` (+Y), as the stage does.

#include <common>
#include <logdepthbuf_pars_vertex>
#include ../../../sdk/materials/shaderLib/globe.glsl
#include ../../../sdk/materials/shaderLib/geo-tile.glsl

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
// The tile it blends from (TileTransitions): where it lies there (tileOffsetIn) and that
// tile's slot, -1 for none; and how far it is from that tile's look (0) to its own (1).
attribute vec4 reliefTileFrom;
attribute float reliefTileBlend;

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
flat varying vec4 vReliefTileFrom;
flat varying float vReliefTileBlend;
// 1 on a skirt, 0 on the grid: flat, from a triangle's last vertex (the provoking vertex in
// WebGL 2), which the patch's index order makes a skirt's lower edge on every skirt's
// triangle and a grid node on every other (createSceneryReliefTilePatch). Interpolated, a
// skirt seen edge-on, a sliver under a pixel, is sampled past its edge, where the value
// falls to 0 and below.
flat varying float vReliefSkirt;
// The height the vertex lies at, metres over the sea: on a skirt, down from the tile's edge.
varying float vReliefHeight;
#ifdef RELIEF_CUT_OCCUPANT
// Where the ground lies, the curve's drop left out: the frame an occupant's cut is in.
varying vec3 vReliefFlat;
#endif
#ifdef USE_OIT
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;
#endif

// The height at `at` (node coordinates, 0…cells) of the tile in `slot`, on its triangles as
// the patch draws them (diagonals from node (i + 1, j) to (i, j + 1)): where a tile blending
// from it starts, exactly on what it drew.
float reliefTileTriangleHeight(int slot, vec2 at) {
  vec2 cell = clamp(floor(at), vec2(0.0), vec2(uReliefTileCells - 1.0));
  vec2 f = at - cell;
  ivec2 base = ivec2(cell) + 1;
  float h10 = texelFetch(uReliefTileHeights, ivec3(base + ivec2(1, 0), slot), 0).r;
  float h01 = texelFetch(uReliefTileHeights, ivec3(base + ivec2(0, 1), slot), 0).r;
  // The lower triangle's corner (i, j), or the upper's (i + 1, j + 1), measured from it.
  bool lower = f.x + f.y <= 1.0;
  float corner = texelFetch(uReliefTileHeights, ivec3(base + (lower ? ivec2(0) : ivec2(1)), slot), 0).r;
  vec2 g = lower ? f : 1.0 - f;
  return corner + g.x * ((lower ? h10 : h01) - corner) + g.y * ((lower ? h01 : h10) - corner);
}

void main() {
  ivec2 node = ivec2(position.xz + 0.5) + 1;
  float height = texelFetch(uReliefTileHeights, ivec3(node, int(reliefTile.w + 0.5)), 0).r;
  vec2 t = position.xz / uReliefTileCells;
  // A soft swap: from the surface of the tile it replaces, at the same place (a geomorph).
  if(reliefTileBlend < 1.0 && reliefTileFrom.w >= 0.0) {
    float from = reliefTileTriangleHeight(int(reliefTileFrom.w + 0.5), geoTileFrom(reliefTileFrom.xyz, t) * uReliefTileCells);
    height = mix(from, height, reliefTileBlend);
  }
  height -= reliefSkirt * reliefTileSkirt;
  vec2 offset = geoTileOffset(reliefTile.xy, reliefTileChi, t);

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
  vReliefTileFrom = reliefTileFrom;
  vReliefTileBlend = reliefTileBlend;
  vReliefSkirt = reliefSkirt;
  vReliefHeight = height;
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
