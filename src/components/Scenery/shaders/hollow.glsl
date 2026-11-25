// The hollow under the seabed (SceneryVoid's `hollow`, scenery-hollow.ts): the void as a
// confined gap in the crust, under a cap of the globe about the field's disc centre, its rim
// `radius` out along the sea, wandering in and out round it. While its opening is open (the
// sea's seabed peeled), the relief and the sea's seabed are cut inside the rim and stay whole
// around it. Needs globe.glsl. About the disc's centre, as globe.glsl: nothing near-equal is
// subtracted.

// x: 1 while the hollow is on; y: 1 while its opening is open (on, and the seabed peeled);
// z: the angle its rim makes about the globe's centre, before it wanders (with the globe on);
// w: its radius along the sea, world units (with the globe off, across).
uniform vec4 uSceneryHollow;
// How the rim wanders round the axis (SCENERY_HOLLOW_RIM, scaled by SceneryHollow.rimWander):
// per wave its number round the rim, its share of the radius and its phase. The CPU builds the
// walls along the same.
#define HOLLOW_RIM_WAVES 11
uniform vec3 uSceneryHollowRim[HOLLOW_RIM_WAVES];
// Where the camera is, set each frame (SceneryHollowParts.setView). x: 1 inside the hollow's
// rim, where its walls stand about the camera and its lid is drawn, at any depth; outside it
// the camera is in solid rock. y: how shut the hollow is, 1 under the lid (the seabed in
// place, or the camera under it), eased. z: how much of the air about the camera has drained
// into the open hollow. w: how far under the floor the camera is, in the rock (0 over it).
uniform vec4 uHollowView;
// The hollow's look's switches (scenery-hollow.ts, setLook), read here and by hollow-look.glsl.
// x: how much the fissures glow; y: how much the air darkens with depth; z: 1 for the calm
// style (grey rock, dark cracks, no warmth from below), 0 for the molten one; w: how much of
// the air is left over the open hollow (hollowAirAt).
uniform vec4 uHollowLook;

// How calm the hollow's style is, for blending: 0 molten, 1 calm or simple (grey rock, no
// warmth from below). And whether it is the simple style, a diagram (uHollowLook.z 2).
float hollowStyleCalm() {
  return min(uHollowLook.z, 1.0);
}
bool hollowStyleSimple() {
  return uHollowLook.z > 1.5;
}

// The rim's radius at `turn` radians round the axis (from true east toward true north), as a
// share of its radius. Round with no wander, as the simple style's.
float hollowRimScale(float turn) {
  float scale = 1.0;
  for(int i = 0; i < HOLLOW_RIM_WAVES; i++) {
    vec3 wave = uSceneryHollowRim[i];
    scale += wave.y * sin(wave.x * turn + wave.z);
  }
  return scale;
}

// How far inside the rim `p` lies, across the hollow's axis at its own height: positive
// inside, negative outside, in world units.
float hollowInside(vec3 p) {
  vec3 v = p - uGlobeDisc.xyz;
  float h = dot(v, uGlobeUp);
  vec3 across = v - uGlobeUp * h;
  float turn = atan(dot(across, uGlobeNorth), dot(across, uGlobeEast));
  float scale = hollowRimScale(turn);
  float limit = globeOn() ? tan(uSceneryHollow.z * scale) * (h + uGlobe.y) : uSceneryHollow.w * scale;
  return limit - length(across);
}

// Whether `p` lies in the hollow's open opening: there the relief and the seabed are cut away.
bool hollowOpenAt(vec3 p) {
  return uSceneryHollow.y > 0.5 && hollowInside(p) > 0.0;
}

// The sky's own colour while the hollow is open: greyed and dimmed, so it stays a backdrop and
// the eye goes down into the hollow. Not in the bakes, which take the hollow off.
#define HOLLOW_SKY_SATURATION 0.35
#define HOLLOW_SKY_LIGHT 0.7
vec3 hollowDullSky(vec3 color) {
  if(uSceneryHollow.y < 0.5 || hollowStyleSimple())
    return color;
  float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(grey), color, HOLLOW_SKY_SATURATION) * HOLLOW_SKY_LIGHT;
}

// While the hollow is open its air drains into the void: all but uHollowLook.w of it gone over
// the opening, thinning over a band outside the rim this share of its radius wide, whole
// beyond. The ground about it loses the sky's light toward the rim, to this share of it, and
// its haze, so the crater does not stand out of a bright land; and the sky over it darkens
// toward space's. Not in the bakes, which take the hollow off.
#define HOLLOW_AIR_BAND 0.4
#define HOLLOW_AIR_GROUND 0.45

// The simple style's ring along the open hollow's rim on the ground (relief-fragment): its
// half-width in pixels, and its colour (linear).
#define HOLLOW_SIMPLE_RIM 1.5
#define HOLLOW_SIMPLE_RIM_COLOR vec3(0.85)

// How much of the air is left `inside` the rim (hollowInside, negative outside): 1 beyond the
// band, uHollowLook.w over the opening.
float hollowAirAt(float inside) {
  if(uSceneryHollow.y < 0.5)
    return 1.0;
  return mix(uHollowLook.w, 1.0, smoothstep(0.0, HOLLOW_AIR_BAND * uSceneryHollow.w, -inside));
}

// How much of the air is left at `p` (hollowAirAt).
float hollowAir(vec3 p) {
  return uSceneryHollow.y < 0.5 ? 1.0 : hollowAirAt(hollowInside(p));
}

// While the hollow is open there is no sea over its opening: none inside the rim, coming back
// over a band outside it this share of its radius wide, whole beyond. A mask, not a shore: the
// water is not shaped by it. Not in the bakes, which take the hollow off.
#define HOLLOW_WATER_BAND 0.1

// How much of the sea is left `inside` the rim (hollowInside, negative outside): 0 over the
// opening, 1 beyond the band, and 1 while the hollow is shut.
float hollowWaterAt(float inside) {
  if(uSceneryHollow.y < 0.5)
    return 1.0;
  return smoothstep(0.0, HOLLOW_WATER_BAND * uSceneryHollow.w, -inside);
}

// How much of the sea is left at `p` (hollowWaterAt). Well inside the rim's furthest reach in,
// or past the band beyond its furthest reach out (its waves' shares together, the wander), it
// is known from the distance to the axis alone: only between are the rim's waves read.
float hollowWater(vec3 p) {
  if(uSceneryHollow.y < 0.5)
    return 1.0;
  vec3 v = p - uGlobeDisc.xyz;
  float h = dot(v, uGlobeUp);
  float across = length(v - uGlobeUp * h);
  float wander = 0.0;
  for(int i = 0; i < HOLLOW_RIM_WAVES; i++)
    wander += abs(uSceneryHollowRim[i].y);
  float least = globeOn() ? tan(uSceneryHollow.z * (1.0 - wander)) * (h + uGlobe.y) : uSceneryHollow.w * (1.0 - wander);
  float most = globeOn() ? tan(uSceneryHollow.z * (1.0 + wander)) * (h + uGlobe.y) : uSceneryHollow.w * (1.0 + wander);
  if(across <= least)
    return 0.0;
  if(across >= most + HOLLOW_WATER_BAND * uSceneryHollow.w)
    return 1.0;
  return hollowWaterAt(hollowInside(p));
}

// How much of the air the sky's view finds gone: about the camera, low enough to be in it
// (uHollowView.z, sceneryHollowAirGone), the same for every pixel.
float hollowAirGone() {
  return uSceneryHollow.y > 0.5 ? uHollowView.z : 0.0;
}
