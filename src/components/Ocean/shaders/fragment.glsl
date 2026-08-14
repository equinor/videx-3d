// Ocean surface fragment shader (stylized).
//
// The visible wave shape is reconstructed per-pixel from the spectral wave
// model (see waves.glsl) as a surface normal, plus a fine procedural FBM micro-
// ripple layer for close-up detail. Everything is sampled in WORLD X/Z space so
// it tiles seamlessly across patched geometry; no texture assets are used.
//
// Level-of-detail is handled by per-component footprint anti-aliasing (each
// wave fades out smoothly when its wavelength approaches the on-screen pixel
// size) rather than a fixed world-distance fade, so there is no visible LOD
// ring/circle and the horizon does not shimmer.
//
// Reflections use a procedural analytic sky gradient, Fresnel-weighted against
// a tunable see-through water body. The material is OIT-compatible: it includes
// the shared oit.glsl chunk and routes its final colour through oitProcess() so
// it composites correctly with the other transparent subsurface geometry.

#ifndef OCEAN_WAVE_COUNT
#define OCEAN_WAVE_COUNT 16
#endif
#ifndef OCEAN_DETAIL_OCTAVES
#define OCEAN_DETAIL_OCTAVES 4
#endif
// Brightness multiplier applied when the surface is viewed from below (the
// underside, inside the water body) so looking up through the water reads
// darker than looking down onto the sky-lit top. 1.0 disables the effect.
#ifndef OCEAN_UNDERSIDE_DARKNESS
#define OCEAN_UNDERSIDE_DARKNESS 0.25
#endif
// Surf zone shape. These are the parts nobody has information to tune, so they are
// constants rather than knobs.
// A floor on the wave height standing in for background swell: an open coast
// breaks in a dead calm, and without this the shore would go glassy at wind 0.
#ifndef OCEAN_SWELL_FLOOR
#define OCEAN_SWELL_FLOOR 0.5
#endif
// Whitewater still left at the water's edge, relative to the break line. Surf is
// generated AT the break and decays as it washes inshore, so the shore is the dim
// end of the band rather than the bright one.
#ifndef OCEAN_SURF_RESIDUAL
#define OCEAN_SURF_RESIDUAL 0.3
#endif
// Surf left on a shore the waves are running away from. Not zero — a lee shore
// still gets refracted and diffracted energy round the headland.
#ifndef OCEAN_LEE_EXPOSURE
#define OCEAN_LEE_EXPOSURE 0.25
#endif
// Maximum number of floating-object contact footprints that can spread foam on
// the surface (see uContactCount / uContactA / uContactB).
#ifndef OCEAN_CONTACT_COUNT
#define OCEAN_CONTACT_COUNT 8
#endif

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

uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform float uReflectionIntensity;

uniform vec3 uSunDirection; // world space, normalised
uniform vec3 uSunColor;
uniform float uSunShininess;

uniform vec3 uFoamColor;
uniform float uFoamAmount;

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

uniform float uFresnelPower;
uniform float uDetailScale;    // micro-ripple frequency (waves per world unit)
uniform float uDetailStrength; // micro-ripple normal strength

uniform float uMasterOpacity; // master multiplier (CommonComponent opacity prop)

#ifdef OCEAN_BATHYMETRY
// The sea bed's depth grid, so shallow water can read as shallow. Without it the
// shader has no depth input at all and uses the VIEW ANGLE as a stand-in, which
// cannot tell a metre of water over a sandbank from the open sea.
uniform sampler2D uBathyMap;
uniform mat3 uBathyToUv; // object XZ -> uv
uniform vec2 uBathySize; // grid size in texels
uniform vec3 uShoal;     // x: water level (object Y), y: 1 / depth scale, z: opacity at zero depth
uniform vec4 uShore;      // x: shore foam amount, y: break depth (x wave height), z: swash, w: gradient step (m)
uniform vec2 uShoreNoise; // x: edge raggedness (m), y: its frequency (1 / m)
uniform vec2 uShoreFade;  // x: foam strength (1 = full white surf), y: fraction lost at distance
uniform float uSurfScale; // exaggeration of the surf zone's width, 1 = as measured
varying vec2 vObjectXZ;
#endif

varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec2 vUv;
// Undisplaced world X/Z (see vertex.glsl): the wave field is sampled here so
// vertex displacement doesn't alias the sampling grid into a lens/dot pattern.
varying vec2 vSurfaceXZ;

#ifdef OCEAN_SECTION
varying float vSectionDist;
#endif

#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include ./waves.glsl

