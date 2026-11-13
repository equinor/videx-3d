// Fog through a body of water: one model for every sea the library draws (water-optics.ts,
// documents/water.md). A water is its colour (of water too deep to see through, linear) and its
// extinction per metre per channel (waterExtinctionOf). Heights are along the world's up, from
// the water surface.
#ifndef WATER_FOG_GLSL
#define WATER_FOG_GLSL

// The most optical depth the water's light, and what lies in the water, are dimmed by (the
// light falls to e^(−2), 13 %, of the surface's): deeper, they keep that much, so however deep
// the ground goes it stays dark blue but seen, rather than black. About 20 m down in a North
// Sea's water, 1000 m in clear.
#define WATER_DARKEST 4.0

// `depth` below the surface, no deeper than the water's light is taken (WATER_DARKEST).
float waterLitDepth(float depth, vec3 extinction) {
  return min(max(depth, 0.0), WATER_DARKEST / max(dot(extinction, vec3(1.0 / 3.0)), 1e-6));
}

// The depth the water's own light along a sight line `path` long, from `fromDepth` to `toDepth`,
// is taken at: where the line gathers it. Half way through clear water; in murky water, the
// first optical depth or so of it, so a long line gathers it near its start, deeper looking
// down and shallower looking up, and a view through the level of the eye has no seam.
float waterLitAlong(float fromDepth, float toDepth, float path, vec3 extinction) {
  float reach = path * dot(extinction, vec3(1.0 / 3.0));
  return mix(fromDepth, toDepth, clamp(0.5 / max(reach, 1e-6), 0.0, 0.5));
}

// How much of a segment `len` long, from height `ha` to height `hb`, lies between `bottom`
// and `top`.
float waterFogPath(float ha, float hb, float len, float bottom, float top) {
  float lo = min(ha, hb);
  float hi = max(ha, hb);
  if(hi - lo < 1e-6)
    return ha >= bottom && ha <= top ? len : 0.0;
  return max(min(hi, top) - max(lo, bottom), 0.0) / (hi - lo) * len;
}

// How much of what lies `dist` away through the water shows, per channel.
vec3 waterTransmittance(float dist, vec3 extinction) {
  return exp(-max(dist, 0.0) * extinction);
}

// Daylight left `depth` below the surface: the diffuse light falls at about half the
// extinction (waterDaylight).
vec3 waterFogDim(float depth, vec3 extinction) {
  return exp(-max(depth, 0.0) * 0.5 * extinction);
}

// The light the water itself carries `depth` down; night keeps a little, as the sky does.
vec3 waterFogLight(float depth, vec3 extinction, float daylight) {
  return waterFogDim(depth, extinction) * mix(0.15, 1.0, daylight);
}

// How bright the water's own light is, seen along a ray `facing` up (its cosine): the light
// from above, scattered toward the eye, is dimmest looking down (the water's colour, as seen
// from above), about three times as bright looking level and nine looking up.
#define WATER_GLOW 3.0
float waterGlow(float facing) {
  return pow(WATER_GLOW, 1.0 + clamp(facing, -1.0, 1.0));
}

// How far up (cosine) a sight line `facing` up runs on in the water: as it is from inside it;
// from the air bent down as it enters (Snell, n = 1.333), so it never runs flatter than
// about 41° below level.
float waterFacing(float facing, bool fromAir) {
  return fromAir ? -sqrt(1.0 - (1.0 - facing * facing) * 0.5628) : facing;
}

// `color` seen through `dist` of water along a ray `facing` up, fading toward the water's
// colour lit by `light` (waterGlow).
vec3 waterFog(vec3 color, float dist, vec3 extinction, vec3 waterColor, vec3 light, float facing) {
  vec3 shown = waterTransmittance(dist, extinction);
  return color * shown + waterColor * light * waterGlow(facing) * (1.0 - shown);
}

