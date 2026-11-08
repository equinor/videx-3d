// The 3D clouds' light volume (CloudAtmosphereVolume, scenery-cloud-atmosphere.ts), a slice at a
// time, from their density volume (cloud-atmosphere-bake.glsl): from each texel's middle, how much
// cloud lies toward the light (the sun's, or the moon's by night) up to the clouds' top, and
// straight up to it. In units of the density volume's r over metres: the march multiplies them
// by the extinction a unit of r stands for, so they hold whatever the clouds' density.
//
// The march takes the light near a point from the density volume itself, finely, and from here
// only beyond (cloud-volume-march.glsl, cloudRefLight): this volume may be coarse.
//
// Out: r toward the light, g straight up.

precision highp float;
precision highp int;
precision highp sampler3D;

uniform sampler3D uLightDensity;
// Texels along the light volume's sides, and the slice drawn.
uniform vec4 uLightSize;
// Half the square's side (m), and the metres a texel of the density volume spans across.
uniform vec2 uLightDomain;
// The heights the volumes span (m, over the sea).
uniform vec2 uLightExtent;
// The way to the light, on the field's frame (east, north, up).
uniform vec3 uLightWay;

// Samples toward the light, and straight up: spread as their squares, nearer first.
#define LIGHT_SAMPLES 32
#define LIGHT_SKY_SAMPLES 16
// The longest way toward the light (m): past it, a low light's way has left the clouds.
#define LIGHT_FARTHEST 12000.0

// The density volume's r at `p` (m: east, north, height over the sea), taken in over a footprint
// `footprint` across.
float lightDensity(vec3 p, float footprint) {
  vec3 at = vec3(p.xy / (2.0 * uLightDomain.x) + 0.5, (p.z - uLightExtent.x) / (uLightExtent.y - uLightExtent.x));
  if(any(lessThan(at, vec3(0.0))) || any(greaterThan(at, vec3(1.0))))
    return 0.0;
  return textureLod(uLightDensity, at, max(log2(footprint / uLightDomain.y), 0.0)).r;
}

// The cloud from `p` along `way` over `span` metres (r m), in `n` samples, each taking in as much
// as it stands for (as cloudRefDepth does).
float lightDepth(vec3 p, vec3 way, float span, int n) {
  float depth = 0.0;
  float fn = float(n);
  for(int j = 0; j < n; j++) {
    float a = pow(float(j) / fn, 2.0);
    float b = pow(float(j + 1) / fn, 2.0);
    float part = (b - a) * span;
    depth += lightDensity(p + way * (0.5 * (a + b) * span), 0.25 * part) * part;
  }
  return depth;
}

void main() {
  vec3 uvw = vec3(gl_FragCoord.xy, uLightSize.w + 0.5) / uLightSize.xyz;
  vec3 p = vec3((uvw.xy - 0.5) * 2.0 * uLightDomain.x, mix(uLightExtent.x, uLightExtent.y, uvw.z));
  float toTop = max(uLightExtent.y - p.z, 0.0);
  float toLight = lightDepth(p, uLightWay, min(toTop / max(uLightWay.z, 0.03), LIGHT_FARTHEST), LIGHT_SAMPLES);
  float above = lightDepth(p, vec3(0.0, 0.0, 1.0), toTop, LIGHT_SKY_SAMPLES);
  gl_FragColor = vec4(toLight, above, 0.0, 1.0);
}
