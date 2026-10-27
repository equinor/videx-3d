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

// The surface's own uniforms, contact foam's included, are declared in ocean-surface.glsl,
// shared with the Sky's sea.
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;

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
#endif

#if defined(OCEAN_BATHYMETRY) || defined(OCEAN_FENCE)
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

#ifdef OCEAN_FENCE
// x: 1 while the cut is live, 0 to pass everything; y: +1 normally, -1 to keep only
// what the fence removed. The rest place the field in the stack's own object XZ.
uniform vec2 fenceParams;
uniform sampler2D fenceMap;
uniform mat3 fenceToUv;   // object XZ -> uv
uniform vec2 fenceSize;   // grid size in texels
#include ../../../sdk/materials/shaderLib/fence-field.glsl
#endif

#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include ./ocean-surface.glsl

#ifdef OCEAN_BATHYMETRY
#include ../../../sdk/materials/shaderLib/depth-map.glsl
#endif

#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

// Procedural sky/environment colour for a reflected world direction.
vec3 oceanSkyReflection(vec3 dir) {
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(uHorizonColor, uSkyColor, pow(up, 0.65));
  // Subtle sun disc/glow in the reflection.
  float sun = max(dot(dir, normalize(uSunDirection)), 0.0);
  sky += uSunColor * pow(sun, 64.0) * 0.6;
  return sky;
}

void main() {
  #ifdef OCEAN_SECTION
  if(vSectionDist > 0.0)
    discard;
  #endif

  #ifdef OCEAN_FENCE
  // ⭐ The same exact lookup the block is cut by, off the same segments — so the
  // sea ends on the curve rather than a fraction of a cell either side of it.
  if(fenceParams.x > 0.5 && fenceParams.y * fenceSide(fenceMap, fenceToUv, fenceSize, vObjectXZ) < 0.0)
    discard;
  #endif

  #include <logdepthbuf_fragment>

  vec2 worldXZ = vSurfaceXZ;
  // World units covered by one pixel (used for footprint-based LOD/AA).
  float texel = max(length(fwidth(worldXZ)), 1e-3);
  float flatness = oceanFlatness(distance(cameraPosition, vWorldPosition));

  vec2 slope;
  float height;
  vec2 np;
  float rough;
  vec3 N = oceanWaveNormal(worldXZ, texel, flatness, slope, height, np, rough);

  // Viewed from below (inside the ocean box), the surface is back-facing; flip
  // the normal toward the camera so the underside is shaded as a water surface
  // (Fresnel-tinted) rather than showing a bright sky reflection that blends
  // into the background.
  bool underside = !gl_FrontFacing;
  if(underside)
    N = -N;

  vec3 V = normalize(cameraPosition - vWorldPosition);

  // --- Fresnel (analytically widened to avoid grazing-angle shading aliasing)
  float ndvAA;
  float fresnel = oceanFresnel(N, V, ndvAA);

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
    // ⭐ Where the map has no bed, the honest reading is DEEP water — not the
    // angle stand-in. Blending back to that made a partly mapped bed disagree
    // with itself across its own survey edge, printing the grid's outline onto
    // the sea surface: inside it the water is fully body-coloured (`shoal`
    // saturates by a few hundred metres), outside it the colour follows the view
    // angle instead. The stand-in still stands where there is NO map at all,
    // which is what it was for.
    shoal = mix(1.0, 1.0 - exp(-max(waterDepth, 0.0) * uShoal.y), bathy);
  }
  #endif

  // --- Water body colour ----------------------------------------------------
  // ⭐ The angle term is a STAND-IN for depth, from before there was a depth
  // input: without it, open sea and a metre of water over a bank look identical
  // from the same viewpoint. With a bed it is not needed at all — `shoal` already
  // reads deep wherever the bed is unknown.
  #ifdef OCEAN_BATHYMETRY
  float bodyMix = shoal;
  #else
  float bodyMix = clamp(ndvAA, 0.0, 1.0);
  #endif
  vec3 waterColor = mix(uShallowColor, uDeepColor, bodyMix);

  float tonalReflect;
  float tonalSpec;
  oceanTonal(worldXZ, flatness, waterColor, tonalReflect, tonalSpec);

  vec3 color = oceanShade(N, V, waterColor, oceanSkyReflection(reflect(-V, N)), fresnel, tonalReflect, tonalSpec, rough);

  // Foam: wind-driven whitecaps, then the foam the contacts and the shore add.
  float foamCoverage = oceanWindFoam(slope, height);

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

  float foamFar;
  float foamBlend = oceanFoam(np, texel, foamCoverage, foamFar);

  // Distance fade: once the foam noise shrinks below the pixel footprint it can no
  // longer be resolved and full-white foam reads as harsh bright noise, so far
  // crests are faded back into the water as their feature footprint
  // approaches and exceeds one pixel.
  // ⚠️ The shore band needs its OWN factor: on a gentle shelf it never goes
  // sub-pixel (its width on screen is the break depth over the bed's gradient,
  // hundreds of metres), so the whitecaps' footprint fade would leave it at full
  // strength.
  // ⚠️⚠️ Guarded, not just multiplied by `shoreWeight`: without a bathymetry grid
  // there IS no shore band and `uShoreFade` is not declared, so referring to it
  // here compiles only in the variant that happens to have the define.
  float foamFade = foamFar * OCEAN_FOAM_FAR_FADE;
  #ifdef OCEAN_BATHYMETRY
  {
    float shoreFade = 1.0 - uShoreFade.x * (1.0 - foamFar * uShoreFade.y);
    foamFade = mix(foamFade, shoreFade, shoreWeight);
  }
  #endif
  foamFade = clamp(foamFade, 0.0, 1.0);

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
  // `shoal` is already 1 where the bed is unmapped, so this leaves those
  // fragments at the body's own opacity without a second coverage blend.
  bodyOpacity *= mix(uShoal.z, 1.0, shoal);
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
