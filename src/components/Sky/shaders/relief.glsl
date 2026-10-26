// A stage's relief overview (SkyBoxStage `relief`, past the tiles, RELIEF_FAR): the
// ground's height from a map of the relief's first layer in longitude and latitude, which
// holds it times its coverage and the coverage.

uniform sampler2D uReliefMap;
// Longitude and latitude (degrees) of texel (0, 0), and the degrees between texels along each.
uniform vec4 uReliefMapFrame;
// Texels along longitude and latitude, the last mip level, and 1 where it goes all the way round.
uniform vec4 uReliefMapSize;

// The relief's height over the sea at `geo` (longitude and latitude, degrees), read at mip
// level `lod`, and how much of it the map holds there: none beyond the map, fading out
// over its last texels; east and west too unless it goes all the way round.
vec2 reliefSample(vec2 geo, float lod) {
  vec2 texel = (geo - uReliefMapFrame.xy) / uReliefMapFrame.zw + 0.5;
  bool wraps = uReliefMapSize.w > 0.5;
  if(wraps)
    texel.x -= uReliefMapSize.x * floor(texel.x / uReliefMapSize.x);
  vec2 edge = min(texel, uReliefMapSize.xy - texel);
  float inside = smoothstep(0.5, 2.5, wraps ? edge.y : min(edge.x, edge.y));
  if(inside <= 0.0)
    return vec2(0.0);
  vec2 map = textureLod(uReliefMap, texel / uReliefMapSize.xy, lod).rg;
  return vec2(map.y > 1e-4 ? map.x / map.y : 0.0, map.y * inside);
}

// The ground's height over the sea at `geo`, and how much of it is the relief's: the rest
// is the flat seabed `bed` (over the sea, so negative).
vec2 reliefGround(vec2 geo, float lod, float bed) {
  vec2 relief = reliefSample(geo, lod);
  return vec2(mix(bed, relief.x, relief.y), relief.y);
}