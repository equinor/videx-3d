// A tileable square of cliff face (createCliffTexture), x along the face and y down it: rounded
// columns standing out to heights of their own, some eight times as tall as wide, finer flutes
// on them, a crack down some of their creases, and a fine grain streaked down the rock; ledges
// across it, wavering and coming and going. r: the rock's shade, 0 to 1; g, b: its normal's x
// and y (across and down the face), 0.5 where it faces straight out; a: how open the surface
// is, low in its creases and cracks. After the void's baked cliffs (parked/abyss-walls).

precision highp float;

uniform float uSize; // texels along a side
uniform float uSeed;
// 1 (bakeTexture): loop counts are written times it so Direct3D keeps each loop rather than
// copying it out turn by turn, and cliffRelief is called from one loop; drawn once, it compiled
// in 3–7 s before (RTX A1000, 2026-11-19).
uniform int uLoops;

varying vec2 vUv;

// The rock's relief, across and down a tile of it: its columns, the finer flutes on them, and
// its fine grain; its ledges; and how steep it is drawn.
#define COLUMNS vec2(16.0, 2.0)
#define FLUTES vec2(48.0, 4.0)
#define GRAIN vec2(64.0, 16.0)
#define LEDGES 6.0
#define RELIEF_BUMP 0.5

float cliffHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx + uSeed * 17.0) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Gradient noise repeating every `period` cells, in about [-1, 1].
float cliffNoise(vec2 p, vec2 period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n = 0.0;
  for(int y = 0; y <= uLoops; y++) {
    for(int x = 0; x <= uLoops; x++) {
      vec2 o = vec2(x, y);
      float a = 6.2831853 * cliffHash(mod(i + o, period));
      float w = dot(vec2(cos(a), sin(a)), f - o);
      n += w * (o.x > 0.5 ? u.x : 1.0 - u.x) * (o.y > 0.5 ? u.y : 1.0 - u.y);
    }
  }
  return n * 1.4;
}

// Cells of the rock, `period` of them across and down the tile, each a column as tall against
// its width as the period stretches it: how far `uv` lies inside its cell from the crease with
// the next (x), the cell's own random value (y), and one shared by the cells either side of
// that crease (z).
vec3 cliffCells(vec2 uv, vec2 period) {
  vec2 p = uv * period;
  vec2 i = floor(p);
  float d1 = 1e9;
  float d2 = 1e9;
  vec2 id1 = vec2(0.0);
  vec2 id2 = vec2(0.0);
  for(int y = -uLoops; y <= uLoops; y++) {
    for(int x = -uLoops; x <= uLoops; x++) {
      vec2 c = i + vec2(x, y);
      vec2 cell = mod(c, period);
      vec2 at = c + 0.5 + 0.8 * (vec2(cliffHash(cell), cliffHash(cell + 17.31)) - 0.5);
      float d = length(p - at);
      if(d < d1) {
        d2 = d1;
        id2 = id1;
        d1 = d;
        id1 = cell;
      } else if(d < d2) {
        d2 = d;
        id2 = cell;
      }
    }
  }
  return vec3(d2 - d1, cliffHash(id1 + 3.7), cliffHash(min(id1, id2) * 7.0 + max(id1, id2) * 13.0));
}

// Fine, smooth grain, streaked down the rock, in [0, 1].
float cliffGrain(vec2 uv) {
  float sum = 0.0;
  float amp = 0.5;
  vec2 period = GRAIN;
  for(int o = 0; o < 3 * uLoops; o++) {
    sum += amp * (0.5 + 0.5 * cliffNoise(uv * period + 0.37 * float(o), period));
    period *= 2.0;
    amp *= 0.5;
  }
  return sum / 0.875;
}

// Ledges across the face: a flat top standing out, a sheer face below it, then receding to the
// next; wavering along the face, and coming and going. In [-0.4, 0.6].
float cliffLedges(vec2 uv) {
  float v = fract(uv.y * LEDGES + 0.5 * cliffNoise(uv * vec2(6.0, 2.0), vec2(6.0, 2.0)));
  float ledge = smoothstep(0.0, 0.12, v) - smoothstep(0.55, 1.0, v);
  float shown = smoothstep(-0.2, 0.4, cliffNoise(uv * vec2(8.0, 3.0) + 5.3, vec2(8.0, 3.0)));
  return shown * (ledge - 0.4);
}

// The rock's surface, carved (x): rounded columns standing out to their own heights, finer
// flutes on them and a crack down some of their creases, over a fine grain, on its ledges. And
// how open it is (y): shut in the creases and cracks.
vec2 cliffRelief(vec2 uv) {
  vec3 column = cliffCells(uv, COLUMNS);
  vec3 flute = cliffCells(uv + 0.37, FLUTES);
  float face = sqrt(smoothstep(0.0, 0.7, column.x)) * (0.75 + 0.5 * column.y);
  float fine = sqrt(smoothstep(0.0, 0.5, flute.x));
  float crack = step(0.75, column.z) * (1.0 - smoothstep(0.0, 0.06, column.x));
  float grain = cliffGrain(uv);
  float ledges = cliffLedges(uv);
  float height = 0.6 * face + 0.25 * fine + 0.15 * grain - 0.3 * crack + 0.6 * ledges;
  float open = clamp(0.35 + 0.5 * face + 0.15 * (fine - 0.5) - 0.4 * crack + 0.2 * (grain - 0.5) + 0.35 * ledges, 0.0, 1.0);
  return vec2(height, open);
}

void main() {
  vec2 uv = vUv;
  vec2 texel = vec2(1.0 / uSize);
  // The relief here and either side of it across and down the tile, for its slopes per column:
  // one call of cliffRelief, in a loop over the five.
  vec2 relief = vec2(0.0);
  vec2 slope = vec2(0.0);
  for(int k = 0; k < 5 * uLoops; k++) {
    vec2 side = k % 2 == 1 ? texel : -texel;
    vec2 at = k == 0 ? vec2(0.0) : (k < 3 ? vec2(side.x, 0.0) : vec2(0.0, side.y));
    vec2 r = cliffRelief(uv + at);
    if(k == 0)
      relief = r;
    else if(k < 3)
      slope.x += k == 1 ? r.x : -r.x;
    else
      slope.y += k == 3 ? r.x : -r.x;
  }
  slope /= 2.0 * texel * COLUMNS.x;
  vec3 normal = normalize(vec3(-slope * RELIEF_BUMP, 1.0));
  float shade = 0.5 + 0.5 * cliffNoise(uv * vec2(4.0, 4.0) + 1.7, vec2(4.0)) * 0.6 + 0.4 * (cliffGrain(uv * 0.5) - 0.5);
  gl_FragColor = vec4(clamp(shade, 0.0, 1.0), normal.xy * 0.5 + 0.5, relief.y);
}
