// A label's text: the glyphs of its run (uRuns: each its index in the glyph table, its
// pen's place along its line in ems, its line), each a cell of the atlas (uAtlas: its fill's
// coverage in red, its halo's in green) placed about its pen by the glyph table (uGlyphs).
// A pixel takes the most coverage of the glyphs whose cells it lies in, so neighbouring
// glyphs' halos join as one outline, as when a canvas strokes a whole text.
// ⚠️ The run is `LabelTextRun` (label-atlas.ts), laid out by `layoutLabelText`
// (label-text.ts): keep them alike.

uniform sampler2D uAtlas;
uniform highp sampler2D uGlyphs;
uniform highp sampler2D uRuns;

// Where in its text: ems from its cell's left edge, and up from its middle.
varying vec2 vText;
// Its text's run of glyphs in uRuns (its first, how many), and its lines.
flat varying vec3 vRun;
varying float vOpacity;
// Its layer's colour, in display (sRGB) values, and its halo's colour and alpha.
varying vec3 vColor;
varying vec4 vHalo;

#include <logdepthbuf_pars_fragment>

vec3 displayToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec4 runGlyph(int i) {
  return texelFetch(uRuns, ivec2(i % LABEL_RECORDS_WIDTH, i / LABEL_RECORDS_WIDTH), 0);
}

vec4 glyphTexel(int glyph, int k) {
  int i = glyph * LABEL_GLYPH_TEXELS + k;
  return texelFetch(uGlyphs, ivec2(i % LABEL_GLYPHS_WIDTH, i / LABEL_GLYPHS_WIDTH), 0);
}

// The coverage of the run's glyph `entry` at `p`: ems along its line, and up from its
// middle. Its cell (u0, v0, u1, v1; v0 its top row) and its box about its pen (x0, x1, half
// its height), read with gradients `gx` and `gy`.
vec2 glyphCoverage(vec4 entry, vec2 p, vec2 gx, vec2 gy) {
  int glyph = int(entry.x + 0.5);
  vec4 box = glyphTexel(glyph, 1);
  float x = p.x - entry.y;
  if (x <= box.x || x >= box.y || abs(p.y) >= box.z) return vec2(0.0);
  vec4 cell = glyphTexel(glyph, 0);
  vec2 t = vec2((x - box.x) / (box.y - box.x), (box.z - p.y) / (2.0 * box.z));
  return textureGrad(uAtlas, mix(cell.xy, cell.zw, t), gx, gy).rg;
}

// The coverage of line `line`'s glyphs at `p` (along it, and up from its middle): the
// glyph whose pen is the last at or before it, found by halving the run (it runs line by
// line, its pens rising along each), and two either side, whose cells may reach it.
vec2 lineCoverage(float line, vec2 p, int start, int count, vec2 gx, vec2 gy) {
  int low = 0;
  int high = count;
  while (low < high) {
    int middle = (low + high) / 2;
    vec4 entry = runGlyph(start + middle);
    if (entry.z < line || (entry.z == line && entry.y <= p.x)) low = middle + 1;
    else high = middle;
  }
  vec2 coverage = vec2(0.0);
  for (int k = max(low - 3, 0); k <= min(low + 1, count - 1); k++) {
    vec4 entry = runGlyph(start + k);
    if (entry.z == line) coverage = max(coverage, glyphCoverage(entry, p, gx, gy));
  }
  return coverage;
}

void main() {
  #include <logdepthbuf_fragment>

  // How fast its text's ems change on screen: the atlas read with those gradients (its
  // texels an em over its size), the same for every glyph, so no seams where one meets the
  // next; half a mip finer than the footprint asks (2^-0.5), so small text stays crisp, not
  // heavy. Outside the loops: derivatives are undefined in control flow that varies by
  // pixel.
  vec2 dx = dFdx(vText);
  vec2 dy = dFdy(vText);
  float perEm = LABEL_RASTER_SIZE / float(textureSize(uAtlas, 0).x) * 0.70710678;
  vec2 gx = vec2(dx.x, -dx.y) * perEm;
  vec2 gy = vec2(dy.x, -dy.y) * perEm;

  int start = int(vRun.x + 0.5);
  int count = int(vRun.y + 0.5);
  float lines = max(vRun.z, 1.0);
  // Its line, the one whose middle is nearest (LABEL_LINE_HEIGHT apart, the first at the
  // top), and the next where their cells meet.
  float below = (lines - 1.0) * 0.5 * LABEL_LINE_HEIGHT - vText.y;
  float line = clamp(floor(below / LABEL_LINE_HEIGHT + 0.5), 0.0, lines - 1.0);
  float off = below - line * LABEL_LINE_HEIGHT;
  vec2 coverage = lineCoverage(line, vec2(vText.x, -off), start, count, gx, gy);
  float other = line + (off > 0.0 ? 1.0 : -1.0);
  if (abs(off) > 0.35 && other >= 0.0 && other <= lines - 1.0) {
    float otherOff = below - other * LABEL_LINE_HEIGHT;
    coverage = max(coverage, lineCoverage(other, vec2(vText.x, -otherOff), start, count, gx, gy));
  }

  // Magnified past the atlas's own size along either way on screen (at a slant, along one
  // only), its edges are kept about a pixel wide rather than the texels they span, so large
  // text and its halo stay crisp; eased in from texels a pixel across. Never softened: where
  // coverage changes faster than that, untouched. Minified, untouched: thin halos far off
  // would thin away.
  float texels = min(length(dx), length(dy)) * LABEL_RASTER_SIZE;
  float magnified = 1.0 - smoothstep(0.5, 1.0, texels);
  vec2 change = clamp(fwidth(coverage), vec2(1e-4), vec2(1.0));
  vec2 sharp = clamp((coverage - 0.5) / change + 0.5, 0.0, 1.0);
  coverage = mix(coverage, sharp, magnified);
  float fill = coverage.r;
  float halo = coverage.g * vHalo.a * (1.0 - fill);
  float alpha = (fill + halo) * vOpacity;
  if (alpha < 0.002) discard;
  // Fill over halo in display colours, as a canvas draws them. Mixed in linear light, a
  // label a few pixels high, its fill and halo sharing every pixel, reads as its fill alone.
  vec3 display = (vColor * fill + vHalo.rgb * halo) / (fill + halo);
  // Premultiplied.
  gl_FragColor = vec4(displayToLinear(display) * alpha, alpha);

  // No-ops into the pipeline's linear buffer; on screen, as three's own materials are.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
