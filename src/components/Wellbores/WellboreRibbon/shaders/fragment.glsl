#include <common>
#include <logdepthbuf_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>

  vec3 color = vec3(1.0, 0.0, 0.0);

  gl_FragColor = vec4(color, 1.0);

  //#include <tonemapping_fragment>
	#include <colorspace_fragment>

}
