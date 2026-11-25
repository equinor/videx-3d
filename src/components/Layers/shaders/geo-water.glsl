// Something lying in a Scenery's sea seen as its seabed is (the relief's own water,
// relief-fragment.glsl): include after scenery.glsl, compiled with the sky's defines.

// `color` (linear, the layer's own) at `world`, `height` metres over the sea, seen from the
// camera: dimmed by the daylight its depth leaves it; from above, the sea's surface carries the
// water in front of it (scenerySeaWaterUnder); from in the water, through the water between. Where the cutaway takes the seabed it takes this too: `alpha` with it. And under
// what the background draws of the sea — its surface, its seabed, or either past the Earth's
// curve — `alpha` takes its cover (scenerySeaCover): the background lies on the far plane and
// hides nothing by depth, so past a stage, and past the far plane, it hides it here.
vec3 geoThroughWater(vec3 color, inout float alpha, vec3 world, float height) {
  alpha *= 1.0 - scenerySeaCover(world, height);
  float altitude = scenerySeaCameraAltitude();
  if(uScenerySeaWater < 0.5 || (height >= 0.0 && altitude > 0.0))
    return color;
  vec3 toPoint = world - cameraPosition;
  float dist = length(toPoint);
  vec3 dir = toPoint / max(dist, 1e-6);
  float cutaway = scenerySeaCutawayAlong(cameraPosition, world);
  if(height < 0.0)
    alpha *= scenerySeaCutawaySeabed(cutaway);
  // In the sky's own scale, as the relief's colour is.
  color /= max(uSceneryIntensity, 1e-4);
  color *= scenerySeaDim(-height);
  if(altitude <= 0.0) {
    float path = scenerySeaCutawayPath(scenerySeaPathBelowSurface(cameraPosition, world), scenerySeaCutawayWall(cameraPosition, dir), scenerySeaCutawayWater(cutaway));
    color = scenerySeaFog(color, path, scenerySeaLightAlong(-altitude, max(-height, 0.0), path), dir);
  }
  return color * uSceneryIntensity;
}
