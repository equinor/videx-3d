precision highp float;

/**
* Inspired by https://bgolus.medium.com/the-best-darn-grid-shader-yet-727f9278b9d8
*/

#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uBackground;
uniform float uBackgroundOpacity;
uniform vec2 uSize;
uniform float uCellSize;
uniform float uSubDivisions;
uniform float uOpacity;
uniform vec3 uGridColorMajor;
uniform vec3 uGridColorMinor;
uniform float uGridLineWidth;
uniform vec2 uAxesOffset;
uniform vec3 uAxesColor;
uniform float uAxesLineWidth;
uniform float uAxesTickSize;
uniform vec2 uOriginOffset;
uniform vec2 uCursorPosition;
uniform vec3 uRulerColor;
uniform float uRulerLineWidth;
uniform float uRulerOpacity;
uniform sampler2D uProjectionTexture;
uniform vec3 uProjectionColor;
uniform sampler2D uTexture;
uniform float uTextureMix;


varying vec2 vUv;

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

float pristineRadialGrid(vec2 _uv, vec2 _lineWidth, float _segments, float _cutoff) {
  float angle = atan(_uv.y, _uv.x) / PI2;
  //fix for derivative discontinuities in atan gradient
  float angleFrac = fract(angle);
  float ddAngle = fwidth(angle * 2.0);
  float ddAngleFrac = fwidth(angleFrac * 2.0);
  ddAngle = ddAngle - 0.00001 < ddAngleFrac ? ddAngle : ddAngleFrac;

  float dist = length(_uv);
  
  #ifdef DYNAMICSEGMENTS
    float logDist = log2(dist);
    float segments = pow(2.0, max(2.0, ceil(logDist) + 2.0));
  #else
    float segments = max(1.0, round(_segments));
  #endif

  vec2 lineWidth = vec2(_lineWidth.x * segments / (dist * PI2), _lineWidth.y);
  vec2 uv = vec2(angle * segments, dist);
  vec2 uvDeriv = vec2(ddAngle * segments, fwidth(dist * 2.0));

  vec2 drawWidth = clamp(lineWidth, uvDeriv, vec2(0.5));
  vec2 lineAA = uvDeriv * 1.5;
  vec2 gridUV = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 grid2 = smoothstep(drawWidth + lineAA, drawWidth - lineAA, gridUV);

  #ifdef SATURATE
  grid2 *= saturate(lineWidth / drawWidth);
  #endif
  grid2 *= step(_cutoff, dist);
  
  return max(grid2.x, grid2.y);
}

float lines(vec2 uv, vec2 lineWidth) {
  vec2 uvDeriv = fwidth(uv * 2.0);

  vec2 drawWidth = clamp(lineWidth * uvDeriv, uvDeriv, vec2(0.5));
  vec2 lineAA = uvDeriv * 1.5;
  vec2 axisLine2 = smoothstep(drawWidth + lineAA, drawWidth - lineAA, abs(uv * 2.0));

  axisLine2 *= saturate(lineWidth / drawWidth);

  return max(axisLine2.x, axisLine2.y);
}

float ticklines(vec2 uv, vec2 offset, vec2 lineWidth, float tickSize) {
  vec2 uvDeriv = fwidth(uv * 2.0);

  vec2 drawWidth = clamp(lineWidth * uvDeriv, uvDeriv, vec2(0.5));
  vec2 lineAA = uvDeriv * 1.5;
  vec2 tickUV = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 tickLine2 = smoothstep(drawWidth + lineAA, drawWidth - lineAA, tickUV);
  
  tickLine2 *= saturate(lineWidth / drawWidth);
  tickLine2 *= 1.0 - step( tickSize, abs( uv.yx - offset.yx));
  return max(tickLine2.x, tickLine2.y);
}

vec4 drawGrid(vec4 color, vec2 uv, vec3 lineColor, vec2 lineWidth) {
  float grid = pristineGrid(uv, lineWidth);
  color = mix(color, vec4(lineColor, uOpacity), grid);
  return color;
}

