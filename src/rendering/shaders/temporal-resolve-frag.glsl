precision highp float;

// Temporal supersampling resolve for the still-camera `temporal` (and `temporal-smaa`)
// mode.
//
// Every frame the camera projection is offset by a sub-pixel Halton jitter and the
// freshly composited frame is blended into a running history average. There is NO
// reprojection: the owning resolver detects camera motion and reseeds the history
// (blend == 1) while the camera moves, then feeds a fixed-feedback exponential average
// (blend == 1 - feedback) while it holds still.
//
// Anti-ghost neighbourhood clip: while accumulating (blend < 1) the history is clipped
// into the current frame's local colour range before the blend, at `clampStrength`.
// This bounds the fade trail an object animating under a perfectly still camera would
// otherwise leave in the pure average. Crucially the box is WIDENED (BOX_GAMMA and a
// >1px NEIGHBOURHOOD_RADIUS sampling stride): a heavily aliased near-Nyquist feature (a
// field of thin bars) is then always represented in the box, so its converged value
// stays inside it and the clip is a no-op on it - the image still converges to a
// genuinely supersampled result. Only history that lands FAR outside the local range
// (a moving object's trail, a disocclusion) is pulled in. An earlier version used a
// tight box and rejected the good history every frame, wobbling instead of settling;
// the wide box is what makes an always-on clip safe here. Set clampStrength to 0 to
// restore the pure exponential average (longer trails on animated content).
//
// The blend and clip run on a reversible luminance tonemap in YCoCg so a single very
// bright HDR specular sample cannot dominate the running average and shimmer along thin
// edges, and colour ghosts are bounded without the desaturation a raw RGB box clamp
// introduces. Operates in linear HDR, before the OutputPass. (YCoCg is a linear
// transform of the tonemapped RGB and the blend is linear, so with clampStrength == 0
// this is identical to a plain tonemapped-RGB exponential average.)
uniform sampler2D current;
uniform sampler2D history;
uniform float blend; // current-frame weight: 1 on reset/motion, 1 - feedback when still
uniform float clampStrength; // anti-ghost neighbourhood clip strength (0 = pure EMA)
uniform vec2 texelSize;

varying vec2 vUv;

// Neighbourhood colour-box half-width in sigmas, and the sampling stride in texels.
// Both are deliberately wide so converged near-Nyquist static geometry stays inside the
// box (the clip is a no-op on it) while a moving object's history is still caught.
const float BOX_GAMMA = 1.6;
const float NEIGHBOURHOOD_RADIUS = 1.5;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Reversible luminance tonemap (Tardif/Karis). Averaging / clamping in this
// range-compressed space stops a single very bright HDR sample from dominating the
// running average and shimmering across thin edges; untonemap expands the result back
// to linear HDR. Exact inverses, so the stored history round-trips without drift.
vec3 tonemap(vec3 c) {
  return c / (1.0 + luma(c));
}

vec3 untonemap(vec3 c) {
  // Clamp the expansion luma below 1: the per-channel YCoCg clip/blend can decode to an
  // RGB whose luma is >= 1, which would drive (1 - luma) to zero (or negative) and blow
  // the result past the half-float max into +Inf - the seed of a NaN feedback loop.
  // Bounding luma keeps the expansion finite.
  return c / (1.0 - min(luma(c), 0.999));
}

// Largest magnitude written back into the (half-float) history each frame. Well under
// the half-float max (65504) so a composed frame can never round up to +Inf.
const float HALF_MAX_SAFE = 60000.0;

// True when every channel is finite (no NaN / Inf). GLSL ES gives no portable
// isnan/isinf, so test NaN via self-inequality (NaN != NaN) and Inf via magnitude.
bool isFiniteColor(vec4 c) {
  return c == c && all(lessThan(abs(c), vec4(1e20)));
}

// RGB <-> YCoCg. Clipping in YCoCg bounds luma and chroma separately, so colour
// ghosting is caught without the desaturation a raw RGB box clamp introduces.
vec3 rgb2ycocg(vec3 c) {
  return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}

vec3 ycocg2rgb(vec3 c) {
  float t = c.x - c.z;
  return vec3(t + c.y, c.x + c.z, t - c.y);
}

// Clip point p into the axis-aligned box [mn, mx] by scaling its offset from the box
// centre until it lands on the box surface. Unlike a per-channel min/max clamp (which
// snaps thin features onto a box corner and desaturates), this soft clip moves the
// history the minimum distance needed to enter the current frame's statistical range.
vec4 clipAABB(vec4 mn, vec4 mx, vec4 p) {
  vec4 centre = 0.5 * (mx + mn);
  vec4 extent = 0.5 * (mx - mn) + vec4(1e-5);
  vec4 offset = p - centre;
  vec4 unit = abs(offset / extent);
  float maxUnit = max(max(unit.x, unit.y), max(unit.z, unit.w));
  return maxUnit > 1.0 ? centre + offset / maxUnit : p;
}

void main() {
  vec4 c = texture2D(current, vUv);

  // Reset / camera motion: the resolver passes blend == 1, so the history is reseeded
  // exactly from the current frame. Nothing to clip - show the current frame.
  if(blend >= 1.0) {
    gl_FragColor = c;
    return;
  }

  vec4 h = texture2D(history, vUv);
  // Belt-and-suspenders: drop a non-finite (NaN/Inf) history texel back to the current
  // frame so it cannot persist in the running average. (Unlike the TAA resolver this
  // reads history point-aligned and reseeds on motion, so it cannot spread - but the
  // shared untonemap arithmetic makes the guard cheap insurance.)
  if(!isFiniteColor(h)) {
    h = c;
  }
  vec4 curY = vec4(rgb2ycocg(tonemap(c.rgb)), c.a);
  vec4 histY = vec4(rgb2ycocg(tonemap(h.rgb)), h.a);

  // Current frame's 3x3 (widened stride) neighbourhood mean +/- gamma*sigma colour box
  // in tonemapped YCoCg + alpha. The wide box keeps converged near-Nyquist detail
  // inside it (clip = no-op) while bounding far-outside history.
  vec4 m1 = vec4(0.0);
  vec4 m2 = vec4(0.0);
  for(int x = -1; x <= 1; x++) {
    for(int y = -1; y <= 1; y++) {
      vec4 s = texture2D(current, vUv + vec2(float(x), float(y)) * texelSize * NEIGHBOURHOOD_RADIUS);
      vec4 sy = vec4(rgb2ycocg(tonemap(s.rgb)), s.a);
      m1 += sy;
      m2 += sy * sy;
    }
  }
  m1 /= 9.0;
  m2 /= 9.0;
  vec4 sigma = sqrt(max(vec4(0.0), m2 - m1 * m1));
  vec4 boxMin = m1 - BOX_GAMMA * sigma;
  vec4 boxMax = m1 + BOX_GAMMA * sigma;

  // Softly clip the history into the box (strength 0 -> untouched history = pure EMA).
  vec4 clippedY = mix(histY, clipAABB(boxMin, boxMax, histY), clampStrength);

  // Fixed-feedback exponential average in tonemapped YCoCg, then expand back to linear
  // HDR. While still, blend == 1 - feedback and the jittered frames average into a
  // supersampled image that CONVERGES.
  vec4 outY = mix(clippedY, curY, blend);
  // Clamp to a finite, non-negative range before writing back to history so a single
  // pathological frame can never store an +Inf (and thus a NaN next frame).
  gl_FragColor = vec4(clamp(untonemap(ycocg2rgb(outY.rgb)), 0.0, HALF_MAX_SAFE), outY.a);
}
