// Stylised sky radiance for a world-space view direction.
//
// Colours are display-referred linear values, so with no tone mapping the result
// stays in [0, 1] everywhere except at the sun. The sun colour and daylight factor
// are computed on the CPU (sky-model.ts) and shared with the directional light.

#include ./sky-gradient.glsl

uniform vec3 uSkyNorth; // normalised, perpendicular to uSkyUp
uniform vec3 uSkyEast;
uniform float uSkySunSize; // angular radius, radians
uniform float uSkySunRadiance; // disc multiplier; > 1 only when tone mapped
uniform float uSkySunDisc; // 0 in the environment / light-probe bakes: no discs, no stars
uniform vec3 uSkyMoonDirection; // world space, normalised
uniform vec3 uSkyMoonColor;
uniform float uSkyMoonSize; // angular radius, radians
uniform float uSkyMoonGlow;
uniform float uSkyNight; // 0 by day to 1 at night: how much the moon and the stars show
uniform vec2 uSkyStars; // brightness, and the share of the sky's cells holding one
uniform float uSkyHorizonBlend; // width of the horizon -> ground transition, in dot(dir, up)
uniform float uSkyIntensity;
uniform float uSkyDebug; // 1: tint each part by what draws it (SkyDebug.tint)

// Debug tints (SkyDebug.tint): the sky's own sea, seabed and void; what it leaves to a
// stage; its surface layer.
#define SKY_DEBUG_SEA vec3(0.9, 0.15, 0.1)
#define SKY_DEBUG_STAGED vec3(0.55, 0.1, 0.8)
#define SKY_DEBUG_LAYER vec3(1.0, 0.55, 0.0)

// `color` shifted halfway toward the debug `tint` of the part that drew it, while debugging.
vec3 skyDebugTint(vec3 color, vec3 tint) {
  return uSkyDebug > 0.5 ? mix(color, tint, 0.5) : color;
}

// A hash in [0, 1) of a point.
float skyHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
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

// Faint stars along `dir`, fixed in the sky: at most one in each cell of a grid around
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
  // Mostly faint, a few brighter.
  float shine = 0.15 + 0.85 * pow(skyHash(cell + 9.2), 3.0);
  return shine * (1.0 - smoothstep(0.0, 1.2 * pixel, length(p - star)));
}

// The moon and the stars over `color`, as night falls. ⚠️ Derivatives.
vec3 skyNight(vec3 color, vec3 dir, float blend) {
  if(uSkyNight <= 0.0)
    return color;
  float above = smoothstep(-blend, blend, dot(dir, uSkyUp));
  float cosMoon = dot(dir, uSkyMoonDirection);
  float angle = atan(length(cross(dir, uSkyMoonDirection)), cosMoon);
  float aa = max(fwidth(angle), 1e-5);
  float disc = 1.0 - smoothstep(uSkyMoonSize - aa, uSkyMoonSize + aa, angle);
  float glow = uSkyMoonGlow * pow(max(cosMoon, 0.0), 200.0);
  // The stars come out late, once it is dark.
  float stars = uSkyStars.x * skyStars(dir) * uSkyNight * uSkyNight * uSkyNight;
  color += (uSkyMoonColor * glow * uSkyNight + vec3(stars * uSkySunDisc)) * above;
  return mix(color, uSkyMoonColor, disc * uSkyNight * above * uSkySunDisc);
}

#if defined(SKY_ABYSS) || defined(SKY_OCEAN) || defined(SKY_CLOUDS)
#include ../../../sdk/materials/shaderLib/procedural-normal.glsl
#endif

#ifdef SKY_CLOUDS
uniform vec4 uSkyClouds; // coverage, altitude along up, feature size (world units), edge softness
uniform vec4 uSkyCloudsColor; // lit colour, and opacity
uniform vec2 uSkyCloudsSeed; // offset of the pattern

