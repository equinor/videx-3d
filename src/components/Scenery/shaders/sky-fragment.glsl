// The scenery's background, its first layer: the sky itself (skyAir), under every other
// layer (scenery-layers.ts). See sky.glsl for the model.

#include <common>
#include <fog_pars_fragment>
#include <dithering_pars_fragment>
#include ./sky.glsl

varying vec3 vSkyDirection;

void main() {
  vec3 dir = normalize(vSkyDirection);
  gl_FragColor = vec4(skyAir(dir, skyBlendAt(dir)) * uSkyIntensity, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <dithering_fragment>
}