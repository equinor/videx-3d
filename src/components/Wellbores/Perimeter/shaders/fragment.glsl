uniform float uTime;
uniform float uFrom;
uniform float uTo;
uniform float uOpacity;
uniform vec3 uColor;

varying float vLength;
varying vec2 vUv;

#include <common>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>

void main() {

  #include <logdepthbuf_fragment>


  float uDensity = 300.0;
  
  //float modulatedLength = mod(vLength - uTime * 50.0, uDensity); 
  float modulatedLength = mod(vLength - uFrom, uDensity); 
  
  float coord1 = modulatedLength / 10.0;
  float coord2 = vUv.y * 20.0;
  float line1 = abs(fract(coord1 - 0.5) - 0.5) / fwidth(coord1);
  float line2 = abs(fract(coord2 - 0.5) - 0.5) / fwidth(coord2);

  float line = min(line1, line2);

  float strength = 1.0 - min(line, 1.0);
  strength = pow(strength, 1.0 / 2.2);
  

  
  if (vLength < uFrom || vLength > uTo || uOpacity < 0.01) discard;

  vec3 color = uColor;
  if (!gl_FrontFacing) {
    color = mix(color, vec3(0.0), 0.75);
  }

  gl_FragColor = vec4(color * strength, uOpacity);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}