vec4 drawRadialGrid(vec4 color, vec2 uv, vec3 lineColor, vec2 lineWidth, float segments, float cutoff) {
  float grid = pristineRadialGrid(uv, lineWidth, segments, cutoff);
  color = mix(color, vec4(lineColor, uOpacity), grid);
  return color;
}

vec4 drawAxisLines(vec4 color, vec2 uv, vec2 originOffset, vec2 axesOffset, vec3 lineColor, vec2 lineWidth, float tickSize) {
  vec2 tickOffset = axesOffset;
  //float originLines = lines(uv - originOffset, lineWidth);
  float axesLines = lines(uv - originOffset - axesOffset, lineWidth);
  vec2 tickLineWidth = lineWidth;
  float majorTicks = ticklines(uv - originOffset,  tickOffset, tickLineWidth, tickSize);
  float minorTicks = ticklines((uv - originOffset) * uSubDivisions,  tickOffset * uSubDivisions, tickLineWidth * uSubDivisions * 0.5, tickSize * uSubDivisions * 0.5);
  float lines = max(axesLines, max(minorTicks, majorTicks));
  color = mix(color, vec4(lineColor, uOpacity), lines);
  //color = mix(color, vec3(1.0, 0.0, 0.0), originLines);
  return color;
}

vec4 drawRulerLines(vec4 color, vec2 uv, vec3 lineColor, vec2 lineWidth, float opacity) {
  float rulerLines = lines(uv, lineWidth) * opacity;
  color = mix(color, vec4(lineColor, uOpacity), rulerLines);
  return color;
}

void main() {
  #include <logdepthbuf_fragment>
  
  vec2 originOffset = clamp(uOriginOffset, -uSize / 2.0, uSize / 2.0) / uCellSize; //mod(uOriginOffset, uCellSize) / uCellSize;
  vec2 axesOffset = uAxesOffset / uCellSize;

  vec2 uv = (vUv.xy - 0.5) * (uSize / uCellSize); 

  vec2 uvMaj = uv - originOffset;
  vec2 uvMin = uvMaj * uSubDivisions;

  vec4 color = vec4(uBackground, uBackgroundOpacity * uOpacity);
  vec2 projectionUv = vec2(1.0 - vUv.x, vUv.y);
  
  vec4 textureColor = texture2D(uTexture, vUv);
  color = mix(color, textureColor, textureColor.a * uTextureMix);

  float projection = texture2D(uProjectionTexture, projectionUv).a;
  color = mix(color, vec4(uProjectionColor, uOpacity), projection); 

  #ifdef RADIAL
    color = drawRadialGrid(color, uvMin, uGridColorMinor, vec2(uGridLineWidth * uSubDivisions * 0.75), 16.0 * uSubDivisions, 0.0);
    color = drawRadialGrid(color, uvMaj, uGridColorMajor, vec2(uGridLineWidth), 16.0, 0.0);
  #else
    color = drawGrid(color, uvMin, uGridColorMinor, vec2(uGridLineWidth * uSubDivisions * 0.75));
    color = drawGrid(color, uvMaj, uGridColorMajor, vec2(uGridLineWidth));
  #endif
  
  #ifdef RULERS
    if (uCursorPosition.x > 0.0 && uCursorPosition.y > 0.0) {
      color = drawRulerLines(color, vUv - uCursorPosition, uRulerColor, vec2(uRulerLineWidth), uRulerOpacity);
    }
  #endif

  #ifdef AXES
  color = drawAxisLines(color, uv, originOffset, axesOffset, uAxesColor, vec2(uAxesLineWidth), uAxesTickSize);
  #endif

  // if (color.a < EPSILON) {
  //   discard;
  // }
  gl_FragColor = color;

  // #include <tonemapping_fragment>
  // #include <colorspace_fragment>
}