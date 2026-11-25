// The depth buffer as three sets it up, for shaders that place, write or read depth
// themselves (see documents/architecture.md, "Depth buffers"):
// - linear: near at 0, far at 1, clip z from -w to w;
// - logarithmic (USE_LOGARITHMIC_DEPTH_BUFFER): written per fragment, log2 of 1 + w
//   (logdepthbuf_fragment); clipped as linear;
// - reversed (USE_REVERSED_DEPTH_BUFFER): near at 1, far at 0, clip z from 0 to w.
// Logarithmic and reversed together are not supported: three's own logdepthbuf_fragment has
// no reversed form. three defines both for a ShaderMaterial; a RawShaderMaterial gets
// neither, and must be told by a uniform.

#ifndef VIDEX_DEPTH_GLSL
#define VIDEX_DEPTH_GLSL

// The far plane's z in normalized device coordinates, for what is drawn on it.
#ifdef USE_REVERSED_DEPTH_BUFFER
#define DEPTH_FAR_NDC 0.0
#else
#define DEPTH_FAR_NDC 1.0
#endif

// `step` of window depth inside the far plane, in normalized device coordinates: in front of
// what is drawn on it (DEPTH_FAR_NDC), behind everything else. A layer drawn there first,
// writing its depth, leaves those on the far plane to the depth test where it is drawn. The
// step must be the depth buffer's own (see the relief overview's, scenery-relief.ts): finer,
// it rounds to the far plane and they pass; coarser, what lies just short of the far plane
// falls behind it. A 24-bit step (2^-24) lies behind the clouds' and the layers' depths held
// inside the far plane (depthInsideFar, 1e-7 and more).
float depthInsideFarNdc(float step) {
  #ifdef USE_REVERSED_DEPTH_BUFFER
  return step;
  #else
  return 1.0 - 2.0 * step;
  #endif
}

// `clip` held `margin` of its w inside the far plane: far off, clip z rounds past it in fp32,
// and vertices there are clipped at random. A logarithmic buffer writes its depth from w, so
// there only the clipping changes.
vec4 depthInsideFarClip(vec4 clip, float margin) {
  #ifdef USE_REVERSED_DEPTH_BUFFER
  clip.z = max(clip.z, clip.w * margin);
  #else
  clip.z = min(clip.z, clip.w * (1.0 - margin));
  #endif
  return clip;
}

// `depth` held `margin` inside the far plane's.
float depthInsideFar(float depth, float margin) {
  #ifdef USE_REVERSED_DEPTH_BUFFER
  return max(depth, margin);
  #else
  return min(depth, 1.0 - margin);
  #endif
}

// The depth the hardware gives the clip position `clip`, linear or reversed.
float depthOfClip(vec4 clip) {
  #ifdef USE_REVERSED_DEPTH_BUFFER
  return clip.z / clip.w;
  #else
  return 0.5 * clip.z / clip.w + 0.5;
  #endif
}

// The depth to write (gl_FragDepth) for the view-space point `view` seen through `projection`:
// with a logarithmic buffer and a perspective projection as logdepthbuf_fragment writes it,
// from `logFC` (three's logDepthBufFC), else as the hardware would. Called through
// depthOfView, which passes logDepthBufFC (declared by logdepthbuf_pars_fragment) only where it
// is called, so a shader without it may include this file.
// ⚠️ three declares `projectionMatrix` for the vertex shader only: a fragment shader passing it
// declares it itself (three sets it by name).
float depthOfViewWith(mat4 projection, vec3 view, float logFC) {
  float depth = depthOfClip(projection * vec4(view, 1.0));
  #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  // three's isPerspectiveMatrix, without <common>.
  if(projection[2][3] == -1.0)
    depth = log2(1.0 - view.z) * logFC * 0.5;
  #endif
  return depth;
}
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
#define depthOfView(projection, view) depthOfViewWith(projection, view, logDepthBufFC)
#else
#define depthOfView(projection, view) depthOfViewWith(projection, view, 0.0)
#endif

// A depth read from a linear or reversed buffer as the linear one: reversed, 1 - depth is the
// linear depth of the same point, for a perspective and an orthographic projection alike. A
// logarithmic one is left as it is.
float depthToStandard(float depth) {
  #ifdef USE_REVERSED_DEPTH_BUFFER
  return 1.0 - depth;
  #else
  return depth;
  #endif
}

#endif
