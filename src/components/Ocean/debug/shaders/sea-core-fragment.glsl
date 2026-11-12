// The wave core's prototype surface (debug/Ocean/Sea Bench, `waves: 'core'`): the Ocean's own
// Fresnel, sky reflection and glint (ocean-surface.glsl), its normal from a SeaState's baked
// layers (SeaWaveBake) instead of the per-pixel wave sum, its warp and its ripple noise. No
// tonal patches, no foam.

#ifndef SEA_LAYERS
#define SEA_LAYERS 3
#endif

uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform float uMasterOpacity;

// Per layer: its tile's slopes, height and squared slope (SeaWaveBake).
uniform sampler2D uSeaSurface0;
uniform sampler2D uSeaSurface1;
uniform sampler2D uSeaSurface2;
#if SEA_LAYERS > 3
uniform sampler2D uSeaSurface3;
#endif
// Per layer: 1 / its tile's size, its turn (cos, sin), and its texels across.
uniform vec4 uSeaLayers[SEA_LAYERS];
// Per layer: the slope variance (both axes) of its waves, all of it, as its coarsest mip holds.
uniform float uSeaLayerVariance[SEA_LAYERS];
// Slope variance no layer draws: the waves shorter than the finest layer's, Cox and Munk's.
uniform float uSeaResidual;

varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec2 vUv;
varying vec2 vSurfaceXZ;

#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include ../../shaders/ocean-surface.glsl
#include ../../shaders/sea-hex.glsl

vec3 oceanSkyReflection(vec3 dir) {
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(uHorizonColor, uSkyColor, pow(up, 0.65));
  float sun = max(dot(dir, normalize(uSunDirection)), 0.0);
  sky += uSunColor * pow(sun, 64.0) * 0.6;
  return sky;
}

// One layer at `xz` in the wave plane, filtered to the pixel by its mips: its slope added,
// and the variance of the slopes the pixel spans. One mip for the layer, from its texels a
// pixel spans; past its coarsest, all of the layer lies below the pixel and only its variance
// is left, with no fetch (where its coarsest mip holds just that, so nothing jumps). With
// SEA_HEX the tile is read as three shifted copies blended over hexagonal cells
// (sea-hex.glsl), so it never repeats.
void seaLayer(sampler2D surfaceMap, vec4 layer, float layerVariance, int index, vec2 xz, inout vec2 slope, inout float variance) {
  // Into the layer's tile: turned back, over its size.
  vec2 uv = vec2(layer.y * xz.x + layer.z * xz.y, -layer.z * xz.x + layer.y * xz.y) * layer.x;
  vec2 dx = dFdx(uv) * layer.w;
  vec2 dy = dFdy(uv) * layer.w;
  float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
  if(lod >= log2(layer.w)) {
    variance += layerVariance;
    return;
  }
  #ifdef SEA_HEX
  vec2 o1, o2, o3;
  vec3 w;
  seaHexTiles(uv, index, o1, o2, o3, w);
  vec4 a = textureLod(surfaceMap, uv + o1, lod);
  vec4 b = textureLod(surfaceMap, uv + o2, lod);
  vec4 c = textureLod(surfaceMap, uv + o3, lod);
  float w2 = dot(w, w);
  slope += (w.x * a.xy + w.y * b.xy + w.z * c.xy) * inversesqrt(w2);
  vec3 v = max(vec3(a.w - dot(a.xy, a.xy), b.w - dot(b.xy, b.xy), c.w - dot(c.xy, c.xy)), vec3(0.0));
  variance += dot(w * w, v) / w2;
  #else
  vec4 a = textureLod(surfaceMap, uv, lod);
  slope += a.xy;
  variance += max(a.w - dot(a.xy, a.xy), 0.0);
  #endif
}

// The normal at `xz` from every layer; `rough` the slope variance (both axes) the pixel
// cannot show.
vec3 seaWaveNormal(vec2 xz, out float rough) {
  vec2 slope = vec2(0.0);
  float variance = 0.0;
  seaLayer(uSeaSurface0, uSeaLayers[0], uSeaLayerVariance[0], 0, xz, slope, variance);
  seaLayer(uSeaSurface1, uSeaLayers[1], uSeaLayerVariance[1], 1, xz, slope, variance);
  seaLayer(uSeaSurface2, uSeaLayers[2], uSeaLayerVariance[2], 2, xz, slope, variance);
  #if SEA_LAYERS > 3
  seaLayer(uSeaSurface3, uSeaLayers[3], uSeaLayerVariance[3], 3, xz, slope, variance);
  #endif
  rough = variance + uSeaResidual;
  return normalize(vec3(-slope.x, 1.0, -slope.y));
}

void main() {
  #include <logdepthbuf_fragment>

  vec2 worldXZ = vSurfaceXZ;
  float rough;
  vec3 N = seaWaveNormal(worldXZ, rough);
  bool underside = !gl_FrontFacing;
  if(underside)
    N = -N;
  vec3 V = normalize(cameraPosition - vWorldPosition);
  float ndvAA;
  float fresnel = oceanFresnel(N, V, ndvAA);
  vec3 waterColor = mix(uShallowColor, uDeepColor, clamp(ndvAA, 0.0, 1.0));
  vec3 color = oceanShade(N, V, waterColor, oceanSkyReflection(reflect(-V, N)), fresnel, 1.0, 1.0, rough);
  if(underside)
    color *= 0.25;
  float alpha = mix(uOpacity, 1.0, fresnel) * uMasterOpacity;
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));

  #include <colorspace_fragment>
  #include <fog_fragment>
}
