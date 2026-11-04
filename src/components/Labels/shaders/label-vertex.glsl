// A label of a label group: its record (uRecords, LABEL_RECORD_FLOATS: where it is, its
// frame, its text) and its layer's style (uStyles, a row: LABEL_STYLE_TEXELS), fetched by
// the record each instance draws (labelDraw). A quad painted in the plane square to its
// normal, as large as its sizing makes it (world units, or CSS pixels on screen, or those
// shrinking with distance; times its own size), no larger on screen than its layer's
// largest, placed by its anchor and offset, faded as it turns edge-on, grows small or nears
// its distances or the far plane, and as its group lets it in or pushes it out.
// ⚠️ The fade is `labelFade`, the size `labelPixels` (label-geometry.ts), the layout
// `writeLabelRecords` (label-records.ts) and `LabelGroup.writeStyles`: keep them alike.

// The record it draws, its opacity as its group placed it, how much it is shrunk to fit its
// room (after its largest), unused.
attribute vec4 labelDraw;

// Its group's labels' records, 4 texels each, LABEL_RECORDS_WIDTH texels a row.
uniform highp sampler2D uRecords;
// Its group's layers' styles, a row each.
uniform highp sampler2D uStyles;
// The view's height, in CSS pixels.
uniform float uViewHeight;
// The camera's far plane, from it (0: none known): labels fade out before it.
uniform float uFar;

// Where in its text: ems from its cell's left edge, and up from its middle.
varying vec2 vText;
// Its text's run of glyphs in its group's runs (its first, how many), and its lines.
flat varying vec3 vRun;
varying float vOpacity;
// Its layer's colour and halo, in display values.
varying vec3 vColor;
varying vec4 vHalo;

#include <common>
#include <logdepthbuf_pars_vertex>

vec4 recordTexel(int record, int k) {
  int i = record * 4 + k;
  return texelFetch(uRecords, ivec2(i % LABEL_RECORDS_WIDTH, i / LABEL_RECORDS_WIDTH), 0);
}

vec4 styleTexel(int row, int k) {
  return texelFetch(uStyles, ivec2(k, row), 0);
}

// From 0 at `from` to 1 at `to`; a step at `from` if they meet (labelRamp).
float ramp(float value, float from, float to) {
  return to > from ? clamp((value - from) / (to - from), 0.0, 1.0) : step(from, value);
}

// LABEL_AUTO_KNEE.
const float AUTO_KNEE = 0.4;

float smoothMin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Drawn 'auto', the share of its size drawn where the view spans `span` world units
// (labelAutoScale): whole up to `factor`, no less than `least`.
float autoScale(float factor, float least, float span) {
  least = clamp(least, 1e-6, 1.0);
  if (least >= 1.0) return 1.0;
  float x = log(max(factor, 1e-30) / max(span, 1e-30));
  return exp(smoothMin(-smoothMin(-x, -log(least), AUTO_KNEE), 0.0, AUTO_KNEE));
}

// Its font's size on screen face-on, CSS pixels, before its largest (labelPixels): `own`
// its size, `perUnit` the pixels a world unit spans face-on where it is, `sizing` its
// layer's (0 'world', 1 'screen', 2 'auto'), `bounds` its distanceFactor and minScale,
// `facing` the cosine it faces the camera at: sized on screen, drawn larger at a slant, so
// it reads as large as asked as seen, its facing's square root no less than `least`
// (labelSlantLeast: 1 never larger).
float sizedPixels(float own, float perUnit, float sizing, vec2 bounds, float facing, float least) {
  if (sizing < 0.5) return own * perUnit;
  float slant = max(sqrt(max(facing, 0.0)), least);
  if (sizing < 1.5) return own / slant;
  return own * autoScale(bounds.x, bounds.y, uViewHeight / max(perUnit, 1e-30)) / slant;
}

