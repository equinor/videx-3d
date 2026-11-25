// The hollow under the seabed (scenery-hollow.ts): a crater in the crust that frames the data,
// drawn just before the background, after the scene, which it never hides, writing depth so
// the background's layers skip it. HOLLOW_FLOOR draws its floor, else its walls.
// The walls show the crust in section, in one warm grey: the sea's seabed's hue along the
// cut's top, banded, folded sediments under it telling apart by their shade, mottled granite
// below them, darker basalt down to the floor, rubble on their aprons. The floor is the
// mantle's cooled top: dark rock, charcoal to rust, its fissures meandering and glowing
// dully, cooling to grey rubble toward the walls. Lit by a light raking from the opening at
// the subsurface light's bearing, which falls with depth, by what the hollow keeps at any
// depth, and by the floor's warmth from below; the void's air darkens with depth toward the
// rock's own dark. No air haze: the sky's is blue, and from space it stays as it is.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <dithering_pars_fragment>
#include ../../../sdk/materials/shaderLib/globe.glsl
#include ./hollow.glsl
#include ./hollow-look.glsl

// The sky's: the seabed's height along up (the void's level), the scale of everything it
// draws, and the sea's seabed's colour, which the walls' top continues.
uniform float uSceneryVoidLevel;
uniform float uSceneryIntensity;
uniform vec3 uScenerySeabedColor;

varying vec3 vHollowWorld;
varying vec3 vHollowNormal;
varying vec2 vHollowUv;
varying float vHollowEdge;
varying float vHollowOpen;
varying vec3 vHollowUp;
varying vec3 vHollowEast;
varying vec3 vHollowRake;

// The void's dark: how far a view must run under the seabed for it to keep but 1/e of what it
// sees, the floor's and the walls' foot; and its colour, all but black, so the far floor sinks
// into it and the hollow looks vast, without a haze over it. The walls above their foot keep
// their shape across the hollow.
#define HOLLOW_VEIL 200000.0
#define HOLLOW_VEIL_COLOR vec3(0.0035, 0.003, 0.0028)
// The light from above on the walls falls a quarter as fast with depth as on the floor: they
// face the opening across the hollow, and it is their shape that frames it from afar; and
// their top, which catches most of it, stands out of them no more than their layers do.
#define HOLLOW_WALL_LIGHT 0.25
// How much of the mesh's own turn the walls' faces keep for the light (0 none: all face the
// axis; 1 all of it): their shape reads, their flanks never fall into dark slabs.
#define HOLLOW_WALL_SHAPE 0.4
// The walls' palette (hollowStrata): luminance weights; how much warmer or cooler a sediment
// band is at most, by its shade; how much lighter than the walls' own colour their top is, in
// the seabed's hue, and how deep it reaches before the walls' own colour takes over.
#define HOLLOW_LUMA vec3(0.2126, 0.7152, 0.0722)
#define HOLLOW_BAND_HUE vec3(0.06, 0.0, -0.06)
// How much lighter or darker one sediment band is than the next, at most (a share either way).
#define HOLLOW_BAND_CONTRAST 0.8
// The calm style (hollowStyleCalm): its bands' warm/cool shift as a share of the molten one's;
// its walls' top's light; its floor's light, as light as the walls' foot it meets; how dark
// its floor's cracks are.
#define HOLLOW_CALM_HUE 0.33
#define HOLLOW_CALM_TOP_LIGHT 1.1
#define HOLLOW_CALM_FLOOR 3.0
#define HOLLOW_CALM_CRACKS 0.45
// The simple style (hollowStyleSimple), a diagram: how far apart its walls' depth lines and its
// floor's rings are (world units), how much darker a line is, the shadow under the rim (its
// depth, and the light left at the rim), and the light left under the lid.
#define HOLLOW_SIMPLE_LINES 5000.0
#define HOLLOW_SIMPLE_RINGS 50000.0
#define HOLLOW_SIMPLE_LINE 0.3
#define HOLLOW_SIMPLE_EDGE vec2(6000.0, 0.55)
#define HOLLOW_SIMPLE_SHUT 0.6
#define HOLLOW_TOP_LIGHT 1.25
#define HOLLOW_TOP_DEPTH 3000.0
// How much the cut's top edge catches the light, so the crust's outline reads at any distance.
#define HOLLOW_TOP_EDGE 0.08
// The walls darken toward the floor from this share of the way down their face (0 at the top,
// 1 at the foot), to this share of their light at the foot.
#define HOLLOW_WALL_DUSK vec2(0.0, 0.5)
// How dark the floor is, and how much its fissures glow, with the camera close over it (its
// height over the seabed up to the first) against far off (from the second up): from space
// the hollow reads in the scene, close up it is the backdrop and falls back behind the data.
// The walls darken less, so the crater's outline still reads; toward their foot as the floor.
#define HOLLOW_NEAR vec2(20000.0, 1500000.0)
#define HOLLOW_NEAR_FLOOR 0.5
#define HOLLOW_NEAR_WALL 0.75
// Under the lid (uHollowView.y): the share of their light the walls keep, the opening's gone;
// and toward their top, in the corner with the lid, the depth over which they darken further
// and by how much at the top.
#define HOLLOW_SHUT_WALL 0.35
#define HOLLOW_SHUT_TOP vec2(6000.0, 0.6)
// How directly the floor is seen (its view's cosine to the floor), for how warm it shows: not
// at all below the first, wholly above the second. Seen at a slant it is greyed, a shade cool,
// keeping its light, and its fissures glow as much as this share of it.
#define HOLLOW_FACE_ON vec2(0.2, 0.9)
#define HOLLOW_GREY vec3(0.96, 0.98, 1.0)
#define HOLLOW_SLANT_GLOW 0.35