#ifdef OCEAN_BATHYMETRY
#include ../../../sdk/materials/shaderLib/depth-map.glsl
#endif

#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

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

// Procedural sky/environment colour for a reflected world direction.
vec3 oceanSkyReflection(vec3 dir) {
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(uHorizonColor, uSkyColor, pow(up, 0.65));
  // Subtle sun disc/glow in the reflection.
  float sun = max(dot(dir, normalize(uSunDirection)), 0.0);
  sky += uSunColor * pow(sun, 64.0) * 0.6;
  return sky;
}

// Foam coverage [0,1] spread around floating-object contact footprints. For
// each active contact the world point is transformed into the object's local
// frame and tested against an oriented ellipse (the hull waterline); foam is a
// soft band hugging that ellipse boundary (inside and out by `foamWidth`),
// gently pulsing in time so the collar shimmers. The band is scaled by the
// per-contact intensity and tapered toward the bow/stern (forward axis) by
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

void main() {
  #ifdef OCEAN_SECTION
  if(vSectionDist > 0.0)
    discard;
  #endif

  #include <logdepthbuf_fragment>

  vec2 worldXZ = vSurfaceXZ;
  // World units covered by one pixel (used for footprint-based LOD/AA).
  float texel = max(length(fwidth(worldXZ)), 1e-3);

  // --- Break the periodicity of the finite spectral sum ---------------------
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

  // --- Spectral wave surface: per-pixel slope + height ----------------------
  vec2 slope;
  float height;
  oceanSurface(waveXZ, uTime, texel, slope, height);

  // Surface normal from the slope; uSteepness exaggerates apparent choppiness.
  vec3 N = normalize(vec3(-slope.x * uSteepness, 1.0, -slope.y * uSteepness));

  // --- Near-field micro ripples (fine FBM), footprint-faded -----------------
  // Drift with the wind in world space (seamless across tiles). Fades in only
  // where the fine ripples are large enough on screen to resolve (i.e. close),
  // which keeps crisp detail up close without shimmer at distance — and, being
  // footprint-based, adds no LOD ring.
  vec2 flow = uWindDirection * uTime * (0.5 + uWindSpeed * 0.1);
  vec2 np = (worldXZ + flow) * uDetailScale;
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
  if(microAA > 0.001) {
    float e = 0.5;
    vec2 mp = np * 4.0;
    float mL = oceanFbm(mp - vec2(e, 0.0));
    float mR = oceanFbm(mp + vec2(e, 0.0));
    float mD = oceanFbm(mp - vec2(0.0, e));
    float mU = oceanFbm(mp + vec2(0.0, e));
    N = normalize(N + vec3((mL - mR), 0.0, (mD - mU)) * uDetailStrength * microAA * windDetail);
  }

  // Viewed from below (inside the ocean box), the surface is back-facing; flip
  // the normal toward the camera so the underside is shaded as a water surface
  // (Fresnel-tinted) rather than showing a bright sky reflection that blends
  // into the background.
  bool underside = !gl_FrontFacing;
  if(underside)
    N = -N;

  vec3 V = normalize(cameraPosition - vWorldPosition);

  // --- Fresnel (analytically widened to avoid grazing-angle shading aliasing)
  float ndv = max(dot(N, V), 0.0);
  float ndvAA = max(ndv, fwidth(ndv));
  float fresnel = pow(1.0 - ndvAA, uFresnelPower);

  // --- Shoaling: how much water actually stands here ------------------------
  // 1 = deep (the water reads as its own body), 0 = the bed is at the surface.
  // ⚠️ `bathy` is the map's coverage: everything below blends back to the
  // angle-driven behaviour where the bed is unmapped, so no bathymetry is
  // bit-for-bit the original look rather than a hole.
  float shoal = 1.0;
  float bathy = 0.0;
  float waterDepth = 0.0;
  // How squarely the waves meet the shore here. Drives both the swash and, as
  // exposure, how much surf a stretch of coast gets at all.
  float shoreAlign = 1.0;
  #ifdef OCEAN_BATHYMETRY
  {
    float bedY;
    bathy = sampleDepthMap(uBathyMap, uBathyToUv, uBathySize, vObjectXZ, bedY);

    // ⚠️ NOT refraction, and not pretending to be. Real waves turn to face the
    // shore as they shoal, so run-up on a beach is near-uniform along it; this
    // shader carries the deep-water direction right up to the sand, which made the
    // waterline scallop into stripes sliding ALONG the coast whenever the wind ran
    // parallel to it. Weighting the swash by how squarely the waves meet the shore
    // suppresses that: waves running along a coast stop moving its waterline. It
    // removes the artefact rather than modelling its cause — the honest version
    // re-evaluates the wave field on a shore-projected coordinate, which is a
    // second 16-component sum per fragment.
    float bedX, bedZ;
    sampleDepthMap(uBathyMap, uBathyToUv, uBathySize, vObjectXZ + vec2(uShore.w, 0.0), bedX);
    sampleDepthMap(uBathyMap, uBathyToUv, uBathySize, vObjectXZ + vec2(0.0, uShore.w), bedZ);
    vec2 grad = vec2(bedX - bedY, bedZ - bedY);
    float gradLen = length(grad);
    // A flat bed has no shore to face, so there is nothing to weight.
    shoreAlign = gradLen > 1e-6 ? abs(dot(normalize(uWindDirection), grad / gradLen)) : 1.0;

    // ⭐ The swell carries the waterline with it: offsetting the LEVEL by this
    // fragment's own wave height makes the shore advance and retreat, varied
    // along the coast, with no clock of its own and no second field to tune.
    waterDepth = uShoal.x + height * uShore.z * shoreAlign - bedY;
    shoal = 1.0 - exp(-max(waterDepth, 0.0) * uShoal.y);
  }
  #endif

  // --- Water body colour ----------------------------------------------------
  // ⭐ The angle term is a STAND-IN for depth, from before there was a depth
  // input: without it, open sea and a metre of water over a bank look identical
  // from the same viewpoint. Where the bed is known, use the real thing.
  float bodyMix = mix(clamp(ndvAA, 0.0, 1.0), shoal, bathy);
  vec3 waterColor = mix(uShallowColor, uDeepColor, bodyMix);

  // --- Large-scale tonal variation (currents / slicks) ----------------------
  // A very low-frequency, world-space variation so the open water is not a flat
  // uniform colour when viewed from far away. Two decorrelated noise fields give
  // a one-sided brightness lift (currents catch the light) and a subtle hue
  // shift toward uTonalColor (slick / algae / pollution). Low frequency =>
  // visible at distance, no footprint fade needed.
  float tonalReflect = 1.0;
  float tonalSpec = 1.0;
  if(uTonalVariation > 0.0) {
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
    waterColor *= mix(1.0, 1.0 + uTonalVariation * 0.5, tonal);
    waterColor = mix(waterColor, waterColor * uTonalColor, tonal2 * uTonalVariation);
    // The tinted patches are also slightly less reflective, so the tonal
    // variation reads as a change in water surface, not just colour.
    tonalReflect = 1.0 - tonal2 * uTonalVariation * 0.5;
    // The specular sun glint is modulated much more strongly than the diffuse
    // reflection so the patches read as distinctly calmer/glossier water: the
    // brighter (tonal) patches sparkle more, the tinted (tonal2) patches less.
    tonalSpec = clamp(1.0 + (tonal - tonal2) * uTonalVariation * 2.0, 0.0, 3.0);
  }

  // --- Reflection -----------------------------------------------------------
  vec3 R = reflect(-V, N);
  vec3 reflection = oceanSkyReflection(R) * uReflectionIntensity * tonalReflect;

  // --- Specular sun sparkle -------------------------------------------------
  // Modulated more strongly than the reflection (tonalSpec) so the tonal
  // patches show a pronounced difference in sun glint.
  vec3 H = normalize(V + normalize(uSunDirection));
  float ndh = max(dot(N, H), 0.0);
  float spec = pow(ndh, uSunShininess);
  vec3 specular = uSunColor * spec * tonalSpec;

  vec3 color = mix(waterColor, reflection, fresnel) + specular;

  // --- Foam: whitecaps where the spectral surface is steep / cresting --------
  // Wind drives coverage (uWindSpeed is the average wind in m/s); little/no foam
  // in calm conditions, white caps once the wind picks up. The foam is built as
  // a coverage value thresholded against a noise texture, with the threshold's
  // transition width tracking the pixel footprint: edges stay crisp (and get
  // crisper as the camera approaches) yet remain anti-aliased at distance. A
  // finer foam octave fades in up close for sharp filaments.
  float windFoam = smoothstep(4.0, 14.0, uWindSpeed);
  float crest = smoothstep(0.45, 0.9, height / max(uSignificantHeight, 1e-3));
  float steep = smoothstep(0.7, 1.4, length(slope) * uSteepness);
  float foamCoverage = clamp((crest * 0.7 + steep * 0.7) * uFoamAmount * windFoam, 0.0, 1.0);

  // Foam stirred up where floating objects touch the water. How much each object
  // generates is supplied per-contact (uContactB.w intensity) — driven CPU-side
  // by how much the object is actually moving (a bobbing/pitching hull throws up
  // more spray), so it naturally rises with the sea state without referencing
  // the wind directly. Folded into the same coverage so it picks up the noise
  // texture, froth and distance fade below.
  float contactFoam = oceanContactFoam(worldXZ, uTime);
  foamCoverage = max(foamCoverage, contactFoam);

  // Surf where the waves break on the shore. ⭐ Folded into the SAME coverage as
  // the whitecaps, so it inherits the noise texture, the froth and the footprint
  // AA below rather than reading as a different kind of foam.
  // ⚠️⚠️ Keyed on water DEPTH, never on the water body's boundary — most of that
  // boundary is the outline CROP, and surf along an arbitrary crop edge would be
  // a confident lie.
  float shoreWeight = 0.0;
  #ifdef OCEAN_BATHYMETRY
  {
    // ⭐⭐ Waves break where the depth falls to ~1.3x the wave height, so the surf
    // zone MOVES WITH THE SEA STATE instead of sitting at a fixed depth: a thin
    // line in a calm, a wide belt in a storm. A fixed band was the single most
    // unphysical thing about this — the whole sea offshore responded to the wind
    // and the shore did not.
    float surfHeight = max(uSignificantHeight, OCEAN_SWELL_FLOOR);
    float breakDepth = max(uShore.y * surfHeight * uSurfScale, 1e-3);

    float edge = waterDepth;
    if(uShoreNoise.x > 0.0) {
      // A ragged edge rather than the bathymetry contour exactly. ⚠️ Drifts slowly
      // on its own rather than with the wind `flow` that carries `np`: a
      // coastline's raggedness belongs to the shore and must not stream downwind.
      float n = oceanFbm(worldXZ * uShoreNoise.y + uTime * 0.02);
      float nAA = 1.0 - smoothstep(0.5, 3.0, uShoreNoise.y * 6.2831853 * texel);
      edge += (n - 0.5) * 2.0 * uShoreNoise.x * nAA;
    }

    // ⭐⭐ The profile PEAKS AT THE BREAK LINE, not at the water's edge. Foam is
    // generated where the waves break and then washes inshore while decaying, so
    // the bright line stands OFFSHORE and the shore is the dim end. A band that
    // maxes at depth 0 traces the coastline exactly, which is what makes it read
    // as a drawn outline around the land rather than as water doing something.
    float t = max(edge, 0.0) / breakDepth;
    float seaward = exp(-pow(max(t - 1.0, 0.0) / 0.25, 2.0));
    float inshore = mix(OCEAN_SURF_RESIDUAL, 1.0, exp(-(1.0 - min(t, 1.0)) / 0.45));

    // Sets: surf arrives in groups, so the band pulses along the coast instead of
    // standing still. Low frequency, so it survives being zoomed out.
    float sets = mix(0.6, 1.0, oceanFbm(worldXZ * 0.0006 + uTime * 0.03));

    // Exposure: a windward coast breaks, a lee shore mostly does not. Free — the
    // alignment is already computed for the swash.
    float exposure = mix(OCEAN_LEE_EXPOSURE, 1.0, shoreAlign);

    // ⭐ Analytic anti-aliasing: once the band is narrower than a pixel it would be
    // drawn as a hard aliased line, so drop its amplitude by however much it is
    // over-wide. Preserves the integral, so it goes soft and dim rather than thin
    // and hard. ⚠️ Only bites on a STEEP shore — a band measured in metres of depth
    // is hundreds of metres across on a gentle shelf.
    // ⚠️ From the unperturbed depth: the AA width follows the field, not the
    // raggedness applied to it.
    float aa = min(1.0, breakDepth / max(fwidth(waterDepth), 1e-6));

    float shoreFoam = clamp(
      seaward * inshore * sets * exposure * aa * uShore.x * bathy, 0.0, 1.0);
    foamCoverage = max(foamCoverage, shoreFoam);
    // What share of the foam here IS the shore band — see the distance fade below.
    shoreWeight = shoreFoam / max(foamCoverage, 1e-4);
  }
  #endif

  float foamNoise = oceanFbm(np * 2.0 + 3.7);
  float fineK = uDetailScale * 8.0 * 6.2831853;
  float fineAA = 1.0 - smoothstep(0.5, 3.0, fineK * texel);
  float foamTex = mix(foamNoise, foamNoise * oceanFbm(np * 8.0 + 11.1) * 2.0, fineAA);
  foamTex = clamp(foamTex, 0.0, 1.0);

  // Foam feature footprint vs. pixel size: foamFar -> 1 when crests shrink below
  // a pixel (far away); closeness -> 1 when the camera is near and the foam is
  // well resolved.
  float foamK = uDetailScale * 2.0 * 6.2831853;
  float foamFar = smoothstep(0.5, 4.0, foamK * texel);
  float closeness = 1.0 - foamFar;

  // Higher coverage lowers the threshold => more of the noise becomes foam.
  float foamT = 1.0 - foamCoverage;

  // Edge softness: stay crisp + AA at distance, but WIDEN the transition band up
  // close so the foam fringe feathers into the water (frothy) rather than a hard,
  // high-contrast white cutout.
  float foamAaw = clamp(fwidth(foamTex) + 0.015, 0.01, 0.5);
  float edge = foamAaw + closeness * 0.2;
  float foam = smoothstep(foamT - edge, foamT + edge, foamTex);

  // Up close, modulate the foam fill with a finer bubble noise so it reads as
  // clumpy froth instead of a flat sheet of white — this breaks up the uniform
  // brightness that makes the foam look hard.
  float bubble = oceanFbm(np * 12.0 + 5.3);
  float froth = mix(1.0, 0.55 + 0.45 * bubble, closeness);
  foam *= froth;

  // Thin foam blends in gently as soft froth; only the densest foam reaches full
  // bright white. This ramps down the foam/water contrast up close while leaving
  // the crisp far look untouched.
  float foamBlend = foam * mix(1.0, smoothstep(0.05, 0.6, foam), closeness);

  // Distance fade: once the foam noise shrinks below the pixel footprint it can no
  // longer be resolved and full-white foam reads as harsh bright noise, so far
  // crests are faded back into the water as their feature footprint
  // (foamK * texel) approaches and exceeds one pixel.
  // ⚠️ The shore band needs its OWN factor: on a gentle shelf it never goes
  // sub-pixel (its width on screen is the break depth over the bed's gradient,
  // hundreds of metres), so the whitecaps' footprint fade would leave it at full
  // strength.
  float shoreFade = 1.0 - uShoreFade.x * (1.0 - foamFar * uShoreFade.y);
  float foamFade = clamp(mix(foamFar * 0.85, shoreFade, shoreWeight), 0.0, 1.0);

  // ⭐⭐ ONE effective foam opacity, used by the colour AND by the alpha below.
  // Fading a colour toward the water is identical to reducing coverage —
  // mix(c, mix(f, c, k), b) == mix(c, f, b * (1 - k)) — so expressing it as an
  // opacity is both simpler and the only form that keeps the two in step.
  // ⚠⚠ They were NOT in step, and the symptom pointed at the wrong one: the alpha
  // boost ("foam reads as opaque") ignored the fade, so foam faded to nothing still
  // forced the water opaque — revealing the water's colour at opacity 1 where the
  // real pixel is mostly sea bed showing through a shoal. That is a saturated teal
  // band exactly where the foam was asked to disappear.
  float foamOpacity = foamBlend * (1.0 - foamFade);
  color = mix(color, uFoamColor, foamOpacity);

  // Seen from below (inside the water body) the surface should read as a darker
  // underside rather than the bright, sky-lit top. Dim the final colour for
  // back-facing fragments so looking up through the water is visibly darker
  // than looking down onto it.
  if(underside)
    color *= OCEAN_UNDERSIDE_DARKNESS;

  // --- Transparency: see-through looking down, reflective at grazing angles --
  // Shallow water is clearer: the body's own opacity is scaled toward uShoal.z as
  // the bed comes up, so you see the bed through a shoal. The Fresnel term is
  // untouched — a reflection at a grazing angle does not care how deep it is.
  float bodyOpacity = uOpacity;
  #ifdef OCEAN_BATHYMETRY
  bodyOpacity *= mix(1.0, mix(uShoal.z, 1.0, shoal), bathy);
  #endif
  float alpha = mix(bodyOpacity, 1.0, fresnel);
  // Foam reads as opaque — but only as much of it as was actually drawn. Using the
  // raw coverage here is what let faded-out foam go on forcing the water opaque.
  alpha = max(alpha, foamOpacity);
  alpha *= uMasterOpacity;

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));

  #include <colorspace_fragment>
  // Looking up at the surface from inside the water body, there IS water in the
  // way, so the lid is fogged with everything else. ⚠️ After the colour space
  // conversion, matching three's own material ordering.
  #include <fog_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
