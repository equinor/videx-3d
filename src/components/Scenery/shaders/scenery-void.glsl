// The void's gradient all round (VoidGradient, sdk/materials/void-gradient.ts, which draws the
// same into a texture): the ceiling's colour overhead fading to the horizon's, and the depths'
// below. The stand-in draws it while the sky compiles, the plain void below its horizon, and
// with no sky (uScenerySky 0) it is what the sky's surface is read as: the seas' reflections
// and the bakes.

uniform vec3 uSceneryVoidCeilingColor;
uniform vec3 uSceneryVoidHorizonColor;
uniform vec3 uSceneryVoidDepthColor;
uniform float uSceneryVoidFalloff; // exponent of the depths' gradient below the horizon

// The bottomless gradient below the horizon, for a view ray at height `y` along up.
vec3 sceneryVoidDepthsGradient(float y) {
  return mix(uSceneryVoidHorizonColor, uSceneryVoidDepthColor, pow(max(-y, 0.0), uSceneryVoidFalloff));
}

// The whole gradient for a view ray at height `y` along up (or over the horizon): the lid
// above the horizon, the depths below.
vec3 sceneryVoidGradient(float y) {
  return y > 0.0 ? mix(uSceneryVoidHorizonColor, uSceneryVoidCeilingColor, sqrt(y)) : sceneryVoidDepthsGradient(y);
}
