// Order-independent transparency (OIT) shared shader chunk.
//
// Provides the uniforms and the per-pass output logic used by the OITRenderPass
// hybrid pipeline (exact depth-peeled front layer + weighted-blended OIT tail).
//
// Usage (library ShaderMaterials, GLSL1 / gl_FragColor):
//   #include <this file>           // brings uniforms + oitProcess()
//   ...
//   gl_FragColor = ...;            // compute final straight (non-premultiplied) color
//   #ifdef USE_OIT
//     gl_FragColor = oitProcess(gl_FragColor);
//   #endif
//
// The fragment shader must have `vViewPosition` (view-space position) available.
//
// Pass selection is driven by defines set on the per-pass variant materials:
//   USE_OIT            enables the whole block
//   OIT_DEPTH_PASS     min-depth pre-pass (writes linear view-space depth)
//   OIT_FRONT_PASS     exact front layer (alpha-over, discards tail fragments)
//   (none of the above, USE_OIT only) => single-buffer weighted-blended OIT tail
//
// The WBOIT tail uses a single RGBA16F accumulation target with optical-depth
// weighting: each fragment contributes weight b = -ln(1 - alpha), so
//   accum.rgb = sum(rgb * b),  accum.a = sum(b).
// The composite recovers the weighted-average colour as accum.rgb / accum.a and the
// coverage as 1 - exp(-accum.a) = 1 - prod(1 - alpha) -- identical to a separate
// (ZERO, ONE_MINUS_SRC_COLOR) reveal pass, but without the extra rasterisation.
//
// The `oitSkipFront` uniform (1) disables front peeling so the tail pass keeps the
// front fragments too (debug: everything resolved through WBOIT).

#ifdef USE_OIT

uniform float oitDepthFar;          // normalisation factor for view-space depth
uniform vec2 oitScreenSize;         // render target size in pixels
uniform sampler2D oitMinDepthTexture; // per-pixel min linear depth (front layer)
uniform int oitSkipFront;           // 1 = disable front peeling (debug: all WBOIT)
uniform float oitOcclusionThreshold; // occlusion-stamp pass: min alpha to write depth

// Process the straight (non-premultiplied) fragment color for the active pass.
vec4 oitProcess(vec4 color) {
  #ifdef OIT_OCCLUSION_PASS
  // Occlusion depth stamp: write depth only where this surface is opaque enough
  // (its own alpha clears the threshold). Colour writes are disabled on the
  // variant, so the returned colour is ignored; discarding skips the depth write.
  // Lets sufficiently-opaque transparent surfaces occlude annotation labels even
  // though they don't write depth in the regular OIT passes.
  if(color.a < oitOcclusionThreshold)
    discard;
  return color;
  #endif

  // View-space linear depth, normalised. Independent of the (logarithmic) depth
  // buffer encoding, so the partition is correct at any camera scale.
  float linZ = abs(vViewPosition.z) / oitDepthFar;

  #ifdef OIT_DEPTH_PASS

  // Written into an R32F target with MinEquation blending => per-pixel minimum.
  return vec4(linZ, 0.0, 0.0, 1.0);

  #else

  // Gradient-relative tolerance: only the surface that produced the per-pixel
  // minimum qualifies as "front". A fixed epsilon would form a depth slab and let
  // distinct surfaces grazing within it bleed into each other.
  vec2 uv = gl_FragCoord.xy / oitScreenSize;
  float minZ = texture2D(oitMinDepthTexture, uv).r;
  // Depth-relative tolerance. The min-depth pre-pass and this pass rasterise the
  // SAME geometry with the SAME vertex transform, so the genuine front fragment's
  // linZ matches the stored minZ to near bit-exactness; a tiny epsilon suffices.
  // Avoid fwidth(linZ) here: at self-overlap silhouettes the 2x2 derivative quads
  // straddle the depth discontinuity between layers, so fwidth spikes and inflates
  // the tolerance, misclassifying back-layer fragments as front (visible edges).
  float tol = minZ * 1e-3 + 1e-6;
  bool isFront = (linZ - minZ) <= tol;

  #ifdef OIT_FRONT_PASS

  // Exact front layer: keep only the nearest fragment, blended alpha-over.
  if(!isFront)
    discard;
  return color;

  #else

  // Tail pass: exclude the front fragment (handled exactly by the front pass),
  // unless front peeling is disabled (debug: every fragment goes through WBOIT).
  if(isFront && oitSkipFront == 0)
    discard;

  float alpha = color.a;

  // Optical-depth weight b = -ln(1 - alpha). Additive (ONE, ONE) blending then gives
  // accum.rgb = sum(rgb * b), accum.a = sum(b). The composite reconstructs both the
  // weighted-average colour (accum.rgb / accum.a) and the coverage
  // (1 - exp(-accum.a) = 1 - prod(1 - alpha)) from this single buffer, so no separate
  // reveal pass is needed. alpha is clamped below 1 to keep b finite.
  float b = -log(1.0 - clamp(alpha, 0.0, 0.9999));
  return vec4(color.rgb * b, b);

  #endif // OIT_FRONT_PASS
  #endif // OIT_DEPTH_PASS
}

#endif // USE_OIT
