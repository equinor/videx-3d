// A stage's real geometry, shaded with the sky's own sea so it continues the background
// without a seam. STAGE_SURFACE or STAGE_BED is defined; STAGE_SEE_THROUGH marks a seabed
// drawn at the sea's seabed opacity. STAGE_CURVED_DEPTH has the surface write the depth of
// the curved sea, for a relief.

#include <common>
#include <logdepthbuf_pars_fragment>
#include ./sky.glsl

uniform mat4 uSkyStageInverseProjection;
uniform vec4 uSkyStageViewport; // the pixels being drawn: x, y, width, height

varying vec3 vStageWorld;
varying vec3 vViewPosition;

#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

// The view ray through this pixel. ⚠️ Not from vStageWorld: across the stage's
// far-reaching triangles, an interpolated position is metres off and seams the ripples.
// ⚠️ And built in view space: a world point minus the camera cancels away float precision.
vec3 stageViewRay() {
  vec2 ndc = (gl_FragCoord.xy - uSkyStageViewport.xy) / uSkyStageViewport.zw * 2.0 - 1.0;
  // A point on the ray, whichever way the depth range runs.
  vec4 point = uSkyStageInverseProjection * vec4(ndc, 0.0, 1.0);
  return normalize(transpose(mat3(viewMatrix)) * (point.xyz / point.w));
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 dir = stageViewRay();
  float blend = max(uSkyHorizonBlend, fwidth(dot(dir, uSkyUp)));
  float altitude = dot(cameraPosition, uSkyUp) - uSkyOceanLevel;
  float y = dot(dir, uSkyUp);

  // The flat caps are shaded where the ray meets their plane, exactly; from above, beyond the
  // scene, where it meets them falling away with the Earth's curve, as the sky's own sea.
  #if defined(STAGE_SURFACE)
  float planeAltitude = altitude;
  #else
  float planeAltitude = altitude + uSkyOceanDepth;
  #endif
  vec3 reach = planeAltitude > 0.0 ? skyOceanReach(cameraPosition, dir, planeAltitude) : vec3(-planeAltitude / max(abs(y), 1e-6), 0.0, 0.0);
  vec3 world = cameraPosition + dir * reach.x;
  #ifdef STAGE_CURVED_DEPTH
  // At the sea's own depth where it falls away with the curve, which a relief beyond the
  // scene, falling away with it, meets. Over the scene's own disc at the geometry's: the
  // scene is flat, and a curve measured from the disc under a high camera sinks it below.
  vec3 fromScene = vStageWorld - uSkyStageFlat.xyz;
  fromScene -= uSkyUp * dot(fromScene, uSkyUp);
  if(dot(fromScene, fromScene) > uSkyStageFlat.w * uSkyStageFlat.w) {
    vec3 viewHit = mat3(viewMatrix) * dir * reach.x;
    #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
    gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(1.0 - viewHit.z) * logDepthBufFC * 0.5;
    #else
    vec4 clipHit = projectionMatrix * vec4(viewHit, 1.0);
    gl_FragDepth = 0.5 * clipHit.z / clipHit.w + 0.5;
    #endif
  }
    #ifndef USE_LOGARITHMIC_DEPTH_BUFFER
  else
    gl_FragDepth = gl_FragCoord.z;
    #endif
  #endif
  vec2 p = skyOceanPlane(world);
  float texel = max(length(fwidth(p)), 1e-3);
  float dist = distance(cameraPosition, world);
  #ifdef STAGE_SURFACE
  vec2 rimAt = skyOceanCutawayRimAt(world, cameraPosition);
  #endif
  // The sky draws the band a pixel inside the stage's edge (see skyOceanStaged), and the
  // stage leaves it, and everything beyond, alone.
  bool dry = uSkyOceanWater < 0.5;
  float bedAltitude = altitude + uSkyOceanDepth;
  bool staged = skyOceanStaged(dir, cameraPosition, 1.0, false);
  bool outsideWater = dry || altitude > 0.0 || bedAltitude < 0.0;
  bool skyDraws = outsideWater && !staged;
  // From the void the lid hides the water, seabed or not: through an occupant's section,
  // or a see-through one, the background draws it.
  bool underLid = bedAltitude < 0.0;
  // Over the curved sea's horizon there is none, nor a seabed under it: the background's sky shows.
  #if defined(STAGE_SURFACE)
  float overSea = reach.z;
  #else
  vec3 surfaceReach = skyOceanReach(cameraPosition, dir, altitude);
  float overSea = altitude > 0.0 && !dry ? surfaceReach.z : bedAltitude > 0.0 && dry ? reach.z : 0.0;
  #endif
  bool overCurve = uSkyCurvature > 0.0 && planeAltitude > 0.0 && overSea > 0.5;

  #if defined(STAGE_SURFACE)
  // One wave for both sides: each call compiles a full copy of it.
  SkyOceanWave wave = skyOceanWave(p, texel, dist);
  skyOceanTiltWave(wave, dir, reach.y);
  bool cutThrough = false;
  if(altitude > 0.0) {
    vec4 surface = skyOceanThroughAir(skyOceanSurfaceOf(wave, p, texel, dir, blend), cameraPosition, dir, dist, blend);
    gl_FragColor = skyOceanCutawayMark(surface, world, rimAt);
  } else {
    vec3 underside = skyOceanUndersideOf(-wave.normal, dir, blend, -altitude);
    float wall = skyOceanCutawayWall(cameraPosition, dir);
    // The cutaway's cut takes the surface over it too: the background shows the sky there.
    float kept = wall >= dist ? 1.0 - uSkyOceanCutawayCuts.x : 1.0;
    cutThrough = kept < 1e-3;
    float path = skyOceanCutawayPath(skyOceanWaterPath(cameraPosition, world), wall, 1.0);
    vec3 seen = skyOceanFog(underside, path, skyOceanLight(-0.5 * altitude));
    gl_FragColor = vec4(seen, kept);
  }
  if(skyDraws || underLid || cutThrough || overCurve)
    discard;
  #else
  vec3 up = uSkyUp;
  float bedDepth = uSkyOceanDepth;
  bool fromAbove = altitude + bedDepth > 0.0;
  // Shaded on the side the camera is on, the same all over the flat seabed: from below
  // only its lid is shaded.
  vec3 color = vec3(0.0);
  if(fromAbove)
    color = skyOceanBed(world, up, bedDepth);
  float cutaway = skyOceanCutawayAlong(cameraPosition, world);
  float seabed = skyOceanCutawaySeabed(cutaway);
    #ifdef SKY_ABYSS_WALLS
  // The lid's ripples' footprint, before any pixel leaves or takes its own side below.
  float lidFootprint = skyAbyssLidFootprint(cameraPosition + dir * dist);
    #endif
  if(fromAbove) {
    // Dry, the fog's density is 0.
    float light = skyOceanLight(0.5 * (bedDepth + max(-altitude, 0.0)));
    float below = skyOceanPathBelowSurface(cameraPosition, world);
    // Beyond the scene both fall away with the curve: the water lies between them, not under the level.
    if(altitude > 0.0 && uSkyCurvature > 0.0)
      below = max(reach.x - surfaceReach.x, 0.0);
    float path = skyOceanCutawayPath(below, skyOceanCutawayWall(cameraPosition, dir), skyOceanCutawayWater(cutaway));
    color = skyOceanFog(color, path, light);
      #ifndef STAGE_SEE_THROUGH
        // Bitten through: the void, as the background draws it through the gap. Without its
        // rock: it cannot show in the edge's fade under the rim, and would cost a copy.
    if(seabed < 1.0)
      color = mix(skyOceanThroughCutaway(skyAbyssGradient(y), dir, cameraPosition), color, seabed);
      #endif
  } else {
      #ifdef SKY_ABYSS_WALLS
    // The walls' fill stands in front of the lid here, or, from under their foot, the rock
    // that runs on down below it (skyAbyssWallUnder): the background draws both, so it is
    // left before the lid is shaded. Their faces are a mesh of their own, which hides the
    // lid by depth.
    vec3 wallStart = skyAbyssWallStart(cameraPosition, dir);
    if((wallStart.y > 0.0 && wallStart.x < dist) || skyAbyssWallUnder(cameraPosition, dir, wallStart) < dist)
      discard;
    // From the void: the lid, as the background draws it.
    color = skyAbyssLid(cameraPosition, dir, dist, lidFootprint);
      #else
    color = skyAbyssCeiling(world, distance(cameraPosition, world));
      #endif
    if(uSkyAbyssDarkening > 0.0)
      color *= exp((altitude + bedDepth) / uSkyAbyssDarkening);
  }
  // Bitten through, what lies behind shows, with the background's void beyond. Only here,
  // once the derivatives above are taken.
  if(seabed < 1e-3)
    discard;
    #ifdef STAGE_SEE_THROUGH
  gl_FragColor = vec4(color, seabed * uSkyOceanSeabedOpacity);
    #else
  gl_FragColor = vec4(color, 1.0);
    #endif
  if(skyDraws || overCurve)
    discard;
  #endif

  // Debug tints (SkyDebug.tint), by part.
  #if defined(STAGE_SURFACE)
  vec3 debugTint = vec3(0.1, 0.35, 1.0);
  #else
  vec3 debugTint = vec3(0.15, 0.8, 0.2);
  #endif
  gl_FragColor.rgb = skyDebugTint(gl_FragColor.rgb, debugTint);

  gl_FragColor.rgb *= uSkyIntensity;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
