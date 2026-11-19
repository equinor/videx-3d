// A body of water (WaterBody), as its surface, its walls and what lies in it read it. One model
// with every sea's (water-fog.glsl): seen from the air, the water a sight line crosses is drawn
// by what it enters the water by, the surface (waterBodySurfaceWater: the water down to the
// seabed under it) or a wall (the Ocean's walls, ocean-volume-material.ts); what lies in the
// water is only dimmed by the daylight its depth leaves it. From in the water, all of it fades
// by its own path through the water (waterBodyFog). Needs depth-map.glsl included before it,
// once: an include repeated is inlined again (vite-plugin-glsl), and warned of.
#include ./water-fog.glsl
#include ./ground-map.glsl

// xyz the world's up, w the surface's height along it.
uniform vec4 uWaterBody;
// x how far down the seabed lies under the surface where no bed map says (1e30 none),
// y the daylight (0 night, 1 day), z whether the camera is over the water's footprint and above
// its seabed (as its sea works it out: WaterBody.cameraOver), w unused.
uniform vec4 uWaterBodyFloor;
// Per channel per world unit; nil, no water.
uniform vec3 uWaterBodyExtinction;
uniform vec3 uWaterBodyColor;
// Where the water lies, world X and Z: min x, min z, max x, max z (x below -1e29: everywhere):
// what lies in this box under the surface is in the water.
uniform vec4 uWaterBodyExtent;
// The seabed's heights (depth-map.glsl's packing): from world X/Z through uWaterBodyBedToUv;
// uWaterBodyBedInfo xy its texels (0, none), z and w its height into the world's: z·h + w.
uniform sampler2D uWaterBodyBed;
uniform mat3 uWaterBodyBedToUv;
uniform vec4 uWaterBodyBedInfo;
// The scene's ground (ground-map.glsl) as the seabed where the bed's map does not cover: x 1
// while it does, y and z its height into the world's: y·h + z.
uniform vec4 uWaterBodyGround;

// How far down the seabed lies under the surface at `world`: the bed's map where it covers
// it, else the scene's ground where it does, else the flat floor.
float waterBodyFloorAt(vec3 world) {
  if(uWaterBodyBedInfo.x > 0.0) {
    float bedY;
    float covered = sampleDepthMap(uWaterBodyBed, uWaterBodyBedToUv, uWaterBodyBedInfo.xy, world.xz, bedY);
    if(covered > 0.5)
      return uWaterBody.w - (uWaterBodyBedInfo.z * bedY + uWaterBodyBedInfo.w);
  }
  if(uWaterBodyGround.x > 0.5) {
    float covered;
    float height = groundMapHeight(world, covered);
    if(covered > 0.5)
      return max(uWaterBody.w - (uWaterBodyGround.y * height + uWaterBodyGround.z), 0.0);
  }
  return uWaterBodyFloor.x;
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

// Whether `world` lies over the water: in its extent.
bool waterBodyOver(vec3 world) {
  vec2 inside = waterBodyInExtent(world, world);
  return inside.y >= inside.x;
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

// The water under the surface at `world`, seen from the air along `dir` (unit), as a layer
// (premultiplied) between what the surface reflects and what lies under it: down to the seabed
// under it, lit where the line gathers its light (water-fog.glsl's waterUnderSurface).
vec4 waterBodySurfaceWater(vec3 world, vec3 dir) {
  vec3 extinction = uWaterBodyExtinction;
  if(dot(extinction, extinction) <= 0.0)
    return vec4(0.0);
  float depth = min(waterBodyFloorAt(world), 1e6);
  float facing = dot(dir, uWaterBody.xyz);
  float path = waterPathDown(depth, facing);
  vec3 light = waterFogLight(waterLitDepth(waterLitAlong(0.0, depth, path, extinction), extinction), extinction, uWaterBodyFloor.y);
  return waterUnderSurface(path, facing, extinction, uWaterBodyColor, light);
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

// `color` of what lies at `world`, seen from the camera through the water between: only what
// lies in the water column (in the water's extent, between the surface and the seabed
// under it, or over the surface seen through it). It is dimmed by the daylight its depth leaves
// it; from in the water, it fades along the part of the sight line in the water too, toward
// the water's colour lit half way down. From the air, the surface or the walls it is seen
// through carry the water in front of it (waterBodySurfaceWater). What lies below the seabed,
// or beside the water, is drawn as it is: the ground hides it from the water.
vec3 waterBodyFog(vec3 color, vec3 world) {
  vec3 extinction = uWaterBodyExtinction;
  if(dot(extinction, extinction) <= 0.0)
    return color;
  float floorDepth = waterBodyFloorAt(world);
  float depth = uWaterBody.w - dot(world, uWaterBody.xyz);
  if(!waterBodyOver(world) || depth > floorDepth + 0.5)
    return color;
  depth = clamp(depth, 0.0, floorDepth);
  color *= waterFogDim(waterLitDepth(depth, extinction), extinction);
  if(!waterBodyCameraIn())
    return color;
  float path = waterBodyPath(world, floorDepth);
  if(path <= 0.0)
    return color;
  return waterFog(color, path, extinction, uWaterBodyColor, waterBodyLight(world, depth, floorDepth, path), waterBodyFacing(world));
}

// `color` of the seabed at `world`, seen through the water over it (waterBodyFog): taken at
// the seabed under it, no deeper, so a bed whose mesh and map differ a little is all under the
// water. For what IS the seabed (a column's top cap), not what lies below it.
vec3 waterBodyFogBed(vec3 color, vec3 world) {
  float floorDepth = waterBodyFloorAt(world);
  float below = uWaterBody.w - dot(world, uWaterBody.xyz) - floorDepth;
  return waterBodyFog(color, world + uWaterBody.xyz * max(below, 0.0));
}

// `color` of what lies at `world` in the water column, dimmed by the daylight its depth
// leaves it, whatever the camera sees it through: what stands for the seabed under a surface
// and walls that carry the water in front of it (a ChunkStack's top cap). Taken at the seabed
// under it, no deeper, as waterBodyFogBed. Where no water stands (beside it, or cut away),
// drawn as it is.
vec3 waterBodyDim(vec3 color, vec3 world) {
  vec3 extinction = uWaterBodyExtinction;
  if(dot(extinction, extinction) <= 0.0 || !waterBodyOver(world))
    return color;
  float floorDepth = waterBodyFloorAt(world);
  float depth = clamp(uWaterBody.w - dot(world, uWaterBody.xyz), 0.0, floorDepth);
  return color * waterFogDim(waterLitDepth(depth, extinction), extinction);
}
