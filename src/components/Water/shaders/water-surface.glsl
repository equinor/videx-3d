// Shared ocean surface shading: the waves from a sea state's layers (sea-layers.glsl),
// Fresnel, reflection and sun glint, and wind-driven and contact foam. The Water surface and the
// Sky's endless sea both include it, so they read the same uniforms and look the same.
//
// ⚠️ waterWaves, waterFresnel and waterFoam take screen-space derivatives: call them under
// uniform control flow.

// Maximum number of floating-object contact footprints that can spread foam on
// the surface (see uContactCount / uContactA / uContactB).
#ifndef WATER_CONTACT_COUNT
#define WATER_CONTACT_COUNT 8
#endif
// The foam's texture (waterWaves' `crest`): standard deviations each side of its middle, and
// how much the finest layer breaks up the wind sea's crests.
#define WATER_CREST_SPAN 3.0
#define WATER_CREST_FINE 0.6
#define WATER_CREST_RIPPLES 0.4
// A whitecap's patch, metres across: x + y × the wind (m/s), 3.5 m at 10 m/s, 5.75 m at 25; and
// the share of the foam's texture's spread its breakup stands for (waterFoam).
#define WATER_FOAM_PATCH vec2(2.0, 0.15)
#define WATER_FOAM_PATCH_SHARE 0.5
// The foam's albedo, lit (Dupuy and Bruneton 2012 use 0.4, after Koepke 1984; fresh foam is
// brighter).
#define WATER_FOAM_ALBEDO 0.8

uniform float uTime;
// Octaves of the shore's ragged edge noise (waterFbm). A uniform, not a define: Direct3D then
// keeps its loop a loop rather than a copy per octave, at every one of its calls.
uniform int uWaterDetailOctaves;
uniform vec2 uWindDirection;
uniform float uWindSpeed; // m/s (drives foam coverage)
uniform float uSignificantHeight; // Hs (m) for foam crest normalisation
uniform float uSteepness; // apparent choppiness: the waves' slopes scaled, 1 as the spectrum gives them

uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform float uOpacity; // base body opacity (looking straight down)

uniform float uReflectionIntensity;

uniform vec3 uSunDirection; // world space, normalised
uniform vec3 uSunColor;
uniform float uSunShininess;
uniform float uSunGlintSpread; // roughness added to the glint, widening its path; 0 = none
uniform float uSparkle; // how much of the glint's glitter is drawn (WATER_SPARKLE), 1 as modelled
uniform float uCrestLight; // how much light through the crests is drawn (waterCrestLight), 1 as modelled

uniform vec3 uFoamColor;
uniform float uFoamAmount;
// ⚠️ Tuning (WaterFoamTuning; its defaults in water-material.ts, WATER_FOAM_*_DEFAULT): x the
// finer waves' share in the crests (×), y the rim's width up close, z the froth, w the thin
// foam's falloff (where it turns opaque).
uniform vec4 uFoamShape;
// ⚠️ Tuning: x the far fade, y the most foam covers, z how much it is lit by the wave, w the
// lift (a brighter rim).
uniform vec4 uFoamLook;
// ⚠️ Tuning: x the grain's strength, y its cell (m), z how narrow the foam is drawn toward
// the crest lines, w the debug view (waterDebugView): 0 none.
uniform vec4 uFoamGrain;
// The crests' slope along the wind at the pixel, in standard deviations, as waterWaves last
// found it: > 0 on a crest's back (where its foam trails), < 0 on its front.
float waterCrestAlong;

uniform float uFresnelPower;
uniform float uDetailScale;    // the foam's feature frequency (per world unit)
uniform vec2 uDetailFade;      // distances from the camera over which the waves fade to a flat mirror

// Contact foam from floating objects (e.g. a vessel hull). Each active contact
// is an oriented ellipse footprint: uContactA = vec4(centerX, centerZ, forwardX,
// forwardZ) with forward the UNIT DIRECTION the object points in (not the sine
// and cosine of its heading — see WaterMaterial.setContacts), uContactB =
// vec4(halfLength, halfWidth, foamWidth, intensity), uContactC =
// vec4(endFalloff, unused...). uContactCount active entries; 0 = no objects, so
// the loop exits immediately (no cost when nothing floats on the ocean).
uniform int uContactCount;
uniform vec4 uContactA[WATER_CONTACT_COUNT];
uniform vec4 uContactB[WATER_CONTACT_COUNT];
uniform vec4 uContactC[WATER_CONTACT_COUNT];

#include ./sea-layers.glsl

// The detail octave (SeaState.detail): the finest layer's tile read again, smaller, for the
// ripples below its band. As uSeaLayers is for a layer: 1 / its size, its turn, its texels;
// and x the gain on the finest layer's slopes, y, z its tile point's shift, the ripples' drift.
uniform vec4 uSeaDetailLayer;
uniform vec3 uSeaDetail;

#if SEA_LAYERS > 3
#define uSeaFinest uSeaSurface3
#define SEA_FINEST 3
#else
#define uSeaFinest uSeaSurface2
#define SEA_FINEST 2
#endif

#include ../../../sdk/materials/shaderLib/weather-wind.glsl

// The weather's gusts and slicks over the sea (weatherWindAt): x their strength, y the largest
// gusts across (m), z the slicks the wind allows, w the slicks across (m); x and z nil, none.
uniform vec4 uWeatherGusts;
// x how far the mean wind has run (m), y the field's seed.
uniform vec2 uWeatherGustTravel;
// The short waves' slope variance in a local wind 0.25, 0.5, 1.5 and 2 times the mean, over
// the mean's (SeaState.shortWaveRatios): none in no wind, 1 in the mean.
uniform vec4 uWeatherGustRough;
// ⚠️ Tuning (WaterWaveTuning.roughReflect): how much rougher water turns the reflection, 1.
uniform float uRoughReflect;
// As waterWaves last found them: the local wind over the mean, the slick there (0 to 1), and
// the slope variance the pixel cannot show as it would be without either.
float waterGust = 1.0;
float waterSlick = 0.0;
float waterRoughMean = 0.0;
// As waterWaves last found it: the waves' height there as they would stand in deep water, which
// carries the waterline up and down a shore (the swash) after they have broken.
float waterOpenHeight = 0.0;
// As waterWaves last found it: how much of the waves the breaking limit leaves there
// (seaShallowFactors' `limit`): 1 off the surf zone, falling to 0 toward the shore, where the
// surf (waterShoreFoam) stands in for the whitecaps (waterWindFoam).
float waterBreakLimit = 1.0;
// How much a slick damps the short waves the gusts move (Cox and Munk's slicks keep about 40 %
// of the whole slope variance at 10 m/s).
#define WATER_SLICK_DAMPING 0.8

// The short waves' slope variance in a local wind `g` times the mean, over the mean's: through
// uWeatherGustRough, linear between.
float waterGustRough(float g) {
  vec4 r = uWeatherGustRough;
  if(g < 0.25)
    return r.x * g * 4.0;
  if(g < 0.5)
    return mix(r.x, r.y, (g - 0.25) * 4.0);
  if(g < 1.0)
    return mix(r.y, 1.0, (g - 0.5) * 2.0);
  if(g < 1.5)
    return mix(1.0, r.z, (g - 1.0) * 2.0);
  return max(mix(r.z, r.w, (g - 1.5) * 2.0), 0.0);
}

