// A layer of the scenery's background over the sky (scenery-layers.ts): the void
// (SCENERY_LAYER_VOID), the sea seen from the air (SCENERY_LAYER_SEA) or the view in the water
// (SCENERY_LAYER_WATER). Each is premultiplied in scenery.glsl and drawn
// unpremultiplied here, so three's tone mapping, colour space and fog apply as to any
// colour, and blended with its alpha over the layers before it.

#include <common>
#include <fog_pars_fragment>
#include <dithering_pars_fragment>
// The relief's looks, for its seabed (SCENERY_SEABED_LOOK, scenery-sea.glsl's scenerySeabed): here,
// once, before the sky, as no other program of the sky's needs them and the relief's own include
// them themselves.
#include ./relief-look.glsl
#include ./scenery.glsl

varying vec3 vSceneryDirection;

void main() {
  vec3 dir = normalize(vSceneryDirection);
  vec3 origin = sceneryViewOrigin();
  #if defined(SCENERY_LAYER_VOID)
  vec4 layer = sceneryVoidLayer(dir, origin);
  #elif defined(SCENERY_LAYER_SEA)
  vec4 layer = scenerySeaLayer(dir, origin, skyBlendAt(dir));
  #elif defined(SCENERY_LAYER_WATER)
  vec4 layer = sceneryWaterLayer(dir, origin, skyBlendAt(dir));
  #else
  vec4 layer = vec4(0.0);
  #endif
  // Last, after every derivative is taken: where it adds nothing, nothing is blended.
  if(layer.a <= 0.0)
    discard;
  gl_FragColor = vec4(layer.rgb / layer.a * uSceneryIntensity, layer.a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <dithering_fragment>
}