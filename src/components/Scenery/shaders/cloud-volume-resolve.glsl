// The 3D clouds' temporal accumulation (SceneryCloudVolume): this frame's march, whose steps
// and sub-pixel place are jittered each frame, blended into what the last frames made of it.
// Last frame's image is read where this pixel's cloud lay then, by the distance to its front
// (a neighbour's where it has none), clamped to what this frame's 3 × 3 neighbours hold so
// moving clouds and a moving view leave no trails, and blended in. Written as the march is:
// premultiplied colour and alpha, and the distance as depth, which is accumulated too: the
// sub-pixel jitter moves every ray the same way, and with it the depth of a whole region, which
// would otherwise flicker against what reaches into the clouds. The clouds' own drift since
// the last frame (their level's wind, by the height their front lies at) is followed as the
// camera's move is. The history is read Catmull-Rom: bilinear reads blurred it a little each
// time the drift moved it by part of a pixel, more the longer it is kept (calm). Far off
// (uCloudBlur), this frame's ray is softened with its neighbours', each weighed by how far
// from this pixel's middle it crossed: there a pixel's grain is as large as the clouds' shapes.
// A sparse march (uCloudSparse)
// draws one pixel of each 2 × 2 of the image a frame, in turn, into an image half as wide and
// high: there this frame's ray is blended in; the other three keep what the frames before
// left them, clamped to the march's neighbours about them, and take this frame's (filtered,
// each texel where its ray crossed: uCloudSample) only where the view had not seen them
// before, or some of it while the clouds change fast where they are (a timelapse): held three
// frames in four, they stood out of what moved about them as dots.

#include <common>

uniform sampler2D uCloudCurrent; // this frame's march: premultiplied colour and alpha
uniform sampler2D uCloudCurrentDepth; // log2 of the distance to their front, over CLOUD_DEPTH_RANGE
uniform sampler2D uCloudHistory; // the image the last frame resolved
uniform sampler2D uCloudHistoryDepth; // its depth (this frame's own where it has none)
uniform vec2 uCloudImageSize; // texels
uniform vec2 uCloudCurrentSize; // the march's texels: the image's, or half as many each way while sparse
uniform vec4 uCloudSparse; // 1 while the march is sparse (x), the pixel of each 2 × 2 it drew (yz), and the share of the march the other three take (w)
uniform mat3 uCloudPreviousRotation; // the last frame's world -> view rotation
uniform mat4 uCloudPreviousProjection;
uniform vec3 uCloudCameraMove; // where the camera is now, from where it was the last frame (world)
// How far each level's clouds drifted since the last frame (world, by its index in CLOUD_LEVELS),
// and which a cloud's front belongs to by its height over the sea: the camera's height, half the
// sphere's curvature (1 / 2R, for the height along the view), and the heights between the low
// and middle levels and the middle and high (zw); up at the camera.
uniform vec3 uCloudDrift[3];
uniform vec4 uCloudLevels;
uniform vec3 uCloudUp;
uniform float uCloudBlend; // how much of this frame is taken: 1 starts over
// Where this frame's rays crossed their texels of the march, from each one's first pixel of the
// image (pixels of the image): the pixel it was marched for, moved by the sub-pixel jitter.
uniform vec2 uCloudSample;
// Far clouds softened: log2 of the distance it starts at, 1 / the doublings of that distance
// over which it grows, and the most (σ, pixels of the image).
uniform vec3 uCloudBlur;

varying vec3 vCloudDirection;
varying vec2 vCloudUv;

// The history at `uv`, Catmull-Rom from five filtered taps (the four corners' small weights
// left out).
vec4 historyAt(vec2 uv) {
  vec2 p = uv * uCloudImageSize - 0.5;
  vec2 c = floor(p);
  vec2 f = p - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c - 0.5) / uCloudImageSize;
  vec2 t3 = (c + 2.5) / uCloudImageSize;
  vec2 t12 = (c + 0.5 + w2 / w12) / uCloudImageSize;
  vec4 sum = texture(uCloudHistory, vec2(t12.x, t0.y)) * (w12.x * w0.y) +
    texture(uCloudHistory, vec2(t0.x, t12.y)) * (w0.x * w12.y) +
    texture(uCloudHistory, t12) * (w12.x * w12.y) +
    texture(uCloudHistory, vec2(t3.x, t12.y)) * (w3.x * w12.y) +
    texture(uCloudHistory, vec2(t12.x, t3.y)) * (w12.x * w3.y);
  float weight = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return sum / weight;
}

void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  bool sparse = uCloudSparse.x > 0.5;
  float scale = sparse ? 2.0 : 1.0;
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

  // Far off, this frame's ray softened with its neighbours', by a Gaussian of where they
  // crossed from this pixel's middle (its own taken whole, wherever the jitter moved it).
  float sigma = uCloudBlur.z * smoothstep(0.0, 1.0, (log2(t) - uCloudBlur.x) * uCloudBlur.y);
  if(marched && d < 1.0 && sigma > 0.05) {
    vec2 middle = vec2(at) + 0.5 - uCloudSample;
    float k = -0.5 / (sigma * sigma);
    vec4 sum = current;
    float weight = 1.0;
    for(int y = -1; y <= 1; y++) {
      for(int x = -1; x <= 1; x++) {
        ivec2 p = from + ivec2(x, y);
        if((x == 0 && y == 0) || any(lessThan(p, ivec2(0))) || any(greaterThan(p, last)))
          continue;
        vec2 o = scale * vec2(p) - middle;
        float w = exp(k * dot(o, o));
        sum += w * texelFetch(uCloudCurrent, p, 0);
        weight += w;
      }
    }
    current = sum / weight;
  }

  // Since the last frame the camera moved, and the cloud drifted with its level's wind.
  float altitude = uCloudLevels.x + dot(dir, uCloudUp) * t + t * t * uCloudLevels.y;
  vec3 drift = altitude < uCloudLevels.z ? uCloudDrift[0] : (altitude < uCloudLevels.w ? uCloudDrift[1] : uCloudDrift[2]);
  vec3 move = uCloudCameraMove - drift;
  vec3 view = uCloudPreviousRotation * (dir * t + move);
  vec4 clip = uCloudPreviousProjection * vec4(view, 1.0);
  vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
  bool seen = clip.w > 0.0 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
  float blend = !seen || uCloudBlend >= 1.0 ? 1.0 : (marched ? uCloudBlend : uCloudSparse.w);
  // Where this frame's ray was another pixel's, its march filtered to this one: each texel
  // where its ray crossed, not its middle.
  vec4 fresh = marched ? current : texture(uCloudCurrent, vCloudUv - (uCloudSample - 0.5 * scale) / uCloudImageSize);

  vec4 history = clamp(historyAt(uv), low, high);
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
    float then = exp2(before * CLOUD_DEPTH_RANGE) - dot(dir, move);
    before = clamp(log2(max(then, 1.0)) / CLOUD_DEPTH_RANGE, nearest, max(farthest, nearest));
    d = mix(before, d, blend);
  }
  gl_FragDepth = d;
}
