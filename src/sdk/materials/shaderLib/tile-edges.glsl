// A tile's surface toward its edges and corners where a tile drawn coarser touches it:
// blended toward its parent's surface, which meets that tile exactly, as tiles at one depth
// meet each other (tileCoarserEdges, tileEdgeWeight in sdk/tiles/tile-edges.ts). Its edge
// mask's bits (TILE_EDGE): 1 west, 2 east, 4 north, 8 south; 16, 32, 64, 128 the north-west,
// north-east, south-west and south-east corners; 256 an odd column, 512 an odd row.

// Cells into the tile it blends over (TILE_EDGE_BAND).
#define TILE_EDGE_BAND 4.0

// How much of its parent's surface the tile takes at `t` across it (0…1 east and south):
// all on a marked edge or corner, none past TILE_EDGE_BAND of its `cells`, eased between;
// from a corner, the larger distance along the axes.
float tileEdgeWeight(float mask, vec2 t, float cells) {
  int m = int(mask + 0.5);
  if((m & 255) == 0)
    return 0.0;
  vec2 a = t * cells;
  vec2 b = (1.0 - t) * cells;
  float d = 1e9;
  if((m & 1) != 0)
    d = min(d, a.x);
  if((m & 2) != 0)
    d = min(d, b.x);
  if((m & 4) != 0)
    d = min(d, a.y);
  if((m & 8) != 0)
    d = min(d, b.y);
  if((m & 16) != 0)
    d = min(d, max(a.x, a.y));
  if((m & 32) != 0)
    d = min(d, max(b.x, a.y));
  if((m & 64) != 0)
    d = min(d, max(a.x, b.y));
  if((m & 128) != 0)
    d = min(d, max(b.x, b.y));
  return 1.0 - smoothstep(0.0, TILE_EDGE_BAND, d);
}

// `t` across the tile, across its parent: by the quarter of it the tile is.
vec2 tileEdgeParentAt(float mask, vec2 t) {
  int m = int(mask + 0.5);
  return (vec2((m & 256) != 0 ? 1.0 : 0.0, (m & 512) != 0 ? 1.0 : 0.0) + t) * 0.5;
}
