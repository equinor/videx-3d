// The relief a stage draws, read where something lies on it (GeoTileLayer's drape,
// GeoTubes): its heights' texture array and its tiles' cells (SceneryReliefDrawn), and a
// height on a tile's triangles as the relief's patch draws them.

uniform highp sampler2DArray uReliefTileHeights;
uniform float uReliefTileCells;

// The height at `at` (node coordinates, 0…cells) of the relief's tile in `slot`, on its
// triangles (diagonals from node (i + 1, j) to (i, j + 1)): the relief's own
// reliefTileTriangleHeight.
float geoTileReliefHeight(int slot, vec2 at) {
  vec2 cell = clamp(floor(at), vec2(0.0), vec2(uReliefTileCells - 1.0));
  vec2 f = at - cell;
  ivec2 base = ivec2(cell) + 1;
  float h10 = texelFetch(uReliefTileHeights, ivec3(base + ivec2(1, 0), slot), 0).r;
  float h01 = texelFetch(uReliefTileHeights, ivec3(base + ivec2(0, 1), slot), 0).r;
  bool lower = f.x + f.y <= 1.0;
  float corner = texelFetch(uReliefTileHeights, ivec3(base + (lower ? ivec2(0) : ivec2(1)), slot), 0).r;
  vec2 g = lower ? f : 1.0 - f;
  return corner + g.x * ((lower ? h10 : h01) - corner) + g.y * ((lower ? h01 : h10) - corner);
}

// The ground as the relief draws it at `uv` (0…1 east and south) across its tile `own`
// (its slot in w; -1: none, `fallback`), blending from where that lies in the tile it
// replaces (`from`: its corner and scale there, its slot in w) by `blend`, as the relief's
// soft swaps do.
float geoTileReliefGround(vec4 own, vec4 from, float blend, vec2 uv, float fallback) {
  if(own.w < 0.0)
    return fallback;
  float height = geoTileReliefHeight(int(own.w + 0.5), (own.xy + uv * own.z) * uReliefTileCells);
  if(blend < 1.0 && from.w >= 0.0) {
    float source = geoTileReliefHeight(int(from.w + 0.5), (from.xy + uv * from.z) * uReliefTileCells);
    height = mix(source, height, blend);
  }
  return height;
}
