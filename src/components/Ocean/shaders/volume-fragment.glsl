// Ocean water-body (volume) fragment shader.
//
// Shades the box side walls (rendered back-face) as a depth-tinted water body:
// the further a wall fragment is from the camera, the denser the water tint
// between the camera and that fragment, like an exponential fog. This gives the
// "inside a water body" feel when the camera is within the box, and a tinted
// body seen through the (transparent) surface from outside — without a separate
// fullscreen pass. Animated caustic light play near the surface breaks up the
// flat tint.
//
// OIT-compatible: includes the shared oit.glsl chunk and routes its final colour
// through oitProcess() so it composites with the surface and subsurface geometry.

uniform float uTime;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform float uFogDensity;   // per-meter tint build-up
uniform float uMaxOpacity;   // densest tint (far through the water)
uniform float uShimmer;      // animated brightness variation (0 = off)
uniform float uMasterOpacity;

varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying float vWallV; // 1 at the top (surface) edge, 0 at the sea bed

#include <common>
#include <logdepthbuf_pars_fragment>

#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

void main() {
  #include <logdepthbuf_fragment>

  float dist = length(vViewPosition);

  // Exponential fog build-up with view distance through the water.
  float fog = 1.0 - exp(-dist * uFogDensity);

  // Tint shifts from the shallow toward the deep colour as the body deepens.
  vec3 color = mix(uShallowColor, uDeepColor, clamp(fog, 0.0, 1.0));

  // Animated underwater light play. Replaces the old axis-aligned product-of-
  // sines (which read as a flat, blocky pulsing grid): two drifting, criss-
  // crossing wave layers form soft caustic filaments, concentrated just under
  // the surface (vWallV near 1) and fading with depth — so it looks like sunlight
  // filtering down through the water rather than a uniform brightness flicker.
  //
  // Footprint anti-aliased: each layer fades out as its world wavelength
  // approaches the on-screen pixel size, so the body never shimmers/moirés when
  // zoomed far out at field scale (only resolving as the camera nears it).
  if(uShimmer > 0.0) {
    float texel = max(length(fwidth(vWorldPosition.xz)), 1e-3);

    // Light concentrates near the surface and fades toward the bed (depth-cue).
    float nearSurface = vWallV * vWallV;

    if(nearSurface > 0.001) {
      // Broad, slow caustic web (~250 m features).
      float webAA = 1.0 - smoothstep(120.0, 400.0, texel);
      float web = 0.0;
      if(webAA > 0.001) {
        vec2 p = vWorldPosition.xz * 0.0045;
        float t = uTime * 0.18;
        float c = sin(p.x * 1.3 + sin(p.y * 0.7 + t)) +
          sin(p.y * 1.1 - sin(p.x * 0.9 - t * 0.8));
        web = pow(max(c * 0.25 + 0.5, 0.0), 3.0) * webAA;
      }

      // Finer, faster ripple twinkle (~60 m features).
      float rippleAA = 1.0 - smoothstep(40.0, 140.0, texel);
      float ripple = 0.0;
      if(rippleAA > 0.001) {
        vec2 q = vWorldPosition.xz * 0.018;
        float t = uTime * 0.5;
        float r = sin(q.x + sin(q.y * 1.4 + t) + t * 0.6) +
          sin(q.y * 1.2 - sin(q.x - t * 0.7));
        ripple = pow(max(r * 0.25 + 0.5, 0.0), 4.0) * rippleAA;
      }

      // Brighten toward the shallow (sunlit) colour rather than a flat white so
      // it reads as light in the water, not a glare overlay.
      float light = (web * 0.7 + ripple * 0.5) * nearSurface;
      color = mix(color, uShallowColor, clamp(light * uShimmer, 0.0, 0.5));
    }
  }

  float alpha = clamp(fog * uMaxOpacity, 0.0, 1.0) * uMasterOpacity;

  gl_FragColor = vec4(color, alpha);

  #include <colorspace_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
