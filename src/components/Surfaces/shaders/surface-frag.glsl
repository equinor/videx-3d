#define MESH_SURFACE_MATERIAL

uniform mat3 gridUvMat;
uniform mat3 normalMatrix;
uniform float referenceDepth;
uniform sampler2D elevationTexture;
uniform vec2 scale;
uniform float rotation;
#ifndef USE_DEBUG
uniform vec2 size;
#endif

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

varying vec2 vGridUv;

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

#ifdef USE_DEBUG
#include ../../../sdk/materials/shaderLib/glyphs.glsl
#include ../../../sdk/materials/shaderLib/render-number.glsl

float pristineGrid(vec2 uv, vec2 lineWidth) {
  vec2 uvDeriv = fwidth(uv * 2.0);

  vec2 drawWidth = clamp(lineWidth, uvDeriv, vec2(0.5));
  vec2 lineAA = uvDeriv * 1.5;
  vec2 gridUV = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 grid2 = smoothstep(drawWidth + lineAA, drawWidth - lineAA, gridUV);
  grid2 *= saturate(lineWidth / drawWidth);
  grid2 = mix(grid2, lineWidth, clamp(uvDeriv * 2.0 - 1.0, 0.0, 1.0));

  return max(grid2.x, grid2.y);
}

vec4 drawGrid(vec4 color, vec2 uv, vec3 lineColor, vec2 lineWidth) {
  float grid = pristineGrid(uv, lineWidth);
  color = mix(color, vec4(lineColor, 1.0), grid);
  return color;
}
#endif

vec3 adjustColor(vec3 color, float saturation, float brightness) {
  vec3 hsl = rgb2hsl(color);
  hsl.y = hsl.y * saturation;
  vec3 rgb = hsl2rgb(hsl);
  rgb += vec3(brightness);
  return clamp(rgb, 0.0, 1.0);
}

vec3 rotateVec3(vec3 v, vec3 a, float angle) {
  float c = cos(angle);
  float s = sin(angle);

  float t = 1.0 - c;

  float tx = t * a.x;
  float ty = t * a.y;

  return vec3((tx * a.x + c) * v.x + (tx * a.y - s * a.z) * v.y + (tx * a.z + s * a.y) * v.z, (tx * a.y + s * a.z) * v.x + (ty * a.y + c) * v.y + (ty * a.z - s * a.x) * v.z, (tx * a.z - s * a.y) * v.x + (ty * a.z + s * a.x) * v.y + (t * a.z * a.z + c) * v.z);
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

float getElevation(vec2 pos) {
  float value = texture2D(elevationTexture, pos).r;
  return value;
}

#ifdef USE_CONTOURS

float contourLine(float v) {
  float f = abs(fract(v) - .5);
  float df = max(0.0025, fwidth(v) * contoursThickness);
  return smoothstep(0., df, f);
}

#endif

void main() {
	#include <clipping_planes_fragment>

  float elevation = getElevation(vGridUv);

  if(elevation < 0.0) {
    discard;
  }

  vec2 gridSegments = size - 1.0;

  float depth = referenceDepth - elevation;

  // normal

  float distanceFactor = 1.;
  vec2 offset = distanceFactor / gridSegments;
  vec2 dist = scale * distanceFactor;

  float nw = getElevation(saturate(vGridUv + vec2(-offset.x, offset.y)));
  float ne = getElevation(saturate(vGridUv + vec2(offset.x, offset.y)));
  float sw = getElevation(saturate(vGridUv + vec2(-offset.x, -offset.y)));
  float se = getElevation(saturate(vGridUv + vec2(offset.x, -offset.y)));

  vec3 p1 = vec3(-dist.x, nw - elevation, -dist.y);
  vec3 p2 = vec3(dist.x, ne - elevation, -dist.y);
  vec3 p3 = vec3(-dist.x, sw - elevation, dist.y);
  vec3 p4 = vec3(dist.x, se - elevation, dist.y);

  vec3 n0 = vec3(0.0, 0.0001, 0.0);

  if(nw >= 0.0 && ne >= 0.0)
    n0 += cross(p2, p1);
  if(ne >= 0.0 && se >= 0.0)
    n0 += cross(p4, p2);
  if(sw >= 0.0 && se >= 0.0)
    n0 += cross(p3, p4);
  if(se >= 0.0 && nw >= 0.0)
    n0 += cross(p1, p3);

  n0 = rotateVec3(n0, vec3(0.0, 1.0, 0.0), rotation);
  vec3 vNormal = normalize(normalMatrix * n0);

  // color
  vec4 diffuseColor = vec4(diffuse, opacity);

  #ifdef USE_COLOR_RAMP

  vec3 sampledColor = getColor(depth);
  diffuseColor = vec4(sampledColor, opacity);

  #endif

  // debug
  #ifdef USE_DEBUG

  vec2 pixelCoords = vec2(vUv.x, 1.0 - vUv.y) * gridSegments;

  vec2 guv = vGridUv * size;
  diffuseColor = drawGrid(diffuseColor, guv, vec3(0.), vec2(0.01));

  float fontSize = .2;
  float scale = glyphFontSize / fontSize;

  float spacing = scale;

  vec2 xy = pixelCoords.xy * scale;
  vec2 ixy = round(xy / spacing);

  vec2 p = xy - spacing * ixy;
  vec2 px = vec2(p.x, p.y + 0.25 * scale);
  vec2 py = vec2(p.x, p.y - 0.25 * scale);
  vec3 clr = diffuseColor.rgb;
  vec2 uv = ixy / gridSegments;
  uv.y = 1.0 - uv.y;
  uv = (gridUvMat * vec3(uv, 1.0)).xy;
  float v = referenceDepth - getElevation(uv);
  renderNumber(clr, p, v, 1u, 0., 0.5, vec3(1., 0., 1.), 0., scale);
  renderNumber(clr, px, ixy.x, 0u, 0., 0.5, vec3(1., 0., 0.), 0., scale);
  renderNumber(clr, py, ixy.y, 0u, 0., 0.5, vec3(0., 0., 1.), 0., scale);

  diffuseColor.rgb = clr;
  #endif

  // contour lines
  #ifdef USE_CONTOURS
  float h = (depth + contoursInterval * 0.5) / contoursInterval;

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

  //gl_FragColor = vec4(vNormal, 1.0);
}
