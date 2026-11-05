// The 3D clouds' fullscreen triangle (SceneryCloudVolume), for the march, the temporal
// resolve and the composite: each pixel's view ray, rebuilt from the camera as the sky's is
// (sky-vertex.glsl, from a point at NDC depth 0, never the far plane), and where it lies on
// the screen. The march moves its rays by a sub-pixel jitter each frame (uCloudJitter, in
// NDC), which the temporal resolve accumulates; the others take none.

uniform vec2 uCloudJitter;

varying vec3 vCloudDirection;
varying vec2 vCloudUv;

void main() {
  vec4 view = inverse(projectionMatrix) * vec4(position.xy + uCloudJitter, 0.0, 1.0);
  vCloudDirection = mat3(inverse(viewMatrix)) * (view.xyz / view.w);
  vCloudUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
