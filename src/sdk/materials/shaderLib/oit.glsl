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
//
// The `oitMergeFront` uniform (1) makes the tail pass also carry the front layer:
// the target then has a second attachment, front fragments write their b-weighted
// colour there (and nothing to the tail), and the composite resolves both — one
// geometry pass fewer than a separate front pass.
//
// The `oitTailSlices` uniform (2 or 3) splits the tail into depth slices: each pixel
// divides its own range between the nearest and farthest transparent fragment (the
// min-depth pass also stores -depth, so its minimum is -farthest), each slice goes
// to its own attachment, and the composite stacks them back to front.
//
// `oitInTail()` tells a material whether the fragment ends up in the tail, i.e. is only
// seen through the front layer, so costly shading (procedural detail) can be skipped.

#ifdef USE_OIT

uniform float oitDepthFar;          // normalisation factor for view-space depth
uniform vec2 oitScreenSize;         // render target size in pixels
uniform sampler2D oitMinDepthTexture; // per-pixel min linear depth (r), -max depth (g)
uniform int oitSkipFront;           // 1 = disable front peeling (debug: all WBOIT)
uniform float oitOcclusionThreshold; // occlusion-stamp pass: min alpha to write depth
uniform float oitFrontTolerance;    // front-peel slab, as a FRACTION of view distance
uniform int oitMergeFront;          // 1 = tail pass also writes the front layer
uniform int oitTailSlices;          // 0 = one tail; 2 or 3 = depth slices
uniform int oitTailSliceSpacing;    // 0 = equal depth, 1 = equal depth ratio (log)

