// The sea's layers as a surface reads them (SeaState, SeaWaveBake): uniforms and sampling,
// for the surface's fragments and for the vertices displaced with it. ocean-surface.glsl
// reads them per pixel; vertex.glsl and volume-vertex.glsl displace by the long ones.

#ifndef SEA_LAYERS
#define SEA_LAYERS 3
#endif

// Per layer: its tile, x, y the slope ∂h/∂x, ∂h/∂z, z the height (m), w |∇h|² (SeaWaveBake).
uniform sampler2D uSeaSurface0;
uniform sampler2D uSeaSurface1;
uniform sampler2D uSeaSurface2;
#if SEA_LAYERS > 3
uniform sampler2D uSeaSurface3;
#endif
// Per layer: 1 / its tile's size, its turn (cos, sin), and its texels across.
uniform vec4 uSeaLayers[SEA_LAYERS];
// Per layer: the slope variance (both axes) and height variance of its waves, all of them, as
// its coarsest mip holds them.
uniform vec2 uSeaLayerStats[SEA_LAYERS];
// Slope variance no layer draws: the waves shorter than the finest layer's (Cox and Munk's).
uniform float uSeaResidual;
// The depth waves break at, as a multiple of their significant height (sea-shallow.ts).
uniform float uSeaBreakDepth;
// The depth from which the bottom changes no layer's waves (seaDeepDepth): deeper, all 1.
uniform float uSeaDeepDepth;

#include ./sea-hex.glsl

// sea-shallow.ts's seaShoaling: how many times its deep-water height a wave of deep-water
// wavenumber `k` stands in water `depth` deep.
float seaShoaling(float k, float depth) {
  float x = max(k * depth, 1e-6);
  if(x >= 6.0)
    return 1.0;
  float kh = x / pow(tanh(pow(x, 0.75)), 2.0 / 3.0);
  float g = 2.0 * kh / sinh(2.0 * kh);
  return inversesqrt(tanh(kh) * (1.0 + g));
}

// sea-shallow.ts's seaShallowFactors: per layer (x to w, layers 0 to 3), the share of its waves'
// height and slope left in water `depth` deep, from the layers' statistics; `limit` the breaking
// limit alone, for waves shorter than any layer's (the ripples), which no bottom shoals first.
// 1 in deep water; 0 at no depth, or on land.
vec4 seaShallowFactors(float depth, out float limit) {
  limit = 0.0;
  if(!(depth > 0.0))
    return vec4(0.0);
  limit = 1.0;
  // Most of a sea: deep enough that the bottom changes nothing (seaDeepDepth).
  if(depth >= uSeaDeepDepth)
    return vec4(1.0);
  vec4 f = vec4(0.0);
  float variance = 0.0;
  for(int i = 0; i < SEA_LAYERS; i++) {
    vec2 s = uSeaLayerStats[i];
    float ks = s.y > 0.0 ? seaShoaling(sqrt(s.x / s.y), depth) : 1.0;
    // f[i] = ks, without writing a component by the loop's index, which ANGLE emulates.
    f += ks * vec4(equal(ivec4(0, 1, 2, 3), ivec4(i)));
    variance += ks * ks * s.y;
  }
  float r = 4.0 * sqrt(variance) * max(uSeaBreakDepth, 0.0) / depth;
  float r2 = r * r;
  limit = inversesqrt(sqrt(1.0 + r2 * r2));
  return f * limit;
}

// The point `p` of the wave plane in a layer's tile: turned back, over its size.
vec2 seaLayerUv(vec4 layer, vec2 p) {
  return vec2(layer.y * p.x + layer.z * p.y, -layer.z * p.x + layer.y * p.y) * layer.x;
}

// Three shifted copies of a layer (`a`, `b`, `c`, read at its hex cells' offsets) blended by the
// cells' weights `w`, variance-preserving (Σ wᵢ·xᵢ / √Σ wᵢ²): x, y its slope, z its height, w
// the slope variance the reads lost to the filter.
vec4 seaHexBlend(vec4 a, vec4 b, vec4 c, vec3 w) {
  float w2 = dot(w, w);
  vec3 mean = (w.x * a.xyz + w.y * b.xyz + w.z * c.xyz) * inversesqrt(w2);
  vec3 spread = max(vec3(a.w - dot(a.xy, a.xy), b.w - dot(b.xy, b.xy), c.w - dot(c.xy, c.xy)), vec3(0.0));
  return vec4(mean, dot(w * w, spread) / w2);
}

