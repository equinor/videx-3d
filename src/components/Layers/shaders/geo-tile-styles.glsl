// Each feature's style, by its id, for a geographic tile layer's sampling (GeoTileStyles:
// `texels` RGBA floats a feature, rows of uGeoTileStylesWidth), and the id a tile stores
// in its G and B channels (the high and low byte of id + 1; 0 for none).

uniform highp sampler2D uGeoTileStyles;
uniform float uGeoTileStylesWidth;

vec4 geoTileStyle(int index) {
  int width = int(uGeoTileStylesWidth);
  return texelFetch(uGeoTileStyles, ivec2(index % width, index / width), 0);
}

// The feature over `uv` in the tile in `slot`, -1 for none.
int geoTileId(float slot, vec2 uv) {
  vec4 ids = geoTileFetch(slot, uv);
  return int(ids.g * 255.0 + 0.5) * 256 + int(ids.b * 255.0 + 0.5) - 1;
}
