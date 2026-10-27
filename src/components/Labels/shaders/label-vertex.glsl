// A label: a quad painted in the plane square to its normal, as large as uSize, placed by
// its anchor and offset, faded as it turns edge-on, grows small or nears its distances.
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
uniform float uLift;
// The view's height, in CSS pixels.
uniform float uViewHeight;

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
  // Its font's size on screen, face-on.
  float pixels = uSize * projectionMatrix[1][1] * uViewHeight * 0.5 / max(centre.w, 1e-6);
  float opacity = 0.0;
  if (facing > 0.0 && away >= uDistance.x && away <= uDistance.y) {
    float fade = max(uDistance.z, 0.0);
    float near = uDistance.x > 0.0 ? ramp(away, uDistance.x, uDistance.x + fade) : 1.0;
    float far = ramp(-away, -uDistance.y, -uDistance.y + fade);
    opacity = near * far * ramp(facing, uFacing.x, uFacing.y) *
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
  vec3 corner = at + (worldAlong * local.x + top * local.y) * uSize + toCamera / away * uLift;
  gl_Position = projectionMatrix * viewMatrix * vec4(corner, 1.0);

  #include <logdepthbuf_vertex>

  vUv = vec2(
    mix(labelRect.x, labelRect.z, position.x + 0.5),
    mix(labelRect.w, labelRect.y, position.y + 0.5)
  );
}
