// The hollow's look (scenery-hollow.ts): its rock, its light and its crust's top layer, shared
// by its walls and floor (hollow-fragment.glsl) and by the void's lid over it (sky.glsl's
// skyAbyssCeilingOver), so the lid is the underside of the layer the walls' top is cut in.
// Needs globe.glsl and hollow.glsl.

// The rock (createRockTexture): slope along u and v, shade, fissures; and the slope r and g span.
uniform sampler2D uHollowRock;
uniform float uHollowRockSlope;
// The cliffs (createCliffTexture): shade; normal along and down the face; how open it is.
uniform sampler2D uHollowCliff;
// x: the floor's depth under the seabed; y: the rim's radius; z: the band inside the walls'
// foot over which the floor cools; w: the depth over which the light from above falls by e.
uniform vec4 uHollowShape;
uniform vec3 uHollowWallColor;
uniform vec3 uHollowFloorColor;
uniform vec3 uHollowEmberColor;
// x: how much the fissures glow; y: how much the air darkens with depth.
uniform vec2 uHollowLook;
// The embers' pulse (sceneryHollowPulse): its two waves' phases, and how far it dims.
uniform vec3 uHollowPulse;

// Depth over which the floor's warmth on the walls falls by e, from the floor up.
#define HOLLOW_WARMTH_FOLD 7000.0
// The light the hollow keeps at any depth, the opening's bounced about it: dark rock never
// turns black, without a haze over it.
#define HOLLOW_FILL 0.22
// How far round from the rake its light still reaches (hollowLight), as the cosine past 90°: on
// the floor a little; on the walls all the way round (half-Lambert), so a buttress's far side
// keeps half of it and the walls show no dark upright patches from across the hollow.
#define HOLLOW_RAKE_WRAP 0.5
#define HOLLOW_WALL_WRAP 1.0
// Under the lid, the scattered light that stands in for the rake and the sky (hollowLight).
#define HOLLOW_SCATTER 0.8
// The sediments under the seabed, which the walls' top is cut in and the lid is the underside
// of, as shares of the walls' own colour.
#define HOLLOW_SAND vec3(1.55, 1.4, 1.15)
// How bright the lid is, lit only by what the hollow keeps, against the sediments lit.
#define HOLLOW_LID 0.2
// The floor's warmth on the lid: how much of the embers' colour, and how saturated (0 grey).
#define HOLLOW_LID_WARM vec2(0.0013, 0.5)
// The distance from the camera over which the lid recedes into its own dark, and the share of
// its light left far off: it darkens from just over the camera, not only out by the walls,
// where everything past a few tens of km crowds into the degree or two over them; gently, so
// far off it is dim, not a black band.
#define HOLLOW_LID_FADE vec2(60000.0, 0.45)
// The lid darkens toward the walls, its corner with them in the hollow's shade: over this share
// of the radius in from the rim, to this share of its light at the rim. All of it from above the
// field, falling early: seen from inside, everything past a few tens of km crowds into the
// degree or two over the walls, so a fade kept for the rim reads as a thin band there.
#define HOLLOW_LID_EDGE vec2(1.0, 0.4)

// The depth over which the rock under the floor dims a view through it by e, and the share of
// the hollow it never takes: from deep under it the hollow still shows, faintly, overhead.
#define HOLLOW_ROCK_FADE 30000.0
#define HOLLOW_ROCK_KEPT 0.15

// The light from above at `alt` under the seabed (≤ 0): falling with depth; under a closed
// lid a fifth of it, the void lit by its floor.
float hollowAbove(float alt) {
  return exp(min(alt, 0.0) / uHollowShape.w) * mix(0.2, 1.0, uSkyHollow.y);
}

// The floor's warmth at `alt`, falling from the floor up.
float hollowBelow(float alt) {
  return exp(-(alt + uHollowShape.x) / HOLLOW_WARMTH_FOLD);
}

// Across the hollow, how far one wave of the embers' pulse lies from the next (world units),
// and how far the rock's blotches put a patch out of step (a share of a turn).
#define HOLLOW_PULSE_SPAN 250000.0
#define HOLLOW_PULSE_MOTTLE 0.6

