// The 3D clouds' light (SceneryClouds; documents/clouds.md, "The light"; calibrated under
// toneMapping 'none'): the sun's colour and daylight where each point lies, the moon by night,
// the light scattered once (by a two-lobed phase) and many times over (all round), and the sky
// above and below as ambient; then the air's haze over the distance their light comes from, and
// from space the air over them.

uniform float uSkyHorizonBlend;
uniform vec3 uSkyEast;
uniform vec3 uSkyMoonDirection;
uniform vec3 uSkyMoonColor;
uniform float uSkyMoonPhase;
uniform float uSkySunRadiance;
uniform vec3 uCloudColor;

// The sun's weight against the sky's.
#define CLOUD_SUN 0.8
// The sky's light: how far overhead is toward the zenith's blue from the horizon's; the
// ground's below, and how much of overhead's reaches the underside anyway, off the clouds and
// the air around; and its weight. Less of it with the sun low (CLOUD_SKY_LOW at 5°, all from
// 30°), and at a cloud's base (CLOUD_SKY_BASE of it), shaded by the cloud over it.
#define CLOUD_SKY vec4(0.85, 0.7, 0.5, 0.95)
#define CLOUD_SKY_LOW 0.5
#define CLOUD_SKY_BASE 0.55

// 4π times Henyey-Greenstein's phase function: 1 all round for g = 0.
float cloudPhase(float cosine, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * cosine, 1.5);
}

// The phase's two lobes (cloudLightingAt): the forward lobe's g, the backward's, the forward's
// share, and the most it reaches (4π times: 1 all round).
uniform vec4 uCloudPhase;
// How the sun's light is shared (cloudLit): x the light scattered once, by the phase, falling
// off as e^(−τ) with the optical depth τ toward the light; y the light scattered many times over,
// leaving a cloud much as it came whichever way it is seen from, falling off z as fast.
uniform vec3 uCloudScatter;

// Where the light comes from for a point whose up is `up`: the sun while it is up there, the
// moon once its light is gone (skyMoonlight's hand-over, so it shows nothing).
vec3 cloudLightWay(vec3 up) {
  return dot(up, uSkySunDirection) > -0.105 ? uSkySunDirection : uSkyMoonDirection;
}

// What lights the clouds seen along `dir` where their up is `up`, all but what depends on the
// point (cloudLit): the light's way and its colour (the sun's, or the moon's by night, by the
// clouds' colour and CLOUD_SUN), the phase toward the view (the two lobes, at most
// uCloudPhase.w), and the ambient light at a cloud's base and top (the sky above and the ground
// below, as dark as the night is where they lie; about sunrise and sunset the undersides' glow,
// most toward the sun, in `glow`). The same for every sample of a view: within a local weather's
// radius the sun stands within a degree of itself.
struct CloudLighting {
  vec3 way;
  vec3 direct;
  float phase;
  vec3 base;
  vec3 top;
  vec3 glow;
};

CloudLighting cloudLightingAt(vec3 dir, vec3 up) {
  float sine = dot(up, uSkySunDirection);
  float elevation = degrees(asin(clamp(sine, -1.0, 1.0)));
  float daylight = smoothstep(-6.0, 10.0, elevation);
  float twilight = smoothstep(-12.0, -3.0, elevation) * (1.0 - smoothstep(1.0, 12.0, elevation));
  float dusk = min(uSkyTwilight.x * twilight, 1.0);
  vec3 sun = mix(skySunColorAt(sine), SKY_TWILIGHT_LIGHT, dusk) * daylight * (uSkySunRadiance > 1.0 ? 2.0 : 1.0);
  float moonUp = smoothstep(-0.02, 0.05, dot(up, uSkyMoonDirection));
  vec3 moon = uSkyMoonColor * (1.0 - smoothstep(-12.0, -6.0, elevation)) * uSkyMoonPhase * moonUp * 0.25;
  CloudLighting l;
  l.way = cloudLightWay(up);
  l.direct = uCloudColor * CLOUD_SUN * (l.way == uSkySunDirection ? sun : moon);
  float cosine = dot(dir, l.way);
  l.phase = min(mix(cloudPhase(cosine, uCloudPhase.y), cloudPhase(cosine, uCloudPhase.x), uCloudPhase.z), uCloudPhase.w);
  float dayLevel = mix(SKY_NIGHT_LEVEL, 1.0, skySunlit(up));
  vec3 overhead = mix(uSkyHorizonColor, uSkyZenithColor, CLOUD_SKY.x) * dayLevel;
  vec3 under = mix(mix(uSkyGroundColor, uSkyHorizonColor, 0.5) * CLOUD_SKY.y * dayLevel, overhead, CLOUD_SKY.z);
  float sky = CLOUD_SKY.w * mix(CLOUD_SKY_LOW, 1.0, smoothstep(5.0, 30.0, elevation));
  l.base = uCloudColor * under * sky;
  l.top = uCloudColor * overhead * sky;
  float facing = 0.5 + 0.5 * dot(dir, uSkySunDirection);
  l.glow = uCloudColor * SKY_TWILIGHT_ORANGE * dusk * 0.25 * facing * facing * sky;
  return l;
}

