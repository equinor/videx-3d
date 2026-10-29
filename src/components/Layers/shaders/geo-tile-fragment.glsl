// A geographic tile layer (GeoTileLayer): each pixel's colour from the layer's own sampling
// (GEO_TILE_SAMPLE_CHUNK, put in by createGeoTileMaterial: `vec4 geoTileSample(float slot,
// vec2 uv, float texelMetres)`, premultiplied). While a tile replaces another
// (TileTransitions), the other's look at the same place is mixed in: a soft swap between
// levels of detail, nothing drawn twice. With GEO_TILE_WATER it is seen through the sea as
// the seabed under it is (the relief's own water: relief-fragment.glsl), and wired for the
// OITRenderPass.

#include <common>
#include <logdepthbuf_pars_fragment>
#ifdef GEO_TILE_WATER
#include ../../Scenery/shaders/sky.glsl
#include ./geo-water.glsl
#endif
#ifdef USE_OIT
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

uniform highp sampler2DArray uGeoTiles;
// Texels along a tile's side, its border aside.
uniform float uGeoTileSize;
// The whole layer's opacity.
uniform float uGeoTileOpacity;

varying vec2 vGeoTileUv;
varying vec2 vGeoTileFromUv;
flat varying float vGeoTileSlot;
flat varying float vGeoTileBlend;
flat varying float vGeoTileFromSlot;
flat varying vec2 vGeoTileTexelMetres;
#ifdef GEO_TILE_WATER
varying vec3 vGeoTileWorld;
varying float vGeoTileGround;
#endif

// Where `uv` across a tile lies in its texels, its border counted: a texel's middle at
// (i + 0.5, j + 0.5).
vec2 geoTileTexel(vec2 uv) {
  return uv * uGeoTileSize + 1.0;
}

// The tile in `slot`'s texels at `uv`, filtered as the layer's format is.
vec4 geoTileRead(float slot, vec2 uv) {
  return texture(uGeoTiles, vec3(geoTileTexel(uv) / (uGeoTileSize + 2.0), slot));
}

// The texel of the tile in `slot` under `uv`, unfiltered.
vec4 geoTileFetch(float slot, vec2 uv) {
  ivec2 node = clamp(ivec2(geoTileTexel(uv)), ivec2(0), ivec2(int(uGeoTileSize) + 1));
  return texelFetch(uGeoTiles, ivec3(node, int(slot + 0.5)), 0);
}

GEO_TILE_SAMPLE_CHUNK

void main() {
  #include <logdepthbuf_fragment>
  vec4 color = geoTileSample(vGeoTileSlot, vGeoTileUv, vGeoTileTexelMetres.x);
  if(vGeoTileBlend < 1.0) {
    // The look it replaces: its source's at this place, or nothing (a fade-in).
    vec4 from = vGeoTileFromSlot >= 0.0 ? geoTileSample(vGeoTileFromSlot, vGeoTileFromUv, vGeoTileTexelMetres.y) : vec4(0.0);
    color = mix(from, color, vGeoTileBlend);
  }
  float alpha = color.a * uGeoTileOpacity;
  if(alpha <= 0.0)
    discard;
  vec3 rgb = color.rgb / max(color.a, 1e-4);
  #ifdef GEO_TILE_WATER
  rgb = geoThroughWater(rgb, alpha, vGeoTileWorld, vGeoTileGround);
  if(alpha <= 0.0)
    discard;
  #endif
  gl_FragColor = vec4(rgb, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
