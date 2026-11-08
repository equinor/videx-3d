// The 3D clouds' field (SceneryCloudVolume): where its clouds are and what they are like. The
// twin of sdk/weather/cloud-field.ts, which the uniforms come from and whose tests measure it.
//
// Positions are on the field's frame (uCloudFrameE/N/M: east, north and up at the weather's
// middle, in the world): (east, north, up less the sea's radius) from the Earth's centre, the
// camera's worked out on the CPU in 64-bit floats (uCloudCamera). The field is the plane
// touching the Earth there (gnomonic: a column is a point on it, a view's track a line), in
// metres; each pattern drifts on it with the layer's wind.

uniform vec3 uCloudFrameE;
uniform vec3 uCloudFrameN;
uniform vec3 uCloudFrameM;
uniform vec3 uCloudCamera;
// 1 / the sea's radius; 0 with the globe off (the field is the level plane).
uniform float uCloudInvRadius;
// The layer: its base and top over the sea, its cover, and the local weather's radius.
uniform vec4 uCloudLayer;
// The layer's wind on the field: the way it blows (xy, east and north) and its speed (z).
uniform vec4 uCloudWind;
// Its looks: the extinction in cloud (1 / metre, by the density), the detail volume's period,
// and the scale; w unused.
uniform vec4 uCloudLook;
uniform sampler3D uCloudShape;
uniform sampler3D uCloudDetail;

// The cumulus grids (cumulusGrids): each one's cell, least and most radius, and the share of
// its cells holding a cloud; its clock (cumulusEpoch: the lifetimes passed, the share of the
// next), seed (cumulusGridSeed) and lifetime; its drift, wrapped to CLOUD_WRAP cells; and,
// far off, its mean (its cover, its clouds' mean radius and height).
uniform vec4 uCloudGrids[CLOUD_GRIDS];
uniform vec4 uCloudGridClocks[CLOUD_GRIDS];
uniform vec2 uCloudGridShifts[CLOUD_GRIDS];
// How each grid is turned from the field's east (cumulusGridTurn): its cosine and sine.
uniform vec2 uCloudGridTurns[CLOUD_GRIDS];
uniform vec4 uCloudGridMeans[CLOUD_GRIDS];
// A uniform count, so Direct3D keeps the loops over the grids loops.
uniform int uCloudGridCount;

// The strato field (stratoOctave, stratoOctaveShift): each octave's matrix (column-major 2 × 2)
// and its shift, the warp's first; and the level it must pass (stratoThreshold), its standard
// deviation, the variance of one octave of unit weight, and its broadest octave's period
// across the wind (metres).
uniform vec4 uCloudStratoMatrices[CLOUD_STRATO_OCTAVES + 1];
uniform vec3 uCloudStratoShifts[CLOUD_STRATO_OCTAVES + 1];
uniform vec4 uCloudStrato;

#define CLOUD_FAR 1e30

// The noise volumes' means and standard deviations (measured, scenery-cloud-noise.ts): their
// Perlin-Worley (shape r), billows (shape gba, weighted), fine billows (detail rgb, weighted)
// and wisps (detail a).
#define CLOUD_PERLIN_WORLEY vec2(0.736, 0.094)
#define CLOUD_BILLOWS vec2(0.471, 0.099)
#define CLOUD_FINE vec2(0.487, 0.093)
#define CLOUD_WISPS vec2(0.501, 0.149)
#define CLOUD_SHAPE_TEXELS 128.0
#define CLOUD_DETAIL_TEXELS 32.0

// A cumulus: its billows' tile over its full radius (Worley cells of some a quarter and an
// eighth of its radius: its turrets); how far they heap its body (CLOUD_CUMULUS_BODY) up and
// carve it (shares of its radius, at their extremes); its detail's reach in and out (all
// outward reaches together within CUMULUS_REACH's room); how fast its billows rise as it lives
// (metres a second); and its edge's softness (a share of its radius).
#define CLOUD_BILLOW_TILE 1.8
#define CLOUD_BILLOW_OUT 0.3
#define CLOUD_BILLOW_IN 0.45
#define CLOUD_DETAIL_IN 0.15
#define CLOUD_DETAIL_OUT 0.05
#define CLOUD_RISE 0.5
#define CLOUD_SOFT 0.08

