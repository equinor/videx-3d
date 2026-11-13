// The deep water under an Ocean's surface where nothing else lies under it (OceanDeepMaterial):
// the water's own light along the sight line, as water too deep to see through (water-body.glsl),
// one model with every sea's.

uniform float uMasterOpacity;

varying vec3 vWorldPosition;

#include <common>
#include ../../../sdk/materials/shaderLib/water-body.glsl

void main() {
  vec3 up = uWaterBody.xyz;
  bool fromAir = dot(cameraPosition, up) > uWaterBody.w;
  vec3 color = waterBodyDeep(dot(normalize(vWorldPosition - cameraPosition), up), fromAir);
  gl_FragColor = vec4(color, uMasterOpacity);
  #include <colorspace_fragment>
}
