#include <common>
#include <logdepthbuf_pars_fragment>

uniform float fontSize;
uniform float stepSize;
uniform float startDepth;

varying vec2 vUv;

#include ../../../../sdk/materials/shaderLib/glyphs.glsl
#include ../../../../sdk/materials/shaderLib/render-number.glsl
#include ../../../../sdk/materials/shaderLib/colors.glsl

float lines(float v, float lineWidth) {
  float uvDeriv = fwidth(v * 2.0);

  float drawWidth = clamp(lineWidth, uvDeriv, 0.5);
  float lineAA = uvDeriv * 1.5;
  float fraction = 1.0 - abs(fract(v) * 2.0 - 1.0);
  float line = smoothstep(drawWidth + lineAA, drawWidth - lineAA, abs(fraction * 2.0));

  line *= saturate(lineWidth / drawWidth);

  return line;
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 color = WHITE;

  vec2 uv = vUv.xy;

  if(!gl_FrontFacing) {
    color = LIGHTGRAY;
    uv.x = 1.0 - uv.x;
  }

  vec2 pixelCoords = vec2(uv.x, 1.0 - uv.y) * size;
  pixelCoords.y += startDepth;
  float scale = glyphFontSize / fontSize;

  float ticks = ceil((size.y + 1.0 + startDepth) / stepSize);

  float spacing = stepSize * scale;

  float y = pixelCoords.y;
  y *= scale;

  float iy = round(y / spacing);
  iy = clamp(iy, 0.0, ticks - 1.0);

  float number = iy * stepSize;

  float x = pixelCoords.x - size.x * 0.65;

  x *= scale;

  vec2 p = vec2(x, y - spacing * iy);

  renderNumber(color, p, number, 0u, 0.17, 1.0, BLACK, 0.0, scale);

  // tick marks
  float minY = ((1.0 - vUv.y) * size.y + startDepth) / (stepSize / 10.0);
  float minLines = lines(minY, fontSize * 0.05 / (stepSize / 10.0));
  minLines = minLines * step(size.x * 0.75, pixelCoords.x);
  color = mix(color, GRAY, minLines);

  float majY = ((1.0 - vUv.y) * size.y + startDepth) / stepSize;
  float majLines = lines(majY, fontSize * 0.1 / stepSize);
  majLines = majLines * step(size.x * 0.7, pixelCoords.x);
  color = mix(color, BLACK, majLines);

  gl_FragColor = vec4(color, 0.95);

  //#include <tonemapping_fragment>
	#include <colorspace_fragment>

}
