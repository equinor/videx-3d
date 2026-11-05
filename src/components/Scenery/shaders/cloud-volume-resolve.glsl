// The 3D clouds' temporal accumulation (SceneryCloudVolume): this frame's march, whose steps
// and sub-pixel place are jittered each frame, blended into what the last frames made of it.
// Last frame's image is read where this pixel's cloud lay then, by the distance to its front
// (a neighbour's where it has none), clamped to what this frame's 3 × 3 neighbours hold so
// moving clouds and a moving view leave no trails, and blended in. Written as the march is:
// premultiplied colour and alpha, and the distance as depth, which is accumulated too: the
// sub-pixel jitter moves every ray the same way, and with it the depth of a whole region, which
// would otherwise flicker against what reaches into the clouds. A sparse march (uCloudSparse)
// draws one pixel of each 2 × 2 of the image a frame, in turn, into an image half as wide and
// high: there this frame's ray is blended in; the other three keep what the frames before
// left them, clamped to the march's neighbours about them, and take this frame's (filtered)
// only where the view had not seen them before.

#include <common>

uniform sampler2D uCloudCurrent; // this frame's march: premultiplied colour and alpha
uniform sampler2D uCloudCurrentDepth; // log2 of the distance to their front, over CLOUD_DEPTH_RANGE
uniform sampler2D uCloudHistory; // the image the last frame resolved
uniform sampler2D uCloudHistoryDepth; // its depth (this frame's own where it has none)
uniform vec2 uCloudImageSize; // texels
uniform vec2 uCloudCurrentSize; // the march's texels: the image's, or half as many each way while sparse
uniform vec3 uCloudSparse; // 1 while the march is sparse (x), and the pixel of each 2 × 2 it drew (yz)
uniform mat3 uCloudPreviousRotation; // the last frame's world -> view rotation
uniform mat4 uCloudPreviousProjection;
uniform vec3 uCloudCameraMove; // where the camera is now, from where it was the last frame (world)
uniform float uCloudBlend; // how much of this frame is taken: 1 starts over

varying vec3 vCloudDirection;
varying vec2 vCloudUv;

void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  bool sparse = uCloudSparse.x > 0.5;
  // Its texel in this frame's march, and whether this frame's ray was this pixel's.
  ivec2 from = sparse ? at / 2 : at;
  bool marched = !sparse || (at.x % 2 == int(uCloudSparse.y) && at.y % 2 == int(uCloudSparse.z));
  ivec2 last = ivec2(uCloudCurrentSize) - 1;
  ivec2 lastImage = ivec2(uCloudImageSize) - 1;
  vec4 current = texelFetch(uCloudCurrent, from, 0);
  float depth = texelFetch(uCloudCurrentDepth, from, 0).r;
  vec4 low = current;
  vec4 high = current;
  float nearest = depth;
  // The farthest of the neighbours' depths that have cloud.
  float farthest = depth < 1.0 ? depth : 0.0;
  for(int y = -1; y <= 1; y++) {
    for(int x = -1; x <= 1; x++) {
      ivec2 p = clamp(from + ivec2(x, y), ivec2(0), last);
      vec4 c = texelFetch(uCloudCurrent, p, 0);
      low = min(low, c);
      high = max(high, c);
      float d = texelFetch(uCloudCurrentDepth, p, 0).r;
      nearest = min(nearest, d);
      if(d < 1.0)
        farthest = max(farthest, d);
    }
  }

  // Where this pixel's cloud lay the last frame: by its own distance, a neighbour's where it
  // has none, and as if far off where they have none either (the view's turn alone). Its
  // place from the camera then is kept apart from the camera's own, so it holds from space.
  vec3 dir = normalize(vCloudDirection);
  float d = depth < 1.0 ? depth : nearest;
  float t = d < 1.0 ? exp2(d * CLOUD_DEPTH_RANGE) : 1e9;
  vec3 view = uCloudPreviousRotation * (dir * t + uCloudCameraMove);
  vec4 clip = uCloudPreviousProjection * vec4(view, 1.0);
  vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
  bool seen = clip.w > 0.0 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
  float blend = !seen || uCloudBlend >= 1.0 ? 1.0 : (marched ? uCloudBlend : 0.0);
  // Where this frame's ray was another pixel's, its march filtered to this one.
  vec4 fresh = marched ? current : texture(uCloudCurrent, vCloudUv);

  vec4 history = clamp(texture(uCloudHistory, uv), low, high);
  gl_FragColor = mix(history, fresh, blend);

  // The depth the last frames found there, from where the camera is now, within this frame's
  // neighbours' depths: interpolated between the four texels about it that have cloud. ⚠️ Not
  // the nearest texel's: from space a texel spans kilometres of a slanting layer, more than
  // lies between the clouds' tops and the land under them, and the rounding sank whole
  // stripes of cloud behind the land while the view moved.
  vec2 h = uv * uCloudImageSize - 0.5;
  ivec2 corner = ivec2(floor(h));
  vec2 f = h - vec2(corner);
  float sum = 0.0;
  float weight = 0.0;
  for(int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    float texel = texelFetch(uCloudHistoryDepth, clamp(corner + o, ivec2(0), lastImage), 0).r;
    float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    if(texel < 1.0) {
      sum += texel * w;
      weight += w;
    }
  }
  float before = weight > 1e-4 ? sum / weight : 1.0;
  if(blend < 1.0 && d < 1.0 && before < 1.0) {
    float then = exp2(before * CLOUD_DEPTH_RANGE) - dot(dir, uCloudCameraMove);
    before = clamp(log2(max(then, 1.0)) / CLOUD_DEPTH_RANGE, nearest, max(farthest, nearest));
    d = mix(before, d, blend);
  }
  gl_FragDepth = d;
}
