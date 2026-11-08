// The 3D clouds' weather far off (scenery-cloud-map.ts): a cube map over the whole Earth, fixed on
// it (z toward the north pole, x toward latitude and longitude 0), of the share of the ground
// under low cloud (r) and how thick it is (g: 0 a thin veil, 1 a front's or a cyclone's deep
// cloud), and the share under cloud at the middle level (b) and the high (a). With
// CLOUD_MAP_TYPES, the same weather's types instead: where each level's cloud lies along its
// chain of types (r low, g middle, b high), for a smaller cube map drawn alongside.
// The second of two passes: the first draws the weather systems' wind and pressure
// (cloud-map-flow.glsl), and this one traces each place's air back along that wind, some
// 2000 km, and reads where it came from.
//
// Nothing is drawn as a shape. The air brings its moisture, a broad noise drawn out into
// filaments along the wind, and its warmth, whose level where cold air meets warm is a front:
// the flow winds the fronts into the cyclones' commas and draws them out between the systems,
// which is most of what the weather systems look like from space. Low pressure, where the air is
// and where it came through, lifts and clouds it; high pressure clears it. Where cold air flows
// out toward the equator behind the lows, open cells (rings of cloud about clear middles, some
// 90 km); where it flows round the subtropical highs' eastern flanks, decks of closed cells (some
// 55 km), several texels across so they are not the map's noise. The tropics' trade cumulus and
// the convergence zone's thunderstorms by latitude. With the ground (a relief's, the clouds'
// terrain), the wind blowing up it lifts the air and down it the air sinks, past ridges the air
// has rained out (gaps in their lee), and the cells keep to the sea. Every part is weighed in
// smoothly, so they blend, with soft edges some texels wide.

#include ./cloud-map-noise.glsl

// The first pass: xyz the wind (radians a trace step), w the pressure.
uniform samplerCube uMapFlow;
// The ground (scenery-cloud-terrain.ts), while uMapTerrainOn: its height over the sea (r,
// metres; the sea's level under the sea) and its slope east and north (g, b).
uniform samplerCube uMapTerrain;
uniform float uMapTerrainOn;

// Steps back along the wind, and a typical step (radians), for the wind's direction's weight.
#define MAP_TRACE 36
#define MAP_TYPICAL_STEP 0.005
// The ground: a typical slope over the some 50 km it is read at, which a typical wind blowing
// up it lifts the air by as much as a front's edge; the steps back along the wind (some
// 400 km) the ridges it crossed are looked for over; and how much higher than here they must
// be for the air to have rained out on them (metres), from none to all of the lee's drying,
// both read at the level of some 40 km.
#define MAP_UPSLOPE 0.03
#define MAP_LEE_STEPS 12
#define MAP_LEE vec2(300.0, 1800.0)
// Ground this high (metres, over some 55 km) is land: the sea's level lies under the sea in
// the terrain. Broad and soft, or the coasts' 20 km texels show as stairs in the cells' edges.
#define MAP_LAND vec2(20.0, 250.0)

vec4 mapFlow(vec3 d) {
  return textureLod(uMapFlow, d, 0.0);
}

