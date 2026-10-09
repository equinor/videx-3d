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

#ifdef USE_OIT
#include ../../../../sdk/materials/shaderLib/oit.glsl
#endif

#include ../../../../sdk/materials/shaderLib/ramp-filter.glsl

void main() {
  vec2 uvDx = dFdx(vUv);
  vec2 uvDy = dFdy(vUv);

	#include <clipping_planes_fragment>

  // Reversed range, so the ramp reads the way it always has here.
  vec3 color = rampSampleFiltered(
    data,
    vUv,
    uvDx,
    uvDy,
    colorRampTexture,
    (float(colorRampIndex) + 0.5) / float(colorRamps),
    vec2(colorRampMax, colorRampMin)
  );

  vec4 diffuseColor = vec4(color, opacity);

	#include <logdepthbuf_fragment>
  vec3 surfaceNormal = normalize(gl_FrontFacing ? vNormal : -vNormal);

  diffuseColor.rgb *= clamp(pow(dot(surfaceNormal, normalize(vViewPosition)), .5), 0.5, 1.0);

  gl_FragColor = diffuseColor.rgba;

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
