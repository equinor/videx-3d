// Drawn in the sky's place while its shaders compile: the void's gradient all round, ceiling
// above the horizon and depths below, wherever the camera is (scenery-void.glsl). Small, so it
// is up at once. Not drawn with no sky (Scenery's `sky`): the scene's background shows instead.

#include <common>
#include <fog_pars_fragment>
#include ./scenery-void.glsl

uniform vec3 uSceneryUp; // normalised
uniform float uSceneryIntensity;

varying vec3 vSceneryDirection;

void main() {
  float y = dot(normalize(vSceneryDirection), uSceneryUp);
  gl_FragColor = vec4(sceneryVoidGradient(y) * uSceneryIntensity, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
