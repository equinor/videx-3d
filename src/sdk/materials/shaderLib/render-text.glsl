uniform usampler2D textTexture;
uniform uint textPointersCount;
uniform uint textPointersOffset;

uint _readGlyphIdFromTexture(uint index) {
  uint value = texelFetch(textTexture, ivec2(index, 0), 0).r;
  return value;
}

GlyphParams _findGlyph(vec2 pixelCoords, uvec3 textPointer, float spacing) {

  uint id = _readGlyphIdFromTexture(textPointer.x);
  float width = glyphOffset[id].z + spacing;
  vec2 position = pixelCoords.xy;

  uint i = textPointer.x;

  while(position.x >= width && i++ < textPointer.y - 1u) {
    position.x -= width;
    uint j = _readGlyphIdFromTexture(i);

    id = j;
    width = glyphOffset[id].z + spacing;
  };

  return GlyphParams(position, id);
}

uvec3 readTextPointerFromTexture(uint index) {
  uvec3 pointer = uvec3(0u);
  uint pos = (index * 3u) + textPointersOffset;
  pointer.x = texelFetch(textTexture, ivec2(pos, 0), 0).r;
  pointer.y = texelFetch(textTexture, ivec2(pos + 1u, 0), 0).r;
  pointer.z = texelFetch(textTexture, ivec2(pos + 2u, 0), 0).r;

  return pointer;
}

void renderText(
  inout vec3 outColor,
  vec2 position,
  uvec3 textPointer,
  float verticalAlign,
  float horizontalAlign,
  vec3 textColor,
  float spacing,
  float scale
) {
  // do nothing if the text widht is 0
  if(textPointer.z == 0u)
    return;

  float spacingWidth = spacing * float(textPointer.y - textPointer.x - 1u);
  position.x += (float(textPointer.z) + spacingWidth) * horizontalAlign;

  //if (position.y > glyphLineHeight / 2.0 || position.y < -glyphLineHeight / 2.0) return;
  
  vec2 pos = position;
  pos.y += _calculateGlyphVerticalOffset(verticalAlign);
  
  if(pos.x < 0.0)
    return;

  GlyphParams params = _findGlyph(pos, textPointer, spacing);
  renderGlyph(outColor, params.position, params.index, textColor, _screenPixelRange(scale));
}