// Shared ocean surface shading: the wave normal with its micro ripples, Fresnel, the
// large-scale tonal variation, reflection and sun glint, and wind-driven and contact
// foam. The Ocean surface and the Sky's endless sea both include it, so they read the
// same uniforms and look the same.
//
// ⚠️ oceanFresnel, oceanTonal and oceanFoam take screen-space derivatives: call them
// under uniform control flow.

#ifndef OCEAN_WAVE_COUNT
#define OCEAN_WAVE_COUNT 16
#endif
#ifndef OCEAN_DETAIL_OCTAVES
#define OCEAN_DETAIL_OCTAVES 4
#endif
// Maximum number of floating-object contact footprints that can spread foam on
// the surface (see uContactCount / uContactA / uContactB).
#ifndef OCEAN_CONTACT_COUNT
#define OCEAN_CONTACT_COUNT 8
#endif
// Share of the foam lost once its detail goes sub-pixel.
#define OCEAN_FOAM_FAR_FADE 0.85
// The foam noise's spread about its mean, which stands in for it once sub-pixel.
#define OCEAN_FOAM_SPREAD 0.2
// The sea's mean square slope for a wind (m/s), the small waves included (Cox and Munk).
#define OCEAN_COX_MUNK(wind) (0.003 + 0.00512 * (wind))

uniform float uTime;
uniform vec2 uWindDirection;
uniform float uWindSpeed; // m/s (drives foam coverage)
uniform float uSignificantHeight; // Hs (m) for foam crest normalisation
uniform float uSteepness; // apparent choppiness (normal exaggeration)

uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform float uOpacity; // base body opacity (looking straight down)

uniform float uTonalVariation; // strength of large-scale tonal variation
uniform float uTonalScale;     // frequency of the tonal variation (per world unit)
uniform float uTonalSharpness; // 0 = soft gradient, 1 = hard-edged patches
uniform vec3 uTonalColor;      // tint waters drift toward (currents / algae / pollution)

uniform float uReflectionIntensity;

uniform vec3 uSunDirection; // world space, normalised
uniform vec3 uSunColor;
uniform float uSunShininess;
uniform float uSunGlintSpread; // roughness added to the glint, widening its path; 0 = none

uniform vec3 uFoamColor;
uniform float uFoamAmount;

uniform float uFresnelPower;
uniform float uDetailScale;    // micro-ripple frequency (waves per world unit)
uniform float uDetailStrength; // micro-ripple normal strength
uniform vec2 uDetailFade;      // distances from the camera over which the detail fades to a flat mirror
uniform float uSlopeVariance;  // mean square slope of the wave field

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

#include ./waves.glsl

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
  for(int i = 0; i < OCEAN_DETAIL_OCTAVES; i++) {
    sum += amp * oceanNoise(p);
    norm += amp;
    p = rot * p * 2.03 + 17.1; // rotate + scale + offset per octave
    amp *= 0.5;
  }
  return sum / max(norm, 1e-4);
}

