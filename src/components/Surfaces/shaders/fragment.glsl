#define MESH_SURFACE_MATERIAL

uniform sampler2D normalTexture;
uniform mat3 normalMatrix;
uniform float referenceDepth;
uniform sampler2D depthTexture;

#ifdef USE_COLOR_RAMP

uniform sampler2D colorRampTexture;
uniform int colorRampIndex;
uniform float colorRampMin;
uniform float colorRampMax;
uniform bool colorRampReverse;
uniform int colorRamps;

#endif

#ifdef USE_CONTOURS

uniform float contoursInterval;
uniform int contoursColorMode;
uniform float contoursColorModeFactor;
uniform float contoursThickness;
uniform vec3 contoursColor;

#endif

uniform float saturation;
uniform float brightness;
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;

#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
// #include <normal_pars_fragment>
#ifndef FLAT_SHADED
  //varying vec3 vNormal;
	#ifdef USE_TANGENT
varying vec3 vTangent;
varying vec3 vBitangent;
	#endif
#endif
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

// custom fragments
#include ../../../sdk/materials/shaderLib/color-conversion.glsl

vec3 adjustColor(vec3 color, float saturation, float brightness) {
  vec3 hsl = rgb2hsl(color);
  hsl.y = hsl.y * saturation;
  vec3 rgb = hsl2rgb(hsl);
  rgb += vec3(brightness);
  return clamp(rgb, 0.0, 1.0);
}

#ifdef USE_COLOR_RAMP

vec3 getColor(float v) {
  float min = colorRampMin;
  float max = colorRampMax;

  float t = clamp((v - min) / (max - min), 0.0, 1.0);
  if(colorRampReverse) {
    t = 1.0 - t;
  }
  vec4 texel = texture2D(colorRampTexture, vec2(t, (float(colorRampIndex) + 0.5) / float(colorRamps)));
  return texel.rgb;
}

#endif

float getPointValue(vec2 pos) {
  vec4 pixel = texture2D(depthTexture, pos);
  if(pixel.a == 0.)
    return -1.;
  return (referenceDepth - ((pixel.r * 256. * 256. * 256.) + (pixel.g * 256. * 256.) + (pixel.b * 256.)) / 1000.);
}

#ifdef USE_CONTOURS

float contourLine(float v) {
  float f = abs(fract(v) - .5);
  float df = fwidth(v) * contoursThickness;
  return smoothstep(0., df, f);
}

#endif

void main() {

  vec3 textureNormal = texture2D(normalTexture, vUv).rgb * 2. - 1.;
  vec3 vNormal = normalize(normalMatrix * textureNormal);

	#include <clipping_planes_fragment>

  vec4 diffuseColor = vec4(diffuse, opacity);

  float texDepth = getPointValue(vUv.xy);

  if(texDepth <= -1.) {
    discard;
  }

  #ifdef USE_COLOR_RAMP

  vec3 sampledColor = getColor(texDepth);
  diffuseColor = vec4(sampledColor, opacity);

  #endif

  #ifdef USE_CONTOURS
  float h = (texDepth + contoursInterval / 2.) / contoursInterval;

  float t = contourLine(h);

  float colorMod = 1.;

  if(contoursColorMode == 0) { // darken
    colorMod = 1. - (1. - t) * contoursColorModeFactor;
  } else if(contoursColorMode == 1) { // lighten
    colorMod = 1.0 + (1. - t) * contoursColorModeFactor;
  }

  #endif

  ReflectedLight reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
  vec3 totalEmissiveRadiance = emissive;

	  // TODO: Something is not correct with this
  diffuseColor = vec4(adjustColor(diffuseColor.rgb, saturation, brightness), diffuseColor.w);

  #include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>

	// accumulation
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>

	// modulation
	#include <aomap_fragment>

  vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;

  #ifdef USE_CONTOURS
  outgoingLight *= colorMod;

  if(contoursColorMode == 2) { // mixed
    outgoingLight = mix(outgoingLight, contoursColor, (1. - t) * contoursColorModeFactor);
  }

  #endif
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>

  //gl_FragColor = vec4(vNormal, opacity);

}