// A geographic tile layer (GeoTileLayer): one patch per square drawn — a tile, or the part
// of it over a finer tile of the relief — each node placed on the globe where its latitude
// and longitude lie (globeGeodetic): flat at `uGeoTileHeight` over the sea's level, or,
// draped (GEO_TILE_DRAPE), on the relief's tile drawn under it, on its triangles as the
// relief draws them, through its soft swaps too. Then drawn toward the camera by a lift, so
// the surface it lies on does not cut through it: a move of the vertex, not a depth bias,
// so it holds with any depth buffer — linear, logarithmic or reversed.
// ⚠️ Assumes the default `up` (+Y).

#include <common>
#include <logdepthbuf_pars_vertex>
#include ../../../sdk/materials/shaderLib/globe.glsl
#include ../../../sdk/materials/shaderLib/geo-tile.glsl

uniform float uGeoTileCells;
uniform float uGeoTileHeight;
uniform float uGeoTileSize;
// How far toward the camera it is drawn: in world units, and per world unit of distance.
uniform vec2 uGeoTileLift;

// The square (geoTileOffsets): its west and east edges' longitude, its tile's blend from
// the tile it replaces (TileTransitions: 0 that tile's look, 1 its own) and its tile's slot;
// and its north edge's, middle's and south edge's latitude.
attribute vec4 layerTile;
attribute vec3 layerTileChi;
// Where it lies in its tile's data, and in the data of the tile that blends from (with that
// tile's slot, -1 for none): tileOffsetIn.
attribute vec3 layerTileUv;
attribute vec4 layerTileFrom;

#ifdef GEO_TILE_DRAPE
#include ./relief-tile-height.glsl
// Where it lies in the relief's tile drawn under it, and that tile's slot (-1: flat); where
// it lies in the tile that one blends from, and its slot; and that blend.
attribute vec4 layerTileRelief;
attribute vec4 layerTileReliefFrom;
attribute float layerTileReliefBlend;
#endif

// Across its tile's data, and across the data of the tile it blends from.
varying vec2 vGeoTileUv;
varying vec2 vGeoTileFromUv;
flat varying float vGeoTileSlot;
flat varying float vGeoTileBlend;
flat varying float vGeoTileFromSlot;
// A texel's width along a meridian, in metres: of its tile, and of the tile it blends from.
flat varying vec2 vGeoTileTexelMetres;
#ifdef GEO_TILE_WATER
// Where it lies, before the lift, and its height over the sea.
varying vec3 vGeoTileWorld;
varying float vGeoTileGround;
#endif
#ifdef USE_OIT
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;
#endif

void main() {
  vec2 t = position.xz / uGeoTileCells;
  float height = uGeoTileHeight;
  #ifdef GEO_TILE_DRAPE
  height = geoTileReliefGround(layerTileRelief, layerTileReliefFrom, layerTileReliefBlend, t, height);
  #endif
  vec3 world = globeGeodetic(geoTileOffset(layerTile.xy, layerTileChi, t), height);
  #ifdef GEO_TILE_WATER
  vGeoTileWorld = world;
  vGeoTileGround = height;
  #endif
  vec3 toCamera = cameraPosition - world;
  float away = max(length(toCamera), 1e-6);
  // Never as far as the camera: half the way at the most.
  float lift = min(uGeoTileLift.x + uGeoTileLift.y * away, 0.5 * away);
  world += toCamera / away * lift;

  vGeoTileUv = layerTileUv.xy + t * layerTileUv.z;
  vGeoTileFromUv = layerTileFrom.xy + t * layerTileFrom.z;
  vGeoTileSlot = layerTile.w;
  vGeoTileBlend = layerTile.z;
  vGeoTileFromSlot = layerTileFrom.w;
  // The square's span along a meridian, over the part of each tile's data it holds.
  float span = abs(layerTileChi.z - layerTileChi.x) * uGlobe.x;
  vGeoTileTexelMetres = span / uGeoTileSize / vec2(layerTileUv.z, max(layerTileFrom.z, 1e-9));

  vec4 view = viewMatrix * vec4(world, 1.0);
  #ifdef USE_OIT
  vViewPosition = -view.xyz;
  #endif
  gl_Position = projectionMatrix * view;
  // ⚠️ Far off, clip z rounds past w in fp32 and clips vertices at random (as the relief's).
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-7));
  #include <logdepthbuf_vertex>
}
