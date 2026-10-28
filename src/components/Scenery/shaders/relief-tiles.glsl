// A stage's relief drawn from tiles (RELIEF_TILES): the height and the normal under a
// pixel, from the tile it lies on. Stands in for relief.glsl's map in relief-fragment.glsl.

uniform highp sampler2DArray uReliefTileHeights;
uniform highp sampler2DArray uReliefTileNormals;
uniform float uReliefTileNodes;
uniform float uReliefTileCells;

varying vec2 vReliefTileNode;
flat varying float vReliefTileSlot;
flat varying vec2 vReliefTileLongitude;
flat varying vec3 vReliefTileLatitude;
flat varying vec2 vReliefTileDepthCell;
// The tile it blends from (TileTransitions): where it lies there and that tile's slot (-1
// for none), and how far it is from that tile's look (0) to its own (1).
flat varying vec4 vReliefTileFrom;
flat varying float vReliefTileBlend;
varying vec3 vReliefEast;
flat varying float vReliefSkirt;

// The height at `node` of the texel grid of the tile in `slot`: bilinear between the four
// nodes around it (32-bit floats, which are not filtered).
float reliefTileHeightIn(int slot, vec2 node) {
  vec2 texel = clamp(node - 0.5, vec2(0.0), vec2(uReliefTileNodes - 1.001));
  ivec2 base = ivec2(floor(texel));
  vec2 f = texel - vec2(base);
  float h00 = texelFetch(uReliefTileHeights, ivec3(base, slot), 0).r;
  float h10 = texelFetch(uReliefTileHeights, ivec3(base + ivec2(1, 0), slot), 0).r;
  float h01 = texelFetch(uReliefTileHeights, ivec3(base + ivec2(0, 1), slot), 0).r;
  float h11 = texelFetch(uReliefTileHeights, ivec3(base + ivec2(1, 1), slot), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

// Whether the tile is blending from another (see vReliefTileFrom).
bool reliefTileBlending() {
  return vReliefTileBlend < 1.0 && vReliefTileFrom.w >= 0.0;
}

// The node of the tile it blends from at `node` of its own grid.
vec2 reliefTileFromNode(vec2 node) {
  vec2 t = (node - 1.5) / uReliefTileCells;
  return (vReliefTileFrom.xy + t * vReliefTileFrom.z) * uReliefTileCells + 1.5;
}

// The height at `node` of the tile's texel grid, blended from the tile it replaces while
// it does.
float reliefTileHeightAt(vec2 node) {
  float height = reliefTileHeightIn(int(vReliefTileSlot + 0.5), node);
  if(reliefTileBlending())
    height = mix(reliefTileHeightIn(int(vReliefTileFrom.w + 0.5), reliefTileFromNode(node)), height, vReliefTileBlend);
  return height;
}

// The height at this pixel.
float reliefTileHeight() {
  return reliefTileHeightAt(vReliefTileNode);
}

// The width of the tile's cells along a meridian.
float reliefTileCell() {
  return vReliefTileDepthCell.y;
}

// Per node, 1 + the layer that gave most of it, or 0 for the base (sky-relief-tiles.ts).
uniform highp sampler2DArray uReliefTileLayers;

// The layer that gave the nearest node: 1 + its place among the relief's, or 0 for the base.
int reliefTileLayer() {
  return int(texelFetch(uReliefTileLayers, ivec3(ivec2(vReliefTileNode), int(vReliefTileSlot + 0.5)), 0).r * 255.0 + 0.5);
}

// The ground under `p` as the tile holds it: 1 at or above the sea, 0 below it, -1 off the
// tile. Its latitude found along the tile's quadratic rows (geoTileLatitudeAt) by a
// Newton step from the linear guess, so the coast falls where the tile draws it.
float reliefTileGroundAt(vec3 p) {
  vec2 offset = globeSphereOffset(p);
  vec3 chi = vReliefTileLatitude;
  float span = chi.z - chi.x;
  float t = (offset.x - chi.x) / span;
  // d/dt of the quadratic through the three, at t.
  float slope = chi.x * (4.0 * t - 3.0) + chi.y * (4.0 - 8.0 * t) + chi.z * (4.0 * t - 1.0);
  float at = chi.x * (1.0 - t) * (1.0 - 2.0 * t) + chi.y * 4.0 * t * (1.0 - t) + chi.z * t * (2.0 * t - 1.0);
  t -= (at - offset.x) / (abs(slope) > 1e-12 ? slope : span);
  vec2 along = vec2((offset.y - vReliefTileLongitude.x) / (vReliefTileLongitude.y - vReliefTileLongitude.x), t);
  vec2 node = along * uReliefTileCells + 1.5;
  if(any(lessThan(node, vec2(1.5))) || any(greaterThan(node, vec2(uReliefTileCells + 1.5))))
    return -1.0;
  return reliefTileHeightAt(node) >= 0.0 ? 1.0 : 0.0;
}

// The stage's area (SceneryStage `bounds`), min X/Z and max X/Z.
uniform vec4 uReliefStage;

// Whether this pixel is the other draw's: with a see-through seabed, the opaque tiles leave
// the stage's area to the see-through draw, which keeps it alone — without skirts, as two
// see-through skirts over each other would show as a line.
bool reliefTileLeftToOther(vec2 xz) {
  bool inside = all(greaterThanEqual(xz, uReliefStage.xy)) && all(lessThan(xz, uReliefStage.zw));
  #if defined(RELIEF_STAGE_AROUND)
  return inside;
  #elif defined(RELIEF_SEE_THROUGH)
  return !inside || vReliefSkirt > 0.0;
  #else
  return false;
  #endif
}

// The normal at this pixel, along true east (x), up (y) and true south (z) where its node
// lies on the globe; blended from the tile it replaces while it does.
vec3 reliefTileNormal() {
  vec2 n = texture(uReliefTileNormals, vec3(vReliefTileNode / uReliefTileNodes, vReliefTileSlot)).rg;
  if(reliefTileBlending()) {
    vec2 from = texture(uReliefTileNormals, vec3(reliefTileFromNode(vReliefTileNode) / uReliefTileNodes, vReliefTileFrom.w)).rg;
    n = mix(from, n, vReliefTileBlend);
  }
  return normalize(vec3(n.x, sqrt(max(1.0 - dot(n, n), 0.0)), n.y));
}

#ifdef RELIEF_OCCUPANTS
// The stage's occupants' outlines (SkyReliefOccupantFields): per occupant a square of
// texels, side by side, its signed distance, positive inside.
uniform highp sampler2D uReliefOccupantFields;
// Per occupant: X/Z of its square's min corner, and a texel's width.
uniform vec3 uReliefOccupantFrames[RELIEF_OCCUPANTS];

// Occupant `i`'s outline at X/Z: positive inside. Bilinear between the texels about it,
// each clamped to its square, as `sampleFieldMap` reads a field, so a straight edge is
// found exactly. Its square's border lies outside it.
float reliefOccupantOutline(int i, vec2 xz) {
  vec3 frame = uReliefOccupantFrames[i];
  int size = textureSize(uReliefOccupantFields, 0).y;
  vec2 texel = (xz - frame.xy) / frame.z - 0.5;
  vec2 base = floor(texel);
  vec2 f = texel - base;
  ivec2 b = ivec2(base);
  ivec2 hi = ivec2(size - 1);
  ivec2 slot = ivec2(i * size, 0);
  float s00 = texelFetch(uReliefOccupantFields, clamp(b, ivec2(0), hi) + slot, 0).r;
  float s10 = texelFetch(uReliefOccupantFields, clamp(b + ivec2(1, 0), ivec2(0), hi) + slot, 0).r;
  float s01 = texelFetch(uReliefOccupantFields, clamp(b + ivec2(0, 1), ivec2(0), hi) + slot, 0).r;
  float s11 = texelFetch(uReliefOccupantFields, clamp(b + ivec2(1, 1), ivec2(0), hi) + slot, 0).r;
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

// Whether X/Z lies on an occupant: there the cutaway takes the water, not the ground, as
// it does over an occupant's own seabed.
bool reliefOnOccupant(vec2 xz) {
  #if RELIEF_OCCUPANTS == 1
  return reliefOccupantOutline(0, xz) > 0.0;
  #else
  for(int i = 0; i < RELIEF_OCCUPANTS; i++) {
    if(reliefOccupantOutline(i, xz) > 0.0)
      return true;
  }
  return false;
  #endif
}
#endif

#ifdef RELIEF_CUT_OCCUPANT
// Where the ground lies, the curve's drop left out: the frame the occupant's cut is in.
varying vec3 vReliefFlat;
#ifdef RELIEF_OCCUPANT_SECTION
uniform vec4 sectionPlane; // the half-space it points at is cut away
#endif
#ifdef RELIEF_OCCUPANT_FENCE
uniform vec2 fenceParams; // x: 1 while the cut is live, y: +1 keeps the block
uniform sampler2D fenceMap;
uniform mat3 fenceToUv;
uniform vec2 fenceSize;
#include ../../../sdk/materials/shaderLib/fence-field.glsl
#endif
#endif

// Cut away with the occupant RELIEF_CUT_OCCUPANT, by its section and its fence, as it cuts
// itself, but only inside its outline.
bool reliefCutAway() {
  #ifdef RELIEF_CUT_OCCUPANT
  if(reliefOccupantOutline(RELIEF_CUT_OCCUPANT, vReliefFlat.xz) <= 0.0)
    return false;
  #ifdef RELIEF_OCCUPANT_SECTION
  if(dot(sectionPlane.xyz, vReliefFlat) + sectionPlane.w > 0.0)
    return true;
  #endif
  #ifdef RELIEF_OCCUPANT_FENCE
  if(fenceParams.x > 0.5 && fenceParams.y * fenceSide(fenceMap, fenceToUv, fenceSize, vReliefFlat.xz) < 0.0)
    return true;
  #endif
  #endif
  return false;
}

#if defined(RELIEF_DEBUG_TILES) || defined(RELIEF_DEBUG_LAYERS)
vec3 reliefDebugHue(float t) {
  return clamp(abs(fract(t + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

// The debug view (SceneryStageDebug.relief) over the shaded `color`.
vec3 reliefTileDebug(vec3 color) {
  #ifdef RELIEF_DEBUG_TILES
  // By the tile's depth, its border a line a pixel or two wide.
  float depth = vReliefTileDepthCell.x;
  vec3 tint = reliefDebugHue(depth * 0.13);
  vec2 cell = vReliefTileNode - 1.5;
  vec2 edge = min(cell, uReliefTileCells - cell) / max(fwidth(cell), vec2(1e-6));
  float line = 1.0 - smoothstep(0.5, 1.5, min(edge.x, edge.y));
  return mix(mix(color, tint * 0.5, 0.6), vec3(1.0), line);
  #else
  // By the layer that gave the nearest node: grey for the base, where none did.
  float id = texelFetch(uReliefTileLayers, ivec3(ivec2(vReliefTileNode), int(vReliefTileSlot + 0.5)), 0).r * 255.0;
  vec3 tint = id < 0.5 ? vec3(0.25) : reliefDebugHue(id * 0.27);
  return mix(color, tint * 0.5, 0.6);
  #endif
}
#endif