// 32-bit integer hash: cloudFieldHash, bit for bit.
uint cloudFieldHash(ivec3 p, uint seed) {
  uvec3 q = uvec3(p);
  uint h = (q.x * 0x8da6b343u) ^ (q.y * 0xd8163841u) ^ (q.z * 0xcb1ab31fu) ^ ((seed + 0x9e3779b9u) * 0x85ebca6bu);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return h ^ (h >> 15u);
}

float cloudFieldByte(uint h, uint shift) {
  return (float((h >> shift) & 255u) + 0.5) / 256.0;
}

float cloudFieldShort(uint h) {
  return float(h & 0xffffu) / 65536.0;
}

// A point `t` along a view whose way is `d` on the field's frame.
vec3 cloudFieldPoint(vec3 d, float t) {
  return uCloudCamera + d * t;
}

// Where a point `p` of the field's frame lies on the field (metres, fixed on the Earth).
vec2 cloudFieldOf(vec3 p) {
  return p.xy / (1.0 + p.z * uCloudInvRadius);
}

// Its height over the sea: |p| − R, written so it keeps its precision near the Earth.
float cloudAltitudeOf(vec3 p) {
  if(uCloudInvRadius <= 0.0)
    return p.z;
  float R = 1.0 / uCloudInvRadius;
  float a = p.z * (2.0 * R + p.z) + dot(p.xy, p.xy);
  return a / (R + sqrt(R * R + a));
}

// Where a view's track on the field (along `d`) crosses the line where the field's coordinate
// along `axis` (unit) is `value`: CLOUD_FAR where it does not ahead of `from`.
float cloudFieldCross(vec3 d, vec2 axis, float value, float from) {
  float s0 = 1.0 + uCloudCamera.z * uCloudInvRadius;
  float s1 = d.z * uCloudInvRadius;
  float den = dot(d.xy, axis) - value * s1;
  if(abs(den) < 1e-9)
    return CLOUD_FAR;
  float t = (value * s0 - dot(uCloudCamera.xy, axis)) / den;
  return t > from ? t : CLOUD_FAR;
}

// Where `field` (fixed on the Earth) lies in grid `k`'s frame: drifted, and turned.
vec2 cloudGridOf(int k, vec2 field) {
  vec2 f = field - uCloudGridShifts[k];
  vec2 turn = uCloudGridTurns[k];
  return vec2(turn.x * f.x + turn.y * f.y, turn.x * f.y - turn.y * f.x);
}

// And back: where a point of grid `k`'s frame lies on the field.
vec2 cloudFieldOfGrid(int k, vec2 g) {
  vec2 turn = uCloudGridTurns[k];
  return uCloudGridShifts[k] + vec2(turn.x * g.x - turn.y * g.y, turn.y * g.x + turn.x * g.y);
}

// Where a view along `d` lies within `radius` of the column at `middle` on the field (fixed on
// the Earth): (from, to), from > to where it never does. The track's distance from the column
// is a ratio of linear functions of t, so this is a quadratic.
vec2 cloudFieldColumn(vec3 d, vec2 middle, float radius) {
  float s0 = 1.0 + uCloudCamera.z * uCloudInvRadius;
  float s1 = d.z * uCloudInvRadius;
  vec2 m0 = uCloudCamera.xy - middle * s0;
  vec2 m1 = d.xy - middle * s1;
  float r2 = radius * radius;
  float a = dot(m1, m1) - r2 * s1 * s1;
  float b = dot(m0, m1) - r2 * s0 * s1;
  float c = dot(m0, m0) - r2 * s0 * s0;
  if(a < 1e-12)
    return c <= 0.0 ? vec2(-CLOUD_FAR, CLOUD_FAR) : vec2(1.0, -1.0);
  float disc = b * b - a * c;
  if(disc < 0.0)
    return vec2(1.0, -1.0);
  float s = sqrt(disc);
  return vec2((-b - s) / a, (-b + s) / a);
}

