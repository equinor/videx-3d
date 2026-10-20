// Drawn in the sky's place while its shaders compile: the void's gradient all round, lid
// above the horizon and depths below, without its detail and wherever the camera is.
// Small, so it is up at once.

#include <common>
#include <fog_pars_fragment>

uniform vec3 uSkyUp; // normalised
uniform float uSkyIntensity;
uniform vec3 uSkyAbyssCeilingColor;
uniform vec3 uSkyAbyssHorizonColor;
uniform vec3 uSkyAbyssDepthColor;
uniform float uSkyAbyssFalloff;

varying vec3 vSkyDirection;

void main() {
  float y = dot(normalize(vSkyDirection), uSkyUp);
  vec3 lid = mix(uSkyAbyssHorizonColor, uSkyAbyssCeilingColor, sqrt(max(y, 0.0)));
  vec3 depths = mix(uSkyAbyssHorizonColor, uSkyAbyssDepthColor, pow(max(-y, 0.0), uSkyAbyssFalloff));
  gl_FragColor = vec4((y > 0.0 ? lid : depths) * uSkyIntensity, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
