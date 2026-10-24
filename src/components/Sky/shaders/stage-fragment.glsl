// A stage's real geometry, shaded with the sky's own sea so it continues the background
// without a seam. STAGE_SURFACE or STAGE_BED is defined; STAGE_SEE_THROUGH marks a seabed
// drawn at the sea's seabed opacity, and
// STAGE_OCCUPANT an occupant's own seabed, which the cutaway never cuts. STAGE_SECTION and
// STAGE_FENCE cut that seabed with the occupant instead, by its own uniforms.
// STAGE_CURVED_DEPTH has the surface write the depth of the curved sea, for a relief.

#include <common>
#include <logdepthbuf_pars_fragment>
#include ./sky.glsl

uniform mat4 uSkyStageInverseProjection;
uniform vec4 uSkyStageViewport; // the pixels being drawn: x, y, width, height

varying vec3 vStageWorld;
varying vec3 vViewPosition;
#ifdef STAGE_SHAPED
varying vec3 vStageNormal;
#endif

#ifdef STAGE_SECTION
uniform vec4 sectionPlane; // the half-space it points at is cut away
#endif
#ifdef STAGE_FENCE
uniform vec2 fenceParams; // x: 1 while the cut is live, y: +1 keeps the block
uniform sampler2D fenceMap;
uniform mat3 fenceToUv;
uniform vec2 fenceSize;
#include ../../../sdk/materials/shaderLib/fence-field.glsl
#endif

// Cut away with the occupant, by its section and its fence, as the occupant cuts itself.
bool stageCutAway() {
  #ifdef STAGE_SECTION
  if(dot(sectionPlane.xyz, vStageWorld) + sectionPlane.w > 0.0)
    return true;
  #endif
  #ifdef STAGE_FENCE
  if(fenceParams.x > 0.5 && fenceParams.y * fenceSide(fenceMap, fenceToUv, fenceSize, vStageWorld.xz) < 0.0)
    return true;
  #endif
  return false;
}

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
  #ifdef STAGE_SHAPED
  vec3 world = vStageWorld;
  #else
  vec3 world = cameraPosition + dir * reach.x;
  #endif
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
  #ifdef STAGE_SHAPED
    // Over a dry bed the shaped bed rises in front of the bed plane.
  if(dry && bedAltitude > 0.0)
    staged = skyOceanOnStage(p, dist, texel);
  #endif
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
    #ifdef STAGE_SHAPED
  vec3 up = normalize(vStageNormal);
  up *= dot(up, uSkyUp) < 0.0 ? -1.0 : 1.0;
  float bedDepth = uSkyOceanLevel - dot(world, uSkyUp);
      // The lid is seen only from the void below the flat seabed, or from inside an
      // occupant's seabed above it: anywhere else, and above the point, the camera sees
      // seabed. Otherwise it asks which side of the slope it is on. ⚠️ From the face's
      // own plane: a smoothed normal's slight tilt can outweigh the camera's height.
  vec3 face = cross(dFdx(vStageWorld), dFdy(vStageWorld));
  face *= dot(face, uSkyUp) < 0.0 ? -1.0 : 1.0;
  bool inSea = altitude + uSkyOceanDepth > 0.0 && uSkyOceanBuried < 0.5;
  bool fromAbove = inSea || altitude + bedDepth > 0.0 || dot(face, cameraPosition - world) > 0.0;
    #else
  vec3 up = uSkyUp;
  float bedDepth = uSkyOceanDepth;
  bool fromAbove = altitude + bedDepth > 0.0;
    #endif
    // Shaded whichever side the camera is on: it takes derivatives.
  vec3 color = skyOceanBed(world, up, bedDepth);
  float cutaway = skyOceanCutawayAlong(cameraPosition, world);
  float seabed = skyOceanCutawaySeabed(cutaway);
  bool behindWall = false;
    #ifdef STAGE_OCCUPANT
  seabed = 1.0;
    #endif
  if(fromAbove) {
    // Dry, the fog's density is 0.
    float light = skyOceanLight(0.5 * (bedDepth + max(-altitude, 0.0)));
    float below = skyOceanPathBelowSurface(cameraPosition, world);
      #ifndef STAGE_SHAPED
    // Beyond the scene both fall away with the curve: the water lies between them, not under the level.
    if(altitude > 0.0 && uSkyCurvature > 0.0)
      below = max(reach.x - surfaceReach.x, 0.0);
      #endif
    float path = skyOceanCutawayPath(below, skyOceanCutawayWall(cameraPosition, dir), skyOceanCutawayWater(cutaway));
    color = skyOceanFog(color, path, light);
      #ifndef STAGE_SEE_THROUGH
        // Bitten through: the void, as the background draws it through the gap. Without its
        // rock: it cannot show in the edge's fade under the rim, and would cost a copy.
    if(seabed < 1.0)
      color = mix(skyOceanThroughCutaway(skyAbyssGradient(y), dir, cameraPosition), color, seabed);
      #endif
  } else {
      // From the void: the lid, as the background draws it.
      #ifdef SKY_ABYSS_WALLS
    color = skyAbyssLid(cameraPosition, dir, distance(cameraPosition, world));
      #else
    color = skyAbyssCeiling(world, distance(cameraPosition, world));
      #endif
    if(uSkyAbyssDarkening > 0.0)
      color *= exp((altitude + bedDepth) / uSkyAbyssDarkening);
      #ifdef SKY_ABYSS_WALLS
    // The walls' fill stands in front of the lid here, or, from under their foot, the rock
    // that runs on down below it (skyAbyssWallUnder): the background draws both. Their
    // faces are a mesh of their own, which hides the lid by depth.
    vec3 wallStart = skyAbyssWallStart(cameraPosition, dir);
    float lidAt = distance(cameraPosition, world);
    behindWall = (wallStart.y > 0.0 && wallStart.x < lidAt) || skyAbyssWallUnder(cameraPosition, dir, wallStart) < lidAt;
      #endif
  }
      // Bitten through, what lies behind shows, with the background's void beyond. Cut
      // away with the occupant only here, once the derivatives above are taken.
  if(seabed < 1e-3 || stageCutAway() || behindWall)
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
  #elif defined(STAGE_OCCUPANT)
  vec3 debugTint = vec3(1.0, 0.1, 0.8);
  #elif defined(STAGE_SHAPED)
  vec3 debugTint = vec3(0.0, 0.85, 0.9);
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