void main() {
  float latitude;
  vec3 d = mapPlace(latitude);
  float away = abs(latitude);
  vec3 east;
  vec3 north;
  mapTangents(d, east, north);
  vec4 here = mapFlow(d);
  float p = here.w;

  // Where the air here came from (midpoint steps back along the wind): a few steps back, some
  // fifteen, and all the way; the pressure it passed through on the way, high pressure having
  // dried it as it sank; and the highest ground it crossed lately, which it rained out on.
  vec3 x = d;
  vec3 recent = d;
  vec3 earlier = d;
  float passed = 0.0;
  float ridge = 0.0;
  bool terrain = uMapTerrainOn > 0.5;
  for(int i = 0; i < MAP_TRACE; i++) {
    vec4 mid = mapFlow(normalize(x - 0.5 * mapFlow(x).xyz));
    x = normalize(x - mid.xyz);
    passed += mid.w;
    if(terrain && i < MAP_LEE_STEPS)
      ridge = max(ridge, textureLod(uMapTerrain, x, 1.0).r);
    if(i == 3)
      recent = x;
    if(i == 14)
      earlier = x;
  }
  passed /= float(MAP_TRACE);
  vec3 origin = x;
  float originLatitude = degrees(asin(clamp(origin.z, -1.0, 1.0)));

  // The climate by latitude.
  float stormTrack = exp(-mapSquare((away - 50.0) / 14.0));
  float trades = exp(-mapSquare((away - 13.0) / 8.0));
  float itcz = exp(-mapSquare((latitude - 6.0) / 5.0));
  float polar = smoothstep(62.0, 80.0, away);

  // What the air brought: its moisture, broad where it came from; finer where it was more
  // recently, drawn out along the wind; finer still from a few steps back, drawn out less.
  float moisture = mapFbm(origin * 3.2, 5, 40u);
  float streaks = mapFbm(earlier * 12.0, 4, 41u);
  float detail = mapFbm(recent * 30.0, 4, 49u);
  float ragged = mapFbm(d * 36.0, 4, 42u);

  // Fronts: where the air's warmth, carried from where it came from, crosses the level between
  // the polar air and the warm, in the storm tracks and the troughs, broken here and there. The
  // flow winds them into the cyclones' commas and draws them out between the systems: most of
  // what the weather systems look like from space. Drawn out, they grow sharper than a texel: a
  // band widened by how fast the warmth changes across one, so it shows as a band and not as the
  // texels' stairs. Not dimmed as it widens: where the flow stretches the air, the widening
  // spikes along thin lines, and a dimmed band left a line of holes in the cloud there.
  float warmth = -(abs(originLatitude) - 47.0) / 11.0 + 0.6 * mapFbm(origin * 1.4 + 7.0, 3, 43u);
  float band = sqrt(mapSquare(0.3) + mapSquare(1.5 * fwidth(warmth)));
  float front = exp(-mapSquare(warmth / band)) * stormTrack * smoothstep(-0.9, 0.3, streaks) * smoothstep(-0.3, 0.3, 0.2 - p);

  // The ground: the wind blowing up it lifts the air, down it the air sinks; past ridges higher
  // than here the air has rained out (the lee's gaps, a föhn); and over land, no marine cells.
  float upslope = 0.0;
  float lee = 0.0;
  float land = 0.0;
  if(terrain) {
    vec4 broad = textureLod(uMapTerrain, d, 1.5);
    upslope = clamp(dot(here.xyz / MAP_TYPICAL_STEP, east * broad.g + north * broad.b) / MAP_UPSLOPE, -1.5, 1.5);
    lee = smoothstep(MAP_LEE.x, MAP_LEE.y, ridge - textureLod(uMapTerrain, d, 1.0).r);
    land = smoothstep(MAP_LAND.x, MAP_LAND.y, broad.r);
  }

  // The cloud the weather systems lay: along the fronts, lifted by low pressure where the air is
  // and where it came through, cleared by high; the moisture and the streaks only modulating;
  // lifted up the ground and dried in its lee.
  // Its edge widened, too, by how fast it changes across a texel, outward only: widened both
  // ways, it pulled a full deck just under full cover wherever a front's edge crossed it, and
  // the march opened a line of holes there, stepped by fwidth's 2 × 2 texel blocks.
  float lift = 1.9 * front + 0.3 * -p + 0.3 * -passed + 0.35 * moisture + 0.35 * streaks + 0.25 * detail + 1.5 * itcz * smoothstep(-0.8, 0.6, streaks + 0.5 * ragged) + 0.5 * polar + 0.45 * upslope - 0.6 * lee;
  float blur = fwidth(lift);
  float synoptic = smoothstep(0.5 - blur, 1.4, lift);
  float deep = smoothstep(1.0 - blur, 2.6, lift);

  // Cold air flowing toward the equator: open cells behind the lows in the storm tracks, decks
  // of closed cells round the subtropical highs' eastern flanks; some larger than others. Both
  // over the sea.
  float meridional = dot(here.xyz, north) * sign(latitude) / MAP_TYPICAL_STEP;
  float outbreak = smoothstep(0.1, 0.8, -meridional);
  float openWeight = outbreak * stormTrack * smoothstep(-0.5, 0.3, p) * smoothstep(-0.6, 0.6, mapFbm(d * 5.0, 2, 44u)) * (1.0 - 0.75 * land);
  float closedWeight = smoothstep(-0.2, 0.5, -meridional) * exp(-mapSquare((away - 25.0) / 9.0)) * smoothstep(0.2, 0.7, p) * smoothstep(-0.5, 0.7, mapFbm(d * 3.5, 2, 45u)) * (1.0 - 0.9 * land);
  float size = exp2(0.35 * mapFbm(d * 4.0, 2, 46u));
  float walls = mapFbm(d * 60.0, 2, 47u);
  float rings = 0.0;
  if(openWeight > 0.001) {
    vec2 cells = mapWorley(d * (MAP_EARTH_KM / (90.0 * size)), 9u);
    rings = (1.0 - smoothstep(0.02, 0.3 + 0.08 * walls, cells.y - cells.x)) * smoothstep(-1.6, 0.4, walls);
  }
  float filled = 0.0;
  if(closedWeight > 0.001) {
    vec2 cells = mapWorley(d * (MAP_EARTH_KM / (55.0 * size)), 10u);
    filled = smoothstep(0.02, 0.2 + 0.05 * walls, cells.y - cells.x);
  }
  float open = 0.85 * openWeight * rings;
  float closed = 0.92 * closedWeight * filled;

  // The trades' fair-weather cumulus: a faint speckle, finer than the map shows one by one.
  float fair = 0.0;
  float tradeWeight = trades * (1.0 - itcz);
  if(tradeWeight > 0.01)
    fair = 0.45 * tradeWeight * smoothstep(0.6, 1.6, mapFbm(d * 130.0, 2, 48u));

  float cover = max(max(synoptic, open), max(closed, fair));
  // How thick: each part's, weighed by its cover; the systems' thin at their edges, deep in
  // their hearts. Over a floor of weight, so where the cover fades it fades to thin rather than
  // jumping between the parts' thicknesses, which showed the texels' stairs.
  float weight = max(synoptic + open + closed + fair, 0.6);
  float thickness = (synoptic * mix(0.2, 1.0, deep) + open * 0.45 + closed * 0.32 + fair * 0.12) / weight;

  // The cloud higher up, as the layers there take it far off. The cells and the trades' cumulus
  // keep to the low level. Altostratus at the middle level, along the fronts — a band on the
  // cold side, where the warm air rides up over the cold — and in the systems' deep hearts.
  // Ice at the top: the cirrus shield further ahead of the fronts, the deep systems' tops, the
  // convergence zone's anvils, and faint streaks along the storm tracks' jets.
  float lowered = smoothstep(-0.3, 0.3, 0.2 - p) * stormTrack;
  float ahead = exp(-mapSquare((warmth + 0.45) / (2.0 * band)));
  float shield = exp(-mapSquare((warmth + 0.9) / (3.5 * band)));
  float midLift = 1.6 * ahead * lowered * smoothstep(-0.9, 0.3, streaks) + 1.2 * deep + 0.3 * moisture + 0.25 * detail - 0.5 * lee;
  float mid = smoothstep(0.5 - fwidth(midLift), 1.3, midLift);
  float highLift = 1.5 * shield * lowered * smoothstep(-0.6, 0.6, streaks + 0.4 * ragged) + 0.9 * deep + 1.4 * itcz * smoothstep(-0.4, 0.8, streaks + ragged) + 0.6 * stormTrack * smoothstep(0.3, 1.1, streaks) + 0.2 * detail;
  float high = smoothstep(0.45 - fwidth(highLift), 1.2, highLift);

#ifdef CLOUD_MAP_TYPES
  // Where each level's cloud lies along its chain of types (CLOUD_TYPE_CHAINS in
  // scenery-cloud-volume.ts), each part at its own place weighed by how much of the cover it
  // lays. Low (cumulus 0, stratocumulus 1, stratus 2): the open cells and the trades' cumulus
  // heaped; the closed cells' decks; the systems' sheets, stratus where they run deep or the
  // air is polar, heaped again in the convergence zone's thunderstorms. Middle (altocumulus 0,
  // altostratus 1): the warm air riding up the fronts and the systems' deep hearts a sheet,
  // what weaker lift there is elsewhere in puffs. High (cirrus 0, cirrostratus 1): the shield
  // ahead of the fronts and the deep systems' tops a veil; the anvils and the jets' streaks.
  float sheets = mix(1.0 + max(deep, polar), 0.0, itcz);
  float lowPlace = (synoptic * sheets + closed) / max(synoptic + open + closed + fair, 1e-3);
  float midSheet = 1.6 * ahead * lowered * smoothstep(-0.9, 0.3, streaks) + 1.2 * deep;
  float midPlace = midSheet / (midSheet + max(0.3 * moisture + 0.25 * detail, 0.0) + 0.1);
  float highVeil = 1.5 * shield * lowered * smoothstep(-0.6, 0.6, streaks + 0.4 * ragged) + 0.9 * deep;
  float highStreaks = 1.4 * itcz * smoothstep(-0.4, 0.8, streaks + ragged) + 0.6 * stormTrack * smoothstep(0.3, 1.1, streaks) + max(0.2 * detail, 0.0) + 0.1;
  gl_FragColor = vec4(clamp(0.5 * lowPlace, 0.0, 1.0), clamp(midPlace, 0.0, 1.0), clamp(highVeil / (highVeil + highStreaks), 0.0, 1.0), 1.0);
#else
  gl_FragColor = vec4(clamp(cover, 0.0, 1.0), clamp(thickness, 0.0, 1.0), clamp(mid, 0.0, 1.0), clamp(high, 0.0, 1.0));
#endif
}
