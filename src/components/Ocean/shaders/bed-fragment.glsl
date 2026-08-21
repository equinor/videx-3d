// Ocean sea-bed fragment shader.
//
// Shades the displaced sea bed with simple sun-direction diffuse lighting so the
// procedural slope reads as relief. The water-facing (top) side is tinted toward
// the water colour, as if seen through the water column; the underside (seen from
// outside / below the box) keeps its light, sandy/yellowish base colour.
//
// OIT-compatible: includes the shared oit.glsl chunk and routes its final colour
// through oitProcess(). With opacity 1 the OITRenderPass routes it through the
// opaque pass (writing depth), so it occludes geometry below it.

uniform vec3 uColor; // sandy/yellowish base
uniform vec3 uWaterColor; // tint applied on the water-facing side
uniform float uWaterTint; // strength of the water tint on top (0..1)
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uAmbient;
uniform float uOpacity;
uniform float uMasterOpacity;
uniform float uDuneStrength; // 0 = off; sand-dune normal-perturbation strength
uniform float uDuneWavelength; // base dune crest spacing in meters
uniform vec2 uDuneDirection; // dune ridge propagation direction (world XZ)
uniform float uDuneSharpness; // 0 = off; extra crest/trough albedo banding

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;

#include <common>
#include <logdepthbuf_pars_fragment>

#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

// --- Procedural sand-dune relief ------------------------------------------
// A cheap, GEOMETRY-FREE bump: the sea bed stays a coarse mesh, but the shading
// normal is perturbed per pixel by the analytic slope of a small directional
// "dune" height field (a few rotated, meandering sine ridges). This adds a
// subtle sense of depth/scale to the otherwise flat-shaded bed without extra
// vertices.
//
// Crucially it is FOOTPRINT ANTI-ALIASED exactly like the water surface: each
// octave fades out as its wavelength approaches the on-screen pixel size
// (`k * texel`), so at oilfield scale (the bed zoomed far out) the dunes vanish
// smoothly into the flat base instead of shimmering — and only resolve when the
// camera is close enough for them to read.
float bedHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float bedNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = bedHash(i);
  float b = bedHash(i + vec2(1.0, 0.0));
  float c = bedHash(i + vec2(0.0, 1.0));
  float d = bedHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Accumulate the (normalized) world-XZ slope of the dune height field, with the
// per-octave footprint AA, and output the height for a faint crest highlight.
// The returned slope is dimensionless (~unit order), so uDuneStrength reads as a
// direct tilt amount rather than a physical amplitude.
vec2 duneSlope(vec2 p, float texel, out float height) {
  height = 0.0;
  vec2 slope = vec2(0.0);

  // Low-frequency domain warp so the ridges meander and never read as a single
  // straight 1D ripple (or an obviously tiled pattern far out). The warp is very
  // low frequency, so the local wavelength/slope is essentially unchanged and
  // the unwarped `texel` stays a valid footprint estimate (same trick the water
  // surface FBM uses).
  vec2 wq = p / max(uDuneWavelength, 1.0) * 0.7;
  vec2 warp = vec2(bedNoise(wq), bedNoise(wq + 19.3)) - 0.5;
  vec2 q = p + warp * uDuneWavelength * 0.9;

  vec2 dir = normalize(uDuneDirection + vec2(1e-4, 0.0));
  float k = 6.2831853 / max(uDuneWavelength, 1.0);
  float amp = 1.0;
  float ampSum = 0.0;
  float ca = cos(0.7);
  float sa = sin(0.7);

  for(int i = 0; i < 4; i++) {
    ampSum += amp;
    float aa = 1.0 - smoothstep(1.5, 3.0, k * texel);
    if(aa > 0.001) {
      vec2 perp = vec2(-dir.y, dir.x);
      float along = dot(q, dir);
      float cross = dot(q, perp);
      // Meander the crest lines along the perpendicular axis so ridges wave.
      float meander = sin(cross * k * 0.35) * 1.3;
      float phase = along * k + meander;
      height += amp * sin(phase) * aa;
      // Normalized gradient: d(phase)/dq divided by k (so the result is ~unit
      // order and independent of wavelength). dir term is the ridge slope; the
      // perp term tilts with the meander.
      vec2 dphaseN = dir + perp * (1.3 * cos(cross * k * 0.35) * 0.35);
      slope += amp * cos(phase) * dphaseN * aa;
    }
    k *= 1.9;
    amp *= 0.5;
    // Rotate the ridge direction each octave to decorrelate the layers.
    dir = vec2(dir.x * ca - dir.y * sa, dir.x * sa + dir.y * ca);
  }

  height /= max(ampSum, 1e-3);
  return slope / max(ampSum, 1e-3);
}

