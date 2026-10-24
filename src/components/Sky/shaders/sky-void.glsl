// The void's gradient all round, without its detail: the lid's colour overhead fading to
// the horizon's, and the depths' below. The stand-in draws it while the sky compiles, and
// the sky draws it in place of its own with `background: 'void'` (SKY_VOID).

uniform vec3 uSkyAbyssCeilingColor;
uniform vec3 uSkyAbyssHorizonColor;
uniform vec3 uSkyAbyssDepthColor;
uniform float uSkyAbyssFalloff; // exponent of the depths' gradient below the horizon

// The bottomless gradient below the horizon, for a view ray at height `y` along up.
vec3 skyAbyssGradient(float y) {
  return mix(uSkyAbyssHorizonColor, uSkyAbyssDepthColor, pow(max(-y, 0.0), uSkyAbyssFalloff));
}

// The whole gradient for a view ray at height `y` along up (or over the horizon): the lid
// above the horizon, the depths below.
vec3 skyVoidGradient(float y) {
  return y > 0.0 ? mix(uSkyAbyssHorizonColor, uSkyAbyssCeilingColor, sqrt(y)) : skyAbyssGradient(y);
}
