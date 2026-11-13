// What lies in a body of water, faded by it (WaterBody, applyWaterFog): the library's own
// materials and any patched by applyWaterFog read the same water as the sea over them, so
// data under the sea fades by its own path through it. One model with the sea's (water-fog.glsl).
#include ./water-fog.glsl
#include ./depth-map.glsl

// xyz the world's up, w the surface's height along it.
uniform vec4 uWaterBody;
// x how far down the seabed lies under the surface where no bed map says (1e30 none),
// y the daylight (0 night, 1 day), z whether the camera is over the water's footprint (as its
// sea works it out: WaterBody.cameraOver), w whether a footprint texture says where in the
// extent the water lies.
uniform vec4 uWaterBodyFloor;
// Per channel per world unit; nil, no water.
uniform vec3 uWaterBodyExtinction;
uniform vec3 uWaterBodyColor;
// Where the water lies, world X and Z: min x, min z, max x, max z (x below -1e29: everywhere).
uniform vec4 uWaterBodyExtent;
// The seabed's heights (depth-map.glsl's packing): from world X/Z through uWaterBodyBedToUv;
// uWaterBodyBedInfo xy its texels (0, none), z and w its height into the world's: z·h + w.
uniform sampler2D uWaterBodyBed;
uniform mat3 uWaterBodyBedToUv;
uniform vec4 uWaterBodyBedInfo;
// Where in the extent the water lies (WaterBody.setFootprint), while uWaterBodyFloor.w: the
// signed distance to its outline (positive over the water), from world X/Z through
// uWaterBodyFootprintToUv. Read at a point only: what lies in the water column
// (waterBodyOver). A sight line's part in the water is taken over the extent's box.
uniform sampler2D uWaterBodyFootprint;
uniform mat3 uWaterBodyFootprintToUv;

// How far down the seabed lies under the surface at `world`: the bed's map where it covers
// it, else the flat floor.
float waterBodyFloorAt(vec3 world) {
  float depth = uWaterBodyFloor.x;
  if(uWaterBodyBedInfo.x > 0.0) {
    float bedY;
    float covered = sampleDepthMap(uWaterBodyBed, uWaterBodyBedToUv, uWaterBodyBedInfo.xy, world.xz, bedY);
    if(covered > 0.5)
      depth = uWaterBody.w - (uWaterBodyBedInfo.z * bedY + uWaterBodyBedInfo.w);
  }
  return depth;
}

// The part of the segment from `a` to `b` (as shares of it) that lies over the water's extent.
vec2 waterBodyInExtent(vec3 a, vec3 b) {
  vec2 range = vec2(0.0, 1.0);
  if(uWaterBodyExtent.x < -1e29)
    return range;
  vec2 d = b.xz - a.xz;
  for(int i = 0; i < 2; i++) {
    float o = a.xz[i];
    float lo = uWaterBodyExtent[i];
    float hi = uWaterBodyExtent[i + 2];
    if(abs(d[i]) < 1e-6) {
      if(o < lo || o > hi)
        return vec2(1.0, 0.0);
    } else {
      float ta = (lo - o) / d[i];
      float tb = (hi - o) / d[i];
      range = vec2(max(range.x, min(ta, tb)), min(range.y, max(ta, tb)));
    }
  }
  return range;
}

// How much of the sight line from the camera to `world` runs through the water: over its
// extent, between the surface and a seabed `floorDepth` down.
float waterBodyPath(vec3 world, float floorDepth) {
  vec2 range = waterBodyInExtent(cameraPosition, world);
  if(range.y <= range.x)
    return 0.0;
  vec3 a = mix(cameraPosition, world, range.x);
  vec3 b = mix(cameraPosition, world, range.y);
  vec3 up = uWaterBody.xyz;
  return waterFogPath(dot(a, up) - uWaterBody.w, dot(b, up) - uWaterBody.w, distance(a, b), -floorDepth, 0.0);
}

// Whether the camera is in the water: under the surface, over its footprint (as its sea works
// it out on the CPU, exactly: uWaterBodyFloor.z), above the seabed. Beside a water box, below
// its surface's height, it is in air.
bool waterBodyCameraIn() {
  float depth = uWaterBody.w - dot(cameraPosition, uWaterBody.xyz);
  return depth > 0.0 && uWaterBodyFloor.z > 0.5 && depth < waterBodyFloorAt(cameraPosition);
}

