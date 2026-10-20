// Drawn in the sky's place while its shaders compile: its gradient and the sun's halo,
// with the sea's colour below the horizon, and all round under the sea surface. Small,
// so it is up at once.

#include <common>
#include <fog_pars_fragment>
#include ./sky-gradient.glsl

uniform float uSkyHorizonBlend;
uniform float uSkyIntensity;
#ifdef SKY_OCEAN
uniform float uSkyOceanLevel;
uniform vec3 uDeepColor;
#endif

varying vec3 vSkyDirection;

void main() {
  vec3 dir = normalize(vSkyDirection);
  float y = dot(dir, uSkyUp);
  float blend = max(uSkyHorizonBlend, fwidth(y));
  vec3 color = skySurface(dir, blend);
  #ifdef SKY_OCEAN
  float above = step(uSkyOceanLevel, dot(cameraPosition, uSkyUp));
  vec3 sea = uDeepColor * mix(0.15, 1.0, uSkyDaylight);
  color = mix(sea, color, above * smoothstep(-blend, 0.0, y));
  #endif
  gl_FragColor = vec4(color * uSkyIntensity, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
