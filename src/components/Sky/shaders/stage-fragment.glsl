// A stage's real geometry, shaded with the sky's own sea so it continues the background
// without a seam. One of STAGE_SURFACE, STAGE_BED or STAGE_WALL is defined; STAGE_DRY
// marks a seabed with no water over it, STAGE_DRAINED a wall around a drained hole.

#include <common>
#include <logdepthbuf_pars_fragment>
#include ./sky.glsl
#include ../../Ocean/shaders/ocean-body.glsl

uniform mat4 uSkyStageInverseProjection;
uniform vec4 uSkyStageViewport; // the pixels being drawn: x, y, width, height
uniform float uSkyOceanShimmer; // light play in the water body's walls
uniform float uSkyOceanBodyOpacity; // densest tint of the water body's walls

varying vec3 vStageWorld;
varying vec3 vViewPosition;
#ifdef STAGE_WALL
varying float vStageBedY;
varying float vStageWallV;
#endif
#ifdef STAGE_RELIEF
varying vec3 vStageNormal;
#endif
#ifdef STAGE_BAND
varying float vStageFade;
#endif

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

  // The flat caps are shaded where the ray meets their plane, exactly.
  #if defined(STAGE_SURFACE)
  float planeAltitude = altitude;
  #else
  float planeAltitude = altitude + uSkyOceanDepth;
  #endif
  #if defined(STAGE_WALL) || defined(STAGE_RELIEF)
  vec3 world = vStageWorld;
  #else
  vec3 world = cameraPosition + dir * (abs(planeAltitude) / max(abs(y), 1e-6));
  #endif
  vec2 p = skyOceanPlane(world);
  float texel = max(length(fwidth(p)), 1e-3);
  float dist = distance(cameraPosition, world);
  #ifdef STAGE_SURFACE
  float rimAt = skyOceanCutawayRimAt(world, cameraPosition);
  #endif
  // The sky draws the band a pixel inside the stage's edge (see skyOceanStaged), and the
  // stage leaves it, and everything beyond, alone.
  bool dry = uSkyOceanWater < 0.5;
  float bedAltitude = altitude + uSkyOceanDepth;
  bool staged = skyOceanStaged(dir, cameraPosition, 1.0, false);
  #ifdef STAGE_RELIEF
    // Over a dry bed the relief rises in front of the bed plane.
  if(dry && bedAltitude > 0.0)
    staged = skyOceanOnStage(p, dist, texel);
  #endif
  bool outsideWater = dry || altitude > 0.0 || bedAltitude < 0.0;
  bool skyDraws = outsideWater && !staged;
  // From the void under a seabed the lid hides the water: through an occupant's section,
  // or a see-through one, the background draws it.
  bool underLid = bedAltitude < 0.0 && uSkyOceanSeabed > 0.5;

  #if defined(STAGE_SURFACE)
  // One wave for both sides: each call compiles a full copy of it.
  SkyOceanWave wave = skyOceanWave(p, texel, dist);
  if(altitude > 0.0) {
    gl_FragColor = skyOceanCutawayMark(skyOceanSurfaceOf(wave, p, texel, dir, blend), world, rimAt);
  } else {
    vec3 underside = skyOceanUndersideOf(-wave.normal, dir, blend, -altitude);
    float path = skyOceanWaterPath(cameraPosition, world);
    vec3 seen = skyOceanFog(underside, path, skyOceanLight(-0.5 * altitude));
    gl_FragColor = vec4(skyOceanThroughVoid(seen, cameraPosition, dir), 1.0);
  }
  if(skyDraws || underLid)
    discard;
  #elif defined(STAGE_BED)
    #ifdef STAGE_RELIEF
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
  if(fromAbove) {
      #ifndef STAGE_DRY
    float light = skyOceanLight(0.5 * (bedDepth + max(-altitude, 0.0)));
    float path = skyOceanPathBelowSurface(cameraPosition, world) * skyOceanCutawayWater(cutaway);
    color = skyOceanFog(color, path, light);
      #endif
      #ifndef STAGE_BAND
        // Bitten through: the void, as the background draws it through the gap. Without its
        // rock: it cannot show in the edge's fade under the rim, and would cost a copy.
    if(seabed < 1.0)
      color = mix(skyOceanThroughCutaway(skyAbyssGradient(y), dir, cameraPosition), color, seabed);
      #endif
  } else {
      // From the void: the lid, as the background draws it.
    color = skyAbyssCeiling(world, distance(cameraPosition, world));
    if(uSkyAbyssDarkening > 0.0)
      color *= exp((altitude + bedDepth) / uSkyAbyssDarkening);
  }
    #ifdef STAGE_BAND
      // Over an occupant's seabed, which the cutaway leaves.
  gl_FragColor = vec4(color, vStageFade * seabed);
    #else
      // Bitten through, what lies behind shows, with the background's void beyond.
  if(seabed < 1e-3)
    discard;
  gl_FragColor = vec4(color, 1.0);
    #endif
  if(skyDraws)
    discard;
  #else
    // A wall of the sea along the outline: its water body, tinted over the view distance
    // as OceanVolumeMaterial tints it, with light play on the side facing in.
  float fog = 1.0 - exp(-dist * uSkyOceanFogDensity);
  vec3 tint = mix(uShallowColor, uDeepColor, fog);
  float alpha = clamp(fog * uSkyOceanBodyOpacity, 0.0, 1.0);
    #ifdef STAGE_DRAINED
      // Facing into the drained hole, the endless sea beyond. Taken on both faces: it
      // takes derivatives.
  vec3 beyond = skyOceanInWater(world, dir, blend, dist, uSkyOceanLevel - vStageBedY, skyOceanVoid(dir));
    #endif
  if(uSkyOceanShimmer > 0.0 && gl_FrontFacing) {
    tint = oceanBodyLight(tint, world, vStageWallV, uTime, uSkyOceanShimmer, uShallowColor);
  }
  gl_FragColor = vec4(tint, alpha);
    #ifdef STAGE_DRAINED
  if(gl_FrontFacing)
    gl_FragColor = vec4(mix(beyond, tint, alpha), 1.0);
    #endif
  if(underLid)
    discard;
  #endif

  // Debug tints (SkyDebug.tint), by part.
  #if defined(STAGE_SURFACE)
  vec3 debugTint = vec3(0.1, 0.35, 1.0);
  #elif defined(STAGE_BAND)
  vec3 debugTint = vec3(1.0, 0.1, 0.8);
  #elif defined(STAGE_RELIEF)
  vec3 debugTint = vec3(0.0, 0.85, 0.9);
  #elif defined(STAGE_BED)
  vec3 debugTint = vec3(0.15, 0.8, 0.2);
  #else
  vec3 debugTint = vec3(1.0, 0.9, 0.1);
  #endif
  gl_FragColor.rgb = skyDebugTint(gl_FragColor.rgb, debugTint);

  gl_FragColor.rgb *= uSkyIntensity;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
