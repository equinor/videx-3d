// Sky fragment shader. See sky.glsl for the model.

#include <common>
#include <fog_pars_fragment>
#include <dithering_pars_fragment>
#include ./sky.glsl

varying vec3 vSkyDirection;

void main() {
  gl_FragColor = vec4(skyRadiance(normalize(vSkyDirection), cameraPosition), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <dithering_fragment>
}
