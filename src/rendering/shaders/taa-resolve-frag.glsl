precision highp float;

// Reprojected temporal anti-aliasing (TAA) resolve for the OIT pipeline.
//
// Unlike the still-only `temporal` accumulation, this reprojects the history every
// frame so anti-aliasing survives camera motion. The app's world is effectively
// static (only the camera moves), so no per-object velocity buffer is needed: the
// nearest visible surface's depth is enough to map each current pixel back into the
// previous frame.
//
// Front-pass depth: the reprojection depth is the nearest of the opaque hardware
// depth and the OIT front-layer's view-space linear depth. Transparent surfaces
// write no hardware depth, so reprojecting them by the opaque depth behind them is
// exactly what made a naive TAA ghost transparent content; using the OIT front
// depth reprojects the visible transparent surface at its true position instead.
//
// Ghosting from content the reprojection cannot track (disocclusions, additive
// highlights, animated objects) is bounded by a MOTION-GATED neighbourhood clip of
// the reprojected history: the clip is relaxed to nothing while the camera is still
// (so heavily aliased static geometry converges instead of wobbling against a single
// jittered frame's colour box) and ramped fully on as the camera moves (so nothing
// can ghost). Reprojections that land off-screen fall back to the current frame.
//
// Operates in linear HDR (RGBA passed through unchanged), so it runs before the
// OutputPass.
uniform sampler2D current;
uniform sampler2D history;
uniform sampler2D opaqueDepth; // hardware depth (log or linear encoded)
uniform sampler2D frontDepth; // OIT front-layer view-space linear depth / far
uniform int hasFrontDepth; // 1 when frontDepth was written this frame
uniform int hasHistory; // 0 on the first frame / after a reset

uniform mat4 prevViewProj; // world -> previous frame clip
uniform mat4 cameraMatrixWorld; // view -> world (current)
uniform float projP00; // projectionMatrix[0][0]
uniform float projP11; // projectionMatrix[1][1]
uniform float cameraNear;
uniform float cameraFar;
uniform int logDepth; // 1 when the renderer uses a logarithmic depth buffer
uniform float feedback; // history weight when reprojection is valid (e.g. 0.9)
uniform float clampStrength; // rest floor -> 1 in motion: neighbourhood clip strength
uniform float boxGamma; // colour-box half-width in sigmas (wider at rest, tight in motion)
uniform float neighbourhoodRadius; // sampling stride in texels (wider at rest)
uniform vec2 texelSize;

varying vec2 vUv;

