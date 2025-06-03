#include <common>
#include <logdepthbuf_pars_fragment>

#include ../../../../sdk/materials/shaderLib/glyphs.glsl
#include ../../../../sdk/materials/shaderLib/render-text.glsl
#include ../../../../sdk/materials/shaderLib/sdf-functions.glsl
#include ../../../../sdk/materials/shaderLib/rotation.glsl

struct Unit {
  uint index;
  vec3 color;
};

uniform vec3 intervals[INTERVALS_LENGTH];
uniform Unit units[UNITS_LENGTH];
uniform float startDepth;

const vec3 BLACK = vec3(0.0);
const vec3 WHITE = vec3(1.0);
const vec3 GRAY = vec3(0.5);
const vec3 LIGHTGRAY = vec3(0.75);
const float padding = 0.9;

float lines(float v, float lineWidth) {
  float uvDeriv = fwidth(v * 2.0);

  float drawWidth = clamp(lineWidth, uvDeriv, 0.5);
  float lineAA = uvDeriv * 1.5;
  float fraction =  1.0 - abs(fract(v) * 2.0 - 1.0);
  float line = smoothstep(drawWidth + lineAA, drawWidth - lineAA, abs(fraction * 2.0));

  line *= saturate(lineWidth / drawWidth);

  return line;
}

vec3 currentInterval(vec2 position) {
  int index = 0;
  int nIntervals = int(INTERVALS_LENGTH);
  vec3 interval = intervals[index];

  while (position.y > interval.y && index < nIntervals - 1) {
    index++;
    interval = intervals[index];
  }
  return interval;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 color = LIGHTGRAY;
  float colorMultiplier = 1.0;

  vec2 uv = vUv.xy;

  if (!gl_FrontFacing) {
    colorMultiplier = 0.5;
    uv.x = 1.0 - uv.x;
  }

  float alpha = 0.95;
  vec2 pixelCoords = vec2(uv.x, 1.0 - uv.y) * size;
  pixelCoords.y += startDepth;

  vec3 interval = currentInterval(pixelCoords);

  float intervalLength = interval.y - interval.x;
  Unit unit = units[int(interval.z)];
  
  if (pixelCoords.y < interval.x || pixelCoords.y > interval.y) {
    discard;
    //alpha = 0.0;
  }
  uvec3 textPointer = readTextPointerFromTexture(unit.index);

  float rotation = 0.0;
  float span = size.x * padding;
  float vscale = glyphLineHeight / (intervalLength * padding);

  if (intervalLength > size.x) {
    span = intervalLength * padding;
    vscale = glyphLineHeight / (size.x * padding);
    rotation = (-PI / 2.0);
  }
  float hscale = float(textPointer.z) / span;
  float scale = max(hscale, vscale);
  
  scale = max(scale, glyphLineHeight / (size.x * 0.5));

  
  vec2 pos = pixelCoords.xy;
  pos.x -= size.x / 2.0;
  pos.y -= ((interval.x + intervalLength / 2.0));


  float frame = sdfBox(pos, vec2(size.x / 2.0, intervalLength / 2.0));
  float frameAA = min(fwidth(pixelCoords.y), fwidth(pixelCoords.x));
  color = mix( color, BLACK, smoothstep(1.5 * frameAA,0.0,frame) );
  color = mix( color, unit.color, smoothstep(0.0,-frameAA * 1.5,frame) );
  
  pos *= scale;
  pos *= rotation2d(rotation);
  
  float luminance = (0.299 * unit.color.r + 0.587 * unit.color.g + 0.114 * unit.color.b);
  vec3 textColor = luminance < 0.25 ? LIGHTGRAY : BLACK;
  //textColor = mix(textColor, unit.color, 0.25);
  renderText(
    color,
    pos,
    textPointer,
    0.17,
    0.5,
    textColor,
    0.0,
    scale
  );

  gl_FragColor = vec4(color * colorMultiplier, alpha);
    
  // #include <tonemapping_fragment>
	#include <colorspace_fragment>
}