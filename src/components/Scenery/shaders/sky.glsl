// Stylised sky radiance for a world-space view direction.
//
// Colours are display-referred linear values, so with no tone mapping the result
// stays in [0, 1] everywhere except at the sun. The sun colour and daylight factor
// are computed on the CPU (sky-model.ts) and shared with the directional light.

#include ./sky-gradient.glsl
#include ./sky-void.glsl
#include ./hollow.glsl
#include ./cloud-shadow.glsl

uniform vec3 uSkyNorth; // normalised, perpendicular to uSkyUp
uniform vec3 uSkyEast;
uniform float uSkySunRadiance; // disc multiplier; > 1 only when tone mapped
uniform float uSkySunDisc; // 0 in the environment / light-probe bakes: no discs, no stars
uniform vec3 uSkyMoonDirection; // world space, normalised
uniform vec3 uSkyMoonColor;
uniform float uSkyMoonSize; // angular radius, radians
uniform float uSkyMoonGlow;
uniform float uSkyMoonPhase; // share of its disc lit: 1 opposite the sun
uniform float uSkyMoonDay; // 1 while it can be up by day (an observer's moon)
uniform sampler2D uSkyMoonMap; // its albedo, longitude by latitude (sky-moon.ts)
uniform float uSkyMoonMapped; // 1 once uSkyMoonMap is in: until then a plain disc
uniform float uSkyNight; // 0 by day to 1 at night: how much the moon and the stars show
uniform vec2 uSkyStars; // brightness, and the share of the sky's cells holding one
uniform mat3 uSkyStarFrame; // world direction -> the turning star sphere's
uniform float uSkyObserved; // 1 with an observer: the catalogue's stars and the planets, over a faint procedural filler
uniform vec4 uSkyPlanets[5]; // world direction, and apparent magnitude
// How many of them are set: 0 without an observer. A uniform also keeps the loop over
// them a loop in Direct3D.
uniform int uSkyPlanetCount;
uniform sampler2D uSkyStarCells; // each cell of a cube-face grid over the star sphere: its first entry, and count
uniform sampler2D uSkyStarList; // each entry: the star's direction scaled by 2 + its B-V, and its magnitude
uniform float uSkyHorizonBlend; // width of the horizon -> ground transition, in dot(dir, up)
uniform float uSkyIntensity;
uniform float uSkyDebug; // 1: tint each part by what draws it (SceneryDebug.tint)
// The sea's levels, and whether the camera is under a stage's ground above its seabed
// (SceneryMaterial.oceanBuried), or over a stage's ground below it, in a trench
// (SceneryMaterial.oceanTrench): every layer of the background starts its view from there
// (skyViewOrigin), with a sea or not.
uniform float uSkyOceanLevel; // along uSkyUp
uniform float uSkyOceanDepth;
uniform float uSkyOceanBuried;
uniform float uSkyOceanTrench;
// How far above the sea's seabed a view from a trench starts (skyViewOrigin): within the
// water however shallow the sea. sceneryLayersShown takes the same.
#define SKY_OCEAN_TRENCH_LIFT min(1.0, 0.5 * uSkyOceanDepth)

// Debug tints (SceneryDebug.tint): the sky's own sea, seabed and void; what it leaves to a
// stage; its surface layer.
#define SKY_DEBUG_SEA vec3(0.9, 0.15, 0.1)
#define SKY_DEBUG_STAGED vec3(0.55, 0.1, 0.8)
#define SKY_DEBUG_LAYER vec3(1.0, 0.55, 0.0)
// The moon's dark side in earthshine, as a share of its lit side, near new moon.
#define SKY_EARTHSHINE 0.05
// The moon's dark side shows the air in front of it, a shade darker than the sky around it.
#define SKY_MOON_DARK 0.75
// How bright the moon shows by day, over the sky behind it.
#define SKY_MOON_DAY 0.35
// The moon's axis on the star sphere (uSkyStarFrame's): within 1.5° of the ecliptic's pole
// (right ascension 18h, declination 66.56°).
#define SKY_MOON_AXIS vec3(0.0, -0.39777, 0.91748)
// uSkyMoonMap's mean over the near side as seen from the Earth, in linear light: the albedo is
// taken over it, so the moon is as bright on the whole as a plain disc.
#define SKY_MOON_MEAN 0.2242
// The procedural stars as a faint filler under an observer's catalogue, relative to their own,
// and the magnitude the brightest of them is held to: half the light of the catalogue's
// faintest (magnitude 5), so the real stars, the planets, the sun and the moon stand out.
#define SKY_STAR_FILLER 0.12
#define SKY_STAR_FILLER_BRIGHTEST 6.5
// A star's light pulled into a crisp centre, this much brighter, at the same size.
#define SKY_STAR_CORE 1.5

// A star's profile `d` from its centre, out to `radius`.
float skyStarCore(float shine, float d, float radius) {
  float t = 1.0 - smoothstep(0.0, radius, d);
  return min(shine * SKY_STAR_CORE, 1.0) * t * t;
}

// `color` shifted halfway toward the debug `tint` of the part that drew it, while debugging.
vec3 skyDebugTint(vec3 color, vec3 tint) {
  return uSkyDebug > 0.5 ? mix(color, tint, 0.5) : color;
}