// waterFog as a layer: `layer` premultiplied, its alpha how much it hides of what lies behind
// it, so waterFog of what then shows is the result over that. What lies behind shows by the
// channels' mean.
vec4 waterFogOver(vec4 layer, float dist, vec3 extinction, vec3 waterColor, vec3 light, float facing) {
  vec3 shown = waterTransmittance(dist, extinction);
  float through = dot(shown, vec3(1.0 / 3.0));
  return vec4(layer.rgb * shown + waterColor * light * waterGlow(facing) * (1.0 - shown), 1.0 - (1.0 - layer.a) * through);
}

// The cutaway through the water in front of the view:
// everything nearer than a line across the view, `shape.x` ahead of `anchor` along
// `heading`, waved across it by `waveA` and `waveB` (amplitude, angular frequency, phase).
// `shape.y` is its scale (0: no cutaway), `shape.z` its edge's width.
struct WaterFogCutaway {
  vec3 anchor;
  vec3 heading;
  vec3 shape;
  vec3 waveA;
  vec3 waveB;
};

// How far `p` on the cutaway's plane lies beyond its edge, across it; negative inside.
float waterFogCutawayEdge(WaterFogCutaway cutaway, vec3 p, vec3 up) {
  vec3 d = p - cutaway.anchor;
  float ahead = dot(d, cutaway.heading);
  float side = dot(d, cross(cutaway.heading, up));
  vec3 a = cutaway.waveA;
  vec3 b = cutaway.waveB;
  float edge = cutaway.shape.x + a.x * sin(a.y * side + a.z) + b.x * sin(b.y * side + b.z);
  // Across: divided by the edge's slope there, to first order.
  float slope = a.x * a.y * cos(a.y * side + a.z) + b.x * b.y * cos(b.y * side + b.z);
  return (ahead - edge) / sqrt(1.0 + slope * slope);
}

// How much the cutaway covers `p` on its plane: 1 inside, 0 outside, easing over its edge.
float waterFogCutaway(WaterFogCutaway cutaway, vec3 p, vec3 up) {
  if(cutaway.shape.y <= 0.0)
    return 0.0;
  return 1.0 - smoothstep(-cutaway.shape.z, 0.0, waterFogCutawayEdge(cutaway, p, up));
}

// Where a sight line from `a` through `b` meets the cutaway's plane, level with its `anchor`:
// before or past `b`. False where the line never comes down to it.
bool waterFogCutawayPoint(vec3 a, vec3 b, vec3 anchor, vec3 up, out vec3 point) {
  float level = dot(anchor, up);
  float ha = dot(a, up) - level;
  float hb = dot(b, up) - level;
  point = a;
  if(ha <= 0.0 || hb >= ha)
    return false;
  point = a + (b - a) * (ha / (ha - hb));
  return true;
}

// How much the cutaway covers a sight line from `a` through `b` (see waterFogCutawayPoint).
float waterFogCutawayAlong(WaterFogCutaway cutaway, vec3 a, vec3 b, vec3 up) {
  vec3 point;
  return waterFogCutawayPoint(a, b, cutaway.anchor, up, point) ? waterFogCutaway(cutaway, point, up) : 0.0;
}

// How far a ray from `origin` inside the cutaway runs along `dir` before it crosses the wall
// standing on its edge: 0 where `origin` lies beyond it or there is no cutaway, 1e30 where
// the ray heads away from it.
float waterFogCutawayWall(WaterFogCutaway cutaway, vec3 origin, vec3 dir, vec3 up) {
  if(cutaway.shape.y <= 0.0 || waterFogCutawayEdge(cutaway, origin, up) >= 0.0)
    return 0.0;
  float along = dot(dir, cutaway.heading);
  if(along <= 1e-6)
    return 1e30;
  // Between the reaches of the edge's waves, by bisection.
  float ahead = dot(origin - cutaway.anchor, cutaway.heading);
  float swing = abs(cutaway.waveA.x) + abs(cutaway.waveB.x);
  float lo = max(cutaway.shape.x - swing - ahead, 0.0) / along;
  float hi = (cutaway.shape.x + swing - ahead) / along;
  for(int i = 0; i < 10; i++) {
    float mid = 0.5 * (lo + hi);
    if(waterFogCutawayEdge(cutaway, origin + dir * mid, up) < 0.0)
      lo = mid;
    else
      hi = mid;
  }
  return hi;
}

#endif
