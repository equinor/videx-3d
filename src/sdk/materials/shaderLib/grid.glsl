// Anti-aliased grid lines, after https://bgolus.medium.com/the-best-darn-grid-shader-yet-727f9278b9d8
//
// Needs <common> (saturate). pristineGrid takes screen-space derivatives, so needs uniform
// control flow; pristineLine and pristineLines take theirs from the caller.

// How much of the pixel a line covers, `gridUV` the distance to the nearest line in half
// cells (0 on it, 1 halfway to the next), changing by `uvDeriv` a pixel, `lineWidth` the
// line's width as a fraction of a cell. Drawn at least about a pixel wide, then dimmed by
// how much thinner it is, with a pixel and a half of anti-aliasing either side.
float pristineLine(float gridUV, float uvDeriv, float lineWidth) {
  float drawWidth = clamp(lineWidth, uvDeriv, 0.5);
  float lineAA = uvDeriv * 1.5;
  return smoothstep(drawWidth + lineAA, drawWidth - lineAA, gridUV) * saturate(lineWidth / drawWidth);
}

// The lines of a grid along each axis (pristineLine), `uv` in cells and `uvDeriv` how
// much `uv * 2` changes over a pixel.
vec2 pristineLines(vec2 uv, vec2 uvDeriv, vec2 lineWidth) {
  vec2 gridUV = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  return vec2(pristineLine(gridUV.x, uvDeriv.x, lineWidth.x), pristineLine(gridUV.y, uvDeriv.y, lineWidth.y));
}

// A grid: `uv` in cells, `lineWidth` a fraction of a cell, so lines keep their world width
// and fade to their average coverage where a cell gets smaller than a pixel.
float pristineGrid(vec2 uv, vec2 lineWidth) {
  vec2 uvDeriv = fwidth(uv * 2.0);
  vec2 grid2 = pristineLines(uv, uvDeriv, lineWidth);
  grid2 = mix(grid2, lineWidth, clamp(uvDeriv * 2.0 - 1.0, 0.0, 1.0));
  return max(grid2.x, grid2.y);
}