// The same of a layer (premultiplied), as much as it covers.
vec4 skyDebugTintOver(vec4 layer, vec3 tint) {
  return uSkyDebug > 0.5 ? vec4(0.5 * (layer.rgb + tint * layer.a), layer.a) : layer;
}

// A hash in [0, 1) of a point.
float skyHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// The sun's disc without tone mapping: near white, warming a little at sunrise and sunset.
#define SKY_SUN_DISC_WARM vec3(1.0, 0.86, 0.66)
// The glare once white, without tone mapping: over the bright halo it clips to a white blob twice the disc.
#define SKY_SUN_DAY_GLARE 0.25

// The sun's disc as drawn. Tone mapped, past white, so the mapping burns its core; without,
// its light's own orange would read as a flat orange disc, so it is drawn near white.
vec3 skySunDiscRadiance(SkyLight seen) {
  if(uSkySunRadiance > 1.0)
    return skySunDiscColor(seen) * uSkySunRadiance;
  return mix(vec3(1.0), SKY_SUN_DISC_WARM, min(uSkyTwilight.x * seen.twilight, 1.0));
}

uniform vec3 uSkySunGlare; // glare, rays, and the rays' shimmer phase in radians

// A ring of `count` rays about the sun: `around` the angle about it, `r` the distance from
// it in disc radii, `pixel` a pixel across the rays as a fraction of their spacing.
float skySunRayRing(float around, float r, float pixel, float count, float seed) {
  float s = around * count / 6.2831853;
  float i = floor(s + 0.5);
  float off = s - i;
  float id = mod(i, count);
  float strength = pow(skyHash(vec3(id, seed, 1.7)), 2.0);
  float reach = mix(3.0, 12.0, skyHash(vec3(id, seed, 4.3)));
  float twinkle = skyHash(vec3(id, seed, 8.9));
  strength *= 0.65 + 0.35 * sin(uSkySunGlare.z * (0.5 + twinkle) + twinkle * 6.2831853);
  // At least a pixel wide, with the same light, so the rays don't flicker near the disc.
  float width = 0.06;
  float w = max(width, pixel);
  return strength * (width / w) * exp(-off * off / (w * w)) * exp(-(r - 1.0) / reach);
}

// The glare hugging the sun's disc, and its rays, `angle` from its centre (`aa` that
// angle's change over a pixel).
float skySunGlare(vec3 dir, float angle, float aa) {
  float r = max(angle, uSkySunSize) / uSkySunSize;
  float glare = uSkySunGlare.x / (r * r);
  if(uSkySunGlare.y <= 0.0)
    return glare;
  // About the sun from its upper side, so the rays turn with neither the view nor the sun.
  vec3 side = normalize(cross(uSkySunDirection, abs(dot(uSkySunDirection, uSkyUp)) < 0.999 ? uSkyUp : uSkyNorth));
  vec3 lift = cross(side, uSkySunDirection);
  float around = atan(dot(dir, lift), dot(dir, side));
  float pixel = aa / max(angle, 1e-6) / 6.2831853;
  float rays = skySunRayRing(around, r, pixel * 16.0, 16.0, 0.0) +
    0.5 * skySunRayRing(around, r * 1.6, pixel * 40.0, 40.0, 1.0);
  return glare + uSkySunGlare.y * rays;
}

// Faint stars along `dir`, on the star sphere: at most one in each cell of a grid around
// it, kept only where it falls in its own cell so none is cut off. ⚠️ Derivatives.
float skyStars(vec3 dir) {
  const float cells = 150.0;
  vec3 p = dir * cells;
  float pixel = max(length(fwidth(p)), 1e-4);
  vec3 cell = floor(p);
  if(skyHash(cell) > uSkyStars.y)
    return 0.0;
  vec3 jitter = vec3(skyHash(cell + 1.7), skyHash(cell + 3.1), skyHash(cell + 5.3)) - 0.5;
  vec3 star = normalize(cell + 0.5 + jitter * 0.6) * cells;
  if(any(notEqual(floor(star), cell)))
    return 0.0;
  // As star counts go, N(brighter than L) ~ L^-1.5: mostly faint, a rare few at full.
  float shine = min(0.08 * pow(max(skyHash(cell + 9.2), 1e-4), -2.0 / 3.0), 1.0);
  return skyStarCore(shine, length(p - star), 1.2 * pixel);
}

// How bright a star of magnitude `m` is drawn: 0.08 at magnitude 5, and the square root
// of its light brighter, as the eye's response compresses it.
float skyStarShine(float m) {
  return 0.08 * exp2(0.6644 * (5.0 - m));
}

// How much a star of magnitude `m` shows, for the sun's elevation in degrees: Venus by
// sunset, the brightest stars a few degrees later, magnitude 5 once it is 11.5° down.
float skyStarSeen(float m, float sunElevation) {
  float onset = -4.0 - (m < 0.0 ? 1.0 : 1.5) * m;
  return 1.0 - smoothstep(onset - 2.0, onset, sunElevation);
}

// A star's colour from its B-V index: faintly blue to faintly red, as the eye sees them.
vec3 skyStarColor(float bv) {
  vec3 color = mix(vec3(0.7, 0.8, 1.0), vec3(0.9, 0.93, 1.0), smoothstep(-0.3, 0.0, bv));
  color = mix(color, vec3(1.0, 0.96, 0.88), smoothstep(0.0, 0.6, bv));
  return mix(color, vec3(1.0, 0.78, 0.58), smoothstep(0.6, 1.6, bv));
}

