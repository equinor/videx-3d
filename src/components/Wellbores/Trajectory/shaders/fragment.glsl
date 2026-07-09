#define TRAJECTORY_MATERIAL

uniform vec3 diffuse;
uniform float opacity;

// Silhouette (rim) shading controls. Distance fade is left to scene fog (no distance
// darkening / no distance-driven opacity here).
uniform vec3 shadingColor;    // colour the silhouette darkens toward (black = darker same-hue diffuse)
uniform float shadingStrength; // 0 = flat, 1 = silhouette fully = shadingColor
uniform float shadingFalloff;  // rim exponent: higher = darkening hugs the silhouette (broad exact-colour front), lower = spreads inward

#ifndef FLAT_SHADED
varying vec3 vNormal;
#endif
varying vec3 vViewPosition;
varying float vAxial; // measured depth (MSL) in metres, for procedural depth patterns

// Depth-marker bands (only compiled when USE_DEPTH_MARKERS is defined). The band is a
// crisp world-space width (metres, fwidth-AA'd); the colour modulation follows the
// Surface contour convention (ContourColorMode: 0 darken, 1 lighten, 2 mixed) so depth
// markers behave consistently across the library.
#ifdef USE_DEPTH_MARKERS
uniform float depthInterval;              // spacing between markers (metres)
uniform float depthMarkerWidth;           // band thickness in metres, centred on each interval
uniform int depthMarkerColorMode;         // 0 = darken, 1 = lighten, 2 = mixed (toward colour)
uniform float depthMarkerColorModeFactor; // modulation strength (0..1)
uniform vec3 depthMarkerColor;            // target colour used by the 'mixed' mode
uniform float depthMarkerOffset;          // shifts the reference datum from MSL (metres)
#endif

// Interval colouring (only compiled when USE_INTERVAL_COLORS is defined): recolour the
// tube by measured-depth (MSL) intervals for data visualisation. The interval ranges +
// palette indices live in one strip texture; the de-duplicated colours live in another,
// so many intervals can share a colour. INTERVAL_COLOR_COUNT is the interval count
// (loop bound + interval-texel denominator).
#ifdef USE_INTERVAL_COLORS
uniform sampler2D intervalColorTexture;   // INTERVAL_COLOR_COUNT texels: (from, to, paletteIndex, -)
uniform sampler2D intervalPaletteTexture; // intervalPaletteSize texels: (r, g, b, -), linear
uniform float intervalPaletteSize;        // number of palette entries
#endif

#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

#ifdef USE_OIT
#include ../../../../sdk/materials/shaderLib/oit.glsl
#endif

void main() {
  #include <clipping_planes_fragment>

  vec4 diffuseColor = vec4(diffuse.rgb, opacity);

  // Optional albedo map (procedural UV from the vertex shader). No-op unless USE_MAP.
  #include <map_fragment>

  // Interval colouring: where this fragment's measured depth (MSL) falls inside a data
  // interval, replace the base colour with that interval's palette colour (overriding
  // the map within the range). Rim shading + depth markers below then compose on top.
  // Linear scan over the intervals; the first containing interval wins.
  #ifdef USE_INTERVAL_COLORS
  for(int i = 0; i < INTERVAL_COLOR_COUNT; i++) {
    float iu = (float(i) + 0.5) / float(INTERVAL_COLOR_COUNT);
    vec4 interval = texture2D(intervalColorTexture, vec2(iu, 0.5));
    if(vAxial >= interval.x && vAxial <= interval.y) {
      float pu = (interval.z + 0.5) / intervalPaletteSize;
      diffuseColor.rgb = texture2D(intervalPaletteTexture, vec2(pu, 0.5)).rgb;
      break;
    }
  }
  #endif

  #include <logdepthbuf_fragment>

  // Silhouette-rim shading with analytic AA (the tube's built-in edge AA). The darkening
  // is applied ADDITIVELY toward the rim: `pow(1 - N·V, falloff)` is exactly 0 at the
  // front-facing point (N·V = 1) for ANY strength/falloff, so the tube centre stays
  // EXACTLY the diffuse colour — important for data-viz colour coding. `fwidth` floors
  // N·V so the dark rim can't shrink below ~1px (avoids a jagged fringe), and clamping
  // keeps thin/far tubes flat at the exact colour. (Scene fog / great distance may still
  // shift the colour — accepted.)
  float ndv = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
  float ndvAA = clamp(max(ndv, fwidth(ndv)), 0.0, 1.0);
  float rimDarken = shadingStrength * pow(1.0 - ndvAA, shadingFalloff);
  diffuseColor.rgb = mix(diffuseColor.rgb, shadingColor, rimDarken);

  // Depth markers: crisp world-space bands every `depthInterval` metres of measured depth
  // (referenced to MSL + depthMarkerOffset), applied to the final shaded colour. Colour
  // modulation follows the Surface contour modes: darken / lighten multiply the colour,
  // 'mixed' blends toward depthMarkerColor. markerBand is ~1 ON the band and 0 away; the
  // +0.5*interval shift centres a band ON each interval multiple.
  #ifdef USE_DEPTH_MARKERS
  float markerDepth = vAxial + depthMarkerOffset;
  float distToMarker = abs(fract(markerDepth / depthInterval + 0.5) - 0.5) * depthInterval;
  float markerHalfWidth = depthMarkerWidth * 0.5;
  float markerAA = fwidth(markerDepth);
  float markerBand = 1.0 - smoothstep(markerHalfWidth - markerAA, markerHalfWidth + markerAA, distToMarker);
  float markerMod = 1.0;
  if(depthMarkerColorMode == 0) {
    markerMod = 1.0 - markerBand * depthMarkerColorModeFactor;
  } else if(depthMarkerColorMode == 1) {
    markerMod = 1.0 + markerBand * depthMarkerColorModeFactor;
  }
  diffuseColor.rgb *= markerMod;
  if(depthMarkerColorMode == 2) {
    diffuseColor.rgb = mix(diffuseColor.rgb, depthMarkerColor, markerBand * depthMarkerColorModeFactor);
  }
  #endif

  gl_FragColor = diffuseColor;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>

  #ifdef OPAQUE
  gl_FragColor.a = 1.0;
  #endif

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
