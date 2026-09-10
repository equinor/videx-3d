#define TRAJECTORY_HIGHLIGHT

uniform vec3 diffuse;
uniform float opacity;

#include <common>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

// Flat, constant-brightness highlight colour (no DEPTH_SHADE rim darkening and no
// distance alpha-fade), so the ghost reads clearly at any zoom. Depth is written via
// the log-depth chunks so the highlight is occluded by nearer opaque geometry.
void main() {
  #include <clipping_planes_fragment>
  #include <logdepthbuf_fragment>

  gl_FragColor = vec4(diffuse.rgb, opacity);

  #include <colorspace_fragment>
}