// A point of light `shine` bright at `star`, along `dir`, `pixel` the angle a pixel spans:
// the brighter, the wider too, so the bright ones stand out of the faint.
float skyPoint(vec3 dir, vec3 star, float shine, float pixel) {
  return skyStarCore(shine, length(dir - star), 1.2 * pixel * (1.0 + sqrt(shine)));
}

// The catalogue's stars along `s`, on the star sphere: those listed in its cell of a
// cube-face grid. ⚠️ The cell is `skyStarCell`'s (sky-star-catalogue.ts).
vec3 skyCatalogue(vec3 s, float pixel, float sunElevation) {
  int cells = textureSize(uSkyStarCells, 0).x;
  vec3 a = abs(s);
  int face;
  vec2 uv;
  if(a.x >= a.y && a.x >= a.z) {
    face = s.x > 0.0 ? 0 : 1;
    uv = s.yz / a.x;
  } else if(a.y >= a.z) {
    face = s.y > 0.0 ? 2 : 3;
    uv = s.xz / a.y;
  } else {
    face = s.z > 0.0 ? 4 : 5;
    uv = s.xy / a.z;
  }
  ivec2 cell = clamp(ivec2(floor((uv * 0.5 + 0.5) * float(cells))), ivec2(0), ivec2(cells - 1));
  vec2 entries = texelFetch(uSkyStarCells, ivec2(cell.x, face * cells + cell.y), 0).xy;
  int first = int(entries.x);
  int count = int(entries.y);
  int width = textureSize(uSkyStarList, 0).x;
  vec3 light = vec3(0.0);
  for(int i = 0; i < count; i++) {
    int k = first + i;
    vec4 star = texelFetch(uSkyStarList, ivec2(k % width, k / width), 0);
    float scale = length(star.xyz);
    float shine = skyStarShine(star.w) * skyStarSeen(star.w, sunElevation);
    light += skyStarColor(scale - 2.0) * skyPoint(s, star.xyz / scale, shine * uSkyStars.x, pixel);
  }
  return light;
}

// The naked-eye planets along `dir`, with their B-V: Mercury, Venus, Mars, Jupiter, Saturn.
vec3 skyPlanets(vec3 dir, float pixel, float sunElevation) {
  const float colorIndex[5] = float[5](0.93, 0.82, 1.36, 0.83, 1.04);
  vec3 light = vec3(0.0);
  for(int i = 0; i < uSkyPlanetCount; i++) {
    vec4 planet = uSkyPlanets[i];
    float shine = skyStarShine(planet.w) * skyStarSeen(planet.w, sunElevation);
    light += skyStarColor(colorIndex[i]) * skyPoint(dir, planet.xyz, shine * uSkyStars.x, pixel);
  }
  return light;
}

// The moon's albedo over its mean where the view meets its sphere at `normal` (toward the camera
// at the disc's middle), seen `aa` (radians) to a pixel: from its map, its north toward its axis
// and its near side's middle toward the Earth; 1 until the map is in.
float skyMoonAlbedo(vec3 normal, float aa) {
  if(uSkyMoonMapped <= 0.0)
    return 1.0;
  vec3 toEarth = -uSkyMoonDirection;
  vec3 axis = SKY_MOON_AXIS * uSkyStarFrame;
  vec3 north = normalize(axis - toEarth * dot(axis, toEarth));
  vec3 east = cross(north, toEarth);
  float latitude = asin(clamp(dot(normal, north), -1.0, 1.0));
  float longitude = atan(dot(normal, east), dot(normal, toEarth));
  vec2 uv = vec2(0.5 + longitude * RECIPROCAL_PI2, 0.5 + latitude * RECIPROCAL_PI);
  // A quarter of the map's width spans the disc's radius.
  float texels = float(textureSize(uSkyMoonMap, 0).x) / (4.0 * max(uSkyMoonSize, 1e-6));
  return textureLod(uSkyMoonMap, uv, log2(max(aa * texels, 1.0))).r / SKY_MOON_MEAN;
}

