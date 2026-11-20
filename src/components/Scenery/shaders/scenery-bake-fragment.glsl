// What a Scenery films into its environment map and light probe for each zone the camera can be
// in (SceneryBaker): never drawn, and small, so it compiles at once and the scene is lit within
// moments of loading, whatever the background still compiles. The light is smooth, so the
// zones are drawn as such:
// - the air: the sky's own surface (skySurface: its gradient, daylight, twilight and the sun's
//   halo; no disc, moon or stars, which the scene's lights carry), over a flat sea: the sky
//   mirrored by Fresnel toward the horizon, the water and its seabed toward the nadir, and the
//   whitecaps' mean cover. The 3D clouds are drawn over it (the baker's overlay);
// - the water: its own light at the bake's depth, the seabed below fogged by it, and over it
//   Snell's window, the sky through the surface;
// - the subsurface: a dark backdrop and soft light panels, fixed in the sky's frame.

#include <common>
#include ./sky-gradient.glsl
#include ../../../sdk/materials/shaderLib/water-fog.glsl

uniform vec3 uSkyNorth;
uniform vec3 uSkyEast;
uniform float uSkyHorizonBlend;
uniform vec3 uSkyOceanWaterColor;
uniform vec3 uSkyOceanExtinction;
uniform float uSkyOceanDepth;
uniform vec3 uSkyOceanBedColor;
// The zone filmed: 0 the air, 1 the water, 2 the subsurface.
uniform int uBakeZone;
// The sea under the air: x 1 with one; y how much of the sky it reflects (its
// reflectionIntensity); z the share of it the whitecaps cover (oceanWhitecapCover, times the
// foam's opacity); w 1 with its water drawn under the surface.
uniform vec4 uBakeSea;
uniform vec3 uBakeFoamColor;
// How far under the surface the water is filmed from (SCENERY_WATER_BAKE_DEPTH).
uniform float uBakeDepth;
uniform vec3 uSubsurfaceTop;
uniform vec3 uSubsurfaceBottom;
uniform vec3 uSubsurfaceAbove; // the panels above the horizon, colour times intensity
uniform vec3 uSubsurfaceBelow; // and below it

varying vec3 vSkyDirection;

// How much light water reflects at `c`, the cosine of the angle of incidence on the air side:
// Schlick's curve from 2 %, close enough for light as smooth as this.
float bakeFresnel(float c) {
  return 0.02 + 0.98 * pow(1.0 - clamp(c, 0.0, 1.0), 5.0);
}

// The water's own light gathered along a sight line `path` long from `fromDepth` to `toDepth`.
vec3 bakeWaterLight(float fromDepth, float toDepth, float path) {
  vec3 e = uSkyOceanExtinction;
  return waterFogLight(waterLitDepth(waterLitAlong(fromDepth, toDepth, path, e), e), e, uSkyDaylight);
}

// The seabed, lit by what daylight reaches it.
vec3 bakeSeabed() {
  vec3 e = uSkyOceanExtinction;
  return uSkyOceanBedColor * waterFogLight(waterLitDepth(uSkyOceanDepth, e), e, uSkyDaylight);
}

vec3 bakeAir(vec3 dir) {
  float y = dot(dir, uSkyUp);
  vec3 color = skySurface(dir, uSkyHorizonBlend);
  if(uBakeSea.x < 0.5 || y >= 0.0)
    return color;
  vec3 sky = skySurface(dir - 2.0 * y * uSkyUp, uSkyHorizonBlend) * uBakeSea.y;
  vec3 under = vec3(0.0);
  if(uBakeSea.w > 0.5) {
    float path = waterPathDown(uSkyOceanDepth, y);
    vec4 water = waterUnderSurface(path, y, uSkyOceanExtinction, uSkyOceanWaterColor, bakeWaterLight(0.0, uSkyOceanDepth, path));
    under = water.rgb + bakeSeabed() * (1.0 - water.a);
  }
  float fresnel = bakeFresnel(-y);
  vec3 sea = sky * fresnel + under * (1.0 - fresnel);
  vec3 foam = uBakeFoamColor * mix(SKY_NIGHT_LEVEL, 1.0, uSkyDaylight);
  return mix(sea, foam, uBakeSea.z);
}

// One return: from within a branch, Direct3D took the function's value for one that may be
// left unset (warning X4000).
vec3 bakeWater(vec3 dir) {
  float y = dot(dir, uSkyUp);
  float depth = uBakeDepth;
  vec3 seen;
  if(y > 0.0) {
    // Up to the surface: the water mirrored, and through the window the sky over it.
    vec3 mirrored = uSkyOceanWaterColor * bakeWaterLight(depth, depth, 1e6) * waterGlow(-y);
    vec3 above = mirrored;
    vec3 exit = refract(dir, -uSkyUp, 1.333);
    if(dot(exit, exit) > 0.0) {
      exit = normalize(exit);
      above = mix(skySurfaceAt(exit, uSkyHorizonBlend, 0.0), mirrored, bakeFresnel(dot(exit, uSkyUp)));
    }
    float path = depth / max(y, 1e-3);
    seen = waterFog(above, path, uSkyOceanExtinction, uSkyOceanWaterColor, bakeWaterLight(depth, 0.0, path), y);
  } else {
    // Down to the seabed, as far as it lies.
    float path = max(uSkyOceanDepth - depth, 0.0) / max(-y, 1e-3);
    seen = waterFog(bakeSeabed(), path, uSkyOceanExtinction, uSkyOceanWaterColor, bakeWaterLight(depth, uSkyOceanDepth, path), y);
  }
  return seen;
}

// Each panel: compass bearing and elevation, angular radius (degrees), share of the light.
const int SUBSURFACE_PANELS = 5;
const vec4 SUBSURFACE_PANEL[SUBSURFACE_PANELS] = vec4[SUBSURFACE_PANELS](vec4(45.0, 45.0, 14.0, 1.0), // key
vec4(225.0, 30.0, 20.0, 0.4), // fill
vec4(0.0, 90.0, 24.0, 0.6), // top
vec4(135.0, -35.0, 20.0, 0.5), // bounce
vec4(315.0, -35.0, 20.0, 0.5) // bounce
);

vec3 bakeSubsurface(vec3 dir) {
  float y = dot(dir, uSkyUp);
  vec3 color = mix(uSubsurfaceBottom, uSubsurfaceTop, smoothstep(-1.0, 1.0, y));
  for(int i = 0; i < SUBSURFACE_PANELS; i++) {
    vec4 panel = SUBSURFACE_PANEL[i];
    float azimuth = radians(panel.x);
    float elevation = radians(panel.y);
    vec3 toward = (uSkyNorth * cos(azimuth) + uSkyEast * sin(azimuth)) * cos(elevation) + uSkyUp * sin(elevation);
    float radius = radians(panel.z);
    // Soft from 60% of the radius out.
    float lit = smoothstep(cos(radius), cos(0.6 * radius), dot(dir, toward));
    color += (panel.y < 0.0 ? uSubsurfaceBelow : uSubsurfaceAbove) * panel.w * lit;
  }
  return color;
}

void main() {
  vec3 dir = normalize(vSkyDirection);
  vec3 color = uBakeZone == 0 ? bakeAir(dir) : uBakeZone == 1 ? bakeWater(dir) : bakeSubsurface(dir);
  gl_FragColor = vec4(color, 1.0);
}