// How bright the embers glow at `plane` (along true east and north from the hollow's middle),
// `mottle` the rock's blotches there (0 to 1), as they pulse (uHollowPulse): 1 at the peak,
// down by its depth at the deepest. Two slow waves, each rolling across the hollow its own
// way, each patch a little out of step with the next, so it never beats as one.
float hollowPulseAt(vec2 plane, float mottle) {
  vec2 across = plane * (6.2832 / HOLLOW_PULSE_SPAN);
  float offset = mottle * 6.2832 * HOLLOW_PULSE_MOTTLE;
  float wave = 0.6 * cos(uHollowPulse.x - dot(across, vec2(0.8, 0.6)) + offset) +
    0.4 * cos(uHollowPulse.y - dot(across, vec2(-0.45, 0.89)) + 1.3 - offset);
  return 1.0 - uHollowPulse.z * 0.5 * (1.0 - wave);
}

// Where `p` lies across the hollow, along true east and north from its middle.
vec2 hollowPlane(vec3 p) {
  vec3 v = p - uGlobeDisc.xyz;
  return vec2(dot(v, uGlobeEast), dot(v, uGlobeNorth));
}

// What is left of the hollow seen `reach` away at `p`, from under its floor (uHollowView.w
// below it): seen through the rock between, as much of the view's path as climbs through it,
// dimmed by e every HOLLOW_ROCK_FADE, down to HOLLOW_ROCK_KEPT. All of it over the floor, and
// at it: no step there.
float hollowThroughRock(float reach, vec3 p) {
  float below = uHollowView.w;
  if(below <= 0.0)
    return 1.0;
  float rise = globeAltitude(p) - (globeCameraHeight() - globeLevel());
  float path = reach * clamp(below / max(rise, 1.0), 0.0, 1.0);
  return mix(HOLLOW_ROCK_KEPT, 1.0, exp(-path / HOLLOW_ROCK_FADE));
}