// The local weather's cover at `field` (fixed on the Earth): thinning over its outer
// CLOUD_LOCAL_EDGE, none beyond its radius.
float cloudLocalEdge(vec2 field) {
  float radius = uCloudLayer.w;
  return 1.0 - smoothstep((1.0 - CLOUD_LOCAL_EDGE) * radius, radius, length(field));
}

// cumulusAspect: how much taller than broad a cumulus `diameter` across (at scale 1) grows.
float cloudAspect(float diameter) {
  return clamp(0.45 + 0.35 * log2(max(diameter, 1.0) / 500.0), 0.45, 1.9);
}

// cumulusLife: at `age` of its life, how far up it has built, how far out, and how dense.
vec3 cloudCumulusLife(float age) {
  float fade = 1.0 - smoothstep(0.7, 1.0, age);
  return vec3(smoothstep(0.0, 0.35, age) * (0.4 + 0.6 * fade), (0.6 + 0.4 * smoothstep(0.0, 0.25, age)) * pow(fade, 0.7), smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.92, 1.0, age)));
}

// A cumulus as it is now (cumulusAt): its middle on the field (fixed on the Earth), its radius
// and height as it has grown, its base, its density (a share of its own, by its life and the
// local weather's edge), its full radius (its billows' scale), how it towers (0 a dome, 1 a
// tower over a broader base), its lean downwind (metres at its top), where its billows lie in
// the noise, and how far they have risen.
struct Cumulus {
  vec2 middle;
  float radius;
  float height;
  float base;
  float density;
  float full;
  float towering;
  float lean;
  vec3 noise;
};

// The cumulus of grid `k` in its cell `cell`, if it holds one.
bool cloudCumulusAt(int k, ivec2 cell, out Cumulus c) {
  vec4 grid = uCloudGrids[k];
  vec4 clock = uCloudGridClocks[k];
  uint seed = uint(clock.z);
  ivec3 p = ivec3(cell & (CLOUD_WRAP - 1), 0);
  float at = clock.y + cloudFieldShort(cloudFieldHash(p, seed + 1u));
  p.z = int(clock.x) + int(floor(at));
  float age = fract(at);
  uint form = cloudFieldHash(p, seed + 2u);
  if(cloudFieldShort(form) >= grid.w)
    return false;
  uint place = cloudFieldHash(p, seed + 3u);
  uint look = cloudFieldHash(p, seed + 4u);
  float r0 = grid.y;
  float r1 = grid.z;
  float q = r0 / r1;
  float radius = r0 / sqrt(1.0 - cloudFieldByte(form, 16u) * (1.0 - q * q));
  float aspect = cloudAspect(2.0 * radius / uCloudLook.z) * (0.85 + 0.3 * cloudFieldByte(form, 24u));
  float thickness = uCloudLayer.y - uCloudLayer.x;
  float height = min(2.0 * radius * aspect, thickness * (0.85 + 0.15 * cloudFieldByte(place, 16u)));
  float room = max(0.5 * grid.x - CLOUD_REACH * radius - CLOUD_MARGIN * grid.x, 0.0);
  c.middle = cloudFieldOfGrid(k, (vec2(cell) + 0.5) * grid.x + (2.0 * vec2(cloudFieldByte(place, 0u), cloudFieldByte(place, 8u)) - 1.0) * room);
  vec3 life = cloudCumulusLife(age);
  float edge = cloudLocalEdge(c.middle);
  c.radius = radius * life.y * sqrt(edge);
  c.height = height * life.x;
  c.base = uCloudLayer.x + (cloudFieldByte(place, 24u) - 0.5) * min(60.0 * uCloudLook.z, 0.05 * thickness);
  c.density = life.z * edge;
  c.full = radius;
  c.towering = smoothstep(1.0, 1.6, aspect);
  c.lean = 0.1 * cloudFieldByte(look, 0u) * min(c.height, radius);
  c.noise = vec3(cloudFieldByte(look, 8u), cloudFieldByte(look, 16u), cloudFieldByte(look, 24u)) - vec3(0.0, 0.0, age * clock.w * CLOUD_RISE / (CLOUD_BILLOW_TILE * radius));
  return c.density > 0.0 && c.height > 1.0 && c.radius > 1.0;
}