// Hardware depth (window [0,1]) -> positive view-space distance (-viewZ).
float viewDistFromDepth(float d) {
  if(logDepth == 1) {
    // three's log depth: d = log2(1 + w) / log2(1 + far), with w == clip.w == -viewZ.
    return pow(cameraFar + 1.0, d) - 1.0;
  }
  float ndcZ = 2.0 * d - 1.0;
  return (2.0 * cameraNear * cameraFar) /
    (cameraFar + cameraNear - ndcZ * (cameraFar - cameraNear));
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

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Reversible luminance tonemap (Tardif/Karis). Range-compressing colour by its own
// luminance before the temporal blend (and expanding back after) stops a single very
// bright HDR specular sample from dominating the average and shimmering along thin
// edges. tonemap/untonemap are exact inverses, so the HDR history round-trips each
// frame without drift.
vec3 tonemap(vec3 c) {
  return c / (1.0 + luma(c));
}

vec3 untonemap(vec3 c) {
  return c / max(1.0 - luma(c), 1e-4);
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

  // First frame / reset: nothing to blend, seed the history with the current frame.
  if(hasHistory == 0) {
    gl_FragColor = c;
    return;
  }

  // Nearest visible surface distance: opaque hardware depth, refined by the OIT
  // front-layer depth where a transparent surface is closer.
  float viewDist = viewDistFromDepth(texture2D(opaqueDepth, vUv).r);
  if(hasFrontDepth == 1) {
    float mf = texture2D(frontDepth, vUv).r; // 1.0 == no transparent fragment
    if(mf < 0.9999) {
      viewDist = min(viewDist, mf * cameraFar);
    }
  }

  // Reconstruct the current view/world position (centred perspective).
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 viewPos = vec3(ndc.x * viewDist / projP00, ndc.y * viewDist / projP11, -viewDist);
  vec4 worldPos = cameraMatrixWorld * vec4(viewPos, 1.0);

  // Project into the previous frame to find where this surface was.
  vec4 prevClip = prevViewProj * worldPos;
  vec2 prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;

  bool valid = prevClip.w > 0.0 &&
    prevUv.x >= 0.0 &&
    prevUv.x <= 1.0 &&
    prevUv.y >= 0.0 &&
    prevUv.y <= 1.0;

  if(!valid) {
    // Disoccluded / off-screen: no trustworthy history, show the current frame.
    gl_FragColor = c;
    return;
  }

  // Current frame's 3x3 neighbourhood mean +/- gamma*sigma colour box, in tonemapped
  // (YCoCg, alpha) space; the motion-gated clip below pulls the reprojected history
  // into this range. A hard RGB min/max box was tried but it collapses to a single
  // point whenever a jittered thin/sub-pixel feature misses the 3x3 window, clamping
  // the correctly accumulated edge back to the background and making thin bars flicker
  // instead of converging. Working on tonemapped colour also keeps HDR fireflies from
  // blowing the box wide open.
  vec4 m1 = vec4(0.0);
  vec4 m2 = vec4(0.0);
  for(int x = -1; x <= 1; x++) {
    for(int y = -1; y <= 1; y++) {
      vec4 s = texture2D(current, vUv + vec2(float(x), float(y)) * texelSize * neighbourhoodRadius);
      vec4 sy = vec4(rgb2ycocg(tonemap(s.rgb)), s.a);
      m1 += sy;
      m2 += sy * sy;
    }
  }
  m1 /= 9.0;
  m2 /= 9.0;
  vec4 sigma = sqrt(max(vec4(0.0), m2 - m1 * m1));
  vec4 boxMin = m1 - boxGamma * sigma;
  vec4 boxMax = m1 + boxGamma * sigma;

  vec4 h = texture2D(history, prevUv);
  vec4 histY = vec4(rgb2ycocg(tonemap(h.rgb)), h.a);

  // Motion-gated neighbourhood clip. While the camera is still (clampStrength at its
  // rest floor) the reprojected history is clipped only softly, against a box widened
  // by boxGamma/neighbourhoodRadius so heavily aliased near-Nyquist static geometry
  // still CONVERGES (its converged value stays inside the wide box, so the clip is a
  // no-op on it) while the far-outside-box history of an object animating under a still
  // camera is pulled in - bounding the ghost trail the old fully-relaxed rest left. As
  // the camera moves (clampStrength ->1, box tightens) the history is clipped fully so
  // disocclusions and content the depth reprojection cannot follow cannot ghost.
  // Crucially the clip PRESERVES temporal AA - history that already lies inside the box
  // is kept and keeps accumulating - unlike a hard rejection that snaps every aliased
  // pixel to the raw current frame and leaves moving frames un-anti-aliased.
  vec4 clippedY = mix(histY, clipAABB(boxMin, boxMax, histY), clampStrength);

  // Blend the (clipped) history and current in tonemapped YCoCg, then expand back to
  // linear HDR. Doing the blend on range-compressed luminance is the key specular /
  // firefly fix: without it a single very bright jittered highlight dominates the
  // average and shimmers along thin edges.
  vec4 curY = vec4(rgb2ycocg(tonemap(c.rgb)), c.a);
  vec4 outY = mix(clippedY, curY, 1.0 - feedback);
  gl_FragColor = vec4(untonemap(ycocg2rgb(outY.rgb)), outY.a);
}
