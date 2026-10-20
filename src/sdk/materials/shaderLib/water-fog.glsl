// Fog through a body of water, as the Sky's sea draws it. Heights are along the world's
// up, from the water surface.

// How much of a segment `len` long, from height `ha` to height `hb`, lies between `bottom`
// and `top`.
float waterFogPath(float ha, float hb, float len, float bottom, float top) {
  float lo = min(ha, hb);
  float hi = max(ha, hb);
  if(hi - lo < 1e-6)
    return ha >= bottom && ha <= top ? len : 0.0;
  return max(min(hi, top) - max(lo, bottom), 0.0) / (hi - lo) * len;
}

// Daylight left `depth` below the surface.
float waterFogDim(float depth, float density) {
  return exp(-max(depth, 0.0) * density * 0.5);
}

// The light the water itself carries `depth` down; night keeps a little, as the sky does.
float waterFogLight(float depth, float density, float daylight) {
  return waterFogDim(depth, density) * mix(0.15, 1.0, daylight);
}

// `color` seen through `dist` of water, tinted toward the water's colour lit by `light`.
vec3 waterFog(vec3 color, float dist, float density, vec3 shallowColor, vec3 deepColor, float light) {
  float fog = 1.0 - exp(-dist * density);
  return mix(color, mix(shallowColor, deepColor, fog) * light, fog);
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
