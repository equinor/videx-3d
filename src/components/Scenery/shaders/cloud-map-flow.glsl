// The weather systems' wind and pressure over the whole Earth (scenery-cloud-map.ts): the first
// of the cloud map's two passes, small (a texel some 80 km), which the second traces the air
// back through (cloud-map.glsl). Fixed on the Earth, z toward the north pole. Over the ground
// (uMapTerrainOn) the wind is steered by it: slowed over land, and what of
// it would blow up high, steep ground turned along it, so the air the second pass traces flows
// round the mountain ranges and the fronts bend about them.
//
// The pressure: the climate's by latitude (subtropical highs, subpolar lows, the equatorial
// trough, the polar highs), each weather system's (WeatherSystemCentre: a Gaussian about its
// centre, summed over all of them, so it is smooth everywhere), and broad meanders. The wind
// blows along the isobars (geostrophic: anticlockwise about lows in the north, clockwise in the
// south), fading toward the equator, where the trade winds blow from the east instead.
//
// xyz: the wind, fixed on the Earth, in radians a trace step (FLOW_SCALE); w: the pressure.

#include ./cloud-map-noise.glsl

// Each weather system: xyz its centre (unit) times its radius (radians), w its pressure.
uniform vec4 uMapSystems[MAP_SYSTEMS];
uniform int uMapSystemCount;
// The ground (scenery-cloud-terrain.ts), while uMapTerrainOn: its height over the sea (r, metres;
// the sea's level under the sea) and its slope east and north (g, b).
uniform samplerCube uMapTerrain;
uniform float uMapTerrainOn;

// The wind's scale: radians a trace step per unit of the pressure's gradient (per radian), and
// the most a step may take. About a low's centre the air turns some 0.25 rad a step, so it winds
// round once over the trace (cloud-map.glsl's MAP_TRACE): more, and its moisture winds into
// rings like a target's.
#define FLOW_SCALE 0.0018
#define FLOW_MOST 0.02
// The most the air turns about a low's centre a step (radians).
#define FLOW_TURN 0.12
// How far the Coriolis effect's fall toward the equator is held off (sin of latitude).
#define FLOW_EQUATOR 0.2
// The ground, read at the level of some 80 km (a texel of this pass): the share of the wind it
// slows over land (land from x to y metres high); and how much of what blows up it is turned
// along it, from none to all as the ground goes from z to w metres high and as its slope goes
// from FLOW_STEEP.x to y.
#define FLOW_GROUND_LOD 2.0
#define FLOW_FRICTION 0.3
#define FLOW_BLOCK vec4(20.0, 250.0, 300.0, 1500.0)
#define FLOW_STEEP vec2(0.004, 0.025)

// The climate's pressure at `latitude` (degrees).
float flowClimate(float latitude) {
  float away = abs(latitude);
  return 0.6 * exp(-mapSquare((away - 30.0) / 9.0)) - 0.7 * exp(-mapSquare((away - 60.0) / 10.0)) - 0.45 * exp(-mapSquare((latitude - 6.0) / 6.0)) + 0.35 * smoothstep(70.0, 88.0, away);
}

float flowPressure(vec3 d) {
  float latitude = degrees(asin(clamp(d.z, -1.0, 1.0)));
  float p = flowClimate(latitude) + 0.12 * mapFbm(d * 2.2, 3, 30u);
  for(int i = 0; i < MAP_SYSTEMS; i++) {
    if(i >= uMapSystemCount)
      break;
    vec4 system = uMapSystems[i];
    float radius = length(system.xyz);
    float x = length(d - system.xyz / radius) / radius;
    if(x < 3.5)
      p += system.w * exp(-x * x);
  }
  return p;
}

void main() {
  float latitude;
  vec3 d = mapPlace(latitude);
  vec3 east;
  vec3 north;
  mapTangents(d, east, north);

  // The pressure's gradient (per radian), from either side some 25 km off.
  float h = 0.004;
  float p = flowPressure(d);
  vec3 gradient = east * (flowPressure(normalize(d + east * h)) - flowPressure(normalize(d - east * h))) +
    north * (flowPressure(normalize(d + north * h)) - flowPressure(normalize(d - north * h)));
  gradient /= 2.0 * h;

  // Along the isobars, low pressure on the left in the north, on the right in the south.
  float s = sin(radians(latitude));
  float coriolis = s / (s * s + FLOW_EQUATOR * FLOW_EQUATOR);
  vec3 wind = cross(d, gradient) * coriolis;
  // The trade winds, from the east, and drawn toward the equatorial trough.
  float trades = exp(-mapSquare((abs(latitude) - 13.0) / 9.0));
  wind += -east * 1.6 * trades - north * 0.5 * sign(latitude - 6.0) * exp(-mapSquare((abs(latitude - 6.0) - 7.0) / 6.0));
  wind *= FLOW_SCALE;
  // Steered by the ground: slower over land, and what would blow up high, steep ground turned
  // along it (its part up the slope taken away), so the air goes round the ranges.
  if(uMapTerrainOn > 0.5) {
    vec4 ground = textureLod(uMapTerrain, d, FLOW_GROUND_LOD);
    wind *= 1.0 - FLOW_FRICTION * smoothstep(FLOW_BLOCK.x, FLOW_BLOCK.y, ground.r);
    vec3 slope = east * ground.g + north * ground.b;
    float steep = length(slope);
    if(steep > 1e-6) {
      vec3 uphill = slope / steep;
      float into = dot(wind, uphill);
      if(into > 0.0)
        wind -= uphill * into * smoothstep(FLOW_BLOCK.z, FLOW_BLOCK.w, ground.r) * smoothstep(FLOW_STEEP.x, FLOW_STEEP.y, steep);
    }
  }
  // About a low's centre the air turns no faster than FLOW_TURN a step, as a solid body: the
  // small, deep lows of the tropics wound their moisture into rings otherwise.
  float nearest = 1e9;
  for(int i = 0; i < MAP_SYSTEMS; i++) {
    if(i >= uMapSystemCount)
      break;
    vec4 system = uMapSystems[i];
    if(system.w < 0.0)
      nearest = min(nearest, length(d - normalize(system.xyz)));
  }
  float speed = length(wind);
  float most = min(FLOW_MOST, FLOW_TURN * nearest);
  if(speed > most)
    wind *= most / speed;

  gl_FragColor = vec4(wind, p);
}
