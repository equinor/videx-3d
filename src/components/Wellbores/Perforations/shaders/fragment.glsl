#include <common>

#include <logdepthbuf_pars_fragment>

uniform float uTime;
uniform float uRadius;
uniform float uLength;

varying vec3 vPosition;
varying vec3 vCamera;

vec3 outer = vec3(1.0, 0.2, 0.0);
vec3 inner = vec3(1.0, 1.0, .8);

bool isInside(vec3 pos, float radius) {
  if(pos.y < 0.0 || pos.y > uLength)
    return false;
  return length(pos.xz) < radius;
}

float energyAtPosition(vec3 pos, float radius) {
  return pow(1.0 - (length(pos.xz) / radius), 2.0) * smoothstep(1.0, 0.8, pos.y);
}

void main() {
  #include <logdepthbuf_fragment>
  float STEP_SIZE = uRadius / 20.0;

  vec3 viewVector = vPosition - vCamera;

  if(length(viewVector) > 500.0) {
    gl_FragColor = vec4(mix(vec3(0.8, 0.5, 0.5), vec3(1.0), 0.5), 0.25);
  } else {

    vec3 direction = normalize(viewVector);

    vec3 pos = vPosition.xyz;
    float t = 0.0;
    float e = 0.0;
    float radius = ((uLength - pos.y) / uLength) * uRadius;

    do {
    //e += energyAtPosition(pos, radius) * 0.15;
      float calculatedE = energyAtPosition(pos, radius);
      if(calculatedE < e)
        break;
      e = calculatedE;
      t += STEP_SIZE;
      pos = vPosition.xyz + direction * t;
      radius = ((uLength - pos.y) / uLength) * uRadius;
    } while(isInside(pos, radius) && e < 1.0);

    e = e + (sin((-vPosition.y + uTime) * 20.0) * 0.003);

    float strength = clamp(e, 0.0, 1.0); //smoothstep(-0.2, 1.2, e);

    vec3 col = mix(outer, inner, strength);
    gl_FragColor = vec4(col, strength);
  }
  // #include <tonemapping_fragment>
  // #include <colorspace_fragment>
}