// The surface normal at `worldXZ` (+Y up, in the X/Z wave plane), with the spectral
// `slope` and `height` for the foam and `np`, the wind-drifted coordinates the fine
// detail is drawn in. `texel` is world units per pixel; `flatness` (oceanFlatness)
// fades the waves out. `rough` is the slope variance the pixel cannot show (oceanShade).
vec3 oceanWaveNormal(vec2 worldXZ, float texel, float flatness, out vec2 slope, out float height, out vec2 np, out float rough) {
  float detail = 1.0 - flatness;
  slope = vec2(0.0);
  height = 0.0;
  float kept = 0.0;
  if(detail > 0.001) {
    // --- Break the periodicity of the finite spectral sum -------------------
    // The wave field is a finite sum of sinusoids, so it tiles *exactly* in
    // world space; from very far away (where the micro-ripple FBM that normally
    // masks it has faded below the pixel footprint) that exact period reads as a
    // repeating diagonal "corduroy". A large-scale, slowly varying domain warp
    // meanders the sample position by a kilometre-scale wander so the wave train
    // never lines up into a visible tile — much like real swell refracting. The
    // warp frequency is very low, so it adds no high-frequency distortion (the
    // local wavelengths/slope are essentially unchanged); the unwarped `texel`
    // remains valid for AA. Sampled only for the fragment normals; the optional
    // vertex displacement (off by default, for floating-object support) is a
    // separate low-frequency path and does not need it.
    vec2 warp = vec2(oceanFbm(worldXZ * 0.0009 + 31.7), oceanFbm(worldXZ * 0.0009 + 67.3)) - 0.5;
    vec2 waveXZ = worldXZ + warp * 240.0;

    // --- Spectral wave surface: per-pixel slope + height --------------------
    oceanSurface(waveXZ, uTime, texel, slope, height, kept);
    slope *= detail;
    height *= detail;
  }

  // Surface normal from the slope; uSteepness exaggerates apparent choppiness.
  vec3 N = normalize(vec3(-slope.x * uSteepness, 1.0, -slope.y * uSteepness));

  // --- Near-field micro ripples (fine FBM), footprint-faded -----------------
  // Drift with the wind in world space (seamless across tiles). Fades in only
  // where the fine ripples are large enough on screen to resolve (i.e. close),
  // which keeps crisp detail up close without shimmer at distance — and, being
  // footprint-based, adds no LOD ring.
  vec2 flow = uWindDirection * uTime * (0.5 + uWindSpeed * 0.1);
  np = (worldXZ + flow) * uDetailScale;
  // Calm-water response: as the wind drops toward still, fade out the fine
  // surface ripples so the ocean settles to a near-glassy sheet. A small floor
  // keeps a faint texture so calm water never reads as a dead mirror.
  float windDetail = mix(0.05, 1.0, smoothstep(0.5, 6.0, uWindSpeed));
  float microK = uDetailScale * 4.0 * 6.2831853;
  // Gradual footprint falloff: ramp down over a wide range so the micro detail
  // is never at full strength right at the camera (which read as too dominant)
  // and instead stays faintly visible much farther out before vanishing near
  // the Nyquist limit. `1.0 - smoothstep` over a wide band gives a long, gentle
  // tail rather than a hard near plateau + sudden cutoff.
  float microAA = 1.0 - smoothstep(0.25, 4.0, microK * texel);
  microAA *= microAA; // bias toward lower blend, softer near the camera
  microAA *= detail;
  // Too small for the pixel or faded out with distance, the slopes still roughen the glint: the
  // waves left out, and the small ones no wave stands for once the ripples fade.
  float s2 = uSteepness * uSteepness;
  float small = max(OCEAN_COX_MUNK(uWindSpeed) - uSlopeVariance * s2, 0.0);
  rough = max(uSlopeVariance - kept * detail * detail, 0.0) * s2 + small * (1.0 - microAA);
  if(microAA > 0.001) {
    float e = 0.5;
    vec2 mp = np * 4.0;
    float mL = oceanFbm(mp - vec2(e, 0.0));
    float mR = oceanFbm(mp + vec2(e, 0.0));
    float mD = oceanFbm(mp - vec2(0.0, e));
    float mU = oceanFbm(mp + vec2(0.0, e));
    N = normalize(N + vec3((mL - mR), 0.0, (mD - mU)) * uDetailStrength * microAA * windDetail);
  }
  return N;
}

// Fresnel, analytically widened to avoid grazing-angle shading aliasing. `ndvAA` is the
// widened cosine, which also stands in for depth in the body colour. Clamped to 1: looking
// straight down on a flat normal it rounds a hair over, and pow() of the negative base is NaN.
float oceanFresnel(vec3 N, vec3 V, out float ndvAA) {
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  ndvAA = min(max(ndv, fwidth(ndv)), 1.0);
  return pow(1.0 - ndvAA, uFresnelPower);
}

// --- Large-scale tonal variation (currents / slicks) ------------------------
// A very low-frequency, world-space variation so the open water is not a flat
// uniform colour when viewed from far away. Two decorrelated noise fields give
// a one-sided brightness lift (currents catch the light) and a subtle hue
// shift toward uTonalColor (slick / algae / pollution). Low frequency, so no
// footprint fade; it fades with distance instead (`flatness`), since many small
// patches on screen read as noise. `tonalReflect` scales the reflection and
// `tonalSpec` the sun glint.
// ⚠️ The branch is per pixel: its derivatives are only unreliable where the
// variation has faded to nothing.
void oceanTonal(vec2 worldXZ, float flatness, inout vec3 waterColor, out float tonalReflect, out float tonalSpec) {
  tonalReflect = 1.0;
  tonalSpec = 1.0;
  float variation = uTonalVariation * (1.0 - flatness);
  if(variation > 0.001) {
    vec2 tonalP = worldXZ * uTonalScale;
    float tonal = oceanFbm(tonalP + 5.7);
    float tonal2 = oceanFbm(tonalP * 1.7 + 21.3);
    // Optionally crispen the patch boundaries. uTonalSharpness narrows the
    // transition band around the noise mid-point so currents/slicks read as
    // distinct, well-defined regions instead of a soft drift. The band is
    // floored at the per-pixel footprint (fwidth) so the edges stay anti-aliased
    // even at distance. 0 keeps the original smooth FBM gradient.
    if(uTonalSharpness > 0.0) {
      float s = clamp(uTonalSharpness, 0.0, 1.0);
      float w1 = max(mix(0.5, 0.015, s), fwidth(tonal));
      float w2 = max(mix(0.5, 0.015, s), fwidth(tonal2));
      tonal = smoothstep(0.5 - w1, 0.5 + w1, tonal);
      tonal2 = smoothstep(0.5 - w2, 0.5 + w2, tonal2);
    }
    waterColor *= mix(1.0, 1.0 + variation * 0.5, tonal);
    waterColor = mix(waterColor, waterColor * uTonalColor, tonal2 * variation);
    // The tinted patches are also slightly less reflective, so the tonal
    // variation reads as a change in water surface, not just colour.
    tonalReflect = 1.0 - tonal2 * variation * 0.5;
    // The specular sun glint is modulated much more strongly than the diffuse
    // reflection so the patches read as distinctly calmer/glossier water: the
    // brighter (tonal) patches sparkle more, the tinted (tonal2) patches less.
    tonalSpec = clamp(1.0 + (tonal - tonal2) * variation * 2.0, 0.0, 3.0);
  }
}

