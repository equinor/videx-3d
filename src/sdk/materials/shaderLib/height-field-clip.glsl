// Ground drawn as a height field over a region (see `HeightFieldClip`), for whatever must
// end where it is drawn. An index over the region gives, per entry, the tile drawn there
// (its min X/Z, width and slot); the height is that of the tile's triangles, whose
// diagonals run from node (i + 1, j) to node (i, j + 1). Positions are in the consumer's
// own X/Z, heights in its Y: the frame the ground was drawn in.

// Per slot, a tile's heights over its (cells + 3)² nodes: its own and a border of one.
uniform highp sampler2DArray heightClipTiles;
// Per entry: min X, min Z, width, slot (below 0: none).
uniform highp sampler2D heightClipIndex;
// x, y: the index's min X/Z; z: an entry's width.
uniform vec4 heightClipRegion;
// x: 1 while live; y: the Y heights are measured from; z: the Y at and below which
// nothing is clipped; w: cells along a tile's side.
uniform vec4 heightClipParams;
// From the consumer's X/Z to the coordinates the tiles are squares in (see
// `heightFieldWarp`): a point and the coordinates there; their derivatives along X and Z;
// and each one's second-order terms. The identity for tiles that are squares in X/Z.
uniform mat4 heightClipWarp;

vec2 heightFieldWarp(vec2 p) {
  vec2 d = p - heightClipWarp[0].xy;
  vec3 second = vec3(d.x * d.x, d.x * d.y, d.y * d.y);
  return heightClipWarp[0].zw + vec2(dot(heightClipWarp[1].xy, d), dot(heightClipWarp[1].zw, d)) + vec2(dot(heightClipWarp[2].xyz, second), dot(heightClipWarp[3].xyz, second));
}

// The ground as drawn at `xz`; false where none is.
bool heightFieldGroundAt(vec2 xz, out float ground) {
  ground = 0.0;
  vec2 p = heightFieldWarp(xz);
  ivec2 size = textureSize(heightClipIndex, 0);
  ivec2 entry = ivec2(floor((p - heightClipRegion.xy) / heightClipRegion.z));
  if(any(lessThan(entry, ivec2(0))) || any(greaterThanEqual(entry, size)))
    return false;
  vec4 tile = texelFetch(heightClipIndex, entry, 0);
  if(tile.w < 0.0)
    return false;
  float cells = heightClipParams.w;
  vec2 f = clamp((p - tile.xy) / tile.z * cells, 0.0, cells);
  vec2 c = min(floor(f), vec2(cells - 1.0));
  vec2 t = f - c;
  // Past the border of one.
  ivec3 n = ivec3(ivec2(c) + 1, int(tile.w + 0.5));
  float h10 = texelFetch(heightClipTiles, n + ivec3(1, 0, 0), 0).r;
  float h01 = texelFetch(heightClipTiles, n + ivec3(0, 1, 0), 0).r;
  float h;
  if(t.x + t.y <= 1.0) {
    float h00 = texelFetch(heightClipTiles, n, 0).r;
    h = h00 + t.x * (h10 - h00) + t.y * (h01 - h00);
  } else {
    float h11 = texelFetch(heightClipTiles, n + ivec3(1, 1, 0), 0).r;
    h = h11 + (1.0 - t.x) * (h01 - h11) + (1.0 - t.y) * (h10 - h11);
  }
  ground = heightClipParams.y + h;
  return true;
}

// Whether `p` lies above the ground as drawn: what is clipped. Below the lowest ground,
// nothing is read.
bool heightFieldClipped(vec3 p) {
  if(heightClipParams.x < 0.5 || p.y <= heightClipParams.z)
    return false;
  float ground;
  return heightFieldGroundAt(p.xz, ground) && p.y > ground;
}