// A layer at tile point `uv`, read at mip `lod` as three shifted copies blended over hexagonal
// cells (sea-hex.glsl), so the tile never repeats: x, y its slope, z its height, w the slope
// variance the mip spans. Past its coarsest mip all of the layer lies below the pixel: its
// variance alone, with no fetch, where that mip holds just that, so nothing jumps. `shift`
// slides the tile under the cells, which stay put: a whole tile's shift changes nothing.
vec4 seaLayerReadShifted(sampler2D map, vec4 layer, vec2 stats, int index, vec2 uv, vec2 shift, float lod) {
  if(lod >= log2(layer.w))
    return vec4(0.0, 0.0, 0.0, stats.x);
  vec2 o1, o2, o3;
  vec3 w;
  seaHexTiles(uv, index, o1, o2, o3, w);
  uv += shift;
  return seaHexBlend(textureLod(map, uv + o1, lod), textureLod(map, uv + o2, lod), textureLod(map, uv + o3, lod), w);
}

#ifdef SEA_ANISO
// The same filtered along the pixel's footprint, `dx` and `dy` the tile point's derivatives:
// at most SEA_ANISO taps along its longer axis (the textures' anisotropy), so the waves stay
// sharp toward grazing. Each tap's second moments (w) average as the filter takes them, so
// what it loses still comes back as variance. Past the coarsest mip by the mip the filter
// reads: the longer axis over SEA_ANISO, never finer than the shorter.
vec4 seaLayerReadGrad(sampler2D map, vec4 layer, vec2 stats, int index, vec2 uv, vec2 shift, vec2 dx, vec2 dy) {
  float texels2 = layer.w * layer.w;
  float x2 = dot(dx, dx) * texels2;
  float y2 = dot(dy, dy) * texels2;
  float lod = 0.5 * log2(max(max(max(x2, y2) / (SEA_ANISO * SEA_ANISO), min(x2, y2)), 1e-8));
  if(lod >= log2(layer.w))
    return vec4(0.0, 0.0, 0.0, stats.x);
  vec2 o1, o2, o3;
  vec3 w;
  seaHexTiles(uv, index, o1, o2, o3, w);
  uv += shift;
  return seaHexBlend(textureGrad(map, uv + o1, dx, dy), textureGrad(map, uv + o2, dx, dy), textureGrad(map, uv + o3, dx, dy), w);
}
#endif

vec4 seaLayerRead(sampler2D map, vec4 layer, vec2 stats, int index, vec2 uv, float lod) {
  return seaLayerReadShifted(map, layer, stats, index, uv, vec2(0.0), lod);
}

// The sea's height at `p` of the wave plane from its layers up to `last`, finest mip, each by
// its share left in the water there (`shallow`, seaShallowFactors), for a vertex: what
// floating objects ride, as SeaState.heightAtDepth sums it.
float seaHeight(vec2 p, int last, vec4 shallow) {
  float h = shallow.x * seaLayerRead(uSeaSurface0, uSeaLayers[0], uSeaLayerStats[0], 0, seaLayerUv(uSeaLayers[0], p), 0.0).z;
  if(last >= 1)
    h += shallow.y * seaLayerRead(uSeaSurface1, uSeaLayers[1], uSeaLayerStats[1], 1, seaLayerUv(uSeaLayers[1], p), 0.0).z;
  if(last >= 2)
    h += shallow.z * seaLayerRead(uSeaSurface2, uSeaLayers[2], uSeaLayerStats[2], 2, seaLayerUv(uSeaLayers[2], p), 0.0).z;
  #if SEA_LAYERS > 3
  if(last >= 3)
    h += shallow.w * seaLayerRead(uSeaSurface3, uSeaLayers[3], uSeaLayerStats[3], 3, seaLayerUv(uSeaLayers[3], p), 0.0).z;
  #endif
  return h;
}
