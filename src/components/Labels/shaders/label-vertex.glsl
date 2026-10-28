// A label: a quad painted in the plane square to its normal, as large as uSize (no larger
// on screen than uMaxPixels), placed by its anchor and offset, faded as it turns edge-on,
// grows small or nears its distances or the far plane.
// ⚠️ The fade is `labelFade` (label-geometry.ts): keep them alike.

attribute vec3 labelPosition;
attribute vec3 labelNormal;
attribute vec3 labelAlong;
// Its place in the atlas: u0, v0 (its top), u1, v1.
attribute vec4 labelRect;
// Its width and height, in ems.
attribute vec2 labelExtent;

uniform float uSize;
// Where its fades start and end: the cosine facing the camera, its font's size on screen
// in CSS pixels (labelFadeRanges).
uniform vec2 uFacing;
uniform vec2 uPixels;
// The nearest and farthest it is drawn at, and over how far it fades toward them.
uniform vec3 uDistance;
uniform float uOpacity;
// Its middle from its position, in its own width and height (labelAnchor), and its offset
// in ems.
uniform vec2 uAnchor;
uniform vec2 uOffset;
// How far toward the camera it is drawn: in world units, and per world unit of distance.
// A move of the quad, so it holds with any depth buffer: linear, logarithmic or reversed.
uniform vec2 uLift;
// The view's height, in CSS pixels.
uniform float uViewHeight;
// The camera's far plane, from it (0: none known): labels fade out before it.
uniform float uFar;
// The largest it is drawn on screen (its font face-on, CSS pixels): shrunk to it nearer.
uniform float uMaxPixels;
// 1: turned to read left to right (LabelStyle.flip).
uniform float uFlip;

varying vec2 vUv;
varying float vOpacity;

#include <common>
#include <logdepthbuf_pars_vertex>

// From 0 at `from` to 1 at `to`; a step at `from` if they meet (labelRamp).
float ramp(float value, float from, float to) {
  return to > from ? clamp((value - from) / (to - from), 0.0, 1.0) : step(from, value);
}

void main() {
  // In the world: the layer's frame is its parent's. Its size stays in world units.
  vec3 at = (modelMatrix * vec4(labelPosition, 1.0)).xyz;
  vec3 worldNormal = normalize(mat3(modelMatrix) * labelNormal);
  vec3 worldAlong = normalize(mat3(modelMatrix) * labelAlong);

  vec3 toCamera = cameraPosition - at;
  float away = length(toCamera);
  float facing = dot(toCamera, worldNormal) / max(away, 1e-6);

  vec4 centre = projectionMatrix * viewMatrix * vec4(at, 1.0);
  // Its font's size on screen face-on, no larger than uMaxPixels, the size that gives, and
  // its text's height as seen, less its slant.
  float faceOn = uSize * projectionMatrix[1][1] * uViewHeight * 0.5 / max(centre.w, 1e-6);
  float shrink = faceOn > uMaxPixels ? uMaxPixels / faceOn : 1.0;
  float size = uSize * shrink;
  faceOn *= shrink;
  float pixels = faceOn * max(facing, 0.0);

  // Beyond the far plane the quad would be clipped, whole or in part: faded out before it,
  // from 90 % of the way to 99 %, by its farthest corner along the view. A host sees them
  // farther with a farther plane.
  vec3 forward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float reach = (length(labelExtent) + length(uOffset)) * size;
  float deepest = dot(at - cameraPosition, forward) + reach;
  float opacity = 0.0;
  if (facing > 0.0 && away >= uDistance.x && away <= uDistance.y) {
    float fade = max(uDistance.z, 0.0);
    float near = uDistance.x > 0.0 ? ramp(away, uDistance.x, uDistance.x + fade) : 1.0;
    float far = ramp(-away, -uDistance.y, -uDistance.y + fade);
    float beyond = uFar > 0.0 ? 1.0 - ramp(deepest, 0.9 * uFar, 0.99 * uFar) : 1.0;
    opacity = near * far * beyond * ramp(facing, uFacing.x, uFacing.y) *
      ramp(pixels, uPixels.x, uPixels.y) * uOpacity;
  }
  vOpacity = opacity;
  if (opacity <= 0.0 || centre.w <= 0.0) {
    // Out of the clip volume, every corner alike: nothing is drawn.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    vUv = vec2(0.0);
    return;
  }

  vec3 top = cross(worldNormal, worldAlong);
  vec2 local = (position.xy + uAnchor) * labelExtent + uOffset;
  // Never as far as the camera: half the way at the most.
  float lift = min(uLift.x + uLift.y * away, 0.5 * away);
  vec3 corner = at + (worldAlong * local.x + top * local.y) * size + toCamera / away * lift;
  gl_Position = projectionMatrix * viewMatrix * vec4(corner, 1.0);

  #include <logdepthbuf_vertex>

  // Reading backward on screen (labelReadsBackward: away from 10° above right by more than
  // a right angle), turned half round inside its quad: the text mirrored both ways, the
  // quad where it was. The same for its four corners.
  vec2 uv = position.xy;
  if (uFlip > 0.5) {
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
  vUv = vec2(
    mix(labelRect.x, labelRect.z, uv.x + 0.5),
    mix(labelRect.w, labelRect.y, uv.y + 0.5)
  );
}
