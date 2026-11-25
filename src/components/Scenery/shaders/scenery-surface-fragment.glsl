// The sky's sea surface as a layer of its own, blended over the background's seabed (and
// a stage's) the same way a stage's surface is blended, so the two cannot differ.

#include <common>
#include ./scenery.glsl

varying vec3 vSceneryDirection;

void main() {
  vec3 dir = normalize(vSceneryDirection);
  float blend = max(uSkyHorizonBlend, fwidth(dot(dir, globeCameraLook())));
  vec4 surface = scenerySeaSurfaceLayer(dir, cameraPosition, blend);
  gl_FragColor = vec4(sceneryDebugTint(surface.rgb, SCENERY_DEBUG_LAYER) * uSceneryIntensity, surface.a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
