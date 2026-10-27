// The void's cliffs (sky-cliffs.ts), baked once into a tile that repeats both ways, x along
// the walls and y down them. R: how far their rock stands out, in [0, 1]; G, B: the relief
// of its surface (its slope, x across the tile, y along it); A: how open that surface is
// (low in its creases).

uniform vec2 uRockSize; // texels

// Across the tile: bays and headlands; buttresses and gullies, tall and narrow; ledges down it.
#define BAYS 4.0
#define BUTTRESSES vec2(24.0, 6.0)
#define LEDGES 12.0
// The rock's relief, across and down a tile of it: its columns, about 8 times as tall as wide,
// the finer flutes on them, and its fine grain; and how steep it is drawn.
#define COLUMNS vec2(16.0, 2.0)
#define FLUTES vec2(48.0, 4.0)
#define GRAIN vec2(64.0, 16.0)
#define RELIEF_BUMP 0.5

float cliffHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Gradient noise repeating every `period` cells, in about [-1, 1].
float cliffNoise(vec2 p, vec2 period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n = 0.0;
  for(int y = 0; y <= 1; y++) {
    for(int x = 0; x <= 1; x++) {
      vec2 o = vec2(x, y);
      float a = 6.2831853 * cliffHash(mod(i + o, period));
      float w = dot(vec2(cos(a), sin(a)), f - o);
      n += w * (o.x > 0.5 ? u.x : 1.0 - u.x) * (o.y > 0.5 ? u.y : 1.0 - u.y);
    }
  }
  return n * 1.4;
}

// How far the rock stands out, in [0, 1].
float cliffHeight(vec2 uv) {
  float bays = 0.0;
  float amp = 0.65;
  vec2 period = vec2(BAYS);
  for(int o = 0; o < 2; o++) {
    bays += amp * cliffNoise(uv * period, period);
    period *= 2.0;
    amp *= 0.5;
  }
  // Ridged, so the buttresses' crests are sharp.
  float ridges = 0.0;
  amp = 0.5;
  period = BUTTRESSES;
  for(int o = 0; o < 3; o++) {
    float n = 1.0 - abs(cliffNoise(uv * period + 0.37 * float(o), period));
    ridges += amp * n * n;
    period *= 2.0;
    amp *= 0.5;
  }
  ridges /= 0.875;
  // A flat top standing out, a sheer face below it, then receding to the next; wavering
  // along the wall, and coming and going.
  float v = fract(uv.y * LEDGES + 0.5 * cliffNoise(uv * vec2(6.0, 2.0), vec2(6.0, 2.0)));
  float ledge = smoothstep(0.0, 0.12, v) - smoothstep(0.55, 1.0, v);
  float ledges = smoothstep(-0.2, 0.4, cliffNoise(uv * vec2(8.0, 3.0) + 5.3, vec2(8.0, 3.0)));
  return clamp(0.5 + 0.35 * bays + 0.3 * (ridges - 0.5) + 0.25 * ledges * (ledge - 0.4), 0.0, 1.0);
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
  for(int y = -1; y <= 1; y++) {
    for(int x = -1; x <= 1; x++) {
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
  for(int o = 0; o < 3; o++) {
    sum += amp * (0.5 + 0.5 * cliffNoise(uv * period + 0.37 * float(o), period));
    period *= 2.0;
    amp *= 0.5;
  }
  return sum / 0.875;
}

// The rock's surface, carved (x): rounded columns standing out to their own heights, finer
// flutes on them and a crack down some of their creases, over a fine grain. And how open it
// is (y): shut in the creases and cracks.
vec2 cliffRelief(vec2 uv) {
  vec3 column = cliffCells(uv, COLUMNS);
  vec3 flute = cliffCells(uv + 0.37, FLUTES);
  float face = sqrt(smoothstep(0.0, 0.7, column.x)) * (0.75 + 0.5 * column.y);
  float fine = sqrt(smoothstep(0.0, 0.5, flute.x));
  float crack = step(0.7, column.z) * (1.0 - smoothstep(0.0, 0.06, column.x));
  float grain = cliffGrain(uv);
  float height = 0.6 * face + 0.25 * fine + 0.15 * grain - 0.6 * crack;
  float open = clamp(0.3 + 0.6 * face + 0.2 * (fine - 0.5) - 0.8 * crack + 0.2 * (grain - 0.5), 0.0, 1.0);
  return vec2(height, open);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRockSize;
  vec2 texel = 1.0 / uRockSize;
  // Slopes per column across and down the tile.
  vec2 slope = vec2(
    cliffRelief(uv + vec2(texel.x, 0.0)).x - cliffRelief(uv - vec2(texel.x, 0.0)).x,
    cliffRelief(uv + vec2(0.0, texel.y)).x - cliffRelief(uv - vec2(0.0, texel.y)).x
  ) / (2.0 * texel * COLUMNS.x);
  vec3 normal = normalize(vec3(-slope * RELIEF_BUMP, 1.0));
  gl_FragColor = vec4(cliffHeight(uv), normal.xy * 0.5 + 0.5, cliffRelief(uv).y);
}
