// GeoPolygons' sampling (see geo-tile-fragment.glsl): polygons from the tile's distance
// field (buildOverlayTile) — the fill's edge and an outline inside it of a width in pixels,
// sharp at any zoom — coloured by the polygon on top, each one's fill and outline (two
// texels) from the styles.

#include ./geo-tile-styles.glsl

// How many texels the distance spans; the outline's width, in pixels.
uniform float uGeoPolygonBand;
uniform float uGeoPolygonStrokeWidth;

// ⚠️ Its derivatives (fwidth) need the same call for the whole primitive: branch only on
// what is flat per tile.
vec4 geoTileSample(float slot, vec2 uv, float texelMetres) {
  float d = (geoTileRead(slot, uv).r * 255.0 - 128.0) / 127.0 * uGeoPolygonBand;
  // Texels a pixel spans here.
  float perPixel = max(fwidth(d), 1e-4);
  float pixels = d / perPixel;
  float covered = clamp(pixels + 0.5, 0.0, 1.0);
  int id = geoTileId(slot, uv);
  if(id < 0 || covered <= 0.0)
    return vec4(0.0);
  vec4 fill = geoTileStyle(2 * id);
  vec4 stroke = geoTileStyle(2 * id + 1);

  // The outline: inside the edge, `uGeoPolygonStrokeWidth` pixels wide.
  float s = clamp(uGeoPolygonStrokeWidth - pixels + 0.5, 0.0, 1.0) * stroke.a;
  float alpha = s + fill.a * (1.0 - s);
  vec3 rgb = mix(fill.rgb, stroke.rgb, s / max(alpha, 1e-4));
  alpha *= covered;
  return vec4(rgb * alpha, alpha);
}