// `color`, at `alt` under the seabed, seen through the void's dark from the camera, as much as
// `weight`: what the dark takes away along the part of the view under the seabed.
vec3 hollowVeil(vec3 color, float alt, float weight) {
  float camera = globeCameraHeight() - uSceneryVoidLevel;
  float dist = distance(vHollowWorld, cameraPosition);
  // From above the seabed, only the part of the view under it.
  float inside = camera > 0.0 ? dist * -alt / max(camera - alt, 1.0) : dist;
  float kept = exp(-inside * weight * uHollowLook.y / HOLLOW_VEIL);
  return mix(HOLLOW_VEIL_COLOR, color, kept);
}

// How far off the camera is, for how the floor is exposed: 0 close over it, 1 far off, by its
// height over the seabed on a log scale, as a zoom feels.
float hollowFar() {
  float height = max(globeCameraHeight() - uSceneryVoidLevel, 1.0);
  return smoothstep(log(HOLLOW_NEAR.x), log(HOLLOW_NEAR.y), log(height));
}

// The simple style's faint grain, the rock's shade at `big` and `small` (each a unit a square),
// turned against each other: a brightness around 1, by HOLLOW_SIMPLE_GRAIN either way. The
// mips average it out far off.
float hollowSimpleGrain(vec2 big, vec2 small) {
  float a = hollowRock(big + vec2(0.13, 0.71), vec2(0.8, 0.6)).z;
  float b = hollowRock(small + vec2(0.57, 0.19), vec2(-0.5, 0.866)).z;
  return 1.0 + HOLLOW_SIMPLE_GRAIN * (1.2 * (a - 0.5) + 0.8 * (b - 0.5));
}

#ifdef HOLLOW_FLOOR
// The floor's rock at its two largest sizes, read per vertex (hollow-vertex).
varying vec4 vHollowLarge;

// The rock as hollowRock, its square shifted by an amount that changes where `region` (smooth,
// from a larger size of the rock) passes a whole number, the two shifts blended there, the
// lighter rock winning: read dozens of times across the floor, one square alone repeats in a
// lattice the eye finds. Quílez's "texture repetition", technique 3. Its gradients are `uv`'s
// (`du`, `dv` across a pixel), the unshifted square's, so the shift's steps leave no seams of
// a coarser mip level; taken once for every size it is read at.
vec4 hollowRockVaried(vec2 uv, vec2 turn, float region, vec2 du, vec2 dv) {
  mat2 m = mat2(turn.x, turn.y, -turn.y, turn.x);
  vec2 p = m * uv;
  vec2 dx = m * du;
  vec2 dy = m * dv;
  float i = floor(region);
  float f = region - i;
  vec4 a = textureGrad(uHollowRock, p + sin(vec2(3.0, 7.0) * i), dx, dy);
  vec4 b = textureGrad(uHollowRock, p + sin(vec2(3.0, 7.0) * (i + 1.0)), dx, dy);
  vec4 rock = mix(a, b, smoothstep(0.2, 0.8, f - 0.3 * (a.z - b.z)));
  rock.xy = transpose(m) * ((rock.xy * 2.0 - 1.0) * uHollowRockSlope);
  return rock;
}
#endif

