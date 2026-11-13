// Shared ocean surface shading: the waves from a sea state's layers (sea-layers.glsl),
// Fresnel, reflection and sun glint, and wind-driven and contact foam. The Ocean surface and the
// Sky's endless sea both include it, so they read the same uniforms and look the same.
//
// ⚠️ oceanWaves, oceanFresnel and oceanFoam take screen-space derivatives: call them under
// uniform control flow.

// Maximum number of floating-object contact footprints that can spread foam on
// the surface (see uContactCount / uContactA / uContactB).
#ifndef OCEAN_CONTACT_COUNT
#define OCEAN_CONTACT_COUNT 8
#endif
// The foam's texture (oceanWaves' `crest`): standard deviations each side of its middle, and
// how much the finest layer breaks up the wind sea's crests.
#define OCEAN_CREST_SPAN 3.0
#define OCEAN_CREST_FINE 0.6
#define OCEAN_CREST_RIPPLES 0.4
// The foam's albedo, lit (Dupuy and Bruneton 2012 use 0.4, after Koepke 1984; fresh foam is
// brighter).
#define OCEAN_FOAM_ALBEDO 0.8

uniform float uTime;
// Octaves of the shore's ragged edge noise (oceanFbm). A uniform, not a define: Direct3D then
// keeps its loop a loop rather than a copy per octave, at every one of its calls.
uniform int uOceanDetailOctaves;
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

uniform vec3 uFoamColor;
uniform float uFoamAmount;
// ⚠️ Tuning (OceanFoamTuning; its defaults in ocean-material.ts, OCEAN_FOAM_*_DEFAULT): x the
// finer waves' share in the crests (×), y the rim's width up close, z the froth, w the thin
// foam's falloff (where it turns opaque).
uniform vec4 uFoamShape;
// ⚠️ Tuning: x the far fade, y the most foam covers, z how much it is lit by the wave, w the
// lift (a brighter rim).
uniform vec4 uFoamLook;
// ⚠️ Tuning: x the grain's strength, y its cell (m), z how narrow the foam is drawn toward
// the crest lines, w the debug view (oceanDebugView): 0 none.
uniform vec4 uFoamGrain;
// The crests' slope along the wind at the pixel, in standard deviations, as oceanWaves last
// found it: > 0 on a crest's back (where its foam trails), < 0 on its front.
float oceanCrestAlong;

uniform float uFresnelPower;
uniform float uDetailScale;    // the foam's feature frequency (per world unit)
uniform vec2 uDetailFade;      // distances from the camera over which the waves fade to a flat mirror

// Contact foam from floating objects (e.g. a vessel hull). Each active contact
// is an oriented ellipse footprint: uContactA = vec4(centerX, centerZ, forwardX,
// forwardZ) with forward the UNIT DIRECTION the object points in (not the sine
// and cosine of its heading — see OceanMaterial.setContacts), uContactB =
// vec4(halfLength, halfWidth, foamWidth, intensity), uContactC =
// vec4(endFalloff, unused...). uContactCount active entries; 0 = no objects, so
// the loop exits immediately (no cost when nothing floats on the ocean).
uniform int uContactCount;
uniform vec4 uContactA[OCEAN_CONTACT_COUNT];
uniform vec4 uContactB[OCEAN_CONTACT_COUNT];
uniform vec4 uContactC[OCEAN_CONTACT_COUNT];

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
// ⚠️ Tuning (OceanWaveTuning.roughReflect): how much rougher water turns the reflection, 1.
uniform float uRoughReflect;
// As oceanWaves last found them: the local wind over the mean, the slick there (0 to 1), and
// the slope variance the pixel cannot show as it would be without either.
float oceanGust = 1.0;
float oceanSlick = 0.0;
float oceanRoughMean = 0.0;
// How much a slick damps the short waves the gusts move (Cox and Munk's slicks keep about 40 %
// of the whole slope variance at 10 m/s).
#define OCEAN_SLICK_DAMPING 0.8

