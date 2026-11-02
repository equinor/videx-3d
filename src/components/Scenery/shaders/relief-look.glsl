// A relief's looks (SceneryReliefLooks): its colour by height and its contour lines, the
// relief's own or its layers'. Shared by the relief drawn with the sky (relief-fragment.glsl:
// its tiles and the overview past them) and without one (relief-plain-fragment.glsl), each
// including it once.

#include ../../../sdk/materials/shaderLib/color-ramp.glsl
#include ../../../sdk/materials/shaderLib/contours.glsl

// The land's shine, faint: rock and soil, not water.
#define RELIEF_LAND_SPECULAR vec3(0.02)
#define RELIEF_LAND_SHININESS 8.0
// How far below the sea's own seabed the seabed's colour darkens to half.
#define RELIEF_BED_DARKEN 600.0

// The looks (SceneryReliefLooks): a column per look, 0 the relief's own and 1 + i its layer
// i's, of five rows:
//   0: the land's ramp: its row of the colour ramps (-1 for a flat colour), its low and
//      high heights, 1 to run it backwards (colorRampAt)
//   1: the land's flat colour, linear; and how contours shade (ContourColorMode)
//   2: the seabed's ramp, as the land's; its row -1 for the sea's seabed colour darkened
//      with depth, -2 for it plain
//   3: contours: metres apart (0 for none), width in pixels, every how many a major line,
//      1 on the seabed too
//   4: the contours' colour, linear; and how strongly they shade
uniform highp sampler2D uReliefLook;
uniform sampler2D uColorRamps;

// A row of look `look` (uReliefLook).
vec4 reliefLookRow(int look, int row) {
  return texelFetch(uReliefLook, ivec2(look, row), 0);
}

// The colour of ground `height` metres from the sea's level by look `look`. Where the look
// gives the seabed no ramp, it is `bedColor`, darkened with depth from `bedDepth` metres
// below the sea (the sea's own seabed) down, unless the look keeps it plain.
vec3 reliefLookAlbedo(float height, int look, vec3 bedColor, float bedDepth) {
  vec4 landRamp = reliefLookRow(look, 0);
  vec4 bedRamp = reliefLookRow(look, 2);
  vec3 land = landRamp.x >= 0.0 ? colorRampAt(uColorRamps, landRamp, height) : reliefLookRow(look, 1).rgb;
  vec3 bed = bedColor;
  if(bedRamp.x >= 0.0)
    bed = colorRampAt(uColorRamps, bedRamp, height);
  else if(bedRamp.x > -1.5)
    bed *= mix(1.0, 0.5, smoothstep(bedDepth, bedDepth + RELIEF_BED_DARKEN, -height));
  return mix(bed, land, smoothstep(-1.0, 1.0, height));
}

// `color` with look `look`'s contour lines over it, for ground `height` metres from the
// sea's level, `gHeight` its gradient on screen (contourGradient); on the seabed only if
// the look says so. The tiles and the overview past them draw the same lines, so they run
// on across where one hands over to the other.
vec3 reliefContours(vec3 color, float height, float gHeight, int look) {
  vec4 lines = reliefLookRow(look, 3);
  if(lines.x <= 0.0 || (height < 0.0 && lines.w < 0.5))
    return color;
  vec4 shade = reliefLookRow(look, 4);
  float cover = contourCover(height, gHeight, lines.x, lines.y, lines.z);
  return contourShade(color, cover, int(reliefLookRow(look, 1).w + 0.5), shade.w, shade.rgb);
}
