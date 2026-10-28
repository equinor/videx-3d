// An overlay's tiles (GeoPolygons): one flat patch per geographic tile, each node placed on
// the globe where its latitude and longitude lie (globeGeodetic), `uOverlayHeight` over
// the sea's level, then drawn toward the camera by a lift, so the surface it lies on — the
// sea, a flat seabed — does not cut through it. A move of the vertex, not a depth bias,
// so it holds with any depth buffer: linear, logarithmic or reversed.
// ⚠️ Assumes the default `up` (+Y).

#include <common>
#include <logdepthbuf_pars_vertex>
#include ../../../sdk/materials/shaderLib/globe.glsl
#include ../../../sdk/materials/shaderLib/geo-tile.glsl

uniform float uOverlayCells;
uniform float uOverlayHeight;
// How far toward the camera it is drawn: in world units, and per world unit of distance.
uniform vec2 uOverlayLift;

// The tile (geoTileOffsets): its west and east edges' longitude, its blend from the tile it
// replaces (TileTransitions: 0 that tile's look, 1 its own) and its slot; and its north
// edge's, middle's and south edge's latitude.
attribute vec4 overlayTile;
attribute vec3 overlayTileChi;
// Where it lies in the tile it blends from (tileOffsetIn), and that tile's slot: -1 for none.
attribute vec4 overlayFrom;

// Across the tile, 0…1 east and south.
varying vec2 vOverlayUv;
flat varying float vOverlaySlot;
flat varying float vOverlayBlend;
flat varying vec4 vOverlayFrom;

void main() {
  vec2 t = position.xz / uOverlayCells;
  vec3 world = globeGeodetic(geoTileOffset(overlayTile.xy, overlayTileChi, t), uOverlayHeight);
  vec3 toCamera = cameraPosition - world;
  float away = max(length(toCamera), 1e-6);
  // Never as far as the camera: half the way at the most.
  float lift = min(uOverlayLift.x + uOverlayLift.y * away, 0.5 * away);
  world += toCamera / away * lift;
  vOverlayUv = t;
  vOverlaySlot = overlayTile.w;
  vOverlayBlend = overlayTile.z;
  vOverlayFrom = overlayFrom;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  // ⚠️ Far off, clip z rounds past w in fp32 and clips vertices at random (as the relief's).
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-7));
  #include <logdepthbuf_vertex>
}
