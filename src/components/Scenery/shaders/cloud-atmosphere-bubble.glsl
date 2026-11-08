// What the clouds' bakes (cloud-atmosphere-bake.glsl) take in at a point of the atmosphere
// (sdk/weather/atmosphere.ts): the air's own condensate, moved by its moister and drier patches,
// and each bubble's (thermalBubbles, sdk/weather/thermal-field.ts) over it. Nothing here knows a
// kind of cloud: sheets, decks, puffs and towers come out of the atmosphere's table.
//
// Defines (from the bake's material): BAKE_SPREAD (THERMAL_SPREAD), BAKE_LOBES (SHEET_LOBES) and
// BAKE_LUMPS (SHEET_LUMPS), which the bubbles' reach on the CPU (bubbleReach) is bound to.

// atmosphereTable: ATMOSPHERE_LEVELS wide; rows of thermals from strength 0 to 1 by height
// (condensate g/kg, updraft m/s, most updraft m/s), the air's own by height (condensate g/kg,
// negative under saturation; water at saturation g/kg; stability 1/s), then the thermals' courses
// by time.
uniform sampler2D uAtmosphere;
// Its levels and its thermals' rows, and the metres between its levels.
uniform vec3 uAtmosphereSize;
// Half the domain's width (m), the slice drawn, how patchy the air's moisture is, and how far
// its moister and drier patches move its water (a share of its water at saturation, at
// patchiness 1: ATMOSPHERE_MOISTURE).
uniform vec4 uBakeDomain;
// The patches' map (patchesMap): the moisture's (r), repeating over uBakePatches.x (m); and how
// far the wind has carried them, per m of height over the mixed layer (east, north: m per m),
// and at it.
uniform sampler2D uBakePatchMap;
uniform vec4 uBakePatches;
uniform vec2 uBakeCarried;
// The top of the mixed layer (m): where the shear starts.
uniform float uBakeMixedTop;
// The inversion's height (m) and how far it swells up and down (m; 0: none, or no inversion).
uniform vec2 uBakeInversion;
// The bubbles (thermalBubbles): three texels each, BAKE_BUBBLE_ROW to a row: (east, north, height,
// row), (across, up, keep, radius unspread) and (its billows' place in the shape volume, how fresh
// it is).
uniform sampler2D uBakeBubbles;
uniform sampler3D uCloudShape;
// Curl noise (curlNoiseMap), a tile of it over a tile of the shape volume: what the billows are
// read through.
uniform sampler2D uBakeCurl;

#define BAKE_BUBBLE_ROW 256
// How far a bubble reaches, squared, in its radii: its billows move its edge by BAKE_BILLOWS at
// most (BUBBLE_REACH, thermal-field.ts).
#define BAKE_REACH 2.05
#define BAKE_BILLOWS 0.3
// A sheet's lumps: cells this many of its radii up across (the shape volume's broadest are a
// quarter of its side), some 2.5 times its thickness.
#define BAKE_CELLS 20.0
// How far the curl noise moves where the billows are read (shares of the shape volume's side:
// its broadest billows are a quarter), and how far past it as a bubble mixes away (frayed).
#define BAKE_CURL 0.06
#define BAKE_CURL_FRAYED 0.6
// The inversion's swells: cells some kilometres across (the metres a tile of the shape volume
// spans; its broadest features a quarter of it), eased out over this far above and below it (m).
#define BAKE_SWELL_TILE 4000.0
#define BAKE_SWELL_REACH 300.0

// The atmosphere's table at height `z` (m) and row `row` (no mipmaps: read at its level, so a loop
// of bubbles may read it).
vec4 bakeAtmosphere(float z, float row) {
  vec2 uv = vec2((z / uAtmosphereSize.z + 0.5) / uAtmosphereSize.x, (row + 0.5) / (2.0 * uAtmosphereSize.y + 1.0));
  return textureLod(uAtmosphere, uv, 0.0);
}

// The height (m) to read the atmosphere's table at for `xy`, `z` (m), baked `voxel` metres a
// texel across: near the inversion, shifted as it swells up and down in broad cells, drifting
// with the wind at it. The air's dryness over it caps the clouds under it along it, so their
// tops rise and fall with it rather than lie in one plane.
float bakeTableHeight(vec2 xy, float z, float voxel) {
  float near = 1.0 - smoothstep(0.0, BAKE_SWELL_REACH, abs(z - uBakeInversion.x));
  if(uBakeInversion.y <= 0.0 || near <= 0.0)
    return z;
  vec2 drifted = xy - uBakeCarried - uBakePatches.yz * max(uBakeInversion.x - uBakeMixedTop, 0.0);
  float lod = max(log2(voxel * 128.0 / BAKE_SWELL_TILE), 0.0);
  float swell = textureLod(uCloudShape, vec3(drifted / BAKE_SWELL_TILE, 0.29), lod).r;
  return z - uBakeInversion.y * near * clamp((swell - 0.736) / 0.188, -1.0, 1.0);
}

// The air's own at `xy` (m, about the middle), `z` up (m), its table read at `table` (m:
// bakeTableHeight): condensate where it is saturated, or how far it is from saturation
// (negative), moved by moister and drier patches of air some kilometres across, a share of its
// water at saturation: veils with holes, and where it is near saturation, patches raised into
// cloud. The patches drift with the wind at their height.
float bakeAir(vec2 xy, float z, float table) {
  vec4 air = bakeAtmosphere(table, uAtmosphereSize.y);
  vec2 drifted = xy - uBakeCarried - uBakePatches.yz * max(z - uBakeMixedTop, 0.0);
  float moisture = 2.0 * texture(uBakePatchMap, drifted / uBakePatches.x).r - 1.0;
  return air.r + uBakeDomain.w * uBakeDomain.z * moisture * air.g;
}

