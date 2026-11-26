// The occlusion stamp folded into the OIT min-depth pass (OITRenderPass.occlusionDepthStamp):
// per pixel, the nearest transparent fragment whose alpha cleared the threshold, as the
// min-depth target keeps it (linear view depth over the far plane; oit.glsl,
// OIT_DEPTH_OCCLUDERS), written into the depth buffer as the buffer holds depth.
#include ../../sdk/materials/shaderLib/depth.glsl

uniform sampler2D occluders;
// The channel it is in: 1 (g), or 2 (b) beside the tail slices' -farthest in g.
uniform int occluderChannel;
uniform float depthFar;
// The scene camera's: this draw's own camera is the fullscreen one.
uniform mat4 cameraProjection;
uniform float cameraLogDepthFC;

void main() {
  vec4 texel = texelFetch(occluders, ivec2(gl_FragCoord.xy), 0);
  float linZ = occluderChannel == 2 ? texel.b : texel.g;
  // None here: the clear's far.
  if(linZ >= 1.0)
    discard;
  gl_FragDepth = depthOfViewWith(cameraProjection, vec3(0.0, 0.0, -linZ * depthFar), cameraLogDepthFC);
}