// Still clouds on a deck over `color`, seen from `origin` below it along `dir`, lit by
// the sun, or the moon at night. Far off they melt into `haze`, the sky without its sun
// disc, moon and stars, which they hide. They fade out as the camera climbs to the deck.
// ⚠️ Derivatives.
vec3 skyClouds(vec3 color, vec3 haze, vec3 dir, vec3 origin) {
  float below = uSkyClouds.y - dot(origin, uSkyUp);
  float fade = 1.0 - smoothstep(0.5, 1.0, 1.0 - below / uSkyClouds.y);
  if(fade <= 0.0)
    return color;
  float y = dot(dir, uSkyUp);
  // Rays that never reach the deck take the mirrored hit, so the derivatives stay continuous.
  float t = below / max(abs(y), 1e-4);
  vec3 hit = origin + dir * t;
  vec2 p = vec2(dot(hit, uSkyEast), dot(hit, uSkyNorth)) / uSkyClouds.z + uSkyCloudsSeed;
  float n = pnFbmSigned2Filtered(p, 5) + 0.5;

  // Denser toward the light, the darker the side seen from below.
  vec3 light = uSkyDaylight > 0.0 ? uSkySunDirection : uSkyMoonDirection;
  vec2 toward = vec2(dot(light, uSkyEast), dot(light, uSkyNorth));
  float ahead = pnFbmSigned2Filtered(p + toward * 0.25, 3) + 0.5;
  float threshold = mix(0.68, 0.32, uSkyClouds.x);
  float edge = 0.02 + 0.2 * uSkyClouds.w;
  float density = smoothstep(threshold - edge, threshold + edge, n);
  float lit = clamp(1.0 - (ahead - n) * 4.0, 0.35, 1.0);

  vec3 ambient = mix(uSkyHorizonColor, uSkyZenithColor, 0.5) * mix(0.15, 1.0, uSkyDaylight);
  vec3 direct = uSkyDaylight > 0.0 ? uSkySunColor * uSkyDaylight : uSkyMoonColor * uSkyNight * 0.25;
  vec3 cloud = uSkyCloudsColor.rgb * (ambient * 0.55 + direct * lit * 0.75);
  float cosLight = dot(dir, light);
  // A bright rim where they thin toward the light.
  cloud += direct * (1.0 - density) * pow(max(cosLight, 0.0), 8.0) * 0.6;
  // Optical depth: none where the edge begins, enough in the cores to hide the sun.
  float tau = max(n - threshold + edge, 0.0) * 30.0;
  float transmit = exp(-tau);
  // Forward scattering (Henyey-Greenstein, g 0.85, 1 at the light): the glow around it,
  // brightest where the cloud is about one optical depth thick.
  float phase = 0.003375 / pow(1.7225 - 1.7 * cosLight, 1.5);
  cloud += direct * phase * tau * transmit * 2.718 * uSkySunDisc;
  // Far off they melt into the haze at the horizon.
  float far = 1.0 - exp(-t / (uSkyClouds.z * 15.0));
  cloud = mix(cloud, haze, far * 0.8);

  // The light itself, far brighter than the sky it hides, shows through all but the cores,
  // softer the thicker the cloud.
  bool day = uSkyDaylight > 0.0;
  float size = day ? uSkySunSize : uSkyMoonSize;
  float angle = atan(length(cross(dir, light)), cosLight);
  float soft = max(fwidth(angle), 1e-5) + size * min(tau * 0.5, 1.0);
  float disc = 1.0 - smoothstep(size - soft, size + soft, angle);
  float through = disc * min(100.0 * transmit, 1.0) * (day ? 1.0 : uSkyNight) * uSkySunDisc;
  cloud = mix(cloud, day ? uSkySunColor * uSkySunRadiance : uSkyMoonColor, through);

  float above = smoothstep(0.0, 0.03, y);
  return mix(color, cloud, density * uSkyCloudsColor.a * fade * above);
}
#endif

