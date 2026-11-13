// The deep water under an Ocean's surface where nothing else lies under it (OceanDeepMaterial):
// the water's own light along the sight line, as water too deep to see through (water-body.glsl),
// one model with every sea's.

uniform float uMasterOpacity;

varying vec3 vWorldPosition;

#include <common>
#include ../../../sdk/materials/shaderLib/water-body.glsl

void main() {
  // Only under the surface seen from above it: from below its height (in the water, or in the
  // air beside a water box) what lies there is the water's own business, or the air's.
  vec3 up = uWaterBody.xyz;
  if(dot(cameraPosition, up) <= uWaterBody.w)
    discard;
  vec3 color = waterBodyDeep(dot(normalize(vWorldPosition - cameraPosition), up), true);
  gl_FragColor = vec4(color, uMasterOpacity);
  #include <colorspace_fragment>
}