// The reflection off water rougher (or smoother) than the sea's mean, `rough` the slope
// variance the pixel cannot show (waterWaves): its facets tilted every way see higher up the
// sky, as cat's paws darken against the bright horizon a glassy sea mirrors. `r` the mirror
// direction, `up` the sea's up; nothing changes at the mean, as everywhere without the gusts
// and slicks (WATER_NO_GUSTS).
vec3 waterRoughReflect(vec3 r, vec3 up, float rough) {
  #ifdef WATER_NO_GUSTS
  return r;
  #else
  return normalize(r + up * (uRoughReflect * (sqrt(rough) - sqrt(waterRoughMean))));
  #endif
}

// Smith's masking of a Beckmann surface of slope variance `rough` (both axes) seen at `ndv`.
// ⚠️ Kept off 0 (a facet turned from the camera, ndv 0): the ratio of two is 0/0 there, NaN,
// which draws black.
float waterMasking(float ndv, float rough) {
  float a = max(ndv, 1e-3) * inversesqrt(max(0.5 * rough * (1.0 - ndv * ndv), 1e-8));
  if(a >= 1.6)
    return 1.0;
  return 1.0 / (1.0 + (1.0 - 1.259 * a + 0.396 * a * a) / (3.535 * a + 2.181 * a * a));
}

// The reflection's `fresnel` at `ndv` for water rougher (or smoother) than the mean: its facets
// hide each other more as it roughens, toward grazing. Nothing changes at the mean, nor
// without the gusts and slicks.
float waterRoughFresnel(float fresnel, float ndv, float rough) {
  #ifdef WATER_NO_GUSTS
  return fresnel;
  #else
  float ratio = waterMasking(ndv, rough) / max(waterMasking(ndv, waterRoughMean), 1e-4);
  return clamp(fresnel * mix(1.0, ratio, uRoughReflect), 0.0, 1.0);
  #endif
}

// 0 up close, 1 where the sea has faded to a flat mirror, `dist` from the camera.
float waterFlatness(float dist) {
  return smoothstep(uDetailFade.x, uDetailFade.y, dist);
}

// --- Procedural value noise / FBM (world-space input) -----------------------