// The light on rock facing `n` where up is `up`, `open` to the hollow (0 shut in a crease): the
// rake (toward `rake`, reaching `wrap` round past 90° as a cosine) and the sky through the
// opening from above, as it is `lit` under the seabed (hollowAbove's depth); what the hollow
// keeps at any depth; and `warm` of the floor's warmth at `alt`. The sky's share is how much of
// the opening the rock faces: ledges facing up take all of it, cliff faces a quarter, so the
// walls' terraces read from any side of the rim, the rake's light or not. The floor's warmth on
// it as bright as the embers' `pulse` there (hollowPulseAt).
vec3 hollowLight(vec3 n, vec3 up, vec3 rake, float wrap, float lit, float alt, float warm, float open, float pulse) {
  float facing = dot(n, up);
  // Wrapped, so faces turned a little from the rake keep some of it: the walls' spurs show
  // by their light, without their far sides falling into dark upright bands.
  float toward = clamp((dot(n, rake) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float sky = 0.5 + 0.5 * facing;
  sky *= sky;
  // Under the lid (uHollowView.y) nothing comes in from the opening: no rake, no sky from
  // above, but light scattered about the hollow, from all round, a little more onto faces up.
  float raked = 1.0 * toward + 0.6 * sky;
  float scattered = HOLLOW_SCATTER * (0.75 + 0.25 * facing);
  float direct = mix(raked, scattered, uHollowView.y) * hollowAbove(lit);
  float fill = HOLLOW_FILL * (0.35 + 0.65 * sky);
  vec3 warmth = uHollowEmberColor * (0.18 * warm * hollowBelow(alt) * (0.6 - 0.4 * facing) * pulse);
  // Creases only a little darker: the light, not the shade, carries the walls' shape.
  return vec3((direct + fill) * mix(0.85, 1.0, open)) + warmth * mix(0.8, 1.0, open);
}

// The rock at `uv`, its square turned by an angle whose cosine and sine are `turn`, so the
// sizes it is read at never line up along its lattice: its slope (per unit of `uv`, as
// height 0 to 1, turned back into `uv`'s frame), shade and fissures.
vec4 hollowRock(vec2 uv, vec2 turn) {
  mat2 m = mat2(turn.x, turn.y, -turn.y, turn.x);
  vec4 rock = texture2D(uHollowRock, m * uv);
  rock.xy = transpose(m) * ((rock.xy * 2.0 - 1.0) * uHollowRockSlope);
  return rock;
}

// The same, at mip level `lod`: no derivatives taken.
vec4 hollowRockLod(vec2 uv, vec2 turn, float lod) {
  mat2 m = mat2(turn.x, turn.y, -turn.y, turn.x);
  vec4 rock = textureLod(uHollowRock, m * uv, lod);
  rock.xy = transpose(m) * ((rock.xy * 2.0 - 1.0) * uHollowRockSlope);
  return rock;
}

// The mip level for reading the rock `size` world units a square where a pixel spans `pixel`.
float hollowRockLevel(float size, float pixel) {
  return log2(max(pixel * float(textureSize(uHollowRock, 0).x) / size, 1.0));
}

// The lid over the hollow seen from below at `hit`, `reach` away, `inside` the rim
// (hollowInside), where a pixel spans `pixel` world units: the underside of the sediments the
// walls' top is cut in, matte, faintly mottled, lit by what the hollow keeps and faintly warmed
// by its floor, receding into its own dark far off and darkening toward the walls. The way it
// faces at large is its caller's to shade. No derivatives.
vec3 hollowLid(vec3 hit, float reach, float inside, float pixel) {
  vec3 v = hit - uGlobeDisc.xyz;
  vec2 plane = vec2(dot(v, uGlobeEast), dot(v, uGlobeNorth));
  // Three sizes, each turned its own way, so close up and far off it is rough rock.
  vec4 a = hollowRockLod(plane / 40000.0 + vec2(0.31, 0.77), vec2(0.8, 0.6), hollowRockLevel(40000.0, pixel));
  vec4 b = hollowRockLod(plane / 6000.0 + vec2(0.11, 0.53), vec2(-0.5, 0.866), hollowRockLevel(6000.0, pixel));
  vec4 c = hollowRockLod(plane / 1000.0 + vec2(0.67, 0.29), vec2(0.6, -0.8), hollowRockLevel(1000.0, pixel));
  float mottle = 0.62 + 0.55 * a.z + 0.3 * (b.z - 0.5) + 0.18 * (c.z - 0.5);
  // Its roughness in a light from the hollow's middle, the glow and the opening's, so it reads
  // as a rough underside: slopes facing in lit, facing out shaded. The slopes average out in
  // the mips, so it smooths away far off.
  vec2 toward = -plane * inversesqrt(max(dot(plane, plane), 1.0));
  float relief = (0.25 * dot(a.xy, toward) + 0.35 * dot(b.xy, toward) + 0.3 * dot(c.xy, toward)) / uHollowRockSlope;
  mottle *= clamp(1.0 + relief, 0.4, 1.6);
  float near = exp(-reach / HOLLOW_LID_FADE.x);
  // From the middle out, falling fastest near it, all of it by the rim.
  float s = clamp(inside / (HOLLOW_LID_EDGE.x * uHollowShape.y), 0.0, 1.0);
  float shade = mix(HOLLOW_LID_EDGE.y, 1.0, s * s);
  float fade = mix(HOLLOW_LID_FADE.y, 1.0, near);
  vec3 sand = uHollowWallColor * HOLLOW_SAND * (HOLLOW_LID * mottle * fade);
  // The floor's glow on it: faint, half greyed, fading as its own light does, so far off it
  // never takes the lid over.
  vec3 ember = mix(vec3(dot(uHollowEmberColor, vec3(0.2126, 0.7152, 0.0722))), uHollowEmberColor, HOLLOW_LID_WARM.y);
  return (sand + ember * (HOLLOW_LID_WARM.x * uHollowLook.x * hollowPulseAt(plane, a.z) * fade)) * shade * hollowThroughRock(reach, hit);
}