void main() {
  int record = int(labelDraw.x + 0.5);
  vec4 r0 = recordTexel(record, 0);
  vec4 r1 = recordTexel(record, 1);
  vec4 r2 = recordTexel(record, 2);
  // Its text: its run of glyphs (its first, how many), and its cell's width and height in
  // ems, halo included.
  vec4 labelText = recordTexel(record, 3);
  vec2 labelExtent = labelText.zw;
  float labelSize = r1.w;

  int row = int(r0.w + 0.5);
  vec4 s0 = styleTexel(row, 0);
  vColor = s0.rgb;
  float opacityOf = s0.a;
  vHalo = styleTexel(row, 1);
  // Its font's size times the layer's live multiplier, its sizing and 'auto''s bounds.
  vec4 sizing = styleTexel(row, 2);
  // Where its fades end and start (labelFadeRanges): the cosine facing the camera, and its
  // text's height on screen as seen, CSS pixels, it is gone at and whole from.
  vec4 fades = styleTexel(row, 3);
  // Its nearest and farthest, over how far it fades toward them, and its largest on screen.
  vec4 distances = styleTexel(row, 4);
  // Its middle from its position, in its own width and height (labelAnchor), and its
  // offset in ems.
  vec4 placed = styleTexel(row, 5);
  vec2 anchor = placed.xy;
  vec2 offset = placed.zw;
  // How far toward the camera it is drawn, in world units and per world unit of distance
  // (a move of the quad, so it holds with any depth buffer), whether it flips, and the
  // least its slant divides its size by, sized on screen (labelSlantLeast).
  vec4 lifted = styleTexel(row, 6);
  mat4 frame = mat4(styleTexel(row, 7), styleTexel(row, 8), styleTexel(row, 9), styleTexel(row, 10));

  // In the world: its layer's frame.
  vec3 at = (frame * vec4(r0.xyz, 1.0)).xyz;
  vec3 worldNormal = normalize(mat3(frame) * r1.xyz);
  vec3 worldAlong = normalize(mat3(frame) * r2.xyz);

  vec3 toCamera = cameraPosition - at;
  float away = length(toCamera);
  float facing = dot(toCamera, worldNormal) / max(away, 1e-6);

  vec4 centre = projectionMatrix * viewMatrix * vec4(at, 1.0);
  // Its font's size on screen face-on, as its sizing has it, no larger than its largest,
  // shrunk to fit its room; the size in world units that gives; and its text's height as
  // seen (labelSeenPixels): face-on times the square root of its facing.
  float own = sizing.x * labelSize;
  float perUnit = projectionMatrix[1][1] * uViewHeight * 0.5 / max(centre.w, 1e-6);
  float faceOn = min(sizedPixels(own, perUnit, sizing.y, sizing.zw, facing, lifted.w), distances.w) * labelDraw.z;
  float size = faceOn / perUnit;
  float pixels = faceOn * sqrt(max(facing, 0.0));

  // Beyond the far plane the quad would be clipped, whole or in part: faded out before it,
  // from 90 % of the way to 99 %, by its farthest corner along the view. A host sees them
  // farther with a farther plane.
  vec3 forward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  // Its farthest corner from its position: half its extent about its middle, which its
  // anchor moves off its position, and its offset (labelReach).
  float reach = (length(labelExtent * (abs(anchor) + 0.5)) + length(offset)) * size;
  float deepest = dot(at - cameraPosition, forward) + reach;
  float opacity = 0.0;
  if (facing > 0.0 && away >= distances.x && away <= distances.y) {
    float fade = max(distances.z, 0.0);
    float near = distances.x > 0.0 ? ramp(away, distances.x, distances.x + fade) : 1.0;
    float far = ramp(-away, -distances.y, -distances.y + fade);
    float beyond = uFar > 0.0 ? 1.0 - ramp(deepest, 0.9 * uFar, 0.99 * uFar) : 1.0;
    opacity = near * far * beyond * ramp(facing, fades.x, fades.y) *
      ramp(pixels, fades.z, fades.w) * opacityOf * labelDraw.y;
  }
  vOpacity = opacity;
  if (opacity <= 0.0 || centre.w <= 0.0) {
    // Out of the clip volume, every corner alike: nothing is drawn.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    vText = vec2(0.0);
    vRun = vec3(0.0);
    return;
  }

  vec3 top = cross(worldNormal, worldAlong);
  vec2 local = (position.xy + anchor) * labelExtent + offset;
  // Never as far as the camera: half the way at the most.
  float lift = min(lifted.x + lifted.y * away, 0.5 * away);
  vec3 corner = at + (worldAlong * local.x + top * local.y) * size + toCamera / away * lift;
  gl_Position = projectionMatrix * viewMatrix * vec4(corner, 1.0);
  // Kept inside the far plane: with a near plane far closer than the far one (0.1 m to
  // 3000 km), anything over a few hundred kilometres off lies within a float's rounding of
  // it, so the clip test passed and failed corner by corner as the view moved, cutting
  // labels through. Labels nearing the far plane are faded out above, so this only absorbs
  // the rounding. The far plane is z = w, or z = 0 with a reversed depth buffer; a
  // logarithmic one writes its depth from w, so only the clipping changes.
  #ifdef USE_REVERSED_DEPTH_BUFFER
  gl_Position.z = max(gl_Position.z, gl_Position.w * 1e-6);
  #else
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-6));
  #endif

  #include <logdepthbuf_vertex>

  // Reading backward on screen (labelReadsBackward: away from 10° above right by more than
  // a right angle), turned half round inside its quad: the text mirrored both ways, the
  // quad where it was. The same for its four corners.
  vec2 uv = position.xy;
  if (lifted.z > 0.5) {
    vec4 ahead = projectionMatrix * viewMatrix * vec4(at + worldAlong * size, 1.0);
    vec2 way = ahead.w > 0.0
      ? (ahead.xy / ahead.w - centre.xy / centre.w) * vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0)
      : (mat3(viewMatrix) * worldAlong).xy;
    // cos and sin of LABEL_FLIP_TILT.
    const vec2 tilt = vec2(0.98480775, 0.17364818);
    float along = way.x * tilt.x + way.y * tilt.y;
    if (along < 0.0 || (along == 0.0 && way.y * tilt.x - way.x * tilt.y < 0.0))
      uv = -uv;
  }
  vText = vec2((uv.x + 0.5) * labelExtent.x, uv.y * labelExtent.y);
  vRun = vec3(labelText.xy, r2.w);
}