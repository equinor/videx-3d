// Drawn in the sky's place while its shaders compile: the void's gradient all round, lid
// above the horizon and depths below, without its detail and wherever the camera is
// (sky-void.glsl, as `background: 'void'` draws it). Small, so it is up at once.

#include <common>
#include <fog_pars_fragment>
#include ./sky-void.glsl

uniform vec3 uSkyUp; // normalised
uniform float uSkyIntensity;

varying vec3 vSkyDirection;

void main() {
  float y = dot(normalize(vSkyDirection), uSkyUp);
  gl_FragColor = vec4(skyVoidGradient(y) * uSkyIntensity, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
