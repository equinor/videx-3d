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
// Share of the foam lost once its detail goes sub-pixel.
#define OCEAN_FOAM_FAR_FADE 0.85
// The foam's texture (oceanWaves' `crest`): standard deviations each side of its middle, and
// how much the finest layer breaks up the wind sea's crests.
#define OCEAN_CREST_SPAN 3.0
#define OCEAN_CREST_FINE 0.6
#define OCEAN_CREST_RIPPLES 0.4

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
    return vec3(0.0, 1.0, 0.0);
  }
  vec4 l0 = seaLayerAt(uSeaSurface0, 0, p, pixel2);
  vec4 l1 = seaLayerAt(uSeaSurface1, 1, p, pixel2);
  vec4 l2 = seaLayerAt(uSeaSurface2, 2, p, pixel2);
  vec4 fine = l2;
  float fineVariance = uSeaLayerStats[2].y;
  vec4 sum = l0 + l1 + l2;
  float crestHeight = l1.z + l2.z;
  float crestVariance = uSeaLayerStats[1].y + uSeaLayerStats[2].y;
  #if SEA_LAYERS > 3
  vec4 l3 = seaLayerAt(uSeaSurface3, 3, p, pixel2);
  fine = l3;
  fineVariance = uSeaLayerStats[3].y;
  sum += l3;
  crestHeight += l3.z;
  crestVariance += uSeaLayerStats[3].y;
  #endif
  // The ripples: the finest layer again, smaller, its slopes by the gain (heights by the gain
  // over the scale), on its own hex cells, sliding under them downwind.
  vec4 ripples = seaLayerReadShifted(uSeaFinest, uSeaDetailLayer, uSeaLayerStats[SEA_FINEST], SEA_LAYERS, seaLayerUv(uSeaDetailLayer, p), uSeaDetail.yz, seaLayerLod(uSeaDetailLayer, pixel2));
  float zDetail = ripples.z * inversesqrt(max(fineVariance, 1e-8));
  sum += ripples * vec4(uSeaDetail.x, uSeaDetail.x, uSeaDetail.x * uSeaLayers[SEA_FINEST].x / uSeaDetailLayer.x, detailGain2);
  // What the pixel resolves of the layers' slopes: all of them less what its mips filter out.
  float resolved = max(total - sum.w, 0.0);
  slope = sum.xy * detail * uSteepness;
  height = sum.z * detail;
  rough = (sum.w + (1.0 - detail * detail) * resolved) * s2 + uSeaResidual;
  // The wind sea's crests (all but the longest layer), broken up by the finest layer's and the
  // ripples', in standard deviations: ±3 over [0, 1] (OCEAN_CREST_SPAN). `crest.y` the ripples.
  float zFine = fine.z * inversesqrt(max(fineVariance, 1e-8));
  float zCrest = (crestHeight * inversesqrt(max(crestVariance, 1e-8)) + OCEAN_CREST_FINE * zFine + OCEAN_CREST_RIPPLES * zDetail) * inversesqrt(1.0 + OCEAN_CREST_FINE * OCEAN_CREST_FINE + OCEAN_CREST_RIPPLES * OCEAN_CREST_RIPPLES);
  crest = clamp(0.5 + vec2(zCrest, zDetail) / (2.0 * OCEAN_CREST_SPAN), 0.0, 1.0);
  return normalize(vec3(-slope.x, 1.0, -slope.y));
}

// Fresnel, analytically widened to avoid grazing-angle shading aliasing. `ndvAA` is the
// widened cosine, which also stands in for depth in the body colour. Clamped to 1: looking
// straight down on a flat normal it rounds a hair over, and pow() of the negative base is NaN.
float oceanFresnel(vec3 N, vec3 V, out float ndvAA) {
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  ndvAA = min(max(ndv, fwidth(ndv)), 1.0);
  return pow(1.0 - ndvAA, uFresnelPower);
}

// The lit surface: the body colour against the reflection by Fresnel, plus the sun's
// glint. `sky` is the sky's colour in the reflected direction, reflect(-V, N); `rough` the
// slope variance the pixel cannot show (oceanWaves); `glint` scales the sun's.
vec3 oceanShade(vec3 N, vec3 V, vec3 waterColor, vec3 sky, float fresnel, float glint, float rough) {
  vec3 reflection = sky * uReflectionIntensity;

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
  float spec = pow(ndh, shininess) * energy;
  vec3 specular = uSunColor * spec * glint;

  return mix(waterColor, reflection, fresnel) + specular;
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
float oceanFoam(vec2 crest, float texel, float coverage, out float foamFar) {
  float foamTex = crest.x;

  // Foam feature footprint vs. pixel size: foamFar -> 1 when crests shrink below a pixel (far
  // away); closeness -> 1 when the camera is near and the foam is well resolved.
  float foamK = uDetailScale * 2.0 * 6.2831853;
  foamFar = smoothstep(0.5, 4.0, foamK * texel);
  float closeness = 1.0 - foamFar;

  // Higher coverage lowers the threshold => more of the texture becomes foam.
  float foamT = 1.0 - coverage;

  // Edge softness: crisp and anti-aliased at distance, a little wider up close so the foam's
  // fringe feathers into the water rather than a hard cut-out.
  float edge = clamp(fwidth(foamTex) + 0.01, 0.01, 0.5) + closeness * 0.03;
  float near = smoothstep(foamT - edge, foamT + edge, foamTex);
  // Sub-pixel: the share of the texture (a standard normal over ±OCEAN_CREST_SPAN) over the
  // threshold, its tail as a logistic.
  float far = smoothstep(0.0, 0.05, coverage) / (1.0 + exp(-3.4 * OCEAN_CREST_SPAN * (coverage - 0.5)));
  float foam = mix(near, far, foamFar);

  // Up close the finest waves modulate the fill, so it reads as clumpy froth, not a sheet.
  float froth = mix(1.0, 0.55 + 0.45 * crest.y, closeness);
  foam *= froth;

  // Thin foam blends in gently; only the densest reaches full white.
  return foam * mix(1.0, smoothstep(0.05, 0.6, foam), closeness);
}