// The moon and the stars over `color`, as night falls, and by day where the sky is space, or
// its air `gone` (over the open hollow, hollowAirGone); the moon by day too, while it can be
// up. ⚠️ Derivatives.
vec3 skyNight(vec3 color, vec3 dir, float blend, float gone) {
  float height = skyCameraHeight();
  if(uSkyNight <= 0.0 && uSkyMoonDay <= 0.0 && !skyNearSpace(height) && gone <= 0.0)
    return color;
  // By day too where the sky has gone all but black, under a twentieth of its light.
  float space = max(skySpace(dir, height), gone);
  float black = smoothstep(0.95, 1.0, space);
  // From high up, by the sun over the lowered horizon, where it can still be up.
  float share = skyLightShare(dir, height);
  float night = max(mix(uSkyNight, 1.0 - uSkyAirLight.x, share), black);
  float y = skyOverSeaHorizon(dir);
  float above = smoothstep(-blend, blend, y);
  float cosMoon = dot(dir, uSkyMoonDirection);
  float angle = atan(length(cross(dir, uSkyMoonDirection)), cosMoon);
  float aa = max(fwidth(angle), 1e-5);
  float disc = 1.0 - smoothstep(uSkyMoonSize - aa, uSkyMoonSize + aa, angle);
  // The disc as a sphere lit from the sun: the phase, and which way the crescent faces.
  vec3 across = dir - uSkyMoonDirection * cosMoon;
  float r = min(angle / max(uSkyMoonSize, 1e-6), 1.0);
  vec3 normal = -uSkyMoonDirection * sqrt(1.0 - r * r) + across * (r / max(length(across), 1e-8));
  float edge = aa / max(uSkyMoonSize, 1e-6);
  float lit = smoothstep(-edge, edge, dot(normal, uSkySunDirection));
  float shown = disc * above * uSkySunDisc;
  float albedo = 1.0;
  if(shown > 0.0)
    albedo = skyMoonAlbedo(normal, aa);
  // The dark side faintly lit by the Earth, most near new moon.
  float face = (lit + SKY_EARTHSHINE * (1.0 - uSkyMoonPhase) * (1.0 - lit)) * albedo;
  // The air's glow about it: none where the view crosses no air.
  float glow = uSkyMoonGlow * uSkyMoonPhase * pow(max(cosMoon, 0.0), 200.0) * (1.0 - space);
  // The stars come out late, once it is dark, and fade low down through more air.
  float airmass = 1.0 / (max(y, 0.0) + 0.05);
  vec3 starDir = uSkyStarFrame * dir;
  float pixel = length(fwidth(dir));
  float procedural = skyStars(starDir);
  // In space as if the sun were well down.
  float sunElevation = mix(degrees(asin(skyLight(share).sunY)), -18.0, black);
  vec3 stars;
  if(uSkyObserved > 0.5 && uSkySunDisc > 0.0) {
    // The procedural ones stand in, faintly, for those past the catalogue.
    float filler = min(procedural * SKY_STAR_FILLER, skyStarShine(SKY_STAR_FILLER_BRIGHTEST)) * skyStarSeen(SKY_STAR_FILLER_BRIGHTEST, sunElevation);
    stars = skyCatalogue(starDir, pixel, sunElevation) + skyPlanets(dir, pixel, sunElevation) + filler * uSkyStars.x;
  } else {
    stars = vec3(uSkyStars.x * procedural * night * night * night);
  }
  stars *= exp(-0.25 * (airmass - 1.0));
  vec3 air = color + uSkyMoonColor * glow * night * above;
  color = air + stars * uSkySunDisc * above;
  // By night it hides the stars behind it, its dark side a shade darker than the air in
  // front of it once they are out (in twilight it is lost in the sky); by day it is a
  // pale disc over the sky.
  float darkSide = mix(1.0, SKY_MOON_DARK, skyStarSeen(2.0, sunElevation));
  vec3 dark = air * darkSide + uSkyMoonColor * SKY_EARTHSHINE * (1.0 - uSkyMoonPhase) * albedo;
  color = mix(color, mix(dark, uSkyMoonColor * albedo, lit), shown * night);
  return color + uSkyMoonColor * face * shown * uSkyMoonDay * (1.0 - night) * SKY_MOON_DAY;
}

#if defined(SKY_ABYSS) || defined(SKY_OCEAN)
#include ../../../sdk/materials/shaderLib/procedural-normal.glsl
#endif

#ifdef SKY_ABYSS
// Value noise in 3D, in [0, 1].
float skyNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  vec2 e = vec2(0.0, 1.0);
  return mix(
    mix(mix(skyHash(i), skyHash(i + e.yxx), u.x), mix(skyHash(i + e.xyx), skyHash(i + e.yyx), u.x), u.y),
    mix(mix(skyHash(i + e.xxy), skyHash(i + e.yxy), u.x), mix(skyHash(i + e.xyy), skyHash(i + e.yyy), u.x), u.y),
    u.z
  );
}
#endif

#ifdef SKY_OCEAN
// Where a stage's real geometry draws the sea instead: xy min, zw max in the wave plane.
uniform vec4 uSkyOceanStage;
// How far from the camera the stage draws it: out to the far plane, 0 while the camera is
// off its rectangle on the globe (SceneryMaterial.claimStage).
uniform float uSkyOceanStageReach;
// How far from the camera the relief draws its ground from tiles, 0 without one: from
// in the water and over a dry sea its seabed too (SceneryMaterial.oceanReliefReach).
uniform float uSkyOceanReliefReach;
// 1 while a stage's occupant's cut opens its seabed to the void (SceneryMaterial.abyssOpenings).
uniform float uSkyOceanStageOpen;
// What draws itself in the sky (the 3D clouds) as seen from the scene, all round by direction:
// premultiplied colour and alpha, without the sky's intensity; while uSkyOceanCloudsOn. The sea
// reflects it over the sky (SceneryMaterial.oceanClouds).
uniform samplerCube uSkyOceanClouds;
uniform float uSkyOceanCloudsOn;
// What the sea reflects of it away from where it was baked (skyOceanReflectedClouds,
// SceneryMaterial.setOceanCloudReflection): the lowest clouds' base (world units); the weather
// far off, a cube map fixed on the Earth of the share under cloud (r low, b middle, a high),
// and world directions into its frame; how far the cover far off follows it (x, 0 for none),
// from the field's middle where it starts to and where it has (yz, world units), and its texels
// per world unit (w).
uniform float uSkyOceanCloudBase;
uniform samplerCube uSkyOceanCloudMap;
uniform mat3 uSkyOceanCloudEarth;
uniform vec4 uSkyOceanCloudFar;

