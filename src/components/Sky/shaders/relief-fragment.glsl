// A stage's relief (SkyBoxStage `relief`): land where it rises above the sea, seabed below
// it, coloured flat or by the earth ramp, lit by the scene's lights as the stage's seabed
// is. The seabed is seen through the water as the stage's is; the land, and a dry seabed,
// through the air, turning blue with distance before it fades into the horizon. It leaves
// the stage's own area to the stage.
// RELIEF_RAMP colours by height.

#include <common>
#include <logdepthbuf_pars_fragment>
#include ./sky.glsl
#include ./relief.glsl

// The land's shine, faint: rock and soil, not water.
#define RELIEF_LAND_SPECULAR vec3(0.02)
#define RELIEF_LAND_SHININESS 8.0
// How much more of each channel than of green the air takes: it scatters blue most, so
// distant land turns blue before it fades into the horizon.
#define RELIEF_AIR_SPREAD vec3(0.5, 1.0, 2.0)
// How much more the relief's air counts than the sea's haze, for a sense of distance: from
// low down, and from high up, where the air below is thin; eased between those heights.
#define RELIEF_AIR_DEPTH vec2(1.5, 2.0)
#define RELIEF_AIR_HEIGHTS vec2(3000.0, 20000.0)

#ifdef RELIEF_RAMP
uniform sampler2D uReliefPalette; // the earth ramp, its highest at u = 0
uniform vec2 uReliefRange; // the lowest and highest heights over the sea it spans
// Where the sea's level lies along the earth ramp: between its blues and its greens.
#define RELIEF_RAMP_SEA 0.13
#else
uniform vec3 uReliefLandColor;
#endif

varying vec3 vReliefWorld;
varying vec2 vReliefPlane;

vec3 reliefAlbedo(float height, float weight) {
  #ifdef RELIEF_RAMP
  float t = height < 0.0 ? RELIEF_RAMP_SEA * (1.0 - height / min(uReliefRange.x, -1.0)) : RELIEF_RAMP_SEA + (1.0 - RELIEF_RAMP_SEA) * height / max(uReliefRange.y, 1.0);
  vec3 color = texture2D(uReliefPalette, vec2(1.0 - clamp(t, 0.0, 1.0), 0.5)).rgb;
  #else
  vec3 color = mix(uSkyOceanBedColor, uReliefLandColor, smoothstep(-1.0, 1.0, height));
  #endif
  // Into the stage's own seabed where the relief eases into it.
  return mix(uSkyOceanBedColor, color, weight);
}

// The depth of the point `t` along this pixel's view ray `dir`, as the stage writes the curved sea's.
float reliefDepthAt(vec3 dir, float t) {
  vec3 view = mat3(viewMatrix) * dir * t;
  #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  return vIsPerspective == 0.0 ? gl_FragCoord.z : log2(1.0 - view.z) * logDepthBufFC * 0.5;
  #else
  vec4 clip = projectionMatrix * vec4(view, 1.0);
  return 0.5 * clip.z / clip.w + 0.5;
  #endif
}

// `color` seen through the air from the camera, `dist` along `dir`, channel by channel:
// into the sky's blue over short paths and the horizon's colour over long ones. Looking
// down, into the sky overhead as seen from the sea, as the sea's haze does
// (skyOceanThroughAir), so the sun's side cannot show as a wedge below.
vec3 reliefThroughAir(vec3 color, vec3 dir, float dist, float blend, float altitude) {
  float haze = skyAirHaze(cameraPosition, dir, dist);
  if(haze <= 0.0)
    return color;
  vec3 level = dir - uSkyUp * dot(dir, uSkyUp);
  float n2 = dot(level, level);
  vec3 way = n2 > 1e-8 ? level * inversesqrt(n2) : uSkyEast;
  // The sky some 25 degrees up along the view's bearing.
  vec3 blue = skySurfaceAt(normalize(way + uSkyUp * 0.47), blend, 0.0);
  vec3 horizon = skyHorizonColor(way, blend);
  float dusk = min(uSkyTwilight.x * uSkyTwilight.y, 1.0);
  float toward = pow(n2, 2.0 + 14.0 * dusk);
  if(toward < 0.999) {
    vec3 overhead = skySurfaceAt(uSkyUp, blend, 0.0);
    blue = mix(overhead, blue, toward);
    horizon = mix(overhead, horizon, toward);
  }
  float depth = -log(max(1.0 - haze, 1e-4)) * mix(RELIEF_AIR_DEPTH.x, RELIEF_AIR_DEPTH.y, smoothstep(RELIEF_AIR_HEIGHTS.x, RELIEF_AIR_HEIGHTS.y, altitude));
  vec3 kept = exp(-depth * RELIEF_AIR_SPREAD);
  vec3 scatter = mix(blue, horizon, 1.0 - exp(-depth));
  return color * kept + scatter * (1.0 - kept);
}

