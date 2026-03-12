#define SEISMIC_MATERIAL

uniform float opacity;
uniform sampler2D data;
uniform sampler2D colorRampTexture;
uniform int colorRampIndex;
uniform float colorRampMin;
uniform float colorRampMax;
uniform int colorRamps;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;

#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

const bool colorRampReverse = true;

vec3 getColor(float v) {
  float min = colorRampMin;
  float max = colorRampMax;

  float t = saturate((v - min) / (max - min));
  if(colorRampReverse) {
    t = 1.0 - t;
  }
  vec4 texel = texture2D(colorRampTexture, vec2(t, (float(colorRampIndex) + 0.5) / float(colorRamps)));
  return texel.rgb;
}

void main() {
	#include <clipping_planes_fragment>

  float dataPoint = texture2D(data, vUv).r;

  vec4 diffuseColor = vec4(getColor(dataPoint), opacity);

	#include <logdepthbuf_fragment>
  vec3 surfaceNormal = normalize(gl_FrontFacing ? vNormal : -vNormal);

  diffuseColor.rgb *= clamp(pow(dot(surfaceNormal, normalize(vViewPosition)), .5), 0.5, 1.0);

  gl_FragColor = diffuseColor.rgba;

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>

}