// The radius of a cumulus's body at `h` up it (a share of its height), over its own: a dome
// over a flat base a little narrower than its bulge, or a tower narrower than the mound it
// rises from.
float cloudCumulusProfile(float h, float towering) {
  float dome = sqrt(max(1.0 - pow(h, 2.2), 0.0));
  float tower = mix(1.0, 0.62, smoothstep(0.12, 0.45, h)) * sqrt(max(1.0 - pow(h, 4.0), 0.0));
  return CLOUD_CUMULUS_BODY * (0.88 + 0.12 * smoothstep(0.0, 0.2, h)) * mix(dome, tower, towering);
}

// The width of a cumulus's edge (metres), taken in over a footprint `footprint` across: its
// own softness, or the footprint where that is wider.
float cloudCumulusSoft(float radius, float footprint) {
  return max(CLOUD_SOFT * radius, footprint);
}

// The most a cumulus's cloud reaches from its middle (metres), taken in over a footprint
// `footprint` across: its bounding column.
float cloudCumulusReach(Cumulus c, float footprint) {
  return CLOUD_REACH * c.radius + 0.5 * cloudCumulusSoft(c.radius, footprint);
}

// How far a point `z` over cumulus `c`'s base, `across` from its axis, lies outside its body
// (metres; negative inside): its side by its profile, its flat base (below it, how far below),
// its top's dome. And its height up it (h). A distance all round, so a step's share in cloud can
// be integrated as running straight between its ends (cloudShareAlong).
float cloudCumulusOutside(Cumulus c, vec2 across, float z, out float h) {
  h = z / c.height;
  float side = length(across);
  if(h >= 1.0)
    return length(vec2(side, z - c.height));
  return max(side - c.radius * cloudCumulusProfile(max(h, 0.0), c.towering), -z);
}

// A cumulus at `field` (on the field, fixed on the Earth) `altitude` over the sea, taken in over a
// footprint `footprint` across (metres): how far in from its edge (x, in the edge's widths:
// its share in cloud there is clamp(0.5 + x, 0, 1), cloudShare), and its density inside (y, a
// share of the extinction in cloud). Its body heaped up into turrets and carved by its billows,
// most toward its top, none at its flat base; with `detail`, roughened by the detail volume as
// far as the footprint resolves it. The edge apart from the density, so a step's share in
// cloud can be integrated between its ends (cloudShareAlong) rather than sampled.
vec2 cloudCumulusEdge(Cumulus c, vec2 field, float altitude, float footprint, bool detail) {
  float z = altitude - c.base;
  float r = c.radius;
  float soft = cloudCumulusSoft(r, footprint);
  vec2 across = field - c.middle - uCloudWind.xy * (c.lean * max(z, 0.0) / c.height);
  float h;
  float d = cloudCumulusOutside(c, across, z, h);
  float scale = (0.55 + 0.7 * clamp(h, 0.0, 1.0)) * c.density;
  // Too far out for even its billows and detail to reach (below its flat base, none reach).
  if(d > (CLOUD_BILLOW_OUT + CLOUD_DETAIL_OUT) * r + 0.5 * soft || z < 0.0)
    return vec2(-d / soft, scale);
  // Its billows, at its own scale, rising as it lives.
  float tile = CLOUD_BILLOW_TILE * c.full;
  float lod = max(log2(2.0 * footprint * CLOUD_SHAPE_TEXELS / tile), 0.0);
  vec4 s = textureLod(uCloudShape, vec3(across, z) / tile + c.noise, lod);
  float billows = mix((dot(s.gba, vec3(0.625, 0.25, 0.125)) - CLOUD_BILLOWS.x) / CLOUD_BILLOWS.y, (s.r - CLOUD_PERLIN_WORLEY.x) / CLOUD_PERLIN_WORLEY.y, 0.3);
  billows = clamp(billows, -1.5, 1.0);
  d -= r * (billows > 0.0 ? CLOUD_BILLOW_OUT : CLOUD_BILLOW_IN / 1.5) * billows * smoothstep(0.0, 0.3, h);
  // The detail, close up: wisps at its base, fine billows above; faded as the footprint
  // averages it away (it is about its mean, so the cloud keeps its size).
  float period = uCloudLook.y;
  float detailLod = log2(2.0 * footprint * CLOUD_DETAIL_TEXELS / period);
  if(detail && detailLod < 4.0 && abs(d) < 0.3 * r + soft) {
    vec4 n = textureLod(uCloudDetail, vec3(across, z) / period + c.noise.yzx, max(detailLod, 0.0));
    float fine = (dot(n.rgb, vec3(0.625, 0.25, 0.125)) - CLOUD_FINE.x) / CLOUD_FINE.y;
    float wisps = (n.a - CLOUD_WISPS.x) / CLOUD_WISPS.y;
    fine = clamp(mix(0.5 * wisps, fine, smoothstep(0.05, 0.25, h)), -2.5, 1.0);
    d -= r * (fine > 0.0 ? CLOUD_DETAIL_OUT : CLOUD_DETAIL_IN / 2.5) * fine * (1.0 - smoothstep(2.0, 4.0, detailLod));
  }
  return vec2(-d / soft, scale);
}