// The short waves' slope variance in a local wind `g` times the mean, over the mean's: through
// uWeatherGustRough, linear between.
float oceanGustRough(float g) {
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
// variance the pixel cannot show (oceanWaves): its facets tilted every way see higher up the
// sky, as cat's paws darken against the bright horizon a glassy sea mirrors. `r` the mirror
// direction, `up` the sea's up; nothing changes at the mean.
vec3 oceanRoughReflect(vec3 r, vec3 up, float rough) {
  return normalize(r + up * (uRoughReflect * (sqrt(rough) - sqrt(oceanRoughMean))));
}

// Smith's masking of a Beckmann surface of slope variance `rough` (both axes) seen at `ndv`.
// ⚠️ Kept off 0 (a facet turned from the camera, ndv 0): the ratio of two is 0/0 there, NaN,
// which draws black.
float oceanMasking(float ndv, float rough) {
  float a = max(ndv, 1e-3) * inversesqrt(max(0.5 * rough * (1.0 - ndv * ndv), 1e-8));
  if(a >= 1.6)
    return 1.0;
  return 1.0 / (1.0 + (1.0 - 1.259 * a + 0.396 * a * a) / (3.535 * a + 2.181 * a * a));
}

// The reflection's `fresnel` at `ndv` for water rougher (or smoother) than the mean: its facets
// hide each other more as it roughens, toward grazing. Nothing changes at the mean.
float oceanRoughFresnel(float fresnel, float ndv, float rough) {
  float ratio = oceanMasking(ndv, rough) / max(oceanMasking(ndv, oceanRoughMean), 1e-4);
  return clamp(fresnel * mix(1.0, ratio, uRoughReflect), 0.0, 1.0);
}

// 0 up close, 1 where the sea has faded to a flat mirror, `dist` from the camera.
float oceanFlatness(float dist) {
  return smoothstep(uDetailFade.x, uDetailFade.y, dist);
}

// --- Procedural value noise / FBM (world-space input) -----------------------

// Dave Hoskins hash12: well-distributed and far less prone to the axis-aligned
// banding the cheaper fract(sin())/fract(p*c) hashes show at the large world
// coordinates used at oilfield scale.
float oceanHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float oceanNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = oceanHash(i + vec2(0.0, 0.0));
  float b = oceanHash(i + vec2(1.0, 0.0));
  float c = oceanHash(i + vec2(0.0, 1.0));
  float d = oceanHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian motion with per-octave domain ROTATION. Rotating (and
// offsetting) each octave stops the octaves' integer lattices from aligning,
// which is the dominant source of visible repeating patterns in a summed
// value-noise field. The result is normalised to [0,1].
float oceanFbm(vec2 p) {
  const mat2 rot = mat2(0.8, -0.6, 0.6, 0.8); // ~36.9 deg
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for(int i = 0; i < uOceanDetailOctaves; i++) {
    sum += amp * oceanNoise(p);
    norm += amp;
    p = rot * p * 2.03 + 17.1; // rotate + scale + offset per octave
    amp *= 0.5;
  }
  return sum / max(norm, 1e-4);
}

// The squared size on the wave plane of the pixel at `p`, its longer side. ⚠️ Derivatives.
float seaPixel2(vec2 p) {
  vec2 dx = dFdx(p);
  vec2 dy = dFdy(p);
  return max(dot(dx, dx), dot(dy, dy));
}

// A layer's mip for a pixel `pixel2` (seaPixel2) across: from the texels it spans. The turn
// into the tile keeps lengths, so this is the mip the tile point's own derivatives give.
float seaLayerLod(vec4 layer, float pixel2) {
  float texels = layer.x * layer.w;
  return 0.5 * log2(max(pixel2 * texels * texels, 1e-8));
}

// One layer at `p`, filtered to a pixel `pixel2` (seaPixel2) across.
vec4 seaLayerAt(sampler2D map, int index, vec2 p, float pixel2) {
  vec4 layer = uSeaLayers[index];
  return seaLayerRead(map, layer, uSeaLayerStats[index], index, seaLayerUv(layer, p), seaLayerLod(layer, pixel2));
}

// The waves at `p` of the wave plane (+Y up), from the sea state's layers, each filtered to
// the pixel: the normal, with the slope and height for the foam; `crest` the finer layers'
// heights over their spread, as [0, 1] (x all but the longest, y the finest), the foam's
// texture; and `rough` the slope variance (both axes) the pixel cannot show: what the mips
// filter out, and the waves no layer draws. `flatness` (oceanFlatness) fades the slopes
// drawn into that roughness, far off and where two of a Scenery's charts meet; all faded,
// no layer is read.
// ⚠️ Derivatives.
vec3 oceanWaves(vec2 p, float flatness, out vec2 slope, out float height, out vec2 crest, out float rough) {
  oceanCrestAlong = 0.0;
  oceanGust = 1.0;
  oceanSlick = 0.0;
  float pixel2 = seaPixel2(p);
  float s2 = uSteepness * uSteepness;
  float detailGain2 = uSeaDetail.x * uSeaDetail.x;
  float total = uSeaLayerStats[0].x + uSeaLayerStats[1].x + uSeaLayerStats[2].x;
  #if SEA_LAYERS > 3
  total += uSeaLayerStats[3].x;
  #endif
  total += detailGain2 * uSeaLayerStats[SEA_FINEST].x;
  float detail = 1.0 - flatness;
  if(detail <= 0.001) {
    slope = vec2(0.0);
    height = 0.0;
    crest = vec2(0.5);
    rough = total * s2 + uSeaResidual;
    oceanRoughMean = rough;
    return vec3(0.0, 1.0, 0.0);
  }
  vec2 wind = uWindDirection / max(length(uWindDirection), 1e-6);
  // The weather's gusts and slicks roughen and calm the short waves: what no layer draws by
  // the spectrum's answer to the local wind, the ripples and the finest layer a share of it.
  // Faded with the waves (far off, and where two of a Scenery's charts meet); the slicks'
  // damping over its mean, so a sea too far off to show them is as rough as without.
  float gustRough = 1.0;
  if(uWeatherGusts.x > 0.0 || uWeatherGusts.z > 0.0) {
    float slick;
    float g = weatherWindAt(p, wind, uWeatherGustTravel, uWeatherGusts, sqrt(pixel2), slick);
    oceanGust = mix(1.0, g, detail);
    oceanSlick = slick * detail;
    gustRough = oceanGustRough(oceanGust) * (1.0 - OCEAN_SLICK_DAMPING * oceanSlick) / (1.0 - OCEAN_SLICK_DAMPING * WEATHER_SLICK_MEAN * uWeatherGusts.z);
  }
  // What that adds to the slopes drawn, and to all of them: the mean less these is the mean.
  float gustSlope = 0.0;
  float gustTotal = 0.0;
  vec4 l0 = seaLayerAt(uSeaSurface0, 0, p, pixel2);
  vec4 l1 = seaLayerAt(uSeaSurface1, 1, p, pixel2);
  vec4 l2 = seaLayerAt(uSeaSurface2, 2, p, pixel2);
  vec4 fine = l2;
  float fineVariance = uSeaLayerStats[2].y;
  vec4 sum = l0 + l1 + l2;
  // The wind sea's crests: the 307 m and 47 m layers; a finer one only breaks them up.
  float crestHeight = l1.z + l2.z;
  float crestVariance = uSeaLayerStats[1].y + uSeaLayerStats[2].y;
  float zCrestFine = l2.z * inversesqrt(max(uSeaLayerStats[2].y, 1e-8));
  #if SEA_LAYERS > 3
  vec4 l3 = seaLayerAt(uSeaSurface3, 3, p, pixel2);
  // The finest layer (7.3 m on medium) answers the local wind by half (it lies mostly above
  // the short waves).
  float gustLayer = mix(1.0, sqrt(gustRough), 0.5);
  float gustLayer2 = gustLayer * gustLayer - 1.0;
  gustSlope += gustLayer2 * l3.w;
  gustTotal += gustLayer2 * uSeaLayerStats[3].x;
  l3 *= vec4(gustLayer, gustLayer, gustLayer, gustLayer * gustLayer);
  fine = l3;
  fineVariance = uSeaLayerStats[3].y;
  sum += l3;
  #endif
  // The ripples, where drawn (SEA_DETAIL): the finest layer again, smaller, its slopes by the
  // gain (heights by the gain over the scale), on its own hex cells, sliding under them
  // downwind; by the local wind.
  #ifdef SEA_DETAIL
  vec4 ripples = seaLayerReadShifted(uSeaFinest, uSeaDetailLayer, uSeaLayerStats[SEA_FINEST], SEA_LAYERS, seaLayerUv(uSeaDetailLayer, p), uSeaDetail.yz, seaLayerLod(uSeaDetailLayer, pixel2));
  float rippleGain = uSeaDetail.x * sqrt(gustRough);
  float rippleGain2 = rippleGain * rippleGain;
  sum += ripples * vec4(rippleGain, rippleGain, rippleGain * uSeaLayers[SEA_FINEST].x / uSeaDetailLayer.x, rippleGain2);
  gustSlope += (rippleGain2 - detailGain2) * ripples.w;
  gustTotal += (rippleGain2 - detailGain2) * uSeaLayerStats[SEA_FINEST].x;
  #endif
  total += gustTotal;
  // What breaks the crests up finest (and froths the foam, `crest.y`): the layer below the 47 m
  // one, else the ripples, else the 47 m layer itself.
  #if SEA_LAYERS > 3
  float zDetail = l3.z * inversesqrt(max(uSeaLayerStats[3].y, 1e-8));
  #elif defined(SEA_DETAIL)
  float zDetail = ripples.z * inversesqrt(max(fineVariance, 1e-8));
  #else
  float zDetail = zCrestFine;
  #endif
  // What the pixel resolves of the layers' slopes: all of them less what its mips filter out.
  float resolved = max(total - sum.w, 0.0);
  slope = sum.xy * detail * uSteepness;
  height = sum.z * detail;
  float unresolved = 1.0 - detail * detail;
  rough = (sum.w + unresolved * resolved) * s2 + uSeaResidual * gustRough;
  oceanRoughMean = (sum.w - gustSlope + unresolved * max(total - gustTotal - sum.w + gustSlope, 0.0)) * s2 + uSeaResidual;
  // The wind sea's crests (the 307 m and 47 m layers), broken up by the 47 m layer's and the
  // finer waves', in standard deviations: ±3 over [0, 1] (OCEAN_CREST_SPAN).
  float crestFine = OCEAN_CREST_FINE * uFoamShape.x;
  #if SEA_LAYERS > 3 || defined(SEA_DETAIL)
  float crestRipples = OCEAN_CREST_RIPPLES * uFoamShape.x;
  #else
  float crestRipples = 0.0;
  #endif
  float zCrest = (crestHeight * inversesqrt(max(crestVariance, 1e-8)) + crestFine * zCrestFine + crestRipples * zDetail) * inversesqrt(1.0 + crestFine * crestFine + crestRipples * crestRipples);
  // ⚠️ Tuning (uFoamGrain.z): narrowed toward the crest lines, where the crests' slope along the
  // wind is nil, lowered by its size there in standard deviations (a half-normal, centred and
  // rescaled so as much of the sea stays over the threshold): long along a crest, thin across.
  vec2 crestSlope = l1.xy + l2.xy;
  float crestSlopeVariance = uSeaLayerStats[1].x + uSeaLayerStats[2].x;
  // Along one axis, half the slope variance of both. Rising downwind (> 0) on a crest's back,
  // the side its foam trails on as the crest runs on.
  oceanCrestAlong = dot(crestSlope, wind) * inversesqrt(max(0.5 * crestSlopeVariance, 1e-10));
  float narrow = uFoamGrain.z;
  if(narrow > 0.0)
    zCrest = (zCrest - narrow * (abs(oceanCrestAlong) - 0.7978846)) * inversesqrt(1.0 + narrow * narrow * 0.3633802);
  crest = clamp(0.5 + vec2(zCrest, zDetail) / (2.0 * OCEAN_CREST_SPAN), 0.0, 1.0);
  return normalize(vec3(-slope.x, 1.0, -slope.y));
}

// Fresnel, analytically widened to avoid grazing-angle shading aliasing. `ndvAA` is the
// widened cosine. Clamped to 1: looking straight down on a flat normal it rounds a hair over,
// and pow() of the negative base is NaN. Water reflects 2 % straight on (OCEAN_F0).
#define OCEAN_F0 0.02
float oceanFresnel(vec3 N, vec3 V, out float ndvAA) {
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  ndvAA = min(max(ndv, fwidth(ndv)), 1.0);
  return mix(OCEAN_F0, 1.0, pow(1.0 - ndvAA, uFresnelPower));
}

// The sun's glint off the waves: `rough` the slope variance the pixel cannot show
// (oceanWaves); `glint` scales it.
vec3 oceanGlint(vec3 N, vec3 V, float glint, float rough) {
  vec3 H = normalize(V + normalize(uSunDirection));
  float ndh = max(dot(N, H), 0.0);
  // The slopes the pixel cannot show still scatter the sun: their variance widens the glint
  // (the exponent read as a Beckmann roughness), at the same energy, so from far off or high
  // up it spreads into a broad patch. The added spread (uSunGlintSpread) keeps its peak
  // instead, so the path also brightens.
  float shininess = uSunShininess;
  float energy = 1.0;
  if(rough > 0.0 || uSunGlintSpread > 0.0) {
    float base = 2.0 / (uSunShininess + 2.0);
    float roughness = base + rough;
    shininess = 2.0 / (roughness + uSunGlintSpread) - 2.0;
    energy = base / roughness;
  }
  return uSunColor * pow(ndh, shininess) * energy * glint;
}

// The surface as a layer over what lies under it, premultiplied: the sky it reflects by
// `fresnel` and the sun's glint, covering `fresnel` of what lies under it. The water's own
// colour is not the surface's: it is what lies under it, each faded by its own path through
// the water (water-fog.glsl), the seabed, the void, the data, or the deep water.
vec4 oceanSurfaceLayer(vec3 N, vec3 V, vec3 sky, float fresnel, float glint, float rough) {
  return vec4(sky * uReflectionIntensity * fresnel + oceanGlint(N, V, glint, rough), fresnel);
}

// A premultiplied layer as colour and opacity, for blending. Its colour is kept no brighter
// than 1 where it can be, its opacity raised instead: a target may clamp a straight colour
// before it blends (the glint over Fresnel's 2 % is fifty times the glint), and where the glint
// or the sky outshines that, it outshines what lies under it too.
vec4 oceanStraight(vec4 layer) {
  float a = clamp(max(layer.a, max(layer.r, max(layer.g, layer.b))), 1e-3, 1.0);
  return vec4(layer.rgb / a, a);
}

// --- Foam: whitecaps on the wind sea's highest crests -------------------------
// The share of the sea whitecaps cover (Monahan and O'Muircheartaigh 1980: 3.84e-6·U^3.41, about
// 1 % at 10 m/s and 10 % at 20 m/s; uFoamAmount 0.5 as measured), as the coverage that leaves
// that share of the crests' texture (oceanWaves' `crest`) over oceanFoam's threshold.
float oceanWindFoam() {
  float share = min(3.84e-6 * pow(max(uWindSpeed, 0.0), 3.41) * 2.0 * uFoamAmount, 0.5);
  if(share <= 1e-5)
    return 0.0;
  // How many standard deviations up only that share of the crests stands: the normal's
  // upper tail inverted (Abramowitz and Stegun 26.2.23).
  float t = sqrt(-2.0 * log(share));
  float z = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1.0 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return clamp(0.5 - z / (2.0 * OCEAN_CREST_SPAN), 0.0, 1.0);
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
float oceanContactFoam(vec2 p, float t) {
  float foam = 0.0;
  for(int i = 0; i < OCEAN_CONTACT_COUNT; i++) {
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

// How much foam a `coverage` draws, before its distance fade. The coverage is thresholded
// against the foam's texture, the wind sea's crests (oceanWaves' `crest`), with the
// threshold's transition width tracking the pixel footprint: edges stay crisp (and get crisper
// as the camera approaches) yet remain anti-aliased at distance. The finest waves break it up
// further up close. `foamFar` -> 1 once the foam's detail is sub-pixel, where the share of
// the texture over the threshold is drawn instead: an even tint, none without coverage.
float oceanFoam(vec2 crest, vec2 p, float texel, float coverage, out float foamFar) {
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
    float n = 0.6 * oceanNoise(q) + 0.4 * oceanNoise(mat2(0.8, -0.6, 0.6, 0.8) * q * 2.3 + 17.1);
    grain = (n - 0.5) * 1.6 * grainAmount;
  }
  foamTex += grain * 0.15;

  // Higher coverage lowers the threshold => more of the texture becomes foam.
  float foamT = 1.0 - coverage;

  // Edge softness: crisp and anti-aliased at distance, wider up close (uFoamShape.y) so the
  // foam's fringe feathers into the water rather than a hard cut-out.
  float edge = clamp(fwidth(foamTex) + 0.01, 0.01, 0.5) + closeness * uFoamShape.y;
  float near = smoothstep(foamT - edge, foamT + edge, foamTex);
  // Sub-pixel: the share of the texture (a standard normal over ±OCEAN_CREST_SPAN) over the
  // threshold, its tail as a logistic.
  float far = smoothstep(0.0, 0.05, coverage) / (1.0 + exp(-3.4 * OCEAN_CREST_SPAN * (coverage - 0.5)));
  float foam = mix(near, far, foamFar);

  // Up close the finest waves modulate the fill, so it reads as clumpy froth, not a sheet.
  float froth = mix(1.0, 1.0 - uFoamShape.z + uFoamShape.z * crest.y, closeness);
  foam *= froth;
  // Thin foam speckled by the grain.
  foam *= 1.0 - max(grain, 0.0) * 2.0 * (1.0 - foam);

  // Thin foam blends in gently; only the densest reaches full white (uFoamShape.w where).
  foam *= mix(1.0, smoothstep(0.05, max(uFoamShape.w, 0.06), foam), closeness);
  return clamp(foam, 0.0, 1.0) * uFoamLook.y;
}

// Foam over a premultiplied surface `layer` at `opacity` (oceanFoam), its colour `foamColor`.
// Lit (as much as uFoamLook.z says, else flat), it is a rough surface on the wave, in the same
// light as the water: `sky` the sky's light toward the wave's normal `N`, `sun` the sun's
// colour as it reaches the sea (shadowed), as the glint has them; brighter at its rim by
// uFoamLook.w.
vec4 oceanFoamOver(vec4 layer, vec3 foamColor, vec3 N, float opacity, vec3 sky, vec3 sun) {
  vec3 lit = foamColor * OCEAN_FOAM_ALBEDO * (sky + sun * clamp(dot(N, normalize(uSunDirection)), 0.0, 1.0));
  vec3 foam = mix(foamColor, lit, uFoamLook.z) * (1.0 + uFoamLook.w * 4.0 * opacity * (1.0 - opacity));
  return vec4(foam * opacity + layer.rgb * (1.0 - opacity), opacity + layer.a * (1.0 - opacity));
}

// ⚠️ Debug (uFoamGrain.w), in place of the surface's `color`:
// 1 whitecaps: grey by the crests' height (oceanWaves' `crest`); red where foam forms (`foam`,
//   oceanFoam's), blue on the crests' backs, where the foam trails as they run on downwind,
//   amber on their fronts;
// 2 crests: the crests' height as a ramp (blue low, red high), the foam's threshold for the
//   wind (oceanWindFoam) as a white line;
// 3 wind: the local wind over the mean (oceanGust; blue a lull, white the mean, red a gust,
//   full at ±50 %), green where a slick lies.
vec3 oceanDebugView(vec3 color, vec2 crest, float foam) {
  int view = int(uFoamGrain.w + 0.5);
  if(view == 1) {
    vec3 base = vec3(0.15 + 0.7 * crest.x);
    float back = smoothstep(0.0, 1.5, oceanCrestAlong);
    float front = smoothstep(0.0, 1.5, -oceanCrestAlong);
    base = mix(base, base * vec3(0.35, 0.55, 1.2), back * 0.8);
    base = mix(base, base * vec3(1.2, 0.8, 0.3), front * 0.8);
    return mix(base, vec3(1.0, 0.1, 0.05), clamp(foam * 1.5, 0.0, 1.0));
  }
  if(view == 2) {
    float x = crest.x;
    vec3 ramp = clamp(vec3(1.5 * x - 0.25, 1.0 - 2.0 * abs(x - 0.5), 1.25 - 1.5 * x), 0.0, 1.0);
    float threshold = 1.0 - oceanWindFoam();
    float line = 1.0 - smoothstep(0.0, 1.5 * fwidth(x) + 1e-4, abs(x - threshold));
    return mix(ramp, vec3(1.0), line);
  }
  if(view == 3) {
    float g = clamp((oceanGust - 1.0) * 2.0, -1.0, 1.0);
    vec3 base = g > 0.0 ? mix(vec3(1.0), vec3(0.85, 0.1, 0.05), g) : mix(vec3(1.0), vec3(0.05, 0.25, 0.9), -g);
    return mix(base, vec3(0.1, 0.7, 0.3), oceanSlick * 0.8);
  }
  return color;
}