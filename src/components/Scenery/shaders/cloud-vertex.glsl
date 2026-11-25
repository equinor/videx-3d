// The 3D clouds' fullscreen triangle (SceneryClouds), for the march, the rebuild and the
// composite: each pixel's view ray, rebuilt from the camera as the sky's is (scenery-vertex.glsl,
// from a point at NDC depth 0, never the far plane), and where it lies on the screen. The
// interleaved march (`temporal`) draws a quarter of the image's pixels into an image half as wide
// and high: its rays are scaled and moved (uCloudRays: NDC scale xy, offset zw) to pass through
// exactly the full image's pixels it stands for; the others take none (1, 1, 0, 0).

uniform vec4 uCloudRays;

varying vec3 vCloudDirection;
varying vec2 vCloudUv;

void main() {
  vec4 view = inverse(projectionMatrix) * vec4(position.xy * uCloudRays.xy + uCloudRays.zw, 0.0, 1.0);
  vCloudDirection = mat3(inverse(viewMatrix)) * (view.xyz / view.w);
  vCloudUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