void main() {
  #include <logdepthbuf_fragment>
  #ifndef USE_LOGARITHMIC_DEPTH_BUFFER
  gl_FragDepth = gl_FragCoord.z;
  #endif

  vec3 toPoint = vReliefWorld - cameraPosition;
  float dist = length(toPoint);
  vec3 dir = toPoint / max(dist, 1e-6);
  float blend = max(uSkyHorizonBlend, fwidth(dot(dir, uSkyUp)));

  // The slope from the map, as finely as the pixel sees it.
  vec2 xz = vReliefPlane;
  float footprint = max(length(fwidth(xz)), uReliefMapFrame.z);
  float lod = min(log2(footprint / uReliefMapFrame.z), uReliefMapFrame.w);
  float bed = -uSkyOceanDepth;
  float margin = 1.5 * footprint;
  float west = reliefGround(xz - vec2(footprint, 0.0), lod, margin, bed).x;
  float east = reliefGround(xz + vec2(footprint, 0.0), lod, margin, bed).x;
  float north = reliefGround(xz - vec2(0.0, footprint), lod, margin, bed).x;
  float south = reliefGround(xz + vec2(0.0, footprint), lod, margin, bed).x;
  vec3 normal = normalize(vec3(west - east, 2.0 * footprint, north - south));

  // Land or sea by the map at this pixel, not by the triangle: the coast follows the map.
  vec2 ground = reliefGround(xz, lod, margin, bed);
  float height = ground.x;
  bool under = height < 0.0;
  vec3 position = (viewMatrix * vec4(vReliefWorld, 1.0)).xyz;
  vec3 color = sceneBlinnPhong(reliefAlbedo(height, ground.y), under ? uSkyOceanBedSpecular : RELIEF_LAND_SPECULAR, under ? uSkyOceanBedShininess : RELIEF_LAND_SHININESS, uSkyOceanBedAmbient, position, normalize(mat3(viewMatrix) * normal));
  // The sky's own scale is applied to everything it draws, last; a lit surface keeps the scene's.
  color /= max(uSkyIntensity, 1e-4);

  // The triangles miss the curved sea by up to tens of metres, more the coarser they are
  // and the farther the camera is from the scene (the curve follows the view). So the map
  // decides which of the two shows: the seabed stays behind the sea, and where the sea
  // would be met over land there is none, so the land comes in front of it.
  float altitude = dot(cameraPosition, uSkyUp) - uSkyOceanLevel;
  bool water = uSkyOceanWater > 0.5;
  float sea = water && altitude > 0.0 ? skyOceanReach(cameraPosition, dir, altitude).x : 0.0;
  if(under && water) {
    // Through the water over it, from where the view enters it.
    color *= waterFogDim(-height, uSkyOceanFogDensity);
    float path = altitude > 0.0 ? max(dist - sea, 0.0) : skyOceanPathBelowSurface(cameraPosition, vReliefWorld);
    color = skyOceanFog(color, path, skyOceanLight(0.5 * (-height + max(-altitude, 0.0))));
    if(altitude > 0.0 && sea > dist)
      gl_FragDepth = reliefDepthAt(dir, sea * 1.0001);
  } else if(altitude > 0.0) {
    color = reliefThroughAir(color, dir, dist, blend, altitude);
    if(water && sea < dist && reliefGround((cameraPosition + dir * sea).xz, lod, margin, bed).x >= 0.0)
      gl_FragDepth = reliefDepthAt(dir, sea * 0.9999);
  }

  gl_FragColor = vec4(color, 1.0);
  gl_FragColor.rgb = skyDebugTint(gl_FragColor.rgb, vec3(0.95, 0.6, 0.1));
  gl_FragColor.rgb *= uSkyIntensity;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // Once the derivatives above are taken.
  if(reliefInArea(xz))
    discard;
}