// Coordinates in the wave plane the Ocean works in: world X/Z in the default frame. Under a
// projected grid (UTM) true east and south, turned from the scene's X and Z: what floats is
// taken into it on the CPU (OceanPlane: Scenery's sampler and contact foam).
vec2 skyOceanPlane(vec3 p) {
  return vec2(dot(p, uSkyEast), -dot(p, uSkyNorth));
}

// Whether the stage draws the sea at `p`, reached `dist` along the view ray, more than
// `inset` inside its edge.
bool skyOceanOnStage(vec2 p, float dist, float inset) {
  return all(greaterThan(p, uSkyOceanStage.xy + inset)) && all(lessThan(p, uSkyOceanStage.zw - inset)) &&
    dist < uSkyOceanStageReach - inset;
}
#endif

// The sea's cutaway through the water and the seabed in front of the view (see
// WaterFogCutaway, Sky's `cutaway`): read by sky-ocean.glsl, which declares the rest of its
// uniforms. Included once here: vite-plugin-glsl inlines every #include regardless of these
// guards, and warns on a chunk included twice.
#ifdef SKY_OCEAN
#include ../../../sdk/materials/shaderLib/water-fog.glsl
uniform vec3 uSkyOceanCutawayAnchor;
uniform vec3 uSkyOceanCutawayHeading;
uniform vec3 uSkyOceanCutawayShape;
uniform vec3 uSkyOceanCutawayWaveA;
uniform vec3 uSkyOceanCutawayWaveB;
uniform vec2 uSkyOceanCutawayCuts; // how much of the water it cuts (1 all, 0 none), and whether the seabed (1 or 0)
#endif

#ifdef SKY_ABYSS
#include ./hollow-look.glsl
uniform float uSkyAbyssLevel; // height of the lid along uSkyUp, world units
uniform float uSkyAbyssFadeDistance;
uniform float uSkyAbyssTransition;
uniform float uSkyAbyssDarkening; // depth over which the void dims; 0 = off
uniform float uSkyAbyssDetail;
uniform float uSkyAbyssDetailScale; // world units
uniform vec2 uSkyAbyssDepthDetail; // the rock in the depths: strength, and feature size
// Toward the light raking the lid (world): the subsurface light's bearing
// (SceneryMaterial.setAbyssLight).
uniform vec3 uSkyAbyssLight;
// Its colours and the depths' falloff: sky-void.glsl.

// How strongly a relief's lid shows its shape in the raking light (skyAbyssLidRake).
#define SKY_ABYSS_LID_RAKE 0.6

// How a lid facing `surface` (-`up` where it lies level) is lit, against a level lid, by
// the subsurface's raking light: 1 where level, so a relief's lid meets the flat one without
// a seam; lighter on a slope facing the light, darker on one facing away.
float skyAbyssLidRake(vec3 surface, vec3 up) {
  return max(1.0 + SKY_ABYSS_LID_RAKE * dot(surface + up, uSkyAbyssLight), 0.2);
}

// The lid's ripples' cells (uSkyAbyssDetailScale) at `hit` on the lid.
vec2 skyAbyssLidCells(vec3 hit) {
  return vec2(dot(hit, uSkyEast), dot(hit, uSkyNorth)) / uSkyAbyssDetailScale;
}

// How many of the ripples' cells a pixel spans at `hit` on the lid, for skyAbyssCeilingOver.
// ⚠️ Derivatives: taken before any pixel discards or branches its own way.
float skyAbyssLidFootprint(vec3 hit) {
  vec2 d = fwidth(skyAbyssLidCells(hit));
  return max(d.x, d.y);
}

// The lid seen at `hit`, `reach` away: it recedes into the horizon colour over the fade
// distance, or never (0). Its ripples are smoothed over the `footprint` a pixel spans there
// (skyAbyssLidFootprint): it takes no derivatives. With the hollow on, the hollow's lid
// (hollow-look.glsl) everywhere, over its rim or past it, from inside it or out: the underside
// of the sediments its walls' top is cut in, rippled as the plain lid is, so nothing overhead
// changes as the camera crosses the rim.
vec3 skyAbyssCeilingOver(vec3 hit, float reach, float footprint) {
  float near = uSkyAbyssFadeDistance > 0.0 ? exp(-reach / uSkyAbyssFadeDistance) : 1.0;
  vec3 ceiling = mix(uSkyAbyssHorizonColor, uSkyAbyssCeilingColor, near);
  // Pinned to the lid, so it slides and scales as the camera moves; far hits fade out.
  float ripple = 1.0;
  if(uSkyAbyssDetail > 0.0)
    ripple += pnFbmSigned2FilteredOver(skyAbyssLidCells(hit), 5, footprint) * 2.0 * uSkyAbyssDetail * near;
  ceiling *= ripple;
  if(uSkyHollow.x > 0.5)
    ceiling = hollowLid(hit, reach, hollowInside(hit), footprint * uSkyAbyssDetailScale) * (hollowStyleSimple() ? 1.0 : ripple);
  return ceiling;
}

// The lid seen at `hit`, `reach` away (skyAbyssCeilingOver). ⚠️ Derivatives.
vec3 skyAbyssCeiling(vec3 hit, float reach) {
  return skyAbyssCeilingOver(hit, reach, skyAbyssLidFootprint(hit));
}