// Whether `world` lies over the water: in its extent, and where a footprint says so (the side
// of its outline it lies on).
bool waterBodyOver(vec3 world) {
  vec2 inside = waterBodyInExtent(world, world);
  if(inside.y < inside.x)
    return false;
  if(uWaterBodyFloor.w < 0.5)
    return true;
  vec2 uv = (uWaterBodyFootprintToUv * vec3(world.xz, 1.0)).xy;
  return texture2D(uWaterBodyFootprint, uv).r > 0.0;
}

// The light the water carries along a sight line `path` long to `world`, a point `depth` down:
// taken where the line gathers it (waterLitAlong), from where it enters the water.
vec3 waterBodyLight(vec3 world, float depth, float floorDepth, float path) {
  vec2 range = waterBodyInExtent(cameraPosition, world);
  vec3 entry = mix(cameraPosition, world, clamp(range.x, 0.0, 1.0));
  float from = clamp(uWaterBody.w - dot(entry, uWaterBody.xyz), 0.0, floorDepth);
  return waterFogLight(waterLitDepth(waterLitAlong(from, depth, path, uWaterBodyExtinction), uWaterBodyExtinction), uWaterBodyExtinction, uWaterBodyFloor.y);
}

// How far up a sight line to `world` runs on in the water (waterFacing): bent down where it
// enters from the air.
float waterBodyFacing(vec3 world) {
  return waterFacing(dot(normalize(world - cameraPosition), uWaterBody.xyz), !waterBodyCameraIn());
}

// The water along the sight line from the camera to `world`, as a layer over what lies beyond
// it (premultiplied): the part of the line in the water, its own light lit half way down.
// What a wall of the water body stands for.
vec4 waterBodyLayer(vec3 world) {
  float floorDepth = waterBodyFloorAt(world);
  float depth = clamp(uWaterBody.w - dot(world, uWaterBody.xyz), 0.0, floorDepth);
  float path = waterBodyPath(world, floorDepth);
  return waterFogOver(vec4(0.0), path, uWaterBodyExtinction, uWaterBodyColor, waterBodyLight(world, depth, floorDepth, path), waterBodyFacing(world));
}

// The water's own colour, as deep water seen along a sight line `facing` up (its cosine) from
// a camera `fromAir` or in the water: lit where the line gathers its light, near the camera.
vec3 waterBodyDeep(float facing, bool fromAir) {
  vec3 extinction = uWaterBodyExtinction;
  float camera = max(uWaterBody.w - dot(cameraPosition, uWaterBody.xyz), 0.0);
  vec3 light = waterFogLight(waterLitDepth(camera, extinction), extinction, uWaterBodyFloor.y);
  return uWaterBodyColor * light * waterGlow(waterFacing(facing, fromAir));
}

// The world position of a fragment from its view-space position as the OIT chunk has it
// (vViewPosition, the negated view position), so a material needs no varying of its own.
vec3 waterBodyWorldOf(vec3 viewPosition) {
  return cameraPosition - transpose(mat3(viewMatrix)) * viewPosition;
}

// `color` of what lies at `world`, seen from the camera through the water between. What lies
// in the water column (over the water's extent, between the surface and the seabed under it)
// is dimmed by the daylight its depth leaves it; below the seabed it is lit as it is drawn.
// Either way it fades along the part of the sight line in the water (down to the seabed under
// it), toward the water's colour lit half way down.
vec3 waterBodyFog(vec3 color, vec3 world) {
  vec3 extinction = uWaterBodyExtinction;
  if(dot(extinction, extinction) <= 0.0)
    return color;
  float floorDepth = waterBodyFloorAt(world);
  float depth = uWaterBody.w - dot(world, uWaterBody.xyz);
  bool inColumn = waterBodyOver(world) && depth <= floorDepth + 0.5;
  depth = clamp(depth, 0.0, floorDepth);
  if(inColumn)
    color *= waterFogDim(waterLitDepth(depth, extinction), extinction);
  float path = waterBodyPath(world, floorDepth);
  if(path <= 0.0)
    return color;
  return waterFog(color, path, extinction, uWaterBodyColor, waterBodyLight(world, depth, floorDepth, path), waterBodyFacing(world));
}
