// Something lying in a Scenery's sea seen as its seabed is (the relief's own water,
// relief-fragment.glsl): include after sky.glsl, compiled with the sky's defines.

// `color` (linear, the layer's own) at `world`, `height` metres over the sea, seen from the
// camera: from above, through the water over it; from in the water, through the water
// between. Where the cutaway takes the seabed it takes this too: `alpha` with it.
vec3 geoThroughWater(vec3 color, inout float alpha, vec3 world, float height) {
  float altitude = skyOceanCameraAltitude();
  if(uSkyOceanWater < 0.5 || (height >= 0.0 && altitude > 0.0))
    return color;
  vec3 toPoint = world - cameraPosition;
  float dist = length(toPoint);
  vec3 dir = toPoint / max(dist, 1e-6);
  float cutaway = skyOceanCutawayAlong(cameraPosition, world);
  if(height < 0.0)
    alpha *= skyOceanCutawaySeabed(cutaway);
  // In the sky's own scale, as the relief's colour is.
  color /= max(uSkyIntensity, 1e-4);
  color *= waterFogDim(max(-height, 0.0), uSkyOceanFogDensity);
  float sea = altitude > 0.0 ? skyOceanReach(cameraPosition, dir, altitude).x : 0.0;
  float below = altitude > 0.0 ? max(dist - sea, 0.0) : skyOceanPathBelowSurface(cameraPosition, world);
  float path = skyOceanCutawayPath(below, skyOceanCutawayWall(cameraPosition, dir), skyOceanCutawayWater(cutaway));
  color = skyOceanFog(color, path, skyOceanLight(0.5 * (max(-height, 0.0) + max(-altitude, 0.0))));
  return color * uSkyIntensity;
}
