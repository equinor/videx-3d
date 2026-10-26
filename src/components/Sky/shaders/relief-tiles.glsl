// A stage's relief drawn from tiles (RELIEF_TILES): the height and the normal under a
// pixel, from the tile it lies on. Stands in for relief.glsl's map in relief-fragment.glsl.

uniform highp sampler2DArray uReliefTileHeights;
uniform highp sampler2DArray uReliefTileNormals;
uniform float uReliefTileNodes;
uniform float uReliefTileCells;
// 1 while the camera is under the ground where it is (SkyBoxStageReliefTiles).
uniform float uReliefCameraUnder;

varying vec2 vReliefTileNode;
flat varying float vReliefTileSlot;
flat varying vec3 vReliefTileSquare;
varying float vReliefSkirt;
varying float vReliefSkirtTop;

// The height at `node` of the tile's texel grid: bilinear between the four nodes around it
// (32-bit floats, which are not filtered).
float reliefTileHeightAt(vec2 node) {
  vec2 texel = clamp(node - 0.5, vec2(0.0), vec2(uReliefTileNodes - 1.001));
  ivec2 base = ivec2(floor(texel));
  vec2 f = texel - vec2(base);
  int slot = int(vReliefTileSlot + 0.5);
  float h00 = texelFetch(uReliefTileHeights, ivec3(base, slot), 0).r;
  float h10 = texelFetch(uReliefTileHeights, ivec3(base + ivec2(1, 0), slot), 0).r;
  float h01 = texelFetch(uReliefTileHeights, ivec3(base + ivec2(0, 1), slot), 0).r;
  float h11 = texelFetch(uReliefTileHeights, ivec3(base + ivec2(1, 1), slot), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

// The height at this pixel.
float reliefTileHeight() {
  return reliefTileHeightAt(vReliefTileNode);
}

// The width of the tile's cells.
float reliefTileCell() {
  return vReliefTileSquare.z / uReliefTileCells;
}

// Whether the tile has ground at or above the sea at world X/Z `xz`: false off the tile.
bool reliefTileClearsAt(vec2 xz) {
  vec2 node = (xz - vReliefTileSquare.xy) / vReliefTileSquare.z * uReliefTileCells + 1.5;
  if(any(lessThan(node, vec2(1.5))) || any(greaterThan(node, vec2(uReliefTileCells + 1.5))))
    return false;
  return reliefTileHeightAt(node) >= 0.0;
}

// A skirt only closes a crack seen from above the ground. From under the ground the tiles'
// tops face away, and a skirt would show as a line on the void's lid — but not where the
// ground lies deeper than the camera (a trench seen from the void), whose top it sees.
// Whether the camera stands over the ground cannot be told from the skirt alone: in a
// fjord the crack up a cliff lies above it.
bool reliefTileSkirtHidden() {
  return uReliefCameraUnder > 0.5 && vReliefSkirt > 0.0 && globeHeight(cameraPosition) < vReliefSkirtTop;
}

// The stage's area (SkyBoxStage `bounds`), min X/Z and max X/Z.
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

// The normal at this pixel, in the world.
vec3 reliefTileNormal() {
  vec2 n = texture(uReliefTileNormals, vec3(vReliefTileNode / uReliefTileNodes, vReliefTileSlot)).rg;
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
uniform highp sampler2DArray uReliefTileLayers;
uniform float uReliefTileRoot;

vec3 reliefDebugHue(float t) {
  return clamp(abs(fract(t + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

// The debug view (SkyBoxStageDebug.relief) over the shaded `color`.
vec3 reliefTileDebug(vec3 color) {
  #ifdef RELIEF_DEBUG_TILES
  // By the tile's depth, its border a line a pixel or two wide.
  float depth = log2(uReliefTileRoot / vReliefTileSquare.z);
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
