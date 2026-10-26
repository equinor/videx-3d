// Contour lines, as a Surface and a relief draw them (`ContourColorMode`): a solid line
// `thickness` pixels each side with a pixel's soft edge, its distance from the line measured in
// pixels by the value's slope on screen, so it is as wide along any direction and at any
// angle; major lines; and a fade where lines crowd, so a distant or grazing view is not a
// smear or a moiré.

// The length of `v`'s gradient on screen: how much it changes over a pixel, in any
// direction. ⚠️ Derivatives.
float contourGradient(float v) {
  return length(vec2(dFdx(v), dFdy(v)));
}

// How much of the pixel the nearest line covers (0 to 1), for lines where `v` is a whole
// number, `g` its gradient on screen (contourGradient) and `width` the line's in pixels.
float contourLineCover(float v, float g, float width) {
  float pixels = abs(v - floor(v + 0.5)) / max(g, 1e-6);
  return clamp(0.5 * width + 0.5 - pixels, 0.0, 1.0);
}

// How much of lines `g` apart per pixel (in their own spacing) is kept: all while over 8
// pixels apart, none once 3 pixels apart.
float contourCrowd(float g) {
  return 1.0 - smoothstep(0.125, 0.333, g);
}

// `color` where a line covers `line` of it (0 to 1): darkened (mode 0), lightened (1) or
// blended toward `lineColor` (2), by `factor`.
vec3 contourShade(vec3 color, float line, int mode, float factor, vec3 lineColor) {
  if(mode == 0)
    return color * (1.0 - line * factor);
  if(mode == 1)
    return color * (1.0 + line * factor);
  return mix(color, lineColor, line * factor);
}

// How much of a line covers this pixel (0 to 1), for lines every `interval` of `value` from
// 0, `thickness` pixels each side, and every `major`-th one (below 2 for none) twice as
// wide. `gValue` is contourGradient(value), taken where control flow is uniform: so
// `interval` may change from pixel to pixel. Lines fade out as they crowd, the minor ones
// first.
float contourCover(float value, float gValue, float interval, float thickness, float major) {
  float g = gValue / interval;
  float minor = contourLineCover(value / interval, g, 2.0 * thickness) * contourCrowd(g);
  if(major < 1.5)
    return minor;
  float every = floor(major + 0.5);
  float gm = g / every;
  float heavy = contourLineCover(value / (interval * every), gm, 4.0 * thickness) * contourCrowd(gm);
  return max(minor, heavy);
}
