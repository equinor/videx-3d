// The 3D clouds' interleaved image rebuilt (SceneryCloudVolume, `temporal`). The march draws one
// pixel of each 2 × 2 block a frame (a part, each in turn), each part into an image of its own
// half as wide and high, from the camera it was drawn from. Each pixel of the full image is taken
// from its own part: this frame's as it is; another's (at most three frames old) as it was, where
// that part's camera is this frame's, else from where its cloud lies in this view — moved by the
// distance to the clouds' front about this pixel in this frame's part — and where that falls
// outside what the part's camera saw, from this frame's part between its nearest texels.
//
// Each pixel is read once from a march, never from an image built before. The temporal resolve
// this replaces (2026-11-06) blended each frame's march into the image it had built so far, its
// steps jittered from frame to frame: its errors carried on frame after frame, and the clouds
// morphed as the camera moved.

uniform sampler2D uCloudPart0;
uniform sampler2D uCloudPart1;
uniform sampler2D uCloudPart2;
uniform sampler2D uCloudPart3;
// Each part's depth: log2 of the distance to the clouds' front, over CLOUD_DEPTH_RANGE; 1 none.
uniform sampler2D uCloudPartDepth0;
uniform sampler2D uCloudPartDepth1;
uniform sampler2D uCloudPartDepth2;
uniform sampler2D uCloudPartDepth3;
// Each part's camera: its projection times its view's turn (no translation), and its inverse;
// where it was from this frame's camera (world); whether it holds a march (x) and whether its
// camera was other than this frame's (y).
uniform mat4 uCloudPartView[4];
uniform mat4 uCloudPartUnview[4];
uniform vec3 uCloudPartAt[4];
uniform vec2 uCloudPartState[4];
// This frame's part (x + 2 y of its pixel in each block), the full image's size and a part's.
uniform int uCloudPhase;
uniform vec2 uCloudImageSize;
uniform vec2 uCloudPartSize;

varying vec3 vCloudDirection;

// How far off a view with no cloud about it is taken: its direction alone counts.
#define CLOUD_PART_FAR 1e8

ivec2 cloudPartOffset(int k) {
  return ivec2(k & 1, k >> 1);
}

vec4 cloudPartTexel(int k, ivec2 at) {
  if(k == 0)
    return texelFetch(uCloudPart0, at, 0);
  if(k == 1)
    return texelFetch(uCloudPart1, at, 0);
  if(k == 2)
    return texelFetch(uCloudPart2, at, 0);
  return texelFetch(uCloudPart3, at, 0);
}

// Part `k` at `c` (its texels, their middles at whole numbers), filtered.
vec4 cloudPartAt(int k, vec2 c) {
  vec2 uv = (c + 0.5) / uCloudPartSize;
  if(k == 0)
    return texture(uCloudPart0, uv);
  if(k == 1)
    return texture(uCloudPart1, uv);
  if(k == 2)
    return texture(uCloudPart2, uv);
  return texture(uCloudPart3, uv);
}

float cloudPartDepth(int k, ivec2 at) {
  at = clamp(at, ivec2(0), ivec2(uCloudPartSize) - 1);
  if(k == 0)
    return texelFetch(uCloudPartDepth0, at, 0).r;
  if(k == 1)
    return texelFetch(uCloudPartDepth1, at, 0).r;
  if(k == 2)
    return texelFetch(uCloudPartDepth2, at, 0).r;
  return texelFetch(uCloudPartDepth3, at, 0).r;
}

// The nearest of part `k`'s four texels' depths about `c`, a clear one having none (1).
float cloudPartNearest(int k, vec2 c) {
  ivec2 corner = ivec2(floor(c));
  float nearest = 1.0;
  for(int i = 0; i < 4; i++)
    nearest = min(nearest, cloudPartDepth(k, corner + ivec2(i & 1, i >> 1)));
  return nearest;
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  int k = (pixel.x & 1) + 2 * (pixel.y & 1);
  int f = uCloudPhase;
  ivec2 own = pixel >> 1;
  if(k == f || (uCloudPartState[k].x > 0.5 && uCloudPartState[k].y < 0.5)) {
    gl_FragColor = cloudPartTexel(k, own);
    gl_FragDepth = cloudPartDepth(k, own);
    return;
  }
  // This frame's part about this pixel: between its nearest texels, at the nearest's depth; and
  // the least and most of them, which bound what any part may show here.
  vec2 fresh = vec2(pixel - cloudPartOffset(f)) * 0.5;
  float near = cloudPartNearest(f, fresh);
  vec4 color = cloudPartAt(f, fresh);
  ivec2 corner = clamp(ivec2(floor(fresh)), ivec2(0), ivec2(uCloudPartSize) - 1);
  vec4 low = vec4(1e9);
  vec4 high = vec4(-1e9);
  for(int i = 0; i < 4; i++) {
    vec4 texel = cloudPartTexel(f, min(corner + ivec2(i & 1, i >> 1), ivec2(uCloudPartSize) - 1));
    low = min(low, texel);
    high = max(high, texel);
  }
  float depth = near;
  if(uCloudPartState[k].x > 0.5) {
    // Where the cloud at that depth along this pixel's view lay in part k's view.
    float t = near < 1.0 ? exp2(near * CLOUD_DEPTH_RANGE) : CLOUD_PART_FAR;
    vec3 q = normalize(vCloudDirection) * t - uCloudPartAt[k];
    vec4 clip = uCloudPartView[k] * vec4(q, 1.0);
    if(clip.w > 0.0) {
      vec2 ndc = clip.xy / clip.w;
      vec2 c = ((ndc * 0.5 + 0.5) * uCloudImageSize - 0.5 - vec2(cloudPartOffset(k))) * 0.5;
      if(all(greaterThanEqual(c, vec2(-0.5))) && all(lessThanEqual(c, uCloudPartSize - 0.5))) {
        // Held within this frame's own about it: where the depth it was moved by is not its
        // cloud's (at a cloud's edge, the clear sky's beside it), each older part showed the edge
        // where it lay in its own frame, three edges trailing the one marched (2026-11-10).
        color = clamp(cloudPartAt(k, c), low, high);
        // Its depth as far from this frame's camera.
        float d = cloudPartNearest(k, c);
        depth = 1.0;
        if(d < 1.0) {
          vec4 v = uCloudPartUnview[k] * vec4(ndc, 0.0, 1.0);
          vec3 p = normalize(v.xyz / v.w) * exp2(d * CLOUD_DEPTH_RANGE) + uCloudPartAt[k];
          depth = clamp(log2(max(length(p), 1.0)) / CLOUD_DEPTH_RANGE, 0.0, 0.999999);
        }
      }
    }
  }
  gl_FragColor = color;
  gl_FragDepth = depth;
}
