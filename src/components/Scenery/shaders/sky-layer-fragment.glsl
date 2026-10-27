// A layer of the scenery's background over the sky (scenery-layers.ts): its clouds
// (SKY_LAYER_CLOUDS), the void (SKY_LAYER_ABYSS), the sea seen from the air (SKY_LAYER_SEA)
// or the view in the water (SKY_LAYER_WATER). Each is premultiplied in sky.glsl and drawn
// unpremultiplied here, so three's tone mapping, colour space and fog apply as to any
// colour, and blended with its alpha over the layers before it.

#include <common>
#include <fog_pars_fragment>
#include <dithering_pars_fragment>
#include ./sky.glsl

varying vec3 vSkyDirection;

void main() {
  vec3 dir = normalize(vSkyDirection);
  vec3 origin = skyViewOrigin();
  #if defined(SKY_LAYER_CLOUDS)
  vec4 layer = skyCloudsLayer(dir, origin, skyBlendAt(dir));
  #elif defined(SKY_LAYER_ABYSS)
  vec4 layer = skyAbyssLayer(dir, origin);
  #elif defined(SKY_LAYER_SEA)
  vec4 layer = skySeaLayer(dir, origin, skyBlendAt(dir));
  #elif defined(SKY_LAYER_WATER)
  vec4 layer = skyWaterLayer(dir, origin, skyBlendAt(dir));
  #else
  vec4 layer = vec4(0.0);
  #endif
  // Last, after every derivative is taken: where it adds nothing, nothing is blended.
  if(layer.a <= 0.0)
    discard;
  gl_FragColor = vec4(layer.rgb / layer.a * uSkyIntensity, layer.a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <dithering_fragment>
}