// The light a cloud scatters toward the camera at a point `h` up its level (0 its base, 1 its
// top), lit as `l` (cloudLightingAt), where the cloud toward the light is `depth` deep (optical
// depth): the light scattered once and many times over (uCloudScatter), and the sky's. The light
// scattered many times over falls off far slower than the light straight through: it carries the
// sun's light deep into a cloud, so what a view sees changes little with how far in it is seen,
// and a deck far off, seen at a low angle (a long way through its sunlit top), is not brighter than
// seen from above.
vec3 cloudLit(CloudLighting l, float h, float depth) {
  float through = uCloudScatter.x * l.phase * exp(-depth) + uCloudScatter.y * exp(-uCloudScatter.z * depth);
  float upward = smoothstep(0.0, 1.0, h);
  vec3 ambient = (mix(l.base, l.top, upward) + l.glow * (1.0 - h)) * mix(CLOUD_SKY_BASE, 1.0, upward);
  return l.direct * through + ambient;
}

// `color` seen through the air from the camera, `dist` along `dir`, as the relief is
// (reliefThroughAir): into the sky's blue over short paths and the horizon's colour over long
// ones; looking down, into the sky overhead.
vec3 cloudThroughAir(vec3 color, vec3 dir, float dist, float blend) {
  float haze = skyAirHaze(cameraPosition, dir, dist);
  if(haze <= 0.0)
    return color;
  vec3 look = globeCameraLook();
  vec3 level = dir - look * dot(dir, look);
  float n2 = dot(level, level);
  vec3 way = n2 > 1e-8 ? level * inversesqrt(n2) : uSkyEast;
  vec3 blue = skySurfaceAt(normalize(way + look * 0.47), blend, 0.0);
  vec3 horizon = skyHorizonColor(way, blend);
  float dusk = min(uSkyTwilight.x * uSkyTwilight.y, 1.0);
  float toward = pow(n2, 2.0 + 14.0 * dusk);
  if(toward < 0.999) {
    vec3 overhead = skySurfaceAt(look, blend, 0.0);
    blue = mix(overhead, blue, toward);
    horizon = mix(overhead, horizon, toward);
  }
  float depth = -log(max(1.0 - haze, 1e-4));
  vec3 kept = exp(-depth * vec3(0.75, 1.0, 1.5));
  vec3 scatter = mix(blue, horizon, 1.0 - exp(-depth));
  return color * kept + scatter * (1.0 - kept);
}

// From space, as lit where they lie (`lit`), under the little air over them: its share above
// `altitude`. In the air, `near`.
vec3 cloudFromSpace(vec3 near, vec3 lit, vec3 p, float altitude) {
  float space = skyFromSpace();
  if(space <= 0.0)
    return near;
  vec3 up = globeUpAt(p);
  float over = uSkyAir.y > 0.0 ? exp(-max(altitude, 0.0) / uSkyAir.y) : 1.0;
  float haze = skySpaceHaze(p, up) * over;
  vec3 air = skySpaceAir(haze, dot(uSkySunDirection, up)) * mix(SKY_NIGHT_LEVEL, 1.0, skySunlit(up));
  return mix(near, mix(lit, air, haze), space);
}