#ifdef SKY_OCEAN
// Where a stage's real geometry draws the sea instead: xy min, zw max in the wave plane.
uniform vec4 uSkyOceanStage;
// How far from the camera the stage draws it: short of the far plane, which clips it.
uniform float uSkyOceanStageReach;

// Coordinates in the wave plane the Ocean works in: world X/Z in the default frame.
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

#ifdef SKY_ABYSS
uniform float uSkyAbyssLevel; // height of the lid along uSkyUp, world units
uniform vec3 uSkyAbyssCeilingColor;
uniform vec3 uSkyAbyssHorizonColor;
uniform vec3 uSkyAbyssDepthColor;
uniform float uSkyAbyssFadeDistance;
uniform float uSkyAbyssTransition;
uniform float uSkyAbyssDarkening; // depth over which the void dims; 0 = off
uniform float uSkyAbyssDetail;
uniform float uSkyAbyssDetailScale; // world units
uniform vec2 uSkyAbyssDepthDetail; // the rock in the depths: strength, and feature size
uniform float uSkyAbyssFalloff; // exponent of the depths' gradient below the horizon

// The lid seen at `hit`, `reach` away: it recedes into the horizon colour. ⚠️ Derivatives.
vec3 skyAbyssCeiling(vec3 hit, float reach) {
  float near = exp(-reach / uSkyAbyssFadeDistance);
  vec3 ceiling = mix(uSkyAbyssHorizonColor, uSkyAbyssCeilingColor, near);
  if(uSkyAbyssDetail > 0.0) {
    // Pinned to the lid, so it slides and scales as the camera moves; far hits fade out.
    vec2 cells = vec2(dot(hit, uSkyEast), dot(hit, uSkyNorth)) / uSkyAbyssDetailScale;
    ceiling *= 1.0 + pnFbmSigned2Filtered(cells, 5) * 2.0 * uSkyAbyssDetail * near;
  }
  return ceiling;
}

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

