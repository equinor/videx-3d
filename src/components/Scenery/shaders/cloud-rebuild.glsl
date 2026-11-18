// The 3D clouds' interleaved image rebuilt (SceneryClouds, `temporal`). The march draws one
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
// 1: where each pixel came from, instead of its own colour (SceneryCloudsDebug's 'temporal').
uniform int uCloudDebug;

varying vec3 vCloudDirection;

// How far off a view with no cloud about it is taken: its direction alone counts.
#define CLOUD_PART_FAR 1e8
// An older part is taken as it is where the view has moved its pixel less than x of a pixel of the
// full image since it was marched, and held within this frame's part about it from y on.
#define CLOUD_PART_HELD vec2(0.25, 1.0)
// An older part's pixel whose own cloud, carried into this frame's view by its own depth, lands
// x pixels of the full image from where it is taken is taken whole; from y on, not at all.
#define CLOUD_PART_LANDS vec2(0.75, 1.5)
// The debug view's tints (uCloudDebug): an older part taken as it was; moved, turning to the
// held tint by how much this frame's part held it (the colour it changed, CLOUD_SOURCE_SCALE
// of it the whole tint); and this frame's part between its texels, where the older part's
// camera did not see. This frame's own pixels keep their colour.
#define CLOUD_SOURCE_KEPT vec3(0.2, 1.0, 0.2)
#define CLOUD_SOURCE_MOVED vec3(0.25, 0.45, 1.0)
#define CLOUD_SOURCE_HELD vec3(1.0, 0.15, 0.1)
#define CLOUD_SOURCE_FILLED vec3(1.0, 0.85, 0.1)
#define CLOUD_SOURCE_SCALE 0.25

// `color` (premultiplied) tinted by `tint`, as bright as its cloud and as opaque.
vec4 cloudSourceTint(vec4 color, vec3 tint) {
  float lum = color.a > 1e-3 ? dot(color.rgb / color.a, vec3(0.299, 0.587, 0.114)) : 0.0;
  return vec4(tint * color.a * (0.35 + 0.65 * clamp(lum, 0.0, 1.0)), color.a);
}

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
    vec4 texel = cloudPartTexel(k, own);
    gl_FragColor = uCloudDebug == 1 && k != f ? cloudSourceTint(texel, CLOUD_SOURCE_KEPT) : texel;
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
  // How much this frame's part held the older part's colour; none where it was not taken.
  float held = -1.0;
  if(uCloudPartState[k].x > 0.5) {
    // Where the cloud at that depth along this pixel's view lay in part k's view.
    float t = near < 1.0 ? exp2(near * CLOUD_DEPTH_RANGE) : CLOUD_PART_FAR;
    vec3 q = normalize(vCloudDirection) * t - uCloudPartAt[k];
    vec4 clip = uCloudPartView[k] * vec4(q, 1.0);
    if(clip.w > 0.0) {
      vec2 ndc = clip.xy / clip.w;
      vec2 c = ((ndc * 0.5 + 0.5) * uCloudImageSize - 0.5 - vec2(cloudPartOffset(k))) * 0.5;
      if(all(greaterThanEqual(c, vec2(-0.5))) && all(lessThanEqual(c, uCloudPartSize - 0.5))) {
        // Held within this frame's own about it as far as the view has moved its pixel
        // (CLOUD_PART_HELD): where the depth it was moved by is not its cloud's (at a cloud's
        // edge, the clear sky's beside it), each older part showed the edge where it lay in its
        // own frame, three edges trailing the one marched (2026-11-10). A pixel that has not moved
        // is where it was marched, and not held: this frame's part, two pixels apart, does not
        // bound the clouds' detail between its pixels, and held within whichever part was marched
        // last, every older pixel changed each frame while the camera crept (its controls easing
        // it to a stop): 3 % of the clouds' pixels over 0.05 off the full march, 5 % from frame to
        // frame against 0.02 % (2026-11-11).
        vec4 moved = cloudPartAt(k, c);
        float shift = 2.0 * length(c - vec2(own));
        vec4 filled = color;
        color = mix(moved, clamp(moved, low, high), smoothstep(CLOUD_PART_HELD.x, CLOUD_PART_HELD.y, shift));
        held = length(color - moved);
        // Its depth as far from this frame's camera.
        float d = cloudPartNearest(k, c);
        depth = 1.0;
        if(d < 1.0) {
          vec4 v = uCloudPartUnview[k] * vec4(ndc, 0.0, 1.0);
          vec3 p = normalize(v.xyz / v.w) * exp2(d * CLOUD_DEPTH_RANGE) + uCloudPartAt[k];
          depth = clamp(log2(max(length(p), 1.0)) / CLOUD_DEPTH_RANGE, 0.0, 0.999999);
          // Where its own cloud lies in this frame's view: taken only where that is this pixel
          // (CLOUD_PART_LANDS), else this frame's part between its texels. Moved by a depth not
          // its own — at a cloud's edge, a clear pixel by the cloud beside it — it was the cloud
          // as it lay in the older part's frame: moving along the view (a zoom), where only the
          // depth moves a pixel, the older parts trailed the clouds' edges, the clamp to this
          // frame's part no help where its texels hold both cloud and sky (2026-11-17).
          vec4 now = uCloudPartView[f] * vec4(p, 1.0);
          float off = 1e9;
          if(now.w > 0.0)
            off = length((now.xy / now.w * 0.5 + 0.5) * uCloudImageSize - 0.5 - vec2(pixel));
          float keep = 1.0 - smoothstep(CLOUD_PART_LANDS.x, CLOUD_PART_LANDS.y, off);
          color = mix(filled, color, keep);
          if(keep < 0.5) {
            depth = near;
            held = -1.0;
          }
        }
      }
    }
  }
  if(uCloudDebug == 1)
    color = held < 0.0 ? cloudSourceTint(color, CLOUD_SOURCE_FILLED) : cloudSourceTint(color, mix(CLOUD_SOURCE_MOVED, CLOUD_SOURCE_HELD, clamp(held / CLOUD_SOURCE_SCALE, 0.0, 1.0)));
  gl_FragColor = color;
  gl_FragDepth = depth;
}
