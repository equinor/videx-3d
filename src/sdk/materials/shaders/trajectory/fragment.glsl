#define TRAJECTORY_MATERIAL

uniform vec3 diffuse;
uniform float opacity;

#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
varying vec3 vViewPosition;
varying vec3 vColor;

#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

#include ../../shaderLib/color-conversion.glsl

void main() {
	#include <clipping_planes_fragment>

  vec3 color = diffuse.rgb;
  	
  vec4 diffuseColor = vec4(color.rgb, opacity);

	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
  #include <normal_fragment_begin>
  
  #ifdef DEPTH_SHADE
    float depthFactor = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
    float darkenFactor = clamp(vViewPosition.z / 5000.0, 0.1, 0.8);
    vec3 hsv = rgb2hsv(diffuseColor.rgb);
    hsv.z = hsv.z * darkenFactor;
    vec3 mixColor = hsv2rgb(hsv);
    diffuseColor.rgb = mix(mixColor, diffuseColor.rgb, pow(depthFactor, 0.8));
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
}