// A minimap's relief (Minimap): the ground at each pixel from the relief's layers in
// longitude and latitude, merged as the tiles and the stage's overview merge them
// (../../../Scenery/shaders/relief.glsl), looked as they look it (SceneryReliefLooks: a
// colour ramp by height, contours), then either:
// - shaded: the colour, lit from the upper left of the screen by the ground's slope, which
//   the four neighbouring pixels give, or
// - outline: the coast and the contours as lines over a faint land fill.
// Drawn on its own canvas, on demand, so it costs nothing while the view holds still.

#include <common>
#include ../../../Scenery/shaders/relief.glsl
#include ../../../../sdk/materials/shaderLib/color-ramp.glsl
#include ../../../../sdk/materials/shaderLib/contours.glsl

// The looks (SceneryReliefLooks), as relief-fragment.glsl reads them: a column per look, 0
// the relief's own and 1 + i its layer i's.
uniform highp sampler2D uReliefLook;
uniform sampler2D uColorRamps;

// x: 0 shaded, 1 outline; y: the slope's vertical exaggeration; z: how strongly the slope
// shades, 0 to 1; w: ground metres a device pixel spans.
uniform vec4 uMinimap;
// The sea's colour where the look's seabed takes it, darkened with depth.
uniform vec3 uSeaColor;
// Outline mode: the line's colour, and the land's fill (rgb, alpha).
uniform vec3 uOutlineColor;
uniform vec4 uOutlineFill;

varying vec2 vGeo;

// How far below the sea the seabed's colour darkens to half.
#define MINIMAP_BED_DARKEN 600.0
// The light's direction on the screen: from the upper left, a little above it.
#define MINIMAP_LIGHT normalize(vec3(-0.55, 0.65, 0.6))

vec4 minimapLookRow(int look, int row) {
  return texelFetch(uReliefLook, ivec2(look, row), 0);
}

// The colour of ground `height` metres from the sea's level by look `look`.
vec3 minimapAlbedo(float height, int look) {
  vec4 landRamp = minimapLookRow(look, 0);
  vec4 bedRamp = minimapLookRow(look, 2);
  vec3 land = landRamp.x >= 0.0 ? colorRampAt(uColorRamps, landRamp, height) : minimapLookRow(look, 1).rgb;
  vec3 bed = uSeaColor;
  if(bedRamp.x >= 0.0)
    bed = colorRampAt(uColorRamps, bedRamp, height);
  else if(bedRamp.x > -1.5)
    bed *= mix(1.0, 0.5, smoothstep(0.0, MINIMAP_BED_DARKEN, -height));
  return mix(bed, land, smoothstep(-1.0, 1.0, height));
}

// How much of the pixel look `look`'s contour lines cover, for ground `height` whose gradient
// on the screen is `gHeight` (metres a pixel); none on the seabed if the look says so.
float minimapContourCover(float height, float gHeight, int look) {
  vec4 lines = minimapLookRow(look, 3);
  if(lines.x <= 0.0 || (height < 0.0 && lines.w < 0.5))
    return 0.0;
  return contourCover(height, gHeight, lines.x, lines.y, lines.z);
}

void main() {
  // A pixel's step across and up the screen, in degrees; the spans for the maps' mip level.
  vec2 stepX = dFdx(vGeo);
  vec2 stepY = dFdy(vGeo);
  vec2 span = abs(stepX) + abs(stepY);

  vec3 ground = reliefGround(vGeo, span);
  float east = reliefGround(vGeo + stepX, span).x;
  float west = reliefGround(vGeo - stepX, span).x;
  float north = reliefGround(vGeo + stepY, span).x;
  float south = reliefGround(vGeo - stepY, span).x;

  float height = ground.x;
  int look = int(ground.z + 0.5);
  // Metres up per pixel across and up the screen.
  vec2 slope = vec2(east - west, north - south) * 0.5;
  float cover = smoothstep(0.0, 0.5, ground.y);
  float lines = minimapContourCover(height, length(slope), look);

  vec4 color;
  if(uMinimap.x < 0.5) {
    vec3 albedo = minimapAlbedo(height, look);
    vec4 shade = minimapLookRow(look, 4);
    albedo = contourShade(albedo, lines, int(minimapLookRow(look, 1).w + 0.5), shade.w, shade.rgb);
    vec2 gradient = slope / uMinimap.w * uMinimap.y;
    vec3 normal = normalize(vec3(-gradient, 1.0));
    float lit = dot(normal, MINIMAP_LIGHT) / MINIMAP_LIGHT.z;
    color = vec4(albedo * mix(1.0, clamp(lit, 0.25, 1.6), uMinimap.z), cover);
  } else {
    bool land = height >= 0.0;
    bool coast = land != (east >= 0.0) || land != (west >= 0.0) || land != (north >= 0.0) || land != (south >= 0.0);
    float line = coast ? 1.0 : lines * 0.6;
    float fill = land ? uOutlineFill.a : 0.0;
    vec3 rgb = mix(uOutlineFill.rgb, uOutlineColor, line);
    color = vec4(rgb, mix(fill, 1.0, line) * cover);
  }

  gl_FragColor = color;
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
}
