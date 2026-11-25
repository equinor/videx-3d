// The colours the air fades what it hazes into, as the camera sees them (SkyAirColors,
// scenery-air-colors.ts): along each bearing about the camera's look, the horizon's colour
// (skyHorizonColor) and the sky some 25° up (scenerySurfaceAt, as from the sea); and the sky
// overhead. Drawn once for each place the camera draws from (sky-air-colors-fragment.glsl),
// rather than worked out for every pixel of what lies in the air: the relief's, the sea's and
// the clouds' haze read them here, so none of their programs holds a copy of the sky's surface.

// How far up the sky the haze's blue is taken: a level bearing plus this much of the look,
// some 25°.
#define SKY_AIR_BLUE_RISE 0.47

// The lookup's frame about the camera's look, level there (SkyAirColors.update): its bearings
// run round from east toward north.
uniform vec3 uSkyAirEast;
uniform vec3 uSkyAirNorth;

#ifndef SKY_AIR_PASS
uniform sampler2D uSkyAirColors;

// The lookup's u for the bearing of `way` (level, any length): 0 to 1, wrapping. Never
// atan(0, 0), which is undefined.
float skyAirBearing(vec3 way) {
  return atan(dot(way, uSkyAirNorth), dot(way, uSkyAirEast) + 1e-20) * (0.5 / PI) + 0.5;
}

// A row of the lookup along `way`'s bearing: no derivatives, so it may be read in any branch.
vec3 skyAirRow(vec3 way, float row) {
  return textureLod(uSkyAirColors, vec2(skyAirBearing(way), (row + 0.5) / 3.0), 0.0).rgb;
}

// The horizon's colour along `way`'s bearing (skyHorizonColor).
vec3 skyAirHorizon(vec3 way) {
  return skyAirRow(way, 0.0);
}

// The sky some 25° up along `way`'s bearing, as from the sea (scenerySurfaceAt).
vec3 skyAirBlue(vec3 way) {
  return skyAirRow(way, 1.0);
}

// The sky overhead, along the camera's look, as from the sea (scenerySurfaceAt).
vec3 skyAirOverhead() {
  return texelFetch(uSkyAirColors, ivec2(0, 2), 0).rgb;
}
#endif
