// The scenery's background, its first layer: the sky itself (skyAir), under every other
// layer (scenery-layers.ts). See scenery.glsl for the model.

#include <common>
#include <fog_pars_fragment>
#include <dithering_pars_fragment>
#include ./scenery.glsl

varying vec3 vSceneryDirection;

void main() {
  vec3 dir = normalize(vSceneryDirection);
  gl_FragColor = vec4(hollowDullSky(skyAir(dir, skyBlendAt(dir))) * uSceneryIntensity, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <dithering_fragment>
}