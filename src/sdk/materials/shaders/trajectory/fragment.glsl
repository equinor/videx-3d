#define TRAJECTORY_MATERIAL

uniform vec3 diffuse;
uniform float opacity;

#ifndef FLAT_SHADED
varying vec3 vNormal;
#endif
varying vec3 vViewPosition;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

#include ../../shaderLib/color-conversion.glsl

#ifdef USE_OIT
#include ../../shaderLib/oit.glsl
#endif

void main() {
	#include <clipping_planes_fragment>

  vec3 color = diffuse.rgb;

  vec4 diffuseColor = vec4(color.rgb, opacity);

	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
  #include <normal_fragment_begin>

  #ifdef DEPTH_SHADE
  float ndv = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
  // Analytic shading anti-aliasing for the silhouette rim. At the tube edge N·V
  // collapses to 0 within a sub-pixel band, so pow(ndv, 0.8) below produces a
  // razor-thin dark rim that the rasterizer undersamples. That sub-pixel shading
  // frequency is what reads as a jagged dark fringe and which edge-AA passes
  // (FXAA/SMAA) cannot fix. Clamp ndv to its per-pixel screen-space footprint so
  // the steep part of the curve can never compress below ~1px; the bulk rounded
  // shading across the tube cross-section (where ndv changes slowly) is unaffected.
  float ndvAA = max(ndv, fwidth(ndv));
  float depthFactor = pow(ndvAA, 0.8);
  float darkenFactor = clamp(vViewPosition.z / 5000.0, 0.1, 0.8);
  vec3 hsv = rgb2hsv(diffuseColor.rgb);
  hsv.z = hsv.z * darkenFactor;
  vec3 mixColor = hsv2rgb(hsv);
  diffuseColor.rgb = mix(mixColor, diffuseColor.rgb, depthFactor);
  #else
  float alphaFactor = clamp(vViewPosition.z / 100000.0, 0.0, 0.9);

  diffuseColor.a = 1.0 - alphaFactor;
  #endif

  gl_FragColor = diffuseColor.rgba;

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
