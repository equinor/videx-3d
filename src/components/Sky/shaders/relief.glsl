// A stage's relief (SkyBoxStage `relief`): the ground's height from its map, which holds it
// times its coverage and the coverage, eased into the stage's flat seabed around the
// stage's own area. Shared by the relief's vertex and fragment shaders.

uniform sampler2D uReliefMap;
uniform vec4 uReliefMapFrame; // scene X/Z of texel (0, 0), the scene units between texels, and the last mip level
uniform vec2 uReliefMapSize; // texels
uniform vec4 uReliefArea; // the stage's own area, min X/Z and max X/Z, which the relief leaves to it
uniform float uReliefFalloff; // how far past that area the relief rises from the flat seabed

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

// How much the relief shows at `xz`: none within `margin` of the stage's area, then rising
// to all of it over the falloff.
float reliefEase(vec2 xz, float margin) {
  vec2 outside = max(max(uReliefArea.xy - xz, xz - uReliefArea.zw), 0.0);
  return smoothstep(margin, margin + uReliefFalloff, length(outside));
}

// The ground's height over the sea at `xz`, and how much of it is the relief's: the rest is
// the flat seabed `bed` (over the sea, so negative).
vec2 reliefGround(vec2 xz, float lod, float margin, float bed) {
  vec2 relief = reliefSample(xz, lod);
  float weight = relief.y * reliefEase(xz, margin);
  return vec2(mix(bed, relief.x, weight), weight);
}

bool reliefInArea(vec2 xz) {
  return all(greaterThan(xz, uReliefArea.xy)) && all(lessThan(xz, uReliefArea.zw));
}
