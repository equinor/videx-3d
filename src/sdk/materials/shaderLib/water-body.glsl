// What lies in a body of water, faded by it (WaterBody, applyWaterFog): the library's own
// materials and any patched by applyWaterFog read the same water as the sea over them, so
// data under the sea fades by its own path through it. One model with the sea's (water-fog.glsl).
#include ./water-fog.glsl

// xyz the world's up, w the surface's height along it.
uniform vec4 uWaterBody;
// x how far down the seabed lies under the surface (below it the ground, not water; 1e30 none),
// y the daylight (0 night, 1 day).
uniform vec2 uWaterBodyFloor;
// Per channel per world unit; nil, no water.
uniform vec3 uWaterBodyExtinction;
uniform vec3 uWaterBodyColor;

// `color` of what lies at `world`, seen from the camera through the water between: dimmed by
// the daylight its depth leaves it, then faded along the part of the sight line in the water
// (between the surface and the seabed), toward the water's colour lit half way down.
vec3 waterBodyFog(vec3 color, vec3 world) {
  vec3 extinction = uWaterBodyExtinction;
  if(dot(extinction, extinction) <= 0.0)
    return color;
  vec3 up = uWaterBody.xyz;
  float hCamera = dot(cameraPosition, up) - uWaterBody.w;
  float hPoint = dot(world, up) - uWaterBody.w;
  float depth = min(max(-hPoint, 0.0), uWaterBodyFloor.x);
  color *= waterFogDim(waterLitDepth(depth, extinction), extinction);
  float path = waterFogPath(hCamera, hPoint, distance(cameraPosition, world), -uWaterBodyFloor.x, 0.0);
  if(path <= 0.0)
    return color;
  float lit = 0.5 * (depth + min(max(-hCamera, 0.0), uWaterBodyFloor.x));
  vec3 light = waterFogLight(waterLitDepth(lit, extinction), extinction, uWaterBodyFloor.y);
  float facing = waterFacing(dot(normalize(world - cameraPosition), up), hCamera > 0.0);
  return waterFog(color, path, extinction, uWaterBodyColor, light, facing);
}
