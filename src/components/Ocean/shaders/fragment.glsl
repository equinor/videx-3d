// Ocean surface fragment shader (stylized).
//
// The visible waves are a sea state's layers (sea-layers.glsl), baked into tiling textures each
// frame and read hex-tiled so they never repeat, in WORLD X/Z, so patched geometry is seamless.
// Each layer is filtered to the pixel by its mips, and what they filter out roughens the sun's
// glint, so there is no LOD ring and the horizon does not shimmer.
//
// Reflections are of the scene's sky (OceanMaterial.setSky: a Scenery's, else the scene's
// environment, else a procedural gradient), by Fresnel over the water down to the
// seabed under the surface (water-body.glsl's waterBodySurfaceWater), through which what lies
// under it shows: one water model with every sea's (documents/water.md). The material is OIT-compatible: it includes
// the shared oit.glsl chunk and routes its final colour through oitProcess() so
// it composites correctly with the other transparent subsurface geometry.

// The surface's own uniforms, contact foam's and the surf's included, are declared in
// ocean-surface.glsl, shared with the Sky's sea.
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;

#ifdef OCEAN_SKY_ENV
// The scene's environment, prefiltered (three's CubeUV layout), its intensity, and world
// directions into it.
uniform sampler2D uSkyEnv;
uniform float uSkyEnvIntensity;
uniform mat3 uSkyEnvRotation;
#endif

#ifdef OCEAN_SKY_CLOUDS
// The clouds that draw themselves in the scene's sky (a Scenery's 3D clouds): premultiplied,
// by world direction, and their lowest base over the sea.
uniform samplerCube uSkyClouds;
uniform float uSkyCloudBase;
// The film's coarsest level (its side is 128: scenery-clouds.ts), a texel's angle at its finest
// (radians), and the least base its blur is reckoned from (world units).
#define OCEAN_SKY_CLOUD_LODS 7.0
#define OCEAN_SKY_CLOUD_TEXEL 0.0123
#define OCEAN_SKY_CLOUD_BASE 100.0
#endif

uniform float uMasterOpacity; // master multiplier (CommonComponent opacity prop)

#ifdef OCEAN_BATHYMETRY
// The sea bed's depth grid (object XZ), whose own slope tells how squarely the waves meet a
// shore. The depth itself is the water body's (waterBodyFloorAt), which reads the same grid.
uniform sampler2D uBathyMap;
uniform mat3 uBathyToUv; // object XZ -> uv
uniform vec2 uBathySize; // grid size in texels
uniform vec3 uShoal;     // x: water level (object Y), y: 1 / depth scale, z: opacity at zero depth
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
#ifdef OCEAN_SKY_ENV
#include <cube_uv_reflection_fragment>
#endif
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include ./ocean-surface.glsl
#include ../../../sdk/materials/shaderLib/water-body.glsl

#ifdef OCEAN_BATHYMETRY
#include ../../../sdk/materials/shaderLib/depth-map.glsl
#endif

#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

