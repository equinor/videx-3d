#include <common>
#include <logdepthbuf_pars_fragment>


uniform float time;

uniform float fontSize;
uniform float rotation;
uniform float spacing;
uniform float verticalAlign;
uniform float horizontalAlign;

#include ../../../sdk/materials/shaderLib/glyphs.glsl
#include ../../../sdk/materials/shaderLib/render-text.glsl
#include ../../../sdk/materials/shaderLib/render-number.glsl
#include ../../../sdk/materials/shaderLib/rotation.glsl

// SDF functions
float sdfLine(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);

  return length(pa - ba * h);
}

float sdfBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdfCircle(vec2 p, float r) {
  return length(p) - r;
}

// Debug
void textGuides(out vec3 outColor, vec2 position) {
  float helper;

  // helper = sdfBox(position - vec2(0.0, 8.5), vec2(1000.0, glyphFontSize / 2.0));
  // outColor = mix(outColor, vec3(1.0, 1.0, 0.0), step(helper, 0.0));

  helper = sdfLine(position + vec2(0.0, glyphLineHeight / 2.0), vec2(0.0), vec2(size.x, 0.0));
  outColor = mix(outColor, vec3(1.0, 0.0, 0.0), smoothstep(1.0, -1.0, helper));

  helper = sdfLine(position - vec2(0.0, glyphLineHeight / 2.0), vec2(0.0), vec2(size.x, 0.0));
  outColor = mix(outColor, vec3(1.0, 0.0, 0.0), smoothstep(1.0, -1.0, helper));

  helper = sdfLine(position + vec2(0.0, glyphLineHeight / 2.0 - glyphBaseLine), vec2(0.0), vec2(size.x, 0.0));
  outColor = mix(outColor, vec3(0.0, 0.0, 1.0), smoothstep(1.0, -1.0, helper));

  helper = sdfLine(position, vec2(0.0), vec2(size.x, 0.0));
  outColor = mix(outColor, vec3(0.0, 1.0, 0.0), smoothstep(1.0, -1.0, helper));

  

}

// Examples
void example1(out vec3 color, vec2 pixelCoords) {
  // the scale we need for a specific font size
  float scale = glyphFontSize / fontSize;

  // set up rotation
  mat2 rotationMatrix = rotation2d(rotation);

  // spacing we want between text segments
  float lineSpacing = (glyphLineHeight + 10.0);

  // where we want to position the text 
  vec2 textPosition = vec2(size.x / 2.0, glyphLineHeight);

  // transform the coordinates
  pixelCoords = (pixelCoords - textPosition) * scale * rotationMatrix;

  // calculate an index for the y positions we want so we know which
  // text pointer to reference
  uint i = uint(round(pixelCoords.y / lineSpacing));
  i = clamp(i, 0u, textPointersCount - 1u);

  // get text pointer from textTexture at index i
  uvec3 textPointer = readTextPointerFromTexture(i);

  // advance to line according to the calculated line index (i)
  pixelCoords.y -= float(i) * lineSpacing;

  // debug
  // textGuides(color, pixelCoords);

  // render text
  renderText(color, pixelCoords, textPointer, verticalAlign, horizontalAlign, vec3(0.09, 0.74, 0.51), spacing, scale);
}

void example2(out vec3 color, vec2 pixelCoords) {
  uint i = 0u;

  uvec3 textPointer = readTextPointerFromTexture(i);

  // scale text to a specific with
  float width = size.x / 2.0;
  float scale = float(textPointer.z) / width;

  // set up rotation
  mat2 rotationMatrix = rotation2d(rotation);

  // where we want to position the text 
  vec2 textPosition = vec2(size.x / 2.0, size.y / 2.0);

  // transform the coordinates
  pixelCoords = (pixelCoords - textPosition) * scale * rotationMatrix;

  // debug
  // textGuides(color, pixelCoords);

  vec3 textColor = vec3(0.74, 0.09, 0.58);

  // render text
  renderText(color, pixelCoords, textPointer, verticalAlign, horizontalAlign, textColor, spacing, scale);
}

void exmaple3(out vec3 color, vec2 pixelCoords) {
  float scale = glyphFontSize / fontSize;

  float number = time;//-495.549221;
  vec3 textColor = vec3(0.0, 0.5, 0.0);

  // set up rotation
  mat2 rotationMatrix = rotation2d(rotation);

  pixelCoords = pixelCoords * scale * rotationMatrix;

  renderNumber(color, pixelCoords, number, 3u, verticalAlign, horizontalAlign, textColor, spacing, scale);
  pixelCoords.y -= 80.0;
  renderNumber(color, pixelCoords, -number * 100.0, 3u, verticalAlign, horizontalAlign, textColor, spacing, scale);
}

void main() {
  #include <logdepthbuf_fragment>

  // initial color
  vec3 color = vec3(1.0);

  vec2 uv = vUv.xy;
  if(!gl_FrontFacing) {
    uv.x = 1.0 - uv.x;
  }

  // transform uv coordinates to unit coordinates according to size
  // with origo at the top left
  vec2 pixelCoords = vec2(uv.x, 1.0 - uv.y) * size;

  if(pixelCoords.x >= size.x / 2.0) {
    color = vec3(0.9);
  }

  example1(color, pixelCoords);
  example2(color, pixelCoords);

  pixelCoords -= vec2(size.x / 2.0, size.y - 100.0);
  exmaple3(color, pixelCoords);

  gl_FragColor = vec4(color, 1.0);

	#include <colorspace_fragment>

}