// Faint distant rock along `dir`, at infinity so it never moves: wavy strata broken by
// crags, strongest just below the horizon, by the camera's look up (globeCameraLook). A
// brightness factor around 1.
float skyAbyssRock(vec3 dir) {
  float depth = -dot(dir, globeCameraLook());
  if(uSkyAbyssDepthDetail.x <= 0.0 || depth <= 0.0)
    return 1.0;
  float size = max(uSkyAbyssDepthDetail.y, 1e-3);
  // On the direction itself, so it has no seam around the horizon.
  vec3 p = dir * (6.0 / size);
  float warp = skyNoise3(p * 0.7) - 0.5;
  float strata = sin((depth + warp * 0.06) * 70.0 / size + warp * 3.0);
  float crag = 1.0 - abs(2.0 * skyNoise3(p * 3.0) - 1.0);
  crag *= 0.6 + 0.4 * (1.0 - abs(2.0 * skyNoise3(p * 8.0) - 1.0));
  float rock = 0.5 * strata + (crag * crag - 0.3);
  float band = smoothstep(0.0, 0.02, depth) * exp(-depth * 4.0);
  return 1.0 + uSkyAbyssDepthDetail.x * rock * band;
}

// The gradient below the horizon (skyAbyssGradient, sky-void.glsl) along `dir`, by the
// camera's look up (globeCameraLook), so it is the same under any field, with its rock.
vec3 skyAbyssDepths(vec3 dir) {
  return skyAbyssGradient(dot(dir, globeCameraLook())) * skyAbyssRock(dir);
}

// How far the void covers the view of a camera at `origin` below its level: fading in over
// uSkyAbyssTransition, or under a sea at once at its seabed. The same for every pixel.
float skyAbyssUnder(vec3 origin) {
  float depth = uSkyAbyssLevel - globeViewHeight(origin);
  #ifdef SKY_OCEAN
    // The level is the seabed: going through it is going through rock.
  return step(0.0, depth);
  #else
  return smoothstep(0.0, uSkyAbyssTransition, depth);
  #endif
}

// How far along `dir` a view from `origin`, `depth` under the lid, meets the lid as it lies on
// the globe, seen from below: the sphere through it, from inside, so it curves down to meet
// the hollow's walls where they stand on it. Its radial at the camera's (globeCameraUp), and
// |origin − C|² − ρ² as −depth (2R + …): nothing near-equal subtracted.
float skyAbyssLidCurved(vec3 dir, float depth) {
  float R = uGlobe.x;
  float lid = uSkyAbyssLevel - globeLevel();
  float h = lid - depth;
  float b = (R + h) * dot(dir, globeCameraUp());
  float c = -depth * (2.0 * R + h + lid);
  float root = sqrt(max(b * b - c, 0.0));
  return b > 0.0 ? -c / (b + root) : root - b;
}

// Below the level, an endless lid overhead hides the sky and a bottomless gradient fills
// the view below the horizon (`depths`, skyAbyssDepths), as a layer over everything else
// (premultiplied), as much as it has faded in (skyAbyssUnder). The lid lies level over the
// camera, by its look up (globeCameraLook), as deep over it as the camera is under the seabed
// on the globe: far from the stage too, it is where that seabed is. Inside the hollow's rim
// it curves down with the globe to meet the hollow's walls (skyAbyssLidCurved), and every
// view the walls and floor leave is the lid's. Background only, so it never hides data.
vec4 skyAbyss(vec3 dir, vec3 origin, vec3 depths) {
  float depth = uSkyAbyssLevel - globeViewHeight(origin);
  float under = skyAbyssUnder(origin);
  if(under <= 0.0)
    return vec4(0.0);

  float y = dot(dir, globeCameraLook());
  // Rays that never reach the lid take the mirrored hit, so the derivatives stay continuous.
  float reach = depth / max(abs(y), 1e-6);
  // The same for every pixel: the lid's derivatives stay sound. Outside the hollow's rim, past
  // its walls, the camera is in solid rock, the void black there below the horizon.
  bool curved = uSkyHollow.x > 0.5 && globeOn() && uHollowView.x > 0.5;
  if(curved)
    reach = skyAbyssLidCurved(dir, depth);
  vec3 ceiling = skyAbyssCeiling(origin + dir * reach, reach);

  vec3 abyss = y > 0.0 || curved ? ceiling : depths;
  if(uSkyAbyssDarkening > 0.0)
    abyss *= exp(-depth / uSkyAbyssDarkening);

  return vec4(abyss * under, under);
}
#endif

#ifdef SKY_OCEAN
#include ./sky-ocean.glsl
#endif

// The background is drawn in layers, each blended over those before it (scenery-layers.ts):
// the sky itself (skyAir), the void (skyAbyssLayer), the sea from
// the air (skySeaLayer) or the view in the water (skyWaterLayer), and the sea's surface
// (skyOceanSurfaceLayer). Each but the sky is premultiplied: its alpha is how much it hides of
// those before it. Each is a program of its own, so each compiles on its own, and switching
// one recompiles only its own.

// Where every layer's view starts: the camera. Under a stage's ground it is in the rock:
// seen as from just below the sea's seabed, by its height over the globe, which far off lies
// well below the scene's level. Over a stage's ground below the sea's seabed, in a trench,
// it is in the water: seen as from just above that seabed.
vec3 skyViewOrigin() {
  float altitude = globeCameraHeight() - uSkyOceanLevel;
  if(uSkyOceanBuried > 0.5)
    return cameraPosition - uSkyUp * (altitude + uSkyOceanDepth + 1.0);
  if(uSkyOceanTrench > 0.5)
    return cameraPosition - uSkyUp * (altitude + uSkyOceanDepth - SKY_OCEAN_TRENCH_LIFT);
  return cameraPosition;
}