#ifndef HOLLOW_FLOOR
// Along the rim, `u` world units round it, in repeats `size` long: as many whole ones as fit
// round it, so the rock meets itself at the walls' seam.
float hollowAround(float u, float size) {
  float rim = 6.2832 * uHollowShape.y;
  return u * max(floor(rim / size + 0.5), 1.0) / rim;
}

// A hash of a band's index: 0 to 1.
float hollowBandHash(float band) {
  return fract(sin(band * 127.1 + 311.7) * 43758.5453);
}

// The crust's colour `folded` under the seabed (its layers' depth, folded) and `depth` (its
// own), `mottle` its rock's blotches: one warm grey, the sea's seabed's hue at the top, the
// walls' own below, its layers telling apart by their shade more than by their hue. Sediments
// in bands of their own thickness and shade, mottled granite, darker basalt, none far from the
// others.
vec3 hollowStrata(float folded, float depth, float mottle) {
  // Sediments: bands some 1 to 3 km thick, to read from across the hollow, each a little
  // lighter or darker, a little warmer or cooler.
  float b = folded / 1800.0;
  float band = floor(b);
  float h = mix(hollowBandHash(band), hollowBandHash(band + 1.0), smoothstep(0.85, 1.0, fract(b)));
  vec3 hue = HOLLOW_BAND_HUE * mix(1.0, HOLLOW_CALM_HUE, hollowStyleCalm());
  vec3 sediment = (1.0 + HOLLOW_BAND_CONTRAST * (h - 0.5)) * (vec3(1.0) + 3.0 * hue * (h - 0.5));
  float granite = 0.95 + 0.12 * mottle;
  float basalt = 0.84 * (0.94 + 0.12 * mottle);
  vec3 shade = mix(sediment, vec3(granite), smoothstep(8000.0, 10000.0, folded));
  shade = mix(shade, vec3(basalt), smoothstep(20000.0, 23000.0, folded));
  // The seabed's hue at the walls' own shade, a little lighter, along the cut's top: the
  // ground it is cut in, at its own depth, so the rim meets the ground all round.
  vec3 bed = uScenerySeabedColor * (dot(uHollowWallColor, HOLLOW_LUMA) / max(dot(uScenerySeabedColor, HOLLOW_LUMA), 1e-4));
  vec3 tone = mix(bed * mix(HOLLOW_TOP_LIGHT, HOLLOW_CALM_TOP_LIGHT, hollowStyleCalm()), uHollowWallColor, smoothstep(0.0, HOLLOW_TOP_DEPTH, depth));
  return tone * shade;
}
#endif

