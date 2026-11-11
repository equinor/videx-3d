// The 3D clouds (SceneryClouds) drawn over the scene at full resolution, from the march's
// smaller image (cloud-march.glsl), at the depth of their front: so what lies in front
// of them hides them, crisp at the screen's own resolution.

#include <common>

uniform sampler2D uCloudImage; // premultiplied colour and alpha, filtered
uniform sampler2D uCloudDepth; // log2 of the distance to their front, over CLOUD_DEPTH_RANGE
uniform vec2 uCloudImageSize; // texels
uniform float uCloudSoften; // 1 without temporal accumulation, 0 with
uniform float uSkyIntensity;
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
uniform float logDepthBufFC;
#endif

varying vec3 vCloudDirection;
varying vec2 vCloudUv;

void main() {
  // Four filtered taps `uCloudSoften` of half a texel about this pixel: a tent 1.5 texels wide
  // that smooths the march's jitter as it scales the image up when the frames are not
  // accumulated, and a plain bilinear tap when they are.
  vec2 texel = 0.5 * uCloudSoften / uCloudImageSize;
  vec4 cloud = 0.25 * (texture(uCloudImage, vCloudUv + vec2(-1.0, -1.0) * texel) +
    texture(uCloudImage, vCloudUv + vec2(1.0, -1.0) * texel) +
    texture(uCloudImage, vCloudUv + vec2(-1.0, 1.0) * texel) +
    texture(uCloudImage, vCloudUv + vec2(1.0, 1.0) * texel));
  if(cloud.a < 0.003)
    discard;

  // The nearest of the four texels' distances, a clear one having none (1); and the farthest
  // of those with cloud.
  ivec2 corner = ivec2(floor(vCloudUv * uCloudImageSize - 0.5));
  ivec2 last = ivec2(uCloudImageSize) - 1;
  float nearest = 1.0;
  float farthest = 0.0;
  for(int k = 0; k < 4; k++) {
    ivec2 at = clamp(corner + ivec2(k & 1, k >> 1), ivec2(0), last);
    float texel = texelFetch(uCloudDepth, at, 0).r;
    nearest = min(nearest, texel);
    if(texel < 1.0)
      farthest = max(farthest, texel);
  }
  if(nearest >= 1.0)
    discard;

  // At that depth along this pixel's ray, nearer by as much as the four texels' depths spread
  // (up to CLOUD_DEPTH_MARGIN): where a layer slants away, as from space, a texel's depth is
  // its middle's, not this pixel's, and the jitter and the frames' accumulation move it
  // within that spread. Kilometres from space, more than lies between the clouds' tops and
  // the land under them, which then showed through in flickering stripes.
  float pulled = nearest - min(max(farthest - nearest, 0.0), CLOUD_DEPTH_MARGIN);
  float t = exp2(pulled * CLOUD_DEPTH_RANGE);
  vec3 view = mat3(viewMatrix) * normalize(vCloudDirection) * t;
  #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  float depth = log2(1.0 - view.z) * logDepthBufFC * 0.5;
  #else
  vec4 clip = projectionMatrix * vec4(view, 1.0);
  float depth = 0.5 * clip.z / clip.w + 0.5;
  #endif
  // Past the far plane, still over the background.
  gl_FragDepth = min(depth, 0.9999999);

  gl_FragColor = vec4(cloud.rgb / cloud.a * uSkyIntensity, min(cloud.a, 1.0));

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