// The width of the horizon's blend along `dir`, at least a pixel, by the camera's look up
// (the sky as the camera sees it; what lies under the field, by the scene's).
float skyBlendAt(vec3 dir) {
  return max(uSkyHorizonBlend, fwidth(dot(dir, globeCameraLook())));
}

// The sky itself, under every other layer: the air with the sun, the moon and the stars; with
// no sky (`background: 'void'`) the void's gradient all round, as the stand-in draws it, from
// the horizon the Earth's curve lowers, so it meets the far lid's haze without a seam.
// ⚠️ Derivatives.
vec3 skyAir(vec3 dir, float blend) {
  float y = dot(dir, globeCameraLook());
  float horizon = skyHorizon(dir);
  #ifdef SKY_VOID
  return skyVoidGradient(skyOverHorizon(y, horizon));
  #else
  // Below the horizon into the hollow's open opening: the view dips into the hollow and out
  // again over the globe at the angle it went in, meeting nothing but the air beyond, not the
  // ground the sky paints there: the sky as far over the horizon as it looks under it, along
  // its bearing, so the sky runs on mirrored down to the far rim.
  vec3 sees = dir;
  if(uSkyHollow.y > 0.5 && y < horizon) {
    vec2 hit = globeReach(cameraPosition, dir, 0.0);
    // From at or under the sea's level, inside the rim, every view down is into the opening:
    // there is no level for it to meet first.
    bool into = globeCameraHeight() - globeLevel() <= 0.0 ? hollowInside(cameraPosition) > 0.0 : hit.y < 0.5 && hollowOpenAt(cameraPosition + dir * hit.x);
    if(into) {
      vec3 level = dir - globeCameraLook() * y;
      float over = horizon - skyOverHorizon(y, horizon) * (1.0 - horizon);
      sees = level * inversesqrt(max(dot(level, level), 1e-12)) * sqrt(max(1.0 - over * over, 0.0)) + globeCameraLook() * over;
    }
  }
  vec3 color = skySurface(sees, blend);
  // Over the open hollow its air is drained (hollowAirGone): the sky there darkens toward space's.
  float gone = hollowAirGone();
  color *= 1.0 - gone;
  if(uSkySunDisc > 0.0) {
    float cosSun = dot(dir, uSkySunDirection);
    // atan2 keeps the angle precise for the small radii a disc uses.
    float angle = atan(length(cross(dir, uSkySunDirection)), cosSun);
    float aa = max(fwidth(angle), 1e-5);
    float disc = 1.0 - smoothstep(uSkySunSize - aa, uSkySunSize + aa, angle);
    SkyLight seen = skyLight(skyLightShare(uSkySunDirection, skyCameraHeight()));
    // Reddened only by the air the view toward it crosses: from space, white, but through
    // the air along the Earth's edge still red.
    float bare = skySpace(uSkySunDirection, skyCameraHeight());
    seen.sun = mix(seen.sun, SKY_SUN_HIGH, bare);
    seen.twilight *= 1.0 - bare;
    color = mix(color, skySunDiscRadiance(seen), disc * uSkySunDisc);
    // Over the disc too, so it is never dimmer than its glare; above the horizon, while the sun is up.
    float sunOver = skyOverHorizon(dot(uSkySunDirection, globeCameraLook()), skyHorizon(uSkySunDirection));
    float up = smoothstep(-blend, 0.0, skyOverHorizon(y, horizon)) * smoothstep(-uSkySunSize, uSkySunSize, sunOver);
    vec3 light = skyTwilightLight(seen);
    // Full while warm (to ~15° up), a quarter once white (~20°).
    float white = min(light.r, min(light.g, light.b)) / max(max(light.r, max(light.g, light.b)), 1e-4);
    float glare = uSkySunRadiance > 1.0 ? 1.0 : mix(1.0, SKY_SUN_DAY_GLARE, smoothstep(0.3, 0.7, white));
    color += light * skySunGlare(dir, angle, aa) * glare * up * uSkySunDisc * (1.0 - gone);
  }
  return skyNight(color, dir, blend, gone);
  #endif
}

#ifdef SKY_ABYSS
// The void: for a camera below its level, the lid overhead and the depths below the horizon,
// over everything, as much as it has faded in (skyAbyss). From above it, with a sea, the
// depths where the sea's layers leave them showing (skyOceanShowsVoid), under those layers:
// nothing elsewhere. ⚠️ Derivatives.
vec4 skyAbyssLayer(vec3 dir, vec3 origin) {
  #ifdef SKY_OCEAN
  SkyOceanStagedView staged = skyOceanStagedView(dir, origin);
  #endif
  float under = skyAbyssUnder(origin);
  bool shown = under > 0.0;
  #ifdef SKY_OCEAN
  if(!shown)
    shown = skyOceanShowsVoid(dir, origin, staged);
  #endif

  // The void below the horizon, with its rock: taken once, as each call compiles a copy.
  vec3 depths = vec3(0.0);
  if(shown) {
    #ifdef SKY_OCEAN
    depths = skyOceanVoid(dir);
    #else
    depths = skyAbyssDepths(dir);
    #endif
  }

  vec4 layer = vec4(0.0);
  // The same for every pixel: the lid's derivatives stay sound.
  if(under > 0.0)
    layer = skyAbyss(dir, origin, depths);
  else if(shown)
    layer = vec4(depths, 1.0);
  return skyDebugTintOver(layer, SKY_DEBUG_SEA);
}
#endif

