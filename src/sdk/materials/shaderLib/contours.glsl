// Contour lines, as a Surface draws them (`ContourColorMode`), and with major lines and a
// fade where they crowd, as a relief draws them.

// 1 off a line, falling to 0 on it: the line where `v` is a whole number and a half, about
// `thickness` pixels each side, `w` being fwidth(v).
float contourLineWidth(float v, float w, float thickness) {
  float f = abs(fract(v) - 0.5);
  float df = max(0.0025, w * thickness);
  return smoothstep(0.0, df, f);
}

// The same, taking fwidth(v) itself. ⚠️ Derivatives.
float contourLine(float v, float thickness) {
  return contourLineWidth(v, fwidth(v), thickness);
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
// 0, about `thickness` pixels wide, and every `major`-th one (below 2 for none) twice as
// wide. `dValue` is fwidth(value), taken where control flow is uniform: so `interval` may
// change from pixel to pixel. Lines fade out as they come closer than a few pixels apart,
// the minor ones first, so a distant view is not a moiré.
float contourCover(float value, float dValue, float interval, float thickness, float major) {
  float w = dValue / interval;
  float minor = (1.0 - contourLineWidth(value / interval + 0.5, w, thickness)) * (1.0 - smoothstep(0.15, 0.4, w));
  float every = max(floor(major + 0.5), 1.0);
  float wm = w / every;
  float heavy = (1.0 - contourLineWidth(value / (interval * every) + 0.5, wm, 2.0 * thickness)) * (1.0 - smoothstep(0.15, 0.4, wm));
  return major >= 1.5 ? max(minor, heavy) : minor;
}
