uniform vec2 size;
uniform sampler2D glyphAtlas;

uniform float in_bias;
uniform float out_bias;

uniform GlyphData {
  vec4 glyphPosition[GLYPHS_LENGTH];
  vec3 glyphOffset[GLYPHS_LENGTH];
  vec2 glyphTextureSize;
  float glyphFontSize;
  float glyphPixelRange;
  float glyphLineHeight;
  float glyphBaseLine;
};

varying vec2 vUv;

struct GlyphParams {
  vec2 position;
  uint index;
};

uint _numDigits(float number) {
  float log10 = 0.4342944819032518 * log(number);
  return uint(max(trunc(log10), 0.0) + 1.0);
}

uint _getDigit(float number, uint position) {
  return uint(trunc(mod(number / pow(10.0, float(position - 1u)), 10.0)));
  //return uint(floor(fract(number / pow(10.0, float(position))) * 10.0));
}

float _median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

vec2 _calcGlyphUv(vec2 texPos) {
  vec2 glyphUv = vec2(texPos.x / glyphTextureSize.x, (glyphTextureSize.y - texPos.y) / glyphTextureSize.y);

  return clamp(glyphUv, 0.0, 1.0);
}

float _calculateGlyphVerticalOffset(float vAlign) {
  float pxRangeOffset = floor(glyphPixelRange / 2.0);
  float lineHightOffset = glyphLineHeight / 2.0;
  float vAlignOffset = (glyphFontSize / 2.0) * vAlign;
  //float vAlignOffset = vAlign != 0.0 ? mix(mix(BOTTOM, 0.0, vAlign + 1.0), mix(0.0, TOP, vAlign), step(0.0, vAlign)) : 0.0;
  return lineHightOffset + pxRangeOffset + vAlignOffset;
}

float _screenPixelRange(float scale) {
  vec2 scaledSize = size * scale;
  vec2 screenPxRange = glyphPixelRange / fwidth(vUv * scaledSize);
  return max(min(screenPxRange.x, screenPxRange.y), 1.0);
}

float _sdfGlyph(vec2 p, uint glyphId) {
  vec2 offset = vec2(p.x - glyphOffset[glyphId].x, p.y - glyphOffset[glyphId].y);
  vec2 uv = glyphPosition[glyphId].xy + offset;
  float sigDist = -0.5;

  if(offset.x >= 0.0 && offset.y >= 0.0 && offset.x <= glyphPosition[glyphId].z && offset.y <= glyphPosition[glyphId].w) {
    vec2 TexCoord = _calcGlyphUv(uv);
    vec3 mdf = texture2D(glyphAtlas, TexCoord).rgb;
    sigDist = _median(mdf.r, mdf.g, mdf.b);
  }
  return sigDist;
}

void renderGlyph(out vec3 outColor, vec2 position, uint glyphId, vec3 glyphColor, float pxRange) {
  float dist = _sdfGlyph(position, glyphId);
  float e = pxRange * (dist - 0.5 + in_bias) + 0.5 + out_bias;

  float contour = clamp(e, 0.0, 1.0);

  outColor = mix(outColor, glyphColor, contour);
}