#ifdef SKY_OCEAN
// Where a stage draws the sea, the sea's layer leaves what shows through its gaps: beyond
// its seabed, below the horizon, the water the cutaway left over the void (skyAbyssLayer);
// without a void, the sky. `layer` is the sea's own elsewhere.
vec4 skyOceanStagedOver(vec4 layer, SkyOceanStagedView staged, vec3 dir, vec3 origin) {
  if(!staged.staged)
    return skyDebugTintOver(layer, SKY_DEBUG_SEA);
  #ifdef SKY_ABYSS
  if(staged.below)
    layer = skyOceanThroughCutawayOver(dir, origin);
  #else
  layer = vec4(0.0);
  #endif
  return skyDebugTintOver(layer, SKY_DEBUG_STAGED);
}

// The sea seen from the air, or a dry sea's bed from below its level: the seabed through the
// water, over the void (skyOceanFromAir). Nothing from in the water (skyWaterLayer), nor from
// below the seabed. ⚠️ Derivatives.
vec4 skySeaLayer(vec3 dir, vec3 origin, float blend) {
  SkyOceanStagedView staged = skyOceanStagedView(dir, origin);
  bool water = skyOceanNeedsWaterView(origin);
  vec4 sea = vec4(0.0);
  // Staged pixels are left to the stage; their sea is skipped where the quad surely is.
  if(!staged.skip && !water && skyOceanSeesBed(origin)) {
    vec3 reach = skyOceanBedReach(origin, dir, false);
    vec3 bedPoint = origin + dir * reach.x;
    vec3 bedUp = globeUpAt(bedPoint);
    float bedDepth = uSkyOceanDepth;
    // From the air over water, the seabed the water in front of it reads (skyOceanWaterUnder):
    // as deep as the ground lies there (skyOceanDepthAt), on the line of sight, lit as that
    // deep. Not bent at the surface: the stage's seabed and the relief lie where they are, and
    // this one meets them. On the sea's own depth, near a shore the water let a bed through
    // that was lit as that deep: with clear water bright, the shallows reading as deep; with
    // realistic water black, a dark rim along every coast.
    float altitude = skyOceanViewAltitude(origin);
    if(uSkyOceanWater > 0.5 && altitude > 0.0) {
      vec3 at = origin + dir * skyOceanReach(origin, dir, altitude).x;
      bedUp = globeUpAt(at);
      bedDepth = skyOceanDepthAt(at);
      bedPoint = at + dir * (bedDepth / max(-dot(dir, bedUp), 1e-3));
    }
    vec3 bed = skyOceanBed(bedPoint, bedUp, bedDepth);
    bool reached;
    sea = skyOceanFromAir(dir, origin, blend, reach, bed, reached);
    #ifndef SKY_ABYSS
    if(reached)
      sea = skyOceanOverVoid(sea, dir);
    #endif
  }
  return water ? vec4(0.0) : skyOceanStagedOver(sea, staged, dir, origin);
}

// The view from in the water: the surface's underside above, the seabed below, water all
// round, over the void (skyOceanInWaterOver). Up through the cutaway's cut, which takes the
// surface over it too, the sky before it shows. Nothing from anywhere else. ⚠️ Derivatives.
vec4 skyWaterLayer(vec3 dir, vec3 origin, float blend) {
  SkyOceanStagedView staged = skyOceanStagedView(dir, origin);
  bool water = skyOceanNeedsWaterView(origin);
  vec4 view = vec4(0.0);
  // Under an opaque seabed with no opening in it, below the horizon, the water's own view
  // everywhere, the stage's area included: what the stage draws hides it by depth, at no
  // cost, and a gap shows the water, as it would, not the void. A relief's ground deeper
  // than the sea's depth curves away below the view a pixel or so short of the horizon the
  // sea's seabed has. The cutaway takes it as it takes the stage's.
  bool own = water && staged.staged && staged.below && uSkyOceanSeabedOpacity >= 1.0 && uSkyOceanStageOpen < 0.5;
  if((!staged.skip || own) && water) {
    vec3 reach = skyOceanBedReach(origin, dir, true);
    vec3 bedPoint = origin + dir * reach.x;
    vec3 bed = skyOceanBed(bedPoint, globeUpAt(bedPoint), uSkyOceanDepth);
    view = skyOceanInWaterOver(origin, dir, blend, reach.x, bed);
    #ifndef SKY_ABYSS
    view = skyOceanOverVoid(view, dir);
    #endif
    float rise = dot(dir, globeCameraUp());
    bool through = rise > 0.0 && skyOceanCutawayWall(origin, dir) * rise > -skyOceanViewAltitude(origin);
    if(through)
      view *= 1.0 - uSkyOceanCutawayCuts.x;
  }
  if(own)
    return skyDebugTintOver(view, SKY_DEBUG_SEA);
  return water ? skyOceanStagedOver(view, staged, dir, origin) : vec4(0.0);
}
#endif