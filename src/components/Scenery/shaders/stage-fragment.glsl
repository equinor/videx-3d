// A stage's real geometry, shaded with the sky's own sea so it continues the background
// without a seam. STAGE_SURFACE or STAGE_BED is defined; STAGE_SEE_THROUGH marks a seabed
// drawn at the sea's seabed opacity. STAGE_CURVED_DEPTH has the part write its depth where it
// lies on the globe beyond the disc, not the flat plane's: the surface's for a relief, the
// seabed's always, so what lies on the globe there is not hidden by the plane.

#include <common>
#include <logdepthbuf_pars_fragment>
#include ./scenery.glsl
#include ../../../sdk/materials/shaderLib/depth.glsl

uniform mat4 uSceneryStageInverseProjection;
uniform vec4 uSceneryStageViewport; // the pixels being drawn: x, y, width, height
#ifdef STAGE_CURVED_DEPTH
// three declares it for the vertex shader only, and sets it here by its name.
uniform mat4 projectionMatrix;
#endif

varying vec3 vStageWorld;
varying vec3 vViewPosition;

#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

// The view ray through this pixel. ⚠️ Not from vStageWorld: across the stage's
// far-reaching triangles, an interpolated position is metres off and seams the ripples.
// ⚠️ And built in view space: a world point minus the camera cancels away float precision.
vec3 stageViewRay() {
  vec2 ndc = (gl_FragCoord.xy - uSceneryStageViewport.xy) / uSceneryStageViewport.zw * 2.0 - 1.0;
  // A point on the ray, whichever way the depth range runs.
  vec4 point = uSceneryStageInverseProjection * vec4(ndc, 0.0, 1.0);
  return normalize(transpose(mat3(viewMatrix)) * (point.xyz / point.w));
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 dir = stageViewRay();
  float blend = max(uSkyHorizonBlend, fwidth(dot(dir, globeCameraLook())));
  float altitude = scenerySeaCameraAltitude();

  // The flat caps are shaded where the ray meets their plane, exactly; from above, beyond the
  // scene, where it meets them on the globe, as the sky's own sea. From below, level under
  // the camera (globeCameraUp), as the background's view in the water: far off the globe
  // tilts the field's up away.
  #if defined(STAGE_SURFACE)
  float planeAltitude = altitude;
  #else
  float planeAltitude = altitude + uScenerySeaDepth;
  #endif
  vec3 reach = planeAltitude > 0.0 ? scenerySeaReach(cameraPosition, dir, planeAltitude) : vec3(-planeAltitude / max(abs(dot(dir, globeCameraUp())), 1e-6), 0.0, 0.0);
  vec3 world = cameraPosition + dir * reach.x;
  // Sunk under a camera far off (stage-vertex), the plane bends back up toward the scene,
  // where a ray that crossed it crosses it again, from the other side: only the crossing
  // from the camera's side draws. The planes' triangles face up. From below a plane, which
  // is level under the camera (`reach`), only a ray rising over that level reaches it: far
  // off, the sunk plane still meets rays that do not, down to the field's level.
  bool fromBehind = gl_FrontFacing != (planeAltitude > 0.0) || (planeAltitude <= 0.0 && dot(dir, globeCameraUp()) <= 0.0);
  #ifdef STAGE_CURVED_DEPTH
  // At the part's own depth where it lies on the globe, which what lies beyond the scene on
  // the globe too (a relief, a geographic layer) meets. Over the disc the globe is the plane
  // the geometry lies on.
  vec3 fromScene = vStageWorld - uSceneryStageFlat.xyz;
  fromScene -= uSceneryUp * dot(fromScene, uSceneryUp);
  if(dot(fromScene, fromScene) > uSceneryStageFlat.w * uSceneryStageFlat.w)
    gl_FragDepth = depthOfView(projectionMatrix, mat3(viewMatrix) * dir * reach.x);
    #ifndef USE_LOGARITHMIC_DEPTH_BUFFER
  else
    gl_FragDepth = gl_FragCoord.z;
    #endif
  #endif
  vec2 p = scenerySeaPlane(world);
  float dist = distance(cameraPosition, world);
  #ifdef STAGE_SURFACE
  vec2 rimAt = scenerySeaCutawayRimAt(world, cameraPosition);
  #endif
  // The sky draws the band a pixel inside the stage's edge (see scenerySeaStaged), and the
  // stage leaves it, and everything beyond, alone.
  bool dry = uScenerySeaWater < 0.5;
  float bedAltitude = altitude + uScenerySeaDepth;
  #if !defined(STAGE_SURFACE)
  vec3 surfaceReach = scenerySeaReach(cameraPosition, dir, altitude);
  #endif
  // Where the stage's test meets the level it tests (scenerySeaStagedReach): from above the
  // water the surface, and over a dry sea the seabed from above it, both reached already.
  float stagedAt;
  #if defined(STAGE_SURFACE)
  if(altitude > 0.0 && !dry)
    stagedAt = reach.x;
  #else
  if(altitude > 0.0 && !dry)
    stagedAt = surfaceReach.x;
  else if(dry && bedAltitude > 0.0)
    stagedAt = reach.x;
  #endif
  else
    stagedAt = scenerySeaStagedReach(dir, cameraPosition);
  bool staged = scenerySeaStagedAlong(dir, cameraPosition, stagedAt, 1.0, false);
  bool outsideWater = dry || altitude > 0.0 || bedAltitude < 0.0;
  bool backgroundDraws = outsideWater && !staged;
  // From the void the lid hides the water, seabed or not: through an occupant's section,
  // or a see-through one, the background draws it.
  bool underLid = bedAltitude < 0.0;
  // Over the curved sea's horizon there is none, nor a seabed under it: the background's sky shows.
  #if defined(STAGE_SURFACE)
  float overSea = reach.z;
  #else
  float overSea = altitude > 0.0 && !dry ? surfaceReach.z : bedAltitude > 0.0 && dry ? reach.z : 0.0;
  #endif
  bool overCurve = uSceneryCurvature > 0.0 && planeAltitude > 0.0 && overSea > 0.5;

  #if defined(STAGE_SURFACE)
  // One wave for both sides: each call compiles a full copy of it.
  vec3 delta = dir * reach.x;
  float texel = scenerySeaTexel(delta);
  ScenerySeaWave wave = scenerySeaWave(delta, globeUpAt(world), texel, dist);
  bool cutThrough = false;
  if(altitude > 0.0) {
    vec4 surface = scenerySeaThroughAir(scenerySeaSurfaceOf(wave, p, texel, dir, blend, world), cameraPosition, dir, dist);
    gl_FragColor = scenerySeaCutawayMark(surface, world, rimAt);
  } else {
    vec3 underside = scenerySeaUndersideOf(-wave.normal, dir, blend, -altitude);
    float wall = scenerySeaCutawayWall(cameraPosition, dir);
    // The cutaway's cut takes the surface over it too: the background shows the sky there.
    float kept = wall >= dist ? 1.0 - uScenerySeaCutawayCuts.x : 1.0;
    cutThrough = kept < 1e-3;
    float path = scenerySeaCutawayPath(scenerySeaWaterPath(cameraPosition, world), wall, 1.0);
    vec3 seen = scenerySeaFog(underside, path, scenerySeaLightAlong(-altitude, 0.0, path), dir);
    gl_FragColor = vec4(seen, kept);
  }
  if(backgroundDraws || underLid || cutThrough || overCurve || fromBehind)
    discard;
  #else
  // Beyond the disc the seabed lies on the globe, as the background's does.
  vec3 up = globeUpAt(world);
  float bedDepth = uScenerySeaDepth;
  bool fromAbove = altitude + bedDepth > 0.0;
  // Under the stage's surface where the water hides the seabed whole (scenerySeaSurfaceHides),
  // its shading is never seen: skipped, the water's own light in its place (the surface's water
  // over it), its depth and discards kept, so what lies under it stays hidden as before. The test is uniform, so the
  // derivatives its detail takes are sound wherever it shows.
  #ifdef STAGE_BED_UNDER_SURFACE
  bool hidden = scenerySeaSurfaceHides();
  #else
  bool hidden = false;
  #endif
  // Shaded on the side the camera is on: from below only its lid is shaded.
  vec3 color = vec3(0.0);
  if(fromAbove && !hidden)
    color = scenerySeabed(world, up, bedDepth);
  float cutaway = scenerySeaCutawayAlong(cameraPosition, world);
  float seabed = scenerySeaCutawaySeabed(cutaway);
  if(fromAbove) {
    if(!hidden) {
      // From the air the surface carries the water in front of it (scenerySeaWaterUnder): the
      // bed is only dimmed by the daylight its depth leaves it (scenerySeabed). From in the water,
      // through the water between. Dry, the fog's density is 0.
      if(altitude <= 0.0) {
        float path = scenerySeaCutawayPath(scenerySeaPathBelowSurface(cameraPosition, world), scenerySeaCutawayWall(cameraPosition, dir), scenerySeaCutawayWater(cutaway));
        color = scenerySeaFog(color, path, scenerySeaLightAlong(-altitude, bedDepth, path), dir);
      }
        #ifndef STAGE_SEE_THROUGH
          // Bitten through: the void, as the background draws it through the gap.
      if(seabed < 1.0)
        color = mix(scenerySeaThroughCutaway(sceneryVoidDepths(dir), dir, cameraPosition), color, seabed);
        #endif
    } else {
      // Hidden: the water down to it lets nothing of it through, only its own light, as
      // water too deep to see through.
      color = scenerySeaFog(vec3(0.0), 1e6, scenerySeaLightAlong(max(-altitude, 0.0), bedDepth, 1e6), dir);
    }
  } else {
    // From the void: the lid, as the background draws it.
    color = sceneryVoidCeiling(world, distance(cameraPosition, world));
    if(uSceneryVoidDarkening > 0.0)
      color *= exp((altitude + bedDepth) / uSceneryVoidDarkening);
  }
  // Bitten through, what lies behind shows, with the background's void beyond. Only here,
  // once the derivatives above are taken.
  if(seabed < 1e-3)
    discard;
    #ifdef STAGE_SEE_THROUGH
  gl_FragColor = vec4(color, seabed * uScenerySeabedOpacity);
    #else
  gl_FragColor = vec4(color, 1.0);
    #endif
  if(backgroundDraws || overCurve || fromBehind)
    discard;
  #endif

  // Debug tints (SceneryDebug.tint), by part.
  #if defined(STAGE_SURFACE)
  vec3 debugTint = vec3(0.1, 0.35, 1.0);
  #else
  vec3 debugTint = vec3(0.15, 0.8, 0.2);
  #endif
  gl_FragColor.rgb = sceneryDebugTint(gl_FragColor.rgb, debugTint);

  gl_FragColor.rgb *= uSceneryIntensity;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
