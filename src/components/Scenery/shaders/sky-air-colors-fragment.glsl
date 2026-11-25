// The air's colours as the camera sees them (sky-air-colors.glsl, SkyAirColors): a texel a
// bearing (x) and a row (y): the horizon's colour, the sky some 25° up as from the sea, and
// the sky overhead as from the sea, as the haze worked them out for each pixel before
// (skyHorizonColor, scenerySurfaceAt). The horizon softening has no effect on any of them: each
// lies on the horizon or well above it. One call of the sky's surface for all three rows, as
// Direct3D compiles a copy of a function for every call.

#include <common>
#include ./sky-gradient.glsl

uniform float uSkyHorizonBlend;

void main() {
  float bearing = (gl_FragCoord.x / float(SKY_AIR_BEARINGS) - 0.5) * PI2;
  int row = int(gl_FragCoord.y);
  vec3 look = globeCameraLook();
  vec3 way = cos(bearing) * uSkyAirEast + sin(bearing) * uSkyAirNorth;
  // The horizon from the camera's height; the sky above it from the sea's, whose horizon is
  // level (skyHorizonAt).
  float height = row == 0 ? skyCameraHeight() : 0.0;
  float sine = row == 0 ? skyHorizonAt(way, height) : 0.0;
  vec3 dir = row == 0 ? way * sqrt(1.0 - sine * sine) + look * sine : row == 1 ? normalize(way + look * SKY_AIR_BLUE_RISE) : look;
  gl_FragColor = vec4(scenerySurfaceSeen(dir, uSkyHorizonBlend, sine, skyLight(skyLightShare(dir, height))), 1.0);
}
