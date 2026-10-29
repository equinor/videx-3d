// A relief read from its tiles through an index (SceneryReliefAtlas), per pixel: the
// minimap's map and the stage's overview past its tiles. The tiles are the stage's own
// (buildGeoReliefTile: the layers merged over the base, in longitude and latitude), so all
// three draw the same ground, whatever the number of layers, and only the tiles in view are
// ever read. Positions are the index's: degrees east and south of its origin.

// Per slot, a tile's heights (metres over the sea), its normals' east and south (half
// floats, filtered) and, per node, 1 + the layer that gave it (0 the base), over its
// (cells + 3)² nodes: its own and a border of one.
uniform highp sampler2DArray uReliefAtlasHeights;
uniform highp sampler2DArray uReliefAtlasNormals;
uniform highp sampler2DArray uReliefAtlasLayers;
// Per entry: its tile's min X, min Z (east and south of the origin), width and slot (below 0: none).
uniform highp sampler2D uReliefAtlasIndex;
// x, y: the index's min corner; z: an entry's width; w: cells along a tile's side.
uniform vec4 uReliefAtlasRegion;
// The height where no tile is yet, metres over the sea (the tiles' base).
uniform float uReliefBase;

// The ground at `p`: x its height over the sea, bilinear between the tile's nodes; y how
// much of it a layer gave (0 over the base); z the look of the layer that gave the nearest
// node (0 for the relief's own, 1 + i for its layer i's); w the tile's cell in degrees, 0
// where no tile is.
vec4 reliefAtlasGround(vec2 p) {
  vec4 none = vec4(uReliefBase, 0.0, 0.0, 0.0);
  ivec2 size = textureSize(uReliefAtlasIndex, 0);
  ivec2 entry = ivec2(floor((p - uReliefAtlasRegion.xy) / uReliefAtlasRegion.z));
  if(any(lessThan(entry, ivec2(0))) || any(greaterThanEqual(entry, size)))
    return none;
  vec4 tile = texelFetch(uReliefAtlasIndex, entry, 0);
  if(tile.w < 0.0)
    return none;
  float cells = uReliefAtlasRegion.w;
  vec2 f = clamp((p - tile.xy) / tile.z * cells, 0.0, cells);
  vec2 c = min(floor(f), vec2(cells - 1.0));
  vec2 t = f - c;
  // Past the border of one.
  ivec3 n = ivec3(ivec2(c) + 1, int(tile.w + 0.5));
  ivec3 nx = n + ivec3(1, 0, 0);
  ivec3 ny = n + ivec3(0, 1, 0);
  ivec3 nxy = n + ivec3(1, 1, 0);
  float height = mix(mix(texelFetch(uReliefAtlasHeights, n, 0).r, texelFetch(uReliefAtlasHeights, nx, 0).r, t.x), mix(texelFetch(uReliefAtlasHeights, ny, 0).r, texelFetch(uReliefAtlasHeights, nxy, 0).r, t.x), t.y);
  vec4 layer = floor(vec4(texelFetch(uReliefAtlasLayers, n, 0).r, texelFetch(uReliefAtlasLayers, nx, 0).r, texelFetch(uReliefAtlasLayers, ny, 0).r, texelFetch(uReliefAtlasLayers, nxy, 0).r) * 255.0 + 0.5);
  vec4 given = step(0.5, layer);
  float cover = mix(mix(given.x, given.y, t.x), mix(given.z, given.w, t.x), t.y);
  vec2 near = step(0.5, t);
  float look = mix(mix(layer.x, layer.y, near.x), mix(layer.z, layer.w, near.x), near.y);
  return vec4(height, cover, look, tile.z / cells);
}

// The ground's normal at `p`, filtered between the tile's nodes as the stage shades it: x
// east, y up, z south; straight up where no tile is.
vec3 reliefAtlasNormal(vec2 p) {
  ivec2 size = textureSize(uReliefAtlasIndex, 0);
  ivec2 entry = ivec2(floor((p - uReliefAtlasRegion.xy) / uReliefAtlasRegion.z));
  if(any(lessThan(entry, ivec2(0))) || any(greaterThanEqual(entry, size)))
    return vec3(0.0, 1.0, 0.0);
  vec4 tile = texelFetch(uReliefAtlasIndex, entry, 0);
  if(tile.w < 0.0)
    return vec3(0.0, 1.0, 0.0);
  float cells = uReliefAtlasRegion.w;
  vec2 f = clamp((p - tile.xy) / tile.z * cells, 0.0, cells);
  // Past the border of one, at the node's texel centre.
  vec2 uv = (f + 1.5) / (cells + 3.0);
  vec2 xz = texture(uReliefAtlasNormals, vec3(uv, tile.w)).rg;
  return vec3(xz.x, sqrt(max(1.0 - dot(xz, xz), 0.0)), xz.y);
}