// The lit surface: the body colour against the reflection by Fresnel, plus the sun's
// glint. `sky` is the sky's colour in the reflected direction, reflect(-V, N); `rough` the
// slope variance the pixel cannot show (oceanWaveNormal).
vec3 oceanShade(vec3 N, vec3 V, vec3 waterColor, vec3 sky, float fresnel, float tonalReflect, float tonalSpec, float rough) {
  vec3 reflection = sky * uReflectionIntensity * tonalReflect;

  // Modulated more strongly than the reflection (tonalSpec) so the tonal
  // patches show a pronounced difference in sun glint.
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
  vec3 specular = uSunColor * spec * tonalSpec;

  return mix(waterColor, reflection, fresnel) + specular;
}

// --- Foam: whitecaps where the spectral surface is steep / cresting ----------
// Wind drives coverage (uWindSpeed is the average wind in m/s); little/no foam
// in calm conditions, white caps once the wind picks up.
float oceanWindFoam(vec2 slope, float height) {
  float windFoam = smoothstep(4.0, 14.0, uWindSpeed);
  float crest = smoothstep(0.45, 0.9, height / max(uSignificantHeight, 1e-3));
  float steep = smoothstep(0.7, 1.4, length(slope) * uSteepness);
  return clamp((crest * 0.7 + steep * 0.7) * uFoamAmount * windFoam, 0.0, 1.0);
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

// How much foam a `coverage` draws, before its distance fade. The coverage is
// thresholded against a noise texture, with the threshold's transition width
// tracking the pixel footprint: edges stay crisp (and get crisper as the camera
// approaches) yet remain anti-aliased at distance. A finer foam octave fades in up
// close for sharp filaments. `foamFar` -> 1 once the foam detail is sub-pixel, where
// the share of foam a pixel holds is drawn instead: an even tint, none without coverage.
float oceanFoam(vec2 np, float texel, float coverage, out float foamFar) {
  float foamNoise = oceanFbm(np * 2.0 + 3.7);
  float fineK = uDetailScale * 8.0 * 6.2831853;
  float fineAA = 1.0 - smoothstep(0.5, 3.0, fineK * texel);
  // Skipped where its weight is 0; the fwidth below stays outside the branch.
  float foamTex = foamNoise;
  if(fineAA > 0.0)
    foamTex = mix(foamNoise, foamNoise * oceanFbm(np * 8.0 + 11.1) * 2.0, fineAA);
  foamTex = clamp(foamTex, 0.0, 1.0);

  // Foam feature footprint vs. pixel size: foamFar -> 1 when crests shrink below
  // a pixel (far away); closeness -> 1 when the camera is near and the foam is
  // well resolved.
  float foamK = uDetailScale * 2.0 * 6.2831853;
  foamFar = smoothstep(0.5, 4.0, foamK * texel);
  float closeness = 1.0 - foamFar;

  // Higher coverage lowers the threshold => more of the noise becomes foam.
  float foamT = 1.0 - coverage;

  // Edge softness: stay crisp + AA at distance, but WIDEN the transition band up
  // close so the foam fringe feathers into the water (frothy) rather than a hard,
  // high-contrast white cutout.
  float foamAaw = clamp(fwidth(foamTex) + 0.015, 0.01, 0.5);
  float edge = foamAaw + closeness * 0.2;
  // ⚠️ Sub-pixel, fwidth measures the aliasing: the edge it widens let foam through at no coverage.
  float spread = mix(edge, OCEAN_FOAM_SPREAD, foamFar);
  float foam = smoothstep(foamT - spread, foamT + spread, mix(foamTex, 0.5, foamFar));

  // Up close, modulate the foam fill with a finer bubble noise so it reads as
  // clumpy froth instead of a flat sheet of white — this breaks up the uniform
  // brightness that makes the foam look hard.
  float bubble = 0.5;
  if(closeness > 0.0)
    bubble = oceanFbm(np * 12.0 + 5.3);
  float froth = mix(1.0, 0.55 + 0.45 * bubble, closeness);
  foam *= froth;

  // Thin foam blends in gently as soft froth; only the densest foam reaches full
  // bright white. This ramps down the foam/water contrast up close while leaving
  // the crisp far look untouched.
  return foam * mix(1.0, smoothstep(0.05, 0.6, foam), closeness);
}