#if !defined(OIT_DEPTH_PASS) && !defined(OIT_FRONT_PASS) && !defined(OIT_OCCLUSION_PASS)
// Extra colour attachments of the tail target (merged front layer, tail slices 1-2).
// Always written; attachments the target does not have are discarded by the GPU.
layout(location = 1) out highp vec4 oitFrontColor;
layout(location = 2) out highp vec4 oitSlice1Color;
layout(location = 3) out highp vec4 oitSlice2Color;
#endif

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

  // Written with MinEquation blending => per-pixel minimum of depth (r) and of -depth
  // (g, i.e. -farthest; dropped by a single-channel target).
  return vec4(linZ, -linZ, 0.0, 1.0);

  #else

  vec2 uv = gl_FragCoord.xy / oitScreenSize;
  vec2 minMax = texture2D(oitMinDepthTexture, uv).rg;
  float minZ = minMax.x;

  // The tolerance exists ONLY to absorb the last-ULP disagreement between this pass
  // and the min-depth pre-pass: they rasterise the same geometry with the same vertex
  // source, but a per-pass #define makes them separate PROGRAMS, and GLSL guarantees
  // no invariance across programs unless `invariant gl_Position` is declared. It is
  // not a modelling parameter, and two earlier forms of it were real bugs:
  //   - a FIXED normalised epsilon is a WORLD slab of eps * oitDepthFar (tens of
  //     metres at field scale), so distinct grazing surfaces both count as front, are
  //     alpha-blended in traversal order (sorting is off for the OIT sub-passes, so a
  //     FARTHER one can paint over a nearer one) and both drop out of the tail;
  //   - fwidth(linZ) spikes where a 2x2 derivative quad straddles a self-overlap
  //     silhouette, inflating the tolerance into visible bands along the seam.
  // Hence: relative to depth (so it is a constant fraction of the view distance, not
  // a fixed distance) and gradient-free (so it cannot explode at an edge). In metres,
  // the slab is about `distance * oitFrontTolerance`. The additive term only keeps
  // the test off a bare equality as minZ approaches 0 at the camera.
  float tol = minZ * oitFrontTolerance + 1e-9;

  #ifdef OIT_FRONT_PASS

  // Exact front layer: keep only the nearest fragment, blended alpha-over.
  if((linZ - minZ) > tol)
    discard;
  return color;

  #else

  // Optical-depth weight b = -ln(1 - alpha). Additive (ONE, ONE) blending then gives
  // accum.rgb = sum(rgb * b), accum.a = sum(b). The composite reconstructs both the
  // weighted-average colour (accum.rgb / accum.a) and the coverage
  // (1 - exp(-accum.a) = 1 - prod(1 - alpha)) from this single buffer, so no separate
  // reveal pass is needed. alpha is clamped below 1 to keep b finite.
  float b = -log(1.0 - clamp(color.a, 0.0, 0.9999));
  vec4 weighted = vec4(color.rgb * b, b);

  oitFrontColor = vec4(0.0);
  oitSlice1Color = vec4(0.0);
  oitSlice2Color = vec4(0.0);

  if(oitMergeFront == 1) {
    // Front and tail are decided by the SAME evaluation here, so the partition is
    // exact: no fragment is counted twice or dropped. Encoding the front fragment
    // with the same weight resolves a single fragment exactly (alpha = 1 - exp(-b))
    // and fragments tied at the front depth order-independently.
    if((linZ - minZ) <= tol) {
      oitFrontColor = weighted;
      return vec4(0.0);
    }
  } else if((linZ - minZ) <= tol * 2.0 && oitSkipFront == 0) {
    // Tail pass: exclude the front fragment (handled exactly by the front pass),
    // unless front peeling is disabled (debug: every fragment goes through WBOIT).
    // ⚠️ Tested against a WIDER slab than the front pass uses. The two are separate
    // programs, so right at the threshold they can disagree; a fragment the front
    // pass draws and this one also keeps is counted twice and reads as extra opacity
    // — exactly the artefact a tight tolerance is meant to remove. Erring wide here
    // makes that impossible, leaving only the benign case of a fragment neither pass
    // takes.
    discard;
  }

  if(oitTailSlices > 1) {
    // Position within this pixel's own [nearest, farthest] range. The guards only
    // matter where the passes disagree in the last ULP (t then clamps to an end).
    float maxZ = -minMax.y;
    float t = oitTailSliceSpacing == 1
      ? log(linZ / max(minZ, 1e-12)) / max(log(maxZ / max(minZ, 1e-12)), 1e-12)
      : (linZ - minZ) / max(maxZ - minZ, 1e-12);
    // Tent-split the weight between the two nearest slice centres: a hard boundary
    // draws a contour wherever it falls between two close layers. The weights sum to
    // 1, so the total optical depth (and transmittance) is unchanged.
    float n = float(oitTailSlices);
    float p = clamp(clamp(t, 0.0, 1.0) * n - 0.5, 0.0, n - 1.0);
    oitSlice1Color = weighted * max(0.0, 1.0 - abs(p - 1.0));
    oitSlice2Color = weighted * max(0.0, 1.0 - abs(p - 2.0));
    return weighted * max(0.0, 1.0 - p);
  }

  return weighted;

  #endif // OIT_FRONT_PASS
  #endif // OIT_DEPTH_PASS
}

// Whether this fragment is resolved in the weighted tail, i.e. only seen through the
// exact front layer, so a material can skip shading the blend would lose. Mirrors the
// partition in oitProcess; false in every other pass and with front peeling off.
bool oitInTail() {
  #if defined(OIT_DEPTH_PASS) || defined(OIT_FRONT_PASS) || defined(OIT_OCCLUSION_PASS)
  return false;
  #else
  if(oitSkipFront == 1)
    return false;
  // Without mergeFront the front layer has its own pass, and this one keeps only the tail.
  if(oitMergeFront == 0)
    return true;
  float linZ = abs(vViewPosition.z) / oitDepthFar;
  float minZ = texture2D(oitMinDepthTexture, gl_FragCoord.xy / oitScreenSize).r;
  return (linZ - minZ) > minZ * oitFrontTolerance + 1e-9;
  #endif
}

#endif // USE_OIT