// Cumulus `c`'s body alone at `field`, `altitude`: its density with its billows taken as their
// mean and a soft edge a third of its radius wide. What the light crosses beyond a point's own
// billows (cloudCumulusLight): the cloud's mass, not its every crease, which a few samples
// toward the light would slice into bands. No texture read.
float cloudCumulusBody(Cumulus c, vec2 field, float altitude) {
  float z = altitude - c.base;
  if(z < 0.0)
    return 0.0;
  vec2 across = field - c.middle - uCloudWind.xy * (c.lean * z / c.height);
  float h;
  float d = cloudCumulusOutside(c, across, z, h);
  return clamp(0.5 - d / (0.33 * c.radius), 0.0, 1.0) * (0.55 + 0.7 * min(h, 1.0)) * c.density;
}

// The share in cloud at an edge value `edge` (cloudCumulusEdge's x): a ramp across the edge.
float cloudShare(float edge) {
  return clamp(0.5 + edge, 0.0, 1.0);
}

// The integral of clamp(u, 0, 1) from 0 to `u`.
float cloudRamp(float u) {
  return u <= 0.0 ? 0.0 : (u >= 1.0 ? u - 0.5 : 0.5 * u * u);
}

// The mean share in cloud along a step whose edge value runs straight from `a` to `b`: where
// within the step the view crosses the edge, not on which side a sample fell, so the steps do
// not slice the clouds into shells.
float cloudShareAlong(float a, float b) {
  float ua = 0.5 + a;
  float ub = 0.5 + b;
  if(abs(ub - ua) < 1e-4)
    return clamp(0.5 * (ua + ub), 0.0, 1.0);
  return (cloudRamp(ub) - cloudRamp(ua)) / (ub - ua);
}

// Its density (a share of the extinction in cloud) there: cloudCumulusEdge's share in cloud.
float cloudCumulusDensity(Cumulus c, vec2 field, float altitude, float footprint, bool detail) {
  vec2 e = cloudCumulusEdge(c, field, altitude, footprint, detail);
  return cloudShare(e.x) * e.y;
}

// Stefan Gustavson's permutation polynomial modulo 289 (webgl-noise, MIT).
vec4 cloudPermute(vec4 x) {
  return mod(((x * 34.0) + 10.0) * x, 289.0);
}

// Value noise in [0, 1) at `p` in cells, smooth, repeating every 289 cells: the twin of
// cloudValueNoise in cloud-noise.ts.
float cloudValueNoise(vec3 p) {
  vec3 f = floor(p);
  vec3 i = mod(f, 289.0);
  vec3 j = mod(i + 1.0, 289.0);
  vec3 u = p - f;
  u = u * u * (3.0 - 2.0 * u);
  vec4 x = vec4(i.x, j.x, i.x, j.x);
  vec4 y = vec4(i.y, i.y, j.y, j.y);
  vec4 near = cloudPermute(cloudPermute(cloudPermute(vec4(i.z)) + y) + x) / 289.0;
  vec4 far = cloudPermute(cloudPermute(cloudPermute(vec4(j.z)) + y) + x) / 289.0;
  vec4 h = mix(near, far, u.z);
  vec2 rows = mix(h.xz, h.yw, u.x);
  return mix(rows.x, rows.y, u.y);
}