// The sky along `dir` (world), as a surface of perceptual `roughness` (three's: the square root
// of GGX's alpha) sees it, from `over` world units above it: the scene's (OceanMaterial.setSky)
// environment, prefiltered, with the clouds that draw themselves over it; else the gradient
// with a sun's glow in it.
vec3 oceanSky(vec3 dir, float roughness, float over) {
  #ifdef OCEAN_SKY_ENV
  vec3 sky = textureCubeUV(uSkyEnv, uSkyEnvRotation * dir, roughness).rgb;
  #else
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(uHorizonColor, uSkyColor, pow(up, 0.65));
  // Subtle sun disc/glow in the reflection.
  float sun = max(dot(dir, normalize(uSunDirection)), 0.0);
  sky += uSunColor * pow(sun, 64.0) * 0.6;
  #endif
  #ifdef OCEAN_SKY_CLOUDS
  // Their film read by direction alone blows them up by the height they are seen from against
  // their base (as the Scenery's sea reads it, sky-ocean.glsl), and as blurred as the
  // reflection's lobe (GGX alpha, in radians) is wide against a texel.
  float lift = log2(max(over / max(uSkyCloudBase, OCEAN_SKY_CLOUD_BASE), 1.0));
  float lobe = log2(max(roughness * roughness / OCEAN_SKY_CLOUD_TEXEL, 1.0));
  vec4 clouds = textureLod(uSkyClouds, dir, clamp(max(lift, lobe), 0.0, OCEAN_SKY_CLOUD_LODS));
  sky = sky * (1.0 - clouds.a) + clouds.rgb;
  #endif
  #ifdef OCEAN_SKY_ENV
  sky *= uSkyEnvIntensity;
  #endif
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
  // World units covered by one pixel (used for the foam's footprint).
  float texel = max(length(fwidth(worldXZ)), 1e-3);
  float flatness = oceanFlatness(distance(cameraPosition, vWorldPosition));

  vec2 slope;
  float height;
  vec2 crest;
  float rough;
  // The still water's depth here: the bed's grid, else the scene's ground, else the flat floor
  // (water-body.glsl). The waves shoal and die out by it, and the surf breaks by it. The
  // surface lies level, so its still point is at the water's height.
  float depth = waterBodyFloorAt(vec3(worldXZ.x, uWaterBody.w, worldXZ.y));
  vec3 N = oceanWaves(worldXZ, flatness, depth, slope, height, crest, rough);

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

  // --- How squarely the waves meet the shore here -------------------------------
  // Drives the swash and, as exposure, how much surf a stretch of coast gets. A bathymetry
  // grid's slope is stepped across it; any other depth's (the scene's ground, a flat floor) is
  // taken from its screen derivatives.
  vec2 bedSlope;
  #ifdef OCEAN_BATHYMETRY
  {
    float bedY, bedX, bedZ;
    sampleDepthMap(uBathyMap, uBathyToUv, uBathySize, vObjectXZ, bedY);
    sampleDepthMap(uBathyMap, uBathyToUv, uBathySize, vObjectXZ + vec2(uShore.w, 0.0), bedX);
    sampleDepthMap(uBathyMap, uBathyToUv, uBathySize, vObjectXZ + vec2(0.0, uShore.w), bedZ);
    bedSlope = vec2(bedX - bedY, bedZ - bedY);
  }
  #else
  bedSlope = oceanDepthSlope(depth, worldXZ);
  #endif
  float shoreAlign = oceanShoreAlign(bedSlope);
  float shoreDepth = oceanShoreDepth(depth, shoreAlign);

  // --- The surface ----------------------------------------------------------
  // From above, the sky it reflects and the sun's glint, covering Fresnel of what lies under
  // it, over the water down to the seabed under it (water-body.glsl's waterBodySurfaceWater):
  // what lies in the water shows through as much as the water lets it, only dimmed by the
  // daylight its depth leaves it. Gusts and slicks (oceanWaves) turn the reflection and how
  // much there is of it, in the colour only.
  vec4 layer;
  // The sky's blur: what the pixel's own normal leaves of the slopes (GGX alpha their RMS),
  // as three's perceptual roughness. From the camera's height over the surface, the clouds'.
  float skyRoughness = sqrt(sqrt(max(rough, 0.0)));
  float skyOver = max(cameraPosition.y - vWorldPosition.y, 0.0);
  if(!underside) {
    vec3 reflected = oceanRoughReflect(reflect(-V, N), vec3(0.0, 1.0, 0.0), rough);
    // Steep waves can tip a reflection below the horizon; mirror it back up, as the Scenery's
    // sea does: under it, an environment holds the sea or a floor.
    reflected.y = abs(reflected.y);
    float roughFresnel = oceanRoughFresnel(fresnel, ndvAA, rough);
    layer = vec4(oceanSky(reflected, skyRoughness, skyOver) * uReflectionIntensity * roughFresnel + oceanGlint(N, V, 1.0, rough, worldXZ, texel), fresnel);
    layer = waterLayerOver(layer, waterBodySurfaceWater(vWorldPosition, -V));
    // The sun's light through the crests, out of the water toward the eye.
    layer.rgb += oceanCrestLight(N, V, height, flatness, fresnel, uWaterBodyExtinction, uWaterBodyColor, uSunColor, vec3(0.0, 1.0, 0.0));
  } else {
    // From below: the sky through Snell's window, beyond it the deep water mirrored, seen
    // through the water between (as the Scenery's sea's underside).
    vec3 exitDir = refract(-V, N, 1.333);
    vec3 deep = waterBodyDeep(reflect(-V, N).y, false);
    vec3 under = deep;
    if(dot(exitDir, exitDir) > 0.0) {
      float mirrored = oceanFresnelAt(dot(exitDir, -N));
      under = mix(oceanSky(normalize(exitDir), skyRoughness, 0.0), deep, mirrored);
    }
    layer = vec4(waterBodyFog(under, vWorldPosition), 1.0);
  }

  // Foam: wind-driven whitecaps, then the foam the contacts and the shore add.
  float foamCoverage = oceanWindFoam();

  // Foam stirred up where floating objects touch the water. How much each object
  // generates is supplied per-contact (uContactB.w intensity) — driven CPU-side
  // by how much the object is actually moving (a bobbing/pitching hull throws up
  // more spray), so it naturally rises with the sea state without referencing
  // the wind directly. Folded into the same coverage so it picks up the noise
  // texture, froth and distance fade below.
  float contactFoam = oceanContactFoam(worldXZ, uTime);
  foamCoverage = max(foamCoverage, contactFoam);

  // Surf where the waves break on the shore (oceanShoreFoam): in the same coverage as the
  // whitecaps, so it takes their texture, froth and footprint AA.
  float shoreFoam = oceanShoreFoam(shoreDepth, fwidth(shoreDepth), shoreAlign, worldXZ, texel);
  foamCoverage = max(foamCoverage, shoreFoam);
  // What share of the foam here IS the shore band, for its own distance fade below.
  float shoreWeight = shoreFoam / max(foamCoverage, 1e-4);

  float foamFar;
  float foamBlend = oceanFoam(crest, worldXZ, texel, foamCoverage, foamFar);

  // Distance fade: once the foam noise shrinks below the pixel footprint it can no
  // longer be resolved and full-white foam reads as harsh bright noise, so far
  // crests are faded back into the water as their feature footprint
  // approaches and exceeds one pixel. The surf by its own (oceanShoreFade).
  float foamFade = mix(foamFar * uFoamLook.x, oceanShoreFade(foamFar), shoreWeight);
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
  // From below, the foam is the underside's own light, already in the water's. Lit by the sky
  // toward its normal, all round (a second look at the sky, so only where there is foam).
  if(!underside && foamOpacity > 0.001)
    layer = oceanFoamOver(layer, uFoamColor, N, foamOpacity, oceanSky(N, 1.0, skyOver), uSunColor);

  vec4 straight = oceanStraight(layer);
  vec3 color = straight.rgb;
  float alpha = straight.a * uMasterOpacity;
  // ⚠️ Debug views (foamTuning.debug): opaque, in place of the surface.
  if(uFoamGrain.w > 0.5) {
    color = oceanDebugView(color, crest, foamBlend);
    alpha = uMasterOpacity;
  }

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
