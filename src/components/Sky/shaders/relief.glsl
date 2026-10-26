// A stage's relief overview (SkyBoxStage `relief`, past the tiles, RELIEF_FAR): the
// ground's height from a map of the relief's first layer, which holds it times its
// coverage and the coverage.

uniform sampler2D uReliefMap;
uniform vec4 uReliefMapFrame; // scene X/Z of texel (0, 0), the scene units between texels, and the last mip level
uniform vec2 uReliefMapSize; // texels

// The relief's height over the sea at scene `xz`, read at mip level `lod`, and how much of
// it the map holds there: none beyond the map, fading out over its last texels.
vec2 reliefSample(vec2 xz, float lod) {
  vec2 texel = (xz - uReliefMapFrame.xy) / uReliefMapFrame.z + 0.5;
  vec2 edge = min(texel, uReliefMapSize - texel);
  float inside = smoothstep(0.5, 2.5, min(edge.x, edge.y));
  if(inside <= 0.0)
    return vec2(0.0);
  vec2 map = textureLod(uReliefMap, texel / uReliefMapSize, lod).rg;
  return vec2(map.y > 1e-4 ? map.x / map.y : 0.0, map.y * inside);
}

// The ground's height over the sea at `xz`, and how much of it is the relief's: the rest is
// the flat seabed `bed` (over the sea, so negative).
vec2 reliefGround(vec2 xz, float lod, float bed) {
  vec2 relief = reliefSample(xz, lod);
  return vec2(mix(bed, relief.x, relief.y), relief.y);
}