// Where `field` (fixed on the Earth, metres) lies in the strato field: along the wind and across
// it, in its broadest octave's periods (drawn out along the wind).
vec2 cloudStratoPlace(vec2 field) {
  vec2 along = uCloudWind.xy;
  vec2 across = vec2(-along.y, along.x);
  return vec2(dot(field, along) / CLOUD_STRATO_STRETCH, dot(field, across)) / uCloudStrato.w;
}

// The strato field at `s` (cloudStratoPlace; stratoField), taken in over a footprint
// `footprint` across (metres): its octaves finer than the footprint dropped (x), and the
// variance they would have added (y), by which its edge widens.
vec2 cloudStratoField(vec2 s, float footprint) {
  vec4 wm = uCloudStratoMatrices[0];
  vec3 ws = uCloudStratoShifts[0];
  float wx = wm.x * s.x + wm.z * s.y + ws.x;
  float wy = wm.y * s.x + wm.w * s.y + ws.y;
  vec2 a = s + CLOUD_STRATO_WARP * (vec2(cloudValueNoise(vec3(wx, wy, ws.z)), cloudValueNoise(vec3(wy + 31.7, wx + 11.3, ws.z))) - 0.5);
  float sum = 0.0;
  float total = 0.0;
  float lost = 0.0;
  float weight = 1.0;
  float period = uCloudStrato.w;
  for(int o = 0; o < CLOUD_STRATO_OCTAVES; o++) {
    total += weight;
    float kept = 1.0 - smoothstep(0.35, 0.7, footprint / period);
    if(kept > 0.0) {
      vec4 m = uCloudStratoMatrices[o + 1];
      vec3 sh = uCloudStratoShifts[o + 1];
      vec3 p = vec3(m.x * a.x + m.z * a.y + sh.x, m.y * a.x + m.w * a.y + sh.y, sh.z);
      sum += weight * kept * (cloudValueNoise(p) - 0.5);
    }
    lost += weight * weight * (1.0 - kept * kept);
    weight *= CLOUD_STRATO_GAIN;
    period /= CLOUD_STRATO_LACUNARITY;
  }
  return vec2(0.5 + sum / total, lost * uCloudStrato.z / (total * total));
}

// The strato layer at `field`: the share of it in cloud (x, across its soft edge, as the
// footprint takes it in), its base (y) and top (z) there over the sea.
vec3 cloudStratoAt(vec2 field, float footprint) {
  vec2 f = cloudStratoField(cloudStratoPlace(field), footprint);
  float width = sqrt(pow(CLOUD_STRATO_EDGE * uCloudStrato.y, 2.0) + 1.5625 * f.y);
  float e = (f.x - uCloudStrato.x) / width;
  float share = smoothstep(-1.0, 1.0, e) * cloudLocalEdge(field);
  float thickness = uCloudLayer.y - uCloudLayer.x;
  // A lens: thin toward a veil's edge from below and above, its whole depth at its core.
  float core = smoothstep(-1.0, 2.5, e);
  float base = uCloudLayer.x + 0.25 * thickness * (1.0 - core);
  float top = base + (uCloudLayer.y - base) * (0.35 + 0.65 * core);
  return vec3(share, base, top);
}

// Its density at `altitude` in a column whose layer is `column` (cloudStratoAt): soft at its
// base, softer toward its top.
float cloudStratoDensity(vec3 column, float altitude) {
  float h = (altitude - column.y) / max(column.z - column.y, 1.0);
  if(h <= 0.0 || h >= 1.0)
    return 0.0;
  return column.x * smoothstep(0.0, 0.2, h) * (1.0 - smoothstep(0.5, 1.0, h));
}