void main() {
  #include <logdepthbuf_fragment>
  #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  // Past the far plane just in front of it, as the vertices are held (hollow-vertex): the
  // background lies on it, and a tie went to it, eating the far walls (2026-11-15).
  gl_FragDepth = min(gl_FragDepth, 1.0 - 1.0 / 2097152.0);
  #endif
  vec3 up = normalize(vHollowUp);
  vec3 rake = normalize(vHollowRake);
  vec3 face = normalize(vHollowNormal);
  vec2 uv = vHollowUv;
  vec3 color;
  float alt;
  float warm;

  #ifdef HOLLOW_FLOOR
  alt = -uHollowShape.x;
  if(hollowStyleSimple()) {
    // A diagram: flat, a ring every HOLLOW_SIMPLE_RINGS out from the middle, a faint grain.
    float rr = length(uv);
    float ringAt = abs(fract(rr / HOLLOW_SIMPLE_RINGS + 0.5) - 0.5) * HOLLOW_SIMPLE_RINGS;
    float rw = max(fwidth(rr), 1.0);
    float ring = 1.0 - smoothstep(0.75 * rw, 1.75 * rw, ringAt);
    float grain = hollowSimpleGrain(uv / 30000.0, uv / 3000.0);
    color = uHollowFloorColor * grain * (1.0 - HOLLOW_SIMPLE_LINE * ring) * mix(1.0, HOLLOW_SIMPLE_SHUT, uHollowView.y);
  } else {
  vec2 du = dFdx(uv);
  vec2 dv = dFdy(uv);
  // The mantle's look at large: blotches of colour and of heat, some hundreds of km across.
  // It and the rock's largest size are read per vertex (hollow-vertex).
  vec4 m = vec4(0.0, 0.0, vHollowLarge.x, 0.0);
  // The rock at three sizes, some eight to ten times apart, turned against each other, each
  // varied by the size above it, so none repeats in a lattice.
  vec4 r1 = vec4(vHollowLarge.zw, vHollowLarge.y, 0.0);
  vec4 r2 = hollowRockVaried(uv / 24000.0 + vec2(0.61, 0.05), vec2(-0.545, 0.839), r1.z * 3.0 + m.z * 2.0, du / 24000.0, dv / 24000.0);
  vec4 r3 = hollowRockVaried(uv / 2400.0 + vec2(0.19, 0.43), vec2(0.951, -0.309), r2.z * 3.0 + r1.z, du / 2400.0, dv / 2400.0);
  vec2 slope = r1.xy * 0.03 + r2.xy * 0.02 + r3.xy * 0.012;
  vec3 east = normalize(vHollowEast - face * dot(vHollowEast, face));
  vec3 north = cross(face, east);
  vec3 n = normalize(face - east * slope.x - north * slope.y);
  float edge = vHollowEdge;
  warm = smoothstep(0.15 * uHollowShape.z, uHollowShape.z, edge);
  // Charcoal, brown and rust, in blotches, the charcoal near black; cooler grey rubble toward
  // the walls' foot. Calm: the same blotches in greys.
  float calm = hollowStyleCalm();
  vec3 charcoal = mix(vec3(0.5, 0.47, 0.45), vec3(0.6), calm);
  vec3 brown = mix(vec3(1.05, 0.88, 0.76), vec3(0.82), calm);
  vec3 rust = mix(vec3(1.25, 0.82, 0.62), vec3(0.95), calm);
  vec3 tint = mix(charcoal, brown, smoothstep(0.35, 0.65, m.z));
  tint = mix(tint, rust, smoothstep(0.55, 0.8, r1.z) * smoothstep(0.4, 0.7, m.z));
  vec3 rubble = vec3(1.2, 1.15, 1.1) * (0.8 + 0.4 * r3.z);
  tint = mix(rubble, tint, smoothstep(2000.0, 18000.0, edge));
  // Its shade with deep darks: squared, so the dark rock goes near black and the light stays;
  // calm, gentler, and as light as the walls' foot it meets.
  float tone = clamp(0.6 * r2.z + 0.25 * r3.z + 0.15 * r1.z, 0.0, 1.0);
  float shade = mix(0.15 + 1.9 * tone * tone, (0.45 + 0.9 * tone) * HOLLOW_CALM_FLOOR, calm);
  float ao = mix(0.55, 1.0, smoothstep(0.0, 25000.0, edge));
  float far = hollowFar();
  // The embers' pulse here, by place and by the mantle's blotches, so it rolls across the floor.
  float pulse = hollowPulseAt(uv, m.z);
  color = uHollowFloorColor * tint * shade * hollowLight(n, up, rake, HOLLOW_RAKE_WRAP, alt, alt, warm, 1.0, pulse) * ao * mix(HOLLOW_NEAR_FLOOR, 1.0, far);
  // The fissures: the great ones, some 30 km apart, the lesser ones forking off them some 2 km
  // apart, and fine ones under 500 m; thin, glowing dully where the mantle is hot under them.
  // Close up the great ones are fields wide and fade, so the floor never looks near: only the
  // lesser and fine ones glow, faintly. From afar the great ones glow, and the hot patches
  // broadly, where the rest are finer than a pixel.
  // One read each: they glow only where the varied rock under them lets them (r1, r2), so
  // their network never shows as one repeating.
  float great = texture2D(uHollowRock, uv / 240000.0 + vec2(0.47, 0.11)).a;
  float lesser = texture2D(uHollowRock, uv / 50000.0 + vec2(0.21, 0.57)).a;
  float fine = texture2D(uHollowRock, uv / 11000.0 + vec2(0.83, 0.39)).a;
  float fissure = max(great * mix(0.2, 1.0, far), max(0.6 * lesser * smoothstep(0.35, 0.65, r1.z), 0.45 * fine * smoothstep(0.4, 0.7, r2.z)));
  // How directly the floor is seen, a Fresnel-like term: face on, looking down into the
  // hollow, it shows warm; at a slant, across the hollow, it is dull grey rock, its fissures
  // faint.
  float faceOn = smoothstep(HOLLOW_FACE_ON.x, HOLLOW_FACE_ON.y, dot(normalize(cameraPosition - vHollowWorld), face));
  float heat = smoothstep(0.25, 0.75, m.z) * warm * mix(HOLLOW_SLANT_GLOW, 1.0, faceOn);
  float glow = fissure * mix(0.04, 0.16, far) + smoothstep(0.35, 0.8, m.z) * mix(0.002, 0.035, far);
  color += uHollowEmberColor * (glow * heat * uHollowLook.x * pulse);
  // Calm, its fissures are dark cracks in the rock, fainter at a slant.
  color *= 1.0 - HOLLOW_CALM_CRACKS * calm * fissure * mix(0.4, 1.0, faceOn);
  color = mix(dot(color, vec3(0.2126, 0.7152, 0.0722)) * HOLLOW_GREY, color, faceOn);
  // Into the void's dark with distance: the floor recedes, vast, toward its walls.
  color = hollowVeil(color, alt, 1.0);
  }
  #else
  alt = uv.y;
  float depth = -alt;
  if(hollowStyleSimple()) {
    // A diagram: one even slope, matte, a line every HOLLOW_SIMPLE_LINES of depth, darker
    // toward the floor, and a shadow just under the rim, so the cut reads as an edge.
    float lineAt = abs(fract(depth / HOLLOW_SIMPLE_LINES + 0.5) - 0.5) * HOLLOW_SIMPLE_LINES;
    float lw = max(fwidth(depth), 1.0);
    float line = 1.0 - smoothstep(0.75 * lw, 1.75 * lw, lineAt);
    float lit = 0.6 + 0.4 * dot(face, rake);
    float grain = hollowSimpleGrain(vec2(hollowAround(uv.x, 20000.0), depth / 20000.0), vec2(hollowAround(uv.x, 2000.0), depth / 2000.0));
    color = uHollowWallColor * grain * lit * mix(1.0, 0.75, vHollowEdge) * (1.0 - HOLLOW_SIMPLE_LINE * line);
    color *= mix(HOLLOW_SIMPLE_EDGE.y, 1.0, smoothstep(0.0, HOLLOW_SIMPLE_EDGE.x, depth));
    color *= mix(1.0, HOLLOW_SIMPLE_SHUT, uHollowView.y);
  } else {
  // The mesh's faces turn far from the hollow's middle on the buttresses' flanks and the
  // terraces' lips: lit by them alone, under a light from one side, whole flanks fall into
  // dark slabs. The light sees them only partly: the face toward the hollow's axis, turned
  // HOLLOW_WALL_SHAPE of the way to the mesh's own.
  vec3 inward = uGlobeDisc.xyz - vHollowWorld;
  inward -= up * dot(inward, up);
  face = normalize(mix(normalize(inward), face, HOLLOW_WALL_SHAPE));
  float t = vHollowEdge;
  // Toward the foot the walls become the floor's: its rubble, its light, its shade.
  float foot = smoothstep(0.6, 1.0, t);
  warm = 0.15 * (1.0 - foot);
  // The face's rock at large: blotches of shade, which bend its strata.
  vec4 a = hollowRock(vec2(hollowAround(uv.x, 120000.0), depth / 120000.0) + vec2(0.29, 0.83), vec2(1.0, 0.0));
  // Its cliffs (createCliffTexture), at two sizes, each a whole number of tiles down the wall
  // (16 columns across a tile, 2 down, 6 ledges): one tile down the whole face, its columns
  // some 9 km wide and as tall as half the wall, its ledges some 6 km apart; and four down, on
  // them. Fitted to the wall's depth, so the face shows whole cells, not slivers of tall ones.
  float wallDepth = uHollowShape.x;
  vec4 c1 = texture2D(uHollowCliff, vec2(hollowAround(uv.x, 140000.0), depth / wallDepth));
  vec4 c2 = texture2D(uHollowCliff, vec2(hollowAround(uv.x, 35000.0), 4.0 * depth / wallDepth) + vec2(0.37, 0.61));
  // Along the rim as the tile's x runs, and down the face as its y does. Across the face only
  // half as much: under the rake's light from one side its columns would shade in vertical bands.
  vec3 around = normalize(cross(face, up));
  vec3 down = normalize(cross(face, around));
  vec2 bump = ((c1.yz * 2.0 - 1.0) * 0.6 + (c2.yz * 2.0 - 1.0) * 0.35) * vec2(0.5, 1.0) * (1.0 - foot);
  vec3 n = normalize(face + around * bump.x + down * bump.y);
  float open = mix(vHollowOpen * mix(0.85, 1.0, c1.w) * mix(0.92, 1.0, c2.w), 1.0, foot);
  // The crust in section: its layers folded, swelling and pinching round the rim; mottled by
  // the rock's round blotches more than by the cliffs' columns, which would band it upright.
  float folded = depth + (a.z - 0.5) * 5000.0 + 1500.0 * sin(hollowAround(uv.x, 120000.0) * 6.2832);
  vec3 strata = hollowStrata(folded, depth, mix(a.z, c1.x, 0.3)) * (0.9 + 0.2 * c2.x);
  // The aprons at the foot: fallen rock, the floor's rubble.
  vec3 rubble = uHollowFloorColor * vec3(1.2, 1.15, 1.1) * (0.8 + 0.4 * c2.x);
  vec3 base = mix(strata, rubble, foot);
  // Lit by the opening a quarter as fast with depth as the floor near the top, handing over to
  // the floor's falloff gradually down the whole face (no step where the foot begins); shaded
  // as the floor is along their foot; and exposed as the floor is toward it.
  float far = hollowFar();
  float exposure = mix(mix(HOLLOW_NEAR_WALL, 1.0, far), mix(HOLLOW_NEAR_FLOOR, 1.0, far), foot);
  float lit = alt * mix(HOLLOW_WALL_LIGHT, 1.0, t * t);
  // Darkening toward the floor from high up the face, to a share of its light at the foot:
  // its edge following the cliffs' shade, deeper in their creases, so it is the rock that
  // falls into shadow, not a gradient over it.
  float dusk = smoothstep(HOLLOW_WALL_DUSK.x, 1.0, t + 0.12 * (c1.x - 0.5));
  float dim = mix(1.0, HOLLOW_WALL_DUSK.y * mix(0.75, 1.0, open), dusk);
  // Calm, the foot as light as the floor it meets (HOLLOW_CALM_FLOOR).
  dim *= mix(1.0, HOLLOW_CALM_FLOOR, hollowStyleCalm() * foot);
  color = base * hollowLight(n, up, rake, HOLLOW_WALL_WRAP, lit, alt, warm, open, hollowPulseAt(hollowPlane(vHollowWorld), a.z)) * dim * exposure;
  // Under the lid the walls stand in its shade: what the opening lets in gone, as with the
  // seabed in place (hollowAbove), and darker toward their top, in one corner with the lid's
  // own dark edge (hollowLid).
  float shut = uHollowView.y;
  float corner = HOLLOW_SHUT_TOP.y * exp(min(alt, 0.0) / HOLLOW_SHUT_TOP.x);
  color *= mix(1.0, HOLLOW_SHUT_WALL, shut * uSceneryHollow.y) * (1.0 - corner * shut);
  // The cut's top edge catches the light, a little, so the crust's outline reads at any distance.
  float fp = max(fwidth(alt), 1.0);
  color *= 1.0 + HOLLOW_TOP_EDGE * (1.0 - shut) * exp(min(alt, 0.0) / max(500.0, fp));
  // Their foot into the void's dark as the floor is, so the two meet; above it, the face keeps
  // its shape across the hollow.
  color = hollowVeil(color, alt, foot);
  }
  #endif

  // From under the floor, seen through the rock.
  color *= hollowThroughRock(length(vHollowWorld - cameraPosition), vHollowWorld);
  gl_FragColor = vec4(color * uSceneryIntensity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