// Faint distant rock along `dir`, at infinity so it never moves: wavy strata broken by
// crags, strongest just below the horizon. A brightness factor around 1.
float skyAbyssRock(vec3 dir) {
  float depth = -dot(dir, uSkyUp);
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

// The bottomless gradient below the horizon, for a view ray at height `y` along up.
vec3 skyAbyssGradient(float y) {
  return mix(uSkyAbyssHorizonColor, uSkyAbyssDepthColor, pow(max(-y, 0.0), uSkyAbyssFalloff));
}

// The same along `dir`, with its rock.
vec3 skyAbyssDepths(vec3 dir) {
  return skyAbyssGradient(dot(dir, uSkyUp)) * skyAbyssRock(dir);
}

// Below the level, an endless lid overhead hides the sky and a bottomless gradient fills
// the view below the horizon (`depths`, skyAbyssDepths). Background only, so it never
// hides data.
vec3 skyAbyss(vec3 color, vec3 dir, vec3 origin, vec3 depths) {
  float depth = uSkyAbyssLevel - dot(origin, uSkyUp);
  #ifdef SKY_OCEAN
    // The level is the seabed: going through it is going through rock.
  float under = step(0.0, depth);
  #else
  float under = smoothstep(0.0, uSkyAbyssTransition, depth);
  #endif
  if(under <= 0.0)
    return color;

  float y = dot(dir, uSkyUp);
  // Rays that never reach the lid take the mirrored hit, so the derivatives stay continuous.
  float reach = depth / max(abs(y), 1e-6);
  vec3 hit = origin + dir * reach;
  vec3 ceiling = skyAbyssCeiling(hit, reach);

  vec3 abyss = y > 0.0 ? ceiling : depths;
  if(uSkyAbyssDarkening > 0.0)
    abyss *= exp(-depth / uSkyAbyssDarkening);

  return mix(color, abyss, under);
}
#endif

#ifdef SKY_OCEAN
#include ./sky-ocean.glsl
#endif

vec3 skyRadiance(vec3 dir, vec3 origin) {
  #ifdef SKY_OCEAN
    // Inside an occupant's seabed the camera is in the ground: seen as from just below the sea's.
  if(uSkyOceanBuried > 0.5)
    origin -= uSkyUp * (dot(origin, uSkyUp) - uSkyOceanLevel + uSkyOceanDepth + 1.0);
  #endif
  float y = dot(dir, uSkyUp);
  float blend = max(uSkyHorizonBlend, fwidth(y));

  vec3 color = skySurface(dir, blend);
  #ifdef SKY_CLOUDS
  vec3 haze = color;
  #endif

  if(uSkySunDisc > 0.0) {
    float cosSun = dot(dir, uSkySunDirection);
    // atan2 keeps the angle precise for the small radii a disc uses.
    float angle = atan(length(cross(dir, uSkySunDirection)), cosSun);
    float aa = max(fwidth(angle), 1e-5);
    float disc = 1.0 - smoothstep(uSkySunSize - aa, uSkySunSize + aa, angle);
    color = mix(color, uSkySunColor * uSkySunRadiance, disc * uSkySunDisc);
    // Over the disc too, so it is never dimmer than its glare; above the horizon, while the sun is up.
    float up = smoothstep(-blend, 0.0, y) * smoothstep(-uSkySunSize, uSkySunSize, dot(uSkySunDirection, uSkyUp));
    color += uSkySunColor * skySunGlare(dir, angle, aa) * up * uSkySunDisc;
  }
  color = skyNight(color, dir, blend);
  #ifdef SKY_CLOUDS
  color = skyClouds(color, haze, dir, origin);
  #endif

  // The void below the horizon, with its rock: taken once, as each call compiles a copy.
  #if defined(SKY_OCEAN)
  vec3 depths = skyOceanVoid(dir);
  #elif defined(SKY_ABYSS)
  vec3 depths = skyAbyssDepths(dir);
  #endif

  bool skip = false;
  #ifdef SKY_OCEAN
  vec3 open = color;
    // Kept a few pixels inside the stage's rim, so the rim still has the seabed behind it.
    // Without a seabed there is nothing to leave to the stage, nor from inside an occupant's.
  bool staged = skyOceanStaged(dir, origin, 4.0, false) && uSkyOceanSeabed > 0.5 && uSkyOceanBuried < 0.5;
    // Staged pixels are replaced below; their sea is skipped where the quad surely is.
  bool surelyStaged = skyOceanStaged(dir, origin, 8.0, true);
  skip = staged && surelyStaged;
  // One view in the water for both uses below: each call compiles a full copy of the waves.
  vec3 inWater = open;
  if(!skip && skyOceanNeedsWaterView(origin))
    inWater = skyOceanWaterView(dir, origin, blend, depths);
  if(!skip)
    color = skyOcean(color, dir, origin, inWater, depths);
  #endif

  #ifdef SKY_ABYSS
  // Not skipped: from the void the lid shows through a stage's gaps too, as through an
  // occupant's section or a see-through column. Above the void it returns at once.
  color = skyAbyss(color, dir, origin, depths);
  #endif

  #if defined(SKY_OCEAN) && defined(SKY_ABYSS)
  if(uSkyOceanSeabed < 0.5) {
    vec3 fromBelow = skyOceanFromBelow(dir, origin, open, inWater);
    if(y > 0.0 && dot(origin, uSkyUp) < uSkyAbyssLevel)
      color = fromBelow;
  }
  #endif

  #ifdef SKY_OCEAN
    // The stage draws the sea here; what shows through its gaps lies beyond its seabed.
  if(staged) {
      #ifdef SKY_ABYSS
    color = y < 0.0 ? skyOceanThroughCutaway(depths, dir, origin) : color;
      #else
    color = open;
      #endif
  }
  if(staged)
    color = skyDebugTint(color, SKY_DEBUG_STAGED);
  else if(any(notEqual(color, open)))
    color = skyDebugTint(color, SKY_DEBUG_SEA);
  #endif

  return color * uSkyIntensity;
}