// What bubble `index` has of its water over the air's (`around`, g/kg) at `xy`, `z` (as bakeAir,
// its table read at `table`), eased to the air's own toward its edge, its edge moved by its
// billows; baked `voxel` metres a texel across. Rising, a bubble billows most on its upper side,
// its base kept flatter. Stopped and spread into a sheet, its outline swings out and in in broad
// lobes, its top and base rise and fall in cells (the rolls under a stratocumulus deck), and it
// thins toward its rim.
float bakeBubble(int index, vec2 xy, float z, float table, float around, float voxel) {
  ivec2 at = ivec2(3 * (index % BAKE_BUBBLE_ROW), index / BAKE_BUBBLE_ROW);
  vec4 where = texelFetch(uBakeBubbles, at, 0);
  vec4 size = texelFetch(uBakeBubbles, at + ivec2(1, 0), 0);
  // How far it has spread into a sheet (0 to 1), and whether it reaches here at its widest.
  float sheet = clamp((size.x / size.w - 1.0) / BAKE_SPREAD, 0.0, 1.0);
  vec2 rel = xy - where.xy;
  float rise = z - where.z;
  vec3 widest = vec3(rel / (size.x * (1.0 + BAKE_LOBES * sheet)), rise / (size.y * (1.0 + BAKE_LUMPS * sheet)));
  if(dot(widest, widest) >= BAKE_REACH)
    return 0.0;
  // Its parcel's water here over the air's about it: with none, no cloud of it here.
  float parcel = bakeAtmosphere(table, where.w).r;
  float over = parcel - around;
  if(parcel <= 0.0 || over <= 0.0)
    return 0.0;
  vec4 own = texelFetch(uBakeBubbles, at + ivec2(2, 0), 0);
  float across = size.x;
  float up = size.y;
  if(sheet > 0.0) {
    // Its lobes: two and three about it, turned by its own (own.xy, 0 to 8: an eighth a turn).
    float far = length(rel);
    vec2 c = far > 0.0 ? rel / far : vec2(1.0, 0.0);
    vec2 two = vec2(c.x * c.x - c.y * c.y, 2.0 * c.x * c.y);
    vec2 three = vec2(c.x * (4.0 * c.x * c.x - 3.0), c.y * (3.0 - 4.0 * c.y * c.y));
    float a = 0.7854 * own.x;
    float b = 0.7854 * own.y;
    float lobe = 0.6 * dot(two, vec2(cos(a), -sin(a))) + 0.4 * dot(three, vec2(cos(b), -sin(b)));
    across *= 1.0 + BAKE_LOBES * sheet * lobe;
    // Its lumps: its top's and its base's own, from the shape volume flat across.
    vec2 cell = rel / (BAKE_CELLS * size.y) + own.xy;
    float lumpLod = max(log2(voxel * 128.0 / (BAKE_CELLS * size.y)), 0.0);
    float lump = textureLod(uCloudShape, vec3(cell, rise > 0.0 ? own.z : own.z + 0.5), lumpLod).r;
    up *= 1.0 + BAKE_LUMPS * sheet * clamp((lump - 0.736) / 0.188, -1.0, 1.0);
  }
  vec3 off = vec3(rel / across, rise / up);
  float d2 = dot(off, off);
  if(d2 >= BAKE_REACH)
    return 0.0;
  // Its billows, at its own scale and half and a quarter of it, from its own place in the shape
  // volume (lobes on lobes), read through curl noise so they swirl, the more as it mixes away;
  // not where the bake's texels are too coarse to show the swirls, nor in a sheet, its lumps
  // its own. Its edge moves by BAKE_BILLOWS at most.
  vec3 place = vec3(rel, rise) / (1.2 * size.w) + own.xyz;
  float lod = max(log2(voxel * 128.0 / (1.2 * size.w)), 0.0);
  float swirl = BAKE_CURL * (1.0 + BAKE_CURL_FRAYED * (1.0 - own.w)) * (1.0 - smoothstep(4.0, 5.0, lod)) * (1.0 - sheet);
  if(swirl > 0.0) {
    vec4 plane = textureLod(uBakeCurl, place.xy, 0.0);
    vec4 upright = textureLod(uBakeCurl, place.yz + vec2(0.37, 0.71), 0.0);
    // The curl of one potential in the east-north plane, of another in the north-up plane: no
    // gathering or spreading in 3D either.
    place += swirl * vec3(plane.x, plane.y + upright.z, upright.w);
  }
  float lobes = 0.55 * textureLod(uCloudShape, place, lod).r + 0.3 * textureLod(uCloudShape, place * 2.03 + 0.37, lod + 1.0).r + 0.15 * textureLod(uCloudShape, place * 4.07 + 0.71, lod + 2.0).r;
  float billows = clamp((lobes - 0.736) / (0.094 * 0.645), -2.0, 2.0);
  float upward = off.z * inversesqrt(max(d2, 1e-6));
  float side = mix(mix(0.45, 1.3, smoothstep(-0.4, 0.8, upward)), 1.0, sheet);
  float depth = 0.15 * side * (0.7 + 0.3 * own.w);
  float d = sqrt(d2) * (1.0 - clamp(depth * billows, -BAKE_BILLOWS, BAKE_BILLOWS));
  if(d >= 1.0)
    return 0.0;
  float body = 1.0 - d * d;
  return over * size.z * body * mix(1.0, body, sheet);
}
