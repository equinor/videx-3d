// A stage's relief overview (SceneryStage `relief`, past the tiles, RELIEF_FAR): the
// ground's height from maps of the relief's layers in longitude and latitude, each holding
// it times its weight and the weight (its coverage, faded in over the layer's feather),
// merged in turn as the tiles merge them. RELIEF_FAR_LAYERS of them, at most six
// (SCENERY_RELIEF_FAR_MAX_LAYERS): each is a texture unit, and samplers cannot be indexed
// by a loop's counter.

uniform sampler2D uReliefMap0;
#if RELIEF_FAR_LAYERS > 1
uniform sampler2D uReliefMap1;
#endif
#if RELIEF_FAR_LAYERS > 2
uniform sampler2D uReliefMap2;
#endif
#if RELIEF_FAR_LAYERS > 3
uniform sampler2D uReliefMap3;
#endif
#if RELIEF_FAR_LAYERS > 4
uniform sampler2D uReliefMap4;
#endif
#if RELIEF_FAR_LAYERS > 5
uniform sampler2D uReliefMap5;
#endif
// Per layer: longitude and latitude (degrees) of texel (0, 0), and the degrees between
// texels along each.
uniform vec4 uReliefMapFrames[RELIEF_FAR_LAYERS];
// Per layer: texels along longitude and latitude, the last mip level, and 1 where it goes
// all the way round.
uniform vec4 uReliefMapSizes[RELIEF_FAR_LAYERS];

// Per layer: its look, 1 + its index in the relief (the tiles' numbering).
uniform float uReliefMapLooks[RELIEF_FAR_LAYERS];
// The height where no layer has data, metres over the sea (the tiles' base).
uniform float uReliefBase;

// Where `geo` (longitude and latitude, degrees) lies on a layer's map, in texels.
vec2 reliefMapTexel(vec2 geo, vec4 frame, vec4 size) {
  vec2 texel = (geo - frame.xy) / frame.zw + 0.5;
  if(size.w > 0.5)
    texel.x -= size.x * floor(texel.x / size.x);
  return texel;
}

// How much of a layer's map is in at `texel`: none beyond it, fading out over its last
// texels; east and west too unless it goes all the way round.
float reliefMapInside(vec2 texel, vec4 size) {
  vec2 edge = min(texel, size.xy - texel);
  return smoothstep(0.5, 2.5, size.w > 0.5 ? edge.y : min(edge.x, edge.y));
}

// The degrees north–south between the texels of the finest map at `geo`: the finest the
// ground there is held.
float reliefMapCell(vec2 geo) {
  float cell = 180.0;
  for(int i = 0; i < RELIEF_FAR_LAYERS; i++) {
    vec4 size = uReliefMapSizes[i];
    if(reliefMapInside(reliefMapTexel(geo, uReliefMapFrames[i], size), size) > 0.0)
      cell = min(cell, uReliefMapFrames[i].w);
  }
  return cell;
}

// A layer's height over the sea at `geo` and its weight there, read at the mip level a
// pixel `span` degrees east and north wide sees: none beyond its map, fading out over its
// last texels.
vec2 reliefSample(sampler2D map, vec4 frame, vec4 size, vec2 geo, vec2 span) {
  vec2 texel = reliefMapTexel(geo, frame, size);
  float inside = reliefMapInside(texel, size);
  if(inside <= 0.0)
    return vec2(0.0);
  float lod = clamp(log2(max(span.x / frame.z, span.y / frame.w)), 0.0, size.z);
  vec2 sampled = textureLod(map, texel / size.xy, lod).rg;
  return vec2(sampled.y > 1e-4 ? sampled.x / sampled.y : 0.0, sampled.y * inside);
}

// Layer `i` merged over the ground as the tiles merge it: eased toward it by its weight;
// its look where it gives more than half, as a tile's node takes it.
#define RELIEF_FAR_MERGE(map, i) { \
  vec2 layer = reliefSample(map, uReliefMapFrames[i], uReliefMapSizes[i], geo, span); \
  ground.x = mix(ground.x, layer.x, layer.y); \
  ground.y += (1.0 - ground.y) * layer.y; \
  if(layer.y > 0.5) ground.z = uReliefMapLooks[i]; \
}

// The ground at `geo` (longitude and latitude, degrees), seen by a pixel `span` degrees
// east and north wide: its height over the sea, from the base (uReliefBase) where no layer
// has data; how much of it is the relief's; and the look of the layer that gave it (0 for
// the relief's own, 1 + i for its layer i's).
vec3 reliefGround(vec2 geo, vec2 span) {
  vec3 ground = vec3(uReliefBase, 0.0, 0.0);
  RELIEF_FAR_MERGE(uReliefMap0, 0)
  #if RELIEF_FAR_LAYERS > 1
  RELIEF_FAR_MERGE(uReliefMap1, 1)
  #endif
  #if RELIEF_FAR_LAYERS > 2
  RELIEF_FAR_MERGE(uReliefMap2, 2)
  #endif
  #if RELIEF_FAR_LAYERS > 3
  RELIEF_FAR_MERGE(uReliefMap3, 3)
  #endif
  #if RELIEF_FAR_LAYERS > 4
  RELIEF_FAR_MERGE(uReliefMap4, 4)
  #endif
  #if RELIEF_FAR_LAYERS > 5
  RELIEF_FAR_MERGE(uReliefMap5, 5)
  #endif
  return ground;
}