// Dave Hoskins hash12: well-distributed and far less prone to the axis-aligned
// banding the cheaper fract(sin())/fract(p*c) hashes show at the large world
// coordinates used at oilfield scale.
float waterHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float waterNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = waterHash(i + vec2(0.0, 0.0));
  float b = waterHash(i + vec2(1.0, 0.0));
  float c = waterHash(i + vec2(0.0, 1.0));
  float d = waterHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian motion with per-octave domain ROTATION. Rotating (and
// offsetting) each octave stops the octaves' integer lattices from aligning,
// which is the dominant source of visible repeating patterns in a summed
// value-noise field. The result is normalised to [0,1].
float waterFbm(vec2 p) {
  const mat2 rot = mat2(0.8, -0.6, 0.6, 0.8); // ~36.9 deg
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for(int i = 0; i < uWaterDetailOctaves; i++) {
    sum += amp * waterNoise(p);
    norm += amp;
    p = rot * p * 2.03 + 17.1; // rotate + scale + offset per octave
    amp *= 0.5;
  }
  return sum / max(norm, 1e-4);
}

// A layer's mip for a pixel `pixel2` across (squared, on the wave plane, its longer side): from
// the texels it spans. The turn into the tile keeps lengths, so this is the mip the tile point's
// own derivatives give.
float seaLayerLod(vec4 layer, float pixel2) {
  float texels = layer.x * layer.w;
  return 0.5 * log2(max(pixel2 * texels * texels, 1e-8));
}

// One layer at `p`, filtered to the pixel there, `dx` and `dy` its derivatives on the wave
// plane: along its footprint (SEA_ANISO), else over its longer side.
vec4 seaLayerAt(sampler2D map, int index, vec2 p, vec2 dx, vec2 dy) {
  vec4 layer = uSeaLayers[index];
  vec2 uv = seaLayerUv(layer, p);
  #ifdef SEA_ANISO
  return seaLayerReadGrad(map, layer, uSeaLayerStats[index], index, uv, vec2(0.0), seaLayerUv(layer, dx), seaLayerUv(layer, dy));
  #else
  return seaLayerRead(map, layer, uSeaLayerStats[index], index, uv, seaLayerLod(layer, max(dot(dx, dx), dot(dy, dy))));
  #endif
}

// The share of a layer's height variance a read keeps, from the share of its slope variance
// it loses to the mips (`lost` of `total`): its waves span about SEA_LAYER_SPAN in wavenumber
// (the tiles are that far apart) on a k⁻³ spectrum, filtered from the shortest up, so the
// heights, mostly the longest waves', hold on long after the slopes go (0.87 at half of them).
#define SEA_LAYER_SPAN 6.5
float seaHeightKept(float lost, float total) {
  float f = clamp(lost / max(total, 1e-12), 0.0, 1.0);
  float r2 = SEA_LAYER_SPAN * SEA_LAYER_SPAN;
  return clamp((r2 - pow(SEA_LAYER_SPAN, 2.0 * f)) / (r2 - 1.0), 0.0, 1.0);
}

// As waterWaves last found it: the spread of the crests (`crest.x`, in their standard
// deviations) the pixel cannot show: 0 up close, where it shows all of them, 1 where it shows
// none (filtered out, or faded far off and where two of a Scenery's charts meet). The foam is
// the share of the pixel the crests stand over their threshold, those it shows and those it
// does not together (waterFoam).
float waterCrestUnresolved = 1.0;

// The waves at `p` of the wave plane (+Y up), from the sea state's layers, each filtered to
// the pixel: the normal, with the slope and height for the foam; `crest` the finer layers'
// heights over their spread, as [0, 1] (x all but the longest, y the finest), the foam's
// texture; and `rough` the slope variance (both axes) the pixel cannot show: what the mips
// filter out, and the waves no layer draws. `flatness` (waterFlatness) fades the slopes
// drawn into that roughness, far off and where two of a Scenery's charts meet; all faded,
// no layer is read. `depth` is the still water's there: each layer is cut to what is left of
// it there (seaShallowFactors), so the waves shoal and die out toward a shore; the crests are
// taken over their spread as cut, so the foam's texture keeps its look (the whitecaps answer
// the cut by waterBreakLimit).
// ⚠️ Derivatives.
vec3 waterWaves(vec2 p, float flatness, float depth, out vec2 slope, out float height, out vec2 crest, out float rough) {
  waterCrestAlong = 0.0;
  waterGust = 1.0;
  waterSlick = 0.0;
  waterOpenHeight = 0.0;
  waterBreakLimit = 1.0;
  waterCrestUnresolved = 1.0;
  // The pixel's footprint on the wave plane, and its longer side squared.
  vec2 dpx = dFdx(p);
  vec2 dpy = dFdy(p);
  float pixel2 = max(dot(dpx, dpx), dot(dpy, dpy));
  float s2 = uSteepness * uSteepness;
  float detailGain2 = uSeaDetail.x * uSeaDetail.x;
  float limit;
  vec4 shallow = seaShallowFactors(depth, limit);
  vec4 shallow2 = shallow * shallow;
  waterBreakLimit = limit;
  float total = shallow2.x * uSeaLayerStats[0].x + shallow2.y * uSeaLayerStats[1].x + shallow2.z * uSeaLayerStats[2].x;
  #if SEA_LAYERS > 3
  total += shallow2.w * uSeaLayerStats[3].x;
  #endif
  total += detailGain2 * limit * limit * uSeaLayerStats[SEA_FINEST].x;
  float detail = 1.0 - flatness;
  if(detail <= 0.001) {
    slope = vec2(0.0);
    height = 0.0;
    crest = vec2(0.5);
    rough = total * s2 + uSeaResidual;
    waterRoughMean = rough;
    return vec3(0.0, 1.0, 0.0);
  }
  vec2 wind = uWindDirection / max(length(uWindDirection), 1e-6);
  // The weather's gusts and slicks roughen and calm the short waves: what no layer draws by
  // the spectrum's answer to the local wind, the ripples and the finest layer a share of it.
  // Faded with the waves (far off, and where two of a Scenery's charts meet); the slicks'
  // damping over its mean, so a sea too far off to show them is as rough as without. None at
  // low quality (WATER_NO_GUSTS): the mean's roughness everywhere.
  float gustRough = 1.0;
  #ifndef WATER_NO_GUSTS
  if(uWeatherGusts.x > 0.0 || uWeatherGusts.z > 0.0) {
    float slick;
    float g = weatherWindAt(p, wind, uWeatherGustTravel, uWeatherGusts, sqrt(pixel2), slick);
    waterGust = mix(1.0, g, detail);
    waterSlick = slick * detail;
    gustRough = waterGustRough(waterGust) * (1.0 - WATER_SLICK_DAMPING * waterSlick) / (1.0 - WATER_SLICK_DAMPING * WEATHER_SLICK_MEAN * uWeatherGusts.z);
  }
  #endif
  // What that adds to the slopes drawn, and to all of them: the mean less these is the mean.
  float gustSlope = 0.0;
  float gustTotal = 0.0;
  vec4 l0 = seaLayerAt(uSeaSurface0, 0, p, dpx, dpy);
  vec4 l1 = seaLayerAt(uSeaSurface1, 1, p, dpx, dpy);
  vec4 l2 = seaLayerAt(uSeaSurface2, 2, p, dpx, dpy);
  waterOpenHeight = (l0.z + l1.z + l2.z) * detail;
  float kept1 = seaHeightKept(l1.w, uSeaLayerStats[1].x);
  float kept2 = seaHeightKept(l2.w, uSeaLayerStats[2].x);
  l0 *= vec4(vec3(shallow.x), shallow2.x);
  l1 *= vec4(vec3(shallow.y), shallow2.y);
  l2 *= vec4(vec3(shallow.z), shallow2.z);
  vec4 fine = l2;
  float fineVariance = uSeaLayerStats[2].y;
  vec4 sum = l0 + l1 + l2;
  // The wind sea's crests: the 307 m and 47 m layers; a finer one only breaks them up. Over
  // their spread as they stand here, cut by the depth: the foam's texture keeps its look in
  // shallow water, and the whitecaps answer the depth by their share (waterBreakLimit).
  float crestHeight = l1.z + l2.z;
  float crestVariance1 = shallow2.y * uSeaLayerStats[1].y;
  float crestVariance2 = shallow2.z * uSeaLayerStats[2].y;
  float crestVariance = crestVariance1 + crestVariance2;
  // How much of their spread the pixel shows (seaHeightKept), for the foam (waterCrestUnresolved).
  float keptCrest = (crestVariance1 * kept1 + crestVariance2 * kept2) / max(crestVariance, 1e-8);
  float zCrestFine = l2.z * inversesqrt(max(crestVariance2, 1e-8));
  #if SEA_LAYERS > 3
  vec4 l3 = seaLayerAt(uSeaSurface3, 3, p, dpx, dpy);
  float kept3 = seaHeightKept(l3.w, uSeaLayerStats[3].x);
  waterOpenHeight += l3.z * detail;
  // The finest layer (7.3 m on medium) answers the local wind by half (it lies mostly above
  // the short waves).
  float gustLayer = mix(1.0, sqrt(gustRough), 0.5);
  float gustLayer2 = gustLayer * gustLayer - 1.0;
  gustSlope += gustLayer2 * shallow2.w * l3.w;
  gustTotal += gustLayer2 * shallow2.w * uSeaLayerStats[3].x;
  l3 *= vec4(vec3(gustLayer * shallow.w), gustLayer * gustLayer * shallow2.w);
  fine = l3;
  fineVariance = uSeaLayerStats[3].y;
  sum += l3;
  #endif
  // The ripples, where drawn (SEA_DETAIL): the finest layer again, smaller, its slopes by the
  // gain (heights by the gain over the scale), on its own hex cells, sliding under them
  // downwind; by the local wind.
  #ifdef SEA_DETAIL
  #ifdef SEA_ANISO
  vec4 ripples = seaLayerReadGrad(uSeaFinest, uSeaDetailLayer, uSeaLayerStats[SEA_FINEST], SEA_LAYERS, seaLayerUv(uSeaDetailLayer, p), uSeaDetail.yz, seaLayerUv(uSeaDetailLayer, dpx), seaLayerUv(uSeaDetailLayer, dpy));
  #else
  vec4 ripples = seaLayerReadShifted(uSeaFinest, uSeaDetailLayer, uSeaLayerStats[SEA_FINEST], SEA_LAYERS, seaLayerUv(uSeaDetailLayer, p), uSeaDetail.yz, seaLayerLod(uSeaDetailLayer, pixel2));
  #endif
  float rippleGain = uSeaDetail.x * sqrt(gustRough) * limit;
  float rippleGain2 = rippleGain * rippleGain;
  float detailGainHere2 = detailGain2 * limit * limit;
  sum += ripples * vec4(rippleGain, rippleGain, rippleGain * uSeaLayers[SEA_FINEST].x / uSeaDetailLayer.x, rippleGain2);
  gustSlope += (rippleGain2 - detailGainHere2) * ripples.w;
  gustTotal += (rippleGain2 - detailGainHere2) * uSeaLayerStats[SEA_FINEST].x;
  #endif
  total += gustTotal;
  // What breaks the crests up finest (and froths the foam, `crest.y`): the layer below the 47 m
  // one, else the ripples, else the 47 m layer itself.
  #if SEA_LAYERS > 3
  float zDetail = l3.z * inversesqrt(max(shallow2.w * uSeaLayerStats[3].y, 1e-8));
  float keptDetail = kept3;
  #elif defined(SEA_DETAIL)
  float zDetail = ripples.z * inversesqrt(max(fineVariance, 1e-8));
  float keptDetail = seaHeightKept(ripples.w, uSeaLayerStats[SEA_FINEST].x);
  #else
  float zDetail = zCrestFine;
  float keptDetail = kept2;
  #endif
  // What the pixel resolves of the layers' slopes: all of them less what its mips filter out.
  float resolved = max(total - sum.w, 0.0);
  slope = sum.xy * detail * uSteepness;
  height = sum.z * detail;
  float unresolved = 1.0 - detail * detail;
  rough = (sum.w + unresolved * resolved) * s2 + uSeaResidual * gustRough;
  waterRoughMean = (sum.w - gustSlope + unresolved * max(total - gustTotal - sum.w + gustSlope, 0.0)) * s2 + uSeaResidual;
  // The wind sea's crests (the 307 m and 47 m layers), broken up by the 47 m layer's and the
  // finer waves', in standard deviations: ±3 over [0, 1] (WATER_CREST_SPAN).
  float crestFine = WATER_CREST_FINE * uFoamShape.x;
  #if SEA_LAYERS > 3 || defined(SEA_DETAIL)
  float crestRipples = WATER_CREST_RIPPLES * uFoamShape.x;
  #else
  float crestRipples = 0.0;
  #endif
  float crestWeights = 1.0 + crestFine * crestFine + crestRipples * crestRipples;
  float zCrest = (crestHeight * inversesqrt(max(crestVariance, 1e-8)) + crestFine * zCrestFine + crestRipples * zDetail) * inversesqrt(crestWeights);
  // The share of that spread the pixel shows, each part by what its mips keep of it.
  float keptZ = (keptCrest + crestFine * crestFine * kept2 + crestRipples * crestRipples * keptDetail) / crestWeights;
  // ⚠️ Tuning (uFoamGrain.z): narrowed toward the crest lines, where the crests' slope along the
  // wind is nil, lowered by its size there in standard deviations (a half-normal, centred and
  // rescaled so as much of the sea stays over the threshold): long along a crest, thin across.
  vec2 crestSlope = l1.xy + l2.xy;
  float crestSlopeVariance = shallow2.y * uSeaLayerStats[1].x + shallow2.z * uSeaLayerStats[2].x;
  // Along one axis, half the slope variance of both. Rising downwind (> 0) on a crest's back,
  // the side its foam trails on as the crest runs on.
  waterCrestAlong = dot(crestSlope, wind) * inversesqrt(max(0.5 * crestSlopeVariance, 1e-10));
  float narrow = uFoamGrain.z;
  if(narrow > 0.0) {
    // As filtered, the slope keeps the share of its spread the mips leave (their `w` the rest):
    // its half-normal centred on its own mean, so the crests' mean stays put.
    float keptSlope = clamp(1.0 - (l1.w + l2.w) / max(crestSlopeVariance, 1e-10), 0.0, 1.0);
    float narrow2 = narrow * narrow * 0.3633802;
    zCrest = (zCrest - narrow * (abs(waterCrestAlong) - 0.7978846 * sqrt(keptSlope))) * inversesqrt(1.0 + narrow2);
    keptZ = (keptZ + narrow2 * keptSlope) / (1.0 + narrow2);
  }
  // Faded far off and where two of a Scenery's charts meet, as the slopes are: the spread it
  // loses goes to what the pixel does not show, so the foam keeps its share there.
  float keptFade = smoothstep(0.0, 0.5, detail);
  zCrest *= sqrt(keptFade);
  waterCrestUnresolved = sqrt(clamp(1.0 - keptZ * keptFade, 0.0, 1.0));
  crest = clamp(0.5 + vec2(zCrest, zDetail) / (2.0 * WATER_CREST_SPAN), 0.0, 1.0);
  return normalize(vec3(-slope.x, 1.0, -slope.y));
}

// The share of light water reflects at `c`, the cosine of the angle of incidence on the air
// side: by Fresnel's equations for an unpolarised ray into water of IOR 1.333 (2.04 % straight
// on, all at grazing). From below, at the cosine of the ray's angle in air as it leaves, the
// same (reciprocity). WATER_FRESNEL_POWER (an WaterMaterial's `fresnelPower`) draws the old
// look instead: Schlick's curve from 2 % with that exponent (4 held more reflection at middle
// angles than water does).
#define WATER_F0 0.02
#define WATER_IOR 1.333
float waterFresnelAt(float c) {
  c = clamp(c, 0.0, 1.0);
  #ifdef WATER_FRESNEL_POWER
  return mix(WATER_F0, 1.0, pow(1.0 - c, uFresnelPower));
  #else
  float g = sqrt(WATER_IOR * WATER_IOR - 1.0 + c * c);
  float s = (g - c) / (g + c);
  float p = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
  return 0.5 * s * s * (1.0 + p * p);
  #endif
}

// Fresnel, analytically widened to avoid grazing-angle shading aliasing. `ndvAA` is the
// widened cosine. Clamped to 1: looking straight down on a flat normal it rounds a hair over.
float waterFresnel(vec3 N, vec3 V, out float ndvAA) {
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  ndvAA = min(max(ndv, fwidth(ndv)), 1.0);
  return waterFresnelAt(ndvAA);
}

#ifdef WATER_SPARKLE
// --- The sun's glitter --------------------------------------------------------
// The glint (waterGlint) is what many small glints the pixel cannot show send of the sun on
// average. Where few of them fall in a pixel, they are a few bright points instead, and they
// come and go as the ripples move: a cell of the sea fixed in the world shows k of them,
// Poisson-distributed about the mean (as Deliot and Belcour 2023 draw glints), as k / mean of
// the glint. Many to a pixel, that is 1: the smooth glint, the same mean at every distance. How
// many glints a square metre has is the specular points' density (Longuet-Higgins 1960): the
// slope pdf at the half vector times the curvature of the waves too short to draw, taken as
// their slope variance times a ripple's wavenumber squared. So a rough sea, crowded with
// ripples, has so many that past a few metres they are a sheen; a calmer one fewer, standing
// out. The cells are as wide as a pixel's footprint, read at the two powers of two either side
// and blended, so nothing pops as it changes. Closer, where a ripple spans pixels, the waves
// drawn carry the glint: the glitter gives way to it as a pixel narrows from four ripples to
// one. `uSparkle` scales how much of it is drawn (WaterMaterial.sparkle).
// A ripple's wavenumber squared ((rad/m)², about 6 cm long), the size it spans (m), how often a
// cell's ripples turn anew (Hz, each draw rising and falling over two turns), and the most one
// draw outshines the mean: past it, they come oftener and dimmer, at the same mean.
#define WATER_SPARKLE_CURVATURE 11000.0
#define WATER_SPARKLE_FACET 0.03
#define WATER_SPARKLE_RATE 8.0
#define WATER_SPARKLE_MAX 4.0

// Jarzynski and Olano's pcg3d: three well-mixed words from three, exact for any cell index.
uvec3 waterPcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

// k / mean for the cell hashed `h` at its `turn`, `mean` facets expected in it.
float waterSparkleDraw(uvec3 h, uint turn, float mean) {
  vec3 u = vec3(waterPcg3(h ^ uvec3(turn * 747796405u, turn, ~turn))) * (1.0 / 4294967296.0);
  float k = 0.0;
  if(mean < 4.0) {
    // Poisson by inversion: the first count whose cumulative share passes u.x.
    float term = exp(-mean);
    float sum = term;
    for(int i = 1; i < 12; i++) {
      if(sum >= u.x)
        break;
      term *= mean / float(i);
      sum += term;
      k += 1.0;
    }
  } else {
    // As normal (Irwin-Hall of three, scaled to unit variance).
    k = max(mean + sqrt(mean) * 2.0 * (u.x + u.y + u.z - 1.5), 0.0);
  }
  return k / mean;
}

// k / mean in the cell `cell` wide at `p` (world, m) on level `level`, `perArea` the facets a
// square metre expected to send the sun to the eye: each turn's draw faded into the next's.
float waterSparkleCell(vec2 p, float cell, float level, float perArea) {
  float mean = max(perArea * cell * cell, 1.0 / WATER_SPARKLE_MAX);
  uvec3 h = waterPcg3(uvec3(uvec2(ivec2(floor(p / cell))), uint(level)));
  // Each cell turns at its own phase, so they do not twinkle in step.
  float clock = uTime * WATER_SPARKLE_RATE + float(h.x) * (1.0 / 4294967296.0);
  float turn = floor(clock);
  uint t = uint(turn);
  return mix(waterSparkleDraw(h, t, mean), waterSparkleDraw(h, t + 1u, mean), clock - turn);
}

float waterSparkle(vec2 p, float texel, float perArea) {
  float level = log2(max(texel, WATER_SPARKLE_FACET) / WATER_SPARKLE_FACET);
  float l0 = floor(level);
  float cell = WATER_SPARKLE_FACET * exp2(l0);
  return mix(waterSparkleCell(p, cell, l0, perArea), waterSparkleCell(p, 2.0 * cell, l0 + 1.0, perArea), level - l0);
}
#endif

// The sun's glint off the waves: `rough` the slope variance the pixel cannot show
// (waterWaves); `glint` scales it. `p` is the surface point (world X/Z, m) and `texel` the
// metres a pixel spans there, for its glitter (WATER_SPARKLE).
vec3 waterGlint(vec3 N, vec3 V, float glint, float rough, vec2 p, float texel) {
  vec3 H = normalize(V + normalize(uSunDirection));
  float ndh = max(dot(N, H), 0.0);
  // The slopes the pixel cannot show still scatter the sun: their variance widens the glint
  // (the exponent read as a Beckmann roughness), at the same energy, so from far off or high
  // up it spreads into a broad patch. The added spread (uSunGlintSpread) keeps its peak
  // instead, so the path also brightens.
  float base = 2.0 / (uSunShininess + 2.0);
  float shininess = uSunShininess;
  float energy = 1.0;
  if(rough > 0.0 || uSunGlintSpread > 0.0) {
    float roughness = base + rough;
    shininess = 2.0 / (roughness + uSunGlintSpread) - 2.0;
    energy = base / roughness;
  }
  float lobe = pow(ndh, shininess);
  float g = lobe * energy * glint;
  #ifdef WATER_SPARKLE
  // Of the lobe's variance, the ripples' share (the rest the sun's own breadth and the glitter
  // path's added spread, drawn smooth), and their glints a square metre there: the slope pdf at
  // the half vector, lobe / (π variance), times their curvature. None where a ripple spans more
  // than a pixel: the waves drawn show it.
  float shown = smoothstep(1.0, 4.0, texel / WATER_SPARKLE_FACET);
  if(g > 1e-4 && rough > 0.0 && shown > 0.0) {
    float variance = base + rough + uSunGlintSpread;
    // π² = 9.8696.
    float perArea = WATER_SPARKLE_CURVATURE * rough * lobe / (9.8696044 * variance);
    g *= mix(1.0, waterSparkle(p, texel, perArea), clamp(uSparkle * shown * rough / variance, 0.0, 1.0));
  }
  #endif
  return uSunColor * g;
}

// --- Light through the crests ---------------------------------------------------
// The sun's light crossing a wave's crest and scattered toward the eye, seen with the sun behind
// the wave: the water's own light looking toward the light from in it (water-fog.glsl's
// waterGlow straight up, 9 times its colour), tinted by the short path through the crest (half
// the waves' significant height, 0.3 to 3 m: red goes first, so it glows turquoise), on a
// narrow lobe about the sun's direction pushed by the normal (Barré-Brisebois and Bouchard
// 2011's thin translucency), high on the waves only, and fading with their detail (`flatness`).
// `fresnel` is the share the surface reflects (the rest leaves the water), `sun` the light's
// colour there, `up` the sea's up; uCrestLight scales it (WaterMaterial.crestLight).
#define WATER_CREST_GLOW 9.0
#define WATER_CREST_BEND 0.5
#define WATER_CREST_POWER 4.0
vec3 waterCrestLight(vec3 N, vec3 V, float height, float flatness, float fresnel, vec3 extinction, vec3 waterColor, vec3 sun, vec3 up) {
  // Not drawn at low quality (WATER_QUALITY_DEFINES).
  #ifdef WATER_NO_CREST_LIGHT
  return vec3(0.0);
  #else
  float crest = uCrestLight * smoothstep(0.0, 0.5 * uSignificantHeight, height) * (1.0 - flatness);
  if(crest <= 0.0)
    return vec3(0.0);
  vec3 L = normalize(uSunDirection);
  float behind = pow(clamp(dot(V, -normalize(L + N * WATER_CREST_BEND)), 0.0, 1.0), WATER_CREST_POWER);
  // Only while the light is up over the sea.
  behind *= smoothstep(-0.02, 0.05, dot(L, up));
  vec3 tint = exp(-extinction * clamp(0.5 * uSignificantHeight, 0.3, 3.0));
  return crest * behind * (1.0 - fresnel) * WATER_CREST_GLOW * waterColor * tint * sun;
  #endif
}

// A premultiplied layer as colour and opacity, for blending. Its colour is kept no brighter
// than 1 where it can be, its opacity raised instead: a target may clamp a straight colour
// before it blends (the glint over Fresnel's 2 % is fifty times the glint), and where the glint
// or the sky outshines that, it outshines what lies under it too.
vec4 waterStraight(vec4 layer) {
  float a = clamp(max(layer.a, max(layer.r, max(layer.g, layer.b))), 1e-3, 1.0);
  return vec4(layer.rgb / a, a);
}

// --- Foam: whitecaps on the wind sea's highest crests -------------------------
// How many standard deviations up a normal leaves `share` (0 to 1) of it above: its upper tail
// inverted (Abramowitz and Stegun 26.2.23), either side of the middle.
float waterTailZ(float share) {
  float s = clamp(min(share, 1.0 - share), 1e-6, 0.5);
  float t = sqrt(-2.0 * log(s));
  float z = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1.0 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return share > 0.5 ? -z : z;
}

// The share of the sea whitecaps cover (Monahan and O'Muircheartaigh 1980: 3.84e-6·U^3.41, about
// 1 % at 10 m/s and 10 % at 20 m/s; uFoamAmount 0.5 as measured), in the surf zone by what the
// breaking limit leaves of the waves (waterBreakLimit, after waterWaves). Its twin without the
// surf zone: water-material.ts's waterWhitecapCover.
float waterWhitecapCover() {
  return min(3.84e-6 * pow(max(uWindSpeed, 0.0), 3.41) * 2.0 * uFoamAmount, 0.5) * waterBreakLimit;
}

// The whitecaps' cover (waterWhitecapCover) as the coverage that leaves that share of the
// crests' texture (waterWaves' `crest`) over waterFoam's threshold. `scale` takes a share of
// that cover: the share that breaks afresh where the foam's life is drawn (WATER_FOAM_LIFE),
// the rest being the foam it leaves.
float waterWindFoamShare(float scale) {
  float share = waterWhitecapCover() * scale;
  if(share <= 1e-5)
    return 0.0;
  return clamp(0.5 - waterTailZ(share) / (2.0 * WATER_CREST_SPAN), 0.0, 1.0);
}

float waterWindFoam() {
  return waterWindFoamShare(1.0);
}

#ifdef WATER_FOAM_LIFE
// --- The foam's life (SeaFoamLife) -------------------------------------------------
// A square of the wave plane about the camera: r fresh foam, the trail a breaking crest leaves,
// g old foam, thin, gathered into streaks along the wind. Where it holds, only a share of the
// whitecaps' cover breaks afresh (WATER_FOAM_ACTIVE), the rest being the foam it holds.
uniform sampler2D uFoamLife;
// xy: the square's corner in the wave plane (m); z: its size (m); w: how much it holds (0 none,
// as the camera rises past where its foam would show).
uniform vec4 uFoamLifeArea;
// The share of the whitecaps' cover that breaks afresh where the foam's life holds.
#define WATER_FOAM_ACTIVE 0.47
// How opaque fresh foam is where it is thickest, and old foam.
#define WATER_FOAM_FRESH 0.7
#define WATER_FOAM_OLD 0.3

// The foam's life at `p`: x fresh, y old, z how much of it holds there: all of it inside the
// square's middle, fading out over its outer 30 %, where the whitecaps' mean takes over, and as
// much as the texel has come into its life since the square moved onto it (b, SeaFoamLife).
vec3 waterFoamLifeAt(vec2 p) {
  vec2 uv = (p - uFoamLifeArea.xy) / uFoamLifeArea.z;
  vec2 edge = min(uv, 1.0 - uv);
  float hold = uFoamLifeArea.w * smoothstep(0.0, 0.3, min(edge.x, edge.y));
  if(hold <= 0.0)
    return vec3(0.0);
  vec3 life = textureLod(uFoamLife, uv, 0.0).rgb;
  return vec3(life.rg, hold * life.b);
}

// The whitecaps' cover at a point where the foam's life holds by `hold`: a share of it there.
float waterWindFoamWithLife(float hold) {
  return hold > 0.0 ? mix(waterWindFoam(), waterWindFoamShare(WATER_FOAM_ACTIVE), hold) : waterWindFoam();
}

// `opacity` (the foam drawn, waterFoam's) with the foam's life `life` (waterFoamLifeAt) over
// it. Both kinds are drawn as a share of a fine lace (smooth noise in two octaves, the finest
// waves' texture in it up close), their thickness the threshold: fresh foam, just broken, all
// of it, opening into holes as it thins; old foam a thin lace at most WATER_FOAM_OLD. So its
// edges are the lace's, a pixel's, whatever the square's texels, and once the lace is below a
// pixel (`texel`, m) its mean is drawn, the same thickness, as the foam fades by `foamFar`.
#define WATER_FOAM_LACE 1.2
float waterFoamLifeOver(float opacity, vec3 life, vec2 crest, vec2 p, float texel, float foamFar) {
  if(life.z <= 0.0 || life.x + life.y <= 0.002)
    return opacity;
  vec2 q = p / WATER_FOAM_LACE;
  float n = 0.55 * waterNoise(q) + 0.3 * waterNoise(mat2(0.8, -0.6, 0.6, 0.8) * q * 2.7 + 31.7) + 0.15 * crest.y;
  float sharp = 1.0 - smoothstep(0.5, 2.0, texel / WATER_FOAM_LACE);
  float edge = 0.04 + 0.1 * (1.0 - sharp);
  float fresh = WATER_FOAM_FRESH * mix(life.x, smoothstep(1.0 - life.x - edge, 1.0 - life.x + edge, n), sharp);
  float old = WATER_FOAM_OLD * mix(life.y, smoothstep(1.0 - life.y - edge, 1.0 - life.y + edge, n), sharp);
  float add = (1.0 - (1.0 - fresh) * (1.0 - old)) * life.z * (1.0 - foamFar * uFoamLook.x);
  return 1.0 - (1.0 - opacity) * (1.0 - clamp(add, 0.0, 1.0));
}
#endif

// --- Surf: where the waves break on a shore ------------------------------------
// The parts nobody has information to tune, so constants rather than knobs.
// A floor on the wave height standing in for background swell: an open coast breaks in a dead
// calm, and without this the shore would go glassy at wind 0.
#ifndef WATER_SWELL_FLOOR
#define WATER_SWELL_FLOOR 0.5
#endif
// Whitewater still left at the water's edge, relative to the break line. Surf is generated AT
// the break and decays as it washes inshore, so the shore is the dim end of the band.
#ifndef WATER_SURF_RESIDUAL
#define WATER_SURF_RESIDUAL 0.3
#endif
// Surf left on a shore the waves are running away from. Not zero: a lee shore still gets
// refracted and diffracted energy round the headland.
#ifndef WATER_LEE_EXPOSURE
#define WATER_LEE_EXPOSURE 0.25
#endif

// x how much surf (0 none), y its zone's width exaggerated (1 as measured), z how far the waves
// carry the waterline up and down the shore (the swash, × their height), w the step a
// bathymetry grid's slope is taken over (m).
uniform vec4 uShore;
// x the surf's landward edge's raggedness (m of depth), y its frequency (1 / m).
uniform vec2 uShoreNoise;
// x how white the surf is drawn (1 full white), y the share of that lost once its detail is
// below a pixel.
uniform vec2 uShoreFade;

// How squarely the waves meet a shore whose bed slopes along `bedSlope` (any scale): 1 head on,
// 0 running along it, and 1 on a flat bed, which has no shore to face.
float waterShoreAlign(vec2 bedSlope) {
  float len = length(bedSlope);
  return len > 1e-6 ? abs(dot(normalize(uWindDirection), bedSlope / len)) : 1.0;
}

// The slope across the wave plane of `depth`, from its screen derivatives and those of the
// plane point `p`: for a depth with no grid to step across (the scene's ground). ⚠️ Derivatives.
vec2 waterDepthSlope(float depth, vec2 p) {
  vec2 px = dFdx(p);
  vec2 py = dFdy(p);
  float fx = dFdx(depth);
  float fy = dFdy(depth);
  float det = px.x * py.y - px.y * py.x;
  return abs(det) > 1e-12 ? vec2(fx * py.y - px.y * fy, px.x * fy - fx * py.x) / det : vec2(0.0);
}

// The depth the surf reads at a point of still water `depth` deep, the waves meeting the shore
// there as squarely as `align` (waterShoreAlign): raised by the waves' height there as in deep
// water (waterOpenHeight, after waterWaves), so the shore advances and retreats with them,
// varied along the coast, with no clock of its own.
// ⚠️ NOT refraction, and not pretending to be. Real waves turn to face the shore as they shoal,
// so run-up on a beach is near-uniform along it; these keep their deep-water direction to the
// sand, which made the waterline scallop into stripes sliding ALONG the coast when the wind ran
// parallel to it. Weighting by `align` suppresses that: waves running along a coast stop moving
// its waterline.
float waterShoreDepth(float depth, float align) {
  return depth + waterOpenHeight * uShore.z * align;
}

// The surf's coverage at the plane point `p` (`texel` world units a pixel there), where the
// surf reads the depth `shoreDepth` (waterShoreDepth), `shoreWidth` its change across the pixel
// (its fwidth, taken where derivatives may be), and the waves meet the shore as squarely as
// `align`. Folded into the same coverage as the whitecaps, so it inherits their texture, froth
// and distance fade. ⚠️ Keyed on water DEPTH, never on the water's boundary, most of which is
// a crop.
float waterShoreFoam(float shoreDepth, float shoreWidth, float align, vec2 p, float texel) {
  if(uShore.x <= 0.0)
    return 0.0;
  // ⭐⭐ Waves break where the depth falls to uSeaBreakDepth times their height (where
  // seaShallowFactors cuts them down), so the surf zone MOVES WITH THE SEA STATE: a thin line in
  // a calm, a wide belt in a storm.
  float surfHeight = max(uSignificantHeight, WATER_SWELL_FLOOR);
  float breakDepth = max(uSeaBreakDepth * surfHeight * uShore.y, 1e-3);
  // Offshore of the band (its seaward tail under 1e-7, the ragged edge included), nothing: the
  // open sea pays for no noise.
  if(shoreDepth - uShoreNoise.x > 2.0 * breakDepth)
    return 0.0;
  // ⭐ Analytic anti-aliasing: once the band is narrower than a pixel it would be drawn as a hard
  // aliased line, so its amplitude drops by however much it is over-wide, keeping its integral.
  // Only bites on a steep shore: on a gentle shelf the band is hundreds of metres across. From
  // the unperturbed depth: the width follows the field, not the raggedness applied to it.
  float aa = min(1.0, breakDepth / max(shoreWidth, 1e-6));

  float edge = shoreDepth;
  if(uShoreNoise.x > 0.0) {
    // A ragged edge rather than the depth's contour exactly. ⚠️ Drifts slowly on its own rather
    // than with the waves: a coastline's raggedness belongs to the shore.
    float n = waterFbm(p * uShoreNoise.y + uTime * 0.02);
    float nAA = 1.0 - smoothstep(0.5, 3.0, uShoreNoise.y * 6.2831853 * texel);
    edge += (n - 0.5) * 2.0 * uShoreNoise.x * nAA;
  }

  // ⭐⭐ The profile PEAKS AT THE BREAK LINE, not at the water's edge: foam is made where the
  // waves break and washes inshore while decaying, so the bright line stands offshore. A band
  // peaking at depth 0 traces the coastline exactly and reads as a drawn outline.
  float t = max(edge, 0.0) / breakDepth;
  float seaward = exp(-pow(max(t - 1.0, 0.0) / 0.25, 2.0));
  float inshore = mix(WATER_SURF_RESIDUAL, 1.0, exp(-(1.0 - min(t, 1.0)) / 0.45));
  // Sets: surf arrives in groups, so the band pulses along the coast. Low frequency, so it
  // survives being zoomed out.
  float sets = mix(0.6, 1.0, waterFbm(p * 0.0006 + uTime * 0.03));
  // Exposure: a windward coast breaks, a lee shore mostly does not.
  float exposure = mix(WATER_LEE_EXPOSURE, 1.0, align);
  return clamp(seaward * inshore * sets * exposure * aa * uShore.x, 0.0, 1.0);
}

// The surf's own distance fade (in place of the whitecaps' where it is the foam, by its share):
// on a gentle shelf the band never goes sub-pixel, so the whitecaps' footprint fade would leave
// it at full strength. `foamFar` as waterFoam gives it.
float waterShoreFade(float foamFar) {
  return 1.0 - uShoreFade.x * (1.0 - foamFar * uShoreFade.y);
}

// Foam coverage [0,1] spread around floating-object contact footprints. For
// each active contact the point `p` on the sea's plane is transformed into the
// object's local frame and tested against an oriented ellipse (the hull waterline);
// foam is a soft band hugging that ellipse boundary (inside and out by
// `foamWidth`), gently pulsing in time so the collar shimmers. The band is scaled
// by the per-contact intensity and tapered toward the bow/stern (forward axis) by
// endFalloff, so the foam concentrates along the sides where a hull pushes the
// most water. Independent of wind, so a near-stationary object still leaves a
// foam collar in calm water. The loop breaks at uContactCount, so it is free
// when no objects are registered.
float waterContactFoam(vec2 p, float t) {
  float foam = 0.0;
  for(int i = 0; i < WATER_CONTACT_COUNT; i++) {
    if(i >= uContactCount)
      break;
    vec4 a = uContactA[i];
    vec4 b = uContactB[i];
    vec2 d = p - a.xy;
    vec2 fwd = a.zw;
    // Rotate into the object's local axes (forward, starboard).
    vec2 local = vec2(dot(d, fwd), dot(d, vec2(-fwd.y, fwd.x)));
    vec2 halfExtent = max(b.xy, vec2(1e-3));
    vec2 nrm = local / halfExtent;
    float dn = length(nrm);
    // Approximate signed distance (world units) to the ellipse boundary.
    float sd = (dn - 1.0) * min(halfExtent.x, halfExtent.y);
    float width = max(b.z, 1e-3);
    float band = 1.0 - smoothstep(0.0, width, abs(sd));
    // Taper toward the ends (bow/stern): dirN.x is the cosine of the boundary
    // point's angle from the forward axis, so dirN.x^2 is ~1 at the ends and ~0
    // on the sides. endFalloff (0..1) scales how much foam is removed there.
    vec2 dirN = nrm / max(dn, 1e-3);
    float endWeight = mix(1.0, 1.0 - dirN.x * dirN.x, clamp(uContactC[i].x, 0.0, 1.0));
    float pulse = 0.8 + 0.2 * sin(t * 1.5 + a.x * 0.05 + a.y * 0.05);
    foam = max(foam, band * pulse * endWeight * max(b.w, 0.0));
  }
  return foam;
}

// How much foam a `coverage` draws, before its distance fade: the share of the pixel the wind
// sea's crests (waterWaves' `crest`, the foam's texture) stand over the threshold the coverage
// sets. Those the pixel shows and those it does not (waterCrestUnresolved) together: up close,
// where it shows all of them, a crisp edge (and crisper as the camera approaches); further off a
// soft brightening over the crests it still shows; then an even tint, as much foam at every
// distance, none without coverage. The finest waves break it up further up close. `foamFar` -> 1
// once the foam's detail is sub-pixel.
float waterFoam(vec2 crest, vec2 p, float texel, float coverage, out float foamFar) {
  float foamTex = crest.x;

  // Foam feature footprint vs. pixel size: foamFar -> 1 when crests shrink below a pixel (far
  // away); closeness -> 1 when the camera is near and the foam is well resolved.
  float foamK = uDetailScale * 2.0 * 6.2831853;
  foamFar = smoothstep(0.5, 4.0, foamK * texel);
  float closeness = 1.0 - foamFar;

  // Grain: smooth noise in two octaves of cells uFoamGrain.y across, turned apart so their
  // grids never line up, roughening the rim and speckling thin foam; gone once a cell is under
  // a pixel, so it does not shimmer from afar.
  float grainCell = max(uFoamGrain.y, 1e-4);
  float grainAmount = uFoamGrain.x * (1.0 - smoothstep(0.5, 2.0, texel / grainCell));
  float grain = 0.0;
  if(grainAmount > 0.0) {
    vec2 q = p / grainCell;
    float n = 0.6 * waterNoise(q) + 0.4 * waterNoise(mat2(0.8, -0.6, 0.6, 0.8) * q * 2.3 + 17.1);
    grain = (n - 0.5) * 1.6 * grainAmount;
  }
  foamTex += grain * 0.15;

  // Higher coverage lowers the threshold => more of the texture becomes foam.
  float foamT = 1.0 - coverage;

  // Edge softness: crisp and anti-aliased at distance, wider up close (uFoamShape.y) so the
  // foam's fringe feathers into the water rather than a hard cut-out.
  float edge = clamp(fwidth(foamTex) + 0.01, 0.01, 0.5) + closeness * uFoamShape.y;
  // The crests the pixel does not show, a normal of their spread there, and the edge (a
  // smoothstep `edge` each side is as soft as a normal of edge / √5), in standard deviations:
  // the share over the threshold, as a logistic. A whitecap is no solid crest top but a ragged
  // patch a few metres across (WATER_FOAM_PATCH, larger as the wind rises), full of holes, which
  // the froth and grain draw up close: once a pixel spans one, that breakup is also what the
  // pixel does not show (WATER_FOAM_PATCH_SHARE of the texture's spread, the crests it shows the
  // rest), so the whitecaps soften into a mottled brightening, as much foam all the same.
  float patchSize = WATER_FOAM_PATCH.x + WATER_FOAM_PATCH.y * max(uWindSpeed, 0.0);
  float patchLost = WATER_FOAM_PATCH_SHARE * smoothstep(0.5 * patchSize, 2.0 * patchSize, texel);
  float edgeSpread = edge * 2.0 * WATER_CREST_SPAN;
  float spread = sqrt((1.0 - patchLost) * waterCrestUnresolved * waterCrestUnresolved + patchLost + edgeSpread * edgeSpread * 0.2);
  float zShown = (foamTex - 0.5) * 2.0 * WATER_CREST_SPAN * sqrt(1.0 - patchLost);
  float over = zShown - (foamT - 0.5) * 2.0 * WATER_CREST_SPAN;
  float foam = smoothstep(0.0, 0.05, coverage) / (1.0 + exp(-1.702 * over / max(spread, 1e-4)));

  // Up close the finest waves modulate the fill, so it reads as clumpy froth, not a sheet.
  float froth = mix(1.0, 1.0 - uFoamShape.z + uFoamShape.z * crest.y, closeness);
  foam *= froth;
  // Thin foam speckled by the grain.
  foam *= 1.0 - max(grain, 0.0) * 2.0 * (1.0 - foam);

  // Thin foam blends in gently; only the densest reaches full white (uFoamShape.w where).
  foam *= mix(1.0, smoothstep(0.05, max(uFoamShape.w, 0.06), foam), closeness);
  return clamp(foam, 0.0, 1.0) * uFoamLook.y;
}

// Foam over a premultiplied surface `layer` at `opacity` (waterFoam), its colour `foamColor`.
// Lit (as much as uFoamLook.z says, else flat), it is a rough surface on the wave, in the same
// light as the water: `sky` the sky's light toward the wave's normal `N`, `sun` the sun's
// colour as it reaches the sea (shadowed), as the glint has them; brighter at its rim by
// uFoamLook.w.
vec4 waterFoamOver(vec4 layer, vec3 foamColor, vec3 N, float opacity, vec3 sky, vec3 sun) {
  vec3 lit = foamColor * WATER_FOAM_ALBEDO * (sky + sun * clamp(dot(N, normalize(uSunDirection)), 0.0, 1.0));
  vec3 foam = mix(foamColor, lit, uFoamLook.z) * (1.0 + uFoamLook.w * 4.0 * opacity * (1.0 - opacity));
  return vec4(foam * opacity + layer.rgb * (1.0 - opacity), opacity + layer.a * (1.0 - opacity));
}

// ⚠️ Debug (uFoamGrain.w), in place of the surface's `color`:
// 1 whitecaps: grey by the crests' height (waterWaves' `crest`); red where foam forms (`foam`,
//   waterFoam's), blue on the crests' backs, where the foam trails as they run on downwind,
//   amber on their fronts;
// 2 crests: the crests' height as a ramp (blue low, red high), the foam's threshold for the
//   wind (waterWindFoam) as a white line;
// 3 wind: the local wind over the mean (waterGust; blue a lull, white the mean, red a gust,
//   full at ±50 %), green where a slick lies.
vec3 waterDebugView(vec3 color, vec2 crest, float foam) {
  int view = int(uFoamGrain.w + 0.5);
  if(view == 1) {
    vec3 base = vec3(0.15 + 0.7 * crest.x);
    float back = smoothstep(0.0, 1.5, waterCrestAlong);
    float front = smoothstep(0.0, 1.5, -waterCrestAlong);
    base = mix(base, base * vec3(0.35, 0.55, 1.2), back * 0.8);
    base = mix(base, base * vec3(1.2, 0.8, 0.3), front * 0.8);
    return mix(base, vec3(1.0, 0.1, 0.05), clamp(foam * 1.5, 0.0, 1.0));
  }
  if(view == 2) {
    float x = crest.x;
    vec3 ramp = clamp(vec3(1.5 * x - 0.25, 1.0 - 2.0 * abs(x - 0.5), 1.25 - 1.5 * x), 0.0, 1.0);
    float threshold = 1.0 - waterWindFoam();
    float line = 1.0 - smoothstep(0.0, 1.5 * fwidth(x) + 1e-4, abs(x - threshold));
    return mix(ramp, vec3(1.0), line);
  }
  if(view == 3) {
    float g = clamp((waterGust - 1.0) * 2.0, -1.0, 1.0);
    vec3 base = g > 0.0 ? mix(vec3(1.0), vec3(0.85, 0.1, 0.05), g) : mix(vec3(1.0), vec3(0.05, 0.25, 0.9), -g);
    return mix(base, vec3(0.1, 0.7, 0.3), waterSlick * 0.8);
  }
  return color;
}