void main() {
  #include <logdepthbuf_fragment>

  // The bed is a height-field rendered double-sided so it is visible from above
  // (water-facing top) and from below (underside). In the OIT (transparent)
  // path depth writes are off, so where the relief folds, the near top face and
  // a far underside can land on the same pixel and blend blue-top with
  // sandy-underside into uneven self-transparency mottling. To avoid that, keep
  // only the face that locally faces the camera and discard the opposite one.
  //
  // This uses the LOCAL surface orientation (normal vs. direction to the
  // camera), not a global "camera above the bed" Y plane: when the camera sits
  // within the bed's depth range (e.g. a low, near-horizontal pitch) a global
  // plane flips across the relief and discards parts of the visible side,
  // letting the water/walls behind bleed through.
  //
  // Only applied in the OIT path: at full opacity the bed is opaque-routed and
  // depth testing already resolves overlaps, so discarding there would just
  // punch holes (the very bleed-through this guards against).
  #ifdef USE_OIT
  vec3 toCamera = cameraPosition - vWorldPosition;
  bool topFacesCamera = dot(vWorldNormal, toCamera) > 0.0;
  if(topFacesCamera != gl_FrontFacing)
    discard;
  #endif

  // Orient the normal toward the viewer for stable lighting.
  vec3 N = normalize(vWorldNormal);
  if(!gl_FrontFacing)
    N = -N;

  // Subtle procedural sand-dune relief: perturb the shading normal by the
  // analytic slope of the dune height field. Footprint-anti-aliased, so it
  // fades to flat far out (no shimmer) and only resolves up close.
  float duneHeight = 0.0;
  if(uDuneStrength > 0.0) {
    float texel = max(length(fwidth(vWorldPosition.xz)), 1e-3);
    vec2 g = duneSlope(vWorldPosition.xz, texel, duneHeight);
    // y = h(x,z) => normal tilts by (-dh/dx, -dh/dz) in the horizontal plane.
    N = normalize(N + vec3(-g.x, 0.0, -g.y) * uDuneStrength);
  }

  float ndl = max(dot(N, normalize(uSunDirection)), 0.0);
  vec3 lit = uColor * (uAmbient + (1.0 - uAmbient) * ndl) * uSunColor;

  // Faint crest/trough albedo modulation so the dunes read even on flat-lit
  // areas (kept very subtle to avoid banding).
  lit *= 1.0 + duneHeight * uDuneStrength * 0.15;

  // Optional extra albedo banding: lighten the wind-scoured crests and darken
  // the troughs for a stronger sense of relief/distance. Off by default
  // (uDuneSharpness = 0); the crest term is smoothstepped so it adds contrast
  // without hard bands, and it follows the SAME footprint-faded duneHeight so it
  // also vanishes far out (no aliasing).
  if(uDuneSharpness > 0.0) {
    float band = smoothstep(-1.0, 1.0, duneHeight) - 0.5; // [-0.5, 0.5]
    lit *= 1.0 + band * uDuneSharpness * 0.5;
  }

  // Front face (normals point +Y => water-facing top): tint toward the water
  // colour. Back face (underside / outside): keep the sandy base.
  vec3 color = gl_FrontFacing ? mix(lit, uWaterColor, uWaterTint) : lit;

  float alpha = uOpacity * uMasterOpacity;

  gl_FragColor = vec4(color, alpha);

  #include <colorspace_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
