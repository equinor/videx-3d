// An overlay's tiles (GeoPolygons): polygons from the tile's distance field (buildOverlayTile)
// — the fill's edge and an outline inside it of a width in pixels, sharp at any zoom —
// coloured by the shape on top, each shape's fill and outline from the styles' texture.
// While a tile replaces another (TileTransitions), the other's look at the same place is
// mixed in: a soft swap between levels of detail, nothing drawn twice.

#include <common>
#include <logdepthbuf_pars_fragment>
#include ../../../sdk/materials/shaderLib/geo-tile.glsl

uniform highp sampler2DArray uOverlayTiles;
// Texels along a tile's side (its border aside), and how many texels its distance spans.
uniform float uOverlaySize;
uniform float uOverlayBand;
// Two texels per shape, by its id: its fill, then its outline (linear RGB, alpha).
uniform highp sampler2D uOverlayStyles;
uniform float uOverlayStylesWidth;
// The outline's width, in pixels; the layer's opacity.
uniform float uOverlayStrokeWidth;
uniform float uOverlayOpacity;

varying vec2 vOverlayUv;
flat varying float vOverlaySlot;
flat varying float vOverlayBlend;
flat varying vec4 vOverlayFrom;

vec4 overlayStyle(int index) {
  int width = int(uOverlayStylesWidth);
  return texelFetch(uOverlayStyles, ivec2(index % width, index / width), 0);
}

// The polygons' colour at `uv` across the tile in `slot`, premultiplied: nothing outside them.
// ⚠️ Its derivatives (fwidth) need the same call for the whole primitive: branch only on
// what is flat per tile.
vec4 overlaySample(float slot, vec2 uv) {
  // In the tile's texels, its border counted: a texel's middle at (i + 0.5, j + 0.5).
  vec2 texel = uv * uOverlaySize + 1.0;
  vec3 at = vec3(texel / (uOverlaySize + 2.0), slot);
  float d = (texture(uOverlayTiles, at).r * 255.0 - 128.0) / 127.0 * uOverlayBand;
  // Texels a pixel spans here.
  float perPixel = max(fwidth(d), 1e-4);
  float pixels = d / perPixel;
  float covered = clamp(pixels + 0.5, 0.0, 1.0);

  ivec2 node = clamp(ivec2(texel), ivec2(0), ivec2(int(uOverlaySize) + 1));
  vec4 ids = texelFetch(uOverlayTiles, ivec3(node, int(slot + 0.5)), 0);
  int id = int(ids.g * 255.0 + 0.5) * 256 + int(ids.b * 255.0 + 0.5) - 1;
  if(id < 0 || covered <= 0.0) return vec4(0.0);
  vec4 fill = overlayStyle(2 * id);
  vec4 stroke = overlayStyle(2 * id + 1);

  // The outline: inside the edge, `uOverlayStrokeWidth` pixels wide.
  float s = clamp(uOverlayStrokeWidth - pixels + 0.5, 0.0, 1.0) * stroke.a;
  float alpha = s + fill.a * (1.0 - s);
  vec3 rgb = mix(fill.rgb, stroke.rgb, s / max(alpha, 1e-4));
  alpha *= covered;
  return vec4(rgb * alpha, alpha);
}

void main() {
  #include <logdepthbuf_fragment>
  vec4 color = overlaySample(vOverlaySlot, vOverlayUv);
  if(vOverlayBlend < 1.0) {
    // The look it replaces: its source's at this place, or nothing (a fade-in).
    vec4 from = vOverlayFrom.w >= 0.0
      ? overlaySample(vOverlayFrom.w, geoTileFrom(vOverlayFrom.xyz, vOverlayUv))
      : vec4(0.0);
    color = mix(from, color, vOverlayBlend);
  }
  float alpha = color.a * uOverlayOpacity;
  if(alpha <= 0.0) discard;
  gl_FragColor = vec4(color.rgb / max(color.a, 1e-4), alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
