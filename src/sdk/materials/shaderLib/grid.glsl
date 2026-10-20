// Anti-aliased grid lines, after https://bgolus.medium.com/the-best-darn-grid-shader-yet-727f9278b9d8
//
// `uv` is in cells, `lineWidth` a fraction of a cell, so lines keep their world width
// and fade to their average coverage where a cell gets smaller than a pixel. Needs
// <common> (saturate) and uniform control flow (screen-space derivatives).

float pristineGrid(vec2 uv, vec2 lineWidth) {
  //vec2 ddx = dFdx(uv);
  //vec2 ddy = dFdy(uv);
  //vec2 uvDeriv =  vec2(length(vec2(ddx.x, ddy.x)), length(vec2(ddx.y, ddy.y)));
  vec2 uvDeriv = fwidth(uv * 2.0);

  vec2 drawWidth = clamp(lineWidth, uvDeriv, vec2(0.5));
  vec2 lineAA = uvDeriv * 1.5;
  vec2 gridUV = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 grid2 = smoothstep(drawWidth + lineAA, drawWidth - lineAA, gridUV);
  grid2 *= saturate(lineWidth / drawWidth);
  //grid2 *= clamp(lineWidth / drawWidth, 0.0, 1.0);
  grid2 = mix(grid2, lineWidth, clamp(uvDeriv * 2.0 - 1.0, 0.0, 1.0));

  //return mix(grid2.x, 1.0, grid2.y);
  return max(grid2.x, grid2.y);
}
