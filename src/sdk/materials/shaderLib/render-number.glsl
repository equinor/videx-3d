uniform uint digits[12];

float renderNumber(
  inout vec3 outColor,
  vec2 position,
  float number,
  uint decimals,
  float verticalAlign,
  float horizontalAlign,
  vec3 textColor,
  float spacing,
  float scale
) {
  
  float width = 0.0;
  float totalWidth = 0.0;
  float offset = 0.0;

  // store glyphId and width during calculation of total width so we don't need to re-calculate these values
  uvec2 temp[30]; 

  uint glyphId;
  uint nDigits;

  vec2 pos = position.xy;
  uint c = 0u;
  
  if (number < 0.0) {
    glyphId = digits[11];
    width = glyphOffset[glyphId].z + spacing;
    offset = width;
    temp[c++] = uvec2(glyphId, width);
    number = -number;
  }

  float intPart;
  float fractPart = modf(number, intPart);
  fractPart *= pow(10.0, float(decimals));
  nDigits = _numDigits(intPart);

  for(uint n = 0u; n < nDigits; n++) {
    glyphId = digits[_getDigit(intPart, nDigits - n)];
    width = glyphOffset[glyphId].z + spacing;
    temp[c++] = uvec2(glyphId, width);
    totalWidth += width;
  }

  if(decimals > 0u) {
    glyphId = digits[10];
    width = glyphOffset[glyphId].z + spacing;
    temp[c++] = uvec2(glyphId, width);
    totalWidth += width;
    
    nDigits = _numDigits(fractPart);
    for(uint n = 0u; n < decimals; n++) {
      glyphId = digits[_getDigit(fractPart, nDigits - n)];
      width = glyphOffset[glyphId].z + spacing;
      temp[c++] = uvec2(glyphId, width);
      totalWidth += width;
    }
  }

  if(c > 0u) {
    pos.x += (totalWidth - spacing) * horizontalAlign + offset;
    pos.y += _calculateGlyphVerticalOffset(verticalAlign);

    uint n = 0u;

    while (n < c && pos.x > float(temp[n].y)) pos.x -= float(temp[n++].y);
    if (n < c) renderGlyph(outColor, pos, temp[n].x, textColor, _screenPixelRange(scale));  
  }

  return totalWidth;
}