// The sky's sea surface as a layer of its own, blended over the background's seabed (and
// a stage's) the same way a stage's surface is blended, so the two cannot differ.

#include <common>
#include ./sky.glsl

varying vec3 vSkyDirection;

void main() {
  vec3 dir = normalize(vSkyDirection);
  float blend = max(uSkyHorizonBlend, fwidth(dot(dir, globeCameraLook())));
  vec4 surface = skyOceanSurfaceLayer(dir, cameraPosition, blend);
  gl_FragColor = vec4(skyDebugTint(surface.rgb, SKY_DEBUG_LAYER) * uSkyIntensity, surface.a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
